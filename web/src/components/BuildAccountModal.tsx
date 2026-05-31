import { useCallback, useEffect, useRef, useState } from "react";
import {
  autofillCode,
  autofillHref,
  copyText,
  createAccountDraft,
  pollAccountCode,
  type AccountDraft,
  type DraftInput,
} from "../lib/accountApi";

const IG_GRADIENT = "bg-gradient-to-r from-[#8a3ab9] via-[#e95950] to-[#fccc63]";

function CopyButton({
  value,
  label = "Copy",
  className = "",
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        if (await copyText(value)) {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        }
      }}
      className={`shrink-0 rounded-lg border border-black/15 px-2.5 py-1 text-[12px] font-medium text-black/70 transition hover:bg-black/[0.05] ${className}`}
    >
      {done ? "Copied ✓" : label}
    </button>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-black/40">
          {label}
        </p>
        <p className="truncate font-mono text-[13px] text-black/90">{value}</p>
      </div>
      <CopyButton value={value} />
    </div>
  );
}

function StepRow({
  n,
  done,
  active,
  title,
  children,
}: {
  n: number;
  done: boolean;
  active: boolean;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`flex gap-3 ${active || done ? "" : "opacity-60"}`}>
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${
          done
            ? "bg-emerald-500 text-white"
            : active
              ? "bg-black text-white"
              : "bg-black/10 text-black/50"
        }`}
      >
        {done ? "✓" : n}
      </span>
      <div className="min-w-0 flex-1 pb-1">
        <p className="text-[14px] font-medium text-black/90">{title}</p>
        {children && <div className="mt-2">{children}</div>}
      </div>
    </div>
  );
}

export default function BuildAccountModal({
  input,
  onClose,
}: {
  input?: DraftInput;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AccountDraft | null>(null);
  const [phase, setPhase] = useState<"generating" | "ready" | "error">("generating");
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const generate = useCallback(async () => {
    setPhase("generating");
    setError(null);
    setCode(null);
    setOpened(false);
    try {
      const d = await createAccountDraft(input || {});
      setDraft(d);
      setPhase("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate account details");
      setPhase("error");
    }
  }, [input]);

  useEffect(() => {
    generate();
  }, [generate]);

  // Watch the provisioned inbox for Instagram's verification code, but only once
  // the user has actually started signup (opened IG) — the code can't arrive
  // before they submit, so there's no point hammering the inbox earlier. It
  // returns null until IG emails the code, at which point we surface it here so
  // they never have to open their email.
  useEffect(() => {
    if (!draft || code || !opened) return;
    const check = async () => {
      try {
        const { code: c } = await pollAccountCode(draft.draftId);
        if (c) {
          setCode(c);
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        }
      } catch {
        /* transient — keep polling */
      }
    };
    check();
    pollRef.current = setInterval(check, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [draft, code, opened]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const openInstagram = () => {
    if (draft) window.open(draft.signupUrl, "_blank", "noopener,noreferrer");
    setOpened(true);
  };

  const copyAll = () => {
    if (!draft) return;
    copyText(
      [
        `Full name: ${draft.fullName}`,
        `Username: ${draft.username}`,
        `Password: ${draft.password}`,
        `Email: ${draft.email}`,
        `Birthday: ${draft.birthday.label}`,
      ].join("\n"),
    );
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-[480px] flex-col overflow-hidden rounded-3xl bg-white text-black shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-black/10 px-6 py-5">
          <div>
            <h2 className="text-[19px] font-semibold" style={{ fontFamily: "var(--font-heading)" }}>
              Build your Instagram account
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-black/55">
              We generate everything and read the verification code for you. You
              just open Instagram, autofill, and clear the human check — it takes
              about a minute.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-2 -mt-1 rounded-full px-2 text-[22px] leading-none text-black/40 hover:text-black"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {phase === "generating" && (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <span className="h-7 w-7 animate-spin rounded-full border-2 border-black/15 border-t-black" />
              <p className="text-[14px] font-medium text-black/80">
                Generating your account details…
              </p>
              <p className="text-[12px] text-black/50">
                Creating a private inbox so we can catch the verification code.
              </p>
            </div>
          )}

          {phase === "error" && (
            <div className="py-6 text-center">
              <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-[13px] text-red-700">
                {error}
              </p>
              <button
                type="button"
                onClick={generate}
                className="rounded-full border border-black/15 px-5 py-2.5 text-[14px] font-medium transition hover:bg-black/5"
              >
                Try again
              </button>
            </div>
          )}

          {phase === "ready" && draft && (
            <div className="space-y-6">
              {/* Step 1 — generated details */}
              <StepRow n={1} done active title="Your account details are ready">
                <div className="space-y-2">
                  <Field label="Full name" value={draft.fullName} />
                  <Field label="Username" value={draft.username} />
                  <Field label="Password" value={draft.password} />
                  <Field label="Email (we own this inbox)" value={draft.email} />
                  <div className="flex items-center gap-3 rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-black/40">
                        Birthday (enter on Instagram manually)
                      </p>
                      <p className="truncate font-mono text-[13px] text-black/90">
                        {draft.birthday.label}
                      </p>
                    </div>
                    <CopyButton value={draft.birthday.label} />
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={generate}
                      className="text-[12px] text-[#5b73d6] transition hover:underline"
                    >
                      Generate new details
                    </button>
                    <button
                      type="button"
                      onClick={copyAll}
                      className="text-[12px] font-medium text-black/70 transition hover:underline"
                    >
                      Copy all
                    </button>
                  </div>
                </div>
              </StepRow>

              {/* Step 2 — open IG + autofill */}
              <StepRow n={2} done={opened} active={!opened} title="Open Instagram & autofill the form">
                <button
                  type="button"
                  onClick={openInstagram}
                  className={`inline-flex w-full items-center justify-center gap-2 rounded-full ${IG_GRADIENT} px-5 py-3 text-[14px] font-medium text-white transition hover:opacity-90`}
                >
                  {opened ? "Reopen Instagram signup ↗" : "Open Instagram signup ↗"}
                </button>

                <div className="mt-3 rounded-xl border border-black/10 bg-black/[0.02] p-3">
                  <p className="text-[12px] font-medium text-black/70">
                    Instant autofill (optional)
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-black/55">
                    Drag this button to your bookmarks bar once, then click it on
                    the Instagram tab to fill name, email, username and password.
                  </p>
                  <div className="mt-2.5 flex items-center gap-2">
                    {/* href is a javascript: bookmarklet — set imperatively so
                        React doesn't sanitize it out of the JSX href. */}
                    <a
                      ref={(el) => {
                        if (el) el.setAttribute("href", autofillHref(draft));
                      }}
                      onClick={(e) => e.preventDefault()}
                      draggable
                      title="Drag me to your bookmarks bar"
                      className="inline-flex cursor-grab items-center gap-1.5 rounded-lg bg-black px-3 py-1.5 text-[12px] font-semibold text-white active:cursor-grabbing"
                    >
                      ⚡ Autofill Instagram
                    </a>
                    <CopyButton
                      value={autofillCode(draft)}
                      label="Copy autofill code"
                      className="bg-white"
                    />
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-black/45">
                    No bookmarks bar? Use the Copy buttons above to paste each
                    field instead.
                  </p>
                </div>
              </StepRow>

              {/* Step 3 — human check */}
              <StepRow
                n={3}
                done={!!code}
                active={opened && !code}
                title="Pass the human check & submit"
              >
                <p className="text-[13px] leading-relaxed text-black/55">
                  Choose your birthday, solve Instagram's “confirm you're human”
                  step, and press Sign up. This is the part bots get blocked on —
                  in your own browser it just works.
                </p>
              </StepRow>

              {/* Step 4 — verification */}
              <StepRow
                n={4}
                done={!!code}
                active={opened && !code}
                title="Verify with the code we caught"
              >
                {code ? (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-50 p-3">
                    <p className="text-[12px] font-medium text-emerald-700">
                      Instagram sent your verification code
                    </p>
                    <div className="mt-1.5 flex items-center justify-between gap-3">
                      <span className="font-mono text-[26px] font-bold tracking-[0.3em] text-emerald-800">
                        {code}
                      </span>
                      <CopyButton
                        value={code}
                        label="Copy code"
                        className="border-emerald-500/40 bg-white text-emerald-700"
                      />
                    </div>
                    <p className="mt-1.5 text-[12px] text-emerald-700/80">
                      Paste it into Instagram to finish. Then connect the account
                      below with one tap.
                    </p>
                  </div>
                ) : opened ? (
                  <div className="flex items-center gap-2.5 rounded-xl border border-black/10 bg-black/[0.02] px-3 py-2.5">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500 opacity-70" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
                    </span>
                    <p className="text-[13px] text-black/60">
                      Watching your inbox — the code appears here automatically.
                    </p>
                  </div>
                ) : (
                  <p className="text-[13px] leading-relaxed text-black/45">
                    Once you submit on Instagram, the verification code we catch
                    will appear right here.
                  </p>
                )}
              </StepRow>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-black/10 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-full bg-black px-5 py-3 text-[14px] font-medium text-white transition hover:opacity-80"
          >
            {code ? "Done — back to connect" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
