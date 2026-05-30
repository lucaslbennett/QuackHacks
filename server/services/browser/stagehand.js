import { Stagehand } from "@browserbasehq/stagehand";
import { config } from "../../config.js";
import { createLogger } from "../../lib/logger.js";

const log = createLogger("stagehand");

export function isConfigured() {
  return Boolean(config.browserbase.apiKey && config.browserbase.projectId);
}

// Browserbase solves CAPTCHAs asynchronously in the background and signals
// progress via page console events. Stagehand 3.4.0 has no built-in awareness
// of this, so we implement the documented pattern ourselves: track solver
// state from the console events and expose a barrier that callers await before
// proceeding (so we don't click/extract on a half-solved challenge or tear the
// session down mid-solve).
// See: https://docs.browserbase.com/platform/identity/overview (CAPTCHA events)
const SOLVING_STARTED = "browserbase-solving-started";
const SOLVING_FINISHED = "browserbase-solving-finished";
// Hard cap so a missed "finished" event can never hang the flow forever.
const SOLVE_TIMEOUT_MS = 45000;

function attachCaptchaWatcher(page) {
  const state = { solving: false, sawCaptcha: false, waiters: [] };

  const settle = () => {
    const waiters = state.waiters;
    state.waiters = [];
    for (const resolve of waiters) resolve();
  };

  const onConsole = (msg) => {
    let text = "";
    try {
      text = msg.text();
    } catch {
      return;
    }
    if (text === SOLVING_STARTED) {
      state.solving = true;
      state.sawCaptcha = true;
      log.info("CAPTCHA detected — Browserbase solving in progress");
    } else if (text === SOLVING_FINISHED) {
      if (state.solving) log.info("CAPTCHA solving finished");
      state.solving = false;
      settle();
    }
  };

  try {
    page.on("console", onConsole);
  } catch (err) {
    log.warn("could not attach captcha console listener", err?.message);
  }

  // Waits out an in-progress solve. Returns true if a captcha was being solved
  // (so callers can re-read the page), false if there was nothing to wait for.
  // `startGraceMs` polls for Browserbase's "started" event, since captcha
  // *detection* lags the page render — a single short check can miss it and let
  // us proceed straight into the solve. If a solve already finished while we
  // were sleeping before this call, `state.solving` is false and we correctly
  // report "nothing to wait for".
  const waitForCaptcha = async ({ timeoutMs = SOLVE_TIMEOUT_MS, startGraceMs = 4000 } = {}) => {
    const graceDeadline = Date.now() + startGraceMs;
    while (!state.solving && Date.now() < graceDeadline) {
      await new Promise((r) => setTimeout(r, 300));
    }
    if (!state.solving) return false;

    log.info("Waiting for Browserbase to finish solving CAPTCHA…");
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        state.solving = false;
        log.warn("CAPTCHA solve wait timed out; continuing");
        resolve();
      }, timeoutMs);
      state.waiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    return true;
  };

  return { waitForCaptcha, state };
}

// Builds the Browserbase dashboard URL for a session so it can be watched live.
export function sessionUrlFor(sessionId) {
  if (!sessionId) return null;
  return `https://www.browserbase.com/sessions/${sessionId}`;
}

// Creates an initialized Stagehand instance backed by Browserbase, using
// Gemini as the reasoning model for act()/extract(). Caller must close().
// `onSession` (if provided) is invoked once the session is live with
// { sessionId, sessionUrl } so callers can surface a watchable link early.
export async function createStagehand({ sessionData, onSession } = {}) {
  if (!isConfigured()) {
    throw new Error("BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID required");
  }
  const stagehand = new Stagehand({
    env: config.browserbase.env,
    apiKey: config.browserbase.apiKey,
    projectId: config.browserbase.projectId,
    model: {
      modelName: `google/${config.gemini.model}`,
      apiKey: config.gemini.apiKey,
    },
    // Don't over-wait for the DOM to "settle" between steps; IG pages keep
    // background activity alive, so a tight cap avoids multi-second stalls.
    domSettleTimeout: 3000,
    // Bound any LLM-backed act() so a slow inference can't hang the flow.
    actTimeoutMs: 20000,
    // Reuse cached element resolutions server-side across identical act/observe.
    serverCache: true,
    verbose: process.env.DEBUG ? 2 : 1,
    browserbaseSessionCreateParams: {
      projectId: config.browserbase.projectId,
      // Residential proxies + a "verified" (real-fingerprint) browser make IG
      // far less likely to throw a CAPTCHA at all, and materially improve the
      // background solver's success rate when one does appear.
      proxies: config.browserbase.proxies,
      browserSettings: {
        // Reuse a stored Browserbase context for persistent IG sessions.
        context: sessionData?.contextId
          ? { id: sessionData.contextId, persist: true }
          : undefined,
        // Background CAPTCHA solving (reCAPTCHA et al.). Enabled by default on
        // Browserbase, but set explicitly so intent is clear.
        solveCaptchas: true,
        // Real device fingerprint / consistent UA — lowers bot-detection that
        // triggers the "Help us confirm it's you" challenge.
        verified: config.browserbase.verified,
      },
    },
  });
  await stagehand.init();
  const sessionId = stagehand.browserbaseSessionID;
  log.info("Stagehand session initialized", sessionId || "");
  if (typeof onSession === "function") {
    try {
      onSession({ sessionId, sessionUrl: sessionUrlFor(sessionId) });
    } catch (err) {
      log.warn("onSession callback error", err?.message);
    }
  }
  return stagehand;
}

// Convenience: run a function with a Stagehand instance and always close it.
export async function withStagehand(fn, opts) {
  const stagehand = await createStagehand(opts);
  try {
    const page = stagehand.context.pages()[0] || (await stagehand.context.newPage());
    const { waitForCaptcha } = attachCaptchaWatcher(page);
    return await fn({ stagehand, page, waitForCaptcha });
  } finally {
    await stagehand.close().catch((e) => log.warn("close error", e.message));
  }
}
