function normalizePlatform(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "reddit";
  if (raw === "twitter") return "x";
  if (["reddit", "x", "linkedin", "upwork"].includes(raw)) return raw;
  if (raw.includes("reddit")) return "reddit";
  if (raw.includes("twitter") || raw === "x.com") return "x";
  if (raw.includes("linkedin")) return "linkedin";
  if (raw.includes("upwork")) return "upwork";
  return raw;
}
function asStringArray(value) {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return parsed.map((v) => String(v)); } catch {}
    return value.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}
function toDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const ms = String(Math.trunc(value)).length <= 10 ? value * 1000 : value;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  const s = String(value).trim();
  if (/^\d{10,13}$/.test(s)) {
    const n = Number(s);
    const ms = s.length <= 10 ? n * 1000 : n;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
function normalizeUrl(value) {
  if (typeof value !== "string") return "";
  let u = value.trim();
  const marker = u.match(/#post-[0-9a-z]+$/i);
  const hash = u.indexOf("#");
  if (hash !== -1) u = u.slice(0, hash);
  const q = u.indexOf("?");
  if (q !== -1) u = u.slice(0, q);
  if (u.length > 1) u = u.replace(/\/+$/, "");
  return marker ? `${u}${marker[0].toLowerCase()}` : u;
}
function externalIdFor(platform, url) {
  if (!url) return null;
  let m = url.match(/comments\/([a-z0-9]+)/i);
  if (m) return m[1].toLowerCase();
  m = url.match(/status\/(\d+)/i);
  if (m) return m[1];
  m = url.match(/#post-([0-9a-z]+)/i);
  if (m) return m[1].toLowerCase();
  m = url.match(/_~?(\d+)\/?$/);
  if (m) return m[1];
  return null;
}
module.exports = { normalizePlatform, asStringArray, toDate, normalizeUrl, externalIdFor };
