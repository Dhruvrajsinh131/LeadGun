"use strict";

const express = require("express");
const cron = require("node-cron");
const config = require("./config");
const { runScrapeJob, isRunning } = require("./jobs/scrapeJob");
const { readJson, loadState, ensureDataDir } = require("./services/store");
const { leadScore } = require("./services/matcher");
const { llmStatus } = require("./services/classifier");
const { notifyLeads } = require("./services/discord");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    service: "reddit-lead-agent",
    subreddits: config.subreddits,
    schedule: config.cronSchedule,
    x: { enabled: Boolean(config.x && config.x.enabled), queries: (config.x && config.x.queries) || [] },
    endpoints: ["GET /health", "GET /api/status", "GET /api/posts", "GET /api/matched", "GET /api/leads", "POST /api/scrape", "POST /api/notify-test", "GET /api/x/posts", "GET /api/x/matched", "GET /api/x/leads"],
  });
});

app.get("/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.get("/api/status", async (req, res) => {
  const state = await loadState();
  res.json({
    running: isRunning(),
    schedule: config.cronSchedule,
    subreddits: config.subreddits,
    capabilities: config.capabilities.map((k) => k.label),
    llm: llmStatus(),
    x: { enabled: Boolean(config.x && config.x.enabled), queries: (config.x && config.x.queries) || [] },
    ...state,
  });
});

app.get("/api/posts", async (req, res) => {
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || "50", 10)));
  const posts = await readJson(config.allPostsFile, []);
  res.json({ count: posts.length, posts: posts.slice(0, limit) });
});

app.get("/api/matched", async (req, res) => {
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || "50", 10)));
  const posts = await readJson(config.matchedPostsFile, []);
  res.json({ count: posts.length, posts: posts.slice(0, limit) });
});

app.get("/api/leads", async (req, res) => {
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || "50", 10)));
  const minScore = parseInt(req.query.minScore || "0", 10);
  const subreddit = (req.query.subreddit || "").toLowerCase();
  const capability = (req.query.capability || "").toLowerCase();
  const grade = (req.query.grade || "").toUpperCase();
  let leads = await readJson(config.leadsFile, []);
  if (minScore) leads = leads.filter((l) => leadScore(l) >= minScore);
  if (subreddit) leads = leads.filter((l) => (l.subreddit || "").toLowerCase() === subreddit);
  if (capability) leads = leads.filter((l) => (l.capabilities || []).some((c) => String(c).toLowerCase() === capability));
  if (grade) leads = leads.filter((l) => l.grade === grade);
  res.json({ count: leads.length, leads: leads.slice(0, limit) });
});

app.get("/api/x/posts", async (req, res) => {
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || "50", 10)));
  const posts = await readJson(config.x.postsFile, []);
  res.json({ count: posts.length, posts: posts.slice(0, limit) });
});

app.get("/api/x/matched", async (req, res) => {
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || "50", 10)));
  const posts = await readJson(config.x.matchedFile, []);
  res.json({ count: posts.length, posts: posts.slice(0, limit) });
});

app.get("/api/x/leads", async (req, res) => {
  const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || "50", 10)));
  const minScore = parseInt(req.query.minScore || "0", 10);
  const query = (req.query.query || "").toLowerCase();
  const handle = (req.query.handle || "").toLowerCase();
  const capability = (req.query.capability || "").toLowerCase();
  const grade = (req.query.grade || "").toUpperCase();
  let leads = await readJson(config.x.leadsFile, []);
  if (minScore) leads = leads.filter((l) => leadScore(l) >= minScore);
  if (query) leads = leads.filter((l) => (l.query || "").toLowerCase() === query);
  if (handle) leads = leads.filter((l) => (l.handle || l.author || "").toLowerCase() === handle);
  if (capability) leads = leads.filter((l) => (l.capabilities || []).some((c) => String(c).toLowerCase() === capability));
  if (grade) leads = leads.filter((l) => l.grade === grade);
  res.json({ count: leads.length, leads: leads.slice(0, limit) });
});

app.post("/api/scrape", async (req, res) => {
  if (isRunning()) return res.status(429).json({ ok: false, error: "scrape already running" });
  runScrapeJob({ reason: "api" });
  res.json({ ok: true, message: "scrape started" });
});

app.post("/api/notify-test", async (req, res) => {
  const result = await notifyLeads(
    [{ title: "Test lead (ignore)", subreddit: "forhire", source: "test", capabilities: ["node.js"], grade: "A", heuristicScore: 99, intentType: "direct", classifiedBy: "test", url: `https://www.reddit.com/r/forhire/?test=${Date.now()}` }],
    { reason: "test", scraped: 0, subreddits: [] }
  );
  res.json({ ok: true, ...result });
});

async function start() {
  await ensureDataDir();

  if (!cron.validate(config.cronSchedule)) {
    throw new Error(`Invalid CRON schedule: ${config.cronSchedule}`);
  }

  cron.schedule(config.cronSchedule, () => {
    console.log(`\n⏰ Cron trigger (${config.cronSchedule})`);
    runScrapeJob({ reason: "cron" });
  });
  console.log(`⏰ Scheduler set: "${config.cronSchedule}" (≈ every 3 hours with default "0 */3 * * *")`);

  if (config.runOnStart && !process.argv.includes("--no-scrape")) {
    console.log("🚀 Initial scrape on startup...");
    runScrapeJob({ reason: "startup" });
  }

  app.listen(config.port, () => {
    console.log(`🌐 Server listening on http://localhost:${config.port}`);
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error("❌ Server failed to start:", err);
    process.exit(1);
  });
}

module.exports = { app, start };
