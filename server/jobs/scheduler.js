import cron from "node-cron";
import * as repo from "../db/repo.js";
import { config } from "../config.js";
import { randomizedPostTimes } from "../lib/util.js";
import { normalizeSchedule } from "../lib/schedule.js";
import { replanAllEnabled } from "./postingSchedule.js";
import { createLogger, formatError } from "../lib/logger.js";

const log = createLogger("scheduler");

const tasks = [];

// Legacy global planner: random times spread across the day for active
// influencers that do NOT have per-influencer autopilot enabled.
export async function planDailyContent() {
  const all = await repo.influencers.list();
  const active = all.filter((i) => {
    if (i.status !== "active") return false;
    const schedule = normalizeSchedule(i.posting_schedule);
    return !schedule.enabled;
  });
  log.info(`Planning legacy daily content for ${active.length} active influencer(s)`);

  for (const inf of active) {
    const count = Math.max(1, inf.posts_per_day || 2);
    const times = randomizedPostTimes(count);
    const viaPostiz = config.scheduler.usePostiz && Boolean(inf.postiz_integration_id);
    for (const t of times) {
      const renderAt = new Date(Math.max(Date.now(), t.getTime() - 20 * 60 * 1000));
      await repo.jobs.enqueue({
        influencerId: inf.id,
        type: "generate_content",
        runAt: renderAt,
      });
      if (viaPostiz) {
        await repo.jobs.enqueue({
          influencerId: inf.id,
          type: "schedule_postiz",
          payload: { runAt: t.toISOString() },
          runAt: renderAt,
        });
      } else {
        await repo.jobs.enqueue({
          influencerId: inf.id,
          type: "post_content",
          runAt: t,
        });
      }
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

  // Per-influencer autopilot: replan every morning + every 30 min for random cadence.
  tasks.push(
    cron.schedule("5 8 * * *", () => {
      replanAllEnabled().catch((e) => log.error("replanAllEnabled error", formatError(e)));
      planDailyContent().catch((e) => log.error("planDailyContent error", formatError(e)));
    })
  );
  tasks.push(
    cron.schedule("*/5 * * * *", () => {
      replanAllEnabled().catch((e) => log.error("replanAllEnabled tick error", formatError(e)));
    })
  );

  tasks.push(
    cron.schedule("0 */6 * * *", () => {
      planMetrics().catch((e) => log.error("planMetrics error", formatError(e)));
    })
  );

  log.info(
    `Scheduler started (autopilot ensure-queue @ 08:05 + every 5m, legacy daily content @ 08:05, metrics every 6h)`
  );
}

export function stopScheduler() {
  for (const t of tasks) t.stop();
  tasks.length = 0;
}
