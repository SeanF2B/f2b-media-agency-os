import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { fullTeamPermissions, getTeamPermissions, type TeamPermissions } from "@/lib/access-permissions";
import { buildClientReport } from "@/lib/client-report-data";
import { listBookings, listCalendars } from "@/lib/scheduling/server";
import { metaAdsConnectionExists, readDirectMetaAdsInsights } from "@/lib/meta-ads-direct";
import { summarizeMetaAdsRows, summarizeMetaAdsTotals } from "@/lib/meta-ads-performance";
import { getGoogleAdsCallStats, getGoogleAdsKeywordPerformance, getGoogleAdsLandingPages } from "@/lib/google-ads-direct";
import { hasGoogleSearchConsoleConnection, listGoogleSearchConsoleProperties, readGoogleSearchConsoleRows } from "@/lib/google-search-console-direct";
import { loadCachedMarketingData } from "@/lib/marketing-data-history";

// Dashboard tiles: marketing results for one client (from the same cached reads as client reports),
// upcoming appointments and emails the system sent. One request per dashboard load.
export const dynamic = "force-dynamic";
const reply = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
type Staff = { id: string; email: string; role: string; isBot?: boolean; permissions?: Partial<TeamPermissions>; clientAccessIds?: string[]; limitClientAccess?: boolean };
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const avg = (values: number[]) => values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return reply({ error: "Sign in first." }, 401);
  if (!env.DB) return reply({ error: "The workspace database is unavailable." }, 503);
  const db = env.DB;
  const row = await db.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!row?.data) return reply({ error: "The workspace is unavailable." }, 503);
  const workspace = JSON.parse(row.data) as { ownerId?: string; staff?: Staff[]; clients?: Array<{ id: string; name: string; googleAdsAccountId?: string; metaAdsAccountId?: string; website?: string; wordpressSiteUrl?: string; googleSearchConsoleAccountId?: string }> };
  const ownerId = String(workspace.ownerId || "");
  const owner = ownerId === user.userId;
  const staff = (workspace.staff || []).find((item) => !item.isBot && (item.id === user.userId || item.email?.toLowerCase() === user.email.toLowerCase()));
  const admin = owner || ["Owner", "Admin"].includes(staff?.role || "");
  if (!admin && !staff) return reply({ error: "You do not have access." }, 403);
  const permissions = owner ? fullTeamPermissions : getTeamPermissions(staff?.role || "Viewer", staff?.permissions);
  const allowedIds = admin || !staff?.limitClientAccess ? null : staff.clientAccessIds || [];
  const url = new URL(request.url);
  let clientId = (url.searchParams.get("clientId") || "").slice(0, 120);
  const allClients = clientId === "all" && !allowedIds;
  if (clientId === "all" && !allClients) clientId = "";
  if (clientId && !allClients && !(workspace.clients || []).some((client) => client.id === clientId)) clientId = "";
  if (clientId && allowedIds && !allowedIds.includes(clientId)) return reply({ error: "You do not have access to this client." }, 403);
  // Reporting window: from the dashboard's period picker (defaults to the last 30 days).
  const okDate = (v: string | null) => /^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v! : "";
  const reqEnd = okDate(url.searchParams.get("end")) || day(0);
  const reqStart = okDate(url.searchParams.get("start")) || (() => { const d = new Date(`${reqEnd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 30); return d.toISOString().slice(0, 10); })();
  const windowDays = Math.max(1, Math.min(366, Math.round((Date.parse(reqEnd) - Date.parse(reqStart)) / 86_400_000)));
  const clampStart = (() => { const d = new Date(`${reqEnd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - windowDays); return d.toISOString().slice(0, 10); })();
  const scope: string | null = allClients ? null : clientId || (allowedIds ? allowedIds[0] || "none" : null);

  type Totals = { spend: number; clicks: number; impressions: number; conversions: number };
  const adsBlock = (now: Totals | null, before: Totals | null) => now ? {
    adSpend: { value: now.spend, previous: before?.spend ?? null }, adClicks: { value: now.clicks, previous: before?.clicks ?? null },
    impressions: { value: now.impressions, previous: before?.impressions ?? null }, conversions: { value: now.conversions, previous: before?.conversions ?? null },
    cpc: now.clicks ? { value: now.spend / now.clicks, previous: before && before.clicks ? before.spend / before.clicks : null } : null,
    costPerConversion: now.conversions ? { value: now.spend / now.conversions, previous: before && before.conversions ? before.spend / before.conversions : null } : null,
  } : { adSpend: null, adClicks: null, impressions: null, conversions: null, cpc: null, costPerConversion: null };
  // Meta Ads totals (last 30 days) for the given clients' mapped ad accounts.
  const metaFor = async (ids: string[]) => {
    const linked = (workspace.clients || []).filter((c) => ids.includes(c.id) && c.metaAdsAccountId);
    if (!linked.length) return { meta: null, metaNote: "No Meta Ads account linked" };
    if (!(await metaAdsConnectionExists(ownerId).catch(() => false))) return { meta: null, metaNote: "Meta Ads isn’t connected" };
    const window = { start: clampStart, end: reqEnd };
    const raw = await Promise.all(linked.map((c) => readDirectMetaAdsInsights(ownerId, c.metaAdsAccountId!, window, "campaigns").catch(() => null)));
    const rows = raw.map((r) => r ? summarizeMetaAdsTotals(r) : null);
    const campaigns = raw.flatMap((r) => r ? summarizeMetaAdsRows(r, "campaigns").map((c) => ({ id: c.id, name: c.name, status: c.status, spend: c.spend, clicks: c.clicks, impressions: c.impressions, leads: c.leads })) : []).slice(0, 40);
    const ok = rows.filter((r): r is NonNullable<typeof r> => Boolean(r));
    if (!ok.length) return { meta: null, metaNote: "Meta didn’t return data" };
    const t = ok.reduce((a, r) => ({ spend: a.spend + r.spend, impressions: a.impressions + r.impressions, clicks: a.clicks + r.clicks, leads: a.leads + r.leads }), { spend: 0, impressions: 0, clicks: 0, leads: 0 });
    return { meta: { ...t, cpc: t.clicks ? t.spend / t.clicks : null, costPerLead: t.leads ? t.spend / t.leads : null, accounts: ok.length, linkedAccounts: linked.length, campaigns }, metaNote: "" };
  };
  // Real organic data from Google Search Console: clicks, position, top pages and trending searches.
  const searchConsoleFor = async (cid: string) => {
    const client = (workspace.clients || []).find((c) => c.id === cid);
    if (!client) return null;
    if (!(await hasGoogleSearchConsoleConnection(ownerId).catch(() => false))) return { error: "Connect Google Search Console in Operations → Launchpad to see real organic searches and pages." };
    const host = (raw: string) => { try { return new URL(/^https?:/.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
    let property = String(client.googleSearchConsoleAccountId || "").trim();
    if (!property) {
      const domain = host(client.website || client.wordpressSiteUrl || "");
      if (!domain) return { error: "Add this client’s website so Search Console can be matched." };
      const props = await loadCachedMarketingData({ db: db as never, ownerId, clientId: "agency", service: "Search Console", key: "gsc-properties", ttlMs: 6 * 3600_000 }, () => listGoogleSearchConsoleProperties(ownerId)).then((r) => r.data).catch(() => []);
      const match = props.find((p) => p.id === `sc-domain:${domain}`) || props.find((p) => host(p.id.replace(/^sc-domain:/, "")) === domain);
      if (!match) return { error: `${domain} isn’t in the connected Search Console account yet. Add it (or give that Google login access) and it will appear here.` };
      property = match.id;
    }
    const shift = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
    const end = reqEnd > day(-3) ? day(-3) : reqEnd, start = clampStart < end ? clampStart : shift(end, -28), span = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000) + 1, pEnd = shift(start, -1), pStart = shift(pEnd, -(span - 1));
    const read = (a: string, b: string) => loadCachedMarketingData({ db: db as never, ownerId, clientId: cid, service: "Search Console", key: JSON.stringify({ report: "dash-gsc", property, a, b }), ttlMs: 6 * 3600_000 }, () => readGoogleSearchConsoleRows(ownerId, property, a, b)).then((r) => r.data);
    try {
      const [cur, prev] = await Promise.all([read(start, end), read(pStart, pEnd).catch(() => [])]);
      const totals = (rows: typeof cur) => { let clicks = 0, impressions = 0, posW = 0; for (const r of rows) { clicks += r.clicks; impressions += r.impressions; posW += r.position * r.impressions; } return { clicks, impressions, position: impressions ? Math.round((posW / impressions) * 10) / 10 : null }; };
      const group = (rows: typeof cur, key: "page" | "query") => { const map = new Map<string, { key: string; clicks: number; impressions: number; posW: number }>(); for (const r of rows) { const k = r[key]; if (!k) continue; const g = map.get(k) || { key: k, clicks: 0, impressions: 0, posW: 0 }; g.clicks += r.clicks; g.impressions += r.impressions; g.posW += r.position * r.impressions; map.set(k, g); } return map; };
      const now = totals(cur), before = totals(prev);
      const pages = [...group(cur, "page").values()].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 25).map((g) => ({ page: g.key.replace(/^https?:\/\/[^/]+/, "") || "/", url: g.key, clicks: g.clicks, impressions: g.impressions, position: g.impressions ? Math.round(g.posW / g.impressions * 10) / 10 : null }));
      const qNow = group(cur, "query"), qPrev = group(prev, "query");
      const queries = [...qNow.values()].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 25).map((g) => ({ query: g.key, clicks: g.clicks, impressions: g.impressions, position: g.impressions ? Math.round(g.posW / g.impressions * 10) / 10 : null }));
      const trending = [...qNow.values()].map((g) => ({ query: g.key, impressions: g.impressions, change: g.impressions - (qPrev.get(g.key)?.impressions || 0) })).filter((g) => g.change > 0).sort((a, b) => b.change - a.change).slice(0, 15);
      return { property, clicks: now.clicks, previousClicks: prev.length ? before.clicks : null, impressions: now.impressions, position: now.position, previousPosition: prev.length ? before.position : null, queriesTracked: qNow.size, pages, queries, trending };
    } catch (error) { return { error: error instanceof Error ? error.message : "Search Console couldn’t be read." }; }
  };
  // Public Trustpilot rating for the client's website (cached a day). Facebook needs a connected Page.
  const trustpilotFor = async (cid: string) => {
    const client = (workspace.clients || []).find((c) => c.id === cid);
    const raw = client?.website || client?.wordpressSiteUrl || "";
    let domain = ""; try { domain = new URL(/^https?:/.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, ""); } catch { /* none */ }
    if (!domain) return { status: "no_website" as const };
    try {
      const got = await loadCachedMarketingData({ db: db as never, ownerId, clientId: cid, service: "Trustpilot", key: `tp:${domain}`, ttlMs: 24 * 3600_000 }, async () => {
        const res = await fetch(`https://www.trustpilot.com/review/${domain}`, { headers: { "User-Agent": "Mozilla/5.0 (compatible; F2B-OS/1.0)", Accept: "text/html" }, signal: AbortSignal.timeout(8000) });
        if (res.status === 404) return { found: false, rating: null as number | null, total: null as number | null };
        const html = await res.text();
        const rating = /"ratingValue"\s*:\s*"?([\d.]+)/.exec(html)?.[1]; const total = /"reviewCount"\s*:\s*"?(\d+)/.exec(html)?.[1];
        return { found: Boolean(rating || total), rating: rating ? Number(rating) : null, total: total ? Number(total) : null };
      });
      return got.data.found ? { status: "ok" as const, rating: got.data.rating, total: got.data.total, url: `https://www.trustpilot.com/review/${domain}` } : { status: "not_found" as const, url: `https://www.trustpilot.com/review/${domain}` };
    } catch { return { status: "unavailable" as const }; }
  };
  const marketing = async () => {
    if (!clientId || !(admin || permissions.reports)) return null;
    const period = { start: clampStart, end: reqEnd };
    if (allClients) {
      // Agency view: Google Ads totals across every client with a linked account.
      const linked = (workspace.clients || []).filter((c) => c.googleAdsAccountId && !/^(inactive|archived)$/i.test(String((c as { status?: string }).status || "")));
      const reports = await Promise.all(linked.map((c) => buildClientReport(db as never, workspace as never, c.id, "ads", period).catch(() => null)));
      const zero = (): Totals => ({ spend: 0, clicks: 0, impressions: 0, conversions: 0 });
      const now = zero(), before = zero(); let withData = 0, withPrev = 0, leads = 0, currency = "EUR";
      for (const r of reports) {
        if (!r) continue;
        if (r.attribution.status === "ok") leads += Object.values(r.attribution.data!.allChannels || {}).reduce((a, b) => a + (Number(b) || 0), 0);
        if (r.ads?.status !== "ok" || !r.ads.data) continue;
        withData++; currency = r.client.currency || currency;
        const c = r.ads.data.current, p = r.ads.data.previous;
        now.spend += c.spend; now.clicks += c.clicks; now.impressions += c.impressions; now.conversions += c.conversions;
        if (p) { withPrev++; before.spend += p.spend; before.clicks += p.clicks; before.impressions += p.impressions; before.conversions += p.conversions; }
      }
      const meta = await metaFor((workspace.clients || []).map((c) => c.id));
      return { ...meta, scope: "all", accounts: withData, linkedAccounts: linked.length, currency, ...adsBlock(withData ? now : null, withPrev ? before : null), adsNote: linked.length ? "No Google Ads data returned yet" : "No client has a Google Ads account linked",
        visits: null, visitsNote: "Pick a client to see website visits", calls: null, profileClicks: null, businessNote: "Pick a client", leads: { value: leads, previous: null },
        google: null, rankNote: "Pick a client to see rankings", chatgpt: null, aiNote: "Pick a client", bing: null, bingNote: "Bing rank tracking isn’t set up yet" };
    }
    const [seo, ads] = await Promise.all([
      buildClientReport(db as never, workspace as never, clientId, "seo", period).catch(() => null),
      buildClientReport(db as never, workspace as never, clientId, "ads", period).catch(() => null),
    ]);
    const ok = <T,>(section?: { status: string; data?: T; note?: string }) => section?.status === "ok" ? section.data || null : null;
    const why = (section?: { status: string; note?: string }) => section && section.status !== "ok" ? section.note || "Not connected" : "";
    const traffic = ok(seo?.traffic), ranks = ok(seo?.rankings), biz = ok(seo?.business), ai = ok(seo?.aiVisibility), adsData = ok(ads?.ads);
    const positions = (ranks?.keywords || []).map((k) => k.position).filter((p): p is number => typeof p === "number" && p > 0);
    const prevPositions = (ranks?.keywords || []).map((k) => k.previousPosition).filter((p): p is number => typeof p === "number" && p > 0);
    const chatgpt = ai?.platforms.find((p) => p.platform === "chatgpt");
    const leadsNow = seo?.attribution.status === "ok" ? Object.values(seo.attribution.data!.allChannels || {}).reduce((a, b) => a + (Number(b) || 0), 0) : null;
    const [meta, gsc, trustpilot] = await Promise.all([metaFor([clientId]), searchConsoleFor(clientId), trustpilotFor(clientId)]);
    // Latest ChatGPT answer per question (last 60 days) for the "Where you show up" drop-down.
    const aiQuestions = await (async () => {
      try {
        const since = new Date(Date.now() - 60 * 86400_000).toISOString();
        const rows = (await db.prepare("SELECT prompt, mentioned, position, competitors_json, created_at FROM ai_visibility_tests WHERE owner_id = ?1 AND client_id = ?2 AND platform = 'chatgpt' AND error IS NULL AND created_at >= ?3 ORDER BY created_at DESC LIMIT 200").bind(ownerId, clientId, since).all<{ prompt: string; mentioned: number; position: number | null; competitors_json: string; created_at: string }>()).results || [];
        const seen = new Set<string>(); const out: Array<{ prompt: string; mentioned: boolean; position: number | null; competitors: string[]; at: string }> = [];
        for (const r of rows) { const key = r.prompt.trim().toLowerCase(); if (seen.has(key)) continue; seen.add(key); let comps: string[] = []; try { const v = JSON.parse(r.competitors_json || "[]"); comps = (Array.isArray(v) ? v : []).map((c: unknown) => typeof c === "string" ? c : String((c as { name?: string })?.name || "")).filter(Boolean).slice(0, 4); } catch { /* ignore */ } out.push({ prompt: r.prompt.slice(0, 240), mentioned: Boolean(r.mentioned), position: r.position ?? null, competitors: comps, at: r.created_at }); if (out.length >= 20) break; }
        return out;
      } catch { return []; }
    })();
    // Paid vs organic split: leads by channel from CRM attribution, ad calls from Google Ads.
    const channels = seo?.attribution.status === "ok" ? seo.attribution.data!.allChannels as Record<string, number> : null;
    const accountId = String((workspace.clients || []).find((c) => c.id === clientId)?.googleAdsAccountId || "").replace(/\D/g, "");
    const adCalls = accountId ? await getGoogleAdsCallStats(ownerId, accountId, period).catch(() => null) : null;
    // Landing pages and keywords behind the Google Ads card's drop-down (cached 6h, one Ads read each).
    const adsDetail = accountId ? await (async () => {
      const cache = <T,>(key: string, load: () => Promise<T>) => loadCachedMarketingData({ db: db as never, ownerId, clientId, service: "Google Ads", key: JSON.stringify({ report: key, accountId, a: period.start, b: period.end }), ttlMs: 6 * 3600_000 }, load).then((r) => r.data);
      const [pages, kws] = await Promise.all([
        cache("dash-ads-pages", () => getGoogleAdsLandingPages(ownerId, accountId, period)).catch(() => null),
        cache("dash-ads-keywords", () => getGoogleAdsKeywordPerformance(ownerId, accountId, undefined, { startDate: period.start, endDate: period.end }).then((r) => r.keywords)).catch(() => null),
      ]);
      return {
        landingPages: (pages || []).slice(0, 60),
        keywords: (kws || []).slice(0, 80).map((k) => ({ campaignId: k.campaignId, keyword: k.keyword, matchType: k.matchType, clicks: k.clicks, impressions: k.impressions, spend: k.spend, conversions: k.conversions, qualityScore: k.qualityScore })),
        error: pages == null && kws == null ? "Google Ads didn’t return landing pages or keywords." : "",
      };
    })() : null;
    const split = {
      organic: { clicks: traffic && /click/i.test(traffic.metric) ? traffic.current : null, visits: traffic && !/click/i.test(traffic.metric) ? traffic.current : null, calls: biz?.calls ?? null, leads: channels ? Number(channels.seo || 0) : null },
      paid: { clicks: adsData ? adsData.current.clicks : null, calls: adCalls ? (adCalls.calls ?? null) : null, callConversions: adCalls?.callConversions ?? null, leads: channels ? Number(channels.google_ads || 0) : null, conversions: adsData ? adsData.current.conversions : null },
      otherLeads: channels ? Number(channels.other || 0) + Number(channels.unknown || 0) : null,
      notes: { organic: why(seo?.traffic) || (biz ? "" : why(seo?.business)), paid: accountId ? why(ads?.ads) : "No Google Ads account linked" },
    };
    return {
      ...meta, split, gsc, trustpilot, adsDetail, businessProfile: biz ? { views: biz.impressions, calls: biz.calls, directions: biz.directions, websiteClicks: biz.websiteClicks, previous: biz.previous } : null,
      googleCampaigns: adsData ? adsData.campaigns.slice(0, 40).map((c) => ({ id: c.id, name: c.name, status: c.status, spend: c.spend, clicks: c.clicks, impressions: c.impressions, conversions: c.conversions })) : [],
      currency: seo?.client.currency || ads?.client.currency || "EUR",
      visits: traffic ? { value: traffic.current, previous: traffic.previous, metric: traffic.metric } : null, visitsNote: why(seo?.traffic),
      ...adsBlock(adsData ? adsData.current : null, adsData?.previous || null), adsNote: why(ads?.ads),
      calls: biz && biz.calls != null ? { value: biz.calls, previous: biz.previous?.calls ?? null } : null,
      profileClicks: biz && biz.websiteClicks != null ? { value: biz.websiteClicks, previous: biz.previous?.websiteClicks ?? null } : null, businessNote: why(seo?.business),
      leads: leadsNow != null ? { value: leadsNow, previous: null } : null,
      google: positions.length ? { position: avg(positions), previous: avg(prevPositions), tracked: positions.length, top3: positions.filter((p) => p <= 3).length, keywords: (ranks?.keywords || []).map((k) => ({ keyword: k.keyword, position: k.position, previous: k.previousPosition, volume: k.volume })) } : null, rankNote: why(seo?.rankings) || (ranks && !positions.length ? "No ranking checks yet" : ""),
      chatgpt: chatgpt ? { share: chatgpt.share, previous: chatgpt.previousShare, prompts: chatgpt.prompts, mentioned: chatgpt.mentioned, questions: aiQuestions } : null, aiNote: why(seo?.aiVisibility),
      bing: null, bingNote: "Bing rank tracking isn’t set up yet",
    };
  };
  const appointments = async () => {
    try {
      const from = new Date(); from.setHours(0, 0, 0, 0);
      const [list, cals] = await Promise.all([listBookings(db as never, ownerId, scope, from.toISOString(), new Date(Date.now() + 32 * 86_400_000).toISOString()), listCalendars(db as never, ownerId, scope).catch(() => [])]);
      const staffName = new Map((workspace.staff || []).map((s) => [s.id, String((s as { name?: string }).name || "")]));
      return list.filter((b) => !/cancel/i.test(b.status)).slice(0, 80).map((b) => ({ id: b.id, name: b.name, start: b.start, end: b.end, status: b.status, clientId: b.clientId, channel: b.channel, meetLink: b.meetLink, calendar: (cals as Array<{ id: string; name: string }>).find((c) => c.id === b.calendarId)?.name || "", staff: b.staffIds.map((id) => staffName.get(id) || "").filter(Boolean).join(", ") }));
    } catch { return []; }
  };
  const emails = async () => {
    try {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const where = scope === null ? "" : " AND t.client_id=?3";
      const bind = scope === null ? [ownerId, since] : [ownerId, since, scope];
      const recent = (await db.prepare(`SELECT m.body, m.created_at, m.error, t.contact, t.contact_name FROM conv_messages m JOIN conv_threads t ON t.id=m.thread_id WHERE m.owner_id=?1 AND t.channel='email' AND m.direction='out' AND m.created_at>=?2${where} ORDER BY m.created_at DESC LIMIT 6`).bind(...bind).all<{ body: string; created_at: string; error: string; contact: string; contact_name: string }>()).results || [];
      const stats = await db.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN COALESCE(m.error,'')<>'' THEN 1 ELSE 0 END) AS failed, COUNT(DISTINCT t.contact) AS people, MAX(m.created_at) AS last FROM conv_messages m JOIN conv_threads t ON t.id=m.thread_id WHERE m.owner_id=?1 AND t.channel='email' AND m.direction='out' AND m.created_at>=?2${where}`).bind(...bind).first<{ n: number; failed: number; people: number; last: string }>();
      const replies = (await db.prepare(`SELECT COUNT(*) AS n FROM conv_messages m JOIN conv_threads t ON t.id=m.thread_id WHERE m.owner_id=?1 AND t.channel='email' AND m.direction='in' AND m.created_at>=?2${where}`).bind(...bind).first<{ n: number }>())?.n || 0;
      const total = Number(stats?.n || 0), failed = Number(stats?.failed || 0);
      return { total, failed, delivered: total - failed, people: Number(stats?.people || 0), replies, last: stats?.last || "", configured: Boolean((env as unknown as Record<string, unknown>).RESEND_API_KEY), recent: recent.map((r) => ({ to: r.contact_name || r.contact, subject: (r.body.split("\n")[0] || "").replace(/^subject:\s*/i, "").slice(0, 90), at: r.created_at, failed: Boolean(r.error) })) };
    } catch { return { total: 0, failed: 0, delivered: 0, people: 0, replies: 0, last: "", configured: false, recent: [] }; }
  };
  const [m, a, e] = await Promise.all([marketing(), appointments(), emails()]);
  return reply({ clientId, marketing: m, appointments: a, emails: e });
}
