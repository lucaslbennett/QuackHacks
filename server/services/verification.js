import { createHash } from "node:crypto";
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

// Pulls the numeric verification code out of arbitrary text (subject/body).
// Instagram codes are 6 digits, so prefer a standalone 6-digit run; only then
// fall back to any 4–8 digit run. Accepts arrays (mail.tm `html` is string[]).
function extractCode(text) {
  if (!text) return null;
  const s = Array.isArray(text) ? text.join(" ") : String(text);
  const six = s.match(/\b(\d{6})\b/);
  if (six) return six[1];
  const m = s.match(CODE_RE);
  return m ? m[1] : null;
}

// --- Address generation ------------------------------------------------------

// Per-process monotonic counter so two slugs minted in the same millisecond
// (e.g. a tight account-generation loop) still differ.
let slugSeq = 0;

// Builds a GUARANTEED-UNIQUE address slug. A new account must get a brand-new
// email every time: Instagram ties each address to a signup the instant it's
// submitted, so reusing one (even from an abandoned attempt) trips "email
// already in use" / "this email can't be used". The suffix combines a
// millisecond timestamp + a per-process sequence counter + randomness, so no
// two calls — even with an identical seed or within the same millisecond — ever
// collide. The human-readable prefix is capped short so the unique suffix is
// never lost to the 24-char truncation the IMAP/mail.tm helpers apply to the
// local part (which strips the dot, leaving prefix+suffix).
function randomSlug(seed) {
  const clean = String(seed || "creator")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8) || "creator";
  const unique =
    Date.now().toString(36) +
    (slugSeq++).toString(36) +
    Math.random().toString(36).slice(2, 5);
  return `${clean}.${unique}`;
}

// Returns a fresh, inbox-backed email address for a new account. ASYNC because
// the default provider (mail.tm) has to provision the inbox up front so it can
// receive Instagram's email.
//
// - "maildotm" (default): creates a REAL disposable inbox via mail.tm and
//   returns its address. waitForEmailCode() later logs in and reads the IG code
//   from it. No API key required.
// - "mailosaur": returns `<slug>@<serverId>.mailosaur.net`. NOTE: Mailosaur
//   policy-blocks third-party signup emails, so IG's code never lands here —
//   kept only for backwards compatibility.
// - otherwise ("manual"): a placeholder example.com address; the code must be
//   entered by hand from the dashboard.
export async function generateEmail({ seed } = {}) {
  const { emailProvider, mailosaurServerId } = config.verification;
  const slug = randomSlug(seed);

  if (emailProvider === "imap") {
    // Real mailbox: just mint a fresh alias that routes to it. No provisioning
    // call needed — the inbox already exists and IG will deliver to it.
    const address = imapAliasFor(slug);
    log.info("Using IMAP inbox alias", address);
    return address;
  }
  if (emailProvider === "maildotm") {
    try {
      return await provisionMailtmInbox(slug);
    } catch (err) {
      log.error("mail.tm inbox provisioning failed:", err.message);
      throw err;
    }
  }
  if (emailProvider === "mailosaur" && mailosaurServerId) {
    return `${slug}@${mailosaurServerId}.mailosaur.net`;
  }
  return `${slug}@example.com`;
}

// --- mail.tm provider --------------------------------------------------------
// mail.tm (and its identical-API sibling mail.gw) is a free disposable-mail
// service that exposes a small REST API and, crucially, RECEIVES external email
// (including Instagram's verification code). No API key is needed: you create
// an account (address + password), exchange it for a bearer token, and list
// messages. We derive the password deterministically from the address so the
// poller can always re-authenticate to the same inbox — even across process
// restarts or if the in-memory cache misses.

// address -> { token, password, base } cache (avoids re-auth on every poll and
// remembers WHICH endpoint the inbox was provisioned on, so we always poll the
// same one).
const mailtmSessions = new Map();

// mail.tm content-negotiates list responses: the default (Hydra) shape wraps
// results in `hydra:member`, while `Accept: application/json` returns a plain
// array. Normalize both so we don't depend on which one we get back.
function listMembers(data) {
  if (Array.isArray(data)) return data;
  return data?.["hydra:member"] || [];
}

