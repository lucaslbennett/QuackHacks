export function Card({ children, className = "" }) {
  return (
    <div
      className={`rounded-2xl border border-[var(--color-line)] bg-[var(--color-panel)]/70 backdrop-blur p-5 ${className}`}
    >
      {children}
    </div>
  );
}

export function Button({ children, variant = "primary", className = "", ...props }) {
  const variants = {
    primary:
      "bg-gradient-to-r from-[var(--color-brand)] to-[var(--color-brand2)] text-black font-semibold hover:opacity-90",
    ghost: "border border-[var(--color-line)] text-zinc-200 hover:bg-white/5",
    danger: "border border-red-500/40 text-red-300 hover:bg-red-500/10",
  };
  return (
    <button
      className={`px-4 py-2 rounded-xl text-sm transition disabled:opacity-40 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

const STATUS_COLORS = {
  draft: "bg-zinc-500/20 text-zinc-300",
  cloning: "bg-amber-500/20 text-amber-300",
  ready: "bg-sky-500/20 text-sky-300",
  spawning: "bg-amber-500/20 text-amber-300",
  active: "bg-emerald-500/20 text-emerald-300",
  paused: "bg-zinc-500/20 text-zinc-300",
  error: "bg-red-500/20 text-red-300",
  failed: "bg-red-500/20 text-red-300",
  posted: "bg-emerald-500/20 text-emerald-300",
  queued: "bg-zinc-500/20 text-zinc-300",
  rendering: "bg-violet-500/20 text-violet-300",
  scripting: "bg-violet-500/20 text-violet-300",
  voicing: "bg-violet-500/20 text-violet-300",
  posting: "bg-amber-500/20 text-amber-300",
  pending: "bg-zinc-500/20 text-zinc-300",
  running: "bg-amber-500/20 text-amber-300",
  done: "bg-emerald-500/20 text-emerald-300",
};

export function Badge({ status }) {
  const cls = STATUS_COLORS[status] || "bg-zinc-500/20 text-zinc-300";
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}

export function Stat({ label, value, sub }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-zinc-400">{label}</span>
      <span className="text-3xl font-bold text-white">{value}</span>
      {sub && <span className="text-xs text-zinc-500">{sub}</span>}
    </Card>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center py-10">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-brand)] border-t-transparent" />
    </div>
  );
}

export function fmt(n) {
  const x = Number(n || 0);
  if (x >= 1_000_000) return (x / 1_000_000).toFixed(1) + "M";
  if (x >= 1_000) return (x / 1_000).toFixed(1) + "K";
  return String(x);
}
