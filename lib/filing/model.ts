// "Get ready for filing" — pure logic shared by the Books screen, the /api/filing route and the tests.
// Works from the existing Books records; tax maths comes from lib/tax-rules. Estimates only, not tax advice.
import { estimateCompanyTax, estimatePersonalTax, taxCountry, TAX_COUNTRIES, type BusinessType, type TaxCountry, type TaxSettings } from "../tax-rules.ts";

export type ReturnKind = "income" | "company" | "vat" | "state";
export type ReturnTypeId = "ie-form11" | "ie-ct1" | "ie-vat3" | "gb-sa100" | "gb-ct600" | "gb-vat" | "us-1040" | "us-1120" | "us-state";
export type ReturnType = { id: ReturnTypeId; country: TaxCountry; kind: ReturnKind; label: string; short: string };

export const RETURN_TYPES: Record<ReturnTypeId, ReturnType> = {
  "ie-form11": { id: "ie-form11", country: "IE", kind: "income", label: "Income Tax return (Form 11)", short: "Form 11" },
  "ie-ct1": { id: "ie-ct1", country: "IE", kind: "company", label: "Corporation Tax return (CT1)", short: "CT1" },
  "ie-vat3": { id: "ie-vat3", country: "IE", kind: "vat", label: "VAT return (VAT3)", short: "VAT3" },
  "gb-sa100": { id: "gb-sa100", country: "GB", kind: "income", label: "Self Assessment tax return (SA100)", short: "Self Assessment" },
  "gb-ct600": { id: "gb-ct600", country: "GB", kind: "company", label: "Company Tax Return (CT600)", short: "CT600" },
  "gb-vat": { id: "gb-vat", country: "GB", kind: "vat", label: "VAT return (Making Tax Digital)", short: "VAT return" },
  "us-1040": { id: "us-1040", country: "US", kind: "income", label: "Federal return (Form 1040 + Schedule C)", short: "Form 1040" },
  "us-1120": { id: "us-1120", country: "US", kind: "company", label: "Federal corporate return (Form 1120)", short: "Form 1120" },
  "us-state": { id: "us-state", country: "US", kind: "state", label: "State income tax return", short: "State return" },
};

