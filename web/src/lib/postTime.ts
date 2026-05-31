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
