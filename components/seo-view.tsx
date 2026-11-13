"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { MarketingAuditPanel } from "@/components/marketing-audit-panel";
import { MarketingSnapshotHistory, type MarketingHistorySnapshot } from "@/components/marketing-snapshot-history";
import type { MarketingAuditRun } from "@/lib/marketing-audit";
import { compareSearchConsoleQueryPositions } from "@/lib/seo-performance";
import { inspectSeoContentPage, type SeoContentPage } from "@/lib/seo-content-audit";
import { suggestSeoPageOpportunities } from "@/lib/seo-page-opportunities";
import { MarketingSetupWizard } from "@/components/marketing-setup-wizard";

type Client = { id: string; name: string; logo?: string; website?: string; services?: Array<{ name?: string; campaignName?: string }>; seoServices?: string[]; seoLocations?: string[]; googleAdsAccountId?: string; googleSearchConsoleAccountId?: string; googleAnalyticsAccountId?: string; googleBusinessProfileAccountId?: string; googleBusinessProfileLocationId?: string; wordpressSiteUrl?: string };
type SeoRow = { name: string; clicks: number; impressions: number; ctr: number | null; averagePosition: number | null };
function snapshotQueries(snapshot: MarketingHistorySnapshot | undefined): SeoRow[] {
  const current = snapshot?.payload.current;
  if (!current || typeof current !== "object") return [];
  const rows = (current as Record<string, unknown>).topQueries;
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is SeoRow => Boolean(row && typeof row === "object" && typeof (row as SeoRow).name === "string" && typeof (row as SeoRow).clicks === "number" && typeof (row as SeoRow).impressions === "number" && ((row as SeoRow).averagePosition === null || typeof (row as SeoRow).averagePosition === "number")));
}
type SeoPayload = { status: "connected" | "no_data" | "not_mapped" | "missing_connection" | "source_not_connected" | "unavailable"; message?: string; dataNote?: string; dataSource?: string; propertyId?: string; snapshots?: MarketingHistorySnapshot[]; dateWindow?: { current: { start: string; end: string }; previous: { start: string; end: string } }; current?: { totals: { clicks: number; impressions: number; ctr: number | null; averagePosition: number | null }; daily: Array<{ date: string; clicks: number; impressions: number }>; topQueries: SeoRow[]; topPages: SeoRow[]; sourceRows: number; mayBeLimited: boolean }; previous?: { totals: { clicks: number; impressions: number; ctr: number | null; averagePosition: number | null } }; updatedAt?: string };
type Analytics = { status: string; message?: string; dataNote?: string; range?: string; accountName?: string; snapshots?: MarketingHistorySnapshot[]; dateWindow?: { current: { start: string; end: string }; previous: { start: string; end: string } } | null; updatedAt?: string; totals?: Record<string, number | null>; previousTotals?: Record<string, number | null> | null; organicTotals?: { sessions: number | null; conversions: number | null; sourceRows: number } | null; previousOrganicTotals?: { sessions: number | null; conversions: number | null; sourceRows: number } | null };
type SearchProperty = { id: string; name: string; status: string };
type KeywordIdea = { keyword: string; avgMonthlySearches: number | null; competition: string; competitionIndex: number | null; lowTopOfPageBid: number | null; highTopOfPageBid: number | null; difficulty?: number | null };
type KeywordIdeasPayload = { source: string; location: string; count: number; results: KeywordIdea[]; dataNote: string; providerCostUsd?: number | null; costs?: { keywordIdeasUsd: number | null; keywordDifficultyUsd: number | null }; updatedAt?: string; historyId?: string };
type KeywordResearchHistory = { id: string; createdAt: string; location: string; seeds: string[]; costUsd: number | null; results: KeywordIdea[] };
type CompetitorKeyword = { keyword: string; monthlySearches: number | null; difficulty: number | null; competitorPosition: number | null; competitorUrl: string | null };
type CompetitorKeywordResult = { competitorDomain: string; status: "connected" | "unavailable"; message?: string; costUsd: number | null; totalCount: number | null; keywords: CompetitorKeyword[] };
type CompetitorResearchRun = { id: string; createdAt: string; location: string; clientDomain: string; requestCount: number; costUsd: number | null; competitors: CompetitorKeywordResult[] };
type BusinessAccount = { id: string; name: string };
type BusinessLocation = { id: string; name: string; website: string };
type LocalSeoData = { status: string; message?: string; dataNote?: string; reviewsNote?: string; locationName?: string; snapshots?: MarketingHistorySnapshot[]; dateWindow?: { current: { start: string; end: string }; previous: { start: string; end: string } }; current?: { impressions: number | null; calls: number | null; directions: number | null; websiteClicks: number | null }; previous?: { impressions: number | null; calls: number | null; directions: number | null; websiteClicks: number | null }; reviews?: { total: number | null; averageRating: number | null; recent: Array<{ reviewer: string; rating: string; comment: string; createdAt: string; reply: string }> } | null };
type LocalMapsRank = { keyword: string; location: string; businessName: string; domain: string; rank: number | null; placeId: string | null; rating: number | null; reviewCount: number | null; matchedBy: "domain" | "name" | null; competitors: Array<{ name: string; rank: number; domain: string | null; rating: number | null; reviewCount: number | null }> };
type LocalRankHistory = { id: string; createdAt: string; location: string; businessName: string; domain: string; costUsd: number | null; results: LocalMapsRank[] };
type LocalRankData = { status: string; message?: string; history?: LocalRankHistory[]; results?: LocalMapsRank[]; failed?: Array<{ keyword: string; error: string }>; providerCostUsd?: number | null; dataNote?: string; updatedAt?: string };
type BacklinkSummary = { target: string; backlinks: number | null; referringDomains: number | null; referringIps: number | null; rank: number | null; spamScore: number | null; brokenBacklinks: number | null; crawledPages: number | null };
type BacklinkChangeCounts = { backlinksNew: number | null; backlinksLost: number | null; referringDomainsNew: number | null; referringDomainsLost: number | null; startDate: string; endDate: string };
type BacklinkItem = { domainFrom: string; urlFrom: string; urlTo: string; anchor: string | null; rank: number | null; firstSeen: string | null; isNew: boolean; isLost: boolean; dofollow: boolean | null };
type BacklinkOutreach = { id: string; sourceUrl: string; sourceDomain: string; targetUrl: string; anchor: string; status: "To review" | "Shortlisted" | "Contacted" | "Replied" | "Link live" | "Not suitable"; note: string; followUpDate: string | null; createdAt: string; updatedAt: string };
type BacklinkHistoryItem = { target: string; checkedAt: string; summary: BacklinkSummary; changes?: BacklinkChangeCounts | null; providerCostUsd: number | null };
type BacklinkData = { status: string; message?: string; defaultTarget?: string; dataNote?: string; detailErrors?: string[]; summary?: BacklinkSummary; changes?: BacklinkChangeCounts | null; items?: BacklinkItem[]; providerCostUsd?: number | null; updatedAt?: string; history?: BacklinkHistoryItem[]; comparison?: { previousCheckedAt: string; backlinks: number | null; referringDomains: number | null; brokenBacklinks: number | null } };
type SeoInventoryPage = SeoContentPage & { id: number; slug: string; modified?: string; seoCapabilities?: { title?: boolean; description?: boolean; canonical?: boolean; indexing?: boolean } };
type SeoInventory = { siteUrl?: string; pages?: SeoInventoryPage[]; inventoryPage?: number; totalPages?: number; publicInventory?: boolean; publicInventoryError?: string; connected?: boolean; connectionType?: string };
export type SeoTab = Tab;
type Tab = "Performance" | "Queries" | "Keyword ideas" | "Pages & content" | "Local SEO" | "Backlinks" | "Technical" | "Setup";
const tabs: Tab[] = ["Performance", "Queries", "Keyword ideas", "Pages & content", "Local SEO", "Backlinks", "Technical", "Setup"];
const number = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("en-IE", { maximumFractionDigits: 1 });
const signed = (value: number | null) => value == null ? "—" : `${value > 0 ? "+" : ""}${number(value)}`;
const safeHttpUrl = (value: string) => { try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined; } catch { return undefined; } };
function comparablePageUrl(value: string) {
  try { const url = new URL(value); url.search = ""; url.hash = ""; return `${url.origin}${url.pathname.replace(/\/+$/, "") || "/"}`.toLowerCase(); } catch { return value.trim().toLowerCase(); }
}
function change(current: number | null | undefined, previous: number | null | undefined, inverse = false) {
  if (current == null || previous == null || previous === 0) return "No previous comparison";
  const delta = (current - previous) / Math.abs(previous) * 100;
  return `${delta > 0 ? "+" : ""}${delta.toFixed(1)}% ${inverse ? (delta < 0 ? "↑ better" : delta > 0 ? "↓ worse" : "same") : "vs prior period"}`;
}

