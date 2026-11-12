"use client";

export type MarketingHistorySnapshot = {
  snapshotDate: string;
  fetchedAt: string;
  status: "connected" | "no_data";
  payload: Record<string, unknown>;
};

type Metric = { label: string; path: string[]; format?: "money" };

function valueAt(source: Record<string, unknown>, path: string[]) {
  let value: unknown = source;
  for (const key of path) {
    if (!value || typeof value !== "object") return null;
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function shown(value: number | null, format: Metric["format"]) {
  if (value == null) return "No value";
  return format === "money"
    ? new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value)
    : new Intl.NumberFormat("en-IE", { maximumFractionDigits: 1 }).format(value);
}

export function MarketingSnapshotHistory({ service, snapshots = [], metrics }: { service: string; snapshots?: MarketingHistorySnapshot[]; metrics: Metric[] }) {
  if (!snapshots.length) return null;
  const ordered = [...snapshots].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  return <details className="marketing-snapshot-history">
    <summary>📈 Saved daily history · {ordered.length} {ordered.length === 1 ? "day" : "days"}</summary>
    <p>Shows a consistent rolling 30-day report window. The latest snapshot refreshes automatically each day.</p>
    <div className="marketing-snapshot-grid">
      {metrics.map((metric) => {
        const rows = ordered.map((item) => ({ date: item.snapshotDate, value: item.status === "connected" ? valueAt(item.payload, metric.path) : null }));
        const max = Math.max(1, ...rows.map((item) => item.value ?? 0));
        const latest = rows.at(-1)?.value ?? null;
        return <section className="marketing-snapshot-metric" key={metric.label}>
          <header><b>{metric.label}</b><span>Latest: {shown(latest, metric.format)}</span></header>
          <div className="marketing-snapshot-bars" role="img" aria-label={`${metric.label} across ${rows.length} saved daily snapshots`}>
            {rows.map((item) => <span key={item.date} title={`${item.date}: ${shown(item.value, metric.format)}`} style={{ height: item.value == null ? "2px" : `${Math.max(4, item.value / max * 100)}%` }} data-empty={item.value == null ? "true" : undefined} />)}
          </div>
          <footer><span>{rows[0]?.date}</span><span>{rows.at(-1)?.date}</span></footer>
        </section>;
      })}
    </div>
  </details>;
}
