import { getToken } from "./auth";

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// A channel connected to the user's Postiz account (Instagram, X, TikTok, ...).
// `identifier` is the platform (e.g. "instagram"); `id` is what we link to an
// influencer.
export interface PostizChannel {
  id: string;
  name: string | null;
  identifier: string | null;
  profile: string | null;
  picture: string | null;
  disabled: boolean;
}

export interface PostizStatus {
  // True when POSTIZ_API_KEY is set on the server.
  configured: boolean;
  // True when the key is valid + connected to a Postiz workspace.
  connected: boolean;
}

// Checks whether Postiz is configured + connected. Never throws: a server
// without a key returns { configured: false } so the UI can guide the user.
export async function getPostizStatus(): Promise<PostizStatus> {
  const res = await fetch("/api/postiz/status", { headers: authHeaders() });
  const data = await res.json().catch(() => ({ ok: false }));
  if (res.status === 400) return { configured: false, connected: false };
  if (!res.ok || data.ok === false) {
    return { configured: true, connected: false };
  }
  return { configured: true, connected: Boolean(data.connected) };
}

// Gets a Postiz OAuth URL for connecting a new channel of the given platform
// (default "instagram"). Open this URL so the user can authorize the account
// without leaving the app; afterwards the channel appears in listPostizChannels.
// Pass `refresh` (an existing channel id) to re-authorize an expired/disabled
// channel instead of creating a new connection.
export async function getPostizConnectUrl(
  platform = "instagram",
  refresh?: string,
): Promise<string> {
  const params = new URLSearchParams({ platform });
  if (refresh) params.set("refresh", refresh);
  const res = await fetch(`/api/postiz/connect-url?${params.toString()}`, {
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || data.ok === false || !data.url) {
    throw new Error(data.error || `Couldn't start the connection (${res.status})`);
  }
  return data.url as string;
}

// Lists the channels connected to the user's Postiz workspace.
export async function listPostizChannels(): Promise<PostizChannel[]> {
  const res = await fetch("/api/postiz/integrations", { headers: authHeaders() });
  const data = await res.json().catch(() => ({ ok: false }));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Failed to load Postiz channels (${res.status})`);
  }
  return (data.integrations as PostizChannel[]) || [];
}
