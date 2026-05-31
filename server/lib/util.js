import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { createLogger } from "./logger.js";

const mediaLog = createLogger("media");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Hard constraint for all influencer image generation (profile + posts). Models
// often interpret "Instagram story" / "phone snapshot" as rendering app chrome.
export const PHOTO_NO_UI_RULE =
  "CRITICAL — the output must be ONE clean photograph only, with zero UI: " +
  "no screenshot framing, no picture-of-a-phone-screen, no Instagram/TikTok/" +
  "Snapchat/Facebook/Messages UI, no story bars or stickers, no chat bubbles, " +
  "no notification banners, no like/comment/share buttons, no status bars, " +
  "no watermarks, no captions burned into the image, no app chrome of any kind. " +
  "If a phone appears, only the back, edge, or case — never an on-screen interface.";

// Common given names and surnames for onboarding (see nameLists.js).
export { FIRST_NAMES, LAST_NAMES, formatNameListsForPrompt } from "./nameLists.js";

// The "amateur phone-photo" look applied to influencer images so they read as
// authentic real-person snapshots rather than polished studio shots. Shared by
// Gemini Nano Banana image generation so the aesthetic can be tuned in one
// place. `selfie` toggles the self-taken front-camera framing vs. the default
// casual "friend shot" — a candid iPhone photo of the person taken by someone
// else (or a propped-up phone) in the setting. We DEFAULT to the friend shot
// because it reads as the most authentic, natural influencer photo; selfie
// framing is opt-in for the occasional close phone-in-hand / mirror post where
// it genuinely fits.
//
// `hasReference` matters for identity fidelity: when a reference profile photo
// is supplied to the image model, the FACE and SKIN TONE must come from that
// photo, not from text. So with a reference we (1) DROP the generic facial
// attractiveness description (symmetrical face, clear skin, etc.) because it
// competes with the reference and makes the model invent a new face/skin tone,
// and (2) DROP the front-camera face-warping, which fights face fidelity. The
// body/styling/attractiveness text is only used when there's no reference.
function amateurPhotoStyle({ selfie = false, hasReference = false } = {}) {
  const framing = selfie
    ? (hasReference
        ? "A selfie that the person took themselves on an iPhone front-facing " +
          "camera, held at arm's length. The arm holding the phone is visible " +
          "reaching toward the camera, OR it is a mirror selfie with the phone " +
          "in hand (back of phone or blank screen only — never app UI on screen). " +
          "Close, slightly-too-near crop typical of a " +
          "front-facing phone camera, but WITHOUT distorting or reshaping the " +
          "face — keep the face's true proportions and identity. It must " +
          "obviously look like a self-taken iPhone photo, NOT a photo taken by " +
          "someone else and NOT a professional or content-creator shot. "
        : "A selfie that the person took themselves on a smartphone front-facing " +
          "camera, held at arm's length. The arm holding the phone is visible " +
          "reaching toward the camera, OR it is a mirror selfie with the phone " +
          "in hand (back of phone or blank screen only — never app UI on screen). " +
          "Close arm's-length crop typical of a " +
          "front-facing phone camera, but WITHOUT distorting or reshaping the " +
          "face — keep natural, conventionally attractive facial proportions. " +
          "It must obviously look like a self-taken phone photo, NOT a photo " +
          "taken by someone else and NOT a professional or content-creator shot. ")
    : hasReference
      ? "A casual iPhone snapshot of the person in the scene, taken by a friend " +
        "holding an iPhone or on a propped-up phone — natural, slightly imperfect " +
        "framing, not a selfie, not a posed professional or content-creator shot. "
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
  // On the reference (post) path we keep skin tone stable but lighting should
  // still look like a real iPhone snap — "soft, even" reads too professional.
  const lighting = hasReference
    ? "Shot on an iPhone (front camera for selfies, rear camera for scene shots). " +
      "Everyday iPhone lighting: a little uneven and imperfect — window light, " +
      "overhead room light, or flat indoor light with mixed color temperatures. " +
      "NOT soft studio light, NOT golden-hour glow, NOT ring light, NOT " +
      "three-point lighting, NOT cinematic or professional photoshoot lighting. " +
      "Exposure and white balance must keep the face at the reference skin tone — " +
      "do NOT brighten, lighten, or wash out the face. "
    : "Everyday phone-camera lighting: soft window daylight, warm indoor light, " +
      "or a mild on-camera flash — natural and a little uneven, but still " +
      "flattering enough to read as a photo someone would actually post. Not a " +
      "professional studio setup, no ring light, no three-point lighting, no " +
      "heavy color grading. ";

  // Post/reference images only: push hard away from polished DSLR/influencer look.
  const iphoneLook = hasReference
    ? "Must read as a casual iPhone photo someone actually posted — NOT a DSLR, " +
      "NOT portrait-mode background blur, NOT an influencer photoshoot, NOT " +
      "cinematic color grading. Slight iPhone JPEG compression, a little grain, " +
      "mild phone-camera softness, slightly off-center or imperfect framing, " +
      "casual in-the-moment social-post energy (the photo itself only — never " +
      "rendered inside an app frame). "
    : "";

  const capture =
    "The PHOTO itself (not the person) is a candid, un-staged everyday phone " +
    "snapshot — a real photo file, NOT a screenshot of a social app. " +
    lighting +
    skin +
    iphoneLook +
    (hasReference
      ? "Authentic amateur iPhone snapshot — never polished, never professional-looking."
      : "Authentic phone snapshot — the kind of flattering casual photo someone " +
        "would actually pick as their profile photo: casual and real, but she looks " +
        "conventionally attractive with a warm, confident expression and a " +
        "becoming angle. NOT a professional studio shoot, NOT airbrushed or " +
        "plastic skin, NOT an uncanny AI-perfect face.");

  return framing + subject + capture;
}

