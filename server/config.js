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
    // Custom EXTERNAL proxy for the browser session. The point of this is to make
    // the session egress from the SAME IP that CapSolver solves from (set
    // CAPSOLVER_PROXY to the same value): reCAPTCHA Enterprise rejects a token
    // whose solve IP/fingerprint doesn't match the page's, so matching them is
    // what lets an injected token actually clear IG's challenge.
    proxyServer: process.env.BROWSERBASE_PROXY_SERVER || "",
    proxyUsername: process.env.BROWSERBASE_PROXY_USERNAME || "",
    proxyPassword: process.env.BROWSERBASE_PROXY_PASSWORD || "",
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
    // Instagram serves reCAPTCHA *Enterprise* (sitekey 6LdktRgn…). A token solved
    // with the standard v2 task type is REJECTED by IG, so we must use CapSolver's
    // Enterprise task. DOM-based enterprise detection is unreliable (the key and
    // the "/enterprise/" signal can live in different/cross-origin frames), so
    // default this ON to force the Enterprise task type. Set to false only if you
    // ever point this flow at a genuinely non-enterprise reCAPTCHA.
    forceEnterprise: bool(process.env.CAPSOLVER_FORCE_ENTERPRISE, true),
    // Proxy CapSolver should solve THROUGH (format: "scheme:host:port:user:pass"
    // or "host:port:user:pass"). reCAPTCHA Enterprise binds the token to the
    // solver's IP/fingerprint, so a proxyless (datacenter-IP) token is rejected
    // when submitted from the Browserbase session's IP. Set this to the SAME
    // proxy as BROWSERBASE_PROXY_SERVER so the solve IP matches the page IP — that
    // is what makes an Enterprise token actually clear the challenge. When empty,
    // CapSolver solves proxyless (works for non-enterprise, often rejected by IG).
    proxy: process.env.CAPSOLVER_PROXY || "",
  },

  verification: {
    // Pluggable email provider. "imap" | "maildotm" | "mailosaur" | "manual"
    //
    // "imap" (MOST RELIABLE): polls a REAL mailbox over IMAP (e.g. a Gmail with
    // an app password, or any catch-all domain inbox). Because the address is a
    // real, reputable one, Instagram actually DELIVERS the verification email to
    // it — unlike disposable domains, which Meta blocks. Use EMAIL_ALIAS_BASE
    // (e.g. you@gmail.com -> you+ig123@gmail.com) or EMAIL_CATCHALL_DOMAIN
    // (e.g. ig123@yourdomain.com) so every signup gets a fresh-looking address
    // that still lands in the one mailbox we read. THIS is the way to guarantee
    // the inbox receives the code.
    //
    // "maildotm" (mail.tm, zero-config default): provisions a disposable inbox
    // and polls it. No API key, but Meta blocks most disposable domains, so the
    // email frequently never arrives — best for quick local testing only.
    // "mailosaur" does NOT work for IG (it policy-blocks third-party signup
    // emails). "manual" generates a placeholder address for dashboard entry.
    emailProvider: process.env.EMAIL_PROVIDER || "maildotm",
    emailApiKey: process.env.EMAIL_API_KEY || "",
    mailosaurServerId: process.env.MAILOSAUR_SERVER_ID || "",
    // Disposable-mail (mail.tm-compatible) API bases, in priority order. Both
    // mail.tm and its identical-API sibling mail.gw are tried so a single
    // flagged/dead endpoint or domain doesn't sink provisioning. Comma-separated
    // override via MAILTM_API_BASE (keeps backwards compatibility with a single
    // value).
    mailtmApiBases: (process.env.MAILTM_API_BASE || "https://api.mail.tm,https://api.mail.gw")
      .split(",")
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter(Boolean),
    // Optionally pin/avoid specific disposable domains (comma-separated). PIN
    // wins; otherwise the first active public domain not in the skip list is
    // used. Lets you switch off a domain you've seen IG reject.
    mailtmPreferredDomain: (process.env.MAILTM_PREFERRED_DOMAIN || "").trim().toLowerCase(),
    mailtmSkipDomains: (process.env.MAILTM_SKIP_DOMAINS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    // IMAP real-inbox provider config. host/user/pass are required for "imap".
    imap: {
      host: process.env.IMAP_HOST || "",
      port: parseInt(process.env.IMAP_PORT || "993", 10),
      secure: bool(process.env.IMAP_SECURE, true),
      user: process.env.IMAP_USER || "",
      pass: process.env.IMAP_PASS || "",
      mailbox: process.env.IMAP_MAILBOX || "INBOX",
      // The address every alias delivers to (defaults to IMAP_USER). With Gmail
      // this is the bare account; aliases are user+slug@domain (or dotted).
      aliasBase: (process.env.EMAIL_ALIAS_BASE || process.env.IMAP_USER || "").trim().toLowerCase(),
      // "plus" -> you+slug@dom · "dot" -> Gmail dot-variants · "none" -> use the
      // base address verbatim every time (only safe for one signup at a time).
      aliasMode: (process.env.EMAIL_ALIAS_MODE || "plus").trim().toLowerCase(),
      // A catch-all domain you control (every <anything>@domain reaches the IMAP
      // box). When set, addresses are <slug>@<domain> — unlimited, real-looking,
      // and the most IG-friendly option.
      catchAllDomain: (process.env.EMAIL_CATCHALL_DOMAIN || "").trim().toLowerCase(),
    },
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
