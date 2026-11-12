export const LEAD_EXPORT_HEADERS: readonly string[];
export function buildLeadExportRows(rows: Array<{ values?: Record<string, string>; keep?: boolean }>): string[][];
export function buildLeadCsv(rows: Array<{ values?: Record<string, string>; keep?: boolean }>): string;
export function buildLeadXlsx(rows: Array<{ values?: Record<string, string>; keep?: boolean }>): Uint8Array;
export function parseLeadXlsx(input: ArrayBuffer | Uint8Array): Array<{ sourceRow: number; values: Record<string, string> }>;
