export const SEED_OAUTH: Readonly<Record<"gmail" | "outlook", { authorize: string; token: string; scope: string; extra: Record<string, string> }>>;
export function newPlacementToken(): string;
export function seedAuthorizeUrl(provider: "gmail" | "outlook", p: { clientId: string; redirectUri: string; state: string }): string;
export function exchangeSeedToken(provider: "gmail" | "outlook", p: { clientId: string; clientSecret: string; redirectUri: string; code: string; refreshToken?: string }, deps?: { fetchImpl?: typeof fetch }): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }>;
export function findPlacement(provider: "gmail" | "outlook", accessToken: string, token: string, deps?: { fetchImpl?: typeof fetch; sleepImpl?: (ms: number) => Promise<void> }): Promise<"inbox" | "promotions" | "other-tab" | "spam" | "missing">;
export function gmailPlacement(labels: string[]): "inbox" | "promotions" | "other-tab" | "spam";
export function summarisePlacement(results: Array<{ placement: string }>): { total: number; inbox: number; tabs: number; spam: number; missing: number; inboxRate: number | null; reachedRate: number | null };
