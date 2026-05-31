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
    // Pause flow execution while Browserbase's background CAPTCHA solver is
    // active, and resume once it finishes. This is the SDK-native counterpart to
    // our console-event barrier and stops act()/extract() from racing a solve.
    waitForCaptchaSolves: true,
    // Reuse cached element resolutions server-side across identical act/observe.
    serverCache: true,
    verbose: process.env.DEBUG ? 2 : 1,
    browserbaseSessionCreateParams: {
      projectId: config.browserbase.projectId,
      // Proxy config, in priority order:
      //  1. A custom EXTERNAL proxy (BROWSERBASE_PROXY_SERVER) — set this to the
      //     SAME proxy as CAPSOLVER_PROXY so the session egresses from the IP the
      //     CAPTCHA was solved on. reCAPTCHA Enterprise binds the token to the
      //     solver IP/fingerprint, so matching them is what lets an injected
      //     CapSolver token actually clear IG's challenge.
      //  2. Browserbase's built-in residential proxies (PAID; proxies:true on a
      //     free plan fails session creation with 402), as a fallback.
      ...(config.browserbase.proxyServer
        ? {
            proxies: [
              {
                type: "external",
                server: config.browserbase.proxyServer,
                ...(config.browserbase.proxyUsername
                  ? { username: config.browserbase.proxyUsername }
                  : {}),
                ...(config.browserbase.proxyPassword
                  ? { password: config.browserbase.proxyPassword }
                  : {}),
              },
            ],
          }
        : config.browserbase.proxies
          ? { proxies: true }
          : {}),
      browserSettings: {
        // Reuse a stored Browserbase context for persistent IG sessions.
        context: sessionData?.contextId
          ? { id: sessionData.contextId, persist: true }
          : undefined,
        // Background CAPTCHA solving (incl. reCAPTCHA Enterprise). Available on
        // all plans; success is best-effort and improves with proxies/stealth.
        solveCaptchas: true,
        // Advanced stealth (real device fingerprint) — ENTERPRISE only, so only
        // include when enabled; sending it elsewhere fails session creation (403).
        ...(config.browserbase.verified ? { verified: true } : {}),
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
  const opts2 = opts || {};
  // Capture the live session info so we can hand the watchable URL to the flow
  // (needed for the manual-CAPTCHA-assist fallback) while still forwarding the
  // caller's own onSession callback.
  let session = { sessionId: null, sessionUrl: null };
  const wrappedOpts = {
    ...opts2,
    onSession: (info) => {
      session = info || session;
      try {
        opts2.onSession?.(info);
      } catch (err) {
        log.warn("onSession callback error", err?.message);
      }
    },
  };
  const stagehand = await createStagehand(wrappedOpts);
  try {
    const page = stagehand.context.pages()[0] || (await stagehand.context.newPage());
    // NOTE: Stagehand v3's "understudy" Page only emits "console" events — it has
    // no "close"/"crash"/"disconnected" events (and no page.keyboard, getByRole,
    // locator.evaluate/getAttribute/filter). Flows must therefore use only the
    // supported primitives; a thrown error (rather than an event) is how a dead
    // page surfaces, and withStagehand's finally{} closes the session cleanly.
    const { waitForCaptcha } = attachCaptchaWatcher(page);
    return await fn({
      stagehand,
      page,
      waitForCaptcha,
      sessionId: session.sessionId,
      sessionUrl: session.sessionUrl,
    });
  } finally {
    await stagehand.close().catch((e) => log.warn("close error", e.message));
  }
}
