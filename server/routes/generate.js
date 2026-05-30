import { Router } from "express";
import * as repo from "../db/repo.js";
import * as gemini from "../services/gemini.js";
import * as fal from "../services/fal.js";
import { requireAuth } from "../lib/auth.js";

const router = Router();

const asyncH = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) =>
    res.status(500).json({ ok: false, error: err.message })
  );

// Looks up an onboarding answer by a keyword in its question text. Answers are
// keyed by the full question string the chat asked.
function findAnswer(answers, keyword) {
  const hit = Object.entries(answers).find(([q]) =>
    q.toLowerCase().includes(keyword)
  );
  return (hit?.[1] || "").trim();
}

// Builds a usable character straight from the chat answers, no LLM. Used when
// Gemini isn't configured so onboarding still works on the fal key alone.
function buildCharacterFromAnswers(answers) {
  const niche = findAnswer(answers, "niche") || "lifestyle";
  const audience = findAnswer(answers, "audience") || "a broad online audience";
  const vibe = findAnswer(answers, "vibe") || findAnswer(answers, "personality") || "warm and authentic";
  const format = findAnswer(answers, "post") || findAnswer(answers, "content") || "short-form videos";
  const look = findAnswer(answers, "look") || "";

  const slug = niche
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 12) || "creator";
  const displayName = `${niche.replace(/(^|\s)\S/g, (s) => s.toUpperCase())} Creator`;
  const lookClause =
    look && !/you decide/i.test(look) ? look : "natural, approachable, modern";

  return {
    displayName,
    tagline: `${vibe} ${niche} content for ${audience}`.slice(0, 60),
    handleSuggestions: [`${slug}.daily`, `the.${slug}`, `${slug}hq`],
    niche,
    bio: `${niche} for ${audience} ✨ ${vibe}`.slice(0, 150),
    personality: `A ${vibe} creator who lives and breathes ${niche}. They speak directly to ${audience} and keep things real.`,
    appearance: lookClause,
    aesthetic: `${vibe} ${niche} aesthetic, natural lighting, modern social-media feed`,
    contentPillars: [
      `${niche} tips`,
      `behind the scenes`,
      `${niche} trends`,
      `community Q&A`,
    ],
    contentFormats: [format, "talking-head reels", "day-in-the-life vlogs"],
    samplePosts: [
      {
        hook: `The one ${niche} thing nobody tells you`,
        caption: `Saving you the trial-and-error. Follow for more ${niche}. #${slug}`,
      },
      {
        hook: `A day in my ${niche} life`,
        caption: `Realistic, not perfect. Made for ${audience}. #${slug}`,
      },
      {
        hook: `You asked, I answered`,
        caption: `Your top ${niche} questions this week. Drop more below 👇`,
      },
    ],
    postingStrategy: {
      postsPerDay: 2,
      bestTimes: ["8am", "12pm", "7pm"],
      hashtagThemes: [niche, "creator", "fyp"],
    },
    imagePrompt: `Portrait of a ${niche} social-media influencer. ${lookClause}. ${vibe} energy.`,
  };
}

// Public: generate an influencer image from a text prompt (free preview).
router.post(
  "/influencer-image",
  asyncH(async (req, res) => {
    const prompt = String(req.body.prompt || "").trim();
    if (!prompt) {
      return res.status(400).json({ ok: false, error: "prompt is required" });
    }
    if (!gemini.isConfigured()) {
      return res
        .status(503)
        .json({ ok: false, error: "image generation is not configured" });
    }

    const image = await gemini.generateInfluencerImage({ prompt });
    res.json({ ok: true, prompt, imageUrl: image.url });
  })
);

// Public: from a handful of onboarding chat answers, design a character and
// render its portrait. The persona/content plan is written by Gemini when it's
// configured, otherwise built directly from the answers so the flow runs on the
// fal key alone. The portrait uses Nano Banana on fal.ai, falling back to the
// Gemini image path only if fal isn't configured.
router.post(
  "/onboarding-character",
  asyncH(async (req, res) => {
    const answers = req.body.answers;
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
      return res
        .status(400)
        .json({ ok: false, error: "answers object is required" });
    }
    if (!fal.isConfigured() && !gemini.isConfigured()) {
      return res
        .status(503)
        .json({ ok: false, error: "character generation is not configured" });
    }

    const character = gemini.isConfigured()
      ? await gemini.designOnboardingCharacter({ answers })
      : buildCharacterFromAnswers(answers);

    const imagePrompt =
      character.imagePrompt ||
      [character.appearance, character.aesthetic].filter(Boolean).join(". ") ||
      character.displayName;

    const image = fal.isConfigured()
      ? await fal.generateNanoBananaImage({ prompt: imagePrompt })
      : await gemini.generateInfluencerImage({ prompt: imagePrompt });

    res.json({ ok: true, character, imageUrl: image.url });
  })
);

// Auth required: persist a generated image to the user's dashboard.
router.post(
  "/save",
  requireAuth,
  asyncH(async (req, res) => {
    const prompt = String(req.body.prompt || "").trim();
    const imageUrl = String(req.body.imageUrl || "").trim();
    const persona =
      req.body.persona && typeof req.body.persona === "object"
        ? req.body.persona
        : {};
    if (!prompt || !imageUrl) {
      return res
        .status(400)
        .json({ ok: false, error: "prompt and imageUrl are required" });
    }
    const generation = await repo.generations.create({
      userId: req.user.id,
      prompt,
      imageUrl,
      persona,
    });
    res.status(201).json({ ok: true, generation });
  })
);

// Auth required: list the user's saved generations for the dashboard.
router.get(
  "/saved",
  requireAuth,
  asyncH(async (req, res) => {
    const generations = await repo.generations.listFor(req.user.id);
    res.json({ ok: true, generations });
  })
);

export default router;
