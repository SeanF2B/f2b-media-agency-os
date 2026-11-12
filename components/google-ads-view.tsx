"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { MarketingAuditPanel } from "@/components/marketing-audit-panel";
import { MarketingSnapshotHistory, type MarketingHistorySnapshot } from "@/components/marketing-snapshot-history";
import type { MarketingAuditRun } from "@/lib/marketing-audit";
import { compareGoogleAdsTotals } from "@/lib/google-ads-performance";
import { fetchReadWithRetry, readApiJson } from "@/lib/read-api-json";
import { MarketingSetupWizard } from "@/components/marketing-setup-wizard";

type Client = { id: string; name: string; logo?: string; googleAdsAccountId?: string };
type Campaign = { id: string; name: string; status: string; spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number; ctr: number | null; averageCpc: number | null; costPerConversion: number | null; conversionRate: number | null; returnOnAdSpend: number | null };
type BreakdownItem = Campaign & { kind: string; campaignId: string; campaignName: string; adGroupId: string; adGroupName: string; matchType: string; matchSource?: string; targetingStatus?: string; triggeringKeyword?: string; triggeringKeywordMatchType?: string; device?: string; network?: string; qualityScore?: number | null; adRelevance?: string; landingPageExperience?: string; expectedCtr?: string };
type ResponsiveAd = { campaignId: string; campaignName: string; adGroupId: string; adGroupName: string; adId: string; status: string; finalUrls: string[]; headlines: Array<{ text: string; pinnedField?: string }>; descriptions: Array<{ text: string; pinnedField?: string }> };
type GoogleAdsAsset = { scope: string; campaignId: string; campaignName: string; adGroupId: string; adGroupName: string; assetId: string; assetName: string; type: string; source?: string; fieldType: string; status: string; performanceLabel?: string; associationResourceName?: string; impressions?: number; clicks?: number; ctr?: number; spend?: number; conversions?: number; conversionValue?: number; text: string[]; finalUrls: string[]; imageUrl: string };
type AdsPayload = { status: "connected" | "no_data" | "not_mapped" | "missing_connection" | "unavailable"; message?: string; currency?: string; accountId?: string; section?: string; rows?: BreakdownItem[]; ads?: ResponsiveAd[]; assets?: GoogleAdsAsset[]; sourceRows?: number; mayBeLimited?: boolean; dateWindow?: { current: { start: string; end: string }; previous?: { start: string; end: string } }; current?: { totals: Campaign; campaigns: Campaign[]; daily: Array<{ date: string; clicks: number }>; campaignDaily: Array<{ campaignId: string; date: string; clicks: number }>; sourceRows: number; mayBeLimited: boolean }; previous?: { totals: Campaign; campaigns: Campaign[] }; changes?: Record<string, number | null>; snapshots?: MarketingHistorySnapshot[]; updatedAt?: string; dataNote?: string; activityDiagnosis?: string };
type AdsSection = "performance" | "campaigns" | "ad_groups" | "keywords" | "search_terms" | "ads" | "assets" | "keyword_planner" | "setup";
type DirectConnection = { configured: boolean; connected: boolean; accountEmail?: string; connectedAt?: string; apiReady: boolean };
type DirectAccount = { id: string; name: string };
type AdsAdGroup = { id: string; name: string; campaignId: string; campaign: string };
type PendingKeywordChange = { id: string; campaign_name: string; change_type: string; old_value: string; new_value: string; payload_json: string; created_at: string; created_by: string };
type KeywordPlannerResult = { keyword: string; avgMonthlySearches: number; competition: string; competitionIndex: number | null; lowTopOfPageBid: number; highTopOfPageBid: number; monthlySearchVolumes: Array<{ year: number; month: string; searches: number }> };

function safeAdsUrl(value: string) { try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.href : ""; } catch { return ""; } }

