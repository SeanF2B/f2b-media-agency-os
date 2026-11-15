// Signed, login-free link a client can open to connect their accounts (Agency OS → Operations quick link).
// Token = base64url(clientId).hmac — only the server can make one, and it only works for that client.
const enc = new TextEncoder();
const b64url = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (text: string) => { try { return decodeURIComponent(escape(atob(text.replace(/-/g, "+").replace(/_/g, "/")))); } catch { return ""; } };

async function sign(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(`client-connect:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(value))).slice(0, 32);
}
export async function makeConnectToken(secret: string, clientId: string) {
  const id = b64url(enc.encode(unescape(encodeURIComponent(clientId))));
  return `${id}.${await sign(secret, clientId)}`;
}
export async function readConnectToken(secret: string, token: string) {
  const [id, mac] = String(token || "").split(".");
  if (!id || !mac) return "";
  const clientId = fromB64url(id);
  if (!clientId) return "";
  return (await sign(secret, clientId)) === mac ? clientId : "";
}
