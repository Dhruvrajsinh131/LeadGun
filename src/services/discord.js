"use strict";

const config = require("../config");
const { leadScore: scoreOf } = require("./matcher");
const { readJson, writeJson, normalizeUrl } = require("./store");
const { sleep } = require("../utils/humanBehavior");

function isConfigured() {
  return config.discord.enabled && Boolean(config.discord.botToken) && Boolean(config.discord.channelId);
}

// Discord answers HTTP 400 to an embed whose `url` is not a well-formed
// http(s) URL, and one bad embed fails the whole message batch. Scraped
// links are not always clean (fallback harvest, old stored posts), so
// sanitize every URL: invalid ones are omitted from the embed instead of
// poisoning the batch.
function safeUrl(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return undefined;
  try {
    new URL(trimmed);
    return trimmed;
  } catch {
    return undefined;
  }
}

function gradeEmoji(grade) {
  if (grade === "A") return "🔥";
  if (grade === "B") return "⭐";
  return "💡";
}

function intentLabel(intentType) {
  if (intentType === "direct") return "🎯 Direct";
  if (intentType === "indirect") return "💡 Indirect";
  return "❓ Unknown";
}

function verifierLabel(classifiedBy) {
  if (classifiedBy === "llm") return "🧠 AI";
  if (classifiedBy === "test") return "🧪 Test";
  return "⚙️ Heuristic";
}

function leadToEmbed(lead) {
  const url = safeUrl(lead.url);
  const lines = [
    `📍 r/${lead.subreddit} · ${lead.source || "feed"} · ⬆ ${lead.upvotes ?? 0} · 💬 ${lead.comments ?? 0}`,
    `🧰 ${(lead.capabilities || []).join(", ") || "general"}`,
  ];
  if (lead.warm) lines.push("🔥 Red-hot buyer — budget mentioned");
  else if (typeof lead.budget === "string" && lead.budget.trim()) lines.push(`💰 ${lead.budget.trim().slice(0, 120)}`);
  if (url) lines.push(url);
  const embed = {
    title: `${gradeEmoji(lead.grade)} [${lead.grade || "?"}|${scoreOf(lead)}] ${String(lead.title || "Untitled").slice(0, 200)}`.slice(0, 256),
    description: lines.join("\n").slice(0, 1000),
    color: lead.grade === "A" ? 5763719 : lead.grade === "B" ? 3447003 : 9807270,
    fields: [
      { name: "Intent", value: intentLabel(lead.intentType), inline: true },
      { name: "Checked by", value: verifierLabel(lead.classifiedBy), inline: true },
    ],
  };
  if (url) embed.url = url;
  if (lead.reasoning) embed.footer = { text: String(lead.reasoning).slice(0, 200) };
  return embed;
}

// Discord's documented limits for bots (free or not — exceeding any of
// them is an instant HTTP 400). Enforced client-side so a send can never
// fail on shape: truncate, never reject.
const LIMITS = {
  content: 2000,
  embedsPerMessage: 10,
  title: 256,
  description: 4096,
  fieldsPerEmbed: 25,
  fieldName: 256,
  fieldValue: 1024,
  footerText: 2048,
  totalCharsPerMessage: 6000,
};

function clampEmbed(embed) {
  const out = { ...embed };
  if (typeof out.title === "string") out.title = out.title.slice(0, LIMITS.title);
  if (typeof out.description === "string") out.description = out.description.slice(0, LIMITS.description);
  if (Array.isArray(out.fields)) {
    out.fields = out.fields.slice(0, LIMITS.fieldsPerEmbed).map((f) => ({
      name: String((f && f.name) || "—").slice(0, LIMITS.fieldName),
      // Empty field values are also a 400 — always fall back to "—".
      value: String((f && f.value) || "—").slice(0, LIMITS.fieldValue) || "—",
      inline: Boolean(f && f.inline),
    }));
  }
  if (out.footer && typeof out.footer.text === "string") out.footer = { text: out.footer.text.slice(0, LIMITS.footerText) };
  return out;
}

