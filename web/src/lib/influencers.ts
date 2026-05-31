import { getToken } from "./auth";
import type { Character } from "./generate";

// A user-owned influencer created from a brief and managed from the dashboard.
// Mirrors the influencers table (+ summary fields on list).
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
  posting_schedule?: PostingSchedule;
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
  updated_at?: string;
  scheduled_at?: string | null;
  posted_at?: string | null;
  meta?: { source?: string; altText?: string } | null;
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

export interface PostingSchedule {
  enabled: boolean;
  mode: "off" | "fixed" | "random";
  timezone: string;
  times: string[];
  intervalMinutes: 5 | 60 | 360 | 1440;
  intervalHours?: number;
  nextRunAt: string | null;
}

export interface PostingScheduleSummary {
  active: boolean;
  mode?: "fixed" | "random";
  summary: string;
  times?: string[];
  timezone?: string;
  intervalMinutes?: number;
  intervalHours?: number;
  nextRunAt?: string | null;
}

export interface LiveProfilePost {
  id: string;
  imageUrl: string;
  caption: string | null;
  status: string;
  source: string;
  publishedAt: string | null;
}

export interface LiveProfile {
  linked: boolean;
  displayName: string;
  handle: string | null;
  bio: string | null;
  bioSource: string;
  profilePicture: string | null;
  profilePictureSource: string;
  channelUrl: string | null;
  stats: { posts: number; followers: number | null; following: number | null };
  live: {
    followers: boolean;
    following: boolean;
    bio: boolean;
    profilePicture: boolean;
    posts: boolean;
    instagram?: boolean;
  };
  posts: LiveProfilePost[];
  limitations: string[];
  scrapedAt?: string | null;
  canScrapeInstagram?: boolean;
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

export async function getLiveProfile(
  influencerId: string,
  opts?: { refresh?: boolean },
): Promise<LiveProfile> {
  const qs = opts?.refresh ? "?refresh=1" : "";
  const res = await fetch(`/api/influencers/${influencerId}/live-profile${qs}`, {
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || data.ok === false || !data.profile) {
    throw new Error(data.error || `Failed to load live profile (${res.status})`);
  }
  return data.profile as LiveProfile;
}

export async function reorderInfluencers(order: string[]): Promise<void> {
  const res = await fetch("/api/influencers/reorder", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ order }),
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Failed to reorder (${res.status})`);
  }
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

// Auth required: update stored character fields (e.g. after renaming on reveal).
export async function updateInfluencerCharacter(
  influencerId: string,
  character: Character,
  answers?: Record<string, string>,
): Promise<Influencer> {
  const name = String(character.displayName || "").trim() || "My Influencer";
  const handle = (character.handleSuggestions?.[0] || "").trim() || null;
  const questionnaire = answers ?? character.answers ?? {};
  const res = await fetch(`/api/influencers/${influencerId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      name,
      handle: handle || null,
      niche: character.niche || null,
      persona: { ...character, answers: questionnaire },
      questionnaire,
    }),
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || data.ok === false || !data.influencer) {
    throw new Error(data.error || `Failed to update influencer (${res.status})`);
  }
  return data.influencer as Influencer;
}

// Auth required: permanently delete an influencer and related content.
export async function deleteInfluencer(influencerId: string): Promise<void> {
  const res = await fetch(`/api/influencers/${influencerId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Failed to delete influencer (${res.status})`);
  }
}

// Auth required: update the influencer's Instagram @handle (display username).
// The leading "@" is stripped so storage stays consistent. Returns the updated
// influencer.
export async function updateInfluencerHandle(
  influencerId: string,
  handle: string,
): Promise<Influencer> {
  const clean = handle.trim().replace(/^@+/, "");
  const res = await fetch(`/api/influencers/${influencerId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ handle: clean || null }),
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || data.ok === false || !data.influencer) {
    throw new Error(data.error || `Failed to update username (${res.status})`);
  }
  return data.influencer as Influencer;
}

// Auth required: unlink an influencer from its Postiz channel so it no longer
// publishes to that account. Returns the cleared link fields.
export async function unlinkPostizChannel(
  influencerId: string,
): Promise<{ postiz_integration_id: string | null; postiz_platform: string | null }> {
  const res = await fetch(`/api/influencers/${influencerId}/postiz`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Failed to unlink channel (${res.status})`);
  }
  return {
    postiz_integration_id: data.influencer?.postiz_integration_id ?? null,
    postiz_platform: data.influencer?.postiz_platform ?? null,
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

export async function getPostingSchedule(influencerId: string): Promise<{
  schedule: PostingSchedule;
  summary: PostingScheduleSummary;
  canAutopilot: boolean;
  autopilotBlocked: string | null;
  lastAutopilotJob: {
    id: string;
    status: string;
    runAt: string;
    lastError: string | null;
    updatedAt: string;
  } | null;
}> {
  const res = await fetch(`/api/influencers/${influencerId}/schedule`, {
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Failed to load schedule (${res.status})`);
  }
  return {
    schedule: data.schedule,
    summary: data.summary,
    canAutopilot: Boolean(data.canAutopilot),
    autopilotBlocked: data.autopilotBlocked ?? null,
    lastAutopilotJob: data.lastAutopilotJob ?? null,
  };
}

export async function savePostingSchedule(
  influencerId: string,
  schedule: Partial<PostingSchedule> & { enabled: boolean; mode: "fixed" | "random" | "off" },
): Promise<{
  schedule: PostingSchedule;
  summary: PostingScheduleSummary;
  planned: number;
  warning: string | null;
}> {
  const res = await fetch(`/api/influencers/${influencerId}/schedule`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(schedule),
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Failed to save schedule (${res.status})`);
  }
  return {
    schedule: data.schedule,
    summary: data.summary,
    planned: data.planned ?? 0,
    warning: data.warning ?? null,
  };
}
