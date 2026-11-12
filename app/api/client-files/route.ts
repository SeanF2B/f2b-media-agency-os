import { getChatGPTUser } from "../../chatgpt-auth";
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

type Staff = { email: string; role: string };
type StoredFile = { id: string; clientId: string; name: string; type: string; size: number; uploadedAt: string; key?: string };

async function workspace() {
  if (!env.DB) return null;
  const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string }>();
  return row?.data ? JSON.parse(row.data) : null;
}

function canManage(data: any, user: { userId: string; email: string }) {
  return data?.ownerId === user.userId || data?.staff?.some((member: Staff) => member.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(member.role));
}

function safeName(name: string) {
  return name.replace(/[\\/";\0-\x1f\x7f]/g, "_").replace(/[^\x20-\x7e]/g, "_").slice(0, 180) || "client-file";
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in to upload a client file." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "Private file storage is not connected yet." }, { status: 503 });
  try {
    const data = await workspace();
    if (!data || !canManage(data, user)) return Response.json({ error: "Only an owner or admin can manage client files." }, { status: 403 });
    const form = await request.formData();
    const clientId = String(form.get("clientId") || "");
    const file = form.get("file");
    if (!data.clients?.some((client: { id: string }) => client.id === clientId)) return Response.json({ error: "Choose a client first." }, { status: 400 });
    if (!(file instanceof File) || !file.size) return Response.json({ error: "Choose a file to upload." }, { status: 400 });
    if (file.size > 20 * 1024 * 1024) return Response.json({ error: "Each file must be 20 MB or smaller." }, { status: 413 });
    const allowed = new Set(["application/pdf", "text/plain", "text/csv", "application/json", "application/zip", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint", "image/jpeg", "image/png", "image/webp"]);
    if (!allowed.has(file.type)) return Response.json({ error: "Use a PDF, image, text, CSV, Office or ZIP file." }, { status: 415 });
    const id = crypto.randomUUID();
    const key = env.BUCKET ? `client-files/${clientId}/${id}` : "";
    const item: StoredFile = { id, clientId, name: safeName(file.name), type: file.type || "application/octet-stream", size: file.size, uploadedAt: new Date().toISOString(), ...(key ? { key } : {}) };
    if (env.BUCKET && key) await env.BUCKET.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: item.type, cacheControl: "private, no-store" } });
    else {
      if (file.size > 1024 * 1024) return Response.json({ error: "Larger file storage is unavailable. Try a file under 1 MB or contact your workspace admin." }, { status: 503 });
      await env.DB.prepare("INSERT INTO workspace_files (id, client_id, name, content_type, size, uploaded_at, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
        .bind(id, clientId, item.name, item.type, file.size, item.uploadedAt, await file.arrayBuffer()).run();
    }
    const nextFiles = [...(data.files || []), item];
    // File uploads update a workspace snapshot too. Keep the current chess
    // matches from the database in the same atomic write.
    await env.DB.prepare("UPDATE workspace_documents SET data = json_set(?1, '$.chessGames', json(COALESCE(json_extract(data, '$.chessGames'), '[]'))), updated_at = ?2 WHERE id = ?3").bind(JSON.stringify({ ...data, files: nextFiles }), `client-files-${crypto.randomUUID()}`, "f2b-agency").run();
    return Response.json({ file: item }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not upload the client file." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in to open a client file." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "Private file storage is not connected yet." }, { status: 503 });
  try {
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!id) return Response.json({ error: "Choose a client file to open." }, { status: 400 });
    // Retrieve only the requested file plus the small access-control fields.
    const row = await env.DB.prepare(`SELECT json_extract(data, '$.ownerId') AS owner_id, json_extract(data, '$.staff') AS staff_json, (SELECT value FROM json_each(workspace_documents.data, '$.files') WHERE json_extract(value, '$.id') = ?2 LIMIT 1) AS file_json FROM workspace_documents WHERE id = ?1`)
      .bind("f2b-agency", id).first<{ owner_id: string | null; staff_json: string | null; file_json: string | null }>();
    if (!row) return Response.json({ error: "The workspace could not be loaded." }, { status: 503 });
    const accessData = { ownerId: row.owner_id, staff: row.staff_json ? JSON.parse(row.staff_json) : [] };
    if (!canManage(accessData, user)) return Response.json({ error: "Only an owner or admin can open client files." }, { status: 403 });
    if (!row.file_json) return Response.json({ error: "That client file was not found." }, { status: 404 });
    const item = JSON.parse(row.file_json) as StoredFile;
    const object = item.key && env.BUCKET ? await env.BUCKET.get(item.key) : null;
    const params = new URL(request.url).searchParams;
    const inline = params.get("preview") === "1" && (item.type === "application/pdf" || item.type.startsWith("image/") || item.type.startsWith("text/") || item.type === "application/json");
    const disposition = `${inline ? "inline" : "attachment"}; filename="${safeName(item.name)}"`;
    if (item.key && object) return new Response(object.body, { headers: { "Content-Type": item.type || "application/octet-stream", "Content-Disposition": disposition, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    if (item.key && !object) return Response.json({ error: "The stored file is missing." }, { status: 404 });
    const legacyObject = await env.DB.prepare("SELECT data FROM workspace_files WHERE id = ?1 AND client_id = ?2").bind(item.id, item.clientId).first<{ data: ArrayBuffer | number[] }>();
    if (!legacyObject) return Response.json({ error: "The stored file is missing." }, { status: 404 });
    // D1 reads BLOB values back as arrays of bytes; converting them keeps legacy files intact.
    const legacyBytes = legacyObject.data instanceof ArrayBuffer ? legacyObject.data : new Uint8Array(legacyObject.data);
    return new Response(legacyBytes, { headers: { "Content-Type": item.type || "application/octet-stream", "Content-Disposition": disposition, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not open the client file." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in before removing a client file." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "Private file storage is not connected yet." }, { status: 503 });
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!id) return Response.json({ error: "Choose a client file to remove." }, { status: 400 });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const row = await env.DB.prepare("SELECT data, updated_at FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string; updated_at: string }>();
    if (!row?.data) return Response.json({ error: "The workspace could not be loaded." }, { status: 503 });
    let data: any;
    try { data = JSON.parse(row.data); } catch { return Response.json({ error: "The workspace data could not be read." }, { status: 500 }); }
    if (!canManage(data, user)) return Response.json({ error: "Only an owner or admin can remove client files." }, { status: 403 });
    const file = (data.files || []).find((item: StoredFile) => item.id === id) as StoredFile | undefined;
    if (!file) return Response.json({ error: "That client file was not found." }, { status: 404 });
    const next = { ...data, files: data.files.filter((item: StoredFile) => item.id !== id) };
    const saved = await env.DB.prepare("UPDATE workspace_documents SET data = json_set(?1, '$.chessGames', json(COALESCE(json_extract(data, '$.chessGames'), '[]'))), updated_at = ?2 WHERE id = ?3 AND updated_at = ?4")
      .bind(JSON.stringify(next), `client-file-delete-${crypto.randomUUID()}`, "f2b-agency", row.updated_at).run();
    if (saved.meta.changes !== 1) continue;
    if (file.key && env.BUCKET) await env.BUCKET.delete(file.key).catch(() => undefined);
    else await env.DB.prepare("DELETE FROM workspace_files WHERE id = ?1 AND client_id = ?2").bind(file.id, file.clientId).run().catch(() => undefined);
    return Response.json({ removedId: id }, { headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ error: "The workspace changed while the file was being removed. Refresh and try again." }, { status: 409 });
}
