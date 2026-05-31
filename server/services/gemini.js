import { writeFile } from "node:fs/promises";
import { GoogleGenAI } from "@google/genai";
import { config } from "../config.js";
import {
  mediaPath,
  mediaUrl,
  buildInfluencerImagePrompt,
  PHOTO_NO_UI_RULE,
  loadMediaAsBase64,
  sleep,
} from "../lib/util.js";
import { formatNameListsForPrompt } from "../lib/nameLists.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("gemini");

// Scene/imagePrompt text must not invite app UI in the rendered photo (models
// often draw story bars, DMs, etc. when prompts mention screenshots or apps).
const IMAGE_SCENE_RULES = `
Image scene rules (for imagePrompt, setting, outfit, action — feeds an image model):
- Describe only the real-world scene: location, outfit, pose, activity, lighting mood.
- NEVER ask for screenshots, phone-screen close-ups, "story UI", DMs, chat bubbles,
  notification overlays, or any social-app interface inside the photo.
- NEVER describe the image as "on Instagram", "in Stories", or "a screenshot of".
- A phone may appear in a mirror selfie, but never with messaging or app UI on screen.
${PHOTO_NO_UI_RULE}`.trim();

// Transient errors worth retrying: 429 (RESOURCE_EXHAUSTED / rate limit) and
// 503 (model overloaded / UNAVAILABLE). These limits are usually short windows,
// so a few backed-off retries absorb them instead of failing the whole call.
function isTransient(err) {
  const message = String(err?.message || err || "");
  const status = err?.status ?? err?.code;
  if (status === 429 || status === 503) return true;
  return /\b(429|503)\b|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|rate limit/i.test(message);
}

// Calls a Gemini generateContent thunk with exponential backoff on transient
// 429/503 errors. Delays ~0.5s, 1s, 2s, 4s (+jitter); non-transient errors and
// the final attempt rethrow immediately.
async function withRetry(fn, { retries = 4, label = "gemini" } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= retries || !isTransient(err)) throw err;
      const backoff = 500 * 2 ** attempt + Math.floor(Math.random() * 250);
      log.warn(
        `${label}: transient error (attempt ${attempt + 1}/${retries + 1}), retrying in ${backoff}ms`,
        err?.message
      );
      await sleep(backoff);
    }
  }
  throw lastErr;
}

let client = null;
function getClient() {
  if (!config.gemini.apiKey) {
    throw new Error("GEMINI_API_KEY not configured");
  }
  if (!client) client = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  return client;
}

export function isConfigured() {
  return Boolean(config.gemini.apiKey);
}

// Liveness check: confirms the configured GEMINI_API_KEY is actually ACCEPTED by
// Google, not merely present. A non-empty-but-dead key (e.g. an expired/revoked
// or misconfigured service-account-bound "AQ." key) returns 401 on every call,
// which otherwise surfaces deep inside a browser run as an opaque "act fallback
// failed" / "email code not accepted". Callers use this to fail fast with an
// actionable message. Returns { ok: true } or { ok: false, status?, message }.
// Never throws.
export async function verifyAccess() {
  if (!config.gemini.apiKey) {
    return { ok: false, message: "GEMINI_API_KEY is not set" };
  }
  try {
    const c = getClient();
    await c.models.generateContent({
      model: config.gemini.model,
      contents: "ping",
      config: { maxOutputTokens: 8, thinkingConfig: { thinkingBudget: 0 } },
    });
    return { ok: true };
  } catch (err) {
    const message = String(err?.message || err);
    const status = /"?code"?\s*[:=]\s*(\d{3})|\b(4\d\d|5\d\d)\b/.exec(message);
    return { ok: false, status: status?.[1] || status?.[2], message };
  }
}

// Low level helper that asks Gemini for JSON and parses it defensively.
// `temperature` lets callers crank up variety (e.g. fresh post captions) while
// most callers keep the default for stable, on-brand output.
async function completeJson({
  system,
  prompt,
  maxTokens = 2000,
  temperature,
  trace,
  step: stepName,
}) {
  const run = async () => {
    const c = getClient();
    const res = await withRetry(
      () =>
        c.models.generateContent({
          model: config.gemini.model,
          contents: prompt,
          config: {
            systemInstruction: system,
            maxOutputTokens: maxTokens,
            responseMimeType: "application/json",
            ...(temperature !== undefined ? { temperature } : {}),
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      { label: stepName || "completeJson" }
    );
    const text = (res.text || "").trim();
    if (!text) throw new Error("Empty response from Gemini");
    return parseJson(text);
  };

  if (trace && stepName) {
    return trace.span(stepName, run, {
      kind: "llm_json",
      model: config.gemini.model,
      maxTokens,
      temperature,
    });
  }
  return run();
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]);
      } catch {
        /* fall through */
      }
    }
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last !== -1) {
      try {
        return JSON.parse(text.slice(first, last + 1));
      } catch {
        /* fall through */
      }
    }
    throw new Error("Failed to parse JSON from model output");
  }
}

