"use strict";

const fs = require("fs/promises");
const path = require("path");
const config = require("../config");
const { leadScore, isHardExcluded } = require("./matcher");
const { freshnessFor } = require("./freshness");

async function ensureDataDir() {
  await fs.mkdir(config.dataDir, { recursive: true });
}

function filePath(name) {
  return path.join(config.dataDir, name);
}

// Dedupe key for post URLs: trims and strips query/fragment/trailing slash.
// LinkedIn posts without a permalink carry a unique #post-<hash> marker that
// is kept, so different posts by the same author stay distinct.
function normalizeUrl(value) {
  if (typeof value !== "string") return "";
  let u = value.trim();
  const marker = u.match(/#post-[0-9a-z]+$/i);
  const hash = u.indexOf("#");
  if (hash !== -1) u = u.slice(0, hash);
  const query = u.indexOf("?");
  if (query !== -1) u = u.slice(0, query);
  if (u.length > 1) u = u.replace(/\/+$/, "");
  return marker ? `${u}${marker[0].toLowerCase()}` : u;
}

async function readJson(name, fallback) {
  try {
    const raw = await fs.readFile(filePath(name), "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(name, data) {
  await ensureDataDir();
  await fs.writeFile(filePath(name), JSON.stringify(data, null, 2));
}

function mergePosts(existing, incoming) {
  const byUrl = new Map();
  for (const p of [...incoming, ...existing]) {
    if (!p.url) continue;
    if (!byUrl.has(p.url)) byUrl.set(p.url, p);
  }
  return [...byUrl.values()];
}

// Recompute freshness on every load so stored leads age out over time.
function withFreshness(lead, now = Date.now()) {
  return { ...lead, ...freshnessFor(lead, now) };
}

function isFreshLead(lead, now = Date.now()) {
  return freshnessFor(lead, now).isFresh;
}

// Stored leads were judged under older rules; re-apply seller/recruiter
// exclusions so old junk drops out without a re-scrape.
function isActiveLead(lead, now = Date.now()) {
  return isFreshLead(lead, now) && !isHardExcluded(lead);
}

function mergeLeads(existing, incoming) {
  const now = Date.now();
  const byUrl = new Map();
  for (const p of [...incoming, ...existing]) {
    if (!p.url) continue;
    const prev = byUrl.get(p.url);
    if (!prev || leadScore(p) > leadScore(prev)) byUrl.set(p.url, withFreshness(p, now));
  }
  return [...byUrl.values()]
    .filter((p) => isActiveLead(p, now))
    .sort((a, b) => leadScore(b) - leadScore(a));
}

async function saveResults(allPosts, matchedPosts) {
  await ensureDataDir();
  const prevAll = await readJson(config.allPostsFile, []);
  const prevMatched = await readJson(config.matchedPostsFile, []);
  const all = mergePosts(prevAll, allPosts);
  const matched = mergePosts(prevMatched, matchedPosts);
  await writeJson(config.allPostsFile, all);
  await writeJson(config.matchedPostsFile, matched);
  return { allCount: all.length, matchedCount: matched.length };
}

async function saveLeads(leads) {
  await ensureDataDir();
  const prev = await readJson(config.leadsFile, []);
  const merged = mergeLeads(prev, leads);
  await writeJson(config.leadsFile, merged);
  return { leadsCount: merged.length };
}

async function loadState() {
  return readJson(config.stateFile, { lastRun: null, lastResult: null, runCount: 0 });
}

async function saveState(state) {
  await writeJson(config.stateFile, state);
}

module.exports = { ensureDataDir, readJson, writeJson, mergePosts, mergeLeads, saveResults, saveLeads, loadState, saveState, normalizeUrl, withFreshness, isFreshLead, isActiveLead };
