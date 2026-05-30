import cron from "node-cron";
import * as repo from "../db/repo.js";
import { config } from "../config.js";
import { randomizedPostTimes } from "../lib/util.js";
import { createLogger, formatError } from "../lib/logger.js";

const log = createLogger("scheduler");

const tasks = [];

// Plans a day of randomized content jobs for every active influencer.
// For each scheduled slot we enqueue a generate job now and a post job at the
// randomized time, so the reel is rendered ahead of its publish moment.
export async function planDailyContent() {
  const all = await repo.influencers.list();
  const active = all.filter((i) => i.status === "active");
  log.info(`Planning daily content for ${active.length} active influencer(s)`);

  for (const inf of active) {
    const count = Math.max(1, inf.posts_per_day || 2);
    const times = randomizedPostTimes(count);
    for (const t of times) {
      // Render ~20 min before publish; if that's in the past, render now.
      const renderAt = new Date(Math.max(Date.now(), t.getTime() - 20 * 60 * 1000));
      await repo.jobs.enqueue({
        influencerId: inf.id,
        type: "generate_content",
        runAt: renderAt,
      });
      // Posts the oldest ready-but-unposted reel at the randomized time.
      await repo.jobs.enqueue({
        influencerId: inf.id,
        type: "post_content",
        runAt: t,
      });
    }
  }
}

// Enqueue metrics scraping for all active influencers.
export async function planMetrics() {
  const all = await repo.influencers.list();
  for (const inf of all.filter((i) => i.status === "active")) {
    await repo.jobs.enqueue({ influencerId: inf.id, type: "scrape_metrics" });
  }
}

export function startScheduler() {
  if (!config.scheduler.enabled) {
    log.warn("Scheduler disabled");
    return;
  }
  if (!config.databaseUrl) {
    log.warn("DATABASE_URL not set - scheduler disabled");
    return;
  }

  // Plan content once each morning.
  tasks.push(
    cron.schedule("5 8 * * *", () => {
      planDailyContent().catch((e) => log.error("planDailyContent error", formatError(e)));
    })
  );

  // Scrape metrics a few times a day.
  tasks.push(
    cron.schedule("0 */6 * * *", () => {
      planMetrics().catch((e) => log.error("planMetrics error", formatError(e)));
    })
  );

  log.info("Scheduler started (daily content @ 08:05, metrics every 6h)");
}

export function stopScheduler() {
  for (const t of tasks) t.stop();
  tasks.length = 0;
}
