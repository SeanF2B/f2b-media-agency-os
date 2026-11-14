export type PlaybookEntry = { id: string; kind: string; title?: string; body: string; evidence?: "proven" | "hypothesis"; client_id?: string | null; niche?: string; updated_at?: string };
export const KINDS: Readonly<Record<string, string>>;
export function chunkDocument(text: string, size?: number): string[];
export function buildPlaybookContext(entries: PlaybookEntry[], p: { purpose: "copywriter" | "responder"; query?: string; clientId?: string | null; niche?: string; maxChars?: number }): { text: string; usedIds: string[]; chars: number };
export function buildCopywriterMessages(p: { task: string; campaign?: { name?: string; niche?: string; offer?: string }; steps?: number; draft?: string; instruction?: string }, playbookText: string): Array<{ role: "system" | "user"; content: string }>;
export function buildResponderMessages(p: { prospect?: { name?: string; company?: string }; campaignName?: string; history?: Array<{ direction: "in" | "out"; body: string }>; bookingUrl?: string }, playbookText: string): Array<{ role: "system" | "user"; content: string }>;
export function correctionFromEdit(p: { before: string; after: string; note?: string }): PlaybookEntry | null;
export function parseJsonReply(raw: string): any;
