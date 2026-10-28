"use strict";

const path = require("path");
const { spawn } = require("child_process");
const { Agent, tool, run } = require("@openai/agents");
const { z } = require("zod");
const { prisma } = require("./prisma");
const { getOpenAI, model } = require("./openai");
const { rewriteSearchKeywords } = require("../services/queryRewriter");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

function summarizeLead(l) {
  return {
    id: l.id,
    name: l.name ?? l.username,
    username: l.username,
    platform: l.platform,
    title: l.title,
    postContent: (l.postContent || "").slice(0, 400),
    postUrl: l.postUrl,
    profileUrl: l.profileUrl,
    discoveredAt: l.discoveredAt,
    leadScore: l.leadScore,
    status: l.status,
    isSaved: l.isSaved,
    capabilities: l.capabilities,
    clientLocation: l.clientLocation,
    intentType: l.intentType,
  };
}

const searchLeads = tool({
  name: "search_leads",
  description: "Search stored leads in PostgreSQL with natural-language filters.",
  parameters: z.object({
    q: z.string().optional(),
    platform: z.string().optional(),
    status: z.string().optional(),
    saved: z.boolean().optional(),
    contacted: z.boolean().optional(),
    minScore: z.number().int().optional(),
    limit: z.number().int().min(1).max(50).optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
  }),
  execute: async (params) => {
    const where = {};
    if (params.platform) where.platform = params.platform.toLowerCase();
    if (params.status) where.status = params.status;
    if (params.saved === true) where.isSaved = true;
    if (params.saved === false) where.isSaved = false;
    if (params.contacted === true) where.status = { in: ["contacted", "replied", "interested"] };
    if (params.contacted === false) where.status = { in: ["new", "saved"] };
    if (params.minScore) where.leadScore = { gte: params.minScore };
    if (params.dateFrom || params.dateTo) {
      where.discoveredAt = {};
      if (params.dateFrom) where.discoveredAt.gte = new Date(params.dateFrom);
      if (params.dateTo) where.discoveredAt.lte = new Date(params.dateTo);
    }
    if (params.q) {
      where.OR = [
        { title: { contains: params.q, mode: "insensitive" } },
        { postContent: { contains: params.q, mode: "insensitive" } },
        { username: { contains: params.q, mode: "insensitive" } },
        { name: { contains: params.q, mode: "insensitive" } },
        { capabilities: { has: params.q } },
      ];
    }
    const items = await prisma.lead.findMany({ where, orderBy: { discoveredAt: "desc" }, take: params.limit ?? 20 });
    return JSON.stringify({ count: items.length, leads: items.map(summarizeLead) });
  },
});

const getLeadDetails = tool({
  name: "get_lead_details",
  description: "Get full details, notes/activity and outreach history for one lead by id or postUrl.",
  parameters: z.object({ leadId: z.string().optional(), postUrl: z.string().optional() }),
  execute: async (params) => {
    const lead = params.leadId
      ? await prisma.lead.findUnique({ where: { id: params.leadId }, include: { activities: { orderBy: { createdAt: "desc" } }, outreach: { orderBy: { createdAt: "desc" } } } })
      : params.postUrl
        ? await prisma.lead.findUnique({ where: { postUrl: params.postUrl }, include: { activities: { orderBy: { createdAt: "desc" } }, outreach: { orderBy: { createdAt: "desc" } } } })
        : null;
    if (!lead) return JSON.stringify({ error: "lead not found" });
    return JSON.stringify(lead);
  },
});

