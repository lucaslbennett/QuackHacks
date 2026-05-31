import { randomUUID } from "node:crypto";
import { Router } from "express";
import { generateEmail, peekEmailCode } from "../services/verification.js";
import { buildAccountIdentity } from "../services/identity.js";
import { config } from "../config.js";
import { createLogger, formatError } from "../lib/logger.js";

// Guided, USER-DRIVEN account creation.
//
// The fully-automated Browser Use signup (services/browser/createAccount.js)
// keeps tripping Instagram's bot defenses (reCAPTCHA Enterprise, image-code
// challenges, suspicious-funnel detection). A real person in their own browser
// clears those trivially. So this flow keeps only the parts automation is good
// at — minting a realistic identity and provisioning a REAL inbox we can read —
// and hands the bot-sensitive steps (page load, human check, submit) to the
// user. We then watch the inbox and surface Instagram's verification code back
// to them, so they never have to leave the app to check email.

const router = Router();
const log = createLogger("account");

const IG_SIGNUP_URL = "https://www.instagram.com/accounts/emailsignup/";

// Ephemeral store of account drafts (draftId -> draft). Each holds the generated
// identity + the inbox we provisioned, plus the time we created it (the cutoff
// for code polling). A draft only needs to outlive a single guided signup, so
// entries are pruned after a TTL.
const drafts = new Map();
const DRAFT_TTL_MS = 60 * 60 * 1000; // 1h

function pruneDrafts() {
  const now = Date.now();
  for (const [id, d] of drafts) {
    if (now - d.createdAt > DRAFT_TTL_MS) drafts.delete(id);
  }
}

function publicDraft(d) {
  return {
    draftId: d.draftId,
    fullName: d.fullName,
    username: d.username,
    password: d.password,
    email: d.email,
    birthday: {
      monthName: d.dob.monthName,
      month: d.dob.monthNumber,
      day: d.dob.day,
      year: d.dob.year,
      label: `${d.dob.monthName} ${d.dob.day}, ${d.dob.year}`,
    },
    signupUrl: IG_SIGNUP_URL,
    emailProvider: config.verification.emailProvider,
    createdAt: d.createdAt,
  };
}

// Generate a complete, ready-to-use identity + a REAL inbox-backed email up
// front. Returns everything the build screen needs to display and to autofill
// Instagram's form in the user's browser.
router.post("/draft", async (req, res) => {
  pruneDrafts();
  const { name, niche, persona, seed } = req.body || {};
  let email;
  try {
    email = await generateEmail({ seed: seed || name || persona?.displayName || "creator" });
  } catch (err) {
    return res
      .status(502)
      .json({ ok: false, error: `email inbox provisioning failed: ${err.message}` });
  }
  const identity = buildAccountIdentity({ persona, name });
  const draftId = randomUUID();
  const draft = {
    draftId,
    email,
    createdAt: Date.now(),
    ...identity, // fullName, username, password, dob
    niche: niche || null,
  };
  drafts.set(draftId, draft);
  log.info("Created account draft", { draftId, username: draft.username, email });
  res.json({ ok: true, ...publicDraft(draft) });
});

// Client-polled: has Instagram's verification code landed in the draft's inbox
// yet? Returns `{ code }` (null until it arrives) so the build screen can show
// it the instant it's caught — the user never has to open the inbox themselves.
router.get("/draft/:draftId/code", async (req, res) => {
  const draft = drafts.get(req.params.draftId);
  if (!draft) {
    return res.status(404).json({ ok: false, error: "draft not found (it may have expired)" });
  }
  try {
    const hit = await peekEmailCode({
      influencerId: draft.draftId,
      to: draft.email,
      // Small grace for clock skew between our host and the mail provider.
      receivedAfter: draft.createdAt - 60000,
    });
    res.json({
      ok: true,
      code: hit?.code || null,
      email: draft.email,
      emailProvider: config.verification.emailProvider,
    });
  } catch (err) {
    // Never fail the poll — the client just keeps trying.
    res.json({ ok: true, code: null, error: formatError(err) });
  }
});

export default router;
