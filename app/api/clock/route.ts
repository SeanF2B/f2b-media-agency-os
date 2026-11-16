// Clock in / out for every team member (not just admins). Each person can only clock themselves.
// Edits the workspace JSON in place with SQLite JSON functions (no full-document parse), and saves each
// finished shift as a time entry (taskId "clock") so it shows in Timesheets and feeds hourly payslips.
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { loadSchedulingWorkspace } from "@/lib/scheduling/context";

export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Sign in to clock in." }, 401);
  if (!env.DB) return json({ error: "The workspace database is unavailable." }, 503);
  const ws = await loadSchedulingWorkspace();
  if (!ws) return json({ error: "The workspace could not be found." }, 503);
  const me = ws.staffRaw.find((s) => String(s.email || "").toLowerCase() === user.email.toLowerCase()) || (ws.ownerId === user.userId ? ws.staffRaw.find((s) => s.id === user.userId) : undefined);
  if (!me?.id || !/^[A-Za-z0-9_.:@-]{1,120}$/.test(me.id)) return json({ error: "Your account isn't on the team yet." }, 403);
  const body = await request.json().catch(() => ({})) as { action?: string; clientId?: string };
  const path = `$."${me.id}"`;
  const db = env.DB;
  const row = await db.prepare("SELECT json_extract(COALESCE(json_extract(data, '$.clockIns'), '{}'), ?1) AS started FROM workspace_documents WHERE id = 'f2b-agency'").bind(path).first<{ started: string | null }>();
  const started = row?.started || "";
  const now = new Date();
  if (body.action === "in" || (!body.action && !started)) {
    if (started) return json({ clockedInAt: started });
    const at = now.toISOString();
    await db.prepare("UPDATE workspace_documents SET data = json_set(data, '$.clockIns', json_set(COALESCE(json_extract(data, '$.clockIns'), '{}'), ?1, ?2)), updated_at = ?3 WHERE id = 'f2b-agency'").bind(path, at, `workspace-${crypto.randomUUID()}`).run();
    return json({ clockedInAt: at });
  }
  if (!started) return json({ clockedInAt: "" });
  const startMs = Date.parse(started);
  const seconds = Math.max(60, Math.min(24 * 3600, Math.round((now.getTime() - (Number.isFinite(startMs) ? startMs : now.getTime())) / 1000)));
  const clientId = typeof body.clientId === "string" && ws.clients.some((c) => c.id === body.clientId) ? body.clientId : "";
  const entry = { id: `clock-${me.id}-${Number.isFinite(startMs) ? startMs : now.getTime()}`, taskId: "clock", clientId, staffId: me.id, startAt: started, endAt: now.toISOString(), seconds, note: "Clocked in", billable: false };
  await db.prepare("UPDATE workspace_documents SET data = json_set(json_set(data, '$.clockIns', json_remove(COALESCE(json_extract(data, '$.clockIns'), '{}'), ?1)), '$.entries', json_insert(COALESCE(json_extract(data, '$.entries'), '[]'), '$[#]', json(?2))), updated_at = ?3 WHERE id = 'f2b-agency'").bind(path, JSON.stringify(entry), `workspace-${crypto.randomUUID()}`).run();
  return json({ clockedInAt: "", entry });
}
