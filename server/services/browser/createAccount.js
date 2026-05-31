import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { withStagehand } from "./stagehand.js";
import * as capsolver from "./capsolver.js";
import { waitForEmailCode } from "../verification.js";
import { sleep, randomInt } from "../../lib/util.js";
import { createLogger } from "../../lib/logger.js";

const log = createLogger("signup");

// Builds a step tracer for the signup flow. Always logs the step label + the
// page URL (so we can see *where* a run died); additionally writes a screenshot
// per step when `debugDir` is provided, which is invaluable for diagnosing a
// flow that "abruptly stops" on a particular field (e.g. the birthday step).
function makeStepCapture(page, debugDir) {
  let n = 0;
  return async (label) => {
    n += 1;
    const idx = String(n).padStart(2, "0");
    let url = "";
    try {
      url = page.url();
    } catch {
      /* page may be gone */
    }
    log.info(`▶ step ${idx}: ${label}${url ? ` — ${url}` : ""}`);
    if (!debugDir) return;
    try {
      await mkdir(debugDir, { recursive: true });
      const safe = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      await page.screenshot({ path: path.join(debugDir, `${idx}-${safe}.png`) });
    } catch (e) {
      log.warn(`screenshot failed at "${label}":`, e?.message);
    }
  };
}

function buildUsername(base) {
  const clean = (base || "creator").toLowerCase().replace(/[^a-z0-9._]/g, "").slice(0, 18);
  return `${clean}${randomInt(100, 9999)}`;
}

