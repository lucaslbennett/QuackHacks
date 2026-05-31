import dotenv from "dotenv";

dotenv.config();

const bool = (v, fallback = false) => {
  if (v === undefined || v === null || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
};

// Picks the right Postgres URL for the current runtime.
// - On Railway, the internal host (postgres.railway.internal) is fastest and
//   has no egress cost, so prefer DATABASE_URL there.
// - Locally, the internal host is unreachable, so fall back to the public
//   proxy URL (DATABASE_PUBLIC_URL) automatically.
function resolveDatabaseUrl() {
  const internal = (process.env.DATABASE_URL || "").trim();
  const publicUrl = (process.env.DATABASE_PUBLIC_URL || "").trim();
  const onRailway = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID);
  const internalIsUnreachableLocally = /\.railway\.internal[:/]/.test(internal);

  if (!onRailway && internalIsUnreachableLocally && publicUrl) return publicUrl;
  return internal || publicUrl;
}

export const config = {
  env: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "3000", 10),

  databaseUrl: resolveDatabaseUrl(),

  // Encryption key for IG credentials at rest (32 bytes hex/base64/utf8 ok).
  encryptionKey: process.env.ENCRYPTION_KEY || "",

  auth: {
    // How long an issued login session stays valid.
    sessionTtlDays: parseInt(process.env.SESSION_TTL_DAYS || "30", 10),
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
    model: process.env.GEMINI_MODEL || "gemini-flash-lite-latest",
    // Nano Banana Pro (Gemini 3 Pro Image) for image generation/editing.
    imageModel: process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image-preview",
  },

  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY || "",
    model: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
    // Optional default narrator voice id to fall back to.
    defaultVoiceId: process.env.ELEVENLABS_DEFAULT_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb",
  },

  fal: {
    apiKey: process.env.FAL_KEY || process.env.FAL_API_KEY || "",
    imageModel: process.env.FAL_IMAGE_MODEL || "fal-ai/flux/dev",
    // Nano Banana (text-to-image) used for the onboarding character preview.
    nanoBananaModel: process.env.FAL_NANO_BANANA_MODEL || "fal-ai/nano-banana",
    videoModel: process.env.FAL_VIDEO_MODEL || "fal-ai/kling-video/v1.6/standard/image-to-video",
  },

  browserbase: {
    apiKey: process.env.BROWSERBASE_API_KEY || "",
    projectId: process.env.BROWSERBASE_PROJECT_ID || "",
    // Stagehand needs a model for its act/extract reasoning. Reuse Gemini.
    env: process.env.STAGEHAND_ENV || "BROWSERBASE",
    // Residential proxies reduce how often Instagram throws a CAPTCHA and
    // improve Browserbase's background reCAPTCHA-Enterprise solve rate. PAID
    // plans only — enabling on a free plan makes session creation fail (402),
    // so default OFF and let upgraded projects opt in.
    proxies: bool(process.env.BROWSERBASE_PROXIES, false),
    // "verified" = advanced stealth (real device fingerprint). ENTERPRISE plan
    // only — fails with 403 elsewhere — so default OFF and opt in when eligible.
    verified: bool(process.env.BROWSERBASE_VERIFIED, false),
  },

  // Third-party CAPTCHA solver (CapSolver — https://capsolver.com). When an
  // API key is set we solve reCAPTCHA challenges programmatically (sitekey ->
  // token via API -> inject) as a stronger fallback to Browserbase's plan-gated
  // background solver. This lets the FREE Browserbase plan clear IG's reCAPTCHA
  // Enterprise without residential proxies or a human solve. Disabled (and
  // simply skipped) when no key is present.
  capsolver: {
    apiKey: process.env.CAPSOLVER_API_KEY || "",
    apiBase: (process.env.CAPSOLVER_API_BASE || "https://api.capsolver.com").replace(/\/+$/, ""),
    // How long to poll a created task before giving up, and how often.
    pollIntervalMs: parseInt(process.env.CAPSOLVER_POLL_MS || "3000", 10),
    timeoutMs: parseInt(process.env.CAPSOLVER_TIMEOUT_MS || "120000", 10),
  },

  verification: {
    // Pluggable email provider. "mailosaur" | "manual"
    emailProvider: process.env.EMAIL_PROVIDER || "manual",
    emailApiKey: process.env.EMAIL_API_KEY || "",
    mailosaurServerId: process.env.MAILOSAUR_SERVER_ID || "",
    // Pluggable SMS provider. "twilio" | "sms-activate" | "manual"
    smsProvider: process.env.SMS_PROVIDER || "manual",
    smsApiKey: process.env.SMS_API_KEY || "",
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || "",
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || "",
  },

  // Postiz — social-media scheduling. Used to schedule influencer posts to the
  // connected channels (Instagram, X, TikTok, ...) instead of (or alongside)
  // the Stagehand IG poster. Cloud base URL by default; point at a self-hosted
  // instance via POSTIZ_API_BASE (e.g. https://your-host/public/v1).
  postiz: {
    apiKey: process.env.POSTIZ_API_KEY || "",
    apiBase: (process.env.POSTIZ_API_BASE || "https://api.postiz.com/public/v1").replace(
      /\/+$/,
      ""
    ),
    // Default post type for scheduled posts: "schedule" | "now" | "draft".
    defaultType: process.env.POSTIZ_DEFAULT_TYPE || "schedule",
  },

  scheduler: {
    enabled: bool(process.env.SCHEDULER_ENABLED, true),
    // How often the job runner polls the jobs table (seconds).
    pollSeconds: parseInt(process.env.SCHEDULER_POLL_SECONDS || "20", 10),
    // When true the daily planner schedules posts through Postiz instead of
    // the Stagehand IG poster.
    usePostiz: bool(process.env.SCHEDULER_USE_POSTIZ, false),
  },

  // Where generated media (audio/video/images) gets written.
  mediaDir: process.env.MEDIA_DIR || "media",

  // Public base URL where this server is reachable (e.g. the Railway domain).
  // Needed so external services like Postiz can fetch our generated /media
  // files. On Railway the public domain is exposed as RAILWAY_PUBLIC_DOMAIN.
  publicBaseUrl: (
    process.env.PUBLIC_BASE_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "")
  ).replace(/\/+$/, ""),
};

export function missingKeys() {
  const missing = [];
  if (!config.databaseUrl) missing.push("DATABASE_URL");
  if (!config.gemini.apiKey) missing.push("GEMINI_API_KEY");
  if (!config.elevenlabs.apiKey) missing.push("ELEVENLABS_API_KEY");
  if (!config.fal.apiKey) missing.push("FAL_KEY");
  if (!config.browserbase.apiKey) missing.push("BROWSERBASE_API_KEY");
  if (!config.browserbase.projectId) missing.push("BROWSERBASE_PROJECT_ID");
  return missing;
}
