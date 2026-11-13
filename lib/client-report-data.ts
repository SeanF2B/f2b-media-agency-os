// Data for the visual SEO and Google Ads client reports. Real data only:
//  - Ads / Search Console readers are shared with Report Studio (lib/report-sources), cached 6h.
//  - GA4 organic sessions read directly (Analytics scope on the Google login), cached 6h.
//  - Leads, qualified leads, pipeline value (estimate) and won revenue (actual) come from the CRM,
//    attributed per contact to ONE channel (lib/lead-attribution) so SEO and Ads never double-count.
//  - Rankings, backlinks, competitors and AI visibility come only from recorded checks.
// Anything missing is returned as { status: "unavailable" | "not_connected", note } — never zero.
import { classifyLeadChannel, type LeadChannel } from "./lead-attribution";
import { googleAds, searchConsole, summarizeGoogleAds, summarizeSearchConsole } from "./report-sources";
import { loadCachedMarketingData } from "./marketing-data-history";
import { hasGoogleAnalyticsDirectConnection, readGoogleAnalyticsReport } from "./google-analytics-direct";
import { completedTasksForReport, previousReportWindow } from "./report-evidence";
import { clientWebsite } from "./client-website";

export type ReportType = "seo" | "ads";
type Window = { start: string; end: string };
type Status = "ok" | "unavailable" | "not_connected";
export type Section<T> = { status: Status; note?: string; source?: string; updatedAt?: string; data?: T };
type Client = { id: string; name: string; company?: string; logo?: string; color?: string; currency?: string; branding?: { primary?: string }; googleAdsAccountId?: string; googleSearchConsoleAccountId?: string; googleAnalyticsAccountId?: string; googleBusinessProfileLocationId?: string; website?: string; wordpressSiteUrl?: string; email?: string; services?: Array<{ name?: string }> };
type Task = { id: string; clientId?: string; status?: string; title?: string; service?: string; due?: string; dueAt?: string; notes?: string; completedAt?: string; aiReviewedAt?: string; reviewDecidedAt?: string; aiFeedback?: string; note?: string };
type Workspace = { ownerId?: string; clients?: Client[]; tasks?: Task[]; activity?: Array<{ kind?: string; title?: string; taskId?: string; at?: string; clientId?: string }> };

const CACHE_TTL = 6 * 3_600_000;
const n = (value: unknown) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; };
const ok = <T,>(data: T, source: string, updatedAt: string, note?: string): Section<T> => ({ status: "ok", data, source, updatedAt, ...(note ? { note } : {}) });
const off = <T,>(status: Exclude<Status, "ok">, note: string): Section<T> => ({ status, note });
const monthKey = (iso: string) => iso.slice(0, 7);
const addMonths = (date: string, months: number) => { const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + months); return d.toISOString().slice(0, 10); };

/* ---------------------------------------------------------------- CRM attribution */
type Opp = { id: string; contact_id: string | null; value: number; source: string; created_at: string; stage_id: string; pipeline_id: string; stage_name: string; category: string; position: number };
type Touch = { contact_id: string; channel: LeadChannel; utm_campaign: string; created_at: string };
export type ChannelTotals = { leads: number; qualified: number; pipelineValue: number; pipelineEstimated: boolean; wonRevenue: number; wonDeals: number; byCampaign: Array<{ campaign: string; leads: number; qualified: number; wonRevenue: number }> };
export type Attribution = { channel: LeadChannel; current: ChannelTotals; previous: ChannelTotals; trend: Array<{ month: string; leads: number; qualified: number; wonRevenue: number }>; allChannels: Record<LeadChannel, number>; unknownShare: number; qualifiedRule: string };

