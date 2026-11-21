// Per-staff Google Calendar link for Scheduling: busy times in, bookings out (with Google Meet for video calls).
// Uses the agency's existing Google OAuth app (same client + redirect URI as Google Ads / task calendar sync).
import { env } from "cloudflare:workers";
import { encryptCalendarRefreshToken } from "@/lib/google-calendar";
import type { GoogleEvent, GoogleOps } from "./server";
import { ensureSchedulingTables } from "./schema";

const SCOPE = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email";
const STATE_COOKIE = "f2b_sched_google_state";

function fromB64(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
async function key() {
  const encoded = env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY;
  if (!encoded) throw new Error("Secure token storage is not configured.");
  return crypto.subtle.importKey("raw", fromB64(encoded), "AES-GCM", false, ["decrypt"]);
}
async function decrypt(iv: string, ciphertext: string) {
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await key(), fromB64(ciphertext)));
}

export function googleSchedulingAvailable() {
  return Boolean(env.DB && env.GOOGLE_ADS_CLIENT_ID && env.GOOGLE_ADS_CLIENT_SECRET && env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY);
}

const tokens = new Map<string, { token: string; expires: number }>();
async function accessToken(ownerId: string, staffId: string) {
  const cacheKey = `${ownerId}\u0000${staffId}`;
  const cached = tokens.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.token;
  if (!googleSchedulingAvailable()) return null;
  const row = await env.DB!.prepare("SELECT encrypted_refresh_token, token_iv FROM sched_google_connections WHERE owner_id=?1 AND staff_id=?2").bind(ownerId, staffId).first<{ encrypted_refresh_token: string; token_iv: string }>();
  if (!row) return null;
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.GOOGLE_ADS_CLIENT_ID!, client_secret: env.GOOGLE_ADS_CLIENT_SECRET!, refresh_token: await decrypt(row.token_iv, row.encrypted_refresh_token), grant_type: "refresh_token" }), signal: AbortSignal.timeout(15_000) });
  const result = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !result.access_token) throw new Error(result.error === "invalid_grant" ? "Google Calendar access expired — reconnect it in Scheduling → Availability." : "Google Calendar could not refresh its access.");
  tokens.set(cacheKey, { token: result.access_token, expires: Date.now() + Math.max(60, (result.expires_in || 3600) - 300) * 1000 });
  return result.access_token;
}

const busyCache = new Map<string, { at: number; value: Array<{ start: number; end: number }> }>();
const api = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

function body(event: Partial<GoogleEvent>) {
  return {
    ...(event.summary !== undefined ? { summary: event.summary } : {}),
    ...(event.description !== undefined ? { description: event.description } : {}),
    ...(event.location !== undefined ? { location: event.location } : {}),
    ...(event.start ? { start: { dateTime: event.start } } : {}),
    ...(event.end ? { end: { dateTime: event.end } } : {}),
    ...(event.video && event.requestId ? { conferenceData: { createRequest: { requestId: event.requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
    reminders: { useDefault: true },
  };
}

export function createGoogleOps(): GoogleOps {
  return {
    async connected(ownerId, staffIds) {
      if (!env.DB || !staffIds.length) return {};
      await ensureSchedulingTables(env.DB);
      const ids = [...new Set(staffIds)].slice(0, 100);
      const rows = (await env.DB.prepare(`SELECT staff_id, account_email FROM sched_google_connections WHERE owner_id=?1 AND staff_id IN (${ids.map((_, i) => `?${i + 2}`).join(",")})`).bind(ownerId, ...ids).all<{ staff_id: string; account_email: string }>()).results || [];
      return Object.fromEntries(rows.map((r) => [r.staff_id, r.account_email || "connected"]));
    },
    async busy(ownerId, staffId, fromIso, toIso) {
      const cacheKey = `${ownerId}|${staffId}|${fromIso}|${toIso}`;
      const hit = busyCache.get(cacheKey);
      if (hit && Date.now() - hit.at < 60_000) return hit.value;
      const token = await accessToken(ownerId, staffId);
      if (!token) return [];
      const out: Array<{ start: number; end: number }> = [];
      let pageToken = "";
      for (let page = 0; page < 5; page++) {
        const url = new URL(api);
        url.search = new URLSearchParams({ timeMin: fromIso, timeMax: toIso, singleEvents: "true", maxResults: "250", fields: "nextPageToken,items(status,transparency,start,end,extendedProperties/private/f2bBooking)", ...(pageToken ? { pageToken } : {}) }).toString();
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12_000) });
        if (!res.ok) throw new Error(`Google Calendar returned HTTP ${res.status}`);
        const data = await res.json() as { nextPageToken?: string; items?: Array<{ status?: string; transparency?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; extendedProperties?: { private?: { f2bBooking?: string } } }> };
        for (const item of data.items || []) {
          if (item.status === "cancelled" || item.transparency === "transparent") continue;
          if (item.extendedProperties?.private?.f2bBooking) continue; // our own booking events are already counted
          // All-day events marked "busy" block the whole day (in UTC dates; fine for Ireland/UK).
          const start = item.start?.dateTime ? Date.parse(item.start.dateTime) : item.start?.date ? Date.parse(`${item.start.date}T00:00:00Z`) : NaN;
          const end = item.end?.dateTime ? Date.parse(item.end.dateTime) : item.end?.date ? Date.parse(`${item.end.date}T00:00:00Z`) : NaN;
          if (Number.isFinite(start) && Number.isFinite(end) && end > start) out.push({ start, end });
        }
        if (!data.nextPageToken) break;
        pageToken = data.nextPageToken;
      }
      busyCache.set(cacheKey, { at: Date.now(), value: out });
      if (busyCache.size > 300) busyCache.delete(busyCache.keys().next().value as string);
      return out;
    },
    async create(ownerId, staffId, event) {
      const token = await accessToken(ownerId, staffId);
      if (!token) return null;
      const url = `${api}?sendUpdates=none${event.video ? "&conferenceDataVersion=1" : ""}`;
      const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...body(event), extendedProperties: { private: { f2bBooking: event.requestId } } }), signal: AbortSignal.timeout(15_000) });
      const data = await res.json().catch(() => ({})) as { id?: string; hangoutLink?: string; error?: { message?: string } };
      if (!res.ok || !data.id) throw new Error(data.error?.message || `Google Calendar returned HTTP ${res.status}`);
      for (const k of busyCache.keys()) if (k.startsWith(`${ownerId}|${staffId}|`)) busyCache.delete(k);
      return { id: data.id, meetLink: data.hangoutLink };
    },
    async patch(ownerId, staffId, eventId, event) {
      const token = await accessToken(ownerId, staffId);
      if (!token) return;
      const res = await fetch(`${api}/${encodeURIComponent(eventId)}?sendUpdates=none`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body({ ...event, video: false })), signal: AbortSignal.timeout(15_000) });
      if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`Google Calendar returned HTTP ${res.status}`);
    },
    async remove(ownerId, staffId, eventId) {
      const token = await accessToken(ownerId, staffId);
      if (!token) return;
      const res = await fetch(`${api}/${encodeURIComponent(eventId)}?sendUpdates=none`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok && res.status !== 404 && res.status !== 410) throw new Error(`Google Calendar returned HTTP ${res.status}`);
      for (const k of busyCache.keys()) if (k.startsWith(`${ownerId}|${staffId}|`)) busyCache.delete(k);
    },
  };
}

