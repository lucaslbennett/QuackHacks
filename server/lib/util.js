import { mkdir } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Real, common first names and surnames spanning a range of origins. Sampled
// independently so a generated influencer's name feels like a real person
// rather than a niche pun. Shared by the no-LLM fallback and by the LLM path,
// which is fed a randomly-picked surname so repeated identical inputs don't
// collapse to the same name.
export const FIRST_NAMES = [
  "Maya", "Liam", "Sofia", "Noah", "Aaliyah", "Ethan", "Chloe", "Mateo",
  "Priya", "Lucas", "Amara", "Daniel", "Hana", "Caleb", "Isabella", "Omar",
  "Zoe", "Kai", "Leila", "Marcus", "Nina", "Diego", "Grace", "Ravi",
  "Elena", "Jonah", "Yuki", "Adaeze", "Stella", "Theo",
];
export const LAST_NAMES = [
  "Nguyen", "Okafor", "Castellanos", "Petrov", "Andersen", "Cohen", "Yamamoto",
  "Reyes", "Kowalski", "Mbeki", "Singh", "Rossi", "Adebayo", "Park", "Haddad",
  "Fernandez", "O'Brien", "Schneider", "Ivanova", "Tanaka", "Mensah", "Lindqvist",
  "Delgado", "Bauer", "Khan", "Moreau", "Costa", "Abdi", "Walsh", "Sato",
];

// Wraps a per-influencer description in a fixed style frame so every portrait
// reads like a casual, real-person selfie rather than a polished studio shot.
// Shared by both image backends (fal Nano Banana + Gemini) so the look stays
// consistent and can be tuned in one place.
export function buildInfluencerImagePrompt(description) {
  return (
    "A selfie that the person took themselves on a smartphone front-facing " +
    "camera, held at arm's length. The arm holding the phone is visible " +
    "reaching toward the camera, OR it is a mirror selfie with the phone " +
    "clearly visible in hand. Close, slightly-too-near crop with mild " +
    "front-camera wide-angle lens distortion (face a little enlarged, slightly " +
    "warped proportions). It must obviously look like a self-taken phone photo, " +
    "NOT a photo taken by someone else and NOT a professional or content-creator " +
    "shot. Authentic, candid, slightly awkward everyday moment posted to " +
    "Instagram or Snapchat. Unflattering everyday lighting: harsh direct " +
    "on-camera phone flash OR flat overhead room light OR a bright blown-out " +
    "window behind them, with uneven exposure, mixed color temperatures, " +
    "visible shadows across the face, and slight overexposed highlights on the " +
    "skin. Not soft, not even, not glowy, not golden-hour, no ring light, no " +
    "studio or three-point lighting. Slight phone-camera softness, mild motion " +
    "blur or grain, realistic skin texture with pores, oil shine and minor " +
    "blemishes, relaxed natural or slightly imperfect expression. Amateur " +
    `snapshot aesthetic, no retouching, no glamour. Description: ${description}`
  );
}

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

// Like mediaUrl but absolute, so external services (e.g. Postiz) can fetch it.
// Falls back to the relative path when no public base URL is configured.
export function publicMediaUrl(absPath) {
  const rel = mediaUrl(absPath);
  if (!rel) return null;
  return config.publicBaseUrl ? `${config.publicBaseUrl}${rel}` : rel;
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