async function crmAttribution(db: D1Database, ownerId: string, clientId: string, channel: LeadChannel, current: Window, previous: Window): Promise<Section<Attribution>> {
  const trendStart = addMonths(current.end, -5);
  const since = [previous.start, trendStart].sort()[0];
  const until = `${current.end}T23:59:59.999Z`;
  const [oppRows, touchRows] = await db.batch([
    db.prepare("SELECT o.id, o.contact_id, o.value, o.source, o.created_at, o.stage_id, o.pipeline_id, s.name AS stage_name, s.category, s.position FROM crm_opportunities o JOIN crm_pipeline_stages s ON s.id = o.stage_id AND s.owner_id = o.owner_id WHERE o.owner_id = ?1 AND o.client_id = ?2 AND o.created_at >= ?3 AND o.created_at <= ?4").bind(ownerId, clientId, since, until),
    db.prepare("SELECT contact_id, channel, utm_campaign, created_at FROM form_submission_log WHERE owner_id = ?1 AND client_id = ?2 AND created_at >= ?3 AND created_at <= ?4 ORDER BY created_at").bind(ownerId, clientId, since, until),
  ]);
  const opps = (oppRows.results || []) as Opp[];
  const touches = (touchRows.results || []) as Touch[];
  const pipelines = [...new Set(opps.map((opp) => opp.pipeline_id))];
  const stageRows = pipelines.length ? ((await db.prepare(`SELECT pipeline_id, name, position FROM crm_pipeline_stages WHERE owner_id = ?1 AND pipeline_id IN (${pipelines.map((_, i) => `?${i + 2}`).join(",")})`).bind(ownerId, ...pipelines).all<{ pipeline_id: string; name: string; position: number }>()).results || []) : [];
  const qualifiedAt = new Map<string, number>();
  for (const stage of stageRows) if (/qualif/i.test(stage.name)) qualifiedAt.set(stage.pipeline_id, Math.min(qualifiedAt.get(stage.pipeline_id) ?? Infinity, n(stage.position)));
  const isQualified = (opp: Opp) => opp.category === "won" || (opp.category !== "lost" && qualifiedAt.has(opp.pipeline_id) && n(opp.position) >= qualifiedAt.get(opp.pipeline_id)!);

  // One channel per contact: first known form touch, else the CRM source text on their card.
  const contactChannel = new Map<string, { channel: LeadChannel; campaign: string }>();
  for (const touch of touches) if (touch.contact_id && !contactChannel.has(touch.contact_id) && touch.channel && touch.channel !== "unknown") contactChannel.set(touch.contact_id, { channel: touch.channel, campaign: touch.utm_campaign || "" });
  type Lead = { key: string; at: string; channel: LeadChannel; campaign: string; opps: Opp[] };
  const leads = new Map<string, Lead>();
  const leadFor = (key: string, at: string) => { const lead = leads.get(key) || { key, at, channel: "unknown" as LeadChannel, campaign: "", opps: [] }; if (at < lead.at) lead.at = at; leads.set(key, lead); return lead; };
  for (const touch of touches) leadFor(touch.contact_id || `touch:${touch.created_at}`, touch.created_at);
  for (const opp of opps) leadFor(opp.contact_id || `opp:${opp.id}`, opp.created_at).opps.push(opp);
  for (const lead of leads.values()) {
    const known = contactChannel.get(lead.key);
    const fromCrm = lead.opps.map((opp) => classifyLeadChannel({ crmSource: opp.source })).find((value) => value !== "unknown" && value !== "other");
    lead.channel = known?.channel || fromCrm || "unknown";
    lead.campaign = known?.campaign || "";
  }
  const all = [...leads.values()];
  const totals = (window: Window): ChannelTotals => {
    const inWindow = all.filter((lead) => lead.at.slice(0, 10) >= window.start && lead.at.slice(0, 10) <= window.end && lead.channel === channel);
    const campaigns = new Map<string, { campaign: string; leads: number; qualified: number; wonRevenue: number }>();
    let qualified = 0, pipelineValue = 0, wonRevenue = 0, wonDeals = 0;
    for (const lead of inWindow) {
      const q = lead.opps.some(isQualified); if (q) qualified++;
      const won = lead.opps.filter((opp) => opp.category === "won");
      wonRevenue += won.reduce((sum, opp) => sum + n(opp.value), 0); wonDeals += won.length;
      pipelineValue += lead.opps.filter((opp) => opp.category !== "won" && opp.category !== "lost").reduce((sum, opp) => sum + n(opp.value), 0);
      const name = lead.campaign || "Not matched to a campaign";
      const row = campaigns.get(name) || { campaign: name, leads: 0, qualified: 0, wonRevenue: 0 };
      row.leads++; if (q) row.qualified++; row.wonRevenue += won.reduce((sum, opp) => sum + n(opp.value), 0); campaigns.set(name, row);
    }
    return { leads: inWindow.length, qualified, pipelineValue, pipelineEstimated: true, wonRevenue, wonDeals, byCampaign: [...campaigns.values()].sort((a, b) => b.leads - a.leads) };
  };
  const trend: Attribution["trend"] = [];
  for (let i = 5; i >= 0; i--) {
    const month = monthKey(addMonths(current.end, -i));
    const inMonth = all.filter((lead) => monthKey(lead.at) === month && lead.channel === channel);
    trend.push({ month, leads: inMonth.length, qualified: inMonth.filter((lead) => lead.opps.some(isQualified)).length, wonRevenue: inMonth.reduce((sum, lead) => sum + lead.opps.filter((opp) => opp.category === "won").reduce((total, opp) => total + n(opp.value), 0), 0) });
  }
  const periodLeads = all.filter((lead) => lead.at.slice(0, 10) >= current.start && lead.at.slice(0, 10) <= current.end);
  const allChannels = { google_ads: 0, seo: 0, other: 0, unknown: 0 } as Record<LeadChannel, number>;
  for (const lead of periodLeads) allChannels[lead.channel]++;
  const qualifiedRule = qualifiedAt.size ? "Qualified = reached the Qualified stage or later (including Won; Lost excluded)." : "No pipeline stage named Qualified was found, so only Won deals count as qualified.";
  return ok({ channel, current: totals(current), previous: totals(previous), trend, allChannels, unknownShare: periodLeads.length ? allChannels.unknown / periodLeads.length : 0, qualifiedRule }, "Agency OS CRM (form submissions, contacts and pipeline)", new Date().toISOString());
}

