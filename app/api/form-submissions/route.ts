import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { ensureFormSubmissionLog } from "@/lib/form-submission-log";

export const dynamic = "force-dynamic";
const reply = (error: string, status = 400) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

type Row = { id: string; client_id: string; source: string; form_key: string; form_name: string; page_url: string; page_path: string; name: string; email: string; phone: string; message: string; contact_id: string; created_at: string };

async function context() {
  const user = await getChatGPTUser();
  if (!user) return { response: reply("Sign in before opening form submissions.", 401) };
  if (!env.DB) return { response: reply("The private workspace database is unavailable.", 503) };
  // One indexed primary-key read of the workspace document: owner, admin check and client names.
  const row = await env.DB.prepare(`SELECT json_object('ownerId', owner_id,
      'clients', json(COALESCE((SELECT json_group_array(json_object('id', json_extract(value,'$.id'), 'name', json_extract(value,'$.name'))) FROM json_each(data,'$.clients')), '[]')),
      'staff', json(COALESCE((SELECT json_group_array(json_object('email', json_extract(value,'$.email'), 'role', json_extract(value,'$.role'), 'isBot', json_extract(value,'$.isBot'))) FROM json_each(data,'$.staff')), '[]'))) AS data
    FROM workspace_documents WHERE id = 'f2b-agency'`).first<{ data: string }>();
  if (!row?.data) return { response: reply("The agency workspace could not be found.", 503) };
  const workspace = JSON.parse(row.data) as { ownerId?: string; clients?: Array<{ id: string; name: string }>; staff?: Array<{ email?: string; role?: string; isBot?: boolean }> };
  const admin = workspace.ownerId === user.userId || workspace.staff?.some((person) => !person.isBot && person.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(person.role || ""));
  if (!admin) return { response: reply("Only an agency owner or admin can view form submissions.", 403) };
  return { db: env.DB, ownerId: String(workspace.ownerId || ""), clients: workspace.clients || [] };
}

