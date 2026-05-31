// Standalone Browser Use test harness for the Instagram account-generation flow.
//
// Runs the REAL createInstagramAccount() against a live Browser Use session so
// we can confirm the full sequence (fields → birthday/age → CAPTCHA → email
// code → logged in) actually completes. Each step writes a screenshot to a
// per-run debug dir so a run that "abruptly stops" can be inspected frame by
// frame.
//
// Usage:
//   node server/scripts/signupTest.js                # one attempt
//   node server/scripts/signupTest.js --runs 5       # up to 5 attempts, stop on first success
//   node server/scripts/signupTest.js --runs 5 --all # run all 5 regardless of success
//   node server/scripts/signupTest.js --gemini       # synthesize the persona via Gemini
//
// Exit code is 0 if an account logged in, 1 otherwise.

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config, missingKeys } from "../config.js";
import { createInstagramAccount } from "../services/browser/createAccount.js";
import { isConfigured as browserUseConfigured } from "../services/browser/stagehand.js";
import { generateEmail } from "../services/verification.js";
import * as gemini from "../services/gemini.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("signup-test");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

// Deterministic fallback persona so the browser flow can be exercised without
// burning a Gemini call (and so the test is reproducible).
const STATIC_PERSONA = {
  displayName: "Nova Sterling",
  handleSuggestions: ["novasterling", "novastreetwear", "novasterlingco"],
  niche: "streetwear fashion",
  bio: "streetwear curator + fit inspo",
};

// Name + niche pools for per-run RANDOMIZED personas. Reusing one identity
// ("Nova Sterling" / novasterling*) across every attempt is an identity-
// correlation tell: Instagram sees dozens of near-identical personas from the
// same email base + IP pool and treats the whole cluster as abuse. Minting a
// distinct, realistic person per attempt removes that shared signal so each
// signup is evaluated on its own.
const FIRST_NAMES = [
  "Ava", "Mia", "Zoe", "Leah", "Ella", "Nora", "Ruby", "Isla", "Maya", "Lily",
  "Chloe", "Hazel", "Aria", "Iris", "June", "Skye", "Wren", "Elle", "Nina", "Cleo",
  "Liam", "Noah", "Ethan", "Owen", "Leo", "Kai", "Jude", "Cole", "Finn", "Milo",
  "Ezra", "Reed", "Theo", "Jace", "Rhys", "Beau", "Cruz", "Dean", "Gage", "Knox",
];
const LAST_NAMES = [
  "Carter", "Brooks", "Hayes", "Reyes", "Quinn", "Bennett", "Foster", "Walsh",
  "Mercer", "Dalton", "Sloan", "Vance", "Rhodes", "Pierce", "Lane", "Cross",
  "Holt", "Frost", "Beck", "Knight", "Shaw", "Wells", "Reed", "Marsh", "Stone",
  "Page", "Cole", "Hart", "Booth", "Flynn", "Dixon", "Doyle", "Gray", "Nash",
];
const NICHES = [
  { niche: "streetwear fashion", bio: "fits + thrift finds" },
  { niche: "specialty coffee", bio: "pourover nerd + cafe hunts" },
  { niche: "home cooking", bio: "weeknight recipes that slap" },
  { niche: "indie music", bio: "new tracks on repeat" },
  { niche: "film photography", bio: "35mm + grain" },
  { niche: "houseplants", bio: "too many monstera" },
  { niche: "trail running", bio: "miles + mud" },
  { niche: "skincare", bio: "routine + drugstore dupes" },
  { niche: "travel", bio: "window-seat enjoyer" },
  { niche: "gaming", bio: "ranked grind + cozy games" },
];

