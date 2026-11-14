// Cloudflare Registrar API (beta) — search, check and register sending domains.
// Verified live on 14 Nov 2026: GET /registrar/domain-search and POST /registrar/domain-check
// return { domains: [{ name, registrable, tier, pricing: { currency, registration_cost, renewal_cost } }] }.
//
// PURCHASE LOCK: register() refuses unless purchases are explicitly enabled server-side
// (OUTREACH_PURCHASES_ENABLED=true) AND the caller passes an approval record. Nothing can be
// bought by accident, by a retry, or by the AI.

import { ProviderError, providerRequest } from "./http.mjs";

const CF = "https://api.cloudflare.com/client/v4";

export function suggestDomainNames(businessName, { count = 12 } = {}) {
  const base = String(businessName || "").toLowerCase().replace(/&/g, "and").replace(/\b(ltd|limited|llc|inc|plc|co|company|the)\b/g, "").replace(/[^a-z0-9]+/g, "");
  if (base.length < 2) return [];
  const short = base.slice(0, 20);
  const patterns = [`${short}`, `get${short}`, `try${short}`, `${short}hq`, `meet${short}`, `${short}team`, `hello${short}`, `${short}group`, `join${short}`, `${short}mail`, `go${short}`, `${short}media`];
  const tlds = [".com", ".co", ".net", ".io", ".ie", ".uk"];
  const out = [];
  for (const pattern of patterns) for (const tld of tlds.slice(0, 2)) out.push(`${pattern}${tld}`);
  return [...new Set(out)].slice(0, count);
}

const toCents = (value) => Math.round(Number(value || 0) * 100);
export function normaliseOffer(item) {
  return { domain: String(item?.name || "").toLowerCase(), available: Boolean(item?.registrable), tier: String(item?.tier || ""), currency: String(item?.pricing?.currency || "USD"), registrationCents: toCents(item?.pricing?.registration_cost), renewalCents: toCents(item?.pricing?.renewal_cost), reason: String(item?.reason || "") };
}

export function createRegistrar({ apiToken, accountId, purchasesEnabled = false }, { fetchImpl, sleepImpl } = {}) {
  if (!apiToken || !accountId) throw new ProviderError("Cloudflare", 0, "Connect a Cloudflare token first (Domains & DNS).");
  const call = (path, init = {}) => providerRequest({ provider: "Cloudflare", url: `${CF}/accounts/${accountId}${path}`, headers: { Authorization: `Bearer ${apiToken}` }, fetchImpl, sleepImpl, describeError: (status, payload) => status === 403 ? "The Cloudflare token needs the Registrar permission for this." : `Cloudflare: ${String(payload?.errors?.[0]?.message || status).slice(0, 200)}`, ...init });
  return {
    async search(query, { limit = 10 } = {}) { const result = await call(`/registrar/domain-search?q=${encodeURIComponent(query)}&limit=${limit}`); return (result?.result?.domains || []).map(normaliseOffer); },
    async check(domains) {
      const list = [...new Set(domains.map((domain) => String(domain).toLowerCase().trim()).filter(Boolean))];
      const out = [];
      for (let index = 0; index < list.length; index += 20) {
        const result = await call("/registrar/domain-check", { method: "POST", body: { domains: list.slice(index, index + 20) }, idempotent: true });
        out.push(...(result?.result?.domains || []).map(normaliseOffer));
      }
      return out;
    },
    async registration(domain) { try { return (await call(`/registrar/registrations/${encodeURIComponent(domain)}`))?.result || null; } catch (error) { if (error.status === 404) return null; throw error; } },
    async registrationStatus(domain) { return (await call(`/registrar/registrations/${encodeURIComponent(domain)}/registration-status`))?.result || null; },
    /** Billable. Never retried automatically; idempotency is enforced by the caller's job step key. */
    async register(domain, { approval, years = 1, autoRenew = true } = {}) {
      if (!purchasesEnabled) throw new ProviderError("Cloudflare", 0, "Domain purchasing is switched off on the server (OUTREACH_PURCHASES_ENABLED). Nothing was bought.", { code: "purchases-disabled" });
      if (!approval?.approvedBy || !approval?.approvedAt || !Array.isArray(approval?.domains) || !approval.domains.includes(domain)) throw new ProviderError("Cloudflare", 0, `No approval on record for ${domain}. Nothing was bought.`, { code: "not-approved" });
      const existing = await this.registration(domain);
      if (existing) return { domain, alreadyOwned: true, status: existing.status || "registered" };
      const result = await call("/registrar/registrations", { method: "POST", idempotent: false, body: { domain_name: domain, years, auto_renew: autoRenew, privacy_mode: "redaction" } });
      return { domain, alreadyOwned: false, status: String(result?.result?.status || "pending"), workflow: result?.result || null };
    },
  };
}
