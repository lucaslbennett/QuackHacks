// Per-influencer posting schedule helpers. Supports fixed daily times and
// random-interval cadence with jitter so posts feel human.

const DEFAULT_TZ = "America/Los_Angeles";
export const US_AUTOPILOT_TZ = "America/New_York";
export const DEFAULT_POSTS_PER_DAY = 2;

// US peak engagement windows for fixed daily slots (local time in US_AUTOPILOT_TZ).
const MORNING_WINDOW = { sh: 9, sm: 30, eh: 12, em: 0 };
const EVENING_WINDOW = { sh: 17, sm: 0, eh: 20, em: 0 };

function seededRng(seed) {
  let s = 0;
  const str = String(seed);
  for (let i = 0; i < str.length; i++) s = (Math.imul(31, s) + str.charCodeAt(i)) | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function formatHm(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function pickTimeInRange(rng, { sh, sm, eh, em }) {
  const lo = sh * 60 + sm;
  const hi = eh * 60 + em;
  return formatHm(lo + Math.floor(rng() * (hi - lo + 1)));
}

/** True when the influencer has never saved an autopilot config (empty `{}`). */
export function isScheduleUnconfigured(raw = {}) {
  if (!raw || typeof raw !== "object") return true;
  if (Object.keys(raw).length === 0) return true;
  if (raw.enabled === false) return false;
  if (raw.enabled === true && (raw.mode === "fixed" || raw.mode === "random")) return false;
  if (raw.mode === "fixed" && Array.isArray(raw.times) && raw.times.length > 0) return false;
  if (raw.mode === "random") return false;
  return true;
}

/** Default enabled fixed schedule: 2× daily at stable, per-influencer US times. */
export function buildDefaultAutopilotSchedule(influencerId) {
  const rng = seededRng(influencerId || "default");
  const times = [
    pickTimeInRange(rng, MORNING_WINDOW),
    pickTimeInRange(rng, EVENING_WINDOW),
  ].sort();
  return normalizeSchedule({
    enabled: true,
    mode: "fixed",
    timezone: US_AUTOPILOT_TZ,
    times,
  });
}
// Random-mode cadence options in minutes (5 min is for demo/stress-test).
export const VALID_INTERVAL_MINUTES = [5, 60, 360, 1440];
const VALID_INTERVAL_SET = new Set(VALID_INTERVAL_MINUTES);
const MAX_RENDER_LEAD_MS = 20 * 60 * 1000;

function legacyHoursToMinutes(hours) {
  const map = { 1: 60, 6: 360, 24: 1440 };
  return map[hours] ?? null;
}

export function intervalMs(schedule) {
  const min = schedule.intervalMinutes;
  if (min && VALID_INTERVAL_SET.has(min)) return min * 60 * 1000;
  return (schedule.intervalHours || 6) * 60 * 60 * 1000;
}

// How far ahead to start generating. Short intervals generate at publish time.
export function renderLeadMs(schedule) {
  const interval = intervalMs(schedule);
  if (interval <= 10 * 60 * 1000) return 0;
  return Math.min(MAX_RENDER_LEAD_MS, Math.floor(interval / 2));
}

function resolveIntervalMinutes(raw) {
  const fromMinutes = Number(raw.intervalMinutes);
  if (VALID_INTERVAL_SET.has(fromMinutes)) return fromMinutes;
  const fromHours = legacyHoursToMinutes(Number(raw.intervalHours));
  if (fromHours) return fromHours;
  return 360;
}

function intervalLabel(minutes) {
  if (minutes === 5) return "5 minutes";
  if (minutes === 60) return "hour";
  if (minutes === 1440) return "day";
  if (minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

export function normalizeSchedule(raw = {}) {
  const mode = raw.mode === "random" ? "random" : raw.mode === "fixed" ? "fixed" : "off";
  const enabled = Boolean(raw.enabled) && mode !== "off";
  const timezone =
    typeof raw.timezone === "string" && raw.timezone.trim()
      ? raw.timezone.trim()
      : DEFAULT_TZ;

  let times = Array.isArray(raw.times) ? raw.times.map(String) : ["09:00", "18:00"];
  times = times
    .map((t) => t.trim())
    .filter((t) => /^\d{1,2}:\d{2}$/.test(t))
    .map((t) => {
      const [h, m] = t.split(":").map(Number);
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    });
  if (times.length === 0) times = ["09:00"];
  if (times.length > 2) times = times.slice(0, 2);

  let intervalMinutes = resolveIntervalMinutes(raw);

  return {
    enabled,
    mode: enabled ? mode : "off",
    timezone,
    times,
    intervalMinutes,
    // Legacy field kept for older clients reading the raw JSON.
    intervalHours: intervalMinutes / 60,
    nextRunAt: raw.nextRunAt || null,
  };
}

export function validateScheduleInput(body) {
  const schedule = normalizeSchedule(body);
  if (!body.enabled) {
    return { ok: true, schedule: { ...schedule, enabled: false, mode: "off" } };
  }
  if (body.mode !== "fixed" && body.mode !== "random") {
    return { ok: false, error: 'mode must be "fixed" or "random"' };
  }
  if (body.mode === "fixed") {
    const times = Array.isArray(body.times) ? body.times : [];
    if (times.length < 1 || times.length > 2) {
      return { ok: false, error: "Pick one or two posting times" };
    }
  }
  if (body.mode === "random") {
    const min = Number(body.intervalMinutes ?? legacyHoursToMinutes(Number(body.intervalHours)));
    if (!VALID_INTERVAL_SET.has(min)) {
      return { ok: false, error: "intervalMinutes must be 5, 60, 360, or 1440" };
    }
    schedule.intervalMinutes = min;
    schedule.intervalHours = min / 60;
  }
  return { ok: true, schedule };
}

// Calendar date (YYYY-MM-DD) for `date` in `timeZone`.
function dateKeyInTz(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// Wall-clock parts for `date` in `timeZone`.
function partsInTz(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  });
  const map = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
  };
}

// UTC instant when local `dateKey` + `timeStr` (HH:MM) occurs in `timeZone`.
export function zonedTimeToUtc(dateKey, timeStr, timeZone) {
  const [hour, minute] = timeStr.split(":").map(Number);
  const [y, m, d] = dateKey.split("-").map(Number);
  let utc = new Date(Date.UTC(y, m - 1, d, hour, minute, 0));
  for (let i = 0; i < 4; i++) {
    const p = partsInTz(utc, timeZone);
    const diffMin = (hour - p.hour) * 60 + (minute - p.minute);
    const diffDay = d - p.day;
    utc = new Date(utc.getTime() + diffMin * 60_000 + diffDay * 86_400_000);
  }
  return utc;
}

// Upcoming fixed-mode publish times (UTC) within the next `days` calendar days.
export function upcomingFixedSlots(schedule, { fromDate = new Date(), days = 2 } = {}) {
  const out = [];
  const tz = schedule.timezone || DEFAULT_TZ;
  const startKey = dateKeyInTz(fromDate, tz);
  const [sy, sm, sd] = startKey.split("-").map(Number);
  for (let dayOffset = 0; dayOffset < days; dayOffset++) {
    const dt = new Date(Date.UTC(sy, sm - 1, sd + dayOffset));
    const key = dateKeyInTz(dt, tz);
    for (const time of schedule.times) {
      const at = zonedTimeToUtc(key, time, tz);
      if (at.getTime() > fromDate.getTime()) out.push(at);
    }
  }
  return out.sort((a, b) => a - b);
}

// Random next publish time: interval ± 20% jitter from `after`.
export function nextRandomSlot(schedule, after = new Date()) {
  const baseMs = intervalMs(schedule);
  const jitter = baseMs * 0.2 * (Math.random() * 2 - 1);
  return new Date(after.getTime() + baseMs + jitter);
}

// Jobs to enqueue: { runAt (generate), publishAt }[].
export function planScheduleJobs(schedule, { fromDate = new Date(), horizonHours = 36 } = {}) {
  if (!schedule.enabled) return [];

  const horizonEnd = fromDate.getTime() + horizonHours * 60 * 60 * 1000;
  let publishTimes = [];

  if (schedule.mode === "fixed") {
    publishTimes = upcomingFixedSlots(schedule, { fromDate, days: 3 }).filter(
      (t) => t.getTime() <= horizonEnd
    );
  } else if (schedule.mode === "random") {
    // Only plan the next single slot — chainRandomSchedule queues the one after that.
    let cursor = schedule.nextRunAt ? new Date(schedule.nextRunAt) : nextRandomSlot(schedule, fromDate);
    if (cursor.getTime() <= fromDate.getTime()) {
      cursor = nextRandomSlot(schedule, fromDate);
    }
    if (cursor.getTime() <= horizonEnd) {
      publishTimes.push(cursor);
    }
  }

  return publishTimes.map((publishAt) => {
    const lead = renderLeadMs(schedule);
    const runAt = new Date(Math.max(fromDate.getTime(), publishAt.getTime() - lead));
    return { runAt, publishAt, renderLeadMs: lead };
  });
}

export function formatScheduleSummary(schedule) {
  const s = normalizeSchedule(schedule);
  if (!s.enabled) return { active: false, summary: "Autopilot off" };
  if (s.mode === "fixed") {
    const times = s.times.join(" & ");
    return {
      active: true,
      mode: "fixed",
      summary: `Daily at ${times} (${s.timezone})`,
      times: s.times,
      timezone: s.timezone,
      nextRunAt: s.nextRunAt,
    };
  }
  const label = intervalLabel(s.intervalMinutes);
  return {
    active: true,
    mode: "random",
    summary: `Roughly every ${label} (randomized)`,
    intervalMinutes: s.intervalMinutes,
    intervalHours: s.intervalHours,
    nextRunAt: s.nextRunAt,
  };
}
