import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { encryptRefreshToken } from "@/lib/google-ads-direct";
import { encryptCalendarRefreshToken, syncGoogleCalendarTasks } from "@/lib/google-calendar";
import { saveDriveConnection, userDriveKey } from "@/lib/media-library/server";
import { saveGmail } from "@/lib/bookkeeping-email";
import { completeGoogleConnect } from "@/lib/scheduling/google";

export const dynamic = "force-dynamic";

function finish(request: Request, result: string) {
  const url = new URL("/", request.url);
  url.searchParams.set("googleAdsConnection", result);
  return new Response(null, { status: 302, headers: { Location: url.toString(), "Set-Cookie": "f2b_google_ads_oauth_state=; Max-Age=0; Path=/api/google-ads; Secure; HttpOnly; SameSite=Lax", "Cache-Control": "no-store" } });
}

function finishCalendar(request: Request, result: string) {
  const url = new URL("/", request.url);
  url.searchParams.set("googleCalendarConnection", result);
  return new Response(null, { status: 302, headers: { Location: url.toString(), "Set-Cookie": "f2b_google_calendar_oauth_state=; Max-Age=0; Path=/api/google-ads; Secure; HttpOnly; SameSite=Lax", "Cache-Control": "no-store" } });
}

function finishSearchConsole(request: Request, result: string) {
  const url = new URL("/", request.url);
  url.searchParams.set("searchConsoleConnection", result);
  return new Response(null, { status: 302, headers: { Location: url.toString(), "Set-Cookie": "f2b_search_console_oauth_state=; Max-Age=0; Path=/api/google-ads; Secure; HttpOnly; SameSite=Lax", "Cache-Control": "no-store" } });
}

async function completeCalendarConnection(request: Request, data: { ownerId: string; tasks?: Array<{ id: string; title: string; due?: string; status?: string }> }, state: string, code: string) {
  const cookie = request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith("f2b_google_calendar_oauth_state="))?.slice("f2b_google_calendar_oauth_state=".length) || "";
  const url = new URL(request.url);
  if (url.searchParams.has("error")) return finishCalendar(request, "cancelled");
  if (!state || !cookie || state !== cookie || !code || !env.DB || !env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY) return finishCalendar(request, "oauth-failed");
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: env.GOOGLE_ADS_CLIENT_ID, client_secret: env.GOOGLE_ADS_CLIENT_SECRET, redirect_uri: `${url.origin}/api/google-ads/callback`, grant_type: "authorization_code" }), signal: AbortSignal.timeout(15000) });
    const tokens = await tokenResponse.json() as { access_token?: string; refresh_token?: string };
    if (!tokenResponse.ok || !tokens.access_token) return finishCalendar(request, "oauth-failed");
    let refreshToken = tokens.refresh_token;
    if (!refreshToken) {
      const old = await env.DB.prepare("SELECT encrypted_refresh_token, token_iv FROM google_calendar_connections WHERE owner_id = ?1").bind(data.ownerId).first<{ encrypted_refresh_token: string; token_iv: string }>();
      if (!old) return finishCalendar(request, "refresh-token-missing");
    }
    const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(10000) });
    const profile = profileResponse.ok ? await profileResponse.json() as { email?: string } : {};
    const now = new Date().toISOString();
    if (refreshToken) {
      const encrypted = await encryptCalendarRefreshToken(refreshToken);
      await env.DB.prepare("INSERT INTO google_calendar_connections (owner_id, encrypted_refresh_token, token_iv, account_email, connected_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5) ON CONFLICT(owner_id) DO UPDATE SET encrypted_refresh_token = excluded.encrypted_refresh_token, token_iv = excluded.token_iv, account_email = excluded.account_email, updated_at = excluded.updated_at")
        .bind(data.ownerId, encrypted.ciphertext, encrypted.iv, profile.email || "", now).run();
    } else {
      await env.DB.prepare("UPDATE google_calendar_connections SET account_email = ?2, updated_at = ?3 WHERE owner_id = ?1").bind(data.ownerId, profile.email || "", now).run();
    }
    try {
      const ids = (data.tasks || []).filter((task) => task.due && task.status !== "Done").map((task) => task.id);
      await syncGoogleCalendarTasks(data.ownerId, data, ids);
      return finishCalendar(request, "connected");
    } catch (error) {
      console.error("Google Calendar connected, but initial task sync failed", error instanceof Error ? error.message : "unknown");
      return finishCalendar(request, "connected-sync-failed");
    }
  } catch (error) {
    console.error("Google Calendar OAuth callback failed", error instanceof Error ? error.message : "unknown");
    return finishCalendar(request, "oauth-failed");
  }
}

