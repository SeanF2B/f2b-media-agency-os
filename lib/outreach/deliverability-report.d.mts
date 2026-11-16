export type BlocklistResult = { id: string; name: string; state: "clear" | "listed" | "unknown"; note: string };
export const DOMAIN_BLOCKLISTS: Array<{ id: string; name: string; zone: string; listed(ip: string): boolean; refused(ip: string): boolean }>;
export function interpretBlocklist(list: (typeof DOMAIN_BLOCKLISTS)[number], answers: string[] | null, error?: unknown): BlocklistResult;
export const LIMITS: Record<string, number>;
export type DeliverabilityReport = {
  verdict: "good" | "watch" | "act"; headline: string;
  auth: Array<{ key: string; label: string; state: string }>;
  blocklists: BlocklistResult[];
  rates: Array<{ key: string; label: string; value: string; tone?: string }>;
  placement: { completedAt: string; inboxRate: number | null; results: Array<{ provider: string; placement: string; seed?: string }> } | null;
  throttle: { band: string; limitToday: number | null; rampDay: number | null };
  findings: Array<{ tone: "good" | "info" | "warn" | "bad"; text: string }>;
  actions: string[];
};
export function buildDeliverabilityReport(input: Record<string, any>): DeliverabilityReport;
