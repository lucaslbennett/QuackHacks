const TIERS = [
  {
    name: "Starter",
    price: "$0",
    period: "/mo",
    description: "Spin up your first persona and explore the studio.",
    features: [
      "1 AI influencer",
      "30 posts / month",
      "1 connected channel",
      "Community support",
    ],
    cta: "Start free",
    featured: false,
  },
  {
    name: "Creator",
    price: "$49",
    period: "/mo",
    description: "For solo creators running a growing audience.",
    features: [
      "5 AI influencers",
      "Unlimited posts",
      "All channels connected",
      "Auto-replies & DMs",
      "Analytics dashboard",
    ],
    cta: "Start creating",
    featured: true,
  },
  {
    name: "Studio",
    price: "Custom",
    period: "",
    description: "For agencies and brands managing many personas.",
    features: [
      "Unlimited influencers",
      "Team workspaces",
      "Brand safety controls",
      "API & integrations",
      "Dedicated support",
    ],
    cta: "Talk to us",
    featured: false,
  },
] as const;

function Check() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className="mt-[3px] shrink-0"
    >
      <path
        d="M3 8.5L6 11.5L13 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Pricing() {
  return (
    <section
      id="pricing"
      className="border-b border-white/10 bg-black px-5 py-24 sm:px-8 md:px-16 lg:px-24 xl:px-32 md:py-32"
    >
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <p className="mb-3 text-[13px] font-bold uppercase tracking-[0.2em] text-white/40">
            Pricing
          </p>
          <h2
            className="mx-auto max-w-2xl font-bold text-white"
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "clamp(32px, 5vw, 56px)",
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
            }}
          >
            Simple pricing that scales with you.
          </h2>
        </div>

        <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-3">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`flex flex-col rounded-2xl border p-8 ${
                tier.featured
                  ? "border-white bg-white text-black"
                  : "border-white/10 bg-white/[0.02] text-white"
              }`}
            >
              <h3 className="text-[18px] font-bold">{tier.name}</h3>
              <div className="mt-4 flex items-baseline gap-1">
                <span
                  className="font-bold"
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontSize: "clamp(36px, 5vw, 48px)",
                    letterSpacing: "-0.02em",
                  }}
                >
                  {tier.price}
                </span>
                <span
                  className={
                    tier.featured ? "text-black/60" : "text-white/50"
                  }
                >
                  {tier.period}
                </span>
              </div>
              <p
                className={`mt-3 text-[15px] leading-relaxed ${
                  tier.featured ? "text-black/70" : "text-white/60"
                }`}
              >
                {tier.description}
              </p>

              <ul className="mt-8 flex flex-1 flex-col gap-3">
                {tier.features.map((feature) => (
                  <li
                    key={feature}
                    className={`flex items-start gap-2.5 text-[15px] ${
                      tier.featured ? "text-black/80" : "text-white/70"
                    }`}
                  >
                    <Check />
                    {feature}
                  </li>
                ))}
              </ul>

              <a
                href="#"
                className={`mt-8 rounded-full px-6 py-3 text-center text-[15px] font-bold transition-opacity hover:opacity-80 ${
                  tier.featured
                    ? "bg-black text-white"
                    : "bg-white text-black"
                }`}
              >
                {tier.cta}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
