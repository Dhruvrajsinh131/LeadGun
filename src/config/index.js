"use strict";

require("dotenv").config({ quiet: true });

const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "data");

const SUBREDDITS = [
  // Tier 1 — direct leads: hiring / freelance projects.
  { name: "forhire", priority: 1 },
  { name: "WebDeveloperJobs", priority: 1 },
  // Tier 2 — founder leads: MVPs, SaaS, product development.
  { name: "startups", priority: 2 },
  { name: "SaaS", priority: 2 },
  { name: "SideProject", priority: 2 },
  { name: "smallbusiness", priority: 2 },
  { name: "Entrepreneur", priority: 2 },
  // Tier 3 — specialized leads: Odoo, Next.js.
  { name: "Odoo", priority: 3 },
  { name: "nextjs", priority: 3 },
];

// Founder/problem subs get a score bonus (see matcher.js) — a founder
// asking for help is worth more than a generic technical question.
const FOUNDER_SUBS = ["startups", "saas", "sideproject", "smallbusiness", "entrepreneur"];

function parseSubredditOverride() {
  const raw = (process.env.SUBREDDITS || process.env.SUBREDDIT || "").trim();
  if (!raw) return null;
  // Supports optional tier suffix: "forhire:1,startups:2,Odoo:3".
  // No suffix means priority 1. Same tiers as the built-in list.
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, prio] = entry.split(":").map((x) => x.trim());
      const priority = parseInt(prio, 10);
      return { name, priority: Number.isFinite(priority) && priority > 0 ? priority : 1 };
    });
}

