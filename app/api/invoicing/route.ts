import { env } from "cloudflare:workers";
import { authorizeAdmin, respond } from "@/lib/settings-auth";
import { addDays, addInterval, cleanItems, createInvoice, ensureTables, loadSettings, runRecurring, saveSettings, sendInvoiceEmail, today, totals, type Interval } from "@/lib/invoicing/core";

export const dynamic = "force-dynamic";
const INTERVALS = ["weekly", "monthly", "quarterly", "yearly"];
const date = (v: unknown, fallback: string) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : fallback;

async function workspaceInfo() {
  const row = await env.DB!.prepare("SELECT data FROM workspace_documents WHERE id='f2b-agency'").first<{ data: string }>();
  let ws: any = {}; try { ws = JSON.parse(row?.data || "{}"); } catch { /* ignore */ }
  const clients = (ws.clients || []).map((c: any) => ({ id: String(c.id), name: String(c.company || c.name || ""), email: String(c.email || ""), currency: String(c.currency || ""), fee: (c.services || []).reduce((n: number, s: any) => n + (Number(s.fee) || 0), 0), services: (c.services || []).filter((s: any) => Number(s.fee) > 0).map((s: any) => ({ name: String(s.name || s.type || "Service"), fee: Number(s.fee) })) }));
  return { clients, currency: String(ws.settings?.currency || "EUR"), adminEmail: String(ws.settings?.adminEmail || "") };
}
const shape = (r: any) => { const overdue = r.status === "sent" && r.due_date < today(); return { id: r.id, clientId: r.client_id, clientName: r.client_name, clientEmail: r.client_email, clientAddress: r.client_address, number: r.number, status: overdue ? "overdue" : r.status, rawStatus: r.status, issueDate: r.issue_date, dueDate: r.due_date, currency: r.currency, items: JSON.parse(r.items || "[]"), vatRate: r.vat_rate, subtotal: r.subtotal, vat: r.vat, total: r.total, notes: r.notes, recurringId: r.recurring_id, sentAt: r.sent_at, paidAt: r.paid_at, link: `/api/marketing-public/invoice?token=${r.public_token}` }; };

export async function GET(request: Request) {
  const auth = await authorizeAdmin("open Invoicing");
  if (auth.error) return auth.error;
  try {
    await ensureTables();
    const info = await workspaceInfo(), url = new URL(request.url), scope = url.searchParams.get("clientId") || "agency";
    const settings = await loadSettings(auth.ownerId), mailReady = Boolean(env.RESEND_API_KEY && env.TASK_NOTIFICATION_FROM);
    const made = await runRecurring(auth.ownerId, info.clients);
    for (const entry of made) if (entry.endsWith(":send")) { const id = entry.slice(0, -5); const inv = await env.DB!.prepare("SELECT * FROM inv_invoices WHERE id=?1").bind(id).first<any>(); try { await sendInvoiceEmail(inv, settings, url.origin, info.adminEmail); await env.DB!.prepare("UPDATE inv_invoices SET status='sent', sent_at=?2 WHERE id=?1").bind(id, new Date().toISOString()).run(); } catch (e) { console.error("auto-send", e); } }
    const where = scope === "agency" ? "owner_id=?1" : "owner_id=?1 AND client_id=?2", bind = (st: D1PreparedStatement) => scope === "agency" ? st.bind(auth.ownerId) : st.bind(auth.ownerId, scope);
    const invoices = ((await bind(env.DB!.prepare(`SELECT * FROM inv_invoices WHERE ${where} ORDER BY issue_date DESC, number DESC LIMIT 500`)).all<any>()).results || []).map(shape);
    const recurring = ((await bind(env.DB!.prepare(`SELECT * FROM inv_recurring WHERE ${where} ORDER BY next_date`)).all<any>()).results || []).map((r: any) => ({ id: r.id, clientId: r.client_id, title: r.title, items: JSON.parse(r.items || "[]"), vatRate: r.vat_rate, currency: r.currency, interval: r.interval, nextDate: r.next_date, active: r.active === 1, autoSend: r.auto_send === 1, notes: r.notes }));
    return respond({ invoices, recurring, settings, clients: info.clients, currency: info.currency, mailReady, generated: made.length });
  } catch (e) { console.error("invoicing GET", e); return respond({ error: "Could not load invoices." }, 503); }
}

