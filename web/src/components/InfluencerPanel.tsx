import { useEffect, useMemo, useState } from "react";
import { publishViaPostiz, type PublishedPost } from "../lib/generate";
import {
  getInfluencer,
  linkPostizChannel,
  type Influencer,
  type ContentItem,
  type InfluencerAccount,
} from "../lib/influencers";
import {
  getPostizStatus,
  getPostizConnectUrl,
  listPostizChannels,
  type PostizChannel,
} from "../lib/postiz";

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
          onConnectAccount={() => setTab("account")}
        />
      )}
      {tab === "account" && (
        <AccountTab
          account={account}
          influencer={influencer}
          onLinked={(link) =>
            setInfluencer((inf) => ({
              ...inf,
              postiz_integration_id: link.postiz_integration_id,
              postiz_platform: link.postiz_platform,
            }))
          }
        />
      )}
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
  onConnectAccount,
}: {
  influencer: Influencer;
  content: ContentItem[];
  onPosted: (item: ContentItem) => void;
  onConnectAccount: () => void;
}) {
  const [post, setPost] = useState<PublishedPost | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = influencer.persona?.displayName || influencer.name;
  const isLinked = Boolean(influencer.postiz_integration_id);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      // Postiz owns the whole flow now: it renders the image, builds the caption
      // from the persona, and publishes the post live to the linked channel.
      const result = await publishViaPostiz(influencer.id);
      setPost(result);
      // Optimistically add the now-published post to the history list (it's
      // persisted server-side too).
      if (result.contentId) {
        onPosted({
          id: result.contentId,
          title: null,
          caption: result.caption,
          hashtags: result.hashtags,
          image_paths: [result.imageUrl],
          video_path: null,
          status: "posted",
          created_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
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
          disabled={loading || !isLinked}
          title={
            isLinked
              ? undefined
              : "Connect a Postiz channel in Account setup before publishing"
          }
          className="rounded-full bg-black px-5 py-2.5 text-[14px] font-medium text-white transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading
            ? "Publishing…"
            : post
              ? "Generate & publish another"
              : "Generate post"}
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}

      {!isLinked && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          <span>
            Connect an Instagram account to publish. It takes a few seconds.
          </span>
          <button
            type="button"
            onClick={onConnectAccount}
            className="shrink-0 rounded-full bg-amber-600 px-4 py-1.5 text-[13px] font-medium text-white transition hover:bg-amber-700"
          >
            Connect Instagram
          </button>
        </div>
      )}

      {!post && !loading && (
        <div className="rounded-2xl border border-dashed border-black/15 p-10 text-center">
          <p className="text-[14px] text-black/50">
            Generate a fresh post for {name} and publish it straight to
            Instagram through Postiz — Postiz handles the photo, caption, and
            posting. Each one is saved to this influencer's content below.
          </p>
        </div>
      )}

      {loading && (
        <div className="rounded-2xl border border-black/10 p-10 text-center">
          <p className="text-[14px] text-black/50">
            Rendering the image and publishing through Postiz…
          </p>
        </div>
      )}

      {post && !loading && (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <div className="overflow-hidden rounded-2xl border border-black/10">
              <img
                src={post.imageUrl}
                alt={post.altText || "Published post"}
                className="aspect-square w-full object-cover"
              />
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <span
                aria-hidden
                className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-[13px] text-white"
              >
                ✓
              </span>
              <p className="text-[14px] font-medium text-emerald-800">
                Published to {post.channelName ? `@${post.channelName}` : post.platform}{" "}
                via Postiz
              </p>
            </div>

            <div className="rounded-2xl border border-black/10 p-4">
              <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-black/40">
                Caption
              </p>
              <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-black/80">
                {post.caption}
              </p>
              {post.hashtagLine && (
                <p className="mt-3 break-words text-[14px] leading-relaxed text-[#5b73d6]">
                  {post.hashtagLine}
                </p>
              )}
            </div>

            {post.channelUrl ? (
              <a
                href={post.channelUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center justify-center gap-1.5 rounded-full bg-[#5b73d6] px-5 py-3 text-[14px] font-medium text-white transition hover:bg-[#4a61c2]"
              >
                See it on Instagram
                <span aria-hidden>↗</span>
              </a>
            ) : (
              <p className="text-[13px] text-black/50">
                Published — it may take a moment to appear on the channel.
              </p>
            )}
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

/* ---------------- Account setup (Postiz channel linking) ---------------- */

// Where users connect a new Instagram account to their Postiz workspace. The
// Postiz Instagram platform identifiers. Standalone connects directly to an IG
// professional account (no Facebook page needed) — the simplest path — so it's
// the default. The FB-linked variant is offered as a fallback.
const IG_STANDALONE = "instagram-standalone";
const IG_FB_LINKED = "instagram";

function AccountTab({
  account,
  influencer,
  onLinked,
}: {
  account: InfluencerAccount | null;
  influencer: Influencer;
  onLinked: (link: {
    postiz_integration_id: string;
    postiz_platform: string;
  }) => void;
}) {
  const [status, setStatus] = useState<
    "loading" | "not_configured" | "disconnected" | "ready" | "error"
  >("loading");
  const [channels, setChannels] = useState<PostizChannel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // "Connecting…" while we wait for the OAuth popup + a new channel to appear.
  const [connecting, setConnecting] = useState(false);

  const linkedId = influencer.postiz_integration_id;

  const fetchChannels = async (): Promise<PostizChannel[]> => {
    const s = await getPostizStatus();
    if (!s.configured) {
      setStatus("not_configured");
      return [];
    }
    if (!s.connected) {
      setStatus("disconnected");
      return [];
    }
    const list = await listPostizChannels();
    setChannels(list);
    setStatus("ready");
    return list;
  };

  const load = async () => {
    setError(null);
    setRefreshing(true);
    try {
      await fetchChannels();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load channels.");
      setStatus("error");
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-link the influencer to a channel as soon as it's connected, so the
  // single shared workspace + one influencer "just works" without an extra
  // click. If multiple channels exist, the user picks one explicitly instead.
  const link = async (channel: PostizChannel) => {
    setLinkingId(channel.id);
    setError(null);
    try {
      const platform = (channel.identifier || "instagram").split("-")[0];
      const result = await linkPostizChannel(influencer.id, channel.id, platform);
      onLinked(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to connect account.");
    } finally {
      setLinkingId(null);
    }
  };

  // In-app connect: open Postiz's OAuth URL in a popup, then poll the channel
  // list until the connection completes (Postiz redirects back to its own
  // domain after auth, so we detect completion by polling rather than a
  // callback). When `refreshId` is given we're re-authorizing an existing
  // (expired/disabled) channel: success = that channel comes back enabled.
  const connect = async (platform: string, refreshId?: string) => {
    setError(null);
    setConnecting(true);
    const before = new Set(channels.map((c) => c.id));
    let popup: Window | null = null;
    try {
      const url = await getPostizConnectUrl(platform, refreshId);
      popup = window.open(url, "postiz-connect", "width=640,height=760");
      if (!popup) {
        // Popup blocked — fall back to a full redirect in a new tab.
        window.open(url, "_blank", "noopener");
      }

      // Poll for up to ~2 minutes for the connection to complete.
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2500));
        let list: PostizChannel[] = [];
        try {
          list = await listPostizChannels();
        } catch {
          continue;
        }
        setChannels(list);
        setStatus("ready");
        // Re-auth: wait for the existing channel to come back enabled.
        if (refreshId) {
          const re = list.find((c) => c.id === refreshId);
          if (re && !re.disabled) {
            if (popup && !popup.closed) popup.close();
            return;
          }
        } else {
          // New connection: wait for a channel id we didn't have before.
          const fresh = list.find((c) => !before.has(c.id));
          if (fresh) {
            if (popup && !popup.closed) popup.close();
            // Auto-link the just-connected account to this influencer.
            await link(fresh);
            return;
          }
        }
        if (popup && popup.closed) {
          // User closed the popup; do a final refresh and stop waiting.
          break;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't connect the account.");
    } finally {
      setConnecting(false);
    }
  };

  const linkedChannel = channels.find((c) => c.id === linkedId);
  const busy = connecting || refreshing;

  return (
    <section className="max-w-xl">
      <h2
        className="mb-2 text-[22px] sm:text-[26px]"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        Instagram account
      </h2>
      <p className="mb-6 text-[14px] text-black/50">
        Connect the Instagram account this influencer posts from. Once connected,
        the Generate post button publishes straight to it.
      </p>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}

      {/* Currently linked banner — turns amber when the channel needs re-auth. */}
      {linkedId &&
        (linkedChannel?.disabled ? (
          <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            {linkedChannel?.picture && (
              <img
                src={linkedChannel.picture}
                alt=""
                className="h-10 w-10 rounded-full object-cover opacity-70"
              />
            )}
            <div className="min-w-0">
              <p className="text-[13px] text-amber-700">Connection expired</p>
              <p className="truncate text-[16px] font-medium text-amber-900">
                @{linkedChannel?.profile || linkedChannel?.name || "Instagram"}
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                connect(linkedChannel.identifier || "instagram", linkedChannel.id)
              }
              disabled={busy}
              className="ml-auto rounded-full bg-amber-600 px-4 py-1.5 text-[13px] font-medium text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {connecting ? "Reconnecting…" : "Reconnect"}
            </button>
          </div>
        ) : (
          <div className="mb-6 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            {linkedChannel?.picture && (
              <img
                src={linkedChannel.picture}
                alt=""
                className="h-10 w-10 rounded-full object-cover"
              />
            )}
            <div className="min-w-0">
              <p className="text-[13px] text-emerald-700">Connected account</p>
              <p className="truncate text-[16px] font-medium text-emerald-900">
                @{linkedChannel?.profile || linkedChannel?.name || "Instagram"}
              </p>
            </div>
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[12px] font-medium text-emerald-700">
              <span aria-hidden>✓</span> Active
            </span>
          </div>
        ))}

      {status === "loading" && (
        <div className="rounded-2xl border border-black/10 p-8 text-center text-[14px] text-black/50">
          Checking your connected accounts…
        </div>
      )}

      {status === "not_configured" && (
        <div className="rounded-2xl border border-black/10 p-6">
          <p className="text-[14px] text-black/70">
            Posting isn't set up on this server yet. Add a{" "}
            <code className="rounded bg-black/5 px-1.5 py-0.5 text-[13px]">
              POSTIZ_API_KEY
            </code>{" "}
            to enable publishing to Instagram.
          </p>
        </div>
      )}

      {status === "disconnected" && (
        <div className="rounded-2xl border border-black/10 p-6">
          <p className="mb-4 text-[14px] text-black/70">
            We couldn't reach your posting account. Double-check the connection,
            then try again.
          </p>
          <button
            type="button"
            onClick={load}
            className="rounded-full border border-black/15 px-4 py-2 text-[14px] font-medium transition hover:bg-black/5"
          >
            Try again
          </button>
        </div>
      )}

      {status === "ready" && (
        <div className="rounded-2xl border border-black/10 p-5">
          {/* Existing channels (if any) to pick from */}
          {channels.length > 0 && (
            <>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[13px] font-medium uppercase tracking-wide text-black/40">
                  Your accounts
                </p>
                <button
                  type="button"
                  onClick={load}
                  disabled={busy}
                  className="text-[13px] text-[#5b73d6] transition hover:underline disabled:opacity-50"
                >
                  {refreshing ? "Refreshing…" : "Refresh"}
                </button>
              </div>
              <ul className="mb-5 flex flex-col gap-2">
                {channels.map((c) => {
                  const isLinked = c.id === linkedId;
                  const isBusy = linkingId === c.id;
                  return (
                    <li
                      key={c.id}
                      className="flex items-center gap-3 rounded-xl border border-black/10 px-3 py-2.5"
                    >
                      {c.picture ? (
                        <img
                          src={c.picture}
                          alt=""
                          className="h-9 w-9 rounded-full object-cover"
                        />
                      ) : (
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/5 text-[13px] text-black/40">
                          {(c.profile || c.name || "?").slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-[14px] font-medium">
                          @{c.profile || c.name || "account"}
                        </p>
                        <p className="text-[12px] capitalize text-black/40">
                          {(c.identifier || "instagram").split("-")[0]}
                          {c.disabled && (
                            <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium normal-case text-amber-700">
                              Needs reconnect
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="ml-auto">
                        {c.disabled ? (
                          // Expired/disabled channel: re-authorize it in place.
                          <button
                            type="button"
                            onClick={() =>
                              connect(c.identifier || "instagram", c.id)
                            }
                            disabled={busy}
                            className="rounded-full bg-amber-600 px-4 py-1.5 text-[13px] font-medium text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {connecting ? "Reconnecting…" : "Reconnect"}
                          </button>
                        ) : isLinked ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1.5 text-[13px] font-medium text-emerald-700">
                            <span aria-hidden>✓</span> Connected
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => link(c)}
                            disabled={isBusy}
                            className="rounded-full bg-black px-4 py-1.5 text-[13px] font-medium text-white transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isBusy ? "Connecting…" : "Use this"}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {/* In-app connect a brand-new Instagram account */}
          <div
            className={
              channels.length > 0 ? "border-t border-black/10 pt-5" : ""
            }
          >
            {channels.length === 0 && (
              <p className="mb-3 text-[14px] text-black/60">
                No Instagram account connected yet. Connect one to start
                publishing — it opens a secure Instagram login and takes a few
                seconds.
              </p>
            )}
            <button
              type="button"
              onClick={() => connect(IG_STANDALONE)}
              disabled={busy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#8a3ab9] via-[#e95950] to-[#fccc63] px-5 py-3 text-[14px] font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {connecting
                ? "Waiting for Instagram…"
                : channels.length > 0
                  ? "Connect another Instagram account"
                  : "Connect Instagram account"}
            </button>
            {connecting && (
              <p className="mt-3 text-center text-[12px] text-black/50">
                Finish signing in to Instagram in the popup. This page updates
                automatically once it's connected.
              </p>
            )}
            <p className="mt-3 text-center text-[12px] text-black/40">
              Instagram needs a Business or Creator account. Have a
              Facebook-linked Instagram instead?{" "}
              <button
                type="button"
                onClick={() => connect(IG_FB_LINKED)}
                disabled={busy}
                className="text-[#5b73d6] hover:underline disabled:opacity-50"
              >
                Connect via Facebook
              </button>
            </p>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="rounded-2xl border border-black/10 p-6">
          <button
            type="button"
            onClick={load}
            className="rounded-full border border-black/15 px-4 py-2 text-[14px] font-medium transition hover:bg-black/5"
          >
            Try again
          </button>
        </div>
      )}

      {/* Legacy auto-created IG account note, shown only if one exists. */}
      {account && account.status === "active" && account.username && (
        <p className="mt-4 text-[12px] text-black/40">
          Auto-created account on file: @{account.username}
        </p>
      )}
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