/* ---------------------------------------------------------------- Google Ads */
export type AdsTotals = { spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number; ctrPercent: number; averageCpc: number | null; costPerConversion: number | null };
export type AdsData = { accountId: string; current: AdsTotals; previous: AdsTotals | null; campaigns: Array<AdsTotals & { id: string; name: string; status: string }>; monthly: Array<{ month: string; spend: number; clicks: number; conversions: number }> };

async function adsData(db: D1Database, ownerId: string, client: Client, current: Window, previous: Window): Promise<Section<AdsData>> {
  const accountId = String(client.googleAdsAccountId || "").replace(/\D/g, "");
  if (!accountId) return off("not_connected", "No Google Ads account is linked to this client. Add the customer ID on the client record.");
  const load = async (window: Window) => loadCachedMarketingData({ db, ownerId, clientId: client.id, service: "Google Ads", key: JSON.stringify({ report: "visual-ads", accountId, ...window }), ttlMs: CACHE_TTL }, () => googleAds(accountId, window, ownerId));
  try {
    const trendWindow = { start: addMonths(current.end, -5), end: current.end };
    const [cur, prev, trend] = await Promise.all([load(current), load(previous).catch(() => null), load(trendWindow).catch(() => null)]);
    if (!cur.data.rows.length) return off("unavailable", "Google Ads returned no rows for this period. This does not prove zero spend.");
    const summary = summarizeGoogleAds(cur.data.rows, accountId, cur.data.source);
    const previousSummary = prev?.data.rows.length ? summarizeGoogleAds(prev.data.rows, accountId, prev.data.source) : null;
    const months = new Map<string, { month: string; spend: number; clicks: number; conversions: number }>();
    for (const row of trend?.data.rows || []) { const month = monthKey(String(row.date || "")); if (!month) continue; const m = months.get(month) || { month, spend: 0, clicks: 0, conversions: 0 }; m.spend += n(row.spend); m.clicks += n(row.clicks); m.conversions += n(row.conversions); months.set(month, m); }
    return ok({ accountId, current: summary.totals as AdsTotals, previous: (previousSummary?.totals as AdsTotals) || null, campaigns: summary.campaigns as AdsData["campaigns"], monthly: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)) }, cur.data.source, cur.fetchedAt, cur.cacheHit ? "Cached Google Ads result (refreshes every 6 hours)." : undefined);
  } catch (error) { return off("unavailable", error instanceof Error ? error.message : "Google Ads data could not be loaded."); }
}

