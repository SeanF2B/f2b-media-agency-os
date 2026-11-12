import { auditPeriodsComparable, compareAuditMetrics, type MarketingAuditRun } from "@/lib/marketing-audit";

export function AuditComparison({ current, previous }: { current: MarketingAuditRun; previous?: MarketingAuditRun }) {
  const providerPreviousId = current.comparisonPeriod ? `${current.id}-provider-previous` : "";
  const providerPrevious = providerPreviousId && current.comparison ? {
    id: providerPreviousId,
    clientId: current.clientId,
    clientName: current.clientName,
    service: current.service,
    createdAt: current.createdAt,
    period: current.comparisonPeriod!,
    status: current.status,
    summary: "Previous reporting period",
    metrics: Object.fromEntries(Object.entries(current.comparison).flatMap(([key, change]) => current.metrics[key] != null && change != null ? [[key, current.metrics[key]! - change]] : [])),
    findings: [],
  } satisfies MarketingAuditRun : undefined;
  const sourceRun = providerPrevious ? { ...current, previousRunId: providerPreviousId } : current;
  const priorRun = providerPrevious || previous;
  if (!sourceRun.previousRunId) return null;
  if (!priorRun) return <p className="marketing-audit-comparison">The earlier audit is no longer available to compare.</p>;
  if (!auditPeriodsComparable(sourceRun.period, priorRun.period)) return <p className="marketing-audit-comparison">These audits cover different reporting periods, so their metrics are not compared.</p>;
  const rows = compareAuditMetrics(sourceRun, priorRun);
  if (!rows.length) return <p className="marketing-audit-comparison">No metrics were available in both audits to compare.</p>;
  const number = (value: number) => value.toLocaleString("en-IE", { maximumFractionDigits: 2 });
  return <section className="audit-comparison"><div><h3>Compared with the previous period</h3><small>Previous period: {priorRun.period}</small></div><div className="audit-comparison-table-wrap"><table className="audit-comparison-table"><thead><tr><th>Metric</th><th>Previous</th><th>Now</th><th>Change</th></tr></thead><tbody>{rows.map((row) => <tr key={row.key}><th scope="row">{row.label}</th><td>{number(row.previous)}</td><td>{number(row.current)}</td><td>{row.change > 0 ? "+" : ""}{number(row.change)}</td></tr>)}</tbody></table></div></section>;
}
