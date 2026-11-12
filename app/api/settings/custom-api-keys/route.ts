import { env } from "cloudflare:workers";
import { aiCredentialStorageReady, decryptAiCredential, encryptAiCredential } from "@/lib/ai-credentials";
import { authorizeAdmin, respond } from "@/lib/settings-auth";

export const dynamic = "force-dynamic";

async function ensureTable() {
  if (!env.DB) throw new Error("The private workspace database is not available.");
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS agency_custom_api_keys (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    label TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    encrypted_key TEXT NOT NULL,
    key_iv TEXT NOT NULL,
    key_fingerprint TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
}

type Row = { id: string; label: string; note: string; key_fingerprint: string; created_at: string; updated_at: string };
const mapRow = (row: Row) => ({ id: row.id, label: row.label, note: row.note, fingerprint: row.key_fingerprint, createdAt: row.created_at, updatedAt: row.updated_at });

async function list(ownerId: string) {
  const result = await env.DB!.prepare("SELECT id, label, note, key_fingerprint, created_at, updated_at FROM agency_custom_api_keys WHERE owner_id = ?1 ORDER BY label COLLATE NOCASE")
    .bind(ownerId).all<Row>();
  return (result.results || []).map(mapRow);
}

export async function GET() {
  const auth = await authorizeAdmin("manage API keys");
  if (auth.error) return auth.error;
  try {
    await ensureTable();
    return respond({ keys: await list(auth.ownerId), secureStorageReady: aiCredentialStorageReady() });
  } catch {
    return respond({ error: "Could not load saved API keys.", secureStorageReady: aiCredentialStorageReady() }, 503);
  }
}

export async function POST(request: Request) {
  const auth = await authorizeAdmin("manage API keys");
  if (auth.error) return auth.error;
  if (!aiCredentialStorageReady()) return respond({ error: "Secure storage needs a one-time server setup before keys can be saved." }, 503);
  let body: { id?: string; label?: string; note?: string; apiKey?: string };
  try { body = await request.json() as typeof body; } catch { return respond({ error: "Send a valid request." }, 400); }
  const label = String(body.label || "").trim();
  const note = String(body.note || "").trim().slice(0, 200);
  const apiKey = String(body.apiKey || "").trim();
  if (!label || label.length > 60) return respond({ error: "Give the key a short name (up to 60 characters)." }, 400);
  if (apiKey.length < 8 || apiKey.length > 4096 || /\s/.test(apiKey)) return respond({ error: "Paste the API key with no spaces." }, 400);
  try {
    await ensureTable();
    const now = new Date().toISOString();
    const encrypted = await encryptAiCredential(apiKey);
    const id = body.id && /^[a-f0-9-]{36}$/i.test(body.id) ? body.id : crypto.randomUUID();
    const existing = await env.DB!.prepare("SELECT id FROM agency_custom_api_keys WHERE id = ?1 AND owner_id = ?2").bind(id, auth.ownerId).first();
    if (existing) {
      await env.DB!.prepare("UPDATE agency_custom_api_keys SET label = ?3, note = ?4, encrypted_key = ?5, key_iv = ?6, key_fingerprint = ?7, updated_at = ?8 WHERE id = ?1 AND owner_id = ?2")
        .bind(id, auth.ownerId, label, note, encrypted.ciphertext, encrypted.iv, apiKey.slice(-4), now).run();
    } else {
      await env.DB!.prepare("INSERT INTO agency_custom_api_keys (id, owner_id, label, note, encrypted_key, key_iv, key_fingerprint, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)")
        .bind(id, auth.ownerId, label, note, encrypted.ciphertext, encrypted.iv, apiKey.slice(-4), now).run();
    }
    return respond({ keys: await list(auth.ownerId), secureStorageReady: true });
  } catch {
    return respond({ error: "Could not securely save the key." }, 503);
  }
}

export async function DELETE(request: Request) {
  const auth = await authorizeAdmin("manage API keys");
  if (auth.error) return auth.error;
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[a-f0-9-]{36}$/i.test(id)) return respond({ error: "Choose a key to remove." }, 400);
  try {
    await ensureTable();
    await env.DB!.prepare("DELETE FROM agency_custom_api_keys WHERE id = ?1 AND owner_id = ?2").bind(id, auth.ownerId).run();
    return respond({ keys: await list(auth.ownerId), secureStorageReady: aiCredentialStorageReady() });
  } catch {
    return respond({ error: "Could not remove the key." }, 503);
  }
}

/** Server-side helper for features that need a saved key by name. */
export async function readCustomApiKey(ownerId: string, label: string): Promise<string | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare("SELECT encrypted_key, key_iv FROM agency_custom_api_keys WHERE owner_id = ?1 AND lower(label) = lower(?2)")
    .bind(ownerId, label).first<{ encrypted_key: string; key_iv: string }>();
  return row ? decryptAiCredential(row.key_iv, row.encrypted_key) : null;
}
