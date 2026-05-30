const STEPS = [
  {
    step: "01",
    title: "Shape the persona",
    body: "Pick a look, a voice, and a backstory. Aura OS turns it into a consistent identity that stays in character everywhere it appears.",
  },
  {
    step: "02",
    title: "Set the strategy",
    body: "Choose niches, tone, and posting cadence. Your influencer plans a full content calendar and drafts everything in its own style.",
  },
  {
    step: "03",
    title: "Launch and let it run",
    body: "Connect your channels and go live. It posts, replies, and adapts on its own — you stay in control with a single dashboard.",
  },
] as const;

export default function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="border-b border-white/10 bg-black px-5 py-24 sm:px-8 md:px-16 lg:px-24 xl:px-32 md:py-32"
    >
      <div className="mx-auto max-w-6xl">
        <p className="mb-3 text-[13px] font-bold uppercase tracking-[0.2em] text-white/40">
          How it works
        </p>
        <h2
          className="max-w-3xl font-bold text-white"
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(32px, 5vw, 56px)",
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
          }}
        >
          From idea to live influencer in three steps.
        </h2>

        <div className="mt-16 grid grid-cols-1 gap-12 md:grid-cols-3 md:gap-8">
          {STEPS.map((s) => (
            <div key={s.step} className="border-t border-white/15 pt-6">
              <span
                className="text-[15px] font-bold text-white/40"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {s.step}
              </span>
              <h3
                className="mt-4 font-bold text-white"
                style={{ fontSize: "clamp(20px, 2.5vw, 26px)" }}
              >
                {s.title}
              </h3>
              <p className="mt-3 text-[16px] leading-relaxed text-white/60">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
