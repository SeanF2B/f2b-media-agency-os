"use client";

import { useMemo, useState } from "react";
import { AuditComparison } from "@/components/audit-comparison";
import { buildMarketingAudit, type MarketingAuditRun, type MarketingService } from "@/lib/marketing-audit";

export function MarketingAuditPanel({ clientId, clientName, service, period, status, data, history, canRunAudit, onSave, onCreateTask }: { clientId: string; clientName: string; service: MarketingService; period: string; status: MarketingAuditRun["status"]; data: unknown; history: MarketingAuditRun[]; canRunAudit: boolean; onSave: (run: MarketingAuditRun) => Promise<boolean>; onCreateTask: (title: string, notes: string) => void }) {
  const [run, setRun] = useState<MarketingAuditRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const latest = useMemo(() => history.filter((item) => item.clientId === clientId && item.service === service).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0], [history, clientId, service]);
  const activeRun = run || latest;
  const previousRun = activeRun?.previousRunId ? history.find((item) => item.id === activeRun.previousRunId) : undefined;
  async function startAudit() {
    setBusy(true); setMessage("");
    try {
      const result = buildMarketingAudit({ id: crypto.randomUUID(), clientId, clientName, service, createdAt: new Date().toISOString(), period, status, data, previous: latest });
      if (!(await onSave(result))) throw new Error("Could not save this audit to the client history.");
      setRun(result); setMessage("Audit saved to this client’s history.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not run this audit."); }
    finally { setBusy(false); }
  }
  return <section className="marketing-audit-panel"><div className="marketing-audit-heading"><div><span className="eyebrow">EVIDENCE CHECK</span><h2>{service} audit</h2><p>Uses {clientName} results for <b>{period}</b>. Set the audit period in the selector above. It does not change the ad account or website.</p></div><button type="button" className="secondary-button" disabled={!canRunAudit || busy || status === "unavailable"} onClick={() => void startAudit()}>{busy ? "Checking…" : "Run audit"}</button></div>{!canRunAudit && <small>Only an administrator can save audits to the client history.</small>}
    {activeRun && <article className="marketing-audit-result"><div className="marketing-audit-result-meta"><b>{activeRun.summary}</b><small>{activeRun.period} · {new Date(activeRun.createdAt).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}</small></div><AuditComparison current={activeRun} previous={previousRun} />{activeRun.findings.length ? activeRun.findings.map((finding) => <div className="marketing-audit-finding" key={finding.id}><span className={`marketing-audit-priority ${finding.priority}`}>{finding.priority === "medium" ? "Review" : "Note"}</span><h3>{finding.title}</h3><p><b>Evidence:</b> {finding.evidence}</p><p><b>Next step:</b> {finding.recommendation}</p><button type="button" className="secondary-button" onClick={() => onCreateTask(`Review ${service}: ${finding.title}`, `Client: ${clientName}\nSource: ${service}\nPeriod: ${activeRun.period}\nAudit evidence: ${finding.evidence}\nSuggested next step: ${finding.recommendation}\n\nThis is a review task. Do not make or claim a change without approval and verification.`)}>＋ Create task</button></div>) : <p className="marketing-audit-empty">{activeRun.status === "connected" ? "No evidence-based findings in this run." : activeRun.summary}</p>}</article>}
    {message && <small className="marketing-audit-message" role="status">{message}</small>}
    {history.filter((item) => item.clientId === clientId && item.service === service).length > 0 && <details className="marketing-audit-history"><summary>Audit history · {history.filter((item) => item.clientId === clientId && item.service === service).length}</summary>{history.filter((item) => item.clientId === clientId && item.service === service).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5).map((item) => <button type="button" key={item.id} onClick={() => { setRun(item); setMessage(""); }}><b>{item.summary}</b><small>{new Date(item.createdAt).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })} · {item.period}</small></button>)}</details>}
  </section>;
}
