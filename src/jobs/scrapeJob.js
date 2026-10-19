"use strict";

const config = require("../config");
const { connectToChrome } = require("../browser/connection");
const { scrapeSubredditFull, shuffled, isTargetClosed: isRedditTargetClosed } = require("../scraper/redditScraper");
const { scrapeXFull, isTargetClosed: isXTargetClosed } = require("../scraper/xScraper");
const { analyzePosts, filterLeads, leadScore } = require("../services/matcher");
const { classifyLeads, llmStatus, getLlmUsage } = require("../services/classifier");
const { saveResults, saveLeads, loadState, saveState, readJson, writeJson, mergePosts, mergeLeads } = require("../services/store");
const { notifyLeads, notifyXLeads } = require("../services/discord");

let running = false;

async function runScrapeJob({ reason = "manual", sources } = {}) {
  if (running) {
    console.log("⏭️  Scrape already running, skipping.");
    return { skipped: true };
  }
  const wantReddit = sources ? sources.reddit === true : true;
  const wantX = sources ? sources.x === true : Boolean(config.x && config.x.enabled);
  if (!wantReddit && !wantX) {
    throw new Error("No sources selected (use --reddit, --x or --all)");
  }
  running = true;
  const startedAt = new Date().toISOString();
  const sourceNames = [];
  if (wantReddit) sourceNames.push("reddit");
  if (wantX) sourceNames.push("x");
  const subs = [];
  if (wantReddit) {
    if (config.subOrder === "full") {
      subs.push(...shuffled([...config.subreddits]));
    } else {
      for (const p of [...new Set(config.subreddits.map((s) => s.priority))].sort((a, b) => a - b)) {
        subs.push(...shuffled(config.subreddits.filter((s) => s.priority === p)));
      }
    }
    console.log(`📍 Order: ${subs.map((s) => s.name).join(", ")}`);
  }
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🔄 Lead job started (${reason}) at ${startedAt}\n📍 Sources: ${sourceNames.join(" + ")}${wantReddit ? ` (${subs.length} subreddits)` : ""}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  try {
    const conn = await connectToChrome();
    let page = conn.page;
    const context = conn.context;
    // URLs stored by previous runs, for "new" counts.
    const knownUrls = new Set(
      (await readJson(config.allPostsFile, [])).map((p) => p.url).filter(Boolean)
    );
    // X runs in its own tab, in parallel with Reddit.
    let xPage = null;
    let xKnownUrls = new Set();
    if (wantX) {
      xKnownUrls = new Set(
        (await readJson(config.x.postsFile, [])).map((p) => p.url).filter(Boolean)
      );
      try {
        xPage = await context.newPage();
        console.log("🗂️  X: opened separate tab");
      } catch (tabErr) {
        console.error(`❌ X tab failed to open, X falls back to main tab: ${tabErr.message}`);
        xPage = null;
      }
    }

    // classifyLeads uses a shared token counter, so serialize classify calls.
    let llmQueue = Promise.resolve();
    function withLlmLock(fn) {
      const run = llmQueue.then(fn, fn);
      llmQueue = run.catch(() => {});
      return run;
    }

    async function collectReddit() {
      let allPosts = [];
      const perSub = [];
      let emptySubs = 0;
      let abortedEarly = false;
      async function freshRedditTab() {
        try {
          page = await context.newPage();
          console.log("🗂️  Reddit: crashed tab replaced with a fresh one");
          return true;
        } catch (tabErr) {
          console.error(`❌ Reddit: fresh tab failed: ${tabErr.message}`);
          return false;
        }
      }
      for (const { name } of subs) {
        let posts;
        try {
          posts = await scrapeSubredditFull(page, name, knownUrls);
        } catch (err) {
          // Dead renderer: retry this sub once on a fresh tab.
          if ((err && err.code === "TARGET_CLOSED") || (isRedditTargetClosed && isRedditTargetClosed(err))) {
            console.error(`❌ r/${name}: tab died, retrying on a fresh tab…`);
            if (await freshRedditTab()) {
              try {
                posts = await scrapeSubredditFull(page, name, knownUrls);
              } catch (retryErr) {
                console.error(`❌ r/${name} retry failed: ${retryErr.message}`);
                posts = [];
              }
            } else {
              posts = [];
            }
          } else {
            console.error(`❌ r/${name} failed, continuing: ${err.message}`);
            posts = [];
          }
        }
        allPosts = allPosts.concat(posts);
        perSub.push({ subreddit: name, scraped: posts.length });
        if (posts.length === 0) {
          emptySubs++;
          if (config.abortAfterEmptySubs > 0 && emptySubs >= config.abortAfterEmptySubs) {
            console.log(`\n⛔ ${emptySubs} subreddits in a row returned 0 posts — Reddit is challenging every page.`);
            console.log("Solve one challenge manually in Chrome (or wait for the cooldown), then rerun.");
            abortedEarly = true;
            break;
          }
        } else {
          emptySubs = 0;
        }
      }
      return { allPosts, perSub, abortedEarly };
    }

    // Reddit pipeline: scrape → classify → save → notify.
    async function redditPipeline() {
      const { allPosts, perSub, abortedEarly } = await collectReddit();
      const analyzed = analyzePosts(allPosts);
      const heuristicLeads = filterLeads(analyzed);
      console.log(`🎯 Heuristic leads: ${heuristicLeads.length}/${allPosts.length} (LLM: ${config.llm.enabled && config.llm.apiKey ? config.llm.model : "off"})`);
      const notifiedUrls = new Set(await readJson(config.notifiedFile, []));
      const { leads, usage } = await withLlmLock(async () => {
        const l = await classifyLeads(analyzed, notifiedUrls);
        return { leads: l, usage: getLlmUsage() };
      });
      for (const lead of leads.slice(0, 20)) {
        console.log(`   ✅ [${lead.grade}|${leadScore(lead)}|${lead.intentType}|${(lead.capabilities || []).join(", ")}] r/${lead.subreddit} ${lead.title} — ${lead.url}`);
      }
      if (leads.length > 20) console.log(`   ... +${leads.length - 20} more`);
      const { allCount, matchedCount } = await saveResults(allPosts, heuristicLeads);
      const { leadsCount } = await saveLeads(leads);
      const notifyResult = await notifyLeads(leads, { reason, scraped: allPosts.length, subreddits: perSub });
      return { allPosts, perSub, abortedEarly, heuristicLeads, leads, allCount, matchedCount, leadsCount, notified: notifyResult.sent, llmUsage: usage };
    }

    // X pipeline: scrape → classify → save → notify.
    async function xPipeline() {
      let targetPage = xPage || page;
      let xPosts = [];
      try {
        xPosts = await scrapeXFull(targetPage, xKnownUrls);
      } catch (err) {
        // Dead renderer: retry once on a fresh tab.
        if ((err && err.code === "TARGET_CLOSED") || (isXTargetClosed && isXTargetClosed(err))) {
          console.error("❌ 𝕏 tab died, retrying on a fresh tab…");
          try {
            if (xPage) { try { await xPage.close(); } catch {} }
            xPage = await context.newPage();
            targetPage = xPage;
            xPosts = await scrapeXFull(targetPage, xKnownUrls);
          } catch (retryErr) {
            console.error(`❌ 𝕏 retry failed, Reddit results kept: ${retryErr.message}`);
            xPosts = [];
          }
        } else {
          console.error(`❌ 𝕏 collection failed, Reddit results kept: ${err.message}`);
          xPosts = [];
        }
      } finally {
        if (xPage) {
          try { await xPage.close(); } catch {}
          console.log("🗂️  X: separate tab closed");
        }
      }
      const xAnalyzed = analyzePosts(xPosts);
      const xHeuristic = filterLeads(xAnalyzed);
      console.log(`🎯 X heuristic leads: ${xHeuristic.length}/${xPosts.length}`);
      const xNotifiedUrls = new Set(await readJson(config.x.notifiedFile, []));
      const { leads: xLeads, usage } = await withLlmLock(async () => {
        const l = await classifyLeads(xAnalyzed, xNotifiedUrls);
        return { leads: l, usage: getLlmUsage() };
      });
      for (const lead of xLeads.slice(0, 20)) {
        console.log(`   ✅ 𝕏 [${lead.grade}|${leadScore(lead)}|${lead.intentType}|${(lead.capabilities || []).join(", ")}] @${lead.handle || lead.author || "?"} ${String(lead.title || "").slice(0, 110)} — ${lead.url}`);
      }
      if (xLeads.length > 20) console.log(`   ... +${xLeads.length - 20} more`);
      const prevXAll = await readJson(config.x.postsFile, []);
      const prevXMatched = await readJson(config.x.matchedFile, []);
      const mergedXAll = mergePosts(prevXAll, xPosts);
      const mergedXMatched = mergePosts(prevXMatched, xHeuristic);
      await writeJson(config.x.postsFile, mergedXAll);
      await writeJson(config.x.matchedFile, mergedXMatched);
      const prevXLeads = await readJson(config.x.leadsFile, []);
      const mergedXLeads = mergeLeads(prevXLeads, xLeads);
      await writeJson(config.x.leadsFile, mergedXLeads);
      const xQueries = (xPosts.length > 0 || xHeuristic.length > 0 || xLeads.length > 0)
        ? [...new Set(xPosts.map((p) => p.query).filter(Boolean))]
        : [];
      const xNotify = await notifyXLeads(xLeads, { reason, scraped: xPosts.length, queries: xQueries });
      return {
        queries: xQueries, scraped: xPosts.length, matched: xHeuristic.length,
        leads: xLeads.length, totalStored: mergedXAll.length,
        totalMatchedStored: mergedXMatched.length, totalLeadsStored: mergedXLeads.length,
        notified: xNotify.sent, llmUsage: usage,
      };
    }

    let redditRes = { allPosts: [], perSub: [], abortedEarly: false, heuristicLeads: [], leads: [], allCount: 0, matchedCount: 0, leadsCount: 0, notified: 0 };
    let xResult = { enabled: wantX, queries: [], scraped: 0, matched: 0, leads: 0, notified: 0 };
    let redditLlmUsage = { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let xLlmUsage = { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    if (sourceNames.length > 1) {
      console.log("⚡ Parallel pipelines, each notifies on finish (same channel)");
    }
    const runners = sourceNames.map((name) => (name === "reddit" ? redditPipeline : xPipeline));
    const settled = await Promise.allSettled(runners.map((run) => run()));
    let succeeded = 0;
    for (let i = 0; i < sourceNames.length; i++) {
      const name = sourceNames[i];
      const outcome = settled[i];
      if (outcome.status === "rejected") {
        if (name === "reddit") {
          console.error("❌ Reddit pipeline failed:", outcome.reason);
          throw outcome.reason;
        }
        console.error(`❌ X pipeline failed, other results kept: ${(outcome.reason && outcome.reason.message) || outcome.reason}`);
        xResult = { enabled: true, error: (outcome.reason && outcome.reason.message) || "x failed", queries: [], scraped: 0, matched: 0, leads: 0, notified: 0 };
        continue;
      }
      succeeded++;
      const value = outcome.value;
      if (name === "reddit") {
        redditRes = value;
        redditLlmUsage = value.llmUsage || redditLlmUsage;
      } else {
        xLlmUsage = value.llmUsage || xLlmUsage;
        xResult = {
          enabled: true, queries: value.queries, scraped: value.scraped, matched: value.matched,
          leads: value.leads, totalStored: value.totalStored, totalMatchedStored: value.totalMatchedStored,
          totalLeadsStored: value.totalLeadsStored, notified: value.notified,
        };
      }
    }
    if (succeeded === 0) throw new Error("All selected sources failed");

    const { allPosts, perSub, abortedEarly, heuristicLeads, leads, allCount, matchedCount, leadsCount, notified } = redditRes;

    const combinedLlmUsage = {
      calls: (redditLlmUsage.calls || 0) + (xLlmUsage.calls || 0),
      promptTokens: (redditLlmUsage.promptTokens || 0) + (xLlmUsage.promptTokens || 0),
      completionTokens: (redditLlmUsage.completionTokens || 0) + (xLlmUsage.completionTokens || 0),
      totalTokens: (redditLlmUsage.totalTokens || 0) + (xLlmUsage.totalTokens || 0),
    };
    if (redditLlmUsage.estimatedUsd !== undefined || xLlmUsage.estimatedUsd !== undefined) {
      combinedLlmUsage.estimatedUsd = Number((((redditLlmUsage.estimatedUsd || 0) + (xLlmUsage.estimatedUsd || 0))).toFixed(4));
    }

    const state = await loadState();
    const result = {
      startedAt,
      finishedAt: new Date().toISOString(),
      reason,
      sources: sourceNames,
      subreddits: perSub,
      scraped: allPosts.length,
      matched: heuristicLeads.length,
      leads: leads.length,
      totalStored: allCount,
      totalMatchedStored: matchedCount,
      totalLeadsStored: leadsCount,
      notified,
      x: xResult,
      llm: { ...llmStatus(), usage: combinedLlmUsage },
      abortedEarly,
      ok: true,
    };
    await saveState({ lastRun: result.finishedAt, lastResult: result, runCount: (state.runCount || 0) + 1 });
    console.log("💾 Saved. Job done.");
    return result;
  } catch (err) {
    console.error("❌ Scrape job failed:", err);
    const state = await loadState();
    const result = { startedAt, finishedAt: new Date().toISOString(), reason, ok: false, error: err.message };
    await saveState({ lastRun: result.finishedAt, lastResult: result, runCount: state.runCount || 0 });
    return result;
  } finally {
    running = false;
  }
}

function isRunning() {
  return running;
}

module.exports = { runScrapeJob, isRunning };
