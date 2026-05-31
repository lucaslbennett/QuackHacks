import { useState, type ReactNode } from "react";
import { useAuth } from "../lib/authContext";

// The control-center sections, in nav order.
export type DashSection =
  | "overview"
  | "influencers"
  | "content"
  | "analytics"
  | "settings";

export const SECTIONS: { id: DashSection; label: string; icon: ReactNode }[] = [
  { id: "overview", label: "Studio", icon: <StudioIcon /> },
  { id: "influencers", label: "Influencers", icon: <UsersIcon /> },
  { id: "content", label: "Content", icon: <FilmIcon /> },
  { id: "analytics", label: "Analytics", icon: <ChartIcon /> },
  { id: "settings", label: "Settings", icon: <GearIcon /> },
];

interface DashboardLayoutProps {
  active: DashSection;
  onSelect: (s: DashSection) => void;
  onHome: () => void;
  onCreate: () => void;
  // The middle "Influencers" column content (the roster list).
  middleColumn?: ReactNode;
  children: ReactNode;
}

export default function DashboardLayout({
  active,
  onSelect,
  onHome,
  onCreate,
  middleColumn,
  children,
}: DashboardLayoutProps) {
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const name = user?.name || user?.email?.split("@")[0] || "Account";
  const initials = name.slice(0, 2).toUpperCase();

  const handleSelect = (s: DashSection) => {
    onSelect(s);
    setMobileOpen(false);
  };

  // ---- Left icon+label rail ----
  const rail = (
    <div className="flex h-full flex-col">
      {/* Wordmark */}
      <button
        type="button"
        onClick={() => {
          setMobileOpen(false);
          onHome();
        }}
        className="mb-8 flex items-center gap-2 px-1"
        title="Back to home"
      >
        <img src="/images/fasto-logo.png" alt="Fasto" className="h-6 w-auto" />
        <span
          className="text-[22px] font-semibold tracking-tight text-neutral-900"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Fasto
        </span>
      </button>

      {/* Section nav */}
      <nav className="flex flex-col gap-0.5">
        {SECTIONS.map((s) => {
          const isActive = s.id === active;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => handleSelect(s.id)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition-colors duration-150 ${
                isActive
                  ? "bg-neutral-100 font-medium text-neutral-900"
                  : "text-neutral-500 hover:bg-neutral-100/70 hover:text-neutral-900"
              }`}
            >
              <span className={isActive ? "text-neutral-900" : "text-neutral-400"}>
                {s.icon}
              </span>
              {s.label}
            </button>
          );
        })}
      </nav>

      {/* Bottom cluster */}
      <div className="mt-auto flex flex-col gap-3 pt-4">
        <div className="flex items-center gap-2.5 px-1">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#5b73d6] text-[12px] font-semibold text-white">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-neutral-800">
              {name}
            </p>
            {user?.email && (
              <p className="truncate text-[11px] text-neutral-400">{user.email}</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-[13px]">
          <span className="text-neutral-500">Credits</span>
          <span className="font-medium text-neutral-900">0</span>
        </div>

        <button
          type="button"
          onClick={() => logout()}
          className="rounded-lg border border-neutral-200 px-3 py-2 text-[13px] text-neutral-600 transition-colors hover:bg-neutral-900 hover:text-white"
        >
          Log out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-white text-neutral-900">
      {/* Desktop left rail */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-neutral-200 bg-white px-4 py-6 md:flex">
        {rail}
      </aside>

      {/* Desktop middle column (Influencers) */}
      {middleColumn && (
        <aside className="hidden w-72 shrink-0 flex-col border-r border-neutral-200 bg-neutral-50/60 md:flex">
          <div className="flex items-center justify-between px-5 pb-3 pt-6">
            <span className="text-[15px] font-semibold text-neutral-900">
              Influencers
            </span>
            <button
              type="button"
              onClick={onCreate}
              aria-label="New influencer"
              className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-200/70 hover:text-neutral-900"
            >
              <PlusIcon />
            </button>
          </div>
          <div className="no-scrollbar flex-1 overflow-y-auto px-3 pb-6">
            {middleColumn}
          </div>
        </aside>
      )}

      {/* Mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-between border-b border-neutral-200 bg-white px-5 py-3 md:hidden">
        <button type="button" onClick={onHome} className="flex items-center gap-2">
          <img src="/images/fasto-logo.png" alt="Fasto" className="h-6 w-auto" />
          <span
            className="text-[20px] font-semibold tracking-tight"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Fasto
          </span>
        </button>
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setMobileOpen(true)}
          className="flex flex-col gap-[5px]"
        >
          <span className="block h-[2px] w-6 bg-neutral-900" />
          <span className="block h-[2px] w-6 bg-neutral-900" />
          <span className="block h-[2px] w-6 bg-neutral-900" />
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-neutral-900/20 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[82%] flex-col border-r border-neutral-200 bg-white px-4 py-6">
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 text-neutral-500"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path
                  d="M1 1l12 12M13 1L1 13"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            {rail}
          </aside>
        </div>
      )}

      {/* Main pane */}
      <main className="no-scrollbar flex-1 overflow-y-auto pt-16 md:pt-0">
        {children}
      </main>
    </div>
  );
}

/* ---- Inline icons (stroke = currentColor so active state recolors) ---- */

function StudioIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="9" cy="11" r="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3 17l5-3 4 2 3-2 6 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="9" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M16 5.5a3 3 0 010 5.6M17.5 19.5c0-2.3-1.2-4-3-4.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function FilmIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M3 9h18M3 15h18M8 4v16M16 4v16" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 20V4M4 20h16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M8 16l4-5 3 3 4-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 7.2L5.6 5.6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
