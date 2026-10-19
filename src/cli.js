"use strict";

const { runScrapeJob } = require("./jobs/scrapeJob");

const SOURCES = ["reddit", "x", "linkedin"];

function usage() {
  return [
    "Usage: npm run scrape [-- --reddit | --x | --linkedin | --all]",
    "",
    "  --reddit     Scrape Reddit only",
    "  --x          Scrape X (Twitter) only",
    "  --linkedin   Scrape LinkedIn only",
    "  --all        Scrape every source",
    "",
    "No flags: uses the sources enabled in src/config/index.js.",
  ].join("\n");
}

function parseArgs(argv) {
  let help = false;
  let all = false;
  const sources = {};
  for (const raw of argv) {
    const arg = String(raw).toLowerCase();
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--all") {
      all = true;
      continue;
    }
    const name = arg.startsWith("--") ? arg.slice(2) : "";
    if (SOURCES.includes(name)) {
      sources[name] = true;
      continue;
    }
    throw new Error(`Unknown argument: ${raw}\n\n${usage()}`);
  }
  if (all) for (const name of SOURCES) sources[name] = true;
  return { help, sources: Object.keys(sources).length > 0 ? sources : undefined };
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
  if (parsed.help) {
    console.log(usage());
    return;
  }
  const result = await runScrapeJob({ reason: "cli", sources: parsed.sources });
  if (!result || result.ok === false) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs, usage, main };
