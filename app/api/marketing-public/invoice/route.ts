// Public invoice page (unguessable token). Lives under /api/marketing-public so the existing public Access bypass already covers it.
import { env } from "cloudflare:workers";
import { ensureTables, invoiceHtml, loadSettings } from "@/lib/invoicing/core";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!/^[a-f0-9]{64}$/.test(token) || !env.DB) return new Response("Not found", { status: 404 });
  await ensureTables();
  const inv = await env.DB.prepare("SELECT * FROM inv_invoices WHERE public_token=?1 AND status<>'draft'").bind(token).first<any>();
  if (!inv) return new Response("Not found", { status: 404 });
  return new Response(invoiceHtml(inv, await loadSettings(inv.owner_id), inv.status), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" } });
}
