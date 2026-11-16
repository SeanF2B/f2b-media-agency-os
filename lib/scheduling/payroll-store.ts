// Payroll storage (admins only): employer details, per-person payroll details and issued payslips.
// Taxes are recalculated here when a payslip is issued, so year-to-date figures always come from the saved register.
import { ensureSchedulingTables } from "./schema.ts";
import type { Db } from "./server.ts";
import { computePayslip, sanitizeEmployer, sanitizePerson, validPps, normalisePps, DEFAULT_EMPLOYER, DEFAULT_PERSON, EMPTY_YTD, type PayrollEmployer, type PayrollPerson, type PayslipResult, type Ytd } from "./payroll.ts";

export type PayLine = { label: string; detail: string; amount: number };
export type PayslipRecord = {
  key: string; number: number; staffId: string; staffName: string; role: string;
  payDate: string; periodStart: string; periodEnd: string; issuedAt: string; note: string;
  earnings: PayLine[]; deductions: PayLine[];
  employer: PayrollEmployer; person: PayrollPerson; result: PayslipResult;
  emailedTo?: string; emailedAt?: string;
};

const ymd = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: unknown, n: number) => (typeof v === "string" ? v.trim().replace(/[<>]/g, "").slice(0, n) : "");
const money = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.max(-1_000_000, Math.min(1_000_000, Math.round(n * 100) / 100)) : 0; };
const lines = (v: unknown): PayLine[] => Array.isArray(v) ? (v as unknown[]).slice(0, 120).map((x) => { const r = (x || {}) as Record<string, unknown>; return { label: clean(r.label, 120), detail: clean(r.detail, 160), amount: money(r.amount) }; }).filter((l) => l.label && l.amount !== 0) : [];
const parse = <T,>(raw: string | null | undefined, fallback: T): T => { try { return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } };

export async function getPayroll(db: Db, ownerId: string, scope: string, staffIds: string[], year: number) {
  await ensureSchedulingTables(db);
  const emp = await db.prepare("SELECT data FROM sched_payroll WHERE owner_id=?1 AND scope=?2 AND kind='employer' AND key='employer'").bind(ownerId, scope).first<{ data: string }>();
  const ids = [...new Set(staffIds)].slice(0, 100);
  const people: Record<string, PayrollPerson> = {};
  if (ids.length) {
    const rows = (await db.prepare(`SELECT key, data FROM sched_payroll WHERE owner_id=?1 AND scope=?2 AND kind='person' AND key IN (${ids.map((_, i) => `?${i + 3}`).join(",")})`).bind(ownerId, scope, ...ids).all<{ key: string; data: string }>()).results || [];
    for (const row of rows) people[row.key] = sanitizePerson(parse(row.data, {}));
  }
  const slips = ((await db.prepare("SELECT data FROM sched_payroll WHERE owner_id=?1 AND scope=?2 AND kind='slip' AND staff_id!='' AND pay_date>=?3 AND pay_date<?4 ORDER BY pay_date DESC LIMIT 400").bind(ownerId, scope, `${year}-01-01`, `${year + 1}-01-01`).all<{ data: string }>()).results || [])
    .map((r) => parse<PayslipRecord | null>(r.data, null)).filter((x): x is PayslipRecord => Boolean(x));
  return { employer: emp ? sanitizeEmployer(parse(emp.data, {})) : { ...DEFAULT_EMPLOYER }, people, slips };
}

export async function savePayrollEmployer(db: Db, ownerId: string, scope: string, input: unknown) {
  await ensureSchedulingTables(db);
  const employer = sanitizeEmployer(input);
  await db.prepare("INSERT INTO sched_payroll (owner_id, scope, kind, key, data, updated_at) VALUES (?1,?2,'employer','employer',?3,?4) ON CONFLICT(owner_id, scope, kind, key) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at").bind(ownerId, scope, JSON.stringify(employer), new Date().toISOString()).run();
  return employer;
}

export async function savePayrollPerson(db: Db, ownerId: string, scope: string, staffId: string, input: unknown) {
  await ensureSchedulingTables(db);
  const person = sanitizePerson(input);
  if (person.pps && !validPps(person.pps)) throw new Error("That PPS number isn't valid. It's 7 digits followed by one or two letters, e.g. 1234567TA.");
  await db.prepare("INSERT INTO sched_payroll (owner_id, scope, kind, key, staff_id, data, updated_at) VALUES (?1,?2,'person',?3,?3,?4,?5) ON CONFLICT(owner_id, scope, kind, key) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at").bind(ownerId, scope, staffId, JSON.stringify(person), new Date().toISOString()).run();
  return person;
}

