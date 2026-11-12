import { googleAdsPerformanceWindow, summarizeGoogleAdsRows, type GoogleAdsMetricRow } from "./google-ads-performance.ts";
import { metaAdsPerformanceWindow, summarizeMetaAdsDailyClicks, summarizeMetaAdsCampaignDailyClicks, summarizeMetaAdsTotals, type MetaAdsRow } from "./meta-ads-performance.ts";
import { googleAnalyticsDateWindow, searchConsoleDateWindow, summarizeGoogleAnalyticsRows, summarizeOrganicSearchRows, summarizeSearchConsoleRows, type SearchConsoleRow } from "./seo-performance.ts";
import { summarizeBusinessProfileRows, type BusinessProfileRow } from "./local-seo.ts";
import { loadCachedMarketingData, saveDailyMarketingSnapshot, type MarketingSnapshotService } from "./marketing-data-history.ts";

type SyncClient = { id: string; name?: string; googleAdsAccountId?: string; metaAdsAccountId?: string; googleSearchConsoleAccountId?: string; googleAnalyticsAccountId?: string; googleBusinessProfileAccountId?: string; googleBusinessProfileLocationId?: string };
type SyncCandidate = { clientId: string; clientName: string; service: MarketingSnapshotService; accountId: string; locationId?: string };
type SyncEnv = { DB: D1Database; WINDSOR_API_KEY?: string; isGoogleAdsDirect?: (ownerId: string) => Promise<boolean>; readDirectGoogleAds?: (ownerId: string, accountId: string, window: { start: string; end: string }) => Promise<GoogleAdsMetricRow[]>; isMetaAdsDirect?: (ownerId: string) => Promise<boolean>; readDirectMetaAds?: (ownerId: string, accountId: string, window: { start: string; end: string }) => Promise<MetaAdsRow[]>; isSearchConsoleDirect?: (ownerId: string) => Promise<boolean>; readDirectSearchConsole?: (ownerId: string, accountId: string, window: { start: string; end: string }) => Promise<SearchConsoleRow[]>; isGoogleAnalyticsDirect?: (ownerId: string) => Promise<boolean>; readDirectGoogleAnalytics?: (ownerId: string, accountId: string, window: { start: string; end: string }) => Promise<{ totals: SearchConsoleRow[]; channels: SearchConsoleRow[] }> };

const SYNC_LIMIT_PER_TICK = 4;
const SYNC_LEASE_MS = 15 * 60 * 1000;
const RETRY_DELAY_MS = 6 * 60 * 60 * 1000;
const NEXT_DAY_DELAY_MS = 24 * 60 * 60 * 1000;
const googleAdsFields = "account_id,date,campaign,campaign_id,campaign_status,spend,impressions,clicks,conversions,conversion_value";
const metaFields = "account_id,account_name,date,campaign,campaign_id,campaign_status,spend,impressions,clicks,actions_lead";
const searchConsoleFields = "account_id,site,date,query,page,clicks,impressions,ctr,position";
const analyticsFields = "account_id,account_name,sessions,active_users,engaged_sessions,conversions,totalrevenue";
const organicAnalyticsFields = "session_default_channel_group,sessions,conversions";
const businessProfileFields = "account_id,account_name,location_id,location_title,date,impressions,clicks,call_clicks,direction_requests,website_clicks";

function dublinDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function getDailySyncCandidates(clients: SyncClient[], input: {
  ownerId: string;
  today: string;
  now: Date;
  snapshots: Array<{ client_id: string; service: string; account_id: string }>;
  states: Array<{ client_id: string; service: string; account_id: string; next_attempt_at: string; status?: string; last_attempt_at?: string }>;
  allowedServices?: MarketingSnapshotService[];
  limit?: number;
  forceRetry?: boolean;
}) {
  const candidates: SyncCandidate[] = [];
  const current = new Set(input.snapshots.map((row) => `${row.client_id}|${row.service}|${row.account_id}`));
  const stateByKey = new Map(input.states.map((row) => [`${row.client_id}|${row.service}|${row.account_id}`, row]));
  for (const client of clients) {
    if (!client?.id) continue;
    const accounts: Array<[MarketingSnapshotService, string]> = [
      ["Google Ads", String(client.googleAdsAccountId || "").replace(/\D/g, "")],
      ["Meta Ads", String(client.metaAdsAccountId || "").replace(/^act_/i, "").replace(/\D/g, "")],
      ["Search Console", String(client.googleSearchConsoleAccountId || "").trim()],
      ["GA4", String(client.googleAnalyticsAccountId || "").trim()],
      ["Google Business Profile", String(client.googleBusinessProfileAccountId || "").trim()],
    ];
    for (const [service, accountId] of accounts) {
      if (!accountId) continue;
      const key = `${client.id}|${service}|${accountId}`;
      if (current.has(key) && !input.forceRetry) continue;
      const state = stateByKey.get(key);
      const retryAt = state?.status === "syncing" && state.last_attempt_at
        ? Date.parse(state.last_attempt_at) + SYNC_LEASE_MS
        : Date.parse(state?.next_attempt_at || "");
      if (state && state.status === "syncing" && retryAt > input.now.getTime()) continue;
      if (state && !input.forceRetry && retryAt > input.now.getTime()) continue;
      if (service === "Google Business Profile" && !String(client.googleBusinessProfileLocationId || "").trim()) continue;
      if (input.allowedServices && !input.allowedServices.includes(service)) continue;
      candidates.push({ clientId: client.id, clientName: String(client.name || client.id), service, accountId, ...(service === "Google Business Profile" ? { locationId: String(client.googleBusinessProfileLocationId).trim() } : {}) });
    }
  }
  return candidates.slice(0, Math.max(1, Math.min(20, Math.trunc(input.limit || SYNC_LIMIT_PER_TICK))));
}

