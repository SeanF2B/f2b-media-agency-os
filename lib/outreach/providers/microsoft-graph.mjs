// Microsoft 365 / Exchange Online adapter over Microsoft Graph (HTTPS only — no SMTP/IMAP).
// App-only auth (client credentials). Required application permissions:
//   User.ReadWrite.All, Domain.ReadWrite.All, Organization.Read.All, Mail.Send, Mail.ReadBasic.All (or Mail.Read)
// Restrict Mail.* to outreach mailboxes with an Exchange application access policy / RBAC for Applications.
//
// Not available through Graph (documented blocker): turning DKIM signing on. The OS publishes the
// DKIM CNAMEs, then the admin flips one toggle in the Defender portal, or runs the bulk
// PowerShell script from buildDkimScript() once for every pending domain.

import { ProviderError, providerRequest } from "../http.mjs";
import { base64 } from "../mime.mjs";

const GRAPH = "https://graph.microsoft.com/v1.0";
// Exchange Online (Plan 1). Others are accepted if the tenant has them.
export const MAILBOX_SKUS = ["EXCHANGESTANDARD", "EXCHANGEDESKLESS", "O365_BUSINESS_ESSENTIALS", "EXCHANGEENTERPRISE"];

function describe(status, payload) {
  const message = payload?.error?.message || payload?.error_description || "";
  if (status === 401) return "Microsoft rejected the app credentials. Check the tenant ID, client ID and secret.";
  if (status === 403) return `Microsoft says the app is missing a permission${message ? `: ${message.slice(0, 160)}` : "."} Grant admin consent for the listed Graph permissions.`;
  if (status === 404) return "Microsoft couldn't find that item.";
  if (status === 429) return "Microsoft is throttling requests; the app will retry.";
  return message ? `Microsoft: ${message.slice(0, 200)}` : `Microsoft returned an error (${status}).`;
}

