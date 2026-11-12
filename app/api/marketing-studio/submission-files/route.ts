import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { marketingSubmissionFilePrefix, sanitizeMarketingSubmissionFilename } from "../../../../lib/marketing-submission-files";

export const dynamic = "force-dynamic";
type WorkspaceData = { ownerId?: string; staff?: Array<{ email?: string; role?: string }> };
type SavedFile = { id?: string; name?: string; mime?: string; size?: number };

async function ownerContext(user: { userId: string; email: string }) {
  if (!env.DB) return "";
  const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  let data: WorkspaceData;
  try { data = JSON.parse(row?.data || "null"); } catch { return ""; }
  const ownerId = String(data.ownerId || "");
  const allowed = ownerId === user.userId || data.staff?.some((person) => person.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(person.role || ""));
  return allowed ? ownerId : "";
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in to download this submission file." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (!env.DB || !env.BUCKET) return Response.json({ error: "Private file storage is unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const ownerId = await ownerContext(user);
  if (!ownerId) return Response.json({ error: "Only an agency owner or admin can view submission files." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const params = new URL(request.url).searchParams;
  const submissionId = params.get("submissionId") || "";
  const fileId = params.get("fileId") || "";
  if (!/^[\w-]{1,120}$/.test(submissionId) || !/^[\w-]{1,120}$/.test(fileId)) return Response.json({ error: "File not found." }, { status: 404 });
  const row = await env.DB.prepare("SELECT data FROM marketing_submissions WHERE owner_id = ?1 AND id = ?2").bind(ownerId, submissionId).first<{ data: string }>();
  if (!row) return Response.json({ error: "File not found." }, { status: 404 });
  let data: { files?: SavedFile[] };
  try { data = JSON.parse(row.data); } catch { return Response.json({ error: "File not found." }, { status: 404 }); }
  const file = data.files?.find((item) => item.id === fileId);
  const extensions: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
  const extension = file?.mime ? extensions[file.mime] : "";
  if (!file || !extension || !file.id) return Response.json({ error: "File not found." }, { status: 404 });
  const key = `${marketingSubmissionFilePrefix(ownerId, submissionId)}${file.id}.${extension}`;
  const object = await env.BUCKET.get(key);
  if (!object) return Response.json({ error: "File not found." }, { status: 404 });
  return new Response(object.body, { headers: {
    "Content-Type": file.mime!,
    "Content-Disposition": `attachment; filename="${sanitizeMarketingSubmissionFilename(file.name).replace(/"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(sanitizeMarketingSubmissionFilename(file.name))}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  } });
}
