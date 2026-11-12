import { env } from "cloudflare:workers";
import { normalizeDirectMetaAdsRow } from "./meta-ads-performance";
import { extractMetaAdPreviewUrl } from "./meta-ad-preview";

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromBase64Url(value: string) {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
function apiVersion() {
  const version = env.META_MARKETING_API_VERSION?.trim() || "";
  if (!/^v\d+\.0$/.test(version)) throw new Error("Set META_MARKETING_API_VERSION to the current version enabled in the Meta developer app before connecting.");
  return version;
}
async function key() {
  if (!env.META_TOKEN_ENCRYPTION_KEY) throw new Error("Meta token encryption is not configured. Add META_TOKEN_ENCRYPTION_KEY as a Worker secret.");
  const raw = fromBase64Url(env.META_TOKEN_ENCRYPTION_KEY);
  if (raw.byteLength !== 32) throw new Error("META_TOKEN_ENCRYPTION_KEY must be a base64url-encoded 32-byte key.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export async function encryptMetaToken(token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(token));
  return { iv: toBase64Url(iv), ciphertext: toBase64Url(new Uint8Array(ciphertext)) };
}
async function decryptMetaToken(iv: string, ciphertext: string) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(iv) }, await key(), fromBase64Url(ciphertext));
  return new TextDecoder().decode(plain);
}
export async function metaAdsConnectionExists(ownerId: string) {
  if (!env.DB) return false;
  return Boolean(await env.DB.prepare("SELECT owner_id FROM meta_ads_connections WHERE owner_id = ?1").bind(ownerId).first());
}
export async function getMetaAdsAccessToken(ownerId: string) {
  if (!env.DB || !env.META_APP_ID || !env.META_APP_SECRET) throw new Error("Direct Meta Ads OAuth is not configured. Add META_APP_ID and META_APP_SECRET to the Worker settings.");
  const saved = await env.DB.prepare("SELECT encrypted_access_token, token_iv, expires_at FROM meta_ads_connections WHERE owner_id = ?1").bind(ownerId).first<{ encrypted_access_token: string; token_iv: string; expires_at: string }>();
  if (!saved) throw new Error("Meta Ads is not connected directly. Connect it in the Meta Ads workspace or use the existing Windsor connection.");
  if (!saved.expires_at || Date.parse(saved.expires_at) <= Date.now() + 5 * 60_000) throw new Error("The saved Meta Ads authorization has expired or is about to expire. Reconnect Meta Ads.");
  return decryptMetaToken(saved.token_iv, saved.encrypted_access_token);
}
async function appSecretProof(token: string) {
  if (!env.META_APP_SECRET) throw new Error("Meta app secret is not configured.");
  const hmacKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.META_APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, new TextEncoder().encode(token)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function graphGet<T>(path: string, token: string, query: Record<string, string>) {
  const version = apiVersion();
  const url = new URL(`https://graph.facebook.com/${version}/${path.replace(/^\/+/, "")}`);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  url.searchParams.set("appsecret_proof", await appSecretProof(token));
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => ({})) as { error?: { message?: string; code?: number; error_subcode?: number }; data?: T };
  if (!response.ok) {
    const message = String(payload.error?.message || `Meta returned HTTP ${response.status}.`).replace(/[\r\n]+/g, " ").slice(0, 300);
    if (payload.error?.code === 190) throw new Error("Meta rejected the saved authorization. Reconnect the Meta Ads account.");
    if (response.status === 429) throw new Error("Meta Ads API rate limit reached. Wait before retrying.");
    throw new Error(`Meta Ads API request failed: ${message}`);
  }
  return payload;
}

async function graphPost(path: string, token: string, body: Record<string, string>) {
  const version = apiVersion();
  const url = new URL(`https://graph.facebook.com/${version}/${path.replace(/^\/+/, "")}`);
  const form = new URLSearchParams(body);
  form.set("appsecret_proof", await appSecretProof(token));
  const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString(), signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => ({})) as { id?: string; success?: boolean; error?: { message?: string; code?: number } };
  if (!response.ok || payload.success === false) {
    const message = String(payload.error?.message || `Meta returned HTTP ${response.status}.`).replace(/[\r\n]+/g, " ").slice(0, 300);
    if (payload.error?.code === 190) throw new Error("Meta rejected the saved authorization. Reconnect the Meta Ads account.");
    if (response.status === 429) throw new Error("Meta Ads API rate limit reached. Wait before retrying.");
    throw new Error(`Meta Ads API update failed: ${message}`);
  }
  return payload;
}