export const countryLabel = (country: TaxCountry) => TAX_COUNTRIES.find((item) => item.code === country)?.label.replace(/ \(.*/, "") || country;

// Which returns this business can prepare, from its tax country, company type and registrations.
export function returnTypesFor(tax: TaxSettings | undefined, businessType?: BusinessType | ""): ReturnType[] {
  const country = taxCountry(tax);
  const ids: ReturnTypeId[] = [];
  const both = !businessType;
  if (country === "IE") { if (both || businessType === "sole_trader") ids.push("ie-form11"); if (both || businessType === "company") ids.push("ie-ct1"); if (tax?.vatRegistered) ids.push("ie-vat3"); }
  if (country === "GB") { if (both || businessType === "sole_trader") ids.push("gb-sa100"); if (both || businessType === "company") ids.push("gb-ct600"); if (tax?.vatRegistered) ids.push("gb-vat"); }
  if (country === "US") { if (both || businessType === "sole_trader") ids.push("us-1040"); if (both || businessType === "company") ids.push("us-1120"); if (tax?.usState) ids.push("us-state"); }
  return ids.map((id) => RETURN_TYPES[id]);
}

// ---------------------------------------------------------------- periods
export type FilingPeriod = { key: string; label: string; start: string; end: string; ended: boolean };
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Recent periods for a return, most recently ended first, then the one in progress, then older ones.
export function periodsFor(type: ReturnType, today: string): FilingPeriod[] {
  const [ty, tm] = today.split("-").map(Number);
  const list: FilingPeriod[] = [];
  if (type.kind === "vat") {
    const span = type.country === "IE" ? 2 : 3; // Irish VAT3 is bi-monthly; UK VAT quarterly (calendar stagger)
    let y = ty, startMonth = Math.floor((tm - 1) / span) * span + 1;
    for (let i = 0; i < 7; i += 1) {
      const endMonth = startMonth + span - 1;
      const end = iso(y, endMonth, lastDay(y, endMonth));
      list.push({ key: `${y}-${pad(startMonth)}`, label: `${MONTHS[startMonth - 1]}–${MONTHS[endMonth - 1]} ${y}`, start: iso(y, startMonth, 1), end, ended: end < today });
      startMonth -= span; if (startMonth < 1) { startMonth += 12; y -= 1; }
    }
  } else if (type.id === "gb-sa100") {
    const current = tm > 4 || (tm === 4 && Number(today.slice(8, 10)) >= 6) ? ty : ty - 1; // UK tax year starts 6 April
    for (let y = current; y > current - 3; y -= 1) { const end = iso(y + 1, 4, 5); list.push({ key: `${y}-${String(y + 1).slice(2)}`, label: `Tax year ${y}/${String(y + 1).slice(2)}`, start: iso(y, 4, 6), end, ended: end < today }); }
  } else {
    for (let y = ty; y > ty - 3; y -= 1) { const end = iso(y, 12, 31); list.push({ key: String(y), label: type.kind === "company" ? `Year ended 31 Dec ${y}` : `Tax year ${y}`, start: iso(y, 1, 1), end, ended: end < today }); }
  }
  const ended = list.filter((p) => p.ended), open = list.filter((p) => !p.ended);
  return [...ended.slice(0, 1), ...open, ...ended.slice(1)];
}

// ---------------------------------------------------------------- records & draft figures
export type BookRecord = { id: string; kind: "Income" | "Expense"; date: string; description: string; category: string; amount: number; receiptFileId?: string; receiptName?: string };
export const inPeriod = (records: BookRecord[], period: { start: string; end: string }) => records.filter((r) => r.date >= period.start && r.date <= period.end);

export type FigureLine = { id: string; label: string; amount: number; recordIds: string[]; note?: string; emphasis?: boolean };
export type DraftFigures = { lines: FigureLine[]; estimateLabel: string; estimate: number; estimateLines: Array<{ label: string; amount: number }>; notes: string[] };
export type BooksContext = { household?: "single" | "joint"; otherIncome?: number };

const VAT_RATE: Partial<Record<TaxCountry, number>> = { IE: 0.23, GB: 0.2 };
// Costs that never carry VAT (wages, tax payments, bank charges, insurance) stay out of the input-VAT estimate.
const NO_VAT = /wage|salary|salaries|payroll|staff pay|subcontract|tax|revenue|hmrc|bank|interest|insurance|depreciation|drawings/i;
const round = (n: number) => Math.round(n * 100) / 100;
const sum = (rows: BookRecord[]) => round(rows.reduce((total, r) => total + r.amount, 0));

export function draftFigures(type: ReturnType, records: BookRecord[], tax: TaxSettings | undefined, books: BooksContext = {}): DraftFigures {
  const income = records.filter((r) => r.kind === "Income"), expenses = records.filter((r) => r.kind === "Expense");
  const turnover = sum(income), costs = sum(expenses), profit = round(turnover - costs);
  if (type.kind === "vat") {
    const rate = VAT_RATE[type.country] ?? 0.2, vatable = expenses.filter((r) => !NO_VAT.test(`${r.category} ${r.description}`));
    const sales = turnover, purchases = sum(vatable);
    const output = round(sales * rate / (1 + rate)), input = round(purchases * rate / (1 + rate));
    const net = round(output - input);
    return {
      lines: [
        { id: "sales", label: "Sales (VAT-inclusive)", amount: sales, recordIds: income.map((r) => r.id) },
        { id: "output", label: `VAT on sales (T1 / box 1) at ${Math.round(rate * 100)}%`, amount: output, recordIds: income.map((r) => r.id) },
        { id: "purchases", label: "Purchases with VAT (VAT-inclusive)", amount: purchases, recordIds: vatable.map((r) => r.id), note: expenses.length > vatable.length ? `${expenses.length - vatable.length} costs left out (wages, tax, bank, insurance)` : undefined },
        { id: "input", label: `VAT on purchases (T2 / box 4) at ${Math.round(rate * 100)}%`, amount: input, recordIds: vatable.map((r) => r.id) },
      ],
      estimateLabel: net >= 0 ? "Estimated VAT payable" : "Estimated VAT repayable", estimate: Math.abs(net), estimateLines: [],
      notes: [`Worked out at the standard ${Math.round(rate * 100)}% rate from VAT-inclusive totals. Reduced-rate, zero-rated and exempt items need adjusting before you submit.`],
    };
  }
  const lines: FigureLine[] = [
    { id: "turnover", label: "Turnover (income)", amount: turnover, recordIds: income.map((r) => r.id) },
    { id: "expenses", label: "Allowable expenses", amount: costs, recordIds: expenses.map((r) => r.id) },
  ];
  const byCategory = new Map<string, BookRecord[]>();
  for (const r of expenses) byCategory.set(r.category || "Other", [...(byCategory.get(r.category || "Other") || []), r]);
  for (const [category, rows] of [...byCategory.entries()].sort((a, b) => sum(b[1]) - sum(a[1]))) lines.push({ id: `cat:${category}`, label: `· ${category}`, amount: sum(rows), recordIds: rows.map((r) => r.id) });
  lines.push({ id: "profit", label: type.kind === "company" ? "Trading profit before tax" : "Net profit", amount: profit, recordIds: records.map((r) => r.id), emphasis: true });
  const country = type.country;
  if (type.kind === "company") {
    const company = estimateCompanyTax(country, profit, tax);
    return { lines, estimateLabel: "Estimated tax", estimate: round(company.tax), estimateLines: [{ label: company.rateLabel, amount: round(company.tax) }], notes: [company.note] };
  }
  if (type.kind === "state") return { lines, estimateLabel: "State tax", estimate: 0, estimateLines: [], notes: [`State tax isn't estimated here. Use these figures in your ${tax?.usState || "state"} return.`] };
  const personal = estimatePersonalTax(country, Math.max(0, profit), Math.max(0, books.otherIncome || 0), books.household || "single", tax);
  return { lines, estimateLabel: "Estimated tax", estimate: round(personal.total), estimateLines: personal.lines.map((l) => ({ label: l.label, amount: round(l.amount) })), notes: [personal.deadline, ...(books.otherIncome ? [`Includes other income of ${books.otherIncome.toLocaleString("en-IE")} when working out bands.`] : [])] };
}

// ---------------------------------------------------------------- receipt check
export type ReceiptEmail = { id: string; from: string; subject: string; date: string; snippet?: string; attachments: string[]; amounts?: number[] };
export type ReceiptMatch = { recordId: string; via: "email" | "attached"; emailId?: string; by: "rules" | "ai"; reason: string };
export type ReceiptIssue = { id: string; type: "missing" | "duplicate" | "unclear" | "unmatched_receipt"; recordIds: string[]; emailId?: string; message: string };
export type ReceiptCheckResult = { scannedAt: string; account?: string; emailCount: number; matches: ReceiptMatch[]; issues: ReceiptIssue[]; emails: ReceiptEmail[]; aiUsed: boolean; aiNote?: string };
export type Ambiguous = { recordId: string; emailIds: string[] };

// Money amounts written in an email subject/snippet ("Total €49.00", "£1,200", "USD 15.5").
export function parseAmounts(text: string): number[] {
  const found = new Set<number>();
  const re = /(?:[€£$]|\b(?:eur|gbp|usd)\b)\s?(-?\d{1,3}(?:[,\s]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)|(-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:[.,]\d{2}))\s?(?:[€£$]|\b(?:eur|gbp|usd)\b)|\btotal\b[^0-9]{0,12}(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:[.,]\d{2}))/gi;
  for (const m of String(text || "").matchAll(re)) {
    const raw = (m[1] || m[2] || m[3] || "").replace(/\s/g, "");
    const normal = /,\d{1,2}$/.test(raw) && !raw.includes(".") ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
    const n = Math.abs(Number(normal));
    if (Number.isFinite(n) && n > 0 && n < 10_000_000) found.add(round(n));
  }
  return [...found];
}

