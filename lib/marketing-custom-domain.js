export function normalizeMarketingHostname(value) {
  if (typeof value !== "string" || value.length > 300) return "";
  const input = value.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "").toLowerCase();
  if (!input || /[\s/@?#:]/.test(input)) return "";
  try {
    const hostname = new URL(`https://${input}`).hostname.toLowerCase().replace(/\.$/, "");
    if (hostname.length > 253 || hostname === "localhost" || !hostname.includes(".")) return "";
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)) return "";
    if (/^\d+(?:\.\d+){3}$/.test(hostname)) return "";
    return hostname;
  } catch { return ""; }
}

export function createMarketingDomainVerificationToken(random = () => crypto.randomUUID()) {
  return `f2b-${String(random()).replace(/[^a-zA-Z0-9-]/g, "").toLowerCase()}`.slice(0, 80);
}

export function marketingDomainVerificationRecord(hostname, token) {
  const host = normalizeMarketingHostname(hostname);
  if (!host || typeof token !== "string" || !/^f2b-[a-z0-9-]{16,80}$/.test(token)) return null;
  return { type: "TXT", name: `_f2b-verify.${host}`, value: token };
}

export function marketingDomainDnsRecordContainsToken(payload, token) {
  if (!payload || !Array.isArray(payload.Answer) || typeof token !== "string") return false;
  return payload.Answer.some((answer) => Number(answer.type) === 16 && String(answer.data || "").replace(/^"|"$/g, "").trim() === token);
}

export function isMarketingDomainVerified(record) {
  return Boolean(record && record.status === "verified" && typeof record.verifiedAt === "string" && record.verifiedAt);
}

export function marketingCustomDomainPageUrl(requestUrl, slug) {
  if (typeof slug !== "string" || !/^[a-z0-9-]{1,120}$/i.test(slug)) return null;
  const url = new URL(requestUrl);
  if (url.pathname !== "/") return null;
  url.pathname = `/f/${encodeURIComponent(slug)}`;
  return url;
}
