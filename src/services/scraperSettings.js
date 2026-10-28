"use strict";

const config = require("../config");
const { readJson, writeJson } = require("./store");

const FILE = "scraper-settings.json";

const DEFINITIONS = [
  {
    id: "reddit",
    label: "Reddit",
    description: "r/forhire, startup and developer communities",
    icon: "forum",
  },
  {
    id: "x",
    label: "X (Twitter)",
    description: "Real-time hiring and build-in-public posts",
    icon: "alternate_email",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    description: "Hiring posts and contract opportunities",
    icon: "work",
  },
  {
    id: "upwork",
    label: "Upwork",
    description: "Freelance projects with active budgets",
    icon: "payments",
  },
];

const DEFAULTS = Object.freeze({
  reddit: true,
  x: Boolean(config.x && config.x.enabled),
  linkedin: Boolean(config.linkedin && config.linkedin.enabled),
  upwork: Boolean(config.upwork && config.upwork.enabled),
});

function normalize(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const settings = { ...DEFAULTS };
  for (const { id } of DEFINITIONS) {
    if (typeof source[id] === "boolean") settings[id] = source[id];
  }
  return settings;
}

function apply(settings) {
  config.reddit = { ...(config.reddit || {}), enabled: settings.reddit };
  if (config.x) config.x.enabled = settings.x;
  if (config.linkedin) config.linkedin.enabled = settings.linkedin;
  if (config.upwork) config.upwork.enabled = settings.upwork;
}

async function getScraperSettings() {
  const settings = normalize(await readJson(FILE, {}));
  apply(settings);
  return settings;
}

async function listScrapers() {
  const settings = await getScraperSettings();
  return DEFINITIONS.map((definition) => ({
    ...definition,
    enabled: settings[definition.id],
  }));
}

async function setScraperEnabled(id, enabled) {
  if (!DEFINITIONS.some((definition) => definition.id === id)) return null;
  const settings = await getScraperSettings();
  const next = { ...settings, [id]: Boolean(enabled) };
  await writeJson(FILE, next);
  apply(next);
  return next;
}

module.exports = { getScraperSettings, listScrapers, setScraperEnabled };