function randomPassword() {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let p = "";
  for (let i = 0; i < 14; i++) p += chars[Math.floor(Math.random() * chars.length)];
  return `${p}!7`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// --- Fast interaction helpers ------------------------------------------------
// Each stagehand.act()/extract() call is a full LLM round-trip (~2-5s). For the
// known, stable Instagram signup fields we drive the page directly (no LLM),
// and only fall back to act() if the selector misses.
//
// Stagehand v3's understudy Locator.isVisible() is a rough heuristic that often
// returns false for fillable inputs, which used to force every field through
// the slow act() fallback. We instead resolve "the first genuinely-visible
// selector" with one page.evaluate() (real getComputedStyle + box check) and
// then act on that exact selector — fast AND reliable.

async function firstVisibleSelector(page, selectors) {
  return page
    .evaluate((sels) => {
      const isVisible = (el) => {
        if (!el) return false;
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      for (const sel of sels) {
        try {
          if (isVisible(document.querySelector(sel))) return sel;
        } catch {
          /* invalid selector — skip */
        }
      }
      return null;
    }, selectors)
    .catch(() => null);
}

async function firstVisible(page, selectors) {
  const sel = await firstVisibleSelector(page, selectors);
  return sel ? page.locator(sel).first() : null;
}

// Types into a field via direct locator; falls back to act() if not found.
async function fastFill(stagehand, page, { selectors, value, describe, log }) {
  const sel = await firstVisibleSelector(page, selectors);
  if (sel) {
    try {
      await page.locator(sel).first().fill(value);
      return true;
    } catch (e) {
      log?.warn(`fastFill direct failed for ${describe}`, e?.message);
    }
  }
  await stagehand.act(`type "${value}" into the ${describe}`).catch((e) => {
    log?.warn(`fastFill act fallback failed for ${describe}`, e?.message);
  });
  return false;
}

// Clicks the first visible button/clickable whose text matches one of `texts`
// (exact match first, then substring), via real CDP mouse coordinates. The
// understudy engine doesn't support Playwright's :has-text() selector, so we
// resolve the target's text in the DOM and click its on-screen center.
async function clickButtonByText(page, texts) {
  const pt = await page
    .evaluate((labels) => {
      const norm = (s) => (s || "").trim().toLowerCase();
      const wanted = labels.map((l) => l.toLowerCase());
      const isVisible = (el) => {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const els = Array.from(
        document.querySelectorAll('button, [role="button"], a[role="button"], input[type="submit"]')
      ).filter(isVisible);
      const label = (el) => norm(el.textContent || el.value);
      let target = els.find((el) => wanted.includes(label(el)));
      if (!target) target = els.find((el) => wanted.some((w) => label(el).includes(w)));
      if (!target) return null;
      target.scrollIntoView({ block: "center", inline: "nearest" });
      const r = target.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }, texts)
    .catch(() => null);
  if (!pt || pt.x <= 0 || pt.y <= 0) return false;
  await page.click(pt.x, pt.y).catch(() => {});
  return true;
}

// Clicks a button by visible text first (deterministic), then a pure-CSS
// fallback, then an LLM act() as a last resort. Returns true if a click fired.
async function pressButton(stagehand, page, { texts = [], cssFallback = [], act, log }) {
  if (texts.length && (await clickButtonByText(page, texts))) return true;
  if (cssFallback.length) {
    const loc = await firstVisible(page, cssFallback);
    if (loc) {
      try {
        await loc.click();
        return true;
      } catch (e) {
        log?.warn("pressButton css click failed", e?.message);
      }
    }
  }
  if (act) {
    await stagehand.act(act).catch((e) => log?.warn("pressButton act failed", e?.message));
    return true;
  }
  return false;
}

// True if a blocking CAPTCHA challenge ("Help us confirm it's you" + reCAPTCHA
// "I'm not a robot") is currently on screen. Done in one page.evaluate so we
// don't depend on the flaky locator.isVisible heuristic (which previously made
// us bail on a challenge that was clearly visible). The reCAPTCHA badge in the
// corner is deliberately NOT treated as a challenge.
async function captchaPresent(page) {
  return page
    .evaluate(() => {
      const txt = ((document.body && document.body.innerText) || "").toLowerCase();
      const modalPhrases = [
        "help us confirm it's you",
        "help us confirm it\u2019s you",
        "confirm it's you",
        "confirm it\u2019s you",
        "complete the confirmation step",
        "complete the security check",
        "before you continue",
      ];
      if (modalPhrases.some((p) => txt.includes(p))) return true;

      // A large, on-screen reCAPTCHA/hCaptcha challenge iframe (not the small
      // bottom-right "protected by reCAPTCHA" badge).
      const frames = Array.from(
        document.querySelectorAll(
          'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[title="reCAPTCHA"], iframe[title*="captcha" i]'
        )
      );
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      return frames.some((f) => {
        const cs = getComputedStyle(f);
        if (cs.display === "none" || cs.visibility === "hidden") return false;
        const r = f.getBoundingClientRect();
        const onScreen = r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
        const bigEnough = r.width >= 120 && r.height >= 60;
        const isCornerBadge = r.right > vw - 90 && r.bottom > vh - 90 && r.width < 100;
        return onScreen && bigEnough && !isCornerBadge;
      });
    })
    .catch(() => false);
}

// Clicks the reCAPTCHA "I'm not a robot" checkbox to INITIATE the challenge so
// Browserbase's solver can take over (it solves the resulting challenge, but the
// visible v2 checkbox must be clicked first). Prefers clicking the real
// #recaptcha-anchor element inside the anchor iframe via frameLocator — the
// understudy adopts the OOPIF session, so this reaches cross-origin frames —
// and falls back to a coordinate click computed from the iframe's box.
async function clickRecaptchaCheckbox(page, log) {
  // The reCAPTCHA anchor lives in a (possibly deeply nested) cross-origin
  // iframe, so a top-level querySelector misses it. Iterate every frame the
  // understudy knows about (it adopts OOPIF sessions) and click the real
  // #recaptcha-anchor element inside whichever frame owns it.
  let frames = [];
  try {
    frames = page.frames() || [];
  } catch {
    frames = [];
  }
  for (const frame of frames) {
    let before = null;
    try {
      before = await frame.evaluate(() => {
        const el = document.getElementById("recaptcha-anchor");
        return el ? el.getAttribute("aria-checked") : "__none__";
      });
    } catch {
      continue; // frame not evaluable (detached/restricted)
    }
    if (before === "__none__" || before === null) continue;
    if (before === "true") return true;
    try {
      await frame.locator("#recaptcha-anchor").first().click();
      await sleep(800);
      let after = null;
      try {
        after = await frame.evaluate(() => {
          const el = document.getElementById("recaptcha-anchor");
          return el ? el.getAttribute("aria-checked") : null;
        });
      } catch {
        /* ignore */
      }
      log?.info("Clicked reCAPTCHA checkbox (frame)", { before, after });
      return true;
    } catch (e) {
      log?.warn("frame checkbox click failed", e?.message);
    }
  }

  // Coordinate fallback: locate a visible recaptcha/captcha iframe anywhere and
  // click where its checkbox should be (top-left of the anchor).
  const box = await page
    .evaluate(() => {
      const f = document.querySelector(
        'iframe[src*="recaptcha"], iframe[title="reCAPTCHA"], iframe[title*="captcha" i]'
      );
      if (!f) return null;
      const r = f.getBoundingClientRect();
      if (r.width < 20 || r.height < 20) return null;
      return { x: r.left, y: r.top, h: r.height };
    })
    .catch(() => null);
  if (!box) return false;
  const x = Math.round(box.x + 30);
  const y = Math.round(box.y + Math.min(38, box.h / 2));
  await page.click(x, y).catch(() => {});
  log?.info("Nudged reCAPTCHA checkbox (coords)", { x, y });
  return true;
}

// --- Programmatic CAPTCHA solving via CapSolver ------------------------------
// Browserbase's background solver is plan-gated and weak on reCAPTCHA Enterprise
// (what IG serves) without residential proxies. When CAPSOLVER_API_KEY is set we
// solve the challenge ourselves: read the sitekey off the page, get a token from
// CapSolver, inject it into the g-recaptcha-response field, and fire the widget
// callback so the challenge validates. All best-effort — never throws.

// Runs IN the page/frame context. Returns reCAPTCHA params (sitekey + enterprise
// /invisible flags) or null. Parsing the anchor iframe's `k` query param is the
// most reliable signal — it survives both v2 and Enterprise and works even when
// the widget div lacks a data-sitekey attribute.
function readRecaptchaParams() {
  const out = { websiteKey: null, isEnterprise: false, isInvisible: false };

  const widget = document.querySelector("[data-sitekey]");
  if (widget) {
    out.websiteKey = widget.getAttribute("data-sitekey");
    if (widget.getAttribute("data-size") === "invisible") out.isInvisible = true;
  }

  const iframe = document.querySelector('iframe[src*="recaptcha"][src*="k="]');
  if (iframe) {
    try {
      const u = new URL(iframe.getAttribute("src"), location.href);
      const k = u.searchParams.get("k");
      if (k && !out.websiteKey) out.websiteKey = k;
      if (u.pathname.includes("/enterprise/")) out.isEnterprise = true;
      if (u.searchParams.get("size") === "invisible") out.isInvisible = true;
    } catch {
      /* malformed src — ignore */
    }
  }

  if (!out.isEnterprise && document.querySelector('script[src*="recaptcha/enterprise"]')) {
    out.isEnterprise = true;
  }
  return out.websiteKey ? out : null;
}

// Finds the reCAPTCHA on the top document or in any child frame (IG sometimes
// hosts the widget inside a frame). Returns the params or null.
async function detectRecaptcha(page) {
  let info = await page.evaluate(readRecaptchaParams).catch(() => null);
  if (info?.websiteKey) return info;
  let frames = [];
  try {
    frames = page.frames() || [];
  } catch {
    frames = [];
  }
  for (const frame of frames) {
    info = await frame.evaluate(readRecaptchaParams).catch(() => null);
    if (info?.websiteKey) return info;
  }
  return null;
}

// Runs IN the page/frame context. Writes the solved token into every
// g-recaptcha-response textarea and fires the widget success callback(s). The
// callbacks live under window.___grecaptcha_cfg.clients in a version-specific,
// deeply-nested shape, so we DFS for any function under a "callback" key and
// invoke it with the token. Returns how many fields/callbacks were applied.
function applyRecaptchaToken(token) {
  let applied = 0;

  const fields = Array.from(
    document.querySelectorAll(
      'textarea#g-recaptcha-response, textarea[name="g-recaptcha-response"], textarea[id^="g-recaptcha-response"]'
    )
  );
  for (const field of fields) {
    field.value = token;
    try {
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    } catch {
      /* ignore */
    }
    applied += 1;
  }

  try {
    const cfg = window.___grecaptcha_cfg;
    if (cfg && cfg.clients) {
      const seen = new Set();
      const stack = Object.values(cfg.clients);
      while (stack.length) {
        const node = stack.pop();
        if (!node || typeof node !== "object" || seen.has(node)) continue;
        seen.add(node);
        for (const key of Object.keys(node)) {
          let val;
          try {
            val = node[key];
          } catch {
            continue;
          }
          if (typeof val === "function" && key.toLowerCase().includes("callback")) {
            try {
              val(token);
              applied += 1;
            } catch {
              /* not the success callback — keep scanning */
            }
          } else if (val && typeof val === "object") {
            stack.push(val);
          }
        }
      }
    }
  } catch {
    /* no grecaptcha config in this document */
  }
  return applied;
}

// Runs IN the top page context. Guarantees a g-recaptcha-response field carries
// the token for plain form posts, even if no widget textarea existed yet.
function ensureRecaptchaField(token) {
  let field = document.querySelector("textarea#g-recaptcha-response");
  if (!field) {
    field = document.createElement("textarea");
    field.id = "g-recaptcha-response";
    field.name = "g-recaptcha-response";
    field.style.display = "none";
    (document.body || document.documentElement).appendChild(field);
  }
  field.value = token;
}

// Injects a solved token into the page + every frame and fires the callbacks.
async function injectRecaptchaToken(page, token) {
  let applied = (await page.evaluate(applyRecaptchaToken, token).catch(() => 0)) || 0;
  let frames = [];
  try {
    frames = page.frames() || [];
  } catch {
    frames = [];
  }
  for (const frame of frames) {
    applied += (await frame.evaluate(applyRecaptchaToken, token).catch(() => 0)) || 0;
  }
  await page.evaluate(ensureRecaptchaField, token).catch(() => {});
  return applied > 0;
}

// End-to-end programmatic solve: detect the reCAPTCHA, get a token from
// CapSolver, and inject it. Returns true if a token was injected. No-op (false)
// when CapSolver isn't configured or no sitekey is found. Never throws.
async function solveCaptchaViaApi({ page, log }) {
  if (!capsolver.isConfigured()) return false;
  const info = await detectRecaptcha(page);
  if (!info?.websiteKey) {
    log.warn("CapSolver: no reCAPTCHA sitekey found on the page; skipping API solve");
    return false;
  }
  let websiteURL = "";
  try {
    websiteURL = page.url();
  } catch {
    /* page may be gone */
  }
  log.info("CapSolver: solving reCAPTCHA", {
    enterprise: info.isEnterprise,
    invisible: info.isInvisible,
  });
  try {
    const token = await capsolver.solveReCaptcha({
      websiteURL,
      websiteKey: info.websiteKey,
      isEnterprise: info.isEnterprise,
      isInvisible: info.isInvisible,
    });
    const injected = await injectRecaptchaToken(page, token);
    log.info("CapSolver: token injected", { injected });
    return injected;
  } catch (err) {
    log.warn("CapSolver: solve failed", err?.message);
    return false;
  }
}

// Ensures a CAPTCHA challenge is cleared before proceeding:
//   1. Wait for Browserbase's background solver (all plans; best-effort, can
//      take up to ~30s and is strongest with proxies/stealth which the free
//      plan lacks).
//   2. If CapSolver is configured, solve the reCAPTCHA programmatically (sitekey
//      -> token -> inject). This clears reCAPTCHA Enterprise on any plan.
//   3. If it hasn't cleared after a grace period, nudge the v2 checkbox a few
//      times to (re)engage the solver on the visible challenge.
//   4. Keep polling (surfacing the live session URL for an optional human solve)
//      until the challenge clears or we time out.
// Returns true if a CAPTCHA was encountered, false if none was present. Never
// throws.
async function ensureCaptchaSolved({
  page,
  waitForCaptcha,
  sessionUrl,
  log,
  manualTimeoutMs = Number(process.env.CAPTCHA_WAIT_MS) || 180000,
}) {
  await (waitForCaptcha?.() ?? Promise.resolve(false));

  // No challenge present (none appeared or the solver already cleared it).
  if (!(await captchaPresent(page))) return false;

  log.warn("CAPTCHA challenge present — initiating + waiting for Browserbase to solve", { sessionUrl });
  // Click the checkbox right away to INITIATE the v2 challenge; Browserbase's
  // solver engages on the resulting challenge. Then re-check the barrier.
  await clickRecaptchaCheckbox(page, log);
  await (waitForCaptcha?.({ startGraceMs: 2500 }) ?? Promise.resolve(false));

  // Stronger fallback: if a CapSolver key is configured, solve the reCAPTCHA
  // programmatically (sitekey -> token -> inject). This clears IG's reCAPTCHA
  // Enterprise even on the free Browserbase plan. Try once now, then a couple
  // more times in the loop below if the challenge rotates/persists.
  const apiSolveEnabled = capsolver.isConfigured();
  const maxApiTries = 3;
  let apiTries = 0;
  let lastApiTry = 0;
  if (apiSolveEnabled && (await captchaPresent(page))) {
    if (await solveCaptchaViaApi({ page, log })) await sleep(2500);
    apiTries += 1;
    lastApiTry = Date.now();
  }

  const deadline = Date.now() + manualTimeoutMs;
  let lastLog = 0;
  let lastNudge = Date.now();
  let nudges = 1;
  while (Date.now() < deadline) {
    if (!(await captchaPresent(page))) {
      log.info("CAPTCHA cleared");
      return true;
    }
    // Re-attempt the programmatic solve periodically — the challenge can reset
    // or rotate, and a fresh token often clears it.
    if (apiSolveEnabled && apiTries < maxApiTries && Date.now() - lastApiTry > 25000) {
      if (await solveCaptchaViaApi({ page, log })) await sleep(2500);
      apiTries += 1;
      lastApiTry = Date.now();
    }
    // Re-click the checkbox periodically in case the first didn't register or
    // the challenge reset (best-effort; spaced out to avoid fighting the solver).
    if (Date.now() - lastNudge > 18000 && nudges < 4) {
      await clickRecaptchaCheckbox(page, log);
      lastNudge = Date.now();
      nudges += 1;
    }
    if (Date.now() - lastLog > 20000) {
      log.warn(`CAPTCHA still up — watch/solve live: ${sessionUrl || "(session URL unavailable)"}`);
      lastLog = Date.now();
    }
    // Re-run the background barrier in case Browserbase (re)starts a solve.
    await (waitForCaptcha?.({ startGraceMs: 0 }) ?? Promise.resolve(false));
    await sleep(3000);
  }
  log.warn("Timed out waiting for CAPTCHA to clear; continuing best-effort");
  return true;
}

// DOM-based detection of the email confirmation-code step (an actual code input
// or unambiguous instruction text). Replaces an LLM extract() that false-
// positived on the CAPTCHA modal and made us wait for an email IG never sent.
async function emailCodeStepPresent(page) {
  const sel = await firstVisibleSelector(page, [
    'input[name="email_confirmation_code"]',
    'input[name="confirmationCode"]',
    'input[autocomplete="one-time-code"]',
    'input[aria-label*="confirmation code" i]',
  ]);
  if (sel) return true;
  return page
    .evaluate(() => {
      const t = ((document.body && document.body.innerText) || "").toLowerCase();
      return (
        /enter the (confirmation |security )?code/.test(t) ||
        /we sent .*code/.test(t) ||
        /confirmation code/.test(t) ||
        /enter the code we sent/.test(t)
      );
    })
    .catch(() => false);
}

// Picks a concrete, realistic DOB making the user between minAge and maxAge.
// Returns the numeric parts plus the full month name, since IG's Month dropdown
// uses names ("March") while Day/Year use numbers.
function pickBirthday({ minAge = 24, maxAge = 33 } = {}) {
  const now = new Date();
  const age = randomInt(minAge, maxAge);
  const year = now.getFullYear() - age;
  const monthIndex = randomInt(0, 11);
  // Keep day <= 28 so it's always valid regardless of month/leap year.
  const day = randomInt(1, 28);
  return {
    year,
    monthIndex,
    monthName: MONTH_NAMES[monthIndex],
    monthNumber: monthIndex + 1,
    day,
  };
}

// Instagram's signup birthday controls are CUSTOM ARIA comboboxes, confirmed
// against the live DOM:
//   <div role="combobox" aria-haspopup="listbox" aria-label="Select Month"
//        aria-expanded="false" aria-controls="<listboxId>"> Month </div>
// Clicking one opens a role="listbox" of role="option" items (e.g. "March",
// "5", "1995"); clicking an option closes it and the trigger text becomes
// "Month\nMarch".
//
// IMPORTANT: Stagehand v3 drives the page with its own "understudy" engine, NOT
// Playwright. The understudy Page/Locator only expose a SUBSET of Playwright's
// API — there is no page.keyboard, page.getByRole, locator.evaluate,
// locator.getAttribute, or locator.filter. So every interaction below is built
// from the supported primitives only: page.evaluate(), page.locator().click(),
// page.click(x,y), page.keyPress(), page.waitForSelector(), and
// locator.selectOption() (for the legacy native-<select> layout).
const BIRTHDAY_COMBO = {
  month: '[role="combobox"][aria-label="Select Month"]',
  day: '[role="combobox"][aria-label="Select Day"]',
  year: '[role="combobox"][aria-label="Select Year"]',
};
const BIRTHDAY_SELECT = {
  month: 'select[title*="Month" i], select[aria-label*="Month" i]',
  day: 'select[title*="Day" i], select[aria-label*="Day" i]',
  year: 'select[title*="Year" i], select[aria-label*="Year" i]',
};

function textIncludesAny(text, candidates) {
  const t = (text || "").toLowerCase();
  return candidates.some((c) => t.includes(String(c).toLowerCase()));
}

// Reads tag/trigger-text/value/aria-controls/visibility for a selector in a
// single page.evaluate round-trip (no unsupported locator helpers). Returns
// null if the element isn't in the DOM.
async function elInfo(page, selector) {
  return page
    .evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = window.getComputedStyle(el);
      const visible =
        cs.display !== "none" && cs.visibility !== "hidden" && el.getClientRects().length > 0;
      return {
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || "").trim(),
        value: typeof el.value === "string" ? el.value : null,
        ariaControls: el.getAttribute("aria-controls"),
        visible,
      };
    }, selector)
    .catch(() => null);
}

