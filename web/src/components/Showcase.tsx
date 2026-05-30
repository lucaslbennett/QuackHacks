const PERSONAS = [
  {
    name: "Mira Vale",
    handle: "@miravale",
    niche: "Fashion & lifestyle",
    followers: "1.2M",
    gradient: "from-rose-400 to-orange-300",
  },
  {
    name: "Kai Nakamura",
    handle: "@kaibuilds",
    niche: "Tech & gadgets",
    followers: "840K",
    gradient: "from-sky-400 to-indigo-400",
  },
  {
    name: "Soleil",
    handle: "@soleil.daily",
    niche: "Travel & wellness",
    followers: "2.4M",
    gradient: "from-amber-300 to-pink-400",
  },
] as const;

export default function Showcase() {
  return (
    <section
      id="personas"
      className="border-b border-white/10 bg-black px-5 py-24 sm:px-8 md:px-16 lg:px-24 xl:px-32 md:py-32"
    >
      <div className="mx-auto max-w-6xl">
        <p className="mb-3 text-[13px] font-bold uppercase tracking-[0.2em] text-white/40">
          Personas
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
          Influencers your audience won't forget.
        </h2>

        <div className="mt-16 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {PERSONAS.map((p) => (
            <div
              key={p.handle}
              className="group rounded-2xl border border-white/10 bg-white/[0.02] p-6 transition-colors hover:border-white/25"
            >
              <div className="flex items-center gap-4">
                <div
                  className={`h-14 w-14 rounded-full bg-gradient-to-br ${p.gradient}`}
                />
                <div>
                  <h3 className="text-[18px] font-bold text-white">{p.name}</h3>
                  <p className="text-[14px] text-white/50">{p.handle}</p>
                </div>
              </div>

              <div className="mt-6 flex items-end justify-between border-t border-white/10 pt-5">
                <div>
                  <p className="text-[13px] uppercase tracking-wide text-white/40">
                    Niche
                  </p>
                  <p className="mt-1 text-[15px] text-white/80">{p.niche}</p>
                </div>
                <div className="text-right">
                  <p className="text-[13px] uppercase tracking-wide text-white/40">
                    Followers
                  </p>
                  <p
                    className="mt-1 text-[20px] font-bold text-white"
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    {p.followers}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
