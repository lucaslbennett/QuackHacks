export default function Hero() {
  return (
    <section className="relative z-[1] flex h-screen flex-col justify-center px-5 sm:px-8 md:px-16 lg:px-24 xl:px-32">
      <div className="max-w-3xl text-left lg:max-w-4xl">
        <h1
          className="font-bold text-white"
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(40px, 8vw, 88px)",
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
          }}
        >
          The operating
          <br />
          system for AI
          <br />
          influencers.
        </h1>

        <p
          className="mt-5 max-w-md font-medium text-white/80"
          style={{ fontSize: "clamp(16px, 2.5vw, 20px)", lineHeight: 1.5 }}
        >
          Design a persona, give it a voice, and let it post, reply, and grow on
          autopilot. One platform to create and run your AI influencer.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <a
            href="#"
            className="rounded-full bg-white px-7 py-3 text-[16px] font-bold text-black transition-opacity hover:opacity-80"
          >
            Create your influencer
          </a>
          <a
            href="#"
            className="rounded-full border border-white/40 bg-white/10 px-7 py-3 text-[16px] font-bold text-white backdrop-blur-md transition-colors hover:bg-white hover:text-black"
          >
            See how it works
          </a>
        </div>
      </div>
    </section>
  );
}
