"use strict";

const crypto = require("crypto");
const { sleep, random } = require("../utils/humanBehavior");
const { shuffled, markKnown, isTargetClosed } = require("../utils/scrape");
const config = require("../config");

const CARD_SELECTORS = [
  'article[data-test="JobTile"]',
  'article[data-ev-label="search_results_impression"]',
  '[data-ev-job-uid]',
  'div[data-test="job-tile-list"] article',
  'div[data-testid="job-tile-list"] article',
  'div[data-testid="job-tile-list"] section',
  'section[data-test="JobTile"]',
  'article.job-tile',
];
const CARD_SELECTOR = CARD_SELECTORS.join(", ");

const BLOCK_PATTERNS = [
  /attention required/i,
  /you have been blocked/i,
  /verify you are human/i,
  /just a moment/i,
  /too many requests/i,
  /unusual activity/i,
  /access denied/i,
  /enable javascript and cookies/i,
];

function upworkSearchUrl(query) {
  const suffix = String(config.upwork.searchSuffix || "").trim();
  const full = suffix ? `${query} ${suffix}` : String(query);
  const sort = encodeURIComponent(config.upwork.sort || "recency");
  return `https://www.upwork.com/nx/search/jobs/?q=${encodeURIComponent(full)}&sort=${sort}`;
}

function queriesForRun() {
  return shuffled([...config.upwork.queries]).slice(0, Math.max(0, config.upwork.maxQueriesPerRun));
}

function upworkJobId(url) {
  const match = String(url || "").match(/~([a-z0-9]{8,})/i);
  return match ? match[1].toLowerCase() : "";
}

function upworkPostKey(p) {
  const id = upworkJobId(p.url);
  if (id) return `upwork:${id}`;
  const hash = crypto
    .createHash("sha1")
    .update(`${p.title || ""}|${p.content || ""}`)
    .digest("hex")
    .slice(0, 16);
  return `upworktext:${hash}`;
}

function canonicalJobUrl(href) {
  const raw = String(href || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw, "https://www.upwork.com");
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return raw;
  }
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanPosted(value) {
  return cleanText(value)
    .replace(/^posted\s+(?:on\s+)?/i, "")
    .replace(/\s*[•·].*$/, "")
    .trim();
}

async function isUpworkLoginWallVisible(page) {
  try {
    if (/\/(?:login|signup|ab\/account-security)\b/i.test(page.url())) return true;
    const cards = await page.locator(CARD_SELECTOR).count();
    if (cards > 0) return false;
    const body = await page.evaluate(() => document.body.innerText.slice(0, 3000));
    return /(?:log in to upwork|sign up to view|create an account to (?:view|apply)|sign in to upwork)/i.test(body || "");
  } catch {
    return false;
  }
}

async function isUpworkBlocked(page) {
  try {
    const cards = await page.locator(CARD_SELECTOR).count();
    if (cards > 0) return false;
    const body = await page.evaluate(() => document.body.innerText.slice(0, 3000));
    return BLOCK_PATTERNS.some((re) => re.test(body || ""));
  } catch {
    return false;
  }
}

