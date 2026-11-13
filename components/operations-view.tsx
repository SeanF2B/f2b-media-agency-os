"use client";

import { useEffect, useMemo, useState } from "react";

// Operations Centre: one admin-only page that reuses existing features (SEO, Google Ads, Websites,
// Domains & DNS, Reports, Tasks). It reads the workspace already loaded in the app, so the
// Overview adds no database reads; Websites & Domains reads one small site registry table once.

type OpsClient = {
  id: string; name: string; status: string; logo?: string; color?: string;
  services?: Array<{ name: string }>;
  googleAdsAccountId?: string; metaAdsAccountId?: string; googleSearchConsoleAccountId?: string; googleAnalyticsAccountId?: string;
  googleBusinessProfileAccountId?: string; googleBusinessProfileLocationId?: string; wordpressSiteUrl?: string; website?: string;
};
type OpsTask = { id: string; clientId: string; status: string; aiDismissedAt?: string; aiApprovals?: Array<{ status?: string }>; aiRunState?: string };
type SiteRow = { clientId: string; backend: string; previewUrl: string; repo: string; branch: string; updatedAt: string };
export type OperationsTab = "overview" | "websites" | "onboarding";
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

export function OperationsView({ clients, tasks, tab, onTab, onOpenPage, onOpenWebsite, onOpenDns, onStartOnboarding, onboarding }: {
  clients: OpsClient[]; tasks: OpsTask[]; tab: OperationsTab; onTab: (tab: OperationsTab) => void;
  onOpenPage: (page: string, clientId?: string) => void; onOpenWebsite: (client: OpsClient) => void; onOpenDns: () => void;
  onStartOnboarding?: (clientId: string) => void; onboarding?: React.ReactNode;
}) {
  const [sites, setSites] = useState<SiteRow[] | null>(null);
  const [siteError, setSiteError] = useState("");
  const [query, setQuery] = useState("");
  const active = useMemo(() => clients.filter((client) => client.status !== "Inactive" && client.status !== "Archived" && !/^agency$/i.test(client.name.trim())), [clients]);
  useEffect(() => {
    if (tab !== "websites" || sites) return;
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

  return <section className="ops-centre">
    <div className="page-heading"><div><p className="eyebrow">Agency</p><h1>Operations</h1><p className="muted">Client services, connections and websites in one place. Everything opens the existing tools.</p></div></div>
    <div className="ops-tabs" role="tablist" aria-label="Operations sections">
      {([["overview", "Overview"], ["onboarding", "Onboarding"], ["websites", "Websites & Domains"]] as Array<[OperationsTab, string]>).filter(([key]) => key !== "onboarding" || onboarding).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => onTab(key)}>{label}</button>)}
    </div>

    {tab === "overview" && <>
      <div className="ops-summary">
        <div><b>{active.length}</b><span>Active clients</span></div>
        <button type="button" onClick={() => onOpenPage("Tasks")}><b>{rows.reduce((sum, row) => sum + row.openTasks, 0)}</b><span>Open tasks</span></button>
        <button type="button" onClick={() => onOpenPage("Tasks")}><b>{totalApprovals}</b><span>Waiting for review</span></button>
        <div className={issues ? "warn" : ""}><b>{issues}</b><span>Missing connections</span></div>
      </div>
      <div className="ops-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search clients…" aria-label="Search clients" /></div>
      <div className="ops-table-wrap"><table className="ops-table">
        <thead><tr><th>Client</th><th>Services</th><th>Connections</th><th>Tasks</th><th></th></tr></thead>
        <tbody>{rows.map(({ client, openTasks, approvals, checks, missing }) => <tr key={client.id}>
          <td><span className="ops-client">{client.logo ? <img src={client.logo} alt="" /> : <i style={{ background: client.color || "#d9dee3" }} />}<b>{client.name}</b></span></td>
          <td>{(client.services || []).length ? [...new Set((client.services || []).map((service) => serviceName(service.name)))].join(", ") : <span className="muted">No services</span>}</td>
          <td>{checks.length ? <span className="ops-checks">{checks.map((check) => <button key={check.label} type="button" className={check.ok ? "ok" : "missing"} title={check.ok ? `${check.label} connected` : `${check.label} not connected — open to connect`} onClick={() => check.page && onOpenPage(check.page, client.id)}>{check.ok ? "✓" : "!"} {check.label}</button>)}</span> : <span className="muted">—</span>}</td>
          <td><button type="button" className="text-button" onClick={() => onOpenPage("Tasks")}>{openTasks} open{approvals ? ` · ${approvals} to review` : ""}</button></td>
          <td className="ops-actions">{onStartOnboarding && <button type="button" className="secondary-button" onClick={() => onStartOnboarding(client.id)}>{missing.length || !(client.services || []).length ? "Onboard" : "Setup"}</button>}<select aria-label={`Open a tool for ${client.name}`} value="" onChange={(event) => { const value = event.target.value; if (value === "website") onOpenWebsite(client); else if (value) onOpenPage(value, client.id); }}><option value="">Open…</option><option value="website">Website builder</option><option value="SEO">SEO</option><option value="Google Ads">Google Ads</option><option value="Meta Ads">Meta Ads</option><option value="Report Studio">Reports</option><option value="Clients">Client profile</option></select></td>
        </tr>)}</tbody>
      </table>{!rows.length && <p className="ops-empty">No clients match.</p>}</div>
    </>}

    {tab === "websites" && <>
      <div className="ops-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search clients…" aria-label="Search clients" /><button type="button" className="secondary-button" onClick={onOpenDns}>Domains & DNS</button></div>
      {siteError && <p className="ops-empty" role="alert">{siteError}</p>}
      <div className="ops-table-wrap"><table className="ops-table">
        <thead><tr><th>Client</th><th>Website</th><th>Source</th><th>Last edited</th><th></th></tr></thead>
        <tbody>{rows.map(({ client }) => { const site = siteFor(client.id); const domain = hostOf(client.wordpressSiteUrl || client.website); return <tr key={client.id}>
          <td><span className="ops-client">{client.logo ? <img src={client.logo} alt="" /> : <i style={{ background: client.color || "#d9dee3" }} />}<b>{client.name}</b></span></td>
          <td>{domain ? <a href={`https://${domain}`} target="_blank" rel="noreferrer">{domain}</a> : <span className="muted">No domain</span>}{site?.previewUrl && <small><a href={site.previewUrl} target="_blank" rel="noreferrer">Preview</a></small>}</td>
          <td>{sites === null ? <span className="muted">Loading…</span> : site ? (site.backend === "github" ? <span title={`${site.repo}${site.branch ? ` · ${site.branch}` : ""}`}>Astro · GitHub</span> : "Agency OS") : client.wordpressSiteUrl ? "WordPress" : <span className="muted">Not set up</span>}</td>
          <td>{site?.updatedAt ? new Date(site.updatedAt).toLocaleDateString("en-IE", { day: "numeric", month: "short" }) : "—"}</td>
          <td className="ops-actions"><button type="button" className="secondary-button" onClick={() => onOpenWebsite(client)}>Open website</button><button type="button" className="text-button" onClick={() => onOpenPage("Sites", client.id)}>Site settings</button></td>
        </tr>; })}</tbody>
      </table></div>
    </>}

    {tab === "onboarding" && onboarding}
  </section>;
}
