"use strict";

const config = require("../config");
const { gradeFor, leadScore } = require("./matcher");
const { normalizeUrl } = require("./store");

const AGENCY_CAPABILITIES = [
  "full-stack development", "React.js", "Next.js", "Node.js", "TypeScript", "Go",
  "backend development", "API development", "WebSockets", "Redis", "PostgreSQL",
  "database optimization", "backend performance", "scaling",
  "Odoo development", "Odoo customization", "Odoo modules", "Odoo migration",
  "Odoo integrations", "Odoo POS", "Odoo ERP",
  "AI applications", "LLM applications", "RAG", "AI agents", "agentic AI",
  "OpenAI integrations", "AI automation", "business automation", "AI SaaS",
  "MVP development", "SaaS development", "POS systems", "real-time applications",
].join(", ");

function buildPrompt(post) {
  // Token-frugal by design: title + head of content only (~600 chars is
  // plenty to judge hiring intent). Verdict capped at ~150 output tokens.
  const body = `Title: ${post.title || ""}\nSubreddit: r/${post.subreddit || "?"}\nContent: ${(post.content || "").slice(0, 600)}`;
  return [
    "You are a lead qualifier for a software development agency.",
    `Agency capabilities: ${AGENCY_CAPABILITIES}.`,
    "Decide if this Reddit post is a sales lead: someone who may pay a developer, freelancer, team, or agency.",
    "Count INDIRECT intent too (e.g. slow backend, scaling pain, Odoo struggles, RAG needs) when professional work is likely required.",
    "Full-time / direct-hire employment listings (e.g. 'Senior Python Engineer, $3000/month', 'we are hiring...') ARE leads: a company hiring engineers may also buy agency, contract, or staff-augmentation services. Score them by project clarity like any hiring post.",
    "Reject tutorials, questions with no project, job seekers offering services, and spam.",
    "Also reject: personal stories, war-stories, or observations with no request for help; DIYers who say they will do it themselves or won't pay; competitors showcasing their own product or agency; job boards, salary lists, and roundup posts; vague posts with no clear project, budget signal, or ask.",
    "Price-shopping posts ('what would you charge to build X' with a real brief) ARE leads — score them by project clarity.",
    `${body}`,
    "Reply with ONLY this JSON, no other text:",
    '{"isLead": true/false, "score": 0-100, "intentType": "direct"/"indirect"/"none", "capabilities": ["labels"], "budget": "signals or empty string", "reasoning": "one sentence"}',
  ].join("\n");
}

function safeParseJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

// $ per 1M tokens [input, output]. Unknown models log tokens without $.
const MODEL_PRICES = {
  "gpt-4o-mini": [0.15, 0.6],
  "gpt-4o": [2.5, 10],
  "gpt-4.1-mini": [0.4, 1.6],
  "gpt-4.1": [2, 8],
};

const runUsage = { calls: 0, promptTokens: 0, completionTokens: 0 };

function resetUsage() {
  runUsage.calls = 0;
  runUsage.promptTokens = 0;
  runUsage.completionTokens = 0;
}

function getLlmUsage() {
  const total = runUsage.promptTokens + runUsage.completionTokens;
  const prices = MODEL_PRICES[config.llm.model];
  const out = { calls: runUsage.calls, promptTokens: runUsage.promptTokens, completionTokens: runUsage.completionTokens, totalTokens: total };
  if (prices) out.estimatedUsd = Number(((runUsage.promptTokens * prices[0] + runUsage.completionTokens * prices[1]) / 1e6).toFixed(4));
  return out;
}

function logUsage() {
  const u = getLlmUsage();
  const cost = u.estimatedUsd !== undefined ? ` (~$${u.estimatedUsd})` : "";
  console.log(`🧠 LLM usage: ${u.calls} calls, ${u.promptTokens} in / ${u.completionTokens} out tokens${cost} [${config.llm.model}]`);
}

