// Verifies the "Confirm you're human" image-code solver against a sample image.
// Runs BOTH engines the signup flow uses to beat Instagram's image-code
// challenge (screenshot -> read code -> type it):
//   1. PRIMARY — our LLM, Gemini vision (gemini.readCaptchaCode)
//   2. BACKUP  — CapSolver ImageToText OCR (capsolver.solveImageToText), the
//                service purpose-built for "enter the code from the image"
// and prints what each read so you can compare accuracy / confirm the backup.
//
// Usage:
//   node server/scripts/probeCaptchaOcr.js <path-to-image>
//   node server/scripts/probeCaptchaOcr.js <path-to-image> --expect=637760
//   node server/scripts/probeCaptchaOcr.js <path-to-image> --only=capsolver
import { readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import * as gemini from "../services/gemini.js";
import * as capsolver from "../services/browser/capsolver.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("captcha-ocr-probe");

const MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function parseArgs(argv) {
  let imagePath = null;
  let expect = null;
  let only = null; // "gemini" | "capsolver"
  for (const arg of argv) {
    if (arg.startsWith("--expect=")) expect = arg.slice("--expect=".length).trim();
    else if (arg.startsWith("--only=")) only = arg.slice("--only=".length).trim().toLowerCase();
    else if (!arg.startsWith("--")) imagePath = arg;
  }
  return { imagePath, expect, only };
}

async function main() {
  const { imagePath, expect, only } = parseArgs(process.argv.slice(2));

  log.info("config", {
    geminiKeySet: gemini.isConfigured(),
    captchaModel: config.gemini.captchaModel || config.gemini.model,
    capsolverKeySet: capsolver.isConfigured(),
    imageToTextModule: config.capsolver.imageToTextModule,
  });
  if (!imagePath) {
    log.error("Pass the path to a CAPTCHA image, e.g. node server/scripts/probeCaptchaOcr.js ./code.png");
    process.exit(2);
  }
  if (!gemini.isConfigured() && !capsolver.isConfigured()) {
    log.error("Set GEMINI_API_KEY and/or CAPSOLVER_API_KEY to read the code");
    process.exit(2);
  }

  let buffer;
  try {
    buffer = await readFile(imagePath);
  } catch (err) {
    log.error(`Could not read image at ${imagePath}: ${err.message}`);
    process.exit(1);
  }
  const ext = path.extname(imagePath).toLowerCase();
  const mimeType = MIME_BY_EXT[ext] || "image/png";
  const imageBase64 = buffer.toString("base64");
  log.info("loaded image", { imagePath, mimeType, bytes: buffer.length });

  const results = {};

  // 1. PRIMARY — Gemini vision.
  if (gemini.isConfigured() && only !== "capsolver") {
    const started = Date.now();
    const code = await gemini.readCaptchaCode({ imageBase64, mimeType, hint: "usually a 6-digit number" });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    results.gemini = code;
    if (code) log.info(`PRIMARY (Gemini) read: "${code}" (${secs}s)`);
    else log.warn(`PRIMARY (Gemini) could not read a code (${secs}s)`);
  }

  // 2. BACKUP — CapSolver ImageToText.
  if (capsolver.isConfigured() && only !== "gemini") {
    const started = Date.now();
    try {
      const text = await capsolver.solveImageToText({
        imageBase64,
        module: config.capsolver.imageToTextModule || undefined,
      });
      const code = (text || "").replace(/[^a-z0-9]/gi, "").trim() || null;
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      results.capsolver = code;
      if (code) log.info(`BACKUP (CapSolver ImageToText) read: "${code}" (${secs}s)`);
      else log.warn(`BACKUP (CapSolver ImageToText) returned an empty code (${secs}s)`);
    } catch (err) {
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      log.error(`BACKUP (CapSolver ImageToText) failed (${secs}s): ${err.message}`);
      results.capsolver = null;
    }
  }

  const reads = Object.values(results).filter(Boolean);
  if (reads.length === 0) {
    log.error("Neither engine could read a code");
    process.exit(1);
  }

  if (expect) {
    const matched = Object.entries(results)
      .filter(([, code]) => code === expect)
      .map(([engine]) => engine);
    if (matched.length) {
      log.info(`MATCH — ${matched.join(", ")} read the expected code "${expect}"`);
    } else {
      log.error(`MISMATCH — expected "${expect}" but read ${JSON.stringify(results)}`);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  log.error("probe crashed:", err?.stack || err?.message || err);
  process.exit(1);
});
