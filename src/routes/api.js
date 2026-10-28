"use strict";

const { prisma } = require("../lib/prisma");
const { normalizeLead } = require("../lib/normalize");
const { rewriteSearchKeywords } = require("../services/queryRewriter");
const { getOpenAI, model } = require("../lib/openai");
const { freshnessFor } = require("../services/freshness");
const { spawn } = require("child_process");
const { listScrapers, setScraperEnabled } = require("../services/scraperSettings");
const path = require("path");
const conversationLeads = new Map();
const sseClients = [];

function authorizedIngest(req) {
  const secret = process.env.INGEST_SECRET;
  if (!secret) return true;
  const header = req.get("x-ingest-secret") || (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return header === secret;
}

function buildLeadWhere(qp) {
  let where = {};
  const platform = (qp.platform || "").trim();
  const status = (qp.status || "").trim();
  const archived = qp.archived;
  if (archived === "true") where.isArchived = true;
  else if (archived !== "all") where.isArchived = false;
  const saved = qp.saved;
  const contacted = qp.contacted;
  const minScore = parseInt(qp.minScore || "0", 10);
  const maxScore = parseInt(qp.maxScore || "0", 10);
  const dateFrom = qp.dateFrom;
  const dateTo = qp.dateTo;
  const q = (qp.q || "").trim();
  if (platform) where.platform = platform;
  if (status) where.status = status;
  if (saved === "true") where.isSaved = true;
  if (saved === "false") where.isSaved = false;
  if (contacted === "true") where.status = { in: ["contacted", "replied", "interested"] };
  if (contacted === "false") where.status = { in: ["new", "saved"] };
  if (minScore) where.leadScore = { ...(where.leadScore || {}), gte: minScore };
  if (maxScore) where.leadScore = { ...(where.leadScore || {}), lte: maxScore };
  if (dateFrom || dateTo) {
    where.discoveredAt = {};
    if (dateFrom) where.discoveredAt.gte = new Date(dateFrom);
    if (dateTo) where.discoveredAt.lte = new Date(dateTo);
  }
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { postContent: { contains: q, mode: "insensitive" } },
      { username: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { company: { contains: q, mode: "insensitive" } },
      { clientLocation: { contains: q, mode: "insensitive" } },
      { capabilities: { has: q } },
    ];
  }
  const freshness = (qp.freshness || "").trim().toLowerCase();
  if (freshness === "fresh") where.isHealthy = true;
  else if (freshness === "aging") where = { AND: [where, { isFresh: true }, { isHealthy: false }] };
  else if (freshness === "stale") where.isFresh = false;
  return where;
}

