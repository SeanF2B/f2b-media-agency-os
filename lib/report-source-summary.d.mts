export type ReportSourceSummary = { key: string; label: string; status: string; source: string; period: string; note: string; comparison: string };
export function summarizeReportSources(sourceData: unknown): ReportSourceSummary[];
export function reportSourceEvidenceHtml(sourceData: unknown): string;
