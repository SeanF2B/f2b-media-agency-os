"use client";

import { useEffect, useMemo, useState } from "react";
import { AiVisibilityPanel } from "./ai-visibility-panel";
import { RankTrackingPanel } from "./rank-tracking-panel";

// Operations Centre: one admin-only page that reuses existing features (SEO, Google Ads, Websites,
// Domains & DNS, Reports, Tasks). It reads the workspace already loaded in the app, so the
// Overview adds no database reads; Websites & Domains reads one small site registry table once.

type OpsClient = {
  id: string; name: string; status: string; logo?: string; color?: string;
  services?: Array<{ name: string }>;
  googleAdsAccountId?: string; metaAdsAccountId?: string; googleSearchConsoleAccountId?: string; googleAnalyticsAccountId?: string;
  googleBusinessProfileAccountId?: string; googleBusinessProfileLocationId?: string; wordpressSiteUrl?: string; website?: string;
};
type OpsTask = { id: string; clientId: string; title?: string; status: string; due?: string; dueAt?: string; repeat?: string; paused?: boolean; aiRunAt?: string; completedAt?: string; aiDismissedAt?: string; aiApprovals?: Array<{ status?: string }>; aiRunState?: string };

// Every connection a client can have, shown as an icon with a green (connected) or red (missing) dot.
const CONNECTIONS: Array<{ key: string; label: string; page: string; ok: (client: OpsClient, hasSite: boolean) => boolean; icon: React.ReactNode }> = [
  { key: "gads", label: "Google Ads", page: "Google Ads", ok: (c) => Boolean(c.googleAdsAccountId), icon: <svg viewBox="0 0 24 24"><path fill="currentColor" d="M9.4 3.6a3 3 0 0 1 4.1 1.1l6.6 11.4a3 3 0 1 1-5.2 3l-6.6-11.4a3 3 0 0 1 1.1-4.1ZM5 15.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z" /></svg> },
  { key: "meta", label: "Meta Ads", page: "Meta Ads", ok: (c) => Boolean(c.metaAdsAccountId), icon: <svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" d="M3 15c0-4 2-8 4.5-8C11 7 13 17 16.5 17 19 17 21 14.5 21 12s-1.5-5-3.5-5C14 7 12 17 7.5 17 5 17 3 16 3 15Z" /></svg> },
  { key: "gsc", label: "Search Console", page: "SEO", ok: (c) => Boolean(c.googleSearchConsoleAccountId), icon: <svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" strokeWidth="2.4" /><path stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" d="m15 15 5 5" /></svg> },
  { key: "ga4", label: "Google Analytics", page: "SEO", ok: (c) => Boolean(c.googleAnalyticsAccountId), icon: <svg viewBox="0 0 24 24"><rect x="4" y="12" width="4" height="8" rx="2" fill="currentColor" /><rect x="10" y="8" width="4" height="12" rx="2" fill="currentColor" /><rect x="16" y="3" width="4" height="17" rx="2" fill="currentColor" /></svg> },
  { key: "gbp", label: "Business Profile", page: "SEO", ok: (c) => Boolean(c.googleBusinessProfileLocationId || c.googleBusinessProfileAccountId), icon: <svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 4h16l1.5 5a3 3 0 0 1-5 2.2 3 3 0 0 1-5 0 3 3 0 0 1-5 0A3 3 0 0 1 2.5 9L4 4Zm1 9.5V20h14v-6.5a5 5 0 0 1-3.5-.6 5 5 0 0 1-3.5 1 5 5 0 0 1-3.5-1 5 5 0 0 1-3.5.6Z" /></svg> },
  { key: "site", label: "Website", page: "Sites", ok: (c, hasSite) => hasSite || Boolean(c.wordpressSiteUrl), icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" /><path fill="none" stroke="currentColor" strokeWidth="2" d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" /></svg> },
];
function ConnectionDots({ client, hasSite, onOpen }: { client: OpsClient; hasSite: boolean; onOpen: (page: string) => void }) {
  return <span className="ops-conn">{CONNECTIONS.map((item) => { const ok = item.ok(client, hasSite); return <button key={item.key} type="button" className={ok ? "ok" : "missing"} title={`${item.label}: ${ok ? "connected" : "not connected"}`} aria-label={`${item.label} ${ok ? "connected" : "not connected"}`} onClick={() => onOpen(item.page)}>{item.icon}<i /></button>; })}</span>;
}
type SiteRow = { clientId: string; backend: string; previewUrl: string; repo: string; branch: string; updatedAt: string };
export type OperationsTab = "overview" | "seo" | "ads" | "websites" | "local" | "reports" | "onboarding";
/** Older links/state used more tabs; map them onto the six areas (+ the sub-view they opened). */
export function normalizeOpsTab(value: string): { tab: OperationsTab; sub?: string } {
  const legacy: Record<string, { tab: OperationsTab; sub?: string }> = { keywords: { tab: "seo" }, audits: { tab: "reports", sub: "audits" }, media: { tab: "websites", sub: "media" }, ai: { tab: "local", sub: "ai" } };
  return legacy[value] || { tab: (["overview", "seo", "ads", "websites", "local", "reports", "onboarding"].includes(value) ? value : "overview") as OperationsTab };
}
export type CommunityResult = { url: string; title: string; snippet: string; platform: string };
type Check = { label: string; ok: boolean; page?: string };

const SERVICE_ALIASES: Record<string, string> = { "Web Design & Development": "Website", Sites: "Website" };
const serviceName = (name: string) => SERVICE_ALIASES[name] || name;

function connectionChecks(client: OpsClient, hasSite: boolean): Check[] {
  const services = new Set((client.services || []).map((service) => serviceName(service.name)));
  const checks: Check[] = [];
  if (services.has("Google Ads")) checks.push({ label: "Google Ads", ok: Boolean(client.googleAdsAccountId), page: "Google Ads" });
  if (services.has("Meta Ads")) checks.push({ label: "Meta Ads", ok: Boolean(client.metaAdsAccountId), page: "Meta Ads" });
  if (services.has("SEO")) {
    checks.push({ label: "Search Console", ok: Boolean(client.googleSearchConsoleAccountId), page: "SEO" });
    checks.push({ label: "Analytics", ok: Boolean(client.googleAnalyticsAccountId), page: "SEO" });
    checks.push({ label: "Business Profile", ok: Boolean(client.googleBusinessProfileLocationId || client.googleBusinessProfileAccountId), page: "SEO" });
  }
  if (services.has("Website")) checks.push({ label: "Website", ok: hasSite || Boolean(client.wordpressSiteUrl), page: "Sites" });
  return checks;
}

const hostOf = (value?: string) => { try { return value ? new URL(/^https?:\/\//.test(value) ? value : `https://${value}`).hostname : ""; } catch { return ""; } };

/** WordPress admin (the WordPress editor) for a client's WordPress site URL. */
function wpAdminUrl(siteUrl: string) {
  try { const url = new URL(/^https?:\/\//i.test(siteUrl) ? siteUrl : `https://${siteUrl}`); return `${url.origin}${url.pathname.replace(/\/+$/, "").replace(/\/wp-admin$/, "")}/wp-admin/`; } catch { return siteUrl; }
}

export function OperationsView({ clients, tasks, tab, onTab, onOpenPage, onOpenWebsite, onOpenDns, onStartOnboarding, onboarding, onCreateGbpTask, onCreateCommunityTask, renderTool }: {
  clients: OpsClient[]; tasks: OpsTask[]; tab: OperationsTab; onTab: (tab: OperationsTab) => void;
  onOpenPage: (page: string, clientId?: string) => void; onOpenWebsite: (client: OpsClient) => void; onOpenDns: () => void;
  onStartOnboarding?: (clientId: string) => void; onboarding?: React.ReactNode;
  onCreateGbpTask?: (clientId: string) => string; onCreateCommunityTask?: (clientId: string, results: CommunityResult[]) => string;
  renderTool?: (tool: "keywords" | "seo-keywords" | "seo-competitors" | "seo-audit" | "audits" | "reports" | "media" | "ads", clientId: string) => React.ReactNode;
}) {
  const [toolClientId, setToolClientIdState] = useState(() => { try { return window.localStorage.getItem("f2b-ops-client") || ""; } catch { return ""; } });
  const setToolClientId = (id: string) => { setToolClientIdState(id); try { window.localStorage.setItem("f2b-ops-client", id); } catch { /* storage unavailable */ } };
  const [siteMode, setSiteMode] = useState<"sites" | "media">("sites");
  const [localMode, setLocalMode] = useState<"business" | "ai">("business");
  const [reportMode, setReportMode] = useState<"audits" | "reports">("audits");
  const [seoMode, setSeoMode] = useState<"keywords" | "competitors" | "ranks" | "audit">("keywords");
  const [community, setCommunity] = useState<Record<string, { busy?: boolean; error?: string; results?: CommunityResult[]; cost?: number | null; note?: string; usage?: { clientRuns: number; lastRun: string | null; workspaceRuns: number; monthCostUsd: number } }>>({});
  const [notice, setNotice] = useState("");
  const findQuestions = async (client: OpsClient) => {
    const set = (patch: Record<string, unknown>) => setCommunity((current) => ({ ...current, [client.id]: { ...current[client.id], ...patch } }));
    set({ busy: true, error: "", note: "" });
    try {
      const first = await fetch("/api/community-leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: client.id }) });
      const preview = await first.json().catch(() => ({})) as { status?: string; queries?: string[]; message?: string; error?: string; usage?: never };
      if (first.status === 409 && preview.status === "confirmation_required") {
        if (!window.confirm(`${preview.message}\n\nSearches:\n${(preview.queries || []).join("\n")}`)) { set({ busy: false }); return; }
      } else if (!first.ok) throw Object.assign(new Error(preview.error || "Search unavailable."), { usage: preview.usage });
      const response = await fetch("/api/community-leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: client.id, acknowledgeCost: true }) });
      const json = await response.json().catch(() => ({})) as { results?: CommunityResult[]; costUsd?: number | null; error?: string; usage?: never; failed?: string[] };
      if (!response.ok) throw Object.assign(new Error(json.error || "Search failed."), { usage: json.usage });
      set({ busy: false, results: json.results || [], cost: json.costUsd ?? null, usage: json.usage, note: json.failed?.length ? `${json.failed.length} search(es) failed.` : "" });
    } catch (reason) { set({ busy: false, error: reason instanceof Error ? reason.message : "Search failed.", ...((reason as { usage?: unknown })?.usage ? { usage: (reason as { usage: never }).usage } : {}) }); }
  };
  const [sites, setSites] = useState<SiteRow[] | null>(null);
  const [siteError, setSiteError] = useState("");
  const [query, setQuery] = useState("");
  const active = useMemo(() => clients.filter((client) => client.status !== "Inactive" && client.status !== "Archived" && !/^agency$/i.test(client.name.trim())), [clients]);
  useEffect(() => {
    if (!["overview", "websites", "local"].includes(tab) || sites) return;
    fetch("/api/sites?siteRegistry=1", { cache: "no-store" }).then(async (response) => {
      const json = await response.json().catch(() => ({})) as { sites?: SiteRow[]; error?: string };
      if (!response.ok) throw new Error(json.error || "Website list unavailable.");
      setSites(json.sites || []);
    }).catch((reason) => { setSites([]); setSiteError(reason instanceof Error ? reason.message : "Website list unavailable."); });
  }, [tab, sites]);
  const siteFor = (id: string) => (sites || []).find((row) => row.clientId === id);
  const rows = active.filter((client) => !query.trim() || client.name.toLowerCase().includes(query.trim().toLowerCase())).map((client) => {
    const openTasks = tasks.filter((task) => task.clientId === client.id && task.status !== "Done" && !task.aiDismissedAt);
    const approvals = openTasks.filter((task) => (task.aiApprovals || []).some((item) => item.status === "pending") || task.aiRunState === "needs_review").length;
    const checks = connectionChecks(client, Boolean(siteFor(client.id)));
    return { client, openTasks: openTasks.length, approvals, checks, missing: checks.filter((check) => !check.ok) };
  });
  const issues = rows.reduce((sum, row) => sum + row.missing.length, 0);
  const totalApprovals = rows.reduce((sum, row) => sum + row.approvals, 0);

  const selected = active.find((client) => client.id === toolClientId) || active[0];
  const seg = <K extends string>(value: K, set: (key: K) => void, items: Array<[K, string]>, label: string) => <span className="ops-seg" role="tablist" aria-label={label}>{items.map(([key, text]) => <button type="button" role="tab" key={key} aria-selected={value === key} className={value === key ? "active" : ""} onClick={() => set(key)}>{text}</button>)}</span>;
  const seoLocation = ((selected as OpsClient & { seoLocations?: string[] } | undefined)?.seoLocations || [])[0] || "Ireland";

  return <section className="ops-centre">
    <div className="page-heading ops-heading"><div><p className="eyebrow">Agency</p><h1>Operations</h1></div>
      {tab !== "overview" && tab !== "onboarding" && !(tab === "websites" && siteMode === "sites") && !(tab === "local" && localMode === "business") && selected && <label className="ops-client-pick ops-client-shared"><span className="ops-client-logo">{selected.logo ? <img src={selected.logo} alt="" /> : <i style={{ background: selected.color || "#d9dee3" }} />}</span><select aria-label="Client for all Operations tools" value={selected.id} onChange={(event) => setToolClientId(event.target.value)}>{active.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>}
    </div>
    <div className="ops-tabs" role="tablist" aria-label="Operations sections">
      {([["overview", "Overview"], ["seo", "SEO & Research"], ["ads", "Google Ads"], ["websites", "Websites"], ["local", "Local & AI"], ["reports", "Reports"]] as Array<[OperationsTab, string]>).filter(([key]) => !["seo", "ads", "reports"].includes(key) || renderTool).map(([key, label]) => <button type="button" role="tab" key={key} aria-selected={tab === key || (key === "overview" && tab === "onboarding")} className={tab === key || (key === "overview" && tab === "onboarding") ? "active" : ""} onClick={() => onTab(key)}>{label}</button>)}
    </div>

    {tab === "overview" && <p className="ops-more">Also: {[["SEO", "SEO"], ["Google Ads", "Google Ads"], ["Meta Ads", "Meta Ads"], ["Proposal Studio", "Proposals"], ["Automations", "Marketing automations"]].map(([page, label], index) => <span key={page}>{index ? " · " : ""}<button type="button" className="text-button" onClick={() => onOpenPage(page)}>{label}</button></span>)}</p>}
    {tab === "overview" && <>
      <div className="ops-summary">
        <div><b>{active.length}</b><span>Active clients</span></div>
        <button type="button" onClick={() => onOpenPage("Tasks")}><b>{rows.reduce((sum, row) => sum + row.openTasks, 0)}</b><span>Open tasks</span></button>
        <button type="button" onClick={() => onOpenPage("Tasks")}><b>{totalApprovals}</b><span>Waiting for review</span></button>
        <div className={issues ? "warn" : ""}><b>{issues}</b><span>Missing connections</span></div>
      </div>
      <div className="ops-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search clients…" aria-label="Search clients" />{onStartOnboarding && <button type="button" className="primary-button" onClick={() => onStartOnboarding("")}>＋ Onboard a client</button>}</div>
      <div className="ops-table-wrap"><table className="ops-table">
        <thead><tr><th>Client</th><th>Services</th><th>Connections</th><th>Tasks</th><th></th></tr></thead>
        <tbody>{rows.map(({ client, openTasks, approvals, checks, missing }) => <tr key={client.id}>
          <td><span className="ops-client">{client.logo ? <img src={client.logo} alt="" /> : <i style={{ background: client.color || "#d9dee3" }} />}<b>{client.name}</b></span></td>
          <td>{(client.services || []).length ? [...new Set((client.services || []).map((service) => serviceName(service.name)))].join(", ") : <span className="muted">No services</span>}</td>
          <td><ConnectionDots client={client} hasSite={Boolean(siteFor(client.id))} onOpen={(page) => onOpenPage(page, client.id)} />{missing.length > 0 && <small className="ops-missing">Needed: {missing.map((check) => check.label).join(", ")}</small>}</td>
          <td><button type="button" className="text-button" onClick={() => onOpenPage("Tasks")}>{openTasks} open{approvals ? ` · ${approvals} to review` : ""}</button></td>
          <td className="ops-actions">{onStartOnboarding && <button type="button" className="secondary-button" onClick={() => onStartOnboarding(client.id)}>Onboard</button>}<select aria-label={`Open a tool for ${client.name}`} value="" onChange={(event) => { const value = event.target.value; if (value === "website") onOpenWebsite(client); else if (value) onOpenPage(value, client.id); }}><option value="">Open…</option><option value="website">Website builder</option><option value="SEO">SEO</option><option value="Google Ads">Google Ads</option><option value="Meta Ads">Meta Ads</option><option value="Report Studio">Reports</option><option value="Clients">Client profile</option></select></td>
        </tr>)}</tbody>
      </table>{!rows.length && <p className="ops-empty">No clients match.</p>}</div>
    </>}

    {tab === "websites" && siteMode === "sites" && <>
      <div className="ops-subbar">{seg(siteMode, setSiteMode, [["sites", "Sites & domains"], ["media", "Media library"]], "Websites sections")}</div>
      <div className="ops-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search clients…" aria-label="Search clients" /><button type="button" className="secondary-button" onClick={onOpenDns}>Domains & DNS</button></div>
      {siteError && <p className="ops-empty" role="alert">{siteError}</p>}
      <div className="ops-table-wrap"><table className="ops-table">
        <thead><tr><th>Client</th><th>Website</th><th>Source</th><th>Last edited</th><th></th></tr></thead>
        <tbody>{rows.map(({ client }) => { const site = siteFor(client.id); const domain = hostOf(client.wordpressSiteUrl || client.website); return <tr key={client.id}>
          <td><span className="ops-client">{client.logo ? <img src={client.logo} alt="" /> : <i style={{ background: client.color || "#d9dee3" }} />}<b>{client.name}</b></span></td>
          <td>{domain ? <a href={`https://${domain}`} target="_blank" rel="noreferrer">{domain}</a> : <span className="muted">No domain</span>}{site?.previewUrl && <small><a href={site.previewUrl} target="_blank" rel="noreferrer">Preview</a></small>}</td>
          <td>{sites === null ? <span className="muted">Loading…</span> : site ? (site.backend === "github" ? <span title={`${site.repo}${site.branch ? ` · ${site.branch}` : ""}`}>Astro · GitHub</span> : "Agency OS") : client.wordpressSiteUrl ? "WordPress" : <span className="muted">Not set up</span>}</td>
          <td>{site?.updatedAt ? new Date(site.updatedAt).toLocaleDateString("en-IE", { day: "numeric", month: "short" }) : "—"}</td>
          <td className="ops-actions">{!site && client.wordpressSiteUrl ? <a className="secondary-button" href={wpAdminUrl(client.wordpressSiteUrl)} target="_blank" rel="noreferrer" title="Opens the WordPress editor in a new tab">Edit website</a> : <button type="button" className="secondary-button" onClick={() => onOpenWebsite(client)}>Edit website</button>}<button type="button" className="ops-icon-button" onClick={() => onOpenPage("Sites", client.id)} aria-label={`Site settings for ${client.name}`} title="Site settings"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg></button></td>
        </tr>; })}</tbody>
      </table></div>
    </>}

    {tab === "onboarding" && <><button type="button" className="text-button ops-back" onClick={() => onTab("overview")}>← Back to overview</button>{onboarding}</>}

    {tab === "seo" && renderTool && selected && <>
      <div className="ops-subbar">{seg(seoMode, setSeoMode, [["keywords", "Keywords"], ["competitors", "Competitors"], ["ranks", "Rankings"], ["audit", "Site Audit"]], "SEO sections")}</div>
      <div className="ops-embed" key={`seo-${seoMode}-${selected.id}`}>{seoMode === "ranks" ? <RankTrackingPanel clientId={selected.id} clientName={selected.name} defaultLocation={seoLocation} /> : renderTool(seoMode === "competitors" ? "seo-competitors" : seoMode === "audit" ? "seo-audit" : "seo-keywords", selected.id)}</div>
    </>}
    {tab === "ads" && renderTool && selected && <div className="ops-embed" key={`ads-${selected.id}`}>{renderTool("ads", selected.id)}</div>}
    {tab === "reports" && renderTool && selected && <>
      <div className="ops-subbar">{seg(reportMode, setReportMode, [["audits", "Audits"], ["reports", "Reports"]], "Reports sections")}</div>
      <div className="ops-embed" key={`rep-${reportMode}-${selected.id}`}>{renderTool(reportMode, selected.id)}</div>
    </>}
    {tab === "local" && localMode === "ai" && selected && <>
      <div className="ops-subbar">{seg(localMode, setLocalMode, [["business", "Business & community"], ["ai", "AI visibility"]], "Local and AI sections")}</div>
      <div className="ops-embed" key={`ai-${selected.id}`}><AiVisibilityPanel clientId={selected.id} clientName={selected.name} area={seoLocation} services={(selected.services || []).map((service) => service.name).concat((selected as OpsClient & { seoServices?: string[] }).seoServices || [])} /></div>
    </>}
    {tab === "websites" && siteMode === "media" && renderTool && <>
      <div className="ops-subbar">{seg(siteMode, setSiteMode, [["sites", "Sites & domains"], ["media", "Media library"]], "Websites sections")}</div>
      <div className="ops-embed">{renderTool("media", "")}</div>
    </>}
    {!selected && ["seo", "ads", "reports"].includes(tab) && <p className="ops-empty">No active clients.</p>}

    {tab === "local" && localMode === "business" && <>
      <div className="ops-subbar">{seg(localMode, setLocalMode, [["business", "Business & community"], ["ai", "AI visibility"]], "Local and AI sections")}</div>
      <p className="muted ops-hint">Drafts wait for your approval — nothing is posted automatically.</p>
      {notice && <p className="ops-notice" role="status">{notice}</p>}
      <div className="ops-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search clients…" aria-label="Search clients" /></div>
      <div className="ops-table-wrap"><table className="ops-table">
        <thead><tr><th>Client</th><th>Connections</th><th>Community questions</th><th></th></tr></thead>
        <tbody>{rows.map(({ client }) => { const c = community[client.id] || {}; const gbp = Boolean(client.googleBusinessProfileLocationId || client.googleBusinessProfileAccountId); return <tr key={client.id}>
          <td><span className="ops-client">{client.logo ? <img src={client.logo} alt="" /> : <i style={{ background: client.color || "#d9dee3" }} />}<b>{client.name}</b></span></td>
          <td><ConnectionDots client={client} hasSite={Boolean(siteFor(client.id))} onOpen={(page) => onOpenPage(page, client.id)} />{onCreateGbpTask && <button type="button" className="text-button ops-inline" disabled={!gbp} title={gbp ? "Grok drafts posts and review replies for approval" : "Link the Business Profile first"} onClick={() => setNotice(onCreateGbpTask(client.id))}>Draft posts & replies</button>}</td>
          <td>{c.busy ? <span className="muted">Searching…</span> : c.error ? <span className="ops-error">{c.error}</span> : c.results ? <span>{c.results.length} found{c.cost != null ? ` · $${c.cost.toFixed(3)}` : ""}{c.note ? ` · ${c.note}` : ""}</span> : <span className="muted">{c.usage?.lastRun ? `Last search ${new Date(c.usage.lastRun).toLocaleDateString("en-IE")}` : "—"}</span>}
            {c.results && c.results.length > 0 && <details className="ops-results"><summary>View questions</summary><ul>{c.results.map((item) => <li key={item.url}><a href={item.url} target="_blank" rel="noreferrer">{item.platform}: {item.title}</a></li>)}</ul></details>}</td>
          <td className="ops-actions"><button type="button" className="secondary-button" disabled={c.busy} onClick={() => void findQuestions(client)}>Find questions</button>{c.results && c.results.length > 0 && onCreateCommunityTask && <button type="button" className="primary-button" onClick={() => { setNotice(onCreateCommunityTask(client.id, c.results || [])); setCommunity((current) => ({ ...current, [client.id]: { ...current[client.id], results: [] } })); }}>Send to Grok</button>}</td>
        </tr>; })}</tbody>
      </table></div>
    </>}
  </section>;
}
