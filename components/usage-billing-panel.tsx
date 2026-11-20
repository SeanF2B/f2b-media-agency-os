"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { SERVICES, serviceOf } from "@/lib/usage-services";

// Settings → AI billing (agency admins): markup slider, per-client overrides, usage report with real cost vs
// billable amount, request log and audit log. UsageClientPanel: a sub-account's own usage at the billed price only.

type Settings = { enabled: boolean; markupPct: number; usdRate: number; includeSeoData: boolean; minCharge: number; updatedAt: string; updatedBy: string };
type ClientRow = { clientId: string; calls: number; inputTokens: number; outputTokens: number; costUsd: number; aiUsd: number; seoUsd: number; markupPct: number; billable: number; invoicedUsd: number; byService?: Record<string, number> };
type ServiceRow = (typeof SERVICES)[number] & { enabled: boolean; markupPct: number | null; unitUsd: number | null; calls: number; units: number; costUsd: number; active: boolean };
type Agency = { account?: Account; view: "agency"; services: ServiceRow[]; clientServices: Array<{ clientId: string; services: Record<string, boolean> }>; period: { start: string; end: string }; settings: Settings; overrides: Array<{ clientId: string; markupPct: number | null; enabled: boolean }>; clients: ClientRow[]; features: Array<{ feature: string; kind: string; calls: number; costUsd: number }>; days: Array<{ day: string; calls: number; costUsd: number }>; log: Array<{ id: string; clientId: string; kind: string; provider: string; feature: string; model: string; inputTokens: number; outputTokens: number; costUsd: number; costSource: string; actor: string; at: string; invoiceId: string }>; audit: Array<{ clientId: string; action: string; detail: Record<string, any>; actor: string; at: string }>; unattributed: { calls: number; costUsd: number }; lastMonth: string };
type Account = { currency: string; credit: { balance: number; history: Array<{ id: string; amount: number; kind: string; note: string; invoiceId: string; status: string; actor: string; at: string }> }; cancellations: Array<{ id: string; services: string[]; reason: string; endDate: string; status: string; requestedBy: string; at: string }>; ourServices: string[]; noticeEnd: string };
type ClientView = Account & { services: Array<{ key: string; label: string; unit: string; qty: number; amount: number }>; view: "client"; period: { start: string; end: string }; enabled: boolean; total: number; calls: number; features: Array<{ feature: string; calls: number; amount: number }>; days: Array<{ day: string; calls: number; amount: number }> };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const PERIODS: Array<[string, string, () => { start: string; end: string }]> = [
  ["this", "This month", () => { const n = new Date(); return { start: iso(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1))), end: iso(n) }; }],
  ["last", "Last month", () => { const n = new Date(); return { start: iso(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 1, 1))), end: iso(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 0))) }; }],
  ["90", "Last 90 days", () => { const n = new Date(); return { start: iso(new Date(n.getTime() - 89 * 86_400_000)), end: iso(n) }; }],
];
const usd = (v: number) => `$${v < 1 && v > 0 ? v.toFixed(4) : v.toFixed(2)}`;
const n0 = (v: number) => new Intl.NumberFormat("en-IE").format(v);
const when = (s: string) => new Date(s).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const ACTIONS: Record<string, string> = { "settings-changed": "Billing settings changed", "client-changed": "Client billing changed", "service-changed": "Service billing changed", "client-service-changed": "Client service switched", "invoice-line-drafted": "Usage added to draft invoice", "manual-billing-run": "Billing run started manually" };

