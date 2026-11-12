import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { detectMarketingImageType, isMarketingImageKey, MARKETING_IMAGE_MAX_BYTES, marketingImageOwnerPrefix, uploadedMarketingImageUrl } from "../../../../lib/marketing-assets";

export const dynamic = "force-dynamic";
type WorkspaceData = { ownerId?: string; staff?: Array<{ email?: string; role?: string }> };

async function ownerContext(user: { userId: string; email: string }) {
  if (!env.DB) return null;
  const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!row?.data) return null;
  let data: WorkspaceData;
  try { data = JSON.parse(row.data); } catch { return null; }
  const ownerId = String(data.ownerId || "");
  const allowed = ownerId === user.userId || data.staff?.some((member) => member.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(member.role || ""));
  return allowed && ownerId ? ownerId : null;
}

function responseError(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return responseError("Sign in before uploading an image.", 401);
  if (!env.DB || !env.BUCKET) return responseError("Image storage is not configured on this deployment.", 503);
  const ownerId = await ownerContext(user);
  if (!ownerId) return responseError("Only an agency owner or admin can upload builder images.", 403);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MARKETING_IMAGE_MAX_BYTES + 20_000) return responseError("Images must be 1 MB or smaller.", 413);
  let form: FormData;
  try { form = await request.formData(); } catch { return responseError("Choose a PNG, JPEG or WebP image.", 400); }
  const file = form.get("image");
  if (!(file instanceof File)) return responseError("Choose a PNG, JPEG or WebP image.", 400);
  if (file.size < 1 || file.size > MARKETING_IMAGE_MAX_BYTES) return responseError("Images must be between 1 byte and 1 MB.", 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectMarketingImageType(bytes);
  if (!type) return responseError("The file contents are not a supported PNG, JPEG or WebP image.", 415);
  const key = `${await marketingImageOwnerPrefix(ownerId)}${crypto.randomUUID()}.${type.ext}`;
  await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: type.mime, cacheControl: "private, max-age=300" } });
  const imageUrl = uploadedMarketingImageUrl(key);
  return Response.json({ imageUrl, key, contentType: type.mime, size: file.size }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return responseError("Sign in to view this builder image.", 401);
  if (!env.DB || !env.BUCKET) return responseError("Image storage is not configured on this deployment.", 503);
  const ownerId = await ownerContext(user);
  if (!ownerId) return responseError("Only an agency owner or admin can view builder images.", 403);
  const key = new URL(request.url).searchParams.get("image") || "";
  if (!key.startsWith(await marketingImageOwnerPrefix(ownerId)) || !isMarketingImageKey(key)) return responseError("Image not found.", 404);
  const object = await env.BUCKET.get(key);
  if (!object) return responseError("Image not found.", 404);
  return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || "application/octet-stream", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox" } });
}
