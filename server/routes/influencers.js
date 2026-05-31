import { Router } from "express";
import * as repo from "../db/repo.js";
import * as postiz from "../services/postiz.js";
import { mediaUrl, persistInfluencerProfileImage } from "../lib/util.js";
import {
  mergePersonaUpdate,
  personaWithDefaults,
  snapshotPersonaDefaults,
} from "../lib/persona.js";
import * as gemini from "../services/gemini.js";
import {
  validateScheduleInput,
  formatScheduleSummary,
  normalizeSchedule,
  buildDefaultAutopilotSchedule,
  DEFAULT_POSTS_PER_DAY,
} from "../lib/schedule.js";
import { replanInfluencer, ensureAutopilotScheduleFor } from "../jobs/postingSchedule.js";
import { config } from "../config.js";
import { computeLiveProfile } from "../lib/liveProfile.js";
import { requireAuth } from "../lib/auth.js";

const router = Router();

const asyncH = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) =>
    res.status(500).json({ ok: false, error: err.message })
  );

function normalizeIgUrl(input) {
  let handle = String(input || "").trim();
  if (!handle) return null;
  if (handle.startsWith("http")) return handle;
  handle = handle.replace(/^@/, "");
  return `https://www.instagram.com/${handle}/`;
}

// Loads an influencer and 404s if missing. If it's owned by a user, requires the
// requester to be that owner (403 otherwise). User-less (seed/shared) rows are
// readable by anyone, preserving the existing TestPanel/dev behavior.
async function loadOwned(req, res) {
  const influencer = await repo.influencers.get(req.params.id);
  if (!influencer) {
    res.status(404).json({ ok: false, error: "not found" });
    return null;
  }
  if (influencer.user_id && influencer.user_id !== req.user?.id) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return null;
  }
  return influencer;
}

// Launch an influencer from the creator: persists the generated character
// (persona + portrait) as a user-owned influencer in
// the "ready" state so it shows up in their dashboard and can be managed there.
// The Instagram account is set up separately (stubbed for now).
router.post(
  "/launch",
  requireAuth,
  asyncH(async (req, res) => {
    const { character, imageUrl } = req.body;
    if (!character || typeof character !== "object") {
      return res.status(400).json({ ok: false, error: "character is required" });
    }

    const name = String(character.displayName || "").trim() || "My Influencer";
    const handle = (character.handleSuggestions?.[0] || "").trim() || null;
    const influencer = await repo.influencers.create({
      userId: req.user.id,
      name,
      niche: character.niche || null,
      handle,
      questionnaire: character.answers || {},
      persona: personaWithDefaults(character),
      imageUrl: imageUrl || null,
      postsPerDay: DEFAULT_POSTS_PER_DAY,
      // "ready" = character set up; account setup is the next step.
      status: "ready",
    });

    let saved = await repo.influencers.update(influencer.id, {
      posting_schedule: buildDefaultAutopilotSchedule(influencer.id),
    });

    // Move the onboarding portrait out of previews/ into this influencer's own
    // media folder so post generation can reliably load it as a reference.
    if (imageUrl) {
      const persistedUrl = await persistInfluencerProfileImage(influencer.id, imageUrl);
      if (persistedUrl !== imageUrl) {
        saved = await repo.influencers.update(influencer.id, {
          image_url: persistedUrl,
        });
      }
    }

    res.status(201).json({ ok: true, influencer: saved });
  })
);

// The signed-in user's influencers, with a light per-row summary (account
// status + recent post count) so the dashboard list can render at a glance.
router.get(
  "/mine",
  requireAuth,
  asyncH(async (req, res) => {
    const list = await repo.influencers.listForUser(req.user.id);
    const summarized = await Promise.all(
      list.map(async (inf) => {
        const [account, posts] = await Promise.all([
          repo.igAccounts.forInfluencer(inf.id),
          repo.posts.listFor(inf.id),
        ]);
        return {
          ...inf,
          accountStatus: account?.status || null,
          accountUsername: account?.username || null,
          postCount: posts.length,
        };
      })
    );
    res.json({ ok: true, influencers: summarized });
  })
);

