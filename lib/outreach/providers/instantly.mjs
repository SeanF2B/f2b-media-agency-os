// Instantly API v2 — used ONLY for warm-up (its warm-up network). Campaigns, replies and the CRM
// stay in Agency OS. Docs: https://developer.instantly.ai (accounts, warmup, oauth endpoints).
import { ProviderError, providerRequest } from "../http.mjs";

const BASE = "https://api.instantly.ai/api/v2";

const describe = (status, payload) => {
  const message = payload?.message || payload?.error_description || payload?.error || "";
  if (status === 401) return "Instantly rejected the API key. Create a new key with the accounts:all scope.";
  if (status === 403) return "This Instantly API key is missing a scope. It needs accounts:all.";
  if (status === 402) return "Your Instantly plan doesn't allow this. Check the subscription is active.";
  return message ? `Instantly: ${message}` : `Instantly returned an error (${status}).`;
};

/** Instantly warmup_status codes → plain states. */
export const WARMUP_STATES = { 0: "paused", 1: "active", [-1]: "banned", [-2]: "spam-folder-unknown", [-3]: "suspended" };
/** Instantly account status codes → plain states. */
export const ACCOUNT_STATES = { 1: "active", 2: "paused", 3: "maintenance", [-1]: "connection-error", [-2]: "soft-bounce-error", [-3]: "sending-error" };

export function createInstantly({ apiKey }, { fetchImpl, sleepImpl } = {}) {
  if (!apiKey) throw new ProviderError("Instantly", 0, "Connect Instantly with an API key first.");
  const call = (path, { method = "GET", body, idempotent } = {}) => providerRequest({
    provider: "Instantly", url: `${BASE}${path}`, method, body, idempotent,
    headers: { Authorization: `Bearer ${apiKey}` }, fetchImpl, sleepImpl, describeError: describe,
  });
  return {
    /** Confirms the key works (and has read access to accounts). */
    async verify() { const result = await call("/accounts?limit=1"); return { ok: true, accounts: Array.isArray(result?.items) ? result.items.length : 0 }; },
    /** The Instantly account for this address, or null when it isn't in the workspace yet. */
    async getAccount(email) {
      try { return await call(`/accounts/${encodeURIComponent(email)}`); }
      catch (error) { if (error instanceof ProviderError && error.status === 404) return null; throw error; }
    },
    /** Starts the one-click Google / Microsoft sign-in that adds a mailbox to Instantly (10-minute session). */
    async startOAuth(host) {
      const result = await call(`/oauth/${host === "google" ? "google" : "microsoft"}/init`, { method: "POST", body: {} });
      return { sessionId: result.session_id, authUrl: result.auth_url, expiresAt: result.expires_at };
    },
    async oauthStatus(sessionId) {
      const result = await call(`/oauth/session/status/${encodeURIComponent(sessionId)}`);
      return { status: result.status, email: result.email || "", error: result.error_description || result.error || "" };
    },
    async enableWarmup(emails) { return call("/accounts/warmup/enable", { method: "POST", body: { emails }, idempotent: true }); },
    async disableWarmup(emails) { return call("/accounts/warmup/disable", { method: "POST", body: { emails }, idempotent: true }); },
    /** Aggregate warm-up numbers per address: sent, received, landed inbox/spam, health score. */
    async warmupAnalytics(emails) {
      if (!emails.length) return {};
      const out = {};
      for (let index = 0; index < emails.length; index += 100) {
        const result = await call("/accounts/warmup-analytics", { method: "POST", body: { emails: emails.slice(index, index + 100) }, idempotent: true });
        Object.assign(out, summariseWarmup(result));
      }
      return out;
    },
  };
}

/** Normalises the warmup-analytics payload (fields may be missing or formatted differently). */
export function summariseWarmup(payload) {
  const out = {};
  for (const [email, data] of Object.entries(payload?.aggregate_data || {})) {
    const sent = Number(data?.sent || 0), received = Number(data?.received || 0);
    const inbox = Number(data?.landed_inbox || 0), spam = Number(data?.landed_spam || 0);
    const score = Number.isFinite(Number(data?.health_score)) ? Number(data.health_score) : Number.parseFloat(String(data?.health_score_label || "")) || null;
    out[email.toLowerCase()] = { sent, received, inbox, spam, inboxRate: inbox + spam > 0 ? inbox / (inbox + spam) : null, healthScore: score };
  }
  return out;
}

export const EXTERNAL_WARMUP_DAYS = 14;

/** Day N of the external warm-up, and whether campaigns may start. */
export function externalWarmupProgress(startedAt, now = Date.now(), days = EXTERNAL_WARMUP_DAYS) {
  const started = Date.parse(startedAt || "");
  if (!Number.isFinite(started)) return { day: 0, days, progress: 0, ready: false };
  const day = Math.max(1, Math.floor((now - started) / 86_400_000) + 1);
  return { day: Math.min(day, days), days, progress: Math.min(1, (day - 1) / days), ready: day > days };
}
