import path from "node:path";
import * as repo from "../db/repo.js";
import * as postiz from "../services/postiz.js";
import { scrapeInstagramProfile } from "../services/browser/scrapeProfile.js";
import {
  clientMediaUrl,
  parseSocialCount,
  proxiedImageUrl,
  resolveContentImageUrl,
} from "./util.js";
import { isConfigured as stagehandConfigured } from "../services/browser/stagehand.js";
import { createLogger } from "./logger.js";

const log = createLogger("live-profile");
const CACHE_TTL_MS = 15 * 60 * 1000;

const METRIC_PICK = (summary, keys) => {
  for (const k of keys) {
    if (summary?.[k] && typeof summary[k].value === "number") {
      return summary[k].value;
    }
  }
  return null;
};

function absoluteMediaUrl(url) {
  if (!url) return null;
  const s = String(url).trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return `https:${s}`;
  return null;
}

function postizPostImage(post) {
  const media = post?.media;
  if (Array.isArray(media)) {
    for (const m of media) {
      const u = absoluteMediaUrl(m?.url) || absoluteMediaUrl(m?.path);
      if (u) return u;
    }
  }
  const blocks = post?.value || post?.posts?.[0]?.value;
  if (Array.isArray(blocks)) {
    for (const block of blocks) {
      const imgs = block?.image;
      if (Array.isArray(imgs)) {
        for (const img of imgs) {
          const u = absoluteMediaUrl(img?.path) || absoluteMediaUrl(img?.url);
          if (u) return u;
        }
      }
    }
  }
  return null;
}

async function loadInstagramCache(influencer, handle, { refresh = false } = {}) {
  if (!handle) return null;
  const cache = influencer.ig_profile_cache || {};
  const sameHandle = cache.handle === handle;
  const fresh =
    sameHandle &&
    cache.scrapedAt &&
    Date.now() - new Date(cache.scrapedAt).getTime() < CACHE_TTL_MS;

  if (!refresh && fresh) return cache;

  if (!stagehandConfigured()) {
    return sameHandle && cache.scrapedAt ? cache : null;
  }

  try {
    log.info(`Scraping live Instagram profile @${handle} (refresh=${refresh})`);
    const scraped = await scrapeInstagramProfile(handle);
    const next = {
      handle,
      scrapedAt: new Date().toISOString(),
      displayName: scraped.fullName || null,
      bio: scraped.bio || null,
      followers: parseSocialCount(scraped.followers),
      following: parseSocialCount(scraped.following),
      postsCount: parseSocialCount(scraped.postsCount),
      profilePicture: scraped.profilePicture || null,
      thumbnails: Array.isArray(scraped.thumbnails) ? scraped.thumbnails : [],
      channelUrl: scraped.url || null,
    };
    await repo.influencers.update(influencer.id, { ig_profile_cache: next });
    return next;
  } catch (err) {
    log.warn("Instagram scrape failed:", err.message);
    return sameHandle && cache.scrapedAt ? cache : null;
  }
}

async function ourPublishedPosts(influencerId) {
  const content = await repo.content.listFor(influencerId);
  const out = [];
  for (const item of content) {
    if (item.status !== "posted") continue;
    const imageUrl = await resolveContentImageUrl(item.image_paths?.[0]);
    if (!imageUrl) continue;
    out.push({
      id: item.id,
      imageUrl,
      caption: item.caption,
      status: "posted",
      source: "fastpost",
      publishedAt: item.updated_at || item.created_at,
    });
  }
  return out;
}