async function completeSearchConsoleConnection(request: Request, ownerId: string, state: string, code: string) {
  const cookie = request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith("f2b_search_console_oauth_state="))?.slice("f2b_search_console_oauth_state=".length) || "";
  const url = new URL(request.url);
  if (url.searchParams.has("error")) return finishSearchConsole(request, "cancelled");
  if (!state || !cookie || state !== cookie || !code || !env.DB || !env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY) return finishSearchConsole(request, "oauth-failed");
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: env.GOOGLE_ADS_CLIENT_ID, client_secret: env.GOOGLE_ADS_CLIENT_SECRET, redirect_uri: `${url.origin}/api/google-ads/callback`, grant_type: "authorization_code" }), signal: AbortSignal.timeout(15000) });
    const tokens = await tokenResponse.json() as { access_token?: string; refresh_token?: string; scope?: string; error?: string; error_description?: string };
    if (!tokenResponse.ok || !tokens.access_token || !tokens.refresh_token) {
      console.error("Search Console OAuth token exchange failed", { status: tokenResponse.status, hasAccessToken: Boolean(tokens.access_token), hasRefreshToken: Boolean(tokens.refresh_token), error: tokens.error || "unknown", description: String(tokens.error_description || "").slice(0, 200) });
      return finishSearchConsole(request, tokens.access_token && !tokens.refresh_token ? "refresh-token-missing" : "oauth-failed");
    }
    const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(10000) });
    const profile = profileResponse.ok ? await profileResponse.json() as { email?: string } : {};
    const encrypted = await encryptRefreshToken(tokens.refresh_token);
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO google_search_console_connections (id, owner_id, encrypted_refresh_token, token_iv, account_email, connected_at, updated_at, granted_scopes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7) ON CONFLICT(owner_id) DO UPDATE SET encrypted_refresh_token = excluded.encrypted_refresh_token, token_iv = excluded.token_iv, account_email = excluded.account_email, granted_scopes = excluded.granted_scopes, updated_at = excluded.updated_at")
      .bind(crypto.randomUUID(), ownerId, encrypted.ciphertext, encrypted.iv, profile.email || "", now, tokens.scope || "").run();
    // Add, verify and link every client's site straight away (no waiting for the next 6-hourly run).
    try { const { autoLinkGoogleProperties } = await import("@/lib/google-auto-link"); await autoLinkGoogleProperties(env.DB, 0); } catch (error) { console.error("Google auto-link after connect failed", error instanceof Error ? error.message : "unknown"); }
    return finishSearchConsole(request, "connected");
  } catch (error) {
    console.error("Search Console OAuth callback failed", error instanceof Error ? error.message : "unknown");
    return finishSearchConsole(request, "oauth-failed");
  }
}

function finishDrive(request: Request, result: string, page = "") {
  const url = new URL("/", request.url);
  url.searchParams.set("page", page || "Media Library");
  url.searchParams.set("driveConnection", result);
  return new Response(null, { status: 302, headers: { Location: url.toString(), "Set-Cookie": "f2b_google_drive_oauth_state=; Max-Age=0; Path=/api/google-ads; Secure; HttpOnly; SameSite=Lax", "Cache-Control": "no-store" } });
}

function finishGmail(request: Request, result: string) {
  const url = new URL("/", request.url);
  url.searchParams.set("page", "Bookkeeping");
  url.searchParams.set("gmailConnection", result);
  return new Response(null, { status: 302, headers: { Location: url.toString(), "Set-Cookie": "f2b_gmail_oauth_state=; Max-Age=0; Path=/api/google-ads; Secure; HttpOnly; SameSite=Lax", "Cache-Control": "no-store" } });
}