function embedChars(embed) {
  let n = (embed.title || "").length + (embed.description || "").length;
  for (const f of embed.fields || []) n += (f.name || "").length + (f.value || "").length;
  if (embed.footer) n += (embed.footer.text || "").length;
  return n;
}

// Caps embeds per message and shrinks the longest descriptions until the
// 6000-char message total fits. Our batches are small, so this loop is
// pure insurance that only bites on pathological input.
function fitPayload(payload) {
  const out = { ...payload };
  if (typeof out.content === "string" && out.content.length > LIMITS.content) {
    out.content = out.content.slice(0, LIMITS.content);
  }
  if (Array.isArray(out.embeds)) {
    const embeds = out.embeds.map(clampEmbed).slice(0, LIMITS.embedsPerMessage);
    // Shrink the longest text slot until the 6000-char message total fits.
    // Slot minimums keep real content untouched (our summaries run ~150
    // chars, titles ~60): only pathological input ever shrinks, and text
    // always converges because every minimum is far below the total cap.
    // Nothing is ever dropped — a lead is either sent whole or, in the
    // absurd case, with shortened text, never silently lost.
    let guard = 0;
    const messageChars = () => (out.content || "").length + embeds.reduce((n, e) => n + embedChars(e), 0);
    const cut = (s, min) => (s.length > min ? `${s.slice(0, Math.floor(s.length * 0.8))}…` : s);
    while (messageChars() > LIMITS.totalCharsPerMessage && guard++ < 50) {
      if ((out.content || "").length > 200) out.content = cut(out.content, 200);
      for (let ei = 0; ei < embeds.length; ei++) {
        const e = embeds[ei];
        if ((e.title || "").length > 100) e.title = cut(e.title, 100);
        if ((e.description || "").length > 50) e.description = cut(e.description, 50);
        if (e.footer && (e.footer.text || "").length > 50) e.footer = { text: cut(e.footer.text, 50) };
        if (Array.isArray(e.fields)) {
          e.fields = e.fields.map((f) => ((f.value || "").length > 50 ? { ...f, value: cut(f.value, 50) } : f));
        }
      }
    }
    out.embeds = embeds;
  }
  return out;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

const RUN_LABELS = { cli: "manual run", cron: "scheduled scan", startup: "startup scan", api: "API trigger", test: "test ping" };

function buildSummary(fresh, summary) {
  const reason = RUN_LABELS[summary.reason] || String(summary.reason || "run");
  const head = `🎯 **Lead hunt complete!** Sniffed out **${plural(fresh.length, "fresh lead", "fresh leads")}** from **${plural(summary.scraped, "post", "posts")}** across **${plural(summary.subreddits.length, "subreddit", "subreddits")}** · _${reason}_`;
  const top = fresh.filter((l) => l.grade === "A").length;
  const hot = fresh.filter((l) => l.warm).length;
  const extras = [];
  if (top > 0) extras.push(`🔥 ${plural(top, "A-grade", "A-grade")}`);
  if (hot > 0) extras.push(`💰 ${plural(hot, "red-hot buyer", "red-hot buyers")}`);
  return extras.length > 0 ? `${head}\n${extras.join(" · ")}` : head;
}

async function readBodySnippet(res) {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "<unreadable>";
  }
}

// Discord answers 429 with { retry_after: seconds } (sometimes
// retry_after_ms). Honor it, capped at 30s — longer waits mean a global
// limit, and queueing behind it helps nobody. Returns null when the
// response carries no usable hint (caller then stops instead of guessing).
async function readRetryAfterMs(res) {
  try {
    const data = await res.json();
    const seconds = typeof data.retry_after_ms === "number" ? data.retry_after_ms / 1000 : data.retry_after;
    if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(30000, Math.ceil(seconds * 1000));
    }
  } catch {}
  return null;
}