export async function directMetaAdsManagementPermission(ownerId: string) {
  const token = await getMetaAdsAccessToken(ownerId);
  const payload = await graphGet<Array<{ permission?: string; status?: string }>>("me/permissions", token, {});
  return (payload.data || []).some((item) => item.permission === "ads_management" && item.status === "granted");
}

export type DirectMetaCampaign = { id: string; name: string; accountId: string; currency: string; status: string; dailyBudgetMinor: number | null };

export async function readDirectMetaCampaign(ownerId: string, accountId: string, campaignId: string): Promise<DirectMetaCampaign> {
  const cleanAccountId = accountId.replace(/^act_/i, "").replace(/\D/g, "");
  const cleanCampaignId = campaignId.replace(/\D/g, "");
  if (!/^\d{6,20}$/.test(cleanAccountId) || !/^\d{6,24}$/.test(cleanCampaignId)) throw new Error("The mapped Meta Ads account or campaign ID is not valid.");
  const token = await getMetaAdsAccessToken(ownerId);
  const payload = await graphGet<{ id?: string; name?: string; account_id?: string; status?: string; daily_budget?: string }>(cleanCampaignId, token, { fields: "id,name,account_id,status,daily_budget" });
  const campaign = (payload as unknown as { data?: { id?: string; name?: string; account_id?: string; status?: string; daily_budget?: string } }).data || payload as unknown as { id?: string; name?: string; account_id?: string; status?: string; daily_budget?: string };
  const returnedAccountId = String(campaign.account_id || "").replace(/^act_/i, "").replace(/\D/g, "");
  if (String(campaign.id || "") !== cleanCampaignId || returnedAccountId !== cleanAccountId) throw new Error("The selected Meta campaign does not belong to this client's mapped ad account.");
  const dailyBudgetMinor = campaign.daily_budget == null ? null : Number(campaign.daily_budget);
  if (dailyBudgetMinor != null && (!Number.isFinite(dailyBudgetMinor) || dailyBudgetMinor < 0)) throw new Error("Meta returned an invalid campaign budget value.");
  const account = (await listDirectMetaAdAccounts(ownerId)).find((item) => item.id === cleanAccountId);
  if (!account) throw new Error("The selected Meta account is no longer available to the connected login.");
  return { id: cleanCampaignId, name: String(campaign.name || cleanCampaignId), accountId: cleanAccountId, currency: account.currency, status: String(campaign.status || "UNKNOWN"), dailyBudgetMinor };
}

export async function updateDirectMetaCampaign(ownerId: string, campaignId: string, field: "status" | "daily_budget", value: string | number) {
  const cleanCampaignId = campaignId.replace(/\D/g, "");
  if (!/^\d{6,24}$/.test(cleanCampaignId)) throw new Error("The Meta campaign ID is not valid.");
  const token = await getMetaAdsAccessToken(ownerId);
  const payload = await graphPost(cleanCampaignId, token, { [field]: String(value) });
  if (payload.success !== true) throw new Error("Meta did not confirm the campaign update.");
}

export type DirectMetaEntityType = "ad_set" | "ad";
export type DirectMetaEntity = { id: string; name: string; accountId: string; campaignId: string; status: string; type: DirectMetaEntityType };

export async function readDirectMetaEntity(ownerId: string, accountId: string, entityType: DirectMetaEntityType, entityId: string): Promise<DirectMetaEntity> {
  const cleanAccountId = accountId.replace(/^act_/i, "").replace(/\D/g, "");
  const cleanEntityId = entityId.replace(/\D/g, "");
  if (!/^\d{6,20}$/.test(cleanAccountId) || !/^\d{6,24}$/.test(cleanEntityId)) throw new Error("The mapped Meta Ads account or item ID is not valid.");
  const token = await getMetaAdsAccessToken(ownerId);
  const fields = entityType === "ad_set" ? "id,name,account_id,campaign_id,status" : "id,name,account_id,campaign_id,adset_id,status";
  const payload = await graphGet<{ id?: string; name?: string; account_id?: string; campaign_id?: string; status?: string }>(cleanEntityId, token, { fields });
  const entity = (payload as unknown as { data?: { id?: string; name?: string; account_id?: string; campaign_id?: string; status?: string } }).data || payload as unknown as { id?: string; name?: string; account_id?: string; campaign_id?: string; status?: string };
  const returnedAccountId = String(entity.account_id || "").replace(/^act_/i, "").replace(/\D/g, "");
  const returnedCampaignId = String(entity.campaign_id || "").replace(/\D/g, "");
  if (String(entity.id || "") !== cleanEntityId || returnedAccountId !== cleanAccountId || !/^\d{6,24}$/.test(returnedCampaignId)) throw new Error("The selected Meta item does not belong to this client's mapped ad account.");
  if (!(await listDirectMetaAdAccounts(ownerId)).some((item) => item.id === cleanAccountId)) throw new Error("The selected Meta account is no longer available to the connected login.");
  return { id: cleanEntityId, name: String(entity.name || cleanEntityId), accountId: cleanAccountId, campaignId: returnedCampaignId, status: String(entity.status || "UNKNOWN"), type: entityType };
}

