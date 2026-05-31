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

// Removes a connected channel from Postiz (and its scheduled posts there).
export async function deleteIntegration(integrationId) {
  if (!integrationId) throw new Error("integrationId is required");
  log.info(`Deleting Postiz integration ${integrationId}`);
  const data = await postizFetch(`/integrations/${encodeURIComponent(integrationId)}`, {
    method: "DELETE",
  });
  return data;
}

// Looks up a single connected channel by its Postiz integration id. Returns the
// raw integration object (id, name, identifier, profile, picture, ...) or null
// if no channel with that id is connected.
export async function getIntegration(integrationId) {
  if (!integrationId) return null;
  const list = await listIntegrations();
  return list.find((i) => String(i.id) === String(integrationId)) || null;
}

// Best-effort public URL for a channel's profile, used to deep-link the user to
// the live account (e.g. the influencer's Instagram page). Postiz exposes the
// channel's handle as `profile`; we map it to the platform's profile URL.
export function profileUrl(integration) {
  if (!integration) return null;
  const platform = String(integration.identifier || "").split("-")[0];
  const handle = String(integration.profile || integration.name || "")
    .trim()
    .replace(/^@/, "")
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/\/+$/, "");
  if (!handle) return null;
  switch (platform) {
    case "instagram":
      return `https://www.instagram.com/${handle}/`;
    case "x":
    case "twitter":
      return `https://x.com/${handle}`;
    case "tiktok":
      return `https://www.tiktok.com/@${handle}`;
    case "youtube":
      return `https://www.youtube.com/@${handle}`;
    default:
      return null;
  }
}

// Generates a Postiz OAuth authorization URL for connecting a new channel of
// the given platform (e.g. "instagram", "instagram-standalone", "x"). The user
// is redirected there to authorize; Postiz completes the OAuth and the channel
// then appears in listIntegrations(). Pass `refresh` (an existing integration
// id) to refresh that connection's token instead of creating a new one. Only
// OAuth-based platforms are supported (400 otherwise).
export async function getConnectUrl(platform, { refresh } = {}) {
  const id = encodeURIComponent(String(platform || "").trim());
  if (!id) throw new Error("platform is required");
  const qs = refresh ? `?refresh=${encodeURIComponent(refresh)}` : "";
  const data = await postizFetch(`/social/${id}${qs}`);
  if (!data?.url) throw new Error("Postiz returned no OAuth URL");
  return data.url;
}

// Postiz analytics endpoints return an array of metric series:
//   [{ label: "Likes", data: [{ total: "150", date: "2025-01-01" }, ...],
//      percentageChange: 16.7 }, ...]
// This flattens one such series array into a simple { metricKey: { value,
// change } } map using the latest (last) data point per label. Labels are
// lowercased (e.g. "Followers" -> "followers", "Total Views" -> "totalviews").
function summarizeAnalytics(series) {
  const out = {};
  if (!Array.isArray(series)) return out;
  for (const s of series) {
    const label = String(s?.label || "").trim();
    if (!label) continue;
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const points = Array.isArray(s.data) ? s.data : [];
    const last = points[points.length - 1];
    const value = Number(last?.total ?? 0) || 0;
    out[key] = {
      label,
      value,
      change: typeof s.percentageChange === "number" ? s.percentageChange : null,
    };
  }
  return out;
}

// Platform/channel analytics for an integration (followers, impressions, ...).
// `days` is the look-back window (Postiz requires it). Returns a summarized map.
export async function getPlatformAnalytics(integrationId, { days = 7 } = {}) {
  if (!integrationId) throw new Error("integrationId is required");
  const series = await postizFetch(
    `/analytics/${encodeURIComponent(integrationId)}?date=${encodeURIComponent(days)}`
  );
  return summarizeAnalytics(series);
}

// Per-post analytics for a published Postiz post (likes, comments, ...).
// Returns a summarized map. `days` is the look-back window.
export async function getPostAnalytics(postId, { days = 7 } = {}) {
  if (!postId) throw new Error("postId is required");
  const series = await postizFetch(
    `/analytics/post/${encodeURIComponent(postId)}?date=${encodeURIComponent(days)}`
  );
  return summarizeAnalytics(series);
}

// Asks Postiz for the next free posting slot for a channel (honours the
// account's scheduling preferences). Returns an ISO date string or null.
export async function findNextSlot(integrationId) {
  const data = await postizFetch(`/find-slot/${integrationId}`).catch(() => null);
  return data?.date || null;
}

// Lists posts in a date window. Filter by integration id client-side.
export async function listPosts({ startDate, endDate, customer } = {}) {
  const start =
    startDate || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const end = endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const qs = new URLSearchParams({ startDate: start, endDate: end });
  if (customer) qs.set("customer", customer);
  const data = await postizFetch(`/posts?${qs}`);
  if (Array.isArray(data)) return data;
  return data?.posts || [];
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
