"use strict";

require("dotenv").config({ quiet: true });

const express = require("express");
const cors = require("cors");
const { register: registerApi } = require("./routes/api");
const fs = require("fs");
const { spawnSync } = require("child_process");
const cron = require("node-cron");
const config = require("./config");
const { runScrapeJob, isRunning } = require("./jobs/scrapeJob");
const { loadState, ensureDataDir } = require("./services/store");
const { llmStatus } = require("./services/classifier");
const { getScraperSettings } = require("./services/scraperSettings");

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(cors({ origin: true, credentials: true, exposedHeaders: ["X-Conversation-Id"] }));
registerApi(app);

app.get("/", (req, res) => {
  res.json({
    service: "reddit-lead-agent",
    subreddits: config.subreddits,
    schedule: config.cronSchedule,
    reddit: { enabled: Boolean(config.reddit && config.reddit.enabled) },
    x: { enabled: Boolean(config.x && config.x.enabled), queries: (config.x && config.x.queries) || [] },
    linkedin: { enabled: Boolean(config.linkedin && config.linkedin.enabled), queries: (config.linkedin && config.linkedin.queries) || [] },
    upwork: { enabled: Boolean(config.upwork && config.upwork.enabled), queries: (config.upwork && config.upwork.queries) || [] },
    endpoints: ["GET /health", "GET /api/status", "GET /api/leads", "POST /api/ingest/leads", "POST /api/scrape", "GET /api/scrape/jobs", "GET /api/stats", "POST /api/chat", "GET /api/events", "GET /api/scrapers", "POST /api/webhooks/scrape-complete"],
  });
});


app.get("/api/status", async (req, res) => {
  const state = await loadState();
  res.json({
    running: isRunning(),
    schedule: config.cronSchedule,
    subreddits: config.subreddits,
    capabilities: config.capabilities.map((k) => k.label),
    llm: llmStatus(),
    reddit: { enabled: Boolean(config.reddit && config.reddit.enabled) },
    x: { enabled: Boolean(config.x && config.x.enabled), queries: (config.x && config.x.queries) || [] },
    linkedin: { enabled: Boolean(config.linkedin && config.linkedin.enabled), queries: (config.linkedin && config.linkedin.queries) || [] },
    upwork: { enabled: Boolean(config.upwork && config.upwork.enabled), queries: (config.upwork && config.upwork.queries) || [] },
    ...state,
  });
});

function ensureDatabase() {
  const pgdata = process.env.PGDATA || "/home/personal/LeadGun/.pgdata";
  const pgctl = process.env.PGCTL || "/usr/lib/postgresql/18/bin/pg_ctl";
  if (!fs.existsSync(pgdata)) return;
  const result = spawnSync(
    pgctl,
    ["-D", pgdata, "-o", "-k /tmp/opencode -p 5433", "-l", `${pgdata}/pg.log`, "start"],
    { encoding: "utf8" }
  );
  if (result.status !== 0 && !(result.stderr || "").includes("already running")) {
    console.log("DB start:", (result.stderr || result.stdout || "").slice(0, 200));
  }
}

async function start() {
  ensureDatabase();
  await ensureDataDir();
  const scraperSettings = await getScraperSettings();
  const enabledSources = Object.entries(scraperSettings).filter(([, enabled]) => enabled).map(([id]) => id);
  console.log(`🧩 Scrapers enabled: ${enabledSources.length > 0 ? enabledSources.join(", ") : "none"}`);

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
