"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

// Settings → AI billing (agency admins): markup slider, per-client overrides, usage report with real cost vs
// billable amount, request log and audit log. UsageClientPanel: a sub-account's own usage at the billed price only.

type Settings = { enabled: boolean; markupPct: number; usdRate: number; includeSeoData: boolean; minCharge: number; updatedAt: string; updatedBy: string };
type ClientRow = { clientId: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number; aiUsd: number; seoUsd: number; markupPct: number; billable: number; invoicedUsd: number };
type Agency = { view: "agency"; period: { start: string; end: string }; settings: Settings; overrides: Array<{ clientId: string; markupPct: number | null; enabled: boolean }>; clients: ClientRow[]; features: Array<{ feature: string; kind: string; calls: number; costUsd: number }>; days: Array<{ day: string; calls: number; costUsd: number }>; log: Array<{ id: string; clientId: string; kind: string; provider: string; feature: string; model: string; inputTokens: number; outputTokens: number; costUsd: number; costSource: string; actor: string; at: string; invoiceId: string }>; audit: Array<{ clientId: string; action: string; detail: Record<string, any>; actor: string; at: string }>; unattributed: { calls: number; costUsd: number }; lastMonth: string };
type ClientView = { view: "client"; period: { start: string; end: string }; enabled: boolean; total: number; calls: number; features: Array<{ feature: string; calls: number; amount: number }>; days: Array<{ day: string; calls: number; amount: number }> };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const PERIODS: Array<[string, string, () => { start: string; end: string }]> = [
  ["this", "This month", () => { const n = new Date(); return { start: iso(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1))), end: iso(n) }; }],
  ["last", "Last month", () => { const n = new Date(); return { start: iso(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, 1))), end: iso(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 0))) }; }],
  ["90", "Last 90 days", () => { const n = new Date(); return { start: iso(new Date(n.getTime() - 89 * 86_400_000)), end: iso(n) }; }],
];
const usd = (v: number) => `$${v < 1 && v > 0 ? v.toFixed(4) : v.toFixed(2)}`;
const n0 = (v: number) => new Intl.NumberFormat("en-IE").format(v);
const when = (s: string) => new Date(s).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const ACTIONS: Record<string, string> = { "settings-changed": "Billing settings changed", "client-changed": "Client billing changed", "invoice-line-drafted": "Usage added to draft invoice", "manual-billing-run": "Billing run started manually" };

