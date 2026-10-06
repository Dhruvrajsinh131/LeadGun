"use strict";

const { chromium } = require("playwright");
const config = require("../config");

async function connectToChrome() {
  console.log(`🔌 Connecting to Chrome at ${config.cdpUrl}...`);
  const browser = await chromium.connectOverCDP(config.cdpUrl);
  const context = browser.contexts()[0];
  if (!context) throw new Error("No browser context found. Is Chrome running with --remote-debugging-port?");
  const page = context.pages()[0] || (await context.newPage());
  console.log("✅ Connected to Chrome");
  // NOTE: intentionally returns only the page. The browser/context belong
  // to the user's Chrome instance, so we never close them here.
  return { page };
}

module.exports = { connectToChrome };
