"use strict";

const config = require("../config");
const { connectToChrome } = require("../browser/connection");
const { scrapeSubredditFull, shuffled, isTargetClosed: isRedditTargetClosed } = require("../scraper/redditScraper");
const { scrapeXFull, isTargetClosed: isXTargetClosed } = require("../scraper/xScraper");
const { scrapeLinkedInFull, isTargetClosed: isLinkedInTargetClosed } = require("../scraper/linkedinScraper");
const { scrapeUpworkFull, isTargetClosed: isUpworkTargetClosed } = require("../scraper/upworkScraper");
const { analyzePosts, filterLeads, leadScore } = require("../services/matcher");
const { classifyLeads, llmStatus, getLlmUsage } = require("../services/classifier");
const { saveResults, saveLeads, loadState, saveState, readJson, writeJson, mergePosts, mergeLeads } = require("../services/store");
const { notifyLeads, notifyXLeads, notifyLinkedInLeads, notifyUpworkLeads } = require("../services/discord");

let running = false;

async function runScrapeJob({ reason = "manual", sources } = {}) {
  if (running) {
    console.log("⏭️  Scrape already running, skipping.");
    return { skipped: true };
  }
  const wantReddit = sources ? sources.reddit === true : true;
  const wantX = sources ? sources.x === true : Boolean(config.x && config.x.enabled);
  const wantLinkedIn = sources ? sources.linkedin === true : Boolean(config.linkedin && config.linkedin.enabled);
  const wantUpwork = sources ? sources.upwork === true : Boolean(config.upwork && config.upwork.enabled);
  if (!wantReddit && !wantX && !wantLinkedIn && !wantUpwork) {
    throw new Error("No sources selected (use --reddit, --x, --linkedin, --upwork or --all)");
  }
  running = true;
  const startedAt = new Date().toISOString();
  const sourceNames = [];
  if (wantReddit) sourceNames.push("reddit");
  if (wantX) sourceNames.push("x");
  if (wantLinkedIn) sourceNames.push("linkedin");
  if (wantUpwork) sourceNames.push("upwork");
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
    // LinkedIn runs in its own tab too, in parallel with the others.
    let linkedinPage = null;
    let linkedinKnownUrls = new Set();
    if (wantLinkedIn) {
      linkedinKnownUrls = new Set(
        (await readJson(config.linkedin.postsFile, [])).map((p) => p.url).filter(Boolean)
      );
      try {
        linkedinPage = await context.newPage();
        console.log("🗂️  LinkedIn: opened separate tab");
      } catch (tabErr) {
        console.error(`❌ LinkedIn tab failed to open, LinkedIn falls back to main tab: ${tabErr.message}`);
        linkedinPage = null;
      }
    }
    let upworkPage = null;
    let upworkKnownUrls = new Set();
    if (wantUpwork) {
      upworkKnownUrls = new Set(
        (await readJson(config.upwork.postsFile, [])).map((p) => p.url).filter(Boolean)
      );
      try {
        upworkPage = await context.newPage();
        console.log("🗂️  Upwork: opened separate tab");
      } catch (tabErr) {
        console.error(`❌ Upwork tab failed to open, Upwork falls back to main tab: ${tabErr.message}`);
        upworkPage = null;
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
      const freshCount = analyzed.filter((p) => p.isFresh).length;
      console.log(`🕒 Freshness: ${freshCount}/${allPosts.length} posts within ${config.maxLeadAgeDays}d (healthy < ${config.healthyLeadAgeDays}d)`);
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
      const xFresh = xAnalyzed.filter((p) => p.isFresh).length;
      console.log(`🕒 X freshness: ${xFresh}/${xPosts.length} posts within ${config.maxLeadAgeDays}d (healthy < ${config.healthyLeadAgeDays}d)`);
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

    // LinkedIn pipeline: scrape → classify → save → notify.
    async function linkedinPipeline() {
      let targetPage = linkedinPage || page;
      let linkedinPosts = [];
      try {
        linkedinPosts = await scrapeLinkedInFull(targetPage, linkedinKnownUrls);
      } catch (err) {
        // Dead renderer: retry once on a fresh tab.
        if ((err && err.code === "TARGET_CLOSED") || (isLinkedInTargetClosed && isLinkedInTargetClosed(err))) {
          console.error("❌ LinkedIn tab died, retrying on a fresh tab…");
          try {
            if (linkedinPage) { try { await linkedinPage.close(); } catch {} }
            linkedinPage = await context.newPage();
            targetPage = linkedinPage;
            linkedinPosts = await scrapeLinkedInFull(targetPage, linkedinKnownUrls);
          } catch (retryErr) {
            console.error(`❌ LinkedIn retry failed, other results kept: ${retryErr.message}`);
            linkedinPosts = [];
          }
        } else {
          console.error(`❌ LinkedIn collection failed, other results kept: ${err.message}`);
          linkedinPosts = [];
        }
      } finally {
        if (linkedinPage) {
          try { await linkedinPage.close(); } catch {}
          console.log("🗂️  LinkedIn: separate tab closed");
        }
      }
      const linkedinAnalyzed = analyzePosts(linkedinPosts);
      const linkedinHeuristic = filterLeads(linkedinAnalyzed);
      const linkedinFresh = linkedinAnalyzed.filter((p) => p.isFresh).length;
      console.log(`🕒 LinkedIn freshness: ${linkedinFresh}/${linkedinPosts.length} posts within ${config.maxLeadAgeDays}d (healthy < ${config.healthyLeadAgeDays}d)`);
      console.log(`🎯 LinkedIn heuristic leads: ${linkedinHeuristic.length}/${linkedinPosts.length}`);
      const linkedinNotifiedUrls = new Set(await readJson(config.linkedin.notifiedFile, []));
      const { leads: linkedinLeads, usage } = await withLlmLock(async () => {
        const l = await classifyLeads(linkedinAnalyzed, linkedinNotifiedUrls);
        return { leads: l, usage: getLlmUsage() };
      });
      for (const lead of linkedinLeads.slice(0, 20)) {
        console.log(`   ✅ 💼 [${lead.grade}|${leadScore(lead)}|${lead.intentType}|${(lead.capabilities || []).join(", ")}] ${lead.handle || lead.author || "?"} ${String(lead.title || "").slice(0, 110)} — ${lead.url}`);
      }
      if (linkedinLeads.length > 20) console.log(`   ... +${linkedinLeads.length - 20} more`);
      const prevLinkedInAll = await readJson(config.linkedin.postsFile, []);
      const prevLinkedInMatched = await readJson(config.linkedin.matchedFile, []);
      const mergedLinkedInAll = mergePosts(prevLinkedInAll, linkedinPosts);
      const mergedLinkedInMatched = mergePosts(prevLinkedInMatched, linkedinHeuristic);
      await writeJson(config.linkedin.postsFile, mergedLinkedInAll);
      await writeJson(config.linkedin.matchedFile, mergedLinkedInMatched);
      const prevLinkedInLeads = await readJson(config.linkedin.leadsFile, []);
      const mergedLinkedInLeads = mergeLeads(prevLinkedInLeads, linkedinLeads);
      await writeJson(config.linkedin.leadsFile, mergedLinkedInLeads);
      const linkedinQueries = (linkedinPosts.length > 0 || linkedinHeuristic.length > 0 || linkedinLeads.length > 0)
        ? [...new Set(linkedinPosts.map((p) => p.query).filter(Boolean))]
        : [];
      const linkedinNotify = await notifyLinkedInLeads(linkedinLeads, { reason, scraped: linkedinPosts.length, queries: linkedinQueries });
      return {
        queries: linkedinQueries, scraped: linkedinPosts.length, matched: linkedinHeuristic.length,
        leads: linkedinLeads.length, totalStored: mergedLinkedInAll.length,
        totalMatchedStored: mergedLinkedInMatched.length, totalLeadsStored: mergedLinkedInLeads.length,
        notified: linkedinNotify.sent, llmUsage: usage,
      };
    }

    async function upworkPipeline() {
      let targetPage = upworkPage || page;
      let upworkPosts = [];
      try {
        upworkPosts = await scrapeUpworkFull(targetPage, upworkKnownUrls);
      } catch (err) {
        if ((err && err.code === "TARGET_CLOSED") || (isUpworkTargetClosed && isUpworkTargetClosed(err))) {
          console.error("❌ Upwork tab died, retrying on a fresh tab…");
          try {
            if (upworkPage) { try { await upworkPage.close(); } catch {} }
            upworkPage = await context.newPage();
            targetPage = upworkPage;
            upworkPosts = await scrapeUpworkFull(targetPage, upworkKnownUrls);
          } catch (retryErr) {
            console.error(`❌ Upwork retry failed, other results kept: ${retryErr.message}`);
            upworkPosts = [];
          }
        } else {
          console.error(`❌ Upwork collection failed, other results kept: ${err.message}`);
          upworkPosts = [];
        }
      } finally {
        if (upworkPage) {
          try { await upworkPage.close(); } catch {}
          console.log("🗂️  Upwork: separate tab closed");
        }
      }
      const upworkAnalyzed = analyzePosts(upworkPosts);
      const upworkHeuristic = filterLeads(upworkAnalyzed);
      const upworkFresh = upworkAnalyzed.filter((p) => p.isFresh).length;
      console.log(`🕒 Upwork freshness: ${upworkFresh}/${upworkPosts.length} posts within ${config.maxLeadAgeDays}d (healthy < ${config.healthyLeadAgeDays}d)`);
      console.log(`🎯 Upwork heuristic leads: ${upworkHeuristic.length}/${upworkPosts.length}`);
      const upworkNotifiedUrls = new Set(await readJson(config.upwork.notifiedFile, []));
      const { leads: upworkLeads, usage } = await withLlmLock(async () => {
        const l = await classifyLeads(upworkAnalyzed, upworkNotifiedUrls);
        return { leads: l, usage: getLlmUsage() };
      });
      for (const lead of upworkLeads.slice(0, 20)) {
        console.log(`   ✅ 🧑‍💻 [${lead.grade}|${leadScore(lead)}|${lead.intentType}|${(lead.capabilities || []).join(", ")}] ${lead.clientLocation || "client"} ${String(lead.title || "").slice(0, 110)} — ${lead.url}`);
      }
      if (upworkLeads.length > 20) console.log(`   ... +${upworkLeads.length - 20} more`);
      const prevUpworkAll = await readJson(config.upwork.postsFile, []);
      const prevUpworkMatched = await readJson(config.upwork.matchedFile, []);
      const mergedUpworkAll = mergePosts(prevUpworkAll, upworkPosts);
      const mergedUpworkMatched = mergePosts(prevUpworkMatched, upworkHeuristic);
      await writeJson(config.upwork.postsFile, mergedUpworkAll);
      await writeJson(config.upwork.matchedFile, mergedUpworkMatched);
      const prevUpworkLeads = await readJson(config.upwork.leadsFile, []);
      const mergedUpworkLeads = mergeLeads(prevUpworkLeads, upworkLeads);
      await writeJson(config.upwork.leadsFile, mergedUpworkLeads);
      const upworkQueries = (upworkPosts.length > 0 || upworkHeuristic.length > 0 || upworkLeads.length > 0)
        ? [...new Set(upworkPosts.map((p) => p.query).filter(Boolean))]
        : [];
      const upworkNotify = await notifyUpworkLeads(upworkLeads, { reason, scraped: upworkPosts.length, queries: upworkQueries });
      return {
        queries: upworkQueries, scraped: upworkPosts.length, matched: upworkHeuristic.length,
        leads: upworkLeads.length, totalStored: mergedUpworkAll.length,
        totalMatchedStored: mergedUpworkMatched.length, totalLeadsStored: mergedUpworkLeads.length,
        notified: upworkNotify.sent, llmUsage: usage,
      };
    }

    let redditRes = { allPosts: [], perSub: [], abortedEarly: false, heuristicLeads: [], leads: [], allCount: 0, matchedCount: 0, leadsCount: 0, notified: 0 };
    let xResult = { enabled: wantX, queries: [], scraped: 0, matched: 0, leads: 0, notified: 0 };
    let linkedinResult = { enabled: wantLinkedIn, queries: [], scraped: 0, matched: 0, leads: 0, notified: 0 };
    let upworkResult = { enabled: wantUpwork, queries: [], scraped: 0, matched: 0, leads: 0, notified: 0 };
    let redditLlmUsage = { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let xLlmUsage = { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let linkedinLlmUsage = { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let upworkLlmUsage = { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    if (sourceNames.length > 1) {
      console.log("⚡ Parallel pipelines, each notifies on finish (same channel)");
    }
    const pipelineFor = { reddit: redditPipeline, x: xPipeline, linkedin: linkedinPipeline, upwork: upworkPipeline };
    const runners = sourceNames.map((name) => pipelineFor[name]);
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
        const label = name === "x" ? "𝕏" : name === "linkedin" ? "LinkedIn" : "Upwork";
        const error = (outcome.reason && outcome.reason.message) || `${name} failed`;
        console.error(`❌ ${label} pipeline failed, other results kept: ${error}`);
        if (name === "x") {
          xResult = { enabled: true, error, queries: [], scraped: 0, matched: 0, leads: 0, notified: 0 };
        } else if (name === "linkedin") {
          linkedinResult = { enabled: true, error, queries: [], scraped: 0, matched: 0, leads: 0, notified: 0 };
        } else {
          upworkResult = { enabled: true, error, queries: [], scraped: 0, matched: 0, leads: 0, notified: 0 };
        }
        continue;
      }
      succeeded++;
      const value = outcome.value;
      if (name === "reddit") {
        redditRes = value;
        redditLlmUsage = value.llmUsage || redditLlmUsage;
      } else if (name === "x") {
        xLlmUsage = value.llmUsage || xLlmUsage;
        xResult = {
          enabled: true, queries: value.queries, scraped: value.scraped, matched: value.matched,
          leads: value.leads, totalStored: value.totalStored, totalMatchedStored: value.totalMatchedStored,
          totalLeadsStored: value.totalLeadsStored, notified: value.notified,
        };
      } else if (name === "linkedin") {
        linkedinLlmUsage = value.llmUsage || linkedinLlmUsage;
        linkedinResult = {
          enabled: true, queries: value.queries, scraped: value.scraped, matched: value.matched,
          leads: value.leads, totalStored: value.totalStored, totalMatchedStored: value.totalMatchedStored,
          totalLeadsStored: value.totalLeadsStored, notified: value.notified,
        };
      } else {
        upworkLlmUsage = value.llmUsage || upworkLlmUsage;
        upworkResult = {
          enabled: true, queries: value.queries, scraped: value.scraped, matched: value.matched,
          leads: value.leads, totalStored: value.totalStored, totalMatchedStored: value.totalMatchedStored,
          totalLeadsStored: value.totalLeadsStored, notified: value.notified,
        };
      }
    }
    if (succeeded === 0) throw new Error("All selected sources failed");

    const { allPosts, perSub, abortedEarly, heuristicLeads, leads, allCount, matchedCount, leadsCount, notified } = redditRes;

    const combinedLlmUsage = {
      calls: (redditLlmUsage.calls || 0) + (xLlmUsage.calls || 0) + (linkedinLlmUsage.calls || 0) + (upworkLlmUsage.calls || 0),
      promptTokens: (redditLlmUsage.promptTokens || 0) + (xLlmUsage.promptTokens || 0) + (linkedinLlmUsage.promptTokens || 0) + (upworkLlmUsage.promptTokens || 0),
      completionTokens: (redditLlmUsage.completionTokens || 0) + (xLlmUsage.completionTokens || 0) + (linkedinLlmUsage.completionTokens || 0) + (upworkLlmUsage.completionTokens || 0),
      totalTokens: (redditLlmUsage.totalTokens || 0) + (xLlmUsage.totalTokens || 0) + (linkedinLlmUsage.totalTokens || 0) + (upworkLlmUsage.totalTokens || 0),
    };
    if (redditLlmUsage.estimatedUsd !== undefined || xLlmUsage.estimatedUsd !== undefined || linkedinLlmUsage.estimatedUsd !== undefined || upworkLlmUsage.estimatedUsd !== undefined) {
      combinedLlmUsage.estimatedUsd = Number((((redditLlmUsage.estimatedUsd || 0) + (xLlmUsage.estimatedUsd || 0) + (linkedinLlmUsage.estimatedUsd || 0) + (upworkLlmUsage.estimatedUsd || 0))).toFixed(4));
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
      linkedin: linkedinResult,
      upwork: upworkResult,
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
