// Account credit (prepaid balance) per client, and clients' service cancellation requests.
// Credit ledger: top-ups (bought via an invoice, or added by the agency) are positive; usage taken at the monthly
// billing run and agency adjustments can be negative. Balance = sum of the ledger.

type Db = D1Database;
let ready: Promise<unknown> | null = null;
export function ensureCreditTables(db: Db) {
  ready ||= db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS usage_credits (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, client_id TEXT NOT NULL, amount REAL NOT NULL, kind TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', invoice_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'posted', actor TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS usage_credits_client ON usage_credits (owner_id, client_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS usage_credits_invoice ON usage_credits (invoice_id)"),
    db.prepare("CREATE TABLE IF NOT EXISTS service_cancellations (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, client_id TEXT NOT NULL, services TEXT NOT NULL DEFAULT '[]', reason TEXT NOT NULL DEFAULT '', end_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'requested', requested_by TEXT NOT NULL DEFAULT '', decided_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, decided_at TEXT NOT NULL DEFAULT '')"),
    db.prepare("CREATE INDEX IF NOT EXISTS service_cancellations_client ON service_cancellations (owner_id, client_id, created_at)"),
  ]).catch((e) => { ready = null; throw e; });
  return ready;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
export type CreditEntry = { id: string; amount: number; kind: string; note: string; invoiceId: string; status: string; actor: string; at: string };

export async function creditBalance(db: Db, owner: string, clientId: string) {
  await ensureCreditTables(db);
  const row = await db.prepare("SELECT COALESCE(SUM(amount),0) AS bal FROM usage_credits WHERE owner_id=?1 AND client_id=?2 AND status='posted'").bind(owner, clientId).first<{ bal: number }>();
  return r2(Number(row?.bal) || 0);
}
export async function creditHistory(db: Db, owner: string, clientId: string, limit = 30): Promise<CreditEntry[]> {
  await ensureCreditTables(db);
  const rows = (await db.prepare("SELECT * FROM usage_credits WHERE owner_id=?1 AND client_id=?2 ORDER BY created_at DESC LIMIT ?3").bind(owner, clientId, limit).all<any>()).results || [];
  return rows.map((r: any) => ({ id: r.id, amount: Number(r.amount), kind: r.kind, note: r.note, invoiceId: r.invoice_id, status: r.status, actor: r.actor, at: r.created_at }));
}
export async function addCredit(db: Db, owner: string, clientId: string, e: { amount: number; kind: "topup" | "adjustment" | "usage" | "refund"; note?: string; invoiceId?: string; status?: "posted" | "pending"; actor?: string }) {
  await ensureCreditTables(db);
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO usage_credits (id, owner_id, client_id, amount, kind, note, invoice_id, status, actor, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)")
    .bind(id, owner, clientId, r2(e.amount), e.kind, String(e.note || "").slice(0, 300), e.invoiceId || "", e.status || "posted", String(e.actor || "system").slice(0, 160), new Date().toISOString()).run();
  return id;
}
/** A credit top-up invoice was paid: its pending credit becomes spendable. Safe to call for any invoice. */
export async function settleCreditInvoice(db: Db, invoiceId: string, paid: boolean) {
  await ensureCreditTables(db);
  await db.prepare("UPDATE usage_credits SET status=?2 WHERE invoice_id=?1 AND kind='topup'").bind(invoiceId, paid ? "posted" : "pending").run();
}

/** Notice rules from the F2B standard terms: 30 days' notice, and not before the 90-day minimum term ends. */
export function cancellationEndDate(now: Date, startDate?: string) {
  const notice = new Date(now.getTime() + 30 * 86_400_000);
  const start = startDate && /^\d{4}-\d{2}-\d{2}/.test(startDate) ? new Date(`${startDate.slice(0, 10)}T00:00:00Z`) : null;
  const minimum = start ? new Date(start.getTime() + 90 * 86_400_000) : null;
  return (minimum && minimum > notice ? minimum : notice).toISOString().slice(0, 10);
}
export type Cancellation = { id: string; services: string[]; reason: string; endDate: string; status: string; requestedBy: string; decidedBy: string; at: string; decidedAt: string };
export async function cancellations(db: Db, owner: string, clientId: string): Promise<Cancellation[]> {
  await ensureCreditTables(db);
  const rows = (await db.prepare("SELECT * FROM service_cancellations WHERE owner_id=?1 AND client_id=?2 ORDER BY created_at DESC LIMIT 10").bind(owner, clientId).all<any>()).results || [];
  return rows.map((r: any) => ({ id: r.id, services: (() => { try { return JSON.parse(r.services); } catch { return []; } })(), reason: r.reason, endDate: r.end_date, status: r.status, requestedBy: r.requested_by, decidedBy: r.decided_by, at: r.created_at, decidedAt: r.decided_at }));
}
