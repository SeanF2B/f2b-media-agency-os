import { env } from "cloudflare:workers";
import { fileKeyFromPublicParam } from "../../../../lib/media-library/core";

export const dynamic = "force-dynamic";

// Public Media Library links (used on client websites, ads and emails). The file name is an unguessable random id,
// so no database read is needed — deleting a file from the library removes it from storage and the link stops working.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const key = fileKeyFromPublicParam(url.searchParams.get("f") || "");
  if (!key || !env.BUCKET) return new Response("Not found", { status: 404 });
  const rangeHeader = request.headers.get("range") || "";
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  let range: R2Range | undefined;
  if (match && (match[1] || match[2])) range = match[1] ? { offset: Number(match[1]), ...(match[2] ? { length: Number(match[2]) - Number(match[1]) + 1 } : {}) } : { suffix: Number(match[2]) };
  const object = await env.BUCKET.get(key, range ? { range } : undefined);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers({
    "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
    ETag: object.httpEtag,
  });
  const name = (url.searchParams.get("name") || key.split("/").pop() || "file").replace(/[^\w .()-]/g, "").slice(0, 120) || "file";
  if (url.searchParams.has("download")) headers.set("Content-Disposition", `attachment; filename="${name}"`);
  if (range && "range" in object && object.range) {
    const r = object.range as { offset?: number; length?: number; suffix?: number };
    const offset = r.suffix !== undefined ? object.size - r.suffix : r.offset || 0;
    const length = r.suffix !== undefined ? r.suffix : r.length ?? object.size - offset;
    headers.set("Content-Range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("Content-Length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers });
}