// Returns the visible value for a birthday field — combobox trigger text or
// native <select> value — or "" if the control isn't present.
async function controlDisplay(page, key) {
  const combo = await elInfo(page, BIRTHDAY_COMBO[key]);
  if (combo) return combo.text;
  const sel = await elInfo(page, BIRTHDAY_SELECT[key]);
  if (sel) return sel.value || sel.text;
  return "";
}

// Sets a custom ARIA combobox deterministically (NO LLM):
//   1. Escape any stuck-open list.
//   2. Click the trigger (real CDP mouse event) to open its listbox.
//   3. Wait for role=option items inside the aria-controls listbox.
//   4. Find the matching option, scroll it into view, and click its on-screen
//      center via page.click(x, y).
//   5. Verify the trigger now shows the value.
// Retries a few times; never throws.
async function setCombobox(page, selector, { optionText, expects }) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const info = await elInfo(page, selector);
    if (!info) return false;
    if (textIncludesAny(info.text, expects)) return true;

    await page.keyPress("Escape").catch(() => {});
    await page.locator(selector).first().click().catch(() => {});

    const listSel = info.ariaControls ? `[id="${info.ariaControls}"]` : '[role="listbox"]';
    await page
      .waitForSelector(`${listSel} [role="option"]`, { timeout: 4000, state: "visible" })
      .catch(() => {});

    const pt = await page
      .evaluate(
        (arg) => {
          const root = document.querySelector(arg.listSel) || document;
          const opts = Array.from(root.querySelectorAll('[role="option"]'));
          const norm = (s) => (s || "").trim();
          let target = opts.find((o) => norm(o.textContent) === String(arg.optionText));
          if (!target) target = opts.find((o) => norm(o.textContent).includes(String(arg.optionText)));
          if (!target) return null;
          target.scrollIntoView({ block: "center", inline: "nearest" });
          const r = target.getBoundingClientRect();
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
        },
        { listSel, optionText }
      )
      .catch(() => null);

    if (pt && pt.x > 0 && pt.y > 0) {
      await page.click(pt.x, pt.y).catch(() => {});
      await page.waitForTimeout(250);
      const after = await elInfo(page, selector);
      if (after && textIncludesAny(after.text, expects)) return true;
    }
    await page.waitForTimeout(200);
  }
  // Don't leave a dropdown hanging open over the Submit button.
  await page.keyPress("Escape").catch(() => {});
  const final = await elInfo(page, selector);
  return Boolean(final && textIncludesAny(final.text, expects));
}

