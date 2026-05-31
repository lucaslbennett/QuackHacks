// Browser Use Cloud API v3 client (https://docs.browser-use.com/cloud/api-reference).
//
// We explicitly create and stop cloud browser sessions over Browser Use's
// authenticated REST API (header: X-Browser-Use-API-Key, keys start with "bu_").
// This is deliberate: opening a raw CDP WebSocket to wss://connect.browser-use.com
// authenticates the key but does NOT surface in the dashboard's "Sessions" list
// and does NOT update the API key's "last used" timestamp. Creating the session
// via REST does both — so the key shows as used and every run is a real, watchable
// session (with a liveUrl) in the dashboard.
//
// Lifecycle:
//   1. POST   {apiBase}/browsers            -> { id, cdpUrl, liveUrl, ... }
//   2. (Stagehand attaches to the session's CDP endpoint and drives the page)
//   3. PATCH  {apiBase}/browsers/{id}       body { action: "stop" }  (refunds unused time)
import { config } from "../../config.js";
import { createLogger } from "../../lib/logger.js";

const log = createLogger("browser-use");

export function isConfigured() {
  return Boolean(config.browserUse.apiKey);
}

// The most common real desktop resolutions (per StatCounter). Picking one of
// these PER SESSION makes window.screen / innerWidth / outerWidth look like a
// normal visitor instead of exposing a single fixed automation viewport, which
// fingerprinting scripts flag. All are mainstream 16:9 / 16:10 sizes, so any of
// them blends in. Override with a fixed size via BROWSER_USE_SCREEN_WIDTH/HEIGHT.
const COMMON_VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1600, height: 900 },
  { width: 1280, height: 720 },
];

// Returns the viewport to use for a session: the configured fixed size when both
// dimensions are set, otherwise a randomly-chosen common resolution.
export function pickViewport() {
  const { screenWidth, screenHeight } = config.browserUse;
  if (screenWidth && screenHeight) return { width: screenWidth, height: screenHeight };
  return COMMON_VIEWPORTS[Math.floor(Math.random() * COMMON_VIEWPORTS.length)];
}

function authHeaders(extra = {}) {
  return {
    "X-Browser-Use-API-Key": config.browserUse.apiKey,
    "Content-Type": "application/json",
    ...extra,
  };
}

// Low-level JSON request against the Browser Use REST API. Throws a descriptive
// error (including the API's `detail`) on a non-2xx response.
async function api(method, pathname, body) {
  if (!isConfigured()) throw new Error("BROWSER_USE_API_KEY required");
  const res = await fetch(`${config.browserUse.apiBase}${pathname}`, {
    method,
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const detail = data?.detail || data?.message || data?.raw || res.statusText;
    throw new Error(`Browser Use ${method} ${pathname} -> HTTP ${res.status}: ${detail}`);
  }
  return data;
}

// Creates a cloud browser session and returns the raw session view, including
// `id`, `cdpUrl` (for automation) and `liveUrl` (to watch it live). Options
// override the configured defaults per call.
export async function createSession(opts = {}) {
  const body = {};

  // proxyCountryCode: send only when set; omitting lets the API default to "us".
  const proxyCountryCode = opts.proxyCountryCode ?? config.browserUse.proxyCountryCode;
  if (proxyCountryCode) body.proxyCountryCode = proxyCountryCode;

  const profileId = opts.profileId ?? config.browserUse.profileId;
  if (profileId) body.profileId = profileId;

  const timeout = opts.timeout ?? config.browserUse.timeoutMinutes;
  if (timeout) body.timeout = timeout;

  const enableRecording = opts.enableRecording ?? config.browserUse.enableRecording;
  if (enableRecording) body.enableRecording = true;

  // Randomize (or pin) the browser viewport so the screen fingerprint blends in
  // with real traffic rather than presenting one constant automation size. Width
  // and height are chosen together so the aspect ratio stays a real one.
  const viewport = pickViewport();
  body.browserScreenWidth = opts.browserScreenWidth ?? viewport.width;
  body.browserScreenHeight = opts.browserScreenHeight ?? viewport.height;

  const session = await api("POST", "/browsers", body);
  log.info("Browser Use session created", {
    id: session.id,
    liveUrl: session.liveUrl,
    proxyCountryCode: body.proxyCountryCode || "(api default)",
    profileId: body.profileId ? "set" : "(none)",
    timeout: body.timeout,
    viewport: `${body.browserScreenWidth}x${body.browserScreenHeight}`,
  });
  return session;
}

// Stops a session (Browser Use refunds the unused, prepaid time). Best-effort:
// logs and swallows errors so cleanup never breaks the caller's flow.
export async function stopSession(id) {
  if (!id) return;
  try {
    await api("PATCH", `/browsers/${id}`, { action: "stop" });
    log.info("Browser Use session stopped", { id });
  } catch (err) {
    log.warn("Failed to stop Browser Use session", { id, error: err?.message });
  }
}

// Fetches a single session (status, costs, recordingUrl once finished, ...).
export async function getSession(id) {
  return api("GET", `/browsers/${id}`);
}

// Lists recent sessions (paged). Handy for probes/health checks.
export async function listSessions({ pageSize = 10, pageNumber = 1 } = {}) {
  const qs = new URLSearchParams({ pageSize: String(pageSize), pageNumber: String(pageNumber) });
  return api("GET", `/browsers?${qs.toString()}`);
}

// A stable dashboard URL for a session (used when the API didn't hand back a
// liveUrl, or for a generic "open the dashboard" link).
export function dashboardUrlFor(id) {
  return id ? `https://cloud.browser-use.com/sessions/${id}` : "https://cloud.browser-use.com";
}

// Resolves a ws:// or wss:// CDP endpoint that Stagehand can attach to via a raw
// WebSocket (Stagehand connects directly — it does not do /json/version HTTP
// auto-discovery). Browser Use may return `cdpUrl` as either:
//   - a direct ws(s):// URL  -> use as-is
//   - an https:// URL        -> discover the websocketDebuggerUrl via /json/version
export async function cdpWebSocketUrl(session) {
  const cdpUrl = session?.cdpUrl;
  if (!cdpUrl) throw new Error("Browser Use session did not return a cdpUrl");

  if (/^wss?:\/\//i.test(cdpUrl)) return cdpUrl;

  if (/^https?:\/\//i.test(cdpUrl)) {
    const base = cdpUrl.replace(/\/+$/, "");
    const res = await fetch(`${base}/json/version`, { headers: authHeaders() });
    if (!res.ok) {
      throw new Error(`Browser Use CDP discovery failed: HTTP ${res.status} at ${base}/json/version`);
    }
    const info = await res.json().catch(() => ({}));
    const ws = info?.webSocketDebuggerUrl;
    if (!ws) throw new Error("Browser Use /json/version returned no webSocketDebuggerUrl");
    return ws;
  }

  throw new Error(`Unrecognized Browser Use cdpUrl scheme: ${cdpUrl}`);
}
