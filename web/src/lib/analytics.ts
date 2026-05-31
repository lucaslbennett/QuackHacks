import { getToken } from "./auth";

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Live per-post metrics from Postiz. Any field is null when the platform didn't
// return that metric (so the UI can fall back to a demo value).
export interface PostAnalytics {
  postizPostId: string;
  contentId: string | null;
  caption: string | null;
  likes: number | null;
  comments: number | null;
  views: number | null;
}

// Live analytics for a single influencer.
export interface InfluencerAnalytics {
  linked: boolean;
  // True once any real metric came back from Postiz.
  available: boolean;
  channel: { followers: number | null; impressions: number | null } | null;
  posts: PostAnalytics[];
  totals: {
    likes: number | null;
    comments: number | null;
    views: number | null;
  };
}

// Aggregated analytics across all of the user's influencers.
export interface AllAnalytics {
  available: boolean;
  totals: { followers: number; likes: number; comments: number; views: number };
  influencers: (InfluencerAnalytics & { influencerId: string; name: string })[];
}

const EMPTY_INFLUENCER: InfluencerAnalytics = {
  linked: false,
  available: false,
  channel: null,
  posts: [],
  totals: { likes: null, comments: null, views: null },
};

// Module-level cache of the last successful (real) result per key. Persists
// across component mounts for the life of the page, so returning to an analytics
// tab can render the previous live numbers instantly while a fresh fetch runs in
// the background. We only cache results that actually contained real data, so a
// later empty/failed response never overwrites good numbers with placeholders.
const influencerCache = new Map<string, InfluencerAnalytics>();
let allCache = new Map<string, AllAnalytics>();

const keyFor = (id: string, days: number) => `${id}:${days}`;

// Synchronously read the last cached influencer analytics (or null).
export function getCachedInfluencerAnalytics(
  influencerId: string,
  days = 7,
): InfluencerAnalytics | null {
  return influencerCache.get(keyFor(influencerId, days)) ?? null;
}

// Synchronously read the last cached aggregate analytics (or null).
export function getCachedAllAnalytics(days = 7): AllAnalytics | null {
  return allCache.get(String(days)) ?? null;
}

// Live analytics for one influencer. Never throws — returns an empty (all-null)
// shape on failure so callers always fall back to demo numbers. Caches the
// result when it contains real data.
export async function getInfluencerAnalytics(
  influencerId: string,
  days = 7,
): Promise<InfluencerAnalytics> {
  try {
    const res = await fetch(
      `/api/influencers/${influencerId}/analytics?days=${days}`,
      { headers: authHeaders() },
    );
    const data = await res.json().catch(() => ({ ok: false }));
    if (!res.ok || data.ok === false) return EMPTY_INFLUENCER;
    const result: InfluencerAnalytics = {
      linked: Boolean(data.linked),
      available: Boolean(data.available),
      channel: data.channel ?? null,
      posts: Array.isArray(data.posts) ? data.posts : [],
      totals: data.totals ?? EMPTY_INFLUENCER.totals,
    };
    if (result.available) influencerCache.set(keyFor(influencerId, days), result);
    return result;
  } catch {
    return EMPTY_INFLUENCER;
  }
}

// Aggregated live analytics across all of the user's influencers. Never throws.
// Caches the result when it contains real data.
export async function getAllAnalytics(days = 7): Promise<AllAnalytics> {
  const empty: AllAnalytics = {
    available: false,
    totals: { followers: 0, likes: 0, comments: 0, views: 0 },
    influencers: [],
  };
  try {
    const res = await fetch(`/api/influencers/analytics?days=${days}`, {
      headers: authHeaders(),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    if (!res.ok || data.ok === false) return empty;
    const result: AllAnalytics = {
      available: Boolean(data.available),
      totals: data.totals ?? empty.totals,
      influencers: Array.isArray(data.influencers) ? data.influencers : [],
    };
    if (result.available) allCache.set(String(days), result);
    return result;
  } catch {
    return empty;
  }
}

// Clears all cached analytics (e.g. on sign-out, so the next user starts fresh).
export function clearAnalyticsCache() {
  influencerCache.clear();
  allCache = new Map();
}
