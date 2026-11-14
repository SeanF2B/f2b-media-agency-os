// Instantly API v2 adapter (https://developer.instantly.ai). The Outreach UI talks to
// this through the generic sending-provider shape below, so Instantly can be swapped
// for another sending platform later without touching the interface.
//
// Verified against Instantly's published v2 reference (Nov 2026):
//   GET  /api/v2/accounts?limit=1..100&starting_after=…   -> { items, next_starting_after }
//   POST /api/v2/accounts/warmup/enable|disable { emails[] ≤100 } -> background job
//   POST /api/v2/accounts/{email}/pause | /resume
//   GET  /api/v2/campaigns, GET /api/v2/campaigns/analytics
//   GET  /api/v2/emails (20 req/min), POST /api/v2/emails/reply
//   GET  /api/v2/background-jobs/{id}
// Webhooks require the Hypergrowth plan; everything else works with any paid plan.

import { ProviderError, providerRequest } from "../http.mjs";

const BASE = "https://api.instantly.ai/api/v2";

export const ACCOUNT_STATUS = { 1: "active", 2: "paused", 3: "maintenance", [-1]: "connection-error", [-2]: "soft-bounce-error", [-3]: "sending-error" };
export const WARMUP_STATUS = { 0: "paused", 1: "active", [-1]: "banned", [-2]: "spam-folder-unknown", [-3]: "suspended" };
export const PROVIDER_CODE = { 1: "imap-smtp", 2: "google", 3: "microsoft", 4: "aws", 8: "airmail", 11: "airmail-instant" };

function describe(status, payload) {
  if (status === 401) return "Instantly rejected the API key. Create a new key in Instantly → Settings → Integrations → API keys.";
  if (status === 402) return "Instantly says this workspace has no active paid plan.";
  if (status === 403) return "This Instantly API key doesn't have permission for that action. Use a key with the all:all scope.";
  if (status === 404) return "Instantly couldn't find that item.";
  if (status === 429) return "Instantly is rate-limiting requests. The app will retry shortly.";
  const message = payload && typeof payload === "object" ? String(payload.message || payload.error || "") : "";
  return message ? `Instantly: ${message.slice(0, 200)}` : `Instantly returned an error (${status}).`;
}

/** Normalise an Instantly account into the provider-neutral mailbox shape. */
export function normaliseAccount(item) {
  const email = String(item?.email || "").toLowerCase();
  return {
    email,
    domain: email.split("@")[1] || "",
    firstName: String(item?.first_name || ""),
    lastName: String(item?.last_name || ""),
    status: ACCOUNT_STATUS[item?.status] || "unknown",
    statusCode: typeof item?.status === "number" ? item.status : null,
    warmupStatus: WARMUP_STATUS[item?.warmup_status] || "unknown",
    warmupScore: typeof item?.stat_warmup_score === "number" ? item.stat_warmup_score : null,
    dailyLimit: typeof item?.daily_limit === "number" ? item.daily_limit : null,
    mailProvider: PROVIDER_CODE[item?.provider_code] || "unknown",
    setupPending: Boolean(item?.setup_pending),
    tags: Array.isArray(item?.tags) ? item.tags.map((tag) => String(tag?.label || "")).filter(Boolean) : [],
  };
}

export function createInstantlyClient(apiKey, { fetchImpl, sleepImpl } = {}) {
  if (!apiKey || typeof apiKey !== "string") throw new ProviderError("Instantly", 0, "Connect an Instantly API key first.");
  const call = (path, { method = "GET", query, body, idempotent } = {}) => {
    const url = new URL(`${BASE}${path}`);
    for (const [key, value] of Object.entries(query || {})) if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
    return providerRequest({ provider: "Instantly", url: url.toString(), method, body, idempotent, headers: { Authorization: `Bearer ${apiKey}` }, fetchImpl, sleepImpl, describeError: describe });
  };

  return {
    name: "instantly",
    /** Cheapest call that proves the key works. */
    async verify() { await call("/accounts", { query: { limit: 1 } }); return true; },

    /** All sending accounts, following the cursor. maxPages guards against runaway loops. */
    async listAccounts({ maxPages = 50 } = {}) {
      const out = [];
      let cursor;
      for (let page = 0; page < maxPages; page += 1) {
        const result = await call("/accounts", { query: { limit: 100, starting_after: cursor, include_tags: true } });
        const items = Array.isArray(result?.items) ? result.items : [];
        out.push(...items.map(normaliseAccount));
        const next = result?.next_starting_after;
        if (!next || items.length === 0 || next === cursor) break;
        cursor = next;
      }
      return out;
    },

    async setWarmup(emails, enabled) {
      const list = [...new Set(emails.map((email) => String(email).toLowerCase()))];
      const jobs = [];
      for (let index = 0; index < list.length; index += 100) {
        jobs.push(await call(`/accounts/warmup/${enabled ? "enable" : "disable"}`, { method: "POST", body: { emails: list.slice(index, index + 100) }, idempotent: true }));
      }
      return jobs.map((job) => ({ id: String(job?.id || ""), status: String(job?.status || "pending") }));
    },
    async backgroundJob(id) { return call(`/background-jobs/${encodeURIComponent(id)}`); },
    async pauseAccount(email) { return normaliseAccount(await call(`/accounts/${encodeURIComponent(email)}/pause`, { method: "POST", idempotent: true })); },
    async resumeAccount(email) { return normaliseAccount(await call(`/accounts/${encodeURIComponent(email)}/resume`, { method: "POST", idempotent: true })); },
    async setDailyLimit(email, dailyLimit) {
      if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 200) throw new ProviderError("Instantly", 400, "Daily limit must be a whole number between 1 and 200.");
      return normaliseAccount(await call(`/accounts/${encodeURIComponent(email)}`, { method: "PATCH", body: { daily_limit: dailyLimit }, idempotent: true }));
    },
    async warmupAnalytics(emails) { return call("/accounts/warmup-analytics", { method: "POST", body: { emails }, idempotent: true }); },

    async listCampaigns({ maxPages = 20 } = {}) {
      const out = [];
      let cursor;
      for (let page = 0; page < maxPages; page += 1) {
        const result = await call("/campaigns", { query: { limit: 100, starting_after: cursor } });
        const items = Array.isArray(result?.items) ? result.items : [];
        out.push(...items);
        if (!result?.next_starting_after || items.length === 0) break;
        cursor = result.next_starting_after;
      }
      return out;
    },
    async campaignAnalytics({ startDate, endDate, campaignId } = {}) {
      return call("/campaigns/analytics", { query: { start_date: startDate, end_date: endDate, id: campaignId } });
    },

    /** Received emails (ue_type 2) for the unified inbox. Instantly limits this to 20 req/min. */
    async listReceived({ limit = 50, cursor, campaignId } = {}) {
      const result = await call("/emails", { query: { limit, starting_after: cursor, email_type: "received", campaign_id: campaignId } });
      return { items: Array.isArray(result?.items) ? result.items : [], next: result?.next_starting_after || null };
    },
    /** Sending a reply is never retried automatically: a timeout could mean it was sent. */
    async reply({ replyToId, fromAccount, subject, html, text }) {
      if (!replyToId || !fromAccount || !subject || !(html || text)) throw new ProviderError("Instantly", 400, "A reply needs the original email, sending account, subject and body.");
      return call("/emails/reply", { method: "POST", body: { reply_to_uuid: replyToId, eaccount: fromAccount, subject, body: { ...(html ? { html } : {}), ...(text ? { text } : {}) } }, idempotent: false });
    },
  };
}
