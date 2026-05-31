import { config } from "../config.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("postiz");

export function isConfigured() {
  return Boolean(config.postiz.apiKey);
}

function ensureConfig() {
  if (!config.postiz.apiKey) throw new Error("POSTIZ_API_KEY not configured");
}

// Thin wrapper around the Postiz public API. Auth is the raw API key in the
// Authorization header (no "Bearer " prefix), per the Postiz docs.
async function postizFetch(path, { method = "GET", body, headers = {} } = {}) {
  ensureConfig();
  const url = `${config.postiz.apiBase}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: config.postiz.apiKey,
      ...headers,
    },
    body,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || text || res.statusText;
    throw new Error(`Postiz ${method} ${path} failed ${res.status}: ${msg}`);
  }
  return data;
}

// Confirms the API key is valid and connected.
export async function isConnected() {
  const data = await postizFetch("/is-connected");
  return Boolean(data?.connected);
}

// Lists the connected channels (Instagram, X, TikTok, ...). Each has an `id`
// used as the integration id when scheduling posts.
export async function listIntegrations() {
  const data = await postizFetch("/integrations");
  return Array.isArray(data) ? data : data?.integrations || [];
}

// Asks Postiz for the next free posting slot for a channel (honours the
// account's scheduling preferences). Returns an ISO date string or null.
export async function findNextSlot(integrationId) {
  const data = await postizFetch(`/find-slot/${integrationId}`).catch(() => null);
  return data?.date || null;
}

// Uploads media from a public URL into Postiz storage. Returns { id, path }.
export async function uploadFromUrl(url) {
  const data = await postizFetch("/upload-from-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!data?.path) throw new Error("Postiz upload-from-url returned no path");
  return { id: data.id, path: data.path };
}

// Per-platform settings block (the `__type` plus platform-specific fields).
// We keep sensible defaults for the platforms we care about and fall back to a
// bare `__type` for anything else.
function settingsFor(identifier) {
  // Postiz channel identifiers can be suffixed (e.g. "instagram-standalone"),
  // so match on the platform prefix rather than the exact string.
  const platform = String(identifier || "").split("-")[0];
  switch (platform) {
    case "instagram":
      return { __type: identifier, post_type: "post", is_trial_reel: false, collaborators: [] };
    case "x":
    case "twitter":
      return { __type: identifier, who_can_reply_post: "everyone" };
    case "tiktok":
      return { __type: identifier };
    case "youtube":
      return { __type: identifier };
    default:
      return { __type: identifier };
  }
}

// Schedules (or immediately publishes) a single post to one channel.
//
//  integrationId – the Postiz channel id
//  identifier    – the channel platform (e.g. "instagram"); drives settings
//  content       – caption/text (hashtags should already be appended)
//  date          – Date | ISO string of when to publish (UTC)
//  media         – array of { id, path } from uploadFromUrl (optional)
//  type          – "schedule" | "now" | "draft" (defaults from config)
//
// Returns the Postiz response (array of { postId, integration }).
export async function schedulePost({
  integrationId,
  identifier = "instagram",
  content,
  date = new Date(),
  media = [],
  type = config.postiz.defaultType,
  settings,
}) {
  if (!integrationId) throw new Error("integrationId is required");
  const when = date instanceof Date ? date.toISOString() : new Date(date).toISOString();

  const body = {
    type,
    date: when,
    shortLink: false,
    tags: [],
    posts: [
      {
        integration: { id: integrationId },
        value: [{ content: content || "", image: media }],
        settings: settings || settingsFor(identifier),
      },
    ],
  };

  log.info(`Scheduling ${identifier} post to ${integrationId} (${type}) for ${when}`);
  const data = await postizFetch("/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const first = Array.isArray(data) ? data[0] : data;
  return { postId: first?.postId || first?.id || null, raw: data };
}

// Moves a post between draft and schedule states.
export async function changePostStatus(postId, status) {
  return postizFetch(`/posts/${postId}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}
