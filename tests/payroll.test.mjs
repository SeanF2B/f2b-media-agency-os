import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { computePayslip, validPps, maskPps, insurableWeeks, periodNumber, prsiRates, DEFAULT_PERSON, EMPTY_YTD } from "../lib/scheduling/payroll.ts";
import { getPayroll, savePayrollPerson, savePayrollEmployer, issuePayslip, deletePayslip } from "../lib/scheduling/payroll-store.ts";

function d1(raw) {
  const prepare = (sql) => {
    const make = (params) => ({
      bind: (...values) => make(values.map((v) => (v === undefined ? null : typeof v === "boolean" ? Number(v) : v))),
      first: async () => raw.prepare(sql).get(...params) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...params) }),
      run: async () => { const info = raw.prepare(sql).run(...params); return { meta: { changes: Number(info.changes) } }; },
    });
    return make([]);
  };
  return { prepare, batch: async (statements) => { raw.exec("BEGIN"); try { const out = []; for (const s of statements) out.push(await s.run()); raw.exec("COMMIT"); return out; } catch (e) { raw.exec("ROLLBACK"); throw e; } } };
}
const PERSON = { ...DEFAULT_PERSON, pps: "1234567T" };

test("PPS numbers are checked with the mod-23 check letter", () => {
  assert.equal(validPps("1234567T"), true);
  assert.equal(validPps("1234567t"), true);
  assert.equal(validPps("1234567A"), false);
  assert.equal(validPps("123456T"), false);
  assert.equal(validPps("1234567TW"), true); // W second letter counts as 0
  assert.equal(maskPps("1234567T"), "••••567T");
});

test("monthly employee on the cumulative basis (Jan 2026, €3,000)", () => {
  const r = computePayslip({ person: PERSON, gross: 3000, otherDeductions: 0, payDate: "2026-01-31", periodStart: "2026-01-01", periodEnd: "2026-01-31", ytd: EMPTY_YTD });
  assert.equal(r.period, 1);
  assert.equal(r.paye, 266.67); // 20% of 3000 − 4000/12 credits
  assert.equal(r.usc, 51.07);
  assert.equal(r.prsiWeeks, 4);
  assert.equal(r.prsiEE, 126); // 4.2% × 750 × 4 weeks
  assert.equal(r.prsiER, 337.5); // 11.25%
  assert.equal(r.net, 2556.26);
});

test("higher rate kicks in above the cut-off point; second month uses year-to-date", () => {
  const jan = computePayslip({ person: PERSON, gross: 5000, otherDeductions: 0, payDate: "2026-01-31", periodStart: "2026-01-01", periodEnd: "2026-01-31", ytd: EMPTY_YTD });
  assert.ok(jan.payeHigher > 0);
  assert.ok(Math.abs(jan.paye - (44000 / 12 * 0.2 + (5000 - 44000 / 12) * 0.4 - 4000 / 12)) < 0.011);
  const feb = computePayslip({ person: PERSON, gross: 5000, otherDeductions: 0, payDate: "2026-02-28", periodStart: "2026-02-01", periodEnd: "2026-02-28", ytd: jan.ytd });
  assert.equal(feb.period, 2);
  assert.ok(Math.abs(feb.paye - jan.paye) < 0.02);
  assert.equal(feb.ytd.gross, 10000);
});

test("no PPS number means emergency tax; contractors have no deductions", () => {
  const e = computePayslip({ person: { ...PERSON, pps: "" }, gross: 1000, otherDeductions: 0, payDate: "2026-03-31", periodStart: "2026-03-01", periodEnd: "2026-03-31", ytd: EMPTY_YTD });
  assert.equal(e.basis, "emergency"); assert.equal(e.paye, 400); assert.equal(e.usc, 80);
  const c = computePayslip({ person: { ...PERSON, employment: "contractor" }, gross: 1000, otherDeductions: 50, payDate: "2026-03-31", periodStart: "2026-03-01", periodEnd: "2026-03-31", ytd: EMPTY_YTD });
  assert.equal(c.paye + c.usc + c.prsiEE, 0); assert.equal(c.net, 950);
});