/* ---------------------------------------------------------------- SEO sources */
export type TrafficData = { metric: string; current: number; previous: number | null; daily: Array<{ date: string; value: number; previous: number | null }> };
async function organicTraffic(db: D1Database, ownerId: string, client: Client, current: Window, previous: Window): Promise<Section<TrafficData>> {
  const ga4 = String(client.googleAnalyticsAccountId || "").trim();
  const days = (rows: Array<{ date: string; value: number }>, window: Window) => { const map = new Map(rows.map((row) => [row.date, row.value])); const out: Array<{ date: string; value: number }> = []; for (let d = new Date(`${window.start}T00:00:00Z`); d.toISOString().slice(0, 10) <= window.end; d.setUTCDate(d.getUTCDate() + 1)) { const key = d.toISOString().slice(0, 10); out.push({ date: key, value: map.get(key) || 0 }); } return out; };
  const merge = (cur: Array<{ date: string; value: number }>, prev: Array<{ date: string; value: number }> | null) => cur.map((row, index) => ({ ...row, previous: prev ? prev[index]?.value ?? null : null }));
  if (ga4 && await hasGoogleAnalyticsDirectConnection(ownerId)) {
    try {
      const read = (window: Window) => loadCachedMarketingData({ db, ownerId, clientId: client.id, service: "GA4", key: JSON.stringify({ report: "visual-seo-organic", ga4, ...window }), ttlMs: CACHE_TTL }, async () => {
        const rows = await readGoogleAnalyticsReport(ownerId, ga4, window.start, window.end, ["date", "sessionDefaultChannelGroup"], ["sessions"]);
        return rows.filter((row) => /organic search/i.test(String(row.sessionDefaultChannelGroup || ""))).map((row) => { const raw = String(row.date || ""); return { date: /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : raw, value: n(row.sessions) }; });
      });
      const [cur, prev] = await Promise.all([read(current), read(previous).catch(() => null)]);
      const curDays = days(cur.data, current), prevDays = prev ? days(prev.data, previous) : null;
      return ok({ metric: "Organic sessions (GA4 · Organic Search)", current: curDays.reduce((s, r) => s + r.value, 0), previous: prevDays ? prevDays.reduce((s, r) => s + r.value, 0) : null, daily: merge(curDays, prevDays) }, "Google Analytics 4 Data API · read-only", cur.fetchedAt);
    } catch (error) { if (!client.googleSearchConsoleAccountId) return off("unavailable", error instanceof Error ? error.message : "GA4 organic sessions could not be loaded."); }
  }
  if (client.googleSearchConsoleAccountId) {
    try {
      const site = String(client.googleSearchConsoleAccountId);
      const read = (window: Window) => loadCachedMarketingData({ db, ownerId, clientId: client.id, service: "Search Console", key: JSON.stringify({ report: "visual-seo-gsc", site, ...window }), ttlMs: CACHE_TTL }, () => searchConsole(site, window, ownerId));
      const [cur, prev] = await Promise.all([read(current), read(previous).catch(() => null)]);
      const byDay = (rows: Array<Record<string, unknown>>) => { const map = new Map<string, number>(); for (const row of rows) { const d = String(row.date || ""); if (d) map.set(d, (map.get(d) || 0) + n(row.clicks)); } return [...map.entries()].map(([date, value]) => ({ date, value })); };
      const curDays = days(byDay(cur.data.rows), current), prevDays = prev ? days(byDay(prev.data.rows), previous) : null;
      return ok({ metric: "Organic clicks from Google (Search Console)", current: curDays.reduce((s, r) => s + r.value, 0), previous: prevDays ? prevDays.reduce((s, r) => s + r.value, 0) : null, daily: merge(curDays, prevDays) }, cur.data.source, cur.fetchedAt, "Search Console data lags 2–3 days.");
    } catch (error) { return off("unavailable", error instanceof Error ? error.message : "Search Console data could not be loaded."); }
  }
  return off("not_connected", "Link this client's GA4 property or Search Console property to show organic traffic.");
}