function derivePassword(address) {
  const hash = createHash("sha256")
    .update(`${address}::quackhacks-mailtm-v1`)
    .digest("base64")
    .replace(/[^a-zA-Z0-9]/g, "");
  // Mix of upper/lower/digit/symbol, comfortably long, stable per address.
  return `Qh1!${hash.slice(0, 24)}`;
}

async function mailtmFetch(base, path, { method = "GET", token, body, retries = 2 } = {}) {
  const headers = { Accept: "application/json" };
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${base}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      // 429 = rate limited; back off and retry.
      if (res.status === 429 && attempt < retries) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(1000 * (attempt + 1));
    }
  }
  throw lastErr || new Error("mail.tm request failed");
}

// Picks a usable domain for a given endpoint, honoring an optional pinned
// domain (MAILTM_PREFERRED_DOMAIN) and a skip list (MAILTM_SKIP_DOMAINS) so you
// can route around a domain you've observed Instagram reject.
async function mailtmActiveDomain(base) {
  const { mailtmPreferredDomain, mailtmSkipDomains } = config.verification;
  const res = await mailtmFetch(base, "/domains");
  if (!res.ok) throw new Error(`mail.tm domains ${res.status} @ ${base}`);
  const domains = listMembers(await res.json()).filter((d) => d?.domain);
  if (!domains.length) throw new Error(`mail.tm: no domains @ ${base}`);

  if (mailtmPreferredDomain) {
    const pinned = domains.find((d) => String(d.domain).toLowerCase() === mailtmPreferredDomain);
    if (pinned) return pinned.domain;
  }
  const allowed = domains.filter((d) => !mailtmSkipDomains.includes(String(d.domain).toLowerCase()));
  const pool = allowed.length ? allowed : domains;
  const pick =
    pool.find((d) => d.isActive && !d.isPrivate) ||
    pool.find((d) => d.isActive) ||
    pool[0];
  if (!pick?.domain) throw new Error(`mail.tm: no usable domain @ ${base}`);
  return pick.domain;
}

// Creates a real mail.tm inbox and returns its address. Idempotent: a 422
// ("address already exists") is treated as success since the derived password
// still lets us log in.
//
// IMPORTANT: mail.tm NORMALIZES the local part (it strips dots, like Gmail), so
// `a.b@dom` becomes `ab@dom`. If we keep the dotted form we'd then fail to log
// in ("Invalid credentials") because the stored address differs. We therefore
// (1) build a dotless, alphanumeric local part up front so no normalization
// happens, and (2) trust the address echoed back by the create response as the
// canonical one to log in with.
async function provisionMailtmInbox(slug) {
  const bases = config.verification.mailtmApiBases;
  const local = String(slug).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24) || `user${Date.now()}`;
  let lastErr;
  // Try each endpoint (mail.tm, then mail.gw) so a dead/flagged one doesn't sink
  // provisioning. The chosen base is cached with the address so polls hit it.
  for (const base of bases) {
    try {
      const domain = await mailtmActiveDomain(base);
      const address = `${local}@${domain}`;
      const password = derivePassword(address);
      const res = await mailtmFetch(base, "/accounts", {
        method: "POST",
        body: { address, password },
      });
      if (!res.ok && res.status !== 422) {
        const detail = await res.text().catch(() => "");
        throw new Error(`mail.tm account create ${res.status} ${detail}`.trim());
      }
      // Use the address mail.tm actually stored (should match `address` since
      // it's already dotless/lowercased, but be defensive).
      let canonical = address;
      try {
        const created = await res.json();
        if (created?.address) canonical = String(created.address).toLowerCase();
      } catch {
        /* 422 or empty body — keep our address */
      }
      // Cache the password we SENT + the endpoint, keyed by canonical address,
      // so the poller authenticates with the exact credentials on the right host.
      mailtmSessions.set(canonical, { token: null, password, base });
      log.info("Provisioned mail.tm inbox", `${canonical} (via ${base})`);
      return canonical;
    } catch (err) {
      lastErr = err;
      log.warn(`mail.tm provisioning via ${base} failed:`, err.message);
    }
  }
  throw lastErr || new Error("mail.tm provisioning failed on all endpoints");
}

