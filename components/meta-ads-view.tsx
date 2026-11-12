"use client";

import { useEffect, useState } from "react";
import { MarketingAuditPanel } from "@/components/marketing-audit-panel";
import { MarketingSnapshotHistory, type MarketingHistorySnapshot } from "@/components/marketing-snapshot-history";
import type { MarketingAuditRun } from "@/lib/marketing-audit";
import { trustedMetaAdPreviewUrl } from "@/lib/meta-ad-preview";
import { readApiJson } from "@/lib/read-api-json";

type Client = { id: string; name: string; logo?: string; metaAdsAccountId?: string };
type MetaRow = { id: string; name: string; kind: string; status: string; campaignId: string; campaignName: string; spend: number; impressions: number; clicks: number; leads: number; ctr: number | null; costPerLead: number | null; linkClicks: number | null; linkCtr: number | null; costPerClick: number | null; costPerThousandImpressions: number | null; ad_preview_shareable_link?: string };
type Payload = { status: "connected" | "no_data" | "not_mapped" | "missing_connection" | "unavailable"; message?: string; currency?: string; accountId?: string; section?: string; rows?: MetaRow[]; mayBeLimited?: boolean; dateWindow?: { current: { start: string; end: string }; previous?: { start: string; end: string } }; current?: { totals: { spend: number; impressions: number; clicks: number; leads: number; ctr: number | null; costPerLead: number | null }; campaigns: MetaRow[]; daily: Array<{ date: string; clicks: number }>; campaignDaily?: Array<{ campaignId: string; date: string; clicks: number }>; sourceRows: number; mayBeLimited: boolean }; previous?: { spend: number; impressions: number; clicks: number; leads: number; campaigns: MetaRow[] }; changes?: Record<string, number | null>; snapshots?: MarketingHistorySnapshot[]; updatedAt?: string; dataNote?: string };
type Section = "performance" | "campaigns" | "ad_sets" | "ads" | "audiences" | "locations" | "changes";
type MetaChange = { id: string; campaignName: string; campaignId?: string; entityType?: "ad_set" | "ad"; entityName?: string; field: "status" | "daily_budget"; currency: string; oldValue: string; newValue: string; status: string; actor: string; createdAt: string; decidedAt?: string; resultDetail?: string; verified: number };
const n = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("en-IE", { maximumFractionDigits: 1 });
const money = (value: number | null | undefined, currency: string) => value == null ? "—" : (() => { try { return new Intl.NumberFormat("en-IE", { style: "currency", currency, maximumFractionDigits: 2 }).format(value); } catch { return `${currency} ${value.toFixed(2)}`; } })();
function change(value: number | null | undefined) { return value == null ? "No prior comparison" : `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}% vs previous period`; }
function displayLocation(value: string) { return /^[A-Z]{2}$/.test(value) ? new Intl.DisplayNames(["en-IE"], { type: "region" }).of(value) || value : value; }
function displayMetaChangeValue(item: MetaChange, value: string) {
  if (item.field !== "daily_budget") return value;
  const currency = item.currency || "EUR";
  const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return money(Number(value) / (10 ** digits), currency);
}
function safeMetaPreviewUrl(value: unknown) {
  return trustedMetaAdPreviewUrl(value) || "";
}

