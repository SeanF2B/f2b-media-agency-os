// Signed one-click unsubscribe tokens (RFC 8058). The link works without signing in and can't
// be forged or used to unsubscribe someone else.
import { env } from "cloudflare:workers";

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function key() {
  const secret = String(env.AGENCY_CREDENTIALS_ENCRYPTION_KEY || "");
  if (!secret) throw new Error("Unsubscribe signing key is not configured.");
  const material = await crypto.subtle.digest("SHA-256", enc.encode(`outreach-unsubscribe:${secret}`));
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signUnsubscribe(ownerId: string, enrollmentId: string, email: string): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ o: ownerId, e: enrollmentId, m: email.toLowerCase() })));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await key(), enc.encode(payload)));
  return `${payload}.${b64url(signature).slice(0, 32)}`;
}

export async function verifyUnsubscribe(token: string): Promise<{ ownerId: string; enrollmentId: string; email: string } | null> {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature || payload.length > 600) return null;
  const expected = b64url(new Uint8Array(await crypto.subtle.sign("HMAC", await key(), enc.encode(payload)))).slice(0, 32);
  if (expected.length !== signature.length) return null;
  let diff = 0; for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/")), (char) => char.charCodeAt(0))));
    return { ownerId: String(data.o), enrollmentId: String(data.e), email: String(data.m) };
  } catch { return null; }
}
