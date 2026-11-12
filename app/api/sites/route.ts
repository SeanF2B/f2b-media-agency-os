import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { decryptWordPressPassword, encryptWordPressPassword, validateWordPressSiteUrl, wordpressRequest } from "@/lib/wordpress-pages";
import { cleanMcpError, extractPages, extractSites, siteDomain, unwrapWordPressMcpResult, wordpressMcpCall } from "@/lib/wordpress-mcp";
import { buildSeoTechnicalFindings, extractSeoCrawlPage, inspectSitemapXml, type CrawledSeoPage } from "@/lib/seo-technical-audit";
import { pageSpeedApiErrorMessage } from "@/lib/pagespeed-errors";
import { checkLandingDomain } from "@/lib/site-landing-domain";
import { checkSiteConversionTags } from "@/lib/site-conversion-tracking";
import { landingHostnameForWebsite } from "@/lib/site-page-plan";
import { verifyWordPressDraft } from "@/lib/wordpress-draft-verification";

export const dynamic = "force-dynamic";
const respond = (error: string, status = 400) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
type Client = { id: string; name: string; wordpressSiteUrl?: string };

function extractThemeAssets(html: string, siteUrl: string) {
  const origin = new URL(siteUrl).origin;
  const stylesheets: string[] = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/rel=["'][^"']*stylesheet[^"']*["']/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    try {
      const url = new URL(href.replace(/&amp;/g, "&"), siteUrl);
      if (url.protocol === "https:" && url.origin === origin && !stylesheets.includes(url.href)) stylesheets.push(url.href);
    } catch {}
  }
  const inlineStyles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1].slice(0, 250_000)).slice(0, 12);
  const bodyClass = html.match(/<body\b[^>]*\bclass=["']([^"']*)["']/i)?.[1]?.replace(/[^a-zA-Z0-9_\-\s]/g, "").slice(0, 1000) || "";
  return { stylesheets: stylesheets.slice(0, 30), inlineStyles, bodyClass };
}

async function adminContext(user: { userId: string; email: string }) {
  const row = await env.DB?.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!row?.data) return null;
  const data = JSON.parse(row.data);
  const isAdmin = data.ownerId === user.userId || data.staff?.some((person: { email?: string; role?: string; isBot?: boolean }) => !person.isBot && person.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(person.role || ""));
  return isAdmin ? { data, ownerId: String(data.ownerId || ""), accountUserId: user.userId } : null;
}

async function clientConnection(ownerId: string, client: Client) {
  if (!env.DB) throw new Error("The private workspace database is unavailable.");
  return env.DB.prepare("SELECT site_url, username, encrypted_app_password, token_iv FROM wordpress_connections WHERE owner_id = ?1 AND client_id = ?2")
    .bind(ownerId, client.id).first<{ site_url: string; username: string; encrypted_app_password: string; token_iv: string }>();
}

async function requestWithConnection(connection: NonNullable<Awaited<ReturnType<typeof clientConnection>>>, path: string, init?: RequestInit) {
  const password = await decryptWordPressPassword(connection.token_iv, connection.encrypted_app_password);
  return wordpressRequest(connection.site_url, connection.username, password, path, init);
}

async function mcpSiteForClient(ownerId: string, siteUrl: string) {
  const result = await wordpressMcpCall(ownerId, "wpcom-user-sites", {});
  const sites = extractSites(result);
  const domain = siteDomain(siteUrl);
  const site = sites.find((item) => siteDomain(item.url) === domain);
  return { sites, site };
}

function pageFromMcp(item: any, fallbackId = 0) {
  const title = typeof item?.title === "string" ? item.title : String(item?.title?.raw || item?.title?.rendered || "Untitled page");
  const content = typeof item?.content === "string" ? item.content : String(item?.content?.raw || item?.content?.rendered || item?.content_html || "");
  const meta = item?.meta && typeof item.meta === "object" ? item.meta : {};
  const yoast = item?.yoast_head_json && typeof item.yoast_head_json === "object" ? item.yoast_head_json : {};
  const value = (...items: unknown[]) => items.find((entry) => typeof entry === "string" && entry.trim()) as string | undefined;
  const robots = Array.isArray(yoast.robots) ? yoast.robots.filter((entry: unknown) => typeof entry === "string").join(", ") : value(yoast.robots, meta.rank_math_robots, meta._yoast_wpseo_meta_robots_noindex);
  const hasMeta = (...keys: string[]) => keys.some((key) => Object.prototype.hasOwnProperty.call(meta, key));
  return {
    id: Number(item?.id || item?.ID || fallbackId), title, slug: String(item?.slug || ""), status: String(item?.status || "draft"), link: String(item?.link || item?.url || ""), modified: String(item?.modified || item?.date || ""), content,
    seoTitle: value(yoast.title, item?.rank_math_title, meta._yoast_wpseo_title, meta.rank_math_title, meta.seopress_titles_title),
    metaDescription: value(yoast.description, item?.rank_math_description, meta._yoast_wpseo_metadesc, meta.rank_math_description, meta.seopress_titles_desc),
    canonicalUrl: value(yoast.canonical, item?.rank_math_canonical_url, meta.rank_math_canonical_url, meta.seopress_robots_canonical),
    robots: robots || undefined,
    seoCapabilities: {
      title: hasMeta("_yoast_wpseo_title", "rank_math_title", "seopress_titles_title"),
      description: hasMeta("_yoast_wpseo_metadesc", "rank_math_description", "seopress_titles_desc"),
      canonical: hasMeta("_yoast_wpseo_canonical", "rank_math_canonical_url", "seopress_robots_canonical"),
      indexing: hasMeta("rank_math_robots", "_yoast_wpseo_meta-robots-noindex", "_yoast_wpseo_meta_robots_noindex", "seopress_robots_index"),
    },
  };
}

