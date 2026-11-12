export function normalizeSearchConsoleProperties(input) {
  if (!input || typeof input !== "object" || !Array.isArray(input.siteEntry)) return [];
  return input.siteEntry.flatMap((entry) => {
    const id = String(entry?.siteUrl || "").trim();
    if (!id) return [];
    return [{ id, name: id, permissionLevel: String(entry.permissionLevel || "") }];
  });
}

export function normalizeSearchConsoleRows(input, propertyId) {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const keys = Array.isArray(item.keys) ? item.keys : [];
    const date = String(keys[0] || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    return [{
      date,
      query: String(keys[1] || ""),
      page: String(keys[2] || propertyId),
      clicks: Number(item.clicks || 0),
      impressions: Number(item.impressions || 0),
      ctr: Number(item.ctr || 0),
      position: Number(item.position || 0),
    }];
  });
}
