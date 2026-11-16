import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { ensureSystemEmailsTable } from "@/lib/email-log";

// Operations → Email → System emails: every email the OS sends by itself (chess invites, team invites,
// invoices, booking confirmations, task notifications, campaign sends…). Owner/Admin only.
// One indexed read of up to 100 rows per page.
export const dynamic = "force-dynamic";
const respond = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return respond({ error: "Sign in first." }, 401);
  if (!env.DB) return respond({ error: "The workspace database is unavailable." }, 503);
  const row = await env.DB.prepare("SELECT owner_id, data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ owner_id: string; data: string }>();
  if (!row) return respond({ error: "The workspace is unavailable." }, 503);
  const data = JSON.parse(row.data) as { ownerId?: string; staff?: Array<{ id?: string; email?: string; role?: string; isBot?: boolean }>; clients?: Array<{ id: string; name: string }> };
  const admin = data.ownerId === user.userId || row.owner_id === user.userId || (data.staff || []).some((item) => !item.isBot && (item.id === user.userId || item.email?.toLowerCase() === user.email.toLowerCase()) && ["Owner", "Admin"].includes(item.role || ""));
  if (!admin) return respond({ error: "Only an owner or admin can see system emails." }, 403);
  await ensureSystemEmailsTable(env.DB as never);
  const url = new URL(request.url);
  const kind = (url.searchParams.get("kind") || "").slice(0, 40);
  const q = (url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 100);
  const before = (url.searchParams.get("before") || "").slice(0, 40) || "9999";
  const params: unknown[] = [row.owner_id, before];
  let sql = "SELECT id, client_id, kind, to_email, to_name, subject, body, created_at FROM system_emails WHERE owner_id=?1 AND created_at<?2";
  if (kind) { params.push(kind); sql += ` AND kind=?${params.length}`; }
  if (q) { params.push(`%${q}%`); sql += ` AND (lower(subject) LIKE ?${params.length} OR to_email LIKE ?${params.length} OR lower(to_name) LIKE ?${params.length})`; }
  sql += " ORDER BY created_at DESC LIMIT 100";
  const rows = (await env.DB.prepare(sql).bind(...params).all<{ id: string; client_id: string; kind: string; to_email: string; to_name: string; subject: string; body: string; created_at: string }>()).results || [];
  const clientName = (id: string) => (data.clients || []).find((c) => c.id === id)?.name || "";
  return respond({
    emails: rows.map((r) => ({ id: r.id, clientId: r.client_id, clientName: clientName(r.client_id), kind: r.kind, to: r.to_email, toName: r.to_name, subject: r.subject, body: r.body, createdAt: r.created_at })),
    next: rows.length === 100 ? rows[rows.length - 1].created_at : null,
  });
}