// Sets a native <select> birthday control (legacy / regional layouts).
async function setNativeSelect(page, selector, { optionText, expects }) {
  const loc = page.locator(selector).first();
  if (!(await loc.count().catch(() => 0))) return false;
  for (const candidate of [String(optionText), ...expects.map(String)]) {
    try {
      const set = await loc.selectOption(candidate);
      if (set && set.length) return true;
    } catch {
      /* try next form */
    }
  }
  return false;
}

// Sets one birthday field, auto-selecting combobox vs native <select>.
async function setBirthdayField(page, key, opts) {
  const combo = await elInfo(page, BIRTHDAY_COMBO[key]);
  if (combo) return setCombobox(page, BIRTHDAY_COMBO[key], opts);
  return setNativeSelect(page, BIRTHDAY_SELECT[key], opts);
}

// True once all three Month/Day/Year controls show their selected value.
async function birthdayIsSet(page, dob) {
  const [m, d, y] = await Promise.all([
    controlDisplay(page, "month"),
    controlDisplay(page, "day"),
    controlDisplay(page, "year"),
  ]);
  const monthOk =
    m.toLowerCase().includes(dob.monthName.toLowerCase()) ||
    new RegExp(`(^|\\D)${dob.monthNumber}(\\D|$)`).test(m);
  const dayOk = new RegExp(`(^|\\D)${dob.day}(\\D|$)`).test(d);
  const yearOk = String(y).includes(String(dob.year));
  return Boolean(m && d && y && monthOk && dayOk && yearOk);
}

