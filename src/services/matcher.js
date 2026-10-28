"use strict";

const config = require("../config");
const { freshnessFor } = require("./freshness");

function matchSources(text, patterns) {
  return patterns.filter((re) => re.test(text)).map((re) => re.source);
}

// LinkedIn often uses Unicode bold ("𝗪𝗲 𝗮𝗿𝗲 𝗵𝗶𝗿𝗶𝗻𝗴") which defeats
// ASCII regexes. NFKD folds those glyphs back to plain letters.
function normalizeText(text) {
  return String(text || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function extractCapabilities(text) {
  const hits = [];
  for (const { label, category, pattern } of config.capabilities) {
    if (pattern.test(text)) hits.push({ label, category });
  }
  const labels = [...new Set(hits.map((h) => h.label))];
  const categories = [...new Set(hits.map((h) => h.category))];
  return { labels, categories };
}

function extractSignals(post) {
  const title = post.title || "";
  const content = post.content || "";
  const text = normalizeText(`${title}\n${content}`);
  const directIntent = matchSources(text, config.directIntentPatterns);
  // Hard excludes (sellers/seekers) apply even with direct intent; soft
  // excludes only when there is no direct intent.
  const hardExcluded = (config.hardExcludePatterns || []).some((re) => re.test(text));
  if (post.platform === "upwork" && !hardExcluded && directIntent.length === 0) {
    directIntent.push("upwork-job-posting");
  }
  const excluded = hardExcluded || (directIntent.length === 0 && config.excludePatterns.some((re) => re.test(text)));
  const indirectIntent = excluded ? [] : matchSources(text, config.indirectIntentPatterns);
  const { labels, categories } = excluded
    ? { labels: [], categories: [] }
    : extractCapabilities(text);
  const budgetSignals = excluded ? [] : matchSources(text, config.budgetPatterns);
  return { directIntent, indirectIntent, capabilities: labels, capabilityCategories: categories, budgetSignals, excluded };
}

function heuristicScore(signals, post = {}) {
  if (signals.excluded) return 0;
  let score = 0;
  if (signals.directIntent.length > 0) score += Math.min(60, 45 + (signals.directIntent.length - 1) * 5);
  if (signals.indirectIntent.length > 0) score += Math.min(45, 30 + (signals.indirectIntent.length - 1) * 4);
  score += Math.min(24, signals.capabilities.length * 8);
  if (signals.capabilityCategories.length > 1) score += Math.min(12, (signals.capabilityCategories.length - 1) * 6);
  if (signals.budgetSignals.length > 0) score += 10;
  const sub = String(post.subreddit || "").toLowerCase();
  if (signals.directIntent.length > 0 && (config.founderSubs || []).includes(sub)) score += 10;
  return Math.min(100, score);
}

function gradeFor(score) {
  if (score >= 75) return "A";
  if (score >= 55) return "B";
  if (score >= config.minLeadScore) return "C";
  return "D";
}

// Prefer the LLM score, fall back to heuristic; always finite.
function leadScore(lead) {
  for (const v of [lead.score, lead.heuristicScore]) {
    const n = typeof v === "number" ? v : parseInt(v, 10);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function analyzePost(post) {
  const fresh = { ...post };
  for (const key of ["score", "grade", "classifiedBy", "reasoning", "budget", "llmError", "warm", "freshness", "ageMs", "ageDays", "ageLabel", "isFresh", "isHealthy"]) delete fresh[key];
  const signals = extractSignals(fresh);
  const freshnessInfo = freshnessFor(fresh);
  const heuristic = heuristicScore(signals, fresh);
  const hasIntent = signals.directIntent.length > 0 || signals.indirectIntent.length > 0;
  const hasCapability = signals.capabilities.length > 0;
  // Needs hiring intent plus a capability keyword, posted within the age window.
  const isLead = !signals.excluded && hasIntent && hasCapability && freshnessInfo.isFresh && heuristic >= config.minLeadScore;
  // Warm = direct intent plus budget signal; sorted first in Discord.
  const isWarm = isLead && signals.directIntent.length > 0 && signals.budgetSignals.length > 0;
  return {
    ...fresh,
    ...signals,
    ...freshnessInfo,
    intentType: signals.directIntent.length > 0 ? "direct" : signals.indirectIntent.length > 0 ? "indirect" : "none",
    heuristicScore: heuristic,
    grade: gradeFor(heuristic),
    isLead,
    warm: isWarm,
    classifiedBy: "heuristic",
  };
}

// Re-check stored leads against the current hard-exclude list, without
// discarding an existing LLM verdict. Used when loading saved leads.
function isHardExcluded(post) {
  const text = normalizeText(`${post.title || ""}\n${post.content || ""}`);
  return (config.hardExcludePatterns || []).some((re) => re.test(text));
}

function analyzePosts(posts) {
  return posts.map(analyzePost);
}

function filterLeads(analyzed) {
  return analyzed
    .filter((p) => p.isLead)
    .sort((a, b) => (Number(b.warm) - Number(a.warm)) || (b.heuristicScore - a.heuristicScore));
}

module.exports = { gradeFor, leadScore, analyzePosts, filterLeads, isHardExcluded };