export async function POST(request: Request) {
  const auth = await authorizeAdmin("use Invoicing");
  if (auth.error) return auth.error;
  let b: any; try { b = await request.json(); } catch { return respond({ error: "Send a valid request." }, 400); }
  try {
    await ensureTables();
    const info = await workspaceInfo(), origin = new URL(request.url).origin, action = String(b.action || ""), now = new Date().toISOString();
    if (action === "save-settings") { await saveSettings(auth.ownerId, b.settings || {}); return respond({ settings: await loadSettings(auth.ownerId) }); }
    if (action === "save-invoice") {
      const items = cleanItems(b.items); if (!items.length) return respond({ error: "Add at least one line item." }, 400);
      const client = info.clients.find((c: any) => c.id === b.clientId); const s = await loadSettings(auth.ownerId);
      const issue = date(b.issueDate, today()), due = date(b.dueDate, addDays(issue, s.paymentTermsDays));
      const name = String(b.clientName || client?.name || "").trim(); if (!name) return respond({ error: "Choose a client or type a name." }, 400);
      if (b.id) {
        const cur = await env.DB!.prepare("SELECT status FROM inv_invoices WHERE id=?1 AND owner_id=?2").bind(b.id, auth.ownerId).first<any>();
        if (!cur) return respond({ error: "Invoice not found." }, 404);
        if (cur.status === "paid" || cur.status === "void") return respond({ error: "Paid or void invoices can't be edited." }, 400);
        const t = totals(items, b.vatRate);
        await env.DB!.prepare("UPDATE inv_invoices SET client_id=?3, client_name=?4, client_email=?5, client_address=?6, issue_date=?7, due_date=?8, currency=?9, items=?10, vat_rate=?11, subtotal=?12, vat=?13, total=?14, notes=?15 WHERE id=?1 AND owner_id=?2")
          .bind(b.id, auth.ownerId, String(b.clientId || ""), name.slice(0, 160), String(b.clientEmail || "").slice(0, 200), String(b.clientAddress || "").slice(0, 400), issue, due, String(b.currency || info.currency).slice(0, 3).toUpperCase(), JSON.stringify(items), t.vatRate, t.subtotal, t.vat, t.total, String(b.notes || "").slice(0, 1000)).run();
        return respond({ id: b.id });
      }
      const id = await createInvoice(auth.ownerId, { clientId: String(b.clientId || ""), clientName: name, clientEmail: String(b.clientEmail || client?.email || ""), clientAddress: String(b.clientAddress || ""), issueDate: issue, dueDate: due, currency: String(b.currency || client?.currency || info.currency), items, vatRate: Number(b.vatRate) || 0, notes: String(b.notes || "") });
      return respond({ id });
    }
    if (["send", "mark-paid", "void", "delete", "mark-unpaid"].includes(action)) {
      const inv = await env.DB!.prepare("SELECT * FROM inv_invoices WHERE id=?1 AND owner_id=?2").bind(b.id, auth.ownerId).first<any>();
      if (!inv) return respond({ error: "Invoice not found." }, 404);
      if (action === "send") { await sendInvoiceEmail(inv, await loadSettings(auth.ownerId), origin, info.adminEmail); await env.DB!.prepare("UPDATE inv_invoices SET status=CASE WHEN status='draft' THEN 'sent' ELSE status END, sent_at=?2 WHERE id=?1").bind(inv.id, now).run(); }
      if (action === "mark-paid") await env.DB!.prepare("UPDATE inv_invoices SET status='paid', paid_at=?2 WHERE id=?1").bind(inv.id, date(b.paidAt, today())).run();
      if (action === "mark-unpaid") await env.DB!.prepare("UPDATE inv_invoices SET status=CASE WHEN sent_at<>'' THEN 'sent' ELSE 'draft' END, paid_at='' WHERE id=?1").bind(inv.id).run();
      if (action === "void") await env.DB!.prepare("UPDATE inv_invoices SET status='void' WHERE id=?1").bind(inv.id).run();
      if (action === "delete") { if (inv.status !== "draft") return respond({ error: "Only drafts can be deleted. Void it instead." }, 400); await env.DB!.prepare("DELETE FROM inv_invoices WHERE id=?1").bind(inv.id).run(); }
      return respond({ ok: true });
    }
    if (action === "save-recurring") {
      const items = cleanItems(b.items); if (!items.length) return respond({ error: "Add at least one line item." }, 400);
      if (!b.clientId) return respond({ error: "Choose a client." }, 400);
      const interval = INTERVALS.includes(b.interval) ? b.interval as Interval : "monthly", next = date(b.nextDate, today());
      const client = info.clients.find((c: any) => c.id === b.clientId);
      const vals = [String(b.clientId), String(b.title || "").slice(0, 120), JSON.stringify(items), Math.max(0, Math.min(100, Number(b.vatRate) || 0)), String(b.currency || client?.currency || info.currency).slice(0, 3).toUpperCase(), interval, next, b.active === false ? 0 : 1, b.autoSend ? 1 : 0, String(b.notes || "").slice(0, 1000)];
      if (b.id) await env.DB!.prepare("UPDATE inv_recurring SET client_id=?3, title=?4, items=?5, vat_rate=?6, currency=?7, interval=?8, next_date=?9, active=?10, auto_send=?11, notes=?12 WHERE id=?1 AND owner_id=?2").bind(b.id, auth.ownerId, ...vals).run();
      else await env.DB!.prepare("INSERT INTO inv_recurring (id, owner_id, client_id, title, items, vat_rate, currency, interval, next_date, active, auto_send, notes, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)").bind(crypto.randomUUID(), auth.ownerId, ...vals, now).run();
      return respond({ ok: true });
    }
    if (action === "toggle-recurring") { await env.DB!.prepare("UPDATE inv_recurring SET active=?3 WHERE id=?1 AND owner_id=?2").bind(b.id, auth.ownerId, b.active ? 1 : 0).run(); return respond({ ok: true }); }
    if (action === "delete-recurring") { await env.DB!.prepare("DELETE FROM inv_recurring WHERE id=?1 AND owner_id=?2").bind(b.id, auth.ownerId).run(); return respond({ ok: true }); }
    return respond({ error: "Unknown action." }, 400);
  } catch (e) { console.error("invoicing POST", e); return respond({ error: e instanceof Error ? e.message : "Something went wrong." }, 400); }
}
void addInterval;
