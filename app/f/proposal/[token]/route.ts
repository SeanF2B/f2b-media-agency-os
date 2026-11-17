import { approveByToken, confirmProposalPayment, getProposalByToken, paymentsReady, proposalOrder, readAsset, recordView, startProposalCheckout } from "@/lib/proposals/server";
import { renderProposalHtml } from "@/lib/proposals/render";

// Public, read-only proposal link: /f/proposal/<token> (under the existing /f/* Access bypass).
// ?asset=<name> serves screenshots/uploads · ?approve=1 opens the checkout page (package + optional add-ons,
// card / Apple Pay / Google Pay via Stripe Checkout) · ?paid=<checkout>&s=<session> confirms payment.
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ token: string }> };
const HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer", "X-Frame-Options": "SAMEORIGIN" };
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const notFound = () => new Response("<!doctype html><meta charset=utf-8><title>Proposal unavailable</title><body style=\"font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#0d0f14;color:#e5e7eb\"><p>This proposal link is no longer available. Please contact F2B Media.</p>", { status: 404, headers: HEADERS });
const shell = (title: string, body: string, logo: string) => new Response(`<!doctype html><html lang="en-IE"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#0d0f14;font-family:Poppins,system-ui,sans-serif;color:#0b0d12;padding:32px 16px}
.card{max-width:620px;margin:0 auto;background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.45)}
.top{background:#2b2d33;color:#fff;padding:30px 32px 26px;text-align:center}.top img.logo{max-height:64px;max-width:220px;object-fit:contain;background:#fff;padding:10px 16px;border-radius:14px;margin-bottom:14px}
.top h1{margin:0;font-size:26px}.top p{margin:6px 0 0;color:#c7cbd4;font-size:14px}
.body{padding:26px 32px 30px;display:grid;gap:18px}
h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;margin:0 0 8px}
.line{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid #eef0f3;font-size:15px}.line b{font-weight:600}.line span{color:#374151;white-space:nowrap;text-align:right}.line small{display:block;color:#6b7280;font-size:12.5px}
.addon{display:flex;gap:12px;align-items:flex-start;padding:14px;border:1.5px solid #e3e8ef;border-radius:14px;cursor:pointer;transition:border-color .15s,background .15s,transform .15s;margin-bottom:8px}
.addon:hover{transform:translateY(-1px);border-color:#1463ff}.addon input{margin-top:3px;width:18px;height:18px;accent-color:#1463ff}.addon.on{border-color:#1463ff;background:#f2f6ff}
.addon div{flex:1}.addon b{font-size:15px}.addon small{display:block;color:#6b7280;font-size:13px;margin-top:2px}.addon em{font-style:normal;font-weight:700;color:#1463ff;white-space:nowrap}
.totals{background:#f5f7fb;border-radius:16px;padding:16px 18px;display:grid;gap:6px}.totals div{display:flex;justify-content:space-between;font-size:15px}
.note{font-size:12.5px;color:#6b7280;line-height:1.55;margin:0}
.pay{width:100%;border:0;border-radius:14px;background:#0b0d12;color:#fff;font:700 17px Poppins,system-ui;padding:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;transition:transform .15s}
.pay:hover{transform:translateY(-1px)}.pay svg{height:20px}
.methods{display:flex;justify-content:center;gap:8px;flex-wrap:wrap}.methods span{border:1px solid #e3e8ef;border-radius:8px;padding:4px 10px;font-size:12px;font-weight:700;color:#374151}
.alt{background:none;border:0;color:#1463ff;font:600 14px Poppins,system-ui;cursor:pointer;justify-self:center}
.back{display:block;text-align:center;color:#9ec2ff;margin-top:18px;font-size:14px}
.err{background:#fef2f2;color:#b91c1c;border-radius:12px;padding:10px 14px;font-size:14px}
.done{padding:40px 32px;text-align:center}.tick{width:72px;height:72px;border-radius:50%;background:#dcfce7;color:#16a34a;display:grid;place-items:center;margin:0 auto 16px;font-size:36px}
.foot{display:flex;align-items:center;justify-content:center;gap:8px;color:#6b7280;font-size:12px;margin-top:16px}.foot img{height:18px}
</style></head><body>${body}<div class="foot">${logo ? `<img src="${esc(logo)}" alt="F2B Media">` : "F2B Media"}</div></body></html>`, { headers: HEADERS });

