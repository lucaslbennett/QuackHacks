import { useMemo, useState } from "react";
import {
  generatePost,
  type Generation,
  type GeneratedPost,
} from "../lib/generate";

// Deterministic pseudo-random number from a string seed so each influencer
// shows stable (but distinct) placeholder stats instead of reshuffling on every
// render. Real metrics will replace these once analytics are wired up.
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
  const followers = Math.floor(8_000 + rand() * 240_000);
  const posts = Math.floor(40 + rand() * 600);
  const engagement = (2 + rand() * 9).toFixed(1);
  const views = Math.floor(120_000 + rand() * 4_000_000);
  return { followers, posts, engagement, views };
}

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function InfluencerDetail({
  influencer,
  onBack,
}: {
  influencer: Generation;
  onBack: () => void;
}) {
  const persona = influencer.persona || {};
  const name =
    persona.displayName || influencer.prompt?.slice(0, 40) || "Influencer";
  const handle = persona.handleSuggestions?.[0];
  const niche = persona.niche;

  const stats = useMemo(() => seededStats(influencer.id), [influencer.id]);

  const [post, setPost] = useState<GeneratedPost | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"none" | "all" | "caption" | "tags">(
    "none",
  );

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    setCopied("none");
    try {
      const result = await generatePost({
        persona: influencer.persona,
        prompt: influencer.prompt,
      });
      setPost(result);
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
      /* clipboard unavailable; ignore */
    }
  };

  return (
    <div>
      <button
        onClick={onBack}
        className="mb-8 inline-flex items-center gap-1.5 text-[14px] text-black/50 transition hover:text-black"
      >
        <span aria-hidden>←</span> Back to influencers
      </button>

        {/* Header: portrait + identity */}
        <section className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-center">
          <img
            src={influencer.image_url}
            alt={name}
            className="h-32 w-32 shrink-0 rounded-2xl border border-black/10 object-cover sm:h-40 sm:w-40"
          />
          <div className="min-w-0">
            <h1
              className="text-[36px] leading-tight sm:text-[48px]"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {name}
            </h1>
            {handle && (
              <p className="mt-1 text-[15px] text-[#5b73d6]">@{handle}</p>
            )}
            {niche && (
              <p className="mt-1 text-[14px] text-black/50 capitalize">
                {niche}
              </p>
            )}
            {persona.bio && (
              <p className="mt-3 max-w-lg text-[14px] leading-relaxed text-black/70">
                {persona.bio}
              </p>
            )}
          </div>
        </section>

        {/* Stats */}
        <section className="mb-12 grid grid-cols-2 gap-4 sm:grid-cols-4">
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

        {/* Generate post */}
        <section>
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
              className="rounded-full bg-black px-5 py-2.5 text-[14px] font-medium text-white transition hover:bg-black/80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading
                ? "Generating…"
                : post
                  ? "Generate another post"
                  : "Generate post"}
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
                Click “Generate post” to create a fresh image and caption for{" "}
                {name}. Each one is unique — copy it straight into Instagram.
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
              {/* Image */}
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

              {/* Caption + hashtags, copy-paste ready */}
              <div className="flex flex-col gap-4">
                <div className="rounded-2xl border border-black/10 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[12px] font-medium uppercase tracking-wide text-black/40">
                      Caption
                    </p>
                    <button
                      onClick={() => copy(post.caption, "caption")}
                      className="text-[12px] text-[#5b73d6] hover:underline"
                    >
                      {copied === "caption" ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-black/80">
                    {post.caption}
                  </p>
                </div>

                <div className="rounded-2xl border border-black/10 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[12px] font-medium uppercase tracking-wide text-black/40">
                      Hashtags
                    </p>
                    <button
                      onClick={() => copy(post.hashtagLine, "tags")}
                      className="text-[12px] text-[#5b73d6] hover:underline"
                    >
                      {copied === "tags" ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <p className="break-words text-[14px] leading-relaxed text-[#5b73d6]">
                    {post.hashtagLine}
                  </p>
                </div>

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
        </section>
    </div>
  );
}
