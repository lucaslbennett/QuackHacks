import { writeFile } from "node:fs/promises";
import { GoogleGenAI } from "@google/genai";
import { config } from "../config.js";
import {
  mediaPath,
  mediaUrl,
  buildInfluencerImagePrompt,
  loadMediaAsBase64,
  sleep,
} from "../lib/util.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("gemini");

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
async function completeJson({ system, prompt, maxTokens = 2000, temperature }) {
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
          // Flash-Lite is the lightweight tier; keep thinking off so the whole
          // token budget is spent on the JSON answer (lower latency + cost).
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    { label: "completeJson" }
  );
  const text = (res.text || "").trim();
  if (!text) throw new Error("Empty response from Gemini");
  return parseJson(text);
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
  "postingStrategy": {
    "postsPerDay": number,
    "bestTimes": string[],
    "hashtagThemes": string[]
  }
}`;

  return completeJson({ system, prompt, maxTokens: 2000 });
}

// Designs a persona + content plan straight from the onboarding chat answers
// (no scraped sources). Returns a compact shape the onboarding UI renders.
export async function designOnboardingCharacter({
  answers,
  suggestedLastName,
}) {
  log.info("Designing onboarding character");
  const system =
    "You are a brand strategist who designs hyper-realistic, legally-safe AI influencer personas. " +
    "From a few short onboarding answers you invent a complete, believable creator and the content they post. " +
    "Be specific and concrete. Always respond with strict JSON only.";

  const prompt = `Design an AI influencer character from these onboarding answers.

Onboarding answers (question -> answer):
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
  that lists its own targeting parameters.

Naming rules (IMPORTANT — read carefully):
- The name must read like a REAL ORDINARY PERSON, not a brand or a username.
- firstName: a common, real-world first name an actual person would have. If the
  user already specified a first name in their answers, keep it; otherwise invent one.
${
  suggestedLastName
    ? `- lastName: use "${suggestedLastName}" unless the user explicitly specified a different surname in their answers.`
    : "- lastName: a real, common surname that a real family would have, drawn from a wide range of real-world origins."
}
- The last name MUST NOT be a pun, MUST NOT relate to the niche/topic, and MUST
  NOT alliterate or rhyme with the first name. Bad: "Stacy Gains" (fitness pun),
  "Mia Spice" (cooking pun), "Tara Travels". Good: "Stacy Nguyen", "Mia Okafor".
- The first and last name should feel independent of each other and of the niche,
  like two names picked at random from a real population.

Return JSON with this exact shape:
{
  "firstName": string,              // a common, real first name (see naming rules)
  "lastName": string,               // a real, common surname (see naming rules)
  "displayName": string,            // exactly "{firstName} {lastName}", nothing else
  "tagline": string,                // <= 60 chars, the character in one line
  "handleSuggestions": string[3],   // lowercase instagram handles, no spaces or @
  "niche": string,
  "bio": string,                    // <= 150 chars instagram bio with light emoji
  "personality": string,            // 2-3 sentences, first impression of who they are
  "appearance": string,             // vivid physical description for image generation; describe a conventionally attractive, photogenic person (symmetrical features, clear skin, flattering hair, appealing figure, tasteful style) while still feeling like a real, believable individual — not generic or plastic
  "aesthetic": string,              // visual mood: lighting, palette, vibe
  "contentPillars": string[4],      // recurring topics they post about
  "contentFormats": string[3],      // e.g. "talking-head reels", "day-in-the-life vlogs"
  "samplePosts": [                  // 3 concrete posts this character would publish
    { "hook": string, "caption": string }
  ],
  "postingStrategy": {
    "postsPerDay": number,
    "bestTimes": string[],
    "hashtagThemes": string[]
  },
  "imagePrompt": string             // a single rich prompt describing the character's portrait; the person should look genuinely attractive and photogenic (the kind of good-looking creator who gains a following) while remaining a realistic, believable individual
}`;

  // Higher temperature so repeated identical onboarding answers still yield
  // varied personas rather than collapsing to the same name/character.
  return completeJson({ system, prompt, maxTokens: 2000, temperature: 1 });
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

Return JSON:
{
  "title": string,
  "topic": string,
  "hook": string,                 // the spoken first line
  "narration": string,            // full voiceover text to send to TTS (include the hook)
  "onScreenText": string[],       // 3-6 short caption phrases to burn into the video
  "bRollPrompts": string[3],      // image/video generation prompts matching the persona's visualStyle
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

const POST_TIMES = ["morning", "midday", "golden hour", "late night"];

const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Designs a fresh, natural-feeling Instagram post (caption + hashtags + image
// prompt) for an existing persona. Deliberately high-variety: a random angle,
// time-of-day and seed plus a high temperature so repeated calls produce
// distinct, human-sounding posts rather than near-duplicates.
export async function generatePostContent({ persona }) {
  log.info("Generating post content for", persona?.displayName || "influencer");

  const angle = pickRandom(POST_ANGLES);
  const timeOfDay = pickRandom(POST_TIMES);
  const seed = Math.random().toString(36).slice(2, 8);

  const system =
    "You write authentic, natural-sounding Instagram posts for a specific AI influencer persona. " +
    "You sound like a real person, not a marketer: varied sentence length, the occasional emoji, " +
    "no robotic templates, no hashtag stuffing inside the caption body. " +
    "Every post you write must feel different from the last. Respond with strict JSON only.";

  const prompt = `Write ONE brand-new Instagram post for this persona.

