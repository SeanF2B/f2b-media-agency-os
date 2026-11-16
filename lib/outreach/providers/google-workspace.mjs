// Google Workspace adapter: Admin SDK Directory (domains, users), Site Verification and Gmail API.
// Auth: a service account with domain-wide delegation, signed with WebCrypto (RS256) — HTTPS only.
// Scopes to delegate in Admin console → Security → API controls → Domain-wide delegation:
//   https://www.googleapis.com/auth/admin.directory.user
//   https://www.googleapis.com/auth/admin.directory.domain
//   https://www.googleapis.com/auth/siteverification
//   https://www.googleapis.com/auth/gmail.send
//   https://www.googleapis.com/auth/gmail.readonly
//
// Not available through a public Google API (documented blocker): generating the DKIM key and
// pressing "Start authentication" (Admin console → Gmail → Authenticate email). Google also
// requires waiting 24–72 h after Gmail is enabled. The OS tracks this as one guided step per domain.

import { ProviderError, providerRequest } from "../http.mjs";
import { base64url } from "../mime.mjs";

const SCOPES = {
  admin: "https://www.googleapis.com/auth/admin.directory.user https://www.googleapis.com/auth/admin.directory.domain https://www.googleapis.com/auth/siteverification",
  send: "https://www.googleapis.com/auth/gmail.send",
  read: "https://www.googleapis.com/auth/gmail.readonly",
};

function describe(status, payload) {
  const message = payload?.error?.message || payload?.error_description || (typeof payload?.error === "string" ? payload.error : "");
  if (status === 401) return "Google rejected the service account. Check the key and that domain-wide delegation is set up.";
  if (status === 403) return `Google says the service account lacks access${message ? `: ${message.slice(0, 160)}` : "."} Add the listed scopes under domain-wide delegation.`;
  if (status === 404) return "Google couldn't find that item.";
  if (status === 429) return "Google is rate-limiting requests; the app will retry.";
  return message ? `Google: ${String(message).slice(0, 200)}` : `Google returned an error (${status}).`;
}

function pemToBytes(pem) {
  const body = String(pem).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
}

