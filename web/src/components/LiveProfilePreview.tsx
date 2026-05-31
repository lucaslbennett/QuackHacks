import { useCallback, useEffect, useState } from "react";
import { getLiveProfile, type LiveProfile } from "../lib/influencers";
import InfluencerImage from "./InfluencerImage";

function fmt(n: number | null | undefined) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function LiveDot() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[12px] font-medium text-emerald-700">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      Live
    </span>
  );
}

export default function LiveProfilePreview({
  influencerId,
  linked,
  refreshToken = 0,
}: {
  influencerId: string;
  linked: boolean;
  refreshToken?: number;
}) {
  const [profile, setProfile] = useState<LiveProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (refresh = false) => {
      setError(null);
      if (refresh) setRefreshing(true);
      else setLoading(true);
      getLiveProfile(influencerId, { refresh })
        .then(setProfile)
        .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load profile"))
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        });
    },
    [influencerId],
  );

  useEffect(() => {
    load(false);
  }, [load, refreshToken]);

  useEffect(() => {
    if (!linked || !profile?.live.instagram) return;
    const t = setInterval(() => load(false), 15 * 60_000);
    return () => clearInterval(t);
  }, [linked, load, profile?.live.instagram]);

  const handle = profile?.handle;
  const showLive = profile?.live.instagram;
  const igBio = profile?.bioSource === "instagram";

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h2
          className="text-[22px] sm:text-[26px]"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Live profile
        </h2>
        {showLive && <LiveDot />}
        <button
          type="button"
          onClick={() => load(true)}
          disabled={refreshing || loading}
          className="ml-auto rounded-lg border border-black/10 bg-white px-3 py-1.5 text-[13px] font-medium text-black/70 transition hover:bg-black/[0.03] disabled:opacity-50"
        >
          {refreshing ? "Refreshing from Instagram…" : "Refresh from Instagram"}
        </button>
      </div>
      <p className="mb-8 max-w-xl text-[14px] text-black/50">
        Pulls the public Instagram profile — bio, follower counts, and post grid.
        {profile?.scrapedAt && (
          <>
            {" "}
            Last synced{" "}
            {new Date(profile.scrapedAt).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            .
          </>
        )}
      </p>

      <div className="mx-auto w-full max-w-md">
        <div className="overflow-hidden rounded-2xl border border-black/10 bg-black/[0.02] shadow-[0_2px_16px_rgba(0,0,0,0.04)]">
          {loading && !profile ? (
            <div className="p-10 text-center text-[14px] text-black/45">Loading…</div>
          ) : error && !profile ? (
            <div className="p-6 text-[13px] text-red-600">{error}</div>
          ) : profile ? (
            <>
              <div className="flex items-center justify-between border-b border-black/5 px-4 py-3">
                <span className="text-[13px] text-black/35" aria-hidden>
                  @
                </span>
                <p className="truncate text-[15px] font-medium text-black">
                  {handle ? `@${handle}` : "username"}
                </p>
                {profile.channelUrl ? (
                  <a
                    href={profile.channelUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[12px] font-medium text-[#5b73d6] hover:underline"
                  >
                    Open ↗
                  </a>
                ) : (
                  <span className="w-8" />
                )}
              </div>

              <div className="px-4 py-4">
                <div className="flex items-center gap-4">
                  <div className="shrink-0 rounded-2xl border border-black/10 bg-white p-0.5">
                    <InfluencerImage
                      src={profile.profilePicture}
                      name={profile.displayName}
                      className="h-[72px] w-[72px] rounded-[14px] object-cover sm:h-20 sm:w-20"
                      fallbackClassName="flex h-[72px] w-[72px] items-center justify-center rounded-[14px] bg-black/[0.04] text-[22px] text-black/25 sm:h-20 sm:w-20"
                    />
                  </div>
                  <div className="grid flex-1 grid-cols-3 gap-1 text-center">
                    <Stat
                      value={fmt(profile.stats.posts)}
                      label="Posts"
                      live={profile.live.instagram && profile.stats.posts > 0}
                    />
                    <Stat
                      value={fmt(profile.stats.followers)}
                      label="Followers"
                      live={profile.live.followers}
                    />
                    <Stat
                      value={fmt(profile.stats.following)}
                      label="Following"
                      live={profile.live.following}
                    />
                  </div>
                </div>

                <div className="mt-4">
                  <p
                    className="text-[15px] font-medium text-black"
                    style={{ fontFamily: "var(--font-heading)" }}
                  >
                    {profile.displayName}
                  </p>
                  {profile.bio ? (
                    <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-black/65">
                      {profile.bio}
                    </p>
                  ) : (
                    <p className="mt-1 text-[13px] italic text-black/35">No bio yet</p>
                  )}
                  {profile.bio && (
                    <p className="mt-1.5 text-[11px] text-black/40">
                      {igBio ? "Bio from Instagram" : "Bio from your character setup (Instagram not synced yet)"}
                    </p>
                  )}
                </div>
              </div>

              <div className="border-t border-black/5">
                <div className="flex border-b border-black/5 px-4 py-2">
                  <span className="border-b-2 border-black px-1 pb-1 text-[12px] font-medium uppercase tracking-wide text-black/70">
                    Posts
                  </span>
                </div>
                {profile.posts.length === 0 ? (
                  <p className="px-4 py-10 text-center text-[13px] text-black/40">
                    {profile.canScrapeInstagram
                      ? "No post thumbnails yet — tap Refresh from Instagram."
                      : "Connect scraping (BROWSER_USE_API_KEY) to load the live post grid."}
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-0.5 bg-black/5 p-0.5">
                    {profile.posts.map((post) => (
                      <div
                        key={post.id}
                        className="relative aspect-square overflow-hidden bg-white"
                      >
                        <InfluencerImage
                          src={post.imageUrl}
                          name={post.caption || "Post"}
                          className="h-full w-full object-cover"
                          fallbackClassName="flex h-full w-full items-center justify-center bg-black/[0.04] text-[11px] text-black/30"
                          fallbackTextClassName="text-[11px] text-black/30"
                        />
                        {post.source !== "instagram" && post.status === "scheduled" && (
                          <span className="absolute left-1 top-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] font-medium text-white">
                            Scheduled
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>

        {profile?.limitations && profile.limitations.length > 0 && (
          <ul className="mt-4 space-y-1 text-[12px] leading-relaxed text-black/45">
            {profile.limitations.map((note) => (
              <li key={note}>• {note}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Stat({
  value,
  label,
  live,
  title,
}: {
  value: string;
  label: string;
  live?: boolean;
  title?: string;
}) {
  return (
    <div title={title}>
      <p className="flex items-center justify-center gap-1 text-[16px] font-semibold tabular-nums text-black">
        {value}
        {live && value !== "—" && (
          <span className="h-1 w-1 rounded-full bg-emerald-500" aria-hidden />
        )}
      </p>
      <p className="text-[11px] text-black/45">{label}</p>
    </div>
  );
}
