import { Router } from "express";
import * as repo from "../db/repo.js";
import * as gemini from "../services/gemini.js";
import { requireAuth } from "../lib/auth.js";

const router = Router();

const asyncH = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) =>
    res.status(500).json({ ok: false, error: err.message })
  );

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

// Auth required: persist a generated image to the user's dashboard.
router.post(
  "/save",
  requireAuth,
  asyncH(async (req, res) => {
    const prompt = String(req.body.prompt || "").trim();
    const imageUrl = String(req.body.imageUrl || "").trim();
    if (!prompt || !imageUrl) {
      return res
        .status(400)
        .json({ ok: false, error: "prompt and imageUrl are required" });
    }
    const generation = await repo.generations.create({
      userId: req.user.id,
      prompt,
      imageUrl,
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
