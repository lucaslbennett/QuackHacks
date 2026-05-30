export default function CTA() {
  return (
    <section className="border-b border-white/10 bg-black px-5 py-28 sm:px-8 md:px-16 lg:px-24 xl:px-32 md:py-40">
      <div className="mx-auto max-w-4xl text-center">
        <h2
          className="font-bold text-white"
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(40px, 7vw, 80px)",
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
          }}
        >
          Build an influencer
          <br />
          that never sleeps.
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-white/60 sm:text-[19px]">
          Launch your first AI influencer today. No camera, no crew — just a
          persona and a plan.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <a
            href="#"
            className="rounded-full bg-white px-8 py-3.5 text-[16px] font-bold text-black transition-opacity hover:opacity-80"
          >
            Start creating
          </a>
          <a
            href="#pricing"
            className="rounded-full border border-white/30 px-8 py-3.5 text-[16px] font-bold text-white transition-colors hover:bg-white hover:text-black"
          >
            View pricing
          </a>
        </div>
      </div>
    </section>
  );
}
