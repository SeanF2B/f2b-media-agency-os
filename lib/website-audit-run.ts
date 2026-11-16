import { env } from "cloudflare:workers";
import { buildSeoTechnicalFindings, extractSeoCrawlPage, inspectSitemapXml, type CrawledSeoPage } from "@/lib/seo-technical-audit";
import { pageSpeedApiErrorMessage } from "@/lib/pagespeed-errors";

// Public website checks shared by Sites (technical audit, PageSpeed) and the Website audit report.
export function sameWebsiteHost(left: URL, right: URL) {
  const normalize = (host: string) => host.toLowerCase().replace(/^www\./, "");
  return left.protocol === "https:" && right.protocol === "https:" && normalize(left.hostname) === normalize(right.hostname) && left.port === right.port;
}

export async function fetchPublicSiteResponse(url: URL, siteUrl: string, headers: HeadersInit, method = "GET") {
  let current = new URL(url);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!sameWebsiteHost(current, new URL(siteUrl))) return null;
    const response = await fetch(current, { method, headers, redirect: "manual", signal: AbortSignal.timeout(12_000) });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) return null;
    try { current = new URL(location, current); } catch { return null; }
  }
  return null;
}

export async function readLimitedText(response: Response, maxBytes: number) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const chunk = value.slice(0, Math.max(0, maxBytes - size));
    chunks.push(chunk); size += chunk.byteLength;
    if (size >= maxBytes) { await reader.cancel(); break; }
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export async function runPageSpeedInsights(siteUrl: string, pageUrl: string, strategy: "mobile" | "desktop") {
  const target = new URL(pageUrl, siteUrl);
  if (!sameWebsiteHost(target, new URL(siteUrl)) || target.username || target.password) throw new Error("Choose a public HTTPS page on this client’s own website.");
  const endpoint = new URL("https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed");
  endpoint.searchParams.set("url", target.toString());
  endpoint.searchParams.set("strategy", strategy);
  endpoint.searchParams.set("category", "performance");
  if (env.GOOGLE_PAGESPEED_API_KEY) endpoint.searchParams.set("key", env.GOOGLE_PAGESPEED_API_KEY);
  const response = await fetch(endpoint, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    const responseBody = await response.text().catch(() => "");
    throw new Error(pageSpeedApiErrorMessage(response.status, responseBody));
  }
  const payload = await response.json() as any;
  const lighthouse = payload.lighthouseResult;
  if (!lighthouse?.audits) throw new Error("Google PageSpeed returned no Lighthouse result for this page.");
  const audit = (id: string) => lighthouse.audits[id];
  const metric = (id: string) => ({ value: Number(audit(id)?.numericValue || 0), display: String(audit(id)?.displayValue || "") });
  const field = payload.loadingExperience?.metrics || {};
  const fieldMetrics = Object.fromEntries(Object.entries(field).map(([key, value]: [string, any]) => [key, { percentile: Number(value.percentile || 0), category: String(value.category || "") }]));
  const opportunities = ["render-blocking-resources", "unused-css-rules", "unused-javascript", "modern-image-formats", "offscreen-images", "uses-text-compression"]
    .map((id) => ({ id, title: String(audit(id)?.title || ""), displayValue: String(audit(id)?.displayValue || ""), score: audit(id)?.score }))
    .filter((item) => item.title && item.score !== null && item.score !== undefined && item.score < 1)
    .slice(0, 5);
  return {
    status: "connected" as const, measuredAt: String(lighthouse.fetchTime || new Date().toISOString()), requestedUrl: target.toString(), finalUrl: String(payload.id || target.toString()), strategy,
    lighthousePerformanceScore: lighthouse.categories?.performance?.score == null ? null : Math.round(lighthouse.categories.performance.score * 100),
    lab: { lcp: metric("largest-contentful-paint"), cls: metric("cumulative-layout-shift"), tbt: metric("total-blocking-time"), fcp: metric("first-contentful-paint"), speedIndex: metric("speed-index") },
    fieldData: Object.keys(fieldMetrics).length ? { overallCategory: String(payload.loadingExperience?.overall_category || ""), metrics: fieldMetrics } : null,
    opportunities,
    dataNote: "Lighthouse values are lab measurements for this run. Real-user Core Web Vitals are shown only when Google returns field data for this URL; missing field data does not mean zero traffic or a passing score.",
  };
}

