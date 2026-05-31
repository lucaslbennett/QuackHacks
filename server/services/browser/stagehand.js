import { Stagehand } from "@browserbasehq/stagehand";
import { config } from "../../config.js";
import { createLogger } from "../../lib/logger.js";
import * as browserUse from "./browserUse.js";
import * as localBrowser from "./localBrowser.js";

const log = createLogger("stagehand");

export function isConfigured() {
  return browserUse.isConfigured() || config.browserUse.localBrowser;
}

// Fallback connect URL (used only when BROWSER_USE_REST_SESSIONS=false). Opens a
// raw CDP WebSocket straight to Browser Use; the browser auto-starts on connect
// and auto-stops on disconnect. NOTE: sessions opened this way authenticate but
// do NOT appear in the dashboard's session list and do NOT update the API key's
// "last used" — prefer the REST path (the default).
// See: https://docs.browser-use.com/cloud/browser/playwright-puppeteer-selenium
function buildConnectUrl() {
  const url = new URL(config.browserUse.connectHost);
  url.searchParams.set("apiKey", config.browserUse.apiKey);
  if (config.browserUse.proxyCountryCode) {
    url.searchParams.set("proxyCountryCode", config.browserUse.proxyCountryCode);
  }
  if (config.browserUse.profileId) {
    url.searchParams.set("profileId", config.browserUse.profileId);
  }
  if (config.browserUse.timeoutMinutes) {
    url.searchParams.set("timeout", String(config.browserUse.timeoutMinutes));
  }
  // Match the REST path: randomize (or pin) the viewport so the connect-URL
  // fallback doesn't expose a constant automation screen size either.
  const viewport = browserUse.pickViewport();
  url.searchParams.set("browserScreenWidth", String(viewport.width));
  url.searchParams.set("browserScreenHeight", String(viewport.height));
  return url.toString();
}

// Opens a Browser Use cloud browser and returns everything needed to drive and
// clean it up: a ws CDP URL for Stagehand, the live-view URL, a session id, and a
// stop() handle.
//
// Primary path (default): create the session via the REST API so it's visible in
// the dashboard and the key registers as used. Falls back to the raw connect URL
// if REST creation is disabled or fails, so a transient API hiccup never fully
// breaks a run.
async function openBrowserUseSession() {
  // LOCAL-BROWSER escape hatch: drive a real Chrome on this machine (residential
  // home IP) instead of a Browser Use cloud browser. Used to dodge Instagram's
  // integrity-flagging of shared automation proxy ranges.
  if (config.browserUse.localBrowser) {
    const local = await localBrowser.launchLocalSession();
    log.info("Using LOCAL Chrome session (home IP egress)", { sessionUrl: local.sessionUrl });
    return local;
  }

  if (config.browserUse.useRestSessions) {
    let session = null;
    try {
      session = await browserUse.createSession();
      const cdpUrl = await browserUse.cdpWebSocketUrl(session);
      return {
        cdpUrl,
        sessionId: session.id,
        sessionUrl: session.liveUrl || browserUse.dashboardUrlFor(session.id),
        stop: () => browserUse.stopSession(session.id),
      };
    } catch (err) {
      // If the session was created but we couldn't derive a CDP URL, stop it so
      // it doesn't keep running (and billing) until its timeout.
      if (session?.id) await browserUse.stopSession(session.id);
      log.warn(
        "Browser Use REST session create failed — falling back to connect-URL (session won't show in dashboard)",
        err?.message
      );
    }
  }
  return {
    cdpUrl: buildConnectUrl(),
    sessionId: null,
    sessionUrl: "https://cloud.browser-use.com",
    stop: async () => {},
  };
}

// Browser Use's cloud browser solves CAPTCHAs IN the browser (stealth + built-in
// bypass), so unlike Browserbase there are no "solving-started/finished" console
// events to await. We keep the same `waitForCaptcha` barrier shape the flows
// expect, but it's a no-op that immediately reports "nothing to wait for" —
// callers then fall through to their own checks (DOM polling + the CapSolver
// fallback in createAccount.js), which remain fully functional.
function attachCaptchaWatcher() {
  const waitForCaptcha = async () => false;
  return { waitForCaptcha, state: { solving: false, sawCaptcha: false } };
}

