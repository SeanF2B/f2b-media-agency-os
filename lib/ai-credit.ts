/** OpenRouter rejects a request when the key's remaining credit can't cover max tokens ("can only afford 485").
 *  Returns a smaller token budget to retry with, or null if that isn't the problem. */
export function affordableTokens(message: unknown): number | null {
  const m = /can only afford (\d+)/i.exec(String(message || ""));
  if (!m) return null;
  const n = Number(m[1]) - 15;
  return n >= 60 ? n : null;
}
export const AI_CREDIT_MESSAGE = "The AI is out of credit for now. Top up OpenRouter (or raise the key’s monthly limit) and try again.";
export const isCreditError = (message: unknown) => /credit|afford|max_tokens|insufficient|quota/i.test(String(message || ""));

/** POST to the AI with automatic retry on a smaller budget when credit is low. */
export async function postWithCreditRetry(url: string, init: { headers: HeadersInit; body: Record<string, unknown>; timeoutMs?: number }) {
  let body = init.body;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(url, { method: "POST", headers: init.headers, body: JSON.stringify(body), signal: AbortSignal.timeout(init.timeoutMs || 30_000) });
    const payload = await response.json().catch(() => null) as any;
    if (response.ok) return { ok: true as const, payload };
    const message = payload?.error?.message || payload?.error || "";
    const fit = affordableTokens(message);
    if (fit && attempt === 0) { body = { ...body, max_output_tokens: fit }; continue; }
    return { ok: false as const, payload, message: isCreditError(message) ? AI_CREDIT_MESSAGE : String(message || "The AI didn’t respond. Try again.") };
  }
  return { ok: false as const, payload: null, message: AI_CREDIT_MESSAGE };
}
