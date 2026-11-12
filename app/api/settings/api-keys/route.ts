import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { aiCredentialStorageReady, encryptAiCredential } from "@/lib/ai-credentials";
import { getTeamPermissions } from "@/lib/access-permissions";

export const dynamic = "force-dynamic";
const respond = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function ensureApiKeyTable() {
  if (!env.DB) throw new Error("The private workspace database is not available.");
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS agency_api_keys (
    owner_id TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('openrouter')),
    encrypted_key TEXT NOT NULL,
    key_iv TEXT NOT NULL,
    key_fingerprint TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (owner_id, provider)
  )`).run();
}

async function authorizeAdmin(): Promise<{ ownerId: string; error?: never } | { error: Response; ownerId?: never }> {
  const user = await getChatGPTUser();
  if (!user) return { error: respond({ error: "Sign in before managing API keys." }, 401) };
  if (!env.DB) return { error: respond({ error: "The private workspace database is not available." }, 503) };
  const row = await env.DB.prepare("SELECT owner_id, data FROM workspace_documents WHERE id = ?1")
    .bind("f2b-agency").first<{ owner_id: string; data: string }>();
  if (!row?.data) return { error: respond({ error: "The agency workspace could not be loaded." }, 503) };
  let workspace: any;
  try { workspace = JSON.parse(row.data); } catch { return { error: respond({ error: "The agency workspace data could not be read." }, 503) }; }
  const profile = (workspace.staff || []).find((member: any) => !member?.isBot && (member?.id === user.userId || String(member?.email || "").toLowerCase() === user.email.toLowerCase()));
  const isOwner = row.owner_id === user.userId || workspace.ownerId === user.userId || String(workspace.settings?.adminEmail || "").toLowerCase() === user.email.toLowerCase();
  const isAdmin = isOwner || (profile?.role === "Admin" && getTeamPermissions(profile.role, profile.permissions).team);
  if (!isAdmin) return { error: respond({ error: "Only the workspace owner or an admin can manage API keys." }, 403) };
  return { ownerId: row.owner_id || workspace.ownerId || user.userId };
}

export async function GET() {
  const auth = await authorizeAdmin();
  if (auth.error) return auth.error;
  try {
    await ensureApiKeyTable();
    const row = await env.DB!.prepare("SELECT key_fingerprint, updated_at FROM agency_api_keys WHERE owner_id = ?1 AND provider = 'openrouter'")
      .bind(auth.ownerId).first<{ key_fingerprint: string; updated_at: string }>();
    return respond({ provider: "openrouter", connected: Boolean(row), fingerprint: row?.key_fingerprint || "", updatedAt: row?.updated_at || null, secureStorageReady: aiCredentialStorageReady() });
  } catch (error) {
    console.error("Could not read Agency OS API-key settings", error);
    return respond({ error: "API-key storage is not available yet. Apply the Agency OS database update, then try again.", secureStorageReady: aiCredentialStorageReady() }, 503);
  }
}

export async function POST(request: Request) {
  const auth = await authorizeAdmin();
  if (auth.error) return auth.error;
  if (!env.DB) return respond({ error: "The private workspace database is not available." }, 503);
  if (!aiCredentialStorageReady()) return respond({ error: "Secure API-key storage is not configured on the app server yet." }, 503);
  try { await ensureApiKeyTable(); } catch { return respond({ error: "API-key storage could not be initialized." }, 503); }
  let body: { provider?: string; apiKey?: string };
  try { body = await request.json() as typeof body; } catch { return respond({ error: "Enter a valid API key." }, 400); }
  if (body.provider !== "openrouter") return respond({ error: "OpenRouter is the only API-key provider available here so far." }, 400);
  const apiKey = String(body.apiKey || "").trim();
  if (!/^sk-or-v1-[A-Za-z0-9_-]{32,160}$/.test(apiKey)) return respond({ error: "That does not look like an OpenRouter API key." }, 400);

  try {
    const validation = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${apiKey}`, "HTTP-Referer": "https://f2bmedia.com", "X-Title": "F2B Media Agency OS" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!validation.ok) return respond({ error: validation.status === 401 ? "OpenRouter rejected that key. Check it and try again." : `OpenRouter could not verify the key right now (${validation.status}).` }, 422);
    const encrypted = await encryptAiCredential(apiKey);
    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO agency_api_keys (owner_id, provider, encrypted_key, key_iv, key_fingerprint, created_at, updated_at)
      VALUES (?1, 'openrouter', ?2, ?3, ?4, ?5, ?5)
      ON CONFLICT(owner_id, provider) DO UPDATE SET encrypted_key = excluded.encrypted_key, key_iv = excluded.key_iv, key_fingerprint = excluded.key_fingerprint, updated_at = excluded.updated_at`)
      .bind(auth.ownerId, encrypted.ciphertext, encrypted.iv, apiKey.slice(-4), now).run();
    return respond({ provider: "openrouter", connected: true, fingerprint: apiKey.slice(-4), updatedAt: now, secureStorageReady: true });
  } catch (error) {
    console.error("Could not save Agency OS API key", error instanceof Error ? error.message : "unknown error");
    return respond({ error: error instanceof Error && error.message.includes("encryption") ? error.message : "Could not securely save the key. Check the app's storage setup and try again." }, 503);
  }
}

export async function DELETE() {
  const auth = await authorizeAdmin();
  if (auth.error) return auth.error;
  if (!env.DB) return respond({ error: "The private workspace database is not available." }, 503);
  try {
    await ensureApiKeyTable();
    await env.DB.prepare("DELETE FROM agency_api_keys WHERE owner_id = ?1 AND provider = 'openrouter'").bind(auth.ownerId).run();
    return respond({ provider: "openrouter", connected: false, fingerprint: "", updatedAt: null, secureStorageReady: aiCredentialStorageReady() });
  } catch {
    return respond({ error: "API-key storage is not available yet. Apply the Agency OS database update, then try again." }, 503);
  }
}