export async function GET(request: Request, context: RouteContext) {
  const { token } = await context.params;
  const proposal = await getProposalByToken(token).catch(() => null);
  if (!proposal) return notFound();
  const url = new URL(request.url);
  const base = `/f/proposal/${encodeURIComponent(token)}`;
  const agencyLogo = `${url.origin}/f2b-login-logo.png`;
  const assetUrl = (name: string) => `${base}?asset=${encodeURIComponent(name)}`;
  const clientLogo = proposal.brand.logo.startsWith("r2:") ? assetUrl(proposal.brand.logo.slice(3)) : proposal.brand.logo;
  const asset = url.searchParams.get("asset");
  if (asset) {
    const object = await readAsset(proposal.ownerId, proposal.id, asset);
    if (!object) return new Response("Not found", { status: 404 });
    return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || "application/octet-stream", "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" } });
  }
  const thanks = (paid: boolean) => shell("Thank you", `<div class="card"><div class="done"><div class="tick">✓</div><h1 style="margin:0 0 8px">${paid ? "Payment received — welcome aboard!" : "Thank you — you're approved!"}</h1><p class="note" style="font-size:15px">${paid ? `We've received your payment for <b>${esc(proposal.businessName)}</b>. A receipt is on its way by email, and we'll be in touch shortly to book your onboarding call.` : `F2B Media has your approval for <b>${esc(proposal.businessName)}</b>. We'll send your invoice and be in touch to book your onboarding call.`}</p></div></div><a class="back" href="${base}">Back to the proposal</a>`, agencyLogo);
  const paidCheckout = url.searchParams.get("paid");
  if (paidCheckout) {
    const result = await confirmProposalPayment(token, url.searchParams.get("s") || "", paidCheckout, url.origin).catch(() => null);
    if (result?.paid) return thanks(true);
    return shell("Payment processing", `<div class="card"><div class="done"><div class="tick" style="background:#e7efff;color:#1463ff">…</div><h1 style="margin:0 0 8px">Payment processing</h1><p class="note" style="font-size:15px">Thanks — your payment is being confirmed. You'll get an email receipt shortly. If you have any questions, just reply to the F2B Media team.</p></div></div><a class="back" href="${base}">Back to the proposal</a>`, agencyLogo);
  }
  if (url.searchParams.get("approve") === "1") {
    if (proposal.status === "approved" || proposal.approvedAt) return thanks(false);
    const order = await proposalOrder(proposal);
    const canPay = await paymentsReady(proposal.ownerId).catch(() => false);
    const symbol = order.currency === "GBP" ? "£" : order.currency === "USD" ? "$" : "€";
    const fmt = (value: number) => `${symbol}${Math.round(value).toLocaleString("en-IE")}`;
    const coreSetup = order.core.reduce((sum, item) => sum + item.setupFee, 0), coreMonthly = order.core.reduce((sum, item) => sum + item.monthlyFee, 0);
    const error = url.searchParams.get("cancelled") ? `<div class="err">Payment was cancelled — nothing has been charged. You can try again below.</div>` : url.searchParams.get("error") ? `<div class="err">${esc(url.searchParams.get("error"))}</div>` : "";
    const body = `<form class="card" method="post" id="f"><input type="hidden" name="action" value="pay">
      <div class="top">${clientLogo ? `<img class="logo" src="${esc(clientLogo)}" alt="${esc(proposal.businessName)}" onerror="this.remove()">` : ""}<h1>Let's get started</h1><p>Your marketing plan for ${esc(proposal.businessName)}</p></div>
      <div class="body">${error}
        <section><h2>Your package</h2>${order.core.map((item) => `<div class="line"><b>${esc(item.name)}</b><span>${item.setupFee ? `${fmt(item.setupFee)} setup` : ""}<small>${item.monthlyFee ? `${fmt(item.monthlyFee)}/month` : ""}</small></span></div>`).join("")}</section>
        ${order.addons.length ? `<section><h2>Optional extras</h2>${order.addons.map((item) => `<label class="addon" data-setup="${item.setupFee}" data-monthly="${item.monthlyFee}"><input type="checkbox" name="addon" value="${esc(item.key)}"><div><b>${esc(item.name)}</b><small>${esc(item.tagline)}</small></div><em>+${item.setupFee ? `${fmt(item.setupFee)} + ` : ""}${fmt(item.monthlyFee)}/mo</em></label>`).join("")}</section>` : ""}
        <div class="totals"><div><span>Due today</span><b id="today">${fmt(coreSetup + coreMonthly)}</b></div><div><span>Then monthly</span><b id="monthly">${fmt(coreMonthly)}</b></div></div>
        ${order.mediaNotes.length ? `<p class="note">Ad budgets are paid directly to the platforms: ${order.mediaNotes.map(esc).join("; ")}.</p>` : ""}
        ${proposal.inputs.terms ? `<p class="note"><b>Terms:</b> ${esc(proposal.inputs.terms)}</p>` : ""}
        ${canPay ? `<button class="pay" type="submit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>Pay securely</button>
        <div class="methods"><span>Apple Pay</span><span>Google Pay</span><span>Visa</span><span>Mastercard</span><span>Amex</span></div>
        <button class="alt" type="submit" name="action" value="approve">Approve now and pay by invoice instead</button>`
        : `<button class="pay" type="submit" name="action" value="approve">Approve proposal</button><p class="note" style="text-align:center">We'll send your invoice and book your onboarding call.</p>`}
      </div></form><a class="back" href="${base}">Back to the proposal</a>
      <script>(function(){var s=${coreSetup},m=${coreMonthly},sym=${JSON.stringify(symbol)};function f(v){return sym+Math.round(v).toLocaleString("en-IE")}function u(){var ts=s,tm=m;document.querySelectorAll(".addon").forEach(function(a){var on=a.querySelector("input").checked;a.classList.toggle("on",on);if(on){ts+=+a.dataset.setup;tm+=+a.dataset.monthly}});document.getElementById("today").textContent=f(ts+tm);document.getElementById("monthly").textContent=f(tm)}document.querySelectorAll(".addon input").forEach(function(i){i.addEventListener("change",u)})})();</script>`;
    return shell(`Approve · ${proposal.businessName}`, body, agencyLogo);
  }
  if (!proposal.deck) return notFound();
  await recordView(proposal.id, proposal.ownerId);
  const html = renderProposalHtml(proposal.deck, proposal.brand, { assetUrl, agencyLogo, printButton: true, approveUrl: proposal.approvedAt ? undefined : `${url.origin}${base}?approve=1`, title: proposal.title });
  return new Response(html, { headers: HEADERS });
}

export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;
  const url = new URL(request.url);
  const base = `${url.origin}/f/proposal/${encodeURIComponent(token)}`;
  const form = await request.formData().catch(() => null);
  // The submit button that was pressed decides: "Pay securely" (default) or "Approve … pay by invoice".
  const actions = (form?.getAll("action") || []).map(String);
  const action = actions.includes("approve") ? "approve" : "pay";
  if (action === "pay") {
    const addons = (form?.getAll("addon") || []).map(String).filter((key) => /^[a-z0-9-]{1,40}$/.test(key)).slice(0, 20);
    try {
      const checkoutUrl = await startProposalCheckout(token, addons, url.origin);
      if (/^https:\/\/checkout\.stripe\.com\//.test(checkoutUrl)) return Response.redirect(checkoutUrl, 303);
      throw new Error("Payment page unavailable.");
    } catch (error) {
      return Response.redirect(`${base}?approve=1&error=${encodeURIComponent(error instanceof Error ? error.message : "Payment is unavailable right now.")}`, 303);
    }
  }
  const proposal = await approveByToken(token).catch(() => null);
  if (!proposal) return notFound();
  return Response.redirect(`${base}?approve=1`, 303);
}
