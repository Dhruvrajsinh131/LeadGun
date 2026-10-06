"use strict";

const fs = require("fs/promises");
const path = require("path");
const config = require("../config");
const { leadScore } = require("./matcher");

async function ensureDataDir() {
  await fs.mkdir(config.dataDir, { recursive: true });
}

function filePath(name) {
  return path.join(config.dataDir, name);
}

// Canonical identity of a post link for uniqueness checks. Scraped URLs
// vary cosmetically (trailing slash, utm/query params, #fragments), so
// raw-string comparison lets the same post through twice. Normalizing
// (trim, strip query/fragment, drop trailing slashes) makes the
// notified-record lookup robust. Case is preserved: Reddit comment IDs
// are case-sensitive.
// Returns "" for non-URL values (never a valid dedupe key).
function normalizeUrl(value) {
  if (typeof value !== "string") return "";
  let u = value.trim();
  const hash = u.indexOf("#");
  if (hash !== -1) u = u.slice(0, hash);
  const query = u.indexOf("?");
  if (query !== -1) u = u.slice(0, query);
  if (u.length > 1) u = u.replace(/\/+$/, "");
  return u;
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

function mergeLeads(existing, incoming) {
  const byUrl = new Map();
  for (const p of [...incoming, ...existing]) {
    if (!p.url) continue;
    const prev = byUrl.get(p.url);
    if (!prev || leadScore(p) > leadScore(prev)) byUrl.set(p.url, p);
  }
  return [...byUrl.values()].sort((a, b) => leadScore(b) - leadScore(a));
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

module.exports = { ensureDataDir, readJson, writeJson, mergePosts, mergeLeads, saveResults, saveLeads, loadState, saveState, normalizeUrl };
