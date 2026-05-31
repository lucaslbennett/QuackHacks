// CapSolver API client (https://capsolver.com) — solves reCAPTCHA challenges
// programmatically and returns a g-recaptcha-response token we can inject into
// the page. This is the "always works" counterpart to Browserbase's background
// solver, which is plan-gated and unreliable for reCAPTCHA Enterprise (what
// Instagram uses) on the free tier.
//
// Flow (CapSolver "task" model, proxyless):
//   1. POST /createTask  -> { taskId }
//   2. POST /getTaskResult (poll) -> { status: "ready", solution.gRecaptchaResponse }
// We then hand the token back to the caller to inject + fire the widget callback.
//
// Docs: https://docs.capsolver.com/guide/captcha/ReCaptchaV2.html
import { config } from "../../config.js";
import { sleep } from "../../lib/util.js";
import { createLogger } from "../../lib/logger.js";

const log = createLogger("capsolver");

export function isConfigured() {
  return Boolean(config.capsolver.apiKey);
}

// Low-level POST to the CapSolver REST API. Always injects the clientKey and
// throws a descriptive error when the API reports a non-zero errorId.
async function post(pathname, body) {
  const res = await fetch(`${config.capsolver.apiBase}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientKey: config.capsolver.apiKey, ...body }),
  });
  if (!res.ok) throw new Error(`CapSolver ${pathname} HTTP ${res.status}`);
  const data = await res.json();
  if (data.errorId) {
    const detail = [data.errorCode, data.errorDescription].filter(Boolean).join(": ");
    throw new Error(`CapSolver ${pathname} error: ${detail || "unknown"}`);
  }
  return data;
}

// Returns the account balance (and any token packages). Handy for the probe
// script and a quick "is my key live?" health check.
export async function getBalance() {
  const data = await post("/getBalance", {});
  return { balance: data.balance, packages: data.packages || [] };
}

// Builds the CapSolver task body from a detected reCAPTCHA. Two axes pick the
// task type:
//   - Enterprise vs standard v2 (different token + verification path)
//   - Proxied vs ProxyLess: when a `proxy` is given, CapSolver solves THROUGH it
//     so the token's IP/fingerprint matches the browser session (required for
//     reCAPTCHA Enterprise to accept the token). Without a proxy we use the
//     ProxyLess variants (CapSolver's own datacenter IP).
// Everything else is optional and only included when present.
function buildReCaptchaTask({
  websiteURL,
  websiteKey,
  isEnterprise = false,
  isInvisible = false,
  pageAction,
  enterprisePayload,
  apiDomain,
  proxy,
}) {
  const useProxy = Boolean(proxy);
  const type = isEnterprise
    ? useProxy
      ? "ReCaptchaV2EnterpriseTask"
      : "ReCaptchaV2EnterpriseTaskProxyLess"
    : useProxy
      ? "ReCaptchaV2Task"
      : "ReCaptchaV2TaskProxyLess";
  const task = { type, websiteURL, websiteKey };
  if (useProxy) task.proxy = proxy;
  if (isInvisible) task.isInvisible = true;
  if (pageAction) task.pageAction = pageAction;
  if (enterprisePayload) task.enterprisePayload = enterprisePayload;
  if (apiDomain) task.apiDomain = apiDomain;
  return task;
}

// Polls a created task until it resolves to a token or we hit the timeout.
async function waitForTaskResult(taskId) {
  const { pollIntervalMs, timeoutMs } = config.capsolver;
  const deadline = Date.now() + timeoutMs;
  // Solves rarely finish instantly; give the worker a brief head start.
  await sleep(Math.min(pollIntervalMs, 2000));
  while (Date.now() < deadline) {
    const result = await post("/getTaskResult", { taskId });
    if (result.status === "ready") {
      const token = result.solution?.gRecaptchaResponse;
      if (!token) throw new Error("CapSolver task ready but solution had no token");
      return token;
    }
    // status is "idle" | "processing" — keep polling.
    await sleep(pollIntervalMs);
  }
  throw new Error(`CapSolver task ${taskId} timed out after ${timeoutMs}ms`);
}

// Solves a reCAPTCHA and returns the g-recaptcha-response token string.
// Throws on misconfiguration, API error, or timeout. Best-effort callers
// should wrap this in try/catch (the signup flow does).
export async function solveReCaptcha(params) {
  if (!isConfigured()) throw new Error("CAPSOLVER_API_KEY not set");
  if (!params?.websiteKey) throw new Error("solveReCaptcha requires a websiteKey (sitekey)");

  const task = buildReCaptchaTask(params);
  log.info("Creating reCAPTCHA task", {
    type: task.type,
    websiteURL: task.websiteURL,
    invisible: Boolean(task.isInvisible),
  });
  const created = await post("/createTask", { task });
  if (!created.taskId) throw new Error("CapSolver createTask returned no taskId");

  const token = await waitForTaskResult(created.taskId);
  log.info("reCAPTCHA solved", { taskId: created.taskId, tokenLength: token.length });
  return token;
}
