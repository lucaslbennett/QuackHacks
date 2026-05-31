import { Router } from "express";
import * as repo from "../db/repo.js";
import { mediaUrl } from "../lib/util.js";

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
  asyncH(async (req, res) => {
    const influencer = await repo.influencers.get(req.params.id);
    if (!influencer) return res.status(404).json({ ok: false, error: "not found" });
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
    const allowed = ["name", "niche", "handle", "posts_per_day", "status", "voice_id"];
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

const ACTIONS = {
  clone: "clone_persona",
  spawn: "spawn_account",
  generate: "generate_content",
  post: "post_content",
  metrics: "scrape_metrics",
};

// Trigger a pipeline action by enqueueing the corresponding job.
router.post(
  "/:id/actions/:action",
  asyncH(async (req, res) => {
    const type = ACTIONS[req.params.action];
    if (!type) return res.status(400).json({ ok: false, error: "unknown action" });
    const payload = {};
    if (req.params.action === "generate" && req.body.topic) payload.topic = req.body.topic;
    if (req.params.action === "post" && req.body.contentId) payload.contentId = req.body.contentId;
    const job = await repo.jobs.enqueue({ influencerId: req.params.id, type, payload });
    res.status(202).json({ ok: true, job });
  })
);

export default router;
