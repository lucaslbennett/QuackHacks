import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { createLogger } from "./logger.js";

const mediaLog = createLogger("media");

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

// The "amateur phone-photo" look applied to influencer images so they read as
// authentic real-person snapshots rather than polished studio shots. Shared by
// Gemini Nano Banana image generation so the aesthetic can be tuned in one
// place. `selfie` toggles the self-taken front-camera framing (used for
// portraits and selfie-style posts) vs. a normal candid photo taken of the
// person (used for scene posts where a selfie framing would look forced).
//
// `hasReference` matters for identity fidelity: when a reference profile photo
// is supplied to the image model, the FACE and SKIN TONE must come from that
// photo, not from text. So with a reference we (1) DROP the generic facial
// attractiveness description (symmetrical face, clear skin, etc.) because it
// competes with the reference and makes the model invent a new face/skin tone,
// and (2) DROP the front-camera face-warping, which fights face fidelity. The
// body/styling/attractiveness text is only used when there's no reference.
function amateurPhotoStyle({ selfie = true, hasReference = false } = {}) {
  const framing = selfie
    ? "A selfie that the person took themselves on a smartphone front-facing " +
      "camera, held at arm's length. The arm holding the phone is visible " +
      "reaching toward the camera, OR it is a mirror selfie with the phone " +
      "clearly visible in hand. Close, slightly-too-near crop" +
      (hasReference
        ? " typical of a front-facing phone camera, but WITHOUT distorting or " +
          "reshaping the face — keep the face's true proportions and identity. "
        : " with mild front-camera wide-angle lens distortion (face a little " +
          "enlarged, slightly warped proportions). ") +
      "It must obviously look like a self-taken phone photo, NOT a photo taken " +
      "by someone else and NOT a professional or content-creator shot. "
    : "A casual phone snapshot of the person in the scene, taken by a friend or " +
      "on a propped-up phone — natural framing, not a selfie, not a posed " +
      "professional or content-creator shot. ";

  // SUBJECT description is ONLY used without a reference. With a reference the
  // person's looks are defined by the reference photo, so we say nothing about
  // their face/skin/figure here (that would override the reference).
  const subject = hasReference
    ? ""
    : "The person is strikingly attractive and photogenic — naturally " +
      "beautiful, with a symmetrical face, clear healthy skin, good bone " +
      "structure, an appealing fit/toned figure, and a flattering hairstyle. " +
      "They are well groomed with tasteful, on-trend styling and outfit, and a " +
      "warm, confident, naturally engaging expression. Think a conventionally " +
      "good-looking real person who happens to take casual photos. ";

  // CAPTURE: only the photography is amateur/imperfect — NOT the person. With a
  // reference, this describes ONLY how the photo is rendered (texture/grain) and
  // says nothing about the person's actual skin/complexion — that comes wholly
  // from the reference image, including under the new lighting.
  const skin = hasReference
    ? "Render the skin with realistic phone-camera texture (visible pores, NOT " +
      "plastic, NOT over-smoothed, NOT airbrushed). Reproduce the EXACT skin " +
      "tone, depth, and undertone from the reference image. Do NOT lighten, " +
      "brighten, whiten, wash out, desaturate, or warm the complexion under any " +
      "lighting — preserve a deep/dark complexion at its true depth. Choose the " +
      "exposure and white balance so the rendered skin tone matches the " +
      "reference; if uncertain, err toward the reference's true, deeper tone " +
      "rather than a lighter version. "
    : "Slight phone-camera softness, a little grain, and realistic skin texture " +
      "with visible pores (NOT plastic, NOT over-smoothed, NOT airbrushed) — " +
      "but clear, attractive skin without distracting blemishes or heavy oil " +
      "shine. ";

  // LIGHTING: on the no-reference path we allow warm/flash looks for variety.
  // On the reference path we keep lighting tone-NEUTRAL — flash, "warm", and
  // "flattering" all bias the render lighter/warmer and pull skin tone away from
  // the reference (worst on darker complexions), so they're removed there.
  const lighting = hasReference
    ? "Everyday phone-camera lighting: soft, even, natural ambient light with a " +
      "neutral white balance and no strong warm or cool color cast on the skin. " +
      "Natural, accurate exposure that does NOT brighten, lighten, or wash out " +
      "the face. Not a professional studio setup, no ring light, no three-point " +
      "lighting, no flash, no heavy color grading. "
    : "Everyday phone-camera lighting: soft window daylight, warm indoor light, " +
      "or a mild on-camera flash — natural and a little uneven, but still " +
      "flattering enough to read as a photo someone would actually post. Not a " +
      "professional studio setup, no ring light, no three-point lighting, no " +
      "heavy color grading. ";

  const capture =
    "The PHOTO itself (not the person) is a candid, un-staged everyday phone " +
    "snapshot posted to Instagram or Snapchat. " +
    lighting +
    skin +
    "Authentic amateur snapshot framing and capture. Avoid an obviously posed, " +
    "glamour, or AI-perfect look.";

  return framing + subject + capture;
}

