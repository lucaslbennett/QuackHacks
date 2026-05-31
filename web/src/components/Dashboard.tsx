import { useEffect, useState } from "react";
import { useAuth } from "../lib/authContext";
import {
  getInfluencer,
  listMyInfluencers,
  reorderInfluencers,
  type ContentItem,
  type Influencer,
} from "../lib/influencers";
import {
  getAllAnalytics,
  getCachedAllAnalytics,
  type AllAnalytics,
} from "../lib/analytics";
import DashboardLayout, { type DashSection } from "./DashboardLayout";
import InfluencerPanel from "./InfluencerPanel";
import InfluencerImage from "./InfluencerImage";
import { postTimeCaption } from "../lib/postTime";

interface DashboardProps {
  // Launches the influencer creator, optionally with a composer prompt.
  onCreate?: (seed?: string) => void;
  // Leaves the dashboard and returns to the marketing home.
  onHome?: () => void;
}

// Remembers the last dashboard sub-screen + open influencer across reloads.
const SECTION_KEY = "qh.dashSection";
const SELECTED_KEY = "qh.dashSelectedId";

export default function Dashboard({ onCreate, onHome }: DashboardProps) {
  const { user } = useAuth();
  const name = user?.name || user?.email?.split("@")[0] || "there";

  const [section, setSection] = useState<DashSection>(
    () => (localStorage.getItem(SECTION_KEY) as DashSection) || "overview",
  );
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [selected, setSelected] = useState<Influencer | null>(null);

  // Persist the active section so a reload returns to the same tab.
  useEffect(() => {
    localStorage.setItem(SECTION_KEY, section);
  }, [section]);

  // Persist the open influencer's id (or clear it when none is open).
  useEffect(() => {
    if (selected) localStorage.setItem(SELECTED_KEY, selected.id);
    else localStorage.removeItem(SELECTED_KEY);
  }, [selected]);

  // Re-fetch whenever the signed-in user changes so data shows immediately
  // after login (the token isn't available until auth resolves).
  useEffect(() => {
    if (!user) {
      setInfluencers([]);
      return;
    }
    let active = true;
    listMyInfluencers().then((list) => {
      if (!active) return;
      setInfluencers(list);
      // Restore the previously-open influencer once the list is loaded, so a
      // reload lands back on its detail page.
      const savedId = localStorage.getItem(SELECTED_KEY);
      if (savedId) {
        const match = list.find((i) => i.id === savedId);
        if (match) setSelected(match);
      }
    });
    return () => {
      active = false;
    };
  }, [user]);

  const selectSection = (s: DashSection) => {
    setSelected(null);
    setSection(s);
  };

  const openInfluencer = (inf: Influencer) => {
    setSection("influencers");
    setSelected(inf);
  };

  const refreshInfluencers = () => {
    listMyInfluencers().then(setInfluencers);
  };

  const handleReorder = async (order: string[]) => {
    const byId = new Map(influencers.map((i) => [i.id, i]));
    const reordered = order
      .map((id) => byId.get(id))
      .filter((i): i is Influencer => Boolean(i));
    setInfluencers(reordered);
    try {
      await reorderInfluencers(order);
    } catch {
      refreshInfluencers();
    }
  };

  const handleInfluencerDeleted = () => {
    setSelected(null);
    refreshInfluencers();
  };

  // The middle column lists the user's influencers and doubles as quick nav.
  const middleColumn = (
    <InfluencerList
      influencers={influencers}
      selectedId={selected?.id ?? null}
      onSelect={openInfluencer}
      onCreate={() => onCreate?.()}
      onReorder={handleReorder}
    />
  );

  return (
    <DashboardLayout
      active={section}
      onSelect={selectSection}
      onHome={() => {
        setSelected(null);
        setSection("overview");
        onHome?.();
      }}
      onCreate={() => onCreate?.()}
      middleColumn={middleColumn}
    >
      <div className="mx-auto max-w-5xl px-6 py-8 sm:px-10 sm:py-10">
        {section === "overview" && (
          <Studio name={name} onCreate={(seed) => onCreate?.(seed)} onBrowse={() => setSection("content")} />
        )}

        {section === "influencers" &&
          (selected ? (
            <InfluencerPanel
              influencer={selected}
              onBack={() => setSelected(null)}
              onDeleted={handleInfluencerDeleted}
            />
          ) : (
            <Influencers
              influencers={influencers}
              onSelect={openInfluencer}
              onCreate={() => onCreate?.()}
            />
          ))}

        {section === "content" && <Content influencers={influencers} />}
        {section === "analytics" && <Analytics />}
        {section === "settings" && <Settings />}
      </div>
    </DashboardLayout>
  );
}

