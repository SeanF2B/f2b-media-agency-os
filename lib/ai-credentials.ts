import { env } from "cloudflare:workers";

type AiCredentialRow = { encrypted_key: string; key_iv: string; key_fingerprint: string; updated_at: string };

function fromB64(value: string) { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }
function toB64(value: Uint8Array) { return btoa(Array.from(value, (byte) => String.fromCharCode(byte)).join("")); }

async function key() {
  const encoded = env.AGENCY_CREDENTIALS_ENCRYPTION_KEY;
  if (!encoded) throw new Error("Secure API-key storage is not configured on the app server.");
  const bytes = fromB64(encoded);
  if (bytes.byteLength !== 32) throw new Error("The app credential-encryption key must decode to 32 bytes.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export function aiCredentialStorageReady() {
  try { return Boolean(env.AGENCY_CREDENTIALS_ENCRYPTION_KEY && fromB64(env.AGENCY_CREDENTIALS_ENCRYPTION_KEY).byteLength === 32); }
  catch { return false; }
}

export async function encryptAiCredential(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(value));
  return { iv: toB64(iv), ciphertext: toB64(new Uint8Array(encrypted)) };
}

export async function decryptAiCredential(iv: string, ciphertext: string) {
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await key(), fromB64(ciphertext));
  return new TextDecoder().decode(decrypted);
}

export async function getAgencyOwnerId() {
  if (!env.DB) return "";
  const row = await env.DB.prepare("SELECT owner_id FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ owner_id: string }>();
  return String(row?.owner_id || "");
}

export async function getStoredOpenRouterCredential(ownerId?: string) {
  if (!env.DB) return null;
  const canonicalOwnerId = await getAgencyOwnerId();
  const resolvedOwnerId = ownerId || canonicalOwnerId;
  if (!resolvedOwnerId) return null;
  let row: AiCredentialRow | null;
  try {
    row = await env.DB.prepare("SELECT encrypted_key, key_iv, key_fingerprint, updated_at FROM agency_api_keys WHERE owner_id = ?1 AND provider = 'openrouter'")
      .bind(resolvedOwnerId).first<AiCredentialRow>();
    if (!row && canonicalOwnerId && canonicalOwnerId !== resolvedOwnerId) {
      row = await env.DB.prepare("SELECT encrypted_key, key_iv, key_fingerprint, updated_at FROM agency_api_keys WHERE owner_id = ?1 AND provider = 'openrouter'")
        .bind(canonicalOwnerId).first<AiCredentialRow>();
    }
  } catch {
    return null;
  }
  if (!row) return null;
  return { key: await decryptAiCredential(row.key_iv, row.encrypted_key), fingerprint: row.key_fingerprint, updatedAt: row.updated_at };
}