function choice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Builds a fresh, distinct persona (name, handle bases, niche, bio) for one run.
function randomPersona() {
  const first = choice(FIRST_NAMES);
  const last = choice(LAST_NAMES);
  const { niche, bio } = choice(NICHES);
  const fl = `${first}${last}`.toLowerCase();
  const f = first.toLowerCase();
  const l = last.toLowerCase();
  const handleSuggestions = [
    fl,
    `${f}.${l}`,
    `${f}_${l}`,
    `${f}${last.toLowerCase().slice(0, 1)}`,
    `${f}${choice(["xo", "io", "hq", "co", "tv", "", ""])}`,
  ].filter(Boolean);
  return { displayName: `${first} ${last}`, handleSuggestions, niche, bio };
}

function parseArgs(argv) {
  const args = { runs: 1, all: false, gemini: false, static: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--runs") args.runs = Math.max(1, parseInt(argv[++i] || "1", 10) || 1);
    else if (a === "--all") args.all = true;
    else if (a === "--gemini") args.gemini = true;
    else if (a === "--static") args.static = true;
  }
  return args;
}

async function buildPersona(useGemini) {
  if (!useGemini || !gemini.isConfigured()) return STATIC_PERSONA;
  try {
    log.info("Synthesizing persona via Gemini…");
    return await gemini.synthesizePersona({
      name: STATIC_PERSONA.displayName,
      niche: STATIC_PERSONA.niche,
      questionnaire: {},
      sources: [],
    });
  } catch (err) {
    log.warn("Gemini persona failed, using static persona:", err?.message);
    return STATIC_PERSONA;
  }
}

