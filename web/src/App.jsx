import { Link, NavLink, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "./api.js";

function IntegrationDot({ ok, label }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-zinc-400">
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-400" : "bg-zinc-600"}`} />
      {label}
    </span>
  );
}

export default function App() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    api.status().then(setStatus).catch(() => {});
  }, []);

  const i = status?.integrations || {};

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-[var(--color-line)] bg-[var(--color-ink)]/80 backdrop-blur">
        <div className="mx-auto max-w-6xl px-5 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span className="text-xl">🤖</span>
            <span className="font-bold tracking-tight text-white">
              AI Influencer <span className="text-[var(--color-brand)]">OS</span>
            </span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                isActive ? "text-white" : "text-zinc-400 hover:text-white"
              }
            >
              Dashboard
            </NavLink>
            <Link
              to="/onboard"
              className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-[var(--color-brand)] to-[var(--color-brand2)] text-black font-semibold"
            >
              + Spawn influencer
            </Link>
          </nav>
        </div>
        {status && (
          <div className="mx-auto max-w-6xl px-5 pb-2 flex flex-wrap gap-4">
            <IntegrationDot ok={i.database} label="Postgres" />
            <IntegrationDot ok={i.anthropic} label="Claude" />
            <IntegrationDot ok={i.elevenlabs} label="ElevenLabs" />
            <IntegrationDot ok={i.fal} label="fal.ai" />
            <IntegrationDot ok={i.browserbase} label="Browserbase" />
          </div>
        )}
      </header>
      <main className="mx-auto max-w-6xl px-5 py-8">
        <Outlet />
      </main>
    </div>
  );
}
