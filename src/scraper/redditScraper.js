"use strict";

const { sleep, random } = require("../utils/humanBehavior");
const { shuffled, markKnown, isTargetClosed } = require("../utils/scrape");
const { handleVerification, isHumanCheckVisible, ensurePageReady } = require("../utils/verification");
const config = require("../config");

function searchUrl(subreddit, query) {
  return `https://www.reddit.com/r/${subreddit}/search/?q=${encodeURIComponent(query)}&restrict_sr=1&sort=${config.searchSort}`;
}

function queriesForSub(subreddit) {
  // Shuffle before slicing so queries rotate across runs.
  const specific = (config.subredditQueries && config.subredditQueries[subreddit]) || [];
  const pool = [...new Set([...specific, ...config.searchQueries])];
  return shuffled(pool).slice(0, config.maxQueriesPerSub);
}

function postKey(p) {
  const m = String(p.url || "").match(/comments\/([a-z0-9]+)/i);
  return m ? `id:${m[1].toLowerCase()}` : `url:${p.url}`;
}

async function openSubreddit(page, subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/${config.feedPath ? config.feedPath + "/" : ""}`;
  console.log(`\nOpening: ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: config.navigationTimeoutMs });
  return ensurePageReady(page);
}

async function collectPrimary(page, subreddit, source) {
  // `upvotes` only — `score` is reserved for the lead verdict.
  const posts = await page.locator("shreddit-post").evaluateAll((elements) =>
    elements.map((post) => ({
      title: post.getAttribute("post-title") || "",
      content: (post.innerText || "").trim(),
      url: post.getAttribute("content-href") || "",
      upvotes: parseInt(post.getAttribute("score") || "0", 10) || 0,
      comments: parseInt(post.getAttribute("comment-count") || "0", 10) || 0,
      scrapedAt: new Date().toISOString(),
    }))
  );
  return posts.map((p) => ({ ...p, subreddit, source }));
}

async function collectFallback(page, subreddit, source) {
  const links = await page.$$eval('a[href*="/comments/"]', (anchors) =>
    anchors.map((a) => ({
      title: (a.getAttribute("aria-label") || a.innerText || "").trim(),
      url: a.href || "",
    }))
  );
  const seen = new Set();
  const out = [];
  for (const l of links) {
    if (!l.url || !l.title || l.title.length < 10) continue;
    if (seen.has(l.url)) continue;
    seen.add(l.url);
    out.push({ title: l.title, content: "", url: l.url, upvotes: 0, comments: 0, scrapedAt: new Date().toISOString(), subreddit, source, partial: true });
  }
  return out;
}

async function collectPosts(page, subreddit, source) {
  let primary = [];
  try {
    primary = await collectPrimary(page, subreddit, source);
  } catch {}
  if (primary.length > 0) return primary;
  try {
    const fallback = await collectFallback(page, subreddit, source);
    if (fallback.length > 0) console.log(`🔄 Fallback harvest: ${fallback.length} post links (titles only)`);
    return fallback;
  } catch {
    return [];
  }
}

async function scrollToLoadAll(page, subreddit, source, maxScrolls) {
  const limit = maxScrolls || config.maxScrolls;
  const seen = new Map();
  let stagnant = 0;
  let recoveries = 0;
  for (let i = 0; i < limit; i++) {
    if (await isHumanCheckVisible(page)) {
      const cleared = await handleVerification(page);
      if (!cleared) {
        console.log("⛔ Challenge persists, keeping what was collected.");
        break;
      }
      recoveries++;
      if (recoveries >= config.maxRecoveriesPerPage) {
        console.log("⛔ Recovery budget spent, keeping what was collected.");
        break;
      }
    }
    let batch = [];
    try {
      batch = await collectPosts(page, subreddit, source);
    } catch {
      console.log(`📜 Scroll ${i + 1}/${limit}: collect failed, continuing`);
    }
    const before = seen.size;
    for (const p of batch) {
      const key = postKey(p);
      if (!seen.has(key)) seen.set(key, p);
    }
    console.log(`📜 Scroll ${i + 1}/${limit}: ${batch.length} on page, ${seen.size} unique`);
    if (seen.size >= config.maxPosts) break;
    if (seen.size === before) {
      stagnant++;
      if (stagnant >= 3) break;
    } else {
      stagnant = 0;
    }
    // Mark dead renderer so the job can retry on a fresh tab.
    try {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
      await page.waitForTimeout(config.scrollDelayMs);
    } catch (err) {
      if (isTargetClosed(err)) {
        const e = new Error(`Reddit tab closed mid-scroll: ${err.message}`);
        e.code = "TARGET_CLOSED";
        throw e;
      }
      console.log(`📜 Scroll ${i + 1}/${limit}: scroll/wait failed, continuing`);
    }
  }
  return [...seen.values()];
}

