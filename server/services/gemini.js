import { writeFile } from "node:fs/promises";
import { GoogleGenAI } from "@google/genai";
import { config } from "../config.js";
import { mediaPath, mediaUrl } from "../lib/util.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("gemini");

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

// Low level helper that asks Gemini for JSON and parses it defensively.
// `temperature` lets callers crank up variety (e.g. fresh post captions) while
// most callers keep the default for stable, on-brand output.
async function completeJson({ system, prompt, maxTokens = 2000, temperature }) {
  const c = getClient();
  const res = await c.models.generateContent({
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
  });
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
export async function designOnboardingCharacter({ answers }) {
  log.info("Designing onboarding character");
  const system =
    "You are a brand strategist who designs hyper-realistic, legally-safe AI influencer personas. " +
    "From a few short onboarding answers you invent a complete, believable creator and the content they post. " +
    "Be specific and concrete. Always respond with strict JSON only.";

  const prompt = `Design an AI influencer character from these onboarding answers.

Onboarding answers (question -> answer):
${JSON.stringify(answers || {}, null, 2)}

Return JSON with this exact shape:
{
  "displayName": string,            // an inventive, real-sounding creator name
  "tagline": string,                // <= 60 chars, the character in one line
  "handleSuggestions": string[3],   // lowercase instagram handles, no spaces or @
  "niche": string,
  "bio": string,                    // <= 150 chars instagram bio with light emoji
  "personality": string,            // 2-3 sentences, first impression of who they are
  "appearance": string,             // vivid physical description for image generation
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
  "imagePrompt": string             // a single rich prompt describing the character's portrait
}`;

  return completeJson({ system, prompt, maxTokens: 2000 });
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
- Keep hashtags OUT of the caption body. Put them only in the "hashtags" array.
- Provide a vivid image generation prompt that matches the persona's appearance/aesthetic
  and depicts a concrete, photo-worthy scene for THIS specific post (not just a portrait).

Return JSON with this exact shape:
{
  "caption": string,            // the post caption, natural, 1-4 short paragraphs, light emoji ok, NO hashtags
  "hashtags": string[10],       // 8-12 relevant hashtags, lowercase, WITHOUT the # symbol
  "imagePrompt": string,        // rich scene description for the post image
  "altText": string             // short accessibility description of the image
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

  return {
    caption: String(data.caption || "").trim(),
    hashtags,
    imagePrompt: String(data.imagePrompt || "").trim(),
    altText: String(data.altText || "").trim(),
    angle,
  };
}

// Generates an influencer portrait with Nano Banana Pro (Gemini 3 Pro Image)
// and saves it locally. Returns { url, path }.
export async function generateInfluencerImage({
  prompt,
  influencerId,
  label = "influencer",
  aspectRatio = "1:1",
}) {
  const c = getClient();
  log.info("Generating influencer image:", String(prompt).slice(0, 80));

  const fullPrompt =
    "Photorealistic, high-quality portrait of a social-media influencer for an " +
    "AI influencer platform. Natural lighting, modern aesthetic, looks like a real " +
    `person posting on Instagram. Description: ${prompt}`;

  const res = await c.models.generateContent({
    model: config.gemini.imageModel,
    contents: fullPrompt,
    config: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio, imageSize: "2K" },
    },
  });

  const parts = res?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((p) => p?.inlineData?.data);
  if (!imagePart) {
    throw new Error("Nano Banana Pro returned no image");
  }

  const buffer = Buffer.from(imagePart.inlineData.data, "base64");
  const out = await mediaPath(
    influencerId || "previews",
    `${label}-${Date.now()}.png`
  );
  await writeFile(out, buffer);
  return { url: mediaUrl(out), path: out };
}
