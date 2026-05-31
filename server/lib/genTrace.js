import { randomBytes } from "node:crypto";
import { createLogger, formatError } from "./logger.js";

const log = createLogger("gen");

/**
 * Correlated step timeline for influencer generation (Railway stdout).
 * Each step logs stepMs (since previous step) and totalMs (since request start).
 */
export function createGenTrace(flow, meta = {}) {
  const id = randomBytes(4).toString("hex");
  const startedAt = Date.now();
  let lastMark = startedAt;

  const base = { flow, id, ...meta };

  function line(event, step, extra = {}) {
    const payload = { event, step, ...base, ...extra };
    const msg = Object.entries(payload)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
      .join(" ");
    return msg;
  }

  return {
    id,
    /** Log a completed step and advance the timeline marker. */
    step(step, extra = {}) {
      const now = Date.now();
      const stepMs = now - lastMark;
      const totalMs = now - startedAt;
      lastMark = now;
      log.info(line("step", step, { stepMs, totalMs, ...extra }));
      return { stepMs, totalMs };
    },
    /** Log without advancing the marker (e.g. parallel sub-operations). */
    detail(step, extra = {}) {
      const totalMs = Date.now() - startedAt;
      log.info(line("detail", step, { totalMs, ...extra }));
    },
    /** Run async work and log an isolated spanMs (safe inside Promise.all). */
    async span(step, fn, extra = {}) {
      const spanStart = Date.now();
      this.detail(`${step}_start`, extra);
      try {
        const result = await fn();
        this.detail(`${step}_done`, {
          ...extra,
          spanMs: Date.now() - spanStart,
        });
        return result;
      } catch (err) {
        this.fail(step, err, {
          ...extra,
          spanMs: Date.now() - spanStart,
        });
        throw err;
      }
    },
    done(extra = {}) {
      const totalMs = Date.now() - startedAt;
      log.info(line("complete", "done", { totalMs, ...extra }));
      return totalMs;
    },
    fail(step, err, extra = {}) {
      const totalMs = Date.now() - startedAt;
      log.error(
        line("failed", step, {
          totalMs,
          error: formatError(err),
          ...extra,
        })
      );
      return totalMs;
    },
  };
}