export type KeywordRow = { keyword: string; volume: number | null; position: number | null; previousPosition: number | null; change: number | null };
export type RankingsData = { tracked: number; buckets: Array<{ label: string; count: number; change: number | null }>; keywords: KeywordRow[]; basis: string };
async function rankings(db: D1Database, ownerId: string, client: Client, current: Window, previous: Window): Promise<Section<RankingsData>> {
  // 1) DataForSEO rank tracking (recorded daily checks) — real Google positions.
  try {
    const kw = await db.prepare("SELECT id, keyword FROM seo_rank_keywords WHERE owner_id = ?1 AND client_id = ?2").bind(ownerId, client.id).all<{ id: string; keyword: string }>();
    const list = kw.results || [];
    if (list.length) {
      const checks = await db.prepare(`SELECT keyword_id, checked_at, position FROM seo_rank_checks WHERE owner_id = ?1 AND keyword_id IN (${list.map((_, i) => `?${i + 2}`).join(",")}) AND checked_at <= ?${list.length + 2} AND error IS NULL ORDER BY checked_at DESC LIMIT 3000`).bind(ownerId, ...list.map((row) => row.id), `${current.end}T23:59:59Z`).all<{ keyword_id: string; checked_at: string; position: number | null }>();
      const rows = checks.results || [];
      if (rows.length) {
        const latest = (id: string, upTo: string) => rows.find((row) => row.keyword_id === id && row.checked_at.slice(0, 10) <= upTo);
        const volumes = await keywordVolumes(db, ownerId, client.id);
        const keywords = list.map((item) => { const now = latest(item.id, current.end), then = latest(item.id, previous.end); const position = now?.position ?? null, previousPosition = then?.position ?? null; return { keyword: item.keyword, volume: volumes.get(item.keyword.toLowerCase()) ?? null, position, previousPosition, change: position != null && previousPosition != null ? previousPosition - position : null }; });
        const updatedAt = rows[0].checked_at;
        return ok({ tracked: list.length, buckets: buckets(keywords), keywords: keywords.sort((a, b) => (a.position ?? 999) - (b.position ?? 999)).slice(0, 12), basis: "Google positions from daily DataForSEO rank checks" }, "DataForSEO rank tracking", updatedAt);
      }
    }
  } catch { /* table may not exist until rank tracking is first used */ }
  // 2) Search Console average positions (real Google data, impression-weighted).
  const site = String(client.googleSearchConsoleAccountId || "");
  if (site) {
    try {
      const read = (window: Window) => loadCachedMarketingData({ db, ownerId, clientId: client.id, service: "Search Console", key: JSON.stringify({ report: "visual-seo-gsc", site, ...window }), ttlMs: CACHE_TTL }, () => searchConsole(site, window, ownerId));
      const [cur, prev] = await Promise.all([read(current), read(previous).catch(() => null)]);
      const curQ = summarizeSearchConsole(cur.data.rows, site, cur.data.source).topQueries;
      const prevQ = new Map((prev ? summarizeSearchConsole(prev.data.rows, site, prev.data.source).topQueries : []).map((row) => [row.name, row.averagePosition]));
      const volumes = await keywordVolumes(db, ownerId, client.id);
      const keywords = curQ.filter((row) => row.name !== "(not provided)").slice(0, 30).map((row) => { const position = row.averagePosition != null ? Math.round(row.averagePosition * 10) / 10 : null, previousPosition = prevQ.get(row.name) != null ? Math.round(prevQ.get(row.name)! * 10) / 10 : null; return { keyword: row.name, volume: volumes.get(row.name.toLowerCase()) ?? null, position, previousPosition, change: position != null && previousPosition != null ? Math.round((previousPosition - position) * 10) / 10 : null }; });
      if (keywords.length) return ok({ tracked: keywords.length, buckets: buckets(keywords), keywords: keywords.slice(0, 12), basis: "Average Google position from Search Console (top queries by clicks)" }, cur.data.source, cur.fetchedAt);
    } catch (error) { return off("unavailable", error instanceof Error ? error.message : "Rankings could not be loaded."); }
  }
  return off("not_connected", "No rankings recorded. Connect DataForSEO and add rank-tracking keywords, or link Search Console.");
}
function buckets(rows: KeywordRow[]) {
  const defs: Array<[string, (p: number) => boolean]> = [["Top 3", (p) => p <= 3], ["Positions 4 – 10", (p) => p > 3 && p <= 10], ["Positions 11 – 20", (p) => p > 10 && p <= 20], ["Positions 21+", (p) => p > 20]];
  const hasPrev = rows.some((row) => row.previousPosition != null);
  return defs.map(([label, test]) => ({ label, count: rows.filter((row) => row.position != null && test(row.position)).length, change: hasPrev ? rows.filter((row) => row.position != null && test(row.position)).length - rows.filter((row) => row.previousPosition != null && test(row.previousPosition)).length : null }));
}
async function keywordVolumes(db: D1Database, ownerId: string, clientId: string) {
  const map = new Map<string, number>();
  try {
    const row = await db.prepare("SELECT results_json FROM seo_keyword_research_runs WHERE owner_id = ?1 AND client_id = ?2 ORDER BY created_at DESC LIMIT 1").bind(ownerId, clientId).first<{ results_json: string }>();
    for (const item of (JSON.parse(row?.results_json || "[]") as Array<{ keyword?: string; avgMonthlySearches?: number | null }>)) if (item.keyword && item.avgMonthlySearches != null) map.set(item.keyword.toLowerCase(), n(item.avgMonthlySearches));
  } catch { /* no research yet */ }
  return map;
}

