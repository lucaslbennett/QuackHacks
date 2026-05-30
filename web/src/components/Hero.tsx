import { useEffect, useState } from "react";
import { useTypewriter } from "../hooks/useTypewriter";

const TYPEWRITER_TEXT =
  "I'm your always-on AI influencer. I post videos 24/7 and grow your revenue while you sleep.";

const PILL_BUTTONS = [
  "Launch my AI influencer",
  "See how it works",
  "Watch a sample video",
  "View revenue reports",
] as const;

const EMAIL = "hello@fasto.co";

function CopyIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect
        x="4"
        y="4"
        width="7"
        height="7"
        rx="0.5"
        stroke="currentColor"
        strokeWidth="1"
      />
      <rect
        x="1"
        y="1"
        width="7"
        height="7"
        rx="0.5"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

export default function Hero({ onGetStarted }: { onGetStarted: () => void }) {
  const { displayed, done } = useTypewriter({ text: TYPEWRITER_TEXT });
  const [pillsVisible, setPillsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setPillsVisible(true), 400);
    return () => clearTimeout(timer);
  }, []);

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(EMAIL);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <section className="relative z-[1] flex h-screen flex-col justify-end overflow-hidden px-5 pb-12 sm:px-8 md:justify-center md:px-10 md:pb-0">
      <div className="relative z-10 max-w-xl">
        {/* Typewriter text */}
        <p
          className="mb-5 min-h-[54px] text-black sm:mb-6"
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(24px, 5vw, 38px)",
            lineHeight: 1.25,
            fontWeight: 400,
          }}
        >
          {displayed}
          {!done && (
            <span className="animate-blink ml-[2px] inline-block h-[1.1em] w-[2px] align-middle bg-black" />
          )}
        </p>

        {/* Primary CTA */}
        <button
          type="button"
          onClick={onGetStarted}
          className="mb-6 inline-flex items-center justify-center rounded-full bg-black px-20 py-3 text-[15px] font-medium text-white transition-transform duration-200 hover:scale-[1.03] hover:opacity-90 sm:text-[17px]"
        >
          Get Started
        </button>

        {/* Action pill buttons */}
        <div
          className="flex flex-wrap gap-y-1"
          style={{
            opacity: pillsVisible ? 1 : 0,
            transform: pillsVisible ? "translateY(0)" : "translateY(8px)",
            transition: "opacity 0.4s ease, transform 0.4s ease",
          }}
        >
          {PILL_BUTTONS.map((label) => (
            <button
              key={label}
              type="button"
              className="mx-[0.2em] mb-[0.4em] inline-flex items-center justify-center whitespace-nowrap rounded-full border border-white/10 bg-black px-4 py-[0.3em] text-[13px] text-white transition-colors duration-200 hover:bg-white hover:text-black sm:px-5 sm:text-[15px]"
            >
              {label}
            </button>
          ))}

          <button
            type="button"
            onClick={handleCopyEmail}
            className="mx-[0.2em] mb-[0.4em] inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border border-black bg-transparent px-4 py-[0.3em] text-[13px] text-black transition-colors duration-200 hover:bg-black hover:text-white sm:gap-3 sm:px-5 sm:text-[15px]"
          >
            <span>
              Reach us:{" "}
              <span className="underline underline-offset-1">{EMAIL}</span>
            </span>
            <CopyIcon />
          </button>
        </div>
      </div>
    </section>
  );
}