module.exports = {
  cdpUrl: process.env.CDP_URL || "http://127.0.0.1:9222",
  subreddits: parseSubredditOverride() || SUBREDDITS,
  founderSubs: FOUNDER_SUBS,
  subreddit: process.env.SUBREDDIT || "forhire",
  navigationTimeoutMs: 30000,
  maxPosts: parseInt(process.env.MAX_POSTS || "100", 10),
  maxScrolls: parseInt(process.env.MAX_SCROLLS || "10", 10),
  scrollDelayMs: parseInt(process.env.SCROLL_DELAY_MS || "1500", 10),
  verifyWaitMs: parseInt(process.env.VERIFY_WAIT_MS || "120000", 10),
  maxRecoveriesPerPage: parseInt(process.env.MAX_RECOVERIES_PER_PAGE || "3", 10),
  postRenderWaitMs: parseInt(process.env.POST_RENDER_WAIT_MS || "15000", 10),
  interPageDelayMs: parseInt(process.env.INTER_PAGE_DELAY_MS || "4000", 10),
  abortAfterEmptySubs: parseInt(process.env.ABORT_AFTER_EMPTY_SUBS || "3", 10),
  shuffleOrder: process.env.SHUFFLE_ORDER !== "false",
  subOrder: (process.env.SUB_ORDER || "tier").toLowerCase(),
  feedPath: (process.env.FEED_PATH || "").replace(/^\/+|\/+$/g, ""),
  cronSchedule: process.env.SCRAPE_CRON || "0 */3 * * *",
  runOnStart: process.env.SCRAPE_ON_START !== "false",
  port: parseInt(process.env.PORT || "3000", 10),
  dataDir: process.env.DATA_DIR || DATA_DIR,
  allPostsFile: "posts.json",
  matchedPostsFile: "matched.json",
  leadsFile: "leads.json",
  notifiedFile: "notified.json",
  discord: {
    enabled: process.env.DISCORD_ENABLED !== "false",
    botToken: (process.env.DISCORD_BOT_TOKEN || "").trim(),
    channelId: (process.env.DISCORD_CHANNEL_ID || "").trim(),
    minScore: parseInt(process.env.DISCORD_MIN_SCORE || process.env.MIN_LEAD_SCORE || "30", 10),
    maxLeads: parseInt(process.env.DISCORD_MAX_LEADS || "30", 10),
  },
  stateFile: "state.json",
  minLeadScore: parseInt(process.env.MIN_LEAD_SCORE || "30", 10),
  searchEnabled: process.env.SEARCH_ENABLED !== "false",
  searchSort: process.env.SEARCH_SORT || "new",
  searchScrolls: parseInt(process.env.SEARCH_SCROLLS || "4", 10),
  maxQueriesPerSub: parseInt(process.env.MAX_QUERIES_PER_SUB || "2", 10),
  searchQueries: [
    "looking for a developer",
    "need a developer",
    "hire a developer",
    "developer needed",
    "need someone to build",
    "looking for someone to build",
    "build my MVP",
    "need an MVP",
    "looking for a freelancer",
    "need a freelancer",
    "looking for a development agency",
    "need a development team",
    "technical cofounder",
    "AI developer",
    "AI agent developer",
    "React developer",
    "Next.js developer",
    "Odoo developer",
    "Odoo customization",
    "need help building",
  ],
  subredditQueries: {
    forhire: ["looking for a development agency", "need a development team", "how much would it cost to build", "recommend a developer", "need someone to take over", "looking for quotes"],
    WebDeveloperJobs: ["React developer", "Next.js developer", "Node.js developer", "full stack developer", "React freelancer", "Next.js project"],
    startups: ["need an MVP", "looking for technical cofounder", "build my SaaS", "how much does it cost to build", "need someone to build my idea"],
    SaaS: ["looking for SaaS developer", "need help with SaaS", "build my SaaS", "AI SaaS"],
    SideProject: ["build MVP", "MVP developer", "need someone to build", "turn my idea into"],
    smallbusiness: ["need help building", "need API integration", "AI automation", "need help scaling"],
    Entrepreneur: ["need a developer", "need business automation", "looking for technical cofounder"],
    Odoo: ["Odoo developer needed", "Odoo customization", "Odoo integration", "Odoo help", "Odoo migration", "need help with Odoo", "Odoo freelancer", "Odoo POS"],
    nextjs: ["Next.js developer needed", "Next.js freelancer", "React developer", "Next.js project"],
  },
  llm: {
    enabled: process.env.LLM_ENABLED !== "false",
    apiKey: process.env.LLM_API_KEY || "",
    baseUrl: (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    model: process.env.LLM_MODEL || "gpt-4o-mini",
    timeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || "30000", 10),
    maxCallsPerRun: parseInt(process.env.LLM_MAX_CALLS_PER_RUN || "30", 10),
  },
  directIntentPatterns: [
    /\[hiring\]/i,
    /\bhiring\b/i,
    /looking for.*\b(developer|dev|engineer|agency|team|freelancer|contractor|cofounder|partner)\b/i,
    /need.*\b(developer|dev|engineer|agency|team|freelancer|contractor|cofounder|partner)\b/i,
    /need an? (mvp|saas|website|app|prototype)\b/i,
    /\bmvp\b.*\b(built|build|finish|developer|need)\b/i,
    /finish.*\b(mvp|product|app|project)\b/i,
    /someone to (build|finish|fix|develop|create|make)\b/i,
    /can someone (build|fix|develop|create|make)\b/i,
    /help.*\b(developing|develop|building|build|scaling|scale|optimizing|optimize|migrating|migrate)\b/i,
    /agency needed/i,
    /need an agency/i,
    /looking for.*agency/i,
    /developer needed/i,
    /need.*developer/i,
    /looking for.*dev\b/i,
    /need.*\bdev\b/i,
    /website.*needed/i,
    /need.*website/i,
    /web dev.*needed/i,
    /looking for.*web/i,
    /looking for.*freelancer/i,
    /looking for.*contractor/i,
    /contract.*position/i,
    /full[\s-]?time.*dev/i,
    /technical (cofounder|co-founder|partner|team)/i,
    /pay(ing)? (someone|for|a developer)/i,
    /\bbudget\b.*\b(developer|dev|project|freelance)\b/i,
    // Combination / buying-intent phrasing (catches "need + developer",
    // "build + MVP" style posts where no single exact phrase matches).
    /how much.*(cost|charge).*(build|develop|make)/i,
    /(cost|price).*(build|develop).*(app|website|saas|mvp|software)/i,
    /recommend.*(developer|agency|freelancer|dev team|development company)/i,
    /(developer|dev|freelancer).*(quit|disappeared|ghosted|vanished)/i,
    /take over.*(project|codebase|app|website|development)/i,
    /(need|looking for).*(quote|estimate)/i,
    /developers? wanted/i,
    /who can build/i,
  ],
  indirectIntentPatterns: [
    /can't handle (traffic|load|scale)/i,
    /cannot handle (traffic|load|scale)/i,
    /\bslow\b.*\b(backend|api|server|app|saas|queries|query|database|postgres|website)\b/i,
    /\b(backend|api|server|app|saas|queries|query|database|postgres)\b.*\bslow\b/i,
    /taking \d+ seconds/i,
    /keep(s)? (crashing|failing|timing out)/i,
    /need to scale/i,
    /scaling (issues?|problems?|help)/i,
    /performance (issues?|problems?|help|optimization)/i,
    /optimiz(e|ing|ation).*\b(backend|node|postgres|database|queries|api)\b/i,
    /real[\s-]?time (collaboration|app|features?|sync)/i,
    /websocket.*(crash|fail|slow|help|scal)/i,
    /redis.*(scal|help|slow|pub\/sub|cluster)/i,
    /postgres.*(slow|help|performance|tun|optimiz)/i,
    /odoo.*(custom|difficult|help|integrat|migrat|module|need)/i,
    /connect odoo with/i,
    /odoo (with|and|to) (shopify|woocommerce|stripe|api)/i,
    /\braq\b.*\b(documents|knowledge|help|build)\b/i,
    /\brag\b over/i,
    /ai (chatbot|agent|automation|assistant|customer support)/i,
    /automate.*(workflow|business|support|process)/i,
    /llm.*(app|help|integration|build)/i,
    /langchain|openai.*(help|integration|developer|build)/i,
    /struggling with.*\b(backend|scale|database|odoo|ai|automation)\b/i,
    /too difficult/i,
    /any (recommendations|advice).*\b(developer|agency|freelancer)\b/i,
    /where (to|can).*\bfind\b.*\b(developer|freelancer|agency)\b/i,
    /how (do|to).*\b(hire|find|outsource)\b/i,
  ],
  budgetPatterns: [
    /\$\s?\d+/,
    /\b\d+\s?\/\s?hr\b/i,
    /\b(budget|paid|paying|compensation|rate|fixed[-\s]?price)\b/i,
    /\b(quote|estimate)\b/i,
    /\bhow much\b/i,
  ],
  excludePatterns: [
    /\b(crypto|forex|trading signals?|sports betting|essay writing|homework (help|done))\b/i,
    /free (course|ebook|trial|tool)\b/i,
  ],
  // Hard excludes: sellers and seekers, never buyers. These apply even
  // when hiring intent matches — a "[For Hire] I'm available" post quoting
  // "looking for projects" must not pass as a lead.
  hardExcludePatterns: [
    /\[for hire\]/i,
    /\bhire me\b/i,
    /i['’]m (currently )?available/i,
    /looking for (clients|work|gigs|projects|long[\s-]?term clients)\b/i,
    /check out my portfolio/i,
    /\b(interview process|my interview|coding assessment|technical interview)\b/i,
    /\bjobs (this week|roundup|digest)\b/i,
    /\b\d+\s?%\s?commission\b/i,
    /starting at [₹$]\s?\d/i,
    // DIYers who state they won't pay — never buyers.
    /instead of paying/i,
    /\bself[\s-]?maintain\b.*\binstead of\b/i,
    // Showcases fishing for feedback, not hiring.
    /looking for feedback/i,
    /\b(show|tell me what you think of|check out) (my|our) (project|app|saas|tool|repo)\b/i,
  ],
  capabilities: [
    { label: "react", category: "frontend", pattern: /\breact(\.?js)?\b/i },
    { label: "next.js", category: "frontend", pattern: /\bnext\.?js\b/i },
    { label: "typescript", category: "frontend", pattern: /\btypescript\b|\bts\b/i },
    { label: "javascript", category: "frontend", pattern: /\bjavascript\b|\bjs\b/i },
    { label: "node.js", category: "backend", pattern: /node(\.?js)?/i },
    { label: "go", category: "backend", pattern: /\bgolang\b|\bGo\b/ },
    { label: "python", category: "backend", pattern: /\bpython\b/i },
    { label: "api", category: "backend", pattern: /\b(rest|graphql|api|backend|microservice)\b/i },
    { label: "n8n", category: "automation", pattern: /\bn8n\b/i },
    { label: "websocket", category: "infra", pattern: /web[\s-]?socket/i },
    { label: "redis", category: "infra", pattern: /\bredis\b/i },
    { label: "postgresql", category: "infra", pattern: /\bpostgres(ql)?\b|\bneon\b|\bsupabase\b/i },
    { label: "scaling", category: "infra", pattern: /\bscal(e|ing|ability)\b|performance|optimiz/i },
    { label: "odoo", category: "odoo", pattern: /\bodoo\b/i },
    { label: "odoo-customization", category: "odoo", pattern: /odoo.*(custom|module|studio|inherit)/i },
    { label: "odoo-integration", category: "odoo", pattern: /odoo.*(integrat|api|shopify|woocommerce|stripe|migration|migrat)/i },
    { label: "odoo-pos", category: "odoo", pattern: /odoo.*pos|pos.*odoo/i },
    { label: "erp", category: "odoo", pattern: /\berp\b/i },
    { label: "pos", category: "odoo", pattern: /\bpos\b/i },
    { label: "ai-agent", category: "ai", pattern: /ai agents?|agentic|autonomous agent/i },
    // Generic AI mention: catches "AI engineer", "AI project" style posts
    // that name no specific stack. Less precise than rag/llm, but the LLM
    // layer filters out non-dev matches (e.g. video creators).
    { label: "ai", category: "ai", pattern: /\bai\b/i },
    { label: "rag", category: "ai", pattern: /\brag\b|retrieval.*generation|embeddings?|vector (db|database|search)/i },
    { label: "llm", category: "ai", pattern: /\bllm\b|openai|chatgpt|Muse|langchain|llama|mistral|gpt-?4|gemini/i },
    { label: "ai-automation", category: "ai", pattern: /ai (automation|chatbot|assistant|saas|application|integration)/i },
    { label: "saas", category: "product", pattern: /\bsaas\b/i },
    { label: "mvp", category: "product", pattern: /\bmvp\b|prototype|minimum viable/i },
    { label: "website", category: "product", pattern: /\bwebsite\b|web\s?site|landing page/i },
    { label: "web development", category: "product", pattern: /web\s?(dev|development|developer|agency)/i },
    // Generic role mention: catches "hiring a software developer" style
    // posts that name no stack. Same deal as generic "ai" — the LLM
    // rejects non-dev matches downstream.
    { label: "software development", category: "general", pattern: /\bsoftware\b|\bdevelopers?\b|\bdev\b|\bengineers?\b|\bengineering\b/i },
  ],
};
