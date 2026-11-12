// The agency's chosen currency (Settings > Currency). Amounts are displayed in
// this currency; stored numbers are not converted.
export const CURRENCIES = [
  { code: "EUR", label: "Euro (€)" }, { code: "GBP", label: "British pound (£)" }, { code: "USD", label: "US dollar ($)" },
  { code: "CAD", label: "Canadian dollar (CA$)" }, { code: "AUD", label: "Australian dollar (A$)" }, { code: "CHF", label: "Swiss franc (CHF)" },
  { code: "SEK", label: "Swedish krona (kr)" }, { code: "NOK", label: "Norwegian krone (kr)" }, { code: "DKK", label: "Danish krone (kr)" },
  { code: "PLN", label: "Polish złoty (zł)" }, { code: "AED", label: "UAE dirham (AED)" }, { code: "INR", label: "Indian rupee (₹)" },
] as const;

let current = "EUR";
try { const saved = typeof window !== "undefined" ? window.localStorage.getItem("f2b-currency") : null; if (saved) current = saved; } catch { /* storage unavailable */ }

export const getDisplayCurrency = () => current;
export const setDisplayCurrency = (code: string) => {
  const next = CURRENCIES.some((item) => item.code === code) ? code : "EUR";
  if (next === current) return;
  current = next;
  try { window.localStorage.setItem("f2b-currency", next); } catch { /* storage unavailable */ }
};
export const currencySymbol = (code = current) => { try { return new Intl.NumberFormat("en-IE", { style: "currency", currency: code, maximumFractionDigits: 0 }).formatToParts(0).find((part) => part.type === "currency")?.value || code; } catch { return code; } };
