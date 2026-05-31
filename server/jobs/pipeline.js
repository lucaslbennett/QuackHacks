import * as repo from "../db/repo.js";
import * as gemini from "../services/gemini.js";
import * as eleven from "../services/elevenlabs.js";
import * as fal from "../services/fal.js";
import { assembleReel } from "../services/video.js";
import { scrapeInstagramProfile } from "../services/browser/scrapeProfile.js";
import { createInstagramAccount } from "../services/browser/createAccount.js";
import { postReel } from "../services/browser/postReel.js";
import { scrapeAccountMetrics } from "../services/browser/scrapeMetrics.js";
import * as postiz from "../services/postiz.js";
import { generateEmail } from "../services/verification.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";
import { mediaUrl, publicMediaUrl } from "../lib/util.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("pipeline");

// 1. Clone: scrape source accounts, then synthesize persona + pick a voice.
export async function clonePersona({ influencerId }) {
  const influencer = await repo.influencers.get(influencerId);
  if (!influencer) throw new Error("influencer not found");
  await repo.influencers.update(influencerId, { status: "cloning" });

  const sources = await repo.sourceAccounts.listFor(influencerId);
  const scrapedSources = [];
  for (const src of sources) {
    try {
      const scraped = await scrapeInstagramProfile(src.url);
      await repo.sourceAccounts.setScraped(src.id, scraped, scraped.handle);
      scrapedSources.push(scraped);
    } catch (err) {
      log.warn("scrape failed for", src.url, err.message);
      scrapedSources.push({ url: src.url, error: err.message });
    }
  }

  const persona = await gemini.synthesizePersona({
    name: influencer.name,
    niche: influencer.niche,
    questionnaire: influencer.questionnaire,
    sources: scrapedSources,
  });

  let voiceId = influencer.voice_id;
  if (eleven.isConfigured()) {
    voiceId = await eleven.pickVoiceForPersona(persona).catch(() => voiceId);
  }

  await repo.influencers.update(influencerId, {
    persona,
    voice_id: voiceId || null,
    niche: persona.niche || influencer.niche,
    handle: persona.handleSuggestions?.[0] || influencer.handle,
    posts_per_day: persona.postingStrategy?.postsPerDay || influencer.posts_per_day,
    status: "ready",
  });

  return { persona, voiceId, scrapedCount: scrapedSources.length };
}

// 2. Spawn: create a fresh Instagram account for this influencer.
export async function spawnAccount({ influencerId }) {
  const influencer = await repo.influencers.get(influencerId);
  if (!influencer) throw new Error("influencer not found");

  let account = await repo.igAccounts.forInfluencer(influencerId);
  if (!account) account = await repo.igAccounts.create({ influencerId });

  // Provision a fresh inbox-backed address if none was set, so the email
  // verification code can be polled automatically during signup.
  let email = account.email;
  if (!email) {
    email = generateEmail({ seed: influencer.handle || influencer.name });
    account = await repo.igAccounts.update(account.id, { email });
  }

  await repo.igAccounts.update(account.id, { status: "creating" });
  await repo.influencers.update(influencerId, { status: "spawning" });

  const created = await createInstagramAccount({
    influencerId,
    persona: influencer.persona,
    email,
  });

  const updated = await repo.igAccounts.update(account.id, {
    username: created.username,
    password_enc: encryptSecret(created.password),
    full_name: created.fullName,
    status: created.loggedIn ? "active" : "failed",
    session: created.session || {},
    notes: created.note || null,
  });

  await repo.influencers.update(influencerId, {
    status: created.loggedIn ? "active" : "error",
    handle: created.username,
  });

  return { username: created.username, loggedIn: created.loggedIn, accountId: updated.id };
}

// 3. Generate: script -> voiceover -> visuals -> rendered reel.
export async function generateContent({ influencerId, contentId, topic }) {
  const influencer = await repo.influencers.get(influencerId);
  if (!influencer) throw new Error("influencer not found");
  const persona = influencer.persona || {};

  let item = contentId
    ? await repo.content.get(contentId)
    : await repo.content.create({ influencerId, topic });
  contentId = item.id;

  await repo.content.update(contentId, { status: "scripting" });
  const script = await gemini.generateScript({ persona, topic: topic || item.topic });
  await repo.content.update(contentId, {
    title: script.title,
    topic: script.topic,
    script: script.narration,
    caption: script.caption,
    hashtags: script.hashtags || [],
    meta: { onScreenText: script.onScreenText, bRollPrompts: script.bRollPrompts },
  });

  // Voiceover
  await repo.content.update(contentId, { status: "voicing" });
  const audioPath = await eleven.synthesizeNarration({
    text: script.narration,
    voiceId: influencer.voice_id,
    influencerId,
    contentId,
  });
  await repo.content.update(contentId, { audio_path: audioPath });

  // Visuals: generate stills, then optionally animate the first one.
  await repo.content.update(contentId, { status: "rendering" });
  const imagePaths = [];
  const clipPaths = [];
  const prompts = (script.bRollPrompts || []).slice(0, 3);
  for (const p of prompts) {
    try {
      const styled = `${p}. Style: ${persona.visualStyle?.aesthetic || "cinematic, high quality"}.`;
      const img = await fal.generateImage({ prompt: styled, influencerId, label: "broll" });
      imagePaths.push(img.path);
      if (clipPaths.length === 0) {
        const clip = await fal
          .generateVideoFromImage({ imageUrl: img.url, prompt: p, influencerId })
          .catch((e) => {
            log.warn("video gen failed, using still:", e.message);
            return null;
          });
        if (clip) clipPaths.push(clip.path);
      }
    } catch (err) {
      log.warn("image gen failed:", err.message);
    }
  }

  const videoPath = await assembleReel({
    influencerId,
    contentId,
    audioPath,
    imagePaths,
    clipPaths,
    captions: script.onScreenText || [script.hook],
  });

  await repo.content.update(contentId, {
    status: "ready",
    image_paths: imagePaths,
    video_path: videoPath,
  });

  return { contentId, videoPath, videoUrl: mediaUrl(videoPath) };
}

