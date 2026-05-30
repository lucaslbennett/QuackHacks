import { useState } from "react";

const FAQS = [
  {
    q: "What exactly is an AI influencer?",
    a: "A fully digital persona with a consistent face, voice, and personality. Aura OS generates its content and runs its accounts so it behaves like a real creator — without a human in the loop for every post.",
  },
  {
    q: "Do I stay in control of what it posts?",
    a: "Always. You can run on full autopilot or require approval before anything goes live. Brand-safety rules and tone settings keep every post on-message.",
  },
  {
    q: "Which platforms are supported?",
    a: "The major social channels for short-form video, images, and text. Connect your accounts once and your influencer publishes natively to each.",
  },
  {
    q: "Can I use my own likeness or brand?",
    a: "Yes. Upload references to shape the persona around your brand, or design something entirely new from scratch in the studio.",
  },
  {
    q: "How do I get started?",
    a: "Create a free account, build your first persona in minutes, and connect a channel. You can upgrade any time as your audience grows.",
  },
] as const;

export default function FAQ() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section
      id="faq"
      className="border-b border-white/10 bg-black px-5 py-24 sm:px-8 md:px-16 lg:px-24 xl:px-32 md:py-32"
    >
      <div className="mx-auto max-w-3xl">
        <p className="mb-3 text-center text-[13px] font-bold uppercase tracking-[0.2em] text-white/40">
          FAQ
        </p>
        <h2
          className="text-center font-bold text-white"
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(32px, 5vw, 56px)",
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
          }}
        >
          Questions, answered.
        </h2>

        <div className="mt-14 divide-y divide-white/10 border-y border-white/10">
          {FAQS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={item.q}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between gap-4 py-6 text-left"
                  aria-expanded={isOpen}
                >
                  <span className="text-[17px] font-bold text-white sm:text-[19px]">
                    {item.q}
                  </span>
                  <span
                    className={`shrink-0 text-[24px] font-light text-white/50 transition-transform duration-300 ${
                      isOpen ? "rotate-45" : ""
                    }`}
                  >
                    +
                  </span>
                </button>
                <div
                  className={`grid transition-all duration-300 ease-out ${
                    isOpen
                      ? "grid-rows-[1fr] opacity-100"
                      : "grid-rows-[0fr] opacity-0"
                  }`}
                >
                  <div className="overflow-hidden">
                    <p className="pb-6 text-[16px] leading-relaxed text-white/60">
                      {item.a}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