export type BacklinkData = { target: string; backlinks: number | null; referringDomains: number | null; previous: { backlinks: number | null; referringDomains: number | null; checkedAt: string } | null; history: Array<{ date: string; backlinks: number | null }> };
async function backlinks(db: D1Database, ownerId: string, client: Client, current: Window, previous: Window): Promise<Section<BacklinkData>> {
  try {
    const rows = ((await db.prepare("SELECT target, created_at, result_json FROM seo_backlink_snapshots WHERE owner_id = ?1 AND client_id = ?2 AND created_at <= ?3 ORDER BY created_at DESC LIMIT 12").bind(ownerId, client.id, `${current.end}T23:59:59Z`).all<{ target: string; created_at: string; result_json: string }>()).results || []);
    const summary = (raw: string) => { try { const parsed = JSON.parse(raw) as Record<string, unknown>; const s = (parsed.summary || parsed) as { backlinks?: number | null; referringDomains?: number | null }; return { backlinks: s.backlinks ?? null, referringDomains: s.referringDomains ?? null }; } catch { return { backlinks: null, referringDomains: null }; } };
    if (!rows.length) return off("not_connected", "No backlink check recorded yet. Connect DataForSEO and run a backlink check.");
    const latest = rows[0], latestSummary = summary(latest.result_json);
    const prior = rows.find((row) => row.target === latest.target && row.created_at.slice(0, 10) <= previous.end);
    return ok({ target: latest.target, ...latestSummary, previous: prior ? { ...summary(prior.result_json), checkedAt: prior.created_at } : null, history: rows.filter((row) => row.target === latest.target).reverse().map((row) => ({ date: row.created_at.slice(0, 10), backlinks: summary(row.result_json).backlinks })) }, "DataForSEO backlink index", latest.created_at);
  } catch { return off("not_connected", "No backlink check recorded yet."); }
}

export type CompetitorData = { clientDomain: string; competitors: Array<{ domain: string; gapKeywords: number | null; topGaps: string[] }> };
async function competitors(db: D1Database, ownerId: string, client: Client, current: Window): Promise<Section<CompetitorData>> {
  try {
    const row = await db.prepare("SELECT created_at, client_domain, competitors_json FROM seo_competitor_keyword_research_runs WHERE owner_id = ?1 AND client_id = ?2 AND created_at <= ?3 ORDER BY created_at DESC LIMIT 1").bind(ownerId, client.id, `${current.end}T23:59:59Z`).first<{ created_at: string; client_domain: string; competitors_json: string }>();
    if (!row) return off("not_connected", "No competitor comparison recorded yet. Run one in SEO & competitors.");
    const list = (JSON.parse(row.competitors_json) as Array<{ competitorDomain: string; status: string; totalCount: number | null; keywords?: Array<{ keyword: string; monthlySearches: number | null }> }>);
    return ok({ clientDomain: row.client_domain, competitors: list.map((item) => ({ domain: item.competitorDomain, gapKeywords: item.status === "connected" ? item.totalCount : null, topGaps: (item.keywords || []).sort((a, b) => n(b.monthlySearches) - n(a.monthlySearches)).slice(0, 3).map((k) => k.keyword) })) }, "DataForSEO competitor keyword gaps", row.created_at);
  } catch { return off("not_connected", "No competitor comparison recorded yet."); }
}

export type BusinessData = { locationName: string; impressions: number | null; calls: number | null; directions: number | null; websiteClicks: number | null; previous: { impressions: number | null; calls: number | null; directions: number | null; websiteClicks: number | null } | null; windowNote: string };
async function business(db: D1Database, ownerId: string, client: Client, current: Window, previous: Window): Promise<Section<BusinessData>> {
  if (!client.googleBusinessProfileLocationId) return off("not_connected", "No Google Business Profile location is linked to this client.");
  const rows = ((await db.prepare("SELECT snapshot_date, fetched_at, payload_json FROM marketing_metric_snapshots WHERE owner_id = ?1 AND client_id = ?2 AND service = 'Google Business Profile' AND status = 'connected' AND snapshot_date <= ?3 ORDER BY snapshot_date DESC LIMIT 60").bind(ownerId, client.id, current.end).all<{ snapshot_date: string; fetched_at: string; payload_json: string }>()).results || []);
  const read = (row?: { payload_json: string }) => { try { const c = (JSON.parse(row?.payload_json || "{}").current || {}) as Record<string, unknown>; return { locationName: String(c.locationName || ""), impressions: c.impressions as number | null ?? null, calls: c.calls as number | null ?? null, directions: c.directions as number | null ?? null, websiteClicks: c.websiteClicks as number | null ?? null }; } catch { return null; } };
  const latest = rows[0];
  if (!latest) return off("unavailable", "No Google Business Profile data synced for this period yet.");
  const prior = rows.find((row) => row.snapshot_date <= previous.end);
  const now = read(latest)!, then = prior ? read(prior) : null;
  return ok({ ...now, previous: then ? { impressions: then.impressions, calls: then.calls, directions: then.directions, websiteClicks: then.websiteClicks } : null, windowNote: `30 days to ${latest.snapshot_date}` }, "Google Business Profile performance (Windsor daily sync)", latest.fetched_at, "Rating, reviews and posts are not available from the current connection.");
}

