import * as repo from "../db/repo.js";
import { config } from "../config.js";
import {
  normalizeSchedule,
  planScheduleJobs,
  nextRandomSlot,
  formatScheduleSummary,
  renderLeadMs,
} from "../lib/schedule.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("posting-schedule");

const AUTO_JOB = "auto_post_postiz";

// Clears pending autopilot jobs for one influencer so replanning is idempotent.
async function clearPendingAutoJobs(influencerId) {
  await repo.jobs.cancelPending(influencerId, [AUTO_JOB]);
}

// Enqueues generate+schedule jobs from the influencer's posting_schedule config.
export async function replanInfluencer(influencerId) {
  const influencer = await repo.influencers.get(influencerId);
  if (!influencer) throw new Error("influencer not found");

  const schedule = normalizeSchedule(influencer.posting_schedule);
  await clearPendingAutoJobs(influencerId);

  if (!schedule.enabled) {
    log.info(`Autopilot off for ${influencerId}`);
    return { planned: 0, schedule: formatScheduleSummary(schedule) };
  }
  if (!influencer.postiz_integration_id) {
    log.warn(`Autopilot enabled but no Postiz channel for ${influencerId}`);
    return { planned: 0, schedule: formatScheduleSummary(schedule), warning: "no_postiz" };
  }
  if (!config.publicBaseUrl) {
    log.warn(`Autopilot needs PUBLIC_BASE_URL for ${influencerId}`);
    return { planned: 0, schedule: formatScheduleSummary(schedule), warning: "no_public_url" };
  }

  const jobs = planScheduleJobs(schedule);
  let planned = 0;
  for (const { runAt, publishAt } of jobs) {
    await repo.jobs.enqueue({
      influencerId,
      type: AUTO_JOB,
      payload: { publishAt: publishAt.toISOString() },
      runAt,
    });
    planned++;
  }

  // Persist the next upcoming slot for the UI.
  const nextRunAt = jobs[0]?.publishAt?.toISOString() || schedule.nextRunAt;
  if (nextRunAt && nextRunAt !== schedule.nextRunAt) {
    await repo.influencers.update(influencerId, {
      posting_schedule: { ...schedule, nextRunAt },
    });
  }

  log.info(`Planned ${planned} autopilot job(s) for ${influencerId}`);
  return { planned, schedule: formatScheduleSummary({ ...schedule, nextRunAt }) };
}

// Replan every influencer with autopilot enabled. Called by the daily cron and
// a lighter periodic tick for random-interval schedules.
export async function replanAllEnabled() {
  const all = await repo.influencers.list();
  let total = 0;
  for (const inf of all) {
    const schedule = normalizeSchedule(inf.posting_schedule);
    if (!schedule.enabled) continue;
    const { planned } = await replanInfluencer(inf.id);
    total += planned;
  }
  return { total };
}

// After a random-mode post goes out, queue the next slot and update nextRunAt.
export async function chainRandomSchedule(influencerId, publishedAt = new Date()) {
  const influencer = await repo.influencers.get(influencerId);
  if (!influencer) return;
  const schedule = normalizeSchedule(influencer.posting_schedule);
  if (!schedule.enabled || schedule.mode !== "random") return;

  const nextAt = nextRandomSlot(schedule, publishedAt);
  await repo.influencers.update(influencerId, {
    posting_schedule: { ...schedule, nextRunAt: nextAt.toISOString() },
  });

  const lead = renderLeadMs(schedule);
  const runAt = new Date(Math.max(Date.now(), nextAt.getTime() - lead));
  await repo.jobs.enqueue({
    influencerId,
    type: AUTO_JOB,
    payload: { publishAt: nextAt.toISOString() },
    runAt,
  });
  log.info(`Chained next random post for ${influencerId} at ${nextAt.toISOString()}`);
}
