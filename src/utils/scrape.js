"use strict";


const config = require("../config");

function shuffled(arr) {
  const out = [...arr];
  if (!config.shuffleOrder) return out;
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Counts posts not seen before and records their URLs.
// Returns null when no tracking set is passed.
function markKnown(posts, known) {
  if (!known) return null;
  let n = 0;
  for (const p of posts) {
    if (!p.url) continue;
    if (!known.has(p.url)) {
      n++;
      known.add(p.url);
    }
  }
  return n;
}

// Crashed renderer or closed tab/window.
function isTargetClosed(err) {
  return /target page, context or browser has been closed/i.test(String((err && err.message) || err || ""));
}

module.exports = { shuffled, markKnown, isTargetClosed };
