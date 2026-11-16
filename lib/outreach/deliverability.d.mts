export type AuthState = "pass" | "fail" | "missing";
export type AuthResult = { spf: AuthState; dkim: AuthState; dmarc: AuthState; mx: AuthState; details: string[]; allPass: boolean };
export const HOST_EXPECTATIONS: Readonly<Record<string, { spfInclude: string; mx: RegExp; dkimSelectors: string[] }>>;
export function dohAnswers(json: unknown, type: "TXT" | "MX" | "CNAME"): string[];
export function evaluateAuth(p: { host?: "microsoft" | "google" | "smtp"; apexTxt?: string[]; dmarcTxt?: string[]; mx?: string[]; dkim?: Record<string, string[]>; customDkimSelector?: string }): AuthResult;
export function campaignAuthGate(mailboxes: Array<{ domain: string }>, domainChecks: Record<string, Partial<AuthResult> & { checkedAt?: string }>): { ok: boolean; blocking: Array<{ domain: string; reason: string }> };
export function adaptiveBand(s: { healthBand: "green" | "amber" | "red" | "grey"; placementInboxRate?: number | null; gmailSpamRate?: number | null; authAllPass?: boolean; recentBounceRate?: number | null }): { band: "green" | "amber" | "red" | "grey"; reasons: string[] };
