import * as repo from "../db/repo.js";
import * as gemini from "../services/gemini.js";
import * as eleven from "../services/elevenlabs.js";
import { assembleReel } from "../services/video.js";
import { writeFile } from "node:fs/promises";
import { scrapeInstagramProfile } from "../services/browser/scrapeProfile.js";
import { createInstagramAccount } from "../services/browser/createAccount.js";
import { postReel } from "../services/browser/postReel.js";
import { scrapeAccountMetrics } from "../services/browser/scrapeMetrics.js";
import { updateInstagramProfile } from "../services/browser/editProfile.js";
import * as postiz from "../services/postiz.js";
import { generateEmail } from "../services/verification.js";
import { encryptSecret, decryptSecret } from "../lib/crypto.js";
import { config } from "../config.js";
import { loadMediaAsBase64, mediaPath, mediaUrl, publicMediaUrl } from "../lib/util.js";
import { normalizeSchedule, upcomingFixedSlots } from "../lib/schedule.js";
import { chainRandomSchedule } from "./postingSchedule.js";
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
    posts_per_day: 2,
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

  // Provision a FRESH inbox-backed address for every signup attempt that isn't
  // resuming an already-active account. Instagram binds an address to a signup
  // the instant the form is submitted, so reusing the one persisted from a prior
  // FAILED attempt trips "email already in use" and dooms the retry. Only an
  // already-active account keeps its address (that signup succeeded with it).
  let email = account.email;
  if (!email || account.status !== "active") {
    email = await generateEmail({ seed: influencer.name || influencer.handle });
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
    // Persist the address actually used — createInstagramAccount may rotate it
    // if Instagram rejected the original (disposable domain blocked).
    email: created.email || email,
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

  // Visuals: generate Nano Banana stills. The reel assembler adds motion by
  // cycling and cropping them under the voiceover.
  await repo.content.update(contentId, { status: "rendering" });
  const imagePaths = [];
  const prompts = (script.bRollPrompts || []).slice(0, 3);
  for (const p of prompts) {
    try {
      const styled = `${p}. Style: ${persona.visualStyle?.aesthetic || "cinematic, high quality"}.`;
      const img = await gemini.generateInfluencerImage({
        prompt: styled,
        influencerId,
        label: "broll",
        aspectRatio: "9:16",
        frameAsSelfie: false,
        // Keep the reel's on-camera person matching the influencer's profile.
        referenceImage: influencer.image_url || null,
      });
      imagePaths.push(img.path);
    } catch (err) {
      log.warn("image gen failed:", err.message);
    }
  }

  const videoPath = await assembleReel({
    influencerId,
    contentId,
    audioPath,
    imagePaths,
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

// 4c. Autopilot: generate an image post (same flow as the dashboard preview) and
// schedule it through Postiz at `publishAt`. Skips manual review — used by the
// per-influencer posting schedule.
export async function autoPostViaPostiz({ influencerId, publishAt }) {
  if (!postiz.isConfigured()) throw new Error("POSTIZ_API_KEY not configured");
  if (!config.publicBaseUrl) {
    throw new Error("PUBLIC_BASE_URL not set - Postiz cannot fetch generated images");
  }

  const influencer = await repo.influencers.get(influencerId);
  if (!influencer) throw new Error("influencer not found");
  if (!influencer.postiz_integration_id) {
    throw new Error("influencer has no linked Postiz channel");
  }

  const persona = influencer.persona && typeof influencer.persona === "object" ? influencer.persona : {};
  const built = await gemini.generatePostContent({
    persona: {
      ...persona,
      displayName: persona.displayName || influencer.name,
      niche: persona.niche || influencer.niche,
    },
  });
  const image = await gemini.generateInfluencerImage({
    prompt: built.imagePrompt,
    influencerId: influencer.id,
    label: "post",
    frameAsSelfie: built.shotType === "selfie",
    referenceImage: influencer.image_url || null,
  });

  const item = await repo.content.create({
    influencerId,
    topic: built.title || null,
    status: "ready",
  });
  await repo.content.update(item.id, {
    title: built.title || null,
    caption: built.caption,
    hashtags: built.hashtags || [],
    image_paths: [image.url],
    meta: {
      altText: built.altText,
      imagePrompt: built.imagePrompt,
      source: "autopilot",
    },
  });

  const platform = influencer.postiz_platform || "instagram";
  const hashtags = (built.hashtags || []).map((h) => (h.startsWith("#") ? h : `#${h}`));
  const caption = [built.caption, hashtags.join(" ")].filter(Boolean).join("\n\n");

  const imageRelUrl = image.url;
  const imagePublicUrl = imageRelUrl.startsWith("http")
    ? imageRelUrl
    : `${config.publicBaseUrl}${imageRelUrl}`;

  await repo.content.update(item.id, { status: "scheduling" });
  const media = await postiz.uploadFromUrl(imagePublicUrl);

  let date = publishAt ? new Date(publishAt) : new Date(Date.now() + 5 * 60 * 1000);
  if (Number.isNaN(date.getTime()) || date.getTime() < Date.now()) {
    date = new Date(Date.now() + 5 * 60 * 1000);
  }

  const { postId } = await postiz.schedulePost({
    integrationId: influencer.postiz_integration_id,
    identifier: platform,
    content: caption,
    date,
    media: [media],
    type: "schedule",
  });

  await repo.posts.createScheduled({
    influencerId,
    contentId: item.id,
    postizPostId: postId,
    caption: built.caption,
    platform,
    scheduledAt: date,
  });
  await repo.content.update(item.id, {
    status: "scheduled",
    meta: {
      altText: built.altText,
      imagePrompt: built.imagePrompt,
      source: "autopilot",
      postizPostId: postId,
    },
  });

  const schedule = normalizeSchedule(influencer.posting_schedule);
  if (schedule.enabled && schedule.mode === "random") {
    await chainRandomSchedule(influencerId, date);
  } else if (schedule.enabled && schedule.mode === "fixed") {
    const next = upcomingFixedSlots(schedule, { fromDate: date, days: 3 })[0];
    await repo.influencers.update(influencerId, {
      posting_schedule: {
        ...schedule,
        nextRunAt: next ? next.toISOString() : date.toISOString(),
      },
    });
  }

  return {
    scheduled: true,
    contentId: item.id,
    postId,
    scheduledAt: date.toISOString(),
  };
}

// 4d. Sync profile to Instagram via Browser Use. Pushes the refined display
// name / bio / portrait to the LIVE Instagram account — the profile edits Postiz
// can't make. Needs a password-backed account (auto-spawn flow); a Postiz/OAuth
// link alone isn't enough because we don't hold that account's password.
export async function updateIgProfile({ influencerId, name, bio, profileImageUrl }) {
  const influencer = await repo.influencers.get(influencerId);
  if (!influencer) throw new Error("influencer not found");

  const account = await repo.igAccounts.forInfluencer(influencerId);
  if (!account || account.status !== "active" || !account.password_enc) {
    throw new Error(
      "No editable Instagram login on file. Profile sync needs an account " +
        "created via the auto-spawn flow (stored password); Postiz-linked " +
        "accounts can't be edited through the API."
    );
  }

  // Materialize the portrait to a local file Stagehand can upload.
  let profileImagePath = null;
  if (profileImageUrl) {
    const loaded = await loadMediaAsBase64(profileImageUrl);
    if (loaded) {
      profileImagePath = await mediaPath(influencerId, `ig-profile-${Date.now()}.png`);
      await writeFile(profileImagePath, Buffer.from(loaded.data, "base64"));
    } else {
      log.warn("could not load portrait for IG profile sync:", profileImageUrl);
    }
  }

  const result = await updateInstagramProfile({
    account: {
      username: account.username,
      password: decryptSecret(account.password_enc),
      session: account.session || {},
    },
    name: name || null,
    bio: bio || null,
    profileImagePath,
  });

  await repo.igAccounts.update(account.id, {
    notes: result.updated
      ? `Profile synced ${new Date().toISOString()}`
      : account.notes || null,
  });

  return result;
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
  auto_post_postiz: autoPostViaPostiz,
  update_ig_profile: updateIgProfile,
  scrape_metrics: scrapeMetrics,
};
