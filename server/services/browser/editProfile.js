import { z } from "zod";
import { withStagehand } from "./stagehand.js";
import { sleep } from "../../lib/util.js";
import { createLogger } from "../../lib/logger.js";

const log = createLogger("edit-profile");

// Postiz can publish posts and read analytics, but it cannot edit an Instagram
// account's PROFILE (display name, bio, profile photo). That's a browser-only
// task, so we drive it through the same Browser Use + Stagehand stack the rest
// of the IG automation uses. Requires stored login credentials (an account
// created via the auto-spawn flow) — OAuth/Postiz-linked accounts can't be
// edited this way because we never hold their password.

async function ensureLoggedIn(stagehand, page, { username, password }) {
  await page.goto("https://www.instagram.com/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await sleep(3000);
  await stagehand.act("dismiss any cookie banner").catch(() => {});

  const state = await stagehand
    .extract(
      "Is the user already logged in (feed visible) or is a login form shown?",
      z.object({ loggedIn: z.boolean() })
    )
    .catch(() => ({ loggedIn: false }));

  if (state?.loggedIn) return true;

  log.info("Logging in as", username);
  await page.goto("https://www.instagram.com/accounts/login/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await sleep(2500);
  await stagehand.act(`type "${username}" into the username field`);
  await sleep(600);
  await stagehand.act(`type "${password}" into the password field`);
  await sleep(600);
  await stagehand.act("click the log in button");
  await sleep(5000);
  await stagehand.act("if asked to save login info, click not now").catch(() => {});
  await stagehand.act("if asked to turn on notifications, click not now").catch(() => {});
  return true;
}

// Updates the logged-in account's profile. Any of name / bio / profileImagePath
// may be omitted; only the provided fields are changed. The username is left
// untouched on purpose (changing it breaks every existing link to the profile).
// Returns { updated, name, bio, photo }.
export async function updateInstagramProfile({ account, name, bio, profileImagePath }) {
  log.info("Updating IG profile for", account.username, {
    name: Boolean(name),
    bio: Boolean(bio),
    photo: Boolean(profileImagePath),
  });

  return withStagehand(
    async ({ stagehand, page }) => {
      await ensureLoggedIn(stagehand, page, account);

      await page.goto("https://www.instagram.com/accounts/edit/", {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await sleep(3500);
      await stagehand.act("dismiss any dialog or cookie banner blocking the form").catch(() => {});

      // Profile photo (optional) — opens a file chooser we feed the new portrait.
      if (profileImagePath) {
        try {
          const [chooser] = await Promise.all([
            page.waitForEvent("filechooser", { timeout: 12000 }).catch(() => null),
            stagehand
              .act("click the change profile photo button")
              .catch(() => {}),
          ]);
          if (chooser) {
            await chooser.setFiles(profileImagePath);
            await sleep(3500);
            await stagehand
              .act("if a menu or confirmation appears, choose to upload/confirm the new photo")
              .catch(() => {});
            await sleep(2500);
          } else {
            const input = await page.$('input[type="file"]');
            if (input) {
              await input.setInputFiles(profileImagePath);
              await sleep(3500);
            } else {
              log.warn("no file chooser found for profile photo");
            }
          }
        } catch (err) {
          log.warn("profile photo update failed:", err.message);
        }
      }

      // Display name.
      if (name) {
        await stagehand
          .act(`clear the Name text field and type "${String(name).slice(0, 64)}"`)
          .catch(() => {});
        await sleep(700);
      }

      // Bio (Instagram caps bios at 150 chars).
      if (bio) {
        await stagehand
          .act(`clear the Bio field and type the following bio text: ${String(bio).slice(0, 150)}`)
          .catch(() => {});
        await sleep(700);
      }

      await stagehand.act("click the Submit button to save the profile changes");
      await sleep(4000);

      const result = await stagehand
        .extract(
          "Did the profile changes save successfully (a confirmation appeared or " +
            "the form is no longer showing unsaved edits)?",
          z.object({ saved: z.boolean() })
        )
        .catch(() => ({ saved: true }));

      log.info("IG profile update result", result?.saved);
      return {
        updated: Boolean(result?.saved),
        name: name || null,
        bio: bio || null,
        photo: Boolean(profileImagePath),
      };
    },
    { sessionData: account.session }
  );
}