const dayDiff = (a: string, b: string) => Math.abs((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);
const words = (text: string) => new Set(String(text || "").toLowerCase().replace(/<[^>]*>/g, " ").split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !/^(the|and|for|ltd|limited|inc|llc|your|from|invoice|receipt|payment|order|confirmation|bill|com|www|noreply|reply)$/.test(w)));
const overlap = (record: BookRecord, email: ReceiptEmail) => { const a = words(record.description); let n = 0; for (const w of words(`${email.from} ${email.subject}`)) if (a.has(w)) n += 1; return n; };

// Rule-based matching first; anything with several equally good candidates is returned as `ambiguous` for the AI to settle.
export function matchReceipts(records: BookRecord[], emails: ReceiptEmail[]): { matches: ReceiptMatch[]; issues: ReceiptIssue[]; ambiguous: Ambiguous[] } {
  const expenses = records.filter((r) => r.kind === "Expense").sort((a, b) => a.date.localeCompare(b.date));
  const mail = emails.map((e) => ({ ...e, amounts: e.amounts?.length ? e.amounts : parseAmounts(`${e.subject} ${e.snippet || ""}`) }));
  const matches: ReceiptMatch[] = [], issues: ReceiptIssue[] = [], ambiguous: Ambiguous[] = [];
  const used = new Set<string>();
  // Duplicates: same amount, within 2 days, similar description.
  const flagged = new Set<string>();
  for (let i = 0; i < expenses.length; i += 1) for (let j = i + 1; j < expenses.length; j += 1) {
    const a = expenses[i], b = expenses[j];
    if (flagged.has(b.id) || Math.abs(a.amount - b.amount) > 0.005 || dayDiff(a.date, b.date) > 2) continue;
    const wa = words(a.description), wb = words(b.description); let shared = 0; for (const w of wa) if (wb.has(w)) shared += 1;
    if (shared > 0 || a.description.trim().toLowerCase() === b.description.trim().toLowerCase()) { flagged.add(b.id); issues.push({ id: `dup:${a.id}:${b.id}`, type: "duplicate", recordIds: [a.id, b.id], message: `“${b.description}” looks like a duplicate of “${a.description}” (same amount, ${a.date === b.date ? "same day" : "two days apart"}).` }); }
  }
  // Pass 1 — strongest: amount + date + supplier name. Pass 2 — amount + date only, when there's exactly one candidate.
  const pending: BookRecord[] = [];
  for (const record of expenses) {
    if (record.receiptFileId) { matches.push({ recordId: record.id, via: "attached", by: "rules", reason: `Receipt attached in Books${record.receiptName ? ` (${record.receiptName})` : ""}` }); continue; }
    pending.push(record);
  }
  const candidatesFor = (record: BookRecord) => mail.filter((e) => !used.has(e.id) && e.amounts.some((n) => Math.abs(n - record.amount) < 0.01) && (!e.date || dayDiff(e.date, record.date) <= 10));
  const left: BookRecord[] = [];
  for (const record of pending) {
    const named = candidatesFor(record).map((e) => ({ e, score: overlap(record, e) })).filter((c) => c.score > 0).sort((a, b) => b.score - a.score || dayDiff(a.e.date, record.date) - dayDiff(b.e.date, record.date));
    if (named.length && (named.length === 1 || named[0].score > named[1].score)) { used.add(named[0].e.id); matches.push({ recordId: record.id, via: "email", emailId: named[0].e.id, by: "rules", reason: "Same amount, date within 10 days and supplier name matches" }); }
    else left.push(record);
  }
  for (const record of left) {
    const candidates = candidatesFor(record);
    if (candidates.length === 1) { used.add(candidates[0].id); matches.push({ recordId: record.id, via: "email", emailId: candidates[0].id, by: "rules", reason: "Same amount and date within 10 days" }); }
    else if (candidates.length > 1) ambiguous.push({ recordId: record.id, emailIds: candidates.map((e) => e.id) });
    else issues.push({ id: `missing:${record.id}`, type: "missing", recordIds: [record.id], message: `No receipt found for “${record.description}” (${record.date}).` });
  }
  for (const e of mail) {
    if (used.has(e.id) || ambiguous.some((a) => a.emailIds.includes(e.id))) continue;
    issues.push(e.amounts.length
      ? { id: `receipt:${e.id}`, type: "unmatched_receipt", recordIds: [], emailId: e.id, message: `Receipt from ${e.from || "unknown sender"} for ${e.amounts.join(" / ")} has no matching transaction in Books.` }
      : { id: `unclear:${e.id}`, type: "unclear", recordIds: [], emailId: e.id, message: `Couldn’t read an amount in “${e.subject || "(no subject)"}” from ${e.from || "unknown sender"}.` });
  }
  return { matches, issues, ambiguous };
}

