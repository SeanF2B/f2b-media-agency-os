// Account currency (from your workspace settings) and cached ECB exchange rates.
import { fetchUsdRates, type FxRates } from "@/lib/outreach/fx.mjs";
import { db, saveSettings, type OutreachSettings } from "./store";

/** The currency your books use (Settings → currency), e.g. "EUR". */
export async function accountCurrency(): Promise<string> {
  const row = await db().prepare("SELECT json_extract(data, '$.settings.currency') AS currency FROM workspace_documents WHERE id = 'f2b-agency'").first<{ currency: string | null }>();
  const value = String(row?.currency || "").toUpperCase();
  return /^[A-Z]{3}$/.test(value) ? value : "EUR";
}

/** US$-based ECB rates, refreshed at most every ~20 hours; falls back to the last good rates. */
export async function usdRates(ownerId: string, settings: OutreachSettings): Promise<FxRates | null> {
  const cached = settings.fx;
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 20 * 3600_000) return cached;
  try {
    const fresh = await fetchUsdRates();
    await saveSettings(ownerId, { fx: { ...fresh, fetchedAt: new Date().toISOString() } });
    return fresh;
  } catch (error) {
    console.error("outreach:fx", error);
    return cached || null;
  }
}
