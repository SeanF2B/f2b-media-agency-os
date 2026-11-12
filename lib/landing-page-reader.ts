import { extractPublicWebsiteImages, type PublicWebsiteImage } from "./public-website-assets";

export type LandingPageEvidence = {
  url: string;
  status: "connected" | "unavailable";
  title?: string;
  description?: string;
  text?: string;
  images?: PublicWebsiteImage[];
  error?: string;
};

function safeUrl(value: unknown): URL | null {
  try {
    const url = new URL(String(value || "").trim());
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.protocol !== "https:" || url.username || url.password || !host.includes(".")) return null;
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".test")) return null;
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || host.startsWith("[") || host === "0.0.0.0") return null;
    url.hash = "";
    return url;
  } catch { return null; }
}

async function readLimited(response: Response, limit = 240_000): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const chunk = value.slice(0, limit - size);
    chunks.push(chunk);
    size += chunk.byteLength;
    if (chunk.byteLength !== value.byteLength) { await reader.cancel(); break; }
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(joined);
}

function decodeEntities(value: string): string {
  return value.replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function cleanHtml(html: string) {
  const title = decodeEntities(html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
  const description = decodeEntities(html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i)?.[1] || html.match(/<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i)?.[1] || "").replace(/\s+/g, " ").trim().slice(0, 500);
  const text = decodeEntities(html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg|iframe|nav|footer|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/section|\/article|\/main|\/tr)\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " "))
    .replace(/[\t\r ]+/g, " ").replace(/\n\s+/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 8000);
  return { title, description, text };
}

/** Read a small text-only snapshot of a published HTTPS landing page. Never sends credentials. */
export async function readLandingPage(value: unknown): Promise<LandingPageEvidence> {
  let url = safeUrl(value);
  if (!url) return { url: String(value || ""), status: "unavailable", error: "Add a valid public HTTPS URL." };
  try {
    let response: Response | undefined;
    for (let redirects = 0; redirects <= 3; redirects++) {
      response = await fetch(url.toString(), {
        redirect: "manual",
        signal: AbortSignal.timeout(9000),
        headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "F2B-Agency-Landing-Page-Reader/1.0" },
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location || redirects === 3) throw new Error("The page redirected too many times.");
      const redirected = safeUrl(new URL(location, url).toString());
      if (!redirected) throw new Error("The page redirected to an unsupported address.");
      url = redirected;
    }
    if (!response?.ok) throw new Error(`The page returned HTTP ${response?.status || "unknown"}.`);
    if (!/(?:text\/html|application\/xhtml\+xml)/i.test(response.headers.get("content-type") || "")) throw new Error("The URL did not return a public HTML page.");
    const html = await readLimited(response);
    const page = cleanHtml(html);
    if (!page.text) throw new Error("No readable page text was found.");
    return { url: url.toString(), status: "connected", ...page, images: extractPublicWebsiteImages(html, url.toString()) };
  } catch (error) {
    return { url: url.toString(), status: "unavailable", error: error instanceof Error ? error.message : "Could not read this page." };
  }
}