async function waitForJobs(page, timeoutMs = 15000) {
  try {
    await page.locator(CARD_SELECTOR).first().waitFor({ state: "attached", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function ensureUpworkPageReady(page) {
  await sleep(2500);
  if (await waitForJobs(page)) return true;
  if (await isUpworkLoginWallVisible(page)) {
    console.log("⛔ Upwork login wall detected — log in manually in Chrome, skipping page.");
    return false;
  }
  if (await isUpworkBlocked(page)) {
    console.log("⛔ Upwork Cloudflare block / rate limit, skipping query.");
    return false;
  }
  console.log("⚠️  No Upwork job cards rendered, continuing with fallback (may be empty).");
  return true;
}

async function collectJobs(page, query) {
  let raw = [];
  try {
    raw = await page.evaluate(
      ({ cardSelector }) => {
        const pick = (root, selectors) => {
          for (const selector of selectors) {
            const el = root.querySelector(selector);
            if (el) return el;
          }
          return null;
        };
        const pickText = (root, selectors) => {
          const el = pick(root, selectors);
          return el ? (el.innerText || el.textContent || "").trim() : "";
        };
        const texts = (root, selectors) =>
          [...new Set([...root.querySelectorAll(selectors.join(", "))].map((el) => (el.innerText || el.textContent || "").trim()).filter(Boolean))];
        return [...document.querySelectorAll(cardSelector)].map((card) => {
          const titleEl = pick(card, [
            '[data-test="job-tile-title-link"]',
            'a[data-test*="job-tile-title-link"]',
            'h2 a',
            'h3 a',
          ]);
          const linkEl = titleEl || pick(card, ['a[href*="/jobs/"]']);
          const description = pickText(card, [
            '[data-test="UpCLineClamp JobDescription"]',
            '[data-test="JobDescription"]',
            '[data-test="job-description-text"]',
            '[data-test="job-description"]',
            '[data-test="job-description-line-clamp"]',
            '[data-test="description"]',
            ".job-description",
          ]);
          const skills = texts(card, [
            '[data-test="token"]',
            '[data-test="skill"]',
            ".up-skill-badge",
            '[data-test="attr-item"]',
          ]);
          const budget = texts(card, [
            '[data-test="budget"]',
            '[data-test="is-fixed-price"]',
            '[data-test="job-type-label"]',
          ]);
          let posted = pickText(card, [
            '[data-test="job-pubilshed-date"]',
            '[data-test="job-published-date"]',
            '[data-test="posted-on"]',
          ]);
          if (!posted) {
            const timeEl = card.querySelector("time");
            if (timeEl) posted = timeEl.getAttribute("datetime") || timeEl.innerText || "";
          }
          if (!posted) {
            for (const el of card.querySelectorAll("span, div")) {
              const text = (el.innerText || "").trim();
              if (/^Posted\s+(?:just now|yesterday|\d+\s+\w+(?:\s+ago)?)$/i.test(text)) {
                posted = text;
                break;
              }
            }
          }
          return {
            title: titleEl ? (titleEl.innerText || titleEl.textContent || "").trim() : "",
            url: linkEl ? linkEl.getAttribute("href") || linkEl.href || "" : "",
            description,
            skills,
            budget: budget.join(" · "),
            posted,
            location: pickText(card, ['[data-test="location"]', '[data-test="client-location"]']),
            proposals: pickText(card, ['[data-test="proposals-tier"]', '[data-test="proposals"]']),
            clientRating: pickText(card, ['[data-test="total-feedback"]', '[data-test="client-rating"]']),
            paymentVerified: pickText(card, [
              '[data-test="payment-verification-status"]',
              '[data-test="payment-verified"]',
            ]),
            jobType: pickText(card, ['[data-test="job-type-label"]']),
            experienceLevel: pickText(card, ['[data-test="experience-level"]']),
            duration: pickText(card, ['[data-test="duration-label"]']),
            cardText: (card.innerText || "").trim(),
          };
        });
      },
      { cardSelector: CARD_SELECTOR }
    );
  } catch {
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const job of raw) {
    const url = canonicalJobUrl(job.url);
    const title = cleanText(job.title);
    const description = cleanText(job.description);
    const cardText = cleanText(job.cardText);
    if (!url || (!title && !description)) continue;
    const skills = (job.skills || []).map(cleanText).filter(Boolean);
    const budget = cleanText(job.budget);
    const jobType = cleanText(job.jobType);
    const duration = cleanText(job.duration);
    const experienceLevel = cleanText(job.experienceLevel);
    const clientLocation = cleanText(job.location);
    const proposals = cleanText(job.proposals);
    const clientRating = cleanText(job.clientRating);
    const paymentVerified = cleanText(job.paymentVerified);
    const posted = cleanText(job.posted);
    const extras = [];
    if (skills.length > 0) extras.push(`Skills: ${skills.join(", ")}`);
    if (budget) extras.push(`Budget: ${budget}`);
    if (jobType && jobType !== budget) extras.push(`Job type: ${jobType}`);
    if (duration) extras.push(`Duration: ${duration}`);
    if (experienceLevel) extras.push(`Experience: ${experienceLevel}`);
    if (clientLocation) extras.push(`Client location: ${clientLocation}`);
    if (proposals) extras.push(`Proposals: ${proposals}`);
    if (clientRating) extras.push(`Client rating: ${clientRating}`);
    if (paymentVerified) extras.push(`Payment: ${paymentVerified}`);
    const content = [description || cardText, ...extras].filter(Boolean).join("\n").slice(0, 4000);
    if (!title && !content) continue;
    const key = upworkPostKey({ url, title, content });
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      platform: "upwork",
      subreddit: "upwork",
      handle: "",
      query,
      title: (title || content).slice(0, 140),
      content,
      url,
      upvotes: 0,
      comments: 0,
      author: clientLocation,
      clientLocation,
      budget,
      skills,
      proposals,
      clientRating,
      paymentVerified,
      jobType,
      experienceLevel,
      duration,
      timeAgo: cleanPosted(posted),
      createdAt: /^\d{4}-\d{2}-\d{2}T/.test(posted) ? posted : "",
      scrapedAt: new Date().toISOString(),
      source: `upwork-search: ${query}`,
    });
  }
  return out;
}

async function loadMoreOrScroll(page) {
  try {
    const button = page.locator(
      'button[data-test="load-more-button"], button[data-test="load-more"], button[data-ev-label="pagination_next_page"], a[data-ev-label="pagination_next_page"]'
    ).first();
    if ((await button.count()) > 0 && (await button.isVisible())) {
      await button.click({ timeout: 3000 });
      return "load-more";
    }
  } catch {}
  await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
  return "scroll";
}

async function scrollToLoadJobs(page, query) {
  const limit = config.upwork.searchScrolls;
  const seen = new Map();
  let stagnant = 0;
  for (let i = 0; i < limit; i++) {
    if (await isUpworkLoginWallVisible(page)) {
      console.log("⛔ Upwork login wall mid-scroll, keeping what was collected.");
      break;
    }
    let batch = [];
    try {
      batch = await collectJobs(page, query);
    } catch {
      console.log(`📜 Upwork scroll ${i + 1}/${limit}: collect failed, continuing`);
    }
    const before = seen.size;
    for (const job of batch) {
      const key = upworkPostKey(job);
      if (!seen.has(key)) seen.set(key, job);
    }
    console.log(`📜 Upwork scroll ${i + 1}/${limit} "${query}": ${batch.length} on page, ${seen.size} unique`);
    if (seen.size >= config.upwork.maxPosts) break;
    if (seen.size === before) {
      stagnant++;
      if (stagnant >= 3) break;
    } else {
      stagnant = 0;
    }
    try {
      await loadMoreOrScroll(page);
      await page.waitForTimeout(config.upwork.scrollDelayMs);
    } catch (err) {
      if (isTargetClosed(err)) {
        const e = new Error(`Upwork tab closed mid-scroll: ${err.message}`);
        e.code = "TARGET_CLOSED";
        throw e;
      }
      console.log(`📜 Upwork scroll ${i + 1}/${limit}: scroll/wait failed, continuing`);
    }
  }
  return [...seen.values()];
}

function mergeUpworkByKey(lists) {
  const merged = new Map();
  for (const job of lists.flat()) {
    if (!job.url) continue;
    const key = upworkPostKey(job);
    const prev = merged.get(key);
    if (!prev || (prev.content || "").length < (job.content || "").length) merged.set(key, job);
  }
  return [...merged.values()];
}

async function scrapeUpworkSearch(page, query, knownUrls, isFirst = false) {
  const url = upworkSearchUrl(query);
  console.log(`\n🧑‍💻 Upwork search: "${query}"`);
  if (!isFirst) {
    await sleep(config.upwork.interPageDelayMs + Math.floor(random(0, 3000)));
  }
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: config.navigationTimeoutMs });
  const ready = await ensureUpworkPageReady(page);
  if (!ready) {
    console.log(`📦 Upwork "${query}": skipped (login wall / block)`);
    return [];
  }
  const collected = await scrollToLoadJobs(page, query);
  let fresh = [];
  try {
    fresh = await collectJobs(page, query);
  } catch {}
  const jobs = mergeUpworkByKey([collected, fresh]).slice(0, config.upwork.maxPosts);
  const newCount = markKnown(jobs, knownUrls);
  console.log(`📦 Upwork "${query}": ${jobs.length} jobs${newCount === null ? "" : ` (${newCount} new)`}`);
  return jobs;
}

