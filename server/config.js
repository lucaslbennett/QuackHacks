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
    videoModel: process.env.FAL_VIDEO_MODEL || "fal-ai/kling-video/v1.6/standard/image-to-video",
  },

  browserbase: {
    apiKey: process.env.BROWSERBASE_API_KEY || "",
    projectId: process.env.BROWSERBASE_PROJECT_ID || "",
    // Stagehand needs a model for its act/extract reasoning. Reuse Gemini.
    env: process.env.STAGEHAND_ENV || "BROWSERBASE",
  },

  verification: {
    // Pluggable email provider. "imap" | "mailosaur" | "manual"
    emailProvider: process.env.EMAIL_PROVIDER || "manual",
    emailApiKey: process.env.EMAIL_API_KEY || "",
    mailosaurServerId: process.env.MAILOSAUR_SERVER_ID || "",
    // Pluggable SMS provider. "twilio" | "sms-activate" | "manual"
    smsProvider: process.env.SMS_PROVIDER || "manual",
    smsApiKey: process.env.SMS_API_KEY || "",
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || "",
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || "",
  },

  scheduler: {
    enabled: bool(process.env.SCHEDULER_ENABLED, true),
    // How often the job runner polls the jobs table (seconds).
    pollSeconds: parseInt(process.env.SCHEDULER_POLL_SECONDS || "20", 10),
  },

  // Where generated media (audio/video/images) gets written.
  mediaDir: process.env.MEDIA_DIR || "media",
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