export function SeoView({ initialTab, sections, keywordPart = "all", embedded = false, showAudit = true, clients, active, selectedClientId, canOpenSites, canManageMappings, onMapSearchConsole, onMapAnalytics, onMapBusinessProfile, onCreateTask, onOpenSites, auditRuns = [], canRunAudit, onSaveAudit, onCreateAuditTask, agents = [], onOpenTaskList }: { initialTab?: "Keyword ideas"; sections?: Tab[]; keywordPart?: "all" | "ideas" | "competitors"; embedded?: boolean; showAudit?: boolean; clients: Client[]; active: boolean; selectedClientId?: string; canOpenSites: boolean; canManageMappings: boolean; onMapSearchConsole: (clientId: string, propertyId: string) => Promise<boolean>; onMapAnalytics: (clientId: string, propertyId: string) => Promise<boolean>; onMapBusinessProfile: (clientId: string, accountId: string, locationId: string) => Promise<boolean>; onCreateTask: (clientId: string, title: string, notes: string, checklist: string) => void; onOpenSites: () => void; auditRuns?: MarketingAuditRun[]; canRunAudit: boolean; onSaveAudit: (run: MarketingAuditRun) => Promise<boolean>; onCreateAuditTask: (clientId: string, title: string, notes: string) => void; agents?: Array<{ id: string; name: string; isBot?: boolean; avatar?: string }>; onOpenTaskList: () => void }) {
  const available = useMemo(() => clients, [clients]);
  const [clientId, setClientId] = useState(available[0]?.id || clients[0]?.id || "");
  useEffect(() => { if (clients.length && !clients.some((item) => item.id === clientId)) setClientId(clients[0].id); }, [clients, clientId]);
  useEffect(() => { if (active && selectedClientId && clients.some((item) => item.id === selectedClientId)) setClientId(selectedClientId); }, [active, selectedClientId, clients]);
  const [range, setRange] = useState("last_30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const customDatesReady = Boolean(customFrom && customTo && customFrom <= customTo);
  const [tab, setTab] = useState<Tab>(initialTab || "Performance");
  const visibleTabs: Tab[] = sections && sections.length ? sections : [tab];
  const visKey = visibleTabs.join("|");
  const vis = (item: Tab) => visibleTabs.includes(item);
  const hasNonSetup = visibleTabs.some((item) => item !== "Setup");
  const [search, setSearch] = useState<SeoPayload | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [properties, setProperties] = useState<SearchProperty[]>([]);
  const [propertiesStatus, setPropertiesStatus] = useState("");
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  const [mappingSaving, setMappingSaving] = useState(false);
  const [analyticsProperties, setAnalyticsProperties] = useState<SearchProperty[]>([]);
  const [analyticsPropertiesStatus, setAnalyticsPropertiesStatus] = useState("");
  const [selectedAnalyticsPropertyId, setSelectedAnalyticsPropertyId] = useState("");
  const [analyticsPropertiesLoading, setAnalyticsPropertiesLoading] = useState(false);
  const [analyticsMappingSaving, setAnalyticsMappingSaving] = useState(false);
  const [localSeo, setLocalSeo] = useState<LocalSeoData | null>(null);
  const [localRankStatus, setLocalRankStatus] = useState("");
  const [localRankHistory, setLocalRankHistory] = useState<LocalRankHistory[]>([]);
  const [localRankFormState, setLocalRankFormState] = useState({ clientId: "", keywords: "", location: "", businessName: "", domain: "" });
  const [localRankConsent, setLocalRankConsent] = useState(false);
  const [localRankLoading, setLocalRankLoading] = useState(false);
  const [localRankError, setLocalRankError] = useState("");
  const [localRankResult, setLocalRankResult] = useState<LocalRankData | null>(null);
  const [backlinkData, setBacklinkData] = useState<BacklinkData | null>(null);
  const [backlinkTarget, setBacklinkTarget] = useState("");
  const [backlinkConsent, setBacklinkConsent] = useState(false);
  const [backlinkLoading, setBacklinkLoading] = useState(false);
  const [backlinkError, setBacklinkError] = useState("");
  const [backlinkOutreach, setBacklinkOutreach] = useState<BacklinkOutreach[]>([]);
  const [backlinkOutreachError, setBacklinkOutreachError] = useState("");
  const [backlinkOutreachBusyId, setBacklinkOutreachBusyId] = useState("");
  const [businessAccounts, setBusinessAccounts] = useState<BusinessAccount[]>([]);
  const [businessLocations, setBusinessLocations] = useState<BusinessLocation[]>([]);
  const [businessAccountId, setBusinessAccountId] = useState("");
  const [businessLocationId, setBusinessLocationId] = useState("");
  const [businessStatus, setBusinessStatus] = useState("");
  const [businessBusy, setBusinessBusy] = useState(false);
  const [businessSaving, setBusinessSaving] = useState(false);
  const [keywordSeeds, setKeywordSeeds] = useState("");
  const [keywordUrl, setKeywordUrl] = useState("");
  const [keywordGeo, setKeywordGeo] = useState("2372");
  const [keywordSource, setKeywordSource] = useState<"google" | "dataforseo">(keywordPart === "competitors" ? "dataforseo" : "google");
  const [keywordLocation, setKeywordLocation] = useState("Ireland");
  const [keywordChargeConsent, setKeywordChargeConsent] = useState(false);
  const [dataForSeoKeywordStatus, setDataForSeoKeywordStatus] = useState("");
  const [keywordResearchHistory, setKeywordResearchHistory] = useState<KeywordResearchHistory[]>([]);
  const [competitorDomains, setCompetitorDomains] = useState("");
  const [competitorResearchHistory, setCompetitorResearchHistory] = useState<CompetitorResearchRun[]>([]);
  const [competitorResearchResult, setCompetitorResearchResult] = useState<CompetitorResearchRun | null>(null);
  const [competitorResearchLoading, setCompetitorResearchLoading] = useState(false);
  const [competitorResearchError, setCompetitorResearchError] = useState("");
  const [competitorChargeConsent, setCompetitorChargeConsent] = useState(false);
  const [keywordLoading, setKeywordLoading] = useState(false);
  const [keywordError, setKeywordError] = useState("");
  const [keywordIdeas, setKeywordIdeas] = useState<KeywordIdeasPayload | null>(null);
  const [pickedKeywords, setPickedKeywords] = useState<Set<string>>(new Set());
  const [showAllKeywordIdeas, setShowAllKeywordIdeas] = useState(false);
  const [contentInventory, setContentInventory] = useState<SeoInventory | null>(null);
  const [contentInventoryLoading, setContentInventoryLoading] = useState(false);
  const [contentInventoryError, setContentInventoryError] = useState("");
  const [contentInventoryPage, setContentInventoryPage] = useState(1);
  const [contentInventoryReload, setContentInventoryReload] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const client = clients.find((item) => item.id === clientId);
  // Prefill keyword research from what we already know about the client (services, ad campaign names, areas, website).
  useEffect(() => {
    if (!client) return;
    const area = (client.seoLocations || [])[0]?.toLowerCase() || "";
    const fromCampaigns = (client.services || []).map((service) => String(service.campaignName || "").replace(/^[^|]*\|\s*/, "").trim()).filter(Boolean);
    const base = [...new Set([...(client.seoServices || []), ...fromCampaigns].map((item) => item.toLowerCase()))].slice(0, 8);
    setKeywordSeeds(base.map((item) => area && !item.includes(area) ? `${item} ${area}` : item).join(", "));
    setKeywordUrl(client.website || client.wordpressSiteUrl || "");
    setKeywordIdeas(null); setPickedKeywords(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id]);
  const keywordReportRows = () => (keywordIdeas?.results || []).filter((row) => pickedKeywords.has(row.keyword)).sort((a, b) => (b.avgMonthlySearches || 0) - (a.avgMonthlySearches || 0));
  const downloadKeywordCsv = () => {
    const rows = keywordReportRows(); if (!rows.length || !client) return;
    const q = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csv = [["Keyword", "Avg monthly searches", "Competition", "Competition index", "Difficulty", "Low bid", "High bid"].map(q).join(","), ...rows.map((row) => [row.keyword, row.avgMonthlySearches, row.competition, row.competitionIndex, row.difficulty, row.lowTopOfPageBid, row.highTopOfPageBid].map(q).join(","))].join("\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); link.download = `${client.name} keyword research ${new Date().toISOString().slice(0, 10)}.csv`; link.click();
  };
  const openKeywordReport = () => {
    const rows = keywordReportRows(); if (!rows.length || !client || !keywordIdeas) return;
    const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
    const dfs = keywordIdeas.source === "DataForSEO";
    const cur = dfs ? "$" : "€";
    const level = (row: KeywordIdea) => { const c = String(row.competition || "").toLowerCase(); return c.includes("high") ? "high" : c.includes("medium") ? "medium" : c.includes("low") ? "low" : "unknown"; };
    const label = { high: "High", medium: "Medium", low: "Low", unknown: "Unknown" } as const;
    // Organise: group each keyword under the seed phrase it shares the most words with.
    const stop = new Set(["near", "me", "the", "a", "for", "in", "of", "and", "best", "ireland", ...(client.seoLocations || []).map((item) => item.toLowerCase())]);
    const words = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !stop.has(word));
    const seeds = keywordSeeds.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean).slice(0, 10);
    const groups = new Map<string, KeywordIdea[]>();
    for (const row of rows) {
      const kw = new Set(words(row.keyword));
      let best = "", score = 0;
      for (const seed of seeds) { const hit = words(seed).filter((word) => kw.has(word) || [...kw].some((k) => k.startsWith(word.slice(0, 5)))).length; if (hit > score) { best = seed; score = hit; } }
      const key = best || "Other related searches";
      groups.set(key, [...(groups.get(key) || []), row]);
    }
    const order = { high: 2, medium: 1, low: 0, unknown: 3 };
    const sorted = [...groups.entries()].map(([name, list]) => ({ name, list: list.sort((a, b) => (b.avgMonthlySearches || 0) - (a.avgMonthlySearches || 0) || order[level(a)] - order[level(b)]), total: list.reduce((sum, row) => sum + (row.avgMonthlySearches || 0), 0) })).sort((a, b) => Number(a.name === "Other related searches") - Number(b.name === "Other related searches") || b.total - a.total).map((group) => ({ ...group, name: group.name.replace(/^./, (c) => c.toUpperCase()) }));
    const total = rows.reduce((sum, row) => sum + (row.avgMonthlySearches || 0), 0);
    const counts = { low: rows.filter((row) => level(row) === "low").length, medium: rows.filter((row) => level(row) === "medium").length, high: rows.filter((row) => level(row) === "high").length, unknown: rows.filter((row) => level(row) === "unknown").length };
    const bids = rows.filter((row) => row.lowTopOfPageBid != null && row.highTopOfPageBid != null);
    const avg = (pick: (row: KeywordIdea) => number) => bids.length ? bids.reduce((sum, row) => sum + pick(row), 0) / bids.length : null;
    const avgLow = avg((row) => row.lowTopOfPageBid || 0), avgHigh = avg((row) => row.highTopOfPageBid || 0);
    const date = new Date().toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" });
    const money = (value: number | null) => value == null ? "N/A" : `${cur}${value.toFixed(2)}`;
    const letter = (index: number) => String.fromCharCode(65 + index);
    const quickWins = rows.filter((row) => level(row) === "low" && (row.avgMonthlySearches || 0) > 0).slice(0, 8);
    const table = (list: KeywordIdea[]) => `<table class="kw"><thead><tr><th>Keyword</th><th>Avg. searches<br>/ month</th>${dfs ? "<th>Organic<br>difficulty</th>" : ""}<th>Ads<br>competition</th><th>Bid low<br>(${dfs ? "USD" : "EUR"})</th><th>Bid high<br>(${dfs ? "USD" : "EUR"})</th></tr></thead><tbody>${list.map((row) => `<tr class="${level(row)}"><td>${esc(row.keyword)}</td><td>${row.avgMonthlySearches == null ? "N/A" : row.avgMonthlySearches.toLocaleString("en-IE")}</td>${dfs ? `<td>${row.difficulty == null ? "N/A" : `${row.difficulty}/100`}</td>` : ""}<td><b>${label[level(row)]}</b></td><td>${money(row.lowTopOfPageBid)}</td><td>${money(row.highTopOfPageBid)}</td></tr>`).join("")}</tbody></table>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(client.name)} Keyword Research ${new Date().toISOString().slice(0, 10)}</title><style>
@page{size:A4;margin:16mm 14mm 18mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#2b3440;margin:0;font-size:12.5px;line-height:1.45}.wrap{max-width:820px;margin:0 auto;padding:36px 28px}
.navy{color:#1d3a63}.teal{color:#127a86}h1{font-size:34px;line-height:1.08;margin:0;color:#1d3a63;letter-spacing:.3px;text-transform:uppercase}h2{font-size:22px;color:#1d3a63;margin:22px 0 6px}h3{font-size:15px;color:#127a86;margin:16px 0 4px}p{margin:4px 0 8px}
.cover{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}.cover img{max-width:220px;max-height:90px;object-fit:contain}.sub{color:#6b7280;margin-top:6px}
.running{font-size:11px;font-weight:700;color:#1d3a63;letter-spacing:.4px;text-transform:uppercase;border-bottom:1px solid #dfe5ee;padding-bottom:8px;margin-bottom:6px}
table{width:100%;border-collapse:collapse;margin:8px 0}th{background:#1d3a63;color:#fff;text-align:left;font-size:11px;font-weight:700;padding:6px 7px;border:1px solid #1d3a63}td{padding:5px 7px;border:1px solid #d9dee6;font-size:11.5px}
tr.low td{background:#d9ecd5}tr.medium td{background:#fcefb9}tr.high td{background:#f5d3d3}tr.unknown td{background:#e6e8ec}
.summary td:first-child{font-weight:700}.strong{font-weight:700;color:#1d3a63}.small{font-size:10.5px;color:#6b7280}.legend span{display:inline-block;padding:2px 9px;border-radius:4px;margin-right:6px;font-weight:700;font-size:11px}
.page{page-break-before:always;break-before:page}.foot{margin-top:28px;border-top:1px solid #dfe5ee;padding-top:6px;font-size:10.5px;color:#6b7280}
.print{position:fixed;top:14px;right:14px;padding:10px 16px;border:0;border-radius:8px;background:#1d3a63;color:#fff;font-weight:700;cursor:pointer;z-index:9}@media print{.print{display:none}.wrap{padding:0;max-width:none}}
</style></head><body><button class="print" onclick="print()">Save as PDF / Print</button><div class="wrap">
<div class="cover"><div><h1>Your keyword<br>research plan</h1><div class="sub">${esc(client.name)} | Prepared for you | ${date}</div></div>${client.logo ? `<img src="${esc(client.logo)}" alt="${esc(client.name)}">` : ""}</div>
<h3>Your research settings</h3><p>Source: ${esc(keywordIdeas.source)} | ${esc(keywordIdeas.location)} | English${dfs ? "" : " | Google Search | EUR"}<br>Checked: ${date} | ${rows.length} keywords selected from ${keywordIdeas.results.length} ideas</p>
<h2>Keyword groups</h2><table class="summary"><thead><tr><th>Group</th><th>Theme</th><th>Keywords</th><th>Searches / month</th><th>Low / Med / High</th></tr></thead><tbody>${sorted.map((group, index) => `<tr><td>${letter(index)}</td><td>${esc(group.name)}</td><td>${group.list.length}</td><td>${group.total.toLocaleString("en-IE")}</td><td>${group.list.filter((row) => level(row) === "low").length} / ${group.list.filter((row) => level(row) === "medium").length} / ${group.list.filter((row) => level(row) === "high").length}</td></tr>`).join("")}</tbody></table>
<p class="strong">${total.toLocaleString("en-IE")} estimated searches a month across ${rows.length} keywords.${avgLow != null ? ` Typical top-of-page bids: ${money(avgLow)} – ${money(avgHigh)} per click.` : ""}</p>
<h3>Competition at a glance</h3><p class="legend"><span style="background:#d9ecd5">Low ${counts.low}</span><span style="background:#fcefb9">Medium ${counts.medium}</span><span style="background:#f5d3d3">High ${counts.high}</span><span style="background:#e6e8ec">Unknown ${counts.unknown}</span></p>
${quickWins.length ? `<h3>Quick wins</h3><p>Low-competition terms with real search demand: ${quickWins.map((row) => `<b>${esc(row.keyword)}</b> (${(row.avgMonthlySearches || 0).toLocaleString("en-IE")})`).join(", ")}.</p>` : ""}
<h3>What to expect</h3><p>Average monthly searches show demand, not clicks or leads. Top-of-page bids are historical estimates, not actual cost per click. N/A means no figure was available; it is not zero.</p>
${sorted.map((group, index) => `<section class="page"><div class="running">${esc(client.name)} | Keyword research</div><h2>Group ${letter(index)} | ${esc(group.name.replace(/^./, (c) => c.toUpperCase()))}</h2><p>${group.list.length} keyword${group.list.length === 1 ? "" : "s"} · ${group.total.toLocaleString("en-IE")} searches a month. Sorted by search volume.</p>${table(group.list)}</section>`).join("")}
<h3>Competition colours</h3><p class="small">Low = green | Medium = yellow | High = red | Unknown or N/A = grey. ${dfs ? "Ads competition is paid-search competition; organic difficulty is shown separately." : "These are Google Ads auction ratings, not SEO difficulty."}</p>
<p class="small">Source: ${esc(keywordIdeas.source)}, ${esc(keywordIdeas.location)}, checked ${date}. Read-only research: no campaigns, budgets, bids or keywords were changed.</p>
<div class="foot">Prepared ${date} | Read-only research</div></div></body></html>`;
    const win = window.open("", "_blank"); if (!win) { setKeywordError("Allow pop-ups for this site to open the report."); return; }
    win.document.open(); win.document.write(html); win.document.close();
  };
  const localRankForm = localRankFormState.clientId === clientId ? localRankFormState : { clientId, keywords: "", location: client?.seoLocations?.[0] ? `${client.seoLocations[0]}, Ireland` : "", businessName: client?.name || "", domain: client?.wordpressSiteUrl || client?.website || "" };
  const setLocalRankForm = (patch: Partial<typeof localRankForm>) => setLocalRankFormState({ ...localRankForm, ...patch, clientId });
  const pageOpportunities = useMemo(() => suggestSeoPageOpportunities(client?.seoServices || [], client?.seoLocations || [], contentInventory?.pages || []), [client?.seoServices, client?.seoLocations, contentInventory?.pages]);

  useEffect(() => {
    if (!active || !vis("Local SEO") || !clientId || !canManageMappings) return;
    let cancelled = false;
    void fetch(`/api/seo/local-rank?clientId=${encodeURIComponent(clientId)}`).then(async (response) => {
      const payload = await response.json() as LocalRankData;
      if (!response.ok) throw new Error(payload.message || "Could not load saved Maps rankings.");
      if (!cancelled) { setLocalRankStatus(payload.message || payload.status || ""); setLocalRankHistory(payload.history || []); }
    }).catch((reason) => { if (!cancelled) setLocalRankStatus(reason instanceof Error ? reason.message : "Could not load local ranking history."); });
    return () => { cancelled = true; };
  }, [active, visKey, clientId, canManageMappings]);


  useEffect(() => {
    if (!active || !vis("Keyword ideas") || !clientId || !canManageMappings) return;
    let cancelled = false;
    void fetch(`/api/seo/keywords?clientId=${encodeURIComponent(clientId)}`).then(async (response) => {
      const payload = await response.json() as { status?: string; message?: string; history?: KeywordResearchHistory[]; competitorHistory?: CompetitorResearchRun[] };
      if (!response.ok) throw new Error(payload.message || "Could not load saved keyword research.");
      if (!cancelled) { setDataForSeoKeywordStatus(payload.message || payload.status || ""); setKeywordResearchHistory(payload.history || []); setCompetitorResearchHistory(payload.competitorHistory || []); }
    }).catch((reason) => { if (!cancelled) setDataForSeoKeywordStatus(reason instanceof Error ? reason.message : "Could not load DataForSEO status."); });
    return () => { cancelled = true; };
  }, [active, visKey, clientId, canManageMappings]);

  useEffect(() => {
    if (!active || !clientId || !(["Performance", "Queries", "Keyword ideas", "Pages & content", "Setup"] as Tab[]).some(vis)) {
      setLoading(false);
      setError("");
      return;
    }
    if (range === "custom" && !customDatesReady) {
      setLoading(false); setSearch(null); setAnalytics(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true); setError(""); setSearch(null); setAnalytics(null);
    const dateParams = range === "custom" ? `&from=${encodeURIComponent(customFrom)}&to=${encodeURIComponent(customTo)}` : "";
    const searchRequest = fetch(`/api/seo?clientId=${encodeURIComponent(clientId)}&range=${range}${dateParams}`, { signal: controller.signal }).then(async (response) => {
      const payload = await response.json() as SeoPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load Search Console data.");
      return payload;
    });
    const analyticsRequest = fetch(`/api/analytics?clientId=${encodeURIComponent(clientId)}&range=${range}${dateParams}`, { signal: controller.signal }).then(async (response) => {
      const payload = await response.json() as Analytics & { error?: string };
      if (!response.ok) return { status: "unavailable", message: payload.error || "Could not load Analytics data." };
      return payload;
    }).catch(() => ({ status: "unavailable", message: "Could not reach Google Analytics." }));
    void Promise.all([searchRequest, analyticsRequest]).then(([searchPayload, analyticsPayload]) => {
      if (cancelled) return;
      setSearch(searchPayload); setAnalytics(analyticsPayload);
    }).catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load SEO data."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  }, [active, clientId, range, customFrom, customTo, customDatesReady, visKey, client?.googleSearchConsoleAccountId, client?.googleAnalyticsAccountId]);

  useEffect(() => {
    if (!active || !vis("Local SEO") || !clientId) return;
    setLocalSeo(null);
    if (range === "custom" && !customDatesReady) return;
    let cancelled = false;
    const dateParams = range === "custom" ? `&from=${encodeURIComponent(customFrom)}&to=${encodeURIComponent(customTo)}` : "";
    void fetch(`/api/local-seo?clientId=${encodeURIComponent(clientId)}&range=${range}${dateParams}`).then(async (response) => {
      const payload = await response.json() as LocalSeoData;
      if (!response.ok) throw new Error(payload.message || "Could not load Business Profile data.");
      return payload;
    }).then((payload) => { if (!cancelled) setLocalSeo(payload); }).catch((reason) => {
      if (!cancelled) setLocalSeo({ status: "unavailable", message: reason instanceof Error ? reason.message : "Could not load Business Profile data." });
    });
    return () => { cancelled = true; };
  }, [active, visKey, clientId, range, customFrom, customTo, customDatesReady, client?.googleBusinessProfileAccountId, client?.googleBusinessProfileLocationId]);

  useEffect(() => {
    if (!active || !vis("Pages & content") || !clientId || !canOpenSites || !client?.wordpressSiteUrl) {
      setContentInventoryLoading(false);
      return;
    }
    const controller = new AbortController();
    setContentInventory(null); setContentInventoryError(""); setContentInventoryLoading(true);
    void fetch(`/api/sites?clientId=${encodeURIComponent(clientId)}&page=${contentInventoryPage}`, { signal: controller.signal }).then(async (response) => {
      const payload = await response.json() as SeoInventory & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load WordPress pages.");
      return payload;
    }).then((payload) => { if (!controller.signal.aborted) setContentInventory(payload); }).catch((reason) => {
      if (!controller.signal.aborted) setContentInventoryError(reason instanceof Error ? reason.message : "Could not load the WordPress page inventory.");
    }).finally(() => { if (!controller.signal.aborted) setContentInventoryLoading(false); });
    return () => controller.abort();
  }, [active, visKey, clientId, canOpenSites, client?.wordpressSiteUrl, contentInventoryPage, contentInventoryReload]);

  useEffect(() => {
    if (!active || !vis("Backlinks") || !clientId) return;
    let cancelled = false;
    setBacklinkData(null); setBacklinkError(""); setBacklinkConsent(false);
    try { setBacklinkTarget(client?.wordpressSiteUrl ? new URL(client.wordpressSiteUrl).hostname.replace(/^www\./, "") : ""); } catch { setBacklinkTarget(""); }
    void fetch(`/api/seo/backlinks?clientId=${encodeURIComponent(clientId)}`).then(async (response) => {
      const payload = await response.json() as BacklinkData;
      if (!response.ok) throw new Error(payload.message || "Could not check DataForSEO connection status.");
      return payload;
    }).then((payload) => { if (!cancelled) setBacklinkData(payload); }).catch((reason) => {
      if (!cancelled) setBacklinkData({ status: "unavailable", message: reason instanceof Error ? reason.message : "Could not check the backlink connection." });
    });
    return () => { cancelled = true; };
  }, [active, visKey, clientId, client?.wordpressSiteUrl]);

  useEffect(() => {
    if (!active || !vis("Backlinks") || !clientId) return;
    let cancelled = false;
    void fetch(`/api/seo/backlinks/outreach?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" }).then(async (response) => {
      const payload = await response.json() as { opportunities?: BacklinkOutreach[]; message?: string };
      if (!response.ok) throw new Error(payload.message || "Backlink follow-ups could not be loaded.");
      if (!cancelled) { setBacklinkOutreach(payload.opportunities || []); setBacklinkOutreachError(""); }
    }).catch((reason) => { if (!cancelled) setBacklinkOutreachError(reason instanceof Error ? reason.message : "Backlink follow-ups could not be loaded."); });
    return () => { cancelled = true; };
  }, [active, visKey, clientId]);

  async function loadSearchConsoleProperties() {
    if (!clientId || propertiesLoading) return;
    setPropertiesLoading(true); setPropertiesStatus("");
    try {
      const response = await fetch(`/api/seo?clientId=${encodeURIComponent(clientId)}&properties=1`);
      const payload = await response.json() as { properties?: SearchProperty[]; message?: string };
      if (!response.ok) throw new Error(payload.message || "Could not list Search Console properties.");
      const found = payload.properties || [];
      const current = found.find((item) => item.id === client?.googleSearchConsoleAccountId)?.id || "";
      setProperties(found); setSelectedPropertyId(current);
      setPropertiesStatus(found.length ? `${found.length} connected property${found.length === 1 ? "" : "ies"} found. ${current ? "The saved property is selected; confirm it matches this client’s website." : "Choose the property that matches this client’s website. Nothing is preselected."}` : "No Search Console properties were found. Connect the Google account that can access your clients’ properties.");
    } catch (reason) { setPropertiesStatus(reason instanceof Error ? reason.message : "Could not list Search Console properties."); }
    finally { setPropertiesLoading(false); }
  }

  async function mapSelectedProperty() {
    if (!client || !selectedPropertyId || mappingSaving) return;
    setMappingSaving(true);
    try {
      const saved = await onMapSearchConsole(client.id, selectedPropertyId);
      if (saved) setPropertiesStatus(`Search Console property saved for ${client.name}.`);
    } finally { setMappingSaving(false); }
  }

  async function loadAnalyticsProperties() {
    if (!clientId || analyticsPropertiesLoading) return;
    setAnalyticsPropertiesLoading(true); setAnalyticsPropertiesStatus("");
    try {
      const response = await fetch(`/api/analytics?clientId=${encodeURIComponent(clientId)}&properties=1`);
      const payload = await response.json() as { properties?: SearchProperty[]; message?: string };
      if (!response.ok || payload.message) throw new Error(payload.message || "Could not list GA4 properties.");
      const found = payload.properties || [];
      const current = found.find((item) => item.id === client?.googleAnalyticsAccountId)?.id || "";
      setAnalyticsProperties(found); setSelectedAnalyticsPropertyId(current);
      setAnalyticsPropertiesStatus(found.length ? `${found.length} connected GA4 propert${found.length === 1 ? "y" : "ies"} found. ${current ? "The saved property is selected; confirm it belongs to this client." : "Choose the property that belongs to this client. Nothing is preselected."}` : "No GA4 properties were returned by Windsor. Connect and select them in Windsor first.");
    } catch (reason) { setAnalyticsPropertiesStatus(reason instanceof Error ? reason.message : "Could not list GA4 properties."); }
    finally { setAnalyticsPropertiesLoading(false); }
  }

  async function mapSelectedAnalyticsProperty() {
    if (!client || !selectedAnalyticsPropertyId || analyticsMappingSaving) return;
    setAnalyticsMappingSaving(true);
    try {
      const saved = await onMapAnalytics(client.id, selectedAnalyticsPropertyId);
      if (saved) setAnalyticsPropertiesStatus(`GA4 property saved for ${client.name}.`);
    } finally { setAnalyticsMappingSaving(false); }
  }

  async function loadBusinessAccounts() {
    if (!clientId || businessBusy) return;
    setBusinessBusy(true); setBusinessStatus("");
    try {
      const response = await fetch(`/api/local-seo?clientId=${encodeURIComponent(clientId)}&accounts=1`);
      const payload = await response.json() as { accounts?: BusinessAccount[]; message?: string; error?: string };
      if (!response.ok || payload.message) throw new Error(payload.message || payload.error || "Could not list Business Profile accounts.");
      const found = payload.accounts || []; setBusinessAccounts(found);
      const chosen = found.find((item) => item.id === client?.googleBusinessProfileAccountId)?.id || "";
      setBusinessAccountId(chosen); setBusinessLocations([]); setBusinessLocationId("");
      setBusinessStatus(found.length ? `${found.length} connected Business Profile account${found.length === 1 ? "" : "s"} found. ${chosen ? "The saved account is selected." : "Choose the correct account for this client. Nothing is preselected."}` : "No Business Profile accounts are connected in Windsor yet.");
      if (chosen) await loadBusinessLocations(chosen);
    } catch (reason) { setBusinessStatus(reason instanceof Error ? reason.message : "Could not list Business Profile accounts."); }
    finally { setBusinessBusy(false); }
  }

  async function loadBusinessLocations(accountId: string) {
    if (!accountId) return;
    setBusinessAccountId(accountId); setBusinessLocationId(""); setBusinessLocations([]);
    const response = await fetch(`/api/local-seo?clientId=${encodeURIComponent(clientId)}&locations=1&accountId=${encodeURIComponent(accountId)}`);
    const payload = await response.json() as { locations?: BusinessLocation[]; message?: string; error?: string };
    if (!response.ok || payload.message) throw new Error(payload.message || payload.error || "Could not list Business Profile locations.");
    const found = payload.locations || []; setBusinessLocations(found);
    const selected = accountId === client?.googleBusinessProfileAccountId
      ? found.find((item) => item.id === client?.googleBusinessProfileLocationId)?.id || ""
      : "";
    setBusinessLocationId(selected);
    setBusinessStatus(found.length ? `${found.length} location${found.length === 1 ? "" : "s"} found. ${selected ? "The saved location is selected; confirm it matches this client." : "Choose the exact location for this client. Nothing is preselected."}` : "No locations were returned for this connected account.");
  }

  async function saveBusinessProfileMapping() {
    if (!client || !businessAccountId || !businessLocationId || businessSaving) return;
    setBusinessSaving(true);
    try {
      const saved = await onMapBusinessProfile(client.id, businessAccountId, businessLocationId);
      if (saved) setBusinessStatus(`Business Profile location saved for ${client.name}.`);
    } finally { setBusinessSaving(false); }
  }

  async function runKeywordResearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || keywordLoading) return;
    setKeywordLoading(true); setKeywordError(""); setKeywordIdeas(null);
    try {
      const seeds = keywordSeeds.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean).slice(0, 10);
      const response = keywordSource === "dataforseo"
        ? await fetch("/api/seo/keywords", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: client.id, seeds, location: keywordLocation, acknowledgeProviderCharge: keywordChargeConsent }) })
        : await fetch("/api/seo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: client.id, seeds, url: keywordUrl, geo: keywordGeo }) });
      const payload = await response.json() as KeywordIdeasPayload & { error?: string; message?: string; status?: string; history?: KeywordResearchHistory[] };
      if (!response.ok) throw new Error(payload.error || payload.message || "Keyword research could not be completed.");
      setKeywordIdeas(payload); setShowAllKeywordIdeas(false); setPickedKeywords(new Set());
      if (keywordSource === "dataforseo") setKeywordResearchHistory((current) => [{ id: payload.historyId || crypto.randomUUID(), createdAt: payload.updatedAt || new Date().toISOString(), location: payload.location, seeds, costUsd: payload.providerCostUsd ?? null, results: payload.results }, ...current].slice(0, 20));
    } catch (reason) { setKeywordError(reason instanceof Error ? reason.message : "Keyword research could not be completed."); }
    finally { setKeywordLoading(false); }
  }

  async function runCompetitorResearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || competitorResearchLoading) return;
    setCompetitorResearchLoading(true); setCompetitorResearchError(""); setCompetitorResearchResult(null);
    try {
      const competitors = competitorDomains.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean).slice(0, 3);
      const response = await fetch("/api/seo/keywords", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "competitor_gaps", clientId: client.id, competitors, location: keywordLocation, acknowledgeProviderCharge: competitorChargeConsent }) });
      const payload = await response.json() as { status?: string; error?: string; message?: string; clientId: string; clientDomain: string; location: string; competitors: CompetitorKeywordResult[]; updatedAt: string; historyId: string; providerCostUsd: number | null; dataNote: string };
      if (!response.ok) throw new Error(payload.error || payload.message || "Competitor keyword research could not be completed.");
      setCompetitorResearchResult({ id: payload.historyId, createdAt: payload.updatedAt, location: payload.location, clientDomain: payload.clientDomain, requestCount: payload.competitors.length, costUsd: payload.providerCostUsd, competitors: payload.competitors });
      const refreshed = await fetch(`/api/seo/keywords?clientId=${encodeURIComponent(client.id)}`, { cache: "no-store" });
      if (refreshed.ok) { const history = await refreshed.json() as { competitorHistory?: CompetitorResearchRun[] }; setCompetitorResearchHistory(history.competitorHistory || []); }
      setCompetitorChargeConsent(false);
    } catch (reason) { setCompetitorResearchError(reason instanceof Error ? reason.message : "Competitor keyword research could not be completed."); }
    finally { setCompetitorResearchLoading(false); }
  }

  async function runLocalRankCheck() {
    if (!client || localRankLoading) return;
    setLocalRankLoading(true); setLocalRankError(""); setLocalRankResult(null);
    try {
      const keywords = localRankForm.keywords.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean).slice(0, 5);
      const response = await fetch("/api/seo/local-rank", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: client.id, keywords, location: localRankForm.location, businessName: localRankForm.businessName, domain: localRankForm.domain, acknowledgeProviderCharge: localRankConsent }) });
      const payload = await response.json() as LocalRankData;
      if (!response.ok) throw new Error(payload.message || "Google Maps rank check could not be completed.");
      setLocalRankResult(payload);
      const refreshed = await fetch(`/api/seo/local-rank?clientId=${encodeURIComponent(client.id)}`, { cache: "no-store" });
      if (refreshed.ok) { const history = await refreshed.json() as { history?: LocalRankHistory[]; message?: string }; setLocalRankHistory(history.history || []); setLocalRankStatus(history.message || ""); }
      setLocalRankConsent(false);
    } catch (reason) { setLocalRankError(reason instanceof Error ? reason.message : "Google Maps rank check could not be completed."); }
    finally { setLocalRankLoading(false); }
  }

  function createLocalRankTask(item: LocalMapsRank) {
    if (!client || !localRankResult) return;
    const notes = `Client: ${client.name}\nSource: DataForSEO Google Maps live results\nSearch phrase: ${item.keyword}\nLocation: ${item.location}\nBusiness listing match: ${item.matchedBy || "not found in the top 20 returned listings"}\nMaps rank: ${item.rank == null ? "not found in the top 20" : `#${item.rank}`}\nBusiness Profile match: ${item.businessName}\nDomain match: ${item.domain || "not supplied"}\nRating: ${item.rating == null ? "not returned" : `${item.rating}/5 from ${number(item.reviewCount)} reviews`}\nTop competitors: ${item.competitors.map((row) => `#${row.rank} ${row.name}${row.domain ? ` (${row.domain})` : ""}`).join("; ") || "not returned"}\nProvider-reported cost: ${localRankResult.providerCostUsd == null ? "not supplied" : `$${localRankResult.providerCostUsd.toFixed(5)} USD`}\nChecked: ${localRankResult.updatedAt || "unknown"}\n\nThis is one desktop Google Maps snapshot for one selected area, not a universal rank or a verified lead result. Review the exact listing and area before making recommendations.`;
    onCreateTask(client.id, `Review Google Maps visibility: ${item.keyword}`, notes, "Confirm the client listing and target service area are matched correctly\nCompare the saved Maps position with the previous check for the same area\nReview the listed competitors and supporting Business Profile data\nRecommend specific, legitimate local SEO actions with evidence\nDo not promise ranking gains or make profile changes without approval");
  }

  async function runBacklinkCheck() {
    if (!client || backlinkLoading || !backlinkConsent) return;
    setBacklinkLoading(true); setBacklinkError(""); setBacklinkData(null);
    try {
      const response = await fetch(`/api/seo/backlinks?clientId=${encodeURIComponent(client.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: backlinkTarget, acknowledgeProviderCharge: true }) });
      const payload = await response.json() as BacklinkData;
      if (!response.ok) throw new Error(payload.message || "Backlink research could not be completed.");
      setBacklinkData(payload);
    } catch (reason) { setBacklinkError(reason instanceof Error ? reason.message : "Backlink research could not be completed."); }
    finally { setBacklinkLoading(false); }
  }

  async function trackBacklink(item: BacklinkItem) {
    if (!client || backlinkOutreachBusyId) return;
    setBacklinkOutreachBusyId(item.urlFrom); setBacklinkOutreachError("");
    try {
      const response = await fetch(`/api/seo/backlinks/outreach?clientId=${encodeURIComponent(client.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceUrl: item.urlFrom, targetUrl: item.urlTo, sourceDomain: item.domainFrom, anchor: item.anchor || "" }) });
      const payload = await response.json() as { opportunity?: BacklinkOutreach; message?: string };
      if (!response.ok || !payload.opportunity) throw new Error(payload.message || "Could not save this opportunity.");
      setBacklinkOutreach((rows) => [payload.opportunity!, ...rows.filter((row) => row.id !== payload.opportunity!.id)]);
    } catch (reason) { setBacklinkOutreachError(reason instanceof Error ? reason.message : "Could not save this opportunity."); }
    finally { setBacklinkOutreachBusyId(""); }
  }

  async function saveBacklinkOutreach(item: BacklinkOutreach) {
    if (!client || backlinkOutreachBusyId) return;
    setBacklinkOutreachBusyId(item.id); setBacklinkOutreachError("");
    try {
      const response = await fetch(`/api/seo/backlinks/outreach?clientId=${encodeURIComponent(client.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(item) });
      const payload = await response.json() as { opportunity?: BacklinkOutreach; message?: string };
      if (!response.ok || !payload.opportunity) throw new Error(payload.message || "Could not save this follow-up.");
      setBacklinkOutreach((rows) => rows.map((row) => row.id === item.id ? payload.opportunity! : row));
    } catch (reason) { setBacklinkOutreachError(reason instanceof Error ? reason.message : "Could not save this follow-up."); }
    finally { setBacklinkOutreachBusyId(""); }
  }

  function createBacklinkTask() {
    if (!client || !backlinkData?.summary) return;
    const item = backlinkData.summary;
    const changes = backlinkData.changes;
    const notes = `Client: ${client.name}\nTarget: ${item.target}\nSource: DataForSEO backlink index\nBacklinks: ${number(item.backlinks)}\nReferring domains: ${number(item.referringDomains)}\nBroken backlinks: ${number(item.brokenBacklinks)}\nNew/lost backlinks in period: ${changes ? `${number(changes.backlinksNew)} new / ${number(changes.backlinksLost)} lost (${changes.startDate} to ${changes.endDate})` : "not supplied"}\nProvider reported cost: ${backlinkData.providerCostUsd == null ? "not supplied" : `$${backlinkData.providerCostUsd.toFixed(5)} USD`}\nChecked: ${backlinkData.updatedAt || "unknown"}\n\nThese are third-party link index measurements, not Google Search Console data. Review relevance and legitimacy before recommending outreach or a link action.`;
    onCreateTask(client.id, `Review backlink profile: ${item.target}`, notes, "Check the referring pages are relevant and legitimate\nReview broken backlinks and the pages they point to\nIdentify one useful recovery or partnership opportunity\nDo not buy links or mass-submit directories\nBring any outreach or website changes back for approval");
  }

  function makeKeywordTask(row: KeywordIdea) {
    if (!client || !keywordIdeas) return;
    const context = `Client: ${client.name}\nSource: ${keywordIdeas.source}\nLocation: ${keywordIdeas.location}\nKeyword: ${row.keyword}\nAverage monthly searches: ${row.avgMonthlySearches == null ? "not supplied" : row.avgMonthlySearches.toLocaleString("en-IE")}\nPaid competition: ${row.competition}${row.competitionIndex == null ? "" : ` (${row.competitionIndex}/100)`}\nOrganic SEO difficulty: ${row.difficulty == null ? "not supplied" : `${row.difficulty}/100`}\n${row.lowTopOfPageBid == null || row.highTopOfPageBid == null ? "Top of page bid: not supplied" : `Top of page bid estimate: ${row.lowTopOfPageBid.toFixed(2)}–${row.highTopOfPageBid.toFixed(2)}`}\n\nThese are provider estimates, not actual rankings or guaranteed traffic. Review relevance to the client’s services before recommending a page or campaign change.`;
    onCreateTask(client.id, `Review SEO keyword: ${row.keyword}`, context, "Check the keyword fits the client’s services and target area\nReview existing pages and Search Console evidence\nRecommend a specific next step with evidence\nGet approval before changing the site or ads");
  }

  const current = search?.current;
  const prior = search?.previous?.totals;
  const peak = Math.max(1, ...(current?.daily || []).map((item) => item.clicks));
  const makeTask = (kind: "query" | "page", row: SeoRow) => {
    const itemUrl = kind === "page" ? row.name : "Search query: " + row.name;
    const context = `Client: ${client?.name || ""}\nSearch Console property: ${client?.googleSearchConsoleAccountId || "Not mapped"}\nDate range: ${search?.dateWindow?.current.start || ""} to ${search?.dateWindow?.current.end || ""}\n${kind === "page" ? "Page URL" : "Query"}: ${row.name}\nClicks: ${row.clicks}\nImpressions: ${row.impressions}\nCTR: ${row.ctr == null ? "Not available" : (row.ctr * 100).toFixed(2) + "%"}\nAverage position: ${row.averagePosition == null ? "Not available" : row.averagePosition.toFixed(1)}\n\nReview this real Search Console evidence and propose a suitable SEO improvement. Do not claim an outcome before it is verified.`;
    onCreateTask(clientId, `Review SEO ${kind}: ${itemUrl}`, context, "Review the Search Console evidence\nIdentify a specific improvement opportunity\nPrepare the change for review\nVerify the live page or result after approval");
  };

  return <main className="page-heading seo-view">
    {(!embedded || visibleTabs.some((item) => item === "Performance" || item === "Queries" || item === "Pages & content" || item === "Local SEO")) && <header className={`seo-view-heading ${embedded ? "is-embedded" : ""}`}>{!embedded && <div><p className="eyebrow">🔎 CLIENT SEARCH WORKSPACE</p><h1>SEO</h1><p className="muted">Live Search Console and Analytics data, page opportunities and technical checks.</p></div>}<div className="seo-view-controls">{clients.length > 1 && !embedded && <label><span>Client</span><select aria-label="Choose SEO client" value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">Choose a client</option>{available.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}<label><span>Date range</span><select aria-label="Choose SEO date range" value={range} onChange={(event) => setRange(event.target.value)}><option value="last_7d">Last 7 days</option><option value="last_30d">Last 30 days</option><option value="last_90d">Last 90 days</option><option value="custom">Custom dates</option></select></label>{range === "custom" && <><label><span>From</span><input aria-label="SEO start date" type="date" value={customFrom} max={customTo || undefined} onChange={(event) => setCustomFrom(event.target.value)} /></label><label><span>To</span><input aria-label="SEO end date" type="date" value={customTo} min={customFrom || undefined} onChange={(event) => setCustomTo(event.target.value)} /></label></>}</div></header>}
    {range === "custom" && !customDatesReady && <p className="seo-data-message" role="status">Choose a start date and end date. Custom ranges can cover up to 366 days.</p>}
    {!client && <section className="seo-status-card"><b>Add a client website or analytics property first</b><p>Save the client’s website URL, Search Console property ID or GA4 account ID in Clients to show its data here.</p></section>}
    {client && <>
      {!sections && <nav className="seo-tabs" role="tablist" aria-label="SEO sections">{tabs.map((item) => <button type="button" role="tab" aria-selected={tab === item} className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}</button>)}</nav>}
      {vis("Setup") && <MarketingSetupWizard kind="seo" clientId={client.id} clientName={client.name} canEdit={canManageMappings} canOpenSites={canOpenSites} agents={agents.filter((agent) => agent.isBot)} onOpenTaskList={onOpenTaskList} onOpenSites={onOpenSites} onOpenTool={(stepId) => { const destinations: Record<string, Tab> = { connections: "Performance", business_research: "Performance", technical_audit: "Technical", keyword_research: "Keyword ideas", keyword_mapping: "Pages & content", content_strategy: "Pages & content", content_creation: "Pages & content", on_page: "Pages & content", local_seo: "Local SEO", backlinks: "Backlinks", tracking_review: "Performance" }; setTab(destinations[stepId] || "Performance"); }} />}
      {hasNonSetup && showAudit && <MarketingAuditPanel clientId={client.id} clientName={client.name} service="SEO" period={search?.dateWindow ? `${search.dateWindow.current.start} to ${search.dateWindow.current.end}` : range.replaceAll("_", " ")} status={search?.status === "connected" || analytics?.status === "connected" ? "connected" : search?.status === "no_data" || analytics?.status === "no_data" ? "no_data" : "unavailable"} data={{ search, analytics }} history={auditRuns} canRunAudit={canRunAudit} onSave={onSaveAudit} onCreateTask={(title, notes) => onCreateAuditTask(client.id, title, notes)} />}
      {hasNonSetup && error && <section className="seo-status-card error" role="alert"><b>Couldn’t load this SEO data</b><p>{error}</p></section>}
      {hasNonSetup && loading && <section className="seo-status-card" role="status">Loading live client data…</section>}
      {!loading && !error && vis("Performance") && <>
        <section className="seo-data-panel"><div className="seo-data-heading"><div><h2>Google Search Console</h2><p>{search?.propertyId || client.googleSearchConsoleAccountId || "Search Console property not mapped"} · {search?.dateWindow ? `${search.dateWindow.current.start} to ${search.dateWindow.current.end}` : range.replaceAll("_", " ")}</p></div><span className={`seo-connection-state ${search?.status === "connected" ? "connected" : ""}`}>{search?.status === "connected" ? `Live · ${search.dataSource || "Search Console"}` : search?.status === "no_data" ? "No rows returned" : search?.status === "not_mapped" ? "Property not mapped" : search?.status === "source_not_connected" ? "Windsor source not connected" : search?.status === "missing_connection" ? "Connection needed" : search?.status === "unavailable" ? "Unavailable" : "Checking"}</span></div>
          {canManageMappings && <div className="seo-property-map"><div><b>Connect this client’s Search Console property</b><small>Connect Google Search Console, load the sites this Google account can access, then choose the one that matches this client’s website.</small></div><a className="secondary-button" href="/api/search-console/connect">Connect Google account</a><button type="button" className="secondary-button" disabled={propertiesLoading} onClick={() => void loadSearchConsoleProperties()}>{propertiesLoading ? "Loading…" : properties.length ? "↻ Refresh properties" : "Find properties"}</button>{properties.length > 0 && <><label><span>Search Console property</span><select value={selectedPropertyId} onChange={(event) => setSelectedPropertyId(event.target.value)}><option value="">Choose a property</option>{properties.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select></label><button type="button" className="primary-button" disabled={!selectedPropertyId || mappingSaving || selectedPropertyId === client.googleSearchConsoleAccountId} onClick={() => void mapSelectedProperty()}>{mappingSaving ? "Saving…" : selectedPropertyId === client.googleSearchConsoleAccountId ? "Property already mapped" : "Save property to this client"}</button></>}{propertiesStatus && <small role="status">{propertiesStatus}</small>}{propertiesStatus.startsWith("No Search Console properties") && <a className="seo-external-connect" href="https://onboard.windsor.ai/app/searchconsole" target="_blank" rel="noreferrer">Connect Google Search Console in Windsor ↗</a>}</div>}
          {search?.status !== "connected" && <p className="seo-data-message">{search?.message || "Connect Search Console in Windsor, then enter the exact site property ID in this client’s record."}</p>}
          {current && <><div className="seo-metric-grid">{[
            ["Search clicks", number(current.totals.clicks), change(current.totals.clicks, prior?.clicks)], ["Impressions", number(current.totals.impressions), change(current.totals.impressions, prior?.impressions)], ["Click-through rate", current.totals.ctr == null ? "—" : (current.totals.ctr * 100).toFixed(2) + "%", change(current.totals.ctr, prior?.ctr)], ["Average position", number(current.totals.averagePosition), change(current.totals.averagePosition, prior?.averagePosition, true)],
          ].map(([label, value, delta]) => <article className="seo-metric" key={label}><span>{label}</span><b>{value}</b><small>{delta}</small></article>)}</div><MarketingSnapshotHistory service="Search Console" snapshots={search?.snapshots} metrics={[{ label: "Search clicks", path: ["current", "totals", "clicks"] }, { label: "Impressions", path: ["current", "totals", "impressions"] }]} /><div className="seo-trend-panel"><div><b>Daily search clicks</b><span>{current.daily.length} days returned by Search Console</span></div><div className="seo-bar-chart" role="img" aria-label="Daily Search Console clicks"><div>{current.daily.map((item) => <span key={item.date} title={`${item.date}: ${item.clicks} clicks`} style={{ height: `${Math.max(3, item.clicks / peak * 100)}%` }} />)}</div><small>{current.daily[0]?.date || ""}<span>{current.daily[current.daily.length - 1]?.date || ""}</span></small></div></div><p className="seo-data-footnote">{search?.dataNote}{current.mayBeLimited ? search?.dataSource === "Google Search Console" ? " Google Search Console reached its 50,000-row API page limit; query and page detail may be incomplete." : " The Windsor connector reached its 1,000-row limit, so query and page tables may be incomplete." : ""}</p></>}
        </section>
        <section className="seo-data-panel"><div className="seo-data-heading"><div><h2>Google Analytics 4</h2><p>{analytics?.accountName || client.googleAnalyticsAccountId || "GA4 property not mapped"} · {analytics?.dateWindow ? `${analytics.dateWindow.current.start} to ${analytics.dateWindow.current.end}` : range.replaceAll("_", " ")}</p></div><span className={`seo-connection-state ${analytics?.status === "connected" ? "connected" : ""}`}>{analytics?.status === "connected" ? "Live data" : analytics?.status === "no_data" ? "No rows returned" : analytics?.status === "not_mapped" ? "Property not mapped" : analytics?.status === "unavailable" ? "Unavailable" : "Status"}</span></div>
          {canManageMappings && <div className="seo-property-map"><div><b>Connect this client’s GA4 property</b><small>Find properties available to your Google login or Windsor, then link the exact property to this client.</small></div><a className="secondary-button" href="/api/search-console/connect">Connect Google directly</a><button type="button" className="secondary-button" disabled={analyticsPropertiesLoading} onClick={() => void loadAnalyticsProperties()}>{analyticsPropertiesLoading ? "Loading…" : analyticsProperties.length ? "↻ Refresh properties" : "Find properties"}</button>{analyticsProperties.length > 0 && <><label><span>GA4 property</span><select value={selectedAnalyticsPropertyId} onChange={(event) => setSelectedAnalyticsPropertyId(event.target.value)}><option value="">Choose a property</option>{analyticsProperties.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select></label><button type="button" className="primary-button" disabled={!selectedAnalyticsPropertyId || analyticsMappingSaving || selectedAnalyticsPropertyId === client.googleAnalyticsAccountId} onClick={() => void mapSelectedAnalyticsProperty()}>{analyticsMappingSaving ? "Saving…" : selectedAnalyticsPropertyId === client.googleAnalyticsAccountId ? "Property already mapped" : "Save property to this client"}</button></>}{analyticsPropertiesStatus && <small role="status">{analyticsPropertiesStatus}</small>}{analyticsPropertiesStatus.startsWith("No GA4 properties") && <a className="seo-external-connect" href="https://onboard.windsor.ai/app/googleanalytics4" target="_blank" rel="noreferrer">Connect Google Analytics 4 in Windsor ↗</a>}</div>}
          {analytics?.status === "connected" && analytics.totals ? <><h3 className="seo-subheading">All channels</h3><div className="seo-metric-grid">{[["Sessions", analytics.totals.sessions], ["Active users", analytics.totals.active_users], ["Engaged sessions", analytics.totals.engaged_sessions], ["Key events", analytics.totals.conversions]].map(([label, value]) => <article className="seo-metric" key={label}><span>{label}</span><b>{number(value as number | null)}</b><small>{change(value as number | null, analytics.previousTotals?.[label === "Sessions" ? "sessions" : label === "Active users" ? "active_users" : label === "Engaged sessions" ? "engaged_sessions" : "conversions"])}</small></article>)}</div><h3 className="seo-subheading">Organic Search</h3>{analytics.organicTotals ? <div className="seo-metric-grid"><article className="seo-metric"><span>Organic sessions</span><b>{number(analytics.organicTotals.sessions)}</b><small>{change(analytics.organicTotals.sessions, analytics.previousOrganicTotals?.sessions)}</small></article><article className="seo-metric"><span>Organic key events</span><b>{number(analytics.organicTotals.conversions)}</b><small>{change(analytics.organicTotals.conversions, analytics.previousOrganicTotals?.conversions)}</small></article></div> : <p className="seo-data-message">Organic Search channel breakdown is unavailable for this range.</p>}<MarketingSnapshotHistory service="GA4" snapshots={analytics.snapshots} metrics={[{ label: "All-channel sessions", path: ["totals", "sessions"] }, { label: "Organic sessions", path: ["organicTotals", "sessions"] }, { label: "Organic key events", path: ["organicTotals", "conversions"] }]} /><p className="seo-data-footnote">{analytics.dataNote}</p></> : <p className="seo-data-message">{analytics?.message || "Add this client’s GA4 account ID and confirm its property is connected in Windsor."}</p>}</section>
      </>}
      {!loading && !error && vis("Queries") && <section className="seo-data-panel"><div className="seo-data-heading"><div><h2>Queries people searched</h2><p>Search Console queries are the available keyword evidence. They are not a substitute for keyword volume research or rank tracking.</p></div></div>
        {(() => {
          const history = [...(search?.snapshots || [])].filter((item) => item.status === "connected").sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
          const latest = history.at(-1);
          const previous = history.at(-2);
          const latestRows = snapshotQueries(latest);
          const previousRows = snapshotQueries(previous);
          const comparison = previous ? compareSearchConsoleQueryPositions(latestRows, previousRows) : [];
          return <section className="seo-query-history"><div className="seo-data-heading"><div><h3>📈 Search visibility history</h3><p>Same rolling 30-day window, saved once per day. Search Console average position is not a fixed-location rank check.</p></div><span className="seo-connection-state">{latest ? `Latest: ${latest.snapshotDate}` : "No saved history"}</span></div>
            {!latest ? <p className="seo-data-message">The daily sync has not saved a connected Search Console snapshot for this client yet.</p> : !previous ? <p className="seo-data-message">One daily snapshot is saved. Position changes will appear after the next connected daily sync.</p> : comparison.length ? <div className="seo-table-wrap"><table className="seo-data-table"><thead><tr><th>Search query</th><th>Avg position now</th><th>Previous</th><th>Change</th></tr></thead><tbody>{comparison.map((row) => <tr key={row.name}><td>{row.name}</td><td>{number(row.averagePosition)}</td><td>{number(row.previousPosition)}</td><td>{row.changeKind === "new" ? "New query" : row.changeKind === "unavailable" ? "Not enough data" : row.changeKind === "unchanged" ? "No change" : `${row.changeKind === "improved" ? "↑ Improved" : "↓ Moved down"} ${Math.abs(row.positionChange || 0).toFixed(1)} positions`}</td></tr>)}</tbody></table></div> : <p className="seo-data-message">There are no query rows to compare in these saved snapshots.</p>}
          </section>;
        })()}
        {current?.topQueries.length ? <div className="seo-table-wrap"><table className="seo-data-table"><thead><tr><th>Search query</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Avg position</th><th></th></tr></thead><tbody>{current.topQueries.map((row) => <tr key={row.name}><td>{row.name}</td><td>{number(row.clicks)}</td><td>{number(row.impressions)}</td><td>{row.ctr == null ? "—" : (row.ctr * 100).toFixed(2) + "%"}</td><td>{number(row.averagePosition)}</td><td><button className="secondary-button" type="button" onClick={() => makeTask("query", row)}>＋ Task</button></td></tr>)}</tbody></table></div> : <p className="seo-data-message">{search?.message || "No Search Console query data is available for this range."}</p>}</section>}
      {!loading && !error && vis("Keyword ideas") && <section className="seo-data-panel"><div className="seo-data-heading"><div><h2>{keywordPart === "competitors" ? "Competitor keyword gaps" : "Keyword research"}</h2><p>{keywordPart === "competitors" ? "Compare this client’s organic keywords against up to three competitor websites." : "Check estimated search demand and organic difficulty for a client’s services and target area."}</p></div><span className={`seo-connection-state ${keywordSource === "google" ? (client.googleAdsAccountId ? "connected" : "") : dataForSeoKeywordStatus === "ready" ? "connected" : ""}`}>{keywordSource === "google" ? (client.googleAdsAccountId ? "Google Ads mapped" : "Account not mapped") : dataForSeoKeywordStatus === "ready" ? "DataForSEO ready" : "DataForSEO setup needed"}</span></div>
        {keywordPart !== "competitors" && <>
        {!canManageMappings ? <p className="seo-data-message">Keyword research is currently limited to workspace owners and admins.</p> : <form className="seo-keyword-form seo-kw-research" onSubmit={(event) => void runKeywordResearch(event)}>
          <label className="kw-source"><span>Research source</span><select value={keywordSource} onChange={(event) => { setKeywordSource(event.target.value as "google" | "dataforseo"); setKeywordIdeas(null); setKeywordError(""); }}><option value="google">Google Ads Keyword Planner · paid-search estimates</option><option value="dataforseo">DataForSEO · SEO ideas and organic difficulty</option></select></label>
          <label className="kw-seeds"><span>Seed phrases (up to 10, comma or new line)</span><textarea value={keywordSeeds} onChange={(event) => setKeywordSeeds(event.target.value)} placeholder="e.g. interior designer dublin, kitchen renovation" rows={2} /></label>
          {keywordSource === "google" ? <><label className="kw-url"><span>Landing page URL (optional)</span><input type="url" value={keywordUrl} onChange={(event) => setKeywordUrl(event.target.value)} placeholder={client.wordpressSiteUrl || "https://example.com/service-page"} /></label><label className="kw-geo"><span>Country</span><select value={keywordGeo} onChange={(event) => setKeywordGeo(event.target.value)}><option value="2372">Ireland</option><option value="2826">United Kingdom</option><option value="2840">United States</option></select></label></> : <><label className="kw-geo"><span>City, region, or country</span><input value={keywordLocation} onChange={(event) => setKeywordLocation(event.target.value)} placeholder={client.seoLocations?.[0] || "Galway, Ireland"} /></label><p className="seo-data-footnote">{dataForSeoKeywordStatus || "DataForSEO keyword research setup is checking."}</p><label className="seo-report-charge-ack"><input type="checkbox" checked={keywordChargeConsent} onChange={(event) => setKeywordChargeConsent(event.target.checked)} /><span>This may use up to two paid DataForSEO requests. I’m okay using this account’s credits for this research; show me the actual cost afterward.</span></label></>}
          <button type="submit" className="primary-button kw-go" disabled={keywordLoading || (keywordSource === "google" ? !client.googleAdsAccountId : dataForSeoKeywordStatus !== "ready" || !keywordChargeConsent || !keywordLocation.trim())}>{keywordLoading ? "Researching…" : "Find keyword ideas"}</button>
        </form>}
        {keywordSource === "google" && !client.googleAdsAccountId && <p className="seo-data-message">Add the client’s Google Ads customer ID in Clients and connect the owner’s Google Ads access first.</p>}{keywordSource === "dataforseo" && dataForSeoKeywordStatus && dataForSeoKeywordStatus !== "ready" && <p className="seo-data-message">{dataForSeoKeywordStatus}</p>}{keywordError && <p className="seo-data-message" role="alert">{keywordError}</p>}
        {keywordIdeas && <><p className="seo-data-footnote">{keywordIdeas.count} ideas · {keywordIdeas.location} · English · {keywordIdeas.source}. {keywordIdeas.dataNote}{keywordIdeas.providerCostUsd == null ? "" : ` Reported provider cost: $${keywordIdeas.providerCostUsd.toFixed(4)}.`}</p>{keywordIdeas.results.length ? <><div className="seo-kw-bulk"><span>{pickedKeywords.size ? `${pickedKeywords.size} selected` : "Tick keywords to build a report"}</span><button type="button" className="primary-button" disabled={!pickedKeywords.size} onClick={openKeywordReport}>Generate report</button><button type="button" className="secondary-button" disabled={!pickedKeywords.size} onClick={downloadKeywordCsv}>Download CSV</button><button type="button" className="text-button" onClick={() => setPickedKeywords(new Set(keywordIdeas.results.map((row) => row.keyword)))}>Select all {keywordIdeas.results.length}</button>{pickedKeywords.size > 0 && <button type="button" className="text-button" onClick={() => setPickedKeywords(new Set())}>Clear</button>}</div><div className="seo-table-wrap"><table className="seo-data-table"><thead><tr><th className="seo-kw-check"><input type="checkbox" aria-label="Select shown keywords" checked={keywordIdeas.results.slice(0, showAllKeywordIdeas ? undefined : 20).every((row) => pickedKeywords.has(row.keyword))} onChange={(event) => { const shown = keywordIdeas.results.slice(0, showAllKeywordIdeas ? undefined : 20).map((row) => row.keyword); setPickedKeywords((current) => { const next = new Set(current); shown.forEach((keyword) => event.target.checked ? next.add(keyword) : next.delete(keyword)); return next; }); }} /></th><th>Keyword idea</th><th>Avg monthly searches</th>{keywordIdeas.source === "DataForSEO" ? <><th>Organic difficulty</th><th>Paid competition</th><th>Top bid · USD</th></> : <><th>Paid competition</th><th>Top of page bid · account currency</th></>}<th></th></tr></thead><tbody>{keywordIdeas.results.slice(0, showAllKeywordIdeas ? undefined : 20).map((row) => <tr key={row.keyword} className={pickedKeywords.has(row.keyword) ? "picked" : ""}><td className="seo-kw-check"><input type="checkbox" aria-label={`Select ${row.keyword}`} checked={pickedKeywords.has(row.keyword)} onChange={() => setPickedKeywords((current) => { const next = new Set(current); if (next.has(row.keyword)) next.delete(row.keyword); else next.add(row.keyword); return next; })} /></td><td>{row.keyword}</td><td>{number(row.avgMonthlySearches)}</td>{keywordIdeas.source === "DataForSEO" ? <><td>{row.difficulty == null ? "—" : `${row.difficulty}/100`}</td><td>{row.competition || "—"}</td><td>{row.lowTopOfPageBid == null || row.highTopOfPageBid == null ? "—" : `${row.lowTopOfPageBid.toFixed(2)}–${row.highTopOfPageBid.toFixed(2)}`}</td></> : <><td>{row.competition.toLowerCase()}{row.competitionIndex == null ? "" : ` · ${row.competitionIndex}/100`}</td><td>{row.lowTopOfPageBid == null || row.highTopOfPageBid == null ? "—" : `${row.lowTopOfPageBid.toFixed(2)}–${row.highTopOfPageBid.toFixed(2)}`}</td></>}<td><button className="secondary-button" type="button" onClick={() => makeKeywordTask(row)}>＋ Create review task</button></td></tr>)}</tbody></table></div>{keywordIdeas.results.length > 20 && <button className="secondary-button seo-keyword-more" type="button" onClick={() => setShowAllKeywordIdeas(!showAllKeywordIdeas)}>{showAllKeywordIdeas ? "Show top 20" : `Show all ${keywordIdeas.results.length} ideas`}</button>}</> : <p className="seo-data-message">No keyword ideas were returned for this location and those seed phrases. Try a city or nearby service area.</p>}</>}
        {keywordSource === "dataforseo" && keywordResearchHistory.length > 0 && <details className="seo-keyword-history"><summary>Saved DataForSEO research · {keywordResearchHistory.length}</summary><ul>{keywordResearchHistory.map((run) => <li key={run.id}><span><b>{run.location}</b><small>{run.seeds.join(", ")} · {new Date(run.createdAt).toLocaleString("en-IE")}</small></span><span>{run.results.length} ideas · {run.costUsd == null ? "cost unavailable" : `$${run.costUsd.toFixed(4)}`}</span></li>)}</ul></details>}
        </>}
        {keywordSource === "dataforseo" && keywordPart !== "ideas" && <section className="seo-competitor-research"><div className="seo-data-heading"><div><h3>Competitor keyword gaps</h3><p>Find terms where a competitor appears in organic search and this client does not.</p></div></div>
          <p className="seo-data-footnote">Client site: <b>{client.wordpressSiteUrl || client.website || "No website saved"}</b>. {keywordPart === "competitors" ? "" : "Uses the location above. "}Add up to three competitor websites, one per line. This is a paid DataForSEO check.</p>
          {!client.wordpressSiteUrl && !client.website ? <p className="seo-data-message">Add this client’s public website in Clients before comparing competitors.</p> : <form className="seo-keyword-form" onSubmit={(event) => void runCompetitorResearch(event)}>
            {keywordPart === "competitors" && <label><span>Location</span><input value={keywordLocation} onChange={(event) => setKeywordLocation(event.target.value)} placeholder="Ireland or Dublin, Ireland" /></label>}<label><span>Competitor websites (up to 3)</span><textarea value={competitorDomains} onChange={(event) => setCompetitorDomains(event.target.value)} rows={3} placeholder={"competitor-one.ie\ncompetitor-two.ie"} /></label>
            <label className="seo-report-charge-ack"><input type="checkbox" checked={competitorChargeConsent} onChange={(event) => setCompetitorChargeConsent(event.target.checked)} /><span>I approve up to one paid request per competitor website (maximum 3). Show the provider-reported cost afterward.</span></label>
            <button type="submit" className="primary-button" disabled={competitorResearchLoading || dataForSeoKeywordStatus !== "ready" || !competitorChargeConsent || !keywordLocation.trim() || !competitorDomains.trim()}>{competitorResearchLoading ? "Checking competitors…" : "Compare keyword gaps"}</button>
          </form>}
          {competitorResearchError && <p className="seo-data-message" role="alert">{competitorResearchError}</p>}
          {competitorResearchResult && <><p className="seo-data-footnote" role="status">Checked {competitorResearchResult.competitors.length} competitor(s) for {competitorResearchResult.location}. Provider cost: {competitorResearchResult.costUsd == null ? "not supplied" : `$${competitorResearchResult.costUsd.toFixed(5)} USD`}.</p>{competitorResearchResult.competitors.map((result) => <article className="seo-competitor-result" key={result.competitorDomain}><h4>{result.competitorDomain}</h4>{result.status !== "connected" ? <p className="seo-data-message">{result.message || "No confirmed results returned."}</p> : result.keywords.length ? <><p className="seo-data-footnote">{number(result.totalCount)} estimated gap terms returned. Weekly ranking and search-volume estimates are directional.</p><div className="seo-table-wrap"><table className="seo-data-table"><thead><tr><th>Keyword</th><th>Monthly searches</th><th>Difficulty</th><th>Competitor rank</th><th>Ranking page</th></tr></thead><tbody>{result.keywords.slice(0, 25).map((item) => <tr key={item.keyword}><td>{item.keyword}</td><td>{number(item.monthlySearches)}</td><td>{number(item.difficulty)}</td><td>{number(item.competitorPosition)}</td><td>{safeHttpUrl(item.competitorUrl || "") ? <a href={safeHttpUrl(item.competitorUrl || "")} target="_blank" rel="noreferrer">View page ↗</a> : "—"}</td></tr>)}</tbody></table></div><button className="secondary-button" type="button" onClick={() => onCreateTask(client.id, `Review competitor keyword gaps: ${result.competitorDomain}`, `Review organic keyword gaps for ${client.name}.\nClient domain: ${competitorResearchResult.clientDomain}\nCompetitor: ${result.competitorDomain}\nLocation: ${competitorResearchResult.location}\nProvider-reported cost: ${result.costUsd == null ? "not supplied" : `$${result.costUsd.toFixed(5)} USD`}\n\nKeywords returned:\n${result.keywords.slice(0, 25).map((item) => `- ${item.keyword}; estimated volume ${item.monthlySearches ?? "unknown"}; difficulty ${item.difficulty ?? "unknown"}/100; competitor rank ${item.competitorPosition ?? "unknown"}; page ${item.competitorUrl || "unknown"}`).join("\n")}\n\nThese are provider estimates. Verify the search intent and relevance before recommending content. Do not create or publish pages without approval.`, "Review data, verify search intent, assess client relevance, and recommend whether a page or content update is warranted. Do not publish changes.")}>＋ Create review task</button></> : <p className="seo-data-message">No keyword gaps were returned for this competitor and location.</p>}</article>)}</>}
          {competitorResearchHistory.length > 0 && <details className="seo-keyword-history"><summary>Saved competitor checks · {competitorResearchHistory.length}</summary><ul>{competitorResearchHistory.map((run) => <li key={run.id}><span><b>{run.clientDomain} vs {run.competitors.map((item) => item.competitorDomain).join(", ")}</b><small>{run.location} · {new Date(run.createdAt).toLocaleString("en-IE")} · {run.requestCount} paid request(s)</small></span><span>{run.competitors.reduce((sum, item) => sum + item.keywords.length, 0)} gap terms · {run.costUsd == null ? "cost unavailable" : `$${run.costUsd.toFixed(5)}`}</span></li>)}</ul></details>}
        </section>}
        <p className="seo-data-footnote">Search demand and bid ranges are estimates, not current organic rankings or verified leads. Google Ads competition is paid-search competition; DataForSEO difficulty estimates organic top-10 ranking difficulty.</p>
      </section>}
      {!loading && !error && vis("Pages & content") && <>
        <section className="seo-data-panel"><div className="seo-data-heading"><div><h2>Pages with search visibility</h2><p>Use live clicks, impressions, CTR and position to choose pages to review.</p></div>{canOpenSites && <button className="secondary-button" type="button" onClick={onOpenSites}>Open Sites ↗</button>}</div>{current?.topPages.length ? <div className="seo-table-wrap"><table className="seo-data-table"><thead><tr><th>Page URL</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Avg position</th><th></th></tr></thead><tbody>{current.topPages.map((row) => <tr key={row.name}><td><a href={row.name} target="_blank" rel="noreferrer">{row.name}</a></td><td>{number(row.clicks)}</td><td>{number(row.impressions)}</td><td>{row.ctr == null ? "—" : (row.ctr * 100).toFixed(2) + "%"}</td><td>{number(row.averagePosition)}</td><td><button className="secondary-button" type="button" onClick={() => makeTask("page", row)}>＋ Task</button></td></tr>)}</tbody></table></div> : <p className="seo-data-message">{search?.message || "No page performance rows are available. Confirm the Search Console property mapping."}</p>}</section>
        <section className="seo-data-panel seo-content-inventory"><div className="seo-data-heading"><div><h2>🌐 WordPress page content check</h2><p>Reads the existing WordPress inventory. Reports confirmed missing fields only when the live page or an exposed SEO field was checked.</p></div><div className="seo-content-actions">{canOpenSites && client?.wordpressSiteUrl && <button className="secondary-button" type="button" disabled={contentInventoryLoading} onClick={() => setContentInventoryReload((value) => value + 1)}>{contentInventoryLoading ? "Refreshing…" : "↻ Refresh pages"}</button>}{canOpenSites && <button className="secondary-button" type="button" onClick={onOpenSites}>Manage in Sites ↗</button>}</div></div>
          {!client?.wordpressSiteUrl ? <p className="seo-data-message">Add this client’s website address in their profile to load its WordPress pages.</p> : !canOpenSites ? <p className="seo-data-message">An owner or admin can open the WordPress page inventory here. You can still review pages with Search Console data above.</p> : contentInventoryLoading ? <p className="seo-data-message" role="status">Loading the client’s WordPress pages…</p> : contentInventoryError ? <p className="seo-data-message" role="alert">{contentInventoryError}</p> : contentInventory?.pages?.length ? <><p className="seo-data-footnote">{contentInventory.connected ? `Connected WordPress inventory · ${contentInventory.siteUrl || client.wordpressSiteUrl}` : `Public page metadata · ${contentInventory.siteUrl || client.wordpressSiteUrl}`} · {contentInventory.pages.length} pages shown{contentInventory.publicInventory && contentInventory.totalPages ? ` · ${contentInventory.totalPages} pages` : ""}. {contentInventory.publicInventoryError || ""}</p><div className="seo-table-wrap"><table className="seo-data-table seo-content-table"><thead><tr><th>Page</th><th>SEO title</th><th>Meta description</th><th>Review status</th><th>Task</th></tr></thead><tbody>{contentInventory.pages.map((page) => { const audit = inspectSeoContentPage(page); const taskItems = [...audit.issues, ...audit.unavailable]; const pageUrl = page.link || `${client.wordpressSiteUrl?.replace(/\/$/, "")}/${page.slug}/`; const pageMetrics = current?.topPages.find((row) => comparablePageUrl(row.name) === comparablePageUrl(pageUrl)); const searchPeriod = search?.dateWindow ? `${search.dateWindow.current.start} to ${search.dateWindow.current.end}` : range.replaceAll("_", " "); const metricsContext = pageMetrics ? `\nSearch Console (${searchPeriod}): ${pageMetrics.clicks} clicks, ${pageMetrics.impressions} impressions, average position ${pageMetrics.averagePosition ?? "unavailable"}.` : "\nNo matching Search Console page metrics were available in this report range."; return <tr key={`${page.id}-${page.slug}`}><td><a href={pageUrl} target="_blank" rel="noreferrer">{page.title || page.slug || "Untitled page"}</a><small>{page.status}{page.modified ? ` · Updated ${new Date(page.modified).toLocaleDateString("en-IE")}` : ""}</small></td><td>{page.seoTitle || (page.seoChecked || page.seoCapabilities?.title ? "Missing" : "Not available")}</td><td>{page.metaDescription || (page.seoChecked || page.seoCapabilities?.description ? "Missing" : "Not available")}</td><td><span className={`seo-content-status ${audit.status}`}>{audit.status === "review" ? audit.issues.join(" · ") : audit.status === "unknown" ? "SEO fields not fully exposed" : "Checked · no issue found"}</span></td><td className="seo-content-task-actions">{client && <><button className="secondary-button" type="button" onClick={() => onCreateTask(client.id, `SEO content brief: ${page.title || page.slug}`, `Prepare an evidence-based SEO content brief for this existing page.\nClient: ${client.name}\nPage: ${pageUrl}\nPage status: ${page.status}\nSEO title: ${page.seoTitle || "not available"}\nMeta description: ${page.metaDescription || "not available"}${metricsContext}\n\nUse the page and client information already available to the assigned SEO agent. Keep any recommended changes as a draft or proposal. Do not invent services, locations, testimonials, credentials, guarantees, or results. Do not publish without approval.`, "Review the live page and the client’s verified service details\nUse Search Console metrics only as page-level evidence\nPrepare specific content recommendations and a draft; preserve factual claims\nSubmit the brief for human review before publishing")}>＋ Content brief task</button>{audit.status !== "checked" && <button className="secondary-button" type="button" onClick={() => onCreateTask(client.id, `SEO review: ${page.title || page.slug}`, `WordPress page: ${pageUrl}\nClient: ${client.name}\n\nObserved findings:\n${taskItems.map((item) => `• ${item}`).join("\n")}\n\nReview the page and make any changes as a draft or proposal. Do not publish without approval.`, taskItems.join("\n"))}>Review</button>}</>}</td></tr>; })}</tbody></table></div><div className="seo-content-pagination"><span>Page {contentInventory.inventoryPage || contentInventoryPage}{contentInventory.totalPages ? ` of ${contentInventory.totalPages}` : ""}</span><div><button type="button" className="secondary-button" disabled={contentInventoryLoading || (contentInventory.inventoryPage || contentInventoryPage) <= 1} onClick={() => setContentInventoryPage((page) => Math.max(1, page - 1))}>← Previous</button><button type="button" className="secondary-button" disabled={contentInventoryLoading || contentInventory.pages.length < 50 || Boolean(contentInventory.totalPages && (contentInventory.inventoryPage || contentInventoryPage) >= contentInventory.totalPages)} onClick={() => setContentInventoryPage((page) => page + 1)}>Next →</button></div></div></> : <p className="seo-data-message">No page inventory was returned. {contentInventory?.publicInventoryError || "Check that WordPress editing or public page access is available."}</p>}
        </section>
        {client && <section className="seo-data-panel seo-page-opportunities"><div className="seo-data-heading"><div><h2>Service and location page ideas</h2><p>Suggestions use the business services and areas saved in this client profile, showing up to 100 combinations.</p></div></div>{!(client.seoServices?.length && client.seoLocations?.length) ? <p className="seo-data-message">Add the client’s actual services and service areas in Clients → Edit client to generate useful ideas.</p> : !contentInventory?.pages?.length ? <p className="seo-data-message">Load the WordPress page inventory to compare the ideas with existing pages.</p> : <><p className="seo-data-footnote">This checks page {contentInventory.inventoryPage || contentInventoryPage} of the loaded WordPress inventory only. “Not seen here” does not prove a page is missing from the full site. Review the full inventory before creating anything.</p>{pageOpportunities.length ? <div className="seo-opportunity-list">{pageOpportunities.map((idea) => { const title = idea.suggestedTitle; const alreadySeen = Boolean(idea.matchedPage); return <article className="seo-opportunity-item" key={`${idea.service}-${idea.location}`}><div><b>{title}</b><small>{alreadySeen ? `Related page seen on this inventory page: ${idea.matchedPage}` : "No matching page seen on this inventory page"}</small></div><button className="secondary-button" type="button" onClick={() => onCreateAuditTask(client.id, `Review SEO page idea: ${title}`, `Review this possible SEO page for ${client.name}.\nSuggested topic: ${title}.\nBusiness service: ${idea.service}.\nService area: ${idea.location}.\n${alreadySeen ? `A related page was seen in the currently loaded WordPress inventory: ${idea.matchedPage}. Check whether it already serves this intent.` : "No matching page was found in the currently loaded WordPress inventory page."}\n\nFirst search the full WordPress inventory and the live site for an existing equivalent page. This suggestion is not proof that a page is missing. Confirm the service and location are accurate with the client, assess search demand and duplication risk, and prepare a draft brief only if useful. Do not invent claims or publish without approval.`)}>＋ Create review task</button></article>; })}</div> : <p className="seo-data-message">Add at least one service and one service area in the client profile.</p>}</>}</section>}
      </>}
      {!loading && !error && vis("Local SEO") && <section className="seo-data-panel"><div className="seo-data-heading"><div><h2>Google Business Profile</h2><p>{localSeo?.locationName || client.name} · {localSeo?.dateWindow ? `${localSeo.dateWindow.current.start} to ${localSeo.dateWindow.current.end}` : range.replaceAll("_", " ")}</p></div><span className={`seo-connection-state ${localSeo?.status === "connected" ? "connected" : ""}`}>{localSeo?.status === "connected" ? "Live data" : localSeo?.status === "not_mapped" ? "Not linked" : localSeo?.status === "no_data" ? "No rows returned" : localSeo?.status === "checking" ? "Loading" : "Status"}</span></div>
        {canManageMappings && localSeo?.status !== "connected" && <div className="seo-property-map"><div><b>Link this client’s Business Profile</b><small>Pick the connected Google account, then the exact location for this client. This saves a link in the workspace; it does not edit the profile.</small></div><button type="button" className="secondary-button" disabled={businessBusy} onClick={() => void loadBusinessAccounts()}>{businessBusy ? "Loading…" : businessAccounts.length ? "↻ Refresh accounts" : "Find accounts"}</button>{businessAccounts.length > 0 && <><label><span>Google account</span><select value={businessAccountId} onChange={(event) => { void loadBusinessLocations(event.target.value).catch((reason) => setBusinessStatus(reason instanceof Error ? reason.message : "Could not list locations.")); }}><option value="">Choose an account</option>{businessAccounts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{businessLocations.length > 0 && <><label><span>Business location</span><select value={businessLocationId} onChange={(event) => setBusinessLocationId(event.target.value)}><option value="">Choose a location</option>{businessLocations.map((item) => <option key={item.id} value={item.id}>{item.name}{item.website ? ` · ${item.website}` : ""}</option>)}</select></label><button type="button" className="primary-button" disabled={!businessAccountId || !businessLocationId || businessSaving || (businessAccountId === client.googleBusinessProfileAccountId && businessLocationId === client.googleBusinessProfileLocationId)} onClick={() => void saveBusinessProfileMapping()}>{businessSaving ? "Saving…" : "Save location to this client"}</button></>}</>}{businessStatus && <small role="status">{businessStatus}</small>}</div>}
        {localSeo?.status === "connected" && localSeo.current && <><div className="seo-metric-grid">{[["Profile impressions", localSeo.current.impressions, localSeo.previous?.impressions], ["Call clicks", localSeo.current.calls, localSeo.previous?.calls], ["Direction requests", localSeo.current.directions, localSeo.previous?.directions], ["Website clicks", localSeo.current.websiteClicks, localSeo.previous?.websiteClicks]].map(([label, value, previous]) => <article className="seo-metric" key={label as string}><span>{label}</span><b>{number(value as number | null)}</b><small>{change(value as number | null, previous as number | null)}</small></article>)}</div><MarketingSnapshotHistory service="Google Business Profile" snapshots={localSeo.snapshots} metrics={[{ label: "Profile impressions", path: ["current", "impressions"] }, { label: "Calls", path: ["current", "calls"] }, { label: "Website clicks", path: ["current", "websiteClicks"] }]} /><p className="seo-data-footnote">{localSeo.dataNote} Profile actions are not confirmed leads. {localSeo.reviewsNote || ""}</p><div className="seo-data-heading"><div><h3>Reviews</h3><p>{localSeo.reviews?.averageRating == null ? "Rating unavailable" : `${localSeo.reviews.averageRating.toFixed(1)} / 5`} · {localSeo.reviews?.total == null ? "Review total unavailable" : `${number(localSeo.reviews.total)} reviews`}</p></div></div>{localSeo.reviews?.recent?.length ? <div className="seo-table-wrap"><table className="seo-data-table"><thead><tr><th>Reviewer</th><th>Rating</th><th>Review</th><th>Date</th><th>Reply status</th></tr></thead><tbody>{localSeo.reviews.recent.map((review, index) => <tr key={`${review.createdAt}-${index}`}><td>{review.reviewer}</td><td>{review.rating || "—"}</td><td>{review.comment || "—"}</td><td>{review.createdAt ? new Date(review.createdAt).toLocaleDateString("en-IE") : "—"}</td><td>{review.reply ? "Replied" : "No reply shown"}</td></tr>)}</tbody></table></div> : <p className="seo-data-message">No review details were returned for this location. The interaction metrics above load separately.</p>}</>}
        {localSeo?.status !== "connected" && <p className="seo-data-message">{localSeo?.message || (localSeo?.status === "not_mapped" ? "Link the client’s Google Business Profile location to see its live data." : "Business Profile data is not available yet.")}</p>}
      </section>}
      {!loading && !error && vis("Local SEO") && <section className="seo-data-panel"><div className="seo-data-heading"><div><h2>📍 Google Maps local rankings</h2><p>Check where this business appears for local searches in one chosen area. Each keyword check is a paid DataForSEO request; up to five are sent when you run it.</p></div><span className={`seo-connection-state ${localRankStatus.startsWith("Google Maps rank checks are ready") ? "connected" : ""}`}>{localRankStatus.startsWith("Google Maps rank checks are ready") ? "DataForSEO ready" : "Setup status"}</span></div>
        {!canManageMappings ? <p className="seo-data-message">Paid Maps rank checks are limited to workspace owners and admins.</p> : <div className="seo-keyword-form"><label><span>Search phrases · up to 5, one per line</span><textarea value={localRankForm.keywords} onChange={(event) => setLocalRankForm({ keywords: event.target.value })} placeholder="roofer Galway\nroof repairs Galway" /></label><div className="seo-keyword-form-grid"><label><span>Town or area</span><input value={localRankForm.location} onChange={(event) => setLocalRankForm({ location: event.target.value })} placeholder="Galway, Ireland" /></label><label><span>Business Profile name</span><input value={localRankForm.businessName} onChange={(event) => setLocalRankForm({ businessName: event.target.value })} placeholder="Exact name shown on Google" /></label><label><span>Website domain</span><input value={localRankForm.domain} onChange={(event) => setLocalRankForm({ domain: event.target.value })} placeholder="example.ie" /></label></div><p className="seo-data-footnote">{localRankStatus || "Google Maps position changes by location and device. This check records one desktop snapshot for the selected area and checks the top 20 map listings."}</p><label className="seo-report-charge-ack"><input type="checkbox" checked={localRankConsent} onChange={(event) => setLocalRankConsent(event.target.checked)} /><span>I understand this makes a paid request for each phrase (up to five). I approve using DataForSEO credits for this check.</span></label><button type="button" className="primary-button" disabled={localRankLoading || !localRankConsent || !localRankForm.keywords.trim() || !localRankForm.location.trim() || (!localRankForm.businessName.trim() && !localRankForm.domain.trim()) || localRankStatus.startsWith("Add DATAFORSEO_API_LOGIN")} onClick={() => void runLocalRankCheck()}>{localRankLoading ? "Checking Google Maps…" : "📍 Check local rankings"}</button></div>}
        {localRankError && <p className="seo-data-message" role="alert">{localRankError}</p>}
        {localRankResult?.results?.length ? <><p className="seo-data-footnote">Checked {localRankResult.updatedAt ? new Date(localRankResult.updatedAt).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" }) : "just now"} · DataForSEO charge: {localRankResult.providerCostUsd == null ? "not supplied" : `$${localRankResult.providerCostUsd.toFixed(5)} USD`}</p><div className="seo-table-wrap"><table className="seo-data-table"><thead><tr><th>Search phrase</th><th>Maps rank</th><th>Match</th><th>Rating</th><th>Competitors</th><th>Next step</th></tr></thead><tbody>{localRankResult.results.map((item) => <tr key={`${item.keyword}-${item.location}`}><td>{item.keyword}<small>{item.location}</small></td><td>{item.rank == null ? "Not in top 20" : `#${item.rank}`}</td><td>{item.matchedBy ? `${item.matchedBy}: ${item.businessName}` : "No matching listing"}</td><td>{item.rating == null ? "—" : `${item.rating.toFixed(1)} / 5 · ${number(item.reviewCount)} reviews`}</td><td>{item.competitors.map((competitor) => `#${competitor.rank} ${competitor.name}`).join(" · ") || "—"}</td><td><button className="secondary-button" type="button" onClick={() => createLocalRankTask(item)}>＋ Review task</button></td></tr>)}</tbody></table></div>{localRankResult.failed?.length ? <p className="seo-data-message">Some phrases did not return data: {localRankResult.failed.map((item) => `${item.keyword}: ${item.error}`).join("; ")}</p> : null}<p className="seo-data-footnote">{localRankResult.dataNote}</p></> : null}
        <section className="seo-backlink-history"><h3>Saved Maps ranking checks</h3><p>Manual snapshots are kept by client so you can compare results over time.</p>{localRankHistory.length ? <div className="seo-table-wrap"><table className="seo-data-table"><thead><tr><th>Checked</th><th>Area</th><th>Search phrase</th><th>Rank</th><th>Business match</th><th>Cost</th></tr></thead><tbody>{localRankHistory.flatMap((run) => run.results.map((item) => <tr key={`${run.id}-${item.keyword}`}><td>{new Date(run.createdAt).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}</td><td>{run.location}</td><td>{item.keyword}</td><td>{item.rank == null ? "Not in top 20" : `#${item.rank}`}</td><td>{item.matchedBy || "No match"}</td><td>{run.costUsd == null ? "Not supplied" : `$${run.costUsd.toFixed(5)} USD`}</td></tr>))}</tbody></table></div> : <p className="seo-data-message">No Maps ranking checks have been saved for this client yet.</p>}</section>
      </section>}
      {!loading && !error && vis("Backlinks") && <section className="seo-data-panel"><div className="seo-data-heading"><div><h2>Backlink profile</h2><p>Review links pointing to a client website or compare a competitor domain. This reads DataForSEO’s index and does not create or submit links.</p></div><span className={`seo-connection-state ${backlinkData?.status === "ready" || backlinkData?.status === "connected" ? "connected" : ""}`}>{backlinkData?.status === "ready" ? "DataForSEO ready" : backlinkData?.status === "connected" ? "Snapshot loaded" : backlinkData?.status === "missing_connection" ? "Connection needed" : "Read only"}</span></div>
        {!canManageMappings ? <p className="seo-data-message">Backlink research is limited to workspace owners and admins.</p> : <div className="seo-keyword-form"><label><span>Client or competitor domain</span><input value={backlinkTarget} onChange={(event) => setBacklinkTarget(event.target.value)} placeholder="example.com" /></label><p className="seo-data-footnote">{backlinkData?.message || "The client’s website is filled in when available. Saved snapshots let you compare this target over time."}</p><label className="seo-report-charge-ack"><input type="checkbox" checked={backlinkConsent} onChange={(event) => setBacklinkConsent(event.target.checked)} /><span>This check may use up to 3 billable DataForSEO requests: profile, new/lost totals and up to 100 backlink examples. I approve using account credits.</span></label><button type="button" className="primary-button" disabled={backlinkLoading || !backlinkConsent || !backlinkTarget.trim() || backlinkData?.status === "missing_connection"} onClick={() => void runBacklinkCheck()}>{backlinkLoading ? "Checking backlinks…" : "🔎 Check backlink profile"}</button></div>}
        {backlinkData?.status === "missing_connection" && <p className="seo-data-message">Add <code>DATAFORSEO_API_LOGIN</code> and <code>DATAFORSEO_API_PASSWORD</code> as Cloudflare Worker secrets to enable this feature. The current report does not make a provider request.</p>}
        {backlinkError && <p className="seo-data-message" role="alert">{backlinkError}</p>}
        {backlinkData?.summary && <><p className="seo-data-footnote">Target: {backlinkData.summary.target} · Checked {backlinkData.updatedAt ? new Date(backlinkData.updatedAt).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" }) : "just now"} · Total reported cost {backlinkData.providerCostUsd == null ? "not supplied" : `$${backlinkData.providerCostUsd.toFixed(5)} USD`}</p><div className="seo-metric-grid">{[["Backlinks", backlinkData.summary.backlinks], ["Referring domains", backlinkData.summary.referringDomains], ["Referring IPs", backlinkData.summary.referringIps], ["Broken backlinks", backlinkData.summary.brokenBacklinks], ["Link rank", backlinkData.summary.rank], ["Target spam score", backlinkData.summary.spamScore]].map(([label, value]) => <article className="seo-metric" key={label as string}><span>{label}</span><b>{number(value as number | null)}</b><small>DataForSEO index</small></article>)}</div>{backlinkData.changes && <><h3>New and lost · {backlinkData.changes.startDate} to {backlinkData.changes.endDate}</h3><div className="seo-metric-grid">{[["New backlinks", backlinkData.changes.backlinksNew], ["Lost backlinks", backlinkData.changes.backlinksLost], ["New referring domains", backlinkData.changes.referringDomainsNew], ["Lost referring domains", backlinkData.changes.referringDomainsLost]].map(([label, value]) => <article className="seo-metric" key={label as string}><span>{label}</span><b>{number(value as number | null)}</b><small>DataForSEO time series</small></article>)}</div></>}{backlinkData.comparison && <p className="seo-data-footnote">Change since the previous snapshot: backlinks {signed(backlinkData.comparison.backlinks)}, referring domains {signed(backlinkData.comparison.referringDomains)}, broken backlinks {signed(backlinkData.comparison.brokenBacklinks)}.</p>}{backlinkData.detailErrors?.length ? <p className="seo-data-message">{backlinkData.detailErrors.join(" ")} Summary data is still available.</p> : null}<h3>Backlink examples · up to 100</h3>{backlinkData.items?.length ? <div className="seo-table-wrap"><table className="seo-data-table"><thead><tr><th>Status</th><th>Linking page</th><th>Links to</th><th>Anchor text</th><th>Rank</th><th>First seen</th><th>Follow-up</th></tr></thead><tbody>{backlinkData.items.map((item, index) => { const tracked = backlinkOutreach.some((row) => row.sourceUrl === item.urlFrom && row.targetUrl === item.urlTo); return <tr key={`${item.urlFrom}-${index}`}><td>{item.isNew ? "New" : item.isLost ? "Lost" : "Existing"}{item.dofollow === null ? "" : item.dofollow ? " · Follow" : " · Nofollow"}</td><td>{safeHttpUrl(item.urlFrom) ? <a href={safeHttpUrl(item.urlFrom)} target="_blank" rel="noreferrer">{item.domainFrom}</a> : item.domainFrom}<small>{item.urlFrom}</small></td><td><small>{item.urlTo}</small></td><td>{item.anchor || "—"}</td><td>{number(item.rank)}</td><td>{item.firstSeen || "—"}</td><td><button className="secondary-button" type="button" disabled={tracked || backlinkOutreachBusyId === item.urlFrom} onClick={() => void trackBacklink(item)}>{tracked ? "✓ Tracked" : backlinkOutreachBusyId === item.urlFrom ? "Saving…" : "＋ Track"}</button></td></tr>; })}</tbody></table></div> : <p className="seo-data-message">No backlink examples were returned for this target.</p>}<p className="seo-data-footnote">{backlinkData.dataNote}</p><button type="button" className="secondary-button" onClick={createBacklinkTask}>＋ Create review task</button></>}
        <section className="seo-backlink-history"><h3>Outreach follow-ups</h3><p>Track a real linking page from this report. Add your own contact notes and update the status; the app does not send outreach.</p>{backlinkOutreachError && <p className="seo-data-message" role="alert">{backlinkOutreachError}</p>}{backlinkOutreach.length ? <div className="seo-table-wrap"><table className="seo-data-table"><thead><tr><th>Source</th><th>Target page</th><th>Status</th><th>Follow-up date</th><th>Notes</th><th>Save</th></tr></thead><tbody>{backlinkOutreach.map((item) => <tr key={item.id}><td>{safeHttpUrl(item.sourceUrl) ? <a href={safeHttpUrl(item.sourceUrl)} target="_blank" rel="noreferrer">{item.sourceDomain}</a> : item.sourceDomain}<small>{item.anchor || item.sourceUrl}</small></td><td><small>{item.targetUrl}</small></td><td><select value={item.status} onChange={(event) => setBacklinkOutreach((rows) => rows.map((row) => row.id === item.id ? { ...row, status: event.target.value as BacklinkOutreach["status"] } : row))}>{["To review", "Shortlisted", "Contacted", "Replied", "Link live", "Not suitable"].map((status) => <option key={status}>{status}</option>)}</select></td><td><input type="date" value={item.followUpDate || ""} onChange={(event) => setBacklinkOutreach((rows) => rows.map((row) => row.id === item.id ? { ...row, followUpDate: event.target.value || null } : row))} /></td><td><textarea rows={2} maxLength={2000} value={item.note} onChange={(event) => setBacklinkOutreach((rows) => rows.map((row) => row.id === item.id ? { ...row, note: event.target.value } : row))} placeholder="Contact person, reply or next step" /></td><td><button className="primary-button" type="button" disabled={Boolean(backlinkOutreachBusyId)} onClick={() => void saveBacklinkOutreach(item)}>{backlinkOutreachBusyId === item.id ? "Saving…" : "Save"}</button></td></tr>)}</tbody></table></div> : <p className="seo-data-message">No backlink follow-ups yet. Use Track beside a backlink example to add one.</p>}</section>
        <section className="seo-backlink-history"><h3>Saved backlink snapshots</h3><p>Each manual check is saved, so you can compare the same client or competitor later.</p>{backlinkData?.history?.length ? <div className="seo-table-wrap"><table className="seo-data-table"><thead><tr><th>Target</th><th>Checked</th><th>Backlinks</th><th>New / lost</th><th>Referring domains</th><th>Cost</th></tr></thead><tbody>{backlinkData.history.map((item, index) => <tr key={`${item.target}-${item.checkedAt}-${index}`}><td>{item.target}</td><td>{new Date(item.checkedAt).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}</td><td>{number(item.summary.backlinks)}</td><td>{item.changes ? `+${number(item.changes.backlinksNew)} / −${number(item.changes.backlinksLost)}` : "—"}</td><td>{number(item.summary.referringDomains)}</td><td>{item.providerCostUsd == null ? "Not supplied" : `$${item.providerCostUsd.toFixed(5)} USD`}</td></tr>)}</tbody></table></div> : <p className="seo-data-message">No backlink checks have been saved for this client yet.</p>}</section>
      </section>}
      {!loading && !error && vis("Technical") && <section className="seo-data-panel seo-technical-shortcut"><div><span className="eyebrow">🌐 EXISTING SITES WORKSPACE</span><h2>Technical checks</h2><p>Run the bounded, read-only website audit from Sites. It checks sampled page metadata, canonical tags, noindex signals, structured data, internal links and sitemap, then saves a comparison with the previous audit.</p>{!canOpenSites && <small>An admin can run the technical check from Sites.</small>}</div>{canOpenSites && <button className="primary-button" type="button" onClick={onOpenSites}>Open Sites and run check ↗</button>}</section>}
    </>}
  </main>;
}