export type AiVisibilityData = { platforms: Array<{ platform: "chatgpt" | "claude"; prompts: number; mentioned: number; share: number; previousShare: number | null }>; overall: number; previousOverall: number | null; lastRun: string };
async function aiVisibility(db: D1Database, ownerId: string, client: Client, current: Window, previous: Window): Promise<Section<AiVisibilityData>> {
  try {
    const rows = ((await db.prepare("SELECT created_at, platform, mentioned, error FROM ai_visibility_tests WHERE owner_id = ?1 AND client_id = ?2 AND created_at >= ?3 AND created_at <= ?4").bind(ownerId, client.id, `${previous.start}T00:00:00Z`, `${current.end}T23:59:59Z`).all<{ created_at: string; platform: string; mentioned: number; error: string | null }>()).results || []).filter((row) => !row.error);
    const inWin = (window: Window) => rows.filter((row) => row.created_at.slice(0, 10) >= window.start && row.created_at.slice(0, 10) <= window.end);
    const cur = inWin(current), prev = inWin(previous);
    if (!cur.length) return off("not_connected", "No ChatGPT or Claude visibility tests were recorded in this period. Run one in Operations → AI visibility.");
    const share = (list: typeof rows) => list.length ? list.filter((row) => row.mentioned).length / list.length : null;
    const platforms = (["chatgpt", "claude"] as const).map((platform) => { const c = cur.filter((row) => row.platform === platform), p = prev.filter((row) => row.platform === platform); return { platform, prompts: c.length, mentioned: c.filter((row) => row.mentioned).length, share: share(c) ?? 0, previousShare: share(p) }; }).filter((row) => row.prompts);
    return ok({ platforms, overall: share(cur) ?? 0, previousOverall: share(prev), lastRun: cur.map((row) => row.created_at).sort().pop() || "" }, "Recorded AI visibility tests (ChatGPT and Claude APIs)", cur.map((row) => row.created_at).sort().pop() || "", "Sampled API answers vary between runs; this is the share of recorded test prompts that mentioned the business.");
  } catch { return off("not_connected", "No AI visibility tests recorded yet."); }
}

/* ---------------------------------------------------------------- work & recommendations */
const SERVICE_TEST: Record<ReportType, RegExp> = { seo: /seo|website|content|blog|google business|gbp|local|backlink|technical|page/i, ads: /google ads|ppc|ads|campaign|ad copy|keyword/i };
function work(workspace: Workspace, client: Client, type: ReportType, current: Window) {
  const done = completedTasksForReport((workspace.tasks || []) as never[], (workspace.activity || []) as never[], client.id, current.start, current.end).tasks as Array<{ title: string; service: string; completedAt: string }>;
  const completed = done.filter((task) => SERVICE_TEST[type].test(`${task.service} ${task.title}`) && !(type === "seo" && /google ads/i.test(task.service))).slice(0, 8);
  const planned = (workspace.tasks || []).filter((task) => task.clientId === client.id && task.status !== "Done" && SERVICE_TEST[type].test(`${task.service || ""} ${task.title || ""}`) && !(type === "seo" && /google ads/i.test(task.service || ""))).sort((a, b) => String(a.dueAt || a.due || "9").localeCompare(String(b.dueAt || b.due || "9"))).slice(0, 5).map((task) => String(task.title || "Planned task"));
  return { completed: completed.map((task) => ({ title: task.title, completedAt: task.completedAt })), planned };
}

/* ---------------------------------------------------------------- build */
export type ClientReport = {
  type: ReportType; generatedAt: string; period: Window; comparison: Window;
  client: { id: string; name: string; logo: string; color: string; currency: string; website: string };
  attribution: Section<Attribution>;
  ads?: Section<AdsData>;
  traffic?: Section<TrafficData>; rankings?: Section<RankingsData>; backlinks?: Section<BacklinkData>; competitors?: Section<CompetitorData>; business?: Section<BusinessData>; aiVisibility?: Section<AiVisibilityData>;
  work: { completed: Array<{ title: string; completedAt: string }>; planned: string[] };
  recommendations: string[];
  missing: Array<{ label: string; note: string }>;
};

