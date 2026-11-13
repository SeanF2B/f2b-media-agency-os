const ATTRIBUTION_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "gbraid", "wbraid", "f2b_ref", "f2b_landing"];

function cleanValue(value) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 160);
}

export function readMarketingAttribution(source) {
  if (!source || typeof source.get !== "function") return {};
  const attribution = {};
  for (const key of ATTRIBUTION_KEYS) {
    const value = cleanValue(source.get(key));
    if (value) attribution[key] = value;
  }
  return attribution;
}

export function renderMarketingAttributionFields(attribution) {
  const query = new URLSearchParams(Object.entries(attribution || {}));
  return Object.entries(readMarketingAttribution(query))
    .map(([key, value]) => `<input type="hidden" name="__f2b_${key}" value="${escapeHtml(value)}">`)
    .join("");
}

export function readSubmittedMarketingAttribution(form) {
  if (!form || typeof form.get !== "function") return {};
  const values = new URLSearchParams();
  for (const key of ATTRIBUTION_KEYS) {
    const value = form.get(`__f2b_${key}`);
    if (typeof value === "string" && value) values.set(key, value);
  }
  return readMarketingAttribution(values);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
}
