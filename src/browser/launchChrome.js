"use strict";

const { spawn } = require("child_process");
const config = require("../config");

function cdpEndpoint() {
  return `${config.cdpUrl.replace(/\/+$/, "")}/json/version`;
}

async function isCdpUp(timeoutMs = 1500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(cdpEndpoint(), { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function chromeArgs() {
  const port = new URL(config.cdpUrl).port || "9222";
  return [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${config.chrome.profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];
}

// Attach to Chrome if the CDP port is open, otherwise start it detached and
// wait until the port answers. Returns "already-running" or "launched".
async function ensureChrome() {
  if (await isCdpUp()) return "already-running";
  console.log(`🚀 Chrome not listening on ${config.cdpUrl} — launching ${config.chrome.executable}...`);
  let spawnError = null;
  const child = spawn(config.chrome.executable, chromeArgs(), { detached: true, stdio: "ignore" });
  child.on("error", (err) => {
    spawnError = err;
  });
  child.unref();
  const deadline = Date.now() + config.chrome.launchTimeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isCdpUp()) return "launched";
    if (spawnError) break;
  }
  if (spawnError) {
    throw new Error(`Could not launch Chrome (${config.chrome.executable}): ${spawnError.message}. Set CHROME_PATH to the Chrome binary.`);
  }
  throw new Error(
    `Chrome did not expose ${config.cdpUrl} within ${config.chrome.launchTimeoutMs}ms. ` +
      `If Chrome is already open with profile "${config.chrome.profileDir}", close it fully and retry — ` +
      "remote debugging only works when Chrome starts with --remote-debugging-port."
  );
}

module.exports = { ensureChrome, isCdpUp, chromeArgs };
