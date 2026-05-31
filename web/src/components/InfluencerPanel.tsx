import { useCallback, useEffect, useMemo, useState } from "react";
import {
  generatePostPreview,
  publishPostPreview,
  type PostPreview,
  type PublishedPost,
} from "../lib/generate";
import {
  deleteInfluencer,
  getInfluencer,
  linkPostizChannel,
  unlinkPostizChannel,
  updateInfluencerHandle,
  getPostingSchedule,
  type Influencer,
  type ContentItem,
  type InfluencerAccount,
} from "../lib/influencers";
import {
  getPostizStatus,
  getPostizConnectUrl,
  listPostizChannels,
  deletePostizChannel,
  friendlyPostizError,
  type PostizChannel,
} from "../lib/postiz";
import {
  getInfluencerAnalytics,
  getCachedInfluencerAnalytics,
  prefetchInfluencerAnalytics,
  type InfluencerAnalytics,
} from "../lib/analytics";
import InfluencerImage from "./InfluencerImage";
import InfluencerCustomizeTab from "./InfluencerCustomizeTab";
import PostingScheduleModal from "./PostingScheduleModal";
import type { PostingScheduleSummary } from "../lib/influencers";
import { postTimeCaption, latestAutopilotContent, autopilotStatusLabel, hashtagLine } from "../lib/postTime";

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// Downloads an image to the user's device. Fetches it as a blob so cross-origin
// images (e.g. CDN URLs) download instead of just navigating, then falls back to
// opening in a new tab if the fetch is blocked.
async function downloadImage(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const ext = blob.type.split("/")[1] || "png";
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `${filename}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

type Tab = "content" | "account" | "analytics" | "customize";

export default function InfluencerPanel({
  influencer: initial,
  onBack,
  onDeleted,
}: {
  influencer: Influencer;
  onBack: () => void;
  onDeleted?: () => void;
}) {
  // The list row is the seed; we fetch the full detail (account/content/metrics).
  const [influencer, setInfluencer] = useState<Influencer>(initial);
  const [account, setAccount] = useState<InfluencerAccount | null>(null);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [tab, setTab] = useState<Tab>("content");
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // Connected Postiz channels, fetched once at the panel level so both the
  // header link bar and the Account tab can resolve the linked account's handle.
  const [channels, setChannels] = useState<PostizChannel[]>([]);
  const [unlinking, setUnlinking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const persona = influencer.persona || {};
  const name = persona.displayName || influencer.name;
  const handle = persona.handleSuggestions?.[0] || influencer.handle;
  const niche = persona.niche || influencer.niche;

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

  // Start analytics while the user is on Content/Account so Analytics opens fast.
  useEffect(() => {
    prefetchInfluencerAnalytics(initial.id);
  }, [initial.id]);

  // Load connected channels (best-effort) so we can show the linked account's
  // handle/avatar in the persistent header bar.
  const loadChannels = () => {
    listPostizChannels()
      .then(setChannels)
      .catch(() => setChannels([]));
  };
  useEffect(() => {
    loadChannels();
  }, []);

  const handleContentSync = useCallback((items: ContentItem[], inf?: Influencer) => {
    setContent(items);
    if (inf) setInfluencer(inf);
  }, []);

  // Applied when a channel is linked/changed (from the Account tab or the bar).
  const applyLink = (linked: Partial<Influencer>) => {
    setInfluencer((inf) => ({ ...inf, ...linked }));
  };

  // Remove the currently linked account.
  const handleUnlink = async () => {
    setUnlinking(true);
    setLoadErr(null);
    try {
      const link = await unlinkPostizChannel(influencer.id);
      applyLink(link);
    } catch (e) {
      setLoadErr(
        e instanceof Error ? e.message : "Couldn't remove the linked account.",
      );
    } finally {
      setUnlinking(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setLoadErr(null);
    try {
      await deleteInfluencer(influencer.id);
      onDeleted?.();
    } catch (e) {
      setLoadErr(
        e instanceof Error ? e.message : "Couldn't delete this influencer.",
      );
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  const linkedChannel = channels.find(
    (c) => c.id === influencer.postiz_integration_id,
  );

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
        <div className="flex shrink-0 flex-col items-center gap-2">
          <InfluencerImage
            src={influencer.image_url}
            name={name}
            className="h-32 w-32 rounded-2xl border border-black/10 object-cover sm:h-40 sm:w-40"
            fallbackClassName="flex h-32 w-32 items-center justify-center rounded-2xl border border-black/10 bg-black/[0.04] sm:h-40 sm:w-40"
            fallbackTextClassName="text-[48px] text-black/20"
          />
          {influencer.image_url && (
            <button
              type="button"
              onClick={() =>
                downloadImage(
                  influencer.image_url as string,
                  `${(influencer.handle || name).replace(/[^a-z0-9]+/gi, "-")}-profile`,
                )
              }
              className="inline-flex items-center gap-1.5 rounded-full border border-black/15 px-3 py-1.5 text-[12px] font-medium text-black/70 transition hover:bg-black/5"
            >
              <span aria-hidden>↓</span> Download
            </button>
          )}
        </div>
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
          <p className="mt-1">
            <EditableHandle
              influencerId={influencer.id}
              value={influencer.handle || handle || null}
              onSaved={(h) =>
                setInfluencer((inf) => ({ ...inf, handle: h || null }))
              }
              size="lg"
            />
          </p>
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

      {/* Persistent linked-account bar — link, change, or remove the account
          this influencer posts to, from any tab. */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-black/10 bg-black/[0.02] px-4 py-3">
        {influencer.postiz_integration_id ? (
          <>
            {linkedChannel?.picture ? (
              <img
                src={linkedChannel.picture}
                alt=""
                className="h-8 w-8 rounded-full object-cover"
              />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/15 text-[13px] text-emerald-700">
                ✓
              </span>
            )}
            <div className="min-w-0">
              <p className="text-[12px] text-black/40">Linked account</p>
              <p className="truncate text-[14px] font-medium">
                @{linkedChannel?.profile || linkedChannel?.name || "Instagram"}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTab("account")}
                className="rounded-full border border-black/15 px-4 py-1.5 text-[13px] font-medium transition hover:bg-black/5"
              >
                Change
              </button>
              <button
                type="button"
                onClick={handleUnlink}
                disabled={unlinking}
                className="rounded-full border border-red-200 px-4 py-1.5 text-[13px] font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
              >
                {unlinking ? "Removing…" : "Remove"}
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/5 text-[15px] text-black/30">
              ⊕
            </span>
            <div className="min-w-0">
              <p className="text-[12px] text-black/40">No account linked</p>
              <p className="text-[14px] font-medium">
                Link an Instagram account to publish
              </p>
            </div>
            <button
              type="button"
              onClick={() => setTab("account")}
              className="ml-auto rounded-full bg-black px-4 py-1.5 text-[13px] font-medium text-white transition hover:opacity-80"
            >
              Link Instagram
            </button>
          </>
        )}
      </div>

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
            ["customize", "Customize"],
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
          onPosted={(item) => {
            setContent((c) => [item, ...c]);
          }}
          onContentSync={handleContentSync}
          onViewAnalytics={() => setTab("analytics")}
          onHandleSaved={(h) =>
            setInfluencer((inf) => ({ ...inf, handle: h || null }))
          }
        />
      )}
      {tab === "account" && (
        <AccountTab
          account={account}
          influencer={influencer}
          onLinked={(link) => {
            applyLink(link);
            loadChannels();
          }}
        />
      )}
      {tab === "customize" && (
        <InfluencerCustomizeTab
          influencer={influencer}
          onSaved={(inf) => setInfluencer(inf)}
        />
      )}
      {tab === "analytics" && (
        <AnalyticsTab influencer={influencer} persona={persona} />
      )}

      <section className="mt-12 rounded-2xl border border-black/10 p-6">
        <h3 className="text-[13px] uppercase tracking-[0.12em] text-black/40">
          Danger zone
        </h3>
        <p className="mt-2 max-w-lg text-[14px] leading-relaxed text-black/55">
          Permanently delete {name} and all of their generated posts. This cannot
          be undone.
        </p>
        {confirmDelete ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="rounded-full bg-red-600 px-5 py-2 text-[13px] font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Yes, delete permanently"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
              className="rounded-full border border-black/15 px-5 py-2 text-[13px] text-black/70 transition hover:bg-black/[0.04] disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="mt-4 rounded-full border border-black/15 px-5 py-2 text-[13px] font-medium text-black/70 transition hover:border-red-300 hover:text-red-600"
          >
            Delete influencer
          </button>
        )}
      </section>
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

/* ---------------- Editable Instagram @handle ---------------- */

// Inline-editable @handle. Click "Edit" to turn it into a text field; Enter or
// the check saves, Escape cancels. Persists via PATCH and reports the new value
// up so every place that shows the handle updates at once. `size` tunes the
// typography for the big header vs smaller inline placements.
function EditableHandle({
  influencerId,
  value,
  onSaved,
  size = "sm",
}: {
  influencerId: string;
  value: string | null;
  onSaved: (handle: string) => void;
  size?: "lg" | "sm";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textCls = size === "lg" ? "text-[15px]" : "text-[13px]";

  const start = () => {
    setDraft(value || "");
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    const clean = draft.trim().replace(/^@+/, "");
    if (clean === (value || "")) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateInfluencerHandle(influencerId, clean);
      onSaved(updated.handle || "");
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save username.");
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className={`${textCls} text-[#5b73d6]`}>@</span>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          disabled={saving}
          placeholder="username"
          className={`${textCls} w-40 rounded-md border border-black/15 bg-white px-2 py-0.5 text-black outline-none focus:border-[#5b73d6]`}
        />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-[#5b73d6] px-2 py-0.5 text-[12px] font-medium text-white transition hover:bg-[#4a61c2] disabled:opacity-50"
        >
          {saving ? "…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={saving}
          className="text-[12px] text-black/40 hover:text-black"
        >
          Cancel
        </button>
        {error && <span className="text-[12px] text-red-600">{error}</span>}
      </span>
    );
  }

  return (
    <span className="group inline-flex items-center gap-1.5">
      <span className={`${textCls} text-[#5b73d6]`}>
        {value ? `@${value}` : "Set a username"}
      </span>
      <button
        type="button"
        onClick={start}
        className="text-[12px] text-black/40 underline-offset-2 transition hover:text-black hover:underline"
      >
        Edit
      </button>
    </span>
  );
}

/* ---------------- Content & posting ---------------- */

function hashtagsToEditText(tags: string[]): string {
  return tags.map((h) => h.replace(/^#+/, "")).join("\n");
}

function editTextToHashtags(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .flatMap((line) => line.split(/\s+/))
    .map((h) => h.trim().replace(/^#+/, ""))
    .filter(Boolean);
}

const draftFieldCls =
  "w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-[14px] leading-relaxed text-black outline-none transition focus:border-[#5b73d6]/50 focus:ring-2 focus:ring-[#5b73d6]/15";

function scheduleSummaryFromPostingSchedule(
  s: Influencer["posting_schedule"],
): PostingScheduleSummary | null {
  if (!s?.enabled) return null;
  return {
    active: true,
    mode: s.mode === "random" ? "random" : "fixed",
    summary:
      s.mode === "random"
        ? s.intervalMinutes === 5
          ? "Every ~5 min"
          : s.intervalMinutes === 60
            ? "Every ~1h"
            : s.intervalMinutes === 1440
              ? "Every ~24h"
              : `Every ~${(s.intervalMinutes ?? 360) / 60}h`
        : `Daily at ${(s.times || []).join(" & ")}`,
    nextRunAt: s.nextRunAt,
    intervalMinutes: s.intervalMinutes,
  };
}

function ContentTab({
  influencer,
  content,
  onPosted,
  onContentSync,
  onViewAnalytics,
  onHandleSaved,
}: {
  influencer: Influencer;
  content: ContentItem[];
  onPosted: (item: ContentItem) => void;
  onContentSync: (items: ContentItem[], influencer?: Influencer) => void;
  onViewAnalytics: () => void;
  onHandleSaved: (handle: string) => void;
}) {
  // Two-step flow: generate a draft (preview) → review → publish.
  const [preview, setPreview] = useState<PostPreview | null>(null);
  const [draftCaption, setDraftCaption] = useState("");
  const [draftHashtagsText, setDraftHashtagsText] = useState("");
  const [post, setPost] = useState<PublishedPost | null>(null);
  const [loading, setLoading] = useState(false); // generating a preview
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [autopilotIssue, setAutopilotIssue] = useState<string | null>(null);
  const [scheduleSummary, setScheduleSummary] = useState<PostingScheduleSummary | null>(() =>
    scheduleSummaryFromPostingSchedule(influencer.posting_schedule),
  );
  const name = influencer.persona?.displayName || influencer.name;
  const isLinked = Boolean(influencer.postiz_integration_id);
  const draftHashtags = useMemo(() => editTextToHashtags(draftHashtagsText), [draftHashtagsText]);
  const draftHashtagLine = useMemo(() => hashtagLine(draftHashtags), [draftHashtags]);
  const latestAutopilot = useMemo(() => latestAutopilotContent(content), [content]);
  const manualFlowActive = Boolean(preview || post || loading);

  useEffect(() => {
    setScheduleSummary(scheduleSummaryFromPostingSchedule(influencer.posting_schedule));
  }, [influencer.id, influencer.posting_schedule]);

  // Poll while autopilot is on so the hero updates when a new post is generated.
  useEffect(() => {
    if (!scheduleSummary?.active) return;
    let active = true;
    const refresh = () => {
      Promise.all([getInfluencer(influencer.id), getPostingSchedule(influencer.id)])
        .then(([detail, sched]) => {
          if (!active) return;
          onContentSync(detail.content, detail.influencer);
          const s = detail.influencer.posting_schedule;
          if (s?.enabled) {
            setScheduleSummary((prev) =>
              prev?.active
                ? {
                    ...prev,
                    nextRunAt: s.nextRunAt ?? prev.nextRunAt,
                  }
                : prev,
            );
          }
          if (sched.autopilotBlocked) {
            setAutopilotIssue(sched.autopilotBlocked);
          } else if (sched.lastAutopilotJob?.status === "failed" && sched.lastAutopilotJob.lastError) {
            setAutopilotIssue(`Autopilot failed: ${sched.lastAutopilotJob.lastError}`);
          } else {
            setAutopilotIssue(null);
          }
        })
        .catch(() => {});
    };
    refresh();
    const ms =
      scheduleSummary.intervalMinutes === 5 || influencer.posting_schedule?.intervalMinutes === 5
        ? 15_000
        : 30_000;
    const t = setInterval(refresh, ms);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [
    scheduleSummary?.active,
    scheduleSummary?.intervalMinutes,
    influencer.id,
    influencer.posting_schedule?.intervalMinutes,
    onContentSync,
  ]);

  // Step 1: generate the image + caption and show it for review (no publish).
  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    setPost(null);
    try {
      const result = await generatePostPreview(influencer.id);
      setPreview(result);
      setDraftCaption(result.caption);
      setDraftHashtagsText(hashtagsToEditText(result.hashtags));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  // Step 2: publish the reviewed draft through Postiz.
  const handlePublish = async () => {
    if (!preview) return;
    setPublishing(true);
    setError(null);
    try {
      const hashtags = editTextToHashtags(draftHashtagsText);
      const result = await publishPostPreview(influencer.id, preview.contentId, {
        caption: draftCaption.trim(),
        hashtags,
      });
      setPost(result);
      setPreview(null);
      // Add the now-published post to the history list (persisted server-side).
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
          posted_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't publish the post.");
    } finally {
      setPublishing(false);
    }
  };

  // Discard the current draft and start over.
  const handleDiscard = () => {
    setPreview(null);
    setDraftCaption("");
    setDraftHashtagsText("");
    setError(null);
  };

  return (
    <>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h2
          className="text-[22px] sm:text-[26px]"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Create a post
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSchedule(true)}
            className="rounded-full border border-black/20 px-5 py-2.5 text-[14px] font-medium transition hover:bg-black hover:text-white"
          >
            Posting schedule
            {scheduleSummary?.active && (
              <span className="ml-1.5 inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            )}
          </button>
          <button
            onClick={handleGenerate}
            disabled={loading || publishing || !isLinked}
            title={
              isLinked
                ? undefined
                : "Connect a Postiz channel in Account setup before publishing"
            }
            className="rounded-full bg-black px-5 py-2.5 text-[14px] font-medium text-white transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading
              ? "Generating…"
              : preview || post
                ? "Generate another"
                : "Generate post"}
          </button>
        </div>
      </div>
      {scheduleSummary?.active && (
        <p className="mb-3 text-[13px] text-emerald-700">
          Autopilot on — {scheduleSummary.summary}
          {scheduleSummary.nextRunAt && (
            <>
              {" "}
              · next around{" "}
              {new Date(scheduleSummary.nextRunAt).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </>
          )}
        </p>
      )}
      {scheduleSummary?.active && autopilotIssue && isLinked && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {autopilotIssue}
        </div>
      )}
      <div className="mb-4 flex items-center gap-2 text-[13px] text-black/50">
        <span>Posting as</span>
        <EditableHandle
          influencerId={influencer.id}
          value={influencer.handle || null}
          onSaved={onHandleSaved}
        />
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}

      {!manualFlowActive && scheduleSummary?.active && latestAutopilot && (
        <AutopilotPostHero
          item={latestAutopilot}
          onViewAnalytics={onViewAnalytics}
        />
      )}

      {!manualFlowActive && scheduleSummary?.active && !latestAutopilot && (
        <div className="rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/50 p-10 text-center">
          <p className="text-[14px] text-emerald-800">
            Autopilot is on — the next post for {name} will appear here once it&apos;s
            generated.
            {scheduleSummary.nextRunAt && (
              <>
                {" "}
                Expected around{" "}
                {new Date(scheduleSummary.nextRunAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
                .
              </>
            )}
          </p>
        </div>
      )}

      {!manualFlowActive && !scheduleSummary?.active && (
        <div className="rounded-2xl border border-dashed border-black/15 p-10 text-center">
          <p className="text-[14px] text-black/50">
            Generate a fresh post for {name}. You&apos;ll get to review the image and
            caption, then publish it to Instagram through Postiz when you&apos;re
            happy with it.
          </p>
        </div>
      )}

      {loading && (
        <div className="rounded-2xl border border-black/10 p-10 text-center">
          <p className="text-[14px] text-black/50">
            Generating the image and caption for review…
          </p>
        </div>
      )}

      {/* Step: review the generated draft, then publish or regenerate. */}
      {preview && !loading && (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <div className="overflow-hidden rounded-2xl border border-black/10">
              <img
                src={preview.imageUrl}
                alt={preview.altText || "Generated post"}
                className="aspect-square w-full object-cover"
              />
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 rounded-2xl border border-[#5b73d6]/30 bg-[#5b73d6]/5 px-4 py-3">
              <span
                aria-hidden
                className="flex h-6 w-6 items-center justify-center rounded-full bg-[#5b73d6] text-[13px] text-white"
              >
                ✎
              </span>
              <p className="text-[14px] font-medium text-[#3f54b3]">
                Edit the caption and hashtags, then publish
              </p>
            </div>

            <div className="rounded-2xl border border-black/10 p-4">
              <label className="block">
                <span className="mb-2 block text-[12px] font-medium uppercase tracking-wide text-black/40">
                  Caption
                </span>
                <textarea
                  value={draftCaption}
                  onChange={(e) => setDraftCaption(e.target.value)}
                  rows={5}
                  className={`${draftFieldCls} min-h-[120px] resize-y`}
                  placeholder="Write the caption…"
                />
              </label>
              <label className="mt-4 block">
                <span className="mb-2 block text-[12px] font-medium uppercase tracking-wide text-black/40">
                  Hashtags
                </span>
                <textarea
                  value={draftHashtagsText}
                  onChange={(e) => setDraftHashtagsText(e.target.value)}
                  rows={3}
                  className={`${draftFieldCls} min-h-[72px] resize-y font-mono text-[13px]`}
                  placeholder="One per line — # optional"
                />
              </label>
              {draftHashtagLine && (
                <p className="mt-3 break-words text-[13px] leading-relaxed text-[#5b73d6]/80">
                  Preview: {draftHashtagLine}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handlePublish}
                disabled={publishing || !isLinked || !draftCaption.trim()}
                title={
                  isLinked
                    ? undefined
                    : "Connect a Postiz channel in Account setup before publishing"
                }
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-emerald-600 px-5 py-3 text-[14px] font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {publishing ? "Publishing…" : "Publish to Instagram"}
                {!publishing && <span aria-hidden>↗</span>}
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={publishing}
                className="rounded-full border border-black/15 px-5 py-3 text-[14px] font-medium text-black/80 transition hover:bg-black/5 disabled:opacity-50"
              >
                Regenerate
              </button>
              <button
                type="button"
                onClick={handleDiscard}
                disabled={publishing}
                className="rounded-full px-3 py-3 text-[14px] font-medium text-black/40 transition hover:text-black disabled:opacity-50"
              >
                Discard
              </button>
            </div>
          </div>
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
            <button
              type="button"
              onClick={onViewAnalytics}
              className="inline-flex items-center justify-center gap-1.5 rounded-full border border-black/15 px-5 py-3 text-[14px] font-medium text-black/80 transition hover:bg-black/5"
            >
              View analytics
              <span aria-hidden>→</span>
            </button>
          </div>
        </div>
      )}

      {showSchedule && (
        <PostingScheduleModal
          influencerId={influencer.id}
          isLinked={isLinked}
          onClose={() => setShowSchedule(false)}
          onSaved={(summary: PostingScheduleSummary) =>
            setScheduleSummary(summary.active ? summary : null)
          }
        />
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
            const timeLabel = postTimeCaption(item);
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
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="inline-block rounded-full bg-black/5 px-2 py-0.5 text-[11px] capitalize text-black/50">
                      {item.status}
                    </span>
                    {timeLabel && (
                      <span className="text-[11px] text-black/45">{timeLabel}</span>
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

function AutopilotPostHero({
  item,
  onViewAnalytics,
}: {
  item: ContentItem;
  onViewAnalytics: () => void;
}) {
  const img = item.image_paths?.[0];
  const tags = hashtagLine(item.hashtags);
  const { headline, sub, posted } = autopilotStatusLabel(item);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <div>
        <div className="overflow-hidden rounded-2xl border border-black/10">
          {img ? (
            <img
              src={img}
              alt={item.meta?.altText || item.caption || "Autopilot post"}
              className="aspect-square w-full object-cover"
            />
          ) : (
            <div className="flex aspect-square items-center justify-center bg-black/[0.04] text-[14px] text-black/40">
              Generating image…
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div
          className={`flex items-center gap-2 rounded-2xl border px-4 py-3 ${
            posted
              ? "border-emerald-200 bg-emerald-50"
              : "border-[#5b73d6]/30 bg-[#5b73d6]/5"
          }`}
        >
          <span
            aria-hidden
            className={`flex h-6 w-6 items-center justify-center rounded-full text-[13px] text-white ${
              posted ? "bg-emerald-500" : "bg-[#5b73d6]"
            }`}
          >
            {posted ? "✓" : "◷"}
          </span>
          <div>
            <p
              className={`text-[14px] font-medium ${posted ? "text-emerald-800" : "text-[#3f54b3]"}`}
            >
              {headline}
            </p>
            {sub && (
              <p className={`text-[12px] ${posted ? "text-emerald-700/80" : "text-[#3f54b3]/80"}`}>
                {sub}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-black/10 p-4">
          <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-black/40">
            Caption
          </p>
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-black/80">
            {item.caption || "—"}
          </p>
          {tags && (
            <p className="mt-3 break-words text-[14px] leading-relaxed text-[#5b73d6]">{tags}</p>
          )}
        </div>

        <p className="text-[13px] text-black/45">
          Stays here until the next autopilot post replaces it. Use Generate post above for a
          one-off draft you review yourself.
        </p>

        <button
          type="button"
          onClick={onViewAnalytics}
          className="inline-flex items-center justify-center gap-1.5 rounded-full border border-black/15 px-5 py-3 text-[14px] font-medium text-black/80 transition hover:bg-black/5"
        >
          View analytics
          <span aria-hidden>→</span>
        </button>
      </div>
    </div>
  );
}

/* ---------------- Account setup (Postiz channel linking) ---------------- */

// Where users connect a new Instagram account to their Postiz workspace. The
// Postiz Instagram platform identifiers. Standalone connects directly to an IG
// professional account (no Facebook page needed) — the simplest path — so it's
// the default. The FB-linked variant is offered as a fallback.
const IG_STANDALONE = "instagram-standalone";
const IG_FB_LINKED = "instagram";
const IG_SIGNUP_DIRECT_URL = "https://www.instagram.com/accounts/emailsignup/";
// Logged-in sessions skip the signup page — sign out in the new tab first, then land on sign-up.
const IG_SIGNUP_LOGOUT_URL = `https://www.instagram.com/accounts/logout/?next=${encodeURIComponent("/accounts/emailsignup/")}`;

function AccountTab({
  account,
  influencer,
  onLinked,
}: {
  account: InfluencerAccount | null;
  influencer: Influencer;
  onLinked: (linked: Partial<Influencer>) => void;
}) {
  const [status, setStatus] = useState<
    "loading" | "not_configured" | "disconnected" | "ready" | "error"
  >("loading");
  const [channels, setChannels] = useState<PostizChannel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
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
      setError(friendlyPostizError(e instanceof Error ? e.message : "Failed to load channels."));
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
      setError(friendlyPostizError(e instanceof Error ? e.message : "Failed to connect account."));
    } finally {
      setLinkingId(null);
    }
  };

  const remove = async (channel: PostizChannel) => {
    const handle = channel.profile || channel.name || "this account";
    const ok = window.confirm(
      `Remove @${handle} from Postiz?\n\nAny scheduled Postiz posts on this channel will be deleted. This cannot be undone.`,
    );
    if (!ok) return;

    setRemovingId(channel.id);
    setError(null);
    try {
      await deletePostizChannel(channel.id);
      if (channel.id === linkedId) {
        onLinked({ postiz_integration_id: null, postiz_platform: null });
      }
      await fetchChannels();
    } catch (e) {
      setError(friendlyPostizError(e instanceof Error ? e.message : "Failed to remove account."));
    } finally {
      setRemovingId(null);
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
      setError(friendlyPostizError(e instanceof Error ? e.message : "Couldn't connect the account."));
    } finally {
      setConnecting(false);
    }
  };

  const linkedChannel = channels.find((c) => c.id === linkedId);
  const busy = connecting || refreshing || removingId !== null;

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
                      <div className="ml-auto flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => remove(c)}
                          disabled={busy}
                          className="rounded-full px-3 py-1.5 text-[13px] font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {removingId === c.id ? "Removing…" : "Remove"}
                        </button>
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
            <button
              type="button"
              onClick={() =>
                window.open(IG_SIGNUP_LOGOUT_URL, "_blank", "noopener,noreferrer")
              }
              className="mt-3 inline-flex w-full items-center justify-center rounded-full border border-black/15 px-5 py-3 text-[14px] font-medium text-black/80 transition hover:bg-black/[0.04]"
            >
              Create a new Instagram account
            </button>
            <p className="mt-2 text-center text-[12px] leading-relaxed text-black/40">
              Opens sign-up in a new tab. If you&apos;re already signed in on Instagram,
              that tab signs out first so you see the registration form. To keep your
              current session, use a private/incognito window and open{" "}
              <a
                href={IG_SIGNUP_DIRECT_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#5b73d6] hover:underline"
              >
                instagram.com/accounts/emailsignup
              </a>
              .
            </p>
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

// Small badge shown when at least one metric is real (live from Postiz).
function LiveBadge() {
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

function AnalyticsTab({
  influencer,
  persona,
}: {
  influencer: Influencer;
  persona: Influencer["persona"];
}) {
  // Seed from cache so the previous live numbers show instantly when you return
  // to this tab, instead of placeholders.
  const cached = getCachedInfluencerAnalytics(influencer.id);
  const [live, setLive] = useState<InfluencerAnalytics | null>(cached);
  const [loading, setLoading] = useState(!cached);

  // Always revalidate on mount to get a fresh live update. Only overwrite the
  // cached numbers when the fresh fetch actually has real data, so a transient
  // empty response doesn't blank out what we already showed.
  useEffect(() => {
    let active = true;
    if (!getCachedInfluencerAnalytics(influencer.id)) setLoading(true);
    getInfluencerAnalytics(influencer.id)
      .then((a) => {
        if (!active) return;
        setLive((prev) => (a.available || !prev ? a : prev));
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [influencer.id]);

  // Per-metric: show the live value when present, otherwise 0 (no placeholders).
  const followers = live?.channel?.followers ?? 0;
  const views = live?.totals.views ?? 0;
  const comments = live?.totals.comments ?? 0;
  const likes = live?.totals.likes ?? 0;
  const realPosts = live?.posts.filter(
    (p) => p.likes != null || p.comments != null || p.views != null,
  ) ?? [];

  const cards = [
    { label: "Followers", value: fmt(followers), live: live?.channel?.followers != null },
    { label: "Total views", value: fmt(views), live: live?.totals.views != null },
    { label: "Comments", value: fmt(comments), live: live?.totals.comments != null },
    { label: "Likes", value: fmt(likes), live: live?.totals.likes != null },
  ];

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <h2
          className="text-[22px] sm:text-[26px]"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Performance
        </h2>
        {live?.available ? (
          <LiveBadge />
        ) : (
          <span className="rounded-full bg-black/5 px-2.5 py-1 text-[12px] text-black/40">
            {loading ? "Loading…" : "Demo data"}
          </span>
        )}
      </div>

      <section className="mb-10 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {cards.map((s) => (
          <div
            key={s.label}
            className="rounded-2xl border border-black/10 bg-black/[0.02] p-5"
          >
            <p className="flex items-center gap-1.5 text-[13px] text-black/50">
              {s.label}
              {s.live && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              )}
            </p>
            <p
              className="mt-2 text-[26px] sm:text-[32px]"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {s.value}
            </p>
          </div>
        ))}
      </section>

      {/* Live per-post metrics from Postiz (only shown when real data exists). */}
      {realPosts.length > 0 && (
        <section className="mb-10">
          <h3 className="mb-3 flex items-center gap-2 text-[13px] uppercase tracking-[0.12em] text-black/40">
            Per-post performance <LiveBadge />
          </h3>
          <div className="overflow-hidden rounded-2xl border border-black/10">
            <table className="w-full text-left text-[14px]">
              <thead className="bg-black/[0.02] text-[12px] uppercase tracking-wide text-black/40">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Post</th>
                  <th className="px-4 py-2.5 text-right font-medium">Views</th>
                  <th className="px-4 py-2.5 text-right font-medium">Likes</th>
                  <th className="px-4 py-2.5 text-right font-medium">Comments</th>
                </tr>
              </thead>
              <tbody>
                {realPosts.map((p, i) => (
                  <tr key={p.postizPostId || i} className="border-t border-black/5">
                    <td className="max-w-[260px] truncate px-4 py-3 text-black/70">
                      {p.caption || "Post"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {p.views != null ? fmt(p.views) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {p.likes != null ? fmt(p.likes) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {p.comments != null ? fmt(p.comments) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

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
