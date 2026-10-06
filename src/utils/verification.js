"use strict";

const path = require("path");
const { sleep } = require("./humanBehavior");
const config = require("../config");

const HUMAN_CHECK_SELECTORS = [
  'iframe[src*="captcha"]',
  'iframe[src*="challenge"]',
  '[class*="captcha"]',
  '[id*="captcha"]',
  '[class*="challenge"]',
  '[id*="challenge"]',
  'text=/are you human/i',
  'text=/verify you are human/i',
];

async function isHumanCheckVisible(page) {
  // NOTE: count() alone gives false positives — Reddit loads an invisible
  // reCAPTCHA Enterprise badge on every page and "recaptcha" contains the
  // substring "captcha", so iframe[src*="captcha"] always matches.
  // Only a VISIBLE match counts as a real challenge.
  for (const selector of HUMAN_CHECK_SELECTORS) {
    try {
      const loc = page.locator(selector);
      const count = await loc.count();
      for (let i = 0; i < Math.min(count, 10); i++) {
        try {
          if (await loc.nth(i).isVisible()) return true;
        } catch {}
      }
    } catch {}
  }
  return false;
}

async function waitForHuman(page, { timeoutMs = config.verifyWaitMs, screenshotPath = path.join(config.dataDir, "human-check.png") } = {}) {
  if (!(await isHumanCheckVisible(page))) return true;

  console.log("\n⚠️  HUMAN VERIFICATION DETECTED — solve it manually in Chrome.");
  try {
    await page.screenshot({ path: screenshotPath, fullPage: true });
  } catch {}

  const start = Date.now();
  while (true) {
    await page.waitForTimeout(2000);
    if (!(await isHumanCheckVisible(page))) {
      console.log("✅ Human verification completed.");
      return true;
    }
    if (Date.now() - start >= timeoutMs) {
      console.log("\n⏰ Verification wait timeout.");
      return false;
    }
    console.log("⏳ Still waiting for verification...");
  }
}

async function handleVerification(page, opts) {
  if (await waitForHuman(page, opts)) {
    // Challenge was solved (or was never there) — give Reddit a moment
    // to hydrate shreddit-post elements.
    await sleep(2000);
    return true;
  }
  // Timeout path: one reload often turns a challenge interstitial into
  // a rendered feed.
  try {
    await page.reload({ waitUntil: "domcontentloaded", timeout: config.navigationTimeoutMs });
    await sleep(2500);
  } catch {}
  return !(await isHumanCheckVisible(page));
}

async function waitForPosts(page) {
  try {
    await page.locator("shreddit-post").first().waitFor({ state: "attached", timeout: config.postRenderWaitMs });
    return true;
  } catch {
    return false;
  }
}

async function ensurePageReady(page) {
  await sleep(2500);
  if (await isHumanCheckVisible(page)) {
    const cleared = await handleVerification(page);
    if (!cleared) {
      console.log("⛔ Challenge still present, skipping page.");
      return false;
    }
  }
  const rendered = await waitForPosts(page);
  if (!rendered) console.log("⚠️  No shreddit-post elements rendered, trying fallback harvest.");
  return true;
}

module.exports = { isHumanCheckVisible, waitForHuman, handleVerification, waitForPosts, ensurePageReady };
