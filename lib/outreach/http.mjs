// Shared HTTP client for Outreach provider adapters: retries with backoff on 429/5xx,
// honours Retry-After, never retries non-idempotent calls unless told they are safe,
// and never puts the API key into an error message.

export class ProviderError extends Error {
  constructor(provider, status, message, { retryable = false, code = "" } = {}) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = status;
    this.retryable = retryable;
    this.code = code;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function retryDelayMs(attempt, retryAfterHeader, baseMs = 500, capMs = 20_000) {
  const header = Number(retryAfterHeader);
  if (Number.isFinite(header) && header >= 0) return Math.min(header * 1000, capMs);
  return Math.min(baseMs * 2 ** attempt, capMs);
}

/**
 * @param {object} opts
 * @param {string} opts.provider     name used in errors
 * @param {string} opts.url
 * @param {string} [opts.method]
 * @param {Record<string,string>} [opts.headers]
 * @param {unknown} [opts.body]
 * @param {boolean} [opts.idempotent]  GETs are idempotent; pass true for safe retried writes
 * @param {number} [opts.retries]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {(ms:number)=>Promise<void>} [opts.sleepImpl]
 * @param {(status:number, payload:any)=>string} [opts.describeError]
 */
export async function providerRequest(opts) {
  const method = (opts.method || "GET").toUpperCase();
  const idempotent = opts.idempotent ?? method === "GET";
  const retries = opts.retries ?? (idempotent ? 3 : 0);
  const doFetch = opts.fetchImpl || fetch;
  const wait = opts.sleepImpl || sleep;
  const headers = { Accept: "application/json", ...(opts.headers || {}) };
  let body;
  if (opts.body !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.body); }

  for (let attempt = 0; ; attempt += 1) {
    let response;
    try {
      response = await doFetch(opts.url, { method, headers, body, signal: AbortSignal.timeout(25_000) });
    } catch {
      if (attempt < retries) { await wait(retryDelayMs(attempt)); continue; }
      throw new ProviderError(opts.provider, 0, `${opts.provider} could not be reached. Check the connection and try again.`, { retryable: true, code: "network" });
    }
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text.slice(0, 300) }; }
    if (response.ok) return payload;
    const retryable = response.status === 429 || response.status >= 500;
    if (retryable && attempt < retries) { await wait(retryDelayMs(attempt, response.headers.get("Retry-After"))); continue; }
    const message = opts.describeError ? opts.describeError(response.status, payload) : `${opts.provider} returned an error (${response.status}).`;
    throw new ProviderError(opts.provider, response.status, message, { retryable, code: String(response.status) });
  }
}