// Polls until all three birthday controls report their value (or we time out).
async function waitForBirthdaySet(page, dob, { timeoutMs = 6000, intervalMs = 400 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await birthdayIsSet(page, dob)) return true;
    if (Date.now() >= deadline) return false;
    await sleep(intervalMs);
  }
}

// Detects whether the birthday controls are present on the page right now.
async function birthdayPresent(page) {
  const combo = await elInfo(page, BIRTHDAY_COMBO.month);
  if (combo) return true;
  const sel = await elInfo(page, BIRTHDAY_SELECT.month);
  return Boolean(sel);
}

// Polls for the birthday controls to render (page transitions are async).
async function waitForBirthday(page, { timeoutMs = 15000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await birthdayPresent(page)) return true;
    if (Date.now() >= deadline) return false;
    await sleep(intervalMs);
  }
}

// Drives Instagram's three birthday dropdowns (Month/Day/Year). Fully
// deterministic (no LLM); handles the custom ARIA combobox + native <select>,
// re-checks and retries the whole set until every control reports a value.
async function fillBirthday(stagehand, page, dob, log) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (!(await birthdayPresent(page))) {
      log.warn(`Birthday controls not present (attempt ${attempt}/${maxAttempts})`);
      await sleep(500);
      continue;
    }

    await setBirthdayField(page, "month", {
      optionText: dob.monthName,
      expects: [dob.monthName, String(dob.monthNumber)],
    });
    await setBirthdayField(page, "day", {
      optionText: String(dob.day),
      expects: [String(dob.day)],
    });
    await setBirthdayField(page, "year", {
      optionText: String(dob.year),
      expects: [String(dob.year)],
    });

    await sleep(300);
    if (await birthdayIsSet(page, dob)) {
      log.info("Birthday set", { month: dob.monthName, day: dob.day, year: dob.year });
      return true;
    }
    log.warn(`Birthday not fully set (attempt ${attempt}/${maxAttempts}); retrying`);
  }

  log.warn("Birthday could not be confirmed after retries; continuing anyway");
  return false;
}