async function completeGmailConnection(request: Request, ownerId: string, state: string, code: string) {
  const [, scopeId = "agency", nonce = ""] = state.split(":");
  const cookie = request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith("f2b_gmail_oauth_state="))?.slice("f2b_gmail_oauth_state=".length) || "";
  const url = new URL(request.url);
  if (url.searchParams.has("error")) return finishGmail(request, "cancelled");
  if (!nonce || !cookie || nonce !== cookie || !code || !env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY) return finishGmail(request, "oauth-failed");
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: env.GOOGLE_ADS_CLIENT_ID, client_secret: env.GOOGLE_ADS_CLIENT_SECRET, redirect_uri: `${url.origin}/api/google-ads/callback`, grant_type: "authorization_code" }), signal: AbortSignal.timeout(15000) });
    const tokens = await tokenResponse.json() as { access_token?: string; refresh_token?: string; scope?: string };
    if (!tokenResponse.ok || !tokens.access_token) return finishGmail(request, "oauth-failed");
    if (!tokens.refresh_token) return finishGmail(request, "refresh-token-missing");
    if (!String(tokens.scope || "").includes("gmail")) return finishGmail(request, "scope-missing");
    const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(10000) });
    const profile = profileResponse.ok ? await profileResponse.json() as { email?: string } : {};
    await saveGmail(ownerId, scopeId, tokens.refresh_token, profile.email || "");
    return finishGmail(request, "connected");
  } catch (error) {
    console.error("Gmail OAuth callback failed", error instanceof Error ? error.message : "unknown");
    return finishGmail(request, "oauth-failed");
  }
}

async function completeDriveConnection(request: Request, ownerId: string, state: string, code: string, page = "") {
  const cookie = request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith("f2b_google_drive_oauth_state="))?.slice("f2b_google_drive_oauth_state=".length) || "";
  const url = new URL(request.url);
  if (url.searchParams.has("error")) return finishDrive(request, "cancelled", page);
  if (!state || !cookie || state !== cookie || !code || !env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY) return finishDrive(request, "oauth-failed", page);
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: env.GOOGLE_ADS_CLIENT_ID, client_secret: env.GOOGLE_ADS_CLIENT_SECRET, redirect_uri: `${url.origin}/api/google-ads/callback`, grant_type: "authorization_code" }), signal: AbortSignal.timeout(15000) });
    const tokens = await tokenResponse.json() as { access_token?: string; refresh_token?: string; scope?: string };
    if (!tokenResponse.ok || !tokens.access_token) return finishDrive(request, "oauth-failed", page);
    if (!tokens.refresh_token) return finishDrive(request, "refresh-token-missing", page);
    if (!String(tokens.scope || "").includes("drive")) return finishDrive(request, "scope-missing", page);
    const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(10000) });
    const profile = profileResponse.ok ? await profileResponse.json() as { email?: string } : {};
    await saveDriveConnection(ownerId, tokens.refresh_token, profile.email || "");
    return finishDrive(request, "connected", page);
  } catch (error) {
    console.error("Google Drive OAuth callback failed", error instanceof Error ? error.message : "unknown");
    return finishDrive(request, "oauth-failed", page);
  }
}

