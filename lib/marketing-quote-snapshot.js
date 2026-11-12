export function createMarketingQuoteSnapshot({ quote, calculatorVersion, pricingRuleVersion, currency }) {
  const version = Number(calculatorVersion);
  return {
    ...quote,
    calculatorVersion: Number.isInteger(version) && version > 0 ? version : 1,
    currency: /^[A-Z]{3}$/.test(String(currency || "")) ? String(currency) : "EUR",
    pricingRuleVersion: /^[a-f0-9]{16}$/i.test(String(pricingRuleVersion || "")) ? String(pricingRuleVersion).toLowerCase() : "",
  };
}

export function stampMarketingPublicationVersion(serializedData, version) {
  const parsed = JSON.parse(serializedData);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("Published project data must be an object.");
  const normalizedVersion = Number(version);
  if (!Number.isInteger(normalizedVersion) || normalizedVersion < 1) throw new TypeError("Published project version must be a positive integer.");
  return JSON.stringify({ ...parsed, _marketingPublicationVersion: normalizedVersion });
}
