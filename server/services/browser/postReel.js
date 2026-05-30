import { z } from "zod";
import { withStagehand } from "./stagehand.js";
import { sleep } from "../../lib/util.js";
import { createLogger } from "../../lib/logger.js";

const log = createLogger("post");

async function ensureLoggedIn(stagehand, page, { username, password }) {
  await page.goto("https://www.instagram.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
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

// Uploads a video reel with caption to the logged-in account. Returns
// { posted, url, shortcode }.
export async function postReel({ account, videoPath, caption, hashtags = [] }) {
  const fullCaption = [caption, hashtags.map((h) => `#${h}`).join(" ")].filter(Boolean).join("\n\n");
  log.info("Posting reel for", account.username);

  return withStagehand(
    async ({ stagehand, page }) => {
      await ensureLoggedIn(stagehand, page, account);

      await stagehand.act("click the create / new post button");
      await sleep(2500);
      await stagehand.act("choose to create a reel or post if asked").catch(() => {});
      await sleep(1500);

      // Use the file chooser to upload our rendered video.
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 15000 }).catch(() => null),
        stagehand.act("click the select from computer / upload button").catch(() => {}),
      ]);
      if (chooser) {
        await chooser.setFiles(videoPath);
      } else {
        const input = await page.$('input[type="file"]');
        if (input) await input.setInputFiles(videoPath);
        else throw new Error("Could not find a file input to upload the video");
      }
      await sleep(6000);

      // Step through crop -> filters -> caption.
      await stagehand.act("click next to proceed past the crop step").catch(() => {});
      await sleep(2000);
      await stagehand.act("click next to proceed past the edit/filter step").catch(() => {});
      await sleep(2000);

      await stagehand.act(`type the following into the caption field: ${fullCaption.slice(0, 2100)}`);
      await sleep(1500);
      await stagehand.act("click the share button to publish the post");
      await sleep(8000);

      const result = await stagehand
        .extract(
          "Was the post shared successfully? If a link to the new post is visible, provide it.",
          z.object({ shared: z.boolean(), url: z.string().optional() })
        )
        .catch(() => ({ shared: true }));

      const url = result?.url || null;
      const shortcode = url?.match(/\/(?:p|reel)\/([^/?#]+)/)?.[1] || null;
      log.info("Reel post result", result?.shared, url || "");
      return { posted: Boolean(result?.shared), url, shortcode };
    },
    { sessionData: account.session }
  );
}
