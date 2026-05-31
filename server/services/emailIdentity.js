import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { config } from "../config.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("email-identity");

// address (lowercase) -> identity object used to mint it
const addressOwners = new Map();

let state = { burned: [], lastIndex: 0 };
let stateLoaded = false;

function statePath() {
  return join(config.mediaDir, "email_identity_state.json");
}

function loadState() {
  if (stateLoaded) return;
  stateLoaded = true;
  const path = statePath();
  try {
    if (existsSync(path)) {
      state = { burned: [], lastIndex: 0, ...JSON.parse(readFileSync(path, "utf8")) };
    }
  } catch (err) {
    log.warn("Could not read email identity state:", err.message);
  }
  state.burned = [...new Set([...(state.burned || []), ...config.verification.imap.excludeIdentityIds])];
}

function saveState() {
  try {
    const path = statePath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state, null, 2));
  } catch (err) {
    log.warn("Could not persist email identity state:", err.message);
  }
}

/** Canonical identity key Instagram correlates on (plus-base or catch-all domain). */
export function identityKey(identity) {
  if (!identity) return "";
  if (identity.type === "catchall") return `catchall:${identity.domain}`;
  if (identity.type === "plus") return `plus:${identity.aliasBase}`;
  return `direct:${identity.aliasBase || ""}`;
}

/** Derive an identity key from a full signup address. */
export function identityKeyFromAddress(address) {
  const lower = String(address || "").trim().toLowerCase();
  if (!lower.includes("@")) return lower;
  const [local, domain] = lower.split("@");
  const { catchAllDomain, aliasBasePool } = config.verification.imap;

  if (catchAllDomain && domain === catchAllDomain) return `catchall:${domain}`;

  for (const base of aliasBasePool) {
    const [baseLocal, baseDomain] = base.split("@");
    if (domain !== baseDomain) continue;
    if (local === baseLocal) return `plus:${base}`;
    if (local.startsWith(`${baseLocal}+`)) return `plus:${base}`;
  }

  const plusAt = local.indexOf("+");
  if (plusAt >= 0) return `plus:${local.slice(0, plusAt)}@${domain}`;
  return `direct:${lower}`;
}

function buildIdentities() {
  const { catchAllDomain, aliasBase, aliasBasePool, aliasMode } = config.verification.imap;
  loadState();
  const out = [];

  if (catchAllDomain) {
    out.push({ type: "catchall", domain: catchAllDomain, id: `catchall:${catchAllDomain}` });
  }

  // When catch-all is configured it alone provides unlimited unique addresses —
  // don't silently fall back to IMAP_USER / EMAIL_ALIAS_BASE (often the burned base).
  const bases =
    aliasBasePool.length > 0 ? aliasBasePool : catchAllDomain ? [] : aliasBase ? [aliasBase] : [];

  for (const base of bases) {
    if (!base.includes("@")) continue;
    const id = `plus:${base}`;
    if (state.burned.includes(id)) continue;
    if (out.some((i) => i.id === id)) continue;
    out.push({ type: aliasMode === "dot" ? "dot" : "plus", aliasBase: base, id });
  }

  return out;
}

export function listIdentities() {
  loadState();
  return buildIdentities();
}

export function isIdentityBurned(id) {
  loadState();
  return state.burned.includes(id);
}

/** Pick the next non-burned identity (round-robin). Prefers catch-all first. */
export function pickIdentity({ skipId } = {}) {
  loadState();
  const all = buildIdentities();
  if (!all.length) {
    throw new Error(
      "No email identities configured. Add fresh Fastmail aliases to EMAIL_ALIAS_BASES (Settings → My email addresses → New). No DNS required."
    );
  }

  const available = all.filter((i) => !state.burned.includes(i.id) && i.id !== skipId);
  if (!available.length) {
    throw new Error(
      "No email identities available. Create a fresh alias in Fastmail (Settings → My email addresses → New), add it to EMAIL_ALIAS_BASES in .env (comma-separated for rotation), and keep burned bases in EMAIL_EXCLUDE_BASES. No DNS or custom domain required."
    );
  }

  // Catch-all mints a unique address every time — always prefer it when available.
  const catchalls = available.filter((i) => i.type === "catchall");
  const pool = catchalls.length ? catchalls : available;

  const idx = state.lastIndex % pool.length;
  state.lastIndex = idx + 1;
  saveState();

  const picked = pool[idx];
  log.info("Picked email identity", picked.id);
  return picked;
}

export function rememberAddressIdentity(address, identity) {
  if (address && identity) addressOwners.set(String(address).toLowerCase(), identity);
}

export function markIdentityBurned(address, { reason = "unknown" } = {}) {
  loadState();
  const fromMap = addressOwners.get(String(address || "").toLowerCase());
  const id = fromMap ? identityKey(fromMap) : identityKeyFromAddress(address);

  if (!id) return;

  // Integrity flags on catch-all addresses are usually session/IP — don't burn the whole domain.
  if (id.startsWith("catchall:") && reason === "integrity") {
    log.warn(`Not burning ${id} on integrity flag (likely IP/session — address ${address} is still valid)`);
    return;
  }

  if (state.burned.includes(id)) return;

  state.burned.push(id);
  saveState();
  log.warn(`Marked email identity burned (${reason}):`, id, "from", address);
}

export function identityStatus() {
  loadState();
  const all = buildIdentities();
  return {
    identities: all.map((i) => ({ ...i, burned: state.burned.includes(i.id) })),
    burned: [...state.burned],
    lastIndex: state.lastIndex,
  };
}
