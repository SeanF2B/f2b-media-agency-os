import { env } from "cloudflare:workers";

function fromB64(value: string) {
  const normalized = value.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}
function toB64(value: Uint8Array) { return btoa(Array.from(value, (byte) => String.fromCharCode(byte)).join("")); }

async function key() {
  if (!env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY) throw new Error("Secure token storage is not configured.");
  const raw = fromB64(env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY);
  if (raw.length !== 32) throw new Error("The server encryption key must be 32 bytes.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealGhlSecret(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(value));
  return { iv: toB64(iv), ciphertext: toB64(new Uint8Array(ciphertext)) };
}

export async function openGhlSecret(iv: string, ciphertext: string) {
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await key(), fromB64(ciphertext));
  return new TextDecoder().decode(plaintext);
}

export async function getGhlAgencyAccessToken(ownerId: string) {
  if (!env.DB || !env.GHL_CLIENT_ID || !env.GHL_CLIENT_SECRET) throw new Error("The GoHighLevel Marketplace app credentials are not configured.");
  const saved = await env.DB.prepare("SELECT company_id, encrypted_refresh_token, token_iv, encrypted_access_token, access_token_iv, access_expires_at FROM gohighlevel_agency_connections WHERE owner_id = ?1").bind(ownerId).first<{ company_id: string; encrypted_refresh_token: string; token_iv: string; encrypted_access_token: string; access_token_iv: string; access_expires_at: string }>();
  if (!saved) throw new Error("GoHighLevel is not connected. Connect the agency app first.");
  if (saved.encrypted_access_token && saved.access_expires_at && Date.parse(saved.access_expires_at) > Date.now() + 60_000) {
    return { accessToken: await openGhlSecret(saved.access_token_iv, saved.encrypted_access_token), companyId: saved.company_id };
  }
  const refreshToken = await openGhlSecret(saved.token_iv, saved.encrypted_refresh_token);
  const refresh = async (token: string) => {
    const response = await fetch("https://services.leadconnectorhq.com/oauth/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", Version: "v3" },
      body: new URLSearchParams({ client_id: env.GHL_CLIENT_ID!, client_secret: env.GHL_CLIENT_SECRET!, grant_type: "refresh_token", refresh_token: token, user_type: "Company", ...(env.GHL_REDIRECT_URI ? { redirect_uri: env.GHL_REDIRECT_URI } : {}) }),
      signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json().catch(() => ({})) as { accessToken?: string; refreshToken?: string; access_token?: string; refresh_token?: string; error?: string };
    return { ok: response.ok, accessToken: payload.accessToken || payload.access_token || "", refreshToken: payload.refreshToken || payload.refresh_token || "" };
  };
  let result = await refresh(refreshToken);
  if (!result.ok || !result.accessToken || !result.refreshToken) {
    // A concurrent request may have rotated the single-use refresh token.
    const rotated = await env.DB.prepare("SELECT encrypted_refresh_token, token_iv, encrypted_access_token, access_token_iv, access_expires_at FROM gohighlevel_agency_connections WHERE owner_id = ?1").bind(ownerId).first<{ encrypted_refresh_token: string; token_iv: string; encrypted_access_token: string; access_token_iv: string; access_expires_at: string }>();
    if (rotated?.encrypted_access_token && Date.parse(rotated.access_expires_at) > Date.now() + 60_000) return { accessToken: await openGhlSecret(rotated.access_token_iv, rotated.encrypted_access_token), companyId: saved.company_id };
    if (rotated) result = await refresh(await openGhlSecret(rotated.token_iv, rotated.encrypted_refresh_token));
  }
  if (!result.ok || !result.accessToken || !result.refreshToken) throw new Error("HighLevel could not refresh the agency connection. Reconnect the GoHighLevel app.");
  const [encryptedRefresh, encryptedAccess] = await Promise.all([sealGhlSecret(result.refreshToken), sealGhlSecret(result.accessToken)]);
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 23 * 60 * 60_000).toISOString();
  await env.DB.prepare("UPDATE gohighlevel_agency_connections SET encrypted_refresh_token = ?2, token_iv = ?3, encrypted_access_token = ?4, access_token_iv = ?5, access_expires_at = ?6, updated_at = ?7 WHERE owner_id = ?1").bind(ownerId, encryptedRefresh.ciphertext, encryptedRefresh.iv, encryptedAccess.ciphertext, encryptedAccess.iv, expires, now).run();
  return { accessToken: result.accessToken, companyId: saved.company_id };
}