// Reads the distorted verification/security code out of a "Confirm you're
// human" CAPTCHA image using Gemini's vision model. This is how we beat
// Instagram's image-code challenge (a warped number/letter image you must read
// and type): the signup flow screenshots just the code image and hands it here.
//
// Best-effort OCR — returns the code as a clean alphanumeric string (no spaces)
// or null if the model couldn't read one. NEVER throws; the caller falls back to
// requesting a fresh code or a live/human solve when this returns null.
export async function readCaptchaCode({ imageBase64, mimeType = "image/png", hint } = {}) {
  if (!imageBase64) return null;
  const model = config.gemini.captchaModel || config.gemini.model;
  const system =
    "You are a precise OCR engine that reads short verification codes out of " +
    "distorted CAPTCHA images. The code is warped and crossed out with random " +
    "lines, dots and scribbles meant to fool machines. Ignore every line, mark " +
    "and background texture — transcribe ONLY the foreground characters of the " +
    "code, left to right, in order. Codes are typically 5-8 characters, usually " +
    "digits but sometimes letters. Respond with strict JSON only.";
  const promptText =
    "Read the verification code shown in this image" +
    (hint ? ` (${hint})` : "") +
    '. If the image is a full-page screenshot, the code is the distorted text ' +
    'above the "Enter the code from the image" box. ' +
    'Return strict JSON: {"code": string}. "code" must contain ONLY the code ' +
    "characters — no spaces, quotes or punctuation.";
  try {
    const c = getClient();
    const res = await withRetry(
      () =>
        c.models.generateContent({
          model,
          contents: [
            { text: promptText },
            { inlineData: { mimeType, data: imageBase64 } },
          ],
          config: {
            systemInstruction: system,
            maxOutputTokens: 200,
            responseMimeType: "application/json",
            // Deterministic: we want the single most-likely reading, not variety.
            temperature: 0,
          },
        }),
      { label: "readCaptchaCode" }
    );
    const text = (res.text || "").trim();
    if (!text) return null;
    let code = "";
    try {
      const parsed = parseJson(text);
      code = String(parsed?.code ?? "");
    } catch {
      // Model ignored the JSON instruction — salvage the raw text.
      code = text;
    }
    // Keep only code characters (strips quotes/spaces/punctuation the model may add).
    code = code.replace(/[^a-z0-9]/gi, "").trim();
    if (!code) return null;
    log.info(`readCaptchaCode -> "${code}" (model ${model})`);
    return code;
  } catch (err) {
    log.warn("readCaptchaCode failed", err?.message);
    return null;
  }
}

// Builds a rich persona by analyzing the scraped source account(s) + onboarding answers.
export async function synthesizePersona({ name, niche, questionnaire, sources }) {
  log.info("Synthesizing persona for", name);
  const system =
    "You are a brand strategist who designs hyper-realistic AI influencer personas. " +
    "You study a real creator's public profile and craft a distinct, legally-safe persona that posts in a similar style without impersonating them. " +
    "Always respond with strict JSON only.";

  const prompt = `Design an AI influencer persona.

Display name: ${name}
Niche (if given): ${niche || "infer from sources"}
Onboarding answers: ${JSON.stringify(questionnaire || {}, null, 2)}

Reference creator data scraped from their public profile(s):
${JSON.stringify(sources || [], null, 2)}

${IMAGE_SCENE_RULES}

Return JSON with this exact shape:
{
  "displayName": string,
  "handleSuggestions": string[3],   // available-sounding instagram handles, lowercase, no spaces
  "niche": string,
  "bio": string,                     // <= 150 chars, instagram bio with light emoji
  "personality": string,             // 2-3 sentences
  "voiceStyle": {                    // for narration / commentary scripts
    "tone": string,
    "pacing": string,
    "catchphrases": string[],
    "vocabulary": string
  },
  "voiceCasting": {                  // hints to pick an ElevenLabs voice
    "gender": "male" | "female" | "neutral",
    "age": "young" | "adult" | "mature",
    "accent": string,
    "energy": "calm" | "moderate" | "high"
  },
  "visualStyle": {                   // for image/video generation prompts
    "appearance": string,            // physical description of the AI person
    "aesthetic": string,
    "settings": string[],
    "wardrobe": string
  },
  "contentPillars": string[4],       // recurring topics to post about
  "hashtagThemes": string[6]          // micro-niche hashtag inspiration for captions
}`;

  return completeJson({ system, prompt, maxTokens: 2000 });
}

