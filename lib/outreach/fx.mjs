// Currency conversion with the European Central Bank's daily reference rates (free, no key,
// served by frankfurter.dev). Rates are US$-based so provider prices (Cloudflare, OpenRouter,
// Instantly — all billed in US$) convert to your account currency.

export const FX_SOURCES = ["https://api.frankfurter.dev/v1/latest?base=USD", "https://api.frankfurter.app/latest?from=USD"];

/** { date, rates } with rates[XXX] = units of XXX per 1 US$. */
export function parseRates(payload) {
  const rates = payload?.rates && typeof payload.rates === "object" ? { ...payload.rates } : null;
  if (!rates || !payload.date) throw new Error("Exchange rates weren't in the expected format.");
  rates.USD = 1;
  return { base: "USD", date: String(payload.date), rates };
}

export async function fetchUsdRates(fetchImpl = fetch) {
  let lastError;
  for (const url of FX_SOURCES) {
    try {
      const response = await fetchImpl(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Exchange-rate service returned ${response.status}.`);
      return parseRates(await response.json());
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error("Exchange rates unavailable.");
}

/** Converts minor units between currencies. Returns null when a rate is missing (never guesses). */
export function convertCents(cents, from, to, fx) {
  if (cents === null || cents === undefined || !Number.isFinite(Number(cents))) return null;
  const source = String(from || "USD").toUpperCase(), target = String(to || "USD").toUpperCase();
  if (source === target) return Math.round(Number(cents));
  const rateFrom = fx?.rates?.[source], rateTo = fx?.rates?.[target];
  if (!rateFrom || !rateTo) return null;
  return Math.round((Number(cents) / rateFrom) * rateTo);
}