// Returns { token, base } for an address. On a cache miss (e.g. process
// restart) we don't know the endpoint, so we try each configured base until one
// authenticates — the inbox lives on exactly one of them.
async function mailtmToken(address) {
  const cached = mailtmSessions.get(address);
  if (cached?.token && cached?.base) return { token: cached.token, base: cached.base };
  const password = cached?.password || derivePassword(address);
  const bases = cached?.base ? [cached.base] : config.verification.mailtmApiBases;
  let lastErr;
  for (const base of bases) {
    try {
      const res = await mailtmFetch(base, "/token", { method: "POST", body: { address, password } });
      if (res.ok) {
        const { token } = await res.json();
        if (token) {
          mailtmSessions.set(address, { token, password, base });
          return { token, base };
        }
        lastErr = new Error(`mail.tm token: empty response @ ${base}`);
      } else {
        lastErr = new Error(`mail.tm token ${res.status} @ ${base}`);
      }
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("mail.tm token failed on all endpoints");
}

// One poll of a mail.tm inbox. Returns the NEWEST qualifying code as
// `{ code, receivedAt }` (or null). Newest matters: Instagram invalidates an
// older code the instant it issues a new one (retry/resend), so an earlier code
// still sitting in the inbox would be rejected as "invalid or has expired".
async function fetchEmailCodeMailtm({ to, receivedAfter }) {
  const { token, base } = await mailtmToken(to);
  const listRes = await mailtmFetch(base, "/messages", { token });
  if (listRes.status === 401) {
    // Token expired/invalid — drop it so the next poll re-authenticates.
    const s = mailtmSessions.get(to);
    if (s) s.token = null;
    throw new Error("mail.tm messages 401 (re-auth next poll)");
  }
  if (!listRes.ok) throw new Error(`mail.tm messages ${listRes.status}`);

  // Sort newest first so we always evaluate the most recent code before any
  // older one that IG has already superseded.
  const items = listMembers(await listRes.json())
    .slice()
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

  for (const item of items) {
    const createdAt = item.createdAt ? new Date(item.createdAt).getTime() : 0;
    // Only accept a code at/after the caller's cutoff (drops codes from a prior
    // attempt that IG has since invalidated).
    if (receivedAfter && createdAt && createdAt < receivedAfter) continue;
    let code = extractCode(item.subject) || extractCode(item.intro);
    if (!code && item.id) {
      const msgRes = await mailtmFetch(base, `/messages/${item.id}`, { token });
      if (msgRes.ok) {
        const msg = await msgRes.json();
        code =
          extractCode(msg?.subject) ||
          extractCode(msg?.intro) ||
          extractCode(msg?.text) ||
          extractCode(msg?.html);
      }
    }
    if (code) return { code, receivedAt: createdAt || Date.now() };
  }
  return null;
}

// --- IMAP real-inbox provider ------------------------------------------------
// The reliable path: poll a REAL mailbox (Gmail app-password, a custom catch-all
// domain, etc.) over IMAP. Because the address is reputable, Instagram actually
// DELIVERS the code to it instead of dropping it like it does for disposable
// domains. We connect once per wait, then re-search on an interval.

// Builds a fresh, IG-friendly address that still lands in the one mailbox we
// read. Priority: catch-all domain (best: unlimited <slug>@yourdomain), then
// alias of the base account (plus/dot/none).
function imapAliasFor(slug) {
  const { catchAllDomain, aliasBase, aliasMode } = config.verification.imap;
  const clean = String(slug).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24) || `u${Date.now().toString(36)}`;
  if (catchAllDomain) return `${clean}@${catchAllDomain}`;
  if (!aliasBase || !aliasBase.includes("@")) {
    throw new Error("EMAIL_PROVIDER=imap needs EMAIL_CATCHALL_DOMAIN or a full EMAIL_ALIAS_BASE (e.g. you@gmail.com)");
  }
  const [local, domain] = aliasBase.split("@");
  if (aliasMode === "none") return aliasBase;
  if (aliasMode === "dot") {
    // Gmail ignores dots in the local part, so a dotted variant is a distinct
    // address to IG but the same inbox to us. Derive dot positions from the slug
    // so different signups get different variants.
    const chars = local.split("");
    let seed = 0;
    for (const c of clean) seed = (seed * 31 + c.charCodeAt(0)) >>> 0;
    const out = [chars[0]];
    for (let i = 1; i < chars.length; i++) {
      if ((seed >> (i % 31)) & 1) out.push(".");
      out.push(chars[i]);
    }
    return `${out.join("")}@${domain}`;
  }
  // Default: plus-addressing — unlimited and unambiguous.
  return `${local}+${clean}@${domain}`;
}

// Soft-decodes quoted-printable so a code split across a line break (e.g.
// "12=\r\n3456") or hex-escaped digits are still matched. Safe to run over a
// whole raw message when we only care about a numeric run.
function decodeQuotedPrintable(s) {
  if (!s) return "";
  return String(s)
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

const IG_SENDER_RE = /(instagram|facebookmail|meta|mail\.instagram)/i;

// Rejects if `p` doesn't settle within `ms`. Critical for IMAP: imapflow's
// connect()/auth can hang indefinitely against a misbehaving server, which would
// otherwise stall the whole signup flow (it awaits the code) — the wait loop's
// own deadline can't help if a single connect() never returns.
function withTimeout(p, ms, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, guard]).finally(() => clearTimeout(timer));
}

