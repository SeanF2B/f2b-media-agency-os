import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../app/chatgpt-auth";
import { decryptAiCredential } from "../ai-credentials";
import { MEDIA_SCHEMA_SQL, STOCK_PROVIDERS, type StockProvider } from "./core";

export const noStore = { "Cache-Control": "no-store" };
export const reply = (error: string, status = 400) => Response.json({ error }, { status, headers: noStore });
export const ok = (body: Record<string, unknown>) => Response.json(body, { headers: noStore });

type Staff = { id?: string; name?: string; email?: string; role?: string; isBot?: boolean; clientAccessIds?: unknown };
type WorkspaceSlice = { ownerId?: string; adminEmail?: string; clients?: Array<{ id: string; name: string }>; staff?: Staff[] };

let schemaReady: Promise<void> | null = null;
export function ensureMediaTables(db: D1Database) {
  if (!schemaReady) schemaReady = db.batch(MEDIA_SCHEMA_SQL.map((sql) => db.prepare(sql))).then(() => undefined).catch((error) => { schemaReady = null; throw error; });
  return schemaReady;
}

export type MediaAccess = { db: D1Database; bucket: R2Bucket; ownerId: string; userLabel: string; isAdmin: boolean; clients: Array<{ id: string; name: string }>; allowedScopes: Set<string>; canUseAgency: boolean };

/** Owners/admins see every library. Other teammates see the clients they've been given (and the agency library only if unrestricted). */
export async function mediaAccess(): Promise<{ response: Response } | { response?: never; access: MediaAccess }> {
  const user = await getChatGPTUser();
  if (!user) return { response: reply("Sign in to open the Media Library.", 401) };
  if (!env.DB || !env.BUCKET) return { response: reply("File storage is not configured on this deployment.", 503) };
  // Read only the slices we need from the workspace document (one indexed row read).
  const row = await env.DB.prepare(`SELECT json_object(
      'ownerId', owner_id,
      'adminEmail', json_extract(data, '$.settings.adminEmail'),
      'clients', json(COALESCE((SELECT json_group_array(json_object('id', json_extract(value,'$.id'), 'name', json_extract(value,'$.name'))) FROM json_each(data, '$.clients')), '[]')),
      'staff', json(COALESCE((SELECT json_group_array(json_object('id', json_extract(value,'$.id'), 'name', json_extract(value,'$.name'), 'email', json_extract(value,'$.email'), 'role', json_extract(value,'$.role'), 'isBot', json_extract(value,'$.isBot'), 'clientAccessIds', json_extract(value,'$.clientAccessIds'))) FROM json_each(data, '$.staff')), '[]'))
    ) AS data FROM workspace_documents WHERE id = 'f2b-agency'`).first<{ data: string }>();
  if (!row?.data) return { response: reply("The agency workspace could not be found.", 503) };
  let workspace: WorkspaceSlice;
  try { workspace = JSON.parse(row.data); } catch { return { response: reply("The agency workspace data could not be read.", 503) }; }
  const ownerId = String(workspace.ownerId || "");
  const email = user.email.toLowerCase();
  const isOwner = ownerId === user.userId || String(workspace.adminEmail || "").toLowerCase() === email;
  const member = (workspace.staff || []).find((person) => !person.isBot && (person.id === user.userId || String(person.email || "").toLowerCase() === email));
  if (!isOwner && !member) return { response: reply("Only team members can open the Media Library.", 403) };
  const isAdmin = isOwner || ["Owner", "Admin"].includes(String(member?.role || ""));
  const clients = (workspace.clients || []).filter((client) => client && client.id).map((client) => ({ id: String(client.id), name: String(client.name || "Client") }));
  let accessIds: string[] | null = null;
  if (!isAdmin && member) {
    const raw = typeof member.clientAccessIds === "string" ? (() => { try { return JSON.parse(member.clientAccessIds as string); } catch { return null; } })() : member.clientAccessIds;
    if (Array.isArray(raw)) accessIds = raw.map(String);
  }
  const allowedClients = accessIds ? clients.filter((client) => accessIds!.includes(client.id)) : clients;
  const canUseAgency = !accessIds;
  const allowedScopes = new Set<string>(allowedClients.map((client) => client.id));
  if (canUseAgency) allowedScopes.add("");
  await ensureMediaTables(env.DB);
  return { access: { db: env.DB, bucket: env.BUCKET, ownerId, userLabel: member?.name || user.displayName || user.email, isAdmin, clients: allowedClients, allowedScopes, canUseAgency } };
}

