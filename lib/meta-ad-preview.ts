export function trustedMetaAdPreviewUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const allowedHost = hostname === "facebook.com" || hostname.endsWith(".facebook.com") || hostname === "instagram.com" || hostname.endsWith(".instagram.com");
    return url.protocol === "https:" && allowedHost ? url.href : null;
  } catch { return null; }
}

export function extractMetaAdPreviewUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  for (const item of data) {
    if (!item || typeof item !== "object" || typeof (item as { body?: unknown }).body !== "string") continue;
    const html = (item as { body: string }).body.slice(0, 200_000).replace(/&amp;/gi, "&").replace(/&#x2f;/gi, "/").replace(/&#47;/g, "/").replace(/&quot;/gi, '"').replace(/&#39;/g, "'");
    const match = /<iframe\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/i.exec(html);
    if (!match) continue;
    const url = trustedMetaAdPreviewUrl(match[2]);
    if (url) return url;
  }
  return null;
}
