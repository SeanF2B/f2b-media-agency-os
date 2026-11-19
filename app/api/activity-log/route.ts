import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { authorizeAdmin, respond } from "@/lib/settings-auth";
import { ensureActivityTables, recordActive, recordLogin } from "@/lib/activity-log";
import { ensureActionLog } from "@/lib/action-log";

// Settings → Audit log (agency owner/admins): sign-ins, active time per person per day, and every phone call with
// talk time, unanswered and dropped calls. POST is the open app's once-a-minute activity heartbeat.
export const dynamic = "force-dynamic";
const okDate = (v: string | null, fb: string) => /^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v! : fb;
const UNANSWERED = ["no_answer", "busy", "voicemail"];

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user || !env.DB) return new Response(null, { status: 204 });
  let body: { seconds?: number; page?: string } = {};
  try { body = await request.json() as typeof body; } catch { /* sendBeacon text */ }
  // A heartbeat after 30+ minutes away also counts as a new sign-in (in case the app shell was served from cache).
  await recordLogin(env.DB, user.email, request).catch(() => undefined);
  await recordActive(env.DB, user.email, Number(body.seconds) || 0, String(body.page || "")).catch(() => undefined);
  return new Response(null, { status: 204 });
}

export async function GET(request: Request) {
  const auth = await authorizeAdmin("view the audit log");
  if (auth.error) return auth.error;
  const db = env.DB!;
  await ensureActivityTables(db);
  const url = new URL(request.url);
  const end = okDate(url.searchParams.get("end"), new Date().toISOString().slice(0, 10));
  const start = okDate(url.searchParams.get("start"), new Date(Date.parse(end) - 6 * 86_400_000).toISOString().slice(0, 10));
  const from = `${start}T00:00:00.000Z`, to = new Date(Date.parse(`${end}T00:00:00Z`) + 86_400_000).toISOString();
  const who = (url.searchParams.get("email") || "").toLowerCase();
  const ws = await db.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  let staff: Array<{ name: string; email: string; role: string }> = [];
  let clients: Array<{ id: string; name: string }> = [];
  try { const w = JSON.parse(ws?.data || "{}"); staff = (w.staff || []).filter((s: any) => !s.isBot && s.email).map((s: any) => ({ name: String(s.name || s.email), email: String(s.email).toLowerCase(), role: String(s.role || "") })); clients = (w.clients || []).map((c: any) => ({ id: String(c.id), name: String(c.name || "") })); } catch { /* empty */ }

  await ensureActionLog(db);
  const [logins, active, calls, actions, messages] = await Promise.all([
    db.prepare(`SELECT email, at, ip, country, city, device FROM staff_logins WHERE at >= ?1 AND at < ?2${who ? " AND email = ?3" : ""} ORDER BY at DESC LIMIT 500`).bind(from, to, ...(who ? [who] : [])).all<any>(),
    db.prepare(`SELECT email, day, seconds, first_at, last_at, pages FROM staff_active WHERE day >= ?1 AND day <= ?2${who ? " AND email = ?3" : ""} ORDER BY day DESC, seconds DESC`).bind(start, end, ...(who ? [who] : [])).all<any>(),
    db.prepare(`SELECT at, actor, actor_name, actor_type, client_id, area, action, target, detail, method, path, status, is_delete, ip FROM action_log WHERE at >= ?1 AND at < ?2${who ? " AND actor = ?3" : ""} ORDER BY at DESC LIMIT 1000`).bind(from, to, ...(who ? [who] : [])).all<any>(),
    db.prepare("SELECT m.created_at AS at, m.body, m.sender, t.channel, t.contact, t.contact_name, t.client_id, t.our_number FROM conv_messages m JOIN conv_threads t ON t.id = m.thread_id WHERE m.owner_id = ?1 AND m.direction = 'inbound' AND m.created_at >= ?2 AND m.created_at < ?3 ORDER BY m.created_at DESC LIMIT 500").bind(auth.ownerId, from, to).all<any>().catch(() => ({ results: [] as any[] })),
    db.prepare("SELECT id, client_id, direction, channel, trigger, contact_number, contact_name, purpose, status, outcome, summary, duration_sec, started_at, ended_at, error, recording_key, created_at FROM voice_calls WHERE owner_id = ?1 AND created_at >= ?2 AND created_at < ?3 ORDER BY created_at DESC LIMIT 500").bind(auth.ownerId, from, to).all<any>().catch(() => ({ results: [] as any[] })),
  ]);
  const callRows = (calls.results || []).map((c: any) => {
    const dur = Number(c.duration_sec) || 0;
    const state = UNANSWERED.includes(c.outcome) || c.status === "no-answer" ? "unanswered" : c.outcome === "failed" || c.status === "failed" ? "failed" : (c.status === "completed" && dur > 0 && dur < 15 && (!c.outcome || c.outcome === "other")) ? "dropped" : c.status === "cancelled" ? "cancelled" : ["queued", "dialing", "ringing", "live"].includes(c.status) ? "in progress" : "answered";
    return { id: c.id, clientId: c.client_id, client: clients.find((x) => x.id === c.client_id)?.name || "", direction: c.direction, channel: c.channel, trigger: c.trigger, number: c.contact_number, contact: c.contact_name, purpose: c.purpose, status: c.status, outcome: c.outcome, state, summary: String(c.summary || "").slice(0, 400), durationSec: dur, startedAt: c.started_at || c.created_at, endedAt: c.ended_at, error: c.error, hasRecording: Boolean(c.recording_key) };
  });
  const sum = (f: (c: typeof callRows[number]) => boolean) => callRows.filter(f).length;
  return respond({
    period: { start, end }, staff,
    logins: (logins.results || []).map((l: any) => ({ email: l.email, name: staff.find((s) => s.email === l.email)?.name || l.email, at: l.at, ip: l.ip, place: [l.city, l.country].filter(Boolean).join(", "), device: l.device })),
    active: (active.results || []).map((a: any) => ({ email: a.email, name: staff.find((s) => s.email === a.email)?.name || a.email, day: a.day, seconds: Number(a.seconds) || 0, firstAt: a.first_at, lastAt: a.last_at, pages: (() => { try { return JSON.parse(a.pages || "{}"); } catch { return {}; } })() })),
    calls: callRows,
    activity: (actions.results || []).map((a: any) => ({ at: a.at, actor: a.actor, name: a.actor_name || a.actor || "System", type: a.actor_type || "", client: clients.find((x) => x.id === a.client_id)?.name || "", area: a.area, action: a.action, target: a.target, detail: (() => { try { return JSON.parse(a.detail || "{}"); } catch { return {}; } })(), ok: Number(a.status) < 400, status: Number(a.status), isDelete: Boolean(a.is_delete), ip: a.ip })),
    messages: (messages.results || []).map((m: any) => ({ at: m.at, channel: m.channel, from: m.contact_name || m.contact, number: m.contact, client: clients.find((x) => x.id === m.client_id)?.name || "", preview: String(m.body || "").slice(0, 200) })),
    callSummary: { total: callRows.length, answered: sum((c) => c.state === "answered"), unanswered: sum((c) => c.state === "unanswered"), dropped: sum((c) => c.state === "dropped"), failed: sum((c) => c.state === "failed"), talkSeconds: callRows.reduce((t, c) => t + (c.state === "answered" || c.state === "dropped" ? c.durationSec : 0), 0), inbound: sum((c) => c.direction === "inbound"), outbound: sum((c) => c.direction === "outbound") },
  });
}
