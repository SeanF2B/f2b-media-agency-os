export type FxRates = { base: "USD"; date: string; rates: Record<string, number> };
export const FX_SOURCES: string[];
export function parseRates(payload: unknown): FxRates;
export function fetchUsdRates(fetchImpl?: typeof fetch): Promise<FxRates>;
export function convertCents(cents: number | null | undefined, from: string, to: string, fx: FxRates | null | undefined): number | null;