function onboardingNamingRules() {
  return `Naming rules (IMPORTANT — read carefully):
- The name must read like a REAL ORDINARY PERSON, not a brand or a username.
- Pick one firstName from the approved first-name list and one lastName from the
  approved last-name list below. They must sound like a believable real person
  together (plausible cultural pairing — not a random mismatch, not a brand).
- If the user already specified a first or last name in their answers, keep it
  and only choose the other name from the lists.
- Do NOT use names outside these lists unless the user explicitly provided them.
- Vary your choices across generations — do not default to the same few names.
- The last name MUST NOT be a pun, MUST NOT relate to the niche/topic, and MUST
  NOT alliterate or rhyme with the first name. Bad: "Stacy Gains" (fitness pun),
  "Mia Spice" (cooking pun), "Tara Travels". Good: "Stacy Nguyen", "Mia Okafor".
- displayName must be exactly "{firstName} {lastName}".

${formatNameListsForPrompt()}`;
}

function onboardingAnswersBlock(answers) {
  return `Onboarding answers (question -> answer):
${JSON.stringify(answers || {}, null, 2)}

How to use the answers (IMPORTANT):
- The answers describe the TARGET and STRATEGY (who to write for, the niche, the
  intended vibe). They are NOT copy to reuse.
- Do NOT quote or repeat the answer wording verbatim anywhere in the output —
  especially not in "bio", "tagline", "samplePosts", "personality", or hashtags.
- In particular, NEVER drop demographic/labeling terms from the answers (e.g.
  "Gen Z", "millennials", "busy professionals", "entrepreneurs", "target
  audience") into the bio, captions, or posts. Real creators write FOR an
  audience; they don't announce the audience label in their bio.
- Instead, EMBODY the vibe and speak naturally to that audience the way a real
  person would. Example: if the audience is "Gen Z", use the slang, references,
  and tone Gen Z uses — without ever printing the words "Gen Z".
- The bio and posts should read like a real human wrote them, not like a brief
  that lists its own targeting parameters.`;
}

// Fast first pass: names + visual identity + portrait prompt. Kept small so image
// generation can start while the richer content plan is still being written.
export async function designOnboardingVisual({ answers, trace }) {
  trace?.detail("visual_identity_start", { model: config.gemini.model });
  log.info("Designing onboarding visual identity");
  const system =
    "You are a brand strategist who designs hyper-realistic, legally-safe AI influencer personas. " +
    "From a few short onboarding answers you invent a believable creator's identity and look. " +
    "Always respond with strict JSON only.";

  const prompt = `Design the identity and portrait direction for an AI influencer.

${onboardingAnswersBlock(answers)}

${onboardingNamingRules()}

${IMAGE_SCENE_RULES}

Return JSON with this exact shape:
{
  "firstName": string,
  "lastName": string,
  "displayName": string,            // exactly "{firstName} {lastName}"
  "tagline": string,                // <= 60 chars; dry or blunt, NOT a poetic vibe summary
  "handleSuggestions": string[3],   // lowercase instagram handles, no spaces or @
  "niche": string,
  "appearance": string,             // vivid physical description for image generation
  "aesthetic": string,              // visual mood: lighting, palette, vibe
  "imagePrompt": string             // rich portrait prompt; photogenic, believable, NO app UI
}`;

  const visual = await completeJson({
    system,
    prompt,
    maxTokens: 900,
    temperature: 1,
    trace,
    step: "llm.visual_identity",
  });
  trace?.detail("visual_identity_ready", {
    displayName: visual?.displayName,
    niche: visual?.niche,
  });
  return visual;
}