// Persist the user's custom influencer roster order (dashboard sidebar).
router.put(
  "/reorder",
  requireAuth,
  asyncH(async (req, res) => {
    const order = req.body.order;
    if (!Array.isArray(order) || !order.every((id) => typeof id === "string" && id)) {
      return res.status(400).json({ ok: false, error: "order must be an array of influencer ids" });
    }
    await repo.influencers.reorderForUser(req.user.id, order);
    res.json({ ok: true });
  })
);

// Pull the metrics we surface in the demo from a summarized Postiz analytics
// map. Postiz labels vary by platform, so we look up a few likely keys per
// metric and take the first that exists.
const PICK = (summary, keys) => {
  for (const k of keys) {
    if (summary && summary[k] && typeof summary[k].value === "number") {
      return summary[k].value;
    }
  }
  return null;
};

// Computes one influencer's live analytics from Postiz: channel-level metrics
// (followers, impressions) plus per-post metrics (likes, comments, views/
// impressions) for each published Postiz post, and the summed totals. Best
// effort: any Postiz call that fails is treated as "no data" (null) so the
// caller can fall back to demo numbers per-metric rather than erroring.
async function computeInfluencerAnalytics(influencer, days) {
  const integrationId = influencer.postiz_integration_id;
  const result = {
    linked: Boolean(integrationId),
    channel: null, // { followers, impressions }
    posts: [], // [{ postizPostId, contentId, caption, likes, comments, views }]
    totals: { likes: null, comments: null, views: null },
    available: false, // true once any real metric came back
  };
  if (!postiz.isConfigured() || !integrationId) return result;

  // Load posts from DB and channel metrics from Postiz in parallel, then fetch
  // all per-post metrics concurrently (sequential calls were the main latency).
  const [posts, channelMetrics] = await Promise.all([
    repo.posts.listFor(influencer.id),
    postiz.getPlatformAnalytics(integrationId, { days }).catch(() => null),
  ]);

  if (channelMetrics) {
    result.channel = {
      followers: PICK(channelMetrics, ["followers", "follower", "totalfollowers"]),
      impressions: PICK(channelMetrics, ["impressions", "reach", "views", "totalimpressions"]),
    };
    if (result.channel.followers != null || result.channel.impressions != null) {
      result.available = true;
    }
  }

  const postizPosts = posts.filter((p) => p.postiz_post_id);
  const postMetrics = await Promise.all(
    postizPosts.map((p) => postiz.getPostAnalytics(p.postiz_post_id, { days }).catch(() => ({})))
  );

  let sumLikes = 0;
  let sumComments = 0;
  let sumViews = 0;
  let anyPost = false;

  for (let i = 0; i < postizPosts.length; i++) {
    const p = postizPosts[i];
    const metrics = postMetrics[i] || {};
    const likes = PICK(metrics, ["likes", "like", "reactions"]);
    const comments = PICK(metrics, ["comments", "comment", "replies"]);
    const views = PICK(metrics, ["views", "impressions", "reach", "plays"]);
    if (likes != null || comments != null || views != null) {
      anyPost = true;
      result.available = true;
    }
    if (likes != null) sumLikes += likes;
    if (comments != null) sumComments += comments;
    if (views != null) sumViews += views;
    result.posts.push({
      postizPostId: p.postiz_post_id,
      contentId: p.content_id || null,
      caption: p.caption || null,
      likes,
      comments,
      views,
    });
  }

  if (anyPost) {
    result.totals = { likes: sumLikes, comments: sumComments, views: sumViews };
  }
  return result;
}

// Aggregate live analytics across ALL of the signed-in user's influencers, for
// the main dashboard Analytics tab. MUST be declared before "/:id" so the
// literal path wins over the dynamic param. Returns per-influencer summaries
// plus grand totals. Graceful: missing/unlinked influencers contribute nulls.
router.get(
  "/analytics",
  requireAuth,
  asyncH(async (req, res) => {
    const days = Math.max(1, parseInt(req.query.days, 10) || 7);
    const list = await repo.influencers.listForUser(req.user.id);
    const perInfluencer = await Promise.all(
      list.map(async (inf) => {
        const a = await computeInfluencerAnalytics(inf, days);
        return {
          influencerId: inf.id,
          name: inf.persona?.displayName || inf.name,
          ...a,
        };
      })
    );

    // Grand totals across influencers (only counts real values).
    const totals = { followers: 0, likes: 0, comments: 0, views: 0 };
    let available = false;
    for (const a of perInfluencer) {
      if (a.available) available = true;
      if (a.channel?.followers != null) totals.followers += a.channel.followers;
      if (a.totals.likes != null) totals.likes += a.totals.likes;
      if (a.totals.comments != null) totals.comments += a.totals.comments;
      if (a.totals.views != null) totals.views += a.totals.views;
    }

    res.json({ ok: true, days, available, totals, influencers: perInfluencer });
  })
);