test("PRSI: low earners exempt, rates rise on 1 Oct 2026, pension relieves PAYE only", () => {
  const low = computePayslip({ person: { ...PERSON, frequency: "weekly" }, gross: 300, otherDeductions: 0, payDate: "2026-03-06", periodStart: "2026-03-02", periodEnd: "2026-03-08", ytd: EMPTY_YTD });
  assert.equal(low.prsiEE, 0);
  assert.equal(prsiRates("2026-09-30").ee, 0.042); assert.equal(prsiRates("2026-10-01").ee, 0.0435);
  assert.equal(insurableWeeks("2026-11-01", "2026-11-30", "monthly"), 5);
  assert.equal(periodNumber("2026-11-30", "monthly"), 11);
  const pen = computePayslip({ person: { ...PERSON, pensionPct: 5 }, gross: 3000, otherDeductions: 0, payDate: "2026-01-31", periodStart: "2026-01-01", periodEnd: "2026-01-31", ytd: EMPTY_YTD });
  assert.equal(pen.pension, 150); assert.equal(pen.taxable, 2850); assert.equal(pen.usc, 51.07);
});

test("register: issuing payslips builds year-to-date, scoped per account, invalid PPS refused", async () => {
  const db = d1(new DatabaseSync(":memory:"));
  await assert.rejects(savePayrollPerson(db, "o", "c1", "pat", { pps: "1234567A" }), /PPS/);
  await savePayrollPerson(db, "o", "c1", "pat", { ...PERSON });
  await savePayrollEmployer(db, "o", "c1", { name: "The Black Poppy", employerNo: "1234567fa", address: "<b>Galway</b>" });
  const staff = { id: "pat", name: "Pat | Artist", role: "Artist" };
  const jan = await issuePayslip(db, "o", "c1", staff, { payDate: "2026-01-31", periodStart: "2026-01-01", periodEnd: "2026-01-31", earnings: [{ label: "Tattoo", amount: 3000 }] }, true);
  const feb = await issuePayslip(db, "o", "c1", staff, { payDate: "2026-02-28", periodStart: "2026-02-01", periodEnd: "2026-02-28", earnings: [{ label: "Tattoo", amount: 3000 }], deductions: [{ label: "Advance", amount: 100 }] }, true);
  assert.equal(jan.number, 1); assert.equal(feb.number, 2);
  assert.equal(feb.result.ytd.gross, 6000); assert.equal(feb.staffName, "Pat");
  assert.equal(feb.employer.employerNo, "1234567FA"); assert.equal(feb.employer.address, "bGalway/b");
  // Reissuing January keeps its number and doesn't double count.
  const again = await issuePayslip(db, "o", "c1", staff, { payDate: "2026-01-31", periodStart: "2026-01-01", periodEnd: "2026-01-31", earnings: [{ label: "Tattoo", amount: 3000 }] }, true);
  assert.equal(again.number, 1); assert.equal(again.result.ytd.gross, 3000);
  const list = await getPayroll(db, "o", "c1", ["pat"], 2026);
  assert.equal(list.slips.length, 2); assert.equal(list.people.pat.pps, "1234567T");
  assert.equal((await getPayroll(db, "o", "", ["pat"], 2026)).slips.length, 0); // agency scope sees nothing of the client's
  await deletePayslip(db, "o", "c1", feb.key);
  assert.equal((await getPayroll(db, "o", "c1", ["pat"], 2026)).slips.length, 1);
  // Preview doesn't save.
  await issuePayslip(db, "o", "c1", staff, { payDate: "2026-03-31", periodStart: "2026-03-01", periodEnd: "2026-03-31", earnings: [{ label: "x", amount: 10 }] }, false);
  assert.equal((await getPayroll(db, "o", "c1", ["pat"], 2026)).slips.length, 1);
});
