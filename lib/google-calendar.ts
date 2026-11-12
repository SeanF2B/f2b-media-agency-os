import { env } from "cloudflare:workers";

function fromB64(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toB64(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function tokenKey() {
  const encoded = env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY;
  if (!encoded) throw new Error("Google Calendar secure token storage is not configured.");
  const bytes = fromB64(encoded);
  if (bytes.byteLength !== 32) throw new Error("Google Calendar token encryption key must be 32 bytes.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptCalendarRefreshToken(token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await tokenKey(), new TextEncoder().encode(token));
  return { iv: toB64(iv), ciphertext: toB64(new Uint8Array(ciphertext)) };
}

async function decryptCalendarRefreshToken(iv: string, ciphertext: string) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await tokenKey(), fromB64(ciphertext));
  return new TextDecoder().decode(plain);
}

export async function getGoogleCalendarAccessToken(ownerId: string) {
  if (!env.DB || !env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET) throw new Error("Google Calendar OAuth credentials are not configured.");
  const saved = await env.DB.prepare("SELECT encrypted_refresh_token, token_iv FROM google_calendar_connections WHERE owner_id = ?1").bind(ownerId).first<{ encrypted_refresh_token: string; token_iv: string }>();
  if (!saved) return null;
  const refreshToken = await decryptCalendarRefreshToken(saved.token_iv, saved.encrypted_refresh_token);
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.GOOGLE_ADS_CLIENT_ID, client_secret: env.GOOGLE_ADS_CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" }), signal: AbortSignal.timeout(15000) });
  const result = await response.json() as { access_token?: string; error?: string };
  if (!response.ok || !result.access_token) throw new Error(result.error === "invalid_grant" ? "Google Calendar access expired. Reconnect your calendar." : "Google Calendar could not refresh its access. Reconnect if this continues.");
  await env.DB.prepare("UPDATE google_calendar_connections SET updated_at = ?2 WHERE owner_id = ?1").bind(ownerId, new Date().toISOString()).run();
  return result.access_token;
}

export type CalendarTask = { id: string; title: string; clientId?: string; due?: string; service?: string; priority?: string; assigneeId?: string; dueAt?: string; status?: string };
export type CalendarWorkspace = { clients?: Array<{ id: string; name: string }>; staff?: Array<{ id: string; name: string }>; tasks?: CalendarTask[] };

function nextAllDayDate(due: string) {
  const [year, month, day] = due.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

export async function syncGoogleCalendarTasks(ownerId: string, workspace: CalendarWorkspace, taskIds: string[]) {
  if (!env.DB || !taskIds.length) return { synced: 0, removed: 0, connected: true };
  const accessToken = await getGoogleCalendarAccessToken(ownerId);
  if (!accessToken) return { synced: 0, removed: 0, connected: false };
  let synced = 0;
  let removed = 0;
  for (const taskId of [...new Set(taskIds)].slice(0, 100)) {
    const task = workspace.tasks?.find((item) => item.id === taskId);
    const saved = await env.DB.prepare("SELECT google_event_id FROM google_calendar_task_events WHERE owner_id = ?1 AND task_id = ?2").bind(ownerId, taskId).first<{ google_event_id: string }>();
    if (!task || !task.due) {
      if (saved) {
        const deleted = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(saved.google_event_id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000) });
        if (!deleted.ok && deleted.status !== 404 && deleted.status !== 410) throw new Error("Google Calendar could not remove a task event.");
        await env.DB.prepare("DELETE FROM google_calendar_task_events WHERE owner_id = ?1 AND task_id = ?2").bind(ownerId, taskId).run();
        removed++;
      }
      continue;
    }
    const clientName = workspace.clients?.find((client) => client.id === task.clientId)?.name || "Internal";
    const assigneeName = workspace.staff?.find((member) => member.id === task.assigneeId)?.name || "Unassigned";
    const description = [`Client: ${clientName}`, task.service ? `Service: ${task.service}` : "", `Assigned to: ${assigneeName}`, task.priority ? `Priority: ${task.priority}` : "", "Managed by F2B Agency OS"].filter(Boolean).join("\n");
    const event = { summary: `${task.priority === "Urgent" ? "🚨 " : ""}${task.title}`, description, start: { date: task.due }, end: { date: nextAllDayDate(task.due) } };
    let response: Response | undefined;
    if (saved) {
      response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(saved.google_event_id)}`, { method: "PATCH", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(event), signal: AbortSignal.timeout(15000) });
      if (response.status === 404 || response.status === 410) saved.google_event_id = "";
    }
    if (!saved || !saved.google_event_id) {
      response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify(event), signal: AbortSignal.timeout(15000) });
    }
    if (!response) throw new Error("Google Calendar could not prepare the task event.");
    const createdOrUpdated = await response.json() as { id?: string; error?: { message?: string } };
    if (!response.ok || !createdOrUpdated.id) throw new Error(createdOrUpdated.error?.message || "Google Calendar could not save this task event.");
    await env.DB.prepare("INSERT INTO google_calendar_task_events (owner_id, task_id, google_event_id, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(owner_id, task_id) DO UPDATE SET google_event_id = excluded.google_event_id, updated_at = excluded.updated_at").bind(ownerId, taskId, createdOrUpdated.id, new Date().toISOString()).run();
    synced++;
  }
  return { synced, removed, connected: true };
}
