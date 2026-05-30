import { getToken } from "./auth";

export interface Generation {
  id: string;
  prompt: string;
  image_url: string;
  created_at: string;
}

interface GenerateResponse {
  ok: boolean;
  prompt?: string;
  imageUrl?: string;
  error?: string;
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

// Auth required: persist a generated image to the user's dashboard.
export async function saveGeneration(
  prompt: string,
  imageUrl: string,
): Promise<void> {
  const token = getToken();
  if (!token) throw new Error("You must be signed in to save");
  const res = await fetch("/api/generate/save", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ prompt, imageUrl }),
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