const getLeadStatistics = tool({
  name: "get_lead_statistics",
  description: "Return aggregate lead metrics from PostgreSQL.",
  parameters: z.object({}),
  execute: async () => {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [total, today, week, uncontacted, saved, interested, replied] = await Promise.all([
      prisma.lead.count(),
      prisma.lead.count({ where: { discoveredAt: { gte: startToday } } }),
      prisma.lead.count({ where: { discoveredAt: { gte: weekAgo } } }),
      prisma.lead.count({ where: { status: { in: ["new", "saved"] } } }),
      prisma.lead.count({ where: { isSaved: true } }),
      prisma.lead.count({ where: { status: "interested" } }),
      prisma.lead.count({ where: { status: "replied" } }),
    ]);
    const byPlatform = await prisma.lead.groupBy({ by: ["platform"], _count: { _all: true } });
    const byStatus = await prisma.lead.groupBy({ by: ["status"], _count: { _all: true } });
    return JSON.stringify({ total, today, week, uncontacted, saved, interested, replied, byPlatform: byPlatform.map((r) => ({ platform: r.platform, count: r._count._all })), byStatus: byStatus.map((r) => ({ status: r.status, count: r._count._all })) });
  },
});

const updateLeadStatus = tool({
  name: "update_lead_status",
  description: "Update a lead status.",
  parameters: z.object({ leadId: z.string(), status: z.string() }),
  execute: async ({ leadId, status }) => {
    const lead = await prisma.lead.update({ where: { id: leadId }, data: { status } });
    await prisma.leadActivity.create({ data: { leadId, activityType: "status_change", description: `Status changed to ${status}` } });
    return JSON.stringify({ ok: true, id: lead.id, status: lead.status });
  },
});

const saveLeadTool = tool({
  name: "save_lead",
  description: "Mark or unmark a lead as saved.",
  parameters: z.object({ leadId: z.string(), saved: z.boolean().optional() }),
  execute: async ({ leadId, saved }) => {
    const value = saved ?? true;
    const lead = await prisma.lead.update({ where: { id: leadId }, data: { isSaved: value } });
    await prisma.leadActivity.create({ data: { leadId, activityType: value ? "saved" : "unsaved", description: value ? "Lead saved" : "Lead unsaved" } });
    return JSON.stringify({ ok: true, id: lead.id, isSaved: lead.isSaved });
  },
});

const addLeadNote = tool({
  name: "add_lead_note",
  description: "Add a note/activity entry to a lead.",
  parameters: z.object({ leadId: z.string(), note: z.string() }),
  execute: async ({ leadId, note }) => {
    const activity = await prisma.leadActivity.create({ data: { leadId, activityType: "note", description: note } });
    return JSON.stringify({ ok: true, activityId: activity.id });
  },
});

const draftLeadReply = tool({
  name: "draft_lead_reply",
  description: "Generate a personalized outreach reply for a lead and store as a draft (not sent).",
  parameters: z.object({ leadId: z.string(), tone: z.string().optional() }),
  execute: async ({ leadId, tone }) => {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) return JSON.stringify({ error: "lead not found" });
    const resp = await getOpenAI().chat.completions.create({
      model,
      messages: [{ role: "user", content: `Draft a concise, personalized, professional reply to this potential client lead. Tone: ${tone || "professional and helpful"}.\n\nPlatform: ${lead.platform}\nName/Username: ${lead.username ?? lead.name}\nTitle: ${lead.title}\nPost: ${lead.postContent}\nCapabilities matched: ${(lead.capabilities || []).join(", ")}\nBudget signals: ${lead.budget || "none"}\n\nReturn only the draft message body.` }],
      temperature: 0.7,
      max_tokens: 400,
    });
    const draft = resp.choices[0]?.message?.content?.trim() || "";
    const outreach = await prisma.outreach.create({ data: { leadId, platform: lead.platform, messageContent: draft, direction: "outbound", status: "draft" } });
    await prisma.leadActivity.create({ data: { leadId, activityType: "draft", description: "AI reply draft generated" } });
    return JSON.stringify({ ok: true, draft, outreachId: outreach.id });
  },
});