async function ytdBefore(db: Db, ownerId: string, scope: string, staffId: string, payDate: string, key: string): Promise<Ytd> {
  const rows = (await db.prepare("SELECT key, data FROM sched_payroll WHERE owner_id=?1 AND scope=?2 AND kind='slip' AND staff_id=?3 AND pay_date>=?4 AND pay_date<=?5 LIMIT 120").bind(ownerId, scope, staffId, `${payDate.slice(0, 4)}-01-01`, payDate).all<{ key: string; data: string }>()).results || [];
  const ytd = { ...EMPTY_YTD };
  for (const row of rows) {
    if (row.key === key) continue;
    const rec = parse<PayslipRecord | null>(row.data, null); if (!rec) continue;
    if (rec.payDate === payDate && rec.key > key) continue; // same pay date: count only slips issued for earlier periods
    const r = rec.result;
    ytd.gross += r.gross; ytd.taxable += r.taxable; ytd.paye += r.paye; ytd.usc += r.usc; ytd.prsi += r.prsiEE; ytd.net += r.net; ytd.pension += r.pension;
  }
  return ytd;
}

/** Works out the payslip (with year-to-date figures from the register). `save` stores it in the register. */
export async function issuePayslip(db: Db, ownerId: string, scope: string, staff: { id: string; name: string; role?: string }, input: Record<string, unknown>, save: boolean) {
  await ensureSchedulingTables(db);
  const payDate = ymd.test(String(input.payDate)) ? String(input.payDate) : "";
  const periodStart = ymd.test(String(input.periodStart)) ? String(input.periodStart) : "";
  const periodEnd = ymd.test(String(input.periodEnd)) ? String(input.periodEnd) : "";
  if (!payDate || !periodStart || !periodEnd || periodEnd < periodStart) throw new Error("Pick a pay period and a pay date.");
  const data = await getPayroll(db, ownerId, scope, [staff.id], Number(payDate.slice(0, 4)));
  const person = data.people[staff.id] || { ...DEFAULT_PERSON };
  const earnings = lines(input.earnings);
  const deductions = lines(input.deductions).map((l) => ({ ...l, amount: Math.abs(l.amount) }));
  const key = `${staff.id}:${periodStart}:${periodEnd}`;
  const ytd = await ytdBefore(db, ownerId, scope, staff.id, payDate, key);
  const result = computePayslip({ person, gross: earnings.reduce((n, l) => n + l.amount, 0), otherDeductions: deductions.reduce((n, l) => n + l.amount, 0), payDate, periodStart, periodEnd, ytd });
  const existing = data.slips.find((s) => s.key === key);
  const record: PayslipRecord = {
    key, number: existing?.number || data.slips.reduce((m, s) => Math.max(m, s.number || 0), 0) + 1,
    staffId: staff.id, staffName: String(staff.name || "").split("|")[0].trim(), role: String(staff.role || ""),
    payDate, periodStart, periodEnd, issuedAt: new Date().toISOString(), note: clean(input.note, 300),
    earnings, deductions, employer: data.employer, person: { ...person, pps: normalisePps(person.pps) }, result,
  };
  if (save) await db.prepare("INSERT INTO sched_payroll (owner_id, scope, kind, key, staff_id, pay_date, data, updated_at) VALUES (?1,?2,'slip',?3,?4,?5,?6,?7) ON CONFLICT(owner_id, scope, kind, key) DO UPDATE SET data=excluded.data, pay_date=excluded.pay_date, updated_at=excluded.updated_at").bind(ownerId, scope, key, staff.id, payDate, JSON.stringify(record), record.issuedAt).run();
  return record;
}

export async function deletePayslip(db: Db, ownerId: string, scope: string, key: string) {
  await ensureSchedulingTables(db);
  await db.prepare("DELETE FROM sched_payroll WHERE owner_id=?1 AND scope=?2 AND kind='slip' AND key=?3").bind(ownerId, scope, String(key).slice(0, 200)).run();
}

export async function getPayslip(db: Db, ownerId: string, scope: string, key: string) {
  await ensureSchedulingTables(db);
  const row = await db.prepare("SELECT data FROM sched_payroll WHERE owner_id=?1 AND scope=?2 AND kind='slip' AND key=?3").bind(ownerId, scope, String(key).slice(0, 200)).first<{ data: string }>();
  return row ? parse<PayslipRecord | null>(row.data, null) : null;
}

export async function markPayslipEmailed(db: Db, ownerId: string, scope: string, rec: PayslipRecord, to: string) {
  const next = { ...rec, emailedTo: to, emailedAt: new Date().toISOString() };
  await db.prepare("UPDATE sched_payroll SET data=?4, updated_at=?5 WHERE owner_id=?1 AND scope=?2 AND kind='slip' AND key=?3").bind(ownerId, scope, rec.key, JSON.stringify(next), next.emailedAt).run();
  return next;
}