// Fills the birthday if the controls are present within `timeoutMs`. Used both
// on the initial signup form (newer IG layout renders DOB inline) and on a
// separate post-submit birthday step. Best-effort; returns whether it filled.
async function fillBirthdayIfPresent(stagehand, page, dob, log, { timeoutMs = 6000 } = {}) {
  const present = await waitForBirthday(page, { timeoutMs });
  if (!present) return false;
  log.info("Birthday fields present — filling");
  return fillBirthday(stagehand, page, dob, log);
}

// Auto-creates a fresh Instagram account via the signup flow, clearing email
// verification through the pluggable verification service.
export async function createInstagramAccount({ influencerId, persona, email, onSession, debugDir }) {
  const fullName = persona?.displayName || "Creator";
  const username = buildUsername(persona?.handleSuggestions?.[0] || persona?.displayName);
  const password = randomPassword();
  const dob = pickBirthday();

  log.info("Creating IG account", { username, email, dob });

  const result = await withStagehand(async ({ stagehand, page, waitForCaptcha, sessionUrl }) => {
    const capture = makeStepCapture(page, debugDir);
    // Clears any CAPTCHA before continuing: Browserbase auto-solve first, then a
    // human-in-the-loop fallback (via the live session URL) if it persists.
    const settleCaptcha = () => ensureCaptchaSolved({ page, waitForCaptcha, sessionUrl, log });

    await page.goto("https://www.instagram.com/accounts/emailsignup/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await capture("signup-page-loaded");
    // IG can gate the signup page itself behind a challenge.
    await settleCaptcha();

    // Wait for the email field to appear instead of a blind sleep.
    const emailField = await firstVisible(page, [
      'input[name="emailOrPhone"]',
      'input[name="email"]',
      'input[type="email"]',
      'input[aria-label*="email" i]',
    ]);
    if (!emailField) await sleep(2000);

    // Cookie banners block IG in some regions; dismiss by the dialog's specific
    // labels (no-op if no banner is present).
    await clickButtonByText(page, [
      "Allow all cookies",
      "Accept all",
      "Accept All",
      "Allow all",
      "Only allow essential cookies",
    ]).catch(() => {});

    // Fill the four signup fields via direct locators (no LLM round-trips).
    await fastFill(stagehand, page, {
      selectors: ['input[name="emailOrPhone"]', 'input[name="email"]', 'input[type="email"]'],
      value: email,
      describe: "email field",
      log,
    });
    await fastFill(stagehand, page, {
      selectors: ['input[name="fullName"]', 'input[aria-label*="Full" i]'],
      value: fullName,
      describe: "full name field",
      log,
    });
    await fastFill(stagehand, page, {
      selectors: ['input[name="username"]', 'input[aria-label*="user" i]'],
      value: username,
      describe: "username field",
      log,
    });
    await fastFill(stagehand, page, {
      selectors: ['input[name="password"]', 'input[type="password"]'],
      value: password,
      describe: "password field",
      log,
    });
    await capture("text-fields-filled");

    // Newer IG layout renders the birthday (Month/Day/Year) inline on the same
    // signup form, before submit. Fill it BEFORE clicking submit and verify it
    // actually took — otherwise IG rejects the empty DOB (red error) and we end
    // up stuck bouncing between submit and the birthday step.
    const filledInline = await fillBirthdayIfPresent(stagehand, page, dob, log, { timeoutMs: 6000 });
    if (filledInline) await waitForBirthdaySet(page, dob, { timeoutMs: 6000 });
    await capture(filledInline ? "birthday-inline-filled" : "no-inline-birthday");

    const submit = () =>
      pressButton(stagehand, page, {
        texts: ["Sign up", "Sign Up", "Submit"],
        cssFallback: ['button[type="submit"]'],
        act: "click the submit button to submit the form",
        log,
      });

    await submit();
    await sleep(2500);
    await capture("after-submit");

    // If IG bounced us back with the birthday still showing (empty-DOB
    // validation error, or it simply didn't take the first time), fill it and
    // resubmit before moving on. This is the exact "submit ignores the birthday,
    // goes back, then gets stuck" case — handle it deterministically.
    if (await birthdayPresent(page)) {
      log.warn("Birthday still present after submit — filling and resubmitting");
      await fillBirthday(stagehand, page, dob, log);
      await waitForBirthdaySet(page, dob, { timeoutMs: 6000 });
      await sleep(300);
      await submit();
      await sleep(2500);
    }

    // After submitting the form IG most often shows the "Help us confirm it's
    // you" reCAPTCHA. Wait for Browserbase to solve it before we look for the
    // next step, otherwise our extract()/clicks race the solver.
    const solvedAtSignup = await settleCaptcha();
    await capture(solvedAtSignup ? "captcha-cleared-after-submit" : "no-captcha-after-submit");
    if (solvedAtSignup) {
      // The page navigates once the challenge clears; give the DOM a beat and
      // click any "Next"/continue the challenge dialog leaves behind.
      await sleep(1500);
      await pressButton(stagehand, page, {
        texts: ["Next", "Continue"],
        cssFallback: ['button[type="submit"]'],
        log,
      });
      await sleep(1500);
    }

    // Birthday step. Some IG variants show DOB as a SEPARATE page after submit
    // (others had it inline above, already handled). Poll for the controls to
    // render rather than checking once, since the page transitions async.
    const birthdayStep = await waitForBirthday(page, { timeoutMs: 10000 });
    if (birthdayStep) {
      log.info("Birthday step detected");
      await capture("birthday-step-detected");
      const filled = await fillBirthday(stagehand, page, dob, log);
      // Don't advance until DOB is confirmed; otherwise we'd submit an empty
      // form and IG keeps us on the same step.
      if (!filled) await waitForBirthdaySet(page, dob, { timeoutMs: 6000 });
      await capture("birthday-step-filled");
      await sleep(400);

      await pressButton(stagehand, page, {
        texts: ["Next", "Submit"],
        cssFallback: ['button[type="submit"]'],
        log,
      });
      await sleep(2000);
      await settleCaptcha();
      await capture("after-birthday-next");
    } else {
      log.info("No separate birthday step (likely filled inline); proceeding");
    }

    // Email confirmation code step. Detect it from the DOM (an actual code input
    // or instruction text) — NOT an LLM extract(), which previously false-
    // positived on the CAPTCHA modal and made us wait for an email IG never sent.
    // Poll briefly since the page transitions async after the prior step.
    let needsEmail = false;
    for (let i = 0; i < 6 && !needsEmail; i++) {
      needsEmail = await emailCodeStepPresent(page);
      if (!needsEmail) await sleep(1000);
    }

    if (needsEmail) {
      log.info("Email confirmation required");
      await capture("email-code-requested");
      const code = await waitForEmailCode({ influencerId, to: email });
      log.info("Email code received", code);
      await fastFill(stagehand, page, {
        selectors: ['input[name="email_confirmation_code"]', 'input[name="confirmationCode"]', 'input[autocomplete="one-time-code"]', 'input[type="tel"]'],
        value: code,
        describe: "confirmation code field",
        log,
      });
      await sleep(600);
      await pressButton(stagehand, page, {
        texts: ["Next", "Confirm"],
        cssFallback: ['button[type="submit"]'],
        act: "click next or confirm to submit the email code",
        log,
      });
      await sleep(2500);
      await settleCaptcha();
      await capture("after-email-code");
    } else {
      log.info("No email confirmation step detected");
    }

    // If a CAPTCHA is STILL on screen at the end, that's the blocker — surface
    // it explicitly so the account record says *why* (rather than a vague
    // "not logged in"). IG's reCAPTCHA Enterprise needs either a CapSolver key
    // (CAPSOLVER_API_KEY, recommended), Browserbase residential proxies (paid),
    // or a human solve via the live session URL.
    if (await captchaPresent(page)) {
      log.warn("Finished with a CAPTCHA still blocking — CapSolver key / proxies / manual solve required", { sessionUrl });
      await capture("blocked-by-captcha");
      const remedy = capsolver.isConfigured()
        ? "CapSolver couldn't clear it this run"
        : "set CAPSOLVER_API_KEY to auto-solve it";
      return {
        loggedIn: false,
        blockedByCaptcha: true,
        sessionUrl,
        note: `Blocked by Instagram CAPTCHA (${remedy}). Solve it live at ${sessionUrl || "the Browserbase session"}, or enable Browserbase residential proxies (paid plan).`,
      };
    }

    const status = await stagehand
      .extract(
        "Are we now logged in to an Instagram account (home feed, profile, or 'turn on notifications' prompt visible)?",
        z.object({ loggedIn: z.boolean(), note: z.string().optional() })
      )
      .catch(() => ({ loggedIn: false }));
    await capture(status?.loggedIn ? "logged-in" : "final-state");

    return { loggedIn: Boolean(status?.loggedIn), note: status?.note };
  }, { onSession });

  // Posting re-authenticates with the stored credentials, so we don't need to
  // persist a Browserbase context here (avoids feeding a bad context id back in).
  return {
    username,
    password,
    email,
    fullName,
    birthday: `${dob.year}-${String(dob.monthNumber).padStart(2, "0")}-${String(dob.day).padStart(2, "0")}`,
    loggedIn: result.loggedIn,
    blockedByCaptcha: Boolean(result.blockedByCaptcha),
    note: result.note,
    session: {},
  };
}
