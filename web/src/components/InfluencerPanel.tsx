import { useEffect, useMemo, useState } from "react";
import { generatePost, type GeneratedPost } from "../lib/generate";
import {
  getInfluencer,
  type Influencer,
  type ContentItem,
  type InfluencerAccount,
} from "../lib/influencers";

// Deterministic pseudo-random stats from the influencer id so each one shows
// stable (but distinct) placeholder numbers until real metrics arrive.
function seededStats(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rand = () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    followers: Math.floor(8_000 + rand() * 240_000),
    posts: Math.floor(40 + rand() * 600),
    engagement: (2 + rand() * 9).toFixed(1),
    views: Math.floor(120_000 + rand() * 4_000_000),
  };
}

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

type Tab = "content" | "account" | "analytics";

export default function InfluencerPanel({
  influencer: initial,
  onBack,
}: {
  influencer: Influencer;
  onBack: () => void;
}) {
  // The list row is the seed; we fetch the full detail (account/content/metrics).
  const [influencer, setInfluencer] = useState<Influencer>(initial);
  const [account, setAccount] = useState<InfluencerAccount | null>(null);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [tab, setTab] = useState<Tab>("content");
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const persona = influencer.persona || {};
  const name = persona.displayName || influencer.name;
  const handle = persona.handleSuggestions?.[0] || influencer.handle;
  const niche = persona.niche || influencer.niche;
  const stats = useMemo(() => seededStats(influencer.id), [influencer.id]);

  useEffect(() => {
    let active = true;
    getInfluencer(initial.id)
      .then((d) => {
        if (!active) return;
        setInfluencer(d.influencer);
        setAccount(d.account);
        setContent(d.content);
      })
      .catch((e) => active && setLoadErr(e.message));
    return () => {
      active = false;
    };
  }, [initial.id]);

  return (
    <div>
      <button
        onClick={onBack}
        className="mb-8 inline-flex items-center gap-1.5 text-[14px] text-black/50 transition hover:text-black"
      >
        <span aria-hidden>←</span> Back to influencers
      </button>

      {/* Header: portrait + identity + status */}
      <section className="mb-8 flex flex-col gap-6 sm:flex-row sm:items-center">
        {influencer.image_url && (
          <img
            src={influencer.image_url}
            alt={name}
            className="h-32 w-32 shrink-0 rounded-2xl border border-black/10 object-cover sm:h-40 sm:w-40"
          />
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1
              className="text-[36px] leading-tight sm:text-[48px]"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {name}
            </h1>
            <StatusBadge status={influencer.status} />
          </div>
          {handle && <p className="mt-1 text-[15px] text-[#5b73d6]">@{handle}</p>}
          {niche && (
            <p className="mt-1 text-[14px] capitalize text-black/50">{niche}</p>
          )}
          {persona.bio && (
            <p className="mt-3 max-w-lg text-[14px] leading-relaxed text-black/70">
              {persona.bio}
            </p>
          )}
        </div>
      </section>

      {loadErr && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {loadErr}
        </div>
      )}

      {/* Tabs */}
      <div className="mb-8 flex gap-1 border-b border-black/10">
        {(
          [
            ["content", "Content & posting"],
            ["analytics", "Analytics"],
            // Account connection comes later; kept last so the focus stays on
            // creating and running the character itself.
            ["account", "Account setup"],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-4 py-2.5 text-[14px] transition-colors ${
              tab === id
                ? "border-black font-medium text-black"
                : "border-transparent text-black/50 hover:text-black"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "content" && (
        <ContentTab
          influencer={influencer}
          content={content}
          onPosted={(item) => setContent((c) => [item, ...c])}
        />
      )}
      {tab === "account" && <AccountTab account={account} />}
      {tab === "analytics" && (
        <AnalyticsTab stats={stats} persona={persona} />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    ready: { label: "Ready", cls: "bg-[#5b73d6]/10 text-[#5b73d6]" },
    active: { label: "Active", cls: "bg-emerald-500/10 text-emerald-600" },
    spawning: { label: "Setting up", cls: "bg-amber-500/10 text-amber-600" },
    draft: { label: "Draft", cls: "bg-black/5 text-black/50" },
    error: { label: "Error", cls: "bg-red-500/10 text-red-600" },
  };
  const s = map[status] || { label: status, cls: "bg-black/5 text-black/50" };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${s.cls}`}>
      {s.label}
    </span>
  );
}

/* ---------------- Content & posting ---------------- */

function ContentTab({
  influencer,
  content,
  onPosted,
}: {
  influencer: Influencer;
  content: ContentItem[];
  onPosted: (item: ContentItem) => void;
}) {
  const [post, setPost] = useState<GeneratedPost | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"none" | "all" | "caption" | "tags">(
    "none",
  );
  const name = influencer.persona?.displayName || influencer.name;

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    setCopied("none");
    try {
      const result = await generatePost({
        persona: influencer.persona,
        prompt: influencer.name,
        influencerId: influencer.id,
      });
      setPost(result);
      // Optimistically add to the history list (it's persisted server-side too).
      if (result.contentId) {
        onPosted({
          id: result.contentId,
          title: null,
          caption: result.caption,
          hashtags: result.hashtags,
          image_paths: [result.imageUrl],
          video_path: null,
          status: "ready",
          created_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const copy = async (text: string, which: "all" | "caption" | "tags") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied("none"), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2
          className="text-[22px] sm:text-[26px]"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Create a post
        </h2>
        <button
          onClick={handleGenerate}
          disabled={loading}
          className="rounded-full bg-black px-5 py-2.5 text-[14px] font-medium text-white transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Generating…" : post ? "Generate another" : "Generate post"}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}

      {!post && !loading && (
        <div className="rounded-2xl border border-dashed border-black/15 p-10 text-center">
          <p className="text-[14px] text-black/50">
            Generate a fresh image and caption for {name}. Each one is unique —
            it's saved to this influencer's content below.
          </p>
        </div>
      )}

      {loading && (
        <div className="rounded-2xl border border-black/10 p-10 text-center">
          <p className="text-[14px] text-black/50">
            Writing the caption and rendering the image…
          </p>
        </div>
      )}

      {post && !loading && (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <div className="overflow-hidden rounded-2xl border border-black/10">
              <img
                src={post.imageUrl}
                alt={post.altText || "Generated post"}
                className="aspect-square w-full object-cover"
              />
            </div>
            <a
              href={post.imageUrl}
              download
              className="mt-3 inline-flex w-full items-center justify-center rounded-full border border-black/15 px-4 py-2.5 text-[13px] font-medium transition hover:bg-black/5"
            >
              Download image
            </a>
          </div>

          <div className="flex flex-col gap-4">
            <CopyCard
              label="Caption"
              onCopy={() => copy(post.caption, "caption")}
              copied={copied === "caption"}
            >
              <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-black/80">
                {post.caption}
              </p>
            </CopyCard>
            <CopyCard
              label="Hashtags"
              onCopy={() => copy(post.hashtagLine, "tags")}
              copied={copied === "tags"}
            >
              <p className="break-words text-[14px] leading-relaxed text-[#5b73d6]">
                {post.hashtagLine}
              </p>
            </CopyCard>
            <button
              onClick={() => copy(post.copyText, "all")}
              className="rounded-full bg-[#5b73d6] px-5 py-3 text-[14px] font-medium text-white transition hover:bg-[#4a61c2]"
            >
              {copied === "all"
                ? "Copied — paste into Instagram!"
                : "Copy caption + hashtags"}
            </button>
          </div>
        </div>
      )}

      {/* Content history */}
      <h2
        className="mb-4 mt-12 text-[22px] sm:text-[26px]"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        Content
      </h2>
      {content.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/15 p-8 text-center">
          <p className="text-[14px] text-black/50">
            No posts yet — generate the first one above.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {content.map((item) => {
            const img = item.image_paths?.[0];
            return (
              <div
                key={item.id}
                className="overflow-hidden rounded-2xl border border-black/10"
              >
                {img && (
                  <img
                    src={img}
                    alt={item.title || "Post"}
                    className="aspect-square w-full object-cover"
                  />
                )}
                <div className="p-4">
                  <p className="line-clamp-3 text-[13px] leading-relaxed text-black/70">
                    {item.caption || item.title || "Untitled post"}
                  </p>
                  <span className="mt-2 inline-block rounded-full bg-black/5 px-2 py-0.5 text-[11px] text-black/50">
                    {item.status}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function CopyCard({
  label,
  onCopy,
  copied,
  children,
}: {
  label: string;
  onCopy: () => void;
  copied: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-black/10 p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[12px] font-medium uppercase tracking-wide text-black/40">
          {label}
        </p>
        <button
          onClick={onCopy}
          className="text-[12px] text-[#5b73d6] hover:underline"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      {children}
    </div>
  );
}

/* ---------------- Account setup (stubbed) ---------------- */

function AccountTab({ account }: { account: InfluencerAccount | null }) {
  const hasAccount = account && account.status === "active" && account.username;
  return (
    <section className="max-w-xl">
      <h2
        className="mb-2 text-[22px] sm:text-[26px]"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        Instagram account
      </h2>
      <p className="mb-6 text-[14px] text-black/50">
        Later, your influencer will post from its own Instagram account. For now,
        build the character and generate its content — account connection is
        coming soon.
      </p>

      <div className="rounded-2xl border border-black/10 p-6">
        {hasAccount ? (
          <>
            <p className="text-[13px] text-black/50">Connected account</p>
            <p className="mt-1 text-[18px] font-medium">@{account!.username}</p>
            <span className="mt-3 inline-block rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[12px] text-emerald-600">
              Active
            </span>
          </>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-black/20" />
              <span className="text-[13px] text-black/60">Coming soon</span>
            </div>
            <button
              type="button"
              disabled
              title="Instagram account connection is coming soon"
              className="cursor-not-allowed rounded-full bg-black px-5 py-2.5 text-[14px] font-medium text-white opacity-40"
            >
              Connect Instagram account
            </button>
            <p className="mt-3 text-[12px] text-black/40">
              Automated account creation + posting is on the way. Until then,
              generate posts in the Content tab and download or copy them.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

/* ---------------- Analytics ---------------- */

function AnalyticsTab({
  stats,
  persona,
}: {
  stats: { followers: number; posts: number; engagement: string; views: number };
  persona: Influencer["persona"];
}) {
  return (
    <>
      <section className="mb-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Followers", value: fmt(stats.followers) },
          { label: "Total views", value: fmt(stats.views) },
          { label: "Engagement", value: `${stats.engagement}%` },
          { label: "Posts", value: String(stats.posts) },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-2xl border border-black/10 bg-black/[0.02] p-5"
          >
            <p className="text-[13px] text-black/50">{s.label}</p>
            <p
              className="mt-2 text-[26px] sm:text-[32px]"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {s.value}
            </p>
          </div>
        ))}
      </section>

      {persona?.contentPillars && persona.contentPillars.length > 0 && (
        <section className="mb-10">
          <h3 className="mb-2 text-[13px] uppercase tracking-[0.12em] text-black/40">
            Content pillars
          </h3>
          <div className="flex flex-wrap gap-2">
            {persona.contentPillars.map((p) => (
              <span
                key={p}
                className="rounded-full border border-black/15 px-3.5 py-1.5 text-[13px] text-black/70"
              >
                {p}
              </span>
            ))}
          </div>
        </section>
      )}

      {persona?.personality && (
        <section>
          <h3 className="mb-2 text-[13px] uppercase tracking-[0.12em] text-black/40">
            Personality
          </h3>
          <p className="max-w-2xl text-[14px] leading-relaxed text-black/70">
            {persona.personality}
          </p>
        </section>
      )}
    </>
  );
}
