import { z } from "zod";
import { withStagehand } from "./stagehand.js";
import { sleep } from "../../lib/util.js";
import { createLogger } from "../../lib/logger.js";

const log = createLogger("metrics");

function toNumber(str) {
  if (str == null) return 0;
  const s = String(str).trim().toLowerCase().replace(/,/g, "");
  const m = s.match(/([\d.]+)\s*([km])?/);
  if (!m) return 0;
  let n = parseFloat(m[1]);
  if (m[2] === "k") n *= 1000;
  if (m[2] === "m") n *= 1_000_000;
  return Math.round(n);
}

// Scrapes follower count and per-post view/like/comment counts for an account.
export async function scrapeAccountMetrics({ account, posts = [] }) {
  log.info("Scraping metrics for", account.username);

  return withStagehand(
    async ({ stagehand, page }) => {
      await page.goto(`https://www.instagram.com/${account.username}/`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await sleep(3500);
      await stagehand.act("dismiss any login or cookie popup").catch(() => {});

      const profile = await stagehand
        .extract(
          "Extract this profile's follower count and total number of posts.",
          z.object({ followers: z.string().optional(), postsCount: z.string().optional() })
        )
        .catch(() => ({}));

      const perPost = [];
      for (const post of posts.slice(0, 12)) {
        if (!post.ig_post_url) continue;
        try {
          await page.goto(post.ig_post_url, { waitUntil: "domcontentloaded", timeout: 45000 });
          await sleep(2500);
          const stats = await stagehand.extract(
            "Extract this post's view count (if a video/reel), like count and comment count.",
            z.object({
              views: z.string().optional(),
              likes: z.string().optional(),
              comments: z.string().optional(),
            })
          );
          perPost.push({
            postId: post.id,
            views: toNumber(stats?.views),
            likes: toNumber(stats?.likes),
            comments: toNumber(stats?.comments),
          });
        } catch (err) {
          log.warn("metric scrape failed for", post.ig_post_url, err.message);
        }
      }

      return {
        followers: toNumber(profile?.followers),
        postsCount: toNumber(profile?.postsCount),
        perPost,
      };
    },
    { sessionData: account.session }
  );
}