async function runOnce({ index, persona, debugRoot }) {
  const debugDir = path.join(debugRoot, `run-${index}`);
  // Seed the email alias off the persona's own handle so the address looks like
  // it belongs to this person (e.g. lucasfasto+avacarter…@) rather than a fixed
  // "qa-nova" stem shared by every attempt — another small de-correlation.
  const emailSeed =
    (Array.isArray(persona?.handleSuggestions) && persona.handleSuggestions[0]) ||
    persona?.displayName ||
    `qa-${index}`;
  const email = await generateEmail({ seed: emailSeed });
  const influencerId = `signup-test-${Date.now()}-${index}`;

  log.info("─".repeat(64));
  log.info(`RUN ${index} starting`, { email, emailProvider: config.verification.emailProvider });

  const started = Date.now();
  let sessionUrl = null;
  const result = {
    index,
    email,
    ok: false,
    loggedIn: false,
    error: null,
    sessionUrl: null,
    debugDir,
    durationMs: 0,
  };

  try {
    const account = await createInstagramAccount({
      influencerId,
      persona,
      email,
      debugDir,
      onSession: (info) => {
        sessionUrl = info?.sessionUrl || null;
        result.sessionUrl = sessionUrl;
        log.info(`🔴 LIVE SESSION → ${sessionUrl || "(url unavailable)"}`);
      },
    });
    result.ok = true;
    result.loggedIn = Boolean(account.loggedIn);
    result.blockedByCaptcha = Boolean(account.blockedByCaptcha);
    result.blockedBySuspension = Boolean(account.blockedBySuspension);
    result.account = {
      username: account.username,
      password: account.password,
      email: account.email,
      birthday: account.birthday,
      note: account.note,
      loggedIn: account.loggedIn,
      blockedByCaptcha: account.blockedByCaptcha,
      blockedBySuspension: account.blockedBySuspension,
    };
    log.info(`RUN ${index} result:`, {
      loggedIn: account.loggedIn,
      blockedByCaptcha: account.blockedByCaptcha,
      blockedBySuspension: account.blockedBySuspension,
      username: account.username,
      note: account.note,
    });
  } catch (err) {
    result.error = err?.stack || err?.message || String(err);
    log.error(`RUN ${index} threw:`, err?.message || err);
  } finally {
    result.durationMs = Date.now() - started;
    result.sessionUrl = result.sessionUrl || sessionUrl;
    // Persist a per-run summary alongside the screenshots.
    try {
      await mkdir(debugDir, { recursive: true });
      await writeFile(path.join(debugDir, "result.json"), JSON.stringify(result, null, 2));
    } catch {
      /* best effort */
    }
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!browserUseConfigured()) {
    log.error("Browser Use not configured. Set BROWSER_USE_API_KEY.");
    log.error("Missing keys:", missingKeys().join(", ") || "(none reported)");
    process.exit(2);
  }

  // Preflight: the signup flow leans on Gemini for CAPTCHA OCR and Stagehand
  // act()/extract() fallbacks, so a dead key dooms the run at the email/CAPTCHA
  // step after burning a browser session and a long email wait. Catch it now.
  const gem = await gemini.verifyAccess();
  if (!gem.ok) {
    log.error(`Gemini API key rejected${gem.status ? ` (HTTP ${gem.status})` : ""}: ${gem.message}`);
    log.error(
      "Set a working GEMINI_API_KEY in .env (generate one at https://aistudio.google.com/apikey). " +
        'Note: "AQ."-prefixed service-account keys must have the Generative Language API enabled + billing on their bound project; ' +
        "the most reliable fix is to regenerate a legacy \"AIza…\"-format key."
    );
    process.exit(2);
  }

  const provider = config.verification.emailProvider;
  if (!["maildotm", "mailosaur"].includes(provider)) {
    log.warn(`EMAIL_PROVIDER is "${provider}" — automated email-code retrieval needs "maildotm" (recommended) or "mailosaur".`);
  } else if (provider === "mailosaur") {
    log.warn(`EMAIL_PROVIDER is "mailosaur" — Mailosaur policy-blocks Instagram's emails, so the code will never arrive. Use "maildotm".`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const debugRoot = path.join(REPO_ROOT, "media", "debug", "signup", stamp);
  await mkdir(debugRoot, { recursive: true });
  log.info("Debug artifacts →", debugRoot);

  // Persona strategy: with --gemini, synthesize one persona up front. Otherwise
  // mint a DISTINCT random persona per run so attempts don't all share the same
  // identity (a correlation tell). Pass --static to force the legacy fixed one.
  const geminiPersona = args.gemini ? await buildPersona(true) : null;
  const personaFor = () =>
    geminiPersona || (args.static ? STATIC_PERSONA : randomPersona());
  const results = [];
  let success = false;

  for (let i = 1; i <= args.runs; i++) {
    const persona = personaFor();
    log.info(`RUN ${i} persona`, { displayName: persona.displayName, niche: persona.niche });
    const r = await runOnce({ index: i, persona, debugRoot });
    results.push(r);
    if (r.loggedIn) {
      success = true;
      log.info(`✅ Account generation SUCCEEDED on run ${i}`);
      if (!args.all) break;
    } else {
      log.warn(`❌ Run ${i} did not produce a logged-in account.`);
    }
  }

  log.info("═".repeat(64));
  log.info("SUMMARY");
  for (const r of results) {
    const outcome = r.loggedIn
      ? "LOGGED IN ✅"
      : r.blockedBySuspension
        ? "created but SUSPENDED/challenged 🚫 (needs phone verify / better proxy / warming)"
        : r.blockedByCaptcha
          ? "blocked by CAPTCHA 🤖 (needs proxies/human solve)"
          : r.ok
            ? "completed, not logged in ⚠️"
            : "errored ❌";
    log.info(
      `  run ${r.index}: ${outcome}` +
        ` · ${(r.durationMs / 1000).toFixed(1)}s · ${r.sessionUrl || "no session"}` +
        (r.error ? `\n      error: ${r.error.split("\n")[0]}` : "")
    );
  }
  await writeFile(path.join(debugRoot, "summary.json"), JSON.stringify(results, null, 2));
  log.info("Full summary →", path.join(debugRoot, "summary.json"));

  process.exit(success ? 0 : 1);
}

main().catch((err) => {
  log.error("Harness crashed:", err?.stack || err?.message || err);
  process.exit(1);
});