function asNumber(value: number | null | undefined) { return value == null ? "—" : value.toLocaleString("en-IE", { maximumFractionDigits: 1 }); }
function asMoney(value: number | null | undefined, currency: string) {
  if (value == null) return "—";
  try { return new Intl.NumberFormat("en-IE", { style: "currency", currency, maximumFractionDigits: 2 }).format(value); }
  catch { return `${currency} ${value.toFixed(2)}`; }
}
function delta(value: number | null | undefined, inverse = false) {
  if (value == null) return "No prior-period comparison";
  const shown = `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
  return inverse ? `${shown} ${value < 0 ? "better" : value > 0 ? "higher" : "same"}` : `${shown} vs previous period`;
}

export function GoogleAdsView({ clients, active, selectedClientId, canEditClients, onEditClient, onMapAccount, onCreateTask, onCreateCampaignReport, auditRuns = [], canRunAudit, onSaveAudit, onCreateAuditTask, agents = [], onOpenTaskList, onOpenSites = () => {} }: { clients: Client[]; active: boolean; selectedClientId?: string; canEditClients: boolean; onEditClient: (client: Client) => void; onMapAccount: (clientId: string, accountId: string) => Promise<boolean>; onCreateTask: (clientId: string, campaign: Campaign, rangeLabel: string) => void; onCreateCampaignReport: (clientId: string, campaignId: string, campaignName: string, range: string, from: string, to: string) => void; auditRuns?: MarketingAuditRun[]; canRunAudit: boolean; onSaveAudit: (run: MarketingAuditRun) => Promise<boolean>; onCreateAuditTask: (clientId: string, title: string, notes: string) => void; agents?: Array<{ id: string; name: string; isBot?: boolean; avatar?: string }>; onOpenTaskList: () => void; onOpenSites?: () => void }) {
  const [clientId, setClientId] = useState(clients.find((client) => client.googleAdsAccountId)?.id || clients[0]?.id || "");
  const [range, setRange] = useState("last_30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [campaignId, setCampaignId] = useState("all");
  const [section, setSection] = useState<AdsSection>("performance");
  const [payload, setPayload] = useState<AdsPayload | null>(null);
  const [campaignDirectory, setCampaignDirectory] = useState<Array<{ id: string; name: string; status: string; dailyBudget?: string }> | null>(null);
  const [campaignDirectoryError, setCampaignDirectoryError] = useState("");
  const [breakdown, setBreakdown] = useState<AdsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [error, setError] = useState("");
  const [directConnection, setDirectConnection] = useState<DirectConnection | null>(null);
  const [directAccounts, setDirectAccounts] = useState<DirectAccount[] | null>(null);
  const [reportAccounts, setReportAccounts] = useState<DirectAccount[] | null>(null);
  const [directAccountsLoading, setDirectAccountsLoading] = useState(false);
  const [reportAccountsLoading, setReportAccountsLoading] = useState(false);
  const [directAccountsError, setDirectAccountsError] = useState("");
  const [selectedDirectAccountId, setSelectedDirectAccountId] = useState("");
  const [mappingAccount, setMappingAccount] = useState(false);
  const [mappingNotice, setMappingNotice] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [adGroups, setAdGroups] = useState<AdsAdGroup[]>([]);
  const [keywordForm, setKeywordForm] = useState({ keyword: "", adGroupId: "", matchType: "PHRASE" as "EXACT" | "PHRASE" | "BROAD", negative: true, remove: false });
  const [pendingKeywordChanges, setPendingKeywordChanges] = useState<PendingKeywordChange[]>([]);
  const [keywordActionLoading, setKeywordActionLoading] = useState(false);
  const [keywordActionMessage, setKeywordActionMessage] = useState("");
  const [keywordActionError, setKeywordActionError] = useState("");
  const [plannerForm, setPlannerForm] = useState({ seeds: "", url: "", geo: "2372" });
  const [plannerResults, setPlannerResults] = useState<KeywordPlannerResult[]>([]);
  const [plannerLoading, setPlannerLoading] = useState(false);
  const [plannerError, setPlannerError] = useState("");
  const client = clients.find((item) => item.id === clientId);
  useEffect(() => { if (active && selectedClientId && clients.some((item) => item.id === selectedClientId)) setClientId(selectedClientId); }, [active, selectedClientId, clients]);
  const accountChoices = useMemo(() => {
    const byId = new Map<string, DirectAccount>();
    for (const account of directAccounts || []) byId.set(account.id, account);
    for (const account of reportAccounts || []) byId.set(account.id, account);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [directAccounts, reportAccounts]);

  useEffect(() => { setSelectedDirectAccountId(client?.googleAdsAccountId || ""); setMappingNotice(""); }, [clientId, client?.googleAdsAccountId]);

  useEffect(() => {
    if (!active || !canEditClients) return;
    let cancelled = false;
    void fetch("/api/google-ads?connectionStatus=1", { cache: "no-store" }).then(async (response) => {
      const status = await readApiJson<DirectConnection & { error?: string }>(response, "Direct Google Ads connection");
      if (!response.ok) throw new Error(status.error || "Could not check the direct Google Ads connection.");
      return status;
    }).then((status) => { if (!cancelled) setDirectConnection(status); }).catch((reason) => { if (!cancelled) setDirectAccountsError(reason instanceof Error ? reason.message : "Could not check the direct Google Ads connection."); });
    return () => { cancelled = true; };
  }, [active, canEditClients]);

  useEffect(() => {
    if (!active || !clientId || !canEditClients || !directConnection?.apiReady) { setCampaignDirectory(null); setCampaignDirectoryError(""); return; }
    let cancelled = false;
    setCampaignDirectoryError("");
    void fetch(`/api/google-ads?campaignsForClient=${encodeURIComponent(clientId)}`, { cache: "no-store" }).then(async (response) => {
      const result = await readApiJson<{ campaigns?: Array<{ id: string; name: string; status: string; dailyBudget?: string }>; error?: string }>(response, "Google Ads campaigns");
      if (!response.ok) throw new Error(result.error || "Could not load all Google Ads campaigns.");
      return result.campaigns || [];
    }).then((campaigns) => { if (!cancelled) setCampaignDirectory(campaigns); })
      .catch((reason) => { if (!cancelled) { setCampaignDirectory(null); setCampaignDirectoryError(reason instanceof Error ? reason.message : "Could not load all Google Ads campaigns."); } });
    return () => { cancelled = true; };
  }, [active, clientId, canEditClients, directConnection?.apiReady]);

  async function loadDirectAccounts() {
    setDirectAccountsLoading(true); setDirectAccountsError(""); setMappingNotice("");
    try {
      const response = await fetch("/api/google-ads?accessibleCustomers=1", { cache: "no-store" });
      const result = await readApiJson<{ accounts?: DirectAccount[]; error?: string }>(response, "Direct Google Ads accounts");
      if (!response.ok) throw new Error(result.error || "Could not load directly accessible Google Ads accounts.");
      const accounts = result.accounts || [];
      setDirectAccounts(accounts);
      const mappedId = client?.googleAdsAccountId?.replace(/\D/g, "");
      if (mappedId && accounts.some((account) => account.id === mappedId)) setSelectedDirectAccountId(mappedId);
      if (!accounts.length) setDirectAccountsError("This Google login has no directly accessible Ads accounts. If your accounts are under a manager, check that the login has access to the manager account.");
    } catch (reason) { setDirectAccountsError(reason instanceof Error ? reason.message : "Could not load directly accessible Google Ads accounts."); }
    finally { setDirectAccountsLoading(false); }
  }

  async function loadReportAccounts() {
    setReportAccountsLoading(true); setDirectAccountsError(""); setMappingNotice("");
    try {
      const response = await fetch("/api/google-ads/accounts", { cache: "no-store" });
      const result = await readApiJson<{ accounts?: DirectAccount[]; error?: string }>(response, "Windsor Google Ads accounts");
      if (!response.ok) throw new Error(result.error || "Could not find Windsor reporting accounts.");
      const accounts = result.accounts || [];
      setReportAccounts(accounts);
      const mappedId = client?.googleAdsAccountId?.replace(/\D/g, "");
      if (mappedId && accounts.some((account) => account.id === mappedId)) setSelectedDirectAccountId(mappedId);
      if (!accounts.length) setDirectAccountsError("Windsor returned no Google Ads accounts for the last 7 days. Check the connected Windsor source or enter the account ID in the client record.");
    } catch (reason) { setDirectAccountsError(reason instanceof Error ? reason.message : "Could not find connected Google Ads reporting accounts."); }
    finally { setReportAccountsLoading(false); }
  }

  async function saveDirectAccountMapping() {
    if (!client || !selectedDirectAccountId) return;
    setMappingAccount(true); setDirectAccountsError(""); setMappingNotice("");
    try {
      const saved = await onMapAccount(client.id, selectedDirectAccountId);
      if (!saved) throw new Error("The account was not saved to this client.");
      setMappingNotice(`${client.name} is now linked to Ads account ${selectedDirectAccountId}.`);
    } catch (reason) { setDirectAccountsError(reason instanceof Error ? reason.message : "Could not save this account to the client."); }
    finally { setMappingAccount(false); }
  }

  useEffect(() => {
    if (!active || !clientId) return;
    let cancelled = false;
    setLoading(true); setError(""); setPayload(null); setCampaignId("all");
    const params = new URLSearchParams({ clientId, range });
    if (range === "custom") { if (customFrom) params.set("from", customFrom); if (customTo) params.set("to", customTo); }
    void fetchReadWithRetry(`/api/google-ads/workspace?${params}`, { cache: "no-store" }).then(async (response) => {
      const result = await readApiJson<AdsPayload & { error?: string }>(response, "Google Ads");
      if (!response.ok) throw new Error(result.error || "Could not load Google Ads performance.");
      return result;
    }).then((result) => { if (!cancelled) setPayload(result); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load Google Ads data."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [active, clientId, range, customFrom, customTo]);

  useEffect(() => {
    if (!active || !clientId || section === "performance" || section === "campaigns" || section === "keyword_planner" || !payload || !["connected", "no_data"].includes(payload.status)) { setBreakdown(null); return; }
    let cancelled = false;
    setBreakdownLoading(true); setBreakdown(null);
    const params = new URLSearchParams({ clientId, range, section });
    if (range === "custom") { if (customFrom) params.set("from", customFrom); if (customTo) params.set("to", customTo); }
    if (campaignId !== "all" && /^\d+$/.test(campaignId)) params.set("campaignId", campaignId);
    void fetchReadWithRetry(`/api/google-ads/workspace?${params}`, { cache: "no-store" }).then(async (response) => {
      const result = await readApiJson<AdsPayload & { error?: string }>(response, "Google Ads");
      if (!response.ok) throw new Error(result.error || "Could not load this Google Ads section.");
      return result;
    }).then((result) => { if (!cancelled) setBreakdown(result); })
      .catch((reason) => { if (!cancelled) setBreakdown({ status: "unavailable", message: reason instanceof Error ? reason.message : "Could not load this Google Ads section." }); })
      .finally(() => { if (!cancelled) setBreakdownLoading(false); });
    return () => { cancelled = true; };
  }, [active, clientId, range, customFrom, customTo, section, campaignId, payload?.status]);

  const campaigns = useMemo(() => {
    const reported = payload?.current?.campaigns || [];
    if (!campaignDirectory) return reported;
    const byId = new Map(reported.map((campaign) => [campaign.id, campaign]));
    return campaignDirectory.map((campaign) => ({
      spend: 0,
      impressions: 0,
      clicks: 0,
      conversions: 0,
      conversionValue: 0,
      ctr: null,
      averageCpc: null,
      costPerConversion: null,
      conversionRate: null,
      returnOnAdSpend: null,
      ...byId.get(campaign.id),
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
    }));
  }, [payload?.current?.campaigns, campaignDirectory]);
  const selectedCampaign = campaigns.find((campaign) => campaign.id === campaignId);
  const totals = selectedCampaign || payload?.current?.totals;
  const previousCampaign = payload?.previous?.campaigns.find((campaign) => campaign.id === campaignId);
  const hasReportedRows = (payload?.current?.sourceRows || 0) > 0;
  const changes = !hasReportedRows ? undefined : campaignId === "all" ? payload?.changes : selectedCampaign && previousCampaign ? compareGoogleAdsTotals(selectedCampaign, previousCampaign) : undefined;
  const chartData = useMemo(() => {
    const rows = campaignId === "all" ? payload?.current?.daily || [] : (payload?.current?.campaignDaily || []).filter((row) => row.campaignId === campaignId);
    const byDate = new Map<string, number>();
    for (const item of rows) byDate.set(item.date, (byDate.get(item.date) || 0) + item.clicks);
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, clicks]) => ({ date, clicks }));
  }, [payload, campaignId]);
  const peak = Math.max(1, ...chartData.map((item) => item.clicks));
  const rangeLabel = payload?.dateWindow ? `${payload.dateWindow.current.start} to ${payload.dateWindow.current.end}` : range === "custom" ? `${customFrom || "Start"} to ${customTo || "End"}` : range.replace("last_", "Last ").replace("d", " days");

  async function refreshKeywordProposals() {
    if (!clientId) return;
    const response = await fetch(`/api/google-ads?pendingClientId=${encodeURIComponent(clientId)}`, { cache: "no-store" });
    const result = await readApiJson<{ proposals?: PendingKeywordChange[]; error?: string }>(response, "Google Ads approvals");
    if (!response.ok) throw new Error(result.error || "Could not load keyword proposals.");
    setPendingKeywordChanges(result.proposals || []);
  }

  useEffect(() => {
    if (!active || section !== "keywords" || !clientId || !canEditClients || !directConnection?.apiReady || campaignId === "all") { setAdGroups([]); return; }
    let cancelled = false;
    setKeywordActionError("");
    void Promise.all([
      fetch(`/api/google-ads?adGroupsForClient=${encodeURIComponent(clientId)}&campaignId=${encodeURIComponent(campaignId)}`, { cache: "no-store" }).then(async (response) => {
        const result = await readApiJson<{ adGroups?: AdsAdGroup[]; error?: string }>(response, "Google Ads ad groups");
        if (!response.ok) throw new Error(result.error || "Could not load ad groups.");
        return result.adGroups || [];
      }), refreshKeywordProposals(),
    ]).then(([groups]) => { if (!cancelled) { setAdGroups(groups); if (!keywordForm.adGroupId || !groups.some((group) => group.id === keywordForm.adGroupId)) setKeywordForm((current) => ({ ...current, adGroupId: groups[0]?.id || "" })); } })
      .catch((reason) => { if (!cancelled) setKeywordActionError(reason instanceof Error ? reason.message : "Could not load keyword tools."); });
    return () => { cancelled = true; };
  }, [active, section, clientId, campaignId, canEditClients, directConnection?.apiReady]);

  async function prepareKeywordChange(event: FormEvent) {
    event.preventDefault();
    if (!client || campaignId === "all" || !keywordForm.adGroupId || !keywordForm.keyword.trim()) return;
    setKeywordActionLoading(true); setKeywordActionError(""); setKeywordActionMessage("");
    try {
      const response = await fetch("/api/google-ads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ proposeKeyword: { clientId, campaignId, ...keywordForm, keyword: keywordForm.keyword.trim() } }) });
      const result = await readApiJson<{ summary?: string; error?: string }>(response, "Google Ads keyword proposal");
      if (!response.ok) throw new Error(result.error || "Could not prepare keyword proposal.");
      setKeywordActionMessage(`${result.summary || "Keyword change"} is waiting for your approval. No account change has happened yet.`);
      setKeywordForm((current) => ({ ...current, keyword: "" }));
      await refreshKeywordProposals();
    } catch (reason) { setKeywordActionError(reason instanceof Error ? reason.message : "Could not prepare this keyword change."); }
    finally { setKeywordActionLoading(false); }
  }

  async function decideKeywordProposal(id: string, decision: "approve" | "reject") {
    setKeywordActionLoading(true); setKeywordActionError(""); setKeywordActionMessage("");
    try {
      const response = await fetch("/api/google-ads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(decision === "approve" ? { confirmed: true, pendingChangeId: id } : { decision: "reject", pendingChangeId: id }) });
      const result = await readApiJson<{ detail?: string; error?: string; verified?: boolean }>(response, "Google Ads keyword decision");
      if (!response.ok) throw new Error(result.error || "Could not decide this proposal.");
      setKeywordActionMessage(decision === "approve" ? `${result.detail || "Change applied."} ${result.verified ? "Google Ads read-back verified it." : "Google Ads did not confirm it on read-back."}` : "Proposal rejected. No Google Ads change was made.");
      await refreshKeywordProposals();
      setBreakdown(null);
    } catch (reason) { setKeywordActionError(reason instanceof Error ? reason.message : "Could not decide this proposal."); }
    finally { setKeywordActionLoading(false); }
  }

  async function runKeywordPlanner(event: FormEvent) {
    event.preventDefault(); setPlannerLoading(true); setPlannerError(""); setPlannerResults([]);
    try {
      const response = await fetch("/api/seo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, seeds: plannerForm.seeds.split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean), url: plannerForm.url.trim(), geo: plannerForm.geo }) });
      const result = await readApiJson<{ results?: KeywordPlannerResult[]; error?: string }>(response, "Google Ads Keyword Planner");
      if (!response.ok) throw new Error(result.error || "Keyword Planner could not return ideas.");
      setPlannerResults(result.results || []);
    } catch (reason) { setPlannerError(reason instanceof Error ? reason.message : "Keyword Planner could not return ideas."); }
    finally { setPlannerLoading(false); }
  }

  return <main className="page-heading google-ads-view">
    <header className="google-ads-view-heading"><div><p className="eyebrow">📣 CLIENT CAMPAIGN WORKSPACE</p><h1>Google Ads</h1><p className="muted">Live campaign results from the client’s connected Ads account.</p></div><div className="google-ads-view-controls">{clients.length > 1 && <label><span>Client</span><select aria-label="Choose Google Ads client" value={clientId} onChange={(event) => setClientId(event.target.value)}>{clients.map((item) => <option value={item.id} key={item.id}>{item.name}{item.googleAdsAccountId ? "" : " · account not linked"}</option>)}</select></label>}<label><span>Audit and report period</span><select aria-label="Choose Google Ads audit and report period" value={range} onChange={(event) => setRange(event.target.value)}><option value="last_7d">Last 7 days</option><option value="last_30d">Last 30 days</option><option value="last_90d">Last 90 days</option><option value="custom">Custom dates</option></select></label>{range === "custom" && <><label><span>From</span><input type="date" aria-label="Audit period start date" value={customFrom} max={customTo || undefined} onChange={(event) => setCustomFrom(event.target.value)} /></label><label><span>To</span><input type="date" aria-label="Audit period end date" value={customTo} min={customFrom || undefined} onChange={(event) => setCustomTo(event.target.value)} /></label></>}</div></header>
    {canEditClients && <section className="google-ads-direct-access"><div className="google-ads-direct-copy"><span className="eyebrow">🔐 DIRECT GOOGLE ADS API</span><b>{directConnection?.apiReady ? "Direct account access ready" : directConnection?.connected ? "Google login connected" : directConnection?.configured ? "Connect the Google login for your Ads accounts" : "Google Ads API credentials are not configured"}</b><p>{directConnection?.apiReady ? "Google API account access is ready. Account changes still require your approval." : directConnection?.configured ? "Connect the Google account that has access to your client Ads accounts. Google Ads API access is managed by its Google Cloud project; Windsor can provide read-only reports." : "The app needs its server-side Google Ads OAuth settings before direct connection can be used."}</p></div><div className="google-ads-direct-actions"><button className="secondary-button" type="button" onClick={() => void loadReportAccounts()} disabled={reportAccountsLoading}>{reportAccountsLoading ? "Finding accounts…" : "Find reporting accounts"}</button>{directConnection?.configured && <a className="secondary-button" href="/api/google-ads/connect">{directConnection.connected ? "Reconnect Google" : "Connect Google"}</a>}{directConnection?.connected && <button className="secondary-button" type="button" onClick={() => void loadDirectAccounts()} disabled={directAccountsLoading || !directConnection.apiReady}>{directAccountsLoading ? "Loading…" : "Load direct accounts"}</button>}</div>{accountChoices.length > 0 && client && <div className="google-ads-direct-mapping"><label><span>Google Ads account for {client.name}</span><select value={selectedDirectAccountId} onChange={(event) => { setSelectedDirectAccountId(event.target.value); setMappingNotice(""); }}><option value="">Choose an account</option>{accountChoices.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><button className="primary-button" type="button" disabled={!selectedDirectAccountId || mappingAccount || selectedDirectAccountId === (client.googleAdsAccountId || "").replace(/\D/g, "")} onClick={() => void saveDirectAccountMapping()}>{mappingAccount ? "Saving…" : "Save account to client"}</button><small>Windsor links this account for read-only reports. Direct Ads edits use the connected Google login and Google Cloud project access.</small></div>}{directAccountsError && <p className="google-ads-direct-error" role="status">{directAccountsError}</p>}{mappingNotice && <p className="google-ads-direct-success" role="status">{mappingNotice}</p>}</section>}
    {!client && <section className="google-ads-status"><b>No clients saved yet</b><p>Add a client before loading Ads performance.</p></section>}
    {error && <section className="google-ads-status is-error" role="alert"><b>Couldn’t load Google Ads data</b><p>{error}</p></section>}
    {loading && <section className="google-ads-status" role="status">Loading live campaign results…</section>}
    {!loading && !error && payload?.status === "not_mapped" && <section className="google-ads-status"><b>Link a Google Ads account to {client?.name}</b><p>{payload.message}</p>{canEditClients && client && <button type="button" className="primary-button" onClick={() => onEditClient(client)}>Edit client account details</button>}</section>}
    {!loading && !error && payload?.status === "missing_connection" && <section className="google-ads-status is-error"><b>Google Ads data connection is unavailable</b><p>{payload.message}</p></section>}
    {!loading && !error && payload?.status === "unavailable" && <section className="google-ads-status is-error"><b>Google Ads data could not be retrieved</b><p>{payload.message}</p></section>}
    {!loading && !error && (payload?.status === "connected" || payload?.status === "no_data") && totals && <>
      <section className="google-ads-status google-ads-live"><div><b>{client?.name}</b><p>Account {payload.accountId} · {rangeLabel} · {payload.current?.sourceRows || 0} data rows · Updated {payload.updatedAt ? new Date(payload.updatedAt).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" }) : "just now"}</p></div><span>{payload.status === "connected" ? "● Live read-only" : "No rows returned"}</span></section>
      <div className="google-ads-campaign-filter"><label><span>Campaign</span><select aria-label="Filter Google Ads campaign" value={campaignId} onChange={(event) => setCampaignId(event.target.value)}><option value="all">All campaigns</option>{campaigns.map((campaign) => <option key={campaign.id || campaign.name} value={campaign.id || campaign.name}>{campaign.name} · {campaign.status}</option>)}</select></label>{selectedCampaign && client && <button className="secondary-button" title="Opens Report Studio with this client, campaign and date range preselected. It does not make changes in Google Ads." type="button" onClick={() => onCreateCampaignReport(client.id, selectedCampaign.id, selectedCampaign.name, range, customFrom, customTo)}>📄 Build campaign report</button>}{campaignDirectory === null && directConnection?.apiReady && !campaignDirectoryError && <span className="google-ads-empty" role="status">Loading all campaigns…</span>}{campaignDirectoryError && <span className="google-ads-empty" role="status">Couldn’t load the full campaign list; showing campaigns with report data.</span>}</div>
      <section className="google-ads-metric-grid" aria-label="Google Ads summary metrics">{[
        ["Spend", hasReportedRows ? asMoney(totals.spend, payload.currency || "EUR") : "—", hasReportedRows ? delta(changes?.spend) : "No account rows returned"],
        ["Conversions", hasReportedRows ? asNumber(totals.conversions) : "—", hasReportedRows ? delta(changes?.conversions) : "No account rows returned"],
        ["Cost per conversion", hasReportedRows ? asMoney(totals.costPerConversion, payload.currency || "EUR") : "—", hasReportedRows ? delta(changes?.costPerConversion, true) : "No account rows returned"],
        ["Conversion value / spend", !hasReportedRows || totals.returnOnAdSpend == null ? "—" : `${totals.returnOnAdSpend.toFixed(2)}×`, hasReportedRows ? "Calculated from reported conversion value" : "No account rows returned"],
      ].map(([label, value, compare]) => <article className="google-ads-metric" key={label}><span>{label}</span><b>{value}</b><small>{compare}</small></article>)}</section>
      <nav className="google-ads-tabs" aria-label="Google Ads sections">{([["performance", "Performance"], ["campaigns", "Campaigns"], ["ad_groups", "Ad groups"], ["keywords", "Keywords"], ["search_terms", "Search terms"], ["ads", "Ads & copy"], ["assets", "All assets"], ["keyword_planner", "Keyword Planner"], ["setup", "Setup"]] as [AdsSection, string][]).map(([key, label]) => <button key={key} type="button" className={section === key ? "is-active" : ""} aria-pressed={section === key} onClick={() => setSection(key)}>{label}</button>)}</nav>
      {section === "setup" && client && <MarketingSetupWizard kind="google_ads" clientId={client.id} clientName={client.name} canEdit={canEditClients} canOpenSites={canEditClients} agents={agents.filter((agent) => agent.isBot)} onOpenTaskList={onOpenTaskList} onOpenSites={onOpenSites} onOpenTool={(stepId) => { const destinations: Record<string, AdsSection> = { keyword_research: "keyword_planner", campaign_structure: "campaigns", relevance: "ads", ads_assets: "assets", prelaunch_audit: "performance", launch: "campaigns" }; setSection(destinations[stepId] || "performance"); }} />}
      {client && <MarketingAuditPanel clientId={client.id} clientName={client.name} service="Google Ads" period={rangeLabel} status={payload.status === "connected" ? "connected" : payload.status === "no_data" ? "no_data" : "unavailable"} data={payload} history={auditRuns} canRunAudit={canRunAudit} onSave={onSaveAudit} onCreateTask={(title, notes) => onCreateAuditTask(client.id, title, notes)} />}
      {section === "performance" && <section className="google-ads-data-panel"><div className="google-ads-panel-heading"><div><h2>Daily clicks</h2><p>{campaignId === "all" ? "All campaigns" : selectedCampaign?.name || "Selected campaign"} · {rangeLabel}</p></div><div className="google-ads-secondary-metrics"><span><b>{asNumber(totals.clicks)}</b> clicks</span><span><b>{asNumber(totals.impressions)}</b> impressions</span><span><b>{totals.ctr == null ? "—" : `${(totals.ctr * 100).toFixed(2)}%`}</b> CTR</span></div></div><div className="google-ads-chart" role="img" aria-label="Daily Google Ads clicks">{chartData.map((item) => <span key={item.date} title={`${item.date}: ${item.clicks} clicks`} style={{ height: `${Math.max(3, item.clicks / peak * 100)}%` }} />)}</div><div className="google-ads-chart-labels"><span>{chartData[0]?.date || "No daily data"}</span><span>{chartData.at(-1)?.date || ""}</span></div></section>}
      {section === "performance" && <MarketingSnapshotHistory service="Google Ads" snapshots={payload.snapshots} metrics={[{ label: "Spend", path: ["current", "totals", "spend"], format: "money" }, { label: "Clicks", path: ["current", "totals", "clicks"] }, { label: "Conversions", path: ["current", "totals", "conversions"] }]} />}
      {section === "campaigns" && <AdsRows title="Campaign performance" description="Reported campaign results. Create a task to send a campaign with its current metrics to your existing task workflow." rows={campaigns.filter((campaign) => campaignId === "all" || campaign.id === campaignId)} currency={payload.currency || "EUR"} rangeLabel={rangeLabel} onCreateTask={(item) => onCreateTask(clientId, item, rangeLabel)} />}
      {section === "keyword_planner" && <section className="google-ads-data-panel"><div className="google-ads-panel-heading"><div><h2>Keyword Planner</h2><p>Use Google’s search-demand and bid estimates to build a keyword shortlist for {client?.name || "this client"}.</p></div><span>Planning only · no Ads changes</span></div>{!canEditClients ? <p className="google-ads-empty">Keyword Planner access is limited to workspace owners and admins.</p> : <form className="google-ads-keyword-form" onSubmit={(event) => void runKeywordPlanner(event)}><label><span>Seed phrases · up to 10</span><textarea value={plannerForm.seeds} onChange={(event) => setPlannerForm((current) => ({ ...current, seeds: event.target.value }))} placeholder="roof repairs Galway\nroofing contractor" rows={3} /></label><label><span>Optional landing page</span><input type="url" value={plannerForm.url} onChange={(event) => setPlannerForm((current) => ({ ...current, url: event.target.value }))} placeholder={client?.googleAdsAccountId ? "https://example.ie/service-page" : "Connect a Google Ads account first"} /></label><label><span>Location</span><select value={plannerForm.geo} onChange={(event) => setPlannerForm((current) => ({ ...current, geo: event.target.value }))}><option value="2372">Ireland</option><option value="2826">United Kingdom</option><option value="2840">United States</option></select></label><button className="primary-button" type="submit" disabled={plannerLoading || (!plannerForm.seeds.trim() && !plannerForm.url.trim())}>{plannerLoading ? "Finding ideas…" : "Find keyword ideas"}</button></form>}{plannerError && <p className="google-ads-status is-error" role="alert">{plannerError}</p>}{plannerResults.length > 0 && <><p className="google-ads-data-note">{plannerResults.length} Google Keyword Planner ideas. Volumes and bids are estimates for the selected location, not guaranteed traffic.</p><div className="google-ads-table-wrap"><table className="google-ads-table"><thead><tr><th>Keyword idea</th><th>Avg. monthly searches</th><th>Competition</th><th>Competition index</th><th>Top-of-page bid range</th><th>Recent monthly history</th></tr></thead><tbody>{plannerResults.map((idea) => <tr key={idea.keyword}><td><b>{idea.keyword}</b></td><td>{asNumber(idea.avgMonthlySearches)}</td><td>{idea.competition}</td><td>{idea.competitionIndex == null ? "—" : `${idea.competitionIndex}/100`}</td><td>{asMoney(idea.lowTopOfPageBid, payload.currency || "EUR")} – {asMoney(idea.highTopOfPageBid, payload.currency || "EUR")}</td><td>{idea.monthlySearchVolumes?.map((item) => `${item.month} ${item.year}: ${asNumber(item.searches)}`).join(" · ") || "—"}</td></tr>)}</tbody></table></div></>}{plannerResults.length === 0 && !plannerLoading && !plannerError && <p className="google-ads-data-note">Enter one or more phrases, or a landing page, then choose a location. Keyword Planner requires the direct Google Ads API connection to be fully set up.</p>}</section>}
      {section === "ads" && <section className="google-ads-data-panel"><div className="google-ads-panel-heading"><div><h2>Responsive search ads</h2><p>Ad copy and landing pages from Google Ads · {campaignId === "all" ? "all campaigns" : selectedCampaign?.name || "selected campaign"}</p></div><span>{breakdown?.ads?.length || 0} ads</span></div>{breakdownLoading && <p className="google-ads-empty" role="status">Loading responsive search ads…</p>}{!breakdownLoading && breakdown?.status === "missing_connection" && <p className="google-ads-empty" role="status">{breakdown.message}</p>}{!breakdownLoading && breakdown?.status === "unavailable" && <p className="google-ads-empty" role="alert">{breakdown.message}</p>}{!breakdownLoading && breakdown?.status === "no_data" && <p className="google-ads-empty">No responsive search ads were returned for this campaign.</p>}{!breakdownLoading && breakdown?.ads?.map((ad) => <article className="google-ads-data-panel" key={ad.adId}><div className="google-ads-panel-heading"><div><h3>{ad.campaignName} · {ad.adGroupName}</h3><p>Ad ID {ad.adId} · {ad.status}</p></div><span>Responsive search ad</span></div>{ad.finalUrls.length > 0 && <div className="google-ads-landing-links"><b>Landing pages</b>{ad.finalUrls.map((rawUrl) => { const url = safeAdsUrl(rawUrl); return url && <div key={url}><span>{url}</span><button type="button" className="secondary-button" onClick={() => setPreviewUrl(url)}>Preview page</button><a className="secondary-button" href={url} target="_blank" rel="noopener noreferrer">Open page ↗</a></div>; })}</div>}<details><summary>Headlines ({ad.headlines.length})</summary><ul>{ad.headlines.map((item, index) => <li key={`${index}-${item.text}`}>{item.text}{item.pinnedField ? ` · pinned ${item.pinnedField}` : ""}</li>)}</ul></details><details><summary>Descriptions ({ad.descriptions.length})</summary><ul>{ad.descriptions.map((item, index) => <li key={`${index}-${item.text}`}>{item.text}{item.pinnedField ? ` · pinned ${item.pinnedField}` : ""}</li>)}</ul></details></article>)}{breakdown?.dataNote && <p className="google-ads-data-note">{breakdown.dataNote}</p>}{breakdown?.mayBeLimited && <p className="google-ads-data-note">Google Ads returned the 500-row limit; more ads may exist.</p>}</section>}
      {section === "assets" && <section className="google-ads-data-panel"><div className="google-ads-panel-heading"><div><h2>Google Ads assets</h2><p>Sitelinks, callouts, snippets, calls, images and other linked assets · {campaignId === "all" ? "all campaigns" : selectedCampaign?.name || "selected campaign"} · {rangeLabel}</p></div><span>{breakdown?.assets?.length || 0} assets</span></div>{breakdownLoading && <p className="google-ads-empty" role="status">Loading Google Ads assets…</p>}{!breakdownLoading && breakdown?.status === "missing_connection" && <p className="google-ads-empty" role="status">{breakdown.message}</p>}{!breakdownLoading && breakdown?.status === "unavailable" && <p className="google-ads-empty" role="alert">{breakdown.message}</p>}{!breakdownLoading && breakdown?.status === "no_data" && <p className="google-ads-empty">No linked assets were returned for this selection.</p>}{!breakdownLoading && breakdown?.assets?.map((asset) => <article className="google-ads-data-panel" key={`${asset.scope}-${asset.assetId}-${asset.fieldType}-${asset.adGroupId}`}><div className="google-ads-panel-heading"><div><h3>{asset.fieldType.replaceAll("_", " ")} · {asset.assetName || `${asset.type.replaceAll("_", " ")} ${asset.assetId}`}</h3><p>{asset.campaignName || "All campaigns"}{asset.adGroupName ? ` · ${asset.adGroupName}` : ""} · {asset.scope} · {asset.status} · {asset.source || "source not supplied"}{asset.performanceLabel ? ` · ${asset.performanceLabel}` : ""}</p></div><span>{asNumber(asset.impressions)} impressions · {asNumber(asset.clicks)} clicks{asset.ctr == null ? "" : ` · ${(asset.ctr * 100).toFixed(2)}% CTR`} · {asMoney(asset.spend, payload.currency || "EUR")} · {asNumber(asset.conversions)} conv.</span></div>{asset.text.length > 0 && <ul>{asset.text.map((text, index) => <li key={`${index}-${text}`}>{text}</li>)}</ul>}{asset.imageUrl && <p className="google-ads-data-note"><a href={asset.imageUrl} target="_blank" rel="noopener noreferrer">View image asset ↗</a></p>}{asset.finalUrls.length > 0 && <div className="google-ads-landing-links"><b>Landing pages</b>{asset.finalUrls.map((rawUrl) => { const url = safeAdsUrl(rawUrl); return url && <div key={url}><span>{url}</span><button type="button" className="secondary-button" onClick={() => setPreviewUrl(url)}>Preview page</button><a className="secondary-button" href={url} target="_blank" rel="noopener noreferrer">Open page ↗</a></div>; })}</div>}</article>)}{breakdown?.dataNote && <p className="google-ads-data-note">{breakdown.dataNote}</p>}{breakdown?.mayBeLimited && <p className="google-ads-data-note">Google Ads returned the row limit; more assets may exist.</p>}</section>}
      {["ad_groups", "keywords", "search_terms"].includes(section) && <section className="google-ads-data-panel"><div className="google-ads-panel-heading"><div><h2>{section === "ad_groups" ? "Ad group performance" : section === "keywords" ? "Keyword performance" : "Search terms"}</h2><p>On-demand data · {rangeLabel}{campaignId !== "all" ? ` · ${selectedCampaign?.name || "selected campaign"}` : " · all campaigns"}{section === "keywords" ? " · Includes CTR, clicks, CPC, conversion value and Quality Score where Google supplies it" : section === "search_terms" ? " · Includes match source, targeting status, triggering keyword, device and network" : ""}</p></div><span>{breakdown?.rows?.length || 0} rows</span></div>{section === "keywords" && <div className="google-ads-keyword-tools">{canEditClients ? directConnection?.apiReady ? <><h3>Add or remove a keyword</h3><p>Choose one campaign and ad group. Every change goes to approval first; it will not change the account until you approve it.</p>{campaignId === "all" ? <p className="google-ads-empty">Select a campaign above to choose its ad group and prepare a keyword change.</p> : <form className="google-ads-keyword-form" onSubmit={(event) => void prepareKeywordChange(event)}><label><span>Keyword</span><input value={keywordForm.keyword} maxLength={80} onChange={(event) => setKeywordForm((current) => ({ ...current, keyword: event.target.value }))} placeholder="e.g. emergency roof repair" required /></label><label><span>Ad group</span><select value={keywordForm.adGroupId} onChange={(event) => setKeywordForm((current) => ({ ...current, adGroupId: event.target.value }))}>{adGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label><label><span>Match type</span><select value={keywordForm.matchType} onChange={(event) => setKeywordForm((current) => ({ ...current, matchType: event.target.value as "EXACT" | "PHRASE" | "BROAD" }))}><option value="EXACT">Exact</option><option value="PHRASE">Phrase</option><option value="BROAD">Broad</option></select></label><label><span>Keyword kind</span><select value={keywordForm.negative ? "negative" : "positive"} onChange={(event) => setKeywordForm((current) => ({ ...current, negative: event.target.value === "negative" }))}><option value="positive">Target keyword</option><option value="negative">Negative keyword</option></select></label><label><span>Action</span><select value={keywordForm.remove ? "remove" : "add"} onChange={(event) => setKeywordForm((current) => ({ ...current, remove: event.target.value === "remove" }))}><option value="add">Add</option><option value="remove">Remove</option></select></label><button type="submit" className="primary-button" disabled={keywordActionLoading || !keywordForm.keyword.trim() || !keywordForm.adGroupId}>{keywordActionLoading ? "Preparing…" : "Prepare approval"}</button></form>}</> : <p className="google-ads-empty">Direct Google Ads is not ready. Check the connected Google login and Google Ads API access for its Cloud project.</p> : <p className="google-ads-empty">Only workspace owners and admins can prepare account changes.</p>}{keywordActionMessage && <p className="google-ads-direct-success" role="status">{keywordActionMessage}</p>}{keywordActionError && <p className="google-ads-direct-error" role="alert">{keywordActionError}</p>}{pendingKeywordChanges.length > 0 && <div className="google-ads-keyword-approvals"><h3>Keyword changes waiting for your approval</h3>{pendingKeywordChanges.map((proposal) => { let detail: { keyword?: string; matchType?: string; negative?: boolean; remove?: boolean } = {}; try { detail = JSON.parse(proposal.payload_json || "{}"); } catch {} return <article key={proposal.id}><div><b>{proposal.change_type.replaceAll("_", " ")}: “{detail.keyword || proposal.new_value}”</b><small>{proposal.campaign_name} · {detail.matchType || "match type unknown"} · {proposal.created_by} · never expires</small></div><button type="button" className="secondary-button" disabled={keywordActionLoading} onClick={() => void decideKeywordProposal(proposal.id, "reject")}>Reject</button><button type="button" className="primary-button" disabled={keywordActionLoading} onClick={() => void decideKeywordProposal(proposal.id, "approve")}>Approve & apply</button></article>; })}</div>}</div>}{breakdownLoading && <p className="google-ads-empty" role="status">Loading {section.replace("_", " ")}…</p>}{!breakdownLoading && breakdown?.status === "unavailable" && <p className="google-ads-empty" role="alert">{breakdown.message}</p>}{!breakdownLoading && breakdown?.status === "missing_connection" && <p className="google-ads-empty" role="status">{breakdown.message}</p>}{!breakdownLoading && breakdown?.status === "no_data" && <p className="google-ads-empty">No {section.replace("_", " ")} data was returned for this period.</p>}{!breakdownLoading && breakdown?.rows?.length ? <AdsRows section={section as "ad_groups" | "keywords" | "search_terms"} title="" description="" rows={breakdown.rows.filter((item) => campaignId === "all" || item.campaignId === campaignId || item.campaignName === selectedCampaign?.name)} currency={payload.currency || "EUR"} rangeLabel={rangeLabel} onCreateTask={(item) => onCreateTask(clientId, item, rangeLabel)} hideHeading /> : null}{breakdown?.mayBeLimited && <p className="google-ads-data-note">The connected source returned its row limit; this section may be incomplete.</p>}</section>}
      {previewUrl && <div className="google-ads-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewUrl(""); }}><section className="google-ads-preview-modal" role="dialog" aria-modal="true" aria-label="Landing page preview"><header><b>Landing page preview</b><div><a className="secondary-button" href={previewUrl} target="_blank" rel="noopener noreferrer">Open in new tab ↗</a><button type="button" className="secondary-button" onClick={() => setPreviewUrl("")}>Close</button></div></header><p>{previewUrl}</p><iframe title="Google Ads landing page preview" src={previewUrl} sandbox="allow-scripts allow-forms allow-same-origin" referrerPolicy="no-referrer" /></section></div>}
      {payload.status === "no_data" && <section className="google-ads-status google-ads-no-activity"><div><b>No Ads activity in this date range</b><p>{payload.activityDiagnosis || "The Google Ads connection is responding, but Google returned no campaign activity for the selected dates. Try a longer reporting period to check earlier results."}</p></div><button type="button" className="secondary-button" onClick={() => setRange("last_90d")}>View last 90 days</button></section>}
      <p className="google-ads-data-note">{payload.dataNote} Cost per conversion uses reported conversions. Conversion value is reported by the account and is not independently verified as closed revenue.</p>
    </>}
  </main>;
}

function AdsRows({ title, description, rows, currency, rangeLabel, onCreateTask, hideHeading = false, section = "campaigns" }: { title: string; description: string; rows: Campaign[]; currency: string; rangeLabel: string; onCreateTask: (item: Campaign) => void; hideHeading?: boolean; section?: "campaigns" | "ad_groups" | "keywords" | "search_terms" }) {
  const searchTerms = section === "search_terms";
  const keywords = section === "keywords";
  return <section className="google-ads-data-panel">{!hideHeading && <div className="google-ads-panel-heading"><div><h2>{title}</h2><p>{description}</p></div><span>{rows.length} rows</span></div>}{rows.length ? <div className="google-ads-table-wrap"><table className="google-ads-table"><thead><tr><th>{searchTerms ? "Search term" : keywords ? "Keyword" : "Name"}</th><th>{searchTerms ? "Search details" : "Status / type"}</th><th>Impressions</th><th>Clicks</th><th>CTR</th><th>Avg. CPC</th><th>Spend</th><th>Conversions</th><th>Conv. value</th><th>Cost / conv.</th>{keywords && <th>Quality</th>}<th /></tr></thead><tbody>{rows.map((row, index) => { const detail = row as BreakdownItem; const key = row.id || `${detail.campaignId}-${detail.adGroupId}-${row.name}-${index}`; const quality = detail.qualityScore == null ? "—" : `${detail.qualityScore}/10`; return <tr key={key}><td><b>{row.name}</b><small>{detail.kind ? `${detail.campaignName}${detail.adGroupName ? ` · ${detail.adGroupName}` : ""}${detail.matchType ? ` · ${detail.matchType}` : ""}` : row.id ? `ID ${row.id}` : ""}</small></td><td>{searchTerms ? <small>{[detail.matchSource, detail.targetingStatus && `Target: ${detail.targetingStatus}`, detail.triggeringKeyword && `Keyword: ${detail.triggeringKeyword} (${detail.triggeringKeywordMatchType || "match unknown"})`, detail.device, detail.network].filter(Boolean).join(" · ") || "Google did not return more detail"}</small> : <span className={`google-ads-status-pill ${row.status.toLowerCase()}`}>{detail.matchType || row.status}</span>}</td><td>{asNumber(row.impressions)}</td><td>{asNumber(row.clicks)}</td><td>{row.ctr == null ? "—" : `${(row.ctr * 100).toFixed(2)}%`}</td><td>{asMoney(row.averageCpc, currency)}</td><td>{asMoney(row.spend, currency)}</td><td>{asNumber(row.conversions)}</td><td>{asMoney(row.conversionValue, currency)}</td><td>{asMoney(row.costPerConversion, currency)}</td>{keywords && <td title={detail.adRelevance || detail.landingPageExperience || detail.expectedCtr ? `Ad relevance: ${detail.adRelevance || "—"}; landing page: ${detail.landingPageExperience || "—"}; expected CTR: ${detail.expectedCtr || "—"}` : "Google does not supply Quality Score for this row"}>{quality}</td>}<td><button type="button" className="secondary-button" onClick={() => onCreateTask(row)}>＋ Create task</button></td></tr>; })}</tbody></table></div> : <p className="google-ads-empty">No rows were returned for this selection and date range.</p>}{rangeLabel && <p className="google-ads-data-note">Reported results for {rangeLabel}. Google may withhold some low-volume search terms and quality diagnostics. Task creation carries this item and its context into the CRM workflow.</p>}</section>;
}
