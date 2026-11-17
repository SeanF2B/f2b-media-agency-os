import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { fullTeamPermissions, getTeamPermissions, type TeamPermissions } from "@/lib/access-permissions";
import { loadCachedMarketingData } from "@/lib/marketing-data-history";
import { hasGoogleSearchConsoleConnection, readGoogleSearchConsoleRows } from "@/lib/google-search-console-direct";
import { hasGoogleAnalyticsDirectConnection, readGoogleAnalyticsReport } from "@/lib/google-analytics-direct";
import { getGoogleAdsAdMetrics, getGoogleAdsKeywordPerformance, getGoogleAdsLandingPages, listGoogleAdsAssetsResilient, listGoogleAdsResponsiveSearchAds } from "@/lib/google-ads-direct";

// Dashboard → Marketing → Landing pages, per page in full:
//  kind=organic: every site page (sitemap + Search Console + GA4) with its live meta title, description,
//    meta keywords, H1, target keywords, top Google searches, clicks, impressions, position, visits, calls, leads.
//  kind=ads: every ad landing page with clicks, impressions, spend, conversions, calls, leads, the ads that
//    point at it (headlines/descriptions + stats), their keywords, sitelinks to it; plus every account asset.
// Read-only. Google reads are cached 6h, page meta 24h, so opening the drop-down rarely costs a live call.
export const dynamic = "force-dynamic";
const reply = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
type Staff = { id: string; email: string; role: string; isBot?: boolean; permissions?: Partial<TeamPermissions>; clientAccessIds?: string[]; limitClientAccess?: boolean };
type Client = { id: string; name: string; website?: string; wordpressSiteUrl?: string; googleAdsAccountId?: string; googleSearchConsoleAccountId?: string; googleAnalyticsAccountId?: string };
const H6 = 6 * 3600_000;

