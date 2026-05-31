import { mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { config } from "../../config.js";
import { withStagehand } from "./stagehand.js";
import * as capsolver from "./capsolver.js";
import * as gemini from "../gemini.js";
import { waitForEmailCode, generateEmail } from "../verification.js";
import { freshUsername, randomPassword, pickBirthday } from "../identity.js";
import { sleep, randomInt, pick } from "../../lib/util.js";
import { createLogger } from "../../lib/logger.js";

// Instagram serves reCAPTCHA v2 *Enterprise* on its signup + "confirm it's you"
// challenge. Solving these sitekeys as standard v2 yields a token IG rejects, so
// we always solve them with CapSolver's Enterprise task type. DOM detection of
// "enterprise" is unreliable here (cross-origin frames), so we additionally key
// off the known sitekey(s) as a hard signal.
const KNOWN_ENTERPRISE_SITEKEYS = new Set([
  "6LdktRgnAAAAAFQ6icovYI2-masYLFjEFyzQzpix", // Instagram / Meta signup + challenge
]);

const log = createLogger("signup");

// Instagram entry points. We deliberately do NOT cold-deep-link the signup
// endpoint: arriving at /accounts/emailsignup/ with no prior pageview, no
// cookies, and no referrer is a textbook automation funnel. Instead we land on
// the homepage first (sets cookies + referrer), then click through to signup.
const IG_HOME_URL = "https://www.instagram.com/";
const IG_SIGNUP_URL = "https://www.instagram.com/accounts/emailsignup/";

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

// Identity generation (username/password/birthday) lives in
// services/identity.js so the user-driven build-account flow can reuse the exact
// same logic without loading this Stagehand-heavy module. `freshUsername`,
// `randomPassword`, and `pickBirthday` are imported at the top of this file.

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

// Reads back an input/textarea value by selector, so we can VERIFY a fill
// actually stuck (the whole reason for the empty-email stall: a fill that
// silently no-ops leaves IG on a frozen signup form forever).
async function readInputValue(page, selector) {
  if (!selector) return null;
  return page
    .evaluate((sel) => {
      const el = document.querySelector(sel);
      return el && typeof el.value === "string" ? el.value : null;
    }, selector)
    .catch(() => null);
}

// Instagram's signup inputs lost their stable identifiers — email and full-name
// are now bare <input type="text"> with no name/aria-label/placeholder and only
// a React-generated id (e.g. "_r_8_"). The ONLY durable signal is their wrapping
// <label> text. Find the first visible input whose associated/wrapping label
// text includes any keyword, tag it with data-qh-field=<key>, and return that
// selector so we can drive it deterministically.
//
// Keywords must be SPECIFIC: use "full name" (not "name"), because "Username"
// also contains "name" and would be matched by the looser term.
async function tagInputByLabel(page, { keywords, key }) {
  return page
    .evaluate((arg) => {
      const { keywords, key } = arg;
      const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
      const wanted = keywords.map((k) => k.toLowerCase());
      const isVisible = (el) => {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const fields = Array.from(document.querySelectorAll("input, textarea")).filter(isVisible);
      for (const el of fields) {
        const labelText = norm(
          (el.labels && Array.from(el.labels).map((l) => l.textContent).join(" ")) ||
            (el.closest("label") && el.closest("label").textContent) ||
            ""
        );
        if (wanted.some((w) => labelText.includes(w))) {
          el.setAttribute("data-qh-field", key);
          return `[data-qh-field="${key}"]`;
        }
      }
      return null;
    }, { keywords, key })
    .catch(() => null);
}

// Sets a (React-)controlled input's value via the prototype's native setter and
// fires input/change, so frameworks that intercept the value setter pick up the
// change. This is what reliably populates IG's controlled email/name inputs when
// a plain locator.fill() blackholes. Returns the read-back value.
async function setInputValueNative(page, selector, value) {
  return page
    .evaluate((arg) => {
      const { sel, value } = arg;
      const el = document.querySelector(sel);
      if (!el) return null;
      const ctor = el.tagName === "TEXTAREA" ? HTMLTextAreaElement : HTMLInputElement;
      const desc = Object.getOwnPropertyDescriptor(ctor.prototype, "value");
      try {
        el.focus();
      } catch {
        /* ignore */
      }
      if (desc && desc.set) desc.set.call(el, value);
      else el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      try {
        el.blur();
      } catch {
        /* ignore */
      }
      return el.value;
    }, { sel: selector, value })
    .catch(() => null);
}

// Small randomized "think time". IG's signup risk model penalizes inhuman,
// perfectly-uniform cadence (fields filled and buttons clicked in machine time),
// so we sprinkle short, jittered pauses between actions. Best-effort.
async function thinkTime(minMs, maxMs) {
  await sleep(randomInt(minMs, maxMs));
}

// A longer "reading" pause for the moments a human would actually stop to read:
// a freshly-rendered screen, right before committing a form, between flow steps.
// Bots act the instant the DOM is ready; this restores that human beat.
async function readPause(minMs = 900, maxMs = 2200) {
  await sleep(randomInt(minMs, maxMs));
}

// --- Human cursor movement (anti-bot behavioral signals) --------------------
// Bot detectors increasingly score the MOUSE PATH: a real pointer arrives at a
// target via a continuous, slightly-curved, variable-speed trajectory, while
// automation tends to "teleport" the cursor straight onto an element (a single
// mouseMoved to the exact center) or click with no prior movement at all. The
// understudy engine exposes page.hover(x, y), which dispatches genuine CDP
// Input mouseMoved events, so we can synthesize a believable human trajectory.

// Per-PAGE cursor state (not module-global) so concurrent signups don't share a
// phantom cursor position. A real cursor never jumps, so we always move FROM the
// last known point.
function mouseState(page) {
  if (!page.__qhMouse) page.__qhMouse = { x: null, y: null };
  return page.__qhMouse;
}

// Current viewport size (defaults are conservative if the read fails).
async function viewportSize(page) {
  return page
    .evaluate(() => ({
      w: window.innerWidth || 1280,
      h: window.innerHeight || 800,
    }))
    .catch(() => ({ w: 1280, h: 800 }));
}

// Moves the cursor to (x, y) along a gently-curved, multi-step path with small
// per-step jitter and ease-in-out timing — a genuine human trajectory rather
// than one instant jump. Uses page.hover(x, y) (real CDP mouseMoved). All
// best-effort: a no-op when the primitive is missing, never throws.
async function moveMouseTo(page, x, y, { steps } = {}) {
  if (typeof page.hover !== "function") return false;
  try {
    const { w, h } = await viewportSize(page);
    const clamp = (v, max) => Math.max(1, Math.min(Math.round(v), max - 1));
    const tx = clamp(x, w);
    const ty = clamp(y, h);
    const st = mouseState(page);
    let sx = st.x;
    let sy = st.y;
    // First move of the session: start from a plausible spot, not (0,0).
    if (sx == null || sy == null) {
      sx = randomInt(Math.floor(w * 0.25), Math.floor(w * 0.75));
      sy = randomInt(Math.floor(h * 0.25), Math.floor(h * 0.75));
    }
    const dist = Math.hypot(tx - sx, ty - sy);
    const n = steps || Math.max(5, Math.min(26, Math.round(dist / 20)));
    // A control point offset off the straight line gives a natural arc.
    const cx = (sx + tx) / 2 + randomInt(-50, 50);
    const cy = (sy + ty) / 2 + randomInt(-40, 40);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      // Ease-in-out so the cursor accelerates then settles (humans don't move at
      // a constant velocity), traced along a quadratic Bézier for the curve.
      const e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      const bx = (1 - e) * (1 - e) * sx + 2 * (1 - e) * e * cx + e * e * tx;
      const by = (1 - e) * (1 - e) * sy + 2 * (1 - e) * e * cy + e * e * ty;
      await page.hover(clamp(bx + randomInt(-2, 2), w), clamp(by + randomInt(-2, 2), h)).catch(() => {});
      await sleep(randomInt(6, 20));
    }
    st.x = tx;
    st.y = ty;
    return true;
  } catch {
    return false;
  }
}

// Moves the cursor along a human arc to a selector's on-screen center (aiming a
// few px off dead-center, like a real person), so the next click/hover lands
// after genuine movement. Best-effort; returns whether it moved.
async function moveMouseToSelector(page, selector) {
  if (!selector) return false;
  try {
    const pt = await page.locator(selector).first().centroid();
    if (!pt || !(pt.x > 0) || !(pt.y > 0)) return false;
    return await moveMouseTo(page, pt.x + randomInt(-6, 6), pt.y + randomInt(-4, 4));
  } catch {
    return false;
  }
}

// Small idle cursor drift for "reading" pauses — a real person's hand nudges the
// mouse while they read; a bot leaves it frozen. Fires only sometimes so it
// doesn't look metronomic. Best-effort.
async function idleMouseDrift(page) {
  if (Math.random() < 0.45) return;
  try {
    const { w, h } = await viewportSize(page);
    const st = mouseState(page);
    const base = st.x != null ? st : { x: Math.floor(w / 2), y: Math.floor(h / 2) };
    await moveMouseTo(page, base.x + randomInt(-130, 130), base.y + randomInt(-90, 90), {
      steps: randomInt(4, 9),
    });
  } catch {
    /* best-effort */
  }
}

// A plausible mis-key: a random lowercase letter that ISN'T the character we're
// about to type (so the "typo → backspace → correct" looks like a real slip).
function randomTypoChar(nextChar) {
  const alpha = "abcdefghijklmnopqrstuvwxyz";
  const skip = String(nextChar || "").toLowerCase();
  let c;
  do {
    c = alpha[Math.floor(Math.random() * alpha.length)];
  } while (c === skip);
  return c;
}

// Types `value` with non-robotic cadence using only real CDP keystrokes
// (pressSequentially → type). Two human signals layered on top of per-key delay:
//   1. An occasional pre-value mis-key (stray char + brief pause + Backspace) —
//      a strong "a person is typing" tell.
//   2. Occasionally typing the value as two bursts with a pause between, instead
//      of one perfectly-even stream.
// Correctness is GUARANTEED by the caller (humanType verifies the final value
// and cleanly retypes on any mismatch), so neither flourish can corrupt a field.
async function typeHumanly(page, loc, value) {
  const v = String(value);
  const seq =
    typeof loc.pressSequentially === "function"
      ? (s, d) => loc.pressSequentially(s, { delay: d })
      : typeof loc.type === "function"
        ? (s, d) => loc.type(s, { delay: d })
        : null;
  if (!seq) {
    await loc.fill(v).catch(() => {});
    return;
  }

  // (1) Occasional pre-value mis-key, then correct it. Backspace goes through
  // the CDP Input domain too. If it ever misses, the caller's verify+retype net
  // restores the exact value, so this is always safe to attempt.
  if (v.length >= 4 && Math.random() < 0.18) {
    await seq(randomTypoChar(v[0]), randomInt(60, 140)).catch(() => {});
    await thinkTime(90, 260);
    await page.keyPress("Backspace").catch(() => {});
    await thinkTime(80, 200);
  }

  // (2) Type in one stream, or split into two human bursts.
  if (v.length >= 8 && Math.random() < 0.5) {
    const cut = randomInt(3, v.length - 3);
    await seq(v.slice(0, cut), randomInt(55, 140)).catch(() => {});
    await thinkTime(140, 420);
    await seq(v.slice(cut), randomInt(55, 140)).catch(() => {});
  } else {
    await seq(v, randomInt(55, 140)).catch(() => {});
  }
}

// Types into a field with a human-ish cadence: a real cursor drift + focus
// click, a brief pause, then character-by-character typing (via whatever per-key
// primitive the understudy engine exposes). This sheds the "instant value set"
// signal a plain fill()/native-setter leaves.
//
// SELF-VERIFYING: it reads the value back and, on any mismatch (e.g. a burst
// scrambled the caret or a mis-key wasn't backspaced), cleanly retypes the exact
// value via real keystrokes one more time. So it returns true with a correctly,
// HUMANLY-typed field in the overwhelming majority of cases — which keeps the
// flow off the less-human fill()/native-setter fallbacks in fastFill. Returns
// false only if it genuinely couldn't type; fastFill then falls back as before.
async function humanType(page, selector, value, { log } = {}) {
  if (!selector) return false;
  const v = String(value);
  const matches = async () => {
    const got = await readInputValue(page, selector);
    return got != null && got.trim() === v.trim();
  };
  try {
    const loc = page.locator(selector).first();
    // Real mouse move toward the field along a human arc, then a real click to
    // focus it — all through the CDP Input domain (genuine pointer events), not
    // a synthetic JS focus or a straight teleport to the field's center.
    await moveMouseToSelector(page, selector);
    await loc.hover().catch(() => {});
    await thinkTime(60, 160);
    await loc.click().catch(() => {});
    await thinkTime(110, 300);
    await loc.fill("").catch(() => {}); // type into a clean field

    await typeHumanly(page, loc, v);
    if (await matches()) return true;

    // Mismatch — one clean, still-human retype (real keystrokes) before ceding
    // to fastFill's fill()/native-setter fallbacks.
    await loc.fill("").catch(() => {});
    if (typeof loc.pressSequentially === "function") {
      await loc.pressSequentially(v, { delay: randomInt(55, 120) }).catch(() => {});
    } else if (typeof loc.type === "function") {
      await loc.type(v, { delay: randomInt(55, 120) }).catch(() => {});
    }
    return matches();
  } catch (e) {
    log?.warn("humanType failed", e?.message);
  }
  return false;
}

// Fills a field and VERIFIES the value took, trying progressively more forceful
// strategies. IG's signup form silently refuses to advance when a required field
// (notably email) is empty, and its inputs no longer expose name/aria-label, so
// a single best-effort fill is not enough:
//   1. Human-cadence typing (focus + per-key delay) when supported.
//   2. Locator fill on a known CSS selector or label-resolved node.
//   3. Native-setter fill on the resolved node (handles controlled inputs).
//   4. LLM act() as a last resort.
// After each strategy we read the value back; we only return true once the field
// actually contains the value. `key` is the data-qh-field tag used for (2)/(3).
async function fastFill(stagehand, page, { selectors = [], labelKeywords = [], value, describe, key, log }) {
  const matches = async (sel) => {
    const got = await readInputValue(page, sel);
    return got != null && got.trim() === String(value).trim();
  };

  // Resolve a selector for this field: a matching known CSS selector, else the
  // label-tagged one (also (re)applies the data-qh-field tag).
  const resolve = async () => {
    const css = await firstVisibleSelector(page, selectors);
    if (css) return css;
    if (labelKeywords.length) return tagInputByLabel(page, { keywords: labelKeywords, key: key || "field" });
    return null;
  };

  const sel = await resolve();
  if (sel) {
    // (a) Human-cadence typing — focus + per-key delay (anti-bot), then verify.
    await humanType(page, sel, value, { log });
    if (await matches(sel)) return true;
    // (b) Locator fill (clears + types, fires proper events) — the proven path.
    await page
      .locator(sel)
      .first()
      .fill(value)
      .catch((e) => log?.warn(`fastFill locator fill failed for ${describe}`, e?.message));
    if (await matches(sel)) return true;
    // (c) Native setter on the same node (controlled-input safe).
    await setInputValueNative(page, sel, value);
    if (await matches(sel)) return true;
  }

  // (d) LLM fallback, then verify against whatever selector we can resolve.
  await stagehand.act(`type "${value}" into the ${describe}`).catch((e) => {
    log?.warn(`fastFill act fallback failed for ${describe}`, e?.message);
  });
  const verifySel = await resolve();
  if (await matches(verifySel)) return true;

  log?.warn(`fastFill could NOT confirm a value for ${describe} (field stayed empty/mismatched)`);
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
  // Approach the target along a human cursor arc and pause briefly before the
  // real click, so the click is preceded by genuine pointer movement instead of
  // a teleport-then-click (a strong automation tell).
  await moveMouseTo(page, pt.x, pt.y);
  await thinkTime(40, 140);
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

// --- Human-presence helpers (anti-bot behavioral signals) -------------------
// Instagram's signup risk engine doesn't only look at WHAT we submit; it watches
// HOW we got there. A session that teleports to a form and types with zero
// scrolling, no cursor movement, and no reading time reads as automation even
// with a perfect fingerprint. These best-effort helpers add the missing human
// engagement; each is a safe no-op when its target isn't present.

// Dismisses a cookie/consent dialog by its specific button labels. Centralized
// so we can clear it on both the homepage and the signup form.
async function dismissCookieBanner(page) {
  await clickButtonByText(page, [
    "Allow all cookies",
    "Accept all",
    "Accept All",
    "Allow all",
    "Allow essential and optional cookies",
    "Only allow essential cookies",
    "Decline optional cookies",
  ]).catch(() => {});
}

// Hovers the first visible of `selectors` with a real CDP mouse move — a genuine
// pointer event (not synthetic JS), which is what populates the "mouse moved
// before interacting" signal. No-op if none are visible.
async function hoverSafely(page, selectors) {
  const sel = await firstVisibleSelector(page, selectors);
  if (!sel) return false;
  try {
    await moveMouseToSelector(page, sel);
    await page.locator(sel).first().hover();
    return true;
  } catch {
    return false;
  }
}

// A light, human-looking scroll: a couple of downward nudges (and sometimes a
// small scroll back up), with pauses. Real users never sit a page at scrollY=0
// and immediately type; this registers page engagement.
//
// IMPORTANT: prefer REAL wheel events via page.scroll(x, y, dx, dy) (CDP Input
// domain → isTrusted, with proper wheel deltas) over page.evaluate(scrollBy),
// which is a synthetic, UNtrusted programmatic scroll that bot detectors can
// tell apart from a genuine user gesture. Each nudge is split into a few ticks
// so the scroll ramps like a real wheel spin rather than one instant jump.
// Falls back to scrollBy only if the wheel primitive is unavailable.
async function gentleScroll(page, log) {
  try {
    const { w, h } = await viewportSize(page);
    const ox = randomInt(Math.floor(w * 0.3), Math.floor(w * 0.7));
    const oy = randomInt(Math.floor(h * 0.3), Math.floor(h * 0.7));
    const canWheel = typeof page.scroll === "function";
    const wheel = async (dy) => {
      if (canWheel) {
        const ticks = randomInt(2, 4);
        for (let t = 0; t < ticks; t++) {
          await page.scroll(ox, oy, 0, Math.round(dy / ticks)).catch(() => {});
          await sleep(randomInt(40, 110));
        }
      } else {
        await page
          .evaluate((y) => window.scrollBy({ top: y, left: 0, behavior: "smooth" }), dy)
          .catch(() => {});
      }
    };

    const nudges = randomInt(1, 3);
    for (let i = 0; i < nudges; i++) {
      await wheel(randomInt(120, 420));
      await thinkTime(350, 900);
    }
    if (Math.random() < 0.5) {
      await wheel(-randomInt(80, 220));
      await thinkTime(250, 650);
    }
  } catch (e) {
    log?.warn("gentleScroll failed", e?.message);
  }
}

// Clicks the "Sign up" / "Create new account" link to funnel from the homepage
// into the signup form as a real same-site navigation (carries a referrer and
// the cookies IG just set). Hovers first for a natural cursor approach. Falls
// back to a text-based coordinate click. Returns whether a click fired.
async function clickSignupLink(page, log) {
  const sel = await firstVisibleSelector(page, [
    'a[href*="emailsignup"]',
    'a[href*="/accounts/signup"]',
    'a[href*="signup"]',
  ]);
  if (sel) {
    try {
      await moveMouseToSelector(page, sel);
      await page.locator(sel).first().hover().catch(() => {});
      await thinkTime(140, 380);
      await page.locator(sel).first().click();
      return true;
    } catch (e) {
      log?.warn("sign-up link click failed", e?.message);
    }
  }
  return clickButtonByText(page, [
    "Sign up",
    "Sign Up",
    "Create new account",
    "Create New Account",
  ]);
}

// Realistic entry funnel: land on the IG homepage (sets first-party cookies +
// gives the eventual signup nav a same-site referrer), behave like a person for
// a beat (read, drift the cursor, a small scroll), then click through to the
// signup form. Guarantees we end on the email-signup form regardless of how the
// click lands; on any failure it falls back to navigating there directly, so the
// happy path is never worse than the old cold deep-link.
async function warmUpEntry({ page, log, capture, settleCaptcha }) {
  try {
    await page.goto(IG_HOME_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch (e) {
    log.warn("Homepage warm-up navigation failed — going straight to signup", e?.message);
    await page.goto(IG_SIGNUP_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    return;
  }
  await capture("homepage-loaded");
  // The homepage itself can be gated by a challenge.
  await settleCaptcha();
  await dismissCookieBanner(page);
  await readPause();
  await idleMouseDrift(page);
  await hoverSafely(page, ['svg[aria-label="Instagram"]', 'a[href="/"]', "h1", "img"]);
  await gentleScroll(page, log);
  await thinkTime(400, 1100);

  const clicked = await clickSignupLink(page, log);
  if (clicked) {
    // Wait for the signup form to render after the SPA/page transition.
    for (let i = 0; i < 16; i++) {
      const onForm = await firstVisibleSelector(page, ['input[type="email"]', 'input[type="text"]']);
      let url = "";
      try {
        url = page.url();
      } catch {
        /* page may be navigating */
      }
      if (onForm || /emailsignup|signup/i.test(url)) break;
      await sleep(500);
    }
  }

  // Whatever happened above, make sure we're actually on the email-signup form.
  let url = "";
  try {
    url = page.url();
  } catch {
    /* page may be gone */
  }
  if (!/emailsignup/i.test(url)) {
    await page.goto(IG_SIGNUP_URL, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
  }
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
// the solver (Browser Use's built-in bypass or CapSolver) can take over (it
// solves the resulting challenge, but the visible v2 checkbox must be clicked
// first). Prefers clicking the real
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
// Browser Use bypasses most CAPTCHAs in-browser, but IG's reCAPTCHA Enterprise
// can still slip through. When CAPSOLVER_API_KEY is set we solve the challenge
// ourselves as a fallback: read the sitekey off the page, get a token from
// CapSolver, inject it into the g-recaptcha-response field, and fire the widget
// callback so the challenge validates. All best-effort — never throws.

// Runs IN the page/frame context. Returns reCAPTCHA params (sitekey + enterprise
// /invisible flags) or null. Parsing the anchor iframe's `k` query param is the
// most reliable signal — it survives both v2 and Enterprise and works even when
// the widget div lacks a data-sitekey attribute.
function readRecaptchaParams() {
  const out = { websiteKey: null, isEnterprise: false, isInvisible: false, apiDomain: null };

  // Prefer the LIVE widget's anchor/bframe iframe (the `k=` query param). This
  // reflects the CAPTCHA actually being shown right now and is the only signal
  // that reliably distinguishes Enterprise (.../recaptcha/enterprise/...) from
  // standard v2 (.../recaptcha/api2/...). Scan every recaptcha iframe and prefer
  // an Enterprise one — IG's signup page can carry a stray non-enterprise widget
  // whose data-sitekey would otherwise mask the Enterprise challenge.
  const iframes = Array.from(document.querySelectorAll('iframe[src*="recaptcha"]'));
  let chosen = null;
  for (const f of iframes) {
    const src = f.getAttribute("src") || "";
    if (!src.includes("k=")) continue;
    let u;
    try {
      u = new URL(src, location.href);
    } catch {
      continue; // malformed src — skip
    }
    const k = u.searchParams.get("k");
    if (!k) continue;
    const isEnterprise = u.pathname.includes("/enterprise/");
    const isInvisible = u.searchParams.get("size") === "invisible";
    // CapSolver needs the host that serves reCAPTCHA (google.com vs
    // recaptcha.net) when it differs from the default — pass it through.
    const apiDomain = /recaptcha\.net$/i.test(u.hostname) ? u.hostname : null;
    // First match wins, but an Enterprise widget always overrides a v2 one.
    if (!chosen || (isEnterprise && !chosen.isEnterprise)) {
      chosen = { websiteKey: k, isEnterprise, isInvisible, apiDomain };
    }
  }
  if (chosen) {
    out.websiteKey = chosen.websiteKey;
    out.isEnterprise = chosen.isEnterprise;
    out.isInvisible = chosen.isInvisible;
    out.apiDomain = chosen.apiDomain;
  }

  // Fall back to an explicit widget attribute only if no live iframe key exists.
  if (!out.websiteKey) {
    const widget = document.querySelector("[data-sitekey]");
    if (widget) {
      out.websiteKey = widget.getAttribute("data-sitekey");
      if (widget.getAttribute("data-size") === "invisible") out.isInvisible = true;
    }
  }

  // Enterprise can also be inferred from the loaded API (the enterprise.js
  // script or window.grecaptcha.enterprise), which covers cases where the key
  // came from a data-sitekey attribute rather than the iframe URL.
  if (!out.isEnterprise) {
    if (document.querySelector('script[src*="recaptcha/enterprise"]')) {
      out.isEnterprise = true;
    } else if (window.grecaptcha && window.grecaptcha.enterprise) {
      out.isEnterprise = true;
    }
  }

  return out.websiteKey ? out : null;
}

// Finds the reCAPTCHA on the top document or in any child frame (IG sometimes
// hosts the widget inside a frame) and MERGES the signals: we keep the first
// sitekey found but OR-together the enterprise/invisible flags across every
// frame. This matters because the sitekey and the "this is Enterprise" signal
// can live in different frames — returning on the first frame (the old behavior)
// reported enterprise:false and made us solve IG's Enterprise challenge as a
// plain v2, yielding a token IG rejects.
async function detectRecaptcha(page) {
  const merged = { websiteKey: null, isEnterprise: false, isInvisible: false, apiDomain: null };
  const consider = (info) => {
    if (!info) return;
    if (info.websiteKey && !merged.websiteKey) merged.websiteKey = info.websiteKey;
    if (info.isEnterprise) merged.isEnterprise = true;
    if (info.isInvisible) merged.isInvisible = true;
    if (info.apiDomain && !merged.apiDomain) merged.apiDomain = info.apiDomain;
  };

  consider(await page.evaluate(readRecaptchaParams).catch(() => null));
  let frames = [];
  try {
    frames = page.frames() || [];
  } catch {
    frames = [];
  }
  for (const frame of frames) {
    consider(await frame.evaluate(readRecaptchaParams).catch(() => null));
  }
  return merged.websiteKey ? merged : null;
}

// Runs IN the page/frame context. Writes the solved token into every
// g-recaptcha-response textarea and fires the widget success callback(s). The
// callbacks live under window.___grecaptcha_cfg.clients in a version-specific,
// deeply-nested shape, so we DFS for any function under a "callback" key and
// invoke it with the token. Returns { fields, callbacks } counts so the caller
// can SEE whether the token actually reached the widget (a callbacks:0 result
// means we're relying on the getResponse patch + the Next click instead).
function applyRecaptchaToken(token) {
  let fields = 0;
  let callbacks = 0;

  const responseFields = Array.from(
    document.querySelectorAll(
      'textarea#g-recaptcha-response, textarea[name="g-recaptcha-response"], textarea[id^="g-recaptcha-response"]'
    )
  );
  for (const field of responseFields) {
    field.value = token;
    try {
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));
    } catch {
      /* ignore */
    }
    fields += 1;
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
          // Only fire the SUCCESS callback (the param reCAPTCHA stores under the
          // exact key "callback"). Firing "expired-callback"/"error-callback"
          // would tell IG the token expired/failed and actively reset the solve.
          if (typeof val === "function" && key.toLowerCase() === "callback") {
            try {
              val(token);
              callbacks += 1;
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
  return { fields, callbacks };
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

// Runs IN the page/frame context. Instagram reads the token by calling
// grecaptcha.enterprise.getResponse() when its "Next" button is clicked — but
// that returns "" because CapSolver solved the challenge OUT OF BAND (the widget
// never registered a solve). We patch getResponse (both the standard and
// enterprise namespaces) to return our injected token so IG's submit handler
// picks it up. Without this, the textarea/callback alone often isn't read.
function patchRecaptchaGetResponse(token) {
  const force = () => token;
  try {
    if (window.grecaptcha) {
      try {
        window.grecaptcha.getResponse = force;
      } catch {
        /* non-writable — ignore */
      }
      if (window.grecaptcha.enterprise) {
        try {
          window.grecaptcha.enterprise.getResponse = force;
        } catch {
          /* non-writable — ignore */
        }
      }
    }
  } catch {
    /* no grecaptcha in this context */
  }
}

// Injects a solved token into the page + every frame: writes the response
// field(s), fires the success callback(s), and patches getResponse() so IG's
// submit handler reads our token. Returns aggregate { fields, callbacks } counts
// across the top document and all frames.
async function injectRecaptchaToken(page, token) {
  const totals = { fields: 0, callbacks: 0 };
  const add = (r) => {
    if (r && typeof r === "object") {
      totals.fields += r.fields || 0;
      totals.callbacks += r.callbacks || 0;
    }
  };

  add(await page.evaluate(applyRecaptchaToken, token).catch(() => null));
  await page.evaluate(patchRecaptchaGetResponse, token).catch(() => {});

  let frames = [];
  try {
    frames = page.frames() || [];
  } catch {
    frames = [];
  }
  for (const frame of frames) {
    add(await frame.evaluate(applyRecaptchaToken, token).catch(() => null));
    await frame.evaluate(patchRecaptchaGetResponse, token).catch(() => {});
  }
  await page.evaluate(ensureRecaptchaField, token).catch(() => {});
  return totals;
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

  // Decide the task type. IG's reCAPTCHA is Enterprise; a v2 token is rejected.
  // DOM detection is unreliable across cross-origin frames, so OR it with a
  // known-sitekey lookup and the config force flag. This is THE fix for "solved
  // but never clears": we were sending ReCaptchaV2TaskProxyLess for an Enterprise
  // sitekey, so CapSolver returned a token IG would never accept.
  const isEnterprise =
    info.isEnterprise ||
    config.capsolver.forceEnterprise ||
    KNOWN_ENTERPRISE_SITEKEYS.has(info.websiteKey);

  log.info("CapSolver: solving reCAPTCHA", {
    sitekey: info.websiteKey,
    enterprise: isEnterprise,
    enterpriseSource: info.isEnterprise
      ? "dom"
      : KNOWN_ENTERPRISE_SITEKEYS.has(info.websiteKey)
        ? "known-sitekey"
        : config.capsolver.forceEnterprise
          ? "forced"
          : "no",
    invisible: info.isInvisible,
    apiDomain: info.apiDomain || "(default)",
    proxied: Boolean(config.capsolver.proxy),
  });
  try {
    const token = await capsolver.solveReCaptcha({
      websiteURL,
      websiteKey: info.websiteKey,
      isEnterprise,
      isInvisible: info.isInvisible,
      apiDomain: info.apiDomain || undefined,
      // Solve through the same proxy the browser uses (when configured) so the
      // Enterprise token's IP/fingerprint matches and IG accepts it.
      proxy: config.capsolver.proxy || undefined,
    });
    const { fields, callbacks } = await injectRecaptchaToken(page, token);
    // We consider the token transferred if it reached a response field, a
    // success callback, OR (always) the getResponse patch. IG still needs its
    // modal's Next button clicked (caller does that) to actually advance.
    log.info("CapSolver: token transferred to widget", {
      tokenLength: token.length,
      responseFields: fields,
      callbacksFired: callbacks,
    });
    return true;
  } catch (err) {
    log.warn("CapSolver: solve failed", err?.message);
    return false;
  }
}

// Instagram's "Help us confirm it's you" modal does NOT auto-advance when the
// reCAPTCHA token is injected — its blue "Next"/"Continue" button must be
// clicked to POST the solved challenge. Without this, a perfectly valid token
// just sits in the form and the modal never closes (the exact "solved but not
// applied to the screen" symptom). Best-effort; returns whether a click fired.
async function submitSolvedCaptcha(page, log) {
  const clicked = await clickButtonByText(page, [
    "Next",
    "Continue",
    "Submit",
    "Confirm",
    "Done",
  ]);
  if (clicked) log.info("Submitted solved CAPTCHA (clicked Next/Continue)");
  else log.warn("Could not find a Next/Continue button to submit the solved CAPTCHA");
  return clicked;
}

// Polls captchaPresent() at a short interval until the challenge clears or we
// hit the timeout. Lets the CapSolver fast path confirm a clear in seconds
// instead of grinding through the long manual-wait loop.
async function waitForCaptchaCleared(page, { timeoutMs = 12000, intervalMs = 1500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (!(await captchaPresent(page))) return true;
    if (Date.now() >= deadline) return false;
    await sleep(intervalMs);
  }
}

// Ensures a CAPTCHA challenge is cleared before proceeding.
//
// Strategy: Browser Use's stealth browser bypasses most CAPTCHAs automatically
// in-browser, so we poll FIRST — frequently the challenge is already gone. When
// IG's "confirm it's you" reCAPTCHA Enterprise persists, we fall back to
// CapSolver: click the v2 checkbox to initiate the challenge, then (within a
// budget) solve+inject+submit a token. A PROXYLESS CapSolver token is solved on
// a datacenter IP and IG's Enterprise risk engine often rejects the
// IP/fingerprint mismatch, so route the browser and CapSolver through the same
// residential region (BROWSER_USE_PROXY_COUNTRY + CAPSOLVER_PROXY) for the best
// clear rate. Therefore:
//   - Poll first (Browser Use may have already cleared it).
//   - Click the checkbox, then each round try a CapSolver solve+inject+submit.
//   - CapSolver budget is 3 when PROXIED (CAPSOLVER_PROXY set → reliable, leads)
//     and just 1 when proxyless (don't burn credits on a losing battle).
//   - Finally, fall back to a manual/human wait on the live session.
//
// Returns true if a CAPTCHA was encountered, false if none was present. Never
// throws.
async function ensureCaptchaSolved({
  page,
  sessionUrl,
  log,
  manualTimeoutMs = Number(process.env.CAPTCHA_WAIT_MS) || 180000,
}) {
  // Give Browser Use's in-browser CAPTCHA bypass a brief beat to act before we
  // inspect the page (it often clears the first post-submit challenge for free).
  await sleep(2000);

  // No challenge present (none appeared or Browser Use already cleared it).
  if (!(await captchaPresent(page))) return false;

  const apiReady = capsolver.isConfigured();
  const apiProxied = apiReady && Boolean(config.capsolver.proxy);
  // Proxyless CapSolver tokens are usually rejected by IG (solve IP != browser
  // IP), so cap futile attempts at 1; a matched residential proxy makes CapSolver
  // reliable, so let it lead with a larger budget.
  const apiBudget = apiProxied ? 3 : apiReady ? 1 : 0;
  let apiUsed = 0;

  // Initiate the visible challenge by clicking the v2 checkbox so Browser Use's
  // in-browser bypass (or CapSolver) can take it over.
  await clickRecaptchaCheckbox(page, log);

  const rounds = 3;
  for (let attempt = 1; attempt <= rounds; attempt++) {
    if (!(await captchaPresent(page))) {
      log.info("CAPTCHA cleared");
      return true;
    }

    // (a) Give Browser Use's in-browser bypass a moment, then click IG's "Next".
    // Even when the reCAPTCHA checkbox is solved, IG's modal still needs Next to
    // advance — without this click a solved challenge just sits there. Then poll
    // for a clear (generous window when proxyless since the in-browser bypass is
    // our best bet; short when proxied since CapSolver leads).
    await sleep(1000);
    await submitSolvedCaptcha(page, log);
    if (await waitForCaptchaCleared(page, { timeoutMs: apiProxied ? 2000 : 12000 })) {
      log.info("CAPTCHA cleared (Browser Use in-browser bypass)");
      return true;
    }

    // (b) CapSolver solve+inject+submit, within budget.
    if (apiReady && apiUsed < apiBudget) {
      apiUsed += 1;
      log.warn(`CAPTCHA still up — CapSolver attempt ${apiUsed}/${apiBudget}`, {
        sessionUrl,
        proxied: apiProxied,
      });
      if (await solveCaptchaViaApi({ page, log })) {
        await sleep(800); // let the token settle into the widget
        await submitSolvedCaptcha(page, log);
        if (await waitForCaptchaCleared(page, { timeoutMs: 8000 })) {
          log.info("CAPTCHA cleared (CapSolver)");
          return true;
        }
        log.warn("CAPTCHA still up after submitting CapSolver token");
      }
    }

    // Re-nudge the checkbox to (re)initiate the challenge for the next round.
    await clickRecaptchaCheckbox(page, log);
  }

  // ---- Manual / human fallback (keeps polling + nudging) ---------------------
  log.warn("CAPTCHA still up after automated attempts — waiting (Browser Use/human)", { sessionUrl });
  const deadline = Date.now() + manualTimeoutMs;
  let lastLog = 0;
  let lastNudge = Date.now();
  let nudges = 0;
  while (Date.now() < deadline) {
    if (!(await captchaPresent(page))) {
      log.info("CAPTCHA cleared");
      return true;
    }
    // Periodically re-nudge the checkbox and click Next, so a late Browser Use
    // or human solve actually advances the modal.
    if (Date.now() - lastNudge > 18000 && nudges < 4) {
      await clickRecaptchaCheckbox(page, log);
      await submitSolvedCaptcha(page, log);
      lastNudge = Date.now();
      nudges += 1;
    }
    if (Date.now() - lastLog > 20000) {
      log.warn(`CAPTCHA still up — watch/solve live: ${sessionUrl || "(session URL unavailable)"}`);
      lastLog = Date.now();
    }
    await sleep(3000);
  }
  log.warn("Timed out waiting for CAPTCHA to clear; continuing best-effort");
  return true;
}

// --- "Confirm you're human" image-code challenge (LLM vision OCR) -----------
// This is a DIFFERENT challenge from reCAPTCHA: Instagram shows a card titled
// "Confirm you're human" with a DISTORTED NUMBER/letter image and an "Enter the
// code from the image" box. There's no token to inject and CapSolver's
// reCAPTCHA task doesn't apply — the only way through is to actually READ the
// warped code. We screenshot just the code image and send it to our LLM (Gemini
// vision); it returns the code, we type it and submit. On a misread we click
// "Get a new code" and try a fresh image.

// Selectors for the code input on the image-code challenge. IG's box uses the
// placeholder "Enter the code from the image".
const IMAGE_CAPTCHA_INPUT_SELECTORS = [
  'input[placeholder*="code from the image" i]',
  'input[placeholder*="enter the code" i]',
  'input[aria-label*="code from the image" i]',
  'input[aria-label*="enter the code" i]',
  'input[name*="captcha" i]',
];

// True when the distorted image-code "Confirm you're human" challenge is on
// screen — detected by its code input or its distinctive instruction text.
async function imageCaptchaPresent(page) {
  if (await firstVisibleSelector(page, IMAGE_CAPTCHA_INPUT_SELECTORS)) return true;
  return page
    .evaluate(() => {
      const t = ((document.body && document.body.innerText) || "").toLowerCase();
      const human =
        t.includes("confirm you're human") || t.includes("confirm you\u2019re human");
      const code =
        t.includes("code from the image") ||
        t.includes("enter the code from the image") ||
        (t.includes("hear this code") && t.includes("get a new code"));
      return human && code;
    })
    .catch(() => false);
}

// Instagram's post-signup INTEGRITY GATE: a card titled "Confirm you're human
// to use your account, <username>" with a single big "Continue" button and NO
// challenge widget yet (no reCAPTCHA iframe, no code input). It is just the
// INTRO to the human check — you must click Continue to reach the actual
// reCAPTCHA / image-code, which the solvers then clear. Because neither
// captchaPresent() nor imageCaptchaPresent() matches this button-only screen,
// without handling it the run stalls on the intro and the final URL check
// mislabels the account "suspended" — exactly the "Continue never gets clicked"
// symptom.
async function confirmHumanGatePresent(page) {
  // The distorted image-code challenge AND the reCAPTCHA challenge can also sit
  // under "Confirm you're human" text. Their widgets (a code input / a reCAPTCHA
  // iframe) mean we're already PAST the button-only intro, so defer to the
  // dedicated solvers instead of re-clicking Continue over a live challenge.
  if (await firstVisibleSelector(page, IMAGE_CAPTCHA_INPUT_SELECTORS)) return false;
  if (await captchaPresent(page)) return false;
  return page
    .evaluate(() => {
      const t = ((document.body && document.body.innerText) || "").toLowerCase();
      const human =
        t.includes("confirm you're human") || t.includes("confirm you\u2019re human");
      const acct = t.includes("use your account");
      const hasCode = t.includes("code from the image") || t.includes("enter the code");
      return human && acct && !hasCode;
    })
    .catch(() => false);
}

// Clicks through the "Confirm you're human to use your account" intro gate so
// the real challenge renders for the solvers. Clicks its Continue/Start button
// (via a real cursor arc), then waits for the gate to give way. Returns true
// only if we actually advanced past it (so callers don't loop on a stuck gate);
// false when the gate wasn't present or couldn't be cleared.
async function passConfirmHumanGate({ page, log, capture }) {
  if (!(await confirmHumanGatePresent(page))) return false;
  log.info(
    '"Confirm you\'re human to use your account" gate detected — clicking Continue to reach the human check'
  );
  await capture?.("confirm-human-gate");
  // A real person reads this screen for a beat before clicking the one button.
  await readPause();
  await idleMouseDrift(page);

  for (let attempt = 1; attempt <= 3; attempt++) {
    // Primary: click by the visible button label (real mouse arc + click).
    let clicked = await clickButtonByText(page, [
      "Continue",
      "Start",
      "Get started",
      "Get Started",
      "Begin",
      "Next",
    ]);
    // Fallback: the most prominent button / role=button on the card.
    if (!clicked) {
      const sel = await firstVisibleSelector(page, [
        'button[type="submit"]',
        'div[role="button"]',
        "button",
        '[role="button"]',
      ]);
      if (sel) {
        await moveMouseToSelector(page, sel);
        await thinkTime(120, 320);
        await page.locator(sel).first().click().catch(() => {});
        clicked = true;
      }
    }

    // Wait for the intro gate to give way to the next screen (the real
    // challenge, or a cleared/home state).
    for (let i = 0; i < 8; i++) {
      await sleep(800);
      if (!(await confirmHumanGatePresent(page))) {
        log.info("Advanced past the confirm-human gate");
        await capture?.("confirm-human-gate-passed");
        return true;
      }
    }
    log.warn(`Confirm-human gate still up after clicking Continue (attempt ${attempt}/3)`);
  }
  await capture?.("confirm-human-gate-stuck");
  return false;
}

// Computes a viewport-clamped clip rectangle around the distorted code image so
// we screenshot ONLY the code (the cleanest OCR signal). Picks the largest
// plausibly-sized <img>/<canvas>/<svg> that sits above the code input; returns
// null if none is found (caller then falls back to a full-page screenshot).
async function captchaImageClip(page) {
  return page
    .evaluate((inputSelectors) => {
      const isVisible = (el) => {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      let input = null;
      for (const sel of inputSelectors) {
        const el = document.querySelector(sel);
        if (el && isVisible(el)) {
          input = el;
          break;
        }
      }
      const inputTop = input ? input.getBoundingClientRect().top : Infinity;
      const nodes = Array.from(document.querySelectorAll("img, canvas, svg")).filter(isVisible);
      const candidates = nodes
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.left, y: r.top, width: r.width, height: r.height, area: r.width * r.height };
        })
        // Plausible CAPTCHA size — skip tiny icons and full-width banners.
        .filter((r) => r.width >= 70 && r.width <= 700 && r.height >= 22 && r.height <= 320)
        // The code image sits above the input box.
        .filter((r) => r.y < inputTop)
        .sort((a, b) => b.area - a.area);
      const pick = candidates[0];
      if (!pick) return null;
      const pad = 6;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const x = Math.max(0, Math.floor(pick.x - pad));
      const y = Math.max(0, Math.floor(pick.y - pad));
      const width = Math.min(Math.ceil(pick.width + pad * 2), vw - x);
      const height = Math.min(Math.ceil(pick.height + pad * 2), vh - y);
      if (width <= 0 || height <= 0) return null;
      return { x, y, width, height };
    }, IMAGE_CAPTCHA_INPUT_SELECTORS)
    .catch(() => null);
}

// Screenshots the code image (clipped when we can locate it, else the whole
// viewport) and returns it as { base64, mimeType } for the LLM. Never throws.
async function captureCaptchaImage(page, log) {
  const clip = await captchaImageClip(page);
  if (clip) {
    try {
      const buf = await page.screenshot({ clip, type: "png" });
      if (buf && buf.length) {
        return { base64: Buffer.from(buf).toString("base64"), mimeType: "image/png" };
      }
    } catch (e) {
      log?.warn("captcha clip screenshot failed; falling back to full page", e?.message);
    }
  }
  try {
    const buf = await page.screenshot({ type: "png" });
    if (buf && buf.length) {
      return { base64: Buffer.from(buf).toString("base64"), mimeType: "image/png" };
    }
  } catch (e) {
    log?.warn("captcha full-page screenshot failed", e?.message);
  }
  return null;
}

// Asks Instagram for a fresh code image (used after the LLM misreads one).
async function requestNewImageCode(page) {
  return clickButtonByText(page, [
    "Get a new code",
    "Get a new",
    "New code",
    "Refresh",
    "Try a different code",
  ]);
}

// Reads the distorted image code with two engines:
//   1. PRIMARY — our LLM, Gemini vision (gemini.readCaptchaCode).
//   2. BACKUP — CapSolver's ImageToText OCR (capsolver.solveImageToText), a
//      service purpose-built to read "enter the code from the image" challenges.
// `preferBackup` flips the order so a repeatedly-wrong primary yields to the
// other engine on the next retry. Returns { code, source } — code is null when
// no engine could read one. Never throws.
async function readImageCaptchaCode({ shot, page, preferBackup, log }) {
  const readWithGemini = async () => {
    if (!gemini.isConfigured()) return null;
    return gemini.readCaptchaCode({
      imageBase64: shot.base64,
      mimeType: shot.mimeType,
      hint: "usually a 6-digit number",
    });
  };
  const readWithCapsolver = async () => {
    if (!capsolver.isConfigured()) return null;
    let websiteURL = "";
    try {
      websiteURL = page.url();
    } catch {
      /* page may be gone */
    }
    try {
      const text = await capsolver.solveImageToText({
        imageBase64: shot.base64,
        module: config.capsolver.imageToTextModule || undefined,
        websiteURL: websiteURL || undefined,
      });
      const clean = (text || "").replace(/[^a-z0-9]/gi, "").trim();
      return clean || null;
    } catch (e) {
      log.warn("CapSolver ImageToText failed", e?.message);
      return null;
    }
  };

  const engines = preferBackup
    ? [["capsolver", readWithCapsolver], ["gemini", readWithGemini]]
    : [["gemini", readWithGemini], ["capsolver", readWithCapsolver]];

  for (const [source, read] of engines) {
    const code = await read();
    if (code) return { code, source };
  }
  return { code: null, source: null };
}

// Solves the "Confirm you're human" image-code challenge if it's present:
// screenshot the code -> read it (Gemini LLM primary, CapSolver ImageToText OCR
// backup) -> type + submit. On a misread it requests a fresh code and switches
// engines for the next try. Returns true if the challenge was present (handled),
// false if no such challenge was on screen. Never throws.
async function solveImageCaptchaIfPresent({ stagehand, page, log, capture, attempts = 4 }) {
  if (!(await imageCaptchaPresent(page))) return false;
  await capture?.("image-code-captcha-detected");
  log.info(
    '"Confirm you\'re human" image-code challenge detected — solving (Gemini primary, CapSolver ImageToText backup)'
  );

  const geminiReady = gemini.isConfigured();
  const capsolverReady = capsolver.isConfigured();
  if (!geminiReady && !capsolverReady) {
    log.warn(
      "Image-code challenge present but neither GEMINI_API_KEY nor CAPSOLVER_API_KEY is set — cannot auto-read the code (solve it live)"
    );
    return true;
  }

  let preferBackup = false;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (!(await imageCaptchaPresent(page))) {
      log.info("Image-code CAPTCHA cleared");
      return true;
    }

    const shot = await captureCaptchaImage(page, log);
    if (!shot) {
      log.warn(`Image-code CAPTCHA: couldn't capture the code image (attempt ${attempt}/${attempts})`);
      await requestNewImageCode(page);
      await sleep(1800);
      continue;
    }

    const { code, source } = await readImageCaptchaCode({ shot, page, preferBackup, log });
    if (!code) {
      log.warn(
        `Image-code CAPTCHA: no engine could read a code (attempt ${attempt}/${attempts}) — requesting a new one`
      );
      await requestNewImageCode(page);
      await sleep(1800);
      continue;
    }

    log.info(`Image-code CAPTCHA: ${source} read "${code}" (attempt ${attempt}/${attempts})`);
    await fastFill(stagehand, page, {
      selectors: [...IMAGE_CAPTCHA_INPUT_SELECTORS, 'input[type="text"]', 'input[type="tel"]'],
      value: code,
      describe: "confirm-you're-human image code field",
      key: "imagecaptcha",
      log,
    });
    await sleep(400);
    await pressButton(stagehand, page, {
      texts: ["Next", "Continue", "Submit", "Confirm", "Verify"],
      cssFallback: ['button[type="submit"]'],
      act: "click the Next button to submit the confirmation code",
      log,
    });

    // Wait for the challenge to clear after submitting.
    let cleared = false;
    for (let i = 0; i < 6 && !cleared; i++) {
      await sleep(1000);
      cleared = !(await imageCaptchaPresent(page));
    }
    if (cleared) {
      log.info(`Image-code CAPTCHA cleared (${source} read "${code}")`);
      await capture?.("image-code-captcha-cleared");
      return true;
    }

    // Still up — wrong read or rejected. Switch engines and refresh the code.
    preferBackup = !preferBackup;
    log.warn(
      `Image-code CAPTCHA still present after submitting "${code}" (${source}) — refreshing code, switching engine`
    );
    await requestNewImageCode(page);
    await sleep(1800);
  }

  log.warn("Image-code CAPTCHA still present after Gemini + CapSolver attempts");
  await capture?.("image-code-captcha-unsolved");
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

// Compares a read-back field value to the expected code, tolerant of any
// formatting the input applies (e.g. a "612 940" space or stray separators) so a
// correctly-typed code isn't seen as a mismatch.
function codeValueMatches(got, code) {
  if (got == null) return false;
  return got.replace(/\D/g, "") === String(code).replace(/\D/g, "");
}

// Resolves the confirmation-code <input>, robust to IG dropping the stable
// name/autocomplete/aria identifiers. This was THE reason valid codes kept being
// rejected: the field no longer matched the hardcoded selectors, so the humanly-
// typed path never ran and the flow fell to a Stagehand act() that PASTES all
// six digits in one event — the exact automation tell that makes IG reject a
// correct code as "invalid/expired". We now try, in order: explicit selectors,
// the placeholder/aria/label text ("Confirmation code"/"code"), then the single
// prominent visible text/tel/numeric input on the code screen. Returns a CSS
// selector (tagging the element with data-qh-field=code when resolved by scan).
async function resolveCodeInput(page) {
  const explicit = await firstVisibleSelector(page, [
    'input[name="email_confirmation_code"]',
    'input[name="confirmationCode"]',
    'input[autocomplete="one-time-code"]',
    'input[aria-label*="confirmation code" i]',
    'input[aria-label*="code" i]',
    'input[placeholder*="confirmation code" i]',
    'input[placeholder*="code" i]',
    'input[type="tel"]',
    'input[inputmode="numeric"]',
  ]);
  if (explicit) return explicit;

  const byLabel = await tagInputByLabel(page, {
    keywords: ["confirmation code", "security code", "code"],
    key: "code",
  });
  if (byLabel) return byLabel;

  return page
    .evaluate(() => {
      const isVisible = (el) => {
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const inputs = Array.from(document.querySelectorAll("input")).filter((el) => {
        const t = (el.getAttribute("type") || "text").toLowerCase();
        return ["text", "tel", "number", "search"].includes(t) && isVisible(el);
      });
      if (!inputs.length) return null;
      const hint = (el) =>
        `${el.placeholder || ""} ${el.getAttribute("aria-label") || ""} ${
          (el.labels && Array.from(el.labels).map((l) => l.textContent).join(" ")) || ""
        }`;
      const target = inputs.find((el) => /code/i.test(hint(el))) || inputs[0];
      target.setAttribute("data-qh-field", "code");
      return '[data-qh-field="code"]';
    })
    .catch(() => null);
}

// Types the confirmation code into a SINGLE input using ONLY genuine, per-digit
// CDP keystrokes with human gaps — and crucially NEVER an instant value-set.
//
// This is the whole ballgame at IG's most-scrutinized screen: the prior code
// entered the digits via keystrokes BUT, because its read-back check was too
// strict (it failed on a formatted "612 940" read-back), it fell through to a
// Stagehand act()/fill() that re-set all six digits in ONE event — a paste-like
// signal that is exactly what makes IG reject an objectively-correct, freshly-
// issued code as "invalid or has expired". Here we type digit-by-digit, verify
// tolerant of formatting, and on a real mismatch RE-TYPE with keystrokes rather
// than pasting. Returns whether the field ends up holding the code.
async function typeCodeHumanly(page, selector, code, log) {
  if (!selector) return false;
  const digits = String(code).trim().split("");
  const loc = page.locator(selector).first();
  const focusAndClear = async () => {
    await moveMouseToSelector(page, selector);
    await loc.hover().catch(() => {});
    await thinkTime(80, 200);
    await loc.click().catch(() => {});
    await thinkTime(140, 360);
    await loc.fill("").catch(() => {}); // start from an empty field (one clear is fine)
    await thinkTime(120, 280);
  };
  try {
    await focusAndClear();
    for (let i = 0; i < digits.length; i++) {
      const d = digits[i];
      if (typeof loc.pressSequentially === "function") {
        await loc.pressSequentially(d, { delay: randomInt(0, 30) }).catch(() => {});
      } else if (typeof page.keyPress === "function") {
        await page.keyPress(d).catch(() => {});
      } else if (typeof loc.type === "function") {
        await loc.type(d).catch(() => {});
      } else {
        return false;
      }
      await sleep(randomInt(150, 380));
      if ((i === 2 || i === 3) && Math.random() < 0.5) await sleep(randomInt(280, 720));
    }
    const got1 = await readInputValue(page, selector);
    log?.info("code field read-back after keystroke pass 1", JSON.stringify(got1));
    if (codeValueMatches(got1, code)) return true;

    // Read-back didn't confirm — one clean keystroke retype (still NO paste).
    log?.warn("Code field read-back mismatch — retyping via keystrokes once");
    await focusAndClear();
    if (typeof loc.pressSequentially === "function") {
      await loc.pressSequentially(String(code), { delay: randomInt(90, 180) }).catch(() => {});
    } else if (typeof loc.type === "function") {
      await loc.type(String(code), { delay: randomInt(90, 180) }).catch(() => {});
    }
    const got2 = await readInputValue(page, selector);
    log?.info("code field read-back after keystroke pass 2", JSON.stringify(got2));
    if (codeValueMatches(got2, code)) return true;

    // COMMIT TO KEYSTROKES: even if the read-back is uncertain, we have issued
    // genuine per-key events. We deliberately do NOT fall through to an instant
    // act()/fill paste of the whole code here — that paste is the documented tell
    // that gets a correct code rejected. Report success so the caller submits the
    // keystroke-typed value; a truly-empty field surfaces as IG asking again
    // (a distinct, detectable outcome) rather than an "invalid" paste rejection.
    if (got2 != null && got2.replace(/\D/g, "").length > 0) {
      log?.warn("Proceeding with keystroke-typed code despite uncertain read-back (no paste fallback)");
      return true;
    }
    return false;
  } catch (e) {
    log?.warn("typeCodeHumanly failed", e?.message);
    return false;
  }
}

// Enters the email confirmation code. Handles both the common single-input
// layout and a split one-digit-per-box OTP layout (some IG variants), and
// clears the field first so a retry doesn't append to a stale value.
async function enterEmailCode(stagehand, page, code, log) {
  const single = await resolveCodeInput(page);
  if (single) {
    log?.info("Resolved confirmation-code input", single);
    // Genuine per-digit keystrokes ONLY — never an instant paste/fill, which is
    // the documented tell that gets a correct code rejected as invalid/expired.
    if (await typeCodeHumanly(page, single, code, log)) return true;
    log?.warn("typeCodeHumanly could not confirm the code value; trying split-OTP / act fallbacks");
  } else {
    log?.warn("Could not resolve the confirmation-code input by selector/label/scan");
  }

  // Split OTP layout: one <input maxlength="1"> per digit. Type each box with
  // real keystrokes (focus + key) instead of setting .value directly.
  const otpBoxes = await page
    .evaluate(() => {
      const boxes = Array.from(
        document.querySelectorAll('input[maxlength="1"], input[inputmode="numeric"]')
      ).filter((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0;
      });
      boxes.forEach((el, i) => el.setAttribute("data-qh-otp", String(i)));
      return boxes.length;
    })
    .catch(() => 0);
  if (otpBoxes >= String(code).length) {
    try {
      const digits = String(code).split("");
      for (let i = 0; i < digits.length; i++) {
        const boxSel = `[data-qh-otp="${i}"]`;
        const boxLoc = page.locator(boxSel).first();
        await moveMouseToSelector(page, boxSel).catch(() => {});
        await boxLoc.click().catch(() => {});
        await thinkTime(60, 160);
        if (typeof boxLoc.pressSequentially === "function") {
          await boxLoc.pressSequentially(digits[i], { delay: randomInt(0, 30) }).catch(() => {});
        } else if (typeof page.keyPress === "function") {
          await page.keyPress(digits[i]).catch(() => {});
        }
        await sleep(randomInt(140, 360));
      }
      return true;
    } catch (e) {
      log?.warn("split-OTP keystroke entry failed", e?.message);
    }
  }

  await stagehand
    .act(`type "${code}" into the confirmation code field`)
    .catch((e) => log?.warn("enterEmailCode act fallback failed", e?.message));
  return false;
}

// True if IG is showing an inline "that confirmation code is wrong/expired"
// error. Tells us the entered code was stale/incorrect so we should fetch a
// FRESHER one (IG invalidates the old code once a newer one exists) rather than
// re-submitting the same value.
async function emailCodeRejected(page) {
  return page
    .evaluate(() => {
      const t = ((document.body && document.body.innerText) || "").toLowerCase();
      return (
        /invalid or has expired/.test(t) ||
        /didn'?t match/.test(t) ||
        /that code (is|was|you)/.test(t) ||
        /code (is )?(invalid|incorrect|expired)/.test(t) ||
        /(check|enter).{0,40}code (correctly|again)/.test(t) ||
        /please try again/.test(t)
      );
    })
    .catch(() => false);
}

// Best-effort: ask Instagram to ACTUALLY send a new confirmation code. Returns
// whether a real resend was triggered.
//
// IMPORTANT: on the current IG layout "I didn't get the code" does NOT resend —
// it only OPENS a "Didn't get the code?" sheet whose real action is a separate
// "Resend confirmation code" row. The old behavior clicked just the opener and
// returned true, so no code was ever re-sent and attempts 2/3 always timed out
// waiting for an email that never came. We now (1) try any inline/direct resend
// control, then (2) open the sheet and click the real "Resend confirmation
// code" row inside it.
const RESEND_LABELS = [
  "Resend confirmation code",
  "Resend code",
  "Send a new code",
  "Get a new code",
  "Send again",
  "Resend",
];

async function requestNewEmailCode(page) {
  // (1) A directly-visible resend control (some variants render it inline).
  if (await clickButtonByText(page, RESEND_LABELS)) return true;

  // (2) Open the "Didn't get the code?" sheet, then click the real resend row.
  const opened = await clickButtonByText(page, [
    "I didn't get the code",
    "I didn\u2019t get the code",
  ]);
  if (opened) {
    // Let the bottom-sheet/modal animate in before reaching for its rows.
    await sleep(randomInt(900, 1600));
    if (await clickButtonByText(page, RESEND_LABELS)) return true;
  }
  return false;
}

// True if Instagram rejected the EMAIL ADDRESS itself at the signup form (as
// opposed to the later confirmation-code step). This is the #1 reason a code
// "never arrives": IG refuses disposable-domain addresses up front (its domain
// is on Meta's blocklist), so it never even sends a code. Detecting this lets us
// swap in a fresh address instead of waiting forever for an email IG won't send.
async function emailAddressRejected(page) {
  return page
    .evaluate(() => {
      const t = ((document.body && document.body.innerText) || "").toLowerCase();
      const patterns = [
        /you can'?t use this email/,
        /this email( address)? (can'?t|cannot|is not|isn'?t) (be used|available|valid)/,
        /email address is not available/,
        /(please )?enter a valid email/,
        /try (a different|another) email/,
        /use a (different|valid) email/,
        /this email (looks invalid|isn'?t valid)/,
      ];
      return patterns.some((re) => re.test(t));
    })
    .catch(() => false);
}

// True if Instagram rejected the chosen USERNAME (already taken / not available).
// IG validates this inline as you type AND again on submit; when it fires, the
// form won't advance until a different handle is entered — so we detect it and
// rotate to a brand-new username rather than getting stuck resubmitting a taken
// one. Kept specific to the username (not the email/password) messaging.
async function usernameRejected(page) {
  return page
    .evaluate(() => {
      const t = ((document.body && document.body.innerText) || "").toLowerCase();
      const patterns = [
        /this username isn'?t available/,
        /that username isn'?t available/,
        /username isn'?t available/,
        /username is not available/,
        /username.*(is )?(taken|already (taken|in use))/,
        /a user with that username already exists/,
        /(choose|try|pick) (a |another )?(different )?username/,
      ];
      return patterns.some((re) => re.test(t));
    })
    .catch(() => false);
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
    // Drift the cursor onto the trigger and pause before opening it — a person
    // doesn't pop a dropdown the instant the previous one closed.
    await moveMouseToSelector(page, selector);
    await thinkTime(120, 320);
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
      // Move to the option along a human arc and pause (scan the list) before
      // committing the selection.
      await moveMouseTo(page, pt.x, pt.y);
      await thinkTime(80, 220);
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

// Detects whether the birthday controls are present AND visible right now. The
// visibility check matters: IG's SPA leaves the previous step's Month combobox
// mounted-but-hidden in the DOM (seen on the email-confirmation step), so a
// presence-only check false-positived and sent us re-filling a phantom birthday
// — wasting time and firing extra bot-like resubmits — after we'd already
// advanced past the signup form.
async function birthdayPresent(page) {
  const combo = await elInfo(page, BIRTHDAY_COMBO.month);
  if (combo && combo.visible) return true;
  const sel = await elInfo(page, BIRTHDAY_SELECT.month);
  return Boolean(sel && sel.visible);
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
    await thinkTime(220, 560);
    await setBirthdayField(page, "day", {
      optionText: String(dob.day),
      expects: [String(dob.day)],
    });
    await thinkTime(220, 560);
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
  let username = freshUsername(persona);
  const password = randomPassword();
  const dob = pickBirthday();

  log.info("Creating IG account", { username, email, dob });

  const result = await withStagehand(async ({ stagehand, page, sessionUrl }) => {
    const capture = makeStepCapture(page, debugDir);
    // Clears any challenge before continuing. Two distinct kinds:
    //   1. reCAPTCHA ("I'm not a robot") — Browser Use's in-browser bypass first,
    //      then CapSolver, then a human-in-the-loop fallback (ensureCaptchaSolved).
    //   2. The "Confirm you're human" DISTORTED IMAGE-CODE card — read with the
    //      LLM (Gemini vision) and submitted (solveImageCaptchaIfPresent).
    // Each is a fast no-op when its challenge isn't on screen, so calling both
    // everywhere we settle is safe.
    const settleCaptcha = async () => {
      // FIRST click through IG's "Confirm you're human to use your account"
      // INTRO gate (just a Continue button, no challenge widget) — otherwise the
      // solvers below see nothing to do and the run stalls on the intro (the
      // "Continue never gets clicked" bug). Clicking Continue reveals the real
      // reCAPTCHA / image-code, which the solvers then clear.
      const passedGate = await passConfirmHumanGate({ page, log, capture });
      let hadRecaptcha = await ensureCaptchaSolved({ page, sessionUrl, log });
      let hadImageCode = await solveImageCaptchaIfPresent({ stagehand, page, log, capture });
      // If clicking through the gate surfaced a fresh challenge (or a second
      // gate) after that first pass, run one more pass to clear it.
      if (
        passedGate &&
        ((await confirmHumanGatePresent(page)) ||
          (await captchaPresent(page)) ||
          (await imageCaptchaPresent(page)))
      ) {
        await passConfirmHumanGate({ page, log, capture });
        hadRecaptcha = (await ensureCaptchaSolved({ page, sessionUrl, log })) || hadRecaptcha;
        hadImageCode =
          (await solveImageCaptchaIfPresent({ stagehand, page, log, capture })) || hadImageCode;
      }
      return passedGate || hadRecaptcha || hadImageCode;
    };

    // Realistic entry: homepage → (read/scroll/cursor) → click "Sign up" → form,
    // instead of a cold, referrer-less deep-link to the signup endpoint.
    await warmUpEntry({ page, log, capture, settleCaptcha });
    await capture("signup-page-loaded");
    // IG can gate the signup page itself behind a challenge.
    await settleCaptcha();

    // Wait for the signup form's email/mobile field to actually render (poll;
    // IG inputs no longer carry name/aria-label, so resolve it by type or by its
    // wrapping <label> text).
    for (let i = 0; i < 20; i++) {
      const ready =
        (await firstVisibleSelector(page, ['input[type="email"]', 'input[type="text"]'])) ||
        (await tagInputByLabel(page, { keywords: ["mobile number or email", "email"], key: "email" }));
      if (ready) break;
      await sleep(500);
    }

    // Cookie banners block IG in some regions; dismiss (no-op if not present).
    await dismissCookieBanner(page);

    // Register genuine human engagement BEFORE the first keystroke: read the
    // form, drift the cursor onto it, and a small scroll. Instantly typing the
    // millisecond a form paints is a classic automation tell.
    await readPause();
    await idleMouseDrift(page);
    await hoverSafely(page, ['input[type="email"]', 'input[type="text"]', "h2", "h1"]);
    await gentleScroll(page, log);

    // Fill the four signup fields. IG's inputs lost their name/aria-label, so we
    // pass label keywords as the durable fallback and VERIFY each value took
    // (the empty-email field is what silently froze the whole flow). Keywords are
    // specific so e.g. "username" never matches the email/name labels.
    const emailFilled = await fastFill(stagehand, page, {
      selectors: ['input[name="emailOrPhone"]', 'input[name="email"]', 'input[type="email"]'],
      labelKeywords: ["mobile number or email", "email", "mobile number"],
      value: email,
      describe: "email or mobile number field",
      key: "email",
      log,
    });
    await thinkTime(280, 720);
    await fastFill(stagehand, page, {
      selectors: ['input[name="fullName"]', 'input[aria-label*="Full" i]'],
      labelKeywords: ["full name"],
      value: fullName,
      describe: "full name field",
      key: "fullname",
      log,
    });
    await thinkTime(280, 720);
    await fastFill(stagehand, page, {
      selectors: ['input[name="username"]', 'input[aria-label*="user" i]', 'input[type="search"]'],
      labelKeywords: ["username"],
      value: username,
      describe: "username field",
      key: "username",
      log,
    });
    await thinkTime(280, 720);
    await fastFill(stagehand, page, {
      selectors: ['input[name="password"]', 'input[type="password"]'],
      labelKeywords: ["password"],
      value: password,
      describe: "password field",
      key: "password",
      log,
    });
    if (!emailFilled) log.warn("Email field did not confirm a value after filling");
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

    // GUARD: IG silently refuses to advance from the signup form when the
    // email/mobile field is empty — that exact empty field (its selector had
    // changed) is what froze a prior run for ~150s on a form that never moved.
    // Confirm the field holds our email right before submitting; refill once if a
    // re-render cleared it, and bail fast with a clear reason if we truly cannot
    // populate it (rather than marching into an unwinnable email-code wait).
    const ensureEmailFilled = async () => {
      const sel =
        (await firstVisibleSelector(page, ['input[type="email"]'])) ||
        (await tagInputByLabel(page, {
          keywords: ["mobile number or email", "email", "mobile number"],
          key: "email",
        }));
      const current = await readInputValue(page, sel);
      if (current && current.trim() === String(email).trim()) return true;
      log.warn(`Email field not populated before submit (got "${current || ""}") — refilling`);
      return fastFill(stagehand, page, {
        selectors: ['input[name="emailOrPhone"]', 'input[name="email"]', 'input[type="email"]'],
        labelKeywords: ["mobile number or email", "email", "mobile number"],
        value: email,
        describe: "email or mobile number field",
        key: "email",
        log,
      });
    };

    if (!(await ensureEmailFilled())) {
      await capture("email-fill-failed");
      log.warn(
        "Could not enter the email into Instagram's signup form — aborting run early (IG will not advance with an empty email)"
      );
      return {
        loggedIn: false,
        blockedByEmail: true,
        email,
        sessionUrl,
        note: `Could not type the email into Instagram's signup form (the field selector likely changed). Inspect/solve live at ${sessionUrl || "the Browser Use dashboard"}.`,
      };
    }

    // A human "review the form" beat — drift the cursor to the submit button and
    // pause to "re-read" — before committing, like a real signup (not an instant
    // machine click the moment the last field is filled).
    await hoverSafely(page, ['button[type="submit"]']);
    await readPause(800, 1800);
    await submit();
    await sleep(randomInt(2400, 3600));
    await capture("after-submit");

    // If IG rejected the EMAIL ADDRESS up front (disposable domain on Meta's
    // blocklist), no code will ever be sent — swap in a fresh address and
    // resubmit instead of marching on to wait for an email that never comes.
    // Best-effort and bounded; a normal (accepted) email never matches, so the
    // happy path is unaffected.
    let emailRotations = 0;
    while ((await emailAddressRejected(page)) && emailRotations < 2) {
      emailRotations += 1;
      log.warn(`Instagram rejected email "${email}" — rotating to a fresh address (${emailRotations}/2)`);
      await capture(`email-address-rejected-${emailRotations}`);
      try {
        const fresh = await generateEmail({ seed: username });
        if (fresh && fresh !== email) email = fresh;
      } catch (e) {
        log.warn("Could not provision a replacement email:", e?.message);
        break;
      }
      await fastFill(stagehand, page, {
        selectors: ['input[name="emailOrPhone"]', 'input[name="email"]', 'input[type="email"]'],
        labelKeywords: ["mobile number or email", "email", "mobile number"],
        value: email,
        describe: "email or mobile number field",
        key: "email",
        log,
      });
      // DOB can clear when the form re-renders; re-fill if it's showing again.
      if (await birthdayPresent(page)) {
        await fillBirthday(stagehand, page, dob, log);
        await waitForBirthdaySet(page, dob, { timeoutMs: 4000 });
      }
      await sleep(300);
      await submit();
      await sleep(2500);
      await capture(`after-email-rotation-${emailRotations}`);
    }

    // If IG rejected the USERNAME as already taken, rotate to a brand-new handle
    // and resubmit. buildUsername is time-seeded so each retry is genuinely new
    // (no reusing a registered handle), and a small bounded loop avoids spinning
    // forever if something else is also wrong. A normal (available) username
    // never matches, so the happy path is unaffected.
    let usernameRotations = 0;
    while ((await usernameRejected(page)) && usernameRotations < 3) {
      usernameRotations += 1;
      const fresh = freshUsername(persona);
      log.warn(
        `Instagram rejected username "${username}" as taken — trying "${fresh}" (${usernameRotations}/3)`
      );
      username = fresh;
      await capture(`username-rejected-${usernameRotations}`);
      await fastFill(stagehand, page, {
        selectors: ['input[name="username"]', 'input[aria-label*="user" i]', 'input[type="search"]'],
        labelKeywords: ["username"],
        value: username,
        describe: "username field",
        key: "username",
        log,
      });
      // DOB can clear when the form re-renders; re-fill if it's showing again.
      if (await birthdayPresent(page)) {
        await fillBirthday(stagehand, page, dob, log);
        await waitForBirthdaySet(page, dob, { timeoutMs: 4000 });
      }
      await sleep(300);
      await submit();
      await sleep(2500);
      await capture(`after-username-rotation-${usernameRotations}`);
    }

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
    // you" reCAPTCHA. Settle it before we look for the next step, otherwise our
    // extract()/clicks race the solver.
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
      // A beat to "read" the new screen before operating its controls.
      await readPause();
      await idleMouseDrift(page);
      const filled = await fillBirthday(stagehand, page, dob, log);
      // Don't advance until DOB is confirmed; otherwise we'd submit an empty
      // form and IG keeps us on the same step.
      if (!filled) await waitForBirthdaySet(page, dob, { timeoutMs: 6000 });
      await capture("birthday-step-filled");
      await sleep(400);

      await hoverSafely(page, ['button[type="submit"]']);
      await thinkTime(500, 1200);
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
    // Poll a bit longer since the page transitions async after the prior step /
    // CAPTCHA clears (a too-short window made us skip a step IG actually showed).
    let needsEmail = false;
    for (let i = 0; i < 12 && !needsEmail; i++) {
      needsEmail = await emailCodeStepPresent(page);
      if (needsEmail) break;
      // A late "Confirm you're human" image-code card can appear here (between
      // the birthday and email steps) — read + submit it with the LLM, then
      // keep polling for the email step.
      if (await imageCaptchaPresent(page)) {
        await solveImageCaptchaIfPresent({ stagehand, page, log, capture });
      }
      await sleep(1000);
    }

    if (needsEmail) {
      log.info("Email confirmation required");
      await capture("email-code-requested");
      // A person reads the "we sent a code to…" screen before entering anything.
      await readPause();
      await idleMouseDrift(page);

      const emailStepAt = Date.now();
      // The first valid code may have been sent at any point during this signup
      // (IG sometimes sends it before a long CAPTCHA), so look back a few minutes
      // for it. After a rejection we require a code strictly newer than the one
      // we just tried, so a superseded/expired code is never reused.
      let minReceivedAt = emailStepAt - 5 * 60 * 1000;
      let confirmed = false;
      let lastErr = null;
      // Count rejections of codes we KNOW are freshly-issued and correct. Two of
      // those in a row means IG isn't rejecting a stale code — it has integrity-
      // flagged this whole signup session and will reject every valid code. There
      // is nothing more to do in this browser/IP, so we bail fast (rather than
      // dragging through more resends + long waits) and let the loop start a fresh
      // session, which is the only thing that can actually change the outcome.
      let integrityRejections = 0;
      let integrityFlagged = false;

      for (let attempt = 1; attempt <= 3 && !confirmed; attempt++) {
        let hit;
        try {
          hit = await waitForEmailCode({
            influencerId,
            to: email,
            receivedAfter: minReceivedAt,
            timeoutMs: attempt === 1 ? 150000 : 45000,
          });
        } catch (err) {
          lastErr = err;
          log.warn(`No email code retrieved (attempt ${attempt}/3)`, err?.message);
          break;
        }

        const { code, receivedAt } = hit;
        log.info(`Email code received (attempt ${attempt}/3)`, code);
        // A real person never submits the code the instant it lands: they tab to
        // their mail app, read a six-digit code, and tab back — several seconds.
        // We poll IMAP aggressively, so without this the code is often entered
        // <2s after IG issued it, a strong bot signal at the most-scrutinized
        // step. Dwell a human beat (with idle cursor motion) before typing.
        await idleMouseDrift(page);
        await sleep(randomInt(5000, 11000));
        await idleMouseDrift(page);
        await enterEmailCode(stagehand, page, code, log);
        await sleep(500);
        await pressButton(stagehand, page, {
          texts: ["Continue", "Next", "Confirm", "Submit"],
          cssFallback: ['button[type="submit"]'],
          act: "click the button to submit the email confirmation code",
          log,
        });
        await sleep(2000);
        await settleCaptcha();

        // Give the page a few seconds to navigate off the email step before
        // concluding anything (avoids a false "rejected" on a slow transition).
        for (let i = 0; i < 6 && !confirmed; i++) {
          if (!(await emailCodeStepPresent(page))) confirmed = true;
          else await sleep(1000);
        }
        if (confirmed) break;

        // Still on the email step. If IG shows an explicit invalid/expired
        // error, the code is dead — only a NEWER one can work, so bump the
        // cutoff and ask IG to resend. If there's no error, the submit likely
        // didn't take; retry the same (still-valid) code without bumping.
        const rejected = await emailCodeRejected(page);
        log.warn(`Email code not accepted (attempt ${attempt}/3)`, { rejected });
        await capture(`email-code-rejected-${attempt}`);
        if (rejected) {
          // Meta sometimes SOFT-rejects the first submission of an objectively
          // correct, freshly-issued code (a borderline-trust nudge) yet accepts
          // the very SAME code on a calm second try. Before burning a resend
          // (and ~90s waiting for a new email that may never come), clear the
          // field, dwell a human beat, and re-enter the same code once.
          if (attempt === 1 && code) {
            log.info("Re-entering the same fresh code once after a human pause (soft-reject retry)");
            await idleMouseDrift(page);
            await sleep(randomInt(3500, 7000));
            await enterEmailCode(stagehand, page, code, log);
            await sleep(500);
            await pressButton(stagehand, page, {
              texts: ["Continue", "Next", "Confirm", "Submit"],
              cssFallback: ['button[type="submit"]'],
              log,
            });
            await sleep(2500);
            await settleCaptcha();
            for (let i = 0; i < 6 && !confirmed; i++) {
              if (!(await emailCodeStepPresent(page))) confirmed = true;
              else await sleep(1000);
            }
            if (confirmed) break;
          }
          // A freshly-issued, correctly-entered code was rejected. Track it: two
          // such rejections ⇒ the session is integrity-flagged, so stop burning
          // resends/long waits and abandon this session for a fresh one.
          integrityRejections += 1;
          if (integrityRejections >= 2) {
            integrityFlagged = true;
            log.warn(
              "Instagram rejected 2 freshly-issued, correct codes — this signup session is integrity-flagged. Abandoning it so the loop can retry on a fresh IP/session (the only thing that can change the verdict)."
            );
            break;
          }
          // Still rejected — the code is genuinely dead; only a strictly-newer
          // one can work. Bump the cutoff and actually trigger a resend.
          minReceivedAt = (receivedAt || Date.now()) + 1000;
          const resent = await requestNewEmailCode(page);
          if (resent) {
            log.info("Requested a fresh confirmation code (resend)");
            await sleep(4000);
            await settleCaptcha();
          } else {
            log.warn("Could not trigger a confirmation-code resend");
          }
        }
      }

      await capture(confirmed ? "after-email-code" : "email-code-not-accepted");
      if (!confirmed) {
        const reason = integrityFlagged
          ? "Instagram integrity-flagged the session and rejected correct, freshly-issued codes as 'invalid/expired' (not a code problem — the signup itself was blocked). The most effective fixes are a higher-trust IP (clean residential/mobile proxy, BROWSER_USE_PROXY_COUNTRY/customProxy) and a fresh, reputable email base"
          : lastErr
            ? `no code received (${lastErr.message})`
            : "Instagram kept rejecting the code as invalid/expired";
        // A timeout with a disposable provider almost always means IG delivered
        // nothing because the domain is on Meta's blocklist — point at the fix.
        const hint =
          lastErr && config.verification.emailProvider === "maildotm"
            ? " Likely cause: Instagram blocks disposable-mail domains, so it never sent the code. Switch to a real inbox (EMAIL_PROVIDER=imap with EMAIL_ALIAS_BASE/EMAIL_CATCHALL_DOMAIN) and verify delivery with `npm run probe:email`."
            : "";
        return {
          loggedIn: false,
          blockedByEmail: true,
          email,
          sessionUrl,
          note: `Stuck on Instagram's email confirmation: ${reason}.${hint} Watch/solve live at ${sessionUrl || "the Browser Use dashboard"}, or submit a code manually from the dashboard.`,
        };
      }
    } else {
      log.info("No email confirmation step detected");
    }

    // A challenge can appear at the very end (e.g. right after the birthday step
    // when there's no email step) — give it one more solve pass before we give
    // up, instead of immediately reporting "blocked".
    await settleCaptcha();

    // If a CAPTCHA is STILL on screen at the end, that's the blocker — surface
    // it explicitly so the account record says *why* (rather than a vague
    // "not logged in"). Browser Use bypasses most CAPTCHAs in-browser; when IG's
    // reCAPTCHA Enterprise slips through, it needs either a CapSolver key
    // (CAPSOLVER_API_KEY), a residential proxy (BROWSER_USE_PROXY_COUNTRY), or a
    // human solve via the live session.
    if (await captchaPresent(page)) {
      log.warn("Finished with a CAPTCHA still blocking — CapSolver key / residential proxy / manual solve required", { sessionUrl });
      await capture("blocked-by-captcha");
      const remedy = capsolver.isConfigured()
        ? "CapSolver couldn't clear it this run"
        : "set CAPSOLVER_API_KEY to auto-solve it";
      return {
        loggedIn: false,
        blockedByCaptcha: true,
        sessionUrl,
        note: `Blocked by Instagram CAPTCHA (${remedy}). Solve it live at ${sessionUrl || "the Browser Use dashboard"}, or route through a residential proxy via BROWSER_USE_PROXY_COUNTRY.`,
      };
    }

    // Same for the distorted image-code "Confirm you're human" challenge. It has
    // no reCAPTCHA iframe (so captchaPresent above misses it) and lives on a
    // /challenge/ URL, so surface it explicitly here — BEFORE the URL check below
    // mislabels it as a generic suspension — when the LLM couldn't read it.
    if (await imageCaptchaPresent(page)) {
      log.warn("Finished with the image-code 'Confirm you're human' challenge still blocking", { sessionUrl });
      await capture("blocked-by-image-captcha");
      const remedy =
        gemini.isConfigured() || capsolver.isConfigured()
          ? "the LLM (Gemini) and CapSolver ImageToText OCR both couldn't read the distorted code this run"
          : "set GEMINI_API_KEY and/or CAPSOLVER_API_KEY so the code can be read automatically";
      return {
        loggedIn: false,
        blockedByCaptcha: true,
        sessionUrl,
        note: `Blocked by Instagram's "Confirm you're human" image-code challenge (${remedy}). Solve it live at ${sessionUrl || "the Browser Use dashboard"}.`,
      };
    }

    // GROUND TRUTH over the LLM: if IG parked us on a suspension / challenge /
    // disabled URL, the account is NOT a clean login no matter how the page
    // "reads". The a11y-snapshot extract() has literally called the
    // /accounts/suspended/ "Confirm you're human to use your account" page
    // "logged in requiring verification" — a false positive that would record a
    // suspended account as usable. Treat the URL as authoritative.
    let finalUrl = "";
    try {
      finalUrl = page.url();
    } catch {
      /* page may be gone */
    }
    if (/\/accounts\/(suspended|disabled)\/|\/challenge\/|\/integrity\//i.test(finalUrl)) {
      log.warn("Finished on an Instagram restriction page — account created but gated, not a clean login", {
        finalUrl,
        sessionUrl,
      });
      await capture("account-restricted");
      const kind = /suspended/i.test(finalUrl)
        ? "suspended"
        : /disabled/i.test(finalUrl)
          ? "disabled"
          : "challenged";
      return {
        loggedIn: false,
        blockedBySuspension: true,
        sessionUrl,
        note: `Instagram created the account but parked it on its "Confirm you're human to use your account" ${kind} check. The flow clicked Continue and attempted the reCAPTCHA / image-code, but it wasn't cleared this run. Fresh automated signups are routinely gated pending phone verification — a usable account from here needs SMS/phone verification, a higher-trust residential/mobile proxy, and/or account warming. URL: ${finalUrl}`,
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
  // persist a browser profile here (avoids feeding a bad context id back in).
  return {
    username,
    password,
    email,
    fullName,
    birthday: `${dob.year}-${String(dob.monthNumber).padStart(2, "0")}-${String(dob.day).padStart(2, "0")}`,
    loggedIn: result.loggedIn,
    blockedByCaptcha: Boolean(result.blockedByCaptcha),
    blockedByEmail: Boolean(result.blockedByEmail),
    blockedBySuspension: Boolean(result.blockedBySuspension),
    note: result.note,
    session: {},
  };
}
