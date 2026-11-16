import { env } from "cloudflare:workers";
import { readUnsubToken, unsubscribeContact, type Db } from "@/lib/email-marketing/server";

// Public unsubscribe for Operations → Email campaigns. Marks the contact Do Not Disturb in the CRM,
// which every campaign respects, and stops any campaign emails still scheduled for them.
export const dynamic = "force-dynamic";
const secret = () => String((env as unknown as Record<string, string>).GOOGLE_ADS_TOKEN_ENCRYPTION_KEY || "");
const page = (title: string, text: string, form = "") => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:520px;margin:12vh auto;padding:0 20px;color:#1f2328}button{font:inherit;padding:10px 18px;border-radius:10px;border:0;background:#1f2328;color:#fff;cursor:pointer}</style></head><body><h1>${title}</h1><p>${text}</p>${form}</body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

async function run(token: string) {
  const data = token && secret() ? await readUnsubToken(secret(), token) : null;
  if (!data || !env.DB) return false;
  await unsubscribeContact(env.DB as unknown as Db, data.ownerId, data.contactId, data.campaignId);
  return true;
}

/** Human visit: confirm with a button so link scanners can't unsubscribe people by prefetching. */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("t") || "";
  if (token === "test") return page("Unsubscribe (test)", "This is a test email, so nothing was changed.");
  if (!secret() || !await readUnsubToken(secret(), token)) return page("Link not valid", "This unsubscribe link isn't valid. Reply to the email with “unsubscribe” and you'll be removed.");
  return page("Unsubscribe", "Click below and you won't receive any more marketing emails from us.", `<form method="post"><input type="hidden" name="t" value="${token.replace(/[^A-Za-z0-9._-]/g, "")}"><button type="submit">Unsubscribe</button></form>`);
}

/** RFC 8058 one-click (mail apps POST "List-Unsubscribe=One-Click") and the confirm button. */
export async function POST(request: Request) {
  const url = new URL(request.url);
  let token = url.searchParams.get("t") || "";
  if (!token) { const form = await request.formData().catch(() => null); token = String(form?.get("t") || ""); }
  const ok = await run(token);
  if (url.searchParams.get("t")) return new Response(ok ? "Unsubscribed" : "Invalid", { status: ok ? 200 : 400 });
  return ok ? page("You're unsubscribed", "You won't receive any more marketing emails from us.") : page("Link not valid", "This unsubscribe link isn't valid. Reply with “unsubscribe” and you'll be removed.");
}
