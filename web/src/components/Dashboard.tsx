import { useAuth } from "../lib/authContext";

const STATS = [
  { label: "Videos posted", value: "1,284", delta: "+42 this week" },
  { label: "Total views", value: "3.9M", delta: "+312K this week" },
  { label: "Followers", value: "128.4K", delta: "+5.1K this week" },
  { label: "Revenue", value: "$24,910", delta: "+$1,830 this week" },
];

const REPORTS = [
  {
    time: "Today, 6:02 AM",
    title: "Morning drop posted",
    body: "Published “3 tools that run your brand while you sleep.” Early engagement is 2.3× your 30-day average. I scheduled two follow-ups for peak hours.",
    tag: "Content",
  },
  {
    time: "Yesterday, 9:14 PM",
    title: "Audience growth accelerating",
    body: "Your reels niche is trending. I shifted 20% more posting volume toward short-form explainers, which are converting viewers to followers at 4.8%.",
    tag: "Strategy",
  },
  {
    time: "Yesterday, 1:47 PM",
    title: "Revenue milestone",
    body: "Crossed $24.9K in tracked affiliate + sponsorship revenue this month, up 7.9% week over week. Two new brand inbound leads were flagged for review.",
    tag: "Revenue",
  },
];

// Lightweight sparkline so the analytics card feels alive without a chart lib.
function Sparkline() {
  const points = [8, 14, 11, 19, 16, 24, 22, 31, 28, 38, 36, 47];
  const max = Math.max(...points);
  const w = 320;
  const h = 72;
  const step = w / (points.length - 1);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${i * step} ${h - (p / max) * h}`)
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="h-20 w-full"
      aria-hidden
    >
      <path
        d={`${path} L ${w} ${h} L 0 ${h} Z`}
        fill="rgba(107,140,255,0.10)"
      />
      <path d={path} fill="none" stroke="#6b8cff" strokeWidth="2" />
    </svg>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const name = user?.name || user?.email?.split("@")[0] || "there";

  return (
    <div className="min-h-screen bg-white text-black">
      <main className="mx-auto max-w-6xl px-5 pb-16 pt-28 sm:px-10 sm:pt-32">
        {/* Welcome */}
        <h1
          className="mb-2 text-[40px] leading-tight sm:text-[64px]"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Welcome, {name}.
        </h1>
        <p className="mb-12 text-[15px] text-black/50 sm:text-[17px]">
          Here's what your AI influencer has been up to.
        </p>

        {/* Stats */}
        <section className="mb-14 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {STATS.map((s) => (
            <div
              key={s.label}
              className="rounded-2xl border border-black/10 bg-black/[0.02] p-5"
            >
              <p className="text-[13px] text-black/50">{s.label}</p>
              <p
                className="mt-2 text-[28px] sm:text-[34px]"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {s.value}
              </p>
              <p className="mt-1 text-[12px] text-[#5b73d6]">{s.delta}</p>
            </div>
          ))}
        </section>

        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
          {/* Analytics */}
          <section>
            <h2
              className="mb-4 text-[22px] sm:text-[26px]"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Performance
            </h2>
            <div className="rounded-2xl border border-black/10 p-6">
              <div className="mb-1 flex items-end justify-between">
                <p className="text-[13px] text-black/50">
                  Views · last 12 weeks
                </p>
                <p className="text-[13px] font-medium text-[#5b73d6]">
                  +318%
                </p>
              </div>
              <Sparkline />
              <div className="mt-6 grid grid-cols-3 gap-4 border-t border-black/10 pt-5">
                <div>
                  <p className="text-[12px] text-black/50">Avg. watch time</p>
                  <p className="mt-1 text-[18px]">21.4s</p>
                </div>
                <div>
                  <p className="text-[12px] text-black/50">Engagement rate</p>
                  <p className="mt-1 text-[18px]">8.7%</p>
                </div>
                <div>
                  <p className="text-[12px] text-black/50">Posts / day</p>
                  <p className="mt-1 text-[18px]">6</p>
                </div>
              </div>
            </div>
          </section>

          {/* AI reports */}
          <section>
            <h2
              className="mb-4 text-[22px] sm:text-[26px]"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Reports from your AI
            </h2>
            <div className="flex flex-col gap-4">
              {REPORTS.map((r) => (
                <div
                  key={r.title}
                  className="rounded-2xl border border-black/10 p-5"
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-[11px] text-black/60">
                      {r.tag}
                    </span>
                    <span className="text-[11px] text-black/40">{r.time}</span>
                  </div>
                  <p className="text-[15px] font-medium">{r.title}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-black/60">
                    {r.body}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
