import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

// Photos customers attach to website quote forms, shown in the lead email and the CRM note.
// Only keys of the form site-leads/<client uuid>/<random uuid>.<ext> are served; the random id is unguessable.
const KEY_RE = /^site-leads\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;
export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!KEY_RE.test(key) || !env.BUCKET) return new Response("Not found", { status: 404 });
  const object = await env.BUCKET.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || "image/jpeg", "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex", "Content-Security-Policy": "default-src 'none'; sandbox" } });
}
