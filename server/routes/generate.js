import { Router } from "express";
import * as repo from "../db/repo.js";
import * as gemini from "../services/gemini.js";
import * as fal from "../services/fal.js";
import { requireAuth, optionalAuth } from "../lib/auth.js";
import { pick, FIRST_NAMES, LAST_NAMES } from "../lib/util.js";

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

// Builds a fresh-ish post (caption + hashtags + image prompt) straight from a
// persona, no LLM. Used when Gemini isn't configured so "generate post" still
// works on the fal key alone. Varies by pillar + a random angle each call.
const POST_ANGLES = [
  "a quick tip",
  "a behind-the-scenes moment",
  "a relatable everyday struggle",
  "a question for the comments",
  "a 'things nobody tells you' angle",
  "a currently-obsessed recommendation",
];
function buildPostFromPersona(persona) {
  const niche = persona.niche || persona.displayName || "lifestyle";
  const pillars =
    Array.isArray(persona.contentPillars) && persona.contentPillars.length
      ? persona.contentPillars
      : [niche];
  const pillar = pillars[Math.floor(Math.random() * pillars.length)];
  const angle = POST_ANGLES[Math.floor(Math.random() * POST_ANGLES.length)];
  const slug = String(niche).toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 14) || "creator";

  const caption = `${pillar} — ${angle}. ${persona.bio || `More ${niche} every week.`} What do you want to see next? 👇`;
  const hashtags = Array.from(
    new Set([
      slug,
      ...String(pillar).toLowerCase().split(/\s+/).filter(Boolean),
      "creator",
      "fyp",
      "reels",
    ])
  ).slice(0, 10);
  const imagePrompt =
    persona.imagePrompt ||
    [persona.appearance, persona.aesthetic].filter(Boolean).join(". ") ||
    `${niche} influencer, ${pillar} scene, natural lighting`;

  return { caption, hashtags, imagePrompt, altText: `${niche} post`, title: pillar };
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
  const firstName = pick(FIRST_NAMES);
  const lastName = pick(LAST_NAMES);
  const displayName = `${firstName} ${lastName}`;
  const lookClause =
    look && !/you decide/i.test(look) ? look : "natural, approachable, modern";

  return {
    firstName,
    lastName,
    displayName,
    tagline: `${vibe} ${niche} content for ${audience}`.slice(0, 60),
    handleSuggestions: (() => {
      const f = firstName.toLowerCase();
      const l = lastName.toLowerCase().replace(/[^a-z0-9]+/g, "");
      return [`${f}.${l}`, `${f}${l}`, `${f}.${slug}`];
    })(),
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

    // Per-request randomness so repeated identical answers (e.g. always asking
    // for "Stacy") don't collapse to the same surname. The surname is picked
    // from a real list and suggested to the model.
    const suggestedLastName = pick(LAST_NAMES);

    const character = gemini.isConfigured()
      ? await gemini.designOnboardingCharacter({ answers, suggestedLastName })
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

// Public: generate a brand-new, varied Instagram post (image + caption +
// hashtags) for an existing persona. Designed to be called repeatedly from an
// influencer's detail page; each call produces a fresh, natural-feeling post.
// The response includes a ready-to-paste block so it can be dropped straight
// into Instagram until Browserbase auto-posting is wired up.
router.post(
  "/post",
  optionalAuth,
  asyncH(async (req, res) => {
    // The persona shape we store on a saved generation (Character). Older saved
    // rows may have an empty persona, so fall back to the prompt text.
    const persona =
      req.body.persona && typeof req.body.persona === "object"
        ? req.body.persona
        : {};
    const fallbackPrompt = String(req.body.prompt || "").trim();
    // When the panel passes an owned influencerId, the post is persisted to that
    // influencer's content history.
    const influencerId = req.body.influencerId || null;

    const hasPersona = persona && Object.keys(persona).length > 0;
    if (!hasPersona && !fallbackPrompt) {
      return res
        .status(400)
        .json({ ok: false, error: "persona or prompt is required" });
    }
    if (!fal.isConfigured() && !gemini.isConfigured()) {
      return res
        .status(503)
        .json({ ok: false, error: "post generation is not configured" });
    }

    // If we only have a prompt (no structured persona), build a minimal persona
    // so the generator still has something on-brand to work from.
    const effectivePersona = hasPersona
      ? persona
      : {
          displayName: "Influencer",
          niche: fallbackPrompt,
          personality: fallbackPrompt,
          appearance: fallbackPrompt,
          aesthetic: fallbackPrompt,
        };

    // Caption/hashtags via Gemini when available; otherwise a persona-derived
    // fallback so the post still works on the fal key alone.
    const post = gemini.isConfigured()
      ? await gemini.generatePostContent({ persona: effectivePersona })
      : buildPostFromPersona(effectivePersona);

    // Render the post image from the scene prompt the writer produced. Prefer
    // fal Nano Banana (matches onboarding), fall back to the Gemini image path.
    const imagePrompt =
      post.imagePrompt ||
      effectivePersona.imagePrompt ||
      [effectivePersona.appearance, effectivePersona.aesthetic]
        .filter(Boolean)
        .join(". ") ||
      fallbackPrompt;

    const image = fal.isConfigured()
      ? await fal.generateNanoBananaImage({ prompt: imagePrompt, label: "post" })
      : await gemini.generateInfluencerImage({ prompt: imagePrompt, label: "post" });

    const hashtagLine = post.hashtags.map((h) => `#${h}`).join(" ");
    // A single block that's trivial to copy and paste into Instagram: caption,
    // a blank line, then the hashtags.
    const copyText = [post.caption, hashtagLine].filter(Boolean).join("\n\n");

    // Persist to the influencer's content history when the caller owns it. The
    // image URL is stored in image_paths (no video for an image post); status
    // "ready" means it's generated and ready to publish. Best-effort: a save
    // failure never blocks returning the generated post to the user.
    let contentId = null;
    if (influencerId && req.user) {
      try {
        const inf = await repo.influencers.get(influencerId);
        if (inf && inf.user_id === req.user.id) {
          const item = await repo.content.create({
            influencerId,
            topic: post.title || null,
            status: "ready",
          });
          await repo.content.update(item.id, {
            title: post.title || null,
            caption: post.caption,
            hashtags: post.hashtags || [],
            image_paths: [image.url],
            meta: { altText: post.altText, imagePrompt, source: "quick-post" },
          });
          contentId = item.id;
        }
      } catch {
        /* non-fatal: still return the generated post below */
      }
    }

    res.json({
      ok: true,
      contentId,
      imageUrl: image.url,
      caption: post.caption,
      hashtags: post.hashtags,
      hashtagLine,
      altText: post.altText,
      imagePrompt,
      copyText,
    });
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