const pathKey = (u: string) => {
  let v = "/";
  try { v = decodeURIComponent(new URL(u, "https://x.invalid").pathname || "/"); } catch { v = String(u || "/").split("?")[0] || "/"; }
  v = v.toLowerCase().replace(/\/{2,}/g, "/");
  return v.length > 1 && !v.endsWith("/") && !/\.[a-z0-9]+$/i.test(v) ? `${v}/` : v;
};
const decode = (t: string) => t.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/\s+/g, " ").trim();
const metaOf = (html: string, name: string) => {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const key = /\b(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (key === name) return decode(/\bcontent\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? /\bcontent\s*=\s*'([^']*)'/i.exec(tag)?.[1] ?? "");
  }
  return "";
};

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return reply({ error: "Sign in first." }, 401);
  if (!env.DB) return reply({ error: "The workspace database is unavailable." }, 503);
  const db = env.DB;
  const row = await db.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!row?.data) return reply({ error: "The workspace is unavailable." }, 503);
  const workspace = JSON.parse(row.data) as { ownerId?: string; staff?: Staff[]; clients?: Client[] };
  const ownerId = String(workspace.ownerId || "");
  const owner = ownerId === user.userId;
  const staff = (workspace.staff || []).find((s) => !s.isBot && (s.id === user.userId || s.email?.toLowerCase() === user.email.toLowerCase()));
  const admin = owner || ["Owner", "Admin"].includes(staff?.role || "");
  if (!admin && !staff) return reply({ error: "You do not have access." }, 403);
  const permissions = owner ? fullTeamPermissions : getTeamPermissions(staff?.role || "Viewer", staff?.permissions);
  if (!admin && !permissions.reports) return reply({ error: "You do not have access to reports." }, 403);
  const url = new URL(request.url);
  const client = (workspace.clients || []).find((c) => c.id === (url.searchParams.get("clientId") || ""));
  if (!client) return reply({ error: "Choose a client." }, 404);
  if (!admin && staff?.limitClientAccess && !(staff.clientAccessIds || []).includes(client.id)) return reply({ error: "You do not have access to this client." }, 403);
  const okDate = (v: string | null) => /^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v! : "";
  const end = okDate(url.searchParams.get("end")) || new Date().toISOString().slice(0, 10);
  const start = okDate(url.searchParams.get("start")) || new Date(Date.parse(end) - 30 * 86_400_000).toISOString().slice(0, 10);
  const days = Math.max(1, Math.min(366, Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000)));
  const period = { start: new Date(Date.parse(`${end}T12:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10), end };
  const kind = url.searchParams.get("kind") === "ads" ? "ads" : "organic";
  const cache = <T,>(service: string, key: string, load: () => Promise<T>, ttlMs = H6) => loadCachedMarketingData({ db: db as never, ownerId, clientId: client.id, service, key, ttlMs }, load).then((r) => r.data);
  const origin = (() => { const raw = String(client.website || client.wordpressSiteUrl || "").trim(); try { return raw ? new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`).origin : ""; } catch { return ""; } })();

  // GA4 per page: visits by channel, conversions (key events), calls and leads.
  const ga4Id = String(client.googleAnalyticsAccountId || "").trim();
  type Ga = { sessions: number; organicSessions: number; paidSessions: number; keyEvents: number; organicKeyEvents: number; paidKeyEvents: number; calls: { all: number; organic: number; paid: number }; leads: { all: number; organic: number; paid: number }; whatsapp: number; emails: number };
  const ga = new Map<string, Ga>();
  let gaNote = "";
  if (ga4Id && await hasGoogleAnalyticsDirectConnection(ownerId).catch(() => false)) {
    try {
      const [landing, events] = await Promise.all([
        cache("GA4", JSON.stringify({ report: "dash-ga4-landing", ga4Id, a: period.start, b: period.end }), () => readGoogleAnalyticsReport(ownerId, ga4Id, period.start, period.end, ["landingPage", "sessionDefaultChannelGroup"], ["sessions", "keyEvents"])),
        cache("GA4", JSON.stringify({ report: "dash-ga4-events", ga4Id, a: period.start, b: period.end }), () => readGoogleAnalyticsReport(ownerId, ga4Id, period.start, period.end, ["pagePath", "eventName", "sessionDefaultChannelGroup"], ["eventCount"])),
      ]);
      const get = (p: string) => { let g = ga.get(p); if (!g) { g = { sessions: 0, organicSessions: 0, paidSessions: 0, keyEvents: 0, organicKeyEvents: 0, paidKeyEvents: 0, calls: { all: 0, organic: 0, paid: 0 }, leads: { all: 0, organic: 0, paid: 0 }, whatsapp: 0, emails: 0 }; ga.set(p, g); } return g; };
      const ch = (v: unknown) => /organic/i.test(String(v)) ? "organic" : /paid|cpc|ppc/i.test(String(v)) ? "paid" : "other";
      for (const r of landing as Array<Record<string, unknown>>) {
        if (!r.landingPage || r.landingPage === "(not set)") continue;
        const g = get(pathKey(String(r.landingPage))), k = ch(r.sessionDefaultChannelGroup), s = Number(r.sessions) || 0, e = Number(r.keyEvents) || 0;
        g.sessions += s; g.keyEvents += e;
        if (k === "organic") { g.organicSessions += s; g.organicKeyEvents += e; } else if (k === "paid") { g.paidSessions += s; g.paidKeyEvents += e; }
      }
      for (const r of events as Array<Record<string, unknown>>) {
        if (!r.pagePath || r.pagePath === "(not set)") continue;
        const name = String(r.eventName || ""), n = Number(r.eventCount) || 0, k = ch(r.sessionDefaultChannelGroup);
        const bucket = /^(phone_click|click_to_call)$/.test(name) ? "calls" : /^(generate_lead|form_submit)$/.test(name) ? "leads" : name === "whatsapp_click" ? "whatsapp" : name === "email_click" ? "emails" : "";
        if (!bucket) continue;
        const g = get(pathKey(String(r.pagePath)));
        if (bucket === "calls" || bucket === "leads") { g[bucket].all += n; if (k !== "other") g[bucket][k] += n; }
        else g[bucket] += n;
      }
    } catch (error) { gaNote = error instanceof Error ? error.message : "Google Analytics couldn’t be read."; }
  } else gaNote = ga4Id ? "Google Analytics isn’t connected." : "No GA4 property linked to this client.";

  if (kind === "organic") {
    // Search Console rows (date × query × page), shared cache key with the dashboard.
    const property = String(client.googleSearchConsoleAccountId || "").trim();
    let gscRows: Array<{ query: string; page: string; clicks: number; impressions: number; position: number }> = [];
    let gscNote = "";
    if (property && await hasGoogleSearchConsoleConnection(ownerId).catch(() => false)) {
      const today3 = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
      const gEnd = period.end > today3 ? today3 : period.end;
      const gStart = period.start < gEnd ? period.start : new Date(Date.parse(gEnd) - 28 * 86_400_000).toISOString().slice(0, 10);
      try { gscRows = await cache("Search Console", JSON.stringify({ report: "dash-gsc", property, a: gStart, b: gEnd }), () => readGoogleSearchConsoleRows(ownerId, property, gStart, gEnd)) as typeof gscRows; }
      catch (error) { gscNote = error instanceof Error ? error.message : "Search Console couldn’t be read."; }
      if (!gscNote && !gscRows.length) gscNote = "Google hasn’t returned search data for this period yet (new Search Console properties take about a day).";
    } else gscNote = property ? "Search Console isn’t connected." : "No Search Console property linked yet.";

    // All pages: sitemap + anything Google or GA4 saw.
    const sitemapUrls = origin ? await cache("Website", JSON.stringify({ report: "sitemap-urls", origin }), async () => {
      const locs = async (u: string) => { const res = await fetch(u, { headers: { "User-Agent": "F2B-OS/1.0 (+dashboard)" }, signal: AbortSignal.timeout(8000) }); if (!res.ok) return [] as string[]; const xml = await res.text(); return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1])); };
      let list = await locs(`${origin}/sitemap.xml`).catch(() => [] as string[]);
      const nested = list.filter((u) => /\.xml(\?|$)/i.test(u)).slice(0, 5);
      if (nested.length) list = [...list.filter((u) => !/\.xml(\?|$)/i.test(u)), ...(await Promise.all(nested.map((u) => locs(u).catch(() => [] as string[])))).flat()];
      return [...new Set(list)].slice(0, 300);
    }, 24 * 3600_000).catch(() => [] as string[]) : [];

    type Page = { path: string; url: string; clicks: number; impressions: number; posW: number; queries: Map<string, { clicks: number; impressions: number; posW: number }> };
    const pages = new Map<string, Page>();
    const page = (u: string) => { const k = pathKey(u); let p = pages.get(k); if (!p) { p = { path: k, url: /^https?:/i.test(u) ? u.split("#")[0] : origin + k, clicks: 0, impressions: 0, posW: 0, queries: new Map() }; pages.set(k, p); } return p; };
    for (const u of sitemapUrls) page(u);
    for (const r of gscRows) {
      if (!r.page) continue;
      const p = page(r.page); p.clicks += r.clicks; p.impressions += r.impressions; p.posW += r.position * r.impressions;
      const q = p.queries.get(r.query) || { clicks: 0, impressions: 0, posW: 0 }; q.clicks += r.clicks; q.impressions += r.impressions; q.posW += r.position * r.impressions; p.queries.set(r.query, q);
    }
    for (const k of ga.keys()) if (!pages.has(k) && origin) page(origin + k);

    // Saved target keywords (SEO → Pages) and the builder's focus keyword.
    const targets = new Map<string, { primary: string; supporting: string }>();
    try {
      const rows = (await db.prepare("SELECT page_key, primary_kw, supporting FROM seo_page_targets WHERE owner_id = ?1 AND client_id = ?2").bind(ownerId, client.id).all<{ page_key: string; primary_kw: string; supporting: string }>()).results || [];
      for (const r of rows) targets.set(pathKey(r.page_key), { primary: r.primary_kw, supporting: r.supporting });
    } catch { /* table not created yet */ }

    // Live meta tags for every page (24h cache, max 60 pages per refresh).
    const ordered = [...pages.values()].sort((a, b) => (b.clicks - a.clicks) || ((ga.get(b.path)?.sessions || 0) - (ga.get(a.path)?.sessions || 0)) || (b.impressions - a.impressions) || a.path.localeCompare(b.path));
    const metaTargets = ordered.slice(0, 60).map((p) => p.url).filter((u) => /^https?:/i.test(u));
    const metas = await cache("Website", JSON.stringify({ report: "page-meta", origin, urls: metaTargets }), async () => {
      const out: Record<string, { title: string; description: string; keywords: string; h1: string; canonical: string; robots: string; status: number }> = {};
      const queue = [...metaTargets];
      const worker = async () => {
        while (queue.length) {
          const u = queue.shift()!;
          try {
            const res = await fetch(u, { headers: { "User-Agent": "F2B-OS/1.0 (+dashboard)", Accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(7000) });
            const html = (await res.text()).slice(0, 400_000);
            const head = html.split(/<\/head>/i)[0];
            out[pathKey(u)] = {
              title: decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] || ""),
              description: metaOf(head, "description"), keywords: metaOf(head, "keywords"), robots: metaOf(head, "robots"),
              h1: decode((/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] || "").replace(/<[^>]+>/g, " ")),
              canonical: /<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']+)["']/i.exec(head)?.[1] || "",
              status: res.status,
            };
          } catch { out[pathKey(u)] = { title: "", description: "", keywords: "", h1: "", canonical: "", robots: "", status: 0 }; }
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      return out;
    }, 24 * 3600_000).catch(() => ({} as Record<string, never>));

    const list = ordered.map((p) => {
      const g = ga.get(p.path), m = (metas as Record<string, { title: string; description: string; keywords: string; h1: string; canonical: string; robots: string; status: number }>)[p.path], t = targets.get(p.path);
      const queries = [...p.queries.entries()].sort((a, b) => b[1].clicks - a[1].clicks || b[1].impressions - a[1].impressions).slice(0, 15).map(([query, q]) => ({ query, clicks: q.clicks, impressions: q.impressions, position: q.impressions ? Math.round(q.posW / q.impressions * 10) / 10 : null }));
      return {
        path: p.path, url: p.url, clicks: p.clicks, impressions: p.impressions, position: p.impressions ? Math.round(p.posW / p.impressions * 10) / 10 : null, ctr: p.impressions ? Math.round(p.clicks / p.impressions * 1000) / 10 : null,
        title: m?.title || "", description: m?.description || "", metaKeywords: m?.keywords || "", h1: m?.h1 || "", canonical: m?.canonical || "", robots: m?.robots || "", httpStatus: m?.status ?? null,
        targetKeyword: t?.primary || "", supportingKeywords: t?.supporting || "", queries,
        visits: g?.organicSessions ?? null, allVisits: g?.sessions ?? null, conversions: g?.organicKeyEvents ?? null, calls: g?.calls.organic ?? null, leads: g?.leads.organic ?? null, allCalls: g?.calls.all ?? null, allLeads: g?.leads.all ?? null, whatsapp: g?.whatsapp ?? null, emails: g?.emails ?? null,
      };
    });
    return reply({ kind, period, origin, pages: list, notes: { searchConsole: gscNote, analytics: gaNote }, sources: ["Google Search Console", "Google Analytics 4", "Live page HTML", "Sitemap"] });
  }

  // ---- Google Ads ----
  const accountId = String(client.googleAdsAccountId || "").replace(/\D/g, "");
  if (!accountId) return reply({ kind, period, pages: [], assets: [], notes: { ads: "No Google Ads account linked to this client.", analytics: gaNote } });
  const key = (report: string) => JSON.stringify({ report, accountId, a: period.start, b: period.end });
  const [landing, ads, adStats, kwData, assets] = await Promise.all([
    cache("Google Ads", key("dash-ads-pages"), () => getGoogleAdsLandingPages(ownerId, accountId, period)).catch(() => null),
    cache("Google Ads", JSON.stringify({ report: "dash-ads-rsa", accountId }), () => listGoogleAdsResponsiveSearchAds(ownerId, accountId)).catch(() => null),
    cache("Google Ads", key("dash-ads-admetrics"), async () => Object.fromEntries(await getGoogleAdsAdMetrics(ownerId, accountId, period))).catch(() => null),
    cache("Google Ads", key("dash-ads-keywords-full"), () => getGoogleAdsKeywordPerformance(ownerId, accountId, undefined, { startDate: period.start, endDate: period.end }).then((r) => r.keywords)).catch(() => null),
    cache("Google Ads", key("dash-ads-assets-v2"), () => listGoogleAdsAssetsResilient(ownerId, accountId, period)).catch((e) => ({ assets: null, errors: [e instanceof Error ? e.message : "Assets couldn’t be read."] })),
  ]);
  type AdRow = { adId: string; campaign: string; adGroup: string; adGroupId: string; status: string; headlines: string[]; descriptions: string[]; finalUrls: string[]; impressions: number; clicks: number; spend: number; conversions: number; calls: number | null };
  const stats = (adStats || {}) as Record<string, { impressions: number; clicks: number; spend: number; conversions: number; calls: number | null }>;
  const adRows: AdRow[] = (ads || []).map((a) => ({ adId: a.adId, campaign: a.campaignName, adGroup: a.adGroupName, adGroupId: a.adGroupId, status: a.status, headlines: a.headlines.map((h) => h.text), descriptions: a.descriptions.map((d) => d.text), finalUrls: a.finalUrls, impressions: stats[a.adId]?.impressions || 0, clicks: stats[a.adId]?.clicks || 0, spend: stats[a.adId]?.spend || 0, conversions: stats[a.adId]?.conversions || 0, calls: stats[a.adId]?.calls ?? null }));
  type Kw = { adGroupId: string; keyword: string; matchType: string; status?: string; clicks: number; impressions: number; spend: number; conversions: number; qualityScore?: number | null };
  const kws = (kwData || []) as unknown as Kw[];
  type Asset = { type: string; fieldType: string; scope: string; campaignName: string; adGroupName: string; status: string; performanceLabel: string; text: string[]; finalUrls: string[]; imageUrl: string; impressions: number; clicks: number; spend: number; conversions: number };
  const assetRows = (assets?.assets || []) as unknown as Asset[];

  const pages = new Map<string, { path: string; url: string; clicks: number; impressions: number; spend: number; conversions: number }>();
  for (const r of landing || []) { const k = pathKey(r.url); const p = pages.get(k) || { path: k, url: r.url.split("?")[0], clicks: 0, impressions: 0, spend: 0, conversions: 0 }; p.clicks += r.clicks; p.impressions += r.impressions; p.spend += r.spend; p.conversions += r.conversions; pages.set(k, p); }
  for (const a of adRows) for (const u of a.finalUrls) { const k = pathKey(u); if (!pages.has(k)) pages.set(k, { path: k, url: u.split("?")[0], clicks: 0, impressions: 0, spend: 0, conversions: 0 }); }

  const list = [...pages.values()].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).map((p) => {
    const pageAds = adRows.filter((a) => a.finalUrls.some((u) => pathKey(u) === p.path)).sort((a, b) => b.clicks - a.clicks);
    const groups = new Set(pageAds.map((a) => a.adGroupId));
    const pageKws = kws.filter((k) => groups.has(k.adGroupId)).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 40).map((k) => ({ keyword: k.keyword, matchType: k.matchType, clicks: k.clicks, impressions: k.impressions, spend: k.spend, conversions: k.conversions, qualityScore: k.qualityScore ?? null }));
    const sitelinks = assetRows.filter((s) => /SITELINK/i.test(s.type) && s.finalUrls.some((u) => pathKey(u) === p.path)).map((s) => ({ text: s.text, campaign: s.campaignName, clicks: s.clicks, impressions: s.impressions, conversions: s.conversions }));
    const g = ga.get(p.path);
    const adCalls = pageAds.some((a) => a.calls != null) ? pageAds.reduce((t, a) => t + (a.calls || 0), 0) : null;
    return { ...p, cpc: p.clicks ? p.spend / p.clicks : null, adCalls, calls: g?.calls.paid ?? null, leads: g?.leads.paid ?? null, visits: g?.paidSessions ?? null, ads: pageAds.slice(0, 12), keywords: pageKws, sitelinks };
  });
  const order = ["SITELINK", "CALLOUT", "STRUCTURED_SNIPPET", "CALL", "IMAGE", "BUSINESS_NAME", "BUSINESS_LOGO", "PROMOTION", "PRICE", "LEAD_FORM"];
  const assetList = assetRows.filter((a) => !/^(HEADLINE|DESCRIPTION)$/i.test(a.fieldType) || a.scope === "Performance Max asset group")
    .sort((a, b) => (order.indexOf(a.type) + 1 || 99) - (order.indexOf(b.type) + 1 || 99) || b.clicks - a.clicks || b.impressions - a.impressions)
    .slice(0, 200).map((a) => ({ type: a.type, fieldType: a.fieldType, scope: a.scope, campaign: a.campaignName, adGroup: a.adGroupName, status: a.status, performance: a.performanceLabel, text: a.text, finalUrls: a.finalUrls, imageUrl: a.imageUrl, clicks: a.clicks, impressions: a.impressions, spend: a.spend, conversions: a.conversions }));
  return reply({ kind, period, pages: list, assets: assetList, notes: { ads: landing == null && ads == null ? "Google Ads didn’t return data." : "", assets: assets?.errors?.length ? `Some assets couldn’t be read (${assets.errors.join("; ")})` : "", analytics: gaNote }, sources: ["Google Ads API", "Google Analytics 4"] });
}
