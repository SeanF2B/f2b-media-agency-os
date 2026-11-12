// Simple tax estimators per country for the per-client Expenses & Tax tracker. Estimates only, not tax advice.
export type TaxCountry = "IE" | "GB" | "OTHER";
export type BusinessType = "sole_trader" | "company";
export type TaxSettings = { country?: TaxCountry; defaultBusinessType?: BusinessType; otherPersonalRate?: number; otherCompanyRate?: number };
export type TaxLine = { label: string; amount: number };
export type PersonalTax = { lines: TaxLine[]; total: number; monthly: number; bandLimit: number; bandLabel: string; higherRateAmount: number; higherRate: string; deadline: string };
export type CompanyTax = { tax: number; afterTax: number; rateLabel: string; note: string };

export const TAX_COUNTRIES: Array<{ code: TaxCountry; label: string; currency: string }> = [
  { code: "IE", label: "Ireland", currency: "EUR" }, { code: "GB", label: "United Kingdom", currency: "GBP" }, { code: "OTHER", label: "Other country (set your own rates)", currency: "" },
];
export const taxCountry = (settings?: TaxSettings): TaxCountry => settings?.country === "GB" || settings?.country === "OTHER" ? settings.country : "IE";

function ieUsc(income: number) { if (income <= 13_000) return 0; return Math.min(income, 12_012) * 0.005 + Math.min(Math.max(0, income - 12_012), 16_688) * 0.02 + Math.min(Math.max(0, income - 28_700), 41_344) * 0.03 + Math.min(Math.max(0, income - 70_044), 29_956) * 0.08 + Math.max(0, income - 100_000) * 0.11; }
function ieTax(profit: number, other: number, household: "single" | "joint"): PersonalTax {
  const band = household === "joint" ? 53_000 : 44_000, credit = household === "joint" ? 4_000 : 2_000;
  const before = (income: number) => Math.min(income, band) * 0.2 + Math.max(0, income - band) * 0.4;
  const earned = Math.min(2_000, profit * 0.2);
  const incomeTax = Math.max(0, Math.max(0, before(other + profit) - credit - earned) - Math.max(0, before(other) - credit));
  const usc = Math.max(0, ieUsc(other + profit) - ieUsc(other));
  const prsi = profit >= 5_000 ? Math.max(650, profit * 0.042375) : 0;
  const total = incomeTax + usc + prsi;
  return { lines: [{ label: `Income tax (20% to €${band.toLocaleString("en-IE")}, 40% above)`, amount: incomeTax }, { label: "USC", amount: usc }, { label: "PRSI (self-employed)", amount: prsi }], total, monthly: total / 12, bandLimit: band, bandLabel: `€${band.toLocaleString("en-IE")} standard-rate band`, higherRateAmount: Math.max(0, other + profit - band), higherRate: "40%", deadline: "Preliminary tax and the Form 11 return are due 31 October (the ROS date is usually extended to mid-November)." };
}
function gbIncomeTax(income: number) {
  const pa = Math.max(0, 12_570 - Math.max(0, income - 100_000) / 2), taxable = Math.max(0, income - pa);
  return Math.min(taxable, 37_700) * 0.2 + Math.min(Math.max(0, taxable - 37_700), 125_140 - 37_700) * 0.4 + Math.max(0, taxable - 125_140) * 0.45;
}
const gbClass4 = (profit: number) => Math.min(Math.max(0, profit - 12_570), 50_270 - 12_570) * 0.06 + Math.max(0, profit - 50_270) * 0.02;
function gbTax(profit: number, other: number): PersonalTax {
  const incomeTax = Math.max(0, gbIncomeTax(other + profit) - gbIncomeTax(other)), ni = gbClass4(profit);
  const total = incomeTax + ni, limit = 50_270;
  return { lines: [{ label: "Income tax (20% basic, 40% higher, 45% additional)", amount: incomeTax }, { label: "Class 4 National Insurance (6% / 2%)", amount: ni }], total, monthly: total / 12, bandLimit: limit, bandLabel: "£50,270 higher-rate threshold", higherRateAmount: Math.max(0, other + profit - limit), higherRate: "40%", deadline: "Self Assessment: file online by 31 January, pay by 31 January and 31 July (payments on account)." };
}
function otherTax(profit: number, other: number, rate: number): PersonalTax {
  const tax = Math.max(0, profit) * Math.max(0, rate) / 100;
  return { lines: [{ label: `Income tax (flat ${rate}%)`, amount: tax }], total: tax, monthly: tax / 12, bandLimit: Infinity, bandLabel: "", higherRateAmount: 0, higherRate: "", deadline: "Check your local filing deadlines." };
}
export function estimatePersonalTax(country: TaxCountry, profit: number, other: number, household: "single" | "joint", settings?: TaxSettings): PersonalTax {
  const p = Math.max(0, profit), o = Math.max(0, other);
  return country === "GB" ? gbTax(p, o) : country === "OTHER" ? otherTax(p, o, settings?.otherPersonalRate ?? 20) : ieTax(p, o, household);
}
export function estimateCompanyTax(country: TaxCountry, profit: number, settings?: TaxSettings): CompanyTax {
  const p = Math.max(0, profit);
  if (country === "GB") { const tax = p <= 50_000 ? p * 0.19 : p >= 250_000 ? p * 0.25 : p * 0.25 - (250_000 - p) * 3 / 200; return { tax, afterTax: p - tax, rateLabel: "Corporation tax (19% to £50,000, 25% above £250,000, marginal relief between)", note: "Director pay and dividends are taxed personally on top. The company tax return and payment are due 9 months and 1 day after the year-end." }; }
  if (country === "OTHER") { const rate = settings?.otherCompanyRate ?? 20, tax = p * rate / 100; return { tax, afterTax: p - tax, rateLabel: `Company tax (flat ${rate}%)`, note: "Director pay and dividends may be taxed personally on top. Check local filing deadlines." }; }
  const tax = p * 0.125; return { tax, afterTax: p - tax, rateLabel: "Corporation tax (12.5% trading profit)", note: "Director pay and dividends are taxed personally (income tax, USC, PRSI) on top. The company return is due 9 months after the year-end (preliminary tax earlier)." };
}