// Second pass: voice, content plan, and post examples. Runs in parallel with
// portrait rendering once the visual identity exists.
export async function designOnboardingPersonaDetails({ answers, visual, trace }) {
  trace?.detail("persona_details_start", { model: config.gemini.model });
  log.info("Designing onboarding persona details");
  const system =
    "You are a brand strategist who designs hyper-realistic, legally-safe AI influencer personas. " +
    "Given a creator's fixed identity, flesh out their voice and content plan. " +
    "Always respond with strict JSON only.";

  const prompt = `Flesh out the content plan for this AI influencer. Do NOT change their name or look.

Identity (fixed):
${JSON.stringify(
  {
    firstName: visual.firstName,
    lastName: visual.lastName,
    displayName: visual.displayName,
    tagline: visual.tagline,
    niche: visual.niche,
    appearance: visual.appearance,
    aesthetic: visual.aesthetic,
  },
  null,
  2
)}

${onboardingAnswersBlock(answers)}

${HUMAN_COPY_RULES}

Return JSON with this exact shape:
{
  "bio": string,                    // <= 150 chars; mundane/specific, max 1 emoji
  "personality": string,            // 2-3 sentences, first impression
  "contentPillars": string[4],
  "contentFormats": string[3],
  "typicalSettings": string[5],
  "typicalOutfits": string[4],
  "samplePosts": [
    { "hook": string, "caption": string }
  ],
  "hashtagThemes": string[5]
}`;

  const details = await completeJson({
    system,
    prompt,
    maxTokens: 1800,
    temperature: 1,
    trace,
    step: "llm.persona_details",
  });
  trace?.detail("persona_details_ready", {
    pillars: details?.contentPillars?.length,
    samplePosts: details?.samplePosts?.length,
  });
  return details;
}

// Portrait onboarding: visual identity first, then persona details + image in parallel.
export async function designOnboardingCharacterWithImage({ answers, trace }) {
  log.info("Designing onboarding character with parallel portrait");
  trace?.step("request_received", {
    answerKeys: Object.keys(answers || {}),
  });

  const visual = await designOnboardingVisual({ answers, trace });
  const imagePrompt =
    visual.imagePrompt ||
    [visual.appearance, visual.aesthetic].filter(Boolean).join(". ") ||
    visual.displayName;

  trace?.step("parallel_phase_start", {
    imagePromptChars: String(imagePrompt).length,
    displayName: visual.displayName,
  });
  const parallelStart = Date.now();

  const [details, image] = await Promise.all([
    designOnboardingPersonaDetails({ answers, visual, trace }),
    generateInfluencerImage({
      prompt: imagePrompt,
      label: "onboarding-portrait",
      trace,
      traceStepPrefix: "portrait",
    }),
  ]);

  trace?.step("parallel_phase_done", {
    parallelWallMs: Date.now() - parallelStart,
    imageUrl: image.url,
    referenceStatus: image.referenceStatus,
  });

  return {
    character: { ...visual, ...details },
    imageUrl: image.url,
  };
}

// Designs a persona + content plan straight from the onboarding chat answers
// (no scraped sources). Returns a compact shape the onboarding UI renders.
export async function designOnboardingCharacter({ answers }) {
  log.info("Designing onboarding character");
  const visual = await designOnboardingVisual({ answers });
  const details = await designOnboardingPersonaDetails({ answers, visual });
  return { ...visual, ...details };
}

// Generates a commentary-style short-form video script in the persona's voice.
export async function generateScript({ persona, topic }) {
  log.info("Generating script", topic ? `on "${topic}"` : "");
  const system =
    "You write punchy, high-retention short-form video commentary scripts (Reels/TikTok) for an AI influencer. " +
    "Scripts are spoken voiceovers: hook in the first line, conversational, 90-150 spoken words, no stage directions in the narration. " +
    "Respond with strict JSON only.";

  const prompt = `Persona:
${JSON.stringify(persona, null, 2)}

Topic: ${topic || "pick a fresh, on-brand topic from the persona's content pillars"}

${IMAGE_SCENE_RULES}

Return JSON:
{
  "title": string,
  "topic": string,
  "hook": string,                 // the spoken first line
  "narration": string,            // full voiceover text to send to TTS (include the hook)
  "onScreenText": string[],       // 3-6 short caption phrases to burn into the video
  "bRollPrompts": string[3],      // real-world scene prompts only — no app UI (see image scene rules)
  "caption": string,              // instagram caption with a CTA
  "hashtags": string[8]           // no # symbol, lowercase
}`;

  return completeJson({ system, prompt, maxTokens: 1500 });
}

// A grab-bag of angles the post generator picks from at random so two
// back-to-back posts for the same persona never feel like clones.
const POST_ANGLES = [
  "a candid behind-the-scenes moment",
  "a relatable everyday struggle with a hopeful twist",
  "a bold hot-take or unpopular opinion",
  "a quick tip or mini how-to",
  "a question that invites followers to reply in the comments",
  "a gratitude / reflection moment",
  "a 'storytime' style anecdote",
  "a before/after or transformation framing",
  "a myth-busting or 'things nobody tells you' angle",
  "a playful, humorous take",
  "a motivational push to start something today",
  "a 'currently obsessed with' recommendation",
];

