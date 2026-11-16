"use client";

import { appAlert, appConfirm, appPrompt } from "./app-dialog";
import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { readFocusClient, setFocusClient, useFocusClient } from "@/lib/focus-client";
import { BrandIcon } from "./brand-icon";
import { Briefcase, FileText, Globe, Check, Link2, Mail, MapPin, Megaphone, MessageCircle, Star, Search, type LucideIcon } from "lucide-react";
import { AiVisibilityPanel } from "./ai-visibility-panel";
import { RankTrackingPanel } from "./rank-tracking-panel";
import { SiteFormsPanel } from "./site-forms-panel";
const EmailMarketingView = lazy(() => import("./email-marketing-view").then((module) => ({ default: module.EmailMarketingView })));

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
  const done = CONNECTIONS.filter((item) => item.ok(client, hasSite)).length;
  const pct = Math.round(done / CONNECTIONS.length * 100);
  return <span className="ops-conn"><span className={`ops-conn-pct ${pct >= 80 ? "good" : pct >= 50 ? "mid" : "low"}`} style={{ ["--pct" as string]: `${pct}%` }} title={`${done} of ${CONNECTIONS.length} connected`}><b>{pct}%</b></span>{CONNECTIONS.map((item) => { const ok = item.ok(client, hasSite); return <button key={item.key} type="button" className={ok ? "ok" : "missing"} title={`${item.label}: ${ok ? "connected" : "not connected"}`} aria-label={`${item.label} ${ok ? "connected" : "not connected"}`} onClick={() => onOpen(ok ? item.page : "Integrations")}><BrandIcon id={item.key} size={16} fallback={item.icon} /><i /></button>; })}{done < CONNECTIONS.length && <QuickConnectLink client={client} missing={CONNECTIONS.filter((item) => !item.ok(client, hasSite)).map((item) => item.label)} />}</span>;
}
// Quick link a client can open to connect their own accounts (their Launchpad), copied or emailed in one click.
function QuickConnectLink({ client, missing }: { client: OpsClient; missing: string[] }) {
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState("");
  // A signed, login-free link to the client's own connect page (no Agency OS / Cloudflare sign-in needed).
  const getLink = async () => { if (link) return link; const response = await fetch(`/api/client-connect-link?clientId=${encodeURIComponent(client.id)}`, { cache: "no-store" }); const json = await response.json().catch(() => ({})) as { url?: string; error?: string }; if (!response.ok || !json.url) throw new Error(json.error || "Couldn’t make the link."); setLink(json.url); return json.url; };
  const copy = async () => { let url = ""; try { url = await getLink(); await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch (reason) { if (url) await appPrompt("Copy this link:", url); else await appAlert(reason instanceof Error ? reason.message : "Couldn’t make the link."); } };
  const email = async () => { try { const url = await getLink(); window.location.href = mailFor(url); } catch (reason) { await appAlert(reason instanceof Error ? reason.message : "Couldn’t make the link."); } };
  const mailFor = (url: string) => `mailto:${encodeURIComponent((client as OpsClient & { email?: string }).email || "")}?subject=${encodeURIComponent(`Connect your accounts · ${client.name}`)}&body=${encodeURIComponent(`Hi,\n\nCould you connect these so we can manage everything in one place: ${missing.join(", ")}.\n\nOpen this link and follow the steps (no login needed):\n${url}\n\nThanks!`)}`;
  return <span className="ops-quick-link"><button type="button" title={copied ? "Link copied" : "Copy a connect link for this client"} aria-label={`Copy connect link for ${client.name}`} onClick={() => void copy()}>{copied ? <Check size={14} /> : <Link2 size={14} />}</button><button type="button" onClick={() => void email()} title="Email the connect link to the client" aria-label={`Email connect link to ${client.name}`}><Mail size={14} /></button></span>;
}
type SiteRow = { clientId: string; backend: string; previewUrl: string; repo: string; branch: string; updatedAt: string };
// Where everything lives: Overview (performance, priorities, issues) · Google Ads (campaigns, optimisation,
// conversions) · SEO & AI (SEO, AEO/GEO, keyword research, Business Profile, backlinks, AI visibility) ·
// Websites (sites, landing pages, forms, media) · Email (builder, AI campaigns, automations) · Reports.
const OPS_TABS: Array<[OperationsTab, string, LucideIcon]> = [["clients", "Clients", Briefcase], ["ads", "Google Ads", Megaphone], ["seo", "SEO & AI", Search], ["websites", "Websites", Globe], ["email", "Email", Mail], ["reports", "Reports", FileText]];
export type OperationsTab = "overview" | "clients" | "ads" | "seo" | "websites" | "email" | "reports" | "onboarding";
type SeoMode = "keywords" | "competitors" | "ranks" | "audit" | "backlinks" | "local" | "ai";
type SiteMode = "sites" | "forms" | "media";
/** Older links/state used more tabs; map them onto the current areas (+ the sub-view they opened). */
export function normalizeOpsTab(value: string): { tab: OperationsTab; sub?: string } {
  const legacy: Record<string, { tab: OperationsTab; sub?: string }> = { keywords: { tab: "seo", sub: "keywords" }, local: { tab: "seo", sub: "local" }, ai: { tab: "seo", sub: "ai" }, backlinks: { tab: "seo", sub: "backlinks" }, audits: { tab: "reports", sub: "audits" }, media: { tab: "websites", sub: "media" }, forms: { tab: "websites", sub: "forms" }, automations: { tab: "email", sub: "automations" }, emails: { tab: "email" }, leadfactory: { tab: "overview" } };
  return legacy[value] || { tab: (OPS_TABS.some(([key]) => key === value) || value === "onboarding" ? value : "clients") as OperationsTab };
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

export function OperationsView({ clientsView, clients, tasks, tab: rawTab, onTab, onOpenPage, onOpenWebsite, onOpenDns, onStartOnboarding, onboarding, onCreateGbpTask, onCreateCommunityTask, renderTool, automations, onStartReviews, onEditClient, onPickClient }: { clientsView?: ReactNode; onPickClient?: (clientId: string) => void; 
  onStartReviews?: (clientId: string) => string; onEditClient?: (clientId: string) => void;
  clients: OpsClient[]; tasks: OpsTask[]; tab: string; onTab: (tab: OperationsTab) => void;
  onOpenPage: (page: string, clientId?: string) => void; onOpenWebsite: (client: OpsClient) => void; onOpenDns: () => void;
  onStartOnboarding?: (clientId: string) => void; onboarding?: React.ReactNode; automations?: React.ReactNode; hasLeadFactory?: boolean;
  onCreateGbpTask?: (clientId: string) => string; onCreateCommunityTask?: (clientId: string, results: CommunityResult[]) => string;
  renderTool?: (tool: "keywords" | "seo-keywords" | "seo-competitors" | "seo-backlinks" | "seo-audit" | "audits" | "reports" | "media" | "ads", clientId: string) => React.ReactNode;
}) {
  const [toolClientId, setToolClientIdState] = useState(() => { try { return window.localStorage.getItem("f2b-ops-client") || ""; } catch { return ""; } });
  useFocusClient((id) => { if (id) setToolClientIdState(id); });
  const setToolClientId = (id: string) => { setToolClientIdState(id); if (id) setFocusClient(id); try { window.localStorage.setItem("f2b-ops-client", id); } catch { /* storage unavailable */ } };
  const { tab, sub } = normalizeOpsTab(rawTab === "overview" ? "clients" : rawTab);
  const [workroom, setWorkroom] = useState(false); // client workroom (full client profile) open inside the Clients tab
  const [siteMode, setSiteMode] = useState<SiteMode>("sites");
  const [reportMode, setReportMode] = useState<"audits" | "reports">("reports");
  const [seoMode, setSeoMode] = useState<SeoMode>("keywords");
  const [emailStart, setEmailStart] = useState<"campaigns" | "automations">("campaigns");
  // Old links (e.g. "forms", "local", "automations") land on the right section inside the new tabs.
  useEffect(() => {
    if (!sub) return;
    if (tab === "seo") setSeoMode(sub as SeoMode); else if (tab === "websites") setSiteMode(sub as SiteMode); else if (tab === "reports") setReportMode(sub as "audits"); else if (tab === "email" && sub === "automations") setEmailStart("automations");
    onTab(tab);
  }, [rawTab]); // eslint-disable-line react-hooks/exhaustive-deps
  const [community, setCommunity] = useState<Record<string, { busy?: boolean; error?: string; results?: CommunityResult[]; cost?: number | null; note?: string; usage?: { clientRuns: number; lastRun: string | null; workspaceRuns: number; monthCostUsd: number } }>>({});
  const [notice, setNotice] = useState("");
  const findQuestions = async (client: OpsClient) => {
    const set = (patch: Record<string, unknown>) => setCommunity((current) => ({ ...current, [client.id]: { ...current[client.id], ...patch } }));
    set({ busy: true, error: "", note: "" });
    try {
      const first = await fetch("/api/community-leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: client.id }) });
      const preview = await first.json().catch(() => ({})) as { status?: string; queries?: string[]; message?: string; error?: string; usage?: never };
      if (first.status === 409 && preview.status === "confirmation_required") {
        if (!(await appConfirm(`${preview.message}\n\nSearches:\n${(preview.queries || []).join("\n")}`))) { set({ busy: false }); return; }
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
  const [statusView, setStatusView] = useState<"active" | "inactive" | "all">("active");
  const active = useMemo(() => clients.filter((client) => client.status !== "Inactive" && client.status !== "Archived" && !/^agency$/i.test(client.name.trim())), [clients]);
  useEffect(() => {
    if (!(tab === "clients" || tab === "websites" || (tab === "seo" && seoMode === "local")) || sites) return;
    fetch("/api/sites?siteRegistry=1", { cache: "no-store" }).then(async (response) => {
      const json = await response.json().catch(() => ({})) as { sites?: SiteRow[]; error?: string };
      if (!response.ok) throw new Error(json.error || "Website list unavailable.");
      setSites(json.sites || []);
    }).catch((reason) => { setSites([]); setSiteError(reason instanceof Error ? reason.message : "Website list unavailable."); });
  }, [tab, seoMode, sites]);
  const siteFor = (id: string) => (sites || []).find((row) => row.clientId === id);
  const isActiveClient = (client: OpsClient) => client.status !== "Inactive" && client.status !== "Archived";
  const listed = clients.filter((client) => !/^agency$/i.test(client.name.trim()) && (statusView === "all" || (statusView === "active" ? isActiveClient(client) : !isActiveClient(client))));
  const rows = listed.filter((client) => !query.trim() || client.name.toLowerCase().includes(query.trim().toLowerCase())).map((client) => {
    const openTasks = tasks.filter((task) => task.clientId === client.id && task.status !== "Done" && !task.aiDismissedAt);
    const approvals = openTasks.filter((task) => (task.aiApprovals || []).some((item) => item.status === "pending") || task.aiRunState === "needs_review").length;
    const checks = connectionChecks(client, Boolean(siteFor(client.id)));
    return { client, openTasks: openTasks.length, approvals, checks, missing: checks.filter((check) => !check.ok) };
  });
  const issues = rows.reduce((sum, row) => sum + row.missing.length, 0);
  const totalApprovals = rows.reduce((sum, row) => sum + row.approvals, 0);

  const selected = active.find((client) => client.id === toolClientId) || active[0];
  // The top-bar client picker drives every Operations tool; when it's on "All clients", show the client being used there.
  const needsClient = tab !== "clients" && tab !== "onboarding";
  // Email also works for the agency's own contacts when the agency is picked in the top bar.
  const agencyClient = clients.find((client) => /^agency$/i.test(client.name.trim()));
  const emailClient = agencyClient && toolClientId === agencyClient.id ? { ...agencyClient, id: "", name: "F2B Media (agency)" } : selected;
  useEffect(() => { if (needsClient && selected && !readFocusClient()) setFocusClient(selected.id); }, [needsClient, selected?.id]);
  const seg = <K extends string>(value: K, set: (key: K) => void, items: Array<[K, string]>, label: string) => <span className="ops-seg" role="tablist" aria-label={label}>{items.map(([key, text]) => <button type="button" role="tab" key={key} aria-selected={value === key} className={value === key ? "active" : ""} onClick={() => set(key)}>{text}</button>)}</span>;
  const seoLocation = ((selected as OpsClient & { seoLocations?: string[] } | undefined)?.seoLocations || [])[0] || "Ireland";

  return <section className="ops-centre">
    <div className="page-heading ops-heading"><div><p className="eyebrow">Agency</p><h1>Operations</h1></div>
    </div>
    <div className="ops-tabs" role="tablist" aria-label="Operations sections">
      {OPS_TABS.filter(([key]) => (key !== "clients" || clientsView) && (!["seo", "ads", "reports"].includes(key) || renderTool)).map(([key, label, Icon]) => { const on = tab === key || (key === "clients" && tab === "onboarding"); return <button type="button" role="tab" key={key} aria-selected={on} className={on ? "active" : ""} onClick={() => { if (key === "clients") setWorkroom(false); onTab(key); }}><Icon size={16} strokeWidth={1.9} aria-hidden="true" className="ops-tab-icon" />{label}</button>; })}
    </div>

    {tab === "clients" && workroom && clientsView && <><button type="button" className="text-button ops-back" onClick={() => setWorkroom(false)}>← All clients</button>{clientsView}</>}
    {tab === "clients" && !workroom && <p className="ops-more">Also: {[["Meta Ads", "Meta Ads"], ["Proposal Studio", "Proposals"]].map(([page, label], index) => <span key={page}>{index ? " · " : ""}<button type="button" className="text-button" onClick={() => onOpenPage(page)}>{label}</button></span>)}</p>}
    {tab === "clients" && !workroom && <>
      <div className="ops-summary">
        <div><b>{active.length}</b><span>Active clients</span></div>
        <button type="button" onClick={() => onOpenPage("Tasks")}><b>{rows.reduce((sum, row) => sum + row.openTasks, 0)}</b><span>Open tasks</span></button>
        <button type="button" onClick={() => onOpenPage("Tasks")}><b>{totalApprovals}</b><span>Waiting for review</span></button>
        <div className={issues ? "warn" : ""}><b>{issues}</b><span>Missing connections</span></div>
      </div>
      <div className="ops-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search clients…" aria-label="Search clients" /><span className="ops-status-filter" role="tablist" aria-label="Client status">{([["active", "Active"], ["inactive", "Inactive"], ["all", "All"]] as const).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={statusView === key} className={statusView === key ? "active" : ""} onClick={() => setStatusView(key)}>{label}<span>{key === "all" ? clients.filter((c) => !/^agency$/i.test(c.name.trim())).length : clients.filter((c) => !/^agency$/i.test(c.name.trim()) && (key === "active" ? isActiveClient(c) : !isActiveClient(c))).length}</span></button>)}</span>{onStartOnboarding && <button type="button" className="primary-button" onClick={() => onStartOnboarding("")}>＋ Onboard a client</button>}</div>
      <div className="ops-cards">{rows.map(({ client, openTasks, approvals }) => { const services = [...new Set((client.services || []).map((service) => serviceName(service.name)))]; const open = () => { if (clientsView && onPickClient) { onPickClient(client.id); setWorkroom(true); } else onEditClient?.(client.id); }; return <article key={client.id} className={`ops-card${isActiveClient(client) ? "" : " inactive"}`}>
        <button type="button" className="ops-card-head" onClick={open} title={`Open ${client.name}`}>{client.logo ? <img src={client.logo} alt="" /> : <i style={{ background: client.color || "#d9dee3" }}>{client.name.slice(0, 1)}</i>}<span><b>{client.name}</b><small>{services.length ? services.join(" · ") : "No services yet"}</small></span><em className={isActiveClient(client) ? "on" : ""}>{isActiveClient(client) ? "Active" : "Inactive"}</em></button>
        <div className="ops-card-conn"><small>Integrations</small><ConnectionDots client={client} hasSite={Boolean(siteFor(client.id))} onOpen={(page) => onOpenPage(page, client.id)} /></div>
        <div className="ops-card-stats">
          <button type="button" onClick={() => onOpenPage("Tasks")}><b>{openTasks}</b><small>Open tasks</small></button>
          <button type="button" className={approvals ? "warn" : ""} onClick={() => onOpenPage("Tasks")}><b>{approvals}</b><small>To review</small></button>
          <div><b>{(client.services || []).length}</b><small>Services</small></div>
        </div>
        <div className="ops-card-actions">{clientsView && onPickClient && <button type="button" className="primary-button" onClick={open}>Open client</button>}{onStartOnboarding && <button type="button" className="secondary-button" onClick={() => onStartOnboarding(client.id)}>Onboard</button>}<select aria-label={`Open a tool for ${client.name}`} value="" onChange={(event) => { const value = event.target.value; if (value === "website") onOpenWebsite(client); else if (value.startsWith("tab:")) { setToolClientId(client.id); onTab(value.slice(4) as OperationsTab); } else if (value === "profile") onEditClient?.(client.id); else if (value) onOpenPage(value, client.id); }}><option value="">Tools…</option><option value="website">Website builder</option><option value="tab:ads">Google Ads</option><option value="tab:seo">SEO &amp; AI</option><option value="tab:email">Email</option><option value="tab:reports">Reports</option><option value="Meta Ads">Meta Ads</option>{onEditClient && <option value="profile">Edit profile</option>}</select></div>
      </article>; })}</div>{!rows.length && <p className="ops-empty">No clients match.</p>}
    </>}

    {tab === "websites" && <div className="ops-subbar">{seg(siteMode, setSiteMode, [["sites", "Sites & domains"], ["forms", "Forms"], ["media", "Media library"]], "Websites sections")}</div>}
    {tab === "websites" && siteMode === "sites" && <>
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

    {tab === "websites" && siteMode === "forms" && <SiteFormsPanel clients={clients.filter((client) => !/^agency$/i.test(client.name.trim()))} clientId={toolClientId && clients.some((c) => c.id === toolClientId) ? toolClientId : ""} onClient={setToolClientId} />}

    {tab === "onboarding" && <><button type="button" className="text-button ops-back" onClick={() => onTab("clients")}>← Back to clients</button>{onboarding}</>}

    {tab === "seo" && renderTool && selected && <>
      <div className="ops-subbar">{seg(seoMode, setSeoMode, [["keywords", "Keywords"], ["competitors", "Competitors"], ["ranks", "Rankings"], ["audit", "Site audit"], ["backlinks", "Backlinks"], ["local", "Business Profile"], ["ai", "AI visibility"]], "SEO and AI sections")}</div>
      {!["local", "ai"].includes(seoMode) && <div className="ops-embed" key={`seo-${seoMode}-${selected.id}`}>{seoMode === "ranks" ? <RankTrackingPanel clientId={selected.id} clientName={selected.name} defaultLocation={seoLocation} /> : renderTool(seoMode === "competitors" ? "seo-competitors" : seoMode === "audit" ? "seo-audit" : seoMode === "backlinks" ? "seo-backlinks" : "seo-keywords", selected.id)}</div>}
    </>}
    {tab === "email" && emailClient && <Suspense fallback={<div className="page-loading" role="status" aria-label="Loading email…"><i /></div>}><EmailMarketingView key={`${emailClient.id || "agency"}-${emailStart}`} initialMode={emailStart} clientId={emailClient.id} clientName={emailClient.name} clientLogo={emailClient.logo} clientColor={emailClient.color} automations={automations} /></Suspense>}
    {tab === "ads" && renderTool && selected && <div className="ops-embed" key={`ads-${selected.id}`}>{renderTool("ads", selected.id)}</div>}
    {tab === "reports" && renderTool && selected && <>
      <div className="ops-subbar">{seg(reportMode, setReportMode, [["reports", "Client reports"], ["audits", "Audits"]], "Reports sections")}</div>
      <div className="ops-embed" key={`rep-${reportMode}-${selected.id}`}>{renderTool(reportMode, selected.id)}</div>
    </>}
    {tab === "seo" && seoMode === "ai" && selected && <>
      <div className="ops-embed" key={`ai-${selected.id}`}><AiVisibilityPanel clientId={selected.id} clientName={selected.name} area={seoLocation} services={(selected.services || []).map((service) => service.name).concat((selected as OpsClient & { seoServices?: string[] }).seoServices || [])} /></div>
    </>}
    {tab === "websites" && siteMode === "media" && renderTool && <div className="ops-embed">{renderTool("media", "")}</div>}
    {!selected && ["seo", "ads", "reports", "email"].includes(tab) && <p className="ops-empty">No active clients.</p>}

    {tab === "seo" && seoMode === "local" && <>
      {notice && <p className="ops-notice" role="status">{notice}</p>}
      {!selected ? <p className="ops-empty">No active clients.</p> : (() => { const client = selected; const c = community[client.id] || {}; const gbp = Boolean(client.googleBusinessProfileLocationId || client.googleBusinessProfileAccountId); return <div className="ops-local-grid">
        <section className="ops-local-card">
          <header><MapPin size={18} aria-hidden="true" /><div><h3>Google Business Profile</h3><p>{gbp ? "Connected. AI drafts posts and replies to new reviews; nothing is posted until you approve it." : `Link ${client.name}’s Business Profile to draft posts and review replies.`}</p></div><span className={`ops-local-status ${gbp ? "ok" : "off"}`}>{gbp ? "Connected" : "Not linked"}</span></header>
          <div className="ops-local-actions">{gbp ? onCreateGbpTask && <button type="button" className="primary-button" onClick={() => setNotice(onCreateGbpTask(client.id))}>Draft posts &amp; review replies</button> : <button type="button" className="primary-button" onClick={() => onOpenPage("Integrations", client.id)}>Link Business Profile</button>}</div>
        </section>
        {(() => { const reviewsOn = (client.services || []).some((service) => /ai reviews?/i.test(service.name)); const running = tasks.some((task) => (task as { localKey?: string }).localKey === `${client.id}:reviews` && task.status !== "Done" && !(task as { paused?: boolean }).paused); return <section className="ops-local-card">
          <header><Star size={18} aria-hidden="true" /><div><h3>AI Reviews</h3><p>{reviewsOn ? "Every week the AI drafts replies to new Google reviews, plus a review-request message for happy customers. Nothing is posted until you approve it." : `Add the “AI Reviews” service to ${client.name} to switch this on.`}</p></div><span className={`ops-local-status ${reviewsOn && running ? "ok" : "off"}`}>{reviewsOn ? (running ? "Running weekly" : "Service on") : "Off"}</span></header>
          <div className="ops-local-actions">{!reviewsOn ? onEditClient && <button type="button" className="primary-button" onClick={() => onEditClient(client.id)}>Add AI Reviews service</button> : !running ? onStartReviews && <button type="button" className="primary-button" disabled={!gbp} title={gbp ? "" : "Link the Business Profile first"} onClick={() => setNotice(onStartReviews(client.id))}>Start weekly review replies</button> : <span className="muted">Drafts appear in Tasks each week for approval.</span>}{reviewsOn && !gbp && <span className="muted">Link the Business Profile first.</span>}</div>
        </section>; })()}
        <section className="ops-local-card">
          <header><MessageCircle size={18} aria-hidden="true" /><div><h3>Community questions</h3><p>Find recent questions on Reddit, Boards.ie and forums where {client.name} could genuinely help, then have AI draft answers for your approval.</p></div></header>
          <div className="ops-local-actions"><button type="button" className="secondary-button" disabled={c.busy} onClick={() => void findQuestions(client)}>{c.busy ? "Searching…" : "Find questions"}</button>{c.results && c.results.length > 0 && onCreateCommunityTask && <button type="button" className="primary-button" onClick={() => { setNotice(onCreateCommunityTask(client.id, c.results || [])); setCommunity((current) => ({ ...current, [client.id]: { ...current[client.id], results: [] } })); }}>Draft answers for {c.results.length}</button>}<span className="muted">{c.error ? <span className="ops-error">{c.error}</span> : c.results ? `${c.results.length} found${c.cost != null ? ` · $${c.cost.toFixed(3)}` : ""}${c.note ? ` · ${c.note}` : ""}` : c.usage?.lastRun ? `Last search ${new Date(c.usage.lastRun).toLocaleDateString("en-IE")}` : ""}</span></div>
          {c.results && c.results.length > 0 && <ul className="ops-local-results">{c.results.map((item) => <li key={item.url}><a href={item.url} target="_blank" rel="noreferrer"><b>{item.platform}</b> {item.title}</a></li>)}</ul>}
        </section>
      </div>; })()}
    </>}
  </section>;
}
