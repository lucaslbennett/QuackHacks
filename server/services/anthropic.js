import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("anthropic");

let client = null;
function getClient() {
  if (!config.anthropic.apiKey) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
  if (!client) client = new Anthropic({ apiKey: config.anthropic.apiKey });
  return client;
}

export function isConfigured() {
  return Boolean(config.anthropic.apiKey);
}

// Low level helper that asks Claude for JSON and parses it defensively.
async function completeJson({ system, prompt, maxTokens = 2000 }) {
  const c = getClient();
  const res = await c.messages.create({
    model: config.anthropic.model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
  });
  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
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
