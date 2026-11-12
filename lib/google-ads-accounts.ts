export type GoogleAdsConnectedAccount = { id: string; name: string };

export function summarizeGoogleAdsConnectedAccounts(rows: Array<Record<string, unknown>>): GoogleAdsConnectedAccount[] {
  const accounts = new Map<string, GoogleAdsConnectedAccount>();
  for (const row of rows) {
    const rawId = String(row.account_id ?? row.customer_id ?? "").replace(/^customers\//i, "");
    const id = rawId.replace(/\D/g, "");
    if (!/^\d{6,20}$/.test(id)) continue;
    const name = String(row.account_name ?? row.customer_name ?? "").trim() || `Google Ads account ${id}`;
    if (!accounts.has(id)) accounts.set(id, { id, name });
  }
  return [...accounts.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