// A generic watchable link for when no per-session URL is available yet.
export function sessionUrlFor() {
  return "https://cloud.browser-use.com";
}

// Creates an initialized Stagehand instance backed by a Browser Use cloud
// browser. Stagehand runs in LOCAL mode but, instead of launching Chrome on this
// machine, attaches to Browser Use's remote stealth Chromium over CDP. Gemini is
// the reasoning model for act()/extract().
//
// The returned instance carries a `browserUseSession` handle ({ sessionId,
// sessionUrl, stop }); callers (withStagehand) must stop() the session after
// closing Stagehand so we don't keep paying for an idle cloud browser.
//
// `onSession` (if provided) is invoked once the session is live with
// { sessionId, sessionUrl } so callers can surface a watchable link early.
// `sessionData` is accepted for call-site compatibility but ignored — login
// persistence is handled by Browser Use profiles (BROWSER_USE_PROFILE_ID), not a
// per-call context id.
export async function createStagehand({ sessionData, onSession } = {}) {
  void sessionData;
  if (!browserUse.isConfigured() && !config.browserUse.localBrowser) {
    throw new Error("BROWSER_USE_API_KEY required (or set SIGNUP_LOCAL_BROWSER=1 for local Chrome)");
  }
  const session = await openBrowserUseSession();
  const stagehand = new Stagehand({
    env: config.browserUse.env,
    model: {
      modelName: `google/${config.gemini.model}`,
      apiKey: config.gemini.apiKey,
    },
    // Attach to the Browser Use remote browser over CDP rather than launching a
    // local Chrome. Stagehand v3 is CDP-native, so its page/act/extract API works
    // identically against this backend.
    localBrowserLaunchOptions: {
      cdpUrl: session.cdpUrl,
    },
    // Run act()/extract() entirely through our own Gemini client and never route
    // through Browserbase's hosted Stagehand API — we use Browser Use for the
    // browser and Gemini for reasoning, nothing from Browserbase's backend.
    disableAPI: true,
    // Don't over-wait for the DOM to "settle" between steps; IG pages keep
    // background activity alive, so a tight cap avoids multi-second stalls.
    domSettleTimeout: 3000,
    // Bound any LLM-backed act() so a slow inference can't hang the flow.
    actTimeoutMs: 20000,
    verbose: process.env.DEBUG ? 2 : 1,
  });
  try {
    await stagehand.init();
  } catch (err) {
    // init failed after the cloud session was provisioned — stop it so we don't
    // pay for an idle browser, then surface the original error.
    try {
      await session.stop?.();
    } catch {
      /* best-effort cleanup */
    }
    throw err;
  }
  // Stash the session handle so withStagehand can stop it during cleanup.
  stagehand.browserUseSession = session;
  log.info("Stagehand session initialized (Browser Use)", {
    sessionId: session.sessionId || "(connect-url)",
    sessionUrl: session.sessionUrl,
  });
  if (typeof onSession === "function") {
    try {
      onSession({ sessionId: session.sessionId, sessionUrl: session.sessionUrl });
    } catch (err) {
      log.warn("onSession callback error", err?.message);
    }
  }
  return stagehand;
}

// Convenience: run a function with a Stagehand instance and always close +
// stop the underlying Browser Use session.
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
    // Close the Stagehand/CDP connection first, then explicitly stop the cloud
    // session via REST (Browser Use refunds the unused prepaid time). On the
    // connect-URL fallback, stop() is a no-op since disconnect already stops it.
    await stagehand.close().catch((e) => log.warn("close error", e.message));
    try {
      await stagehand.browserUseSession?.stop?.();
    } catch (e) {
      log.warn("session stop error", e?.message);
    }
  }
}
