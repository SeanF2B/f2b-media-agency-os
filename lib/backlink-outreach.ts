export const BACKLINK_OUTREACH_STATUSES = ["To review", "Shortlisted", "Contacted", "Replied", "Link live", "Not suitable"] as const;
export type BacklinkOutreachStatus = typeof BACKLINK_OUTREACH_STATUSES[number];

export type BacklinkOutreachInput = {
  sourceUrl: string;
  targetUrl: string;
  sourceDomain?: string;
  anchor?: string;
  note?: string;
};

export function normalizePublicHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname || url.username || url.password) return null;
    if (url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname) || url.hostname.includes(":")) return null;
    url.hash = "";
    return url.toString();
  } catch { return null; }
}

export function validateBacklinkOutreachInput(input: Record<string, unknown>): { value: BacklinkOutreachInput } | { error: string } {
  const sourceUrl = normalizePublicHttpUrl(input.sourceUrl);
  const targetUrl = normalizePublicHttpUrl(input.targetUrl);
  if (!sourceUrl || !targetUrl) return { error: "Enter valid public source and target page URLs." };
  const sourceDomain = typeof input.sourceDomain === "string" && input.sourceDomain.trim() ? input.sourceDomain.trim().slice(0, 253) : new URL(sourceUrl).hostname;
  const anchor = typeof input.anchor === "string" ? input.anchor.trim().slice(0, 500) : "";
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 2000) : "";
  return { value: { sourceUrl, targetUrl, sourceDomain, anchor, note } };
}

export function isBacklinkOutreachStatus(value: unknown): value is BacklinkOutreachStatus {
  return typeof value === "string" && BACKLINK_OUTREACH_STATUSES.includes(value as BacklinkOutreachStatus);
}

export function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
