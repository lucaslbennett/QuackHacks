import { useState } from "react";

const NAV_LINKS = ["Studio", "Personas", "Pricing", "Docs"] as const;

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <header className="fixed top-0 z-10 flex w-full items-center justify-between px-5 py-4 sm:px-8 sm:py-5">
        {/* Placeholder logo (top left) */}
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white text-[18px] font-bold text-black">
            A
          </span>
          <span
            className="text-[20px] font-bold tracking-tight text-white sm:text-[24px]"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Aura OS
          </span>
        </div>

        {/* Pill navigation (center) */}
        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-full border border-white/20 bg-white/10 px-2 py-1.5 backdrop-blur-md md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link}
              href="#"
              className="rounded-full px-4 py-1.5 text-[15px] font-medium text-white transition-colors hover:bg-white hover:text-black"
            >
              {link}
            </a>
          ))}
        </nav>

        {/* CTA button (top right) */}
        <a
          href="#"
          className="hidden rounded-full bg-white px-5 py-2 text-[15px] font-bold text-black transition-opacity hover:opacity-80 md:inline-block"
        >
          Start creating
        </a>

        {/* Mobile menu toggle */}
        <button
          type="button"
          className="flex flex-col gap-[5px] md:hidden"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span
            className={`block h-[2px] w-6 bg-white transition-all duration-300 ${
              menuOpen ? "translate-y-[7px] rotate-45" : ""
            }`}
          />
          <span
            className={`block h-[2px] w-6 bg-white transition-all duration-300 ${
              menuOpen ? "opacity-0" : ""
            }`}
          />
          <span
            className={`block h-[2px] w-6 bg-white transition-all duration-300 ${
              menuOpen ? "-translate-y-[7px] -rotate-45" : ""
            }`}
          />
        </button>
      </header>

      {/* Mobile menu overlay */}
      <div
        className={`fixed inset-0 z-[9] flex flex-col justify-center gap-8 bg-black/80 px-8 backdrop-blur-md transition-opacity duration-300 md:hidden ${
          menuOpen
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        }`}
      >
        {NAV_LINKS.map((link) => (
          <a
            key={link}
            href="#"
            className="text-[32px] font-bold text-white transition-opacity hover:opacity-60"
            onClick={() => setMenuOpen(false)}
          >
            {link}
          </a>
        ))}
        <a
          href="#"
          className="w-fit rounded-full bg-white px-6 py-3 text-[24px] font-bold text-black transition-opacity hover:opacity-80"
          onClick={() => setMenuOpen(false)}
        >
          Start creating
        </a>
      </div>
    </>
  );
}
