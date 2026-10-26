"use strict";

const config = require("../config");
const { leadScore: scoreOf } = require("./matcher");
const { readJson, writeJson, normalizeUrl, withFreshness, isActiveLead } = require("./store");
const { sleep } = require("../utils/humanBehavior");

function isConfigured() {
  return config.discord.enabled && Boolean(config.discord.botToken) && Boolean(config.discord.channelId);
}

// One malformed embed URL makes Discord reject the whole batch.
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

function freshnessLabel(lead) {
  if (lead.isHealthy) return `🟢 Fresh · ${lead.ageLabel}`;
  if (lead.isFresh) return `🟡 Aging · ${lead.ageLabel}`;
  return `🔴 Stale · ${lead.ageLabel || "unknown"}`;
}

function leadToEmbed(lead) {
  const url = safeUrl(lead.url);
  const isX = lead.platform === "x";
  const isLinkedIn = lead.platform === "linkedin";
  const isUpwork = lead.platform === "upwork";
  const origin = isX
    ? `𝕏 @${lead.handle || lead.author || "?"} · ${lead.query ? `"${lead.query}"` : lead.source || "x-search"}`
    : isLinkedIn
      ? `💼 ${lead.handle || lead.author || "?"} · ${lead.query ? `"${lead.query}"` : lead.source || "linkedin-search"}`
      : isUpwork
        ? `🧑‍💻 Upwork · ${lead.clientLocation || lead.author || "client"} · ${lead.query ? `"${lead.query}"` : lead.source || "upwork-search"}`
        : `📍 r/${lead.subreddit} · ${lead.source || "feed"} · ⬆ ${lead.upvotes ?? 0} · 💬 ${lead.comments ?? 0}`;
  const lines = [
    origin,
    `🕒 ${freshnessLabel(lead)}`,
    `🧰 ${(lead.capabilities || []).join(", ") || "general"}`,
  ];
  if (isUpwork && lead.proposals) lines.push(`📨 ${String(lead.proposals).slice(0, 80)}`);
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

// Discord hard limits; exceeding any is HTTP 400.
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

// Shrink content until the 6000-char message total fits.
function fitPayload(payload) {
  const out = { ...payload };
  if (typeof out.content === "string" && out.content.length > LIMITS.content) {
    out.content = out.content.slice(0, LIMITS.content);
  }
  if (Array.isArray(out.embeds)) {
    const embeds = out.embeds.map(clampEmbed).slice(0, LIMITS.embedsPerMessage);
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

function freshnessCounts(leads) {
  const healthy = leads.filter((l) => l.isHealthy).length;
  const aging = leads.filter((l) => l.isFresh && !l.isHealthy).length;
  const extras = [];
  if (healthy > 0) extras.push(`🟢 ${plural(healthy, "healthy lead", "healthy leads")} (<${config.healthyLeadAgeDays}d)`);
  if (aging > 0) extras.push(`🟡 ${plural(aging, "aging lead", "aging leads")} (${config.healthyLeadAgeDays}-${config.maxLeadAgeDays}d)`);
  return extras;
}

function contentKey(lead) {
  return String(`${lead.title || ""}\n${lead.content || ""}`)
    .replace(/[\u200b-\u200d\ufeff\u2060\u00ad]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 300);
}

// Refresh age fields, drop stale/undated leads, healthy first then score.
// Identical spam reposts (same text, different handles) collapse to the best one.
function selectFreshLeads(leads) {
  const now = Date.now();
  const sorted = leads
    .map((l) => withFreshness(l, now))
    .filter((l) => isActiveLead(l, now) && normalizeUrl(l.url) && scoreOf(l) >= config.discord.minScore)
    .sort((a, b) => (Number(b.isHealthy) - Number(a.isHealthy)) || (Number(b.warm) - Number(a.warm)) || (scoreOf(b) - scoreOf(a)));
  const seen = new Set();
  return sorted.filter((l) => {
    const key = contentKey(l);
    if (key && seen.has(key)) return false;
    if (key) seen.add(key);
    return true;
  });
}

function buildSummary(fresh, summary) {
  const reason = RUN_LABELS[summary.reason] || String(summary.reason || "run");
  const head = `🎯 **Lead hunt complete!** Sniffed out **${plural(fresh.length, "fresh lead", "fresh leads")}** from **${plural(summary.scraped, "post", "posts")}** across **${plural(summary.subreddits.length, "subreddit", "subreddits")}** · _${reason}_`;
  const top = fresh.filter((l) => l.grade === "A").length;
  const hot = fresh.filter((l) => l.warm).length;
  const extras = freshnessCounts(fresh);
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

// 429 retry_after (seconds or ms), capped at 30s. Null when no hint.
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

// Send payloads independently; on 429 wait once, then give up.
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
  // Dedupe by normalized URL against previously notified and this run.
  const notified = new Set((await readJson(config.notifiedFile, [])).map(normalizeUrl).filter(Boolean));
  const seenThisRun = new Set();
  const fresh = selectFreshLeads(leads)
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
  // Only delivered batches count as notified; batch n is results[n + 1].
  const sentLeads = batches.filter((_, n) => results[n + 1]).flat();
  if (sentLeads.length > 0) {
    for (const l of sentLeads) notified.add(normalizeUrl(l.url));
    await writeJson(config.notifiedFile, [...notified].slice(-5000));
  }
  console.log(`💬 Notified Discord: ${sentLeads.length}/${fresh.length} lead(s).`);
  return { sent: sentLeads.length };
}

function buildXSummary(fresh, summary) {
  const reason = RUN_LABELS[summary.reason] || String(summary.reason || "run");
  const head = `𝕏 **X hunt complete!** Sniffed out **${plural(fresh.length, "fresh lead", "fresh leads")}** from **${plural(summary.scraped, "post", "posts")}** across **${plural(summary.queries.length, "query", "queries")}** · _${reason}_`;
  const top = fresh.filter((l) => l.grade === "A").length;
  const hot = fresh.filter((l) => l.warm).length;
  const extras = freshnessCounts(fresh);
  if (top > 0) extras.push(`🔥 ${plural(top, "A-grade", "A-grade")}`);
  if (hot > 0) extras.push(`💰 ${plural(hot, "red-hot buyer", "red-hot buyers")}`);
  return extras.length > 0 ? `${head}\n${extras.join(" · ")}` : head;
}

// Same as notifyLeads, with the separate x_notified file.
async function notifyXLeads(leads, summary) {
  if (!isConfigured()) {
    console.log("💬 Discord not configured, skipping X notifications.");
    return { sent: 0, skipped: "not-configured" };
  }
  const notifiedFile = (config.x && config.x.notifiedFile) || "x_notified.json";
  const notified = new Set((await readJson(notifiedFile, [])).map(normalizeUrl).filter(Boolean));
  const seenThisRun = new Set();
  const fresh = selectFreshLeads(leads)
    .filter((l) => {
      const key = normalizeUrl(l.url);
      if (notified.has(key) || seenThisRun.has(key)) return false;
      seenThisRun.add(key);
      return true;
    })
    .slice(0, config.discord.maxLeads);
  if (fresh.length === 0) {
    console.log("💬 No new X leads to notify.");
    return { sent: 0 };
  }
  const batches = [];
  for (let i = 0; i < fresh.length; i += 5) batches.push(fresh.slice(i, i + 5));
  const payloads = [
    { content: buildXSummary(fresh, summary) },
    ...batches.map((group) => ({ embeds: group.map(leadToEmbed) })),
  ];
  const results = await sendPayloads(payloads);
  const sentLeads = batches.filter((_, n) => results[n + 1]).flat();
  if (sentLeads.length > 0) {
    for (const l of sentLeads) notified.add(normalizeUrl(l.url));
    await writeJson(notifiedFile, [...notified].slice(-5000));
  }
  console.log(`💬 Notified Discord (X): ${sentLeads.length}/${fresh.length} lead(s).`);
  return { sent: sentLeads.length };
}

function buildLinkedInSummary(fresh, summary) {
  const reason = RUN_LABELS[summary.reason] || String(summary.reason || "run");
  const head = `💼 **LinkedIn hunt complete!** Sniffed out **${plural(fresh.length, "fresh lead", "fresh leads")}** from **${plural(summary.scraped, "post", "posts")}** across **${plural(summary.queries.length, "query", "queries")}** · _${reason}_`;
  const top = fresh.filter((l) => l.grade === "A").length;
  const hot = fresh.filter((l) => l.warm).length;
  const extras = freshnessCounts(fresh);
  if (top > 0) extras.push(`🔥 ${plural(top, "A-grade", "A-grade")}`);
  if (hot > 0) extras.push(`💰 ${plural(hot, "red-hot buyer", "red-hot buyers")}`);
  return extras.length > 0 ? `${head}\n${extras.join(" · ")}` : head;
}

// Same as notifyLeads, with the separate linkedin_notified file.
async function notifyLinkedInLeads(leads, summary) {
  if (!isConfigured()) {
    console.log("💬 Discord not configured, skipping LinkedIn notifications.");
    return { sent: 0, skipped: "not-configured" };
  }
  const notifiedFile = (config.linkedin && config.linkedin.notifiedFile) || "linkedin_notified.json";
  const notified = new Set((await readJson(notifiedFile, [])).map(normalizeUrl).filter(Boolean));
  const seenThisRun = new Set();
  const fresh = selectFreshLeads(leads)
    .filter((l) => {
      const key = normalizeUrl(l.url);
      if (notified.has(key) || seenThisRun.has(key)) return false;
      seenThisRun.add(key);
      return true;
    })
    .slice(0, config.discord.maxLeads);
  if (fresh.length === 0) {
    console.log("💬 No new LinkedIn leads to notify.");
    return { sent: 0 };
  }
  const batches = [];
  for (let i = 0; i < fresh.length; i += 5) batches.push(fresh.slice(i, i + 5));
  const payloads = [
    { content: buildLinkedInSummary(fresh, summary) },
    ...batches.map((group) => ({ embeds: group.map(leadToEmbed) })),
  ];
  const results = await sendPayloads(payloads);
  const sentLeads = batches.filter((_, n) => results[n + 1]).flat();
  if (sentLeads.length > 0) {
    for (const l of sentLeads) notified.add(normalizeUrl(l.url));
    await writeJson(notifiedFile, [...notified].slice(-5000));
  }
  console.log(`💬 Notified Discord (LinkedIn): ${sentLeads.length}/${fresh.length} lead(s).`);
  return { sent: sentLeads.length };
}

function buildUpworkSummary(fresh, summary) {
  const reason = RUN_LABELS[summary.reason] || String(summary.reason || "run");
  const head = `🧑‍💻 **Upwork hunt complete!** Sniffed out **${plural(fresh.length, "fresh lead", "fresh leads")}** from **${plural(summary.scraped, "job", "jobs")}** across **${plural(summary.queries.length, "query", "queries")}** · _${reason}_`;
  const top = fresh.filter((l) => l.grade === "A").length;
  const hot = fresh.filter((l) => l.warm).length;
  const extras = freshnessCounts(fresh);
  if (top > 0) extras.push(`🔥 ${plural(top, "A-grade", "A-grade")}`);
  if (hot > 0) extras.push(`💰 ${plural(hot, "red-hot buyer", "red-hot buyers")}`);
  return extras.length > 0 ? `${head}\n${extras.join(" · ")}` : head;
}

async function notifyUpworkLeads(leads, summary) {
  if (!isConfigured()) {
    console.log("💬 Discord not configured, skipping Upwork notifications.");
    return { sent: 0, skipped: "not-configured" };
  }
  const notifiedFile = (config.upwork && config.upwork.notifiedFile) || "upwork_notified.json";
  const notified = new Set((await readJson(notifiedFile, [])).map(normalizeUrl).filter(Boolean));
  const seenThisRun = new Set();
  const fresh = selectFreshLeads(leads)
    .filter((l) => {
      const key = normalizeUrl(l.url);
      if (notified.has(key) || seenThisRun.has(key)) return false;
      seenThisRun.add(key);
      return true;
    })
    .slice(0, config.discord.maxLeads);
  if (fresh.length === 0) {
    console.log("💬 No new Upwork leads to notify.");
    return { sent: 0 };
  }
  const batches = [];
  for (let i = 0; i < fresh.length; i += 5) batches.push(fresh.slice(i, i + 5));
  const payloads = [
    { content: buildUpworkSummary(fresh, summary) },
    ...batches.map((group) => ({ embeds: group.map(leadToEmbed) })),
  ];
  const results = await sendPayloads(payloads);
  const sentLeads = batches.filter((_, n) => results[n + 1]).flat();
  if (sentLeads.length > 0) {
    for (const l of sentLeads) notified.add(normalizeUrl(l.url));
    await writeJson(notifiedFile, [...notified].slice(-5000));
  }
  console.log(`💬 Notified Discord (Upwork): ${sentLeads.length}/${fresh.length} lead(s).`);
  return { sent: sentLeads.length };
}

module.exports = { isConfigured, leadToEmbed, notifyLeads, notifyXLeads, notifyLinkedInLeads, notifyUpworkLeads, buildSummary, buildXSummary, buildLinkedInSummary, buildUpworkSummary, fitPayload, LIMITS, selectFreshLeads };