// Apply the AI's picks for ambiguous records; anything it didn't settle becomes an "unclear" item to review.
export function settleAmbiguous(result: { matches: ReceiptMatch[]; issues: ReceiptIssue[]; ambiguous: Ambiguous[] }, picks: Record<string, string | null>, records: BookRecord[], emails: ReceiptEmail[] = []): { matches: ReceiptMatch[]; issues: ReceiptIssue[] } {
  const matches = [...result.matches], issues = [...result.issues], used = new Set(matches.map((m) => m.emailId).filter(Boolean));
  for (const item of result.ambiguous) {
    const pick = picks[item.recordId];
    const record = records.find((r) => r.id === item.recordId);
    if (pick && item.emailIds.includes(pick) && !used.has(pick)) { used.add(pick); matches.push({ recordId: item.recordId, via: "email", emailId: pick, by: "ai", reason: "AI picked this receipt from several with the same amount" }); }
    else issues.push({ id: `unclear:${item.recordId}`, type: "unclear", recordIds: [item.recordId], emailId: item.emailIds[0], message: `${item.emailIds.length} receipts could match “${record?.description || item.recordId}”. Open the evidence and choose.` });
  }
  // Candidate receipts nobody ended up using still need a look.
  const mentioned = new Set(issues.map((i) => i.emailId).filter(Boolean));
  for (const id of new Set(result.ambiguous.flatMap((a) => a.emailIds))) {
    if (used.has(id) || mentioned.has(id)) continue;
    const e = emails.find((x) => x.id === id);
    issues.push({ id: `receipt:${id}`, type: "unmatched_receipt", recordIds: [], emailId: id, message: `Receipt from ${e?.from || "unknown sender"}${e?.amounts?.length ? ` for ${e.amounts.join(" / ")}` : ""} has no matching transaction in Books.` });
  }
  return { matches, issues };
}

