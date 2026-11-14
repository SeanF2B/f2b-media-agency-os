"use client";
// Small client for /api/outreach plus shared types and formatting helpers.

export type Health = { score: number | null; band: "green" | "amber" | "red" | "grey"; label: string; factors: Array<{ key: string; label: string; max: number; points: number | null; available: boolean; detail: string }>; adaptive?: string[]; placementInboxRate?: number | null; pause?: { required: boolean; reasons: string[] } };
export type Mailbox = { id: string; email: string; domain: string; host: string; displayName: string; group: string; tags: string[]; clientId: string | null; status: string; pausedReason: string; targetDaily: number; sentToday: number; limitToday: number; rampPhase: string; rampReason: string; rampProgress: number; health: Partial<Health>; monthlyCostCents: number | null; renewsAt: string | null; campaigns: Array<{ id: string; name: string }> };
export type Variant = { id: string; subject: string; body: string; weight?: number };
export type Step = { id?: string; position?: number; delayDays: number; variants: Variant[] };
export type Campaign = { id: string; name: string; status: string; clientId: string | null; niche: string; offer: string; mailboxIds: string[]; schedule: { days?: number[]; start?: string; end?: string; tz?: string; fallbackTz?: string }; dailyCap: number; lawfulBasis: string; pipelineId: string | null; stageId: string | null; updatedAt: string; steps: Step[]; stats: { sent: number; replies: number; positive: number } };
export type Job = { id: string; status: string; createdAt: string; input: any; progress: { done: number; total: number; percent: number; failed: number; waitingManual: number; state: string }; steps: Array<{ key: string; status: string; message: string; kind: string; label: string; domain: string; email?: string; manual: boolean; chargeable: boolean; note?: string; attempts: number }> };
export type CheckResult = { spf?: string; dkim?: string; dmarc?: string; mx?: string; details?: string[]; allPass?: boolean; checkedAt?: string };
export type Domain = { id: string; domain: string; host: string; protected: boolean; check: CheckResult; expiresAt: string | null; annualCostCents: number | null; dmarcStage: string };
export type OutreachState = {
  settings: { cooldownDays: number; bookingUrl: string; seatPriceCents: { microsoft: number | null; google: number | null; smtp: number | null }; workersPlanCents: number | null; defaultTargetDaily: number; dmarcReportEmail: string; senderAddress: string; appUrl: string };
  purchasesEnabled: boolean;
  connections: Array<{ provider: string; status: string; config: Record<string, any>; lastError: string; verifiedAt: string | null; fingerprint: string }>;
  range: { from: string; to: string; campaign: string };
  overview: { sent: number; positive: number; positiveRate: number | null; replies: number; qualified: number; meetings: number; activeCampaigns: number; activeMailboxes: number; warming: number; reviewQueue: number; health: number | null; issues: Array<{ level: "critical" | "warning"; text: string }> };
  costs: { lines: Array<{ key: string; label: string; cents: number; source: string; complete: boolean; detail?: string }>; totalCents: number; complete: boolean; openRouterAccountMonthUsd: number | null; perMailboxCents: number | null };
  mailboxes: Mailbox[]; domains: Domain[]; campaigns: Campaign[]; jobs: Job[];
  seeds: Array<{ id: string; provider: string; email: string; status: string; last_error: string }>;
  placementTests: Array<{ id: string; mailboxId: string; status: string; inboxRate: number | null; results: Array<{ seed: string; provider: string; placement: string }>; createdAt: string; completedAt: string | null }>;
  suppressionCount: number; playbookKinds: Record<string, string>; seedAppsConfigured: { gmail: boolean; outlook: boolean };
};

export async function outreachGet(params: Record<string, string> = {}): Promise<OutreachState> {
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value));
  const response = await fetch(`/api/outreach?${query.toString()}`, { cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as { error?: string } & Record<string, unknown>;
  if (!response.ok) throw new Error(payload.error || "Could not load Outreach.");
  return payload as unknown as OutreachState;
}

export async function outreachAction<T = any>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch("/api/outreach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...body }) });
  const payload = await response.json().catch(() => ({})) as { error?: string } & Record<string, unknown>;
  if (!response.ok) throw new Error(payload.error || "That didn't work. Try again.");
  return payload as unknown as T;
}

export const money = (cents: number | null | undefined, currency = "USD") => cents === null || cents === undefined ? "—" : new Intl.NumberFormat("en-IE", { style: "currency", currency, maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
export const pct = (value: number | null | undefined) => value === null || value === undefined ? "—" : `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
export const num = (value: number) => new Intl.NumberFormat("en-IE").format(value);
export const ago = (iso: string | null | undefined) => { if (!iso) return "—"; const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000); if (minutes < 1) return "just now"; if (minutes < 60) return `${minutes}m ago`; const hours = Math.round(minutes / 60); if (hours < 48) return `${hours}h ago`; return new Date(iso).toLocaleDateString("en-IE", { day: "numeric", month: "short" }); };
export const LABELS: Record<string, string> = { positive: "Positive", review: "Needs review", question: "Question", objection: "Objection", referral: "Referral", "meeting-booked": "Meeting booked", negative: "Not interested", "out-of-office": "Out of office", unsubscribe: "Unsubscribe", bounce: "Bounce", spam: "Spam", "needs-review": "Needs review", all: "All" };
