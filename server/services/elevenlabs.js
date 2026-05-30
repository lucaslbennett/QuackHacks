import { writeFile } from "node:fs/promises";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { config } from "../config.js";
import { mediaPath } from "../lib/util.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("elevenlabs");

let client = null;
function getClient() {
  if (!config.elevenlabs.apiKey) throw new Error("ELEVENLABS_API_KEY not configured");
  if (!client) client = new ElevenLabsClient({ apiKey: config.elevenlabs.apiKey });
  return client;
}

export function isConfigured() {
  return Boolean(config.elevenlabs.apiKey);
}

export async function listVoices() {
  const c = getClient();
  const res = await c.voices.search({ pageSize: 100 }).catch(() => c.voices.getAll());
  return res.voices || res || [];
}

// Picks an ElevenLabs voice that best matches the persona's voiceCasting hints.
export async function pickVoiceForPersona(persona) {
  const casting = persona?.voiceCasting || {};
  let voices = [];
  try {
    voices = await listVoices();
  } catch (err) {
    log.warn("Could not list voices, using default:", err.message);
    return config.elevenlabs.defaultVoiceId;
  }
  if (!voices.length) return config.elevenlabs.defaultVoiceId;

  const wantGender = (casting.gender || "").toLowerCase();
  const scored = voices.map((v) => {
    const labels = v.labels || {};
    let score = 0;
    const g = (labels.gender || "").toLowerCase();
    if (wantGender && g && g === wantGender) score += 3;
    const age = (labels.age || "").toLowerCase();
    if (casting.age && age.includes(casting.age)) score += 1;
    const accent = (labels.accent || "").toLowerCase();
    if (casting.accent && accent.includes(String(casting.accent).toLowerCase())) score += 1;
    return { id: v.voiceId || v.voice_id, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.id || config.elevenlabs.defaultVoiceId;
}

async function streamToBuffer(stream) {
  if (Buffer.isBuffer(stream)) return stream;
  // ReadableStream (web) or async iterable of Uint8Array.
  const chunks = [];
  if (typeof stream.getReader === "function") {
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
  } else {
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// Synthesizes narration to an mp3 file and returns its absolute path.
export async function synthesizeNarration({ text, voiceId, influencerId, contentId }) {
  const c = getClient();
  const voice = voiceId || config.elevenlabs.defaultVoiceId;
  log.info("Synthesizing narration with voice", voice);
  const audio = await c.textToSpeech.convert(voice, {
    text,
    modelId: config.elevenlabs.model,
    outputFormat: "mp3_44100_128",
  });
  const buf = await streamToBuffer(audio);
  const out = await mediaPath(influencerId || "misc", `${contentId || Date.now()}.mp3`);
  await writeFile(out, buf);
  log.info("Narration written", out, `${buf.length} bytes`);
  return out;
}