export function UsageBillingPanel({ clients, currency = "EUR", scopeClientId = "" }: { clients: Array<{ id: string; name: string; logo?: string }>; currency?: string; scopeClientId?: string }) {
  const [period, setPeriod] = useState("this");
  const [clientId, setClientId] = useState(scopeClientId);
  const [data, setData] = useState<Agency | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"clients" | "features" | "log" | "audit">("clients");
  const [draft, setDraft] = useState<Settings | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const money = useMemo(() => new Intl.NumberFormat("en-IE", { style: "currency", currency }), [currency]);
  const nameOf = useCallback((id: string) => id ? clients.find((c) => c.id === id)?.name || "Removed client" : "Agency / unassigned", [clients]);

  const load = useCallback(async () => {
    setErr("");
    const range = PERIODS.find((p) => p[0] === period)![2]();
    try {
      const r = await fetch(`/api/usage-billing?${new URLSearchParams({ ...range, ...(clientId ? { clientId } : {}) })}`, { cache: "no-store" });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "Couldn’t load usage.");
      setData(j as Agency); setDraft((d) => d || (j as Agency).settings);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn’t load usage."); }
  }, [period, clientId]);
  useEffect(() => { void load(); }, [load]);

  const post = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true); setMsg("");
    try { const r = await fetch("/api/usage-billing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || "Couldn’t save."); setMsg(typeof j.drafted === "number" ? `${j.drafted} draft invoice line${j.drafted === 1 ? "" : "s"} created.${j.skipped ? ` ${j.skipped}` : ""}` : ok); await load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Couldn’t save."); } finally { setBusy(false); }
  };

  const s = draft;
  const totals = useMemo(() => (data?.clients || []).reduce((t, c) => ({ cost: t.cost + c.costUsd, bill: t.bill + c.billable, calls: t.calls + c.calls }), { cost: 0, bill: 0, calls: 0 }), [data]);
  const example = s ? 10 * s.usdRate * (1 + s.markupPct / 100) : 0;
  const override = (id: string) => data?.overrides.find((o) => o.clientId === id);

  return <section className="panel ubp">
    <style>{CSS}</style>
    <div className="ubp-head"><div><p className="eyebrow">AI &amp; SEO DATA REBILLING</p><h2>AI billing</h2><p className="ubp-sub">Every AI request and paid SEO data call (keyword research, rank checks, backlinks, map ranks) is logged against the client it was for, at real cost. Each month the marked-up total goes onto that client’s draft invoice for you to review and send.</p></div></div>

    {s && <div className="ubp-settings">
      <div className="ubp-slider">
        <label htmlFor="ubp-markup">Markup <b>{s.markupPct}%</b></label>
        <input id="ubp-markup" type="range" min={0} max={500} step={5} value={s.markupPct} onChange={(e) => setDraft({ ...s, markupPct: Number(e.target.value) })} />
        <small>Example: $10.00 of AI cost bills as <b>{money.format(example)}</b> (at {s.usdRate} {currency} per $).</small>
      </div>
      <div className="ubp-fields">
        <label className="ubp-switch"><input type="checkbox" checked={s.enabled} onChange={(e) => setDraft({ ...s, enabled: e.target.checked })} /> Rebilling on</label>
        <label className="ubp-switch"><input type="checkbox" checked={s.includeSeoData} onChange={(e) => setDraft({ ...s, includeSeoData: e.target.checked })} /> Include SEO data (DataForSEO)</label>
        <label>$ → {currency} rate<input type="number" step="0.01" min={0.1} max={10} value={s.usdRate} onChange={(e) => setDraft({ ...s, usdRate: Number(e.target.value) })} /></label>
        <label>Minimum to invoice ({currency})<input type="number" step="1" min={0} value={s.minCharge} onChange={(e) => setDraft({ ...s, minCharge: Number(e.target.value) })} /></label>
      </div>
      <div className="ubp-actions">
        <button type="button" className="primary-button" disabled={busy} onClick={() => post({ action: "settings", ...s }, "Billing settings saved.")}>Save settings</button>
        {data && <button type="button" className="secondary-button" disabled={busy} onClick={() => post({ action: "draft-invoices", month: data.lastMonth }, "")}>Bill {new Date(`${data.lastMonth}-15`).toLocaleDateString("en-IE", { month: "long" })} now</button>}
        {msg && <small>{msg}</small>}
        {data?.settings.updatedAt && <small className="ubp-muted">Last changed {when(data.settings.updatedAt)} by {data.settings.updatedBy}</small>}
      </div>
    </div>}

    <div className="ubp-bar">
      <div className="ubp-seg">{PERIODS.map(([k, l]) => <button key={k} type="button" className={period === k ? "on" : ""} onClick={() => setPeriod(k)}>{l}</button>)}</div>
      {!scopeClientId && <select value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Client"><option value="">All clients</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
    </div>
    {err && <p className="ubp-muted">{err}</p>}
    {!data && !err && <p className="ubp-muted">Loading usage…</p>}
    {data && <>
      <div className="ubp-kpis">
        <div><small>Requests</small><b>{n0(totals.calls)}</b></div>
        <div><small>Your cost</small><b>{usd(totals.cost)}</b></div>
        <div className="good"><small>To bill clients</small><b>{money.format(totals.bill)}</b></div>
        <div><small>Margin</small><b>{money.format(totals.bill - totals.cost * (data.settings.usdRate || 0.92))}</b></div>
        {data.unattributed.calls > 0 && !clientId && <div title="AI used from agency screens with no client picked, or background jobs. Not billed."><small>Agency / unassigned</small><b>{usd(data.unattributed.costUsd)}</b></div>}
      </div>
      <div className="ubp-tabs" role="tablist">{([["clients", "By client"], ["features", "By feature"], ["log", "Request log"], ["audit", "Audit log"]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>

      {tab === "clients" && <div className="ubp-table-wrap"><table className="ubp-table"><thead><tr><th>Client</th><th>Requests</th><th>AI cost</th><th>SEO data</th><th>Markup</th><th>To bill</th><th>Invoiced</th><th>Rebill</th></tr></thead><tbody>
        {data.clients.filter((c) => c.clientId).map((c) => { const o = override(c.clientId); return <tr key={c.clientId}>
          <td><b>{nameOf(c.clientId)}</b><small>{n0(c.inputTokens + c.outputTokens)} tokens</small></td><td>{n0(c.calls)}</td><td>{usd(c.aiUsd)}</td><td>{usd(c.seoUsd)}</td>
          <td><input className="ubp-mk" type="number" min={0} max={1000} step={5} placeholder={`${data.settings.markupPct}`} defaultValue={o?.markupPct ?? ""} title="Leave empty to use the agency markup" onBlur={(e) => { const v = e.target.value.trim(); const cur = o?.markupPct ?? null; if ((v === "" ? null : Number(v)) !== cur) void post({ action: "client", clientId: c.clientId, markupPct: v === "" ? null : Number(v) }, "Client markup saved."); }} />%</td>
          <td className="good">{money.format(c.billable)}</td><td>{c.invoicedUsd ? usd(c.invoicedUsd) : "—"}</td>
          <td><input type="checkbox" checked={o?.enabled !== false} onChange={(e) => void post({ action: "client", clientId: c.clientId, enabled: e.target.checked }, "Saved.")} aria-label="Rebill this client" /></td>
        </tr>; })}
        {!data.clients.some((c) => c.clientId) && <tr><td colSpan={8} className="ubp-muted">No client AI usage in this period yet. Usage starts logging from today.</td></tr>}
      </tbody></table></div>}

      {tab === "features" && <div className="ubp-table-wrap"><table className="ubp-table"><thead><tr><th>Feature</th><th>Type</th><th>Requests</th><th>Cost</th></tr></thead><tbody>
        {data.features.map((f, i) => <tr key={i}><td>{f.feature}</td><td>{f.kind === "ai" ? "AI" : "SEO data"}</td><td>{n0(f.calls)}</td><td>{usd(f.costUsd)}</td></tr>)}
        {!data.features.length && <tr><td colSpan={4} className="ubp-muted">Nothing yet.</td></tr>}
      </tbody></table></div>}

      {tab === "log" && <div className="ubp-table-wrap"><table className="ubp-table"><thead><tr><th>When</th><th>Client</th><th>Feature</th><th>Model / API</th><th>Tokens in/out</th><th>Cost</th><th>By</th></tr></thead><tbody>
        {data.log.map((r) => <tr key={r.id}><td>{when(r.at)}</td><td>{nameOf(r.clientId)}</td><td>{r.feature}</td><td><small>{r.model || r.provider}</small></td><td>{r.kind === "ai" ? `${n0(r.inputTokens)} / ${n0(r.outputTokens)}` : "—"}</td><td title={r.costSource === "provider" ? "Cost reported by the provider" : r.costSource === "price-list" ? "Worked out from the model’s published price" : "Cost not reported"}>{usd(r.costUsd)}{r.invoiceId ? " ✓" : ""}</td><td><small>{r.actor}</small></td></tr>)}
        {!data.log.length && <tr><td colSpan={7} className="ubp-muted">No requests logged in this period.</td></tr>}
      </tbody></table><small className="ubp-muted">Latest 200 requests. ✓ = already on an invoice.</small></div>}

      {tab === "audit" && <div className="ubp-table-wrap"><table className="ubp-table"><thead><tr><th>When</th><th>What</th><th>Client</th><th>Details</th><th>By</th></tr></thead><tbody>
        {data.audit.map((a, i) => <tr key={i}><td>{when(a.at)}</td><td>{ACTIONS[a.action] || a.action}</td><td>{a.clientId ? nameOf(a.clientId) : "—"}</td><td><small>{a.action === "invoice-line-drafted" ? `${money.format(a.detail.amount || 0)} for ${a.detail.month} (${a.detail.calls} requests, cost ${usd(a.detail.costUsd || 0)}, ${a.detail.markupPct}% markup)` : a.action === "settings-changed" ? Object.keys(a.detail.after || {}).filter((k) => a.detail.before?.[k] !== a.detail.after?.[k]).map((k) => `${k}: ${a.detail.before?.[k]} → ${a.detail.after?.[k]}`).join(" · ") || "No change" : a.action === "client-changed" ? `markup ${a.detail.before?.markupPct ?? "agency"} → ${a.detail.after?.markupPct ?? "agency"}, rebill ${a.detail.after?.enabled ? "on" : "off"}` : JSON.stringify(a.detail)}</small></td><td><small>{a.actor}</small></td></tr>)}
        {!data.audit.length && <tr><td colSpan={5} className="ubp-muted">No billing changes yet.</td></tr>}
      </tbody></table></div>}
    </>}
  </section>;
}

/** A sub-account's own AI usage at the price it will be billed (no cost or markup shown). */
export function UsageClientPanel({ clientId, currency = "EUR" }: { clientId: string; currency?: string }) {
  const [data, setData] = useState<ClientView | null>(null);
  const [hidden, setHidden] = useState(false);
  const money = useMemo(() => new Intl.NumberFormat("en-IE", { style: "currency", currency }), [currency]);
  useEffect(() => {
    let live = true; const n = new Date();
    fetch(`/api/usage-billing?${new URLSearchParams({ clientId, start: iso(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1))), end: iso(n) })}`, { cache: "no-store" })
      .then(async (r) => { const j = await r.json(); if (!r.ok || j.view !== "client") throw new Error("hidden"); return j as ClientView; })
      .then((j) => { if (live) { if (!j.enabled || !j.calls) setHidden(true); else setData(j); } }).catch(() => { if (live) setHidden(true); });
    return () => { live = false; };
  }, [clientId]);
  if (hidden || !data) return null;
  return <section className="panel ubp ubp-client" aria-label="AI usage">
    <style>{CSS}</style>
    <div className="ubp-head"><div><p className="eyebrow">THIS MONTH</p><h2>AI usage</h2></div><div className="ubp-total"><small>So far this month</small><b>{money.format(data.total)}</b></div></div>
    <div className="ubp-table-wrap"><table className="ubp-table"><thead><tr><th>Feature</th><th>Requests</th><th>Amount</th></tr></thead><tbody>
      {data.features.map((f) => <tr key={f.feature}><td>{f.feature}</td><td>{n0(f.calls)}</td><td>{money.format(f.amount)}</td></tr>)}
    </tbody></table></div>
    <small className="ubp-muted">Billed on your next invoice. {n0(data.calls)} requests this month.</small>
  </section>;
}

const CSS = `
.ubp{display:flex;flex-direction:column;gap:14px;padding:22px 24px !important;margin-top:14px}
@media (max-width:700px){.ubp{padding:16px !important}}
.ubp .ubp-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.ubp .ubp-sub{margin:4px 0 0;font-size:13px;opacity:.7;max-width:760px}
.ubp .ubp-muted{font-size:12.5px;opacity:.65}
.ubp .ubp-settings{display:grid;grid-template-columns:1.2fr 1fr;gap:14px;border:1px solid rgba(127,127,127,.16);border-radius:16px;padding:14px 16px}
.ubp .ubp-slider{display:flex;flex-direction:column;gap:8px}
.ubp .ubp-slider label{font-size:13px;font-weight:700}.ubp .ubp-slider label b{font-size:22px;margin-left:6px;color:var(--brand-primary,#101828)}
.ubp .ubp-slider input[type=range]{width:100%;accent-color:var(--brand-primary,#101828)}
.ubp .ubp-slider small{font-size:12.5px;opacity:.75}
.ubp .ubp-fields{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;align-content:start}
.ubp .ubp-fields label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600}
.ubp .ubp-fields input[type=number]{padding:7px 9px;border-radius:9px;border:1px solid rgba(127,127,127,.28);background:transparent;color:inherit;font:inherit}
.ubp .ubp-switch{flex-direction:row !important;align-items:center;gap:8px !important}
.ubp .ubp-actions{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.ubp .ubp-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.ubp .ubp-bar select{padding:7px 10px;border-radius:10px;border:1px solid rgba(127,127,127,.28);background:transparent;color:inherit;font:inherit}
.ubp .ubp-seg,.ubp .ubp-tabs{display:inline-flex;gap:3px;padding:3px;border-radius:11px;background:color-mix(in srgb,currentColor 6%,transparent)}
.ubp .ubp-seg button,.ubp .ubp-tabs button{border:0;background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:700;padding:6px 12px;border-radius:8px;cursor:pointer}
.ubp .ubp-seg button.on,.ubp .ubp-tabs button.on{background:var(--brand-primary,#101828);color:#fff}
.ubp .ubp-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
.ubp .ubp-kpis>div{border-radius:12px;padding:9px 12px;background:color-mix(in srgb,currentColor 3%,transparent)}
.ubp .ubp-kpis small{display:block;font-size:12px;opacity:.7}.ubp .ubp-kpis b{font-size:20px}
.ubp .good{color:#157a43}.ubp .ubp-kpis>div.good{background:#effaf3}
.ubp .ubp-table-wrap{overflow-x:auto}
.ubp .ubp-table{width:100%;border-collapse:collapse;font-size:13px}
.ubp .ubp-table th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;opacity:.6;padding:6px 8px;border-bottom:1px solid rgba(127,127,127,.18)}
.ubp .ubp-table td{padding:7px 8px;border-bottom:1px solid rgba(127,127,127,.08);vertical-align:top}
.ubp .ubp-table td small{display:block;opacity:.65}
.ubp .ubp-mk{width:64px;padding:4px 6px;border-radius:8px;border:1px solid rgba(127,127,127,.28);background:transparent;color:inherit;font:inherit}
.ubp .ubp-total{text-align:right}.ubp .ubp-total small{display:block;font-size:12px;opacity:.65}.ubp .ubp-total b{font-size:22px}
@media (max-width:900px){.ubp .ubp-settings{grid-template-columns:1fr}.ubp .ubp-fields{grid-template-columns:1fr}}
`;