const SEO_META_KEYS = {
  title: ["_yoast_wpseo_title", "rank_math_title", "seopress_titles_title"],
  description: ["_yoast_wpseo_metadesc", "rank_math_description", "seopress_titles_desc"],
  canonical: ["_yoast_wpseo_canonical", "rank_math_canonical_url", "seopress_robots_canonical"],
  indexing: ["rank_math_robots", "_yoast_wpseo_meta-robots-noindex", "_yoast_wpseo_meta_robots_noindex", "seopress_robots_index"],
} as const;

function seoMetaUpdate(meta: Record<string, unknown>, body: Record<string, unknown>) {
  const updates: Record<string, unknown> = {};
  const missing: string[] = [];
  const fields = [
    ["seoTitle", "SEO title", SEO_META_KEYS.title],
    ["metaDescription", "Meta description", SEO_META_KEYS.description],
    ["canonicalUrl", "Canonical URL", SEO_META_KEYS.canonical],
  ] as const;
  for (const [field, label, keys] of fields) {
    if (typeof body[field] !== "string") continue;
    const key = keys.find((candidate) => Object.prototype.hasOwnProperty.call(meta, candidate));
    if (!key) { missing.push(label); continue; }
    const next = String(body[field]).trim().slice(0, field === "metaDescription" ? 500 : 1000);
    if (field === "canonicalUrl" && next) {
      try { if (!new Set(["https:", "http:"]).has(new URL(next).protocol)) throw new Error(); }
      catch { throw new Error("Enter a full canonical URL starting with https:// or http://, or leave the field blank."); }
    }
    updates[key] = next;
  }
  if (typeof body.noindex === "boolean") {
    const key = SEO_META_KEYS.indexing.find((candidate) => Object.prototype.hasOwnProperty.call(meta, candidate));
    if (!key) missing.push("Search indexing");
    else if (key === "rank_math_robots") {
      const current = meta[key];
      const robots = Array.isArray(current) ? current.filter((item) => typeof item === "string" && item !== "noindex" && item !== "index") : [];
      updates[key] = body.noindex ? [...robots, "noindex"] : robots;
    } else if (key === "seopress_robots_index") {
      updates[key] = body.noindex ? "yes" : "";
    } else {
      updates[key] = body.noindex ? "1" : "0";
    }
  }
  return { updates, missing };
}

function editabilityMessage(missing: string[]) {
  return `WordPress did not expose ${missing.join(", ")} as editable fields. The page URL and page name can still be changed. To edit these fields here, the site's SEO plugin must register them with the WordPress REST API.`;
}

function verifySeoMeta(meta: Record<string, unknown>, updates: Record<string, unknown>) {
  return Object.entries(updates).every(([key, expected]) => {
    const actual = meta[key];
    return JSON.stringify(actual) === JSON.stringify(expected) || String(actual ?? "") === String(expected ?? "");
  });
}

function readHtmlMeta(html: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const metaTag = new RegExp(`<meta\\b[^>]*(?:name|property)=["']${escaped}["'][^>]*>`, "i").exec(html)?.[0]
    || new RegExp(`<meta\\b[^>]*content=["'][^"']*["'][^>]*(?:name|property)=["']${escaped}["'][^>]*>`, "i").exec(html)?.[0];
  if (!metaTag) return "";
  return /content=["']([^"']*)["']/i.exec(metaTag)?.[1]?.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").trim() || "";
}