const IMAP_OPTS = {
  // Bound every phase so nothing can hang the flow.
  connectionTimeout: 15000,
  greetingTimeout: 10000,
  socketTimeout: 30000,
  logger: false,
  emitLogs: false,
};

// Opens an imapflow client with hard timeouts, cleaning up on failure so a
// half-open socket can't keep the process alive.
async function imapConnect(ImapFlow) {
  const { host, port, secure, user, pass } = config.verification.imap;
  const client = new ImapFlow({ host, port, secure, auth: { user, pass }, ...IMAP_OPTS });
  try {
    await withTimeout(client.connect(), 20000, "IMAP connect");
  } catch (err) {
    try {
      client.close();
    } catch {
      /* ignore */
    }
    throw err;
  }
  return client;
}

// One IMAP search pass. Prefers a message addressed to our exact alias; falls
// back to any Instagram-sent message in the window so a To-header rewrite can't
// make us miss the code. Returns { code, receivedAt } or null.
async function imapFindCode(client, { to, receivedAfter, mailbox }) {
  const lock = await client.getMailboxLock(mailbox);
  try {
    const since = new Date(typeof receivedAfter === "number" ? receivedAfter : Date.now() - 90000);
    let uids = [];
    try {
      uids = (await client.search({ since }, { uid: true })) || [];
    } catch {
      uids = [];
    }
    if (!uids.length) return null;
    const wanted = to ? String(to).toLowerCase() : null;
    let fallback = null;
    // Newest first, capped so a busy inbox doesn't make each poll crawl.
    for (const uid of uids.slice(-20).reverse()) {
      let msg;
      try {
        msg = await client.fetchOne(uid, { uid: true, envelope: true, source: true });
      } catch {
        continue;
      }
      if (!msg) continue;
      const env = msg.envelope || {};
      const createdAt = env.date ? new Date(env.date).getTime() : Date.now();
      if (receivedAfter && createdAt && createdAt < receivedAfter) continue;

      const raw = msg.source ? decodeQuotedPrintable(msg.source.toString("utf8")) : "";
      const code = extractCode(env.subject) || extractCode(raw);
      if (!code) continue;

      const recipients = [...(env.to || []), ...(env.cc || [])].map((a) => (a.address || "").toLowerCase());
      const fromIG = (env.from || []).some((a) => IG_SENDER_RE.test(a.address || ""));
      if (!wanted || recipients.includes(wanted)) return { code, receivedAt: createdAt };
      if (fromIG && !fallback) fallback = { code, receivedAt: createdAt };
    }
    return fallback;
  } finally {
    lock.release();
  }
}

