import * as repo from "../db/repo.js";
import { handlers } from "./pipeline.js";
import { config } from "../config.js";
import { createLogger, formatError } from "../lib/logger.js";

const log = createLogger("runner");

let running = false;
let timer = null;

async function processOne() {
  let job;
  try {
    job = await repo.jobs.claimNext();
  } catch (err) {
    log.error("claim failed:", formatError(err));
    return false;
  }
  if (!job) return false;

  log.info(`Running job ${job.type} (${job.id}) attempt ${job.attempts}/${job.max_attempts}`);
  const handler = handlers[job.type];
  if (!handler) {
    await repo.jobs.fail(job.id, `unknown job type ${job.type}`, false);
    return true;
  }

  try {
    const result = await handler({ influencerId: job.influencer_id, ...(job.payload || {}) });
    await repo.jobs.complete(job.id, result || {});
    log.info(`Job ${job.type} (${job.id}) done`);
  } catch (err) {
    const canRetry = job.attempts < job.max_attempts;
    log.error(`Job ${job.type} (${job.id}) failed:`, formatError(err), canRetry ? "(will retry)" : "(giving up)");
    await repo.jobs.fail(job.id, err.stack || err.message, canRetry);
  }
  return true;
}

// Drains the queue one job at a time (jobs are heavy / use a browser).
async function tick() {
  if (running) return;
  running = true;
  try {
    let processed = true;
    let guard = 0;
    while (processed && guard < 5) {
      processed = await processOne();
      guard++;
    }
  } finally {
    running = false;
  }
}

export function startRunner() {
  if (!config.databaseUrl) {
    log.warn("DATABASE_URL not set - job runner disabled");
    return;
  }
  if (timer) return;
  const ms = Math.max(5, config.scheduler.pollSeconds) * 1000;
  timer = setInterval(() => tick().catch((e) => log.error("tick error", formatError(e))), ms);
  log.info(`Job runner started (poll every ${ms / 1000}s)`);
  tick().catch(() => {});
}

export function stopRunner() {
  if (timer) clearInterval(timer);
  timer = null;
}