function readCanonicalUrl(html: string, pageUrl: string) {
  const tag = /<link\b[^>]*rel=["']canonical["'][^>]*>/i.exec(html)?.[0]
    || /<link\b[^>]*href=["'][^"']+["'][^>]*rel=["']canonical["'][^>]*>/i.exec(html)?.[0];
  const href = tag && /href=["']([^"']+)["']/i.exec(tag)?.[1];
  try { return href ? new URL(href, pageUrl).toString() : ""; } catch { return ""; }
}

function sameWebsiteHost(left: URL, right: URL) {
  const normalize = (host: string) => host.toLowerCase().replace(/^www\./, "");
  return left.protocol === "https:" && right.protocol === "https:" && normalize(left.hostname) === normalize(right.hostname) && left.port === right.port;
}

async function fetchPublicSiteResponse(url: URL, siteUrl: string, headers: HeadersInit, method = "GET") {
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

async function readLimitedText(response: Response, maxBytes: number) {
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

async function runPageSpeedInsights(siteUrl: string, pageUrl: string, strategy: "mobile" | "desktop") {
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

async function runPublicTechnicalAudit(siteUrl: string, requestedUrls: string[]) {
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

async function readLiveSeo(page: ReturnType<typeof pageFromMcp>, siteUrl: string) {
  if (page.status !== "publish" || !page.link) return { ...page, seoChecked: false };
  try {
    const liveUrl = new URL(page.link);
    if (!sameWebsiteHost(liveUrl, new URL(siteUrl))) return { ...page, seoChecked: false };
    const response = await fetchPublicSiteResponse(liveUrl, siteUrl, { Accept: "text/html" });
    if (!response?.ok) return { ...page, seoChecked: false };
    const html = (await response.text()).slice(0, 1_500_000);
    const liveTitle = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").trim();
    const description = readHtmlMeta(html, "description") || readHtmlMeta(html, "og:description");
    const robots = readHtmlMeta(html, "robots");
    return { ...page, seoTitle: page.seoTitle || liveTitle || undefined, metaDescription: page.metaDescription || description || undefined, canonicalUrl: page.canonicalUrl || readCanonicalUrl(html, liveUrl.toString()) || undefined, robots: page.robots || robots || undefined, seoChecked: true };
  } catch { return { ...page, seoChecked: false }; }
}

const PUBLIC_PAGE_FIELDS = "id,date,modified,slug,status,link,title,yoast_head_json,meta";
const PUBLIC_PAGE_BATCH = 50;

async function publicPageInventory(siteUrl: string, requestedPage: number) {
  const pageNumber = Math.min(100, Math.max(1, requestedPage));
  const apiUrl = new URL("wp-json/wp/v2/pages", `${siteUrl}/`);
  apiUrl.searchParams.set("status", "publish");
  apiUrl.searchParams.set("per_page", String(PUBLIC_PAGE_BATCH));
  apiUrl.searchParams.set("page", String(pageNumber));
  apiUrl.searchParams.set("_fields", PUBLIC_PAGE_FIELDS);
  try {
    const response = await fetch(apiUrl, { headers: { Accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(12_000) });
    if (response.ok) {
      const payload = await response.json() as unknown;
      if (Array.isArray(payload)) {
        const pages = payload.map((item: any, index) => pageFromMcp({ ...item, status: "publish" }, (pageNumber - 1) * PUBLIC_PAGE_BATCH + index + 1));
        const totalPages = Math.max(1, Math.min(100, Number(response.headers.get("X-WP-TotalPages") || (pages.length === PUBLIC_PAGE_BATCH ? pageNumber + 1 : pageNumber))));
        const hydrated: ReturnType<typeof pageFromMcp>[] = [];
        for (let i = 0; i < pages.length; i += 6) hydrated.push(...await Promise.all(pages.slice(i, i + 6).map((item) => readLiveSeo(item, siteUrl))));
        return { pages: hydrated, inventoryPage: pageNumber, totalPages, publicInventory: true, publicInventorySource: "wordpress-public-pages" as const };
      }
    }
  } catch {}

  // Public REST can be disabled by a WordPress security plugin. Try the site's
  // declared sitemap and common WordPress sitemap locations before reporting it unavailable.
  const safeGetText = async (candidate: string, maxBytes: number) => {
    try {
      const url = new URL(candidate, `${siteUrl}/`);
      if (!sameWebsiteHost(url, new URL(siteUrl))) return "";
      const response = await fetchPublicSiteResponse(url, siteUrl, { Accept: "application/xml,text/xml,text/plain,text/html" });
      if (!response?.ok || (response.headers.get("content-type") || "").includes("json")) return "";
      return (await response.text()).slice(0, maxBytes);
    } catch { return ""; }
  };
  const sitemapCandidates = new Set<string>([new URL("wp-sitemap.xml", `${siteUrl}/`).toString(), new URL("sitemap_index.xml", `${siteUrl}/`).toString(), new URL("sitemap.xml", `${siteUrl}/`).toString()]);
  const robots = await safeGetText(new URL("robots.txt", `${siteUrl}/`).toString(), 100_000);
  for (const match of robots.matchAll(/^\s*Sitemap:\s*(\S+)/gim)) sitemapCandidates.add(match[1]);
  let sitemapLocations: string[] = [];
  for (const sitemap of [...sitemapCandidates].slice(0, 6)) {
    const xml = await safeGetText(sitemap, 1_000_000);
    if (!xml) continue;
    const locations = [...xml.matchAll(/<loc[^>]*>\s*([^<]+?)\s*<\/loc>/gi)].map((match) => match[1].replace(/&amp;/g, "&").trim());
    const sitemapFiles = locations.filter((location) => /sitemap/i.test(location));
    if (sitemapFiles.length) {
      const preferred = sitemapFiles.filter((location) => /page/i.test(location));
      for (const child of (preferred.length ? preferred : sitemapFiles).slice(0, 6)) {
        const childXml = await safeGetText(child, 1_000_000);
        sitemapLocations.push(...[...childXml.matchAll(/<loc[^>]*>\s*([^<]+?)\s*<\/loc>/gi)].map((match) => match[1].replace(/&amp;/g, "&").trim()));
      }
    } else sitemapLocations.push(...locations);
    if (sitemapLocations.length) break;
  }

  if (!sitemapLocations.length) {
    const homepage = await safeGetText(`${siteUrl}/`, 2_000_000);
    sitemapLocations = [...homepage.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1].replace(/&amp;/g, "&"));
  }
  const unique = [...new Set(sitemapLocations.flatMap((link) => {
    try {
      const url = new URL(link, `${siteUrl}/`);
      if (!sameWebsiteHost(url, new URL(siteUrl)) || /\.(?:jpg|jpeg|png|gif|webp|svg|pdf|xml|css|js|woff2?)(?:$|\?)/i.test(url.pathname)) return [];
      url.search = ""; url.hash = "";
      return [url.toString()];
    } catch { return []; }
  }))].sort((a, b) => a === `${siteUrl}/` ? -1 : b === `${siteUrl}/` ? 1 : a.localeCompare(b));
  if (!unique.length) return { pages: [], inventoryPage: pageNumber, totalPages: 1, publicInventory: true, publicInventorySource: "public-sitemap" as const, publicInventoryError: "The website is blocking its public WordPress page list and no readable sitemap or public page links were found." };
  const totalPages = Math.max(1, Math.ceil(unique.length / PUBLIC_PAGE_BATCH));
  const selected = unique.slice((pageNumber - 1) * PUBLIC_PAGE_BATCH, pageNumber * PUBLIC_PAGE_BATCH);
  const publicPages = selected.map((link, index) => {
    const url = new URL(link);
    const slug = url.pathname.replace(/\/+$/, "").split("/").pop() || "home";
    const title = slug === "home" ? "Home" : decodeURIComponent(slug).replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
    return { id: (pageNumber - 1) * PUBLIC_PAGE_BATCH + index + 1, title, slug, status: "publish", link, modified: "", content: "", seoTitle: undefined, metaDescription: undefined, canonicalUrl: undefined, robots: undefined, seoCapabilities: { title: false, description: false, canonical: false, indexing: false } };
  });
  const hydrated: ReturnType<typeof pageFromMcp>[] = [];
  for (let i = 0; i < publicPages.length; i += 6) hydrated.push(...await Promise.all(publicPages.slice(i, i + 6).map((item) => readLiveSeo(item, siteUrl))));
  return { pages: hydrated, inventoryPage: pageNumber, totalPages, publicInventory: true, publicInventorySource: "public-sitemap" as const };
}

async function mcpPages(ownerId: string, site: { id: string; url: string }, page: number) {
  const result = await wordpressMcpCall(ownerId, "wpcom-mcp-content-authoring", { action: "execute", operation: "pages.list", wpcom_site: site.id || site.url, params: { per_page: 50, page, orderby: "modified", order: "desc", status: "any" } });
  const pages = extractPages(result).map((item) => pageFromMcp(item)).filter((item) => item.id);
  return pages;
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return respond("Sign in before managing WordPress pages.", 401);
  if (!env.DB) return respond("The private workspace database is unavailable.", 503);
  const access = await adminContext(user);
  if (!access) return respond("Only an agency owner or admin can manage connected WordPress pages.", 403);
  const params = new URL(request.url).searchParams;
  const client = access.data.clients?.find((item: Client) => item.id === params.get("clientId"));
  if (!client) return respond("Choose a client in this workspace.", 404);
  if (!client.wordpressSiteUrl) return respond("Add the WordPress website URL in this client’s profile first.", 422);
  try {
    const siteUrl = validateWordPressSiteUrl(client.wordpressSiteUrl).toString().replace(/\/$/, "");
    if (params.get("technicalAuditHistory") === "1") {
      const rows = await env.DB.prepare("SELECT run_id, created_at, result_json FROM seo_audit_runs WHERE owner_id = ?1 AND client_id = ?2 ORDER BY created_at DESC LIMIT 10").bind(access.ownerId, client.id).all<{ run_id: string; created_at: string; result_json: string }>();
      const history = (rows.results || []).flatMap((row) => {
        try {
          const result = JSON.parse(row.result_json);
          return [{ id: row.run_id, sampledAt: row.created_at, kind: result.kind || "technical", pagesChecked: result.pages?.length || 0, findings: result.findings || [], comparison: result.comparison || { added: [], resolved: [] }, pageSpeed: result.pageSpeed ? { strategy: result.pageSpeed.strategy, lighthousePerformanceScore: result.pageSpeed.lighthousePerformanceScore } : undefined }];
        } catch { return []; }
      });
      return Response.json({ history }, { headers: { "Cache-Control": "no-store" } });
    }
    if (params.get("themeStyles") === "1") {
      try {
        const response = await fetch(siteUrl, { headers: { Accept: "text/html" }, signal: AbortSignal.timeout(12_000) });
        if (!response.ok) return respond("Could not load the public site’s design styles for the preview.", 502);
        const html = (await response.text()).slice(0, 2_000_000);
        return Response.json({ theme: extractThemeAssets(html, response.url || siteUrl) }, { headers: { "Cache-Control": "private, max-age=300" } });
      } catch {
        return respond("Could not load the public site’s design styles for the preview.", 502);
      }
    }
    if (params.get("elementorEditor") === "1") {
      const requestedPageId = Number(params.get("pageId") || 0);
      const slug = (params.get("slug") || "home").trim().replace(/^\/+|\/+$/g, "");
      if (!requestedPageId && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug)) return respond("Enter a valid WordPress page.", 422);
      let page: { id?: number; slug?: string; title?: { rendered?: string }; status?: string } | undefined;
      if (requestedPageId) {
        if (!Number.isSafeInteger(requestedPageId) || requestedPageId < 1) return respond("Select a valid WordPress page.", 422);
        const connection = await clientConnection(access.ownerId, client);
        if (connection) {
          if (connection.site_url !== siteUrl) return respond("The saved WordPress connection is for a different website. Reconnect this client before opening its editor.", 409);
          const result = await requestWithConnection(connection, `pages/${requestedPageId}?context=edit&_fields=id,slug,title,status`);
          page = { id: Number(result.id), slug: String(result.slug || ""), title: result.title, status: String(result.status || "") };
        } else {
          const account = await env.DB.prepare("SELECT owner_id FROM wordpress_mcp_connections WHERE owner_id = ?1").bind(access.accountUserId).first();
          if (account) {
            const { site } = await mcpSiteForClient(access.accountUserId, siteUrl);
            if (site) {
              const result = await wordpressMcpCall(access.accountUserId, "wpcom-mcp-content-authoring", { action: "execute", operation: "pages.get", wpcom_site: site.id || site.url, params: { id: requestedPageId, context: "edit" } });
              const candidate = unwrapWordPressMcpResult(result) as Record<string, any>;
              page = { id: Number(candidate?.id), slug: String(candidate?.slug || ""), title: candidate?.title, status: String(candidate?.status || "") };
            }
          }
          if (!page) {
            const pageUrl = new URL(`wp-json/wp/v2/pages/${requestedPageId}`, `${siteUrl}/`);
            pageUrl.searchParams.set("_fields", "id,slug,title,status");
            const response = await fetch(pageUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
            if (response.ok) page = await response.json() as typeof page;
            else return respond("This page is not publicly readable. Connect this client’s WordPress editing access to open a draft in Elementor.", 409);
          }
        }
        if (!page?.id || !["publish", "draft"].includes(page.status || "")) return respond("The selected WordPress page is unavailable or is not a draft or published page.", 404);
      } else {
        const pagesUrl = new URL("wp-json/wp/v2/pages", `${siteUrl}/`);
        pagesUrl.searchParams.set("slug", slug);
        pagesUrl.searchParams.set("_fields", "id,slug,title,status");
        const response = await fetch(pagesUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
        if (!response.ok) return respond("Could not look up the live WordPress page. Open the site’s WordPress admin to continue.", 502);
        const pages = await response.json() as Array<{ id?: number; slug?: string; title?: { rendered?: string }; status?: string }>;
        page = Array.isArray(pages) ? pages.find((item) => item.slug === slug && item.status === "publish") : undefined;
      }
      if (!page?.id) return respond(requestedPageId ? "The selected WordPress page was not found." : "No published page with that URL was found on the live website.", 404);
      // Start at the normal WordPress editor. The connected integrations do
      // not expose a reliable Elementor-installed check, and a hard-coded
      // `action=elementor` URL can fail on sites without the plugin or access.
      // When Elementor is installed and enabled, WordPress exposes its own
      // "Edit with Elementor" action from this page.
      const editorUrl = new URL("wp-admin/post.php", `${siteUrl}/`);
      editorUrl.searchParams.set("post", String(page.id));
      editorUrl.searchParams.set("action", "edit");
      return Response.json({ pageId: page.id, slug: page.slug || slug, title: typeof page.title === "object" ? page.title.rendered : undefined, status: page.status, editorUrl: editorUrl.toString() }, { headers: { "Cache-Control": "private, no-store" } });
    }
    const connection = await clientConnection(access.ownerId, client);
    if (!connection) {
      const requestedPage = Math.min(100, Math.max(1, Number(params.get("page") || 1)));
      const publicInventory = await publicPageInventory(siteUrl, requestedPage);
      const account = await env.DB.prepare("SELECT owner_id FROM wordpress_mcp_connections WHERE owner_id = ?1").bind(access.accountUserId).first();
      if (!account) return Response.json({ siteUrl, connected: false, ...publicInventory }, { headers: { "Cache-Control": "no-store" } });
      try {
        const { sites, site } = await mcpSiteForClient(access.accountUserId, siteUrl);
        if (!site) return Response.json({ siteUrl, connected: false, accountConnected: true, availableSites: sites, ...publicInventory }, { headers: { "Cache-Control": "no-store" } });
        const pageId = Number(params.get("pageId") || 0);
        if (pageId > 0) {
          const result = await wordpressMcpCall(access.accountUserId, "wpcom-mcp-content-authoring", { action: "execute", operation: "pages.get", wpcom_site: site.id || site.url, params: { id: pageId, context: "edit" } });
          const unwrappedPage = unwrapWordPressMcpResult(result);
          const pageCandidate = Array.isArray(unwrappedPage) ? unwrappedPage[0] : unwrappedPage;
          const page = await readLiveSeo(pageFromMcp(pageCandidate, pageId), siteUrl);
          return Response.json({ siteUrl, connected: true, connectionType: "wpcom-mcp", username: "WordPress account", page, pages: [] }, { headers: { "Cache-Control": "no-store" } });
        }
        const requestedPage = Math.min(100, Math.max(1, Number(params.get("page") || 1)));
        const pages = await mcpPages(access.accountUserId, site, requestedPage);
        return Response.json({ siteUrl, connected: true, connectionType: "wpcom-mcp", username: "WordPress account", wordpressSite: site, pages }, { headers: { "Cache-Control": "no-store" } });
      } catch (error) {
        console.error("WordPress account site/page lookup failed", error instanceof Error ? error.stack || error.message : error);
        return respond(cleanMcpError(error), 502);
      }
    }
    if (connection.site_url !== siteUrl) return Response.json({ siteUrl, connected: false, connectionNeedsRefresh: true, ...(await publicPageInventory(siteUrl, Math.min(100, Math.max(1, Number(params.get("page") || 1))))) }, { headers: { "Cache-Control": "no-store" } });
    const pageId = Number(params.get("pageId") || 0);
    if (pageId > 0) {
      const item = await requestWithConnection(connection, `pages/${pageId}?context=edit&_fields=id,date,modified,slug,status,link,title,content,excerpt,meta`);
      const page = await readLiveSeo(pageFromMcp(item, pageId), siteUrl);
      return Response.json({ siteUrl, connected: true, username: connection.username, page, pages: [] }, { headers: { "Cache-Control": "no-store" } });
    }
    const page = Math.min(100, Math.max(1, Number(params.get("page") || 1)));
    const pages = await requestWithConnection(connection, `pages?context=edit&per_page=50&page=${page}&orderby=modified&order=desc&_fields=id,date,modified,slug,status,link,title,content,excerpt,meta`);
    const values = Array.isArray(pages) ? pages : [];
    return Response.json({ siteUrl, connected: true, username: connection.username, page, pages: values.map((item: any) => pageFromMcp(item)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("WordPress sites request failed", error instanceof Error ? error.stack || error.message : error);
    return respond(error instanceof Error ? error.message : "Could not load WordPress pages.", 502);
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return respond("Sign in before managing WordPress pages.", 401);
  if (!env.DB) return respond("The private workspace database is unavailable.", 503);
  const access = await adminContext(user);
  if (!access) return respond("Only an agency owner or admin can manage connected WordPress pages.", 403);
  try {
    const body = await request.json() as Record<string, unknown>;
    const client = access.data.clients?.find((item: Client) => item.id === String(body.clientId || ""));
    if (!client) return respond("Choose a client in this workspace.", 404);
    if (!client.wordpressSiteUrl) return respond("Add the WordPress website URL in this client’s profile first.", 422);
    const siteUrl = validateWordPressSiteUrl(client.wordpressSiteUrl).toString().replace(/\/$/, "");
    const action = String(body.action || "");
    if (action === "tracking-check") {
      const baseHost = new URL(siteUrl).hostname.toLowerCase().replace(/^www\./, "");
      const result = await checkSiteConversionTags(body.pageUrl, [baseHost, `www.${baseHost}`, `go.${baseHost}`]);
      return Response.json({ clientId: client.id, ...result }, { headers: { "Cache-Control": "no-store" } });
    }
    if (action === "landing-domain-check") {
      const hostname = landingHostnameForWebsite(siteUrl);
      if (!hostname) return respond("Connect a client-owned domain to this WordPress.com site and set it as primary before checking a go. subdomain.", 409);
      const result = await checkLandingDomain(hostname);
      return Response.json({ clientId: client.id, ...result }, { headers: { "Cache-Control": "no-store" } });
    }
    if (action === "pagespeed") {
      const strategy = body.strategy === "desktop" ? "desktop" : "mobile";
      try {
        const result = await runPageSpeedInsights(siteUrl, String(body.pageUrl || siteUrl), strategy);
        const runId = crypto.randomUUID();
        const saved = { kind: "pagespeed", sampledAt: result.measuredAt, siteUrl, pages: [], findings: [], comparison: { added: [], resolved: [] }, pageSpeed: result };
        await env.DB.prepare("INSERT INTO seo_audit_runs (run_id, owner_id, client_id, created_at, result_json) VALUES (?1, ?2, ?3, ?4, ?5)").bind(runId, access.ownerId, client.id, result.measuredAt, JSON.stringify(saved)).run();
        return Response.json({ id: runId, ...result }, { headers: { "Cache-Control": "no-store" } });
      } catch (error) {
        return respond(error instanceof Error ? error.message : "Google PageSpeed could not test this page.", 502);
      }
    }
    if (action === "technical-audit") {
      const requestedUrls = Array.isArray(body.urls) ? body.urls.filter((value): value is string => typeof value === "string").slice(0, 15) : [];
      const result = await runPublicTechnicalAudit(siteUrl, requestedUrls);
      const previous = await env.DB.prepare("SELECT result_json FROM seo_audit_runs WHERE owner_id = ?1 AND client_id = ?2 ORDER BY created_at DESC LIMIT 1").bind(access.ownerId, client.id).first<{ result_json: string }>();
      let previousKeys = new Set<string>();
      try { previousKeys = new Set((JSON.parse(previous?.result_json || "{}").findings || []).map((finding: { key: string }) => finding.key)); } catch {}
      const currentKeys = new Set(result.findings.map((finding) => finding.key));
      result.comparison = { added: result.findings.filter((finding) => !previousKeys.has(finding.key)), resolved: [...previousKeys].filter((key) => !currentKeys.has(key)) } as typeof result.comparison;
      const runId = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO seo_audit_runs (run_id, owner_id, client_id, created_at, result_json) VALUES (?1, ?2, ?3, ?4, ?5)").bind(runId, access.ownerId, client.id, result.sampledAt, JSON.stringify(result)).run();
      return Response.json({ id: runId, ...result }, { headers: { "Cache-Control": "no-store" } });
    }
    if (action === "connect") {
      if (!env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY) return respond("Secure credential storage is not configured on the app server.", 503);
      const username = String(body.username || "").trim().slice(0, 160);
      const password = String(body.applicationPassword || "").trim().slice(0, 300);
      if (!username || password.replace(/\s/g, "").length < 12) return respond("Enter the WordPress username and an Application Password.");
      const profile = await wordpressRequest(siteUrl, username, password, "users/me?context=edit");
      if (!profile?.id) return respond("WordPress did not confirm an editable user account.", 502);
      await wordpressRequest(siteUrl, username, password, "pages?context=edit&per_page=1&_fields=id");
      const encrypted = await encryptWordPressPassword(password);
      const now = new Date().toISOString();
      await env.DB.prepare("INSERT INTO wordpress_connections (owner_id, client_id, site_url, username, encrypted_app_password, token_iv, connected_at, last_verified_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7) ON CONFLICT(owner_id, client_id) DO UPDATE SET site_url = excluded.site_url, username = excluded.username, encrypted_app_password = excluded.encrypted_app_password, token_iv = excluded.token_iv, connected_at = excluded.connected_at, last_verified_at = excluded.last_verified_at")
        .bind(access.ownerId, client.id, siteUrl, username, encrypted.ciphertext, encrypted.iv, now).run();
      return Response.json({ ok: true, connected: true, siteUrl, username, displayName: String(profile.name || username) }, { headers: { "Cache-Control": "no-store" } });
    }
    const connection = await clientConnection(access.ownerId, client);
    if (!connection) {
      const account = await env.DB.prepare("SELECT owner_id FROM wordpress_mcp_connections WHERE owner_id = ?1").bind(access.accountUserId).first();
      if (!account) return respond("Connect your WordPress account once in Sites before saving pages.", 409);
      const { site } = await mcpSiteForClient(access.accountUserId, siteUrl);
      if (!site) return respond("This client’s website is not available in the connected WordPress account. If it is self-hosted, connect it to the account with Jetpack first.", 409);
      if (action === "update-details") {
        const id = Number(body.pageId || 0);
        if (!Number.isSafeInteger(id) || id < 1) return respond("Select a WordPress page first.");
        const title = String(body.title || "").trim().slice(0, 180);
        const slug = String(body.slug || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
        if (!title) return respond("Add a page name first.");
        try {
          const currentResult = await wordpressMcpCall(access.accountUserId, "wpcom-mcp-content-authoring", { action: "execute", operation: "pages.get", wpcom_site: site.id || site.url, params: { id, context: "edit" } });
          const current = unwrapWordPressMcpResult(currentResult) as Record<string, any>;
          const { updates, missing } = seoMetaUpdate(current?.meta && typeof current.meta === "object" ? current.meta : {}, body);
          if (missing.length) return respond(editabilityMessage(missing), 422);
          const result = await wordpressMcpCall(access.accountUserId, "wpcom-mcp-content-authoring", { action: "execute", operation: "pages.update", wpcom_site: site.id || site.url, params: { id, title, slug, ...(Object.keys(updates).length ? { meta: updates } : {}), user_confirmed: true } });
          unwrapWordPressMcpResult(result);
          const verifyResult = await wordpressMcpCall(access.accountUserId, "wpcom-mcp-content-authoring", { action: "execute", operation: "pages.get", wpcom_site: site.id || site.url, params: { id, context: "edit" } });
          const updated = unwrapWordPressMcpResult(verifyResult) as Record<string, any>;
          if (Object.keys(updates).length && !verifySeoMeta(updated?.meta && typeof updated.meta === "object" ? updated.meta : {}, updates)) return respond("WordPress accepted the request but did not confirm the SEO values after saving. No success was reported; check the site's SEO plugin settings.", 502);
          const page = pageFromMcp(updated, id);
          return Response.json({ ok: true, page }, { headers: { "Cache-Control": "no-store" } });
        } catch (error) {
          return respond(cleanMcpError(error), 502);
        }
      }
      const title = String(body.title || "").trim().slice(0, 180);
      const slug = String(body.slug || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
      const content = String(body.content || "");
      if (!title) return respond("Add a page title first.");
      if (!content.trim() || content.length > 700_000) return respond("Page content is empty or too large to save.");
      const id = Number(body.pageId || 0);
      const common = { title, slug: slug || undefined, content };
      try {
        const operation = action === "create" ? "pages.create" : "pages.update";
        if (!new Set(["create", "save", "update-live", "publish"]).has(action)) return respond("Choose a valid page action.");
        if (action !== "create" && (!Number.isSafeInteger(id) || id < 1)) return respond("Select a WordPress page or create a new one.");
        const status = action === "publish" || action === "update-live" ? "publish" : "draft";
        const result = await wordpressMcpCall(access.accountUserId, "wpcom-mcp-content-authoring", { action: "execute", operation, wpcom_site: site.id || site.url, params: { ...common, ...(action === "create" ? {} : { id }), status, user_confirmed: true } });
        const written = pageFromMcp(unwrapWordPressMcpResult(result), id);
        if (!Number.isSafeInteger(written.id) || written.id < 1) return respond("WordPress accepted the save but did not return a page ID, so the result could not be checked. Check the page in WordPress before trying again.", 502);
        const readbackResult = await wordpressMcpCall(access.accountUserId, "wpcom-mcp-content-authoring", { action: "execute", operation: "pages.get", wpcom_site: site.id || site.url, params: { id: written.id, context: "edit" } });
        const readback = unwrapWordPressMcpResult(readbackResult);
        const verification = verifyWordPressDraft({ expectedTitle: title, expectedSlug: slug || undefined, expectedContent: content, expectedStatus: status, siteUrl, saved: readback });
        if (!verification.verified) return respond(`WordPress accepted the save, but read-back verification failed. Check the page in WordPress before retrying. ${verification.issues.join(" ")}`, 502);
        const page = pageFromMcp(readback, written.id);
        return Response.json({ ok: true, verified: true, created: action === "create", page }, { headers: { "Cache-Control": "no-store" } });
      } catch (error) {
        return respond(cleanMcpError(error), 502);
      }
    }
    if (connection.site_url !== siteUrl) return respond("The saved site URL has changed. Reconnect this client’s WordPress site before saving pages.", 409);
    if (action === "update-details") {
      const id = Number(body.pageId || 0);
      if (!Number.isSafeInteger(id) || id < 1) return respond("Select a WordPress page first.");
      const title = String(body.title || "").trim().slice(0, 180);
      const slug = String(body.slug || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
      if (!title) return respond("Add a page name first.");
      const current = await requestWithConnection(connection, `pages/${id}?context=edit&_fields=id,status,meta`);
      const { updates, missing } = seoMetaUpdate(current?.meta && typeof current.meta === "object" ? current.meta : {}, body);
      if (missing.length) return respond(editabilityMessage(missing), 422);
      await requestWithConnection(connection, `pages/${id}`, { method: "POST", body: JSON.stringify({ title, slug: slug || undefined, ...(Object.keys(updates).length ? { meta: updates } : {}) }) });
      const updated = await requestWithConnection(connection, `pages/${id}?context=edit&_fields=id,date,modified,slug,status,link,title,content,meta`);
      if (Object.keys(updates).length && !verifySeoMeta(updated?.meta && typeof updated.meta === "object" ? updated.meta : {}, updates)) return respond("WordPress accepted the request but did not confirm the SEO values after saving. No success was reported; check the site's SEO plugin settings.", 502);
      const page = pageFromMcp(updated, id);
      return Response.json({ ok: true, page }, { headers: { "Cache-Control": "no-store" } });
    }
    const title = String(body.title || "").trim().slice(0, 180);
    const slug = String(body.slug || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
    const content = String(body.content || "");
    if (!title) return respond("Add a page title first.");
    if (!content.trim() || content.length > 700_000) return respond("Page content is empty or too large to save.");
    const id = Number(body.pageId || 0);
    const common = { title, slug: slug || undefined, content };
    if (action === "create") {
      const written = await requestWithConnection(connection, "pages", { method: "POST", body: JSON.stringify({ ...common, status: "draft" }) });
      const pageId = Number(written.id);
      if (!Number.isSafeInteger(pageId) || pageId < 1) return respond("WordPress accepted the draft but did not return a page ID, so the result could not be checked. Check WordPress before trying again.", 502);
      const readback = await requestWithConnection(connection, `pages/${pageId}?context=edit&_fields=id,status,slug,link,modified,title,content`);
      const verification = verifyWordPressDraft({ expectedTitle: title, expectedSlug: slug || undefined, expectedContent: content, siteUrl, saved: readback });
      if (!verification.verified) return respond(`WordPress accepted the draft, but read-back verification failed. Check the page in WordPress before retrying. ${verification.issues.join(" ")}`, 502);
      return Response.json({ ok: true, verified: true, created: true, page: pageFromMcp(readback, pageId) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (!Number.isSafeInteger(id) || id < 1) return respond("Select a WordPress page or create a new one.");
    const existing = await requestWithConnection(connection, `pages/${id}?context=edit&_fields=id,status`);
    if (action === "save" && existing.status === "publish") return respond("This page is live. Use Update live page to save changes to the published version.", 409);
    if (action === "update-live" && existing.status !== "publish") return respond("This page is not published. Use Save draft or Publish page instead.", 409);
    if (action === "publish" && existing.status === "publish") return respond("This page is already live. Use Update live page to save edits.", 409);
    if (!["save", "update-live", "publish"].includes(action)) return respond("Choose a valid page action.");
    const payload = action === "publish" ? { ...common, status: "publish" } : common;
    await requestWithConnection(connection, `pages/${id}`, { method: "POST", body: JSON.stringify(payload) });
    const expectedStatus = action === "publish" || action === "update-live" ? "publish" : String(existing.status || "draft");
    const readback = await requestWithConnection(connection, `pages/${id}?context=edit&_fields=id,status,slug,link,modified,title,content`);
    const verification = verifyWordPressDraft({ expectedTitle: title, expectedSlug: slug || undefined, expectedContent: content, expectedStatus, siteUrl, saved: readback });
    if (!verification.verified) return respond(`WordPress accepted the save, but read-back verification failed. Check the page in WordPress before retrying. ${verification.issues.join(" ")}`, 502);
    return Response.json({ ok: true, verified: true, page: pageFromMcp(readback, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return respond(error instanceof Error ? error.message : "Could not save to WordPress.", 502);
  }
}

export async function DELETE(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return respond("Sign in before disconnecting WordPress.", 401);
  if (!env.DB) return respond("The private workspace database is unavailable.", 503);
  const access = await adminContext(user);
  if (!access) return respond("Only an agency owner or admin can disconnect WordPress.", 403);
  const params = new URL(request.url).searchParams;
  const client = access.data.clients?.find((item: Client) => item.id === params.get("clientId"));
  if (!client) return respond("Choose a client in this workspace.", 404);
  await env.DB.prepare("DELETE FROM wordpress_connections WHERE owner_id = ?1 AND client_id = ?2").bind(access.ownerId, client.id).run();
  return Response.json({ ok: true });
}
