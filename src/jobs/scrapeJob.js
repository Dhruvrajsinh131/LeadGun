"use strict";

const config = require("../config");
const { connectToChrome } = require("../browser/connection");
const { scrapeSubredditFull, shuffled } = require("../scraper/redditScraper");
const { analyzePosts, filterLeads, leadScore } = require("../services/matcher");
const { classifyLeads, llmStatus, getLlmUsage } = require("../services/classifier");
const { saveResults, saveLeads, loadState, saveState, readJson } = require("../services/store");
const { notifyLeads } = require("../services/discord");

let running = false;

async function runScrapeJob({ reason = "manual" } = {}) {
  if (running) {
    console.log("⏭️  Scrape already running, skipping.");
    return { skipped: true };
  }
  running = true;
  const startedAt = new Date().toISOString();
  const subs = [];
  if (config.subOrder === "full") {
    subs.push(...shuffled([...config.subreddits]));
  } else {
    for (const p of [...new Set(config.subreddits.map((s) => s.priority))].sort((a, b) => a - b)) {
      subs.push(...shuffled(config.subreddits.filter((s) => s.priority === p)));
    }
  }
  console.log(`📍 Order: ${subs.map((s) => s.name).join(", ")}`);
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🔄 Lead job started (${reason}) at ${startedAt}\n📍 ${subs.length} subreddits\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  try {
    const { page } = await connectToChrome();
    // Freshness tracking: URLs already stored from previous runs, so logs
    // show how many posts per sub/query are genuinely new (not reshown).
    const knownUrls = new Set(
      (await readJson(config.allPostsFile, [])).map((p) => p.url).filter(Boolean)
    );
    let allPosts = [];
    const perSub = [];
    let emptySubs = 0;
    let abortedEarly = false;
    for (const { name } of subs) {
      let posts;
      try {
        posts = await scrapeSubredditFull(page, name, knownUrls);
      } catch (err) {
        console.error(`❌ r/${name} failed, continuing: ${err.message}`);
        posts = [];
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

    const analyzed = analyzePosts(allPosts);
    const heuristicLeads = filterLeads(analyzed);
    console.log(`🎯 Heuristic leads: ${heuristicLeads.length}/${allPosts.length} (LLM: ${config.llm.enabled && config.llm.apiKey ? config.llm.model : "off"})`);
    const notifiedUrls = new Set(await readJson(config.notifiedFile, []));
    const leads = await classifyLeads(analyzed, notifiedUrls);
    for (const lead of leads.slice(0, 20)) {
      console.log(`   ✅ [${lead.grade}|${leadScore(lead)}|${lead.intentType}|${(lead.capabilities || []).join(", ")}] r/${lead.subreddit} ${lead.title} — ${lead.url}`);
    }
    if (leads.length > 20) console.log(`   ... +${leads.length - 20} more`);

    const { allCount, matchedCount } = await saveResults(allPosts, heuristicLeads);
    const { leadsCount } = await saveLeads(leads);
    const notifyResult = await notifyLeads(leads, { reason, scraped: allPosts.length, subreddits: perSub });

    const state = await loadState();
    const result = {
      startedAt,
      finishedAt: new Date().toISOString(),
      reason,
      subreddits: perSub,
      scraped: allPosts.length,
      matched: heuristicLeads.length,
      leads: leads.length,
      totalStored: allCount,
      totalMatchedStored: matchedCount,
      totalLeadsStored: leadsCount,
      notified: notifyResult.sent,
      llm: { ...llmStatus(), usage: getLlmUsage() },
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