export function MetaAdsView({ clients, active, selectedClientId, canEditClients, onEditClient, onCreateTask, onMapAccount, auditRuns = [], canRunAudit, onSaveAudit, onCreateAuditTask }: { clients: Client[]; active: boolean; selectedClientId?: string; canEditClients: boolean; onEditClient: (client: Client) => void; onCreateTask: (clientId: string, item: MetaRow, rangeLabel: string) => void; onMapAccount?: (clientId: string, accountId: string) => Promise<boolean>; auditRuns?: MarketingAuditRun[]; canRunAudit: boolean; onSaveAudit: (run: MarketingAuditRun) => Promise<boolean>; onCreateAuditTask: (clientId: string, title: string, notes: string) => void }) {
  const initialClientId = clients.find((item) => item.metaAdsAccountId)?.id || clients[0]?.id || "";
  const [clientChoice, setClientChoice] = useState({ selectedClientId: selectedClientId || "", id: selectedClientId && clients.some((item) => item.id === selectedClientId) ? selectedClientId : initialClientId });
  const externalClientId = active && selectedClientId && clients.some((item) => item.id === selectedClientId) ? selectedClientId : "";
  const clientId = externalClientId && clientChoice.selectedClientId !== externalClientId ? externalClientId : clientChoice.id;
  const [range, setRange] = useState("last_30d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [campaignChoice, setCampaignChoice] = useState({ clientId: initialClientId, id: "all" });
  const campaignId = campaignChoice.clientId === clientId ? campaignChoice.id : "all";
  const [section, setSection] = useState<Section>("performance");
  const [result, setResult] = useState<{ key: string; payload?: Payload; error?: string } | null>(null);
  const [detailsResult, setDetailsResult] = useState<{ key: string; payload: Payload } | null>(null);
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }> | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [accountConnectUrl, setAccountConnectUrl] = useState("");
  const [changeItems, setChangeItems] = useState<MetaChange[]>([]);
  const [canManageChanges, setCanManageChanges] = useState(false);
  const [changeSetupMessage, setChangeSetupMessage] = useState("");
  const [changeBusy, setChangeBusy] = useState(false);
  const [changeMessage, setChangeMessage] = useState("");
  const [dailyBudgetInput, setDailyBudgetInput] = useState("");
  const [adPreviewLinks, setAdPreviewLinks] = useState<Record<string, string>>({});
  const [adPreviewErrors, setAdPreviewErrors] = useState<Record<string, string>>({});
  const [adPreviewLoadingId, setAdPreviewLoadingId] = useState("");
  const client = clients.find((item) => item.id === clientId);
  const resultKey = `${clientId}|${range}|${from}|${to}`;
  const payload = result?.key === resultKey ? result.payload || null : null;
  const loading = Boolean(active && clientId && result?.key !== resultKey);
  const error = result?.key === resultKey ? result.error : "";
  const detailsKey = `${resultKey}|${section}|${campaignId}`;
  const details = detailsResult?.key === detailsKey ? detailsResult.payload : null;
  const detailLoading = Boolean(active && clientId && section !== "performance" && (payload?.status === "connected" || payload?.status === "no_data") && detailsResult?.key !== detailsKey);

  async function loadCampaignChanges() {
    if (!clientId) return;
    const response = await fetch(`/api/meta-ads/changes?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" });
    const data = await readApiJson<{ proposals?: MetaChange[]; canManage?: boolean; setupMessage?: string; error?: string }>(response, "Meta campaign changes");
    if (!response.ok) throw new Error(data.error || "Could not load Meta campaign approvals.");
    setChangeItems(data.proposals || []); setCanManageChanges(Boolean(data.canManage)); setChangeSetupMessage(data.setupMessage || "");
  }

  async function sendCampaignChange(body: Record<string, unknown>) {
    setChangeBusy(true); setChangeMessage("");
    try {
      const response = await fetch("/api/meta-ads/changes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, ...body }) });
      const data = await readApiJson<{ error?: string; status?: string; detail?: string; campaignName?: string; field?: string; newValue?: string; currency?: string }>(response, "Meta campaign change");
      if (!response.ok) throw new Error(data.error || "Meta could not process this campaign change.");
      setChangeMessage(data.status === "applied" ? data.detail || "Meta change was applied." : data.status === "rejected" ? "Proposal rejected. No Meta Ads change was made." : `Change saved for ${data.campaignName || "review"}. It has not been applied.`);
      await loadCampaignChanges();
    } catch (error) { setChangeMessage(error instanceof Error ? error.message : "Could not process this Meta campaign change."); }
    finally { setChangeBusy(false); }
  }

  async function loadAdPreview(item: MetaRow) {
    if (!clientId || adPreviewLoadingId) return;
    setAdPreviewLoadingId(item.id); setAdPreviewErrors((current) => ({ ...current, [item.id]: "" }));
    try {
      const response = await fetch(`/api/meta-ads/preview?clientId=${encodeURIComponent(clientId)}&adId=${encodeURIComponent(item.id)}`, { cache: "no-store" });
      const data = await readApiJson<{ url?: string; error?: string }>(response, "Meta ad preview");
      if (!response.ok) throw new Error(data.error || "Could not prepare this Meta ad preview.");
      const previewUrl = safeMetaPreviewUrl(data.url);
      if (!previewUrl) throw new Error("Meta returned a preview link that could not be safely opened.");
      setAdPreviewLinks((current) => ({ ...current, [item.id]: previewUrl }));
    } catch (error) { setAdPreviewErrors((current) => ({ ...current, [item.id]: error instanceof Error ? error.message : "Could not prepare this Meta ad preview." })); }
    finally { setAdPreviewLoadingId(""); }
  }

  useEffect(() => {
    if (!active || !clientId) return;
    let cancelled = false;
    void fetch(`/api/meta-ads/changes?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" }).then(async (response) => {
      const data = await readApiJson<{ proposals?: MetaChange[]; canManage?: boolean; setupMessage?: string; error?: string }>(response, "Meta campaign changes");
      if (!response.ok) throw new Error(data.error || "Could not load Meta campaign approvals.");
      if (!cancelled) { setChangeItems(data.proposals || []); setCanManageChanges(Boolean(data.canManage)); setChangeSetupMessage(data.setupMessage || ""); }
    }).catch((error) => { if (!cancelled) setChangeSetupMessage(error instanceof Error ? error.message : "Could not load Meta campaign approvals."); });
    return () => { cancelled = true; };
  }, [active, clientId]);

  useEffect(() => {
    if (!active || !clientId) return;
    let cancelled = false;
    const params = new URLSearchParams({ clientId, range });
    if (range === "custom") { if (from) params.set("from", from); if (to) params.set("to", to); }
    void fetch(`/api/meta-ads/workspace?${params}`, { cache: "no-store" }).then(async (response) => { const responseData = await readApiJson<Payload & { error?: string }>(response, "Meta Ads"); if (!response.ok) throw new Error(responseData.error || responseData.message || "Could not load Meta Ads data."); return responseData; }).then((data) => { if (!cancelled) setResult({ key: resultKey, payload: data }); }).catch((reason) => { if (!cancelled) setResult({ key: resultKey, error: reason instanceof Error ? reason.message : "Could not load Meta Ads data." }); });
    return () => { cancelled = true; };
  }, [active, clientId, range, from, to, resultKey]);

  useEffect(() => {
    if (!active || !clientId || section === "performance" || section === "changes" || !payload || !["connected", "no_data"].includes(payload.status)) return;
    let cancelled = false;
    const params = new URLSearchParams({ clientId, range, section });
    if (range === "custom") { if (from) params.set("from", from); if (to) params.set("to", to); }
    if (campaignId !== "all") params.set("campaignId", campaignId);
    void fetch(`/api/meta-ads/workspace?${params}`, { cache: "no-store" }).then(async (response) => { const responseData = await readApiJson<Payload & { error?: string }>(response, "Meta Ads"); if (!response.ok) throw new Error(responseData.error || responseData.message || "Could not load this Meta Ads section."); return responseData; }).then((data) => { if (!cancelled) setDetailsResult({ key: detailsKey, payload: data }); }).catch((reason) => { if (!cancelled) setDetailsResult({ key: detailsKey, payload: { status: "unavailable", message: reason instanceof Error ? reason.message : "Could not load this section." } }); });
    return () => { cancelled = true; };
  }, [active, clientId, range, from, to, section, campaignId, resultKey, detailsKey, payload, result?.key, result?.payload?.status]);

  const campaigns = payload?.current?.campaigns || [];
  const selected = campaigns.find((item) => item.id === campaignId);
  const totals = payload?.current?.totals;
  const previousSelected = payload?.previous?.campaigns.find((item) => item.id === campaignId);
  const hasReportedRows = (payload?.current?.sourceRows || 0) > 0;
  const selectedChanges = selected ? previousSelected ? {
    spend: previousSelected.spend ? (selected.spend - previousSelected.spend) / Math.abs(previousSelected.spend) : null,
    clicks: previousSelected.clicks ? (selected.clicks - previousSelected.clicks) / Math.abs(previousSelected.clicks) : null,
    leads: previousSelected.leads ? (selected.leads - previousSelected.leads) / Math.abs(previousSelected.leads) : null,
  } : { spend: null, clicks: null, leads: null } : payload?.changes;
  const chartRows = campaignId === "all" ? payload?.current?.daily || [] : (payload?.current?.campaignDaily || []).filter((row) => row.campaignId === campaignId);
  const chartPeak = Math.max(1, ...chartRows.map((item) => item.clicks));
  const rangeLabel = payload?.dateWindow ? `${payload.dateWindow.current.start} to ${payload.dateWindow.current.end}` : range === "custom" ? `${from || "Start"} to ${to || "End"}` : range.replace("last_", "Last ").replace("d", " days");
  async function loadAccounts() {
    setAccountsLoading(true); setAccountError(""); setAccountConnectUrl("");
    try {
      const response = await fetch("/api/meta-ads/accounts", { cache: "no-store" });
      const result = await readApiJson<{ accounts?: Array<{ id: string; name: string }>; error?: string; connectUrl?: string }>(response, "Meta Ads account list");
      if (!response.ok) { if (result.connectUrl) setAccountConnectUrl(result.connectUrl); throw new Error(result.error || "Could not list connected Meta Ads accounts."); }
      setAccounts(result.accounts || []);
    } catch (reason) { setAccountError(reason instanceof Error ? reason.message : "Could not list connected Meta Ads accounts."); }
    finally { setAccountsLoading(false); }
  }
  async function mapAccount(accountId: string) {
    if (!client || !accountId || !onMapAccount) return;
    setAccountError("");
    const saved = await onMapAccount(client.id, accountId);
    if (!saved) setAccountError("The account could not be linked. Please try again.");
    else { setAccounts(null); setResult(null); setDetailsResult(null); }
  }
  return <main className="page-heading google-ads-view">
    <header className="google-ads-view-heading"><div><p className="eyebrow">📱 CLIENT CAMPAIGN WORKSPACE</p><h1>Meta Ads</h1><p className="muted">Facebook and Instagram campaign results from the client’s connected account.</p></div><div className="google-ads-view-controls">{clients.length > 1 && <label><span>Client</span><select aria-label="Choose Meta Ads client" value={clientId} onChange={(event) => setClientChoice({ selectedClientId: selectedClientId || "", id: event.target.value })}>{clients.map((item) => <option value={item.id} key={item.id}>{item.name}{item.metaAdsAccountId ? "" : " · account not linked"}</option>)}</select></label>}<label><span>Reporting period</span><select aria-label="Choose Meta Ads period" value={range} onChange={(event) => setRange(event.target.value)}><option value="last_7d">Last 7 days</option><option value="last_30d">Last 30 days</option><option value="last_90d">Last 90 days</option><option value="custom">Custom dates</option></select></label>{range === "custom" && <><label><span>From</span><input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} /></label><label><span>To</span><input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label></>}</div></header>
    {!client && <section className="google-ads-status"><b>No clients saved yet</b><p>Add a client before loading Meta Ads performance.</p></section>}
    {error && <section className="google-ads-status is-error" role="alert"><b>Couldn’t load Meta Ads data</b><p>{error}</p></section>}
    {loading && <section className="google-ads-status" role="status">Loading live Facebook and Instagram results…</section>}
    {!loading && !error && payload?.status === "not_mapped" && <section className="google-ads-status"><b>Link a Meta Ads account to {client?.name}</b><p>{payload.message}</p>{canEditClients && client && <div className="meta-ads-account-actions"><button type="button" className="primary-button" onClick={() => { window.location.href = "/api/meta-ads/connect"; }}>Connect directly with Meta</button><button type="button" className="primary-button" onClick={() => { void loadAccounts(); }} disabled={accountsLoading}>{accountsLoading ? "Loading accounts…" : "Choose connected Windsor account"}</button><button type="button" className="secondary-button" onClick={() => onEditClient(client)}>Enter account ID</button></div>}{accountError && <p className="google-ads-error" role="alert">{accountError}</p>}{accountConnectUrl && <p><a href={accountConnectUrl} target="_blank" rel="noreferrer">Connect Facebook and Instagram Ads in Windsor ↗</a><br />After connecting it, return here and choose the client account.</p>}{accounts && (accounts.length ? <label className="field meta-ads-account-picker"><span>Connected Meta Ads account</span><select defaultValue="" onChange={(event) => { void mapAccount(event.target.value); }}><option value="">Choose an account…</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {account.id}</option>)}</select></label> : <p>No Meta Ads accounts are connected in Windsor yet. Connect an account there, then load this list again.</p>)}</section>}
    {!loading && !error && payload?.status === "missing_connection" && <section className="google-ads-status is-error"><b>Meta Ads connection is unavailable</b><p>{payload.message}</p></section>}
    {!loading && !error && payload?.status === "unavailable" && <section className="google-ads-status is-error"><b>Meta Ads data could not be retrieved</b><p>{payload.message}</p></section>}
    {!loading && !error && (payload?.status === "connected" || payload?.status === "no_data") && totals && <>
      <section className="google-ads-status google-ads-live"><div><b>{client?.name}</b><p>Account {payload.accountId} · {rangeLabel} · {payload.current?.sourceRows || 0} data rows · Updated {payload.updatedAt ? new Date(payload.updatedAt).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" }) : "just now"}</p></div><span>{payload.status === "connected" ? "● Connected" : "No rows returned"}</span></section>
      <div className="google-ads-campaign-filter"><label><span>Campaign</span><select aria-label="Filter Meta Ads campaign" value={campaignId} onChange={(event) => setCampaignChoice({ clientId, id: event.target.value })}><option value="all">All campaigns</option>{campaigns.map((campaign) => <option key={campaign.id || campaign.name} value={campaign.id || campaign.name}>{campaign.name}</option>)}</select></label>{selected && <button type="button" className="secondary-button" onClick={() => onCreateTask(clientId, { ...selected, kind: "Campaign", campaignId: selected.id, campaignName: selected.name }, rangeLabel)}>＋ Create task for this campaign</button>}</div>
      <section className="google-ads-metric-grid" aria-label="Meta Ads summary metrics">{[["Spend", hasReportedRows ? money(selected?.spend ?? totals.spend, payload.currency || "EUR") : "—", hasReportedRows ? change(selectedChanges?.spend) : "No account rows returned"], ["Reported leads", hasReportedRows ? n(selected?.leads ?? totals.leads) : "—", hasReportedRows ? change(selectedChanges?.leads) : "No account rows returned"], ["Cost per lead", !hasReportedRows ? "—" : money(selected?.costPerLead ?? totals.costPerLead, payload.currency || "EUR"), hasReportedRows ? "Calculated from Meta-reported leads" : "No account rows returned"], ["Clicks", hasReportedRows ? n(selected?.clicks ?? totals.clicks) : "—", hasReportedRows ? change(selectedChanges?.clicks) : "No account rows returned"]].map(([label, value, sub]) => <article className="google-ads-metric" key={label}><span>{label}</span><b>{value}</b><small>{sub}</small></article>)}</section>
      <nav className="google-ads-tabs" aria-label="Meta Ads sections">{([ ["performance", "Performance"], ["campaigns", "Campaigns"], ["ad_sets", "Ad sets"], ["ads", "Ads & creatives"], ["audiences", "Audiences"], ["locations", "Locations"], ["changes", `Approvals · ${changeItems.filter((item) => item.status === "pending").length}`] ] as [Section, string][]).map(([key, label]) => <button key={key} type="button" className={section === key ? "is-active" : ""} aria-pressed={section === key} onClick={() => setSection(key)}>{label}</button>)}</nav>
      {section === "campaigns" && <section className="google-ads-data-panel meta-change-propose"><div className="google-ads-panel-heading"><div><h2>Propose a campaign change</h2><p>Changes wait for your approval. Meta is checked again before and after applying.</p></div></div>{!canManageChanges ? <p className="google-ads-empty">{changeSetupMessage || "Direct Meta Ads editing is not connected."}</p> : selected ? <div className="meta-change-controls"><div><b>{selected.name}</b><small>{selected.status || "Current status will be checked live"}</small></div><div className="meta-change-buttons"><button type="button" className="secondary-button" disabled={changeBusy || !/^\d{6,24}$/.test(selected.id)} onClick={() => void sendCampaignChange({ action: "stage", campaignId: selected.id, field: "status", value: "PAUSED" })}>Propose pause</button><button type="button" className="secondary-button" disabled={changeBusy || !/^\d{6,24}$/.test(selected.id)} onClick={() => void sendCampaignChange({ action: "stage", campaignId: selected.id, field: "status", value: "ACTIVE" })}>Propose resume</button><label><span>New daily budget · {payload.currency || "account currency"}</span><input type="number" min="0.01" step="0.01" value={dailyBudgetInput} onChange={(event) => setDailyBudgetInput(event.target.value)} placeholder="e.g. 25" /></label><button type="button" className="secondary-button" disabled={changeBusy || !dailyBudgetInput || !/^\d{6,24}$/.test(selected.id)} onClick={() => void sendCampaignChange({ action: "stage", campaignId: selected.id, field: "daily_budget", value: Number(dailyBudgetInput) })}>Propose budget</button></div></div> : <p className="google-ads-empty">Select one campaign above to prepare a proposed pause, resume or budget change.</p>}{changeMessage && <p role="status" className="google-ads-data-note">{changeMessage}</p>}</section>}
      {section === "changes" && <section className="google-ads-data-panel meta-change-approvals"><div className="google-ads-panel-heading"><div><h2>Meta approvals</h2><p>Campaign, ad set, and ad edits stay here until you decide. An approved edit is checked against Meta before and after it is applied.</p></div><button type="button" className="secondary-button" disabled={changeBusy} onClick={() => void loadCampaignChanges()}>↻ Refresh</button></div><p className="google-ads-data-note">{changeSetupMessage}</p>{changeMessage && <p role="status" className="google-ads-data-note">{changeMessage}</p>}{changeItems.length ? changeItems.map((item) => <article className={`meta-change-item status-${item.status}`} key={item.id}><div><span className={`integration-status status-${item.status === "pending" ? "needs_setup" : item.status === "applied" && item.verified ? "ready" : "optional"}`}>{item.status === "pending" ? "Waiting for your approval" : item.status === "applied" ? item.verified ? "Applied · verified" : "Applied · unverified" : item.status}</span><h3>{item.entityName || item.campaignName}</h3>{item.entityType && <p>{item.entityType === "ad_set" ? "Ad set" : "Ad"} in {item.campaignName}</p>}<p>{item.field === "status" ? `${item.entityType ? "Status" : "Campaign status"}: ${item.oldValue} → ${item.newValue}` : `Daily budget: ${displayMetaChangeValue(item, item.oldValue)} → ${displayMetaChangeValue(item, item.newValue)}`}</p><small>{new Date(item.createdAt).toLocaleString("en-IE")} · proposed by {item.actor}</small>{item.resultDetail && <p>{item.resultDetail}</p>}</div>{item.status === "pending" && canManageChanges && <div className="meta-change-buttons"><button type="button" className="primary-button" disabled={changeBusy} onClick={() => void sendCampaignChange({ action: item.entityType ? "approve_entity" : "approve", proposalId: item.id })}>✓ Approve &amp; apply</button><button type="button" className="secondary-button" disabled={changeBusy} onClick={() => void sendCampaignChange({ action: item.entityType ? "reject_entity" : "reject", proposalId: item.id })}>Reject</button></div>}</article>) : <p className="google-ads-empty">No proposed Meta Ads changes yet.</p>}</section>}
      {client && <MarketingAuditPanel clientId={client.id} clientName={client.name} service="Meta Ads" period={rangeLabel} status={payload?.status === "connected" ? "connected" : payload?.status === "no_data" ? "no_data" : "unavailable"} data={payload} history={auditRuns} canRunAudit={canRunAudit} onSave={onSaveAudit} onCreateTask={(title, notes) => onCreateAuditTask(client.id, title, notes)} />}
      {section === "performance" && <section className="google-ads-data-panel"><div className="google-ads-panel-heading"><div><h2>Daily clicks</h2><p>{selected?.name || "All campaigns"} · {rangeLabel}</p></div><div className="google-ads-secondary-metrics"><span><b>{hasReportedRows ? n(selected?.impressions ?? totals.impressions) : "—"}</b> impressions</span><span><b>{!hasReportedRows || (selected?.ctr == null && totals.ctr == null) ? "—" : `${(((selected?.ctr ?? totals.ctr) || 0) * 100).toFixed(2)}%`}</b> CTR</span></div></div><div className="google-ads-chart" role="img" aria-label={`Daily Meta Ads clicks for ${selected?.name || "all campaigns"}`}>{chartRows.map((item) => <span key={item.date} title={`${item.date}: ${item.clicks} clicks`} style={{ height: `${Math.max(3, item.clicks / chartPeak * 100)}%` }} />)}</div><div className="google-ads-chart-labels"><span>{chartRows[0]?.date || "No daily data"}</span><span>{chartRows.at(-1)?.date || ""}</span></div></section>}
      {section === "performance" && <MarketingSnapshotHistory service="Meta Ads" snapshots={payload.snapshots} metrics={[{ label: "Spend", path: ["current", "totals", "spend"], format: "money" }, { label: "Clicks", path: ["current", "totals", "clicks"] }, { label: "Reported leads", path: ["current", "totals", "leads"] }]} />}
      {section !== "performance" && <section className="google-ads-data-panel"><div className="google-ads-panel-heading"><div><h2>{section === "campaigns" ? "Campaign performance" : section === "ad_sets" ? "Ad set performance" : section === "ads" ? "Ads and creatives" : section === "audiences" ? "Results by age and gender" : "Results by country"}</h2><p>{section === "ad_sets" || section === "ads" ? "Meta performance · status changes require your approval" : "Read-only results from Meta"} · {rangeLabel}{selected ? ` · ${selected.name}` : ""}</p></div><span>{details?.rows?.length || 0} rows</span></div>{detailLoading && <p className="google-ads-empty" role="status">Loading {section.replace("_", " ")}…</p>}{details?.status === "unavailable" && <p className="google-ads-empty" role="alert">{details.message}</p>}{!detailLoading && details?.status === "no_data" && <p className="google-ads-empty">No {section.replace("_", " ")} data was returned for this period.</p>}{!detailLoading && details?.rows?.map((item) => <article className="google-ads-row" key={item.id || item.name}><div className="google-ads-row-main"><small>{item.kind}{section !== "audiences" && section !== "locations" ? ` · ${item.status}` : ""}{section !== "audiences" && section !== "locations" ? ` · ${item.campaignName}` : selected ? ` · ${selected.name}` : " · All campaigns"}</small><h3>{section === "locations" ? displayLocation(item.name) : item.name}</h3><p>{n(item.impressions)} impressions · {n(item.clicks)} clicks · {n(item.leads)} Meta-reported leads{item.linkClicks == null ? "" : ` · ${n(item.linkClicks)} link clicks${item.linkCtr == null ? "" : ` (${(item.linkCtr * 100).toFixed(2)}% link CTR)`}`}</p></div><div className="google-ads-row-metrics"><b>{money(item.spend, payload.currency || "EUR")}</b><small>{item.costPerLead == null ? "Cost per lead —" : `${money(item.costPerLead, payload.currency || "EUR")} per lead`} · {item.costPerClick == null ? "CPC —" : `${money(item.costPerClick, payload.currency || "EUR")} CPC`} · {item.costPerThousandImpressions == null ? "CPM —" : `${money(item.costPerThousandImpressions, payload.currency || "EUR")} CPM`}</small><button type="button" className="secondary-button" onClick={() => onCreateTask(clientId, item, rangeLabel)}>＋ Create task</button>{canManageChanges && (section === "ad_sets" || section === "ads") && /^\d{6,24}$/.test(item.id) && <><button type="button" className="secondary-button" disabled={changeBusy || !["ACTIVE", "PAUSED"].includes(item.status)} onClick={() => void sendCampaignChange({ action: "stage_entity", entityType: section === "ad_sets" ? "ad_set" : "ad", entityId: item.id, value: item.status === "PAUSED" ? "ACTIVE" : "PAUSED" })}>{item.status === "PAUSED" ? "Propose resume" : "Propose pause"}</button></>}</div>{section === "ads" && <div className="meta-ad-preview-actions">{safeMetaPreviewUrl(item.ad_preview_shareable_link) && <a href={safeMetaPreviewUrl(item.ad_preview_shareable_link)} target="_blank" rel="noreferrer">↗ Open ad preview</a>}{adPreviewLinks[item.id] ? <a href={safeMetaPreviewUrl(adPreviewLinks[item.id])} target="_blank" rel="noreferrer">↗ Open Meta preview</a> : /^\d{6,24}$/.test(item.id) && <button type="button" className="secondary-button" disabled={Boolean(adPreviewLoadingId)} onClick={() => void loadAdPreview(item)}>{adPreviewLoadingId === item.id ? "Preparing preview…" : "Preview this ad"}</button>}{adPreviewErrors[item.id] && <p className="google-ads-error" role="alert">{adPreviewErrors[item.id]}</p>}</div>}</article>)}{details?.mayBeLimited && <p className="google-ads-data-note">The source returned 1,000 rows; this section may be incomplete.</p>}</section>}
      <p className="google-ads-data-note">{payload.dataNote} Results depend on Meta’s event setup and attribution window. Campaign edits are prepared as proposals and only sent to Meta after you approve them.</p>
    </>}
  </main>;
}
