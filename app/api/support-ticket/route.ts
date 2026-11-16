import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { readConnectToken } from "@/lib/client-connect";

// Support tickets: a client (signed in, or through their login-free client link) raises a ticket and it lands
// in the agency's Tasks for that client, marked as a support ticket, with an activity entry so the team sees it.
export const dynamic = "force-dynamic";
const respond = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const clean = (v: unknown, n: number) => String(v ?? "").replace(/\s+\n/g, "\n").trim().slice(0, n);

export async function POST(request: Request) {
  if (!env.DB) return respond({ error: "The workspace is unavailable." }, 503);
  let body: { clientId?: string; token?: string; subject?: string; details?: string; priority?: string; name?: string; contact?: string };
  const isForm = (request.headers.get("content-type") || "").includes("form");
  try { body = isForm ? Object.fromEntries((await request.formData()).entries()) as typeof body : await request.json() as typeof body; } catch { return respond({ error: "Send the ticket details." }, 400); }
  const subject = clean(body.subject, 140), details = clean(body.details, 3000);
  if (subject.length < 3) return respond({ error: "Give the ticket a short subject." }, 400);
  const priority = ["Normal", "High", "Urgent"].includes(String(body.priority)) ? String(body.priority) : "Normal";
  // Who is asking: a signed-in workspace user, or a client using their signed link.
  let clientId = clean(body.clientId, 100), requester = "";
  const secret = String((env as unknown as Record<string, string>).GOOGLE_ADS_TOKEN_ENCRYPTION_KEY || "");
  if (body.token) { clientId = secret ? await readConnectToken(secret, String(body.token)) : ""; if (!clientId) return respond({ error: "This link isn’t valid any more. Ask your agency for a new one." }, 403); requester = clean(body.name, 80) || "Client"; }
  else { const user = await getChatGPTUser(); if (!user) return respond({ error: "Sign in first." }, 401); requester = user.fullName || user.displayName || user.email; }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await env.DB.prepare("SELECT data, updated_at FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string; updated_at: string }>();
    if (!row) return respond({ error: "The workspace is unavailable." }, 503);
    const data = JSON.parse(row.data) as { clients?: Array<{ id: string; name: string }>; tasks?: unknown[]; activity?: unknown[] };
    const client = (data.clients || []).find((item) => item.id === clientId);
    if (clientId && !client) return respond({ error: "Choose a client for this ticket." }, 400);
    const now = new Date().toISOString();
    const number = `T-${String(((data.tasks || []) as Array<{ ticketNumber?: string }>).filter((task) => task.ticketNumber).length + 1).padStart(4, "0")}`;
    const task = { id: crypto.randomUUID(), clientId, projectId: "", title: `🎫 ${subject}`, assigneeId: "", status: "To do", priority, service: "Support", estimate: 0.5, due: now.slice(0, 10), createdAt: now, notes: [`Support ticket ${number} from ${requester}${client ? ` (${client.name})` : ""}.`, body.contact ? `Contact: ${clean(body.contact, 120)}` : "", "", details].filter((line, index) => line || index === 2).join("\n"), checklist: [{ id: crypto.randomUUID(), text: "Reply to the client", done: false }, { id: crypto.randomUUID(), text: "Resolve and confirm with the client", done: false }], ticketNumber: number, ticketFrom: requester, ticketSource: body.token ? "client-link" : "in-app" };
    const activity = { id: crypto.randomUUID(), title: `Support ticket ${number}`, detail: `${requester}${client ? ` · ${client.name}` : ""}: ${subject}`, icon: "🎫", at: now, actor: requester, clientId, taskId: task.id };
    const next = { ...data, tasks: [task, ...(data.tasks || [])], activity: [activity, ...(data.activity || [])].slice(0, 300) };
    const saved = await env.DB.prepare("UPDATE workspace_documents SET data = ?1, updated_at = ?2 WHERE id = ?3 AND updated_at = ?4").bind(JSON.stringify(next), `ticket-${crypto.randomUUID()}`, "f2b-agency", row.updated_at).run();
    if (saved.meta?.changes) {
      return respond({ ok: true, number, taskId: task.id });
    }
  }
  return respond({ error: "Couldn’t save the ticket just now. Try again." }, 409);
}
