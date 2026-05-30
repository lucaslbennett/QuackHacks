import { useState } from "react";
import { useAuth } from "../lib/authContext";
import { isLocalhost } from "../lib/auth";
import type { AuthMode } from "./AuthModal";

const NAV_LINKS = ["Home", "Demo", "Dashboard"] as const;

const SHOW_DEV_LOGIN = isLocalhost();

export default function Navbar({
  onAuth,
  onDashboard,
}: {
  onAuth: (mode: AuthMode) => void;
  onDashboard: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { user, devLogin, logout } = useAuth();

  const handleDevLogin = () => {
    devLogin().catch(() => {
      /* surfaced via console; dev-only shortcut */
    });
  };

  const handleNavClick = (link: string) => {
    if (link === "Dashboard") onDashboard();
  };

  return (
    <>
      <header className="fixed top-0 z-10 flex w-full items-center justify-between px-5 py-4 sm:px-8 sm:py-5">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <span
            className="text-[21px] tracking-tight text-black sm:text-[26px]"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Fasto
          </span>
        </div>

        {/* Desktop nav links */}
        <nav className="hidden items-center gap-1 rounded-full border border-black/30 px-1.5 py-1 text-[13px] text-black md:flex">
          {NAV_LINKS.map((link) => (
            <button
              key={link}
              type="button"
              onClick={() => handleNavClick(link)}
              className="rounded-full px-3 py-0.5 transition-colors duration-200 hover:bg-black hover:text-white"
            >
              {link}
            </button>
          ))}
        </nav>

        {/* Desktop auth actions */}
        <div className="hidden items-center gap-2 md:flex">
          {user ? (
            <>
              <span className="text-[13px] text-black/70">
                {user.name || user.email}
              </span>
              <button
                type="button"
                onClick={() => logout()}
                className="rounded-full border border-black/30 px-4 py-1.5 text-[13px] text-black transition-colors duration-200 hover:bg-black hover:text-white"
              >
                Log Out
              </button>
            </>
          ) : (
            <>
              {SHOW_DEV_LOGIN && (
                <button
                  type="button"
                  onClick={handleDevLogin}
                  title="Sign in with the local dev account"
                  className="rounded-full border border-dashed border-amber-500 px-4 py-1.5 text-[13px] text-amber-600 transition-colors duration-200 hover:bg-amber-500 hover:text-white"
                >
                  Dev Sign In
                </button>
              )}
              <button
                type="button"
                onClick={() => onAuth("login")}
                className="rounded-full border border-black/30 px-4 py-1.5 text-[13px] text-black transition-colors duration-200 hover:bg-black hover:text-white"
              >
                Log In
              </button>
              <button
                type="button"
                onClick={() => onAuth("signup")}
                className="rounded-full bg-black px-4 py-1.5 text-[13px] font-medium text-white transition-opacity duration-200 hover:opacity-80"
              >
                Sign Up
              </button>
            </>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          type="button"
          className="flex flex-col gap-[5px] md:hidden"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span
            className={`block h-[2px] w-6 bg-black transition-all duration-300 ${
              menuOpen ? "translate-y-[7px] rotate-45" : ""
            }`}
          />
          <span
            className={`block h-[2px] w-6 bg-black transition-all duration-300 ${
              menuOpen ? "opacity-0" : ""
            }`}
          />
          <span
            className={`block h-[2px] w-6 bg-black transition-all duration-300 ${
              menuOpen ? "-translate-y-[7px] -rotate-45" : ""
            }`}
          />
        </button>
      </header>

      {/* Mobile overlay */}
      <div
        className={`fixed inset-0 z-[9] flex flex-col justify-center gap-8 bg-black/95 px-8 backdrop-blur-sm transition-opacity duration-300 md:hidden ${
          menuOpen
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        }`}
      >
        {NAV_LINKS.map((link) => (
          <button
            key={link}
            type="button"
            className="text-left text-[32px] font-medium text-white transition-opacity hover:opacity-60"
            onClick={() => {
              setMenuOpen(false);
              handleNavClick(link);
            }}
          >
            {link}
          </button>
        ))}
        {user ? (
          <>
            <span className="text-[20px] text-white/60">
              {user.name || user.email}
            </span>
            <button
              type="button"
              className="text-left text-[32px] font-medium text-white transition-opacity hover:opacity-60"
              onClick={() => {
                setMenuOpen(false);
                logout();
              }}
            >
              Log Out
            </button>
          </>
        ) : (
          <>
            {SHOW_DEV_LOGIN && (
              <button
                type="button"
                className="text-left text-[32px] font-medium text-amber-400 transition-opacity hover:opacity-60"
                onClick={() => {
                  setMenuOpen(false);
                  handleDevLogin();
                }}
              >
                Dev Sign In
              </button>
            )}
            <button
              type="button"
              className="text-left text-[32px] font-medium text-white transition-opacity hover:opacity-60"
              onClick={() => {
                setMenuOpen(false);
                onAuth("login");
              }}
            >
              Log In
            </button>
            <button
              type="button"
              className="text-left text-[32px] font-medium text-white underline underline-offset-2 transition-opacity hover:opacity-60"
              onClick={() => {
                setMenuOpen(false);
                onAuth("signup");
              }}
            >
              Sign Up
            </button>
          </>
        )}
      </div>
    </>
  );
}
