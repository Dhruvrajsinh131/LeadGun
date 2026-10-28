const { normalizePlatform, asStringArray, toDate, normalizeUrl, externalIdFor } = require("./platform");

function sanitizeString(s) {
  return String(s)
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}
function sanitizeValue(value) {
  if (value instanceof Date) return value;
  if (typeof value === "string") return sanitizeString(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) out[k] = sanitizeValue(value[k]);
    return out;
  }
  return value;
}

function normalizeLead(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const subreddit = typeof input.subreddit === "string" ? input.subreddit : "";
  const platformHint = input.platform ??
    (subreddit === "x" ? "x" : subreddit === "linkedin" ? "linkedin" : subreddit === "upwork" ? "upwork" : "reddit");
  const platform = normalizePlatform(platformHint);
  const postUrl = normalizeUrl(input.postUrl ?? input.url);

  const username = input.username ?? input.handle ?? input.author ?? null;
  const name = input.name ?? (username ? String(username) : (typeof input.title === "string" ? input.title.slice(0, 120) : null));

  const leadScore = typeof input.leadScore === "number"
    ? input.leadScore
    : typeof input.score === "number"
      ? input.score
      : typeof input.heuristicScore === "number"
        ? input.heuristicScore
        : null;

  const discoveredAt = toDate(input.discoveredAt ?? input.scrapedAt);
  const postedAt = toDate(input.postedAt ?? input.createdAt);

  return sanitizeValue({
    externalId: input.externalId ?? externalIdFor(platform, postUrl),
    name: name ?? null,
    username: username ?? null,
    profileUrl: input.profileUrl ?? null,
    platform,
    company: input.company ?? null,
    title: input.title ?? null,
    jobTitle: input.jobTitle ?? null,
    postContent: input.postContent ?? input.content ?? null,
    postUrl,
    postedAt,
    discoveredAt,
    leadScore,
    status: input.status ?? "new",
    isSaved: Boolean(input.isSaved ?? false),
    isArchived: Boolean(input.isArchived ?? false),
    intentType: input.intentType ?? null,
    grade: input.grade ?? null,
    heuristicScore: typeof input.heuristicScore === "number" ? input.heuristicScore : null,
    capabilities: asStringArray(input.capabilities),
    budget: input.budget ?? null,
    reasoning: input.reasoning ?? null,
    source: input.source ?? null,
    query: input.query ?? null,
    upvotes: typeof input.upvotes === "number" ? input.upvotes : null,
    comments: typeof input.comments === "number" ? input.comments : null,
    clientLocation: input.clientLocation ?? null,
    skills: asStringArray(input.skills),
    proposals: input.proposals ?? null,
    jobType: input.jobType ?? null,
    experienceLevel: input.experienceLevel ?? null,
    duration: input.duration ?? null,
    isWarm: Boolean(input.isWarm ?? false),
    classifiedBy: input.classifiedBy ?? null,
  });
}

module.exports = { normalizeLead };
