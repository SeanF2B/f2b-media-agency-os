import { approveByToken, getProposalByToken, readAsset, recordView } from "@/lib/proposals/server";
import { renderProposalHtml } from "@/lib/proposals/render";

// Public, read-only proposal link: /f/proposal/<token> (under the existing /f/* Access bypass).
// ?asset=<name> serves that proposal's screenshots/uploads; ?approve=1 lets the client approve it.
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ token: string }> };
const HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer", "X-Frame-Options": "SAMEORIGIN" };
const notFound = () => new Response("<!doctype html><meta charset=utf-8><title>Proposal unavailable</title><body style=\"font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#0d0f14;color:#e5e7eb\"><p>This proposal link is no longer available. Please contact F2B Media.</p>", { status: 404, headers: HEADERS });
const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const page = (title: string, body: string) => new Response(`<!doctype html><html lang="en-IE"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d0f14;font-family:Poppins,system-ui,sans-serif;color:#fff}.card{background:#1b1e25;border-radius:22px;padding:40px;max-width:460px;text-align:center;box-shadow:0 30px 80px rgba(0,0,0,.4)}h1{font-size:26px;margin:0 0 10px}p{color:#c7cbd4;line-height:1.6}button,a.b{display:inline-block;margin-top:18px;border:0;border-radius:999px;background:#1463ff;color:#fff;font:700 16px inherit;padding:14px 28px;cursor:pointer;text-decoration:none}a.l{color:#9ec2ff;display:block;margin-top:14px}</style></head><body><div class="card">${body}</div></body></html>`, { headers: HEADERS });

export async function GET(request: Request, context: RouteContext) {
  const { token } = await context.params;
  const proposal = await getProposalByToken(token).catch(() => null);
  if (!proposal) return notFound();
  const url = new URL(request.url);
  const asset = url.searchParams.get("asset");
  if (asset) {
    const object = await readAsset(proposal.ownerId, proposal.id, asset);
    if (!object) return new Response("Not found", { status: 404 });
    return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || "application/octet-stream", "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" } });
  }
  if (url.searchParams.get("approve") === "1") {
    if (proposal.approvedAt || proposal.status === "approved") return page("Proposal approved", `<h1>Already approved ✓</h1><p>Thanks — F2B Media has your approval for ${esc(proposal.businessName)} and will be in touch to book onboarding.</p><a class="l" href="?">Back to the proposal</a>`);
    return page("Approve proposal", `<h1>Approve this proposal?</h1><p>Confirm you'd like F2B Media to go ahead with the proposal for <b>${esc(proposal.businessName)}</b>. We'll be in touch to book your onboarding call.</p><form method="post"><button type="submit">Yes, approve</button></form><a class="l" href="?">Back to the proposal</a>`);
  }
  if (!proposal.deck) return notFound();
  await recordView(proposal.id, proposal.ownerId);
  const base = `/f/proposal/${encodeURIComponent(token)}`;
  const html = renderProposalHtml(proposal.deck, proposal.brand, { assetUrl: (name) => `${base}?asset=${encodeURIComponent(name)}`, agencyLogo: `${url.origin}/f2b-login-logo.png`, printButton: true, approveUrl: proposal.approvedAt ? undefined : `${base}?approve=1`, title: proposal.title });
  return new Response(html, { headers: HEADERS });
}

export async function POST(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  const proposal = await approveByToken(token).catch(() => null);
  if (!proposal) return notFound();
  return page("Proposal approved", `<h1>Thank you ✓</h1><p>Your approval for <b>${esc(proposal.businessName)}</b> has been sent to F2B Media. We'll be in touch shortly to book your onboarding call.</p><a class="l" href="?">Back to the proposal</a>`);
}
