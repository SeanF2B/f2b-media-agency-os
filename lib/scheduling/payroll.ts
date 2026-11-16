// Irish payroll maths for payslips (PAYE, USC, PRSI) — pure functions, no I/O, so they can be unit tested.
// Rates are the 2026 figures. Each person's tax credits and cut-off point should come from their
// Revenue Payroll Notification (RPN); the defaults below are the standard single-person PAYE figures.

export type PayFrequency = "weekly" | "fortnightly" | "monthly";
export type TaxBasis = "cumulative" | "week1" | "emergency";
export type UscStatus = "ordinary" | "reduced" | "exempt";
export type PrsiClass = "A" | "S" | "M";
export type Employment = "employee" | "contractor";

export type PayrollPerson = {
  pps: string;
  employeeNo: string;
  employment: Employment;
  frequency: PayFrequency;
  basis: TaxBasis;
  taxCredits: number; // annual, from the RPN
  srcop: number; // annual standard rate cut-off point, from the RPN
  uscStatus: UscStatus;
  prsiClass: PrsiClass;
  pensionPct: number; // employee pension contribution, % of gross (relieved for PAYE only)
  startDate: string;
  paymentMethod: string;
};

export type PayrollEmployer = { name: string; address: string; employerNo: string; phone: string; email: string };

export const DEFAULT_PERSON: PayrollPerson = {
  pps: "", employeeNo: "", employment: "employee", frequency: "monthly", basis: "cumulative",
  taxCredits: 4000, srcop: 44000, uscStatus: "ordinary", prsiClass: "A", pensionPct: 0, startDate: "", paymentMethod: "Bank transfer",
};
export const DEFAULT_EMPLOYER: PayrollEmployer = { name: "", address: "", employerNo: "", phone: "", email: "" };

export const PERIODS: Record<PayFrequency, number> = { weekly: 52, fortnightly: 26, monthly: 12 };
const USC_BANDS_2026: Array<[number, number]> = [[12012, 0.005], [28700, 0.02], [70044, 0.03], [Infinity, 0.08]];
const PRSI_WEEKLY_EXEMPT = 352;
const PRSI_CREDIT_TOP = 424;
const PRSI_ER_LOWER_LIMIT = 527;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Class A rates change on 1 Oct 2026 (+0.15%). */
export function prsiRates(payDate: string) {
  const late = payDate >= "2026-10-01";
  return { ee: late ? 0.0435 : 0.042, erHigh: late ? 0.114 : 0.1125, erLow: late ? 0.0905 : 0.089 };
}

/** PPS number: 7 digits, a check letter, optionally one more letter. Validated with the mod-23 check character. */
export function normalisePps(input: string) { return String(input || "").toUpperCase().replace(/[^0-9A-Z]/g, ""); }
export function validPps(input: string) {
  const p = normalisePps(input);
  const m = /^(\d{7})([A-W])([A-IW]?)$/.exec(p);
  if (!m) return false;
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(m[1][i]) * (8 - i);
  if (m[3]) sum += (m[3] === "W" ? 0 : m[3].charCodeAt(0) - 64) * 9;
  const rem = sum % 23;
  return m[2] === (rem === 0 ? "W" : String.fromCharCode(64 + rem));
}
export function maskPps(input: string) { const p = normalisePps(input); return p.length > 4 ? `${"•".repeat(p.length - 4)}${p.slice(-4)}` : p; }

/** Which pay period of the tax year (calendar year) a pay date falls in. */
export function periodNumber(payDate: string, frequency: PayFrequency) {
  const d = new Date(`${payDate}T12:00:00Z`);
  if (frequency === "monthly") return d.getUTCMonth() + 1;
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.floor((d.getTime() - start) / (7 * 86_400_000)) + 1;
  return Math.min(PERIODS[frequency], frequency === "weekly" ? week : Math.ceil(week / 2));
}

/** PRSI is assessed per insurable week; a monthly period counts its Mondays (4 or 5). */
export function insurableWeeks(periodStart: string, periodEnd: string, frequency: PayFrequency) {
  if (frequency === "weekly") return 1;
  if (frequency === "fortnightly") return 2;
  let n = 0;
  for (let t = Date.parse(`${periodStart}T12:00:00Z`), end = Date.parse(`${periodEnd}T12:00:00Z`); t <= end; t += 86_400_000) if (new Date(t).getUTCDay() === 1) n++;
  return Math.max(1, n);
}

