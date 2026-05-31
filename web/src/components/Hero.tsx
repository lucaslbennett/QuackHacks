import { useEffect, useState } from "react";
import { useTypewriter } from "../hooks/useTypewriter";

const TYPEWRITER_TEXT =
  "I'm your always-on AI influencer. I post videos 24/7 and grow your revenue while you sleep.";

const HELPER_TEXT =
  "Describe your influencer — their niche, personality, look, and the kind of content they should post.";

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
  // Set once the user first focuses the composer; drives the "expand" transition
  // (chatbox grows, background video fades to white).
  const [composerActive, setComposerActive] = useState(false);
  // Flips on only after the expand transition fully settles, so the helper text
  // doesn't appear mid-animation.
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setPillsVisible(true), 400);
    return () => clearTimeout(timer);
  }, []);

  // Reveal the helper text once the expand animation (800ms) has finished;
  // hide it immediately when collapsing.
  useEffect(() => {
    if (!composerActive) {
      setSettled(false);
      return;
    }
    const timer = setTimeout(() => setSettled(true), 850);
    return () => clearTimeout(timer);
  }, [composerActive]);

  // Type the helper text out (matching the main hero text) only once settled.
  const { displayed: helperDisplayed, done: helperDone } = useTypewriter({
    text: settled ? HELPER_TEXT : "",
    startDelay: 0,
    speed: 16,
  });

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
    <section className="relative z-[1] flex h-screen flex-col justify-end overflow-hidden bg-white px-5 pb-12 sm:px-8 md:justify-center md:px-10 md:pb-0">
      <video
        aria-hidden
        autoPlay
        className="absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ease-out"
        style={{ opacity: composerActive ? 0 : 1 }}
        loop
        muted
        playsInline
        preload="auto"
      >
        <source src="/videos/hero-background.mp4" type="video/mp4" />
      </video>

      <div
        className="relative z-10 w-full transition-[max-width,margin] duration-700 ease-out"
        style={{
          maxWidth: composerActive ? "880px" : "36rem",
          marginLeft: composerActive ? "auto" : undefined,
          marginRight: composerActive ? "auto" : undefined,
        }}
      >
        {/* Typewriter text — fades out once the composer is activated. */}
        <p
          className="mb-5 min-h-[54px] text-black transition-opacity duration-300 sm:mb-6"
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(24px, 5vw, 38px)",
            lineHeight: 1.25,
            fontWeight: 400,
            opacity: composerActive ? 0 : 1,
          }}
        >
          {displayed}
          {!done && (
            <span className="animate-blink ml-[2px] inline-block h-[1.1em] w-[2px] align-middle bg-black" />
          )}
        </p>

        {/* Helper text — types out (matching the main hero text) once settled.
            The wrapper reserves a fixed height with the text anchored to the
            bottom, so wrapping grows the text upward instead of pushing the
            chat bar down. */}
        <div className="mb-8 flex min-h-[80px] items-start justify-center sm:mb-10 sm:min-h-[140px]">
          <p
            className="text-center text-black transition-opacity duration-300"
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "clamp(24px, 4vw, 36px)",
              lineHeight: 1.25,
              fontWeight: 400,
              opacity: settled ? 1 : 0,
            }}
          >
            {helperDisplayed}
            {settled && !helperDone && (
              <span className="animate-blink ml-[2px] inline-block h-[1.1em] w-[2px] align-middle bg-black" />
            )}
          </p>
        </div>

        {/* ChatGPT-style composer — grows taller/larger when activated. */}
        <form
          onSubmit={handleChatSubmit}
          className="mb-6 flex items-center gap-2 rounded-[28px] border border-black/10 bg-white shadow-[0_2px_12px_rgba(0,0,0,0.06)] transition-all duration-700 ease-out focus-within:shadow-[0_2px_18px_rgba(0,0,0,0.10)]"
          style={{
            paddingLeft: composerActive ? "0.875rem" : "0.625rem",
            paddingRight: composerActive ? "0.875rem" : "0.625rem",
            paddingTop: composerActive ? "0.875rem" : "0.5rem",
            paddingBottom: composerActive ? "0.875rem" : "0.5rem",
          }}
        >
          <input
            type="text"
            value={chatValue}
            onChange={(e) => setChatValue(e.target.value)}
            onFocus={() => setComposerActive(true)}
            onBlur={() => {
              if (!chatValue.trim()) setComposerActive(false);
            }}
            placeholder="Describe your influencer"
            className="min-w-0 flex-1 bg-transparent px-3 text-black placeholder-black/40 outline-none transition-all duration-700 ease-out"
            style={{ fontSize: composerActive ? "20px" : "16px" }}
          />

          {/* Send button */}
          <button
            type="submit"
            aria-label="Send"
            className="flex shrink-0 items-center justify-center rounded-full bg-black text-white transition-all duration-700 ease-out hover:opacity-80 disabled:opacity-30"
            style={{
              height: composerActive ? "2.75rem" : "2.25rem",
              width: composerActive ? "2.75rem" : "2.25rem",
            }}
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
            opacity: composerActive ? 0 : pillsVisible ? 1 : 0,
            transform: pillsVisible ? "translateY(0)" : "translateY(8px)",
            transition: "opacity 0.4s ease, transform 0.4s ease",
            pointerEvents: composerActive ? "none" : "auto",
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
