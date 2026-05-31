import { getToken } from "./auth";

// Bearer header when signed in; empty object otherwise (request still succeeds
// for the public/optional-auth endpoints).
function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface Generation {
  id: string;
  prompt: string;
  image_url: string;
  created_at: string;
  // The full character saved alongside the image (empty object for older rows).
  persona?: Partial<Character>;
}

// A freshly generated, ready-to-post Instagram post for an influencer.
export interface GeneratedPost {
  imageUrl: string;
  caption: string;
  hashtags: string[];
  hashtagLine: string;
  altText: string;
  imagePrompt: string;
  // Caption + hashtags formatted as one block, ready to paste into Instagram.
  copyText: string;
  // Set when the post was persisted to an influencer's content history.
  contentId: string | null;
}

interface GenerateResponse {
  ok: boolean;
  prompt?: string;
  imageUrl?: string;
  error?: string;
}

// The full character the onboarding chat designs (persona + content plan).
export interface Character {
  firstName: string;
  lastName: string;
  displayName: string;
  tagline: string;
  handleSuggestions: string[];
  niche: string;
  bio: string;
  personality: string;
  appearance: string;
  aesthetic: string;
  contentPillars: string[];
  contentFormats: string[];
  samplePosts: { hook: string; caption: string }[];
  postingStrategy: {
    postsPerDay: number;
    bestTimes: string[];
    hashtagThemes: string[];
  };
  imagePrompt: string;
  // The raw onboarding answers, carried through so they're stored as the
  // influencer's questionnaire. Optional: only set when launching.
  answers?: Record<string, string>;
}

interface OnboardingResponse {
  ok: boolean;
  character?: Character;
  imageUrl?: string;
  error?: string;
}

// Public: design a full character (persona + content plan) from onboarding chat
// answers and render its portrait with Nano Banana on fal.ai.
export async function generateOnboardingCharacter(
  answers: Record<string, string>,
): Promise<{ character: Character; imageUrl: string }> {
  const res = await fetch("/api/generate/onboarding-character", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answers }),
  });
  const data: OnboardingResponse = await res
    .json()
    .catch(() => ({ ok: false }) as OnboardingResponse);
  if (!res.ok || data.ok === false || !data.character || !data.imageUrl) {
    throw new Error(data.error || `Character generation failed (${res.status})`);
  }
  return { character: data.character, imageUrl: data.imageUrl };
}

// Public: generate an influencer image from a description (Nano Banana Pro).
export async function generateInfluencerImage(
  prompt: string,
): Promise<{ prompt: string; imageUrl: string }> {
  const res = await fetch("/api/generate/influencer-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const data: GenerateResponse = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || data.ok === false || !data.imageUrl) {
    throw new Error(data.error || `Generation failed (${res.status})`);
  }
  return { prompt: data.prompt ?? prompt, imageUrl: data.imageUrl };
}

// Public: generate a fresh, varied Instagram post (image + caption + hashtags)
// for an existing influencer. Pass the saved persona when available; otherwise
// the prompt is used as a fallback brief. When `influencerId` is given (and the
// caller owns it), the post is persisted to that influencer's content history
// and the returned contentId is set. Each call returns a distinct post.
export async function generatePost(input: {
  persona?: Partial<Character>;
  prompt?: string;
  influencerId?: string;
}): Promise<GeneratedPost> {
  const res = await fetch("/api/generate/post", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || data.ok === false || !data.imageUrl) {
    throw new Error(data.error || `Post generation failed (${res.status})`);
  }
  return {
    imageUrl: data.imageUrl,
    caption: data.caption ?? "",
    hashtags: Array.isArray(data.hashtags) ? data.hashtags : [],
    hashtagLine: data.hashtagLine ?? "",
    altText: data.altText ?? "",
    imagePrompt: data.imagePrompt ?? "",
    copyText: data.copyText ?? "",
    contentId: data.contentId ?? null,
  };
}

// Auth required: persist a generated image (and optional character) to the
// user's dashboard.
export async function saveGeneration(
  prompt: string,
  imageUrl: string,
  persona?: Character,
): Promise<void> {
  const token = getToken();
  if (!token) throw new Error("You must be signed in to save");
  const res = await fetch("/api/generate/save", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ prompt, imageUrl, persona }),
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Save failed (${res.status})`);
  }
}

// Auth required: list the user's saved generations.
export async function listSavedGenerations(): Promise<Generation[]> {
  const token = getToken();
  if (!token) return [];
  const res = await fetch("/api/generate/saved", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({ ok: false }));
  return data.ok ? (data.generations as Generation[]) : [];
}