// ---------------------------------------------------------------- filing routes
export type FilingRoute = { supported: true; service: string; url: string; note: string } | { supported: false; service: string; reason: string; needs: string[] };
export const ROS_URL = "https://www.ros.ie/";
export const HMRC_SA_URL = "https://www.gov.uk/log-in-file-self-assessment-tax-return";
export const IRS_FREE_FILE_URL = "https://www.irs.gov/filing/irs-free-file-do-your-taxes-for-free";

export function filingRoute(type: ReturnType, tax: TaxSettings | undefined): FilingRoute {
  const software = tax?.filingSoftware?.url && /^https:\/\//.test(tax.filingSoftware.url) ? tax.filingSoftware : null;
  if (taxCountry(tax) !== type.country) return { supported: false, service: "the filing service", reason: `This return is for ${countryLabel(type.country)}, but the business's tax country is ${countryLabel(taxCountry(tax))}.`, needs: ["Check the tax country in Books → Settings"] };
  switch (type.id) {
    case "ie-form11": case "ie-ct1": case "ie-vat3":
      return { supported: true, service: "Revenue Online Service (ROS)", url: ROS_URL, note: "Sign in with your ROS digital certificate, open the return for this period and enter the reviewed figures." };
    case "gb-sa100":
      return { supported: true, service: "HMRC Self Assessment", url: HMRC_SA_URL, note: "Sign in with your Government Gateway user ID and complete the return for this tax year." };
    case "gb-vat":
      return software ? { supported: true, service: software.name, url: software.url, note: "Making Tax Digital requires VAT returns to be submitted from compatible software. Submit this period's return there." } : { supported: false, service: "Making Tax Digital software", reason: "VAT returns must be filed through Making Tax Digital-compatible software, and none is connected for this business.", needs: ["Add your MTD-compatible software and its sign-in link in Books → Settings → Registrations & filing"] };
    case "gb-ct600":
      return software ? { supported: true, service: software.name, url: software.url, note: "Company Tax Returns are filed through commercial software. Submit the CT600 there." } : { supported: false, service: "Corporation Tax software", reason: "HMRC's free CT600 service closed on 31 March 2026, so Company Tax Returns now need commercial software, and none is connected for this business.", needs: ["Add your Corporation Tax filing software and its sign-in link in Books → Settings → Registrations & filing"] };
    case "us-1040":
      return software ? { supported: true, service: software.name, url: software.url, note: "Enter the reviewed Schedule C figures in your filing provider and e-file there." } : { supported: true, service: "IRS Free File", url: IRS_FREE_FILE_URL, note: "Free File is for eligible incomes only. Pick a partner provider on IRS.gov, then enter the reviewed Schedule C figures." };
    case "us-1120":
      return software ? { supported: true, service: software.name, url: software.url, note: "Enter the reviewed figures in your filing provider and e-file Form 1120 there." } : { supported: false, service: "a corporate filing provider", reason: "Form 1120 has to be e-filed through an IRS-authorised provider, and none is set for this business.", needs: ["Add your filing provider and its sign-in link in Books → Settings → Registrations & filing"] };
    case "us-state":
      return tax?.usStateFilingUrl && /^https:\/\//.test(tax.usStateFilingUrl) ? { supported: true, service: `${(tax.usState || "State").toUpperCase()} e-file`, url: tax.usStateFilingUrl, note: "Use the reviewed figures as the business income on the state return." } : { supported: false, service: "the state filing service", reason: `No state filing link is set${tax?.usState ? ` for ${tax.usState.toUpperCase()}` : ""}.`, needs: ["Add the state and its official e-file link in Books → Settings → Registrations & filing"] };
  }
}

