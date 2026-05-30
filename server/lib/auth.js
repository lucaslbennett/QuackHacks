import crypto from "node:crypto";
import { config } from "../config.js";
import * as repo from "../db/repo.js";

// Password hashing with Node's built-in scrypt. No external deps needed.
// Stored format: scrypt:<saltBase64>:<hashBase64>
const SCRYPT_KEYLEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
  return `scrypt:${salt.toString("base64")}:${hash.toString("base64")}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith("scrypt:")) return false;
  const [, saltB64, hashB64] = stored.split(":");
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const actual = crypto.scryptSync(String(password), salt, expected.length);
  // Constant-time comparison to avoid leaking timing information.
  return (
    actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
  );
}

// Session tokens: a random opaque string given to the client; only its SHA-256
// hash is persisted, so a leaked DB never exposes usable tokens.
export function generateToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

export function sessionExpiry() {
  const ms = config.auth.sessionTtlDays * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms);
}

// Strips sensitive fields before returning a user over the wire.
export function publicUser(user) {
  if (!user) return null;
  const { password_hash, ...safe } = user;
  return safe;
}

// Creates a session row and returns the raw token to hand to the client.
export async function issueSession(userId) {
  const token = generateToken();
  await repo.sessions.create({
    userId,
    tokenHash: hashToken(token),
    expiresAt: sessionExpiry(),
  });
  return token;
}

function readBearer(req) {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

// Resolves the current user from the bearer token, or null. Never throws.
export async function loadUserFromRequest(req) {
  const token = readBearer(req);
  if (!token) return null;
  const session = await repo.sessions.getValidByTokenHash(hashToken(token));
  if (!session) return null;
  return repo.users.getById(session.user_id);
}

// Attaches req.user when a valid session is present, but allows the request
// through either way. Useful for routes that behave differently when logged in.
export async function optionalAuth(req, _res, next) {
  try {
    req.user = await loadUserFromRequest(req);
  } catch {
    req.user = null;
  }
  next();
}

// Rejects the request with 401 unless a valid session is present.
export async function requireAuth(req, res, next) {
  try {
    const user = await loadUserFromRequest(req);
    if (!user) return res.status(401).json({ ok: false, error: "unauthorized" });
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
