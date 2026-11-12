"use client";

import { useEffect, useState } from "react";

type IntegrationStatus = "ready" | "partial" | "needs_setup" | "optional" | "not_available";
type Integration = { id: string; name: string; group: string; status: IntegrationStatus; detail: string; mappedClients: number; mappingUnit?: string; actionLabel: string; actionPage: string; connectHref?: string; publicAccessSetupConfigured?: boolean; usage?: { status: "available" | "unavailable"; periodStart?: string; requestCount?: number; knownCostUsd?: number | null; unknownCostCount?: number; byService?: { keywordResearch: { requestCount: number; knownCostUsd: number | null; unknownCostCount: number }; competitorResearch?: { requestCount: number; knownCostUsd: number | null; unknownCostCount: number }; localMaps: { requestCount: number; knownCostUsd: number | null; unknownCostCount: number }; backlinks: { requestCount: number; knownCostUsd: number | null; unknownCostCount: number } } }; sync?: { lastAttemptAt: string | null; lastSuccessfulAt: string | null; status: string; detail: string | null; failedClients: string[]; failedAccounts?: Array<{ clientId: string; clientName: string; service: string }>; failedCount: number } };
const statusLabels: Record<IntegrationStatus, string> = { ready: "Ready", partial: "Partly connected", needs_setup: "Setup needed", optional: "Optional setup", not_available: "Not connected" };

function formatSyncDate(value: string | null) {
  if (!value) return "not yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "time unavailable" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function syncLabel(sync: NonNullable<Integration["sync"]>) {
  if (!sync.lastAttemptAt) return "No scheduled sync attempt recorded";
  const when = formatSyncDate(sync.lastAttemptAt);
  if (sync.status === "unavailable") return `Latest attempt failed · ${when}`;
  if (sync.status === "syncing") return `Sync in progress · started ${when}`;
  if (sync.status === "no_data") return `Latest check found no data · ${when}`;
  return `Latest attempt succeeded · ${when}`;
}

function mappingSummary(item: Integration) {
  if (!item.mappingUnit) return "";
  const plural = item.mappingUnit.endsWith("property") ? `${item.mappingUnit.slice(0, -8)}properties` : `${item.mappingUnit}s`;
  return item.mappedClients > 0 ? `${item.mappedClients} ${item.mappedClients === 1 ? item.mappingUnit : plural} linked` : `No ${plural} linked`;
}

function formatUsd(value: number | null | undefined) {
  return value == null ? "Cost not returned" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 5, maximumFractionDigits: 5 }).format(value);
}

const integrationIcons: Record<string, string> = {
  "google-ads": "📣", "meta-ads": "📱", "search-console": "🔎", ga4: "📊", "business-profile": "📍",
  dataforseo: "🔍", pagespeed: "⚡", wordpress: "🌐", "marketing-public": "🚀", gohighlevel: "🧩", "landing-hosting": "🪄",
};

