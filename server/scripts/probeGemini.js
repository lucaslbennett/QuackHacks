// Diagnose GEMINI_API_KEY: text auth, image quota, and billing-related errors.
//
// Usage:
//   npm run probe:gemini
//   npm run probe:gemini -- --image   # also run a real image-generation call (~5–15s)
import { GoogleGenAI } from "@google/genai";
import { config } from "../config.js";
import { verifyAccess } from "../services/gemini.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("gemini-probe");
const runImage = process.argv.includes("--image");

function keyKind(key) {
  if (!key) return "missing";
  if (key.startsWith("AIza")) return "standard-api-key (AIza…)";
  if (key.startsWith("AQ.")) return "oauth-style token (AQ.…) — not a durable API key";
  return "unknown format";
}

function parseApiError(err) {
  const message = String(err?.message || err || "");
  const code =
    err?.status ||
    message.match(/"code"\s*:\s*(\d+)/)?.[1] ||
    message.match(/\b(401|403|429|400|503)\b/)?.[1];
  const status = message.match(/UNAUTHENTICATED|PERMISSION_DENIED|RESOURCE_EXHAUSTED|FAILED_PRECONDITION/i)?.[0];
  const limitZero = /limit[":\s]+0\b/i.test(message);
  const freeTier = /free_tier/i.test(message);
  const billing = /billing|FAILED_PRECONDITION/i.test(message);
  return { message, code, status, limitZero, freeTier, billing };
}

function advice({ text, image }) {
  const lines = [];

  if (!config.gemini.apiKey) {
    lines.push("Set GEMINI_API_KEY in .env (or Railway variables).");
    return lines;
  }

  const kind = keyKind(config.gemini.apiKey.trim());
  if (kind.includes("oauth-style")) {
    lines.push(
      "Your key looks like a short-lived OAuth token, not a permanent API key.",
      "In Google AI Studio → Get API key → create/copy a key that starts with AIza…",
      "Paste that into .env and Railway, then restart the server."
    );
  }

  if (text?.ok === false) {
    if (/401|UNAUTHENTICATED|API_KEY_INVALID/i.test(text.message || "")) {
      lines.push(
        "Text API rejected the key (401). Create a fresh API key in AI Studio and update GEMINI_API_KEY."
      );
    } else {
      lines.push(`Text API failed: ${(text.message || "").slice(0, 200)}`);
    }
  }

  if (image) {
    if (image.limitZero || image.freeTier) {
      lines.push(
        "Image quota is 0 — billing is not linked to THIS key's Google Cloud project, or the key was created before billing was enabled.",
        "",
        "Fix (in order):",
        "  1. AI Studio → API keys → note which Cloud project the key belongs to.",
        "  2. console.cloud.google.com/billing → link that SAME project to a billing account.",
        "  3. console.cloud.google.com/apis/library/generativelanguage.googleapis.com → enable Generative Language API on that project.",
        "  4. console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas → filter \"image\" → IPM should be > 0.",
        "  5. Create a NEW API key in that project (old keys sometimes stay on free-tier quota).",
        "  6. Update GEMINI_API_KEY on Railway + local .env, redeploy, wait 15–30 min.",
        "",
        "If billing says \"success\" but step 4 still shows 0: you likely enabled billing on a different project than the key uses."
      );
    } else if (image.billing) {
      lines.push(
        "Google says billing must be enabled for image generation on this project.",
        "Link billing to the exact project shown on your API key in AI Studio, then create a new key."
      );
    } else if (image.status === "RESOURCE_EXHAUSTED" && !image.limitZero) {
      lines.push("Temporary rate limit — wait a minute and retry.");
    } else if (image.ok) {
      lines.push("Image generation works. If Railway still fails, its GEMINI_API_KEY differs from local .env.");
    }
  }

  return lines;
}

async function probeImage(key) {
  const c = new GoogleGenAI({ apiKey: key });
  try {
    const res = await c.models.generateContent({
      model: config.gemini.imageModel,
      contents: "A solid red circle on a white background, minimal test image",
      config: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "1:1", imageSize: "2K" },
      },
    });
    const hasImage = Boolean(res?.candidates?.[0]?.content?.parts?.some((p) => p?.inlineData?.data));
    return { ok: hasImage, ...(hasImage ? {} : { message: "Response had no image bytes" }) };
  } catch (err) {
    const parsed = parseApiError(err);
    return { ok: false, ...parsed };
  }
}

async function main() {
  const key = (config.gemini.apiKey || "").trim();

  log.info("config", {
    keySet: Boolean(key),
    keyKind: keyKind(key),
    keyPrefix: key ? `${key.slice(0, 6)}… (${key.length} chars)` : null,
    textModel: config.gemini.model,
    imageModel: config.gemini.imageModel,
  });

  if (!key) {
    log.error("GEMINI_API_KEY is not set");
    process.exit(2);
  }

  log.info("probing text model…");
  const text = await verifyAccess();
  log.info("text", text.ok ? { ok: true } : text);

  let image = null;
  if (runImage) {
    log.info("probing image model (this may take ~10s)…", { model: config.gemini.imageModel });
    image = await probeImage(key);
    log.info("image", image.ok ? { ok: true } : image);
  } else {
    log.info("skip image probe (pass --image to test Nano Banana / image quota)");
  }

  const tips = advice({ text, image });
  if (tips.length) {
    console.log("\n--- What to do next ---");
    for (const line of tips) console.log(line);
  }

  if (!text.ok || (image && !image.ok)) process.exit(1);
}

main().catch((err) => {
  log.error(err);
  process.exit(1);
});
