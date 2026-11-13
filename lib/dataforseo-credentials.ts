import { env } from "cloudflare:workers";
import { decryptAiCredential } from "./ai-credentials";

/**
 * DataForSEO login for paid SEO lookups. Uses Worker secrets when set; otherwise the login
 * saved once in Settings → APIs under the name "DataForSEO" (value "login:password").
 */
export async function dataForSeoCredentials(db: D1Database | undefined, ownerId: string): Promise<{ login: string; password: string } | null> {
  if (env.DATAFORSEO_API_LOGIN && env.DATAFORSEO_API_PASSWORD) return { login: env.DATAFORSEO_API_LOGIN, password: env.DATAFORSEO_API_PASSWORD };
  if (!db || !ownerId) return null;
  try {
    const row = await db.prepare("SELECT encrypted_key, key_iv FROM agency_custom_api_keys WHERE owner_id = ?1 AND lower(replace(label, ' ', '')) IN ('dataforseo', 'dataforseologin', 'dataforseoapi') ORDER BY updated_at DESC LIMIT 1")
      .bind(ownerId).first<{ encrypted_key: string; key_iv: string }>();
    if (!row) return null;
    const value = String(await decryptAiCredential(row.key_iv, row.encrypted_key) || "").trim();
    const split = value.match(/^(\S+?)\s*[:\s|]\s*(\S+)$/);
    return split ? { login: split[1], password: split[2] } : null;
  } catch { return null; }
}

export const DATAFORSEO_SETUP_MESSAGE = "Connect DataForSEO once in Settings → APIs: add a key named “DataForSEO” with the value login:password (your DataForSEO API login and password).";
