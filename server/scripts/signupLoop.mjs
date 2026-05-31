// Continuous Instagram signup loop harness.
//
// Spawns a FRESH `node signupTest.js` child per iteration (so any code edits to
// the signup flow are picked up on the very next attempt), tees the child's
// output to both the console and a per-iteration log file under
// media/debug/signup/loop-logs/iter-NN-<stamp>.log, and keeps going until an
// attempt logs in successfully (child exit code 0) or the max-iteration safety
// cap is hit.
//
// Usage:
//   node server/scripts/signupLoop.mjs                  # loop until success (cap 100)
//   node server/scripts/signupLoop.mjs --max 5          # at most 5 iterations
//   node server/scripts/signupLoop.mjs --cooldown 90    # 90s pause between attempts
//   node server/scripts/signupLoop.mjs --gemini         # forward flags to signupTest.js
//
// Exit code is 0 if any iteration succeeded, 1 otherwise.

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const LOOP_DIR = path.join(REPO_ROOT, "media", "debug", "signup", "loop-logs");
const TEST_SCRIPT = path.join("server", "scripts", "signupTest.js");

function parseArgs(argv) {
  const args = { max: 100, cooldownSec: 60, passthrough: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--max") args.max = Math.max(1, parseInt(argv[++i] || "100", 10) || 100);
    else if (a === "--cooldown") args.cooldownSec = Math.max(0, parseInt(argv[++i] || "60", 10) || 0);
    else args.passthrough.push(a);
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const line = (s = "") => process.stdout.write(`${s}\n`);

// Figures out the next iteration number by scanning existing iter-NN-* logs so
// the numbering continues monotonically across separate loop invocations.
async function nextIterStart() {
  try {
    const files = await readdir(LOOP_DIR);
    let max = 0;
    for (const f of files) {
      const m = /^iter-(\d+)/.exec(f);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return max + 1;
  } catch {
    return 1;
  }
}

function runAttempt(iter, logPath, passthrough) {
  return new Promise((resolve) => {
    const out = createWriteStream(logPath, { flags: "a" });
    const started = Date.now();
    const child = spawn("node", [TEST_SCRIPT, ...passthrough], {
      cwd: REPO_ROOT,
      env: process.env,
    });
    const tee = (chunk) => {
      process.stdout.write(chunk);
      out.write(chunk);
    };
    child.stdout.on("data", tee);
    child.stderr.on("data", tee);
    child.on("close", (code) => {
      const durationSec = ((Date.now() - started) / 1000).toFixed(1);
      out.end();
      resolve({ code, durationSec });
    });
    child.on("error", (err) => {
      tee(`\n[signup-loop] failed to spawn child: ${err?.message}\n`);
      out.end();
      resolve({ code: 1, durationSec: "0" });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(LOOP_DIR, { recursive: true });
  const start = await nextIterStart();

  line("═".repeat(70));
  line(`[signup-loop] starting — up to ${args.max} attempt(s), ${args.cooldownSec}s cooldown`);
  line(`[signup-loop] iteration logs → ${LOOP_DIR}`);
  if (args.passthrough.length) line(`[signup-loop] forwarding flags: ${args.passthrough.join(" ")}`);
  line("═".repeat(70));

  let success = false;
  let attempts = 0; // real signup attempts (preflight failures don't count)
  let preflightFails = 0;
  let iter = start;
  const MAX_PREFLIGHT_FAILS = 15; // guard against a genuinely dead key/config

  while (attempts < args.max) {
    const iterStr = String(iter).padStart(2, "0");
    const logPath = path.join(LOOP_DIR, `iter-${iterStr}-${stamp()}.log`);
    line("");
    line("─".repeat(70));
    line(`[signup-loop] ITERATION ${iter} (attempt ${attempts + 1}/${args.max}) → ${path.basename(logPath)}`);
    line("─".repeat(70));

    const { code, durationSec } = await runAttempt(iter, logPath, args.passthrough);
    line(`[signup-loop] iteration ${iter} finished: exit=${code} in ${durationSec}s`);
    iter += 1;

    if (code === 0) {
      success = true;
      line(`[signup-loop] ✅ SUCCESS on iteration ${iter - 1} — an Instagram account logged in. Stopping.`);
      break;
    }

    // Exit code 2 = preflight/config failure (e.g. a transient Gemini 503 "high
    // demand"). That's not a real signup attempt and shouldn't burn one — wait a
    // short beat and retry, so the loop rides out temporary API blips.
    if (code === 2) {
      preflightFails += 1;
      if (preflightFails >= MAX_PREFLIGHT_FAILS) {
        line(`[signup-loop] preflight failed ${preflightFails}× in a row — config/key likely broken, not transient. Stopping.`);
        break;
      }
      line(`[signup-loop] ⚠️ preflight failed (transient API/config issue). Retrying in 30s without counting it as an attempt (${preflightFails}/${MAX_PREFLIGHT_FAILS}).`);
      await sleep(30000);
      continue;
    }

    preflightFails = 0;
    attempts += 1;
    if (attempts < args.max) {
      line(`[signup-loop] ❌ iteration ${iter - 1} did not succeed. Cooling down ${args.cooldownSec}s before the next attempt…`);
      await sleep(args.cooldownSec * 1000);
    }
  }

  if (!success) line(`[signup-loop] reached the attempt cap without a successful login.`);
  process.exit(success ? 0 : 1);
}

main().catch((err) => {
  console.error("[signup-loop] crashed:", err?.stack || err?.message || err);
  process.exit(1);
});
