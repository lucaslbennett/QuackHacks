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
    // Nano Banana Pro (Gemini 3 Pro Image) — best quality for humans, references,
    // and anatomy. Override with GEMINI_IMAGE_MODEL=gemini-3.1-flash-image for
    // the faster/cheaper Flash lane.
    imageModel: process.env.GEMINI_IMAGE_MODEL || "gemini-3-pro-image",
    // Vision model used to OCR Instagram's distorted "Confirm you're human"
    // image-code challenge. Defaults to the main model (our current LLM); set
    // GEMINI_CAPTCHA_MODEL to a stronger vision model if reads are unreliable.
    captchaModel:
      process.env.GEMINI_CAPTCHA_MODEL || process.env.GEMINI_MODEL || "gemini-flash-lite-latest",
  },

  elevenlabs: {
    apiKey: process.env.ELEVENLABS_API_KEY || "",
    model: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
    // Optional default narrator voice id to fall back to.
    defaultVoiceId: process.env.ELEVENLABS_DEFAULT_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb",
  },

  // Browser Use — remote stealth browser that Stagehand drives over CDP. We keep
  // Stagehand as the automation/reasoning layer (its act/extract API is backend-
  // agnostic) but point it at a Browser Use cloud browser instead of Browserbase.
  //
  // PRIMARY path: we explicitly create a session through Browser Use's authenticated
  // REST API (POST {apiBase}/browsers with X-Browser-Use-API-Key). This is what
  // makes the API key register as "used" and makes each run show up as a real,
  // watchable session (liveUrl) in the Browser Use dashboard. Stagehand then attaches
  // to that session's CDP endpoint (env:"LOCAL" + localBrowserLaunchOptions.cdpUrl).
  //
  // FALLBACK path (useRestSessions=false): connect a raw CDP WebSocket straight to
  // connectHost. This still drives a Browser Use browser, but such sessions do NOT
  // appear in the dashboard's session list and do NOT update the key's "last used".
  browserUse: {
    apiKey: process.env.BROWSER_USE_API_KEY || "",
    // Browser Use Cloud REST API v3 base. Used to create/stop visible sessions.
    apiBase: (process.env.BROWSER_USE_API_BASE || "https://api.browser-use.com/api/v3").replace(
      /\/+$/,
      ""
    ),
    // Create sessions via the REST API (visible in the dashboard, marks key used).
    // Set to false to fall back to the raw connect-URL (invisible) path.
    useRestSessions: bool(process.env.BROWSER_USE_REST_SESSIONS, true),
    // Stagehand still needs an LLM for act()/extract() reasoning. Reuse Gemini.
    env: process.env.STAGEHAND_ENV || "LOCAL",
    // Fallback connectable CDP/WebSocket browser endpoint (used only when
    // useRestSessions is false). Override only if Browser Use changes the host.
    connectHost: (process.env.BROWSER_USE_CONNECT_HOST || "wss://connect.browser-use.com").replace(
      /\/+$/,
      ""
    ),
    // Optional residential-proxy country (e.g. "us", "de", "jp"). Blank lets the
    // REST API apply its default ("us"); on the connect-URL path blank uses
    // Browser Use's default egress.
    proxyCountryCode: (process.env.BROWSER_USE_PROXY_COUNTRY || "").trim().toLowerCase(),
    // Optional ROTATION pool of residential-proxy countries (comma-separated,
    // e.g. "us,gb,ca,au"). When set, each new session picks one at random so
    // attempts egress from DIFFERENT residential subnets/pools instead of the
    // single default — used to dodge a proxy range Instagram has flagged. Keep
    // them English-locale so IG's UI (and our text-based selectors) stay English.
    // Blank (default) keeps the single proxyCountryCode behavior.
    proxyCountries: (process.env.BROWSER_USE_PROXY_COUNTRIES || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    // Optional saved browser profile UUID. Loads cookies/localStorage so an IG
    // login can persist across sessions; blank starts from a fresh browser.
    profileId: process.env.BROWSER_USE_PROFILE_ID || "",
    // Session timeout in MINUTES (Browser Use caps at 240). Our signup flow can
    // sit on a CAPTCHA/email step for a while, so default higher than their 15.
    timeoutMinutes: parseInt(process.env.BROWSER_USE_TIMEOUT_MINUTES || "30", 10),
    // Record the session so it can be replayed from the dashboard afterwards.
    // Off by default (small extra cost); handy when debugging "what happened".
    enableRecording: bool(process.env.BROWSER_USE_RECORDING, false),
    // LOCAL BROWSER escape hatch. When SIGNUP_LOCAL_BROWSER=1, the signup flow
    // launches a real local Chrome (e.g. Playwright's "Chrome for Testing") on
    // THIS machine and drives it over CDP instead of a Browser Use cloud browser.
    // The point is egress: the local browser uses the host's own residential IP,
    // which Instagram trusts far more than Browser Use's shared automation proxy
    // pool (whose ranges Meta integrity-flags — the cause of valid email codes
    // being rejected as "invalid/expired"). Headful by default (most trustworthy);
    // set SIGNUP_LOCAL_HEADLESS=1 to run headless. CHROME_EXECUTABLE overrides the
    // auto-detected Chrome binary path.
    localBrowser: bool(process.env.SIGNUP_LOCAL_BROWSER, false),
    localHeadless: bool(process.env.SIGNUP_LOCAL_HEADLESS, false),
    localChromeExecutable: (process.env.CHROME_EXECUTABLE || "").trim(),
    // Optional FIXED browser viewport (CSS px). Left at 0 (the default), each
    // session picks a random COMMON desktop resolution so window.screen /
    // innerWidth / outerWidth don't expose one constant automation viewport —
    // a uniform viewport is a cheap fingerprint tell, and varying it across the
    // most-popular real resolutions blends in with normal traffic. Set BOTH to
    // pin an exact size (e.g. for reproducible debugging).
    screenWidth: parseInt(process.env.BROWSER_USE_SCREEN_WIDTH || "0", 10) || 0,
    screenHeight: parseInt(process.env.BROWSER_USE_SCREEN_HEIGHT || "0", 10) || 0,
  },

  // Third-party CAPTCHA solver (CapSolver — https://capsolver.com). When an
  // API key is set we solve reCAPTCHA challenges programmatically (sitekey ->
  // token via API -> inject) as a fallback for the CAPTCHAs Browser Use's
  // in-browser bypass doesn't clear — chiefly IG's reCAPTCHA Enterprise. Disabled
  // (and simply skipped) when no key is present.
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
    // when submitted from the browser's IP. Point this at a residential proxy in
    // the same region as BROWSER_USE_PROXY_COUNTRY so the solve IP matches the
    // page IP — that is what makes an Enterprise token actually clear the
    // challenge. When empty, CapSolver solves proxyless (works for non-enterprise,
    // often rejected by IG).
    proxy: process.env.CAPSOLVER_PROXY || "",
    // OCR module for CapSolver's ImageToText task — the purpose-built backup to
    // the LLM for reading IG's distorted "Confirm you're human" image code.
    // "common" = general alphanumeric OCR (default, robust); "number" = digits
    // only (more accurate for IG's numeric codes). See:
    // https://docs.capsolver.com/guide/recognition/ImageToTextTask/
    imageToTextModule: (process.env.CAPSOLVER_IMAGE_MODULE || "common").trim(),
  },

  verification: {
    // Pluggable email provider. "imap" | "maildotm" | "mailosaur" | "manual"
    //
    // "imap": polls Fastmail (or any IMAP inbox). Rotate EMAIL_ALIAS_BASES — distinct
    // @fastmail.com aliases (no DNS). Optional EMAIL_CATCHALL_DOMAIN for custom domains.
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
      // Legacy single alias base (used when EMAIL_ALIAS_BASES is empty).
      aliasBase: (process.env.EMAIL_ALIAS_BASE || process.env.IMAP_USER || "").trim().toLowerCase(),
      // Pool of DISTINCT @fastmail.com (or other) bases to rotate across. Each
      // signup picks the next non-burned base and mints base+tag@domain so Meta
      // sees a fresh canonical identity. Comma-separated.
      aliasBasePool: (process.env.EMAIL_ALIAS_BASES || "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.includes("@")),
      // Identities to never use (burned by Instagram). Comma-separated emails or
      // identity ids (e.g. plus:lucasfasto@fastmail.com). Persisted burns in
      // media/email_identity_state.json are merged with this list on startup.
      excludeIdentityIds: [
        ...(process.env.EMAIL_EXCLUDE_BASES || "")
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
          .flatMap((s) => (s.includes("@") ? [`plus:${s}`, `direct:${s}`, s] : [s])),
        ...(process.env.EMAIL_BURNED_BASES || "")
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
          .flatMap((s) => (s.includes("@") ? [`plus:${s}`, `direct:${s}`, s] : [s])),
      ],
      // "plus" -> you+slug@dom · "dot" -> Gmail dot-variants · "none" -> use the
      // base address verbatim every time (only safe for one signup at a time).
      aliasMode: (process.env.EMAIL_ALIAS_MODE || "plus").trim().toLowerCase(),
      // A catch-all domain you control (every <anything>@domain reaches the IMAP
      // box). When set, addresses are <name123>@<domain> — unlimited, real-looking,
      // and the most IG-friendly option (no shared canonical base).
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

  // Where generated media (audio/video/images) gets written and served from
  // (/media). On hosts with an ephemeral filesystem (e.g. Railway), point this
  // at a mounted persistent volume so images survive redeploys — set
  // MEDIA_DIR to the volume's mount path (e.g. /data/media).
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
  if (!config.browserUse.apiKey) missing.push("BROWSER_USE_API_KEY");
  return missing;
}
