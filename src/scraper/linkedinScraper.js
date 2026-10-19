"use strict";

// LinkedIn scraper. Runs in the same Chrome via CDP; login walls and
// rate limits skip the query instead of throwing.
//
// The search UI is server-driven: cards live under a virtualized lazy-column,
// the results pane scrolls inside <main> (not the window), and permalinks
// only arrive in the RSC pagination responses.

const crypto = require("crypto");
const { sleep, random } = require("../utils/humanBehavior");
const { shuffled, markKnown, isTargetClosed } = require("../utils/scrape");
const config = require("../config");

const CARD_SELECTOR = 'div[data-testid="lazy-column"] div[role="listitem"]';
const TEXT_SELECTOR = '[data-testid="expandable-text-box"]';
const PROFILE_SELECTOR = 'a[href*="/in/"], a[href*="/company/"]';

const SLUG_URL_RE = /https:\/\/www\.linkedin\.com\/posts\/[^"\\\s]+/g;

function linkedinSearchUrl(query) {
  const suffix = String(config.linkedin.searchSuffix || "").trim();
  const full = suffix ? `${query} ${suffix}` : String(query);
  return `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(full)}&sortBy=%22date_posted%22`;
}

function queriesForRun() {
  return shuffled([...config.linkedin.queries]).slice(0, Math.max(0, config.linkedin.maxQueriesPerRun));
}

function textHash(author, text) {
  return crypto.createHash("sha1").update(`${author || ""}|${text || ""}`).digest("hex").slice(0, 16);
}

// Post identity: activity id from a permalink, falling back to a text hash.
function linkedinPostKey(p) {
  const m = String(p.url || "").match(/-(\d{15,})-[a-z0-9-]+\/?$/i);
  return m ? `li:${m[1]}` : `litext:${textHash(p.author || p.handle, p.content || p.title)}`;
}

const LOGIN_WALL_SELECTORS = [
  "form.login__form",
  "input#username",
  "input#session_key",
  'a[href*="/login"]',
  'a[href*="/authwall"]',
  'text=/Sign in to LinkedIn/i',
  'text=/Join now/i',
  'text=/New to LinkedIn/i',
];

const RATE_LIMIT_PATTERNS = [/something went wrong/i, /rate limit/i, /too many requests/i, /unusual activity/i];

async function isVisible(page, selector) {
  try {
    const loc = page.locator(selector);
    const count = await loc.count();
    for (let i = 0; i < Math.min(count, 5); i++) {
      try {
        if (await loc.nth(i).isVisible()) return true;
      } catch {}
    }
  } catch {}
  return false;
}

async function isLinkedInLoginWallVisible(page) {
  try {
    if (/\/authwall|\/login|\/checkpoint\/lg\//i.test(page.url())) return true;
  } catch {}
  for (const sel of LOGIN_WALL_SELECTORS) {
    if (await isVisible(page, sel)) return true;
  }
  return false;
}

async function isLinkedInRateLimited(page) {
  // Only when no cards rendered, so post text saying "try again" doesn't match.
  try {
    const posts = await page.locator(CARD_SELECTOR).count();
    if (posts > 0) return false;
    const body = await page.evaluate(() => document.body.innerText.slice(0, 2000));
    return RATE_LIMIT_PATTERNS.some((re) => re.test(body || ""));
  } catch {
    return false;
  }
}

async function waitForPosts(page, timeoutMs = 15000) {
  try {
    await page.locator(CARD_SELECTOR).first().waitFor({ state: "attached", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function ensureLinkedInPageReady(page) {
  await sleep(2500);
  if (await isLinkedInLoginWallVisible(page)) {
    console.log("⛔ LinkedIn login wall detected — log in manually in Chrome, skipping page.");
    return false;
  }
  const rendered = await waitForPosts(page);
  if (!rendered) {
    if (await isLinkedInLoginWallVisible(page)) {
      console.log("⛔ LinkedIn login wall detected — log in manually in Chrome, skipping page.");
      return false;
    }
    if (await isLinkedInRateLimited(page)) {
      console.log("⛔ LinkedIn rate limit / error page, skipping query.");
      return false;
    }
    console.log("⚠️  No posts rendered on LinkedIn page, continuing with fallback (may be empty).");
  }
  return true;
}

function cleanText(text) {
  return String(text || "")
    .replace(/\s*(?:…|\.\.\.)\s*(?:more|see more|see translation)\s*$/i, "")
    .trim();
}

function slugifyText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// "/posts/<author>_<text-slug>-(share|ugcPost|activity)-<id>-<rand>"
function slugUrlText(slugUrl) {
  const m = String(slugUrl || "").match(/\/posts\/[^_/]+_(.+?)-(?:share|ugcPost|activity)-/i);
  return m ? m[1].toLowerCase() : "";
}

function slugMatches(text, slugUrl) {
  const cardSlug = slugifyText(text).slice(0, 24);
  if (cardSlug.length < 8) return false;
  const slugText = slugUrlText(slugUrl).slice(0, 24);
  if (!slugText) return false;
  return slugText.startsWith(cardSlug) || cardSlug.startsWith(slugText);
}

function profileVanity(url) {
  const m = String(url || "").match(/\/(?:in|company)\/([^/?#]+)/i);
  if (!m) return "";
  try {
    return decodeURIComponent(m[1]).toLowerCase();
  } catch {
    return m[1].toLowerCase();
  }
}

function slugAuthor(slugUrl) {
  const m = String(slugUrl || "").match(/\/posts\/([^_/]+)_/);
  if (!m) return "";
  try {
    return decodeURIComponent(m[1]).toLowerCase();
  } catch {
    return m[1].toLowerCase();
  }
}

// Fills in real permalinks. Best: same author + same text slug; then text
// slug alone; then the first remaining post by the same author.
function attachPermalinks(posts, slugUrls) {
  if (!slugUrls || slugUrls.length === 0) return posts;
  const remaining = [...slugUrls];
  const take = (p, idx) => {
    p.url = remaining[idx];
    remaining.splice(idx, 1);
  };
  const passes = [
    (p, u) => slugAuthor(u) === profileVanity(p.url) && slugMatches(p.content || p.title, u),
    (p, u) => slugMatches(p.content || p.title, u),
    (p, u) => slugAuthor(u) === profileVanity(p.url),
  ];
  for (const match of passes) {
    for (const p of posts) {
      if (!/#post-/.test(p.url)) continue; // already has a permalink
      const idx = remaining.findIndex((u) => match(p, u));
      if (idx !== -1) take(p, idx);
    }
  }
  return posts;
}

// The search pane scrolls inside an overflow container (main), not the window.
async function scrollStep(page) {
  return page.evaluate((selector) => {
    const card = document.querySelector(selector);
    let scroller = null;
    for (let n = card ? card.parentElement : null; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 40) {
        scroller = n;
        break;
      }
    }
    if (!scroller) scroller = document.scrollingElement || document.documentElement;
    const before = scroller.scrollTop;
    scroller.scrollBy(0, Math.max(200, Math.floor(scroller.clientHeight * 0.85)));
    return { before, after: scroller.scrollTop, scrollHeight: scroller.scrollHeight };
  }, CARD_SELECTOR);
}

async function collectPosts(page, query) {
  let raw = [];
  try {
    raw = await page.evaluate(
      ({ cardSelector, textSelector, profileSelector }) => {
        const cards = [...document.querySelectorAll(cardSelector)];
        return cards.map((card) => {
          const textEl = card.querySelector(textSelector);
          const text = ((textEl && textEl.innerText) || card.innerText || "").trim();
          const profileEl = card.querySelector(profileSelector);
          let author = "";
          for (const b of card.querySelectorAll("button")) {
            const label = `${b.getAttribute("aria-label") || ""} ${b.innerText || ""}`.trim();
            const m = label.match(/^Open control menu for post by (.+)$/i);
            if (m) {
              author = m[1].trim();
              break;
            }
          }
          if (!author) {
            for (const el of card.querySelectorAll("section[aria-label], div[aria-label]")) {
              const label = el.getAttribute("aria-label") || "";
              if (!/profile/i.test(label)) continue;
              author = label
                .replace(/\s+(verified\s+|premium\s+)?profile\b.*$/i, "")
                .replace(/\s+\d+(?:st|nd|rd)\+?\s*$/i, "")
                .trim();
              if (author) break;
            }
          }
          return { text, author, profileUrl: profileEl ? profileEl.href : "" };
        });
      },
      { cardSelector: CARD_SELECTOR, textSelector: TEXT_SELECTOR, profileSelector: PROFILE_SELECTOR }
    );
  } catch {
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const p of raw) {
    const content = cleanText(p.text);
    if (!content || content.length < 10) continue;
    // Prefer the permalink later (attachPermalinks); this is the fallback.
    const marker = textHash(p.author, content);
    const url = p.profileUrl
      ? `${p.profileUrl.split("?")[0]}#post-${marker}`
      : `https://www.linkedin.com/search/results/content/#post-${marker}`;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({
      // Title capped for Discord; content keeps the full text.
      platform: "linkedin",
      subreddit: "linkedin",
      handle: p.author || "",
      query,
      title: content.slice(0, 140),
      content,
      url,
      upvotes: 0,
      comments: 0,
      author: p.author || "",
      scrapedAt: new Date().toISOString(),
      source: `linkedin-search: ${query}`,
    });
  }
  return out;
}

async function scrollToLoadPosts(page, query) {
  const limit = config.linkedin.searchScrolls;
  const seen = new Map();
  let stagnant = 0;
  for (let i = 0; i < limit; i++) {
    if (await isLinkedInLoginWallVisible(page)) {
      console.log("⛔ LinkedIn login wall mid-scroll, keeping what was collected.");
      break;
    }
    let batch = [];
    try {
      batch = await collectPosts(page, query);
    } catch {
      console.log(`📜 LinkedIn scroll ${i + 1}/${limit}: collect failed, continuing`);
    }
    const before = seen.size;
    for (const p of batch) {
      const key = linkedinPostKey(p);
      if (!seen.has(key)) seen.set(key, p);
    }
    console.log(`📜 LinkedIn scroll ${i + 1}/${limit} "${query}": ${batch.length} on page, ${seen.size} unique`);
    if (seen.size >= config.linkedin.maxPosts) break;
    if (seen.size === before) {
      stagnant++;
      if (stagnant >= 4) break;
    } else {
      stagnant = 0;
    }
    // Mark dead renderer so the job can retry on a fresh tab.
    try {
      await scrollStep(page);
      await page.waitForTimeout(config.linkedin.scrollDelayMs);
    } catch (err) {
      if (isTargetClosed(err)) {
        const e = new Error(`LinkedIn tab closed mid-scroll: ${err.message}`);
        e.code = "TARGET_CLOSED";
        throw e;
      }
      console.log(`📜 LinkedIn scroll ${i + 1}/${limit}: scroll/wait failed, continuing`);
    }
  }
  return [...seen.values()];
}

function mergeLinkedInByUrl(lists) {
  const merged = new Map();
  for (const p of lists.flat()) {
    if (!p.url) continue;
    const key = linkedinPostKey(p);
    const prev = merged.get(key);
    if (!prev || ((prev.content || "").length < (p.content || "").length)) merged.set(key, p);
  }
  return [...merged.values()];
}

// Real permalinks live in the RSC pagination responses, not the DOM.
// Intercepting (fetch + fulfill) is the only reliable way to read the body:
// passive response listeners race with navigation and lose batches.
const PAGINATION_ROUTE = "**/rsc-action/actions/pagination**";

async function startSlugHarvest(page) {
  const slugs = [];
  const handler = async (route) => {
    try {
      const response = await route.fetch();
      const body = await response.text();
      for (const s of body.match(SLUG_URL_RE) || []) {
        if (!slugs.includes(s)) slugs.push(s);
      }
      await route.fulfill({ response, body });
    } catch {
      try {
        await route.continue();
      } catch {}
    }
  };
  await page.route(PAGINATION_ROUTE, handler);
  return {
    slugs,
    stop: async () => {
      try {
        await page.unroute(PAGINATION_ROUTE, handler);
      } catch {}
    },
  };
}

// First batch is server-rendered with its slugs embedded in the HTML.
async function fetchInitialSlugs(page) {
  try {
    const found = await page.evaluate(async (pattern) => {
      const res = await fetch(window.location.href, { credentials: "include" });
      if (!res.ok) return [];
      const text = await res.text();
      return text.match(new RegExp(pattern, "g")) || [];
    }, SLUG_URL_RE.source);
    return [...new Set(found)];
  } catch {
    return [];
  }
}

async function scrapeLinkedInSearch(page, query, knownUrls, isFirst = false) {
  const url = linkedinSearchUrl(query);
  console.log(`\n💼 LinkedIn search: "${query}"`);
  // No delay before the first query; gaps only between queries.
  if (!isFirst) {
    await sleep(config.linkedin.interPageDelayMs + Math.floor(random(0, 3000)));
  }
  // Listen from before navigation: initial rendering already fires pagination.
  const harvest = await startSlugHarvest(page);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: config.navigationTimeoutMs });
    const ready = await ensureLinkedInPageReady(page);
    if (!ready) {
      console.log(`📦 LinkedIn "${query}": skipped (login wall / rate limit)`);
      return [];
    }
    const initialSlugs = await fetchInitialSlugs(page);
    const collected = await scrollToLoadPosts(page, query);
    let fresh = [];
    try {
      fresh = await collectPosts(page, query);
    } catch {}
    await sleep(800);
    const posts = mergeLinkedInByUrl([collected, fresh]).slice(0, config.linkedin.maxPosts);
    const slugUrls = [...initialSlugs, ...harvest.slugs];
    attachPermalinks(posts, slugUrls);
    const withPermalink = posts.filter((p) => !/#post-/.test(p.url)).length;
    const newCount = markKnown(posts, knownUrls);
    console.log(`📦 LinkedIn "${query}": ${posts.length} posts${newCount === null ? "" : ` (${newCount} new)`} (${withPermalink} with permalinks, ${slugUrls.length} slugs seen)`);
    return posts;
  } finally {
    await harvest.stop();
  }
}

async function scrapeLinkedInFull(page, knownUrls) {
  const queries = queriesForRun();
  console.log(`\n💼 LinkedIn enabled: ${queries.length}/${config.linkedin.queries.length} queries this run: ${queries.join(" | ")}`);
  let all = [];
  let emptyInARow = 0;
  for (let qi = 0; qi < queries.length; qi++) {
    const q = queries[qi];
    let posts = [];
    try {
      posts = await scrapeLinkedInSearch(page, q, knownUrls, qi === 0);
    } catch (err) {
      // Dead renderer — rethrow so the job can open a fresh tab.
      if (err && err.code === "TARGET_CLOSED") throw err;
      console.error(`❌ LinkedIn search "${q}" failed, continuing: ${err.message}`);
      posts = [];
    }
    all = all.concat(posts);
    if (posts.length === 0) {
      emptyInARow++;
      if (emptyInARow >= 3) {
        console.log("\n⛔ 3 LinkedIn queries in a row returned 0 posts — likely login wall or rate limit. Keeping what was collected.");
        break;
      }
    } else {
      emptyInARow = 0;
    }
  }
  const merged = mergeLinkedInByUrl([all]).slice(0, config.linkedin.maxPosts * queries.length);
  console.log(`\n📦 LinkedIn total: ${merged.length} unique posts (${queries.length} queries)`);
  return merged;
}

module.exports = { scrapeLinkedInFull, isTargetClosed };