// Wraps a per-influencer description in the amateur phone-photo style frame.
// When `hasReference` is true a profile photo is being supplied to the image
// model as a subject reference, so the prompt instructs the model to KEEP that
// exact person's identity and only change the scene — this is what keeps posts
// looking like the same person as the profile photo. `selfie` controls framing.
export function buildInfluencerImagePrompt(
  description,
  { hasReference = false, selfie = true } = {}
) {
  const style = amateurPhotoStyle({ selfie, hasReference });
  if (hasReference) {
    return (
      "The provided reference photo IS the person. Take their entire physical " +
      "appearance wholesale from that image — facial structure, every facial " +
      "feature, skin tone and complexion, hair, body type, and all " +
      "distinguishing marks — and reproduce it faithfully. This is the SAME real " +
      "individual, not a lookalike: a stranger comparing the two photos should " +
      "have zero doubt it is the same person. Do NOT redesign, beautify, " +
      "lighten, darken, slim, age, or otherwise change how they look in any way; " +
      "your only job for the person is to carry their exact appearance over " +
      "unchanged. The text below describes ONLY the new photo's scene and how it " +
      "is shot — never how the person looks. Generate a NEW candid photo of this " +
      "exact person in which only the setting, pose, outfit, expression, and " +
      "lighting differ. " +
      style +
      ` Scene for this new photo: ${description}`
    );
  }
  return `${style} Description: ${description}`;
}

// Resolve a /media URL or relative path to an absolute file under MEDIA_DIR.
function resolveMediaAbsPath(urlOrPath) {
  if (path.isAbsolute(urlOrPath)) return urlOrPath;
  if (urlOrPath.startsWith("/media/")) {
    return path.resolve(config.mediaDir, urlOrPath.slice("/media/".length));
  }
  return path.resolve(config.mediaDir, urlOrPath);
}

function mimeFromPath(abs) {
  const ext = path.extname(abs).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

// Loads a previously-generated /media image (by its public URL or absolute
// path) back off disk as base64 so it can be passed to the Gemini image model
// as a subject-reference. Tries local MEDIA_DIR first, then fetches over HTTP
// from PUBLIC_BASE_URL when the file isn't on this machine (common when the DB
// points at media created on another host, e.g. local dev + Railway Postgres).
// Returns { data, mimeType, source } or null if it can't be read.
export async function loadMediaAsBase64(urlOrPath) {
  if (!urlOrPath) return null;

  const abs = resolveMediaAbsPath(urlOrPath);

  try {
    const buf = await readFile(abs);
    return { data: buf.toString("base64"), mimeType: mimeFromPath(abs), source: "disk" };
  } catch (err) {
    mediaLog.warn(
      "local media read failed:",
      urlOrPath,
      "resolved=",
      abs,
      err?.code || err?.message || err
    );
  }

  // Fallback: fetch from the public server URL if configured.
  const mediaUrlPath = urlOrPath.startsWith("/media/")
    ? urlOrPath
    : urlOrPath.startsWith("http")
      ? null
      : `/media/${urlOrPath.split(path.sep).join("/")}`;

  if (mediaUrlPath && config.publicBaseUrl) {
    const fetchUrl = `${config.publicBaseUrl}${mediaUrlPath}`;
    try {
      const res = await fetch(fetchUrl);
      if (!res.ok) {
        mediaLog.warn("HTTP media fetch failed:", fetchUrl, "status=", res.status);
        return null;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || mimeFromPath(abs);
      mediaLog.info("loaded media over HTTP:", fetchUrl, `bytes=${buf.length}`);
      return { data: buf.toString("base64"), mimeType, source: "http" };
    } catch (err) {
      mediaLog.warn("HTTP media fetch error:", fetchUrl, err?.message || err);
    }
  } else if (mediaUrlPath && !config.publicBaseUrl) {
    mediaLog.warn(
      "cannot HTTP-fetch missing media; set PUBLIC_BASE_URL (or deploy on Railway with RAILWAY_PUBLIC_DOMAIN):",
      urlOrPath
    );
  }

  return null;
}

// Copies an influencer's profile image into their own media folder so it isn't
// stuck under previews/ and is easier to find on a persistent volume. Returns
// the new /media URL, or the original when the source can't be loaded.
export async function persistInfluencerProfileImage(influencerId, imageUrl) {
  if (!influencerId || !imageUrl) return imageUrl;

  const loaded = await loadMediaAsBase64(imageUrl);
  if (!loaded) return imageUrl;

  const dest = await mediaPath(influencerId, "profile.png");
  await writeFile(dest, Buffer.from(loaded.data, "base64"));
  const url = mediaUrl(dest);
  mediaLog.info("persisted profile image:", imageUrl, "->", url, `via=${loaded.source}`);
  return url;
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