export function IntegrationsView({ onNavigate }: { onNavigate: (page: string) => void }) {
  const [items, setItems] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [retryingKey, setRetryingKey] = useState("");
  const [retryMessages, setRetryMessages] = useState<Record<string, string>>({});
  const [settingUpPublicAccess, setSettingUpPublicAccess] = useState(false);
  const [publicAccessSetupMessage, setPublicAccessSetupMessage] = useState("");
  async function load() {
    setLoading(true); setMessage("");
    try {
      const response = await fetch("/api/integrations/status", { cache: "no-store" });
      const payload = await response.json() as { integrations?: Integration[]; message?: string };
      if (!response.ok) throw new Error(payload.message || "Could not load integrations.");
      setItems(payload.integrations || []);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load integrations."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/integrations/status", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const payload = await response.json() as { integrations?: Integration[]; message?: string };
      if (!response.ok) throw new Error(payload.message || "Could not load integrations.");
      if (!controller.signal.aborted) setItems(payload.integrations || []);
    }).catch((error) => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Could not load integrations."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  async function retrySync(account: { clientId: string; clientName: string; service: string }) {
    const key = `${account.clientId}:${account.service}`;
    setRetryingKey(key);
    setRetryMessages((current) => ({ ...current, [key]: "Retrying…" }));
    try {
      const response = await fetch("/api/integrations/retry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: account.clientId, service: account.service }) });
      const payload = await response.json() as { message?: string };
      if (!response.ok) throw new Error(payload.message || "The sync could not be retried.");
      setRetryMessages((current) => ({ ...current, [key]: payload.message || `${account.clientName} synced successfully.` }));
      await load();
    } catch (error) {
      setRetryMessages((current) => ({ ...current, [key]: error instanceof Error ? error.message : "The sync could not be retried." }));
    } finally { setRetryingKey(""); }
  }
  async function configurePublicMarketingAccess() {
    const approved = window.confirm("This will make only /f/*, /api/marketing-public*, /sitemap.xml, /robots.txt and the signed GoHighLevel webhook publicly reachable. Cloudflare Access will not authenticate or log requests to those paths. The CRM and management APIs stay protected. Continue?");
    if (!approved) return;
    setSettingUpPublicAccess(true);
    setPublicAccessSetupMessage("Applying the approved path rules…");
    try {
      const response = await fetch("/api/integrations/public-marketing-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "APPROVE_PUBLIC_MARKETING_ROUTES" }),
      });
      const payload = await response.json() as { error?: string; createdPaths?: string[]; results?: Array<{ path: string; status: string }> };
      if (!response.ok) throw new Error(payload.error || "Could not configure the approved public routes.");
      const configured = payload.results?.map((item) => item.path).join(", ") || payload.createdPaths?.join(", ") || "the approved routes";
      setPublicAccessSetupMessage(`Applied path rules for ${configured}. Checking public access now…`);
      await load();
    } catch (error) {
      setPublicAccessSetupMessage(error instanceof Error ? error.message : "Could not configure the approved public routes.");
    } finally { setSettingUpPublicAccess(false); }
  }
  return <main className="page-heading integrations-view launchpad-view">
    <header className="launchpad-heading"><div><p className="eyebrow">🚀 WORKSPACE CONNECTIONS</p><h1>Let’s get you on the path to success</h1><p className="muted">Connect your tools and check which workspace services are ready.</p></div><button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>{loading ? "Checking…" : "↻ Refresh"}</button></header>
    {loading && <p role="status" className="integrations-message launchpad-state">Checking connection setup…</p>}
    {message && <div role="alert" className="launchpad-error"><span>{message}</span><button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>Try again</button></div>}
    {!loading && !message && <section className="launchpad-catalog" aria-label="Workspace services">{items.map((item) => <article className={`launchpad-row status-${item.status}`} key={item.id}>
      <div className="launchpad-brand" aria-hidden="true">{integrationIcons[item.id] || "🔗"}</div>
      <div className="launchpad-item-main"><div className="launchpad-item-heading"><h3>{item.name}</h3><span className={`integration-status status-${item.status}`}>{statusLabels[item.status]}</span></div><p>{item.detail}</p>
        <details className="launchpad-details"><summary>{item.mappingUnit ? mappingSummary(item) : "View setup details"}</summary><div className="launchpad-details-content">
          <div className="launchpad-detail-actions"><button className="secondary-button" type="button" onClick={() => onNavigate(item.actionPage)}>{item.actionLabel} ↗</button>{item.connectHref && <a className="secondary-button" href={item.connectHref}>Reconnect</a>}{item.id === "marketing-public" && item.publicAccessSetupConfigured && <button className="secondary-button" type="button" onClick={() => void configurePublicMarketingAccess()} disabled={settingUpPublicAccess}>{settingUpPublicAccess ? "Applying…" : "Apply public paths"}</button>}</div>
          {item.id === "marketing-public" && !item.publicAccessSetupConfigured && <p>The approved routes are ready to apply after the Cloudflare Access API token is configured as a Worker secret. Never share the token in chat.</p>}{item.id === "marketing-public" && publicAccessSetupMessage && <p role="status" className="integrations-message">{publicAccessSetupMessage}</p>}
          {item.usage && <div className={`integration-usage ${item.usage.status === "unavailable" ? "is-error" : ""}`}><b>Provider usage · last 30 days</b>{item.usage.status === "unavailable" ? <small>Usage totals could not be loaded. No provider requests were made by this check.</small> : <><span>{item.usage.requestCount || 0} saved request{item.usage.requestCount === 1 ? "" : "s"} · {formatUsd(item.usage.knownCostUsd)} known cost</span><small>{item.usage.unknownCostCount ? `${item.usage.unknownCostCount} request${item.usage.unknownCostCount === 1 ? "" : "s"} did not return a cost; totals may be incomplete.` : "All saved requests returned a cost, or no requests were recorded."}</small>{item.usage.periodStart && <small>Since {new Date(item.usage.periodStart).toLocaleDateString("en-IE", { dateStyle: "medium" })}. DataForSEO costs are provider-reported estimates, not an invoice total.</small>}{item.usage.byService && <details className="integration-usage-breakdown"><summary>See usage by service</summary><ul>{([["Keyword research", item.usage.byService.keywordResearch], ["Competitor keyword gaps", item.usage.byService.competitorResearch], ["Google Maps rankings", item.usage.byService.localMaps], ["Backlink checks", item.usage.byService.backlinks]] as const).map(([label, bucket]) => bucket && bucket.requestCount > 0 ? <li key={label}><span>{label} · {bucket.requestCount} request{bucket.requestCount === 1 ? "" : "s"}</span><span>{formatUsd(bucket.knownCostUsd)}{bucket.unknownCostCount ? ` · ${bucket.unknownCostCount} cost unknown` : ""}</span></li> : null)}</ul></details>}</>}</div>}
          {item.sync ? <div className={`integration-sync ${item.sync.status === "unavailable" ? "is-error" : ""}`}><b>{syncLabel(item.sync)}</b><small>Last successful data sync: {formatSyncDate(item.sync.lastSuccessfulAt)}</small>{item.sync.status === "unavailable" && item.sync.detail && <p>{item.sync.detail}</p>}{item.sync.failedCount > 0 && <><small>{item.sync.failedCount} client account{item.sync.failedCount === 1 ? " has" : "s have"} a sync error: {item.sync.failedClients.join(", ")}{item.sync.failedCount > item.sync.failedClients.length ? " and others" : ""}.</small>{item.sync.failedAccounts?.map((account) => { const key = `${account.clientId}:${account.service}`; return <div className="integration-retry-row" key={key}><span>{account.clientName}</span><button className="secondary-button" type="button" disabled={Boolean(retryingKey) || item.sync?.status === "syncing"} onClick={() => void retrySync(account)}>{retryingKey === key ? "Retrying…" : "↻ Retry sync"}</button>{retryMessages[key] && <small role="status">{retryMessages[key]}</small>}</div>; })}</>}</div> : <small className="integration-sync-muted">No successful or scheduled sync has been recorded yet.</small>}
        </div></details>
      </div>
      <div className="launchpad-row-status">{item.status === "ready" ? <span className="launchpad-connected-check" role="img" aria-label="Connected and ready">✓</span> : item.connectHref ? <a className="launchpad-connect-button" href={item.connectHref}>Connect</a> : <button className="launchpad-connect-button" type="button" onClick={() => onNavigate(item.actionPage)}>{item.actionLabel === "Review Sites" ? "Review" : "Open"}</button>}</div>
    </article>)}</section>}
    <details className="integrations-security-note launchpad-security"><summary>🔒 How credentials are protected</summary><p>This page shows whether a secret is configured, never its value. Manage credentials in Cloudflare → Workers &amp; Pages → f2b-media-agency-os → Settings → Variables and Secrets. After saving new secrets, refresh Launchpad and reconnect the relevant account.</p></details>
  </main>;
}