export function UsageBillingPanel({ clients, currency = "EUR", scopeClientId = "" }: { clients: Array<{ id: string; name: string; logo?: string }>; currency?: string; scopeClientId?: string }) {
  const [period, setPeriod] = useState("this");
  const [clientId, setClientId] = useState(scopeClientId);
  const [service, setService] = useState("");
  const [open, setOpen] = useState("");
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
      const r = await fetch(`/api/usage-billing?${new URLSearchParams({ ...range, ...(clientId ? { clientId } : {}), ...(service ? { service } : {}) })}`, { cache: "no-store" });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || "Couldn’t load usage.");
      setData(j as Agency); setDraft((d) => d || (j as Agency).settings);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn’t load usage."); }
  }, [period, clientId, service]);
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
  const clientSvcOn = (id: string, key: string) => data?.clientServices.find((c) => c.clientId === id)?.services[key] !== false;
  const rows = useMemo(() => { const used = new Map((data?.clients || []).filter((c) => c.clientId).map((c) => [c.clientId, c])); return [...(data?.clients || []).filter((c) => c.clientId), ...clients.filter((c) => !used.has(c.id) && (!clientId || c.id === clientId)).map((c) => ({ clientId: c.id, calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, aiUsd: 0, seoUsd: 0, markupPct: 0, billable: 0, invoicedUsd: 0, byService: {} } as ClientRow))]; }, [data, clients, clientId]);
  const logoOf = (id: string) => clients.find((c) => c.id === id)?.logo || "";
  const unitFmt = (r: { kind: string; inputTokens: number; outputTokens: number }) => { const d = serviceOf(r.kind); return r.kind === "ai" ? `${n0(r.inputTokens)} / ${n0(r.outputTokens)} tokens` : d?.pricing === "unit" ? `${n0(r.inputTokens)} ${d.unit}${r.inputTokens === 1 ? "" : "s"}` : "—"; };

  return <section className="panel ubp">
    <style>{CSS}</style>
    <div className="ubp-head"><div><p className="eyebrow">USAGE REBILLING <span className="admin-badge">AGENCY</span></p><h2>Usage billing</h2><p className="ubp-sub">Everything that costs money is logged against the client it was for: AI (incl. Grok agents), SEO data, WhatsApp, SMS, phone calls, numbers and emails. Each month the marked-up total goes onto that client’s draft invoice, one line per service, for you to review and send.</p></div></div>

    {s && <div className="ubp-settings">
      <div className="ubp-slider">
        <label htmlFor="ubp-markup">Markup <b>{s.markupPct}%</b></label>
        <input id="ubp-markup" type="range" min={0} max={500} step={5} value={s.markupPct} onChange={(e) => setDraft({ ...s, markupPct: Number(e.target.value) })} />
        <small>Agency markup, used unless a service or client has its own. Example: $10.00 of cost bills as <b>{money.format(example)}</b> (at {s.usdRate} {currency} per $).</small>
      </div>
      <div className="ubp-fields">
        <label className="ubp-switch"><input type="checkbox" checked={s.enabled} onChange={(e) => setDraft({ ...s, enabled: e.target.checked })} /> Rebilling on</label>
        <label>$ → {currency} rate<input type="number" step="0.01" min={0.1} max={10} value={s.usdRate} onChange={(e) => setDraft({ ...s, usdRate: Number(e.target.value) })} /></label>
        <label>Minimum to invoice ({currency})<input type="number" step="1" min={0} value={s.minCharge} onChange={(e) => setDraft({ ...s, minCharge: Number(e.target.value) })} /></label>
      </div>
      <div className="ubp-actions">
        <button type="button" className="primary-button" disabled={busy} onClick={() => { const { includeSeoData: _i, ...rest } = s; void post({ action: "settings", ...rest }, "Billing settings saved."); }}>Save settings</button>
        {data && <button type="button" className="secondary-button" disabled={busy} onClick={() => post({ action: "draft-invoices", month: data.lastMonth }, "")}>Bill {new Date(`${data.lastMonth}-15`).toLocaleDateString("en-IE", { month: "long" })} now</button>}
        {msg && <small>{msg}</small>}
        {data?.settings.updatedAt && <small className="ubp-muted">Last changed {when(data.settings.updatedAt)} by {data.settings.updatedBy}</small>}
      </div>
    </div>}

    {data && <div className="ubp-services">
      <div className="ubp-svc-head"><b>Services</b><small>Switch each paid service on or off for rebilling, set its own markup (empty = agency {data.settings.markupPct}%) and what one unit costs you.</small></div>
      <div className="ubp-table-wrap"><table className="ubp-table"><thead><tr><th>On</th><th>Service</th><th>Markup</th><th>Your cost per unit</th><th>Used</th><th>Your cost</th></tr></thead><tbody>
        {data.services.map((v) => <tr key={v.key} className={v.enabled ? "" : "off"}>
          <td><label className="ubp-toggle"><input type="checkbox" checked={v.enabled} disabled={busy} onChange={(e) => void post({ action: "service", service: v.key, enabled: e.target.checked }, `${v.label} ${e.target.checked ? "on" : "off"}.`)} aria-label={`Rebill ${v.label}`} /><i /></label></td>
          <td><b>{v.label}</b><small title={v.note}>{v.provider} · {v.note}</small></td>
          <td><input key={`mk-${v.key}-${v.markupPct}`} className="ubp-mk" type="number" min={0} max={1000} step={5} placeholder={`${data.settings.markupPct}`} defaultValue={v.markupPct ?? ""} onBlur={(e) => { const x = e.target.value.trim(); if ((x === "" ? null : Number(x)) !== v.markupPct) void post({ action: "service", service: v.key, markupPct: x === "" ? null : Number(x) }, `${v.label} markup saved.`); }} />%</td>
          <td>{v.pricing === "unit" ? <>$<input key={`u-${v.key}-${v.unitUsd}`} className="ubp-mk" type="number" min={0} step="0.0001" placeholder={`${v.defaultUnitUsd}`} defaultValue={v.unitUsd ?? ""} onBlur={(e) => { const x = e.target.value.trim(); if ((x === "" ? null : Number(x)) !== v.unitUsd) void post({ action: "service", service: v.key, unitUsd: x === "" ? null : Number(x) }, `${v.label} unit cost saved.`); }} /> / {v.unit}</> : <small>Real cost from {v.provider.split(" /")[0]}</small>}</td>
          <td>{v.pricing === "unit" ? `${n0(v.units)} ${v.unit}${v.units === 1 ? "" : "s"}` : `${n0(v.calls)} requests`}</td>
          <td>{usd(v.costUsd)}</td>
        </tr>)}
      </tbody></table></div>
    </div>}

    <div className="ubp-bar">
      <div className="ubp-seg">{PERIODS.map(([k, l]) => <button key={k} type="button" className={period === k ? "on" : ""} onClick={() => setPeriod(k)}>{l}</button>)}</div>
      {data && <select value={service} onChange={(e) => setService(e.target.value)} aria-label="Service"><option value="">All active services</option>{data.services.filter((v) => v.enabled).map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}</select>}
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

      {tab === "clients" && <div className="ubp-table-wrap"><table className="ubp-table"><thead><tr><th>Client</th><th>Requests</th><th>Your cost</th><th>Markup</th><th>To bill</th><th>Invoiced</th><th>Rebill</th><th></th></tr></thead><tbody>
        {rows.map((c) => { const o = override(c.clientId); const on = o?.enabled !== false; const isOpen = open === c.clientId; const svcOn = data.services.filter((v) => v.enabled && clientSvcOn(c.clientId, v.key)).length; return <Fragment key={c.clientId}><tr className={on ? "" : "off"}>
          <td><span className="ubp-client">{logoOf(c.clientId) ? <img src={logoOf(c.clientId)} alt="" /> : null}<b>{nameOf(c.clientId)}</b></span><small>{Object.entries(c.byService || {}).filter(([, v]) => Number(v) > 0).map(([k, v]) => `${serviceOf(k)?.label.split(" (")[0] || k} ${usd(Number(v))}`).join(" · ") || "No usage this period"}</small></td><td>{n0(c.calls)}</td><td>{usd(c.costUsd)}</td>
          <td><input className="ubp-mk" type="number" min={0} max={1000} step={5} placeholder="auto" defaultValue={o?.markupPct ?? ""} title="Leave empty to use each service’s markup" onBlur={(e) => { const v = e.target.value.trim(); const cur = o?.markupPct ?? null; if ((v === "" ? null : Number(v)) !== cur) void post({ action: "client", clientId: c.clientId, markupPct: v === "" ? null : Number(v) }, "Client markup saved."); }} />%</td>
          <td className="good">{money.format(c.billable)}</td><td>{c.invoicedUsd ? usd(c.invoicedUsd) : "—"}</td>
          <td><label className="ubp-toggle"><input type="checkbox" checked={on} onChange={(e) => void post({ action: "client", clientId: c.clientId, enabled: e.target.checked }, "Saved.")} aria-label={`Rebill ${nameOf(c.clientId)}`} /><i /></label></td>
          <td><button type="button" className="ubp-link" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? "" : c.clientId)}>{svcOn}/{data.services.filter((v) => v.enabled).length} services {isOpen ? "▴" : "▾"}</button></td>
        </tr>
        {isOpen && <tr className="ubp-svc-row"><td colSpan={8}><div className="ubp-chips">{data.services.filter((v) => v.enabled).map((v) => <label key={v.key} className={`ubp-chip ${clientSvcOn(c.clientId, v.key) ? "on" : ""}`}><input type="checkbox" checked={clientSvcOn(c.clientId, v.key)} disabled={busy} onChange={(e) => void post({ action: "client-service", clientId: c.clientId, service: v.key, enabled: e.target.checked }, `${v.label} ${e.target.checked ? "on" : "off"} for ${nameOf(c.clientId)}.`)} />{v.label.split(" (")[0]}</label>)}</div></td></tr>}
        </Fragment>; })}
        {!rows.length && <tr><td colSpan={8} className="ubp-muted">No clients yet.</td></tr>}
      </tbody></table></div>}

      {tab === "features" && <div className="ubp-table-wrap"><table className="ubp-table"><thead><tr><th>Feature</th><th>Type</th><th>Requests</th><th>Cost</th></tr></thead><tbody>
        {data.features.map((f, i) => <tr key={i}><td>{f.feature}</td><td>{serviceOf(f.kind)?.label.split(" (")[0] || f.kind}</td><td>{n0(f.calls)}</td><td>{usd(f.costUsd)}</td></tr>)}
        {!data.features.length && <tr><td colSpan={4} className="ubp-muted">Nothing yet.</td></tr>}
      </tbody></table></div>}

      {tab === "log" && <div className="ubp-table-wrap"><table className="ubp-table"><thead><tr><th>When</th><th>Client</th><th>Feature</th><th>Service / model</th><th>Used</th><th>Cost</th><th>By</th></tr></thead><tbody>
        {data.log.map((r) => <tr key={r.id}><td>{when(r.at)}</td><td>{nameOf(r.clientId)}</td><td>{r.feature}</td><td><small>{serviceOf(r.kind)?.label.split(" (")[0] || r.kind} · {/^x-ai\//.test(r.model) ? `Grok (${r.model.replace(/^x-ai\//, "")})` : r.model || r.provider}</small></td><td>{unitFmt(r)}</td><td title={r.costSource === "provider" ? "Cost reported by the provider" : r.costSource === "price-list" ? "Worked out from the model’s published price" : r.costSource === "unit-price" ? "Units x your unit cost" : "Cost not reported"}>{usd(r.costUsd)}{r.invoiceId ? " ✓" : ""}</td><td><small>{r.actor}</small></td></tr>)}
        {!data.log.length && <tr><td colSpan={7} className="ubp-muted">No requests logged in this period.</td></tr>}
      </tbody></table><small className="ubp-muted">Latest 200 requests. ✓ = already on an invoice.</small></div>}

      {tab === "audit" && <div className="ubp-table-wrap"><table className="ubp-table"><thead><tr><th>When</th><th>What</th><th>Client</th><th>Details</th><th>By</th></tr></thead><tbody>
        {data.audit.map((a, i) => <tr key={i}><td>{when(a.at)}</td><td>{ACTIONS[a.action] || a.action}</td><td>{a.clientId ? nameOf(a.clientId) : "—"}</td><td><small>{a.action === "invoice-line-drafted" ? `${money.format(a.detail.amount || 0)} for ${a.detail.month} (${a.detail.calls} requests, cost ${usd(a.detail.costUsd || 0)}, ${a.detail.markupPct}% markup)` : a.action === "settings-changed" ? Object.keys(a.detail.after || {}).filter((k) => a.detail.before?.[k] !== a.detail.after?.[k]).map((k) => `${k}: ${a.detail.before?.[k]} → ${a.detail.after?.[k]}`).join(" · ") || "No change" : a.action === "service-changed" ? `${serviceOf(a.detail.service)?.label || a.detail.service}: ${a.detail.after?.enabled ? "on" : "off"}, markup ${a.detail.after?.markupPct ?? "agency"}${a.detail.after?.unitUsd != null ? `, $${a.detail.after.unitUsd}/unit` : ""}` : a.action === "client-service-changed" ? `${serviceOf(a.detail.service)?.label || a.detail.service} ${a.detail.enabled ? "on" : "off"}` : a.action === "client-changed" ? `markup ${a.detail.before?.markupPct ?? "agency"} → ${a.detail.after?.markupPct ?? "agency"}, rebill ${a.detail.after?.enabled ? "on" : "off"}` : JSON.stringify(a.detail)}</small></td><td><small>{a.actor}</small></td></tr>)}
        {!data.audit.length && <tr><td colSpan={5} className="ubp-muted">No billing changes yet.</td></tr>}
      </tbody></table></div>}
    </>}
  </section>;
}

/** Sub-account Settings → Billing: the client's own usage (at the billed price), prepaid credit and cancelling services. */
export function ClientAccountBilling({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [period, setPeriod] = useState("this");
  const [data, setData] = useState<ClientView | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [sure, setSure] = useState(false);
  const load = useCallback(async () => {
    const range = PERIODS.find((p) => p[0] === period)![2]();
    try { const r = await fetch(`/api/usage-billing?${new URLSearchParams({ clientId, as: "client", ...range })}`, { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw new Error(j.error || "Couldn’t load usage."); setData(j as ClientView); setErr(""); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn’t load usage."); }
  }, [clientId, period]);
  useEffect(() => { void load(); }, [load]);
  const money = useMemo(() => new Intl.NumberFormat("en-IE", { style: "currency", currency: data?.currency || "EUR" }), [data?.currency]);
  const post = async (body: Record<string, unknown>) => { setBusy(true); setMsg(""); try { const r = await fetch("/api/usage-billing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, ...body }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || "Couldn’t save."); await load(); return j; } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn’t save."); return null; } finally { setBusy(false); } };
  const buy = async (amount: number) => { const j = await post({ action: "credit-buy", amount }); if (j?.link) { setMsg(`Invoice ${j.number} created for ${money.format(amount)}. Credit is added as soon as it’s paid.`); window.open(j.link, "_blank", "noopener"); } };
  if (err) return <section className="panel ubp"><style>{CSS}</style><p className="ubp-muted">{err}</p></section>;
  if (!data) return <section className="panel ubp"><style>{CSS}</style><p className="ubp-muted">Loading usage…</p></section>;
  const pending = data.credit.history.filter((h) => h.status === "pending").reduce((t, h) => t + h.amount, 0);
  const open = data.cancellations.filter((c) => c.status === "requested" || c.status === "confirmed");
  const total = (data.services || []).reduce((t, v) => t + v.amount, 0);
  const left = data.credit.balance - total;
  return <section className="panel ubp ubp-account" aria-label="Usage and credit">
    <style>{CSS}</style>
    <div className="ubp-head"><div><h2>💳 Usage &amp; credit</h2><p className="ubp-sub">What {clientName} has used (AI, WhatsApp, SMS, calls, emails and data) and your prepaid credit. Usage is taken from credit first; anything left goes on your monthly invoice.</p></div></div>
    <div className="ubp-kpis">
      <div className={left < 0 ? "warn" : "good"}><small>Credit balance</small><b>{money.format(data.credit.balance)}</b>{total > 0 && data.credit.balance > 0 && <small>{left >= 0 ? `≈ ${money.format(left)} after this month’s usage` : `This month’s usage is ${money.format(-left)} more than your credit`}</small>}{pending > 0 && <small>{money.format(pending)} waiting for payment</small>}</div>
      <div><small>Used {period === "this" ? "this month" : period === "last" ? "last month" : "in 90 days"}</small><b>{money.format(total)}</b></div>
    </div>
    <div className="ubp-topup"><b>Top up credit</b>{[25, 50, 100, 250].map((a) => <button key={a} type="button" className="secondary-button" disabled={busy} onClick={() => void buy(a)}>{money.format(a)}</button>)}<span className="ubp-inline"><input className="ubp-mk" type="number" min={5} max={5000} step={5} placeholder="Other" value={custom} onChange={(e) => setCustom(e.target.value)} /><button type="button" className="primary-button" disabled={busy || !(Number(custom) >= 5)} onClick={() => { void buy(Number(custom)); setCustom(""); }}>Top up</button></span></div>
    <div className="ubp-bar"><div className="ubp-seg">{PERIODS.map(([k, l]) => <button key={k} type="button" className={period === k ? "on" : ""} onClick={() => setPeriod(k)}>{l}</button>)}</div></div>
    <div className="ubp-table-wrap"><table className="ubp-table"><thead><tr><th>Service</th><th>Used</th><th>Amount</th></tr></thead><tbody>
      {(data.services || []).map((v) => <tr key={v.key}><td>{v.label}</td><td>{n0(Math.round(v.qty * 100) / 100)} {v.unit}{v.qty === 1 ? "" : "s"}</td><td>{money.format(v.amount)}</td></tr>)}
      {!(data.services || []).length && <tr><td colSpan={3} className="ubp-muted">No usage in this period.</td></tr>}
    </tbody></table></div>
    {data.credit.history.length > 0 && <details className="ubp-history"><summary>Credit history</summary><div className="ubp-table-wrap"><table className="ubp-table"><tbody>{data.credit.history.map((h) => <tr key={h.id}><td>{when(h.at)}</td><td>{h.note || h.kind}{h.status === "pending" ? <small>Waiting for payment</small> : null}</td><td className={h.amount >= 0 ? "good" : ""}>{h.amount >= 0 ? "+" : ""}{money.format(h.amount)}</td></tr>)}</tbody></table></div></details>}
    <div className="ubp-cancel">
      <div className="ubp-svc-head"><b>Cancel services</b><small>30 days’ notice, and not before the 90-day minimum term ends. Services cancelled today would end on <b>{new Date(`${data.noticeEnd}T12:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" })}</b>.</small></div>
      {open.map((c) => <div key={c.id} className="ubp-notice"><span><b>{c.status === "confirmed" ? "Cancellation confirmed" : "Cancellation requested"}</b> · {c.services.join(", ")} · ends {new Date(`${c.endDate}T12:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" })}</span>{c.status === "requested" && <button type="button" className="ubp-link" disabled={busy} onClick={() => void post({ action: "cancel-withdraw", id: c.id })}>Withdraw</button>}</div>)}
      {!cancelOpen ? (data.ourServices.length ? <button type="button" className="secondary-button" onClick={() => { setCancelOpen(true); setSure(false); }}>Cancel a service…</button> : <small className="ubp-muted">No active services.</small>) : <div className="ubp-cancel-form">
        <div className="ubp-chips">{data.ourServices.map((n) => <label key={n} className={`ubp-chip ${picked.includes(n) ? "on" : ""}`}><input type="checkbox" checked={picked.includes(n)} onChange={(e) => setPicked(e.target.checked ? [...picked, n] : picked.filter((x) => x !== n))} />{n}</label>)}</div>
        <textarea rows={2} placeholder="Anything we could do better? (optional)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
        <div className="ubp-actions">{!sure ? <button type="button" className="secondary-button danger" disabled={!picked.length} onClick={() => setSure(true)}>Request cancellation</button> : <button type="button" className="primary-button danger" disabled={busy} onClick={async () => { const j = await post({ action: "cancel-request", services: picked, reason }); if (j) { setMsg(`Request sent. ${picked.join(", ")} will end on ${new Date(`${j.endDate}T12:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "long" })}.`); setCancelOpen(false); setPicked([]); setReason(""); } }}>Yes, cancel {picked.length} service{picked.length === 1 ? "" : "s"}</button>}<button type="button" className="ubp-link" onClick={() => setCancelOpen(false)}>Keep my services</button></div>
      </div>}
    </div>
    {msg && <small className="ubp-muted">{msg}</small>}
  </section>;
}

/** Client profile: rebilling on/off, the client's own markup and which paid services are rebilled (agency admins). */
export function ClientRebillingCard({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [data, setData] = useState<Agency | null>(null);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    const n = new Date();
    try { const r = await fetch(`/api/usage-billing?${new URLSearchParams({ clientId, start: iso(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1))), end: iso(n) })}`, { cache: "no-store" }); const j = await r.json(); if (r.ok && j.view === "agency") setData(j); } catch { /* hidden */ }
  }, [clientId]);
  useEffect(() => { void load(); }, [load]);
  if (!data) return null;
  const post = async (body: Record<string, unknown>, ok: string) => { setMsg(""); try { const r = await fetch("/api/usage-billing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || "Couldn’t save."); setMsg(ok); await load(); } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn’t save."); } };
  const o = data.overrides.find((x) => x.clientId === clientId); const on = o?.enabled !== false;
  const svcOn = (k: string) => data.clientServices.find((c) => c.clientId === clientId)?.services[k] !== false;
  const row = data.clients.find((c) => c.clientId === clientId);
  return <section className="ubp ubp-profile" aria-label="Usage rebilling">
    <style>{CSS}</style>
    <div className="ubp-head"><div><h3>💳 Usage rebilling <span className="admin-badge">AGENCY</span></h3><p className="ubp-sub">{row ? `This month: ${usd(row.costUsd)} cost · bills ${new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(row.billable)}` : "No usage this month yet."}</p></div>
      <label className="ubp-toggle" title={`Rebill ${clientName}`}><input type="checkbox" checked={on} onChange={(e) => void post({ action: "client", clientId, enabled: e.target.checked }, e.target.checked ? "Rebilling on." : "Rebilling off.")} aria-label={`Rebill ${clientName}`} /><i /></label></div>
    {on && <><div className="ubp-chips">{data.services.filter((v) => v.enabled).map((v) => <label key={v.key} className={`ubp-chip ${svcOn(v.key) ? "on" : ""}`} title={v.note}><input type="checkbox" checked={svcOn(v.key)} onChange={(e) => void post({ action: "client-service", clientId, service: v.key, enabled: e.target.checked }, `${v.label.split(" (")[0]} ${e.target.checked ? "on" : "off"}.`)} />{v.label.split(" (")[0]}</label>)}</div>
    <label className="ubp-inline">Markup for {clientName}<input className="ubp-mk" type="number" min={0} max={1000} step={5} placeholder="auto" defaultValue={o?.markupPct ?? ""} onBlur={(e) => { const v = e.target.value.trim(); if ((v === "" ? null : Number(v)) !== (o?.markupPct ?? null)) void post({ action: "client", clientId, markupPct: v === "" ? null : Number(v) }, "Markup saved."); }} />% <small>Empty = each service’s markup</small></label></>}
    {data.account && <div className="ubp-credit-admin">
      <span className="ubp-inline"><b>Credit {new Intl.NumberFormat("en-IE", { style: "currency", currency: data.account.currency }).format(data.account.credit.balance)}</b><input className="ubp-mk" type="number" step="5" placeholder="±" id={`cr-${clientId}`} /><button type="button" className="ubp-link" onClick={() => { const el = document.getElementById(`cr-${clientId}`) as HTMLInputElement | null; const v = Number(el?.value); if (v) { void post({ action: "credit-add", clientId, amount: v }, v > 0 ? "Credit added." : "Credit adjusted."); if (el) el.value = ""; } }}>Add / adjust</button></span>
      {data.account.cancellations.filter((c) => c.status === "requested").map((c) => <div key={c.id} className="ubp-notice"><span><b>Cancellation requested</b> · {c.services.join(", ")} · ends {c.endDate}{c.reason ? ` · “${c.reason}”` : ""}</span><span><button type="button" className="ubp-link" onClick={() => void post({ action: "cancel-decide", id: c.id, status: "confirmed" }, "Cancellation confirmed.")}>Confirm</button> <button type="button" className="ubp-link" onClick={() => void post({ action: "cancel-decide", id: c.id, status: "withdrawn" }, "Cancellation withdrawn.")}>Withdraw</button></span></div>)}
    </div>}
    {msg && <small className="ubp-muted">{msg}</small>}
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
.ubp{display:flex;flex-direction:column;gap:14px;padding:22px 24px !important;margin-top:0}
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
.ubp .ubp-services{border:1px solid rgba(127,127,127,.16);border-radius:16px;padding:12px 14px;display:grid;gap:8px}
.ubp .ubp-svc-head{display:flex;flex-direction:column;gap:2px}.ubp .ubp-svc-head small{font-size:12.5px;opacity:.7}
.ubp tr.off td{opacity:.5}.ubp tr.off td:first-child{opacity:1}
.ubp .ubp-toggle{position:relative;display:inline-block;width:36px;height:20px;cursor:pointer}.ubp .ubp-toggle input{position:absolute;opacity:0;inset:0;margin:0;cursor:pointer}
.ubp .ubp-toggle i{position:absolute;inset:0;border-radius:999px;background:rgba(127,127,127,.35);transition:background .15s}.ubp .ubp-toggle i::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform .15s}
.ubp .ubp-toggle input:checked+i{background:var(--brand-primary,#1677c8)}.ubp .ubp-toggle input:checked+i::after{transform:translateX(16px)}
.ubp .ubp-client{display:inline-flex;align-items:center;gap:8px}.ubp .ubp-client img{height:22px;max-width:60px;object-fit:contain}
.ubp .ubp-link{border:0;background:transparent;color:var(--brand-primary,#1677c8);font:inherit;font-weight:700;font-size:12.5px;cursor:pointer;white-space:nowrap}
.ubp .ubp-svc-row td{background:color-mix(in srgb,currentColor 3%,transparent)}
.ubp .ubp-chips{display:flex;flex-wrap:wrap;gap:6px}
.ubp .ubp-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;border:1px solid rgba(127,127,127,.28);font-size:12.5px;font-weight:600;cursor:pointer;transition:transform .15s,border-color .15s}
.ubp .ubp-chip:hover{transform:translateY(-1px);border-color:var(--brand-secondary,#8b5cf6)}.ubp .ubp-chip.on{border-color:var(--brand-primary,#1677c8);background:color-mix(in srgb,var(--brand-primary,#1677c8) 10%,transparent)}
.ubp.ubp-profile{padding:12px 14px !important;border:1px solid rgba(127,127,127,.16);border-radius:14px;margin-top:12px;gap:10px}.ubp.ubp-profile h3{margin:0;font-size:15px}
.ubp .ubp-inline{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;flex-wrap:wrap}.ubp .ubp-inline small{font-weight:500;opacity:.65}
.ubp .ubp-kpis>div.warn{background:#fff6e5;color:#8a5a00}.ubp .ubp-kpis>div small+small{margin-top:2px}
.ubp .ubp-topup{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.ubp .ubp-cancel{display:grid;gap:8px;border-top:1px solid rgba(127,127,127,.16);padding-top:12px}
.ubp .ubp-cancel-form{display:grid;gap:8px}.ubp .ubp-cancel-form textarea{border:1px solid rgba(127,127,127,.28);border-radius:10px;padding:8px 10px;font:inherit;background:transparent;color:inherit}
.ubp .ubp-notice{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;padding:8px 10px;border-radius:10px;background:#fff6e5;color:#6b4700;font-size:13px}
.ubp .danger{border-color:#d92d20 !important;color:#d92d20}.ubp .primary-button.danger{background:#d92d20 !important;color:#fff}
.ubp .ubp-history summary{cursor:pointer;font-weight:700;font-size:13px}
.ubp .ubp-credit-admin{display:grid;gap:6px}
@media (max-width:900px){.ubp .ubp-settings{grid-template-columns:1fr}.ubp .ubp-fields{grid-template-columns:1fr}}
`;
