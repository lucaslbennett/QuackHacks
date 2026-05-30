import { useEffect, useRef } from "react";
// @ts-expect-error - p5 ships without bundled type declarations; only passed through to Vanta
import p5 from "p5";
// Vanta ships untyped; TRUNK renders organic branching/spiraling line tendrils
// that flow and grow (powered by p5.js, not WebGL) — same line-based feel as
// TOPOLOGY but with vine-like motion. Tuned soft blue over white.
// @ts-expect-error - no type declarations published for vanta effects
import TRUNK from "vanta/dist/vanta.trunk.min";

interface VantaEffect {
  destroy: () => void;
}

export default function AnimatedBackground() {
  const ref = useRef<HTMLDivElement>(null);
  const effectRef = useRef<VantaEffect | null>(null);

  useEffect(() => {
    if (effectRef.current || !ref.current) return;

    effectRef.current = TRUNK({
      el: ref.current,
      p5,
      mouseControls: true,
      touchControls: true,
      gyroControls: false,
      minHeight: 200,
      minWidth: 200,
      scale: 1,
      scaleMobile: 1,
      // Soft blue flowing tendrils over a white backdrop.
      color: 0x6b8cff,
      backgroundColor: 0xffffff,
      spacing: 0,
      chaos: 1.2,
    }) as VantaEffect;

    return () => {
      effectRef.current?.destroy();
      effectRef.current = null;
    };
  }, []);

  return (
    // Confined to the right side with a soft edge fade so the liquid motion
    // lives in one area and melts into the white rather than washing over all.
    <div
      aria-hidden
      className="pointer-events-none fixed inset-y-0 right-0 z-0 w-full opacity-70 sm:w-[60%]"
      style={{
        // Fade horizontally from the right (opaque) to the left (transparent)
        // so it dissolves well before the left edge, plus a gentle vertical
        // softening at top/bottom. Layered masks intersect (mask-composite).
        WebkitMaskImage:
          "linear-gradient(to left, #000 30%, transparent 85%), linear-gradient(to bottom, transparent 0%, #000 18%, #000 82%, transparent 100%)",
        WebkitMaskComposite: "source-in",
        maskImage:
          "linear-gradient(to left, #000 30%, transparent 85%), linear-gradient(to bottom, transparent 0%, #000 18%, #000 82%, transparent 100%)",
        maskComposite: "intersect",
      }}
    >
      <div ref={ref} className="h-full w-full" />
    </div>
  );
}
