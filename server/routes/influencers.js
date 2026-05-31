import { Router } from "express";
import * as repo from "../db/repo.js";
import { mediaUrl } from "../lib/util.js";
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

// Launch an influencer straight from the onboarding quiz funnel: persists the
// character the user designed (persona + portrait) as a user-owned influencer in
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
    const postsPerDay = Number(character.postingStrategy?.postsPerDay) || 2;

    const influencer = await repo.influencers.create({
      userId: req.user.id,
      name,
      niche: character.niche || null,
      handle,
      questionnaire: character.answers || {},
      persona: character,
      imageUrl: imageUrl || null,
      postsPerDay,
      // "ready" = character set up; account setup is the next step.
      status: "ready",
    });

    res.status(201).json({ ok: true, influencer });
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

// Create an influencer from the onboarding wizard. Optionally kicks off cloning.
router.post(
  "/",
  asyncH(async (req, res) => {
    const { name, niche, questionnaire, sourceLinks = [], postsPerDay, email, autoClone } =
      req.body;
    if (!name) return res.status(400).json({ ok: false, error: "name is required" });

    const influencer = await repo.influencers.create({ name, niche, questionnaire, postsPerDay });

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

    res.status(201).json({ ok: true, influencer });
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
      repo.content.listFor(influencer.id),
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

router.patch(
  "/:id",
  asyncH(async (req, res) => {
    const allowed = [
      "name",
      "niche",
      "handle",
      "posts_per_day",
      "status",
      "voice_id",
      "postiz_integration_id",
      "postiz_platform",
    ];
    const fields = {};
    for (const k of allowed) if (k in req.body) fields[k] = req.body[k];
    const influencer = await repo.influencers.update(req.params.id, fields);
    res.json({ ok: true, influencer });
  })
);

router.delete(
  "/:id",
  asyncH(async (req, res) => {
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
  asyncH(async (req, res) => {
    const { integrationId, platform } = req.body;
    if (!integrationId) {
      return res.status(400).json({ ok: false, error: "integrationId is required" });
    }
    const influencer = await repo.influencers.update(req.params.id, {
      postiz_integration_id: integrationId,
      postiz_platform: platform || "instagram",
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