// Signed state: lets the Google round trip finish even when it comes back in a different browser
// (iPhone home-screen app → Safari sheet, phone mail apps…) that has neither our state cookie nor the session.
// Only the server can make one, it names one staff member and expires after 15 minutes.
const STATE_TTL_MS = 15 * 60_000;
async function stateMac(value: string) {
  const secret = String(env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY || "");
  if (!secret) return "";
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(`sched-connect:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 32);
}
export async function makeSchedState(staffId: string, now = Date.now()) {
  const body = `sched:${staffId}:${(now + STATE_TTL_MS).toString(36)}`;
  const mac = await stateMac(body);
  return mac ? `${body}:${mac}` : `${body}:${crypto.randomUUID()}`;
}
/** Staff id from a signed, unexpired state, or "". */
export async function readSchedState(state: string, now = Date.now()) {
  const parts = String(state || "").split(":");
  if (parts.length !== 4 || parts[0] !== "sched" || !parts[1]) return "";
  const exp = parseInt(parts[2], 36);
  if (!Number.isFinite(exp) || exp < now) return "";
  const mac = await stateMac(parts.slice(0, 3).join(":"));
  if (!mac || mac.length !== parts[3].length) return "";
  let diff = 0; for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ parts[3].charCodeAt(i);
  return diff === 0 ? parts[1] : "";
}

/** Starts Google sign-in for one staff member's calendar. */
export async function startGoogleConnect(request: Request, staffId: string) {
  const state = await makeSchedState(staffId);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: env.GOOGLE_ADS_CLIENT_ID!, redirect_uri: `${new URL(request.url).origin}/api/google-ads/callback`, response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent", include_granted_scopes: "true", state }).toString();
  return new Response(null, { status: 302, headers: { Location: url.toString(), "Set-Cookie": `${STATE_COOKIE}=${encodeURIComponent(state)}; Max-Age=900; Path=/api/google-ads; Secure; HttpOnly; SameSite=Lax`, "Cache-Control": "no-store" } });
}

const RESULT_TEXT: Record<string, [string, string]> = {
  connected: ["Calendar connected ✓", "Your Google Calendar is linked. You can close this page and go back to the app."],
  cancelled: ["Not connected", "Google sign-in was cancelled. Go back to the app and tap Google Calendar to try again."],
  "not-allowed": ["Not connected", "This link isn’t for your account. Go back to the app and try again."],
  "refresh-token-missing": ["Almost there", "Google didn’t give us lasting access. Go back to the app and tap Google Calendar again."],
  failed: ["Not connected", "Something went wrong linking your calendar. Go back to the app and try again."],
};
function finish(request: Request, result: string, signedIn = true) {
  const clear = `${STATE_COOKIE}=; Max-Age=0; Path=/api/google-ads; Secure; HttpOnly; SameSite=Lax`;
  if (!signedIn) {
    // Came back in a browser without the app's sign-in (e.g. the sheet an iPhone home-screen app opens): say so plainly.
    const [title, text] = RESULT_TEXT[result] || RESULT_TEXT.failed;
    const ok = result === "connected";
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f4f5f8;color:#111}main{max-width:380px;margin:24px;padding:28px 24px;background:#fff;border-radius:18px;box-shadow:0 10px 30px rgba(0,0,0,.08);text-align:center}.i{width:56px;height:56px;border-radius:50%;margin:0 auto 14px;display:grid;place-items:center;font-size:28px;color:#fff;background:${ok ? "#16a34a" : "#b45309"}}h1{font-size:22px;margin:0 0 8px}p{margin:0 0 18px;line-height:1.5;color:#444}a{display:inline-block;padding:12px 20px;border-radius:12px;background:#111;color:#fff;text-decoration:none;font-weight:600}</style></head><body><main><div class="i">${ok ? "✓" : "!"}</div><h1>${title}</h1><p>${text}</p><a href="/?page=Integrations">Open the app</a></main></body></html>`;
    return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": clear, "Cache-Control": "no-store" } });
  }
  const url = new URL("/", request.url);
  url.searchParams.set("page", "Scheduling");
  url.searchParams.set("schedulingGoogle", result);
  return new Response(null, { status: 302, headers: { Location: url.toString(), "Set-Cookie": clear, "Cache-Control": "no-store" } });
}