export function createMicrosoftClient({ tenantId, clientId, clientSecret }, { fetchImpl, sleepImpl, now = () => Date.now() } = {}) {
  if (!tenantId || !clientId || !clientSecret) throw new ProviderError("Microsoft", 0, "Add the Microsoft tenant ID, client ID and client secret first.");
  let token = null;
  const doFetch = fetchImpl || fetch;

  async function accessToken() {
    if (token && token.expiresAt - 60_000 > now()) return token.value;
    const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" });
    const response = await doFetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) throw new ProviderError("Microsoft", response.status, describe(response.status === 400 ? 401 : response.status, payload));
    token = { value: payload.access_token, expiresAt: now() + Number(payload.expires_in || 3600) * 1000 };
    return token.value;
  }

  const call = async (path, { method = "GET", body, rawBody, headers = {}, idempotent } = {}) => providerRequest({
    provider: "Microsoft", url: path.startsWith("https://") ? path : `${GRAPH}${path}`, method, body, rawBody, idempotent,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...headers }, fetchImpl, sleepImpl, describeError: describe,
  });

  return {
    name: "microsoft",
    async verify() { const org = await call("/organization?$select=id,displayName,verifiedDomains"); const item = org?.value?.[0]; return { tenantName: item?.displayName || "", initialDomain: (item?.verifiedDomains || []).find((d) => d.isInitial)?.name || "" }; },

    /** Free mailbox seats per SKU — seats are bought in the Microsoft admin centre, assigned here. */
    async seats() {
      const skus = await call("/subscribedSkus?$select=skuId,skuPartNumber,prepaidUnits,consumedUnits");
      return (skus?.value || []).filter((sku) => MAILBOX_SKUS.includes(sku.skuPartNumber)).map((sku) => ({ skuId: sku.skuId, sku: sku.skuPartNumber, total: sku.prepaidUnits?.enabled || 0, used: sku.consumedUnits || 0, free: Math.max(0, (sku.prepaidUnits?.enabled || 0) - (sku.consumedUnits || 0)) }));
    },

    // ---- domains ----
    async addDomain(domain) {
      try { return await call("/domains", { method: "POST", body: { id: domain }, idempotent: false }); }
      catch (error) { if (error.status === 400 || error.status === 409) return call(`/domains/${encodeURIComponent(domain)}`); throw error; }
    },
    async getDomain(domain) { return call(`/domains/${encodeURIComponent(domain)}`); },
    async verificationRecords(domain) { const result = await call(`/domains/${encodeURIComponent(domain)}/verificationDnsRecords`); return (result?.value || []).filter((record) => record.recordType === "Txt").map((record) => ({ type: "TXT", name: domain, content: record.text, ttl: record.ttl })); },
    async verifyDomain(domain) { return call(`/domains/${encodeURIComponent(domain)}/verify`, { method: "POST", idempotent: true }); },
    /** MX + SPF + autodiscover the tenant expects for this domain (only valid after verification). */
    async serviceRecords(domain) {
      const result = await call(`/domains/${encodeURIComponent(domain)}/serviceConfigurationRecords`);
      return (result?.value || []).map((record) => record.recordType === "Mx" ? { type: "MX", name: domain, content: record.mailExchange, priority: record.preference } : record.recordType === "Txt" ? { type: "TXT", name: domain, content: record.text } : record.recordType === "CName" ? { type: "CNAME", name: record.label, content: record.canonicalName } : null).filter(Boolean);
    },

    // ---- mailboxes ----
    async createMailbox({ email, displayName, password, usageLocation = "IE" }) {
      const [local] = email.split("@");
      try {
        return await call("/users", { method: "POST", idempotent: false, body: { accountEnabled: true, displayName, mailNickname: local.replace(/[^a-z0-9._-]/gi, ""), userPrincipalName: email, usageLocation, passwordProfile: { forceChangePasswordNextSignIn: false, password } } });
      } catch (error) {
        if (error.status === 400 && /already exists/i.test(error.message)) return call(`/users/${encodeURIComponent(email)}?$select=id,userPrincipalName,displayName`);
        throw error;
      }
    },
    async assignLicense(userId, skuId) { return call(`/users/${encodeURIComponent(userId)}/assignLicense`, { method: "POST", idempotent: true, body: { addLicenses: [{ skuId, disabledPlans: [] }], removeLicenses: [] } }); },
    async mailboxReady(userId) { try { await call(`/users/${encodeURIComponent(userId)}/mailFolders/inbox?$select=id`); return true; } catch (error) { if (error.status === 404) return false; throw error; } },

    // ---- mail ----
    /** Send an RFC 5322 message as-is (keeps our Message-ID, threading and unsubscribe headers). Not retried. */
    /** Sender name as recipients see it (Graph user profile). */
    async updateName(userId, { firstName, lastName }) { await call(`/users/${encodeURIComponent(userId)}`, { method: "PATCH", idempotent: true, body: { givenName: firstName, surname: lastName, displayName: `${firstName} ${lastName}`.trim() } }); },
    /** Profile photo shown in Outlook / Teams. JPEG or PNG bytes. */
    async setPhoto(userId, bytes, contentType = "image/jpeg") { await call(`/users/${encodeURIComponent(userId)}/photo/$value`, { method: "PUT", idempotent: true, headers: { "Content-Type": contentType }, rawBody: bytes }); },
    async sendMime(userId, rawMime) {
      // Graph's MIME send takes the whole message base64-encoded with Content-Type text/plain.
      await call(`/users/${encodeURIComponent(userId)}/sendMail`, { method: "POST", idempotent: false, headers: { "Content-Type": "text/plain" }, rawBody: base64(rawMime) });
      return { accepted: true };
    },
    /** Inbox changes since the last delta link. First call (no cursor) only records a starting point. */
    async inboxDelta(userId, cursor) {
      let url = cursor || `${GRAPH}/users/${encodeURIComponent(userId)}/mailFolders/inbox/messages/delta?$select=id,subject,from,receivedDateTime,internetMessageId,conversationId,body&$top=50`;
      const items = []; let next = null; let pages = 0;
      while (url && pages < 10) {
        const page = await call(url, { headers: { Prefer: 'outlook.body-content-type="text", odata.maxpagesize=50' } });
        if (cursor) items.push(...(page?.value || []));
        url = page?.["@odata.nextLink"] || null;
        next = page?.["@odata.deltaLink"] || next;
        pages += 1;
      }
      return { items: items.filter((item) => !item["@removed"]).map(normaliseGraphMessage), cursor: next || cursor, primed: !cursor };
    },
  };
}

export function normaliseGraphMessage(item) {
  return {
    id: String(item.id || ""),
    messageId: String(item.internetMessageId || ""),
    threadRef: String(item.conversationId || ""),
    from: String(item.from?.emailAddress?.address || "").toLowerCase(),
    fromName: String(item.from?.emailAddress?.name || ""),
    subject: String(item.subject || ""),
    text: String(item.body?.content || "").slice(0, 20_000),
    receivedAt: String(item.receivedDateTime || new Date().toISOString()),
  };
}

/** One script that creates and enables DKIM for every pending domain (paste into Exchange Online PowerShell or Azure Cloud Shell). */
export function buildDkimScript(domains) {
  const safe = domains.filter((domain) => /^[a-z0-9.-]+$/i.test(domain));
  return [
    "# F2B Outreach — enable DKIM for new sending domains (Exchange Online PowerShell)",
    "Connect-ExchangeOnline",
    ...safe.map((domain) => `if (-not (Get-DkimSigningConfig -Identity '${domain}' -ErrorAction SilentlyContinue)) { New-DkimSigningConfig -DomainName '${domain}' -KeySize 2048 -Enabled $true } else { Set-DkimSigningConfig -Identity '${domain}' -Enabled $true }`),
    "Get-DkimSigningConfig | Select-Object Domain, Enabled, Status",
  ].join("\n");
}