async function fetchRows(apiKey: string, datasource: string, accountId: string, fields: string, window: { start: string; end: string }, cache: { db: D1Database; ownerId: string; clientId: string; service: MarketingSnapshotService; key: string }) {
  return (await loadCachedMarketingData({ db: cache.db, ownerId: cache.ownerId, clientId: cache.clientId, service: cache.service, key: cache.key }, async () => {
    const params = new URLSearchParams({ api_key: apiKey, fields, select_accounts: accountId, date_from: window.start, date_to: window.end, _max_rows: "1000", _renderer: "json" });
    const response = await fetch(`https://connectors.windsor.ai/${datasource}?${params}`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Windsor ${datasource} sync failed (HTTP ${response.status}).`);
    const payload = await response.json() as { data?: Array<Record<string, unknown>> };
    if (!Array.isArray(payload.data)) throw new Error(`Windsor ${datasource} returned an unexpected response.`);
    return payload.data;
  })).data;
}

async function readWithFallback<T>(input: {
  direct: boolean;
  windsorAvailable: boolean;
  service: string;
  readDirect: () => Promise<T>;
  readWindsor: () => Promise<T>;
}) {
  if (!input.direct) return { data: await input.readWindsor(), source: "windsor" as const };
  try { return { data: await input.readDirect(), source: "direct" as const }; }
  catch (error) {
    if (!input.windsorAvailable) throw error;
    console.warn(`Direct ${input.service} daily sync failed; trying Windsor`, { reason: error instanceof Error ? error.message : "unknown error" });
    return { data: await input.readWindsor(), source: "windsor" as const };
  }
}

async function snapshotCandidate(env: SyncEnv, ownerId: string, candidate: SyncCandidate, now: Date) {
  const { clientId, service, accountId } = candidate;
  const common = { db: env.DB, ownerId, clientId, service };
  let status: "connected" | "no_data";
  let payload: Record<string, unknown>;
  const fetchedAt = now;
  if (service === "Google Ads") {
    const window = googleAdsPerformanceWindow("last_30d", undefined, undefined, now);
    const direct = await env.isGoogleAdsDirect?.(ownerId) || false;
    if (direct && !env.readDirectGoogleAds) throw new Error("Direct Google Ads sync is not available in this worker run.");
    const result = await readWithFallback({ direct, windsorAvailable: Boolean(env.WINDSOR_API_KEY), service, readDirect: () => env.readDirectGoogleAds!(ownerId, accountId, window), readWindsor: () => fetchRows(env.WINDSOR_API_KEY || "", "google_ads", accountId, googleAdsFields, window, { ...common, key: JSON.stringify({ source: "windsor", accountId, window, section: "campaigns" }) }) });
    const rows = result.data;
    status = rows.length ? "connected" : "no_data";
    payload = { source: result.source === "direct" ? "Google Ads API · read-only" : "Windsor.ai Google Ads connector · read-only", current: summarizeGoogleAdsRows(rows) };
  } else if (service === "Meta Ads") {
    const window = metaAdsPerformanceWindow("last_30d", undefined, undefined, now);
    const direct = await env.isMetaAdsDirect?.(ownerId) || false;
    if (direct && !env.readDirectMetaAds) throw new Error("Direct Meta Ads sync is not available in this worker run.");
    const result = await readWithFallback({ direct, windsorAvailable: Boolean(env.WINDSOR_API_KEY), service, readDirect: () => env.readDirectMetaAds!(ownerId, accountId, window), readWindsor: () => fetchRows(env.WINDSOR_API_KEY || "", "facebook", accountId, metaFields, window, { ...common, key: JSON.stringify({ source: "windsor", accountId, window, section: "campaigns", campaignId: "" }) }) });
    const rows = result.data;
    const totals = summarizeMetaAdsTotals(rows);
    status = rows.length ? "connected" : "no_data";
    payload = { source: result.source === "direct" ? "Meta Marketing API · read-only" : "Windsor.ai Meta Ads connector · read-only", current: { totals: { ...totals, ctr: totals.impressions ? totals.clicks / totals.impressions : null, costPerLead: totals.leads ? totals.spend / totals.leads : null }, daily: summarizeMetaAdsDailyClicks(rows), campaignDaily: summarizeMetaAdsCampaignDailyClicks(rows), sourceRows: rows.length, mayBeLimited: rows.length >= 1000 } };
  } else if (service === "Search Console") {
    const window = searchConsoleDateWindow("last_30d", now);
    const direct = await env.isSearchConsoleDirect?.(ownerId) || false;
    if (direct && !env.readDirectSearchConsole) throw new Error("Direct Search Console sync is not available in this worker run.");
    const result = await readWithFallback({ direct, windsorAvailable: Boolean(env.WINDSOR_API_KEY), service, readDirect: () => env.readDirectSearchConsole!(ownerId, accountId, window.current), readWindsor: () => fetchRows(env.WINDSOR_API_KEY || "", "searchconsole", accountId, searchConsoleFields, window.current, { ...common, key: JSON.stringify({ source: "windsor", siteId: accountId, start: window.current.start, end: window.current.end, fields: searchConsoleFields }) }) });
    const rows = result.data;
    status = rows.length ? "connected" : "no_data";
    payload = { source: result.source === "direct" ? "Google Search Console API · read-only" : "Windsor.ai Search Console connector · read-only", current: { ...summarizeSearchConsoleRows(rows), mayBeLimited: rows.length >= (result.source === "direct" ? 50000 : 1000) } };
  } else if (service === "Google Business Profile") {
    const locationId = String(candidate.locationId || "");
    if (!locationId) throw new Error("The client’s Google Business Profile location is not mapped.");
    const window = googleAnalyticsDateWindow("last_30d", now);
    if (!window) throw new Error("Google Business Profile did not return a dated reporting window.");
    const rows = await fetchRows(env.WINDSOR_API_KEY || "", "google_my_business", accountId, businessProfileFields, window.current, { ...common, key: JSON.stringify({ accountId, locationId, fields: businessProfileFields, start: window.current.start, end: window.current.end }) }) as BusinessProfileRow[];
    const current = summarizeBusinessProfileRows(rows, locationId);
    status = current.rows ? "connected" : "no_data";
    payload = { current, locationId };
  } else {
    const window = googleAnalyticsDateWindow("last_30d", now);
    if (!window) throw new Error("GA4 did not return a dated reporting window.");
    const direct = await env.isGoogleAnalyticsDirect?.(ownerId) || false;
    if (direct && !env.readDirectGoogleAnalytics) throw new Error("Direct GA4 sync is not available in this worker run.");
    const result = await readWithFallback({ direct, windsorAvailable: Boolean(env.WINDSOR_API_KEY), service, readDirect: () => env.readDirectGoogleAnalytics!(ownerId, accountId, window.current), readWindsor: async () => {
      const [totals, channels] = await Promise.all([
        fetchRows(env.WINDSOR_API_KEY || "", "googleanalytics4", accountId, analyticsFields, window.current, { ...common, key: JSON.stringify({ source: "windsor", accountId, fields: analyticsFields, start: window.current.start, end: window.current.end }) }),
        fetchRows(env.WINDSOR_API_KEY || "", "googleanalytics4", accountId, organicAnalyticsFields, window.current, { ...common, key: JSON.stringify({ source: "windsor", accountId, fields: organicAnalyticsFields, start: window.current.start, end: window.current.end }) }),
      ]);
      return { totals, channels };
    } });
    const totalsRows = result.data.totals;
    const channelRows = result.data.channels;
    status = totalsRows.length ? "connected" : "no_data";
    payload = { source: result.source === "direct" ? "Google Analytics Data API · read-only" : "Windsor.ai Google Analytics connector · read-only", totals: summarizeGoogleAnalyticsRows(totalsRows), organicTotals: summarizeOrganicSearchRows(channelRows) };
  }
  await saveDailyMarketingSnapshot({ ...common, accountId, status, payload, fetchedAt });
  return { status, fetchedAt: fetchedAt.toISOString() };
}

async function recordSyncState(env: SyncEnv, ownerId: string, candidate: SyncCandidate, now: Date, status: string, detail: string | null, delay: number) {
  const attemptedAt = now.toISOString();
  const nextAttemptAt = new Date(now.getTime() + delay).toISOString();
  await env.DB.prepare(
    "INSERT INTO marketing_sync_state (owner_id, client_id, service, account_id, last_attempt_at, next_attempt_at, status, detail) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT(owner_id, client_id, service, account_id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at, next_attempt_at = excluded.next_attempt_at, status = excluded.status, detail = excluded.detail",
  ).bind(ownerId, candidate.clientId, candidate.service, candidate.accountId, attemptedAt, nextAttemptAt, status, detail?.slice(0, 400) || null).run();
}

async function claimSync(env: SyncEnv, ownerId: string, candidate: SyncCandidate, now: Date) {
  const attemptedAt = now.toISOString();
  const nextAttemptAt = new Date(now.getTime() + SYNC_LEASE_MS).toISOString();
  const staleBefore = new Date(now.getTime() - SYNC_LEASE_MS).toISOString();
  const result = await env.DB.prepare(
    "INSERT INTO marketing_sync_state (owner_id, client_id, service, account_id, last_attempt_at, next_attempt_at, status, detail) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'syncing', NULL) ON CONFLICT(owner_id, client_id, service, account_id) DO UPDATE SET last_attempt_at = excluded.last_attempt_at, next_attempt_at = excluded.next_attempt_at, status = 'syncing', detail = NULL WHERE marketing_sync_state.status != 'syncing' OR marketing_sync_state.last_attempt_at <= ?7",
  ).bind(ownerId, candidate.clientId, candidate.service, candidate.accountId, attemptedAt, nextAttemptAt, staleBefore).run();
  return result.meta.changes === 1;
}

export async function processDailyMarketingSnapshots(env: Partial<SyncEnv>, at = new Date(), retry?: { clientId: string; service: MarketingSnapshotService }) {
  if (!env.DB) return { status: "not_configured", synced: 0, failed: 0 };
  const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string }>();
  if (!row?.data) return { status: "workspace_unavailable", synced: 0, failed: 0 };
  const workspace = JSON.parse(row.data) as { ownerId?: string; clients?: SyncClient[] };
  const ownerId = String(workspace.ownerId || "");
  if (!ownerId) return { status: "owner_unavailable", synced: 0, failed: 0 };
  const directGoogleAds = await env.isGoogleAdsDirect?.(ownerId) || false;
  const directMetaAds = await env.isMetaAdsDirect?.(ownerId) || false;
  const directSearchConsole = await env.isSearchConsoleDirect?.(ownerId) || false;
  const directGoogleAnalytics = await env.isGoogleAnalyticsDirect?.(ownerId) || false;
  if (!env.WINDSOR_API_KEY && !directGoogleAds && !directMetaAds && !directSearchConsole && !directGoogleAnalytics) return { status: "not_configured", synced: 0, failed: 0 };
  const today = dublinDate(at);
  const [snapshots, states] = await Promise.all([
    env.DB.prepare("SELECT client_id, service, account_id FROM marketing_metric_snapshots WHERE owner_id = ?1 AND snapshot_date = ?2").bind(ownerId, today).all<{ client_id: string; service: string; account_id: string }>(),
    env.DB.prepare("SELECT client_id, service, account_id, last_attempt_at, next_attempt_at, status FROM marketing_sync_state WHERE owner_id = ?1").bind(ownerId).all<{ client_id: string; service: string; account_id: string; last_attempt_at: string; next_attempt_at: string; status: string }>(),
  ]);
  const allowedServices = env.WINDSOR_API_KEY
    ? undefined
    : [ ...(directGoogleAds ? ["Google Ads" as const] : []), ...(directMetaAds ? ["Meta Ads" as const] : []), ...(directSearchConsole ? ["Search Console" as const] : []), ...(directGoogleAnalytics ? ["GA4" as const] : []) ];
  const candidateClients = retry ? (workspace.clients || []).filter((client) => client.id === retry.clientId) : workspace.clients || [];
  const candidates = getDailySyncCandidates(candidateClients, { ownerId, today, now: at, snapshots: snapshots.results || [], states: states.results || [], allowedServices: retry ? [retry.service] : allowedServices, limit: retry ? 1 : 20, forceRetry: Boolean(retry) });
  const batch = candidates.slice(0, SYNC_LIMIT_PER_TICK);
  const outcomes = await Promise.all(batch.map(async (candidate) => {
    try {
      if (!await claimSync(env as SyncEnv, ownerId, candidate, at)) return { status: "in_progress" };
      const result = await snapshotCandidate(env as SyncEnv, ownerId, candidate, at);
      await recordSyncState(env as SyncEnv, ownerId, candidate, at, result.status, null, NEXT_DAY_DELAY_MS);
      return { status: result.status };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The provider request failed.";
      console.error("Marketing daily sync failed", candidate.clientId, candidate.service, detail);
      try { await recordSyncState(env as SyncEnv, ownerId, candidate, at, "unavailable", detail, RETRY_DELAY_MS); } catch { /* the next scheduled tick retries */ }
      return { status: "unavailable" };
    }
  }));
  return { status: "ok", synced: outcomes.filter((item) => item.status === "connected" || item.status === "no_data").length, failed: outcomes.filter((item) => item.status === "unavailable").length, remaining: Math.max(0, candidates.length - outcomes.length) };
}
