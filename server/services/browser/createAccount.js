import { z } from "zod";
import { withStagehand } from "./stagehand.js";
import { waitForEmailCode, waitForSmsCode } from "../verification.js";
import { sleep, randomInt } from "../../lib/util.js";
import { createLogger } from "../../lib/logger.js";

const log = createLogger("signup");

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
// known, stable Instagram signup fields we drive Playwright-style locators
// directly (no LLM), and only fall back to act() if the selector misses.

async function firstVisible(page, selectors) {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.count()) {
        if (await loc.isVisible().catch(() => false)) return loc;
      }
    } catch {
      /* try next selector */
    }
  }
  return null;
}

// Types into a field via direct locator; falls back to act() if not found.
async function fastFill(stagehand, page, { selectors, value, describe, log }) {
  const loc = await firstVisible(page, selectors);
  if (loc) {
    try {
      await loc.fill(value);
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

// Selects an <option> directly, trying each candidate value (label or value)
// in order; falls back to act() if the locator or all candidates miss.
async function fastSelect(stagehand, page, { selectors, values, describe, actText, log }) {
  const loc = await firstVisible(page, selectors);
  if (loc) {
    for (const v of values) {
      try {
        const set = await loc.selectOption(v);
        if (set && set.length) return true;
      } catch {
        /* try next candidate value */
      }
    }
    log?.warn(`fastSelect direct missed for ${describe}; using act fallback`);
  }
  await stagehand.act(actText).catch((e) => {
    log?.warn(`fastSelect act fallback failed for ${describe}`, e?.message);
  });
  return false;
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

// Drives Instagram's three birthday <select> dropdowns (Month/Day/Year).
// IG uses native selects with title="Month:"/"Day:"/"Year:", so we set them
// directly (no LLM) by both label and value, falling back to act() per-field.
async function fillBirthday(stagehand, page, dob, log) {
  await fastSelect(stagehand, page, {
    selectors: ['select[title="Month:"]', 'select[aria-label="Month:"]', "select[title*='Month' i]"],
    // Try label name first, then 1-based numeric value IG sometimes uses.
    values: [dob.monthName, String(dob.monthNumber)],
    describe: "month",
    actText: `select "${dob.monthName}" in the month birthday dropdown`,
    log,
  });
  await fastSelect(stagehand, page, {
    selectors: ['select[title="Day:"]', 'select[aria-label="Day:"]', "select[title*='Day' i]"],
    values: [String(dob.day)],
    describe: "day",
    actText: `select "${dob.day}" in the day birthday dropdown`,
    log,
  });
  await fastSelect(stagehand, page, {
    selectors: ['select[title="Year:"]', 'select[aria-label="Year:"]', "select[title*='Year' i]"],
    values: [String(dob.year)],
    describe: "year",
    actText: `select "${dob.year}" in the year birthday dropdown`,
    log,
  });

  log.info("Birthday set", { month: dob.monthName, day: dob.day, year: dob.year });
}

// Auto-creates a fresh Instagram account via the signup flow, clearing email
// and SMS verification through the pluggable verification service.
export async function createInstagramAccount({ influencerId, persona, email, phone, onSession }) {
  const fullName = persona?.displayName || "Creator";
  const username = buildUsername(persona?.handleSuggestions?.[0] || persona?.displayName);
  const password = randomPassword();
  const dob = pickBirthday();

  log.info("Creating IG account", { username, email, phone, dob });

  const result = await withStagehand(async ({ stagehand, page, waitForCaptcha }) => {
    // Browserbase solves CAPTCHAs in the background; this barrier blocks until
    // any in-progress solve finishes so we never act on a half-solved page.
    const settleCaptcha = (opts) => waitForCaptcha?.(opts) ?? Promise.resolve(false);

    await page.goto("https://www.instagram.com/accounts/emailsignup/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
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

    // Cookie banners block IG in some regions; dismiss via direct selector
    // first (fast), only escalating to the LLM if that fails.
    const cookieBtn = await firstVisible(page, [
      'button[class*="cookie" i]',
      'button:has-text("Allow")',
      'button:has-text("Accept")',
    ]);
    if (cookieBtn) await cookieBtn.click().catch(() => {});

    // Fill the four signup fields via direct locators (no LLM round-trips).
    await fastFill(stagehand, page, {
      selectors: ['input[name="emailOrPhone"]', 'input[name="email"]', 'input[type="email"]'],
      value: email,
      describe: "email or phone field",
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

    const submitBtn = await firstVisible(page, [
      'button[type="submit"]',
      'button:has-text("Sign up")',
      'button:has-text("Sign Up")',
    ]);
    if (submitBtn) await submitBtn.click().catch(() => stagehand.act("click the sign up button to submit the form"));
    else await stagehand.act("click the sign up button to submit the form");
    await sleep(2500);

    // After submitting the form IG most often shows the "Help us confirm it's
    // you" reCAPTCHA. Wait for Browserbase to solve it before we look for the
    // next step, otherwise our extract()/clicks race the solver.
    const solvedAtSignup = await settleCaptcha();
    if (solvedAtSignup) {
      // The page navigates once the challenge clears; give the DOM a beat and
      // click any "Next"/continue the challenge dialog leaves behind.
      await sleep(1500);
      const continueBtn = await firstVisible(page, [
        'button:has-text("Next")',
        'button:has-text("Continue")',
        'button[type="submit"]',
      ]);
      if (continueBtn) await continueBtn.click().catch(() => {});
      await sleep(1500);
    }

    // Birthday step (Instagram asks for DOB). Three separate Month/Day/Year
    // dropdowns, so fill each explicitly with a concrete date, then continue.
    const birthdaySelect = await firstVisible(page, [
      'select[title="Month:"]',
      'select[title*="Month" i]',
      'select[aria-label="Month:"]',
    ]);
    const needsBirthday = Boolean(birthdaySelect)
      ? true
      : await stagehand
          .extract(
            "Is the page asking for the user's birthday / date of birth (month, day, year selectors)?",
            z.object({ asking: z.boolean() })
          )
          .then((r) => r?.asking)
          .catch(() => false);

    if (needsBirthday) {
      log.info("Birthday step detected");
      await fillBirthday(stagehand, page, dob, log);
      await sleep(500);
      const nextBtn = await firstVisible(page, [
        'button:has-text("Next")',
        'button[type="button"]:has-text("Next")',
      ]);
      if (nextBtn) await nextBtn.click().catch(() => {});
      else await stagehand.act("click the Next button to confirm the birthday").catch(() => {});
      await sleep(2000);
      await settleCaptcha();
    }

    // Email confirmation code step.
    const needsEmail = await stagehand
      .extract(
        "Is the page currently asking for an email confirmation code?",
        z.object({ asking: z.boolean() })
      )
      .then((r) => r?.asking)
      .catch(() => false);

    if (needsEmail) {
      log.info("Email confirmation required");
      const code = await waitForEmailCode({ influencerId, to: email });
      await fastFill(stagehand, page, {
        selectors: ['input[name="email_confirmation_code"]', 'input[name="confirmationCode"]', 'input[autocomplete="one-time-code"]', 'input[type="tel"]'],
        value: code,
        describe: "confirmation code field",
        log,
      });
      await sleep(600);
      const confirmBtn = await firstVisible(page, ['button:has-text("Next")', 'button:has-text("Confirm")', 'button[type="submit"]']);
      if (confirmBtn) await confirmBtn.click().catch(() => {});
      else await stagehand.act("click next or confirm to submit the email code");
      await sleep(2500);
      await settleCaptcha();
    }

    // Possible phone verification step.
    const needsPhone = await stagehand
      .extract(
        "Is the page asking to add or confirm a phone number / SMS code?",
        z.object({ asking: z.boolean() })
      )
      .then((r) => r?.asking)
      .catch(() => false);

    if (needsPhone && phone) {
      log.info("Phone confirmation required");
      await stagehand.act(`type "${phone}" into the phone number field`).catch(() => {});
      await stagehand.act("click the button to send the SMS code").catch(() => {});
      const code = await waitForSmsCode({ influencerId, to: phone });
      await stagehand.act(`type "${code}" into the SMS confirmation code field`);
      await sleep(1200);
      await stagehand.act("click next or confirm to submit the SMS code");
      await sleep(3000);
    }

    const status = await stagehand
      .extract(
        "Are we now logged in to an Instagram account (home feed, profile, or 'turn on notifications' prompt visible)?",
        z.object({ loggedIn: z.boolean(), note: z.string().optional() })
      )
      .catch(() => ({ loggedIn: false }));

    return { loggedIn: Boolean(status?.loggedIn), note: status?.note };
  }, { onSession });

  // Posting re-authenticates with the stored credentials, so we don't need to
  // persist a Browserbase context here (avoids feeding a bad context id back in).
  return {
    username,
    password,
    email,
    phone,
    fullName,
    birthday: `${dob.year}-${String(dob.monthNumber).padStart(2, "0")}-${String(dob.day).padStart(2, "0")}`,
    loggedIn: result.loggedIn,
    note: result.note,
    session: {},
  };
}
