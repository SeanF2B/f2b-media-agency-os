"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Item = { description: string; qty: number; unit: number };
type Invoice = { id: string; clientId: string; clientName: string; clientEmail: string; clientAddress: string; number: string; status: "draft" | "sent" | "paid" | "overdue" | "void"; rawStatus: string; issueDate: string; dueDate: string; currency: string; items: Item[]; vatRate: number; subtotal: number; vat: number; total: number; notes: string; recurringId: string; sentAt: string; paidAt: string; link: string };
type Recurring = { id: string; clientId: string; title: string; items: Item[]; vatRate: number; currency: string; interval: string; nextDate: string; active: boolean; autoSend: boolean; notes: string };
type ClientInfo = { id: string; name: string; email: string; currency: string; fee: number; services: Array<{ name: string; fee: number }> };
type Settings = { businessName: string; address: string; vatNumber: string; bankDetails: string; paymentTermsDays: number; prefix: string; nextNumber: number; footerNote: string; replyTo: string };
type Data = { invoices: Invoice[]; recurring: Recurring[]; settings: Settings; clients: ClientInfo[]; currency: string; mailReady: boolean };
type Draft = { id?: string; saveEmailToClient?: boolean; clientId: string; clientName: string; clientEmail: string; clientAddress: string; issueDate: string; dueDate: string; items: Item[]; vatRate: number; notes: string; currency: string };
type RecDraft = { id?: string; clientId: string; title: string; items: Item[]; vatRate: number; interval: string; nextDate: string; autoSend: boolean; notes: string; currency: string };

async function call<T>(body?: unknown, qs = ""): Promise<T> {
  const res = await fetch("/api/invoicing" + qs, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const json = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || "Something went wrong.");
  return json;
}
const fmt = (n: number, c = "EUR") => new Intl.NumberFormat("en-IE", { style: "currency", currency: c }).format(n || 0);
const iso = (d = new Date()) => d.toISOString().slice(0, 10);
const plus = (date: string, days: number) => { const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const calc = (items: Item[], vat: number) => { const sub = items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.unit) || 0), 0), v = sub * (Number(vat) || 0) / 100; return { sub, v, total: sub + v }; };
const LABEL: Record<string, string> = { draft: "Draft", sent: "Sent", paid: "Paid", overdue: "Overdue", void: "Void" };
const EVERY: Record<string, string> = { weekly: "Every week", monthly: "Every month", quarterly: "Every 3 months", yearly: "Every year" };

