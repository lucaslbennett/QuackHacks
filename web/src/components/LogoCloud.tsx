const LOGOS = [
  "Nebula",
  "Foundry",
  "Lumen",
  "Cadence",
  "Northwind",
  "Halcyon",
] as const;

export default function LogoCloud() {
  return (
    <section className="border-b border-white/10 bg-black px-5 py-16 sm:px-8 md:px-16 lg:px-24 xl:px-32">
      <div className="mx-auto max-w-6xl">
        <p className="text-center text-[13px] font-medium uppercase tracking-[0.2em] text-white/40">
          Powering creators and brands worldwide
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-12 gap-y-6">
          {LOGOS.map((logo) => (
            <span
              key={logo}
              className="text-[22px] font-bold tracking-tight text-white/50 transition-colors hover:text-white sm:text-[26px]"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {logo}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
