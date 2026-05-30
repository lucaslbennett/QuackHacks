import { mkdir } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Returns an absolute path inside the media directory, creating subdirs.
export async function mediaPath(...parts) {
  const dir = path.resolve(config.mediaDir, ...parts.slice(0, -1));
  await mkdir(dir, { recursive: true });
  return path.join(dir, parts[parts.length - 1]);
}

export function mediaUrl(absPath) {
  if (!absPath) return null;
  const rel = path.relative(path.resolve(config.mediaDir), absPath);
  return `/media/${rel.split(path.sep).join("/")}`;
}

// Spreads N posts across the active hours of a day with jitter so cadence
// looks human rather than perfectly periodic.
export function randomizedPostTimes(count, { startHour = 9, endHour = 22, fromDate = new Date() } = {}) {
  const times = [];
  const windowMs = (endHour - startHour) * 60 * 60 * 1000;
  const slot = windowMs / count;
  const base = new Date(fromDate);
  base.setHours(startHour, 0, 0, 0);
  for (let i = 0; i < count; i++) {
    const jitter = randomInt(0, Math.floor(slot * 0.8));
    times.push(new Date(base.getTime() + i * slot + jitter));
  }
  return times;
}

export function safeJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
