import { useCallback, useEffect, useRef, useState } from "react";

export const DEFAULT_LOAD_ESTIMATE_MS = 35_000;
export const LOAD_FINISH_MS = 450;

interface LoadingBarProps {
  /** 0–100 */
  progress: number;
  /** Shorter, smoother animation when sprinting to 100% at the end. */
  finishing?: boolean;
  className?: string;
}

export default function LoadingBar({
  progress,
  finishing = false,
  className = "",
}: LoadingBarProps) {
  const value = Math.min(100, Math.max(0, progress));

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06] ${className}`}
    >
      <div
        className="h-full rounded-full bg-black ease-out"
        style={{
          width: `${value}%`,
          transitionProperty: "width",
          transitionDuration: finishing ? `${LOAD_FINISH_MS}ms` : "120ms",
          transitionTimingFunction: finishing ? "cubic-bezier(0.22, 1, 0.36, 1)" : "linear",
        }}
      />
    </div>
  );
}

/**
 * Progress tied to an estimated load duration. Caps at 92% until `completeProgress`
 * is called, which snaps to 100% and resolves after the finish animation.
 */
export function useTimedLoadingProgress(
  active: boolean,
  estimatedMs = DEFAULT_LOAD_ESTIMATE_MS,
) {
  const [progress, setProgress] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const finishingRef = useRef(false);
  const startMs = useRef(0);

  useEffect(() => {
    if (!active) {
      setProgress(0);
      setFinishing(false);
      finishingRef.current = false;
      return;
    }

    startMs.current = performance.now();
    finishingRef.current = false;
    setFinishing(false);
    setProgress(0);

    const id = window.setInterval(() => {
      if (finishingRef.current) return;
      const elapsed = performance.now() - startMs.current;
      setProgress(Math.min(92, (elapsed / estimatedMs) * 92));
    }, 50);

    return () => window.clearInterval(id);
  }, [active, estimatedMs]);

  const completeProgress = useCallback(
    () =>
      new Promise<void>((resolve) => {
        finishingRef.current = true;
        setFinishing(true);
        setProgress(100);
        window.setTimeout(resolve, LOAD_FINISH_MS);
      }),
    [],
  );

  return { progress, finishing, completeProgress };
}