function uscOn(income: number, bandScale: number, status: UscStatus) {
  if (status === "exempt") return 0;
  const bands: Array<[number, number]> = status === "reduced" ? [[12012, 0.005], [Infinity, 0.02]] : USC_BANDS_2026;
  let tax = 0, floor = 0;
  for (const [top, rate] of bands) {
    const ceil = top === Infinity ? Infinity : top * bandScale;
    if (income > floor) tax += (Math.min(income, ceil) - floor) * rate;
    floor = ceil;
  }
  return tax;
}

export type Ytd = { gross: number; taxable: number; paye: number; usc: number; prsi: number; net: number; pension: number };
export const EMPTY_YTD: Ytd = { gross: 0, taxable: 0, paye: 0, usc: 0, prsi: 0, net: 0, pension: 0 };

export type PayslipInput = {
  person: PayrollPerson;
  gross: number; // earnings this period (appointments + any extra pay lines)
  otherDeductions: number; // after-tax deductions (advances, etc.)
  payDate: string; periodStart: string; periodEnd: string;
  ytd: Ytd; // totals from payslips already issued this tax year (before this one)
};

export type PayslipResult = {
  employment: Employment; basis: TaxBasis; period: number; periods: number;
  gross: number; pension: number; taxable: number;
  payeStandard: number; payeHigher: number; taxCredits: number; paye: number;
  srcop: number; usc: number; prsiEE: number; prsiER: number; prsiWeeks: number; prsiClass: PrsiClass;
  otherDeductions: number; totalDeductions: number; net: number;
  ytd: Ytd; notes: string[];
};

