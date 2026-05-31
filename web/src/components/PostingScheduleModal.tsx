import { useEffect, useState } from "react";
import {
  getPostingSchedule,
  savePostingSchedule,
  type PostingSchedule,
  type PostingScheduleSummary,
} from "../lib/influencers";

const TIMEZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "Europe/London",
  "Europe/Paris",
  "Asia/Tokyo",
  "UTC",
];

const INTERVALS: { minutes: 5 | 60 | 360 | 1440; label: string; hint: string }[] = [
  {
    minutes: 5,
    label: "Every ~5 minutes",
    hint: "Demo / stress test — image generation may run longer than 5 min",
  },
  { minutes: 60, label: "Every ~1 hour", hint: "Very aggressive — Instagram may rate-limit" },
  { minutes: 360, label: "Every ~6 hours", hint: "Good for active accounts (3–4 posts/day)" },
  { minutes: 1440, label: "Every ~24 hours", hint: "Once a day at a random time" },
];

function fmtNext(iso: string | null | undefined) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

export default function PostingScheduleModal({
  influencerId,
  isLinked,
  onClose,
  onSaved,
}: {
  influencerId: string;
  isLinked: boolean;
  onClose: () => void;
  onSaved?: (summary: PostingScheduleSummary) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<"fixed" | "random">("fixed");
  const [timezone, setTimezone] = useState(TIMEZONES[0]);
  const [timeCount, setTimeCount] = useState<1 | 2>(1);
  const [time1, setTime1] = useState("09:00");
  const [time2, setTime2] = useState("18:00");
  const [intervalMinutes, setIntervalMinutes] = useState<5 | 60 | 360 | 1440>(360);
  const [nextRunAt, setNextRunAt] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getPostingSchedule(influencerId)
      .then(({ schedule }) => {
        if (!active) return;
        setEnabled(schedule.enabled);
        setMode(schedule.mode === "random" ? "random" : "fixed");
        setTimezone(schedule.timezone || TIMEZONES[0]);
        const times = schedule.times?.length ? schedule.times : ["09:00"];
        setTimeCount(times.length >= 2 ? 2 : 1);
        setTime1(times[0] || "09:00");
        setTime2(times[1] || "18:00");
        const mins = schedule.intervalMinutes ?? (schedule.intervalHours === 1 ? 60 : schedule.intervalHours === 24 ? 1440 : 360);
        setIntervalMinutes((mins as 5 | 60 | 360 | 1440) || 360);
        setNextRunAt(schedule.nextRunAt);
      })
      .catch((e) => active && setError(e.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [influencerId]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      const times = timeCount === 2 ? [time1, time2] : [time1];
      const result = await savePostingSchedule(influencerId, {
        enabled,
        mode: enabled ? mode : "off",
        timezone,
        times,
        intervalMinutes,
      });
      setNextRunAt(result.schedule.nextRunAt);
      onSaved?.(result.summary);
      const next = fmtNext(result.schedule.nextRunAt);
      setSavedMsg(
        enabled
          ? next
            ? `Autopilot on — next post around ${next}`
            : `Autopilot on — ${result.planned} post(s) queued`
          : "Autopilot turned off",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save schedule.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="schedule-title"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2
              id="schedule-title"
              className="text-[22px]"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Posting schedule
            </h2>
            <p className="mt-1 text-[13px] text-black/50">
              Autopilot generates and schedules posts through Postiz — no manual
              review.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-black/40 transition hover:bg-black/5 hover:text-black"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {!isLinked && (
          <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
            Link an Instagram account first — autopilot publishes through Postiz.
          </div>
        )}

        {loading ? (
          <p className="py-8 text-center text-[14px] text-black/50">Loading…</p>
        ) : (
          <div className="space-y-5">
            {/* On/off */}
            <label className="flex cursor-pointer items-center justify-between rounded-xl border border-black/10 px-4 py-3">
              <span className="text-[14px] font-medium">Autopilot posting</span>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                disabled={!isLinked}
                className="h-5 w-5 accent-black"
              />
            </label>

            {enabled && (
              <>
                {/* Mode */}
                <div>
                  <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-black/40">
                    Schedule type
                  </p>
                  <div className="flex gap-2">
                    {(
                      [
                        ["fixed", "Set times"],
                        ["random", "Random frequency"],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setMode(id)}
                        className={`flex-1 rounded-xl border px-3 py-2.5 text-[13px] font-medium transition ${
                          mode === id
                            ? "border-black bg-black text-white"
                            : "border-black/15 text-black/70 hover:bg-black/5"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {mode === "fixed" && (
                  <div className="space-y-3 rounded-xl border border-black/10 p-4">
                    <p className="text-[13px] text-black/60">
                      Post every day at the same time(s). Pick one or two slots.
                    </p>
                    <div className="flex gap-2">
                      {([1, 2] as const).map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setTimeCount(n)}
                          className={`rounded-full px-3 py-1 text-[12px] font-medium transition ${
                            timeCount === n
                              ? "bg-black text-white"
                              : "bg-black/5 text-black/60 hover:bg-black/10"
                          }`}
                        >
                          {n}× daily
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <label className="flex flex-col gap-1 text-[12px] text-black/50">
                        Time 1
                        <input
                          type="time"
                          value={time1}
                          onChange={(e) => setTime1(e.target.value)}
                          className="rounded-lg border border-black/15 px-3 py-2 text-[14px] text-black"
                        />
                      </label>
                      {timeCount === 2 && (
                        <label className="flex flex-col gap-1 text-[12px] text-black/50">
                          Time 2
                          <input
                            type="time"
                            value={time2}
                            onChange={(e) => setTime2(e.target.value)}
                            className="rounded-lg border border-black/15 px-3 py-2 text-[14px] text-black"
                          />
                        </label>
                      )}
                    </div>
                    <label className="flex flex-col gap-1 text-[12px] text-black/50">
                      Timezone
                      <select
                        value={timezone}
                        onChange={(e) => setTimezone(e.target.value)}
                        className="rounded-lg border border-black/15 px-3 py-2 text-[14px] text-black"
                      >
                        {TIMEZONES.map((tz) => (
                          <option key={tz} value={tz}>
                            {tz.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}

                {mode === "random" && (
                  <div className="space-y-2 rounded-xl border border-black/10 p-4">
                    <p className="text-[13px] text-black/60">
                      Posts at unpredictable times, averaging roughly the interval
                      you pick.
                    </p>
                    {INTERVALS.map(({ minutes, label, hint }) => (
                      <label
                        key={minutes}
                        className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition ${
                          intervalMinutes === minutes
                            ? "border-black bg-black/[0.03]"
                            : "border-black/10 hover:bg-black/[0.02]"
                        }`}
                      >
                        <input
                          type="radio"
                          name="interval"
                          checked={intervalMinutes === minutes}
                          onChange={() => setIntervalMinutes(minutes)}
                          className="mt-1 accent-black"
                        />
                        <span>
                          <span className="block text-[14px] font-medium">{label}</span>
                          <span className="text-[12px] text-black/45">{hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}

                {nextRunAt && (
                  <p className="text-[13px] text-black/50">
                    Next scheduled:{" "}
                    <span className="font-medium text-black/70">
                      {fmtNext(nextRunAt) || nextRunAt}
                    </span>
                  </p>
                )}
              </>
            )}

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
                {error}
              </div>
            )}
            {savedMsg && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">
                {savedMsg}
              </div>
            )}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-black/15 px-5 py-2.5 text-[14px] transition hover:bg-black/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading || (enabled && !isLinked)}
            className="rounded-full bg-black px-5 py-2.5 text-[14px] font-medium text-white transition hover:opacity-80 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save schedule"}
          </button>
        </div>
      </div>
    </div>
  );
}