const iso = (value: string | null) => { if (!value) return ""; const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toISOString(); };
const csvCell = (value: unknown) => { const text = String(value ?? ""); return /[",\n\r]/.test(text) || /^[=+\-@]/.test(text) ? `"${(/^[=+\-@]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"` : text; };

export async function GET(request: Request) {
  const ctx = await context();
  if ("response" in ctx) return ctx.response;
  const { db, ownerId, clients } = ctx;
  await ensureFormSubmissionLog(db);
  const url = new URL(request.url);
  const end = iso(url.searchParams.get("end")) || new Date().toISOString();
  const start = iso(url.searchParams.get("start")) || new Date(Date.parse(end) - 30 * 86_400_000).toISOString();
  if (start >= end) return reply("Choose a start date before the end date.");
  const clientParam = url.searchParams.get("clientId");
  const clientId = clientParam === null || clientParam === "all" ? null : clientParam === "agency" ? "" : clientParam.slice(0, 120);
  const form = (url.searchParams.get("form") || "").slice(0, 160);
  const pagePath = (url.searchParams.get("page") || "").slice(0, 300);
  const search = (url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 100);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

  // Every query is bounded by owner + created_at range (indexed); dimension filters run on that slice.
  const where = (skip: "client" | "form" | "page" | "", from = start, to = end) => {
    const parts = ["owner_id = ?", "created_at >= ?", "created_at < ?"]; const binds: unknown[] = [ownerId, from, to];
    if (clientId !== null && skip !== "client") { parts.push("client_id = ?"); binds.push(clientId); }
    if (form && skip !== "form") { parts.push("form_key = ?"); binds.push(form); }
    if (pagePath && skip !== "page") { parts.push("page_path = ?"); binds.push(pagePath); }
    if (search) { parts.push("(lower(name) LIKE ? OR email LIKE ? OR phone LIKE ? OR lower(message) LIKE ?)"); const like = `%${search.replace(/[%_]/g, "")}%`; binds.push(like, like, like, like); }
    return { sql: parts.join(" AND "), binds };
  };
  const all = where("");
  const clientName = new Map(clients.map((client) => [client.id, client.name]));
  const label = (id: string) => id ? clientName.get(id) || "Unknown client" : "F2B Media (agency)";

  if (url.searchParams.get("format") === "csv") {
    const result = await db.prepare(`SELECT * FROM form_submission_log WHERE ${all.sql} ORDER BY created_at DESC LIMIT 5000`).bind(...all.binds).all<Row>();
    const header = ["Submitted at", "Client", "Form", "Page", "Name", "Email", "Phone", "Message", "Source"];
    const lines = [header.join(","), ...(result.results || []).map((row) => [row.created_at, label(row.client_id), row.form_name, row.page_url || row.page_path, row.name, row.email, row.phone, row.message, row.source].map(csvCell).join(","))];
    return new Response(lines.join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="form-submissions-${start.slice(0, 10)}-to-${end.slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
  }

  const span = Date.parse(end) - Date.parse(start);
  const previous = where("", new Date(Date.parse(start) - span).toISOString(), start);
  const byClientW = where("client"), byFormW = where("form"), byPageW = where("page");
  const [rows, total, prev, byForm, byPage, byClient, daily] = await db.batch([
    db.prepare(`SELECT * FROM form_submission_log WHERE ${all.sql} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...all.binds, limit, offset),
    db.prepare(`SELECT COUNT(*) AS n FROM form_submission_log WHERE ${all.sql}`).bind(...all.binds),
    db.prepare(`SELECT COUNT(*) AS n FROM form_submission_log WHERE ${previous.sql}`).bind(...previous.binds),
    db.prepare(`SELECT form_key AS key, MAX(form_name) AS name, client_id, COUNT(*) AS n FROM form_submission_log WHERE ${byFormW.sql} GROUP BY form_key ORDER BY n DESC LIMIT 100`).bind(...byFormW.binds),
    db.prepare(`SELECT page_path AS path, MAX(page_url) AS url, COUNT(*) AS n FROM form_submission_log WHERE ${byPageW.sql} GROUP BY page_path ORDER BY n DESC LIMIT 100`).bind(...byPageW.binds),
    db.prepare(`SELECT client_id, COUNT(*) AS n FROM form_submission_log WHERE ${byClientW.sql} GROUP BY client_id ORDER BY n DESC LIMIT 200`).bind(...byClientW.binds),
    db.prepare(`SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM form_submission_log WHERE ${all.sql} GROUP BY day ORDER BY day`).bind(...all.binds),
  ]);
  type Count = { n: number };
  return Response.json({
    range: { start, end },
    total: (total.results?.[0] as Count | undefined)?.n || 0,
    previousTotal: (prev.results?.[0] as Count | undefined)?.n || 0,
    rows: ((rows.results || []) as Row[]).map((row) => ({ id: row.id, submittedAt: row.created_at, clientId: row.client_id, clientName: label(row.client_id), source: row.source, formKey: row.form_key, formName: row.form_name, pageUrl: row.page_url, pagePath: row.page_path, name: row.name, email: row.email, phone: row.phone, message: row.message, contactId: row.contact_id })),
    byForm: ((byForm.results || []) as Array<{ key: string; name: string; client_id: string; n: number }>).map((item) => ({ key: item.key, name: item.name, clientName: label(item.client_id), count: item.n })),
    byPage: ((byPage.results || []) as Array<{ path: string; url: string; n: number }>).map((item) => ({ path: item.path, url: item.url, count: item.n })),
    byClient: ((byClient.results || []) as Array<{ client_id: string; n: number }>).map((item) => ({ clientId: item.client_id || "agency", name: label(item.client_id), count: item.n })),
    daily: ((daily.results || []) as Array<{ day: string; n: number }>).map((item) => ({ day: item.day, count: item.n })),
  }, { headers: { "Cache-Control": "no-store" } });
}