export async function computeLiveProfile(influencer, { refresh = false } = {}) {
  const persona =
    influencer.persona && typeof influencer.persona === "object" ? influencer.persona : {};
  const integrationId = influencer.postiz_integration_id;
  const handleRaw = influencer.handle || persona.handleSuggestions?.[0] || null;
  let handle = handleRaw ? String(handleRaw).replace(/^@+/, "") : null;

  const profile = {
    linked: Boolean(integrationId),
    displayName: persona.displayName || influencer.name,
    handle,
    bio: persona.bio || null,
    bioSource: "character",
    profilePicture: clientMediaUrl(influencer.image_url),
    profilePictureSource: "character",
    channelUrl: null,
    stats: { posts: 0, followers: null, following: null },
    live: {
      followers: false,
      following: false,
      bio: false,
      profilePicture: false,
      posts: false,
      instagram: false,
    },
    posts: [],
    limitations: [],
    scrapedAt: null,
    canScrapeInstagram: stagehandConfigured(),
  };

  if (postiz.isConfigured() && integrationId) {
    const integration = await postiz.getIntegration(integrationId).catch(() => null);
    if (integration) {
      profile.channelUrl = postiz.profileUrl(integration);
      if (integration.profile) {
        handle = String(integration.profile).replace(/^@+/, "");
        profile.handle = handle;
      }
      if (integration.picture) {
        profile.profilePicture = integration.picture;
        profile.profilePictureSource = "channel";
        profile.live.profilePicture = true;
      }
    }

    try {
      const ch = await postiz.getPlatformAnalytics(integrationId, { days: 30 });
      const followers = METRIC_PICK(ch, ["followers", "follower", "totalfollowers"]);
      if (followers != null) {
        profile.stats.followers = followers;
        profile.live.followers = true;
      }
    } catch {
      /* optional */
    }
  }

  const igCache = await loadInstagramCache(influencer, handle, { refresh });

  if (igCache) {
    profile.scrapedAt = igCache.scrapedAt;
    profile.live.instagram = true;
    if (igCache.displayName) profile.displayName = igCache.displayName;
    if (igCache.bio) {
      profile.bio = igCache.bio;
      profile.bioSource = "instagram";
      profile.live.bio = true;
    }
    if (igCache.profilePicture) {
      profile.profilePicture = igCache.profilePicture;
      profile.profilePictureSource = "instagram";
      profile.live.profilePicture = true;
    }
    if (igCache.followers != null) {
      profile.stats.followers = igCache.followers;
      profile.live.followers = true;
    }
    if (igCache.following != null) {
      profile.stats.following = igCache.following;
      profile.live.following = true;
    }
    if (igCache.postsCount != null) {
      profile.stats.posts = igCache.postsCount;
    }
    if (igCache.channelUrl) profile.channelUrl = igCache.channelUrl;

    if (igCache.thumbnails?.length) {
      profile.posts = igCache.thumbnails.map((imageUrl, i) => ({
        id: `ig-${i}`,
        imageUrl,
        caption: null,
        status: "posted",
        source: "instagram",
        publishedAt: igCache.scrapedAt,
      }));
      profile.live.posts = true;
    }
  }

  // Fill gaps from our published posts when Instagram grid wasn't scraped.
  if (!profile.live.posts) {
    const ours = await ourPublishedPosts(influencer.id);
    if (ours.length) {
      profile.posts = ours.slice(0, 12);
      profile.live.posts = true;
      if (!profile.stats.posts) profile.stats.posts = ours.length;
    }
  }

  // Postiz published posts with CDN images (backup).
  if (!profile.live.posts && postiz.isConfigured() && integrationId) {
    try {
      const remote = await postiz.listPosts();
      const fromPostiz = [];
      for (const p of remote) {
        const intId = p?.integration?.id || p?.integrationId;
        if (intId && String(intId) !== String(integrationId)) continue;
        const stateUp = String(p?.state || p?.status || "").toUpperCase();
        if (stateUp && !["PUBLISHED", "POSTED", "QUEUE"].includes(stateUp)) continue;
        const imageUrl = postizPostImage(p);
        if (!imageUrl) continue;
        fromPostiz.push({
          id: String(p?.id || p?.postId || imageUrl),
          imageUrl,
          caption: typeof p?.content === "string" ? p.content : null,
          status: stateUp === "QUEUE" ? "scheduled" : "posted",
          source: "postiz",
          publishedAt: p?.publishDate || p?.date || null,
        });
      }
      if (fromPostiz.length) {
        profile.posts = fromPostiz.slice(0, 12);
        profile.live.posts = true;
        if (!profile.stats.posts) profile.stats.posts = fromPostiz.length;
      }
    } catch {
      /* optional */
    }
  }

  if (!profile.stats.posts) profile.stats.posts = profile.posts.length;

  if (!profile.live.instagram) {
    profile.limitations.push(
      profile.canScrapeInstagram
        ? "Connect an account and use Refresh to pull the live Instagram profile."
        : "Set BROWSER_USE_API_KEY (or SIGNUP_LOCAL_BROWSER=1) to enable live Instagram scraping."
    );
  }
  if (!profile.live.bio) {
    profile.limitations.push("Bio shown from your character setup until Instagram is scraped.");
  }
  if (!profile.live.following) {
    profile.limitations.push("Following count requires a live Instagram scrape.");
  }

  profile.profilePicture = proxiedImageUrl(profile.profilePicture);
  profile.posts = profile.posts.map((p) => ({
    ...p,
    imageUrl: proxiedImageUrl(p.imageUrl) || p.imageUrl,
  }));

  return profile;
}