async function classifyWithLLM(post) {
  const { baseUrl, apiKey, model, timeoutMs } = config.llm;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 150,
        messages: [{ role: "user", content: buildPrompt(post) }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.usage) {
      runUsage.calls++;
      runUsage.promptTokens += data.usage.prompt_tokens || 0;
      runUsage.completionTokens += data.usage.completion_tokens || 0;
    }
    const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) return null;
    const parsed = safeParseJson(text);
    if (!parsed || typeof parsed.isLead !== "boolean") return null;
    return {
      isLead: parsed.isLead,
      score: Math.max(0, Math.min(100, parseInt(parsed.score, 10) || 0)),
      intentType: ["direct", "indirect", "none"].includes(parsed.intentType) ? parsed.intentType : post.intentType,
      capabilities: Array.isArray(parsed.capabilities) ? parsed.capabilities : post.capabilities,
      budget: typeof parsed.budget === "string" ? parsed.budget : "",
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function classifyPost(post) {
  const hasSignal = post.directIntent.length > 0 || post.indirectIntent.length > 0;
  if (!config.llm.enabled || !config.llm.apiKey || !hasSignal) return post;
  const verdict = await classifyWithLLM(post);
  if (!verdict) return { ...post, llmError: true };
  const score = verdict.isLead ? Math.max(verdict.score, config.minLeadScore) : Math.min(verdict.score, config.minLeadScore - 1);
  return {
    ...post,
    isLead: verdict.isLead && score >= config.minLeadScore,
    score,
    grade: gradeFor(score),
    intentType: verdict.intentType,
    capabilities: verdict.capabilities,
    budget: verdict.budget,
    reasoning: verdict.reasoning,
    classifiedBy: "llm",
  };
}

async function classifyLeads(analyzed, skipUrls = new Set()) {
  // Token budget: only heuristic leads are judged (never raw scraped
  // posts), best-first, capped per run. Anything past the cap keeps its
  // heuristic verdict instead of spending tokens on leads we'd never send.
  // Matches DISCORD_MAX_LEADS so we judge exactly what we can notify.
  // Already-notified URLs are never re-judged — tokens go to new leads.
  // Compared normalized so cosmetic URL variants (trailing slash, utm
  // params) don't waste calls or slip through twice.
  const seenNotified = new Set([...skipUrls].map(normalizeUrl).filter(Boolean));
  const candidates = analyzed
    .filter((p) => p.isLead)
    .sort((a, b) => (b.heuristicScore || 0) - (a.heuristicScore || 0));
  const fresh = candidates.filter((p) => !seenNotified.has(normalizeUrl(p.url)));
  const renotified = candidates.length - fresh.length;
  const budget = Math.max(0, config.llm.maxCallsPerRun);
  const head = fresh.slice(0, budget);
  const tail = [...fresh.slice(budget), ...candidates.filter((p) => seenNotified.has(normalizeUrl(p.url)))];
  resetUsage();
  const out = [];
  for (const post of head) {
    out.push(await classifyPost(post));
  }
  if (tail.length > 0 || renotified > 0) {
    console.log(`🧠 LLM budget: judged ${head.length}, kept ${tail.length} on heuristic verdict (cap ${budget}, ${renotified} already notified).`);
  }
  // Verdict breakdown: heuristic leads the LLM rejected never reach
  // Discord, so log the counts (e.g. "kept 1, rejected 3") instead of
  // silently notifying fewer posts than the heuristic found.
  const llmActive = config.llm.enabled && Boolean(config.llm.apiKey);
  if (llmActive && head.length > 0) {
    const kept = out.filter((p) => p.isLead).length;
    console.log(`🧠 LLM verdict: kept ${kept}, rejected ${head.length - kept} (judged ${head.length}).`);
    // Name the rejects with the LLM's one-line reason, otherwise a post
    // the user expected (e.g. "Senior Python Engineer") disappears
    // silently and the funnel looks broken.
    for (const r of out.filter((p) => !p.isLead).slice(0, 10)) {
      console.log(`   ❌ [${r.heuristicScore}|${(r.capabilities || []).join(", ")}] ${(r.title || "").slice(0, 110)} — ${r.reasoning || "no reason given"}`);
    }
  }
  if (runUsage.calls > 0) logUsage();
  return [...out, ...tail]
    .filter((p) => p.isLead)
    .sort((a, b) => leadScore(b) - leadScore(a));
}

function llmStatus() {
  return { enabled: config.llm.enabled, configured: Boolean(config.llm.apiKey), model: config.llm.model };
}

module.exports = { classifyPost, classifyLeads, llmStatus, getLlmUsage };
