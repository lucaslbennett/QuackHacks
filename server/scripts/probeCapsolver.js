// Verifies the CapSolver integration: confirms the API key is live (balance)
// and, with --solve, actually solves Google's public reCAPTCHA v2 demo to prove
// the create-task -> poll -> token path works end to end.
//
// Usage:
//   node server/scripts/probeCapsolver.js           # check balance only
//   node server/scripts/probeCapsolver.js --solve   # also solve the reCAPTCHA demo
import { config } from "../config.js";
import * as capsolver from "../services/browser/capsolver.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("capsolver-probe");

// Google's official reCAPTCHA v2 test page + sitekey (safe to solve repeatedly).
const DEMO_URL = "https://www.google.com/recaptcha/api2/demo";
const DEMO_SITEKEY = "6Le-wvkSAAAAAPBMRTvw0Q4Muexq9bi0DJwx_mJ-";

async function main() {
  log.info("config", {
    apiKeySet: Boolean(config.capsolver.apiKey),
    apiBase: config.capsolver.apiBase,
    timeoutMs: config.capsolver.timeoutMs,
  });
  if (!capsolver.isConfigured()) {
    log.error("CAPSOLVER_API_KEY must be set");
    process.exit(2);
  }

  // 1. Balance — confirms the key is valid (errors here = bad/expired key).
  try {
    const { balance, packages } = await capsolver.getBalance();
    log.info("balance", { balance, packages: packages.length });
  } catch (err) {
    log.error("balance check failed:", err.message);
    process.exit(1);
  }

  // 2. Optional end-to-end solve against Google's reCAPTCHA demo.
  if (process.argv.includes("--solve")) {
    log.info("solving reCAPTCHA v2 demo…", { url: DEMO_URL });
    const started = Date.now();
    try {
      const token = await capsolver.solveReCaptcha({
        websiteURL: DEMO_URL,
        websiteKey: DEMO_SITEKEY,
      });
      log.info(`solved in ${((Date.now() - started) / 1000).toFixed(1)}s`, {
        tokenPreview: `${token.slice(0, 24)}…`,
        tokenLength: token.length,
      });
    } catch (err) {
      log.error("solve failed:", err.message);
      process.exit(1);
    }
  } else {
    log.info("pass --solve to run a full reCAPTCHA solve test");
  }
}

main().catch((err) => {
  log.error("probe crashed:", err?.stack || err?.message || err);
  process.exit(1);
});
