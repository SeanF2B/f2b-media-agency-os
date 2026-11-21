// Public invoice page (unguessable token). Lives under /api/marketing-public so the existing public Access bypass already covers it.
// ?pay=1 (or ?pay=card for the Stripe backup) sends the client straight to the payment page; ?paid=1 is the return from it.
import { env } from "cloudflare:workers";
import { ensureTables, invoiceHtml, loadSettings } from "@/lib/invoicing/core";
import { invoicePaymentUrl, loadPaymentSettings, payable } from "@/lib/invoicing/payments";

export const dynamic = "force-dynamic";
const HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" };

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  if (!/^[a-f0-9]{64}$/.test(token) || !env.DB) return new Response("Not found", { status: 404 });
  await ensureTables();
  const inv = await env.DB.prepare("SELECT * FROM inv_invoices WHERE public_token=?1 AND status<>'draft'").bind(token).first<any>();
  if (!inv) return new Response("Not found", { status: 404 });
  const settings = await loadSettings(inv.owner_id);
  const pay = url.searchParams.get("pay");
  let payError = "";
  if (pay && payable(inv)) {
    try { return Response.redirect(await invoicePaymentUrl(inv, url.origin, pay === "card" ? "stripe" : undefined), 303); }
    catch (e) { payError = e instanceof Error ? e.message : "Online payment is unavailable right now."; console.error("invoice-pay", e); }
  }
  const ps = payable(inv) ? await loadPaymentSettings(inv.owner_id) : null;
  const base = `${url.origin}/api/marketing-public/invoice?token=${token}`;
  return new Response(invoiceHtml(inv, settings, inv.status, {
    payUrl: ps && ps.preferred !== "none" ? `${base}&pay=1` : "",
    cardUrl: ps && ps.revolut.connected && ps.stripe.ready ? `${base}&pay=card` : "",
    returned: url.searchParams.get("paid") === "1" && inv.status !== "paid",
    payError,
  }), { headers: HEADERS });
}
