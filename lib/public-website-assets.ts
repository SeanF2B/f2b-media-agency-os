export type PublicWebsiteImage = { url: string; alt: string };

function safeImageUrl(value: string, baseUrl: string) {
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol !== "https:" || url.username || url.password || !/\.(?:jpe?g|png|webp|gif)$/i.test(url.pathname)) return "";
    return url.toString().slice(0, 1000);
  } catch { return ""; }
}

function attributes(tag: string) {
  const result = new Map<string, string>();
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
}

/** Read image references already present in a public client page; never fetches them. */
export function extractPublicWebsiteImages(html: string, pageUrl: string): PublicWebsiteImage[] {
  const images: PublicWebsiteImage[] = [];
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const attrs = attributes(tag);
    const candidates = [attrs.get("src"), attrs.get("data-src"), attrs.get("data-lazy-src")].filter((value): value is string => Boolean(value));
    const raw = candidates.find((value) => safeImageUrl(value, pageUrl)) || "";
    const url = safeImageUrl(raw, pageUrl);
    if (!url) continue;
    const alt = (attrs.get("alt") || "").replace(/\s+/g, " ").trim().slice(0, 160);
    images.push({ url, alt });
  }
  const unique = [...new Map(images.map((image) => [image.url, image])).values()];
  return unique.sort((a, b) => Number(/logo/i.test(b.alt + b.url)) - Number(/logo/i.test(a.alt + a.url))).slice(0, 12);
}

export function selectApprovedWebsiteImage(value: unknown, images: PublicWebsiteImage[]) {
  if (typeof value !== "string") return null;
  const url = safeImageUrl(value, "https://invalid.example/");
  if (!url) return null;
  return images.find((image) => image.url === url) || null;
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function createApprovedWebsiteImageBlock(value: unknown, images: PublicWebsiteImage[]) {
  const image = selectApprovedWebsiteImage(value, images);
  if (!image) return "";
  const url = escapeAttribute(image.url);
  const alt = escapeAttribute(image.alt);
  const attributes = JSON.stringify({ id: 0, sizeSlug: "large", linkDestination: "none", url: image.url, alt: image.alt });
  return `<!-- wp:image ${attributes} -->\n<figure class="wp-block-image"><img src="${url}" alt="${alt}" class="wp-image-0"/></figure>\n<!-- /wp:image -->`;
}