const rewriteSearchQuery = tool({
  name: "rewrite_search_query",
  description: "Convert a natural-language topic into 4-6 complete search phrases for the scraper. Never returns split single generic words.",
  parameters: z.object({
    query: z.string(),
    sources: z.array(z.enum(["reddit", "x", "linkedin", "upwork"])).optional(),
  }),
  execute: async ({ query, sources }) => {
    const keywords = await rewriteSearchKeywords({ query, sources: sources || [] });
    return JSON.stringify({ keywords });
  },
});


const getOutreachHistory = tool({
  name: "get_outreach_history",
  description: "Get outreach messages and status history for a lead.",
  parameters: z.object({ leadId: z.string() }),
  execute: async ({ leadId }) => {
    const items = await prisma.outreach.findMany({ where: { leadId }, orderBy: { createdAt: "desc" } });
    const acts = await prisma.leadActivity.findMany({ where: { leadId }, orderBy: { createdAt: "desc" }, take: 30 });
    return JSON.stringify({ outreach: items, activity: acts });
  },
});

const extractLeadEmails = tool({
  name: "extract_lead_emails",
  description: "Extract email addresses from stored lead contact/post content and return a deduplicated list with source lead details.",
  parameters: z.object({
    q: z.string().optional(),
    platform: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  execute: async (params) => {
    const where = {};
    if (params.platform) where.platform = params.platform.toLowerCase();
    if (params.q) where.OR = [
      { title: { contains: params.q, mode: "insensitive" } },
      { postContent: { contains: params.q, mode: "insensitive" } },
      { username: { contains: params.q, mode: "insensitive" } },
    ];
    const leads = await prisma.lead.findMany({ where, orderBy: { discoveredAt: "desc" }, take: params.limit ?? 100 });
    const re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const seen = new Set();
    const emails = [];
    for (const lead of leads) {
      const text = `${lead.title || ""}\n${lead.postContent || ""}`;
      const matches = text.match(re) || [];
      for (const email of matches) {
        const key = email.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        emails.push({ email, leadId: lead.id, platform: lead.platform, name: lead.username || lead.name, postUrl: lead.postUrl, title: lead.title });
      }
    }
    return JSON.stringify({ count: emails.length, emails });
  },
});


const runScrapeJobTool = tool({
  name: "run_scrape_job",
  description:
    "Run the LeadGun scraper to collect new leads and ingest them into PostgreSQL. " +
    "Provide the user's request as `topic` (for example: 'remote software developer jobs'). " +
    "The tool converts the topic into optimized multi-word search phrases; never split a topic into single generic words.",
  parameters: z.object({
    all: z.boolean().optional(),
    sources: z.array(z.enum(["reddit", "x", "linkedin", "upwork"])).optional(),
    topic: z.string().optional().describe("Natural-language description of the leads to find."),
    keywords: z.array(z.string()).optional().describe("Optional complete search phrases. Single generic words are rejected."),
  }),
  execute: async (params, runContext) => {
    try {
      const requestedSources = Array.isArray(params.sources) ? params.sources : [];
      const useAll = params.all || requestedSources.length === 0;
      const sources = useAll ? ["reddit", "x", "linkedin", "upwork"] : [...new Set(requestedSources)];
      const topic = String(params.topic || (params.keywords || []).join(", ")).trim();
      const keywords = topic ? await rewriteSearchKeywords({ query: topic, sources }) : [];

      if (topic && keywords.length === 0) {
        return JSON.stringify({ ok: false, status: "failed", error: "Could not derive useful search keywords from that request." });
      }

      const conversationId = runContext?.context?.conversationId || null;
      const startedAt = new Date();
      let jobId = null;
      try {
        const job = await prisma.scrapeJob.create({
          data: {
            conversationId,
            status: "started",
            sources,
            keywords,
          },
        });
        jobId = job.id;
      } catch (err) {
        console.error("Could not create scrape job:", err.message);
        return JSON.stringify({ ok: false, status: "failed", error: "Could not create scrape job." });
      }

      async function updateJob(status, patch = {}) {
        try {
          await prisma.scrapeJob.update({ where: { id: jobId }, data: { status, ...patch } });
        } catch (err) {
          console.error(`Could not update scrape job ${jobId} to ${status}:`, err.message);
        }
      }

      await updateJob("scraping");

      const args = ["src/cli.js"];
      if (useAll) args.push("--all");
      else for (const source of sources) args.push(`--${source}`);
      if (keywords.length) args.push(`--keywords=${keywords.join(",")}`);

      const env = { ...process.env };
      if (keywords.length) env.SCRAPER_KEYWORDS = keywords.join(",");

      const activeChildren = global.__scrapeChildren = global.__scrapeChildren || new Set();
      const child = spawn(process.execPath, args, { cwd: PROJECT_ROOT, env });
      activeChildren.add(child);

      let output = "";
      let errorOutput = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try { child.kill("SIGTERM"); } catch {}
        updateJob("timeout", {
          output: (output + "\n" + errorOutput).slice(-4000),
          error: "Scrape timed out.",
        });
      }, 540000);

      child.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        output += text;
        process.stdout.write(text);
      });
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        errorOutput += text;
        process.stderr.write(text);
      });

      child.on("close", async (code) => {
        clearTimeout(timer);
        activeChildren.delete(child);
        if (timedOut) return;

        const succeeded = code === 0;
        if (succeeded) await updateJob("ai_processing");

        let leads = [];
        if (succeeded) {
          try {
            const where = { createdAt: { gte: startedAt } };
            if (sources.length === 1) where.platform = sources[0];
            leads = await prisma.lead.findMany({
              where,
              orderBy: { createdAt: "desc" },
              take: 30,
            });
          } catch (err) {
            console.error("Could not load scrape job leads:", err.message);
          }
        }

        await updateJob(succeeded ? "completed" : "failed", {
          output: (output + "\n" + errorOutput).slice(-4000),
          leadIds: leads.map((lead) => lead.id),
          error: succeeded ? null : "Scrape failed.",
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        activeChildren.delete(child);
        updateJob("failed", { error: String(err.message || err) });
      });

      return JSON.stringify({
        started: true,
        jobId,
        status: "scraping",
        keywords,
        message: "Scraping started. Results will appear here when the job finishes.",
      });
    } catch (err) {
      console.error("run_scrape_job exception:", err.message);
      return JSON.stringify({ ok: false, status: "failed", error: String(err.message || err) });
    }
  },
});

