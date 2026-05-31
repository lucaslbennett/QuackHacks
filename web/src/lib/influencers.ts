import { getToken } from "./auth";
import type { Character } from "./generate";

// A user-owned influencer created from the onboarding quiz funnel and managed
// from the dashboard. Mirrors the influencers table (+ summary fields on list).
export interface Influencer {
  id: string;
  user_id: string | null;
  name: string;
  handle: string | null;
  niche: string | null;
  status: string; // draft | ready | spawning | active | paused | error
  persona: Partial<Character>;
  image_url: string | null;
  posts_per_day: number;
  // Linked Postiz channel (null until connected); platform drives the post.
  postiz_integration_id: string | null;
  postiz_platform: string | null;
  created_at: string;
  // Present on the list summary.
  accountStatus?: string | null;
  accountUsername?: string | null;
  postCount?: number;
}

// A content item in an influencer's history (image post or rendered reel).
export interface ContentItem {
  id: string;
  title: string | null;
  caption: string | null;
  hashtags: string[] | null;
  image_paths: string[] | null;
  video_path: string | null;
  videoUrl?: string | null;
  status: string;
  created_at: string;
}

export interface InfluencerAccount {
  id: string;
  username: string | null;
  status: string;
  email: string | null;
  notes: string | null;
}

export interface MetricsDay {
  date: string;
  views: number;
  likes: number;
  comments: number;
  followers: number;
}

export interface InfluencerDetail {
  influencer: Influencer;
  account: InfluencerAccount | null;
  content: ContentItem[];
  posts: unknown[];
  metrics: MetricsDay[];
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Auth required: create a user-owned influencer from the designed character.
export async function launchInfluencer(
  character: Character,
  imageUrl: string,
): Promise<Influencer> {
  const res = await fetch("/api/influencers/launch", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ character, imageUrl }),
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || data.ok === false || !data.influencer) {
    throw new Error(data.error || `Launch failed (${res.status})`);
  }
  return data.influencer as Influencer;
}

// Auth required: the signed-in user's influencers (with summary fields).
export async function listMyInfluencers(): Promise<Influencer[]> {
  const token = getToken();
  if (!token) return [];
  const res = await fetch("/api/influencers/mine", { headers: authHeaders() });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({ ok: false }));
  return data.ok ? (data.influencers as Influencer[]) : [];
}

// Auth required: link an influencer to a connected Postiz channel so its posts
// publish to that account. `platform` (instagram | x | tiktok | ...) drives the
// per-post settings; defaults to instagram.
export async function linkPostizChannel(
  influencerId: string,
  integrationId: string,
  platform = "instagram",
): Promise<{ postiz_integration_id: string; postiz_platform: string }> {
  const res = await fetch(`/api/influencers/${influencerId}/postiz`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ integrationId, platform }),
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || data.ok === false || !data.influencer) {
    throw new Error(data.error || `Failed to link channel (${res.status})`);
  }
  return {
    postiz_integration_id: data.influencer.postiz_integration_id,
    postiz_platform: data.influencer.postiz_platform,
  };
}

// Auth required: full detail for one influencer (account, content, metrics).
export async function getInfluencer(id: string): Promise<InfluencerDetail> {
  const res = await fetch(`/api/influencers/${id}`, { headers: authHeaders() });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Failed to load influencer (${res.status})`);
  }
  return {
    influencer: data.influencer,
    account: data.account,
    content: data.content || [],
    posts: data.posts || [],
    metrics: data.metrics || [],
  };
}
