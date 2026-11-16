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
import { runPageSpeedInsights, runPublicTechnicalAudit } from "./website-audit-run";

export type ReportType = "seo" | "ads" | "audit" | "audit-ads" | "audit-website" | "keywords";
export const isAuditType = (type: ReportType) => type === "audit" || type === "audit-ads" || type === "audit-website";
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
const SERVICE_TEST: Record<ReportType, RegExp> = { seo: /seo|website|content|blog|google business|gbp|local|backlink|technical|page/i, ads: /google ads|ppc|ads|campaign|ad copy|keyword/i, audit: /audit|seo|google ads|ppc|website|google business|gbp|analytics|tracking/i, "audit-ads": /google ads|ppc|ads|campaign|ad copy|conversion|tracking/i, "audit-website": /website|seo|page|speed|technical|content|google business|gbp/i, keywords: /keyword|seo|content|blog|page/i };
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
  /** Marketing audit only: Google Ads lead attribution alongside the SEO one, and evidence-based findings. */
  adsAttribution?: Section<Attribution>;
  findings?: AuditFinding[];
  /** Website audit only: live PageSpeed (mobile) and a technical crawl of the public site. */
  website?: Section<WebsiteAuditData>;
  /** Keyword research report only. */
  keywordResearch?: Section<KeywordResearchData>;
};
export type WebsiteAuditData = { url: string; speed: { score: number | null; lcp: string; cls: string; tbt: string; fcp: string; opportunities: Array<{ title: string; displayValue: string }> } | null; speedNote?: string; pagesChecked: number; brokenLinks: number; sitemapUrls: number | null; issues: Array<{ severity: "high" | "medium" | "info"; title: string; detail: string; pages: number }> };
export type AuditFinding = { priority: "high" | "medium" | "low"; area: string; title: string; evidence: string; action: string };
export type ResearchKeyword = { keyword: string; volume: number | null; competition: string | null; lowBid: number | null; highBid: number | null; difficulty: number | null; tags: string[]; location: string; position: number | null };
export type KeywordResearchData = { total: number; totalVolume: number; groups: Array<{ name: string; keywords: ResearchKeyword[]; volume: number }> };

async function keywordResearch(db: D1Database, ownerId: string, client: Client, ranks?: Section<RankingsData>, onlyGroups?: string[]): Promise<Section<KeywordResearchData>> {
  try {
    const [groupsRes, rowsRes] = await db.batch([
      db.prepare("SELECT id, name FROM seo_keyword_groups WHERE owner_id = ?1 AND client_id = ?2 ORDER BY sort_order, name").bind(ownerId, client.id),
      db.prepare("SELECT keyword, location, group_id, tags, avg_monthly_searches, competition, low_bid, high_bid, difficulty, updated_at FROM seo_saved_keywords WHERE owner_id = ?1 AND client_id = ?2 ORDER BY avg_monthly_searches DESC, keyword").bind(ownerId, client.id),
    ]);
    const groups = (groupsRes.results || []) as Array<{ id: string; name: string }>;
    const rows = (rowsRes.results || []) as Array<{ keyword: string; location: string; group_id: string | null; tags: string; avg_monthly_searches: number | null; competition: string | null; low_bid: number | null; high_bid: number | null; difficulty: number | null; updated_at: string }>;
    if (onlyGroups?.length) {
      // Only the groups picked in Reports → Keywords ("ungrouped" = keywords not in any group).
      const keep = new Set(onlyGroups);
      for (let i = rows.length - 1; i >= 0; i--) { const g = rows[i].group_id; if (!(g ? keep.has(g) : keep.has("ungrouped"))) rows.splice(i, 1); }
      for (let i = groups.length - 1; i >= 0; i--) if (!keep.has(groups[i].id)) groups.splice(i, 1);
    }
    if (!rows.length) return off("not_connected", "No saved keywords for this client yet. Save keywords in SEO → Keywords, then generate this report.");
    const pos = new Map((ranks?.data?.keywords || []).map((k) => [k.keyword.toLowerCase(), k.position]));
    const toKw = (r: (typeof rows)[number]): ResearchKeyword => ({ keyword: r.keyword, volume: r.avg_monthly_searches, competition: r.competition, lowBid: r.low_bid, highBid: r.high_bid, difficulty: r.difficulty, tags: (() => { try { return JSON.parse(r.tags) as string[]; } catch { return []; } })(), location: r.location, position: pos.get(r.keyword.toLowerCase()) ?? null });
    const out = groups.map((g) => ({ name: g.name, keywords: rows.filter((r) => r.group_id === g.id).map(toKw) }));
    const known = new Set(groups.map((g) => g.id));
    const loose = rows.filter((r) => !r.group_id || !known.has(r.group_id)).map(toKw);
    if (loose.length) out.push({ name: "Ungrouped", keywords: loose });
    const withVol = out.filter((g) => g.keywords.length).map((g) => ({ ...g, volume: g.keywords.reduce((sum, k) => sum + n(k.volume), 0) }));
    const latest = rows.map((r) => r.updated_at).sort().pop();
    return ok({ total: rows.length, totalVolume: withVol.reduce((sum, g) => sum + g.volume, 0), groups: withVol }, "Saved keyword research (Google Ads Keyword Planner / DataForSEO)", latest || new Date().toISOString());
  } catch { return off("not_connected", "No saved keywords for this client yet. Save keywords in SEO → Keywords, then generate this report."); }
}

