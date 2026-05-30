const STATS = [
  { value: "50K+", label: "Personas created" },
  { value: "120M", label: "Posts published" },
  { value: "98%", label: "On-brand accuracy" },
  { value: "24/7", label: "Always-on engagement" },
] as const;

export default function Stats() {
  return (
    <section className="border-b border-white/10 bg-black px-5 py-20 sm:px-8 md:px-16 lg:px-24 xl:px-32">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-10 md:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.label} className="text-center md:text-left">
            <p
              className="font-bold text-white"
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: "clamp(36px, 5vw, 56px)",
                letterSpacing: "-0.02em",
              }}
            >
              {s.value}
            </p>
            <p className="mt-2 text-[15px] text-white/50">{s.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
