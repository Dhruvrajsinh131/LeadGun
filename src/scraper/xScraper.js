"use strict";

// X (Twitter) scraper. Runs in the same Chrome via CDP; login walls and
// rate limits skip the query instead of throwing.

const { sleep, random } = require("../utils/humanBehavior");
const config = require("../config");

function isTargetClosed(err) {
  return /target page, context or browser has been closed/i.test(String((err && err.message) || err || ""));
}

function xSearchUrl(query) {
  const suffix = String(config.x.searchSuffix || "").trim();
  const full = suffix ? `${query} ${suffix}` : String(query);
  return `https://x.com/search?q=${encodeURIComponent(full)}&src=typed_query&f=live`;
}

function shuffled(arr) {
  const out = [...arr];
  const doShuffle = config.shuffleOrder;
  if (!doShuffle) return out;
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function queriesForRun() {
  return shuffled([...config.x.queries]).slice(0, Math.max(0, config.x.maxQueriesPerRun));
}

// Tweet identity: status id, falling back to the URL.
function xPostKey(p) {
  const m = String(p.url || "").match(/status\/(\d+)/i);
  return m ? `x:${m[1]}` : `xurl:${p.url}`;
}

const LOGIN_WALL_SELECTORS = [
  'a[href="/login"]',
  'a[href*="/i/flow/login"]',
  'text=/Log in to X/i',
  'text=/Sign in to X/i',
];

const RATE_LIMIT_PATTERNS = [/something went wrong/i, /rate limit/i, /try again/i];

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

async function isXLoginWallVisible(page) {
  for (const sel of LOGIN_WALL_SELECTORS) {
    if (await isVisible(page, sel)) return true;
  }
  return false;
}

async function isXRateLimited(page) {
  // Only when no tweets rendered, so replies saying "try again" don't match.
  try {
    const tweets = await page.locator('article[data-testid="tweet"]').count();
    if (tweets > 0) return false;
    const body = await page.evaluate(() => document.body.innerText.slice(0, 2000));
    return RATE_LIMIT_PATTERNS.some((re) => re.test(body || ""));
  } catch {
    return false;
  }
}

async function waitForTweets(page, timeoutMs = 15000) {
  try {
    await page.locator('article[data-testid="tweet"]').first().waitFor({ state: "attached", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function ensureXPageReady(page) {
  await sleep(2500);
  if (await isXLoginWallVisible(page)) {
    console.log("⛔ X login wall detected — log in manually in Chrome, skipping page.");
    return false;
  }
  const rendered = await waitForTweets(page);
  if (!rendered) {
    if (await isXLoginWallVisible(page)) {
      console.log("⛔ X login wall detected — log in manually in Chrome, skipping page.");
      return false;
    }
    if (await isXRateLimited(page)) {
      console.log("⛔ X rate limit / error page, skipping query.");
      return false;
    }
    console.log("⚠️  No tweets rendered on X page, continuing with fallback (may be empty).");
  }
  return true;
}

async function collectTweets(page, query) {
  let raw = [];
  try {
    raw = await page.locator('article[data-testid="tweet"]').evaluateAll((articles) =>
      articles.map((a) => {
        const textEl = a.querySelector('div[data-testid="tweetText"]');
        const text = (textEl ? textEl.innerText : a.innerText || "").trim();
        const statusLink = a.querySelector('a[href*="/status/"]');
        const href = statusLink ? statusLink.href : "";
        const timeEl = a.querySelector("time");
        const createdAt = timeEl ? timeEl.getAttribute("datetime") || "" : "";
        const m = String(href).match(/x\.com\/([^/]+)\/status\/(\d+)/i);
        return { text, url: href, author: m ? m[1] : "", createdAt };
      })
    );
  } catch {
    return [];
  }
  const out = [];
  for (const t of raw) {
    if (!t.url || !t.text || t.text.length < 10) continue;
    out.push({
      // Title capped for Discord; content keeps the full text.
      platform: "x",
      subreddit: "x",
      handle: t.author || "",
      query,
      title: t.text.slice(0, 140),
      content: t.text,
      url: t.url,
      upvotes: 0,
      comments: 0,
      author: t.author || "",
      createdAt: t.createdAt || "",
      scrapedAt: new Date().toISOString(),
      source: `x-search: ${query}`,
    });
  }
  return out;
}

async function scrollToLoadTweets(page, query) {
  const limit = config.x.searchScrolls;
  const seen = new Map();
  let stagnant = 0;
  for (let i = 0; i < limit; i++) {
    if (await isXLoginWallVisible(page)) {
      console.log("⛔ X login wall mid-scroll, keeping what was collected.");
      break;
    }
    let batch = [];
    try {
      batch = await collectTweets(page, query);
    } catch {
      console.log(`📜 X scroll ${i + 1}/${limit}: collect failed, continuing`);
    }
    const before = seen.size;
    for (const p of batch) {
      const key = xPostKey(p);
      if (!seen.has(key)) seen.set(key, p);
    }
    console.log(`📜 X scroll ${i + 1}/${limit} "${query}": ${batch.length} on page, ${seen.size} unique`);
    if (seen.size >= config.x.maxPosts) break;
    if (seen.size === before) {
      stagnant++;
      if (stagnant >= 3) break;
    } else {
      stagnant = 0;
    }
    // Mark dead renderer so the job can retry on a fresh tab.
    try {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await page.waitForTimeout(config.x.scrollDelayMs);
    } catch (err) {
      if (isTargetClosed(err)) {
        const e = new Error(`X tab closed mid-scroll: ${err.message}`);
        e.code = "TARGET_CLOSED";
        throw e;
      }
      console.log(`📜 X scroll ${i + 1}/${limit}: scroll/wait failed, continuing`);
    }
  }
  return [...seen.values()];
}

function mergeXByUrl(lists) {
  const merged = new Map();
  for (const p of lists.flat()) {
    if (!p.url) continue;
    const key = xPostKey(p);
    const prev = merged.get(key);
    if (!prev || ((prev.content || "").length < (p.content || "").length)) merged.set(key, p);
  }
  return [...merged.values()];
}

function markKnown(posts, known) {
  if (!known) return null;
  let n = 0;
  for (const p of posts) {
    if (!p.url) continue;
    if (!known.has(p.url)) {
      n++;
      known.add(p.url);
    }
  }
  return n;
}

async function scrapeXSearch(page, query, knownUrls, isFirst = false) {
  const url = xSearchUrl(query);
  console.log(`\n𝕏 search: "${query}"`);
  // No delay before the first query; gaps only between queries.
  if (!isFirst) {
    await sleep(config.x.interPageDelayMs + Math.floor(random(0, 3000)));
  }
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: config.navigationTimeoutMs });
  const ready = await ensureXPageReady(page);
  if (!ready) {
    console.log(`📦 𝕏 "${query}": skipped (login wall / rate limit)`);
    return [];
  }
  const collected = await scrollToLoadTweets(page, query);
  let fresh = [];
  try {
    fresh = await collectTweets(page, query);
  } catch {}
  const posts = mergeXByUrl([collected, fresh]).slice(0, config.x.maxPosts);
  const newCount = markKnown(posts, knownUrls);
  console.log(`📦 𝕏 "${query}": ${posts.length} posts${newCount === null ? "" : ` (${newCount} new)`}`);
  return posts;
}

async function scrapeXFull(page, knownUrls) {
  const queries = queriesForRun();
  console.log(`\n𝕏 enabled: ${queries.length}/${config.x.queries.length} queries this run: ${queries.join(" | ")}`);
  let all = [];
  let emptyInARow = 0;
  for (let qi = 0; qi < queries.length; qi++) {
    const q = queries[qi];
    let posts = [];
    try {
      posts = await scrapeXSearch(page, q, knownUrls, qi === 0);
    } catch (err) {
      // Dead renderer — rethrow so the job can open a fresh tab.
      if (err && err.code === "TARGET_CLOSED") throw err;
      console.error(`❌ 𝕏 search "${q}" failed, continuing: ${err.message}`);
      posts = [];
    }
    all = all.concat(posts);
    if (posts.length === 0) {
      emptyInARow++;
      if (emptyInARow >= 3) {
        console.log("\n⛔ 3 X queries in a row returned 0 posts — likely login wall or rate limit. Keeping what was collected.");
        break;
      }
    } else {
      emptyInARow = 0;
    }
  }
  const merged = mergeXByUrl([all]).slice(0, config.x.maxPosts * queries.length);
  console.log(`\n📦 𝕏 total: ${merged.length} unique posts (${queries.length} queries)`);
  return merged;
}

module.exports = {
  xSearchUrl,
  queriesForRun,
  xPostKey,
  isTargetClosed,
  isXLoginWallVisible,
  ensureXPageReady,
  collectTweets,
  scrollToLoadTweets,
  scrapeXSearch,
  scrapeXFull,
  mergeXByUrl,
};