async function scrapeUpworkFull(page, knownUrls) {
  const queries = queriesForRun();
  console.log(`\n🧑‍💻 Upwork enabled: ${queries.length}/${config.upwork.queries.length} queries this run: ${queries.join(" | ")}`);
  let all = [];
  let emptyInARow = 0;
  for (let qi = 0; qi < queries.length; qi++) {
    const query = queries[qi];
    let jobs = [];
    try {
      jobs = await scrapeUpworkSearch(page, query, knownUrls, qi === 0);
    } catch (err) {
      if (err && err.code === "TARGET_CLOSED") throw err;
      console.error(`❌ Upwork search "${query}" failed, continuing: ${err.message}`);
      jobs = [];
    }
    all = all.concat(jobs);
    if (jobs.length === 0) {
      emptyInARow++;
      if (emptyInARow >= 3) {
        console.log("\n⛔ 3 Upwork queries in a row returned 0 jobs — likely login wall, Cloudflare block, or rate limit. Keeping what was collected.");
        break;
      }
    } else {
      emptyInARow = 0;
    }
  }
  const merged = mergeUpworkByKey([all]).slice(0, config.upwork.maxPosts * queries.length);
  console.log(`\n📦 Upwork total: ${merged.length} unique jobs (${queries.length} queries)`);
  return merged;
}

module.exports = { scrapeUpworkFull, isTargetClosed };