export function computePayslip(input: PayslipInput): PayslipResult {
  const p = input.person;
  const gross = r2(Math.max(0, input.gross));
  const other = r2(Math.max(0, input.otherDeductions));
  const periods = PERIODS[p.frequency];
  const period = periodNumber(input.payDate, p.frequency);
  const notes: string[] = [];
  if (p.employment === "contractor") {
    const net = r2(gross - other);
    notes.push("Self-employed contractor: no PAYE, USC or PRSI deducted. The contractor accounts for their own tax.");
    return { employment: "contractor", basis: p.basis, period, periods, gross, pension: 0, taxable: gross, payeStandard: 0, payeHigher: 0, taxCredits: 0, paye: 0, srcop: 0, usc: 0, prsiEE: 0, prsiER: 0, prsiWeeks: 0, prsiClass: p.prsiClass, otherDeductions: other, totalDeductions: other, net, notes,
      ytd: { gross: r2(input.ytd.gross + gross), taxable: r2(input.ytd.taxable + gross), paye: input.ytd.paye, usc: input.ytd.usc, prsi: input.ytd.prsi, net: r2(input.ytd.net + net), pension: input.ytd.pension } };
  }
  const basis: TaxBasis = validPps(p.pps) ? p.basis : "emergency";
  if (basis === "emergency" && p.basis !== "emergency") notes.push("No valid PPS number, so emergency tax applies (40% PAYE, no credits, 8% USC).");
  const pension = r2(gross * Math.max(0, Math.min(100, p.pensionPct)) / 100);
  const taxable = r2(gross - pension);

  // PAYE
  let payeStandard = 0, payeHigher = 0, credits = 0, srcop = 0, paye = 0;
  if (basis === "emergency") {
    payeHigher = r2(taxable * 0.4); paye = payeHigher;
  } else {
    const share = basis === "cumulative" ? period / periods : 1 / periods;
    const base = basis === "cumulative" ? input.ytd.taxable + taxable : taxable;
    srcop = r2(p.srcop * share); credits = r2(p.taxCredits * share);
    const std = Math.min(base, srcop) * 0.2, high = Math.max(0, base - srcop) * 0.4;
    const due = Math.max(0, std + high - credits);
    paye = r2(Math.max(0, basis === "cumulative" ? due - input.ytd.paye : due));
    const gross20 = std + high || 1;
    payeStandard = r2(paye * (std / gross20)); payeHigher = r2(paye - payeStandard);
    if (basis === "cumulative") { srcop = r2(p.srcop / periods); credits = r2(p.taxCredits / periods); }
    if (basis === "cumulative" && due - input.ytd.paye < 0) notes.push(`Tax refund of ${r2(input.ytd.paye - due).toFixed(2)} due under the cumulative basis (not paid automatically).`);
  }

  // USC (on gross; pension contributions don't reduce it)
  // Income of €13,000 or less a year is exempt; Revenue signals that on the RPN, so it's the "exempt" USC status.
  let usc = 0;
  if (basis === "emergency") usc = r2(gross * 0.08);
  else if (p.uscStatus !== "exempt") {
    usc = basis === "cumulative"
      ? r2(Math.max(0, uscOn(input.ytd.gross + gross, period / periods, p.uscStatus) - input.ytd.usc))
      : r2(uscOn(gross, 1 / periods, p.uscStatus));
  }

  // PRSI (per insurable week)
  const weeks = insurableWeeks(input.periodStart, input.periodEnd, p.frequency);
  const weekly = gross / weeks;
  const rates = prsiRates(input.payDate);
  let prsiEE = 0, prsiER = 0;
  if (p.prsiClass === "A") {
    if (weekly > PRSI_WEEKLY_EXEMPT) {
      const credit = weekly <= PRSI_CREDIT_TOP ? Math.max(0, 12 - (weekly - 352.01) / 6) : 0;
      prsiEE = r2(Math.max(0, weekly * rates.ee - credit) * weeks);
    }
    prsiER = r2(gross * (weekly <= PRSI_ER_LOWER_LIMIT ? rates.erLow : rates.erHigh));
  } else if (p.prsiClass === "S") {
    prsiEE = r2(gross * rates.ee);
  }

  const totalDeductions = r2(paye + usc + prsiEE + pension + other);
  const net = r2(gross - totalDeductions);
  return {
    employment: "employee", basis, period, periods, gross, pension, taxable, payeStandard, payeHigher, taxCredits: credits, paye, srcop, usc, prsiEE, prsiER, prsiWeeks: weeks, prsiClass: p.prsiClass,
    otherDeductions: other, totalDeductions, net, notes,
    ytd: { gross: r2(input.ytd.gross + gross), taxable: r2(input.ytd.taxable + taxable), paye: r2(input.ytd.paye + paye), usc: r2(input.ytd.usc + usc), prsi: r2(input.ytd.prsi + prsiEE), net: r2(input.ytd.net + net), pension: r2(input.ytd.pension + pension) },
  };
}

export function sanitizePerson(input: unknown): PayrollPerson {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const num = (v: unknown, min: number, max: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n * 100) / 100)) : d; };
  const pick = <T extends string>(v: unknown, list: readonly T[], d: T) => (list as readonly unknown[]).includes(v) ? v as T : d;
  return {
    pps: normalisePps(s(r.pps, 12)).slice(0, 9),
    employeeNo: s(r.employeeNo, 30),
    employment: pick(r.employment, ["employee", "contractor"] as const, "employee"),
    frequency: pick(r.frequency, ["weekly", "fortnightly", "monthly"] as const, "monthly"),
    basis: pick(r.basis, ["cumulative", "week1", "emergency"] as const, "cumulative"),
    taxCredits: num(r.taxCredits, 0, 100000, DEFAULT_PERSON.taxCredits),
    srcop: num(r.srcop, 0, 1000000, DEFAULT_PERSON.srcop),
    uscStatus: pick(r.uscStatus, ["ordinary", "reduced", "exempt"] as const, "ordinary"),
    prsiClass: pick(r.prsiClass, ["A", "S", "M"] as const, "A"),
    pensionPct: num(r.pensionPct, 0, 100, 0),
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(String(r.startDate)) ? String(r.startDate) : "",
    paymentMethod: s(r.paymentMethod, 60) || "Bank transfer",
  };
}
export function sanitizeEmployer(input: unknown): PayrollEmployer {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().replace(/[<>]/g, "").slice(0, n) : "");
  return { name: s(r.name, 120), address: s(r.address, 300), employerNo: s(r.employerNo, 20).toUpperCase(), phone: s(r.phone, 40), email: s(r.email, 120) };
}
