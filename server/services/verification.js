import { config } from "../config.js";
import { sleep } from "../lib/util.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("verify");

// In-memory store for manual code entry from the dashboard.
// influencerId -> { email?: string, sms?: string }
const manualCodes = new Map();

export function submitManualCode(influencerId, kind, code) {
  const entry = manualCodes.get(influencerId) || {};
  entry[kind] = code;
  manualCodes.set(influencerId, entry);
  log.info(`Manual ${kind} code submitted for`, influencerId);
}

function takeManualCode(influencerId, kind) {
  const entry = manualCodes.get(influencerId);
  if (entry && entry[kind]) {
    const code = entry[kind];
    delete entry[kind];
    return code;
  }
  return null;
}

const CODE_RE = /\b(\d{4,8})\b/;

function extractCode(text) {
  if (!text) return null;
  const m = String(text).match(CODE_RE);
  return m ? m[1] : null;
}

// --- Email providers ---------------------------------------------------------

async function fetchEmailCodeMailosaur({ to }) {
  const { emailApiKey, mailosaurServerId } = config.verification;
  const url = `https://mailosaur.com/api/messages/await?server=${mailosaurServerId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + Buffer.from(`${emailApiKey}:`).toString("base64"),
    },
    body: JSON.stringify({ sentTo: to }),
  });
  if (!res.ok) throw new Error(`Mailosaur ${res.status}`);
  const msg = await res.json();
  return extractCode(msg?.subject) || extractCode(msg?.text?.body) || extractCode(msg?.html?.body);
}

// --- SMS providers -----------------------------------------------------------

async function fetchSmsCodeTwilio({ to }) {
  const { twilioAccountSid, twilioAuthToken } = config.verification;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json?To=${encodeURIComponent(to)}&PageSize=5`;
  const res = await fetch(url, {
    headers: {
      Authorization: "Basic " + Buffer.from(`${twilioAccountSid}:${twilioAuthToken}`).toString("base64"),
    },
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}`);
  const data = await res.json();
  for (const m of data.messages || []) {
    const code = extractCode(m.body);
    if (code) return code;
  }
  return null;
}

async function fetchSmsCodeSmsActivate({ activationId }) {
  const { smsApiKey } = config.verification;
  const url = `https://api.sms-activate.org/stubs/handler_api.php?api_key=${smsApiKey}&action=getStatus&id=${activationId}`;
  const res = await fetch(url);
  const text = await res.text();
  // Format: STATUS_OK:code
  if (text.startsWith("STATUS_OK")) return extractCode(text);
  return null;
}

// --- Public API --------------------------------------------------------------

// Polls the configured provider for a verification code. Falls back to manual
// dashboard entry. Resolves with the numeric code string or throws on timeout.
export async function waitForEmailCode({ influencerId, to, timeoutMs = 180000, intervalMs = 6000 }) {
  const provider = config.verification.emailProvider;
  log.info(`Waiting for email code via "${provider}" for`, to);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const manual = takeManualCode(influencerId, "email");
    if (manual) return manual;
    try {
      if (provider === "mailosaur" && config.verification.emailApiKey) {
        const code = await fetchEmailCodeMailosaur({ to });
        if (code) return code;
      }
    } catch (err) {
      log.warn("email provider error:", err.message);
    }
    await sleep(intervalMs);
  }
  throw new Error("Timed out waiting for email verification code");
}

export async function waitForSmsCode({ influencerId, to, activationId, timeoutMs = 180000, intervalMs = 6000 }) {
  const provider = config.verification.smsProvider;
  log.info(`Waiting for SMS code via "${provider}" for`, to || activationId);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const manual = takeManualCode(influencerId, "sms");
    if (manual) return manual;
    try {
      if (provider === "twilio" && config.verification.twilioAccountSid) {
        const code = await fetchSmsCodeTwilio({ to });
        if (code) return code;
      } else if (provider === "sms-activate" && config.verification.smsApiKey && activationId) {
        const code = await fetchSmsCodeSmsActivate({ activationId });
        if (code) return code;
      }
    } catch (err) {
      log.warn("sms provider error:", err.message);
    }
    await sleep(intervalMs);
  }
  throw new Error("Timed out waiting for SMS verification code");
}
