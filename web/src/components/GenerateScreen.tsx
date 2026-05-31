import { useEffect, useRef, useState } from "react";
import LoadingBar, { useTimedLoadingProgress } from "./LoadingBar";
import { useAuth } from "../lib/authContext";
import {
  generateInfluencerImage,
  saveGeneration,
} from "../lib/generate";

type Phase = "loading" | "done" | "error";

interface GenerateScreenProps {
  prompt: string;
  onClose: () => void;
  onRequireSignIn: () => void;
}

const LOADING_LINES = [
  "Reading your description…",
  "Designing the persona…",
  "Rendering with Nano Banana Pro…",
  "Adding the finishing touches…",
];

export default function GenerateScreen({
  prompt,
  onClose,
  onRequireSignIn,
}: GenerateScreenProps) {
  const { user } = useAuth();
  const [phase, setPhase] = useState<Phase>("loading");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lineIdx, setLineIdx] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const startedRef = useRef(false);
  const { progress, finishing, completeProgress } = useTimedLoadingProgress(
    phase === "loading",
  );

  // Kick off generation once (guard against StrictMode double-invoke).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    generateInfluencerImage(prompt)
      .then(async ({ imageUrl }) => {
        await completeProgress();
        setImageUrl(imageUrl);
        setPhase("done");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Generation failed");
        setPhase("error");
      });
  }, [prompt]);

  // Cycle the loading copy while we wait.
  useEffect(() => {
    if (phase !== "loading") return;
    const t = setInterval(
      () => setLineIdx((i) => (i + 1) % LOADING_LINES.length),
      1800,
    );
    return () => clearInterval(t);
  }, [phase]);

  // If the user signs in while viewing a result, auto-complete a pending save.
  const handleSave = async () => {
    if (!imageUrl) return;
    if (!user) {
      onRequireSignIn();
      return;
    }
    setSaveState("saving");
    try {
      await saveGeneration(prompt, imageUrl);
      setSaveState("saved");
    } catch {
      setSaveState("idle");
    }
  };

  return (
    <div className="fixed inset-0 z-[55] flex flex-col items-center justify-center bg-white px-5 pt-24 text-black">
      {phase === "loading" && (
        <div className="w-full max-w-md text-center">
          <h2
            className="mb-2 text-[26px] sm:text-[32px]"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Creating your influencer
          </h2>
          <p className="mb-8 min-h-[1.25rem] text-[14px] text-black/50">
            {LOADING_LINES[lineIdx]}
          </p>
          <LoadingBar progress={progress} finishing={finishing} />
        </div>
      )}

      {phase === "done" && imageUrl && (
        <div className="flex w-full max-w-md flex-col items-center text-center">
          <h2
            className="mb-1 text-[26px] sm:text-[32px]"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Meet your influencer
          </h2>
          <p className="mb-6 max-w-sm text-[13px] text-black/50">"{prompt}"</p>

          <div className="w-full overflow-hidden rounded-2xl border border-black/10 shadow-[0_4px_24px_rgba(0,0,0,0.08)]">
            <img
              src={imageUrl}
              alt="Generated AI influencer"
              className="aspect-square w-full object-cover"
            />
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-black/20 px-6 py-2.5 text-[14px] transition-colors duration-200 hover:bg-black hover:text-white"
            >
              Start over
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saveState === "saving" || saveState === "saved"}
              className="rounded-full bg-black px-6 py-2.5 text-[14px] font-medium text-white transition-opacity duration-200 hover:opacity-80 disabled:opacity-60"
            >
              {saveState === "saved"
                ? "Saved ✓"
                : saveState === "saving"
                  ? "Saving…"
                  : user
                    ? "Save to dashboard"
                    : "Sign in to save"}
            </button>
          </div>
          {!user && saveState === "idle" && (
            <p className="mt-3 text-[12px] text-black/40">
              You'll need an account to keep this.
            </p>
          )}
        </div>
      )}

      {phase === "error" && (
        <div className="flex flex-col items-center text-center">
          <h2
            className="mb-2 text-[26px] sm:text-[32px]"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Something went wrong
          </h2>
          <p className="mb-6 max-w-sm text-[14px] text-black/50">{error}</p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-black px-6 py-2.5 text-[14px] font-medium text-white transition-opacity duration-200 hover:opacity-80"
          >
            Try again
          </button>
        </div>
      )}
    </div>
  );
}
