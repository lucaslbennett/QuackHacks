const COLUMNS = [
  {
    heading: "Product",
    links: ["Studio", "Personas", "Pricing", "Changelog"],
  },
  {
    heading: "Company",
    links: ["About", "Careers", "Blog", "Contact"],
  },
  {
    heading: "Resources",
    links: ["Docs", "Guides", "API", "Status"],
  },
  {
    heading: "Legal",
    links: ["Privacy", "Terms", "Security"],
  },
] as const;

export default function Footer() {
  return (
    <footer className="bg-black px-5 pb-12 pt-20 sm:px-8 md:px-16 lg:px-24 xl:px-32">
      <div className="mx-auto max-w-6xl">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-6">
          <div className="col-span-2">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-[18px] font-bold text-black">
                A
              </span>
              <span
                className="text-[20px] font-bold tracking-tight text-white"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                Aura OS
              </span>
            </div>
            <p className="mt-4 max-w-xs text-[15px] leading-relaxed text-white/50">
              The operating system for creating and running AI influencers.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <h4 className="text-[14px] font-bold text-white">
                {col.heading}
              </h4>
              <ul className="mt-4 flex flex-col gap-3">
                {col.links.map((link) => (
                  <li key={link}>
                    <a
                      href="#"
                      className="text-[15px] text-white/50 transition-colors hover:text-white"
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 sm:flex-row">
          <p className="text-[14px] text-white/40">
            © 2026 Aura OS. All rights reserved.
          </p>
          <p className="text-[14px] text-white/40">Made for creators.</p>
        </div>
      </div>
    </footer>
  );
}
