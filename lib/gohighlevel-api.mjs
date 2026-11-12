export function ghlFunnelsV4Path(locationId, skip = 0, limit = 100) {
  const query = new URLSearchParams({ locationId, limit: String(limit), skip: String(skip) });
  return `/funnels/funnel?${query}`;
}

export function ghlFunnelPagesV4Path(funnelId, locationId, skip = 0, limit = 20) {
  const query = new URLSearchParams({ locationId, limit: String(limit), skip: String(skip) });
  return `/funnels/funnel/${encodeURIComponent(funnelId)}/pages?${query}`;
}

export function normalizeGhlFunnels(payload) {
  const funnels = payload && typeof payload === "object" ? payload.funnels : null;
  if (Array.isArray(funnels)) return funnels;
  return funnels && typeof funnels === "object" ? [funnels] : [];
}

export function normalizeGhlPages(payload) {
  if (Array.isArray(payload)) return payload;
  const pages = payload && typeof payload === "object" ? payload.pages : null;
  return Array.isArray(pages) ? pages : [];
}

export function ghlProviderError(payload, status) {
  const body = payload && typeof payload === "object" ? payload : {};
  const candidate = [body.message, body.error_description, body.error, body.detail]
    .find((value) => typeof value === "string" && value.trim());
  const message = typeof candidate === "string" ? candidate.replace(/[\r\n\t]+/g, " ").trim().slice(0, 240) : "Check the sub-account ID and required permissions.";
  return `GHL returned HTTP ${status}: ${message}`;
}