// Sends each payload independently and reports per-message success.
// Every payload passes fitPayload first, so a 400 on shape is
// structurally impossible — the only failures left are network issues
// or auth/permission problems, which are logged with Discord's own
// explanation. A failed batch doesn't abort the run; the remaining
// batches still go out. On 429 Discord tells us how long to wait
// (retry_after) — we honor it once per message, then give up on that
// message instead of hammering the free rate limit.
async function sendPayloads(payloads) {
  const { botToken, channelId } = config.discord;
  const results = [];
  for (let i = 0; i < payloads.length; i++) {
    const label = `message ${i + 1}/${payloads.length}`;
    const body = fitPayload(payloads[i]);
    if (!body.content && !(body.embeds || []).length) {
      console.error(`⛔ Discord send skipped (${label}): empty message`);
      results.push(false);
      continue;
    }
    let delivered = false;
    let rateLimited = false;
    for (let attempt = 0; attempt < 2 && !delivered && !rateLimited; attempt++) {
      let res;
      try {
        res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bot ${botToken}` },
          body: JSON.stringify(body),
        });
      } catch (err) {
        console.error(`⛔ Discord send failed (${label}): ${err.message}`);
        break;
      }
      if (res.status === 429) {
        const waitMs = await readRetryAfterMs(res);
        if (waitMs != null && attempt === 0) {
          console.log(`⏳ Discord rate limited (${label}), waiting ${Math.round(waitMs / 1000)}s before one retry...`);
          await sleep(waitMs);
          continue;
        }
        console.error(`⛔ Discord rate limited (${label}), stopping notifications for this run.`);
        rateLimited = true;
        break;
      }
      if (!res.ok) {
        console.error(`⛔ Discord send failed (${label}): HTTP ${res.status} — ${await readBodySnippet(res)}`);
        break;
      }
      delivered = true;
    }
    results.push(delivered);
    // A limit that survived its retry would hit every later message too.
    if (rateLimited) break;
    await sleep(1000);
  }
  return results;
}

async function notifyLeads(leads, summary) {
  if (!isConfigured()) {
    console.log("💬 Discord not configured, skipping notifications.");
    return { sent: 0, skipped: "not-configured" };
  }
  // Uniqueness is by normalized post URL: skipped when already notified
  // in any previous run (record auto-migrates old raw URLs), and skipped
  // when the same post appears twice in this run under cosmetic URL
  // variants (trailing slash, utm params). Best-scored copy wins.
  const notified = new Set((await readJson(config.notifiedFile, [])).map(normalizeUrl).filter(Boolean));
  const seenThisRun = new Set();
  const fresh = leads
    .filter((l) => normalizeUrl(l.url) && scoreOf(l) >= config.discord.minScore)
    .sort((a, b) => (Number(b.warm) - Number(a.warm)) || (scoreOf(b) - scoreOf(a)))
    .filter((l) => {
      const key = normalizeUrl(l.url);
      if (notified.has(key) || seenThisRun.has(key)) return false;
      seenThisRun.add(key);
      return true;
    })
    .slice(0, config.discord.maxLeads);
  if (fresh.length === 0) {
    console.log("💬 No new leads to notify.");
    return { sent: 0 };
  }
  const batches = [];
  for (let i = 0; i < fresh.length; i += 5) batches.push(fresh.slice(i, i + 5));
  const payloads = [
    { content: buildSummary(fresh, summary) },
    ...batches.map((group) => ({ embeds: group.map(leadToEmbed) })),
  ];
  const results = await sendPayloads(payloads);
  // Only leads in successfully delivered batches count as notified, so a
  // failed batch is retried on the next run instead of being forgotten.
  // Index 0 is the summary message; batch n lives at results[n + 1].
  const sentLeads = batches.filter((_, n) => results[n + 1]).flat();
  if (sentLeads.length > 0) {
    for (const l of sentLeads) notified.add(normalizeUrl(l.url));
    await writeJson(config.notifiedFile, [...notified].slice(-5000));
  }
  console.log(`💬 Notified Discord: ${sentLeads.length}/${fresh.length} lead(s).`);
  return { sent: sentLeads.length };
}

module.exports = { isConfigured, leadToEmbed, notifyLeads, buildSummary, fitPayload, LIMITS };
