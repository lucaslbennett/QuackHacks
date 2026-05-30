import crypto from "node:crypto";
import { config } from "../config.js";

const ALGO = "aes-256-gcm";

function getKey() {
  const raw = config.encryptionKey;
  if (!raw) return null;
  // Accept hex, base64, or utf8; normalize to 32 bytes via sha256.
  return crypto.createHash("sha256").update(raw).digest();
}

// Encrypts a string. Returns "plain:<value>" when no key configured so the
// app still functions in a hackathon setup without secrets management.
export function encryptSecret(plaintext) {
  if (plaintext == null) return null;
  const key = getKey();
  if (!key) return `plain:${plaintext}`;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(value) {
  if (value == null) return null;
  if (value.startsWith("plain:")) return value.slice(6);
  if (!value.startsWith("enc:")) return value;
  const key = getKey();
  if (!key) throw new Error("ENCRYPTION_KEY required to decrypt secret");
  const [, ivB64, tagB64, dataB64] = value.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
