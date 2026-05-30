import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { api } from "../api.js";
import { Card, Badge, Button, Stat, Spinner, fmt } from "../components/ui.jsx";

function Section({ title, children, right }) {
  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export default function Influencer() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState("");
  const [code, setCode] = useState({ email: "", sms: "" });

  const load = useCallback(
    () =>
      api
        .getInfluencer(id)
        .then(setData)
        .catch((e) => setError(e.message)),
    [id]
  );

  useEffect(() => {
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]);

  const doAction = async (action, body) => {
    setBusy(action);
    try {
      await api.action(id, action, body);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy("");
    }
  };

  const sendCode = async (kind) => {
    try {
      await api.submitCode(id, kind, code[kind]);
      setCode((c) => ({ ...c, [kind]: "" }));
    } catch (e) {
      setError(e.message);
    }
  };

  if (error) return <Card className="text-red-300">Error: {error}</Card>;
  if (!data) return <Spinner />;

  const { influencer, account, content, posts, metrics, jobs, sources } = data;
  const persona = influencer.persona || {};

  const totalViews = metrics.reduce((s, m) => s + Number(m.views || 0), 0);
  const followers = metrics[0]?.followers || 0;
  const chartData = [...metrics]
    .reverse()
    .map((m) => ({ date: m.date?.slice(5), views: Number(m.views || 0), likes: Number(m.likes || 0) }));

  return (
    <div className="space-y-8">
      <Link to="/" className="text-sm text-zinc-400 hover:text-white">
        ← Back to dashboard
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-[var(--color-brand)] to-[var(--color-brand2)] flex items-center justify-center text-2xl font-bold text-black">
            {(influencer.name || "?")[0].toUpperCase()}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">{influencer.name}</h1>
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              {account?.username ? <span>@{account.username}</span> : <span>{influencer.niche}</span>}
              <Badge status={influencer.status} />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => doAction("clone")}>
            {busy === "clone" ? "…" : "Re-clone persona"}
          </Button>
          <Button
            variant="ghost"
            disabled={busy || account?.status === "active"}
            onClick={() => doAction("spawn")}
          >
            {busy === "spawn" ? "…" : "Spawn IG account"}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => doAction("generate")}>
            {busy === "generate" ? "…" : "Generate reel"}
          </Button>
          <Button disabled={busy} onClick={() => doAction("post")}>
            {busy === "post" ? "…" : "Post now"}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => doAction("metrics")}>
            {busy === "metrics" ? "…" : "Refresh metrics"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Followers" value={fmt(followers)} />
        <Stat label="Total views" value={fmt(totalViews)} sub="last 30 days" />
        <Stat label="Posts" value={posts.length} />
        <Stat label="Reels rendered" value={content.filter((c) => c.video_path).length} />
      </div>

      {/* Verification helper */}
      {account?.status && account.status !== "active" && (
        <Card className="border-amber-500/30">
          <h2 className="font-semibold text-white mb-1">Account verification</h2>
          <p className="text-xs text-zinc-400 mb-3">
            If account creation is waiting on a code and your email/SMS API isn't auto-resolving
            it, paste the code here.
          </p>
          <div className="flex flex-wrap gap-3">
            {["email", "sms"].map((kind) => (
              <div key={kind} className="flex gap-2">
                <input
                  className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel2)] px-3 py-1.5 text-sm text-white"
                  placeholder={`${kind} code`}
                  value={code[kind]}
                  onChange={(e) => setCode((c) => ({ ...c, [kind]: e.target.value }))}
                />
                <Button variant="ghost" onClick={() => sendCode(kind)}>
                  Submit {kind}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Persona */}
        <Section title="Persona">
          <Card className="space-y-3">
            {persona.bio ? (
              <>
                <p className="text-zinc-200">{persona.bio}</p>
                <p className="text-sm text-zinc-400">{persona.personality}</p>
                <div className="flex flex-wrap gap-2">
                  {(persona.contentPillars || []).map((p) => (
                    <span key={p} className="px-2 py-1 rounded-lg bg-white/5 text-xs text-zinc-300">
                      {p}
                    </span>
                  ))}
                </div>
                {persona.voiceStyle && (
                  <p className="text-xs text-zinc-500">
                    Voice: {persona.voiceStyle.tone} · {persona.voiceStyle.pacing}
                  </p>
                )}
                <div className="text-xs text-zinc-500">
                  Modeled from: {sources.map((s) => s.handle || s.url).join(", ") || "—"}
                </div>
              </>
            ) : (
              <p className="text-zinc-400">
                Persona not generated yet. Click "Re-clone persona" to scrape the source accounts
                and synthesize one.
              </p>
            )}
          </Card>
        </Section>

        {/* Analytics */}
        <Section title="Daily performance">
          <Card>
            {chartData.length ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="v" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.6} />
                      <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3d" />
                  <XAxis dataKey="date" stroke="#71717a" fontSize={11} />
                  <YAxis stroke="#71717a" fontSize={11} tickFormatter={fmt} />
                  <Tooltip
                    contentStyle={{ background: "#1c1c2b", border: "1px solid #2a2a3d", borderRadius: 12 }}
                  />
                  <Area type="monotone" dataKey="views" stroke="#a78bfa" fill="url(#v)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-zinc-400 text-sm py-8 text-center">
                No metrics yet. Post some reels and refresh metrics.
              </p>
            )}
          </Card>
        </Section>
      </div>

      {/* Content */}
      <Section title={`Content (${content.length})`}>
        {content.length === 0 ? (
          <Card className="text-zinc-400">No reels generated yet.</Card>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {content.map((c) => (
              <Card key={c.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white truncate">
                    {c.title || c.topic || "Untitled"}
                  </span>
                  <Badge status={c.status} />
                </div>
                {c.videoUrl ? (
                  <video src={c.videoUrl} controls className="w-full rounded-xl bg-black aspect-[9/16] object-cover" />
                ) : (
                  <div className="w-full rounded-xl bg-[var(--color-panel2)] aspect-[9/16] flex items-center justify-center text-xs text-zinc-500">
                    {c.status === "ready" ? "ready" : "rendering…"}
                  </div>
                )}
                <p className="text-xs text-zinc-400 line-clamp-2">{c.caption}</p>
                {c.status === "ready" && (
                  <Button className="w-full" onClick={() => doAction("post", { contentId: c.id })}>
                    Post this
                  </Button>
                )}
              </Card>
            ))}
          </div>
        )}
      </Section>

      {/* Jobs */}
      <Section title="Activity log">
        <Card>
          <div className="space-y-1 max-h-64 overflow-auto text-sm">
            {jobs.length === 0 && <p className="text-zinc-500">No jobs yet.</p>}
            {jobs.map((j) => (
              <div key={j.id} className="flex items-center justify-between py-1 border-b border-[var(--color-line)]/50 last:border-0">
                <span className="text-zinc-300">{j.type}</span>
                <div className="flex items-center gap-2">
                  {j.last_error && (
                    <span className="text-xs text-red-400 max-w-xs truncate" title={j.last_error}>
                      {j.last_error.split("\n")[0]}
                    </span>
                  )}
                  <Badge status={j.status} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </Section>
    </div>
  );
}
