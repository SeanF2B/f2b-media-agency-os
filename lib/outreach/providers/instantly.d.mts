export const WARMUP_STATES: Record<number, string>;
export const ACCOUNT_STATES: Record<number, string>;
export type WarmupStats = { sent: number; received: number; inbox: number; spam: number; inboxRate: number | null; healthScore: number | null };
export type InstantlyClient = {
  verify(): Promise<{ ok: true; accounts: number }>;
  getAccount(email: string): Promise<{ email: string; status?: number; warmup_status?: number; stat_warmup_score?: number | null } | null>;
  startOAuth(host: "google" | "microsoft"): Promise<{ sessionId: string; authUrl: string; expiresAt: string }>;
  oauthStatus(sessionId: string): Promise<{ status: "pending" | "success" | "error" | "expired"; email: string; error: string }>;
  enableWarmup(emails: string[]): Promise<unknown>;
  disableWarmup(emails: string[]): Promise<unknown>;
  warmupAnalytics(emails: string[]): Promise<Record<string, WarmupStats>>;
};
export function createInstantly(credentials: { apiKey: string }, options?: { fetchImpl?: typeof fetch; sleepImpl?: (ms: number) => Promise<void> }): InstantlyClient;
export function summariseWarmup(payload: unknown): Record<string, WarmupStats>;
export const EXTERNAL_WARMUP_DAYS: number;
export function externalWarmupProgress(startedAt: string | null | undefined, now?: number, days?: number): { day: number; days: number; progress: number; ready: boolean };