function register(app) {
  app.get("/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  app.get("/api/scrapers", async (req, res) => {
    try {
      res.json({ ok: true, scrapers: await listScrapers() });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) });
    }
  });

  app.patch("/api/scrapers/:id", async (req, res) => {
    const enabled = (req.body || {}).enabled;
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ ok: false, error: "enabled must be a boolean" });
    }
    try {
      const settings = await setScraperEnabled(req.params.id, enabled);
      if (!settings) return res.status(404).json({ ok: false, error: "unknown scraper" });
      res.json({ ok: true, scrapers: await listScrapers() });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) });
    }
  });

  app.post("/api/ingest/leads", async (req, res) => {
    if (!authorizedIngest(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
    const body = req.body || {};
    const rawLeads = Array.isArray(body.leads) ? body.leads : (Array.isArray(body) ? body : [body]);
    const result = { received: rawLeads.length, inserted: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
    for (const raw of rawLeads) {
      let normalized;
      try { normalized = normalizeLead(raw); } catch (err) { result.failed++; result.errors.push(String(err && err.message ? err.message : err).slice(0, 300)); continue; }
      if (!normalized.postUrl) { result.skipped++; continue; }
      try {
        const existing = await prisma.lead.findUnique({ where: { postUrl: normalized.postUrl } });
        await prisma.lead.upsert({
          where: { postUrl: normalized.postUrl },
          create: { ...normalized, discoveredAt: normalized.discoveredAt || new Date(), updatedAt: new Date() },
          update: {
            ...normalized,
            status: existing ? existing.status : normalized.status,
            isSaved: existing ? existing.isSaved : normalized.isSaved,
            isArchived: existing ? existing.isArchived : normalized.isArchived,
            updatedAt: new Date(),
          },
        });
        if (existing) result.updated++; else {
          result.inserted++;
          const lead = await prisma.lead.findUnique({ where: { postUrl: normalized.postUrl } });
          if (lead) await prisma.leadActivity.create({ data: { leadId: lead.id, activityType: "discovered", description: `Discovered from ${normalized.platform}${normalized.source ? ` (${normalized.source})` : ""}` } });
        }
      } catch (err) {
        result.failed++;
        result.errors.push(String(err && err.message ? err.message : err).slice(0, 300));
        console.error("ingest error:", err && err.message ? err.message : err);
      }
    }
    res.json({ ok: true, ...result });
  });

  app.get("/api/leads", async (req, res) => {
    try {
      const qp = req.query || {};
      const page = Math.max(1, parseInt(qp.page || "1", 10));
      const pageSize = Math.min(100, Math.max(1, parseInt(qp.pageSize || "24", 10)));
      const sort = qp.sort || "discoveredAt:desc";
      const where = buildLeadWhere(qp);
      const [sortField, sortDir] = String(sort).split(":");
      const allowed = ["discoveredAt", "postedAt", "leadScore", "createdAt", "updatedAt", "title"];
      const field = allowed.includes(sortField) ? sortField : "discoveredAt";
      const orderBy = {}; orderBy[field] = sortDir === "asc" ? "asc" : "desc";
      const [found, total] = await Promise.all([
        prisma.lead.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
        prisma.lead.count({ where }),
      ]);
      const items = found.map((l) => {
        const f = freshnessFor(l, Date.now());
        return { ...l, ageMs: f.ageMs, ageDays: f.ageDays, ageLabel: f.ageLabel, isFresh: f.isFresh, isHealthy: f.isHealthy, freshness: f.freshness };
      });
      res.json({ ok: true, total, page, pageSize, items });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err && err.message ? err.message : err) });
    }
  });

  app.get("/api/leads/:id", async (req, res) => {
    const lead = await prisma.lead.findUnique({ where: { id: req.params.id }, include: { activities: { orderBy: { createdAt: "desc" } }, outreach: { orderBy: { createdAt: "desc" } } } });
    if (!lead) return res.status(404).json({ ok: false, error: "not found" });
    res.json({ ok: true, lead });
  });

  app.patch("/api/leads/:id", async (req, res) => {
    const id = req.params.id;
    const body = req.body || {};
    const data = {};
    if (typeof body.status === "string") data.status = body.status;
    if (typeof body.isSaved === "boolean") data.isSaved = body.isSaved;
    if (typeof body.isArchived === "boolean") data.isArchived = body.isArchived;
    if (typeof body.notes === "string" && body.notes.trim()) {
      await prisma.leadActivity.create({ data: { leadId: id, activityType: "note", description: body.notes.trim() } });
    }
    if (Object.keys(data).length > 0) {
      await prisma.lead.update({ where: { id }, data });
      if (data.status) await prisma.leadActivity.create({ data: { leadId: id, activityType: "status_change", description: `Status changed to ${data.status}` } });
    }
    const lead = await prisma.lead.findUnique({ where: { id }, include: { activities: { orderBy: { createdAt: "desc" } }, outreach: { orderBy: { createdAt: "desc" } } } });
    res.json({ ok: true, lead });
  });

  app.get("/api/leads/:id/outreach", async (req, res) => {
    const items = await prisma.outreach.findMany({ where: { leadId: req.params.id }, orderBy: { createdAt: "desc" } });
    res.json({ ok: true, items });
  });

  app.post("/api/leads/:id/outreach", async (req, res) => {
    const id = req.params.id;
    const body = req.body || {};
    const lead = await prisma.lead.findUnique({ where: { id } });
    if (!lead) return res.status(404).json({ ok: false, error: "not found" });
    const message = String(body.messageContent ?? body.message ?? "").trim();
    if (!message) return res.status(400).json({ ok: false, error: "message required" });
    const outreach = await prisma.outreach.create({
      data: {
        leadId: id,
        platform: String(body.platform ?? lead.platform),
        messageContent: message,
        direction: String(body.direction ?? "outbound"),
        status: String(body.status ?? "draft"),
        sentAt: body.sentAt ? new Date(body.sentAt) : null,
        repliedAt: body.repliedAt ? new Date(body.repliedAt) : null,
      },
    });
    await prisma.leadActivity.create({ data: { leadId: id, activityType: body.direction === "inbound" ? "reply_received" : "outreach", description: `${String(body.direction ?? "outbound")} ${body.status ?? "draft"}: ${message.slice(0, 160)}` } });
    res.json({ ok: true, outreach });
  });

  app.get("/api/stats", async (req, res) => {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [total, today, week, uncontacted, saved, replied, interested, outreachCount] = await Promise.all([
      prisma.lead.count(),
      prisma.lead.count({ where: { discoveredAt: { gte: startToday } } }),
      prisma.lead.count({ where: { discoveredAt: { gte: weekAgo } } }),
      prisma.lead.count({ where: { status: { in: ["new", "saved"] } } }),
      prisma.lead.count({ where: { isSaved: true } }),
      prisma.lead.count({ where: { status: "replied" } }),
      prisma.lead.count({ where: { status: "interested" } }),
      prisma.outreach.count(),
    ]);
    const byPlatform = await prisma.lead.groupBy({ by: ["platform"], _count: { _all: true } });
    const byStatus = await prisma.lead.groupBy({ by: ["status"], _count: { _all: true } });
    const latest = await prisma.lead.findMany({ orderBy: { discoveredAt: "desc" }, take: 10 });
    const activity = await prisma.leadActivity.findMany({ orderBy: { createdAt: "desc" }, take: 15, include: { lead: { select: { platform: true, username: true, title: true } } } });
    res.json({ ok: true, metrics: { total, today, week, uncontacted, saved, replied, interested, outreachCount }, byPlatform: byPlatform.map((r) => ({ platform: r.platform, count: r._count._all })), byStatus: byStatus.map((r) => ({ status: r.status, count: r._count._all })), latest, activity });
  });

  app.post("/api/ai/draft-reply", async (req, res) => {
    const leadId = String((req.body || {}).leadId || "");
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return res.status(404).json({ ok: false, error: "lead not found" });
    const resp = await getOpenAI().chat.completions.create({
      model,
      messages: [{ role: "user", content: `Draft a personalized professional reply to this lead. Lead: ${lead.platform} ${lead.username}. Title: ${lead.title}. Post: ${(lead.postContent || "").slice(0, 800)}. Capabilities: ${(lead.capabilities || []).join(", ")}. Return only draft message.` }],
      max_tokens: 400,
    });
    const draft = resp.choices[0]?.message?.content?.trim() || "";
    await prisma.outreach.create({ data: { leadId, platform: lead.platform, messageContent: draft, direction: "outbound", status: "draft" } });
    await prisma.leadActivity.create({ data: { leadId, activityType: "draft", description: "AI reply draft generated" } });
    res.json({ ok: true, draft });
  });

  app.post("/api/scrape", async (req, res) => {
    const body = req.body || {};
    const root = process.env.LEADGUN_ROOT || path.resolve(__dirname, "..", "..");
    const sources = Array.isArray(body.sources) ? body.sources.map((s) => String(s).toLowerCase()) : [];
    const topic = String(body.topic || (Array.isArray(body.keywords) ? body.keywords.join(", ") : "")).trim();
    const keywords = topic ? await rewriteSearchKeywords({ query: topic, sources }) : [];

    const args = ["src/cli.js"];
    if (!sources.length || body.all) args.push("--all");
    else for (const source of sources) args.push(`--${source}`);
    if (keywords.length) args.push(`--keywords=${keywords.join(",")}`);

    const env = { ...process.env };
    if (keywords.length) env.SCRAPER_KEYWORDS = keywords.join(",");

    const child = spawn(process.execPath, args, { cwd: root, env });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch {}
      res.status(504).json({ ok: false, error: "scrape timed out", output: (out + "\n" + err).slice(-4000) });
    }, 540000);
    child.stdout.on("data", (chunk) => { const text = chunk.toString(); out += text; process.stdout.write(text); });
    child.stderr.on("data", (chunk) => { const text = chunk.toString(); err += text; process.stderr.write(text); });
    child.on("close", (code) => {
      clearTimeout(timer);
      res.json({ ok: code === 0, exitCode: code, keywords, output: (out + "\n" + err).slice(-8000) });
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      res.status(500).json({ ok: false, error: String(error.message) });
    });
  });

  app.get("/api/chat", async (req, res) => {
    const userId = process.env.APP_USER_ID || "default-user";
    await prisma.user.upsert({ where: { id: userId }, create: { id: userId, name: "LeadGun User" }, update: {} });
    const conversations = await prisma.chatConversation.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, include: { messages: { take: 1, orderBy: { createdAt: "desc" } } } });
    res.json({ ok: true, conversations });
  });

  app.post("/api/chat", async (req, res) => {
    const body = req.body || {};
    const message = String(body.message || "").trim();
    if (!message) return res.status(400).send("message required");
    const userId = process.env.APP_USER_ID || "default-user";
    await prisma.user.upsert({ where: { id: userId }, create: { id: userId, name: "LeadGun User" }, update: {} });
    let conversationId = body.conversationId;
    if (!conversationId) {
      const conv = await prisma.chatConversation.create({ data: { userId, title: message.slice(0, 60) } });
      conversationId = conv.id;
    } else {
      const exists = await prisma.chatConversation.findUnique({ where: { id: conversationId } });
      if (!exists) {
        const conv = await prisma.chatConversation.create({ data: { userId, title: message.slice(0, 60) } });
        conversationId = conv.id;
      }
    }
    await prisma.chatMessage.create({ data: { conversationId, role: "user", content: message } });
    const prior = await prisma.chatMessage.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" } });
    const prompt = prior.map((m) => (m.role === "assistant" ? "Assistant" : "User") + ": " + m.content).join("\n\n");
    const recentIds = conversationLeads.get(conversationId) || [];
    const leadContext = recentIds.length ? `\n\n[System context: recently retrieved lead IDs (most recent last): ${recentIds.join(", ")}]` : "";
    const fullPrompt = prompt + leadContext;

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("X-Conversation-Id", conversationId);
    res.setHeader("Cache-Control", "no-cache");

    const hb = setInterval(() => {
      if (!res.writableEnded) res.write(". ");
    }, 10000);
    const agentModule = require("../lib/agent");
    const leadGunAgent = agentModule.leadGunAgent;
    const runFn = agentModule.run;

    let finalText = "";
    try {
      const result = await runFn(leadGunAgent, fullPrompt, { stream: true, context: { conversationId } });
      const textStream = result.toTextStream({ compatibleWithNodeStreams: true });
      for await (const chunk of textStream) {
        const text = typeof chunk === "string" ? chunk : String(chunk);
        finalText += text;
        res.write(text);
      }
      await result.completed;
      const output = result.finalOutput || finalText;
      const ids = [];
      try {
        for (const item of (result.newItems || [])) {
          if (item.type !== "tool_call_output_item") continue;
          let raw = item.rawItem && item.rawItem.output;
          let text = "";
          if (raw && typeof raw === "object") text = raw.text || (typeof raw.content === "string" ? raw.content : JSON.stringify(raw));
          else if (typeof raw === "string") text = raw;
          const start = text.indexOf("{");
          const end = text.lastIndexOf("}");
          if (start !== -1 && end !== -1) {
            try {
              const parsed = JSON.parse(text.slice(start, end + 1));
              if (Array.isArray(parsed.leads)) {
                for (const l of parsed.leads) if (l && l.id) ids.push(l.id);
              }
            } catch {}
          }
        }
      } catch {}
      if (ids.length) conversationLeads.set(conversationId, [...new Set(ids)]);
      await prisma.chatMessage.create({ data: { conversationId, role: "assistant", content: output } });
      await prisma.chatConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
    } catch (err) {
      res.write("\n[error: " + String(err && err.message ? err.message : err) + "]");
    } finally {
      clearInterval(hb);
      res.end();
    }
  });



  app.get("/api/chat/leads", async (req, res) => {
    const cid = String(req.query.conversationId || "");
    const ids = conversationLeads.get(cid) || [];
    if (!ids.length) return res.json({ ok: true, leads: [] });
    const leads = await prisma.lead.findMany({ where: { id: { in: ids } } });
    const byId = new Map(leads.map((l) => [l.id, l]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean).map((l) => {
      const f = freshnessFor(l, Date.now());
      return { ...l, ageMs: f.ageMs, ageDays: f.ageDays, ageLabel: f.ageLabel, isFresh: f.isFresh, isHealthy: f.isHealthy, freshness: f.freshness };
    });
    res.json({ ok: true, leads: ordered });
  });


  app.get("/api/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders && res.flushHeaders();
    const client = { id: Date.now() + Math.random(), res };
    sseClients.push(client);
    res.write(`event: connected\ndata: {"ok":true}\n\n`);
    req.on("close", () => {
      const idx = sseClients.indexOf(client);
      if (idx !== -1) sseClients.splice(idx, 1);
    });
  });

  function broadcastScrapeDone(payload) {
    const data = `event: scrape:done\ndata: ${JSON.stringify(payload || {})}\n\n`;
    for (const client of [...sseClients]) {
      try { client.res.write(data); } catch {}
    }
  }

  app.post("/api/webhooks/scrape-complete", async (req, res) => {
    if (!authorizedIngest(req)) return res.status(401).json({ ok: false, error: "unauthorized" });
    const body = req.body || {};
    const payload = { ok: true, at: new Date().toISOString(), ...body };
    broadcastScrapeDone(payload);
    res.json({ ok: true });
  });


  app.get("/api/chat/:id", async (req, res) => {
    const conversation = await prisma.chatConversation.findUnique({
      where: { id: req.params.id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!conversation) return res.status(404).json({ ok: false, error: "not found" });
    res.json({ ok: true, conversation });
  });


  app.get("/api/scrape/jobs", async (req, res) => {
    const where = {};
    if (req.query.conversationId) where.conversationId = String(req.query.conversationId);
    const jobs = await prisma.scrapeJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        conversationId: true,
        status: true,
        sources: true,
        keywords: true,
        leadIds: true,
        error: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    res.json({ ok: true, jobs });
  });

  app.get("/api/scrape/jobs/:id", async (req, res) => {
    const job = await prisma.scrapeJob.findUnique({ where: { id: req.params.id } });
    if (!job) return res.status(404).json({ ok: false, error: "not found" });
    let leads = [];
    if (Array.isArray(job.leadIds) && job.leadIds.length) {
      const found = await prisma.lead.findMany({ where: { id: { in: job.leadIds } } });
      const byId = new Map(found.map((l) => [l.id, l]));
      leads = job.leadIds.map((id) => byId.get(id)).filter(Boolean).map((l) => {
        const f = freshnessFor(l, Date.now());
        return { ...l, ageMs: f.ageMs, ageDays: f.ageDays, ageLabel: f.ageLabel, isFresh: f.isFresh, isHealthy: f.isHealthy, freshness: f.freshness };
      });
    }
    res.json({ ok: true, job, leads });
  });

}

module.exports = { register };
