"use client";
// Settings → Billing: subscriptions (recurring invoices) and recent invoices for the agency or the current
// client account, with cancel / resume. Cancelling stops future invoices; nothing already sent is changed.
import { useEffect, useState } from "react";
import { CalendarClock, CreditCard, FileText, Repeat } from "lucide-react";
import { appConfirm } from "./app-dialog";

type Item = { description: string; qty: number; unit: number };
type Sub = { id: string; clientId: string; title: string; items: Item[]; vatRate: number; currency: string; interval: string; nextDate: string; active: boolean };
type Invoice = { id: string; clientId: string; clientName: string; number: string; status: string; issueDate: string; dueDate: string; total: number; currency: string; link: string };
const money = (n: number, c = "EUR") => new Intl.NumberFormat("en-IE", { style: "currency", currency: c || "EUR" }).format(n || 0);
const subTotal = (s: Sub) => s.items.reduce((sum, i) => sum + (Number(i.qty) || 0) * (Number(i.unit) || 0), 0) * (1 + (Number(s.vatRate) || 0) / 100);

export function BillingPanel({ clientId, clients }: { clientId?: string; clients: Array<{ id: string; name: string }> }) {
  const [subs, setSubs] = useState<Sub[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const name = (id: string) => clients.find((c) => c.id === id)?.name || "Client";
  const load = async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/invoicing${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ""}`, { cache: "no-store" });
      const json = await response.json() as { recurring?: Sub[]; invoices?: Invoice[]; error?: string };
      if (!response.ok) throw new Error(json.error || "Billing couldn’t load.");
      setSubs(json.recurring || []); setInvoices((json.invoices || []).slice(0, 12));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Billing couldn’t load."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = async (sub: Sub) => {
    if (sub.active && !(await appConfirm(`Cancel “${sub.title}”?\nNo more invoices will be created for it. Invoices already sent stay as they are, and you can resume it any time.`))) return;
    setBusy(sub.id);
    try {
      const response = await fetch("/api/invoicing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "toggle-recurring", id: sub.id, active: !sub.active }) });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error || "Couldn’t update the subscription.");
      setSubs((current) => current.map((item) => item.id === sub.id ? { ...item, active: !item.active } : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn’t update the subscription."); }
    finally { setBusy(""); }
  };
  const active = subs.filter((s) => s.active);
  const monthly = active.reduce((sum, s) => sum + subTotal(s) * (s.interval === "weekly" ? 52 / 12 : s.interval === "quarterly" ? 1 / 3 : s.interval === "yearly" ? 1 / 12 : 1), 0);
  return <section className="billing-panel">
    <header className="billing-head"><div><h2><CreditCard size={20} /> Billing</h2><p className="muted">{clientId ? `Subscriptions and invoices for ${name(clientId)}.` : "Every client subscription and recent invoice. Cancel or resume a subscription here."}</p></div>{active.length > 0 && <div className="billing-mrr"><small>Active subscriptions</small><b>{active.length} · {money(monthly)}/mo</b></div>}</header>
    {error && <p className="billing-error" role="alert">{error}</p>}
    {loading ? <p className="muted">Loading billing…</p> : <>
      <h3><Repeat size={16} /> Subscriptions</h3>
      {subs.length ? <div className="billing-subs">{subs.map((sub) => <article key={sub.id} className={`billing-sub${sub.active ? "" : " is-off"}`}>
        <div className="billing-sub-main"><b>{sub.title}</b><small>{clientId ? "" : `${name(sub.clientId)} · `}{money(subTotal(sub), sub.currency)} {sub.interval || "monthly"}{sub.vatRate ? " incl. VAT" : ""}</small><small className="billing-next"><CalendarClock size={13} /> {sub.active ? `Next invoice ${new Date(`${sub.nextDate}T12:00:00`).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" })}` : "Cancelled — no more invoices"}</small></div>
        <span className={`billing-status ${sub.active ? "on" : "off"}`}>{sub.active ? "Active" : "Cancelled"}</span>
        <button type="button" className={sub.active ? "secondary-button billing-cancel" : "primary-button"} disabled={busy === sub.id} onClick={() => void toggle(sub)}>{busy === sub.id ? "…" : sub.active ? "Cancel subscription" : "Resume"}</button>
      </article>)}</div> : <p className="muted billing-empty">No subscriptions yet. Set one up in Bookkeeping → Invoicing → New subscription.</p>}
      <h3><FileText size={16} /> Recent invoices</h3>
      {invoices.length ? <div className="billing-invoices">{invoices.map((inv) => <a key={inv.id} href={inv.link} target="_blank" rel="noreferrer" className="billing-invoice"><span>{inv.number}</span>{!clientId && <span className="billing-inv-client">{inv.clientName}</span>}<span>{new Date(`${inv.issueDate}T12:00:00`).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" })}</span><b>{money(inv.total, inv.currency)}</b><span className={`billing-inv-status s-${inv.status}`}>{inv.status}</span></a>)}</div> : <p className="muted billing-empty">No invoices yet.</p>}
    </>}
  </section>;
}
