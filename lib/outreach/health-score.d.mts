export type HealthBand = "green" | "amber" | "red" | "grey";
export type HealthFactor = { key: string; label: string; max: number; points: number | null; available: boolean; detail: string };
export type HealthInput = { auth?: { spf?: string | null; dkim?: string | null; dmarc?: string | null; mx?: string | null }; connection?: "ok" | "error" | null; sent?: number | null; bounced?: number | null; complaints?: number | null; sendErrors?: number | null; providerRestricted?: boolean | null; inboxPlacementRate?: number | null; blocklisted?: boolean | null };
export const DEFAULT_THRESHOLDS: Readonly<Record<string, number>>;
export function scoreHealth(input?: HealthInput, thresholds?: Record<string, number>): { score: number | null; band: HealthBand; label: string; measuredWeight: number; factors: HealthFactor[]; attention: string[]; pause: { required: boolean; reasons: string[] } };
