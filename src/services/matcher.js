"use strict";

const config = require("../config");

function matchSources(text, patterns) {
  return patterns.filter((re) => re.test(text)).map((re) => re.source);
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
  const text = `${title}\n${content}`;
  const directIntent = matchSources(text, config.directIntentPatterns);
  // RECALL SAFEGUARD: a post explicitly hiring is never auto-excluded by
  // the soft spam filters (crypto, free-course…). Hard seller/seeker
  // patterns always apply — they identify non-buyers, not topics.
  const hardExcluded = (config.hardExcludePatterns || []).some((re) => re.test(text));
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
  // Founder/problem posts outrank generic tech chatter: someone building a
  // business is closer to paying than someone asking a question.
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

// Single source of truth for "the" score of a post/lead.
// Prefers the LLM score when present, falls back to heuristic.
// Always returns a finite number — stale string scores from old runs
// (e.g. score:'7') can no longer shadow the real score or break sorts.
function leadScore(lead) {
  for (const v of [lead.score, lead.heuristicScore]) {
    const n = typeof v === "number" ? v : parseInt(v, 10);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function analyzePost(post) {
  // Strip previous-run verdict fields so a re-analysis is always fresh.
  // Without this, a stale `score` would survive via the spread below and
  // shadow the recomputed heuristicScore downstream.
  const { score, grade, classifiedBy, reasoning, budget, llmError, warm, ...fresh } = post;
  const signals = extractSignals(fresh);
  const heuristic = heuristicScore(signals, fresh);
  const hasIntent = signals.directIntent.length > 0 || signals.indirectIntent.length > 0;
  const hasCapability = signals.capabilities.length > 0;
  // A dev-agency lead needs hiring intent AND at least one capability
  // keyword (stack, role, or AI mention — generics included, the LLM
  // rejects non-dev matches downstream).
  // Keyword-only posts (framework announcements) and intent-only posts
  // (e.g. hiring a content writer) are not our leads.
  const isLead = !signals.excluded && hasIntent && hasCapability && heuristic >= config.minLeadScore;
  // Warm = actively buying: direct hiring intent plus a money signal.
  // These go first in every Discord batch.
  const isWarm = isLead && signals.directIntent.length > 0 && signals.budgetSignals.length > 0;
  return {
    ...fresh,
    ...signals,
    intentType: signals.directIntent.length > 0 ? "direct" : signals.indirectIntent.length > 0 ? "indirect" : "none",
    heuristicScore: heuristic,
    grade: gradeFor(heuristic),
    isLead,
    warm: isWarm,
    classifiedBy: "heuristic",
  };
}

function analyzePosts(posts) {
  return posts.map(analyzePost);
}

function filterLeads(analyzed) {
  return analyzed
    .filter((p) => p.isLead)
    .sort((a, b) => (Number(b.warm) - Number(a.warm)) || (b.heuristicScore - a.heuristicScore));
}

module.exports = { extractSignals, heuristicScore, gradeFor, leadScore, analyzePost, analyzePosts, filterLeads };