/** A stock-photo key pasted under Settings → API keys (named "Unsplash", "Pexels" or "Pixabay"), or a Worker secret. */
export async function stockKey(db: D1Database, ownerId: string, provider: StockProvider) {
  const envName = { unsplash: "UNSPLASH_ACCESS_KEY", pexels: "PEXELS_API_KEY", pixabay: "PIXABAY_API_KEY", openverse: "" }[provider];
  const fromEnv = envName ? String((env as unknown as Record<string, unknown>)[envName] || "") : "";
  if (fromEnv) return fromEnv;
  const label = STOCK_PROVIDERS.find((item) => item.id === provider)?.keyLabel;
  if (!label) return "";
  try {
    const saved = await db.prepare("SELECT encrypted_key, key_iv FROM agency_custom_api_keys WHERE owner_id = ?1 AND lower(label) IN (lower(?2), lower(?3)) ORDER BY updated_at DESC LIMIT 1").bind(ownerId, label, `${label} API key`).first<{ encrypted_key: string; key_iv: string }>();
    return saved ? await decryptAiCredential(saved.key_iv, saved.encrypted_key) : "";
  } catch { return ""; }
}

// ---------- Google Drive (OAuth refresh token, encrypted with the existing Google token key) ----------
const fromB64 = (value: string) => { const normalized = value.replace(/-/g, "+").replace(/_/g, "/"); const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")); return Uint8Array.from(binary, (character) => character.charCodeAt(0)); };
const toB64 = (value: Uint8Array) => { let binary = ""; for (const byte of value) binary += String.fromCharCode(byte); return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""); };
async function driveKey() {
  const encoded = env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY;
  if (!encoded) throw new Error("Google token storage is not configured.");
  return crypto.subtle.importKey("raw", fromB64(encoded), "AES-GCM", false, ["encrypt", "decrypt"]);
}
export const driveOAuthReady = () => Boolean(env.DB && env.GOOGLE_ADS_CLIENT_ID && env.GOOGLE_ADS_CLIENT_SECRET && env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY);

export async function saveDriveConnection(ownerId: string, refreshToken: string, email: string) {
  if (!env.DB) throw new Error("Database unavailable.");
  await ensureMediaTables(env.DB);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await driveKey(), new TextEncoder().encode(refreshToken));
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO google_drive_connections (owner_id, encrypted_refresh_token, token_iv, account_email, connected_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5) ON CONFLICT(owner_id) DO UPDATE SET encrypted_refresh_token = excluded.encrypted_refresh_token, token_iv = excluded.token_iv, account_email = excluded.account_email, updated_at = excluded.updated_at")
    .bind(ownerId, toB64(new Uint8Array(ciphertext)), toB64(iv), email, now).run();
}

export async function driveConnection(db: D1Database, ownerId: string) {
  return db.prepare("SELECT encrypted_refresh_token, token_iv, account_email FROM google_drive_connections WHERE owner_id = ?1").bind(ownerId).first<{ encrypted_refresh_token: string; token_iv: string; account_email: string }>();
}

export async function driveAccessToken(db: D1Database, ownerId: string) {
  if (!driveOAuthReady()) return null;
  const saved = await driveConnection(db, ownerId);
  if (!saved) return null;
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(saved.token_iv) }, await driveKey(), fromB64(saved.encrypted_refresh_token));
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.GOOGLE_ADS_CLIENT_ID!, client_secret: env.GOOGLE_ADS_CLIENT_SECRET!, refresh_token: new TextDecoder().decode(plain), grant_type: "refresh_token" }), signal: AbortSignal.timeout(15000) });
  const result = await response.json() as { access_token?: string; error?: string };
  if (!response.ok || !result.access_token) throw new Error(result.error === "invalid_grant" ? "Google Drive access expired — reconnect Google Drive." : "Google Drive could not refresh its access. Try reconnecting.");
  return result.access_token;
}
