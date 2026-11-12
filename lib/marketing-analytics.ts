export type MarketingDailyMetric = { metricDate?: string; pageLoads?: number; submissions?: number };
export type MarketingAttributionMetric = { source?: string | null; medium?: string | null; campaign?: string | null; submissions?: number };

export function marketingAnalyticsChange(current: number | null, previous: number | null, percentagePoints = false) {
  if (current == null || previous == null) return "No comparison data";
  const delta = current - previous;
  if (delta === 0) return "No change vs previous";
  const amount = percentagePoints ? `${delta > 0 ? "+" : ""}${(delta * 100).toFixed(1)} pp` : `${delta > 0 ? "+" : ""}${delta}`;
  const relative = previous === 0 ? "was 0" : `${delta > 0 ? "+" : ""}${((delta / previous) * 100).toFixed(1)}%`;
  return `${amount} (${relative}) vs previous`;
}

export function summarizeMarketingAnalytics(rows: MarketingDailyMetric[], attributionRows: MarketingAttributionMetric[] = []) {
  const totals = rows.reduce<{ pageLoads: number; submissions: number }>((result, row) => ({
    pageLoads: (result.pageLoads || 0) + Math.max(0, Number(row.pageLoads) || 0),
    submissions: (result.submissions || 0) + Math.max(0, Number(row.submissions) || 0),
  }), { pageLoads: 0, submissions: 0 });
  return {
    ...totals,
    submissionRate: totals.pageLoads ? totals.submissions / totals.pageLoads : null,
    byCampaign: attributionRows.slice(0, 20).map((row) => ({
      source: String(row.source || "Not tagged").slice(0, 160),
      medium: String(row.medium || "").slice(0, 160),
      campaign: String(row.campaign || "").slice(0, 160),
      submissions: Math.max(0, Number(row.submissions) || 0),
    })),
    byDay: [...rows].reverse().map((row) => ({
      date: String(row.metricDate || ""),
      pageLoads: Math.max(0, Number(row.pageLoads) || 0),
      submissions: Math.max(0, Number(row.submissions) || 0),
    })),
  };
}
