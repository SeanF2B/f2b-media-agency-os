"use client";

import { useState } from "react";
import { AuditComparison } from "@/components/audit-comparison";
import { buildFullMarketingAudit, type MarketingAuditRun, type MarketingService } from "@/lib/marketing-audit";

type Client = { id: string; name: string };
type Source = { service: MarketingService; status: MarketingAuditRun["status"]; message?: string; data?: unknown };
type AuditResponse = Record<string, unknown>;
function responseText(data: AuditResponse, key: string) { const value = data[key]; return typeof value === "string" ? value : ""; }

async function loadSource(service: MarketingService, path: string): Promise<Source> {
  try {
    const response = await fetch(path, { cache: "no-store" });
    const data = await response.json() as AuditResponse;
    if (!response.ok) return { service, status: "unavailable", message: responseText(data, "message") || responseText(data, "error") || `Could not load ${service} data.` };
    const status = data.status === "connected" ? "connected" : data.status === "no_data" ? "no_data" : "unavailable";
    return { service, status, message: responseText(data, "message") || undefined, data };
  } catch { return { service, status: "unavailable", message: `${service} data could not be reached.` }; }
}

export function FullMarketingAudit({ client, history, canRunAudit, onSave, onCreateTask }: { client: Client; history: MarketingAuditRun[]; canRunAudit: boolean; onSave: (run: MarketingAuditRun) => Promise<boolean>; onCreateTask: (clientId: string, service: MarketingService, title: string, notes: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const auditHistory = history.filter((run) => run.clientId === client.id && run.service === "Full Marketing").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = auditHistory[0];
  const previousRun = latest?.previousRunId ? auditHistory.find((run) => run.id === latest.previousRunId) : undefined;

  async function runAudit() {
    setBusy(true); setMessage("");
    try {
      const query = `clientId=${encodeURIComponent(client.id)}&range=last_30d`;
      const [googleAds, metaAds, search, analytics, businessProfile] = await Promise.all([
        loadSource("Google Ads", `/api/google-ads/workspace?${query}`),
        loadSource("Meta Ads", `/api/meta-ads/workspace?${query}`),
        loadSource("SEO", `/api/seo?${query}`),
        fetch(`/api/analytics?${query}`, { cache: "no-store" }).then(async (response): Promise<AuditResponse> => response.ok ? await response.json() as AuditResponse : { status: "unavailable", message: "GA4 data could not be loaded." }).catch(() => ({ status: "unavailable", message: "GA4 data could not be reached." })),
        loadSource("Google Business Profile", `/api/local-seo?${query}`),
      ]);
      const seoSource: Source = { ...search, data: { search: search.data } };
      const analyticsStatus = analytics.status === "connected" ? "connected" : analytics.status === "no_data" ? "no_data" : "unavailable";
      const analyticsSource: Source = { service: "Google Analytics", status: analyticsStatus, message: responseText(analytics, "message") || undefined, data: analytics };
      const previous = history.filter((run) => run.clientId === client.id && run.service === "Full Marketing").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      const run = buildFullMarketingAudit({ id: crypto.randomUUID(), clientId: client.id, clientName: client.name, createdAt: new Date().toISOString(), period: "Last 30 days", previous, sources: [googleAds, metaAds, seoSource, analyticsSource, businessProfile] });
      if (!(await onSave(run))) throw new Error("The audit ran but could not be saved to this client’s history.");
      setMessage("Full marketing audit saved to this client’s history.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not run the full marketing audit."); }
    finally { setBusy(false); }
  }

  return <section className="full-marketing-audit">
    <div className="full-marketing-audit-head"><div><span className="eyebrow">CONNECTED SERVICES · LAST 30 DAYS</span><h3>Full marketing audit</h3><p>Checks mapped Google Ads, Meta Ads, Search Console and GA4 data. It never changes a live account or website.</p></div><button className="secondary-button" type="button" disabled={!canRunAudit || busy} onClick={() => void runAudit()}>{busy ? "Checking connected services…" : "🔎 Run Full Marketing Audit"}</button></div>
    {!canRunAudit && <small>Only an administrator can run and save a full audit.</small>}
    {message && <p className="marketing-audit-message" role="status">{message}</p>}
    {latest && <article className="full-marketing-audit-result"><div className="marketing-audit-result-meta"><b>{latest.summary}</b><small>{new Date(latest.createdAt).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })} · {latest.period}</small></div>{latest.sources?.length ? <ul className="full-marketing-audit-sources">{latest.sources.map((source) => <li key={source.service}><b>{source.service}</b><span>{source.status === "connected" ? "Included" : source.status === "no_data" ? "Connected · no rows" : "Unavailable"}</span>{source.message && source.status !== "connected" && <small>{source.message}</small>}</li>)}</ul> : null}{latest.findings.map((finding) => { const service = latest.sources?.find((source) => finding.id.startsWith(`${source.service.toLowerCase().replaceAll(" ", "-")}.`))?.service || "SEO"; return <div className="marketing-audit-finding" key={finding.id}><span className={`marketing-audit-priority ${finding.priority}`}>{finding.priority === "medium" ? "Review" : "Note"}</span><h3>{finding.title}</h3><p><b>Evidence:</b> {finding.evidence}</p><p><b>Next step:</b> {finding.recommendation}</p><button className="secondary-button" type="button" onClick={() => onCreateTask(client.id, service, `Review ${service}: ${finding.title.replace(`${service}: `, "")}`, `Client: ${client.name}\nSource: ${service}\nPeriod: ${latest.period}\nAudit evidence: ${finding.evidence}\nSuggested next step: ${finding.recommendation}\n\nThis is a review task. Do not make or claim a change without approval and verification.`)}>＋ Create task</button></div>; })}{latest.status !== "connected" && <p className="marketing-audit-empty">{latest.summary}</p>}<AuditComparison current={latest} previous={previousRun} /></article>}
  </section>;
}