// Create an influencer from the onboarding wizard. Optionally kicks off cloning.
router.post(
  "/",
  asyncH(async (req, res) => {
    const { name, niche, questionnaire, sourceLinks = [], postsPerDay, email, autoClone } =
      req.body;
    if (!name) return res.status(400).json({ ok: false, error: "name is required" });

    const influencer = await repo.influencers.create({
      name,
      niche,
      questionnaire,
      postsPerDay: postsPerDay || DEFAULT_POSTS_PER_DAY,
    });

    await repo.influencers.update(influencer.id, {
      posting_schedule: buildDefaultAutopilotSchedule(influencer.id),
    });
    const saved = await repo.influencers.get(influencer.id);

    for (const link of sourceLinks.filter(Boolean)) {
      const url = normalizeIgUrl(link);
      if (url) await repo.sourceAccounts.create({ influencerId: influencer.id, url });
    }

    if (email) {
      await repo.igAccounts.create({ influencerId: influencer.id, email });
    }

    if (autoClone) {
      await repo.jobs.enqueue({ influencerId: influencer.id, type: "clone_persona" });
    }

    res.status(201).json({ ok: true, influencer: saved });
  })
);

router.get(
  "/",
  asyncH(async (req, res) => {
    res.json({ ok: true, influencers: await repo.influencers.list() });
  })
);

router.get(
  "/:id",
  requireAuth,
  asyncH(async (req, res) => {
    const influencer = await loadOwned(req, res);
    if (!influencer) return;
    const [sources, account, content, posts, metrics, jobs] = await Promise.all([
      repo.sourceAccounts.listFor(influencer.id),
      repo.igAccounts.forInfluencer(influencer.id),
      repo.content.listForWithPostTimes(influencer.id),
      repo.posts.listFor(influencer.id),
      repo.metrics.dailyTotals(influencer.id),
      repo.jobs.listFor(influencer.id),
    ]);
    const safeAccount = account
      ? { id: account.id, username: account.username, status: account.status, email: account.email, notes: account.notes }
      : null;
    res.json({
      ok: true,
      influencer,
      sources,
      account: safeAccount,
      content: content.map((c) => ({ ...c, videoUrl: mediaUrl(c.video_path) })),
      posts,
      metrics,
      jobs,
    });
  })
);

// Live profile card for the Account tab (avatar, stats, bio, post grid).
router.get(
  "/:id/live-profile",
  requireAuth,
  asyncH(async (req, res) => {
    const influencer = await loadOwned(req, res);
    if (!influencer) return;
    const refresh = req.query.refresh === "1" || req.query.refresh === "true";
    const profile = await computeLiveProfile(influencer, { refresh });
    res.json({ ok: true, profile });
  })
);

// Live analytics for one influencer from Postiz (channel + per-post + totals).
// Used by the influencer page's Analytics tab. Falls back to nulls when the
// influencer isn't linked or Postiz returns nothing, so the UI can show demo
// numbers per-metric instead.
router.get(
  "/:id/analytics",
  requireAuth,
  asyncH(async (req, res) => {
    const influencer = await loadOwned(req, res);
    if (!influencer) return;
    const days = Math.max(1, parseInt(req.query.days, 10) || 7);
    const analytics = await computeInfluencerAnalytics(influencer, days);
    res.json({ ok: true, days, ...analytics });
  })
);

