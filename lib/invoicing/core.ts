// F2B Agency OS · Invoicing: invoices, recurring invoices and subscriptions. D1 tables are CREATE TABLE IF NOT EXISTS only.
// Recurring invoices are generated whenever the Invoicing area (or its API) is opened, so no cron change is needed.
import { env } from "cloudflare:workers";

export type Item = { description: string; qty: number; unit: number };
export type Interval = "weekly" | "monthly" | "quarterly" | "yearly";
export type InvSettings = { businessName: string; address: string; vatNumber: string; bankDetails: string; paymentTermsDays: number; prefix: string; nextNumber: number; footerNote: string; replyTo: string };

export async function ensureTables() {
  const db = env.DB!;
  await db.prepare(`CREATE TABLE IF NOT EXISTS inv_settings (owner_id TEXT PRIMARY KEY, business_name TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', vat_number TEXT NOT NULL DEFAULT '', bank_details TEXT NOT NULL DEFAULT '', payment_terms_days INTEGER NOT NULL DEFAULT 14, prefix TEXT NOT NULL DEFAULT 'INV-', next_number INTEGER NOT NULL DEFAULT 1, footer_note TEXT NOT NULL DEFAULT '', reply_to TEXT NOT NULL DEFAULT '')`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS inv_invoices (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, client_id TEXT NOT NULL DEFAULT '', client_name TEXT NOT NULL DEFAULT '', client_email TEXT NOT NULL DEFAULT '', client_address TEXT NOT NULL DEFAULT '', number TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', issue_date TEXT NOT NULL, due_date TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'EUR', items TEXT NOT NULL DEFAULT '[]', vat_rate REAL NOT NULL DEFAULT 0, subtotal REAL NOT NULL DEFAULT 0, vat REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', recurring_id TEXT NOT NULL DEFAULT '', public_token TEXT NOT NULL, sent_at TEXT NOT NULL DEFAULT '', paid_at TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS inv_recurring (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, client_id TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', items TEXT NOT NULL DEFAULT '[]', vat_rate REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'EUR', interval TEXT NOT NULL DEFAULT 'monthly', next_date TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, auto_send INTEGER NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', last_run TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS inv_invoices_owner ON inv_invoices (owner_id, issue_date)`).run();
}

const cents = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
export const today = () => new Date().toISOString().slice(0, 10);
export function addDays(date: string, days: number) { const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
export function addInterval(date: string, interval: Interval) {
  const d = new Date(date + "T00:00:00Z"), day = d.getUTCDate();
  if (interval === "weekly") { d.setUTCDate(day + 7); return d.toISOString().slice(0, 10); }
  const months = interval === "monthly" ? 1 : interval === "quarterly" ? 3 : 12;
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last)); return d.toISOString().slice(0, 10);
}
export function cleanItems(raw: unknown): Item[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.slice(0, 40).map((i: any) => ({ description: String(i?.description || "").trim().slice(0, 300), qty: Math.max(0, Math.min(100000, Number(i?.qty) || 0)), unit: Math.max(-1e9, Math.min(1e9, Number(i?.unit) || 0)) })).filter((i) => i.description);
}
export function totals(items: Item[], vatRate: number) {
  const subtotal = cents(items.reduce((s, i) => s + i.qty * i.unit, 0)), rate = Math.max(0, Math.min(100, Number(vatRate) || 0)), vat = cents(subtotal * rate / 100);
  return { subtotal, vat, total: cents(subtotal + vat), vatRate: rate };
}

export async function loadSettings(ownerId: string): Promise<InvSettings> {
  await ensureTables();
  const r = await env.DB!.prepare("SELECT * FROM inv_settings WHERE owner_id=?1").bind(ownerId).first<any>();
  return { businessName: r?.business_name || "", address: r?.address || "", vatNumber: r?.vat_number || "", bankDetails: r?.bank_details || "", paymentTermsDays: r?.payment_terms_days ?? 14, prefix: r?.prefix ?? "INV-", nextNumber: r?.next_number ?? 1, footerNote: r?.footer_note || "", replyTo: r?.reply_to || "" };
}
export async function saveSettings(ownerId: string, s: Partial<InvSettings>) {
  const cur = await loadSettings(ownerId);
  const m = { ...cur, ...s };
  await env.DB!.prepare(`INSERT INTO inv_settings (owner_id, business_name, address, vat_number, bank_details, payment_terms_days, prefix, next_number, footer_note, reply_to) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
    ON CONFLICT(owner_id) DO UPDATE SET business_name=?2, address=?3, vat_number=?4, bank_details=?5, payment_terms_days=?6, prefix=?7, next_number=?8, footer_note=?9, reply_to=?10`)
    .bind(ownerId, String(m.businessName).slice(0, 120), String(m.address).slice(0, 400), String(m.vatNumber).slice(0, 40), String(m.bankDetails).slice(0, 600), Math.max(0, Math.min(120, Math.round(Number(m.paymentTermsDays) || 0))), String(m.prefix).slice(0, 12), Math.max(1, Math.round(Number(m.nextNumber) || 1)), String(m.footerNote).slice(0, 400), String(m.replyTo).slice(0, 200)).run();
}
async function takeNumber(ownerId: string) {
  const s = await loadSettings(ownerId);
  await saveSettings(ownerId, { nextNumber: s.nextNumber + 1 });
  return `${s.prefix}${String(s.nextNumber).padStart(4, "0")}`;
}

export async function createInvoice(ownerId: string, p: { clientId: string; clientName: string; clientEmail: string; clientAddress?: string; issueDate: string; dueDate: string; currency: string; items: Item[]; vatRate: number; notes?: string; recurringId?: string }) {
  const t = totals(p.items, p.vatRate), id = crypto.randomUUID(), token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, ""), now = new Date().toISOString();
  const number = await takeNumber(ownerId);
  await env.DB!.prepare(`INSERT INTO inv_invoices (id, owner_id, client_id, client_name, client_email, client_address, number, status, issue_date, due_date, currency, items, vat_rate, subtotal, vat, total, notes, recurring_id, public_token, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,'draft',?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)`)
    .bind(id, ownerId, p.clientId, p.clientName.slice(0, 160), p.clientEmail.slice(0, 200), (p.clientAddress || "").slice(0, 400), number, p.issueDate, p.dueDate, p.currency.slice(0, 3).toUpperCase(), JSON.stringify(p.items), t.vatRate, t.subtotal, t.vat, t.total, (p.notes || "").slice(0, 1000), p.recurringId || "", token, now).run();
  return id;
}

/** Create every invoice that is due from active recurring schedules (catches up missed periods, max 12 per schedule per run). */
export async function runRecurring(ownerId: string, clients: Array<{ id: string; name: string; email?: string }>) {
  await ensureTables();
  const db = env.DB!, settings = await loadSettings(ownerId), made: string[] = [];
  const due = (await db.prepare("SELECT * FROM inv_recurring WHERE owner_id=?1 AND active=1 AND next_date<=?2").bind(ownerId, today()).all<any>()).results || [];
  for (const r of due) {
    let next = r.next_date, guard = 0;
    while (next <= today() && guard++ < 12) {
      // optimistic claim so two parallel opens can't both create the same invoice
      const claim = await db.prepare("UPDATE inv_recurring SET next_date=?3, last_run=?4 WHERE id=?1 AND next_date=?2").bind(r.id, next, addInterval(next, r.interval), next).run();
      if (claim.meta.changes !== 1) break;
      const c = clients.find((x) => x.id === r.client_id);
      const id = await createInvoice(ownerId, { clientId: r.client_id, clientName: c?.name || "", clientEmail: c?.email || "", issueDate: next, dueDate: addDays(next, settings.paymentTermsDays), currency: r.currency, items: JSON.parse(r.items || "[]"), vatRate: r.vat_rate, notes: r.notes, recurringId: r.id });
      made.push(id + (r.auto_send ? ":send" : ""));
      next = addInterval(next, r.interval);
    }
  }
  return made;
}

export const money = (n: number, currency: string) => new Intl.NumberFormat("en-IE", { style: "currency", currency: currency || "EUR" }).format(n || 0);
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function invoiceHtml(inv: any, s: InvSettings, status: string) {
  const items: Item[] = JSON.parse(inv.items || "[]");
  const rows = items.map((i) => `<tr><td>${esc(i.description)}</td><td class="r">${i.qty}</td><td class="r">${esc(money(i.unit, inv.currency))}</td><td class="r">${esc(money(i.qty * i.unit, inv.currency))}</td></tr>`).join("");
  const badge = status === "paid" ? `<span class="b paid">PAID</span>` : status === "void" ? `<span class="b">VOID</span>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Invoice ${esc(inv.number)}</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f5f8;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1c2330}.wrap{max-width:820px;margin:24px auto;padding:0 14px}.bar{display:flex;justify-content:flex-end;margin-bottom:12px}.bar button{padding:10px 18px;border:0;border-radius:10px;background:#2f7de1;color:#fff;font-weight:700;font-size:14px;cursor:pointer}
.sheet{background:#fff;border-radius:16px;padding:44px;box-shadow:0 8px 30px rgba(0,0,0,.08)}h1{margin:0;font-size:30px;letter-spacing:-.02em}.top{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}.muted{color:#667085;font-size:13px;white-space:pre-line}.b{display:inline-block;margin-left:10px;padding:3px 12px;border-radius:99px;background:#eef1f5;font-size:12px;font-weight:800;vertical-align:middle}.b.paid{background:#d3f5e0;color:#0c7a3d}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:18px;margin:30px 0}.meta b{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#667085;margin-bottom:4px}table{width:100%;border-collapse:collapse;margin-top:6px}th{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#667085;text-align:left;border-bottom:2px solid #e4e8ef;padding:10px 6px}td{padding:12px 6px;border-bottom:1px solid #eef1f5;vertical-align:top}.r{text-align:right}.tot{margin-left:auto;margin-top:18px;width:min(300px,100%)}.tot div{display:flex;justify-content:space-between;padding:6px 0}.tot .g{border-top:2px solid #1c2330;margin-top:6px;padding-top:12px;font-size:20px;font-weight:800}
.pay{margin-top:30px;padding:16px 18px;border-radius:12px;background:#f6f8fb}.pay b{display:block;margin-bottom:6px}@media print{body{background:#fff}.bar{display:none}.sheet{box-shadow:none;padding:0}}@media(max-width:600px){.sheet{padding:22px}}</style></head><body><div class="wrap"><div class="bar"><button onclick="window.print()">Download / print PDF</button></div><div class="sheet">
<div class="top"><div><h1>Invoice ${badge}</h1><div class="muted">${esc(inv.number)}</div></div><div style="text-align:right"><b>${esc(s.businessName || "")}</b><div class="muted">${esc(s.address)}${s.vatNumber ? "\nVAT: " + esc(s.vatNumber) : ""}</div></div></div>
<div class="meta"><div><b>Billed to</b>${esc(inv.client_name)}<div class="muted">${esc(inv.client_address)}${inv.client_email ? "\n" + esc(inv.client_email) : ""}</div></div><div><b>Issued</b>${esc(inv.issue_date)}</div><div><b>Due</b>${esc(inv.due_date)}</div></div>
<table><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<div class="tot"><div><span>Subtotal</span><span>${esc(money(inv.subtotal, inv.currency))}</span></div>${inv.vat_rate ? `<div><span>VAT ${inv.vat_rate}%</span><span>${esc(money(inv.vat, inv.currency))}</span></div>` : ""}<div class="g"><span>Total</span><span>${esc(money(inv.total, inv.currency))}</span></div></div>
${s.bankDetails && status !== "paid" ? `<div class="pay"><b>How to pay</b><div class="muted">${esc(s.bankDetails)}\nReference: ${esc(inv.number)}</div></div>` : ""}${inv.notes ? `<p class="muted" style="margin-top:22px">${esc(inv.notes)}</p>` : ""}${s.footerNote ? `<p class="muted" style="margin-top:22px">${esc(s.footerNote)}</p>` : ""}
</div></div></body></html>`;
}

export async function sendInvoiceEmail(inv: any, s: InvSettings, origin: string, adminEmail: string) {
  if (!env.RESEND_API_KEY || !env.TASK_NOTIFICATION_FROM) throw new Error("Email sending isn't set up on the server yet (RESEND_API_KEY and TASK_NOTIFICATION_FROM).");
  if (!inv.client_email || !inv.client_email.includes("@")) throw new Error("This client has no email address. Add one to the invoice first.");
  const link = `${origin}/api/marketing-public/invoice?token=${inv.public_token}`;
  const biz = s.businessName || "F2B Media";
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;color:#1c2330"><h2 style="margin:0 0 8px">Invoice ${esc(inv.number)} from ${esc(biz)}</h2><p>Hi ${esc(inv.client_name)},</p><p>Your invoice for <b>${esc(money(inv.total, inv.currency))}</b> is ready. It's due on <b>${esc(inv.due_date)}</b>.</p><p style="margin:24px 0"><a href="${link}" style="background:#2f7de1;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700">View invoice</a></p>${s.bankDetails ? `<p style="white-space:pre-line;color:#475467;font-size:14px"><b>How to pay</b>\n${esc(s.bankDetails)}\nReference: ${esc(inv.number)}</p>` : ""}<p style="color:#667085;font-size:13px">Thank you,<br>${esc(biz)}</p></div>`;
  const res = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `invoice/${inv.id}/${Date.now()}` }, body: JSON.stringify({ from: env.TASK_NOTIFICATION_FROM, to: [inv.client_email], reply_to: s.replyTo || adminEmail || undefined, subject: `Invoice ${inv.number} from ${biz}`, html }) });
  if (!res.ok) throw new Error(`The email could not be sent (HTTP ${res.status}).`);
}