export async function buildClientReport(db: D1Database, workspace: Workspace, clientId: string, type: ReportType, period: Window): Promise<ClientReport> {
  const ownerId = String(workspace.ownerId || "");
  const client = (workspace.clients || []).find((item) => item.id === clientId);
  if (!client) throw new Error("Choose a client in this workspace.");
  const comparison = previousReportWindow(period.start, period.end);
  const channel: LeadChannel = type === "seo" ? "seo" : "google_ads";
  const attribution = await crmAttribution(db, ownerId, client.id, channel, period, comparison).catch((error) => off<Attribution>("unavailable", error instanceof Error ? error.message : "CRM data could not be read."));
  const report: ClientReport = {
    type, generatedAt: new Date().toISOString(), period, comparison,
    client: { id: client.id, name: client.name, logo: client.logo || "", color: /^#[0-9a-f]{6}$/i.test(client.branding?.primary || "") ? client.branding!.primary! : /^#[0-9a-f]{6}$/i.test(client.color || "") ? client.color! : "#1f6feb", currency: /^[A-Z]{3}$/.test(client.currency || "") ? client.currency! : "EUR", website: clientWebsite(client) },
    attribution, work: work(workspace, client, type, period), recommendations: [], missing: [],
  };
  if (type === "ads") report.ads = await adsData(db, ownerId, client, period, comparison);
  else {
    [report.traffic, report.rankings, report.backlinks, report.competitors, report.business, report.aiVisibility] = await Promise.all([
      organicTraffic(db, ownerId, client, period, comparison), rankings(db, ownerId, client, period, comparison), backlinks(db, ownerId, client, period, comparison),
      competitors(db, ownerId, client, period), business(db, ownerId, client, period, comparison), aiVisibility(db, ownerId, client, period, comparison),
    ]);
  }
  const labels: Record<string, string> = { attribution: "CRM leads & revenue", ads: "Google Ads", traffic: "Organic traffic", rankings: "Google rankings", backlinks: "Backlinks", competitors: "Competitors", business: "Google Business Profile", aiVisibility: "ChatGPT & Claude visibility" };
  for (const key of Object.keys(labels)) { const section = (report as unknown as Record<string, Section<unknown> | undefined>)[key]; if (section && section.status !== "ok") report.missing.push({ label: labels[key], note: section.note || "Unavailable" }); }
  report.recommendations = recommend(report);
  return report;
}

/** Data-driven next steps: each one is triggered by a real figure in this report, plus planned tasks. */
function recommend(report: ClientReport): string[] {
  const out: string[] = [];
  const a = report.attribution.data;
  if (report.type === "ads" && report.ads?.data) {
    const campaigns = report.ads.data.campaigns.filter((c) => c.spend > 0);
    const best = [...campaigns].filter((c) => c.costPerConversion != null).sort((x, y) => x.costPerConversion! - y.costPerConversion!)[0];
    const worst = [...campaigns].filter((c) => c.conversions === 0 && c.spend > 0).sort((x, y) => y.spend - x.spend)[0];
    if (best) out.push(`Scale “${best.name}” — lowest cost per conversion this period.`);
    if (worst) out.push(`Review “${worst.name}”: spend with no recorded conversions this period.`);
    if (a && a.unknownShare > 0.3) out.push(`${Math.round(a.unknownShare * 100)}% of leads have no recorded source — check website forms carry Google click IDs (auto-tagging on).`);
    if (a && a.current.leads > 0 && a.current.qualified === 0) out.push("No Ads leads reached Qualified yet — update CRM stages so lead quality and ROAS can be measured.");
  }
  if (report.type === "seo") {
    const near = (report.rankings?.data?.keywords || []).filter((k) => k.position != null && k.position > 10 && k.position <= 20).slice(0, 2);
    if (near.length) out.push(`Push page-two keywords to page one: ${near.map((k) => `“${k.keyword}” (#${k.position})`).join(", ")}.`);
    if (report.business?.data && report.business.data.previous && n(report.business.data.calls) < n(report.business.data.previous.calls)) out.push("Google Business calls dropped — post weekly updates and ask recent customers for reviews.");
    const ai = report.aiVisibility?.data; if (ai && ai.overall < 0.5) out.push("Improve AI visibility: add clear service + location pages and FAQs that ChatGPT and Claude can cite.");
    if (report.competitors?.data?.competitors.some((c) => c.topGaps.length)) out.push(`Create content for competitor keyword gaps: ${report.competitors.data.competitors.flatMap((c) => c.topGaps).slice(0, 3).map((k) => `“${k}”`).join(", ")}.`);
    if (a && a.unknownShare > 0.3) out.push(`${Math.round(a.unknownShare * 100)}% of leads have no recorded source — keep the website lead tracker on every form.`);
  }
  for (const task of report.work.planned) if (out.length < 5 && !out.includes(task)) out.push(task);
  return out.slice(0, 5);
}
