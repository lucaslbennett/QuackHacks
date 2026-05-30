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

// Auto-creates a fresh Instagram account via the signup flow, clearing email
// and SMS verification through the pluggable verification service.
export async function createInstagramAccount({ influencerId, persona, email, phone }) {
  const fullName = persona?.displayName || "Creator";
  const username = buildUsername(persona?.handleSuggestions?.[0] || persona?.displayName);
  const password = randomPassword();

  log.info("Creating IG account", { username, email, phone });

  const result = await withStagehand(async ({ stagehand, page }) => {
    await page.goto("https://www.instagram.com/accounts/emailsignup/", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await sleep(3000);
    await stagehand.act("accept cookies if a cookie banner is shown").catch(() => {});

    await stagehand.act(`type "${email}" into the email or phone field`);
    await sleep(800);
    await stagehand.act(`type "${fullName}" into the full name field`);
    await sleep(800);
    await stagehand.act(`type "${username}" into the username field`);
    await sleep(800);
    await stagehand.act(`type "${password}" into the password field`);
    await sleep(800);
    await stagehand.act("click the sign up button to submit the form");
    await sleep(3000);

    // Birthday step (Instagram asks for DOB).
    await stagehand
      .act("if a birthday selection appears, set the month, day and a year that makes the user 27 years old, then continue")
      .catch(() => {});
    await sleep(2500);

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
      await stagehand.act(`type "${code}" into the confirmation code field`);
      await sleep(1200);
      await stagehand.act("click next or confirm to submit the email code");
      await sleep(3000);
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
  });

  // Posting re-authenticates with the stored credentials, so we don't need to
  // persist a Browserbase context here (avoids feeding a bad context id back in).
  return {
    username,
    password,
    email,
    phone,
    fullName,
    loggedIn: result.loggedIn,
    note: result.note,
    session: {},
  };
}