// Runs the full wait loop against a real mailbox: connect once, then poll +
// honor manual dashboard entry until the deadline. Resolves { code, receivedAt }
// or null on timeout. imapflow is imported lazily so the dependency is only
// required when EMAIL_PROVIDER=imap.
async function waitForEmailCodeImap({ influencerId, to, receivedAfter, deadline, intervalMs }) {
  const { host, user, pass, mailbox } = config.verification.imap;
  if (!host || !user || !pass) {
    throw new Error("EMAIL_PROVIDER=imap needs IMAP_HOST, IMAP_USER and IMAP_PASS");
  }
  let ImapFlow;
  try {
    ({ ImapFlow } = await import("imapflow"));
  } catch (err) {
    throw new Error(`imapflow not installed (run: npm i imapflow): ${err.message}`);
  }

  let client = null;
  try {
    try {
      client = await imapConnect(ImapFlow);
      log.info(`IMAP connected (${user}@${host}); watching "${mailbox}" for`, to);
    } catch (err) {
      log.warn("IMAP connect failed (will keep checking manual codes):", err.message);
    }
    while (Date.now() < deadline) {
      const manual = takeManualCode(influencerId, "email");
      if (manual) return { code: manual, receivedAt: Date.now() };
      if (!client || !client.usable) {
        try {
          client = await imapConnect(ImapFlow);
        } catch (err) {
          log.warn("IMAP reconnect failed:", err.message);
        }
      }
      if (client && client.usable) {
        try {
          const hit = await withTimeout(
            imapFindCode(client, { to, receivedAfter, mailbox }),
            20000,
            "IMAP search"
          );
          if (hit) return hit;
        } catch (err) {
          log.warn("IMAP search error:", err.message);
          // A stuck client won't recover; drop it so the next loop reconnects.
          try {
            client.close();
          } catch {
            /* ignore */
          }
          client = null;
        }
      }
      await sleep(intervalMs);
    }
    return null;
  } finally {
    if (client) await client.logout().catch(() => {});
  }
}

// --- Email providers ---------------------------------------------------------

// Mailosaur has no single "await" REST endpoint — the SDKs implement waiting by
// polling `POST /api/messages/search` (which returns summaries only) and then
// fetching the full message via `GET /api/messages/:id` for its body/subject.
// We mirror that here: one search + one retrieve per poll. `receivedAfter`
// scopes the search to messages that arrived after signup began so we never
// match a stale verification code from an earlier run.
async function fetchEmailCodeMailosaur({ to, receivedAfter }) {
  const { emailApiKey, mailosaurServerId } = config.verification;
  const auth = "Basic " + Buffer.from(`api:${emailApiKey}`).toString("base64");

  const searchUrl = `https://mailosaur.com/api/messages/search?server=${mailosaurServerId}${
    receivedAfter ? `&receivedAfter=${encodeURIComponent(new Date(receivedAfter).toISOString())}` : ""
  }`;
  const searchRes = await fetch(searchUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: auth },
    body: JSON.stringify({ sentTo: to }),
  });
  if (!searchRes.ok) throw new Error(`Mailosaur search ${searchRes.status}`);
  const { items } = await searchRes.json();
  const summary = items?.[0];
  if (!summary) return null;

  // The subject often already contains the code; if so we can skip the retrieve.
  const fromSubject = extractCode(summary.subject);
  if (fromSubject) return fromSubject;

  if (!summary.id) return null;
  const msgRes = await fetch(`https://mailosaur.com/api/messages/${summary.id}`, {
    headers: { Authorization: auth },
  });
  if (!msgRes.ok) throw new Error(`Mailosaur get ${msgRes.status}`);
  const msg = await msgRes.json();
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
// Resolves with `{ code, receivedAt }` (or throws on timeout). `receivedAfter`
// (epoch ms) is the cutoff for which a code is still valid: only messages that
// arrived at/after it are accepted, so a code IG has already superseded (from an
// earlier attempt or a previous send) is never returned. Callers pass the time
// just after they triggered/expected a fresh code; defaults to ~90s ago.
export async function waitForEmailCode({
  influencerId,
  to,
  timeoutMs = 180000,
  intervalMs = 6000,
  receivedAfter,
} = {}) {
  const provider = config.verification.emailProvider;
  log.info(`Waiting for email code via "${provider}" for`, to);
  const since = typeof receivedAfter === "number" ? receivedAfter : Date.now() - 90000;
  const deadline = Date.now() + timeoutMs;

  // IMAP manages its own connection across the whole wait (connect once, poll
  // many) rather than reconnecting every interval, so it gets its own loop.
  if (provider === "imap") {
    const hit = await waitForEmailCodeImap({ influencerId, to, receivedAfter: since, deadline, intervalMs });
    if (hit) return hit;
    throw new Error("Timed out waiting for email verification code (IMAP)");
  }

  while (Date.now() < deadline) {
    const manual = takeManualCode(influencerId, "email");
    if (manual) return { code: manual, receivedAt: Date.now() };
    try {
      if (provider === "maildotm") {
        const hit = await fetchEmailCodeMailtm({ to, receivedAfter: since });
        if (hit) return hit;
      } else if (provider === "mailosaur" && config.verification.emailApiKey) {
        const code = await fetchEmailCodeMailosaur({ to, receivedAfter: since });
        if (code) return { code, receivedAt: Date.now() };
      }
    } catch (err) {
      log.warn("email provider error:", err.message);
    }
    await sleep(intervalMs);
  }
  throw new Error("Timed out waiting for email verification code");
}

