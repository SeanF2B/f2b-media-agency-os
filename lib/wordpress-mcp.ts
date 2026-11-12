import { env } from "cloudflare:workers";

const MCP_URL = "https://public-api.wordpress.com/wpcom/v2/mcp/v1";
const OAUTH_URL = "https://public-api.wordpress.com/oauth2-1/token";

type Connection = {
  encrypted_access_token: string;
  access_token_iv: string;
  encrypted_refresh_token: string | null;
  refresh_token_iv: string | null;
  token_expires_at: string | null;
};

function fromB64(value: string) { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }
function toB64(value: Uint8Array) { return btoa(Array.from(value, (byte) => String.fromCharCode(byte)).join("")); }

async function wordpressMcpEncryptionKey() {
  const encoded = env.WORDPRESS_MCP_TOKEN_ENCRYPTION_KEY;
  if (!encoded) throw new Error("Secure WordPress account-token storage is not configured on the server.");
  const bytes = fromB64(encoded);
  if (bytes.byteLength !== 32) throw new Error("The WordPress account-token encryption key must be 32 bytes.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptWordPressMcpToken(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await wordpressMcpEncryptionKey(), new TextEncoder().encode(value));
  return { iv: toB64(iv), ciphertext: toB64(new Uint8Array(encrypted)) };
}

export async function decryptWordPressMcpToken(iv: string, value: string) {
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await wordpressMcpEncryptionKey(), fromB64(value));
  return new TextDecoder().decode(decrypted);
}

function jsonResult(response: Response, value: unknown, status?: number) {
  return Response.json(value, { status: status ?? response.status, headers: { "Cache-Control": "no-store" } });
}

export async function getWordPressMcpConnection(ownerId: string) {
  if (!env.DB) return null;
  return env.DB.prepare("SELECT encrypted_access_token, access_token_iv, encrypted_refresh_token, refresh_token_iv, token_expires_at FROM wordpress_mcp_connections WHERE owner_id = ?1")
    .bind(ownerId).first<Connection>();
}

async function refreshAccessToken(ownerId: string, connection: Connection) {
  if (!env.DB || !connection.encrypted_refresh_token || !connection.refresh_token_iv) return "";
  const refreshToken = await decryptWordPressMcpToken(connection.refresh_token_iv, connection.encrypted_refresh_token);
  const appRow = await env.DB.prepare("SELECT client_id FROM wordpress_mcp_oauth_apps WHERE owner_id = ?1").bind(ownerId).first<{ client_id: string }>();
  if (!appRow?.client_id) return "";
  const response = await fetch(OAUTH_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: appRow.client_id }), signal: AbortSignal.timeout(15_000) });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string") throw new Error("WordPress account authorization expired. Reconnect the WordPress account in Sites.");
  const access = await encryptWordPressMcpToken(payload.access_token);
  const refresh = typeof payload.refresh_token === "string" ? await encryptWordPressMcpToken(payload.refresh_token) : { ciphertext: connection.encrypted_refresh_token, iv: connection.refresh_token_iv };
  const expiresAt = typeof payload.expires_in === "number" ? new Date(Date.now() + payload.expires_in * 1000).toISOString() : null;
  await env.DB.prepare("UPDATE wordpress_mcp_connections SET encrypted_access_token = ?1, access_token_iv = ?2, encrypted_refresh_token = ?3, refresh_token_iv = ?4, token_expires_at = ?5, updated_at = ?6 WHERE owner_id = ?7")
    .bind(access.ciphertext, access.iv, refresh.ciphertext, refresh.iv, expiresAt, new Date().toISOString(), ownerId).run();
  return payload.access_token;
}

export async function getWordPressMcpAccessToken(ownerId: string) {
  const connection = await getWordPressMcpConnection(ownerId);
  if (!connection) return "";
  if (connection.token_expires_at && Date.parse(connection.token_expires_at) < Date.now() + 90_000) return refreshAccessToken(ownerId, connection);
  return decryptWordPressMcpToken(connection.access_token_iv, connection.encrypted_access_token);
}