export async function updateDirectMetaEntity(ownerId: string, entityId: string, value: "ACTIVE" | "PAUSED") {
  const cleanId = entityId.replace(/\D/g, "");
  if (!/^\d{6,24}$/.test(cleanId) || !["ACTIVE", "PAUSED"].includes(value)) throw new Error("The Meta item status change is not valid.");
  const token = await getMetaAdsAccessToken(ownerId);
  const payload = await graphPost(cleanId, token, { status: value });
  if (payload.success !== true) throw new Error("Meta did not confirm the item status update.");
}

export async function listDirectMetaAdAccounts(ownerId: string) {
  const token = await getMetaAdsAccessToken(ownerId);
  const payload = await graphGet<Array<{ account_id?: string; id?: string; name?: string; currency?: string; account_status?: number }>>("me/adaccounts", token, { fields: "account_id,name,currency,account_status", limit: "500" });
  return (payload.data || []).map((item) => ({ id: String(item.account_id || item.id || "").replace(/^act_/i, "").replace(/\D/g, ""), name: String(item.name || "Meta Ads account"), currency: item.currency || "", status: item.account_status ?? null })).filter((item) => item.id);
}

export async function readDirectMetaAdsInsights(ownerId: string, accountId: string, window: { start: string; end: string }, section: "campaigns" | "ad_sets" | "ads" | "audiences" | "locations", campaignId?: string) {
  const cleanId = accountId.replace(/^act_/i, "").replace(/\D/g, "");
  if (!/^\d{6,20}$/.test(cleanId)) throw new Error("The mapped Meta Ads account ID is not valid.");
  const token = await getMetaAdsAccessToken(ownerId);
  const level = section === "ad_sets" ? "adset" : section === "ads" ? "ad" : "campaign";
  const fields = ["date_start", "account_currency", "campaign_id", "campaign_name", "adset_id", "adset_name", "ad_id", "ad_name", ...(section === "audiences" ? ["age", "gender"] : section === "locations" ? ["country"] : []), "impressions", "clicks", "inline_link_clicks", "spend", "actions"].join(",");
  const rows: Array<Record<string, unknown>> = [];
  let after = "";
  for (let page = 0; page < 20; page++) {
    const query: Record<string, string> = { fields, level, limit: "500", time_increment: "1", time_range: JSON.stringify({ since: window.start, until: window.end }) };
    if (section === "audiences") query.breakdowns = "age,gender";
    if (section === "locations") query.breakdowns = "country";
    if (after) query.after = after;
    if (campaignId && section !== "campaigns") query.filtering = JSON.stringify([{ field: "campaign.id", operator: "EQUAL", value: campaignId.replace(/\D/g, "") }]);
    const payload = await graphGet<Array<Record<string, unknown>>>(`act_${cleanId}/insights`, token, query);
    const pageRows = payload.data || [];
    rows.push(...pageRows.map(normalizeDirectMetaAdsRow));
    after = String((payload as unknown as { paging?: { cursors?: { after?: string }; next?: string } }).paging?.cursors?.after || "");
    if (!after || pageRows.length < 500) break;
  }
  return rows;
}

export async function readDirectMetaAdPreview(ownerId: string, accountId: string, adId: string) {
  const ad = await readDirectMetaEntity(ownerId, accountId, "ad", adId);
  const token = await getMetaAdsAccessToken(ownerId);
  const payload = await graphGet<Array<{ body?: string }>>(`${ad.id}/previews`, token, { ad_format: "MOBILE_FEED_STANDARD" });
  const url = extractMetaAdPreviewUrl(payload);
  if (!url) throw new Error("Meta did not return a supported preview for this ad. The preview may not be available for its format or placement.");
  return { adId: ad.id, adName: ad.name, format: "MOBILE_FEED_STANDARD", url };
}

export function configuredMetaApiVersion() { return apiVersion(); }
