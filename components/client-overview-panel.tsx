"use client";

import { useEffect, useMemo, useState } from "react";
import { useSampleData } from "@/hooks/use-sample-data";

// Agency Dashboard (admins only): pick a client and see their pipeline and earnings for the dashboard period.
type Entry = { kind: "Income" | "Expense"; date: string; amount: number; category?: string };
export type OverviewClient = { id: string; name: string; company?: string; logo?: string; branding?: { logo?: string }; currency?: string; status?: string; taxBooks?: { entries?: Entry[] } };
type Group = { currency: string; count: number; value: number };
type Summary = { open: Group[]; won: Group[]; stages?: Array<{ name: string; category: string; count: number; value: number }>; sources?: Array<{ source: string; count: number; won: number; wonValue: number }> };

const KEY = "f2b-dash-client-view";
const sum = (list: Group[] = []) => list.reduce((t, g) => ({ count: t.count + g.count, value: t.value + g.value }), { count: 0, value: 0 });

function sampleSummary(seed: string): { summary: Summary; income: number; expenses: number } {
  const n = [...seed].reduce((a, c) => a + c.charCodeAt(0), 0);
  const r = (k: number, lo: number, hi: number) => lo + ((n * (k + 7)) % (hi - lo));
  const stages = [["New lead", "open", r(1, 4, 14), 0], ["Contacted", "open", r(2, 2, 9), 0], ["Quote sent", "open", r(3, 2, 7), 0], ["Won", "won", r(4, 2, 8), 0], ["Lost", "lost", r(5, 1, 5), 0]].map(([name, category, count]) => ({ name: String(name), category: String(category), count: Number(count), value: Number(count) * r(6, 180, 900) }));
  const open = stages.filter((s) => s.category === "open"); const won = stages.filter((s) => s.category === "won");
  const leads = stages.reduce((t, s) => t + s.count, 0);
  const income = r(7, 4200, 16800), expenses = Math.round(income * (0.35 + (n % 20) / 100));
  return { summary: { open: [{ currency: "EUR", count: open.reduce((t, s) => t + s.count, 0), value: open.reduce((t, s) => t + s.value, 0) }], won: [{ currency: "EUR", count: won.reduce((t, s) => t + s.count, 0), value: won.reduce((t, s) => t + s.value, 0) }], stages, sources: [{ source: "all", count: leads, won: won[0].count, wonValue: won[0].value }] }, income, expenses };
}

export function ClientOverviewPanel({ clients, periodStart, periodEnd, periodLabel, onOpenClient }: { clients: OverviewClient[]; periodStart: string; periodEnd: string; periodLabel: string; onOpenClient?: (id: string) => void }) {
  const [sample] = useSampleData();
  const list = useMemo(() => clients.filter((c) => !/^(inactive|archived)$/i.test(c.status || "")), [clients]);
  const [pick, setPick] = useState(() => { try { return localStorage.getItem(KEY) || ""; } catch { return ""; } });
  const client = list.find((c) => c.id === pick) || list[0];
  const [summary, setSummary] = useState<Summary | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => { try { if (client) localStorage.setItem(KEY, client.id); } catch { /* storage off */ } }, [client]);
  useEffect(() => {
    if (!client || sample) return;
    let off = false; setErr(false);
    fetch(`/api/crm?summary=1&clientId=${encodeURIComponent(client.id)}&from=${encodeURIComponent(periodStart)}&to=${encodeURIComponent(periodEnd)}`)
      .then((r) => { if (!r.ok) throw new Error("load"); return r.json() as Promise<Summary>; })
      .then((s) => { if (!off) setSummary(s); }).catch(() => { if (!off) setErr(true); });
    return () => { off = true; };
  }, [client, sample, periodStart, periodEnd]);
  if (!client) return null;
  const currency = client.currency || "EUR";
  const money = (v: number) => { try { return new Intl.NumberFormat("en-IE", { style: "currency", currency, maximumFractionDigits: 0 }).format(v || 0); } catch { return `€${Math.round(v || 0)}`; } };
  const inRange = (d: string) => (!periodStart || d >= periodStart) && (!periodEnd || d <= periodEnd);
  const demo = sample ? sampleSummary(client.id + client.name) : null;
  const shown = demo ? demo.summary : summary;
  const entries = (client.taxBooks?.entries || []).filter((e) => inRange(e.date));
  const income = demo ? demo.income : entries.filter((e) => e.kind === "Income").reduce((t, e) => t + (Number(e.amount) || 0), 0);
  const expenses = demo ? demo.expenses : entries.filter((e) => e.kind === "Expense").reduce((t, e) => t + (Number(e.amount) || 0), 0);
  const profit = income - expenses;
  const open = sum(shown?.open), won = sum(shown?.won);
  const leads = (shown?.sources || []).reduce((t, s) => t + (Number(s.count) || 0), 0);
  const close = leads ? Math.round(won.count / leads * 100) : null;
  const logo = client.branding?.logo || client.logo || "";
  return <section className="panel cov-panel" aria-label="Client view">
    <div className="overview-pipeline-heading">
      <div><p className="eyebrow">👁 CLIENT VIEW <span className="admin-badge" title="Only agency admins see this">ADMIN</span></p><h2>{client.company || client.name}</h2><p>Their pipeline and earnings · {periodLabel.toLowerCase()}. Only agency admins see this.</p></div>
      <div className="cov-pick">
        {logo ? <img src={logo} alt="" className="cov-logo" /> : null}
        <select aria-label="Client" value={client.id} onChange={(e) => { setSummary(null); setPick(e.target.value); }}>{list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        {onOpenClient && <button type="button" className="text-button" onClick={() => onOpenClient(client.id)}>Open account ↗</button>}
      </div>
    </div>
    {sample && <p className="cov-note">Sample data for demos.</p>}
    <div className="cov-grid">
      <div><small>Open pipeline</small><strong>{shown ? money(open.value) : "…"}</strong><span>{shown ? `${open.count} open deal${open.count === 1 ? "" : "s"}` : err ? "Couldn't load" : "Loading"}</span></div>
      <div><small>Won</small><strong>{shown ? money(won.value) : "…"}</strong><span>{shown ? `${won.count} won${close !== null ? ` · ${close}% close rate` : ""}` : ""}</span></div>
      <div><small>Income</small><strong>{money(income)}</strong><span>From their Books</span></div>
      <div><small>Expenses</small><strong>{money(expenses)}</strong><span>Incl. ad spend & fees</span></div>
      <div className={profit >= 0 ? "good" : "bad"}><small>Profit</small><strong>{money(profit)}</strong><span>{income ? `${Math.round(profit / income * 100)}% margin` : "No income recorded"}</span></div>
    </div>
    {shown?.stages && shown.stages.some((s) => s.count > 0) && <div className="dh-chevrons" aria-label="Their leads by stage">{shown.stages.filter((s) => s.count > 0 || s.category === "open").slice(0, 8).map((s, i) => <span key={`${s.name}-${i}`} className={`dh-chevron ${s.category}`} title={`${s.name}: ${s.count} · ${money(s.value)}`}><b>{s.count}</b><span>{s.name}</span><small>{money(s.value)}</small></span>)}</div>}
  </section>;
}