// Google Business Profile (Content calendar publishing + live Google posts).
async function completeGbpConnection(request: Request, ownerId: string, clients: any[], state: string, code: string) {
  const done = (r: string) => { const u = new URL("/", request.url); u.searchParams.set("page", "Content"); u.searchParams.set("gbpConnection", r); return new Response(null, { status: 302, headers: { Location: u.toString(), "Set-Cookie": "f2b_gbp_oauth_state=; Max-Age=0; Path=/api/google-ads; Secure; HttpOnly; SameSite=Lax", "Cache-Control": "no-store" } }); };
  const cookie = request.headers.get("cookie")?.split(";").map((i) => i.trim()).find((i) => i.startsWith("f2b_gbp_oauth_state="))?.slice("f2b_gbp_oauth_state=".length) || "";
  if (new URL(request.url).searchParams.has("error")) return done("cancelled");
  if (!state || state !== cookie || !code || !env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET) return done("oauth-failed");
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: env.GOOGLE_ADS_CLIENT_ID, client_secret: env.GOOGLE_ADS_CLIENT_SECRET, redirect_uri: `${new URL(request.url).origin}/api/google-ads/callback`, grant_type: "authorization_code" }) });
    const t = await r.json() as { access_token?: string; refresh_token?: string; scope?: string };
    if (!r.ok || !t.access_token) return done("oauth-failed");
    if (!t.refresh_token) return done("refresh-token-missing");
    if (!String(t.scope || "").includes("business.manage")) return done("scope-missing");
    const me = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${t.access_token}` } }).then((x) => x.ok ? x.json() as Promise<{ email?: string }> : {}).catch(() => ({} as { email?: string }));
    const { saveGbpConnection, syncGbpLocations } = await import("@/lib/content-publish");
    await saveGbpConnection(ownerId, t.refresh_token, (me as { email?: string }).email || "");
    await syncGbpLocations(ownerId, clients.map((c: any) => ({ id: String(c.id), name: String(c.name || ""), website: String(c.website || c.wordpressSiteUrl || ""), googleBusinessLocation: c.googleBusinessLocation }))).catch((e) => console.error("gbp locations", e));
    return done("connected");
  } catch (e) { console.error("gbp oauth", e); return done("oauth-failed"); }
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  // Scheduling: any staff member can connect their own calendar (admins can connect anyone's). The signed state
  // lets this finish on phones where Google sends you back in a browser without the app's sign-in.
  const schedState = new URL(request.url).searchParams.get("state") || "";
  if (schedState.startsWith("sched:") && env.DB) {
    const ws = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
    if (ws) return completeGoogleConnect(request, user, JSON.parse(ws.data), schedState);
  }
  if (!user || !env.DB) return finish(request, "sign-in-required");
  const workspace = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!workspace) return finish(request, "workspace-unavailable");
  const data = JSON.parse(workspace.data);
  // A team member's own Google Drive (Content calendar): stored under their email, no admin needed.
  if (schedState.startsWith("udrive:")) return completeDriveConnection(request, userDriveKey(user.email), schedState, new URL(request.url).searchParams.get("code") || "", "Content");
  const admin = data.ownerId === user.userId || data.staff?.some((person: { email?: string; role?: string }) => person.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(person.role || ""));
  if (!admin) return finish(request, "admin-required");
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  if (state.startsWith("calendar:")) return completeCalendarConnection(request, data, state, url.searchParams.get("code") || "");
  if (state.startsWith("gmail:")) return completeGmailConnection(request, String(data.ownerId || user.userId), state, url.searchParams.get("code") || "");
  if (state.startsWith("gbp:")) return completeGbpConnection(request, String(data.ownerId || user.userId), data.clients || [], state, url.searchParams.get("code") || "");
  if (state.startsWith("drive:")) return completeDriveConnection(request, String(data.ownerId || user.userId), state, url.searchParams.get("code") || "");
  if (state.startsWith("searchConsole:")) return completeSearchConsoleConnection(request, String(data.ownerId || user.userId), state.slice("searchConsole:".length), url.searchParams.get("code") || "");
  const cookie = request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith("f2b_google_ads_oauth_state="))?.slice("f2b_google_ads_oauth_state=".length) || "";
  const code = url.searchParams.get("code") || "";
  if (!state || !cookie || state !== cookie || !code || !env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY) {
    console.error("Google Ads OAuth callback missing required state, code, or server configuration", {
      hasState: Boolean(state),
      hasCookie: Boolean(cookie),
      stateMatches: Boolean(state && cookie && state === cookie),
      hasCode: Boolean(code),
      hasClientId: Boolean(env.GOOGLE_ADS_CLIENT_ID),
      hasClientSecret: Boolean(env.GOOGLE_ADS_CLIENT_SECRET),
      hasEncryptionKey: Boolean(env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY),
    });
    return finish(request, "oauth-failed");
  }
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: env.GOOGLE_ADS_CLIENT_ID, client_secret: env.GOOGLE_ADS_CLIENT_SECRET, redirect_uri: `${url.origin}/api/google-ads/callback`, grant_type: "authorization_code" }), signal: AbortSignal.timeout(15000) });
    const tokens = await tokenResponse.json() as { access_token?: string; refresh_token?: string; error?: string; error_description?: string };
    if (!tokenResponse.ok || !tokens.access_token) {
      console.error("Google Ads OAuth token exchange was rejected", {
        status: tokenResponse.status,
        error: tokens.error || "unknown",
        description: String(tokens.error_description || "").slice(0, 240),
      });
      return finish(request, "oauth-failed");
    }
    let refreshToken = tokens.refresh_token;
    if (!refreshToken) {
      const old = await env.DB.prepare("SELECT encrypted_refresh_token, token_iv FROM google_ads_connections WHERE owner_id = ?1").bind(data.ownerId).first<{ encrypted_refresh_token: string; token_iv: string }>();
      if (old) return finish(request, "already-connected");
      return finish(request, "refresh-token-missing");
    }
    const encrypted = await encryptRefreshToken(refreshToken);
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO google_ads_connections (id, owner_id, encrypted_refresh_token, token_iv, account_email, connected_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) ON CONFLICT(owner_id) DO UPDATE SET encrypted_refresh_token = excluded.encrypted_refresh_token, token_iv = excluded.token_iv, account_email = excluded.account_email, updated_at = excluded.updated_at")
      .bind(crypto.randomUUID(), data.ownerId, encrypted.ciphertext, encrypted.iv, "", now).run();
    return finish(request, "connected");
  } catch (error) {
    console.error("Google Ads OAuth callback failed", error instanceof Error ? error.message : "unknown");
    return finish(request, "oauth-failed");
  }
}