const leadGunAgent = new Agent({
  name: "LeadGun Assistant",
  instructions: [
    "You are LeadGun Assistant. Use tools for real data and never invent leads.",
    "When the user asks to find, scrape, refresh, collect or discover NEW leads, call run_scrape_job.",
    "Pass the user's request as `topic` and choose only the platforms the user named; omit sources to search all platforms.",
    "Never split a request into generic single words. Do not pass keywords like software, developer, remote or jobs separately.",
    "If you pass keywords yourself, every item must be a complete 2-6 word phrase such as 'remote software developer needed'.",
    "When the user asks about the leads already stored, call search_leads instead.",
    "When the user asks about a specific or the last lead, call get_lead_details using an ID from the system context list; use the last ID for 'last lead'.",
    "When the user requests a specific number of leads, set search_leads.limit to exactly that number.",
    "When the user asks for emails or contact addresses, call extract_lead_emails and list only the emails.",
    "After a tool returns leads, do not repeat lead details, titles, URLs or posts. Reply with at most one short sentence saying the count and that lead cards are shown below.",
    "Never return a numbered or bulleted lead list. Keep replies short.",
  ].join(" "),
  model,
  tools: [
    searchLeads,
    getLeadDetails,
    getLeadStatistics,
    updateLeadStatus,
    saveLeadTool,
    addLeadNote,
    draftLeadReply,
    getOutreachHistory,
    extractLeadEmails,
    rewriteSearchQuery,
    runScrapeJobTool,
  ],
});

module.exports = { leadGunAgent, run };
