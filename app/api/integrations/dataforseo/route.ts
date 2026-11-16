import { env } from "cloudflare:workers";
import { encryptAiCredential, aiCredentialStorageReady } from "@/lib/ai-credentials";
import { dataForSeoCredentials } from "@/lib/dataforseo-credentials";
import { authorizeAdmin, respond } from "@/lib/settings-auth";

export const dynamic = "force-dynamic";

/** Free DataForSEO endpoint: confirms the login works and returns the account balance (no credits used). */
async function checkLogin(login: string, password: string): Promise<{ ok: true; balance: number | null } | { ok: false; message: string }> {
  try {
    const response = await fetch("https://api.dataforseo.com/v3/appendix/user_data", {
      headers: { Authorization: `Basic ${btoa(`${login}:${password}`)}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => null) as { status_code?: number; status_message?: string; tasks?: Array<{ status_code?: number; status_message?: string; result?: Array<{ money?: { balance?: number } }> }> } | null;
    if (response.status === 401 || body?.status_code === 40100) return { ok: false, message: "DataForSEO rejected that login. Use the API login and API password from app.dataforseo.com → API Access (not your website password)." };
    if (!response.ok || !body) return { ok: false, message: `DataForSEO could not be reached (HTTP ${response.status}). Try again in a minute.` };
    const task = body.tasks?.[0];
    if (task && task.status_code && task.status_code >= 40000) return { ok: false, message: `DataForSEO: ${String(task.status_message || "login check failed").slice(0, 200)}` };
    const balance = task?.result?.[0]?.money?.balance;
    return { ok: true, balance: typeof balance === "number" ? balance : null };
  } catch {
    return { ok: false, message: "DataForSEO did not respond. Check your connection and try again." };
  }
}

export async function GET() {
  const auth = await authorizeAdmin("view the DataForSEO connection");
  if (auth.error) return auth.error;
  const creds = await dataForSeoCredentials(env.DB, auth.ownerId);
  if (!creds) return respond({ connected: false, secureStorageReady: aiCredentialStorageReady() });
  const check = await checkLogin(creds.login, creds.password);
  return respond(check.ok
    ? { connected: true, login: creds.login, balance: check.balance }
    : { connected: false, saved: true, login: creds.login, message: check.message, secureStorageReady: aiCredentialStorageReady() });
}

export async function POST(request: Request) {
  const auth = await authorizeAdmin("connect DataForSEO");
  if (auth.error) return auth.error;
  if (!aiCredentialStorageReady()) return respond({ error: "Secure storage needs a one-time server setup before keys can be saved." }, 503);
  let body: { login?: string; password?: string };
  try { body = await request.json() as typeof body; } catch { return respond({ error: "Send a valid request." }, 400); }
  const login = String(body.login || "").trim();
  const password = String(body.password || "").trim();
  if (!login || !password || /\s/.test(login + password) || login.length > 200 || password.length > 200) return respond({ error: "Enter your DataForSEO API login and API password." }, 400);
  const check = await checkLogin(login, password);
  if (!check.ok) return respond({ error: check.message }, 400);
  try {
    const db = env.DB!;
    await db.prepare(`CREATE TABLE IF NOT EXISTS agency_custom_api_keys (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, label TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      encrypted_key TEXT NOT NULL, key_iv TEXT NOT NULL, key_fingerprint TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`).run();
    const value = `${login}:${password}`;
    const encrypted = await encryptAiCredential(value);
    const now = new Date().toISOString();
    const existing = await db.prepare("SELECT id FROM agency_custom_api_keys WHERE owner_id = ?1 AND lower(replace(label, ' ', '')) IN ('dataforseo', 'dataforseologin', 'dataforseoapi') ORDER BY updated_at DESC LIMIT 1")
      .bind(auth.ownerId).first<{ id: string }>();
    if (existing) {
      await db.prepare("UPDATE agency_custom_api_keys SET label = 'DataForSEO', encrypted_key = ?3, key_iv = ?4, key_fingerprint = ?5, updated_at = ?6 WHERE id = ?1 AND owner_id = ?2")
        .bind(existing.id, auth.ownerId, encrypted.ciphertext, encrypted.iv, password.slice(-4), now).run();
    } else {
      await db.prepare("INSERT INTO agency_custom_api_keys (id, owner_id, label, note, encrypted_key, key_iv, key_fingerprint, created_at, updated_at) VALUES (?1, ?2, 'DataForSEO', 'SEO research: keywords, Maps ranks, rank tracking, backlinks, community leads', ?3, ?4, ?5, ?6, ?6)")
        .bind(crypto.randomUUID(), auth.ownerId, encrypted.ciphertext, encrypted.iv, password.slice(-4), now).run();
    }
    return respond({ connected: true, login, balance: check.balance });
  } catch {
    return respond({ error: "Could not securely save the DataForSEO login." }, 503);
  }
}
