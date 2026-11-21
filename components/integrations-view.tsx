"use client";

import { appAlert, appConfirm, appPrompt } from "./app-dialog";
import { lazy, Suspense, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { MessagingLaunchpad } from "./staff-messaging";
const WhatsAppSetup = lazy(() => import("./whatsapp-setup").then((m) => ({ default: m.WhatsAppSetup })));
import { BrandIcon } from "./brand-icon";
import { DataForSeoConnect } from "./dataforseo-connect";
import type { GooglePropertyMatch } from "@/lib/google-property-match.mjs";

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

const plainHelp: Record<string, string> = {
  "google-ads": "Pulls campaign results and lets the AI suggest changes.",
  "meta-ads": "Pulls Facebook and Instagram ad results.",
  "search-console": "Shows search rankings and clicks for each client site.",
  ga4: "Shows website visitors for each client.",
  "business-profile": "Shows Google Maps listing results for each client.",
  dataforseo: "Keyword and ranking research for SEO tasks.",
  pagespeed: "Checks how fast client websites load.",
  wordpress: "Lets the AI create draft pages on client websites.",
  "marketing-public": "Lets public lead forms and landing pages work.",
  gohighlevel: "Syncs leads with your GoHighLevel accounts.",
  "landing-hosting": "Hosts client landing pages on their own domains.",
  "revolut-payments": "Pay now button on invoices: Apple Pay, Google Pay, pay by bank (fee capped at €5) and card.",
  "stripe-payments": "Optional card checkout backup for invoices and proposals.",
};
const firstSentence = (text: string) => { const clean = text.replace(/\s+/g, " ").trim(); const end = clean.search(/[.!?](\s|$)/); const sentence = end > 0 ? clean.slice(0, end + 1) : clean; return sentence.length > 110 ? `${sentence.slice(0, 107)}…` : sentence; };

const integrationIcons: Record<string, string> = {
  "google-ads": "📣", "meta-ads": "📱", "search-console": "🔎", ga4: "📊", "business-profile": "📍",
  dataforseo: "🔍", pagespeed: "⚡", wordpress: "🌐", "marketing-public": "🚀", gohighlevel: "🧩", "landing-hosting": "🪄", "revolut-payments": "💳", "stripe-payments": "💳",
};

export function IntegrationsView({ onNavigate, onApplyGoogleMatches, clients = [], setupSlot, team = [], scopeClientId = "" }: { onNavigate: (page: string) => void; onApplyGoogleMatches?: (matches: GooglePropertyMatch[]) => Promise<boolean>; clients?: Array<{ id: string; name: string; logo?: string } & Record<string, any>>; setupSlot?: ReactNode; team?: Array<{ id: string; name: string; role?: string; avatar?: string; isBot?: boolean; clientAccessIds?: string[] }>; /** A sub-account picked in the top bar: show only that business. */ scopeClientId?: string }) {
  const [waFor, setWaFor] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [linkMessage, setLinkMessage] = useState("");
  async function autoLinkGoogle() {
    if (!onApplyGoogleMatches) return;
    setLinking(true); setLinkMessage("Reading your Search Console and Analytics properties…");
    try {
      const response = await fetch("/api/integrations/google-matches", { cache: "no-store" });
      const payload = await response.json() as { matches?: GooglePropertyMatch[]; searchConsoleProperties?: number; analyticsProperties?: number; notes?: string[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not read your Google properties.");
      const matches = payload.matches || [];
      const found = `Found ${payload.searchConsoleProperties || 0} Search Console and ${payload.analyticsProperties || 0} Analytics properties.`;
      const extra = payload.notes?.length ? ` ${payload.notes.join(" ")}` : "";
      if (!matches.length) { setLinkMessage(`${found} No new confident matches for clients with empty fields.${extra}`); return; }
      const lines = matches.map((m) => `• ${m.clientName}: ${[m.searchConsole && `Search Console ${m.searchConsole}`, m.analytics && `GA4 ${m.analytics}`, m.website && `website ${m.website}`].filter(Boolean).join(", ")}`).join("\n");
      if (!(await appConfirm(`${found} Link these? Only empty fields are filled.\n\n${lines}`))) { setLinkMessage("Nothing changed."); return; }
      const ok = await onApplyGoogleMatches(matches);
      setLinkMessage(ok ? `Linked ${matches.length} client${matches.length === 1 ? "" : "s"}.${extra}` : "Could not save the links. Try again.");
      if (ok) await load();
    } catch (error) { setLinkMessage(error instanceof Error ? error.message : "Could not link Google properties."); }
    finally { setLinking(false); }
  }
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
    const approved = (await appConfirm("This will make only /f/*, /api/marketing-public*, /sitemap.xml, /robots.txt and the signed GoHighLevel webhook publicly reachable. Cloudflare Access will not authenticate or log requests to those paths. The CRM and management APIs stay protected. Continue?"));
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
    <header className="launchpad-heading"><div><p className="eyebrow">🚀 WORKSPACE CONNECTIONS</p><h1>Let’s get you on the path to success</h1><p className="muted">Connect your tools and check which workspace services are ready.</p></div><div className="launchpad-actions">{onApplyGoogleMatches && <button className="primary-button" type="button" onClick={() => void autoLinkGoogle()} disabled={linking || loading} title="Match each client to its Search Console and GA4 property using the connected Google login">{linking ? "Linking…" : "Auto-link Google properties"}</button>}<button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>{loading ? "Checking…" : "↻ Refresh"}</button></div></header>
    {setupSlot}
    {linkMessage && <p role="status" className="integrations-message launchpad-state">{linkMessage}</p>}
    {loading && <p role="status" className="integrations-message launchpad-state">Checking connection setup…</p>}
    {message && <div role="alert" className="launchpad-error"><span>{message}</span><button className="secondary-button" type="button" onClick={() => void load()} disabled={loading}>Try again</button></div>}
    {scopeClientId ? <>
      <MessagingLaunchpad clients={clients} scopeClientId={scopeClientId} team={team} onNavigate={onNavigate} onOpenWhatsApp={(id) => setWaFor(id)} />
      {waFor !== null && <Suspense fallback={null}><WhatsAppSetup clients={clients.filter((c) => c.id === scopeClientId).map((c) => ({ id: c.id, name: c.name }))} initialClientId={waFor} onClose={() => setWaFor(null)} onLive={() => undefined} /></Suspense>}
    </> : !loading && !message && (() => {
      const keep = new Set(["google-ads", "meta-ads", "search-console", "ga4", "business-profile", "wordpress", "dataforseo", "google-calendar", "google-drive", "gmail-bookkeeping", "revolut-payments", "stripe-payments", "email-sending", "twilio"]);
      const shown = items.filter((item) => keep.has(item.id)).sort((a, b) => Number(a.status === "ready") - Number(b.status === "ready"));
      const done = shown.filter((item) => item.status === "ready").length;
      const percent = shown.length ? Math.round(done / shown.length * 100) : 0;
      return <>
        <section className="lp-hero" aria-label="Setup progress">
          <div className="lp-ring" style={{ "--lp-percent": `${percent}%` } as CSSProperties}><span>{percent}%</span></div>
          <div><b>{done} of {shown.length} tools connected</b><p>{done === shown.length ? "You’re all set 🎉" : "Connect the rest to unlock reports, ads and lead sync."}</p></div>
        </section>
        {shown.some((item) => item.id === "dataforseo" && item.status !== "ready") && <DataForSeoConnect onConnected={() => void load()} />}
        <section className="lp-grid" aria-label="Tools">{shown.map((item, index) => <article className={`lp-card status-${item.status}`} style={{ "--lp-delay": `${index * 55}ms` } as CSSProperties} key={item.id}>
          <div className="lp-icon" aria-hidden="true"><BrandIcon id={item.id} size={24} fallback={integrationIcons[item.id] || "🔗"} /></div>
          <div className="lp-body"><h3>{item.name}</h3><p>{plainHelp[item.id] || firstSentence(item.detail)}</p>{item.mappingUnit && <small className="lp-chip">{mappingSummary(item)}</small>}</div>
          <div className="lp-action">{item.status === "ready" ? <span className="lp-done" role="img" aria-label="Connected">✓ Connected</span> : item.connectHref ? <a className="lp-button" href={item.connectHref}>Connect</a> : <button className="lp-button" type="button" onClick={() => onNavigate(item.actionPage)}>Set up</button>}
            {item.status !== "ready" && <ShareLink name={item.name} href={item.connectHref ? new URL(item.connectHref, window.location.origin).toString() : `${window.location.origin}/?page=${encodeURIComponent(item.actionPage || "Integrations")}`} />}</div>
        </article>)}</section>
        <MessagingLaunchpad clients={clients} team={team} onNavigate={onNavigate} onOpenWhatsApp={(id) => setWaFor(id)} />
        {waFor !== null && <Suspense fallback={null}><WhatsAppSetup clients={clients.map((c) => ({ id: c.id, name: c.name }))} initialClientId={waFor} onClose={() => setWaFor(null)} onLive={() => undefined} /></Suspense>}
      </>;
    })()}
  </main>;
}

/** Copy or email a link so someone (e.g. on their phone) can finish this connection. They sign in to the OS first. */
function ShareLink({ name, href }: { name: string; href: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(href); }
    catch { const t = document.createElement("textarea"); t.value = href; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); }
    setCopied(true); window.setTimeout(() => setCopied(false), 1800);
  };
  const subject = `Connect ${name} to F2B Agency OS`;
  const body = `Hi,\n\nCould you connect ${name} for us? Open this link (sign in to the F2B Agency OS if asked) and follow the steps:\n\n${href}\n\nThanks!`;
  return <span className="lp-share">
    <button type="button" className="lp-share-btn" onClick={() => void copy()} title="Copy a link you can send to anyone (works on mobile)">{copied ? "✓ Copied" : "Copy link"}</button>
    <a className="lp-share-btn" href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`} title="Email this link">Email</a>
  </span>;
}
