export type MetaCampaignChangeField = "status" | "daily_budget";
export type MetaEditableEntityType = "ad_set" | "ad";

export function isMetaEntityStatusValid(entityType: string, value: string) {
  return (entityType === "ad_set" || entityType === "ad") && (value === "ACTIVE" || value === "PAUSED");
}

export function toMetaBudgetMinorUnits(amount: number, currency: string) {
  if (!currency || !/^[A-Z]{3}$/.test(currency)) throw new Error("Meta did not supply the ad account currency, so the budget change cannot be staged safely.");
  let digits: number;
  try { digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2; }
  catch { throw new Error("Meta returned an unsupported ad account currency, so the budget change cannot be staged safely."); }
  const scale = 10 ** digits;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) throw new Error("Enter a daily budget greater than zero and no more than 1,000,000 in the ad account currency.");
  const minor = Math.round(amount * scale);
  if (Math.abs(minor / scale - amount) > 1e-8) throw new Error(`This currency supports ${digits} decimal places for the daily budget.`);
  return minor;
}

export function isMetaChangeValueCurrent(field: MetaCampaignChangeField, current: { status: string; dailyBudgetMinor: number | null }, expected: string) {
  if (field === "status") return current.status === expected;
  return current.dailyBudgetMinor != null && String(current.dailyBudgetMinor) === expected;
}

export function isMetaChangeValueValid(field: string, value: string) {
  return field === "status" ? ["ACTIVE", "PAUSED"].includes(value) : field === "daily_budget" && /^\d+$/.test(value) && Number(value) > 0;
}