// ---------------------------------------------------------------- saved returns
export type FilingStatus = "draft" | "filed";
export type Acknowledgement = { reference: string; receivedAt: string; recordedAt: string; recordedBy?: string; note?: string };
export type FilingReturn = {
  id: string; scopeId: string; returnTypeId: ReturnTypeId; periodKey: string; periodLabel: string; periodStart: string; periodEnd: string;
  businessName: string; country: TaxCountry; status: FilingStatus;
  receiptCheck: { state: "checked" | "skipped"; skippedReason?: string; result?: ReceiptCheckResult };
  resolvedIssueIds: string[]; figures?: DraftFigures; openedFilingAt?: string[]; acknowledgement?: Acknowledgement; createdAt: string; updatedAt: string;
};
// Same sanitising as the bookkeeping inbox scope, so a business keeps one id on both sides.
export const filingScope = (value: unknown) => String(value || "agency").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "agency";
export const filingId = (scopeId: string, typeId: ReturnTypeId, periodKey: string) => `${scopeId}:${typeId}:${periodKey}`;
export const unresolvedIssues = (ret: Pick<FilingReturn, "receiptCheck" | "resolvedIssueIds">) => (ret.receiptCheck.result?.issues || []).filter((i) => !ret.resolvedIssueIds.includes(i.id));

// Server-side merge for "save": the client can't mark a return filed, drop its acknowledgement or rewrite its identity.
export function mergeDraft(existing: FilingReturn | null, incoming: FilingReturn, now: string): FilingReturn {
  return { ...incoming, id: existing?.id || incoming.id, status: existing?.status || "draft", acknowledgement: existing?.acknowledgement, openedFilingAt: existing?.openedFilingAt || [], createdAt: existing?.createdAt || now, updatedAt: now };
}
// Opening the filing service is logged but never changes the status.
export const recordOpened = (ret: FilingReturn, now: string): FilingReturn => ({ ...ret, openedFilingAt: [...(ret.openedFilingAt || []), now].slice(-20), updatedAt: now });
// Filed only once an acknowledgement is received or recorded.
export function recordAcknowledgement(ret: FilingReturn, ack: { reference: string; receivedAt?: string; note?: string; recordedBy?: string }, now: string): FilingReturn {
  const reference = String(ack.reference || "").trim().slice(0, 120);
  if (!reference) throw new Error("Enter the acknowledgement or submission reference from the filing service.");
  const receivedAt = /^\d{4}-\d{2}-\d{2}/.test(ack.receivedAt || "") ? String(ack.receivedAt).slice(0, 10) : now.slice(0, 10);
  return { ...ret, status: "filed", acknowledgement: { reference, receivedAt, recordedAt: now, recordedBy: ack.recordedBy, note: ack.note ? String(ack.note).slice(0, 500) : undefined }, updatedAt: now };
}
