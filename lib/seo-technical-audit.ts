export type CrawledSeoPage = {
  url: string; finalUrl?: string; status: number | null; error?: string;
  title: string; description: string; canonicalUrls: string[]; robots: string;
  structuredDataCount: number; invalidStructuredData: number; internalLinks: string[];
};
export type SeoTechnicalFinding = { key: string; severity: "high" | "medium" | "info"; title: string; detail: string; pages: string[]; urls?: string[] };
export type SitemapInspection = { checked: boolean; urlsFound: number; status: number | null; sitemapsRead?: number; offsiteUrlsFound?: number };

/** Parse sitemap entries without trusting or fetching URLs listed by the source. */
export function inspectSitemapXml(xml: string, sitemapUrl: string, siteUrl: string) {
  const isIndex = /<sitemapindex\b/i.test(xml);
  const locations: string[] = [];
  for (const match of xml.matchAll(/<loc\b[^>]*>\s*([\s\S]*?)\s*<\/loc>/gi)) {
    const raw = decodeHtml(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
    try {
      const url = new URL(raw, sitemapUrl);
      if (url.protocol === "https:" && !url.username && !url.password) locations.push(url.toString());
    } catch {}
  }
  const origin = new URL(siteUrl);
  const sameSite = (url: string) => {
    try {
      const candidate = new URL(url);
      const host = (value: string) => value.toLowerCase().replace(/^www\./, "");
      return candidate.protocol === "https:" && host(candidate.hostname) === host(origin.hostname) && candidate.port === origin.port;
    } catch { return false; }
  };
  if (isIndex) {
    const childSitemaps = [...new Set(locations.filter(sameSite))];
    return { isIndex, urls: [] as string[], childSitemaps, offsiteUrlsFound: locations.length - childSitemaps.length };
  }
  const urls = [...new Set(locations.filter(sameSite))];
  return { isIndex, urls, childSitemaps: [] as string[], offsiteUrlsFound: locations.length - urls.length };
}

function decodeHtml(text: string) {
  return text.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&nbsp;/gi, " ").trim();
}
function tagAttribute(tag: string, key: string) {
  return tag.match(new RegExp("\\b" + key + "\\s*=\\s*([\\\"'])([\\s\\S]*?)\\1", "i"))?.[2] || "";
}
export function extractSeoCrawlPage(html: string, url: string, status: number, finalUrl: string, siteOrigin: string): CrawledSeoPage {
  const title = decodeHtml(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ") || "");
  let description = "";
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    if (tagAttribute(tag, "name").toLowerCase() === "description") { description = decodeHtml(tagAttribute(tag, "content").replace(/\s+/g, " ")); break; }
  }
  const canonicalUrls: string[] = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (!tagAttribute(tag, "rel").toLowerCase().split(/\s+/).includes("canonical")) continue;
    try { canonicalUrls.push(new URL(decodeHtml(tagAttribute(tag, "href")), url).toString()); } catch { canonicalUrls.push("invalid"); }
  }
  let robots = "";
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    if (tagAttribute(tag, "name").toLowerCase() === "robots") { robots = decodeHtml(tagAttribute(tag, "content")).toLowerCase(); break; }
  }
  const jsonLd = [...html.matchAll(/<script\b[^>]*type\s*=\s*(["'])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[2].trim());
  const invalidStructuredData = jsonLd.filter((value) => { try { JSON.parse(value); return false; } catch { return true; } }).length;
  const internalLinks = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = tagAttribute(match[0], "href");
    if (!href || href.startsWith("#") || /^(?:mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    try {
      const link = new URL(decodeHtml(href), url);
      if (link.protocol !== "https:" || link.origin.toLowerCase() !== siteOrigin.toLowerCase()) continue;
      link.hash = ""; link.search = "";
      if (/\.(?:jpg|jpeg|png|gif|webp|svg|pdf|xml|css|js|woff2?)(?:$)/i.test(link.pathname)) continue;
      if (internalLinks.size < 80) internalLinks.add(link.toString());
    } catch {}
  }
  return { url, finalUrl, status, title, description, canonicalUrls, robots, structuredDataCount: jsonLd.length, invalidStructuredData, internalLinks: [...internalLinks] };
}
function groupedDuplicates(pages: CrawledSeoPage[], field: "title" | "description") {
  const groups = new Map<string, string[]>();
  for (const page of pages) {
    const value = page[field].trim().toLocaleLowerCase();
    if (!value) continue;
    const list = groups.get(value) || []; list.push(page.url); groups.set(value, list);
  }
  return [...groups.entries()].filter(([, urls]) => urls.length > 1).map(([, urls]) => urls);
}
export function buildSeoTechnicalFindings(pages: CrawledSeoPage[], brokenLinks: Array<{ url: string; status: number | null; sourcePages: string[] }>, sitemap: SitemapInspection) {
  const findings: SeoTechnicalFinding[] = [];
  for (const page of pages) {
    const add = (key: string, severity: SeoTechnicalFinding["severity"], title: string, detail: string) => findings.push({ key: key + ":" + page.url, severity, title, detail, pages: [page.url] });
    if (page.status === null) add("unverified", "medium", "Page could not be verified", page.error || "The page timed out or redirected outside the client website.");
    else if (page.status >= 400) add("http", "high", "Page returns HTTP " + page.status, "This sampled page returned an error response.");
    if (page.status === null || page.status >= 400) continue;
    if (page.error) add("page-check", "info", "Some page checks were skipped", page.error);
    if (page.finalUrl && page.finalUrl !== page.url) add("redirect", "info", "Page redirects to another URL", "The sampled page resolves to " + page.finalUrl + ". Confirm this redirect is intentional and points to the preferred URL.");
    if (!page.title) add("title-missing", "high", "Page title is missing", "The live page HTML has no readable <title> tag.");
    if (!page.description) add("description-missing", "medium", "Meta description is missing", "The live page HTML has no meta description tag.");
    if (page.canonicalUrls.length > 1) add("canonical-multiple", "high", "Multiple canonical URLs", "Found " + page.canonicalUrls.length + " canonical declarations on this page.");
    else if (page.canonicalUrls[0] === "invalid") add("canonical-invalid", "high", "Canonical URL is invalid", "The canonical link could not be parsed as a valid URL.");
    else if (page.canonicalUrls[0]) {
      try { if (new URL(page.canonicalUrls[0]).origin.toLowerCase() !== new URL(page.url).origin.toLowerCase()) add("canonical-external", "medium", "Canonical points to another site", "Canonical URL: " + page.canonicalUrls[0]); }
      catch { add("canonical-invalid", "high", "Canonical URL is invalid", "The canonical link could not be parsed as a valid URL."); }
    }
    if (/\bnoindex\b/.test(page.robots)) add("noindex", "high", "Page blocks search indexing", "Live robots directive: " + page.robots);
    if (page.invalidStructuredData) add("structured-data", "medium", "Structured data contains invalid JSON", page.invalidStructuredData + " of " + page.structuredDataCount + " JSON-LD blocks could not be parsed.");
  }
  for (const urls of groupedDuplicates(pages, "title")) findings.push({ key: "duplicate-title:" + urls.join("|"), severity: "medium", title: "Duplicate page titles", detail: "These sampled pages use the same title text.", pages: urls });
  for (const urls of groupedDuplicates(pages, "description")) findings.push({ key: "duplicate-description:" + urls.join("|"), severity: "medium", title: "Duplicate meta descriptions", detail: "These sampled pages use the same meta description.", pages: urls });
  for (const link of brokenLinks) findings.push({ key: "broken-link:" + link.url, severity: "high", title: link.status === null ? "Internal link could not be verified" : "Internal link returns HTTP " + link.status, detail: "Link found on " + link.sourcePages.length + " sampled page" + (link.sourcePages.length === 1 ? "" : "s") + ".", pages: link.sourcePages, urls: [link.url] });
  if (!sitemap.checked) findings.push({ key: "sitemap-unchecked", severity: "info", title: "Sitemap could not be checked", detail: "No readable sitemap location was found from robots.txt or the common sitemap paths.", pages: [] });
  else if (sitemap.status === null || sitemap.status >= 400) findings.push({ key: "sitemap-error", severity: "medium", title: "Sitemap returned an error", detail: "The discovered sitemap could not be read (HTTP " + (sitemap.status ?? "unverified") + ").", pages: [] });
  if (sitemap.checked && (sitemap.offsiteUrlsFound || 0) > 0) findings.push({ key: "sitemap-offsite-urls", severity: "info", title: "Sitemap includes URLs outside this website", detail: `${sitemap.offsiteUrlsFound} sitemap entries did not match this client’s website hostname. They were counted for review and not fetched.`, pages: [] });
  return findings;
}