// Diagnostic snapshot of what's CURRENTLY visible in `address`'s inbox for the
// configured provider — powers `npm run probe:email`. Lets you confirm, after a
// signup attempt, whether Instagram actually delivered a code (vs. the address
// being silently blocked). Best-effort; throws on auth/connection failure.
export async function inboxSnapshot(address, { sinceMs = 30 * 60 * 1000 } = {}) {
  const provider = config.verification.emailProvider;
  const since = Date.now() - sinceMs;

  if (provider === "maildotm") {
    const { token, base } = await mailtmToken(address);
    const res = await mailtmFetch(base, "/messages", { token });
    if (!res.ok) throw new Error(`mail.tm messages ${res.status}`);
    const items = listMembers(await res.json());
    return {
      provider,
      address,
      base,
      messages: items.map((m) => ({
        from: m.from?.address || "",
        to: (m.to || []).map((t) => t.address).join(", "),
        subject: m.subject || "",
        receivedAt: m.createdAt || "",
        code: extractCode(m.subject) || extractCode(m.intro) || null,
      })),
    };
  }

  if (provider === "imap") {
    const { host, user, pass, mailbox } = config.verification.imap;
    if (!host || !user || !pass) throw new Error("IMAP_HOST, IMAP_USER and IMAP_PASS required");
    const { ImapFlow } = await import("imapflow");
    const client = await imapConnect(ImapFlow);
    const lock = await client.getMailboxLock(mailbox);
    try {
      const uids = (await client.search({ since: new Date(since) }, { uid: true })) || [];
      const messages = [];
      for (const uid of uids.slice(-25).reverse()) {
        const msg = await client.fetchOne(uid, { uid: true, envelope: true, source: true }).catch(() => null);
        if (!msg) continue;
        const env = msg.envelope || {};
        const raw = msg.source ? decodeQuotedPrintable(msg.source.toString("utf8")) : "";
        messages.push({
          from: (env.from || []).map((a) => a.address).join(", "),
          to: [...(env.to || []), ...(env.cc || [])].map((a) => a.address).join(", "),
          subject: env.subject || "",
          receivedAt: env.date || "",
          code: extractCode(env.subject) || extractCode(raw) || null,
        });
      }
      return { provider, address, mailbox, messages };
    } finally {
      lock.release();
      await client.logout().catch(() => {});
    }
  }

  return { provider, address, messages: [] };
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
