import * as repo from "../db/repo.js";
import { config } from "../config.js";
import {
  normalizeSchedule,
  planScheduleJobs,
  nextRandomSlot,
  formatScheduleSummary,
  renderLeadMs,
  isScheduleUnconfigured,
  buildDefaultAutopilotSchedule,
} from "../lib/schedule.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("posting-schedule");

const AUTO_JOB = "auto_post_postiz";

// Clears pending autopilot jobs for one influencer so replanning is idempotent.
async function clearPendingAutoJobs(influencerId) {
  await repo.jobs.cancelPending(influencerId, [AUTO_JOB]);
}

async function hasActiveAutoJob(influencerId) {
  return repo.jobs.hasActive(influencerId, AUTO_JOB);
}

// Assign the default enabled fixed schedule when none has been saved yet.
export async function ensureAutopilotScheduleFor(influencer) {
  const raw = influencer.posting_schedule || {};
  if (!isScheduleUnconfigured(raw)) {
    return { schedule: normalizeSchedule(raw), updated: false };
  }
  const schedule = buildDefaultAutopilotSchedule(influencer.id);
  await repo.influencers.update(influencer.id, { posting_schedule: schedule });
  log.info(`Assigned default autopilot schedule for ${influencer.id} (${schedule.times.join(", ")} ${schedule.timezone})`);
  return { schedule, updated: true };
}

// Enqueues generate+schedule jobs from the influencer's posting_schedule config.
// `force` clears pending jobs and replans (user saved schedule). Without force,
// skips when a pending/running autopilot job already exists so the 5-minute cron
// does not endlessly delete and reschedule jobs before they can run.
export async function replanInfluencer(influencerId, { force = false } = {}) {
  let influencer = await repo.influencers.get(influencerId);
  if (!influencer) throw new Error("influencer not found");

  await ensureAutopilotScheduleFor(influencer);
  influencer = await repo.influencers.get(influencerId);
  const schedule = normalizeSchedule(influencer.posting_schedule);

  if (!schedule.enabled) {
    if (force) await clearPendingAutoJobs(influencerId);
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

  if (!force && (await hasActiveAutoJob(influencerId))) {
    log.info(`Skip replan for ${influencerId} — autopilot job already queued or running`);
    return {
      planned: 0,
      schedule: formatScheduleSummary(schedule),
      skipped: true,
    };
  }

  await clearPendingAutoJobs(influencerId);

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

// Ensure every enabled influencer has a queued autopilot job (recovery only).
// Does NOT cancel existing pending/running jobs — see replanInfluencer({ force }).
export async function replanAllEnabled() {
  const all = await repo.influencers.list();
  let total = 0;
  for (const inf of all) {
    const schedule = normalizeSchedule(inf.posting_schedule);
    if (!schedule.enabled) continue;
    const { planned } = await replanInfluencer(inf.id, { force: false });
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
