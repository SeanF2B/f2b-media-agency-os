export type TrackingTagCheck = { key: "google_ads" | "google_analytics" | "google_tag_manager" | "meta_pixel"; label: string; status: "found" | "not_found" | "tag_manager"; ids: string[] };
export type SiteTrackingResult = { status: "checked"; pageUrl: string; checkedAt: string; checks: TrackingTagCheck[]; note: string };

function extractIds(html: string, pattern: RegExp) {
  return [...new Set([...html.matchAll(pattern)].map((match) => match[1]).filter(Boolean))].slice(0, 10);
}

export function inspectTrackingHtml(html: string, pageUrl: string, checkedAt = new Date().toISOString()): SiteTrackingResult {
  const adsIds = extractIds(html, /\b(AW-\d{4,})\b/gi);
  const analyticsIds = extractIds(html, /\b(G-[A-Z0-9]{5,})\b/gi);
  const tagManagerIds = extractIds(html, /\b(GTM-[A-Z0-9]{4,})\b/gi);
  const pixelIds = extractIds(html, /fbq\s*\(\s*["']init["']\s*,\s*["'](\d{5,})["']/gi);
  const throughTagManager = tagManagerIds.length > 0;
  const check = (key: TrackingTagCheck["key"], label: string, ids: string[]): TrackingTagCheck => ({ key, label, status: ids.length ? "found" : throughTagManager && key !== "google_tag_manager" ? "tag_manager" : "not_found", ids });
  return {
    status: "checked",
    pageUrl,
    checkedAt,
    checks: [
      check("google_ads", "Google Ads tag", adsIds),
      check("google_analytics", "Google Analytics tag", analyticsIds),
      { key: "google_tag_manager", label: "Google Tag Manager", status: tagManagerIds.length ? "found" : "not_found", ids: tagManagerIds },
      check("meta_pixel", "Meta Pixel", pixelIds),
    ],
    note: "This checks the page’s initial HTML only. A tag manager may load tags later, and a visible tag does not prove a conversion event fired. Check the platform’s event diagnostics to confirm events.",
  };
}

function validatedPageUrl(value: unknown, allowedHosts: string[]) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (url.protocol !== "https:" || url.username || url.password || !allowedHosts.includes(host) || url.port) return null;
    url.hash = "";
    return url;
  } catch { return null; }
}

export async function checkSiteConversionTags(value: unknown, allowedHosts: string[], fetcher: typeof fetch = fetch, checkedAt = new Date().toISOString()): Promise<SiteTrackingResult> {
  let url = validatedPageUrl(value, allowedHosts);
  if (!url) throw new Error("Choose a published HTTPS page on this client’s own website or landing subdomain.");
  let response: Response | undefined;
  for (let redirects = 0; redirects <= 3; redirects++) {
    response = await fetcher(url.toString(), { redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "F2B-Agency-Tracking-Check/1.0" } });
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get("location");
    if (!location || redirects === 3) throw new Error("The page redirected too many times; no tracking result was saved.");
    const next = validatedPageUrl(new URL(location, url).toString(), allowedHosts);
    if (!next) throw new Error("The page redirected outside this client’s approved website domains.");
    url = next;
  }
  if (!response?.ok) throw new Error(`The published page returned HTTP ${response?.status || "unknown"}.`);
  if (!/(?:text\/html|application\/xhtml\+xml)/i.test(response.headers.get("content-type") || "")) throw new Error("The page did not return HTML, so its tracking tags could not be checked.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The published page returned no readable HTML.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < 512_000) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const chunk = value.slice(0, 512_000 - size);
    chunks.push(chunk);
    size += chunk.byteLength;
    if (chunk.byteLength !== value.byteLength) { await reader.cancel(); break; }
  }
  const htmlBytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { htmlBytes.set(chunk, offset); offset += chunk.byteLength; }
  return inspectTrackingHtml(new TextDecoder().decode(htmlBytes), url.toString(), checkedAt);
}
