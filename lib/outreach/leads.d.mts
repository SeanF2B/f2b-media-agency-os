export type ImportRow = { email: string; first_name: string; last_name: string; company: string; website: string; phone: string; time_zone: string; city: string; custom: Record<string, string>; flags: string[]; action: "create" | "link" | "skip"; reason: string; contact_id?: string };
export function parseCsv(text: string): string[][];
export function mapColumns(header: string[]): Record<string, number>;
export function checkEmail(raw: string): { email: string; domain: string; valid: boolean; flags: string[] };
export function prepareImport(csvText: string, ctx: { existingContacts: Map<string, { id: string; client_id?: string | null }>; suppressed: Set<string>; lastContacted?: Map<string, string>; activeEnrolled?: Set<string>; cooldownDays?: number; allowPersonalMailboxes?: boolean; now?: Date }): { columns: Record<string, number>; rows: ImportRow[]; summary: { total: number; create?: number; link?: number; skip?: number; reasons?: Record<string, number> } };
