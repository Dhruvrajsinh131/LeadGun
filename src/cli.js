"use strict";

const { runScrapeJob } = require("./jobs/scrapeJob");

const SOURCES = ["reddit", "x", "linkedin", "upwork"];

function usage() {
  return [
    "Usage: npm run scrape [-- --reddit | --x | --linkedin | --upwork | --all]",
    "",
    "  --reddit                  Scrape Reddit only",
    "  --x                       Scrape X (Twitter) only",
    "  --linkedin                Scrape LinkedIn only",
    "  --upwork                  Scrape Upwork only",
    "  --all                     Scrape every source",
    '  --keywords="phrase,phrase"  Override search phrases',
    "",
    "No source flags: uses the sources enabled in src/config/index.js.",
  ].join("\n");
}

function parseKeywordList(value) {
  return String(value || "")
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  let help = false;
  let all = false;
  const sources = {};
  let keywords = undefined;

  for (let i = 0; i < argv.length; i++) {
    const raw = String(argv[i]);
    const arg = raw.toLowerCase();

    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--all") {
      all = true;
      continue;
    }
    if (arg === "--keywords" || arg === "--keyword") {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value for ${raw}\n\n${usage()}`);
      keywords = [...(keywords || []), ...parseKeywordList(value)];
      continue;
    }
    if (arg.startsWith("--keywords=")) {
      keywords = [...(keywords || []), ...parseKeywordList(raw.slice("--keywords=".length))];
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
  return { help, sources: Object.keys(sources).length > 0 ? sources : undefined, keywords };
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`❌ ${err.message}`);
    return 1;
  }
  if (parsed.help) {
    console.log(usage());
    return 0;
  }
  const result = await runScrapeJob({ reason: "cli", sources: parsed.sources, keywords: parsed.keywords });
  return !result || result.ok === false ? 1 : 0;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`❌ ${err.message}`);
      process.exit(1);
    });
}
