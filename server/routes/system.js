import { Router } from "express";
import { config, missingKeys } from "../config.js";
import * as gemini from "../services/gemini.js";
import * as eleven from "../services/elevenlabs.js";
import * as fal from "../services/fal.js";
import * as stagehand from "../services/browser/stagehand.js";
import { pool } from "../db/pool.js";
import { submitManualCode } from "../services/verification.js";

const router = Router();

router.get("/status", async (req, res) => {
  let db = false;
  try {
    await pool.query("SELECT 1");
    db = true;
  } catch {
    db = false;
  }
  res.json({
    ok: true,
    env: config.env,
    integrations: {
      database: db,
      gemini: gemini.isConfigured(),
      elevenlabs: eleven.isConfigured(),
      fal: fal.isConfigured(),
      browserbase: stagehand.isConfigured(),
    },
    missingKeys: missingKeys(),
    verification: {
      emailProvider: config.verification.emailProvider,
      smsProvider: config.verification.smsProvider,
    },
  });
});

// Smoke test: generate a persona without persisting.
router.post("/smoke/persona", async (req, res) => {
  try {
    const persona = await gemini.synthesizePersona({
      name: req.body.name || "Test Creator",
      niche: req.body.niche || "fashion",
      questionnaire: req.body.questionnaire || {},
      sources: req.body.sources || [],
    });
    res.json({ ok: true, persona });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get("/smoke/voices", async (req, res) => {
  try {
    const voices = await eleven.listVoices();
    res.json({ ok: true, count: voices.length, voices: voices.slice(0, 20) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Manual verification code entry (fallback when no email/SMS API is wired).
router.post("/verification/:influencerId/:kind", (req, res) => {
  const { influencerId, kind } = req.params;
  const { code } = req.body;
  if (!code || !["email", "sms"].includes(kind)) {
    return res.status(400).json({ ok: false, error: "kind must be email|sms and code required" });
  }
  submitManualCode(influencerId, kind, code);
  res.json({ ok: true });
});

export default router;
