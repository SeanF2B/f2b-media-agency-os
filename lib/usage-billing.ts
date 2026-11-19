import { env } from "cloudflare:workers";
import { addDays, cleanItems, createInvoice, ensureTables, loadSettings, totals, today } from "@/lib/invoicing/core";
import { audit, billable, ensureUsageTables, loadBilling, markupFor } from "@/lib/usage-meter";

// Monthly AI & SEO-data rebilling: on the 1st–3rd of each month, last month's unbilled usage for every client
// becomes ONE line on that client's draft invoice (an existing draft is reused, otherwise a new draft is made).
// Drafts are never sent automatically; the agency reviews and sends them from Books → Invoicing.

const monthLabel = (ym: string) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString("en-IE", { month: "long", year: "numeric" });
export function previousMonth(now: Date) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)); return d.toISOString().slice(0, 7); }

async function workspace() {
  const row = await env.DB!.prepare("SELECT owner_id, data FROM workspace_documents WHERE id='f2b-agency'").first<{ owner_id: string; data: string }>();
  let ws: any = {}; try { ws = JSON.parse(row?.data || "{}"); } catch { /* empty */ }
  return { ownerId: String(row?.owner_id || ws.ownerId || ""), clients: (ws.clients || []) as any[], currency: String(ws.settings?.currency || "EUR") };
}

/** Bill one month (YYYY-MM). Safe to run repeatedly: rows already on an invoice are skipped. */
export async function draftUsageInvoices(month: string, actor = "system") {
  const db = env.DB!;
  await ensureUsageTables(db); await ensureTables();
  const { ownerId, clients, currency } = await workspace();
  if (!ownerId) return { drafted: 0 };
  const b = await loadBilling(db, ownerId);
  if (!b.settings.enabled) return { drafted: 0, skipped: "Rebilling is turned off." };
  const start = `${month}-01T00:00:00.000Z`, end = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 1)).toISOString();
  const kinds = b.settings.includeSeoData ? ["ai", "seo_data"] : ["ai"];
  const rows = (await db.prepare(`SELECT client_id, kind, COUNT(*) AS calls, SUM(cost_usd) AS cost FROM usage_log WHERE owner_id = ?1 AND created_at >= ?2 AND created_at < ?3 AND client_id <> '' AND invoice_id = '' AND kind IN (${kinds.map((_, i) => `?${i + 4}`).join(",")}) GROUP BY client_id, kind`).bind(ownerId, start, end, ...kinds).all<{ client_id: string; kind: string; calls: number; cost: number }>()).results || [];
  const byClient = new Map<string, { ai: number; seo: number; calls: number }>();
  for (const r of rows) { const g = byClient.get(r.client_id) || { ai: 0, seo: 0, calls: 0 }; if (r.kind === "ai") g.ai += Number(r.cost) || 0; else g.seo += Number(r.cost) || 0; g.calls += Number(r.calls) || 0; byClient.set(r.client_id, g); }
  let drafted = 0;
  for (const [clientId, g] of byClient) {
    const client = clients.find((c) => String(c.id) === clientId);
    if (!client || /^(inactive|archived)$/i.test(String(client.status || ""))) continue;
    if (b.clients.get(clientId)?.enabled === false) continue;
    const markup = markupFor(b, clientId);
    const amount = billable(g.ai + g.seo, b.settings.usdRate, markup);
    if (amount <= 0 || amount < b.settings.minCharge) continue;
    const parts = [g.ai > 0 ? "AI" : "", g.seo > 0 ? "SEO data" : ""].filter(Boolean).join(" & ");
    const item = { description: `${parts} usage · ${monthLabel(month)} (${g.calls} request${g.calls === 1 ? "" : "s"})`, qty: 1, unit: amount };
    const draft = await db.prepare("SELECT id, items, vat_rate FROM inv_invoices WHERE owner_id = ?1 AND client_id = ?2 AND status = 'draft' ORDER BY created_at DESC LIMIT 1").bind(ownerId, clientId).first<{ id: string; items: string; vat_rate: number }>();
    let invoiceId = "";
    if (draft) {
      const items = cleanItems([...JSON.parse(draft.items || "[]"), item]); const t = totals(items, draft.vat_rate);
      await db.prepare("UPDATE inv_invoices SET items = ?3, subtotal = ?4, vat = ?5, total = ?6 WHERE id = ?1 AND owner_id = ?2").bind(draft.id, ownerId, JSON.stringify(items), t.subtotal, t.vat, t.total).run();
      invoiceId = draft.id;
    } else {
      const last = await db.prepare("SELECT vat_rate FROM inv_invoices WHERE owner_id = ?1 AND client_id = ?2 ORDER BY created_at DESC LIMIT 1").bind(ownerId, clientId).first<{ vat_rate: number }>();
      const s = await loadSettings(ownerId); const issue = today();
      invoiceId = await createInvoice(ownerId, { clientId, clientName: String(client.company || client.name || ""), clientEmail: String(client.email || ""), issueDate: issue, dueDate: addDays(issue, s.paymentTermsDays), currency: String(client.currency || currency || "EUR"), items: [item], vatRate: Number(last?.vat_rate) || 0, notes: "AI & SEO data usage is billed at cost plus a service margin. A full usage report is available on request." });
    }
    await db.prepare(`UPDATE usage_log SET invoice_id = ?4 WHERE owner_id = ?1 AND client_id = ?2 AND created_at >= ?3 AND created_at < ?5 AND invoice_id = '' AND kind IN (${kinds.map((_, i) => `?${i + 6}`).join(",")})`).bind(ownerId, clientId, start, invoiceId, end, ...kinds).run();
    await audit(db, ownerId, "invoice-line-drafted", { month, invoiceId, amount, costUsd: Math.round((g.ai + g.seo) * 1e4) / 1e4, markupPct: markup, usdRate: b.settings.usdRate, calls: g.calls, reusedDraft: Boolean(draft) }, actor, clientId);
    drafted++;
  }
  return { drafted };
}

/** Cron: on the 1st–3rd, bill last month once. */
export async function processUsageInvoices(now = new Date()) {
  if (!env.DB || now.getUTCDate() > 3) return;
  const month = previousMonth(now);
  await ensureUsageTables(env.DB);
  const { ownerId } = await workspace();
  const done = await env.DB.prepare("SELECT 1 FROM usage_billing_audit WHERE owner_id = ?1 AND action = 'month-billed' AND detail = ?2 LIMIT 1").bind(ownerId, JSON.stringify({ month })).first();
  if (done) return;
  await draftUsageInvoices(month, "system");
  await audit(env.DB, ownerId, "month-billed", { month }, "system");
}
