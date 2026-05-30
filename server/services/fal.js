import { writeFile } from "node:fs/promises";
import { fal } from "@fal-ai/client";
import { config } from "../config.js";
import { mediaPath } from "../lib/util.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("fal");

let configured = false;
function ensureConfig() {
  if (!config.fal.apiKey) throw new Error("FAL_KEY not configured");
  if (!configured) {
    fal.config({ credentials: config.fal.apiKey });
    configured = true;
  }
}

export function isConfigured() {
  return Boolean(config.fal.apiKey);
}

async function downloadTo(url, absPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(absPath, buf);
  return absPath;
}

// Generates a still image and saves it locally. Returns { url, path }.
export async function generateImage({ prompt, influencerId, label = "img", imageSize = "portrait_16_9" }) {
  ensureConfig();
  log.info("Generating image:", prompt.slice(0, 80));
  const result = await fal.subscribe(config.fal.imageModel, {
    input: { prompt, image_size: imageSize, num_images: 1 },
    logs: false,
  });
  const url = result?.data?.images?.[0]?.url || result?.images?.[0]?.url;
  if (!url) throw new Error("fal image generation returned no image");
  const out = await mediaPath(influencerId || "misc", `${label}-${Date.now()}.jpg`);
  await downloadTo(url, out);
  return { url, path: out };
}

// Generates an image-to-video clip from a still. Returns { url, path }.
export async function generateVideoFromImage({ imageUrl, prompt, influencerId, label = "clip" }) {
  ensureConfig();
  log.info("Generating video from image:", prompt?.slice(0, 80));
  const result = await fal.subscribe(config.fal.videoModel, {
    input: { image_url: imageUrl, prompt: prompt || "subtle cinematic motion", duration: "5" },
    logs: false,
  });
  const url = result?.data?.video?.url || result?.video?.url;
  if (!url) throw new Error("fal video generation returned no video");
  const out = await mediaPath(influencerId || "misc", `${label}-${Date.now()}.mp4`);
  await downloadTo(url, out);
  return { url, path: out };
}

// Uploads a local buffer/file to fal storage so it can be used as model input.
export async function uploadFile(buffer, filename = "upload.jpg") {
  ensureConfig();
  const file = new File([buffer], filename);
  return fal.storage.upload(file);
}