async function extractPosts(page, subreddit, source) {
  // No extra sleep — handleVerification already waits.
  await handleVerification(page);
  return collectPosts(page, subreddit, source);
}

function mergeByUrl(lists) {
  const merged = new Map();
  for (const p of lists.flat()) {
    if (!p.url) continue;
    const key = postKey(p);
    const prev = merged.get(key);
    if (!prev || (!prev.content && p.content)) merged.set(key, p);
  }
  return [...merged.values()];
}

async function scrapeSubreddit(page, subreddit, knownUrls) {
  const sub = subreddit || config.subreddit;
  const ready = await openSubreddit(page, sub);
  if (!ready) {
    console.log(`📦 r/${sub} feed: skipped (challenge persistent)`);
    return [];
  }
  const collected = await scrollToLoadAll(page, sub, "feed");
  const fresh = await extractPosts(page, sub, "feed");
  const posts = mergeByUrl([collected, fresh]).slice(0, config.maxPosts);
  const newCount = markKnown(posts, knownUrls);
  console.log(`\n📦 r/${sub} feed: ${posts.length} posts${newCount === null ? "" : ` (${newCount} new)`} (${collected.length} collected while scrolling)`);
  return posts;
}

async function scrapeSearch(page, subreddit, query, knownUrls) {
  const url = searchUrl(subreddit, query);
  console.log(`\n🔍 r/${subreddit} search: "${query}"`);
  await sleep(config.interPageDelayMs + Math.floor(random(0, 3000)));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: config.navigationTimeoutMs });
  const ready = await ensurePageReady(page);
  if (!ready) {
    console.log(`📦 r/${subreddit} "${query}": skipped (challenge persistent)`);
    return [];
  }
  const collected = await scrollToLoadAll(page, subreddit, `search: ${query}`, config.searchScrolls);
  const fresh = await extractPosts(page, subreddit, `search: ${query}`);
  const posts = mergeByUrl([collected, fresh]).slice(0, config.maxPosts);
  const newCount = markKnown(posts, knownUrls);
  console.log(`📦 r/${subreddit} "${query}": ${posts.length} posts${newCount === null ? "" : ` (${newCount} new)`}`);
  return posts;
}

async function scrapeSubredditFull(page, subreddit, knownUrls) {
  const sub = subreddit || config.subreddit;
  const all = [await scrapeSubreddit(page, sub, knownUrls)];
  if (config.searchEnabled) {
    for (const query of queriesForSub(sub)) {
      try {
        all.push(await scrapeSearch(page, sub, query, knownUrls));
      } catch (err) {
        console.error(`❌ r/${sub} search "${query}" failed, continuing: ${err.message}`);
      }
    }
  }
  const posts = mergeByUrl(all).slice(0, config.maxPosts);
  console.log(`\n📦 r/${sub} total: ${posts.length} unique posts (feed + search)`);
  return posts;
}

module.exports = { openSubreddit, scrollToLoadAll, collectPosts, extractPosts, scrapeSubreddit, scrapeSearch, scrapeSubredditFull, searchUrl, queriesForSub, shuffled, postKey, mergeByUrl, isTargetClosed };
