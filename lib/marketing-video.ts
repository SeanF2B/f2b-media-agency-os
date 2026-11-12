export type MarketingVideo = { kind: "youtube" | "vimeo" | "file"; sourceUrl: string; embedUrl?: string };

/** Allow predictable video sources without accepting arbitrary iframe HTML. */
export function normalizeMarketingVideo(input: unknown): MarketingVideo | null {
  let url: URL;
  try { url = new URL(String(input || "")); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] || "";
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    return { kind: "youtube", sourceUrl: `https://youtu.be/${id}`, embedUrl: `https://www.youtube-nocookie.com/embed/${id}` };
  }
  if (["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)) {
    const parts = url.pathname.split("/").filter(Boolean);
    const id = url.searchParams.get("v") || (parts[0] === "embed" || parts[0] === "shorts" ? parts[1] : "") || "";
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    return { kind: "youtube", sourceUrl: `https://www.youtube.com/watch?v=${id}`, embedUrl: `https://www.youtube-nocookie.com/embed/${id}` };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    const id = (host === "player.vimeo.com" && parts[0] === "video" ? parts[1] : parts[0]) || "";
    if (!/^\d{1,20}$/.test(id)) return null;
    const hash = url.searchParams.get("h") || "";
    if (hash && !/^[A-Za-z0-9]{1,64}$/.test(hash)) return null;
    const suffix = hash ? `?h=${encodeURIComponent(hash)}` : "";
    return { kind: "vimeo", sourceUrl: `https://vimeo.com/${id}${suffix}`, embedUrl: `https://player.vimeo.com/video/${id}${suffix}` };
  }
  if (!/\.(mp4|webm|ogv|ogg)$/i.test(url.pathname)) return null;
  url.hash = "";
  return { kind: "file", sourceUrl: url.toString() };
}
