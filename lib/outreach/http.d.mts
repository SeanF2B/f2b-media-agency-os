export class ProviderError extends Error { provider: string; status: number; retryable: boolean; code: string; }
export function retryDelayMs(attempt: number, retryAfterHeader?: string | null, baseMs?: number, capMs?: number): number;
export function providerRequest<T = unknown>(opts: { provider: string; url: string; method?: string; headers?: Record<string, string>; body?: unknown; idempotent?: boolean; retries?: number; fetchImpl?: typeof fetch; sleepImpl?: (ms: number) => Promise<void>; describeError?: (status: number, payload: unknown) => string }): Promise<T>;
