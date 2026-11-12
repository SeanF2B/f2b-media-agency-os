import { env } from "cloudflare:workers";

function fromB64(value: string) { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }
function toB64(value: Uint8Array) { return btoa(Array.from(value, (byte) => String.fromCharCode(byte)).join("")); }

async function encryptionKey() {
  const encoded = env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY;
  if (!encoded) throw new Error("Secure WordPress credential storage is not configured on the server.");
  const bytes = fromB64(encoded);
  if (bytes.byteLength !== 32) throw new Error("The server encryption key must be 32 bytes.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptWordPressPassword(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), new TextEncoder().encode(value));
  return { iv: toB64(iv), ciphertext: toB64(new Uint8Array(encrypted)) };
}

export async function decryptWordPressPassword(iv: string, value: string) {
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await encryptionKey(), fromB64(value));
  return new TextDecoder().decode(decrypted);
}

function isPrivateIpv4(host: string) {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
}

export function validateWordPressSiteUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Add a valid website URL in this client's profile first."); }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443" || url.search || url.hash || !host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || isPrivateIpv4(host) || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:")) {
    throw new Error("The saved WordPress site must be a public HTTPS website.");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  return url;
}

export async function wordpressRequest(siteUrl: string, username: string, appPassword: string, path: string, init: RequestInit = {}) {
  const site = validateWordPressSiteUrl(siteUrl);
  const endpoint = new URL(`${site.pathname}/wp-json/wp/v2/${path.replace(/^\/+/, "")}`, site.origin);
  const credentialBytes = new TextEncoder().encode(`${username}:${appPassword.replace(/\s/g, "")}`);
  const credentials = btoa(Array.from(credentialBytes, (byte) => String.fromCharCode(byte)).join(""));
  const response = await fetch(endpoint, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Basic ${credentials}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
  });
  if (response.status >= 300 && response.status < 400) throw new Error("WordPress redirected this API request. Check the saved site URL includes the correct HTTPS address and site path.");
  const payload = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) {
    const message = typeof payload.message === "string" ? payload.message.replace(/<[^>]*>/g, "").slice(0, 240) : "";
    const code = typeof payload.code === "string" ? payload.code : "";
    if (response.status === 401) {
      if (/application_passwords_disabled/i.test(code)) throw new Error("WordPress has Application Passwords disabled for this site. The shared WordPress.com connection works only if this site is linked through Jetpack; otherwise the site owner must enable Application Passwords.");
      throw new Error("WordPress did not authenticate the saved credential (HTTP 401). This connection needs a WordPress Application Password, not the normal wp-admin password. If the saved login is already an Application Password, check its username and reconnect.");
    }
    if (response.status === 403) throw new Error("WordPress denied API access (HTTP 403). The connected user may lack permission to edit pages, or a WordPress security or hosting rule may be blocking authenticated API requests.");
    throw new Error(message || `WordPress returned HTTP ${response.status}.`);
  }
  return payload;
}