/** OAuth callback branch (state "sched:<staffId>:<exp>:<sig>"). Accepted when the signed state is valid (it was only
 * handed to an admin or that staff member), or — signed in, same browser — when it matches our state cookie. */
export async function completeGoogleConnect(request: Request, user: { email: string; userId: string } | null, data: { ownerId?: string; staff?: Array<{ id: string; email?: string; role?: string; isBot?: boolean }> }, state: string) {
  const url = new URL(request.url);
  const signedIn = Boolean(user);
  const done = (result: string) => finish(request, result, signedIn);
  const cookie = decodeURIComponent(request.headers.get("cookie")?.split(";").map((p) => p.trim()).find((p) => p.startsWith(`${STATE_COOKIE}=`))?.slice(STATE_COOKIE.length + 1) || "");
  if (url.searchParams.has("error")) return done("cancelled");
  const code = url.searchParams.get("code") || "";
  if (!state || !code || !googleSchedulingAvailable()) return done("failed");
  const signedStaff = await readSchedState(state);
  const cookieOk = Boolean(user && cookie && state === cookie);
  if (!signedStaff && !cookieOk) return done("failed");
  const staffId = signedStaff || state.split(":")[1] || "";
  const ownerId = String(data.ownerId || "");
  const target = (data.staff || []).find((p) => p.id === staffId && !p.isBot);
  if (!target) return done("not-allowed");
  if (!signedStaff) {
    const me = (data.staff || []).find((p) => !p.isBot && p.email?.toLowerCase() === user!.email.toLowerCase());
    const admin = ownerId === user!.userId || Boolean(me && ["Owner", "Admin"].includes(me.role || ""));
    if (!(admin || me?.id === staffId)) return done("not-allowed");
  }
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: env.GOOGLE_ADS_CLIENT_ID!, client_secret: env.GOOGLE_ADS_CLIENT_SECRET!, redirect_uri: `${url.origin}/api/google-ads/callback`, grant_type: "authorization_code" }), signal: AbortSignal.timeout(15_000) });
    const result = await tokenRes.json() as { access_token?: string; refresh_token?: string };
    if (!tokenRes.ok || !result.access_token || !result.refresh_token) return done(result.access_token ? "refresh-token-missing" : "failed");
    const profile = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${result.access_token}` }, signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).catch(() => ({})) as { email?: string };
    const enc = await encryptCalendarRefreshToken(result.refresh_token);
    await ensureSchedulingTables(env.DB!);
    const now = new Date().toISOString();
    await env.DB!.prepare("INSERT INTO sched_google_connections (owner_id, staff_id, encrypted_refresh_token, token_iv, account_email, connected_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?6) ON CONFLICT(owner_id, staff_id) DO UPDATE SET encrypted_refresh_token=excluded.encrypted_refresh_token, token_iv=excluded.token_iv, account_email=excluded.account_email, updated_at=excluded.updated_at")
      .bind(ownerId, staffId, enc.ciphertext, enc.iv, profile.email || "", now).run();
    tokens.delete(`${ownerId}\u0000${staffId}`);
    return done("connected");
  } catch (error) {
    console.error("Scheduling Google connect failed", error instanceof Error ? error.message : error);
    return done("failed");
  }
}

export async function disconnectGoogle(ownerId: string, staffId: string) {
  if (!env.DB) return;
  await ensureSchedulingTables(env.DB);
  await env.DB.prepare("DELETE FROM sched_google_connections WHERE owner_id=?1 AND staff_id=?2").bind(ownerId, staffId).run();
  tokens.delete(`${ownerId}\u0000${staffId}`);
}
