import { db, ensureOutreachSchema, nowIso } from "@/lib/outreach/server/store";
import { verifyUnsubscribe } from "@/lib/outreach/server/unsubscribe";

export const dynamic = "force-dynamic";

const page = (title: string, text: string, form = "") => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:520px;margin:12vh auto;padding:0 20px;color:#1f2328}button{font:inherit;padding:10px 18px;border-radius:10px;border:0;background:#1f2328;color:#fff;cursor:pointer}</style></head><body><h1>${title}</h1><p>${text}</p>${form}</body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

async function unsubscribe(token: string) {
  const data = await verifyUnsubscribe(token);
  if (!data) return false;
  await ensureOutreachSchema();
  const database = db();
  const now = nowIso();
  await database.batch([
    database.prepare("INSERT INTO outreach_suppressions (owner_id, value, reason, source, created_at) VALUES (?1, ?2, 'unsubscribe', 'one-click', ?3) ON CONFLICT(owner_id, value) DO UPDATE SET reason = 'unsubscribe'").bind(data.ownerId, data.email, now),
    database.prepare("UPDATE outreach_enrollments SET status = 'unsubscribed', stop_reason = 'Unsubscribed (link)', updated_at = ?3 WHERE owner_id = ?1 AND email = ?2 AND status IN ('active', 'paused')").bind(data.ownerId, data.email, now),
  ]);
  return true;
}

/** Human visit: confirm with a button (link scanners can't unsubscribe people by prefetching). */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("t") || "";
  if (!await verifyUnsubscribe(token)) return page("Link not valid", "This unsubscribe link isn't valid. Reply to the email with “unsubscribe” and you'll be removed.");
  return page("Unsubscribe", "Click below and you won't receive any more emails from us.", `<form method="post"><input type="hidden" name="t" value="${token.replace(/"/g, "")}"><button type="submit">Unsubscribe</button></form>`);
}

/** RFC 8058 one-click (mail apps POST "List-Unsubscribe=One-Click") and the confirm button. */
export async function POST(request: Request) {
  const url = new URL(request.url);
  let token = url.searchParams.get("t") || "";
  if (!token) { const form = await request.formData().catch(() => null); token = String(form?.get("t") || ""); }
  const ok = await unsubscribe(token);
  if (request.headers.get("content-type")?.includes("application/x-www-form-urlencoded") && url.searchParams.get("t")) return new Response(ok ? "Unsubscribed" : "Invalid", { status: ok ? 200 : 400 });
  return ok ? page("You're unsubscribed", "You won't receive any more emails from us. Sorry for the interruption.") : page("Link not valid", "This unsubscribe link isn't valid. Reply with “unsubscribe” and you'll be removed.");
}