router.patch(
  "/:id",
  requireAuth,
  asyncH(async (req, res) => {
    const owned = await loadOwned(req, res);
    if (!owned) return;
    const allowed = [
      "name",
      "niche",
      "handle",
      "posts_per_day",
      "status",
      "voice_id",
      "postiz_integration_id",
      "postiz_platform",
      "posting_schedule",
      "persona",
      "questionnaire",
    ];
    const fields = {};
    for (const k of allowed) if (k in req.body) fields[k] = req.body[k];
    if (fields.persona && typeof fields.persona === "object") {
      const existing =
        owned.persona && typeof owned.persona === "object" ? owned.persona : {};
      fields.persona = mergePersonaUpdate(existing, fields.persona);
      // Backfill a defaults snapshot for older influencers that pre-date this feature.
      if (!fields.persona.personaDefaults) {
        fields.persona.personaDefaults = snapshotPersonaDefaults(existing);
      }
    }
    const influencer = await repo.influencers.update(req.params.id, fields);
    res.json({ ok: true, influencer });
  })
);

// Restore persona AI fields to the snapshot taken at launch (or regenerate from
// the original creation brief when no snapshot exists).
router.post(
  "/:id/persona/reset",
  requireAuth,
  asyncH(async (req, res) => {
    const owned = await loadOwned(req, res);
    if (!owned) return;

    const existing =
      owned.persona && typeof owned.persona === "object" ? owned.persona : {};
    let restored = null;

    if (existing.personaDefaults && typeof existing.personaDefaults === "object") {
      restored = {
        ...existing.personaDefaults,
        personaDefaults: existing.personaDefaults,
        answers: existing.answers ?? owned.questionnaire ?? {},
      };
    } else {
      const answers =
        (existing.answers && typeof existing.answers === "object" ? existing.answers : null) ||
        (owned.questionnaire && typeof owned.questionnaire === "object"
          ? owned.questionnaire
          : null);
      if (!answers || !Object.keys(answers).length) {
        return res.status(400).json({
          ok: false,
          error: "No saved defaults for this influencer",
        });
      }
      if (!gemini.isConfigured()) {
        return res.status(503).json({ ok: false, error: "character generation is not configured" });
      }
      const character = await gemini.designOnboardingCharacter({ answers });
      restored = personaWithDefaults({ ...character, answers });
    }

    const name = String(restored.displayName || owned.name || "").trim() || owned.name;
    const handle = (restored.handleSuggestions?.[0] || owned.handle || "").trim() || null;
    const influencer = await repo.influencers.update(owned.id, {
      name,
      niche: restored.niche || owned.niche,
      handle,
      persona: restored,
    });
    res.json({ ok: true, influencer });
  })
);

router.delete(
  "/:id",
  requireAuth,
  asyncH(async (req, res) => {
    const owned = await loadOwned(req, res);
    if (!owned) return;
    await repo.influencers.remove(req.params.id);
    res.json({ ok: true });
  })
);

// Add a source account to clone from.
router.post(
  "/:id/sources",
  asyncH(async (req, res) => {
    const url = normalizeIgUrl(req.body.url || req.body.handle);
    if (!url) return res.status(400).json({ ok: false, error: "url or handle required" });
    const src = await repo.sourceAccounts.create({ influencerId: req.params.id, url });
    res.status(201).json({ ok: true, source: src });
  })
);

// Set the email used for IG account creation.
router.post(
  "/:id/account",
  asyncH(async (req, res) => {
    const { email } = req.body;
    let account = await repo.igAccounts.forInfluencer(req.params.id);
    if (account) account = await repo.igAccounts.update(account.id, { email });
    else account = await repo.igAccounts.create({ influencerId: req.params.id, email });
    res.json({ ok: true, account: { id: account.id, email: account.email } });
  })
);

// Link this influencer to a connected Postiz channel so its posts can be
// scheduled through Postiz. `platform` (instagram | x | tiktok | ...) drives the
// per-post settings; defaults to instagram.
router.post(
  "/:id/postiz",
  requireAuth,
  asyncH(async (req, res) => {
    const owned = await loadOwned(req, res);
    if (!owned) return;
    const { integrationId, platform } = req.body;
    if (!integrationId) {
      return res.status(400).json({ ok: false, error: "integrationId is required" });
    }
    await repo.influencers.update(req.params.id, {
      postiz_integration_id: integrationId,
      postiz_platform: platform || "instagram",
    });
    let influencer = await repo.influencers.get(req.params.id);
    await ensureAutopilotScheduleFor(influencer);
    const plan = await replanInfluencer(influencer.id, { force: true });
    influencer = await repo.influencers.get(req.params.id);
    res.json({
      ok: true,
      influencer,
      schedule: plan.schedule,
      planned: plan.planned,
      warning: plan.warning || null,
    });
  })
);

