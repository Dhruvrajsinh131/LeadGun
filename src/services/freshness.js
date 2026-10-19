"use strict";

const config = require("../config");

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const AGE_UNITS = [
  [/^(?:m|min|mins|minute|minutes)$/i, MINUTE_MS],
  [/^(?:h|hr|hrs|hour|hours)$/i, HOUR_MS],
  [/^(?:d|day|days)$/i, DAY_MS],
  [/^(?:w|wk|wks|week|weeks)$/i, 7 * DAY_MS],
  [/^(?:mo|mos|month|months)$/i, 30 * DAY_MS],
  [/^(?:y|yr|yrs|year|years)$/i, 365 * DAY_MS],
];

function cleanAgeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^•\s*/, "")
    .replace(/\s*[•·].*$/, "")
    .trim();
}

function parseRelativeAge(value) {
  const text = cleanAgeText(value);
  if (!text) return null;
  if (/^(?:just now|now)$/i.test(text)) return 0;
  if (/^yesterday$/i.test(text)) return DAY_MS;
  const match = text.match(/^(\d+)\s*([a-z]+)\.?\s*(?:ago)?$/i);
  if (!match) return null;
  const unit = AGE_UNITS.find(([pattern]) => pattern.test(match[2]));
  return unit ? Number(match[1]) * unit[1] : null;
}

function ageFromContent(content) {
  const lines = String(content || "").split(/\r?\n/).slice(0, 10);
  for (const line of lines) {
    const age = parseRelativeAge(line);
    if (age != null) return age;
  }
  return null;
}

function ageFromDate(value, now) {
  if (value == null || value === "") return null;
  if (typeof value === "number" || /^\d{10,13}$/.test(String(value).trim())) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    // 10 digits = epoch seconds, 13 = milliseconds.
    const time = String(Math.trunc(n)).length <= 10 ? n * 1000 : n;
    return Math.max(0, now - time);
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, now - time);
}

// LinkedIn activity ids embed the creation time in their high bits (ms).
function ageFromLinkedInUrl(url, now) {
  const match = String(url || "").match(/-(?:share|ugcPost|activity)-(\d{15,})/i);
  if (!match) return null;
  try {
    const time = Number(BigInt(match[1]) >> 22n);
    if (!Number.isFinite(time) || time <= 0) return null;
    return Math.max(0, now - time);
  } catch {
    return null;
  }
}

// Relative labels ("20m", "4 days ago") describe the post age when it was
// scraped, not now. Anchor them to scrapedAt so stored leads keep aging.
function ageFromRelative(post, now) {
  const relative = parseRelativeAge(post.timeAgo);
  const fromContent = relative == null ? ageFromContent(post.content) : null;
  const relMs = relative != null ? relative : fromContent;
  if (relMs == null) return null;
  const anchor = Date.parse(post.scrapedAt);
  if (!Number.isFinite(anchor)) return relMs;
  return Math.max(0, now - (anchor - relMs));
}

function ageMsFor(post, now = Date.now()) {
  for (const value of [post.createdAt, post.postedAt, post.publishedAt]) {
    const age = ageFromDate(value, now);
    if (age != null) return age;
  }
  const relative = ageFromRelative(post, now);
  if (relative != null) return relative;
  return ageFromLinkedInUrl(post.url, now);
}

function formatAge(ms) {
  if (ms < MINUTE_MS) return "just now";
  const minutes = Math.floor(ms / MINUTE_MS);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(ms / HOUR_MS);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(ms / DAY_MS);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

// Fresh = within maxLeadAgeDays, healthy = under healthyLeadAgeDays.
// Posts with no detectable date are not trusted as fresh.
function freshnessFor(post, now = Date.now()) {
  const ageMs = ageMsFor(post, now);
  if (ageMs == null) {
    return { ageMs: null, ageDays: null, ageLabel: "", isFresh: false, isHealthy: false, freshness: "unknown" };
  }
  const ageDays = ageMs / DAY_MS;
  const isFresh = ageDays <= config.maxLeadAgeDays;
  const isHealthy = ageDays < config.healthyLeadAgeDays;
  return {
    ageMs,
    ageDays: Number(ageDays.toFixed(2)),
    ageLabel: formatAge(ageMs),
    isFresh,
    isHealthy,
    freshness: isHealthy ? "healthy" : isFresh ? "fresh" : "stale",
  };
}

module.exports = { parseRelativeAge, ageMsFor, formatAge, freshnessFor };
