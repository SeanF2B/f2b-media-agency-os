export type ReportHistoryItem = { id: string; clientId: string; generatedAt: string };

/** Keep a recent history for every client instead of one agency-wide queue. */
export function upsertClientReport<T extends ReportHistoryItem>(reports: T[], report: T, perClientLimit = 20) {
  const limit = Math.max(1, Math.min(100, Math.floor(perClientLimit)));
  const otherClients = reports.filter((item) => item.clientId !== report.clientId);
  const thisClient = [report, ...reports.filter((item) => item.clientId === report.clientId && item.id !== report.id)]
    .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt))
    .slice(0, limit);
  return [...thisClient, ...otherClients];
}