Persona:
${JSON.stringify(persona || {}, null, 2)}

Constraints for THIS post (use them to stay fresh):
- Creative angle: ${angle}
- Time of day / mood: ${timeOfDay}
- Variety seed (ignore meaning, just use it to be different): ${seed}

Rules:
- The caption must sound human and natural, on-brand for the persona's voice and niche.
- Do NOT reuse the persona's sample posts verbatim; write something new.
- Write FOR the persona's audience, but NEVER print audience/demographic labels
  (e.g. "Gen Z", "millennials", "busy professionals", "entrepreneurs") in the
  caption or hashtags. Embody the audience's tone instead of naming them. A real
  person doesn't announce who their target audience is in their own caption.
- Keep hashtags OUT of the caption body. Put them only in the "hashtags" array.
- Provide a vivid image generation prompt that depicts a concrete, photo-worthy
  scene for THIS specific post (not just a portrait). Describe the SETTING, action,
  outfit/wardrobe, mood, and framing — but do NOT redescribe the person's face,
  facial features, or skin tone. A reference photo of the influencer is supplied
  separately and defines their identity; restating their face/skin in words only
  makes the image drift from the real person. Refer to them as "the person" / "her".
- Decide whether THIS post reads best as a self-taken selfie (close, face-forward,
  phone-in-hand) or as a wider candid scene photo of the person in their setting,
  and set "shotType" accordingly.

Return JSON with this exact shape:
{
  "caption": string,            // the post caption, natural, 1-4 short paragraphs, light emoji ok, NO hashtags
  "hashtags": string[10],       // 8-12 relevant hashtags, lowercase, WITHOUT the # symbol
  "imagePrompt": string,        // rich scene description for the post image
  "altText": string,            // short accessibility description of the image
  "shotType": string            // either "selfie" or "scene"
}`;

  const data = await completeJson({
    system,
    prompt,
    maxTokens: 1200,
    temperature: 1.15,
  });

  // Normalize hashtags: strip leading #, drop empties, de-dupe.
  const hashtags = Array.from(
    new Set(
      (Array.isArray(data.hashtags) ? data.hashtags : [])
        .map((h) => String(h).trim().replace(/^#+/, "").replace(/\s+/g, ""))
        .filter(Boolean)
    )
  );

  const shotType = String(data.shotType || "").trim().toLowerCase() === "scene" ? "scene" : "selfie";

  return {
    caption: String(data.caption || "").trim(),
    hashtags,
    imagePrompt: String(data.imagePrompt || "").trim(),
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
// Returns { url, path }.
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
}) {
  const c = getClient();
  log.info("Generating Nano Banana image:", String(prompt).slice(0, 80));

  // Resolve the reference photo (if any) into inline base64 the model can read.
  let reference = null;
  if (referenceImage) {
    reference =
      typeof referenceImage === "string"
        ? await loadMediaAsBase64(referenceImage)
        : referenceImage?.data
          ? referenceImage
          : null;
    if (referenceImage && !reference) {
      log.warn("reference image could not be loaded; generating without it");
    }
  }

  const fullPrompt = buildInfluencerImagePrompt(prompt, {
    hasReference: Boolean(reference),
    selfie: frameAsSelfie,
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
  let res;
  try {
    res = await c.models.generateContent({
      model: config.gemini.imageModel,
      contents,
      config: {
        responseModalities: ["IMAGE"],
        imageConfig: {
          aspectRatio,
          ...(!isLegacyFlash ? { imageSize: "2K" } : {}),
        },
      },
    });
  } catch (err) {
    throw imageGenerationError(err);
  }

  const parts = res?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p?.inlineData?.data);
  if (!imagePart) {
    throw new Error("Nano Banana returned no image");
  }

  const buffer = Buffer.from(imagePart.inlineData.data, "base64");
  const out = await mediaPath(
    influencerId || "previews",
    `${label}-${Date.now()}.png`
  );
  await writeFile(out, buffer);
  return { url: mediaUrl(out), path: out };
}