export async function buildClientReport(db: D1Database, workspace: Workspace, clientId: string, type: ReportType, period: Window, options: { keywordGroups?: string[] } = {}): Promise<ClientReport> {
  const ownerId = String(workspace.ownerId || "");
  const client = (workspace.clients || []).find((item) => item.id === clientId);
  if (!client) throw new Error("Choose a client in this workspace.");
  const comparison = previousReportWindow(period.start, period.end);
  const channel: LeadChannel = type === "ads" || type === "audit-ads" ? "google_ads" : "seo";
  const attribution = await crmAttribution(db, ownerId, client.id, channel, period, comparison).catch((error) => off<Attribution>("unavailable", error instanceof Error ? error.message : "CRM data could not be read."));
  const report: ClientReport = {
    type, generatedAt: new Date().toISOString(), period, comparison,
    client: { id: client.id, name: client.name, logo: client.logo || "", color: /^#[0-9a-f]{6}$/i.test(client.branding?.primary || "") ? client.branding!.primary! : /^#[0-9a-f]{6}$/i.test(client.color || "") ? client.color! : "#1f6feb", currency: /^[A-Z]{3}$/.test(client.currency || "") ? client.currency! : "EUR", website: clientWebsite(client) },
    attribution, work: work(workspace, client, type, period), recommendations: [], missing: [],
  };
  if (type === "ads" || type === "audit-ads") report.ads = await adsData(db, ownerId, client, period, comparison);
  else if (type === "audit-website") {
    [report.traffic, report.rankings, report.backlinks, report.business, report.aiVisibility, report.website] = await Promise.all([
      organicTraffic(db, ownerId, client, period, comparison), rankings(db, ownerId, client, period, comparison), backlinks(db, ownerId, client, period, comparison),
      business(db, ownerId, client, period, comparison), aiVisibility(db, ownerId, client, period, comparison), websiteAudit(report.client.website),
    ]);
  }
  else if (type === "keywords") {
    report.rankings = await rankings(db, ownerId, client, period, comparison);
    report.keywordResearch = await keywordResearch(db, ownerId, client, report.rankings, options.keywordGroups);
  } else {
    [report.traffic, report.rankings, report.backlinks, report.competitors, report.business, report.aiVisibility] = await Promise.all([
      organicTraffic(db, ownerId, client, period, comparison), rankings(db, ownerId, client, period, comparison), backlinks(db, ownerId, client, period, comparison),
      competitors(db, ownerId, client, period), business(db, ownerId, client, period, comparison), aiVisibility(db, ownerId, client, period, comparison),
    ]);
    if (type === "audit") {
      [report.ads, report.adsAttribution] = await Promise.all([
        adsData(db, ownerId, client, period, comparison),
        crmAttribution(db, ownerId, client.id, "google_ads", period, comparison).catch((error) => off<Attribution>("unavailable", error instanceof Error ? error.message : "CRM data could not be read.")),
      ]);
    }
  }
  const labels: Record<string, string> = { website: "Website checks", keywordResearch: "Saved keywords", attribution: "CRM leads & revenue", ads: "Google Ads", traffic: "Organic traffic", rankings: "Google rankings", backlinks: "Backlinks", competitors: "Competitors", business: "Google Business Profile", aiVisibility: "ChatGPT & Claude visibility" };
  for (const key of Object.keys(labels)) { const section = (report as unknown as Record<string, Section<unknown> | undefined>)[key]; if (section && section.status !== "ok") report.missing.push({ label: labels[key], note: section.note || "Unavailable" }); }
  if (type === "audit-ads") report.adsAttribution = report.attribution;
  if (isAuditType(type)) report.findings = auditFindings(report);
  report.recommendations = isAuditType(type) ? [...new Set((report.findings || []).filter((f) => f.priority !== "low").map((f) => f.action))].slice(0, 5) : recommend(report);
  if (isAuditType(type) && report.recommendations.length < 5) for (const task of report.work.planned) if (report.recommendations.length < 5 && !report.recommendations.includes(task)) report.recommendations.push(task);
  if (type === "keywords") report.recommendations = keywordRecommendations(report);
  return report;
}

async function websiteAudit(site: string): Promise<Section<WebsiteAuditData>> {
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`); url.protocol = "https:"; url.pathname = "/"; url.search = ""; url.hash = ""; } catch { return off("not_connected", "No website on this client yet. Add it to the client record."); }
  if (!site) return off("not_connected", "No website on this client yet. Add it to the client record.");
  const siteUrl = url.origin;
  try {
    const first = await runPublicTechnicalAudit(siteUrl, [siteUrl]);
    const links = (first.pages[0]?.internalLinks || []).filter((link) => !/\.(?:jpg|jpeg|png|gif|webp|svg|pdf|xml|css|js)(?:$|\?)/i.test(link)).slice(0, 14);
    const [crawl, speed] = await Promise.all([
      links.length ? runPublicTechnicalAudit(siteUrl, [siteUrl, ...links]) : Promise.resolve(first),
      runPageSpeedInsights(siteUrl, siteUrl, "mobile").then((r) => ({ ok: true as const, r })).catch((e) => ({ ok: false as const, note: e instanceof Error ? e.message : "PageSpeed couldn't run." })),
    ]);
    const data: WebsiteAuditData = {
      url: siteUrl,
      speed: speed.ok ? { score: speed.r.lighthousePerformanceScore, lcp: speed.r.lab.lcp.display, cls: speed.r.lab.cls.display, tbt: speed.r.lab.tbt.display, fcp: speed.r.lab.fcp.display, opportunities: speed.r.opportunities.map((o) => ({ title: o.title, displayValue: o.displayValue })) } : null,
      ...(speed.ok ? {} : { speedNote: speed.note }),
      pagesChecked: crawl.pages.length, brokenLinks: crawl.brokenLinks.length, sitemapUrls: crawl.sitemap.checked ? crawl.sitemap.urlsFound : null,
      issues: crawl.findings.map((f) => ({ severity: f.severity, title: f.title, detail: f.detail, pages: f.pages.length })),
    };
    return ok(data, "Live check of the public website + Google PageSpeed (mobile)", new Date().toISOString());
  } catch (e) { return off("unavailable", e instanceof Error ? e.message.slice(0, 200) : "The website couldn't be checked."); }
}

/** Marketing audit: each finding is triggered by a real figure (or a missing connection) in this report. */
function auditFindings(report: ClientReport): AuditFinding[] {
  const out: AuditFinding[] = [];
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const ads = report.ads?.data, a = report.adsAttribution?.data, s = report.attribution.data;
  const add = (priority: AuditFinding["priority"], area: string, title: string, evidence: string, action: string) => out.push({ priority, area, title, evidence, action });
  if (ads) {
    const cur = ads.current, prev = ads.previous;
    const zero = ads.campaigns.filter((c) => c.spend > 0 && c.conversions === 0).sort((x, y) => y.spend - x.spend);
    if (zero.length) add("high", "Google Ads", `Spend with no conversions in ${zero.length} campaign${zero.length > 1 ? "s" : ""}`, `“${zero[0].name}” spent ${zero[0].spend.toFixed(2)} ${report.client.currency} with no recorded conversions.`, `Review search terms, ads and landing page for “${zero[0].name}”, or pause it.`);
    if (prev && cur.costPerConversion != null && prev.costPerConversion != null && cur.costPerConversion > prev.costPerConversion * 1.25) add("medium", "Google Ads", "Cost per conversion rose", `Up from ${prev.costPerConversion.toFixed(2)} to ${cur.costPerConversion.toFixed(2)} ${report.client.currency} versus the previous period.`, "Check bids, negative keywords and recent ad or landing-page changes.");
    if (cur.clicks > 0 && cur.ctrPercent < 2) add("medium", "Google Ads", "Low click-through rate", `CTR is ${cur.ctrPercent.toFixed(2)}% across ${cur.clicks} clicks.`, "Refresh ad copy and tighten ad groups so ads match searches more closely.");
    if (cur.spend > 0 && cur.conversions === 0) add("high", "Google Ads", "No conversions recorded at all", `Spend of ${cur.spend.toFixed(2)} ${report.client.currency} this period with zero conversions.`, "Check conversion tracking is firing on every form and call button.");
  } else if (report.ads) add("medium", "Google Ads", report.ads.status === "not_connected" ? "Google Ads not connected" : "Google Ads data unavailable", report.ads.note || "No Google Ads data for this period.", "Link the client's Google Ads account in their profile so spend and leads can be audited.");
  if (a && a.current.leads > 0 && a.current.qualified === 0) add("medium", "CRM", "Ads leads not progressing", `${a.current.leads} Google Ads lead${a.current.leads > 1 ? "s" : ""} but none reached Qualified.`, "Update CRM stages so lead quality and return on ad spend can be measured.");
  const unknown = Math.max(a?.unknownShare || 0, s?.unknownShare || 0);
  if (unknown > 0.3) add("high", "Tracking", "Many leads have no source", `${pct(unknown)} of leads this period have no recorded source.`, "Make sure every website form carries the lead tracker and Google click IDs (auto-tagging on).");
  const t = report.traffic?.data;
  if (t && t.previous != null && t.previous > 0 && t.current < t.previous * 0.8) add("high", "SEO", "Organic traffic dropped", `${t.metric}: ${t.current} versus ${t.previous} the period before (${pct(1 - t.current / t.previous)} down).`, "Check Search Console for lost pages or queries and recent site changes.");
  else if (!t && report.traffic) add("medium", "SEO", "Organic traffic not measured", report.traffic.note || "No GA4 or Search Console connected.", "Link GA4 and Search Console to this client.");
  const near = (report.rankings?.data?.keywords || []).filter((k) => k.position != null && k.position > 10 && k.position <= 20);
  if (near.length) add("medium", "SEO", `${near.length} keyword${near.length > 1 ? "s" : ""} on page two`, near.slice(0, 3).map((k) => `“${k.keyword}” #${k.position}`).join(", "), "Improve those pages (content depth, internal links, titles) to reach page one.");
  const drops = (report.rankings?.data?.keywords || []).filter((k) => k.change != null && k.change <= -3);
  if (drops.length) add("medium", "SEO", "Ranking drops", drops.slice(0, 3).map((k) => `“${k.keyword}” ${k.previousPosition}→${k.position}`).join(", "), "Review the ranking pages for those keywords and competitor changes.");
  const gb = report.business?.data;
  if (gb?.previous && gb.calls != null && gb.previous.calls != null && gb.calls < gb.previous.calls) add("low", "Google Business", "Fewer calls from Google Business", `${gb.calls} calls versus ${gb.previous.calls} the period before.`, "Post weekly updates and ask recent customers for reviews.");
  else if (!gb && report.business) add("low", "Google Business", "Google Business Profile not linked", report.business.note || "No profile linked.", "Link the client's Google Business Profile location.");
  const ai = report.aiVisibility?.data;
  if (ai && ai.overall < 0.5) add("low", "AI visibility", "Low AI assistant visibility", `Mentioned in ${pct(ai.overall)} of ChatGPT and Claude test questions.`, "Add clear service + location pages and FAQs that AI assistants can cite.");
  const bl = report.backlinks?.data;
  if (bl?.previous?.referringDomains != null && bl.referringDomains != null && bl.referringDomains < bl.previous.referringDomains) add("low", "SEO", "Referring domains fell", `${bl.referringDomains} versus ${bl.previous.referringDomains}.`, "Check for lost links and plan new local citations.");
  const w = report.website?.data;
  if (w) {
    const sp = w.speed?.score;
    if (sp != null && sp < 50) add("high", "Website", "Slow on mobile", `Google PageSpeed mobile score ${sp}/100${w.speed?.lcp ? ` · largest content loads in ${w.speed.lcp}` : ""}.`, `Fix the biggest speed issues first: ${(w.speed?.opportunities || []).slice(0, 2).map((o) => o.title.toLowerCase()).join(", ") || "compress images and defer scripts"}.`);
    else if (sp != null && sp < 90) add("medium", "Website", "Mobile speed could be better", `Google PageSpeed mobile score ${sp}/100.`, `Improve: ${(w.speed?.opportunities || []).slice(0, 2).map((o) => o.title.toLowerCase()).join(", ") || "image sizes and unused code"}.`);
    if (w.brokenLinks) add("high", "Website", `${w.brokenLinks} broken link${w.brokenLinks > 1 ? "s" : ""}`, `Found while checking ${w.pagesChecked} pages.`, "Fix or redirect the broken links so visitors and Google don't hit dead ends.");
    for (const issue of w.issues.filter((i) => !/broken/i.test(i.title)).slice(0, 6)) add(issue.severity === "info" ? "low" : issue.severity, "Website", issue.title, `${issue.detail}${issue.pages ? ` (${issue.pages} page${issue.pages > 1 ? "s" : ""})` : ""}`.slice(0, 300), issue.severity === "high" ? "Fix this on the affected pages first." : "Tidy this up on the affected pages.");
  } else if (report.website) add("medium", "Website", "Website couldn't be checked", report.website.note || "Unavailable.", "Add the client's website to their record so it can be checked.");
  const rank = { high: 0, medium: 1, low: 2 };
  const scoped = report.type === "audit-ads" ? out.filter((f) => /google ads|crm|tracking/i.test(f.area)) : report.type === "audit-website" ? out.filter((f) => !/google ads/i.test(f.area) && !(f.area === "CRM" && /ads/i.test(f.title))) : out;
  return scoped.sort((x, y) => rank[x.priority] - rank[y.priority]).slice(0, 12);
}

function keywordRecommendations(report: ClientReport): string[] {
  const k = report.keywordResearch?.data; if (!k) return [];
  const out: string[] = [];
  const all = k.groups.flatMap((g) => g.keywords.map((kw) => ({ ...kw, group: g.name })));
  const easy = all.filter((kw) => kw.volume && (kw.difficulty == null || kw.difficulty < 30) && (kw.position == null || kw.position > 10)).sort((x, y) => n(y.volume) - n(x.volume)).slice(0, 3);
  if (easy.length) out.push(`Target quick wins first: ${easy.map((kw) => `“${kw.keyword}”`).join(", ")} — good volume, lower difficulty.`);
  const top = [...k.groups].sort((x, y) => y.volume - x.volume)[0];
  if (top) out.push(`Build or strengthen a dedicated page for the “${top.name}” group (${top.volume.toLocaleString("en-IE")} searches a month).`);
  const loose = k.groups.find((g) => g.name === "Ungrouped"); if (loose) out.push(`Sort ${loose.keywords.length} ungrouped keyword${loose.keywords.length > 1 ? "s" : ""} into groups so each maps to one page.`);
  const paid = all.filter((kw) => kw.tags.includes("Google Ads")).length; if (paid) out.push(`${paid} keyword${paid > 1 ? "s are" : " is"} tagged for Google Ads — add them to the matching ad groups.`);
  for (const task of report.work.planned) if (out.length < 5 && !out.includes(task)) out.push(task);
  return out.slice(0, 5);
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
