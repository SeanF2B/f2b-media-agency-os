import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getTeamPermissions, type TeamPermissions } from "@/lib/access-permissions";

export const dynamic = "force-dynamic";

type Staff = { id: string; email: string; role: string; isBot?: boolean; permissions?: Partial<TeamPermissions>; clientAccessIds?: string[] };
type TaskAttachment = { id: string; name: string; type: string; size: number; uploadedAt: string; uploadedBy: string; storageKey?: string };
type TaskRecord = { id: string; clientId?: string; assigneeId?: string; reviewApproverId?: string; attachments?: TaskAttachment[] };

function safeName(name: string) {
  return name.replace(/[\\/";\0-\x1f\x7f]/g, "_").replace(/[^\x20-\x7e]/g, "_").slice(0, 180) || "task-file";
}

function canAccessTask(data: any, user: { userId: string; email: string }, task: TaskRecord) {
  const manager = data?.ownerId === user.userId || data?.staff?.some((member: Staff) => !member.isBot && member.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(member.role));
  if (manager) return true;
  const profile = data?.staff?.find((member: Staff) => !member.isBot && (member.id === user.userId || member.email?.toLowerCase() === user.email.toLowerCase())) as Staff | undefined;
  if (!profile) return false;
  const permissions = getTeamPermissions(profile.role, profile.permissions);
  if (!permissions.tasks || (!permissions.allTasks && task.assigneeId !== profile.id && task.reviewApproverId !== profile.id)) return false;
  return !task.clientId || !Array.isArray(profile.clientAccessIds) || profile.clientAccessIds.includes(task.clientId);
}

async function readWorkspace() {
  if (!env.DB) return null;
  const row = await env.DB.prepare("SELECT data, updated_at FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string; updated_at: string }>();
  return row?.data ? { data: JSON.parse(row.data), updatedAt: row.updated_at } : null;
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in before attaching a task document." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "Private file storage is not connected yet." }, { status: 503 });

  let fileId = "";
  let clientId = "";
  let storageKey = "";
  try {
    const form = await request.formData();
    const taskId = String(form.get("taskId") || "").trim().slice(0, 128);
    const file = form.get("file");
    if (!taskId) return Response.json({ error: "Choose a task first." }, { status: 400 });
    if (!(file instanceof File) || !file.size) return Response.json({ error: "Choose a document to attach." }, { status: 400 });
    if (file.size > 20 * 1024 * 1024) return Response.json({ error: "Each document must be 20 MB or smaller." }, { status: 413 });
    const allowed = new Set(["application/pdf", "text/plain", "text/csv", "application/json", "application/zip", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint", "image/jpeg", "image/png", "image/webp"]);
    if (!allowed.has(file.type)) return Response.json({ error: "Use a PDF, Word, Excel, PowerPoint, image, text, CSV, JSON or ZIP file." }, { status: 415 });

    const initial = await readWorkspace();
    if (!initial) return Response.json({ error: "The workspace could not be loaded." }, { status: 503 });
    const initialTask = (initial.data.tasks || []).find((task: TaskRecord) => task.id === taskId) as TaskRecord | undefined;
    if (!initialTask || !canAccessTask(initial.data, user, initialTask)) return Response.json({ error: "You do not have access to attach files to this task." }, { status: 403 });
    clientId = initialTask.clientId || "";
    fileId = crypto.randomUUID();
    storageKey = env.BUCKET ? `task-attachments/${taskId}/${fileId}` : "";
    const item: TaskAttachment = { id: fileId, name: safeName(file.name), type: file.type || "application/octet-stream", size: file.size, uploadedAt: new Date().toISOString(), uploadedBy: user.displayName || user.email, ...(storageKey ? { storageKey } : {}) };
    if (env.BUCKET) {
      await env.BUCKET.put(storageKey, await file.arrayBuffer(), { httpMetadata: { contentType: item.type, cacheControl: "private, no-store" } });
    } else {
      if (file.size > 1024 * 1024) return Response.json({ error: "Larger document storage is unavailable. Try a file under 1 MB or contact your workspace admin." }, { status: 503 });
      await env.DB.prepare("INSERT INTO workspace_files (id, client_id, name, content_type, size, uploaded_at, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
        .bind(fileId, clientId, item.name, item.type, item.size, item.uploadedAt, await file.arrayBuffer()).run();
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = await readWorkspace();
      if (!current) break;
      const task = (current.data.tasks || []).find((candidate: TaskRecord) => candidate.id === taskId) as TaskRecord | undefined;
      if (!task || !canAccessTask(current.data, user, task)) {
        if (env.BUCKET) await env.BUCKET.delete(storageKey).catch(() => undefined);
        else await env.DB.prepare("DELETE FROM workspace_files WHERE id = ?1 AND client_id = ?2").bind(fileId, clientId).run();
        fileId = "";
        storageKey = "";
        return Response.json({ error: "You no longer have access to this task." }, { status: 403 });
      }
      const nextTask = { ...task, attachments: [...(task.attachments || []).filter((attachment) => attachment.id !== fileId), item] };
      const next = { ...current.data, tasks: current.data.tasks.map((candidate: TaskRecord) => candidate.id === taskId ? nextTask : candidate) };
      const saved = await env.DB.prepare("UPDATE workspace_documents SET data = ?1, updated_at = ?2 WHERE id = ?3 AND updated_at = ?4")
        .bind(JSON.stringify(next), `task-file-${crypto.randomUUID()}`, "f2b-agency", current.updatedAt).run();
      if (saved.meta.changes === 1) return Response.json({ attachment: item }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }

    if (fileId) {
      if (env.BUCKET) await env.BUCKET.delete(storageKey).catch(() => undefined);
      else await env.DB.prepare("DELETE FROM workspace_files WHERE id = ?1 AND client_id = ?2").bind(fileId, clientId).run();
    }
    return Response.json({ error: "The task changed while the document was uploading. Please try again." }, { status: 409 });
  } catch (error) {
    if (fileId) {
      if (storageKey && env.BUCKET) await env.BUCKET.delete(storageKey).catch(() => undefined);
      else if (env.DB) await env.DB.prepare("DELETE FROM workspace_files WHERE id = ?1 AND client_id = ?2").bind(fileId, clientId).run().catch(() => undefined);
    }
    return Response.json({ error: error instanceof Error ? error.message : "Could not attach the task document." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in before opening a task document." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "Private file storage is not connected yet." }, { status: 503 });
  try {
    const params = new URL(request.url).searchParams;
    const taskId = String(params.get("taskId") || "").trim().slice(0, 128);
    const id = String(params.get("id") || "").trim().slice(0, 128);
    if (!taskId || !id) return Response.json({ error: "Choose a task document to open." }, { status: 400 });
    // Look up only the single task needed for access and attachment checks.
    // Parsing the full workspace JSON here can exceed the Worker memory budget.
    const row = await env.DB.prepare(`SELECT json_extract(data, '$.ownerId') AS owner_id, json_extract(data, '$.staff') AS staff_json, (SELECT value FROM json_each(workspace_documents.data, '$.tasks') WHERE json_extract(value, '$.id') = ?2 LIMIT 1) AS task_json FROM workspace_documents WHERE id = ?1`)
      .bind("f2b-agency", taskId).first<{ owner_id: string | null; staff_json: string | null; task_json: string | null }>();
    if (!row) return Response.json({ error: "The workspace could not be loaded." }, { status: 503 });
    if (!row.task_json) return Response.json({ error: "That task document was not found." }, { status: 404 });
    const task = JSON.parse(row.task_json) as TaskRecord;
    const staff = row.staff_json ? JSON.parse(row.staff_json) : [];
    const accessData = { ownerId: row.owner_id, staff };
    const attachment = (task.attachments || []).find((item) => item.id === id);
    if (!attachment || !canAccessTask(accessData, user, task)) return Response.json({ error: "That task document was not found." }, { status: 404 });
    const object = attachment.storageKey && env.BUCKET ? await env.BUCKET.get(attachment.storageKey) : null;
    const inline = params.get("preview") === "1" && (attachment.type === "application/pdf" || attachment.type.startsWith("image/") || attachment.type.startsWith("text/") || attachment.type === "application/json");
    const disposition = `${inline ? "inline" : "attachment"}; filename="${safeName(attachment.name)}"`;
    if (attachment.storageKey && object) return new Response(object.body, { headers: { "Content-Type": attachment.type || "application/octet-stream", "Content-Disposition": disposition, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    if (attachment.storageKey && !object) return Response.json({ error: "The stored document is missing." }, { status: 404 });
    const legacyObject = await env.DB.prepare("SELECT data FROM workspace_files WHERE id = ?1 AND client_id = ?2").bind(id, task.clientId || "").first<{ data: ArrayBuffer | number[] }>();
    if (!legacyObject) return Response.json({ error: "The stored document is missing." }, { status: 404 });
    // D1 reads BLOB values back as arrays of bytes; converting them keeps legacy files intact.
    const legacyBytes = legacyObject.data instanceof ArrayBuffer ? legacyObject.data : new Uint8Array(legacyObject.data);
    return new Response(legacyBytes, { headers: { "Content-Type": attachment.type || "application/octet-stream", "Content-Disposition": disposition, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not open the task document." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in before removing a task document." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "Private file storage is not connected yet." }, { status: 503 });
  const params = new URL(request.url).searchParams;
  const taskId = String(params.get("taskId") || "").trim().slice(0, 128);
  const id = String(params.get("id") || "").trim().slice(0, 128);
  if (!taskId || !id) return Response.json({ error: "Choose a task document to remove." }, { status: 400 });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const row = await env.DB.prepare("SELECT data, updated_at FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string; updated_at: string }>();
    if (!row?.data) return Response.json({ error: "The workspace could not be loaded." }, { status: 503 });
    let data: any;
    try { data = JSON.parse(row.data); } catch { return Response.json({ error: "The workspace data could not be read." }, { status: 500 }); }
    const manager = data.ownerId === user.userId || data.staff?.some((member: Staff) => !member.isBot && member.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(member.role));
    if (!manager) return Response.json({ error: "Only an owner or admin can remove task documents." }, { status: 403 });
    const task = (data.tasks || []).find((item: TaskRecord) => item.id === taskId) as TaskRecord | undefined;
    const attachment = task?.attachments?.find((item) => item.id === id);
    if (!task || !attachment) return Response.json({ error: "That task document was not found." }, { status: 404 });
    const nextTask = { ...task, attachments: task.attachments!.filter((item) => item.id !== id) };
    const next = { ...data, tasks: data.tasks.map((item: TaskRecord) => item.id === taskId ? nextTask : item) };
    const saved = await env.DB.prepare("UPDATE workspace_documents SET data = ?1, updated_at = ?2 WHERE id = ?3 AND updated_at = ?4")
      .bind(JSON.stringify(next), `task-file-delete-${crypto.randomUUID()}`, "f2b-agency", row.updated_at).run();
    if (saved.meta.changes !== 1) continue;
    if (attachment.storageKey && env.BUCKET) await env.BUCKET.delete(attachment.storageKey).catch(() => undefined);
    else await env.DB.prepare("DELETE FROM workspace_files WHERE id = ?1 AND client_id = ?2").bind(id, task.clientId || "").run().catch(() => undefined);
    return Response.json({ removedId: id }, { headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ error: "The task changed while the document was being removed. Refresh and try again." }, { status: 409 });
}
