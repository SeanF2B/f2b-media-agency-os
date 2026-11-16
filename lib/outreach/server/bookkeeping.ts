// Posts Outreach's real running costs into Books → Expenses (agency-level, category "Software"),
// in your account currency. Each entry has a fixed id, so nothing is ever posted twice, and the
// workspace is updated with the same optimistic-concurrency pattern as recurring expenses.
import { convertCents, type FxRates } from "@/lib/outreach/fx.mjs";
import { accountCurrency, usdRates } from "./money";
import { audit, db, getSettings, saveSettings } from "./store";

type Row = Record<string, any>;
export type ExpenseEntry = { id: string; kind: "Expense"; description: string; category: string; amount: number; date: string; clientId: string; source: "outreach" };

/** Adds entries whose id isn't already in the books. Returns how many were added. */
export async function addExpenses(entries: ExpenseEntry[]): Promise<number> {
  if (!entries.length) return 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const row = await db().prepare("SELECT data, updated_at FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string; updated_at: string }>();
    if (!row?.data) return 0;
    let current: Row;
    try { current = JSON.parse(row.data); } catch { return 0; }
    const records: Row[] = Array.isArray(current.financeRecords) ? [...current.financeRecords] : [];
    const existing = new Set(records.map((record) => String(record.id)));
    const fresh = entries.filter((entry) => !existing.has(entry.id) && entry.amount > 0);
    if (!fresh.length) return 0;
    const next = { ...current, financeRecords: [...fresh, ...records] };
    const revision = `outreach-${crypto.randomUUID()}`;
    const result = await db().prepare("UPDATE workspace_documents SET data = ?1, updated_at = ?2 WHERE id = 'f2b-agency' AND updated_at = ?3").bind(JSON.stringify(next), revision, row.updated_at).run();
    if (result.meta.changes === 1) return fresh.length;
  }
  throw new Error("Books were busy; Outreach expenses will be retried on the next run.");
}

const ymd = (date: Date) => date.toISOString().slice(0, 10);
const major = (cents: number | null) => (cents === null ? 0 : Math.round(cents) / 100);
const monthName = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-IE", { month: "long", year: "numeric", timeZone: "UTC" });

/** The expenses for one finished month (pure apart from DB reads). */
export async function monthExpenses(ownerId: string, month: string, currency: string, fx: FxRates | null, sync: { mailboxes: boolean; instantly: boolean; ai: boolean }, seatPrices: Row, instantlyPlanCents: number | null) {
  const start = `${month}-01`;
  const endDate = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
  const end = ymd(endDate); const nextStart = ymd(new Date(endDate.getTime() + 86_400_000));
  const out: ExpenseEntry[] = [];
  if (sync.mailboxes) {
    // Mailboxes that existed during the month, at the seat price you entered (account currency).
    const rows = (await db().prepare("SELECT host, monthly_cost_cents FROM outreach_mailboxes WHERE owner_id = ?1 AND created_at < ?2").bind(ownerId, nextStart).all<Row>()).results || [];
    const cents = rows.reduce((sum, row) => sum + (Number.isFinite(row.monthly_cost_cents) ? row.monthly_cost_cents : Number(seatPrices?.[row.host] ?? 0)), 0);
    if (cents > 0) out.push({ id: `outreach-mailboxes-${month}`, kind: "Expense", description: `Outreach mailboxes (${rows.length}) · ${monthName(month)}`, category: "Software", amount: major(cents), date: end, clientId: "", source: "outreach" });
  }
  if (sync.instantly && Number.isFinite(instantlyPlanCents)) {
    const connection = await db().prepare("SELECT created_at FROM outreach_connections WHERE owner_id = ?1 AND provider = 'instantly'").bind(ownerId).first<Row>();
    if (connection && String(connection.created_at) < nextStart) {
      const cents = convertCents(instantlyPlanCents, "USD", currency, fx);
      if (cents) out.push({ id: `outreach-instantly-${month}`, kind: "Expense", description: `Instantly warm-up plan · ${monthName(month)}${currency !== "USD" ? ` (US$${(instantlyPlanCents! / 100).toFixed(2)})` : ""}`, category: "Software", amount: major(cents), date: end, clientId: "", source: "outreach" });
    }
  }
  if (sync.ai) {
    const row = await db().prepare("SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM outreach_ai_usage WHERE owner_id = ?1 AND day >= ?2 AND day <= ?3").bind(ownerId, start, end).first<Row>();
    const cents = convertCents(Math.round(Number(row?.usd || 0) * 100), "USD", currency, fx);
    if (cents) out.push({ id: `outreach-ai-${month}`, kind: "Expense", description: `Outreach AI (OpenRouter) · ${monthName(month)}`, category: "Software", amount: major(cents), date: end, clientId: "", source: "outreach" });
  }
  return out;
}

/** Domain purchases and yearly renewals, on the day each is charged. */
export async function domainExpenses(ownerId: string, today: string, currency: string, fx: FxRates | null) {
  const rows = (await db().prepare("SELECT domain, registered_at, annual_cost_cents FROM outreach_domains WHERE owner_id = ?1 AND protected = 0 AND registered_at IS NOT NULL").bind(ownerId).all<Row>()).results || [];
  const out: ExpenseEntry[] = [];
  for (const row of rows) {
    const registered = String(row.registered_at).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(registered)) continue;
    for (let year = 0; year < 20; year += 1) {
      const date = `${Number(registered.slice(0, 4)) + year}${registered.slice(4)}`;
      if (date > today) break;
      const cents = convertCents(row.annual_cost_cents, "USD", currency, fx);
      if (!cents) continue;
      out.push({ id: `outreach-domain-${row.domain}-${date}`, kind: "Expense", description: `${year === 0 ? "Domain registration" : "Domain renewal"} · ${row.domain}`, category: "Software", amount: major(cents), date, clientId: "", source: "outreach" });
    }
  }
  return out;
}

/** Engine pass (hourly): post last month's running costs once, and any domain charges due. */
export async function postOutreachExpenses(ownerId: string, now: Date) {
  const settings = await getSettings(ownerId);
  if (!settings.expenseSync.enabled) return { posted: 0, reason: "off" };
  const currency = await accountCurrency();
  const fx = currency === "USD" ? null : await usdRates(ownerId, settings);
  if (currency !== "USD" && !fx) return { posted: 0, reason: "no exchange rate yet" };
  const entries: ExpenseEntry[] = [];
  const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)).toISOString().slice(0, 7);
  const monthly = settings.expensePostedMonth !== previous;
  if (monthly) entries.push(...await monthExpenses(ownerId, previous, currency, fx, settings.expenseSync, settings.seatPriceCents, settings.instantlyPlanCents));
  if (settings.expenseSync.domains) entries.push(...await domainExpenses(ownerId, ymd(now), currency, fx));
  const posted = await addExpenses(entries);
  if (monthly) await saveSettings(ownerId, { expensePostedMonth: previous });
  if (posted) await audit(ownerId, "engine", "expenses-posted", `${posted} entr${posted === 1 ? "y" : "ies"}`, { currency, month: monthly ? previous : null });
  return { posted, currency };
}