export async function runPublicTechnicalAudit(siteUrl: string, requestedUrls: string[]) {
  const origin = new URL(siteUrl);
  const urls = [...new Set(requestedUrls.flatMap((raw) => {
    try {
      const url = new URL(raw, siteUrl);
      if (!sameWebsiteHost(url, origin) || url.username || url.password) return [];
      url.hash = "";
      return [url.toString()];
    } catch { return []; }
  }))].slice(0, 15);
  if (!urls.length) throw new Error("No safe, same-site page URLs were supplied for this sample.");

  const pages: CrawledSeoPage[] = [];
  for (let i = 0; i < urls.length; i += 5) {
    pages.push(...await Promise.all(urls.slice(i, i + 5).map(async (url): Promise<CrawledSeoPage> => {
      try {
        const response = await fetchPublicSiteResponse(new URL(url), siteUrl, { Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" });
        if (!response) return { url, status: null, error: "Redirect left the client website or could not be followed safely.", title: "", description: "", canonicalUrls: [], robots: "", structuredDataCount: 0, invalidStructuredData: 0, internalLinks: [] };
        if (!response.ok) return { url, finalUrl: response.url || url, status: response.status, title: "", description: "", canonicalUrls: [], robots: "", structuredDataCount: 0, invalidStructuredData: 0, internalLinks: [] };
        const type = response.headers.get("content-type") || "";
        if (!/text\/html|application\/xhtml\+xml/i.test(type)) return { url, finalUrl: response.url || url, status: response.status, error: "The response was not HTML, so page metadata checks were skipped.", title: "", description: "", canonicalUrls: [], robots: "", structuredDataCount: 0, invalidStructuredData: 0, internalLinks: [] };
        const html = await readLimitedText(response, 1_000_000);
        return extractSeoCrawlPage(html, url, response.status, response.url || url, origin.origin);
      } catch (error) {
        return { url, status: null, error: error instanceof Error && error.name === "TimeoutError" ? "Page request timed out." : "Page could not be fetched from the public website.", title: "", description: "", canonicalUrls: [], robots: "", structuredDataCount: 0, invalidStructuredData: 0, internalLinks: [] };
      }
    })));
  }

  const linkSources = new Map<string, Set<string>>();
  for (const page of pages) for (const link of page.internalLinks) {
    const sources = linkSources.get(link) || new Set<string>(); sources.add(page.url); linkSources.set(link, sources);
  }
  const brokenLinks: Array<{ url: string; status: number | null; sourcePages: string[] }> = [];
  const links = [...linkSources.entries()].slice(0, 40);
  for (let i = 0; i < links.length; i += 5) {
    await Promise.all(links.slice(i, i + 5).map(async ([url, sourcePages]) => {
      let status: number | null = null;
      try {
        let response = await fetchPublicSiteResponse(new URL(url), siteUrl, { Accept: "text/html,*/*;q=0.1" }, "HEAD");
        if (response && [403, 405, 501].includes(response.status)) response = await fetchPublicSiteResponse(new URL(url), siteUrl, { Accept: "text/html,*/*;q=0.1" });
        status = response?.status ?? null;
      } catch { status = null; }
      if (status === null || status >= 400) brokenLinks.push({ url, status, sourcePages: [...sourcePages] });
    }));
  }

  const sitemapCandidates = new Set<string>(["wp-sitemap.xml", "sitemap_index.xml", "sitemap.xml"].map((path) => new URL(path, `${siteUrl}/`).toString()));
  let sitemapChecked = false; let sitemapStatus: number | null = null; let sitemapUrlsFound = 0; let offsiteUrlsFound = 0; let sitemapsRead = 0;
  try {
    const robots = await fetchPublicSiteResponse(new URL("robots.txt", `${siteUrl}/`), siteUrl, { Accept: "text/plain" });
    if (robots?.ok) {
      const text = await readLimitedText(robots, 100_000);
      for (const match of text.matchAll(/^\s*Sitemap:\s*(\S+)/gim)) {
        try { const url = new URL(match[1]); if (sameWebsiteHost(url, origin)) sitemapCandidates.add(url.toString()); } catch {}
      }
    }
  } catch {}
  const sitemapQueue = [...sitemapCandidates].slice(0, 5);
  const visitedSitemaps = new Set<string>();
  const sitemapPageUrls = new Set<string>();
  let sitemapAttempts = 0;
  while (sitemapQueue.length && sitemapAttempts < 5) {
    const candidate = sitemapQueue.shift()!;
    if (visitedSitemaps.has(candidate)) continue;
    visitedSitemaps.add(candidate);
    sitemapAttempts++;
    try {
      const sitemapUrl = new URL(candidate);
      if (!sameWebsiteHost(sitemapUrl, origin)) continue;
      const response = await fetchPublicSiteResponse(sitemapUrl, siteUrl, { Accept: "application/xml,text/xml,text/plain" });
      if (!response) continue;
      sitemapStatus = response.status;
      if (!response.ok) continue;
      sitemapChecked = true;
      sitemapsRead++;
      const xml = await readLimitedText(response, 1_000_000);
      const inspected = inspectSitemapXml(xml, response.url || candidate, siteUrl);
      offsiteUrlsFound += inspected.offsiteUrlsFound;
      if (inspected.isIndex) sitemapQueue.unshift(...inspected.childSitemaps.filter((url) => !visitedSitemaps.has(url)).slice(0, 5));
      else for (const url of inspected.urls) sitemapPageUrls.add(url);
    } catch {}
  }
  sitemapUrlsFound = sitemapPageUrls.size;
  const sitemap = { checked: sitemapChecked, urlsFound: sitemapUrlsFound, status: sitemapStatus, sitemapsRead, offsiteUrlsFound };
  const findings = buildSeoTechnicalFindings(pages, brokenLinks, sitemap);
  return { sampledAt: new Date().toISOString(), siteUrl, sampleLimit: 15, pages, brokenLinks, sitemap, findings, comparison: { added: [], resolved: [] } };
}

