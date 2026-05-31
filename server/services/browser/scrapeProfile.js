import { z } from "zod";
import { withStagehand } from "./stagehand.js";
import { sleep } from "../../lib/util.js";
import { createLogger } from "../../lib/logger.js";

const log = createLogger("scrape");

function normalizeUrl(input) {
  let handle = input.trim();
  if (handle.startsWith("http")) return { url: handle, handle: extractHandle(handle) };
  handle = handle.replace(/^@/, "");
  return { url: `https://www.instagram.com/${handle}/`, handle };
}

function extractHandle(url) {
  const m = url.match(/instagram\.com\/([^/?#]+)/i);
  return m ? m[1] : null;
}

// Scrapes a public Instagram profile for the data needed to clone its style:
// bio, follower stats, and recent post captions/themes.
export async function scrapeInstagramProfile(input) {
  const { url, handle } = normalizeUrl(input);
  log.info("Scraping profile", url);

  return withStagehand(async ({ stagehand, page }) => {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(3000);

    // Dismiss login/cookie modals that block the public profile view.
    await stagehand
      .act("close any login popup or cookie banner if present")
      .catch(() => {});
    await sleep(1500);

    const profile = await stagehand.extract(
      "Extract this Instagram profile's public information: full name, bio text, " +
        "follower count, following count, number of posts, and whether it is verified.",
      z.object({
        fullName: z.string().optional(),
        bio: z.string().optional(),
        followers: z.string().optional(),
        following: z.string().optional(),
        postsCount: z.string().optional(),
        verified: z.boolean().optional(),
        externalLink: z.string().optional(),
      })
    );

    let posts = [];
    try {
      const extracted = await stagehand.extract(
        "Extract up to 9 of the most recent posts visible in the grid. For each, the caption " +
          "or alt text and whether it appears to be a reel/video.",
        z.object({
          posts: z
            .array(
              z.object({
                caption: z.string().optional(),
                isVideo: z.boolean().optional(),
              })
            )
            .optional(),
        })
      );
      posts = extracted?.posts || [];
    } catch (err) {
      log.warn("post extraction failed:", err.message);
    }

    const result = { url, handle, ...profile, posts, scrapedAt: new Date().toISOString() };

    // Profile picture + post grid thumbnails from the live page DOM.
    try {
      const visuals = await page.evaluate(() => {
        const headerImg = document.querySelector(
          'header img[src*="cdninstagram"], header img[src*="fbcdn"], img[alt*="profile picture"]'
        );
        const profilePicture = headerImg?.src || null;
        const thumbs = Array.from(
          document.querySelectorAll(
            'a[href*="/p/"] img, a[href*="/reel/"] img, main article img, main a img'
          )
        )
          .map((img) => img.src || img.getAttribute("srcset")?.split(/\s+/)[0])
          .filter((src) => src && /cdninstagram|fbcdn|instagram/.test(src));
        return { profilePicture, thumbnails: [...new Set(thumbs)].slice(0, 12) };
      });
      if (visuals.profilePicture) result.profilePicture = visuals.profilePicture;
      if (visuals.thumbnails?.length) result.thumbnails = visuals.thumbnails;
    } catch (err) {
      log.warn("thumbnail extraction failed:", err.message);
    }

    log.info("Scraped profile", handle, `${posts.length} posts`, `${result.thumbnails?.length || 0} thumbs`);
    return result;
  });
}
