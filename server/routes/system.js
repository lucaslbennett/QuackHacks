import { randomUUID } from "node:crypto";
import { Router } from "express";
import { config, missingKeys } from "../config.js";
import * as gemini from "../services/gemini.js";
import * as eleven from "../services/elevenlabs.js";
import * as fal from "../services/fal.js";
import * as stagehand from "../services/browser/stagehand.js";
import { createInstagramAccount } from "../services/browser/createAccount.js";
import { pool } from "../db/pool.js";
import { submitManualCode } from "../services/verification.js";
import { createLogger, formatError } from "../lib/logger.js";

const router = Router();
const log = createLogger("smoke");

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

// Smoke test: launch a real Browserbase session and confirm it can drive a
// page. Returns the live session URL so the run can be watched in Browserbase.
router.post("/smoke/browserbase", async (req, res) => {
  if (!stagehand.isConfigured()) {
    return res
      .status(400)
      .json({ ok: false, error: "BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID required" });
  }
  const url = req.body.url || "https://www.instagram.com/accounts/emailsignup/";
  let sessionInfo = null;
  try {
    const result = await stagehand.withStagehand(
      async ({ page }) => {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
        const title = await page.title().catch(() => "");
        const currentUrl = page.url();
        return { title, currentUrl };
      },
      { onSession: (info) => (sessionInfo = info) }
    );
    res.json({
      ok: true,
      ...result,
      sessionId: sessionInfo?.sessionId || null,
      sessionUrl: sessionInfo?.sessionUrl || null,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: formatError(err),
      sessionId: sessionInfo?.sessionId || null,
      sessionUrl: sessionInfo?.sessionUrl || null,
    });
  }
});

// In-memory store of full-flow test runs (persona generation + account spawn).
// Kept small/ephemeral; this is a developer test harness, not durable state.
const spawnRuns = new Map();

function publicRun(run) {
  if (!run) return null;
  return {
    runId: run.runId,
    status: run.status,
    steps: run.steps,
    inputs: run.inputs,
    persona: run.persona || null,
    sessionId: run.sessionId || null,
    sessionUrl: run.sessionUrl || null,
    account: run.account || null,
    error: run.error || null,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt || null,
  };
}

// Full-flow smoke test: generate a persona with Gemini, then launch a
// Browserbase session and attempt to create an Instagram user with it.
// Runs in the background and is polled via GET /smoke/spawn-user/:runId.
router.post("/smoke/spawn-user", async (req, res) => {
  if (!gemini.isConfigured()) {
    return res.status(400).json({ ok: false, error: "GEMINI_API_KEY required" });
  }
  if (!stagehand.isConfigured()) {
    return res
      .status(400)
      .json({ ok: false, error: "BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID required" });
  }

  const inputs = {
    name: req.body.name || "Test Creator",
    niche: req.body.niche || "fashion",
    questionnaire: req.body.questionnaire || {},
    sources: req.body.sources || [],
    email: req.body.email || `qa.${Date.now()}@example.com`,
    phone: req.body.phone || "",
  };

  const runId = randomUUID();
  const run = {
    runId,
    status: "running",
    steps: { persona: "pending", session: "pending", account: "pending" },
    inputs,
    startedAt: new Date().toISOString(),
  };
  spawnRuns.set(runId, run);

  // Respond immediately; do the heavy lifting in the background.
  res.status(202).json({ ok: true, ...publicRun(run) });

  (async () => {
    try {
      run.steps.persona = "running";
      const persona = await gemini.synthesizePersona({
        name: inputs.name,
        niche: inputs.niche,
        questionnaire: inputs.questionnaire,
        sources: inputs.sources,
      });
      run.persona = persona;
      run.steps.persona = "done";

      run.steps.session = "running";
      run.steps.account = "running";
      const account = await createInstagramAccount({
        influencerId: runId,
        persona,
        email: inputs.email,
        phone: inputs.phone,
        onSession: ({ sessionId, sessionUrl }) => {
          run.sessionId = sessionId;
          run.sessionUrl = sessionUrl;
          run.steps.session = "done";
        },
      });
      run.account = {
        username: account.username,
        password: account.password,
        email: account.email,
        phone: account.phone,
        fullName: account.fullName,
        loggedIn: account.loggedIn,
        note: account.note,
      };
      run.steps.account = "done";
      run.status = "done";
    } catch (err) {
      run.error = formatError(err);
      run.status = "error";
      for (const k of ["persona", "session", "account"]) {
        if (run.steps[k] === "running") run.steps[k] = "error";
      }
      log.error("spawn-user run failed", run.error);
    } finally {
      run.finishedAt = new Date().toISOString();
    }
  })();
});

// Poll a full-flow test run.
router.get("/smoke/spawn-user/:runId", (req, res) => {
  const run = spawnRuns.get(req.params.runId);
  if (!run) return res.status(404).json({ ok: false, error: "run not found" });
  res.json({ ok: true, ...publicRun(run) });
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