const POST_TIMES = ["morning", "midday", "afternoon", "evening"];

// Mega-tags and engagement-bait tags that spam bots monitor aggressively.
const BOT_MAGNET_HASHTAGS = new Set([
  "explorepage",
  "explore",
  "viral",
  "fyp",
  "foryou",
  "foryoupage",
  "instagood",
  "instagram",
  "photooftheday",
  "picoftheday",
  "followme",
  "follow4follow",
  "followforfollow",
  "like4like",
  "likeforlike",
  "tagsforlikes",
  "gainfollowers",
  "freefollowers",
  "followback",
  "instadaily",
  "instalike",
  "fitnessmotivation",
  "motivation",
  "inspiration",
  "mindset",
  "hustle",
  "goals",
  "love",
  "happy",
  "beautiful",
  "photography",
  "reels",
  "reelsinstagram",
  "trending",
  "viralreels",
]);

const HASHTAG_RULES = `
Hashtag rules (CRITICAL — generic tags attract "Send me this post" spam bots):
- Return exactly 5 or 6 hashtags in the "hashtags" array (lowercase, no # symbol).
- NEVER use mega-viral or engagement-bait tags bots monitor: explorepage, viral, fyp,
  instagood, photooftheday, followme, like4like, fitnessmotivation, motivation,
  gym, workout, fitness, wellness (as standalone single words), love, trending.
- Each tag must be SPECIFIC to THIS post — compound micro-niche tags a real creator
  in this niche would use (e.g. "legdayathome", "miamiyoga", "thriftfit") NOT broad
  category labels.
- Prefer 3–4 hyper-specific tags + at most 1 location or small-community tag.
- Do not reuse the same hashtag bundle every post; vary with the angle and setting.
- Hashtags must relate to what is literally in the photo, not generic niche slogans.
`.trim();