export async function getGhlLocationAccessToken(ownerId: string, clientId: string) {
  if (!env.DB) throw new Error("The private workspace database is unavailable.");
  const link = await env.DB.prepare("SELECT location_id, location_name FROM gohighlevel_location_links WHERE owner_id = ?1 AND client_id = ?2").bind(ownerId, clientId).first<{ location_id: string; location_name: string }>();
  if (!link) throw new Error("No GoHighLevel sub-account is linked to this client yet.");
  const agency = await getGhlAgencyAccessToken(ownerId);
  const response = await fetch("https://services.leadconnectorhq.com/oauth/location-token", {
    method: "POST", headers: { Authorization: `Bearer ${agency.accessToken}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", Version: "v3" },
    body: new URLSearchParams({ companyId: agency.companyId, locationId: link.location_id }), signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => ({})) as { access_token?: string; scope?: string; error?: string };
  if (!response.ok || !result.access_token) throw new Error("HighLevel could not issue a token for this sub-account. Check that the app is installed there and has the requested scopes.");
  return { accessToken: result.access_token, locationId: link.location_id, locationName: link.location_name, scopes: result.scope || "" };
}

export async function ghlLocationRequest(ownerId: string, clientId: string, path: string, method = "GET", body?: unknown, version = "v3") {
  const location = await getGhlLocationAccessToken(ownerId, clientId);
  const response = await fetch(`https://services.leadconnectorhq.com${path}`, {
    method, headers: { Authorization: `Bearer ${location.accessToken}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), Version: version },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload && typeof payload === "object" && "message" in payload ? String((payload as { message: unknown }).message).slice(0, 400) : `HTTP ${response.status}`;
    throw new Error(`HighLevel API ${response.status}: ${error}`);
  }
  return { location, payload };
}

export const GHL_REQUESTED_SCOPES = [
  "locations.readonly", "funnels/funnel.readonly", "funnels/page.readonly", "workflows.readonly", "workflows.write", "workflows.publish", "workflows.logs", "adPublishing.readonly", "adPublishing.write", "affiliate-manager.readonly", "affiliate-manager.write", "associations.write", "associations.readonly", "associations/relation.readonly", "associations/relation.write", "blogs/post.write", "blogs/post-update.write", "blogs/check-slug.readonly", "blogs/category.readonly", "blogs/author.readonly", "blogs/posts.readonly", "blogs/list.readonly", "brand-boards/design-kit.readonly", "brand-boards/design-kit.write", "brand-boards/voices.readonly", "brand-boards/voices.write", "calendars.readonly", "calendars.write", "calendars/events.readonly", "calendars/events.write", "calendars/groups.readonly", "calendars/groups.write", "calendars/resources.readonly", "calendars/resources.write", "campaigns.readonly", "chat-widget.readonly", "chat-widget.write", "clientportal-ai.readonly", "clientportal-ai.write", "companies.readonly", "contacts.readonly", "contacts.write", "conversation-ai.readonly", "conversation-ai.write", "conversations.readonly", "conversations.write", "conversations/message.readonly", "conversations/message.write", "conversations/reports.readonly", "conversations/livechat.write", "courses.write", "courses.readonly", "locations/customFields.readonly", "locations/customFields.write", "emails/builder.write", "emails/builder.readonly", "emails/schedule.readonly", "emails/schedule.write", "emails/templates.readonly", "emails/templates.write", "emails/campaigns.readonly", "emails/campaigns.write", "emails/stats.readonly", "files.readonly", "forms.readonly", "forms.write", "invoices.readonly", "invoices.write", "invoices/schedule.readonly", "invoices/schedule.write", "invoices/template.readonly", "invoices/template.write", "invoices/estimate.readonly", "invoices/estimate.write", "knowledge-bases.write", "knowledge-bases.readonly", "lc-email.readonly", "managed-agents.readonly", "managed-agents.write", "medias.readonly", "medias.write", "notes.readonly", "notes.write", "oauth.write", "oauth.readonly", "objects/schema.readonly", "objects/schema.write", "objects/record.readonly", "objects/record.write", "opportunities.readonly", "opportunities.write", "payments/orders.readonly", "payments/orders.write", "payments/orders.collectPayment", "payments/integration.readonly", "payments/integration.write", "payments/transactions.readonly", "payments/subscriptions.readonly", "payments/coupons.readonly", "payments/coupons.write", "payments/custom-provider.readonly", "payments/custom-provider.write", "phonenumbers.read", "phonenumbers.write", "numberpools.read", "pipelines.readonly", "pipelines.write", "pipelines.create", "products.readonly", "products.write", "products/prices.readonly", "products/prices.write", "products/collection.readonly", "products/collection.write", "projects/workspace.readonly", "projects/workspace.write", "projects/tasks.readonly", "projects/tasks.write", "projects/tasks.recurring.readonly", "projects/tasks.recurring.write", "projects/tasks.comments.readonly", "projects/tasks.comments.write", "documents_contracts/list.readonly", "documents_contracts/sendLink.write", "documents_contracts_template/sendLink.write", "documents_contracts_template/list.readonly", "saas/company.read", "saas/company.write", "saas/location.read", "saas/location.write", "snapshots.readonly", "snapshots.write", "agent-studio.readonly", "agent-studio.write", "countdown-timer/timer.readonly", "countdown-timer/timer.write", "custom-menu-link.readonly", "custom-menu-link.write", "funnels/redirect.readonly", "funnels/pagecount.readonly", "funnels/redirect.write", "links.readonly", "links.write", "locations.write", "locations/customValues.readonly", "locations/customValues.write", "locations/tasks.readonly", "locations/tasks.write", "recurring-tasks.readonly", "recurring-tasks.write", "locations/tags.readonly", "locations/tags.write", "locations/templates.readonly", "charges.readonly", "charges.write", "marketplace-installer-details.readonly", "marketplace-external-auth-migration.write", "socialplanner/oauth.readonly", "socialplanner/oauth.write", "socialplanner/post.readonly", "socialplanner/post.write", "socialplanner/account.readonly", "socialplanner/account.write", "socialplanner/csv.readonly", "socialplanner/csv.write", "socialplanner/category.readonly", "socialplanner/tag.readonly", "socialplanner/statistics.readonly", "socialplanner/comments.readonly", "socialplanner/comments.write", "socialplanner/watermarks.readonly", "socialplanner/watermarks.write", "socialplanner/category.write", "socialplanner/tag.write", "store/shipping.readonly", "store/shipping.write", "store/setting.readonly", "store/setting.write", "workflows.delete",
].join(" ");

// Keep the setup UI aligned with the actual Marketplace install link. The
// configured HighLevel app scopes can change without a source-code release.
export function getGhlRequestedScopes(installUrl = env.GHL_INSTALL_URL) {
  if (installUrl) {
    try {
      const url = new URL(installUrl);
      const configured = url.searchParams.get("scope") || url.searchParams.get("scopes");
      if (configured) return [...new Set(configured.split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean))];
    } catch {
      // Keep the known baseline available if the Worker variable is malformed.
    }
  }
  return GHL_REQUESTED_SCOPES.split(" ");
}

export function getGhlAuthorizationUrl() {
  if (env.GHL_INSTALL_URL) return new URL(env.GHL_INSTALL_URL);
  if (!env.GHL_CLIENT_ID || !env.GHL_APP_ID || !env.GHL_REDIRECT_URI) {
    throw new Error("The GoHighLevel Marketplace client ID, app ID and redirect URL are required.");
  }
  const installation = new URL("https://marketplace.gohighlevel.com/v2/oauth/chooselocation");
  installation.searchParams.set("response_type", "code");
  installation.searchParams.set("redirect_uri", env.GHL_REDIRECT_URI);
  installation.searchParams.set("client_id", env.GHL_CLIENT_ID);
  installation.searchParams.set("scope", GHL_REQUESTED_SCOPES);
  installation.searchParams.set("version_id", env.GHL_APP_ID);
  return installation;
}