/* ---------------- Middle column: influencer list ---------------- */

function InfluencerList({
  influencers,
  selectedId,
  onSelect,
  onCreate,
  onReorder,
}: {
  influencers: Influencer[];
  selectedId: string | null;
  onSelect: (inf: Influencer) => void;
  onCreate: () => void;
  onReorder: (order: string[]) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const moveItem = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const ids = influencers.map((i) => i.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, fromId);
    onReorder(next);
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onCreate}
        className="mb-2 flex items-center gap-2 rounded-lg border border-dashed border-neutral-300 px-3 py-2.5 text-[13px] text-neutral-500 transition-colors hover:border-neutral-400 hover:text-neutral-900"
      >
        <span className="text-[16px] leading-none">+</span> New influencer
      </button>

      {influencers.length === 0 ? (
        <p className="px-3 py-6 text-[13px] leading-relaxed text-neutral-400">
          No influencers yet. Create one to get started.
        </p>
      ) : (
        <>
          <p className="mb-1 px-2 text-[11px] text-neutral-400">Drag to reorder</p>
          {influencers.map((inf) => {
            const label = inf.persona?.displayName || inf.name;
            const niche = inf.persona?.niche || inf.niche;
            const isSel = inf.id === selectedId;
            const isDragging = inf.id === dragId;
            const isOver = inf.id === overId && dragId !== inf.id;
            return (
              <div
                key={inf.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragId && dragId !== inf.id) setOverId(inf.id);
                }}
                onDragLeave={() => {
                  if (overId === inf.id) setOverId(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId) moveItem(dragId, inf.id);
                  setDragId(null);
                  setOverId(null);
                }}
                className={`flex items-center gap-1 rounded-lg transition-colors ${
                  isOver ? "bg-neutral-200/80 ring-1 ring-neutral-300" : ""
                } ${isDragging ? "opacity-40" : ""}`}
              >
                <span
                  draggable
                  onDragStart={(e) => {
                    setDragId(inf.id);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", inf.id);
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setOverId(null);
                  }}
                  aria-label={`Reorder ${label}`}
                  className="flex shrink-0 cursor-grab touch-none items-center justify-center px-1 py-2 text-neutral-300 transition-colors hover:text-neutral-500 active:cursor-grabbing"
                >
                  <GripIcon />
                </span>
                <button
                  type="button"
                  onClick={() => onSelect(inf)}
                  className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1.5 py-2 text-left transition-colors ${
                    isSel ? "bg-neutral-200/70" : "hover:bg-neutral-200/50"
                  }`}
                >
                  <InfluencerImage
                    src={inf.image_url}
                    name={label}
                    className="h-9 w-9 shrink-0 rounded-md object-cover"
                    fallbackClassName="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-neutral-200 text-[13px] text-neutral-500"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-neutral-900">
                      {label}
                    </p>
                    {niche && (
                      <p className="truncate text-[11px] capitalize text-neutral-400">
                        {niche}
                      </p>
                    )}
                  </div>
                  <StatusDot status={inf.status} />
                </button>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function GripIcon() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden>
      <circle cx="2" cy="2" r="1.5" />
      <circle cx="8" cy="2" r="1.5" />
      <circle cx="2" cy="8" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="2" cy="14" r="1.5" />
      <circle cx="8" cy="14" r="1.5" />
    </svg>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "active"
      ? "bg-emerald-500"
      : status === "ready"
        ? "bg-[#5b73d6]"
        : status === "error"
          ? "bg-red-500"
          : "bg-neutral-300";
  return <span className={`h-2 w-2 shrink-0 rounded-full ${color}`} title={status} />;
}

/* ---------------- Studio (hero) ---------------- */

function Studio({
  name,
  onCreate,
  onBrowse,
}: {
  name: string;
  onCreate: (seed?: string) => void;
  onBrowse: () => void;
}) {
  const [value, setValue] = useState("");
  const submit = () => onCreate(value.trim());

  return (
    <div className="flex min-h-[calc(100vh-5rem)] flex-col">
      {/* Hero */}
      <div className="flex flex-1 flex-col items-center justify-center pb-10">
        <h1
          className="mb-10 text-center text-[44px] leading-tight text-neutral-900 sm:text-[60px]"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          What can I create for you?
        </h1>

        {/* Composer */}
        <div className="w-full max-w-2xl rounded-2xl border border-neutral-200 bg-white shadow-[0_2px_16px_rgba(0,0,0,0.04)]">
          <div className="flex items-center gap-3 px-4 pt-4">
            <ImageIcon />
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Describe the influencer you want to create…"
              className="min-w-0 flex-1 bg-transparent py-1 text-[15px] text-neutral-900 placeholder-neutral-400 outline-none"
            />
            <button
              type="button"
              onClick={submit}
              aria-label="Create"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white transition-opacity hover:opacity-80"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M12 19V5M12 5l-6 6M12 5l6 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
          <div className="flex items-center gap-2 px-4 py-3 text-[13px] text-neutral-500">
            <Pill>Influencers</Pill>
            <Pill>Content</Pill>
            <Pill>Auto</Pill>
            <Pill>1K</Pill>
            <span className="ml-auto cursor-default text-neutral-400">
              Powered by Nano Banana
            </span>
          </div>
        </div>
      </div>

      {/* Preview cards */}
      <div className="grid gap-5 pb-4 sm:grid-cols-2">
        <PreviewCard
          title="Create an influencer"
          subtitle="Describe your idea and we'll build a character for you"
          onClick={onCreate}
          variant="create"
          greeting={name}
        />
        <PreviewCard
          title="Browse your content"
          subtitle="See the posts your influencers have generated"
          onClick={onBrowse}
          variant="browse"
        />
      </div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 px-2.5 py-1 text-[12px] text-neutral-600">
      {children}
    </span>
  );
}

function PreviewCard({
  title,
  subtitle,
  onClick,
  variant,
  greeting,
}: {
  title: string;
  subtitle: string;
  onClick: () => void;
  variant: "create" | "browse";
  greeting?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-2xl border border-neutral-200 bg-neutral-50 p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg"
    >
      {/* Visual */}
      <div className="mb-4 aspect-[16/9] overflow-hidden rounded-xl border border-neutral-200 bg-white">
        {variant === "create" ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-[#eef1fb] to-white">
            <span
              className="text-[26px] text-neutral-800"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Hi{greeting ? `, ${greeting}` : ""} 👋
            </span>
            <span className="rounded-full bg-neutral-900 px-3 py-1 text-[12px] text-white">
              + New influencer
            </span>
          </div>
        ) : (
          <div className="grid h-full grid-cols-2 gap-1 p-1">
            {[
              "from-[#dfe5fb]",
              "from-[#e7defb]",
              "from-[#fbe7df]",
              "from-[#dffbe9]",
            ].map((c, i) => (
              <div
                key={i}
                className={`rounded-md bg-gradient-to-br ${c} to-white`}
              />
            ))}
          </div>
        )}
      </div>
      <h3 className="px-1 text-[16px] font-semibold text-neutral-900">{title}</h3>
      <p className="mt-1 px-1 text-[13px] leading-relaxed text-neutral-500">
        {subtitle}
      </p>
    </button>
  );
}

function ImageIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden className="shrink-0 text-neutral-400">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="8.5" cy="10" r="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 17l5-4 4 3 3-2 4 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------------- Influencers grid ---------------- */

function Influencers({
  influencers,
  onSelect,
  onCreate,
}: {
  influencers: Influencer[];
  onSelect: (inf: Influencer) => void;
  onCreate: () => void;
}) {
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1
          className="text-[32px] leading-tight text-neutral-900 sm:text-[40px]"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Your influencers
        </h1>
        <button
          type="button"
          onClick={onCreate}
          className="rounded-full bg-neutral-900 px-5 py-2.5 text-[14px] font-medium text-white transition-opacity hover:opacity-80"
        >
          + New influencer
        </button>
      </div>

      {influencers.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 p-10 text-center">
          <p className="text-[14px] text-neutral-500">
            No influencers yet. Click “New influencer” to describe one and start
            creating content.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {influencers.map((inf) => {
            const label = inf.persona?.displayName || inf.name;
            const niche = inf.persona?.niche || inf.niche;
            return (
              <button
                key={inf.id}
                type="button"
                onClick={() => onSelect(inf)}
                title={`Manage ${label}`}
                className="group relative block overflow-hidden rounded-2xl border border-neutral-200 text-left transition-transform duration-300 ease-out hover:z-10 hover:-translate-y-1 hover:scale-[1.03] hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5b73d6]"
              >
                <InfluencerImage
                  src={inf.image_url}
                  name={label}
                  className="aspect-square w-full object-cover transition-transform duration-300 ease-out group-hover:scale-105"
                  fallbackClassName="flex aspect-square w-full items-center justify-center bg-neutral-100 text-[28px] text-neutral-300"
                />
                <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-medium capitalize text-neutral-700 backdrop-blur">
                  {inf.status}
                </span>
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                  <p className="truncate text-[13px] font-medium text-white">
                    {label}
                  </p>
                  {niche && (
                    <p className="truncate text-[11px] capitalize text-white/70">
                      {niche}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ---------------- Content ---------------- */

// A real generated post, flattened across all of the user's influencers with
// the authoring influencer attached for attribution.
type AggregatedPost = ContentItem & {
  influencerId: string;
  author: string;
  authorImage: string | null;
};

function Content({ influencers }: { influencers: Influencer[] }) {
  const [items, setItems] = useState<AggregatedPost[]>([]);
  const [loading, setLoading] = useState(false);

  // Aggregate each influencer's real generated content (not persona sample
  // placeholders). Generated posts live per-influencer, so we fetch each one's
  // content and flatten them into a single cross-creator feed sorted by recency.
  useEffect(() => {
    if (influencers.length === 0) {
      setItems([]);
      return;
    }
    let active = true;
    setLoading(true);
    Promise.all(
      influencers.map((inf) =>
        getInfluencer(inf.id)
          .then((d) =>
            d.content.map((c) => ({
              ...c,
              influencerId: inf.id,
              author: inf.persona?.displayName || inf.name,
              authorImage: inf.image_url,
            })),
          )
          .catch(() => [] as AggregatedPost[]),
      ),
    )
      .then((lists) => {
        if (!active) return;
        const all = lists.flat().sort((a, b) => {
          const ta = new Date(a.created_at).getTime();
          const tb = new Date(b.created_at).getTime();
          return tb - ta;
        });
        setItems(all);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [influencers]);

  return (
    <>
      <h1
        className="mb-2 text-[32px] leading-tight text-neutral-900 sm:text-[40px]"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        Content
      </h1>
      <p className="mb-8 text-[15px] text-neutral-500">
        Generated posts across all your influencers.
      </p>

      {loading && items.length === 0 ? (
        <div className="rounded-2xl border border-neutral-200 p-10 text-center">
          <p className="text-[14px] text-neutral-500">Loading your content…</p>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 p-10 text-center">
          <p className="text-[14px] text-neutral-500">
            No content yet. Build an influencer, then open it to generate posts.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => {
            const image = it.image_paths?.[0] || it.authorImage;
            const timeLabel = postTimeCaption(it);
            return (
              <div
                key={it.id}
                className="overflow-hidden rounded-2xl border border-neutral-200"
              >
                {image && (
                  <img
                    src={image}
                    alt={it.author}
                    className="aspect-square w-full object-cover"
                  />
                )}
                <div className="p-4">
                  <p className="text-[11px] uppercase tracking-wide text-neutral-400">
                    {it.author}
                  </p>
                  <p className="mt-1 line-clamp-3 text-[13px] leading-relaxed text-neutral-600">
                    {it.caption || it.title || "Untitled post"}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] capitalize text-neutral-500">
                      {it.status}
                    </span>
                    {timeLabel && (
                      <span className="text-[11px] text-neutral-400">{timeLabel}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ---------------- Analytics ---------------- */

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
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-20 w-full" aria-hidden>
      <path d={`${path} L ${w} ${h} L 0 ${h} Z`} fill="rgba(91,115,214,0.10)" />
      <path d={path} fill="none" stroke="#5b73d6" strokeWidth="2" />
    </svg>
  );
}

// Compact number formatter for headline metrics (1.2K, 3.4M).
function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function Analytics() {
  const channels = [
    { label: "Instagram Reels", value: "62%", bar: 62 },
    { label: "TikTok", value: "24%", bar: 24 },
    { label: "YouTube Shorts", value: "14%", bar: 14 },
  ];

  // Seed from cache so previous live totals show instantly on return.
  const cached = getCachedAllAnalytics();
  const [live, setLive] = useState<AllAnalytics | null>(cached);
  const [loading, setLoading] = useState(!cached);

  // Revalidate on mount (one server call). Only replace cached totals when the
  // fresh result has real data, so a transient empty response doesn't blank it.
  useEffect(() => {
    let active = true;
    if (!getCachedAllAnalytics()) setLoading(true);
    getAllAnalytics()
      .then((a) => {
        if (!active) return;
        setLive((prev) => (a.available || !prev ? a : prev));
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  // Headline totals: real values when Postiz returned them, demo values
  // otherwise (per metric).
  const t = live?.totals;
  const headline = [
    { label: "Followers", value: fmtNum(t?.followers ?? 0), live: !!t?.followers },
    { label: "Total views", value: fmtNum(t?.views ?? 0), live: !!t?.views },
    { label: "Likes", value: fmtNum(t?.likes ?? 0), live: !!t?.likes },
    { label: "Comments", value: fmtNum(t?.comments ?? 0), live: !!t?.comments },
  ];

  return (
    <>
      <div className="mb-2 flex items-center gap-3">
        <h1
          className="text-[32px] leading-tight text-neutral-900 sm:text-[40px]"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Analytics
        </h1>
        {live?.available ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[12px] font-medium text-emerald-700">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Live
          </span>
        ) : (
          <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[12px] text-neutral-400">
            {loading ? "Loading…" : "Demo data"}
          </span>
        )}
      </div>
      <p className="mb-8 text-[15px] text-neutral-500">
        Reach and engagement across all your influencers.
      </p>

      {/* Headline totals (live across all influencers when available) */}
      <section className="mb-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {headline.map((m) => (
          <div
            key={m.label}
            className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5"
          >
            <p className="flex items-center gap-1.5 text-[13px] text-neutral-500">
              {m.label}
              {m.live && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
            </p>
            <p
              className="mt-2 text-[26px] text-neutral-900 sm:text-[32px]"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {m.value}
            </p>
          </div>
        ))}
      </section>

      <section className="mb-10 rounded-2xl border border-neutral-200 p-6">
        <div className="mb-1 flex items-end justify-between">
          <p className="text-[13px] text-neutral-500">Views · last 12 weeks</p>
          <p className="text-[13px] font-medium text-[#5b73d6]">+318%</p>
        </div>
        <Sparkline />
      </section>

      <div className="grid gap-10 lg:grid-cols-2">
        <section>
          <Heading>By channel</Heading>
          <div className="flex flex-col gap-4">
            {channels.map((c) => (
              <div key={c.label}>
                <div className="mb-1 flex items-center justify-between text-[13px]">
                  <span className="text-neutral-700">{c.label}</span>
                  <span className="text-neutral-400">{c.value}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-100">
                  <div className="h-full rounded-full bg-[#5b73d6]" style={{ width: `${c.bar}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <Heading>Key metrics</Heading>
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: "Avg. watch time", value: "21.4s" },
              { label: "Engagement rate", value: "8.7%" },
              { label: "Follower growth", value: "+5.1K/wk" },
              { label: "Save rate", value: "3.2%" },
            ].map((m) => (
              <div key={m.label} className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5">
                <p className="text-[13px] text-neutral-500">{m.label}</p>
                <p className="mt-2 text-[24px] text-neutral-900" style={{ fontFamily: "var(--font-heading)" }}>
                  {m.value}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

/* ---------------- Settings ---------------- */

function Settings() {
  const { user } = useAuth();
  const integrations = [
    { label: "Gemini (Nano Banana + captions)", status: "Connected", ok: true },
    { label: "ElevenLabs (voiceover)", status: "Not connected", ok: false },
    { label: "Instagram auto-posting", status: "Coming soon", ok: false },
  ];

  return (
    <>
      <h1
        className="mb-2 text-[32px] leading-tight text-neutral-900 sm:text-[40px]"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        Settings
      </h1>
      <p className="mb-8 text-[15px] text-neutral-500">
        Your account and connected services.
      </p>

      <div className="grid gap-10 lg:grid-cols-2">
        <section>
          <Heading>Account</Heading>
          <div className="rounded-2xl border border-neutral-200 p-6">
            <Field label="Name" value={user?.name || "—"} />
            <Field label="Email" value={user?.email || "—"} />
            <Field label="Plan" value="Free preview" />
          </div>
        </section>

        <section>
          <Heading>Integrations</Heading>
          <div className="flex flex-col gap-3">
            {integrations.map((it) => (
              <div
                key={it.label}
                className="flex items-center justify-between rounded-2xl border border-neutral-200 p-4"
              >
                <span className="text-[14px] text-neutral-800">{it.label}</span>
                <span className="flex items-center gap-2 text-[12px] text-neutral-500">
                  <span className={`h-2 w-2 rounded-full ${it.ok ? "bg-emerald-500" : "bg-neutral-300"}`} />
                  {it.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-4 text-[22px] text-neutral-900 sm:text-[26px]" style={{ fontFamily: "var(--font-heading)" }}>
      {children}
    </h2>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-neutral-100 py-3 last:border-b-0">
      <p className="text-[12px] text-neutral-400">{label}</p>
      <p className="mt-0.5 text-[15px] text-neutral-800">{value}</p>
    </div>
  );
}
