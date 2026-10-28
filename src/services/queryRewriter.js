"use strict";

const { getOpenAI, hasOpenAI, model } = require("../lib/openai");

const MAX_KEYWORDS = 6;
const PLATFORM_WORDS = new Set(["reddit", "twitter", "x", "linkedin", "upwork"]);

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "for", "to", "in", "on", "at", "with", "of",
  "my", "our", "your", "me", "i", "we", "you",
  "find", "get", "show", "give", "search", "scrape", "collect", "discover",
  "look", "looking", "need", "needs", "needed", "want", "wants", "some", "any",
  "new", "fresh", "latest", "please", "can", "could", "would", "help",
  "job", "jobs", "role", "roles", "position", "positions", "gig", "gigs",
  "post", "posts", "opening", "openings", "work", "working",
  "hire", "hiring", "candidate", "candidates",
]);

const ROLE_WORDS = new Set([
  "agency", "consultant", "contractor", "designer", "dev", "developer",
  "engineer", "freelancer", "programmer", "team", "tester",
]);

const TOKEN_ALIASES = {
  dev: "developer",
  devs: "developer",
  developers: "developer",
  engineers: "engineer",
  freelancers: "freelancer",
  consultants: "consultant",
  contractors: "contractor",
  designers: "designer",
  programmers: "programmer",
};

const SYSTEM_PROMPT = [
  "You turn a user's request into practical search queries for a job-lead scraper.",
  "The scraper searches Reddit, X, LinkedIn and Upwork for people or companies that want to hire.",
  "Return JSON only: {\"keywords\":[\"...\", \"...\"]}.",
  "Rules:",
  "- Return 4 to 6 queries.",
  "- Each query must be a complete phrase of 2 to 6 words.",
  "- Preserve the requested field, technology, location, seniority and remote preference.",
  "- Prefer buyer-intent phrases for Reddit/X, such as \"remote developer needed\" or \"hire remote developer\".",
  "- Prefer plain role phrases for LinkedIn/Upwork, such as \"remote software developer\".",
  "- Never return standalone generic words such as software, developer, remote, jobs, role or work.",
  "- Never include platform names, URLs, quotes, numbering or explanations.",
].join("\n");

function cleanText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#.\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensFor(value) {
  return cleanText(value)
    .split(" ")
    .filter(Boolean)
    .map((token) => TOKEN_ALIASES[token] || token);
}

function meaningfulTokens(value) {
  return tokensFor(value).filter(
    (token) => token.length > 1 && !STOP_WORDS.has(token) && !PLATFORM_WORDS.has(token)
  );
}

function isValidKeyword(value) {
  const cleaned = cleanText(value);
  if (!cleaned) return false;
  const words = cleaned.split(" ");
  if (words.length < 2 || words.length > 7) return false;
  if (words.some((word) => PLATFORM_WORDS.has(word))) return false;
  return meaningfulTokens(cleaned).length >= 2;
}

function uniqueKeywords(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (!isValidKeyword(value)) continue;
    const keyword = cleanText(value);
    if (seen.has(keyword)) continue;
    seen.add(keyword);
    out.push(keyword);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

function fallbackKeywords(input) {
  const tokens = meaningfulTokens(Array.isArray(input) ? input.join(" ") : input);
  const base = tokens.join(" ").trim();
  if (!base) return [];
  const words = new Set(tokens);
  const hasRole = [...words].some((word) => ROLE_WORDS.has(word));
  const candidates = [base];

  if (hasRole) {
    candidates.push(`${base} needed`, `hire ${base}`, `freelance ${base}`, `contract ${base}`);
    if (words.has("developer")) candidates.push(base.replace(/\bdeveloper\b/g, "engineer"));
    if (words.has("engineer")) candidates.push(base.replace(/\bengineer\b/g, "developer"));
  } else {
    candidates.push(`${base} services`, `${base} help`, `need ${base}`, `looking for ${base}`);
  }
  return uniqueKeywords(candidates);
}

async function llmKeywords(input, sources) {
  const response = await getOpenAI().chat.completions.create(
    {
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `User request: ${input}\nSources: ${sources.length ? sources.join(", ") : "all"}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 220,
      response_format: { type: "json_object" },
    },
    { timeout: 15000 }
  );
  const content = response.choices[0]?.message?.content || "{}";
  const parsed = JSON.parse(content);
  return uniqueKeywords(Array.isArray(parsed.keywords) ? parsed.keywords : []);
}

function normalizeScrapeKeywords(values) {
  const cleaned = (Array.isArray(values) ? values : [values])
    .map((value) => cleanText(value))
    .filter(Boolean);
  if (cleaned.length === 0) return [];
  if (cleaned.length === 1) return isValidKeyword(cleaned[0]) ? cleaned : fallbackKeywords(cleaned[0]);

  const valid = uniqueKeywords(cleaned);
  if (valid.length >= 2) return valid;
  return fallbackKeywords(cleaned.join(" "));
}

async function rewriteSearchKeywords({ query, sources = [] } = {}) {
  const input = Array.isArray(query) ? query.join(", ") : String(query || "").trim();
  if (!input) return [];

  const fallback = fallbackKeywords(input);
  if (!hasOpenAI()) return fallback;

  try {
    const rewritten = await llmKeywords(input, sources);
    if (rewritten.length < 3) return fallback;
    return uniqueKeywords([...rewritten, ...fallback]);
  } catch (err) {
    console.error(`Query rewrite failed, using fallback: ${err && err.message ? err.message : err}`);
    return fallback;
  }
}

module.exports = { rewriteSearchKeywords, normalizeScrapeKeywords };