// Wraps a per-influencer description in the amateur phone-photo style frame.
// When `hasReference` is true a profile photo is being supplied to the image
// model as a subject reference, so the prompt instructs the model to KEEP that
// exact person's identity and only change the scene — this is what keeps posts
// looking like the same person as the profile photo. `selfie` controls framing
// and defaults to false — a casual iPhone "friend shot" rather than a selfie.
export function buildInfluencerImagePrompt(
  description,
  { hasReference = false, selfie = false } = {}
) {
  const style = amateurPhotoStyle({ selfie, hasReference });
  const noUi = PHOTO_NO_UI_RULE;
  if (hasReference) {
    return (
      "The provided reference photo IS the person. Copy her identity from the " +
      "reference only: facial structure, every facial feature, skin tone and " +
      "complexion, hair, body type and build, and distinguishing marks — " +
      "reproduce these faithfully. This is the SAME real individual, not a " +
      "lookalike: a stranger comparing the two photos should have zero doubt it " +
      "is the same person. Do NOT redesign, beautify, lighten, darken, slim, " +
      "age, or otherwise change who she is. Do NOT copy the reference photo's " +
      "clothing, background, location, pose, body position, camera angle, crop, " +
      "or expression — use the scene description for outfit, setting, pose, and " +
      "action instead. The text below describes ONLY the new photo's scene and " +
      "how it is shot — never how the person looks. Generate a NEW candid photo " +
      "of this exact person in a fresh pose and framing. " +
      style +
      noUi +
      ` Scene for this new photo: ${description}`
    );
  }
  return `${style}${noUi} Description: ${description}`;
}

// Resolve a /media URL or relative path to an absolute file under MEDIA_DIR.
// /media/... URLs must be handled before path.isAbsolute — on Unix they start
// with "/" and would otherwise be treated as filesystem-root paths (e.g.
// "/media/previews/foo.png" instead of "<repo>/media/previews/foo.png").
function resolveMediaAbsPath(urlOrPath) {
  const raw = String(urlOrPath || "").trim();
  if (raw.startsWith("/media/")) {
    return path.resolve(config.mediaDir, raw.slice("/media/".length));
  }
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(config.mediaDir, raw);
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

// Normalizes a stored media reference for browser <img src> (relative /media/…).
export function clientMediaUrl(stored) {
  if (!stored) return null;
  const s = String(stored).trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/media/")) return s;
  if (path.isAbsolute(s)) return mediaUrl(s);
  return s.startsWith("/") ? s : `/media/${s.replace(/^\//, "")}`;
}

// Parses Instagram-style counts ("71.2k", "2,552", "1.2M") to a number.
export function parseSocialCount(raw) {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const t = String(raw).trim().toLowerCase().replace(/,/g, "");
  if (!t) return null;
  const m = t.match(/^([\d.]+)\s*([kmb])?$/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const suffix = m[2];
  if (suffix === "k") n *= 1_000;
  else if (suffix === "m") n *= 1_000_000;
  else if (suffix === "b") n *= 1_000_000_000;
  return Math.round(n);
}

const PROXY_IMAGE_HOST =
  /(?:^|\.)cdninstagram\.com$|(?:^|\.)fbcdn\.net$|(?:^|\.)instagram\.com$/i;

// Rewrites Instagram CDN URLs through our proxy so the browser can load them.
export function proxiedImageUrl(url) {
  if (!url) return null;
  const s = String(url).trim();
  if (s.startsWith("/media/") || s.startsWith("/api/proxy-image")) return s;
  if (/^https?:\/\//i.test(s)) {
    try {
      const host = new URL(s).hostname;
      if (PROXY_IMAGE_HOST.test(host)) {
        return `/api/proxy-image?url=${encodeURIComponent(s)}`;
      }
    } catch {
      return null;
    }
    return s;
  }
  return clientMediaUrl(s);
}

// Returns a loadable /media URL only when the file exists on disk (or an http URL).
export async function resolveContentImageUrl(stored) {
  const url = clientMediaUrl(stored);
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/media/")) {
    const rel = url.slice("/media/".length);
    const abs = path.resolve(config.mediaDir, rel);
    try {
      await access(abs);
      return url;
    } catch {
      return null;
    }
  }
  return url;
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
