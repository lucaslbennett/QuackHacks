import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Card, Badge, Stat, Spinner, Button } from "../components/ui.jsx";

export default function Dashboard() {
  const [influencers, setInfluencers] = useState(null);
  const [error, setError] = useState(null);

  const load = () =>
    api
      .listInfluencers()
      .then((d) => setInfluencers(d.influencers))
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  if (error) return <Card className="text-red-300">Error: {error}</Card>;
  if (!influencers) return <Spinner />;

  const active = influencers.filter((i) => i.status === "active").length;

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-[var(--color-line)] bg-gradient-to-br from-[var(--color-panel2)] to-[var(--color-panel)] p-8">
        <h1 className="text-3xl font-bold text-white">Build an army of AI influencers.</h1>
        <p className="mt-2 max-w-2xl text-zinc-400">
          Clone any creator's style, spawn a brand-new Instagram account, and let it post
          commentary reels on autopilot, reach out to brands, and report its growth daily.
        </p>
        <div className="mt-5">
          <Link to="/onboard">
            <Button>Spawn a new influencer</Button>
          </Link>
        </div>
      </section>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Influencers" value={influencers.length} />
        <Stat label="Active" value={active} sub="live & posting" />
        <Stat label="Cloning" value={influencers.filter((i) => i.status === "cloning").length} />
        <Stat label="Errors" value={influencers.filter((i) => i.status === "error").length} />
      </div>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Your roster</h2>
        {influencers.length === 0 ? (
          <Card className="text-zinc-400">
            No influencers yet. Spawn your first one to get started.
          </Card>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {influencers.map((inf) => (
              <Link key={inf.id} to={`/influencer/${inf.id}`}>
                <Card className="hover:border-[var(--color-brand)] transition h-full">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-11 w-11 rounded-full bg-gradient-to-br from-[var(--color-brand)] to-[var(--color-brand2)] flex items-center justify-center font-bold text-black">
                        {(inf.name || "?")[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="font-semibold text-white">{inf.name}</div>
                        <div className="text-xs text-zinc-400">
                          {inf.handle ? `@${inf.handle}` : inf.niche || "—"}
                        </div>
                      </div>
                    </div>
                    <Badge status={inf.status} />
                  </div>
                  <p className="mt-3 text-sm text-zinc-400 line-clamp-2">
                    {inf.persona?.bio || inf.niche || "Persona not generated yet."}
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
