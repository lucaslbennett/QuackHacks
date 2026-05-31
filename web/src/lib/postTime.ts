import type { ContentItem } from "./influencers";

export function fmtPostTimestamp(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    hour: "numeric",
    minute: "2-digit",
  });
}

export function postTimeCaption(
  item: Pick<
    ContentItem,
    "status" | "scheduled_at" | "posted_at" | "updated_at" | "created_at"
  >,
): string | null {
  if (item.status === "scheduled" || item.status === "scheduling") {
    const t = fmtPostTimestamp(item.scheduled_at);
    return t ? `Scheduled for ${t}` : null;
  }
  if (item.status === "posted") {
    const t = fmtPostTimestamp(item.posted_at || item.updated_at);
    return t ? `Posted ${t}` : null;
  }
  return null;
}

export function isAutopilotContent(item: ContentItem): boolean {
  return item.meta?.source === "autopilot";
}

export function latestAutopilotContent(content: ContentItem[]): ContentItem | null {
  for (const item of content) {
    if (!isAutopilotContent(item)) continue;
    if (item.status === "scheduled" || item.status === "scheduling" || item.status === "posted") {
      return item;
    }
  }
  return null;
}

/** Autopilot hero label — treats past scheduled_at as posted until the next autopilot post. */
export function autopilotStatusLabel(
  item: Pick<
    ContentItem,
    "status" | "scheduled_at" | "posted_at" | "updated_at" | "created_at"
  >,
): { headline: string; sub: string | null; posted: boolean } {
  if (item.status === "posted") {
    return {
      headline: "Posted via autopilot",
      sub: postTimeCaption(item),
      posted: true,
    };
  }
  if (item.status === "scheduled" || item.status === "scheduling") {
    const due =
      item.scheduled_at && new Date(item.scheduled_at).getTime() <= Date.now();
    if (due) {
      const t = fmtPostTimestamp(item.scheduled_at);
      return {
        headline: "Posted via autopilot",
        sub: t ? `Posted ${t}` : null,
        posted: true,
      };
    }
    const t = fmtPostTimestamp(item.scheduled_at);
    return {
      headline: "Scheduled via autopilot",
      sub: t ? `Goes live ${t}` : null,
      posted: false,
    };
  }
  return { headline: "Autopilot", sub: null, posted: false };
}

export function hashtagLine(tags: string[] | null | undefined): string {
  return (tags || []).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
}