// 4. Post: publish a ready content item to Instagram. If no contentId is given
// (scheduled posting), pick the oldest rendered-but-unposted item.
export async function postContent({ influencerId, contentId }) {
  let item;
  if (contentId) {
    item = await repo.content.get(contentId);
  } else {
    const items = await repo.content.listFor(influencerId);
    item = items.filter((c) => c.status === "ready" && c.video_path).pop();
  }
  if (!item || !item.video_path) throw new Error("content not ready to post");
  contentId = item.id;

  const account = await repo.igAccounts.forInfluencer(influencerId);
  if (!account || account.status !== "active") throw new Error("no active IG account");

  await repo.content.update(contentId, { status: "posting" });

  const result = await postReel({
    account: {
      username: account.username,
      password: decryptSecret(account.password_enc),
      session: account.session || {},
    },
    videoPath: item.video_path,
    caption: item.caption,
    hashtags: item.hashtags || [],
  });

  if (result.posted) {
    const post = await repo.posts.create({
      influencerId,
      contentId,
      url: result.url,
      shortcode: result.shortcode,
      caption: item.caption,
    });
    await repo.content.update(contentId, { status: "posted" });
    return { posted: true, postId: post.id, url: result.url };
  }

  await repo.content.update(contentId, { status: "failed", error: "post not confirmed" });
  return { posted: false };
}

// 4b. Schedule via Postiz: upload a ready reel to Postiz and schedule it on the
// influencer's linked channel. Used as an alternative to the Stagehand poster
// so posting cadence is managed by Postiz. If no contentId is given, picks the
// oldest rendered-but-unposted item (same selection as postContent).
export async function scheduleViaPostiz({ influencerId, contentId, runAt, type }) {
  if (!postiz.isConfigured()) throw new Error("POSTIZ_API_KEY not configured");

  const influencer = await repo.influencers.get(influencerId);
  if (!influencer) throw new Error("influencer not found");
  if (!influencer.postiz_integration_id) {
    throw new Error("influencer has no linked Postiz channel (postiz_integration_id)");
  }

  let item;
  if (contentId) {
    item = await repo.content.get(contentId);
  } else {
    const items = await repo.content.listFor(influencerId);
    item = items.filter((c) => c.status === "ready" && c.video_path).pop();
  }
  if (!item || !item.video_path) throw new Error("content not ready to schedule");
  contentId = item.id;

  // Postiz needs a publicly reachable URL to ingest the media.
  const mediaPublicUrl = publicMediaUrl(item.video_path);
  if (!mediaPublicUrl || mediaPublicUrl.startsWith("/")) {
    throw new Error("PUBLIC_BASE_URL not set - Postiz cannot fetch local media");
  }

  const platform = influencer.postiz_platform || "instagram";
  const hashtags = (item.hashtags || []).map((h) => (h.startsWith("#") ? h : `#${h}`));
  const caption = [item.caption, hashtags.join(" ")].filter(Boolean).join("\n\n");

  await repo.content.update(contentId, { status: "scheduling" });

  const media = await postiz.uploadFromUrl(mediaPublicUrl);

  // Default to the channel's next free slot when no explicit time is given.
  let date = runAt ? new Date(runAt) : null;
  if (!date) {
    const slot = await postiz.findNextSlot(influencer.postiz_integration_id);
    date = slot ? new Date(slot) : new Date(Date.now() + 60 * 60 * 1000);
  }

  const { postId } = await postiz.schedulePost({
    integrationId: influencer.postiz_integration_id,
    identifier: platform,
    content: caption,
    date,
    media: [media],
    type: type || undefined,
  });

  const post = await repo.posts.createScheduled({
    influencerId,
    contentId,
    postizPostId: postId,
    caption: item.caption,
    platform,
    scheduledAt: date,
  });

  await repo.content.update(contentId, { status: "scheduled" });
  return { scheduled: true, postId, postRowId: post.id, scheduledAt: date.toISOString() };
}

// 5. Metrics: scrape views/likes/comments for the influencer's posts.
export async function scrapeMetrics({ influencerId }) {
  const account = await repo.igAccounts.forInfluencer(influencerId);
  if (!account || account.status !== "active") throw new Error("no active IG account");
  const allPosts = await repo.posts.listFor(influencerId);

  const data = await scrapeAccountMetrics({
    account: { username: account.username, session: account.session || {} },
    posts: allPosts,
  });

  for (const pp of data.perPost) {
    await repo.metrics.upsertDaily({
      influencerId,
      postId: pp.postId,
      views: pp.views,
      likes: pp.likes,
      comments: pp.comments,
      followers: data.followers,
    });
  }
  // Always record a daily followers snapshot even without posts.
  if (!data.perPost.length) {
    await repo.metrics.upsertDaily({ influencerId, postId: null, followers: data.followers });
  }

  return { followers: data.followers, postsMeasured: data.perPost.length };
}

export const handlers = {
  clone_persona: clonePersona,
  spawn_account: spawnAccount,
  generate_content: generateContent,
  post_content: postContent,
  schedule_postiz: scheduleViaPostiz,
  scrape_metrics: scrapeMetrics,
};
