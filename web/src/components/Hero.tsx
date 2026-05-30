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

export default function Hero({
  onGenerate,
}: {
  onGenerate: (prompt: string) => void;
}) {
  const { displayed, done } = useTypewriter({ text: TYPEWRITER_TEXT });
  const [pillsVisible, setPillsVisible] = useState(false);
  const [chatValue, setChatValue] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setPillsVisible(true), 400);
    return () => clearTimeout(timer);
  }, []);

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const prompt = chatValue.trim();
    if (!prompt) return;
    onGenerate(prompt);
  };

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(EMAIL);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <section className="relative z-[1] flex h-screen flex-col justify-end overflow-hidden px-5 pb-12 sm:px-8 md:justify-center md:px-10 md:pb-0">
      <video
        aria-hidden
        autoPlay
        className="absolute inset-0 h-full w-full object-cover"
        loop
        muted
        playsInline
        preload="auto"
      >
        <source src="/videos/hero-background.mp4" type="video/mp4" />
      </video>

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

        {/* ChatGPT-style composer */}
        <form
          onSubmit={handleChatSubmit}
          className="mb-6 flex items-center gap-2 rounded-[28px] border border-black/10 bg-white px-2.5 py-2 shadow-[0_2px_12px_rgba(0,0,0,0.06)] transition-shadow focus-within:shadow-[0_2px_18px_rgba(0,0,0,0.10)]"
        >
          <input
            type="text"
            value={chatValue}
            onChange={(e) => setChatValue(e.target.value)}
            placeholder="Describe your influencer"
            className="min-w-0 flex-1 bg-transparent px-3 text-[15px] text-black placeholder-black/40 outline-none sm:text-[16px]"
          />

          {/* Send button */}
          <button
            type="submit"
            aria-label="Send"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black text-white transition-opacity hover:opacity-80 disabled:opacity-30"
            disabled={!chatValue.trim()}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M12 19V5M12 5l-6 6M12 5l6 6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </form>

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
              onClick={
                label === "Launch my AI influencer"
                  ? () => onGenerate("")
                  : undefined
              }
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