export async function signServiceAccountJwt({ clientEmail, privateKey, scope, subject, now = Date.now() }) {
  const iat = Math.floor(now / 1000);
  const enc = (value) => base64url(JSON.stringify(value));
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iss: clientEmail, scope, aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 3600, ...(subject ? { sub: subject } : {}) })}`;
  const key = await crypto.subtle.importKey("pkcs8", pemToBytes(privateKey), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
  return `${unsigned}.${base64url(signature)}`;
}

/** @param {{client_email:string, private_key:string}} serviceAccount  @param {string} adminEmail super-admin to impersonate for directory calls */
export function createGoogleClient(serviceAccount, adminEmail, { fetchImpl, sleepImpl, now = () => Date.now() } = {}) {
  if (!serviceAccount?.client_email || !serviceAccount?.private_key) throw new ProviderError("Google", 0, "Upload the Google service-account key (JSON) first.");
  if (!adminEmail) throw new ProviderError("Google", 0, "Add the Google Workspace super-admin email the service account acts as.");
  const doFetch = fetchImpl || fetch;
  const cache = new Map();

  async function token(scope, subject) {
    const key = `${scope}|${subject}`;
    const hit = cache.get(key);
    if (hit && hit.expiresAt - 60_000 > now()) return hit.value;
    const assertion = await signServiceAccountJwt({ clientEmail: serviceAccount.client_email, privateKey: serviceAccount.private_key, scope, subject, now: now() });
    const response = await doFetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString() });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) throw new ProviderError("Google", response.status, describe(response.status === 400 ? 401 : response.status, payload));
    cache.set(key, { value: payload.access_token, expiresAt: now() + Number(payload.expires_in || 3600) * 1000 });
    return payload.access_token;
  }
  const call = async (url, { method = "GET", body, idempotent, scope = SCOPES.admin, subject = adminEmail } = {}) => providerRequest({ provider: "Google", url, method, body, idempotent, headers: { Authorization: `Bearer ${await token(scope, subject)}` }, fetchImpl, sleepImpl, describeError: describe });
  const DIR = "https://admin.googleapis.com/admin/directory/v1";

  return {
    name: "google",
    async verify() { const result = await call(`${DIR}/customer/my_customer/domains`); return { domains: (result?.domains || []).map((domain) => domain.domainName) }; },

    // ---- domains ----
    async addDomain(domain) {
      try { return await call(`${DIR}/customer/my_customer/domains`, { method: "POST", body: { domainName: domain } }); }
      catch (error) { if (error.status === 409) return call(`${DIR}/customer/my_customer/domains/${encodeURIComponent(domain)}`); throw error; }
    },
    async getDomain(domain) { return call(`${DIR}/customer/my_customer/domains/${encodeURIComponent(domain)}`); },
    async verificationRecords(domain) {
      const result = await call("https://www.googleapis.com/siteVerification/v1/token", { method: "POST", idempotent: true, body: { site: { type: "INET_DOMAIN", identifier: domain }, verificationMethod: "DNS_TXT" } });
      return result?.token ? [{ type: "TXT", name: domain, content: result.token }] : [];
    },
    async verifyDomain(domain) { return call("https://www.googleapis.com/siteVerification/v1/webResource?verificationMethod=DNS_TXT", { method: "POST", idempotent: true, body: { site: { type: "INET_DOMAIN", identifier: domain } } }); },
    serviceRecords(domain) { return [{ type: "MX", name: domain, content: "smtp.google.com", priority: 1 }]; },
    spfInclude: "_spf.google.com",

    // ---- mailboxes ----
    async createMailbox({ email, firstName, lastName, password }) {
      try { return await call(`${DIR}/users`, { method: "POST", body: { primaryEmail: email, name: { givenName: firstName || email.split("@")[0], familyName: lastName || "-" }, password, changePasswordAtNextLogin: false } }); }
      catch (error) { if (error.status === 409) return call(`${DIR}/users/${encodeURIComponent(email)}`); throw error; }
    },
    async mailboxReady(email) { try { await call(`https://gmail.googleapis.com/gmail/v1/users/me/profile`, { scope: SCOPES.read, subject: email }); return true; } catch (error) { if ([400, 401, 403, 404].includes(error.status)) return false; throw error; } },

    /** Sender name (Admin SDK user name). */
    async updateName(email, { firstName, lastName }) { await call(`${DIR}/users/${encodeURIComponent(email)}`, { method: "PATCH", idempotent: true, body: { name: { givenName: firstName, familyName: lastName || "-" } } }); },
    /** Profile photo shown in Gmail / Google contacts. */
    async setPhoto(email, bytes, contentType = "image/jpeg") {
      let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
      const photoData = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      await call(`${DIR}/users/${encodeURIComponent(email)}/photos/thumbnail`, { method: "PUT", idempotent: true, body: { photoData, mimeType: contentType === "image/png" ? "PNG" : "JPEG" } });
    },

    // ---- mail ----
    async sendMime(email, rawMime) { const result = await call("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", idempotent: false, scope: SCOPES.send, subject: email, body: { raw: base64url(rawMime) } }); return { accepted: true, id: result?.id || "" }; },
    /** New inbox messages since the stored historyId. First call (no cursor) records a starting point. */
    async inboxDelta(email, cursor) {
      const gmail = "https://gmail.googleapis.com/gmail/v1/users/me";
      if (!cursor) { const profile = await call(`${gmail}/profile`, { scope: SCOPES.read, subject: email }); return { items: [], cursor: String(profile?.historyId || ""), primed: true }; }
      let history;
      try { history = await call(`${gmail}/history?startHistoryId=${encodeURIComponent(cursor)}&historyTypes=messageAdded&labelId=INBOX&maxResults=100`, { scope: SCOPES.read, subject: email }); }
      catch (error) { if (error.status === 404) { const profile = await call(`${gmail}/profile`, { scope: SCOPES.read, subject: email }); return { items: [], cursor: String(profile?.historyId || ""), primed: true, gap: true }; } throw error; }
      const ids = [...new Set((history?.history || []).flatMap((entry) => (entry.messagesAdded || []).map((added) => added.message?.id)).filter(Boolean))].slice(0, 50);
      const items = [];
      for (const id of ids) items.push(normaliseGmailMessage(await call(`${gmail}/messages/${id}?format=full`, { scope: SCOPES.read, subject: email })));
      return { items, cursor: String(history?.historyId || cursor), primed: false };
    },
  };
}

function decodePart(data) {
  if (!data) return "";
  const binary = atob(String(data).replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

export function normaliseGmailMessage(message) {
  const headers = Object.fromEntries((message?.payload?.headers || []).map((header) => [String(header.name).toLowerCase(), String(header.value)]));
  const findText = (part) => { if (!part) return ""; if (part.mimeType === "text/plain" && part.body?.data) return decodePart(part.body.data); for (const child of part.parts || []) { const found = findText(child); if (found) return found; } return ""; };
  const fromMatch = /<([^>]+)>/.exec(headers.from || "");
  return {
    id: String(message?.id || ""),
    messageId: headers["message-id"] || "",
    threadRef: String(message?.threadId || ""),
    inReplyTo: headers["in-reply-to"] || "",
    from: String(fromMatch ? fromMatch[1] : headers.from || "").toLowerCase().trim(),
    fromName: String(headers.from || "").replace(/<[^>]+>/, "").replace(/"/g, "").trim(),
    subject: headers.subject || "",
    text: (findText(message?.payload) || String(message?.snippet || "")).slice(0, 20_000),
    headers: { "auto-submitted": headers["auto-submitted"] || "", "x-autoreply": headers["x-autoreply"] || "" },
    receivedAt: message?.internalDate ? new Date(Number(message.internalDate)).toISOString() : new Date().toISOString(),
  };
}
