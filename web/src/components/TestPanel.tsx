import { useCallback, useEffect, useRef, useState } from "react";
import {
  testApi,
  autofillInputs,
  type TestInputs,
  type StatusResponse,
  type Persona,
  type BrowserUseResult,
  type SpawnRun,
  type StepState,
} from "../lib/testApi";

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : "bg-red-500"}`}
    />
  );
}

const STEP_LABEL: Record<StepState, string> = {
  pending: "·",
  running: "…",
  done: "✓",
  error: "✗",
};

const STEP_COLOR: Record<StepState, string> = {
  pending: "text-black/30",
  running: "text-amber-600",
  done: "text-emerald-600",
  error: "text-red-600",
};

function Step({ state, label }: { state: StepState; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className={`w-3 text-center font-bold ${STEP_COLOR[state]}`}>
        {STEP_LABEL[state]}
      </span>
      <span className={state === "pending" ? "text-black/40" : "text-black/80"}>
        {label}
      </span>
    </div>
  );
}

export default function TestPanel() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [inputs, setInputs] = useState<TestInputs>(() => autofillInputs());

  const [busy, setBusy] = useState<null | "persona" | "browseruse" | "spawn">(null);
  const [error, setError] = useState<string | null>(null);

  const [persona, setPersona] = useState<Persona | null>(null);
  const [browser, setBrowser] = useState<BrowserUseResult | null>(null);
  const [run, setRun] = useState<SpawnRun | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    testApi.status().then(setStatus).catch(() => setStatus(null));
  }, []);

  // Poll the active spawn run until it finishes.
  useEffect(() => {
    if (!run || run.status !== "running") return;
    pollRef.current = setInterval(async () => {
      try {
        const next = await testApi.getSpawn(run.runId);
        setRun(next);
        if (next.status !== "running" && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setBusy(null);
        }
      } catch {
        /* keep polling; transient error */
      }
    }, 2500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [run?.runId, run?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key: keyof TestInputs, value: string) =>
    setInputs((prev) => ({ ...prev, [key]: value }));

  const handleAutofill = useCallback(() => {
    setInputs(autofillInputs());
    setError(null);
  }, []);

  const handlePersona = async () => {
    setBusy("persona");
    setError(null);
    setPersona(null);
    try {
      const data = await testApi.generatePersona(inputs);
      setPersona(data.persona);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  const handleBrowserUse = async () => {
    setBusy("browseruse");
    setError(null);
    setBrowser(null);
    try {
      const data = await testApi.testBrowserUse();
      setBrowser(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  const handleSpawn = async () => {
    setBusy("spawn");
    setError(null);
    setRun(null);
    try {
      const started = await testApi.startSpawn(inputs);
      setRun(started);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setBusy(null);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-[60] rounded-full bg-black px-4 py-2.5 text-[13px] font-medium text-white shadow-lg transition-opacity hover:opacity-80"
      >
        Test Lab
      </button>
    );
  }

  const igConfigured = Boolean(status?.integrations.gemini);
  const bbConfigured = Boolean(status?.integrations.browserUse);

  return (
    <div className="fixed bottom-5 right-5 z-[60] flex max-h-[85vh] w-[360px] flex-col overflow-hidden rounded-2xl border border-black/10 bg-white text-black shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-black/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className="text-[18px]"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Test Lab
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-full px-2 text-[18px] leading-none text-black/40 hover:text-black"
          aria-label="Close test panel"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {/* Integration status */}
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-black/70">
          <span className="flex items-center gap-1.5">
            <Dot ok={igConfigured} /> Gemini
          </span>
          <span className="flex items-center gap-1.5">
            <Dot ok={bbConfigured} /> Browser Use
          </span>
          <span className="flex items-center gap-1.5">
            <Dot ok={Boolean(status?.integrations.capsolver)} /> CapSolver
          </span>
          <span className="flex items-center gap-1.5">
            <Dot ok={Boolean(status?.integrations.database)} /> Database
          </span>
        </div>

        {/* Inputs (auto-filled) */}
        <div className="mb-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-medium uppercase tracking-wide text-black/50">
              Inputs
            </span>
            <button
              type="button"
              onClick={handleAutofill}
              className="text-[12px] text-black underline underline-offset-2 hover:opacity-70"
            >
              Autofill
            </button>
          </div>
          {(
            [
              ["name", "Name"],
              ["niche", "Niche"],
              ["email", "Email"],
            ] as const
          ).map(([key, label]) => (
            <input
              key={key}
              value={inputs[key]}
              onChange={(e) => set(key, e.target.value)}
              placeholder={label}
              className="w-full rounded-lg border border-black/15 bg-black/5 px-3 py-2 text-[13px] outline-none focus:border-black/40"
            />
          ))}
          <input
            value={inputs.sources[0] ?? ""}
            onChange={(e) => setInputs((p) => ({ ...p, sources: [e.target.value] }))}
            placeholder="Source profile URL"
            className="w-full rounded-lg border border-black/15 bg-black/5 px-3 py-2 text-[13px] outline-none focus:border-black/40"
          />
        </div>

        {/* Actions */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={handlePersona}
            disabled={busy !== null || !igConfigured}
            className="w-full rounded-lg border border-black/20 px-3 py-2 text-[13px] font-medium transition-colors hover:bg-black hover:text-white disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-black"
          >
            {busy === "persona" ? "Generating…" : "Test Agent Generation"}
          </button>
          <button
            type="button"
            onClick={handleBrowserUse}
            disabled={busy !== null || !bbConfigured}
            className="w-full rounded-lg border border-black/20 px-3 py-2 text-[13px] font-medium transition-colors hover:bg-black hover:text-white disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-black"
          >
            {busy === "browseruse" ? "Launching…" : "Test Browser Use Session"}
          </button>
          <button
            type="button"
            onClick={handleSpawn}
            disabled={busy !== null || !igConfigured || !bbConfigured}
            className="w-full rounded-lg bg-black px-3 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
          >
            {busy === "spawn" ? "Running…" : "Launch Session + Generate User"}
          </button>
        </div>

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700">
            {error}
          </p>
        )}

        {/* Persona result */}
        {persona && (
          <div className="mt-4 rounded-lg border border-black/10 bg-black/[0.03] p-3">
            <div className="mb-1 text-[12px] font-semibold">Agent persona</div>
            <div className="text-[13px] font-medium">{persona.displayName}</div>
            {persona.bio && (
              <p className="mt-1 text-[12px] text-black/70">{persona.bio}</p>
            )}
            {persona.handleSuggestions?.length ? (
              <p className="mt-1 text-[12px] text-black/50">
                @{persona.handleSuggestions.join(", @")}
              </p>
            ) : null}
          </div>
        )}

        {/* Browser Use result */}
        {browser && (
          <div className="mt-4 rounded-lg border border-black/10 bg-black/[0.03] p-3 text-[12px]">
            <div className="mb-1 font-semibold">Browser Use session</div>
            {browser.title && <div className="text-black/70">{browser.title}</div>}
            {browser.sessionUrl && (
              <a
                href={browser.sessionUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-black underline underline-offset-2"
              >
                Watch session ↗
              </a>
            )}
          </div>
        )}

        {/* Full run result */}
        {run && (
          <div className="mt-4 rounded-lg border border-black/10 bg-black/[0.03] p-3">
            <div className="mb-2 text-[12px] font-semibold">
              Full run · {run.status}
            </div>
            <div className="space-y-1">
              <Step state={run.steps.persona} label="Generate agent persona" />
              <Step state={run.steps.session} label="Launch Browser Use session" />
              <Step state={run.steps.account} label="Create user account" />
            </div>

            {run.sessionUrl && (
              <a
                href={run.sessionUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-[12px] text-black underline underline-offset-2"
              >
                Watch live session ↗
              </a>
            )}

            {run.persona?.displayName && (
              <p className="mt-2 text-[12px] text-black/70">
                Persona: {run.persona.displayName}
              </p>
            )}

            {run.account && (
              <div className="mt-2 rounded-md bg-white px-2.5 py-2 text-[12px]">
                <div>
                  <span className="text-black/50">user:</span>{" "}
                  {run.account.username}
                </div>
                <div>
                  <span className="text-black/50">pass:</span>{" "}
                  {run.account.password}
                </div>
                <div>
                  <span className="text-black/50">logged in:</span>{" "}
                  {run.account.loggedIn ? "yes" : "no"}
                </div>
                {run.account.note && (
                  <div className="mt-1 text-black/60">{run.account.note}</div>
                )}
              </div>
            )}

            {run.error && (
              <p className="mt-2 text-[12px] text-red-700">{run.error}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