// Unlink this influencer from its Postiz channel (clears postiz_integration_id).
// The platform default is left as-is so re-linking later is a single step.
router.delete(
  "/:id/postiz",
  requireAuth,
  asyncH(async (req, res) => {
    const owned = await loadOwned(req, res);
    if (!owned) return;
    const influencer = await repo.influencers.update(req.params.id, {
      postiz_integration_id: null,
    });
    res.json({
      ok: true,
      influencer: {
        id: influencer.id,
        postiz_integration_id: influencer.postiz_integration_id,
        postiz_platform: influencer.postiz_platform,
      },
    });
  })
);

// Get the influencer's autopilot posting schedule.
router.get(
  "/:id/schedule",
  requireAuth,
  asyncH(async (req, res) => {
    const influencer = await loadOwned(req, res);
    if (!influencer) return;
    const schedule = normalizeSchedule(influencer.posting_schedule);
    const lastAutopilotJob = await repo.jobs.lastOfType(influencer.id, "auto_post_postiz");
    res.json({
      ok: true,
      schedule,
      summary: formatScheduleSummary(schedule),
      canAutopilot: Boolean(influencer.postiz_integration_id) && Boolean(config.publicBaseUrl),
      autopilotBlocked: !config.publicBaseUrl
        ? "Server needs PUBLIC_BASE_URL so Postiz can fetch generated images."
        : !influencer.postiz_integration_id
          ? "Link an Instagram account first."
          : null,
      lastAutopilotJob: lastAutopilotJob
        ? {
            id: lastAutopilotJob.id,
            status: lastAutopilotJob.status,
            runAt: lastAutopilotJob.run_at,
            lastError: lastAutopilotJob.last_error,
            updatedAt: lastAutopilotJob.updated_at,
          }
        : null,
    });
  })
);

// Save autopilot posting schedule and replan pending jobs.
router.put(
  "/:id/schedule",
  requireAuth,
  asyncH(async (req, res) => {
    const owned = await loadOwned(req, res);
    if (!owned) return;

    const validated = validateScheduleInput(req.body);
    if (!validated.ok) {
      return res.status(400).json({ ok: false, error: validated.error });
    }

    if (validated.schedule.enabled && !owned.postiz_integration_id) {
      return res.status(400).json({
        ok: false,
        error: "Link an Instagram account before turning on autopilot.",
      });
    }

    const influencer = await repo.influencers.update(req.params.id, {
      posting_schedule: validated.schedule,
      // Autopilot implies the influencer is actively posting.
      status: validated.schedule.enabled ? "active" : owned.status,
    });

    const plan = await replanInfluencer(influencer.id, { force: true });
    res.json({
      ok: true,
      schedule: normalizeSchedule(influencer.posting_schedule),
      summary: plan.schedule,
      planned: plan.planned,
      warning: plan.warning || null,
    });
  })
);

const ACTIONS = {
  clone: "clone_persona",
  spawn: "spawn_account",
  generate: "generate_content",
  post: "post_content",
  schedule: "schedule_postiz",
  metrics: "scrape_metrics",
};

// Trigger a pipeline action by enqueueing the corresponding job.
router.post(
  "/:id/actions/:action",
  requireAuth,
  asyncH(async (req, res) => {
    const influencer = await loadOwned(req, res);
    if (!influencer) return;
    const type = ACTIONS[req.params.action];
    if (!type) return res.status(400).json({ ok: false, error: "unknown action" });
    const payload = {};
    if (req.params.action === "generate" && req.body.topic) payload.topic = req.body.topic;
    if (req.params.action === "post" && req.body.contentId) payload.contentId = req.body.contentId;
    if (req.params.action === "schedule") {
      if (req.body.contentId) payload.contentId = req.body.contentId;
      if (req.body.runAt) payload.runAt = req.body.runAt;
      if (req.body.type) payload.type = req.body.type;
    }
    // Honour an explicit runAt for scheduled posts so the generate-then-post
    // flow can stage the job ahead of time.
    const runAt = req.params.action === "schedule" && req.body.runAt ? new Date(req.body.runAt) : undefined;
    const job = await repo.jobs.enqueue({ influencerId: influencer.id, type, payload, runAt });
    res.status(202).json({ ok: true, job });
  })
);

export default router;
