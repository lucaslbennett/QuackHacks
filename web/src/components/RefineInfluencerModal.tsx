import { useEffect, useRef, useState } from "react";
import {
  refineInfluencer,
  type Influencer,
  type RefineResult,
} from "../lib/influencers";
import InfluencerImage from "./InfluencerImage";

// One entry in the running refinement log so the user can see how the character
// has evolved across successive prompts (the "refinable process").
interface HistoryEntry {
  instruction: string;
  summary: string;
  changedFields: string[];
  imageChanged: boolean;
  imageUrl: string | null;
  igNote: string | null;
  igQueued: boolean;
}

// Quick starting points the user can tweak — covers look, profile and persona.
const SUGGESTIONS = [
  "Lean her style more streetwear and edgy",
  "Make the bio warmer and funnier",
  "Switch the niche to skincare and clean beauty",
  "Give a calmer, lower-energy voice",
  "Older, early-30s look",
  "More minimalist, neutral-tone aesthetic",
];

export default function RefineInfluencerModal({
  influencer,
  canSyncInstagram = false,
  onClose,
  onUpdated,
}: {
  influencer: Influencer;
  canSyncInstagram?: boolean;
  onClose: () => void;
  onUpdated: (inf: Influencer) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [keepLikeness, setKeepLikeness] = useState(true);
  const [regenerateImage, setRegenerateImage] = useState(false);
  const [applyToInstagram, setApplyToInstagram] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  const persona = influencer.persona || {};
  const name = persona.displayName || influencer.name;
  const handle = influencer.handle || persona.handleSuggestions?.[0] || null;
  const niche = persona.niche || influencer.niche;

  // Close on Escape (but not while a refinement is in flight).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, loading]);

  const submit = async () => {
    const text = instruction.trim();
    if (!text || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result: RefineResult = await refineInfluencer(influencer.id, {
        instruction: text,
        keepLikeness,
        regenerateImage,
        applyToInstagram: applyToInstagram && canSyncInstagram,
      });
      onUpdated(result.influencer);
      const igNote = applyToInstagram
        ? result.igSync.queued
          ? "Live Instagram profile update queued."
          : result.igSync.reason
        : null;
      setHistory((h) => [
        {
          instruction: text,
          summary: result.summary,
          changedFields: result.changedFields,
          imageChanged: result.imageChanged,
          imageUrl: result.influencer.image_url,
          igNote,
          igQueued: result.igSync.queued,
        },
        ...h,
      ]);
      if (result.imageError) {
        setError(`Persona updated, but the portrait couldn't be re-rendered: ${result.imageError}`);
      }
      // Ready for the next refinement.
      setInstruction("");
      setRegenerateImage(false);
      textRef.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't apply that change.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={() => !loading && onClose()}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-[560px] flex-col overflow-hidden rounded-3xl bg-white text-black shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-4 border-b border-black/10 px-6 py-5">
          <InfluencerImage
            src={influencer.image_url}
            name={name}
            className="h-14 w-14 shrink-0 rounded-xl border border-black/10 object-cover"
            fallbackClassName="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-black/10 bg-black/[0.04]"
            fallbackTextClassName="text-[20px] text-black/30"
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-[19px] font-semibold" style={{ fontFamily: "var(--font-heading)" }}>
              Modify {name}
            </h2>
            <p className="mt-0.5 text-[13px] leading-relaxed text-black/55">
              Describe a change in plain English — look, profile, persona or voice.
              Keep refining until it&apos;s right.
            </p>
            {(handle || niche) && (
              <p className="mt-1 text-[12px] text-black/40">
                {handle ? `@${handle}` : ""}
                {handle && niche ? " · " : ""}
                {niche ? <span className="capitalize">{niche}</span> : null}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => !loading && onClose()}
            className="-mr-2 -mt-1 rounded-full px-2 text-[22px] leading-none text-black/40 hover:text-black"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Prompt */}
          <label className="block">
            <span className="text-[13px] font-medium text-black/70">
              What should change?
            </span>
            <textarea
              ref={textRef}
              autoFocus
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
              }}
              rows={3}
              placeholder="e.g. give her a sleek bob haircut, make the bio drier and funnier, and switch the niche to home espresso"
              className="mt-1.5 w-full resize-y rounded-xl border border-black/10 bg-white px-3 py-2.5 text-[14px] leading-relaxed text-black outline-none transition focus:border-[#5b73d6]/50 focus:ring-2 focus:ring-[#5b73d6]/15"
            />
          </label>

          {/* Suggestions */}
          <div className="mt-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                disabled={loading}
                onClick={() => {
                  setInstruction(s);
                  textRef.current?.focus();
                }}
                className="rounded-full border border-black/15 px-3 py-1.5 text-[12px] text-black/70 transition hover:border-[#5b73d6]/50 hover:bg-[#5b73d6]/5 hover:text-[#3f54b3] disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>

          {/* Options */}
          <div className="mt-5 flex flex-col gap-2.5 rounded-2xl border border-black/10 bg-black/[0.02] p-4">
            <Toggle
              checked={keepLikeness}
              onChange={setKeepLikeness}
              disabled={loading}
              label="Keep the same face"
              hint="Re-renders the portrait in the new style but keeps her identity. Turn off for a different-looking person."
            />
            <Toggle
              checked={regenerateImage}
              onChange={setRegenerateImage}
              disabled={loading}
              label="Regenerate the portrait now"
              hint="Force a fresh photo even for text-only edits. (Look changes always re-render automatically.)"
            />
            <Toggle
              checked={applyToInstagram && canSyncInstagram}
              onChange={setApplyToInstagram}
              disabled={loading || !canSyncInstagram}
              label="Also update the live Instagram profile"
              hint={
                canSyncInstagram
                  ? "Pushes the new name, bio and photo to Instagram via the browser (the profile edit Postiz can't do)."
                  : "Needs an Instagram account with a stored login (auto-spawn). Postiz-linked accounts can't be edited this way."
              }
            />
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
              {error}
            </div>
          )}

          {/* Refinement history */}
          {history.length > 0 && (
            <div className="mt-6">
              <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-black/40">
                Changes so far
              </p>
              <div className="flex flex-col gap-2.5">
                {history.map((h, i) => (
                  <div
                    key={history.length - i}
                    className="flex gap-3 rounded-xl border border-black/10 p-3"
                  >
                    {h.imageChanged && h.imageUrl && (
                      <img
                        src={h.imageUrl}
                        alt=""
                        className="h-12 w-12 shrink-0 rounded-lg border border-black/10 object-cover"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] leading-relaxed text-black/80">
                        {h.summary || "Updated."}
                      </p>
                      <p className="mt-0.5 truncate text-[12px] text-black/40">
                        “{h.instruction}”
                      </p>
                      {h.changedFields.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {h.changedFields.map((f) => (
                            <span
                              key={f}
                              className="rounded-full bg-[#5b73d6]/10 px-2 py-0.5 text-[11px] text-[#3f54b3]"
                            >
                              {f}
                            </span>
                          ))}
                        </div>
                      )}
                      {h.igNote && (
                        <p
                          className={`mt-1.5 text-[12px] ${
                            h.igQueued ? "text-emerald-700" : "text-amber-700"
                          }`}
                        >
                          {h.igNote}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 border-t border-black/10 px-6 py-4">
          <button
            type="button"
            onClick={submit}
            disabled={loading || !instruction.trim()}
            className="flex-1 rounded-full bg-black px-5 py-3 text-[14px] font-medium text-white transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Refining…" : history.length ? "Apply another change" : "Apply change"}
          </button>
          <button
            type="button"
            onClick={() => !loading && onClose()}
            disabled={loading}
            className="rounded-full border border-black/15 px-5 py-3 text-[14px] font-medium text-black/70 transition hover:bg-black/[0.04] disabled:opacity-50"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
  hint?: string;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 ${
        disabled ? "cursor-not-allowed opacity-60" : ""
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[#5b73d6]"
      />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-black/80">{label}</span>
        {hint && <span className="mt-0.5 block text-[12px] leading-relaxed text-black/45">{hint}</span>}
      </span>
    </label>
  );
}
