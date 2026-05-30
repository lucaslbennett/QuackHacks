const FEATURES = [
  {
    title: "Design the persona",
    body: "Craft a face, a voice, and a personality. Define how your influencer looks, talks, and reacts — then lock it in as a consistent identity across every post.",
  },
  {
    title: "Generate on autopilot",
    body: "Turn a single brief into a content calendar. Aura OS writes captions, scripts, and visuals in your persona's style, ready to ship or refine.",
  },
  {
    title: "Post & reply everywhere",
    body: "Connect your channels once. Your influencer publishes, responds to comments, and stays in character across platforms — around the clock.",
  },
  {
    title: "Grow with insight",
    body: "Track what lands. See engagement, audience growth, and trends, then let the system adapt the persona's strategy automatically.",
  },
] as const;

export default function Features() {
  return (
    <section className="relative z-[1] bg-black px-5 py-24 text-white sm:px-8 md:px-16 lg:px-24 xl:px-32">
      <div className="mx-auto max-w-6xl">
        <p className="mb-3 text-[14px] font-bold uppercase tracking-[0.2em] text-white/50">
          The platform
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
          Everything your AI influencer needs to exist.
        </h2>

        <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2">
          {FEATURES.map((feature, i) => (
            <div
              key={feature.title}
              className="bg-black p-8 transition-colors hover:bg-white/[0.04] sm:p-10"
            >
              <span className="text-[14px] font-bold text-white/40">
                0{i + 1}
              </span>
              <h3
                className="mt-4 font-bold text-white"
                style={{ fontSize: "clamp(20px, 2.5vw, 26px)" }}
              >
                {feature.title}
              </h3>
              <p className="mt-3 text-[16px] leading-relaxed text-white/70">
                {feature.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