function normalizeHashtag(raw) {
  return String(raw || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function sanitizeHashtags(raw) {
  const out = [];
  const seen = new Set();
  for (const h of Array.isArray(raw) ? raw : []) {
    const tag = normalizeHashtag(h);
    if (!tag || tag.length < 3 || tag.length > 30) continue;
    if (BOT_MAGNET_HASHTAGS.has(tag)) continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= 6) break;
  }
  return out;
}

// Shared rules so bios/captions show vibe indirectly instead of summarizing the brief.
const HUMAN_COPY_RULES = `
Voice rules (bios, taglines, sample posts, and captions — CRITICAL):
- The user's brief is INTERNAL context. Public copy must NEVER read like a polished
  summary of that brief or a mood board turned into sentences.
- Show personality through specifics (a habit, complaint, craving, inside joke, dry
  aside) — NOT through aesthetic adjectives, niche slogans, or "brand voice" poetry.
- Real creators sound blunt, messy, or accidentally funny more often than poetic.
  Understatement beats manifesto energy.
- Do NOT write Instagram-template bios: no motivational poster lines ("building X one
  Y at a time"), no stacked aesthetic nouns (boots, rings, obsidian, moon metaphors),
  no fake editorial schedules ("archive updates every Sunday") unless truly relevant.
- Do NOT name or describe the vibe/niche/aesthetic directly (no "alt girl energy",
  "fitness journey", "dark feminine", "wellness warrior", etc.).
- Max ONE emoji in bios. Captions: emoji optional, never as decoration on every line.
- Bad bio: "Dressing like the moon is always full. 🌙 Heavy boots, silver rings..."
- Bad bio: "Building a stronger me, one rep at a time 💪"
- Bad caption: "Reminder that progress > perfection. Every rep counts on this journey."
- Good bio: "berlin. bad at texting back. thrifted everything"
- Good bio: "meal prep sundays only. nc"
- Good caption: "skipped cardio again lol anyway this set felt ok"
`.trim();

const SLANG_POOL = [
  "fr", "lowk", "lowkey", "highkey", "omg", "tbh", "ngl", "istg", "idk", "imo",
  "no cap", "cap", "deadass", "bet", "periodt", "literally", "slay", "ate",
  "it's giving", "vibes", "iconic", "help", "crying", "sheesh", "ugh", "lol",
  "lmao", "smh", "rn", "nvm", "obvi", "def", "probs", "kinda", "legit", "based",
  "delulu", "sus", "pls", "icymi", "iykyk", "im dead", "so real", "valid",
];

const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

function pickTwoSlang(pool) {
  if (pool.length === 0) return [];
  if (pool.length === 1) return [pool[0], pool[0]];
  const first = pickRandom(pool);
  let second = pickRandom(pool);
  while (second === first) second = pickRandom(pool);
  return [first, second];
}

// Pulls the on-brand settings/outfits stored on the persona (onboarding or clone).
function sceneOptionsFromPersona(persona) {
  const settings = (
    persona?.typicalSettings ||
    persona?.visualStyle?.settings ||
    []
  )
    .map((s) => String(s).trim())
    .filter(Boolean);
  const rawOutfits = persona?.typicalOutfits || persona?.visualStyle?.wardrobe;
  const outfits = (Array.isArray(rawOutfits) ? rawOutfits : rawOutfits ? [rawOutfits] : [])
    .map((o) => String(o).trim())
    .filter(Boolean);
  return { settings, outfits };
}

// Slim context for post generation — voice and scene lists only, no appearance text.
function postContextFromPersona(persona) {
  const { settings, outfits } = sceneOptionsFromPersona(persona);
  const themes =
    persona?.hashtagThemes ??
    persona?.postingStrategy?.hashtagThemes;
  return {
    displayName: persona?.displayName,
    niche: persona?.niche, // scene/outfit logic only — do not echo in caption
    personality: persona?.personality,
    bioVoiceReference: persona?.bio, // tone only — do not paraphrase or reuse lines
    typicalSettings: settings,
    typicalOutfits: outfits,
    hashtagThemes: Array.isArray(themes)
      ? themes.map((t) => String(t).trim()).filter(Boolean).slice(0, 6)
      : [],
  };
}

function assembleScenePrompt({ setting, outfit, action }) {
  const parts = [
    String(action || "").trim(),
    setting ? `Setting: ${String(setting).trim()}` : "",
    outfit ? `Outfit: ${String(outfit).trim()}` : "",
  ].filter(Boolean);
  return parts.join(". ") + (parts.length ? "." : "");
}

// Designs a fresh, natural-feeling Instagram post (caption + hashtags + image
// prompt) for an existing persona. Deliberately high-variety: a random angle,
// time-of-day and seed plus a high temperature so repeated calls produce
// distinct, human-sounding posts rather than near-duplicates.
export async function generatePostContent({ persona, trace }) {
  trace?.detail("post_content_start", {
    displayName: persona?.displayName,
    niche: persona?.niche,
  });
  log.info("Generating post content for", persona?.displayName || "influencer");

  const angle = pickRandom(POST_ANGLES);
  const timeOfDay = pickRandom(POST_TIMES);
  const seed = Math.random().toString(36).slice(2, 8);
  const [slangA, slangB] = pickTwoSlang(SLANG_POOL);
  const ctx = postContextFromPersona(persona || {});
  const hasSceneLists = ctx.typicalSettings.length > 0 && ctx.typicalOutfits.length > 0;

  const system =
    "You write Instagram posts for a specific creator persona. " +
    "Sound like a real person posting a single moment — not a brand summarizing its niche. " +
    "Varied sentence length, occasional emoji, no robotic templates, no hashtag stuffing in the caption body. " +
    "Every post must feel different from the last. Respond with strict JSON only.";

  const sceneRules = hasSceneLists
    ? `- For the photo scene, pick ONE setting from typicalSettings and ONE outfit from typicalOutfits.
- The outfit must make sense for that setting and for a ${ctx.niche || "this niche"} creator.
- Vary the setting and outfit from post to post — do not default to the same combo every time.
- You may describe a slight variation of a listed setting (e.g. "a different gym than usual") but stay on-brand.`
    : `- For the photo scene, pick a setting and outfit that a real ${ctx.niche || "this niche"} creator would plausibly post from — varied, everyday, on-brand. Nothing random or off-topic (no formal gala, no costume, no location that doesn't fit the niche).`;

  const prompt = `Write ONE brand-new Instagram post for this persona.

Persona (voice + scene — do NOT invent physical appearance; niche is for scene/outfit only):
${JSON.stringify(ctx, null, 2)}

${HUMAN_COPY_RULES}

Constraints for THIS post (caption variety only):
- Creative angle: ${angle}
- Time of day (caption mood only, NOT image lighting): ${timeOfDay}
- Variety seed (ignore meaning, just use it to be different): ${seed}
- Slang for this caption: incorporate "${slangA}" and "${slangB}" (use each once). They must fit the caption's mood and sound like how this persona actually talks — casual and human, never forced, awkward, or try-hard. Do not stack them back-to-back or turn the caption into a meme; spread them where they naturally belong in the thought.

Rules:
- The caption is ONE casual thought about THIS photo (what happened, a complaint, a tiny win,
  something dumb/funny) — NOT a mission statement about the niche.
- Do NOT open with inspirational hooks ("reminder that…", "progress over perfection",
  "here's your sign to…", "building X one Y at a time").
- The caption must sound human and natural, on-brand for the persona's voice.
- Caption length: 400 characters or fewer (including spaces and emoji).
- Do NOT use em dashes (—) in the caption; use a comma, period, or "..." instead.
- Each caption must include exactly TWO casual slang terms (the pair assigned above, or close equivalents if one truly clashes with the mood — still two total). Vary phrasing across posts; never reuse the same pair or the same opening every time. The slang should match the caption tone (funny, tired, excited, dry, etc.), not fight it.
- Do NOT reuse the persona's sample posts verbatim; write something new.
- Write FOR the persona's audience, but NEVER print audience/demographic labels
  (e.g. "Gen Z", "millennials", "busy professionals", "entrepreneurs") in the
  caption or hashtags. Embody the audience's tone instead of naming them. A real
  person doesn't announce who their target audience is in their own caption.
- Keep hashtags OUT of the caption body. Put them only in the "hashtags" array.
${HASHTAG_RULES}
${
  ctx.hashtagThemes?.length
    ? `- Persona hashtag themes (use only as inspiration for SPECIFIC compound tags — never copy these verbatim if they are broad): ${ctx.hashtagThemes.join(", ")}`
    : ""
}
${sceneRules}
${IMAGE_SCENE_RULES}
- Describe what the person is DOING in the photo (action/pose). Refer to them as "the person" / "she" — never describe face, skin tone, hair, or body.
- A reference photo defines what she looks like; your scene fields define only where she is, what she wears, and what she's doing.
- shotType: "selfie" for close phone-in-hand / mirror shots; "scene" for wider candid photos in the setting.

Return JSON with this exact shape:
{
  "caption": string,            // max 400 chars, no em dashes (—)
  "hashtags": string[5],        // 5–6 specific micro-niche tags, lowercase, no #
  "setting": string,
  "outfit": string,
  "action": string,
  "altText": string,
  "shotType": string
}`;

  const data = await completeJson({
    system,
    prompt,
    maxTokens: 1200,
    temperature: 1.15,
    trace,
    step: "llm.post_content",
  });

  // Normalize hashtags: strip bot magnets, de-dupe, cap at 6.
  const hashtags = sanitizeHashtags(data.hashtags);

  const shotType = String(data.shotType || "").trim().toLowerCase() === "scene" ? "scene" : "selfie";
  const imagePrompt =
    assembleScenePrompt({
      setting: data.setting,
      outfit: data.outfit,
      action: data.action,
    }) || String(data.imagePrompt || "").trim();

  trace?.detail("post_content_ready", { shotType, imagePromptChars: imagePrompt.length });

  return {
    caption: String(data.caption || "").trim(),
    hashtags,
    imagePrompt,
    altText: String(data.altText || "").trim(),
    shotType,
    angle,
  };
}

function imageGenerationError(err) {
  const message = String(err?.message || err || "");
  const noQuota = /RESOURCE_EXHAUSTED|quota exceeded/i.test(message);
  if (!noQuota) return err;

  const hasZeroLimit = /limit[":\s]+0\b/i.test(message);
  if (hasZeroLimit) {
    return new Error(
      `Gemini image generation is unavailable because this API project has no image-generation quota for ${config.gemini.imageModel}. Enable billing for the Gemini API project, then try again.`
    );
  }

  return new Error(
    `Gemini image-generation quota was reached for ${config.gemini.imageModel}. Wait briefly and try again, or check the project's Gemini API quota.`
  );
}

// Generates an influencer image with Nano Banana Pro and saves it locally.
// Returns { url, path, referenceUsed, referenceStatus, referenceUrl }.
//
// `referenceImage` is the influencer's saved profile photo, passed to the image
// model as a SUBJECT reference so the generated person keeps the same identity
// (face, hair, skin tone, body) as their profile across posts. It may be a
// /media URL or absolute path (string), or a preloaded { data, mimeType }
// object. When provided, the prompt is reframed to "same person, new scene".
// `frameAsSelfie` toggles selfie vs. candid framing in the style wrapper.
export async function generateInfluencerImage({
  prompt,
  influencerId,
  label = "influencer",
  aspectRatio = "1:1",
  frameAsSelfie = true,
  referenceImage = null,
  trace,
  traceStepPrefix = "image",
}) {
  const c = getClient();
  const detail = (name, extra) =>
    trace?.detail(`${traceStepPrefix}.${name}`, {
      label,
      influencerId: influencerId || null,
      ...extra,
    });
  log.info("Generating Nano Banana image:", String(prompt).slice(0, 80));
  detail("start", {
    promptChars: String(prompt).length,
    frameAsSelfie,
    aspectRatio,
    imageModel: config.gemini.imageModel,
  });

  const referenceUrl =
    typeof referenceImage === "string" ? referenceImage : referenceImage ? "(preloaded)" : null;

  // Resolve the reference photo (if any) into inline base64 the model can read.
  let reference = null;
  let referenceStatus = "not_requested";
  const refLoadStart = Date.now();
  if (referenceImage) {
    reference =
      typeof referenceImage === "string"
        ? await loadMediaAsBase64(referenceImage)
        : referenceImage?.data
          ? referenceImage
          : null;
    if (reference) {
      referenceStatus = "attached";
      const byteLen = Buffer.byteLength(reference.data, "base64");
      log.info(
        "reference image ATTACHED to Gemini request:",
        referenceUrl,
        `mime=${reference.mimeType || "image/png"}`,
        `bytes=${byteLen}`,
        `via=${reference.source || "unknown"}`,
        "contents=image+text"
      );
      detail("reference_loaded", {
        referenceStatus,
        spanMs: Date.now() - refLoadStart,
        refBytes: byteLen,
        refSource: reference.source,
      });
    } else {
      referenceStatus = "load_failed";
      log.warn(
        "reference image FAILED to load; generating text-only (no inlineData):",
        referenceUrl
      );
      detail("reference_load_failed", {
        referenceStatus,
        spanMs: Date.now() - refLoadStart,
        referenceUrl,
      });
    }
  } else {
    log.info("reference image not requested; generating text-only (no inlineData)");
    detail("reference_skipped", { referenceStatus });
  }

  const fullPrompt = buildInfluencerImagePrompt(prompt, {
    hasReference: Boolean(reference),
    selfie: frameAsSelfie,
  });
  detail("prompt_built", {
    fullPromptChars: fullPrompt.length,
    hasReference: Boolean(reference),
  });

  // When a reference photo is supplied, send it alongside the prompt so the
  // model conditions on the actual person rather than re-inventing them from
  // text. Same inlineData mechanism used by the CAPTCHA reader above.
  const contents = reference
    ? [
        { inlineData: { mimeType: reference.mimeType || "image/png", data: reference.data } },
        { text: fullPrompt },
      ]
    : fullPrompt;

  const isLegacyFlash = config.gemini.imageModel === "gemini-2.5-flash-image";
  const runGeminiImage = async () => {
    const res = await withRetry(
      () =>
        c.models.generateContent({
          model: config.gemini.imageModel,
          contents,
          config: {
            responseModalities: ["IMAGE"],
            imageConfig: {
              aspectRatio,
              ...(!isLegacyFlash ? { imageSize: "2K" } : {}),
            },
          },
        }),
      { label: "generateInfluencerImage" }
    );
    return res;
  };

  let res;
  try {
    res = trace
      ? await trace.span(`${traceStepPrefix}.gemini_image`, runGeminiImage, {
          imageModel: config.gemini.imageModel,
          hasReference: Boolean(reference),
        })
      : await runGeminiImage();
  } catch (err) {
    throw imageGenerationError(err);
  }

  const parts = res?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p?.inlineData?.data);
  if (!imagePart) {
    const err = new Error("Nano Banana returned no image");
    trace?.fail(`${traceStepPrefix}.no_image_part`, err);
    throw err;
  }

  const buffer = Buffer.from(imagePart.inlineData.data, "base64");
  const writeStart = Date.now();
  const out = await mediaPath(
    influencerId || "previews",
    `${label}-${Date.now()}.png`
  );
  await writeFile(out, buffer);
  detail("media_saved", {
    spanMs: Date.now() - writeStart,
    outputBytes: buffer.length,
    path: out,
  });

  return {
    url: mediaUrl(out),
    path: out,
    referenceUsed: Boolean(reference),
    referenceStatus,
    referenceUrl,
  };
}