async function parseMcpResponse(response: Response) {
  const text = await response.text();
  if (!response.ok) {
    const detail = text.replace(/((?:access|refresh)_token)["'=:\s]+[^\s,"}]+/gi, "$1=[redacted]").replace(/\s+/g, " ").trim().slice(0, 360);
    throw new Error(`WordPress returned HTTP ${response.status} while connecting to the account${detail ? `: ${detail}` : "."}`);
  }
  if (!text) return {};
  try { return JSON.parse(text); } catch {
    const dataLines = text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());
    for (const line of dataLines.reverse()) { try { return JSON.parse(line); } catch {} }
    throw new Error("WordPress returned an unreadable response. Try reconnecting the account.");
  }
}

async function rpc(token: string, method: string, params: Record<string, unknown>, sessionId?: string) {
  const response = await fetch(MCP_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25", ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }),
    signal: AbortSignal.timeout(25_000),
  });
  const result = await parseMcpResponse(response) as Record<string, any>;
  if (result.error) throw new Error(String(result.error.message || "WordPress account connection failed."));
  return { result: result.result ?? result, sessionId: response.headers.get("Mcp-Session-Id") || sessionId };
}

export async function wordpressMcpCall(ownerId: string, toolName: string, args: Record<string, unknown>) {
  const token = await getWordPressMcpAccessToken(ownerId);
  if (!token) throw new Error("Connect your WordPress account once to manage this client’s site.");
  let sessionId: string | undefined;
  try {
    const initialized = await rpc(token, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "F2B Media Agency OS", version: "1.0.0" } });
    sessionId = initialized.sessionId;
    if (sessionId) await fetch(MCP_URL, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25", "Mcp-Session-Id": sessionId }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), signal: AbortSignal.timeout(10_000) });
    const result = await rpc(token, "tools/call", { name: toolName, arguments: args }, sessionId);
    const payload = result.result as Record<string, any>;
    if (payload?.isError) {
      const message = (payload.content || []).map((item: any) => item.text).filter(Boolean).join(" ");
      throw new Error(message || "WordPress could not complete this request.");
    }
    return payload;
  } finally {
    if (sessionId) await fetch(MCP_URL, { method: "DELETE", headers: { Authorization: `Bearer ${token}`, "Mcp-Session-Id": sessionId }, signal: AbortSignal.timeout(5_000) }).catch(() => {});
  }
}

export function unwrapWordPressMcpResult(value: any): any {
  if (!value || typeof value !== "object") return value;
  if (value.structuredContent && typeof value.structuredContent === "object") return unwrapWordPressMcpResult(value.structuredContent);
  if (value.data && typeof value.data === "object") return unwrapWordPressMcpResult(value.data);
  if (Array.isArray(value.content)) {
    for (const item of value.content) if (typeof item.text === "string") { try { return unwrapWordPressMcpResult(JSON.parse(item.text)); } catch {} }
  }
  if (value.result && typeof value.result === "object") return unwrapWordPressMcpResult(value.result);
  return value;
}

export function requestSiteUrl(value: string) {
  const url = new URL(value);
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, "")}`;
}

export function siteDomain(value: string) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

export function extractSites(value: any): Array<{ id: string; name: string; url: string }> {
  const data = unwrapWordPressMcpResult(value);
  const candidates = Array.isArray(data) ? data : [data?.sites, data?.items, data?.data, data?.results].find(Array.isArray) || [];
  return candidates.map((site: any) => ({ id: String(site.ID ?? site.id ?? site.site_id ?? site.blog_id ?? ""), name: String(site.name ?? site.title ?? site.site_name ?? site.url ?? "WordPress site"), url: String(site.URL ?? site.url ?? site.site_url ?? site.domain ?? "") })).filter((site: { id: string; url: string }) => site.id && site.url);
}

export function extractPages(value: any): Array<Record<string, any>> {
  const data = unwrapWordPressMcpResult(value);
  if (Array.isArray(data)) return data;
  for (const key of ["pages", "items", "results", "data"]) if (Array.isArray(data?.[key])) return data[key];
  if (Array.isArray(data?.posts)) return data.posts;
  return [];
}

export function cleanMcpError(error: unknown) {
  if (error instanceof Error) {
    const text = error.message;
    if (/403|not enabled|MCP.+off|tool.+disabled|not available/i.test(text)) return "Turn on WordPress.com MCP in the WordPress account settings, then reconnect Sites. This one-time connection covers every site that account can access.";
    if (/401|unauthorized|token/i.test(text)) return "WordPress account access expired. Reconnect the account in Sites.";
    return text;
  }
  return "WordPress could not complete the request.";
}