export function InvoicingView({ scopeClientId }: { scopeClientId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<"invoices" | "recurring" | "settings">("invoices");
  const [filter, setFilter] = useState<"all" | "unpaid" | "paid" | "draft">("all");
  const [editor, setEditor] = useState<Draft | null>(null);
  const [recEditor, setRecEditor] = useState<RecDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const openPreview = async (id: string) => { setError(""); try { setPreview((await call<{ html: string }>({ action: "preview", id })).html); } catch (e) { setError(e instanceof Error ? e.message : "Could not load the preview."); } };

  const load = useCallback(async () => { try { setData(await call<Data>(undefined, `?clientId=${encodeURIComponent(scopeClientId || "agency")}`)); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Could not load invoices."); } }, [scopeClientId]);
  useEffect(() => { setData(null); void load(); }, [load]);
  const act = async (body: Record<string, unknown>, ok?: string) => { setBusy(true); setError(""); setNote(""); try { await call(body); if (ok) setNote(ok); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); } finally { setBusy(false); } };

  const stats = useMemo(() => {
    const inv = data?.invoices || [], cur = data?.currency || "EUR", month = iso().slice(0, 7);
    const sum = (f: (i: Invoice) => boolean) => inv.filter(f).reduce((s, i) => s + i.total, 0);
    const mrr = (data?.recurring || []).filter((r) => r.active).reduce((s, r) => { const t = calc(r.items, r.vatRate).total; return s + (r.interval === "weekly" ? t * 52 / 12 : r.interval === "quarterly" ? t / 3 : r.interval === "yearly" ? t / 12 : t); }, 0);
    return { outstanding: sum((i) => i.status === "sent" || i.status === "overdue"), overdue: sum((i) => i.status === "overdue"), paidMonth: sum((i) => i.status === "paid" && i.paidAt.slice(0, 7) === month), mrr, cur };
  }, [data]);

  const newInvoice = (): Draft => { const c = data?.clients.find((x) => x.id === scopeClientId); const s = data!.settings; return { clientId: c?.id || "", clientName: c?.name || "", clientEmail: c?.email || "", clientAddress: "", issueDate: iso(), dueDate: plus(iso(), s.paymentTermsDays), items: [{ description: "", qty: 1, unit: 0 }], vatRate: 0, notes: "", currency: c?.currency || data!.currency }; };
  const newRecurring = (): RecDraft => { const c = data?.clients.find((x) => x.id === scopeClientId); return { clientId: c?.id || "", title: "Monthly service", items: c?.services.length ? c.services.map((s) => ({ description: s.name, qty: 1, unit: s.fee })) : [{ description: "", qty: 1, unit: 0 }], vatRate: 0, interval: "monthly", nextDate: iso(), autoSend: false, notes: "", currency: c?.currency || data!.currency }; };
  const shown = (data?.invoices || []).filter((i) => filter === "all" ? true : filter === "unpaid" ? i.status === "sent" || i.status === "overdue" : filter === "paid" ? i.status === "paid" : i.status === "draft");

  if (!data) return <section className="iv"><div className="empty-state" role="status">{error || "Loading invoicing…"}</div></section>;
  return <section className="iv" aria-label="Invoicing">
    <header className="iv-head"><div><p className="eyebrow">💶 INVOICING</p><h1>Invoices &amp; subscriptions</h1><p>Send invoices, set up recurring invoices and subscriptions, and track who has paid.</p></div>
      <div className="iv-head-actions"><button type="button" className="secondary-button" onClick={() => setRecEditor(newRecurring())}>🔁 New subscription</button><button type="button" className="primary-button" onClick={() => setEditor(newInvoice())}>＋ New invoice</button></div></header>
    {error && <div className="iv-error" role="alert">{error}</div>}{note && <div className="iv-note" role="status">{note}</div>}
    {!data.mailReady && <div className="iv-warn">Email sending isn’t set up on the server yet, so “Send” won’t work. You can still share each invoice’s link or print it as a PDF.</div>}
    <div className="iv-stats"><div><small>Outstanding</small><b>{fmt(stats.outstanding, stats.cur)}</b></div><div className={stats.overdue ? "bad" : ""}><small>Overdue</small><b>{fmt(stats.overdue, stats.cur)}</b></div><div><small>Paid this month</small><b>{fmt(stats.paidMonth, stats.cur)}</b></div><div><small>Recurring / month</small><b>{fmt(stats.mrr, stats.cur)}</b></div></div>
    <div className="iv-tabs" role="tablist">{([["invoices", "Invoices"], ["recurring", `Subscriptions${data.recurring.length ? ` (${data.recurring.length})` : ""}`], ["settings", "Settings"]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>

    {tab === "invoices" && <div className="iv-card">
      <div className="iv-filters">{([["all", "All"], ["unpaid", "Unpaid"], ["paid", "Paid"], ["draft", "Drafts"]] as const).map(([k, l]) => <button key={k} type="button" className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>)}</div>
      {shown.length === 0 ? <div className="iv-empty"><span>🧾</span><p>No invoices here yet.</p><button type="button" className="primary-button" onClick={() => setEditor(newInvoice())}>Create your first invoice</button></div> :
      <div className="iv-table" role="table">{shown.map((i) => <div className="iv-row" role="row" key={i.id}>
        <div className="iv-main"><b>{i.number}</b><span>{i.clientName}{i.recurringId ? " · 🔁" : ""}</span></div>
        <div className="iv-dates"><small>Issued {i.issueDate}</small><small>Due {i.dueDate}</small></div>
        <div className="iv-amount">{fmt(i.total, i.currency)}</div>
        <span className={`iv-pill ${i.status}`}>{LABEL[i.status]}</span>
        <div className="iv-actions">
          {i.rawStatus !== "paid" && i.rawStatus !== "void" && <button type="button" className="iv-btn" disabled={busy} onClick={() => setEditor({ id: i.id, clientId: i.clientId, clientName: i.clientName, clientEmail: i.clientEmail, clientAddress: i.clientAddress, issueDate: i.issueDate, dueDate: i.dueDate, items: i.items, vatRate: i.vatRate, notes: i.notes, currency: i.currency })}>Edit</button>}
          {i.rawStatus !== "void" && <a className="iv-btn" href={i.link} target="_blank" rel="noopener noreferrer" onClick={(e) => { if (i.rawStatus === "draft") { e.preventDefault(); void openPreview(i.id); } }}>{i.rawStatus === "draft" ? "Preview" : "View"}</a>}
          {(i.rawStatus === "draft" || i.rawStatus === "sent") && <button type="button" className="iv-btn" disabled={busy} onClick={() => void act({ action: "send", id: i.id }, `${i.number} sent to ${i.clientEmail || "the client"}.`)}>{i.rawStatus === "draft" ? "Send" : "Resend"}</button>}
          {(i.rawStatus === "sent" || i.rawStatus === "draft") && <button type="button" className="iv-btn ok" disabled={busy} onClick={() => void act({ action: "mark-paid", id: i.id }, `${i.number} marked as paid.`)}>✓ Paid</button>}
          {i.rawStatus === "paid" && <button type="button" className="iv-btn" disabled={busy} onClick={() => void act({ action: "mark-unpaid", id: i.id })}>Undo paid</button>}
          {i.rawStatus === "draft" ? <button type="button" className="iv-btn danger" disabled={busy} onClick={() => { if (confirm(`Delete draft ${i.number}?`)) void act({ action: "delete", id: i.id }); }}>Delete</button> : i.rawStatus !== "void" && i.rawStatus !== "paid" ? <button type="button" className="iv-btn danger" disabled={busy} onClick={() => { if (confirm(`Void ${i.number}? It will stay in your records.`)) void act({ action: "void", id: i.id }); }}>Void</button> : null}
        </div></div>)}</div>}
    </div>}

    {tab === "recurring" && <div className="iv-card">{data.recurring.length === 0 ? <div className="iv-empty"><span>🔁</span><p>No subscriptions yet. Set one up and invoices are created for you on schedule.</p><button type="button" className="primary-button" onClick={() => setRecEditor(newRecurring())}>New subscription</button></div> :
      <div className="iv-table">{data.recurring.map((r) => { const name = data.clients.find((c) => c.id === r.clientId)?.name || "Client"; return <div className={`iv-row ${r.active ? "" : "off"}`} key={r.id}>
        <div className="iv-main"><b>{r.title || "Subscription"}</b><span>{name}</span></div>
        <div className="iv-dates"><small>{EVERY[r.interval] || r.interval}</small><small>{r.active ? `Next: ${r.nextDate}` : "Paused"}</small></div>
        <div className="iv-amount">{fmt(calc(r.items, r.vatRate).total, r.currency)}</div>
        <span className={`iv-pill ${r.active ? "sent" : "void"}`}>{r.active ? (r.autoSend ? "Auto-sends" : "Creates drafts") : "Paused"}</span>
        <div className="iv-actions"><button type="button" className="iv-btn" onClick={() => setRecEditor({ id: r.id, clientId: r.clientId, title: r.title, items: r.items, vatRate: r.vatRate, interval: r.interval, nextDate: r.nextDate, autoSend: r.autoSend, notes: r.notes, currency: r.currency })}>Edit</button>
          <button type="button" className="iv-btn" disabled={busy} onClick={() => void act({ action: "toggle-recurring", id: r.id, active: !r.active })}>{r.active ? "Pause" : "Resume"}</button>
          <button type="button" className="iv-btn danger" disabled={busy} onClick={() => { if (confirm("Delete this subscription? Invoices already created stay.")) void act({ action: "delete-recurring", id: r.id }); }}>Delete</button></div></div>; })}</div>}
      <p className="iv-hint">Invoices are created automatically on each due date whenever Invoicing is opened, so none are missed. Choose “Auto-sends” to email them straight away, or leave it to create drafts for you to check first.</p></div>}

    {tab === "settings" && <SettingsPanel settings={data.settings} onSave={async (s) => { await call({ action: "save-settings", settings: s }); await load(); }} />}
    {editor && <InvoiceEditor draft={editor} clients={data.clients} terms={data.settings.paymentTermsDays} onClose={() => setEditor(null)} onSave={async (d, send) => { const r = await call<{ id: string }>({ action: "save-invoice", ...d }); if (send) await call({ action: "send", id: d.id || r.id }); setEditor(null); setNote(send ? "Invoice saved and sent." : "Invoice saved."); await load(); }} />}
    {preview !== null && <PreviewModal html={preview} onClose={() => setPreview(null)} />}
    {recEditor && <RecurringEditor draft={recEditor} clients={data.clients} onClose={() => setRecEditor(null)} onSave={async (d) => { await call({ action: "save-recurring", ...d }); setRecEditor(null); setNote("Subscription saved."); await load(); }} />}
  </section>;
}

function Lines({ items, onChange, currency }: { items: Item[]; onChange: (i: Item[]) => void; currency: string }) {
  const set = (idx: number, patch: Partial<Item>) => onChange(items.map((it, i) => i === idx ? { ...it, ...patch } : it));
  return <div className="iv-lines"><div className="iv-line head"><span>Description</span><span>Qty</span><span>Price</span><span>Amount</span><span /></div>
    {items.map((it, i) => <div className="iv-line" key={i}><input value={it.description} placeholder="What is this for?" onChange={(e) => set(i, { description: e.target.value })} aria-label="Description" /><input type="number" min="0" step="any" value={it.qty} onChange={(e) => set(i, { qty: Number(e.target.value) })} aria-label="Quantity" /><input type="number" step="any" value={it.unit} onChange={(e) => set(i, { unit: Number(e.target.value) })} aria-label="Unit price" /><span className="iv-linetotal">{fmt((Number(it.qty) || 0) * (Number(it.unit) || 0), currency)}</span><button type="button" className="iv-x" aria-label="Remove line" disabled={items.length < 2} onClick={() => onChange(items.filter((_, j) => j !== i))}>✕</button></div>)}
    <button type="button" className="iv-btn" onClick={() => onChange([...items, { description: "", qty: 1, unit: 0 }])}>＋ Add a line</button></div>;
}
function Totals({ items, vat, currency }: { items: Item[]; vat: number; currency: string }) { const t = calc(items, vat); return <div className="iv-totals"><div><span>Subtotal</span><b>{fmt(t.sub, currency)}</b></div>{vat > 0 && <div><span>VAT {vat}%</span><b>{fmt(t.v, currency)}</b></div>}<div className="g"><span>Total</span><b>{fmt(t.total, currency)}</b></div></div>; }
function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }) { return <div className="iv-modal" role="dialog" aria-label={title} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="iv-dialog"><header><h2>{title}</h2><button type="button" className="iv-x" aria-label="Close" onClick={onClose}>✕</button></header>{children}<footer>{footer}</footer></div></div>; }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function PreviewModal({ html, onClose, closeLabel = "Close", extra }: { html: string; onClose: () => void; closeLabel?: string; extra?: React.ReactNode }) {
  return <Modal title="Invoice preview" onClose={onClose} footer={<><button type="button" className="secondary-button" onClick={onClose}>{closeLabel}</button>{extra}</>}>
    <p className="iv-small">This is exactly what your client will see. Drafts aren’t visible to anyone until you send them.</p>
    <iframe className="iv-preview" title="Invoice preview" srcDoc={html} sandbox="allow-scripts allow-modals" /></Modal>;
}
function InvoiceEditor({ draft, clients, terms, onClose, onSave }: { draft: Draft; clients: ClientInfo[]; terms: number; onClose: () => void; onSave: (d: Draft, send: boolean) => Promise<void> }) {
  const [d, setD] = useState<Draft>(draft); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const pick = (id: string) => { const c = clients.find((x) => x.id === id); setD({ ...d, clientId: id, clientName: c?.name || d.clientName, clientEmail: c?.email || d.clientEmail, currency: c?.currency || d.currency }); };
  const client = clients.find((x) => x.id === d.clientId);
  const missingOnFile = Boolean(client && !client.email.trim());
  const emailOk = EMAIL_RE.test(d.clientEmail.trim());
  const [preview, setPreview] = useState<string | null>(null);
  const go = async (send: boolean) => {
    if (send && !emailOk) { setErr(d.clientEmail.trim() ? "That email address doesn’t look right. Check it before sending." : `Add an email address to send this invoice to${client ? ` — ${client.name} has none on file yet` : ""}.`); return; }
    setBusy(true); setErr(""); try { await onSave({ ...d, clientEmail: d.clientEmail.trim(), saveEmailToClient: missingOnFile && emailOk && d.saveEmailToClient !== false }, send); } catch (e) { setErr(e instanceof Error ? e.message : "Could not save."); setBusy(false); }
  };
  const showPreview = async () => { setErr(""); try { setPreview((await call<{ html: string }>({ action: "preview", ...d })).html); } catch (e) { setErr(e instanceof Error ? e.message : "Could not load the preview."); } };
  if (preview !== null) return <PreviewModal html={preview} onClose={() => setPreview(null)} closeLabel="Back to editing" extra={<><button type="button" className="secondary-button" disabled={busy} onClick={() => void go(false)}>Save draft</button><button type="button" className="primary-button" disabled={busy} onClick={() => { setPreview(null); void go(true); }}>{busy ? "Working…" : "Save & send"}</button></>} />;
  return <Modal title={d.id ? "Edit invoice" : "New invoice"} onClose={onClose} footer={<><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void showPreview()}>Preview</button><button type="button" className="secondary-button" disabled={busy} onClick={() => void go(false)}>Save draft</button><button type="button" className="primary-button" disabled={busy} onClick={() => void go(true)}>{busy ? "Working…" : "Save & send"}</button></>}>
    <div className="iv-grid"><label>Client<select value={d.clientId} onChange={(e) => pick(e.target.value)}><option value="">Someone else…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>Name on invoice<input value={d.clientName} onChange={(e) => setD({ ...d, clientName: e.target.value })} /></label>
      <label>Email to send to<input type="email" value={d.clientEmail} onChange={(e) => setD({ ...d, clientEmail: e.target.value })} placeholder="client@example.com" className={missingOnFile && !d.clientEmail.trim() ? "iv-need" : undefined} />
        {missingOnFile && (d.clientEmail.trim() ? <span className="iv-check iv-small"><input type="checkbox" checked={d.saveEmailToClient !== false} onChange={(e) => setD({ ...d, saveEmailToClient: e.target.checked })} /> Save to {client!.name}’s profile</span> : <span className="iv-small iv-need-text">No email on file for {client!.name} — add one here</span>)}</label>
      <label>Issue date<input type="date" value={d.issueDate} onChange={(e) => setD({ ...d, issueDate: e.target.value, dueDate: plus(e.target.value, terms) })} /></label>
      <label>Due date<input type="date" value={d.dueDate} onChange={(e) => setD({ ...d, dueDate: e.target.value })} /></label>
      <label>VAT %<input type="number" min="0" max="100" step="any" value={d.vatRate} onChange={(e) => setD({ ...d, vatRate: Number(e.target.value) })} /></label></div>
    <Lines items={d.items} currency={d.currency} onChange={(items) => setD({ ...d, items })} /><Totals items={d.items} vat={d.vatRate} currency={d.currency} />
    <label>Note on the invoice (optional)<textarea rows={2} value={d.notes} onChange={(e) => setD({ ...d, notes: e.target.value })} /></label>{err && <p className="iv-error">{err}</p>}</Modal>;
}
function RecurringEditor({ draft, clients, onClose, onSave }: { draft: RecDraft; clients: ClientInfo[]; onClose: () => void; onSave: (d: RecDraft) => Promise<void> }) {
  const [d, setD] = useState<RecDraft>(draft); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const c = clients.find((x) => x.id === d.clientId);
  const go = async () => { setBusy(true); setErr(""); try { await onSave(d); } catch (e) { setErr(e instanceof Error ? e.message : "Could not save."); setBusy(false); } };
  return <Modal title={d.id ? "Edit subscription" : "New subscription"} onClose={onClose} footer={<><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="button" className="primary-button" disabled={busy} onClick={() => void go()}>{busy ? "Saving…" : "Save subscription"}</button></>}>
    <div className="iv-grid"><label>Client<select value={d.clientId} onChange={(e) => { const cl = clients.find((x) => x.id === e.target.value); setD({ ...d, clientId: e.target.value, currency: cl?.currency || d.currency }); }}><option value="">Choose a client…</option>{clients.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label>Name<input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="e.g. Monthly marketing retainer" /></label>
      <label>Repeats<select value={d.interval} onChange={(e) => setD({ ...d, interval: e.target.value })}>{Object.entries(EVERY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label>First / next invoice date<input type="date" value={d.nextDate} onChange={(e) => setD({ ...d, nextDate: e.target.value })} /></label>
      <label>VAT %<input type="number" min="0" max="100" step="any" value={d.vatRate} onChange={(e) => setD({ ...d, vatRate: Number(e.target.value) })} /></label></div>
    {c && c.services.length > 0 && <button type="button" className="iv-btn" onClick={() => setD({ ...d, items: c.services.map((s) => ({ description: s.name, qty: 1, unit: s.fee })) })}>↺ Use {c.name}’s current monthly services ({fmt(c.fee, d.currency)})</button>}
    <Lines items={d.items} currency={d.currency} onChange={(items) => setD({ ...d, items })} /><Totals items={d.items} vat={d.vatRate} currency={d.currency} />
    <label className="iv-check"><input type="checkbox" checked={d.autoSend} onChange={(e) => setD({ ...d, autoSend: e.target.checked })} /> Email each invoice to the client automatically (otherwise it’s created as a draft for you to check)</label>{err && <p className="iv-error">{err}</p>}</Modal>;
}
function SettingsPanel({ settings, onSave }: { settings: Settings; onSave: (s: Settings) => Promise<void> }) {
  const [s, setS] = useState(settings); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");
  const set = (p: Partial<Settings>) => { setMsg(""); setS({ ...s, ...p }); };
  return <div className="iv-card iv-settings"><div className="iv-grid"><label>Your business name<input value={s.businessName} placeholder="F2B Media" onChange={(e) => set({ businessName: e.target.value })} /></label><label>VAT number (optional)<input value={s.vatNumber} onChange={(e) => set({ vatNumber: e.target.value })} /></label>
    <label>Invoice prefix<input value={s.prefix} maxLength={12} onChange={(e) => set({ prefix: e.target.value })} /></label><label>Next invoice number<input type="number" min="1" value={s.nextNumber} onChange={(e) => set({ nextNumber: Number(e.target.value) })} /></label>
    <label>Payment terms (days)<input type="number" min="0" max="120" value={s.paymentTermsDays} onChange={(e) => set({ paymentTermsDays: Number(e.target.value) })} /></label><label>Replies go to (email)<input type="email" value={s.replyTo} placeholder="you@yourbusiness.com" onChange={(e) => set({ replyTo: e.target.value })} /></label></div>
    <label>Business address<textarea rows={3} value={s.address} onChange={(e) => set({ address: e.target.value })} /></label>
    <label>How clients should pay (bank details, IBAN, etc.)<textarea rows={3} value={s.bankDetails} onChange={(e) => set({ bankDetails: e.target.value })} /></label>
    <label>Footer note (optional)<input value={s.footerNote} onChange={(e) => set({ footerNote: e.target.value })} placeholder="Thanks for your business!" /></label>
    <div className="iv-foot">{msg && <span className="iv-ok">{msg}</span>}<button type="button" className="primary-button" disabled={busy} onClick={async () => { setBusy(true); try { await onSave(s); setMsg("Saved."); } catch (e) { setMsg(e instanceof Error ? e.message : "Could not save."); } finally { setBusy(false); } }}>{busy ? "Saving…" : "Save settings"}</button></div></div>;
}
