import { renderContractBody } from "@/lib/contracts/core";
import { ContractError, contractPage, getByToken, markViewed, readSignedHtml, signByToken } from "@/lib/contracts/server";

// Public contract link: /f/contract/<token> (under the existing /f/* Access bypass).
// GET shows the contract with a sign panel (typed name + drawn signature + agree box), or the frozen signed copy.
// POST { name, image, agree } signs it.
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ token: string }> };
const HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" };
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const notFound = () => new Response(contractPage("Contract unavailable", `<p style="color:#e5e7eb;text-align:center;margin-top:30vh">This contract link is no longer available. Please contact F2B Media.</p>`), { status: 404, headers: HEADERS });

const BAR_CSS = `.ct-bar{max-width:820px;margin:0 auto 14px;display:flex;justify-content:space-between;align-items:center;gap:10px;color:#e5e7eb;font-size:14px}.ct-bar b{color:#fff}.ct-btn{border:0;border-radius:12px;background:#fff;color:#0b0d12;font:600 14px Poppins,system-ui;padding:10px 16px;cursor:pointer;transition:transform .15s}.ct-btn:hover{transform:translateY(-1px)}.ct-ok{color:#4ade80}
@media print{body{background:#fff;padding:0}.ct-bar,.ct-signbox{display:none!important}}`;
const SIGN_CSS = `.ct-signbox{max-width:820px;margin:18px auto 0;background:#fff;border-radius:18px;padding:26px 28px;display:grid;gap:14px;font-family:Poppins,system-ui,sans-serif;color:#111827}
.ct-signbox h2{margin:0;font-size:20px}.ct-signbox p{margin:0;color:#4b5563;font-size:14px}.ct-signbox label{display:grid;gap:6px;font-size:13px;font-weight:600}
.ct-signbox input[type=text]{font:16px Poppins,system-ui;padding:12px 14px;border:1.5px solid #d6dae1;border-radius:12px;transition:border-color .15s,transform .15s}.ct-signbox input[type=text]:hover,.ct-signbox input[type=text]:focus{border-color:#1463ff;outline:0;transform:translateY(-1px)}
.ct-pad{position:relative;border:1.5px dashed #c3c9d3;border-radius:14px;background:#fafbfc;touch-action:none;height:170px}.ct-pad canvas{width:100%;height:100%;display:block;cursor:crosshair}.ct-pad span{position:absolute;left:16px;bottom:12px;color:#9ca3af;font-size:12.5px;pointer-events:none}.ct-pad button{position:absolute;right:10px;top:10px;border:0;background:#eef0f3;border-radius:8px;padding:5px 10px;font:600 12px Poppins,system-ui;cursor:pointer}
.ct-agree{display:flex!important;grid-template-columns:none!important;gap:10px!important;align-items:flex-start;font-weight:500!important;font-size:14px!important;color:#374151}.ct-agree input{width:19px;height:19px;margin-top:2px;accent-color:#1463ff;flex:none}
.ct-submit{border:0;border-radius:14px;background:#0b0d12;color:#fff;font:700 17px Poppins,system-ui;padding:16px;cursor:pointer;transition:transform .15s,opacity .15s}.ct-submit:hover{transform:translateY(-1px)}.ct-submit:disabled{opacity:.55;cursor:wait}.ct-err{background:#fef2f2;color:#b91c1c;border-radius:12px;padding:10px 14px;font-size:14px;display:none}
@media (max-width:640px){.ct-signbox{padding:20px 18px}}`;

const signScript = (token: string) => `<script>(function(){var c=document.getElementById("pad"),x=c.getContext("2d"),drawn=false,down=false,last=null;function size(){var r=c.getBoundingClientRect(),d=window.devicePixelRatio||1;var img=drawn?c.toDataURL():null;c.width=r.width*d;c.height=r.height*d;x.scale(d,d);x.lineWidth=2.4;x.lineCap="round";x.lineJoin="round";x.strokeStyle="#111827";if(img){var i=new Image();i.onload=function(){x.drawImage(i,0,0,r.width,r.height)};i.src=img}}size();addEventListener("resize",size);
function p(e){var r=c.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
c.addEventListener("pointerdown",function(e){down=true;last=p(e);c.setPointerCapture(e.pointerId);document.getElementById("hint").style.display="none"});
c.addEventListener("pointermove",function(e){if(!down)return;var q=p(e);x.beginPath();x.moveTo(last.x,last.y);x.lineTo(q.x,q.y);x.stroke();last=q;drawn=true});
["pointerup","pointercancel","pointerleave"].forEach(function(t){c.addEventListener(t,function(){down=false})});
document.getElementById("clear").onclick=function(){x.clearRect(0,0,c.width,c.height);drawn=false;document.getElementById("hint").style.display=""};
var f=document.getElementById("sign"),err=document.getElementById("err"),btn=document.getElementById("go");
f.addEventListener("submit",function(e){e.preventDefault();err.style.display="none";var name=document.getElementById("fullname").value.trim();
if(name.length<2){err.textContent="Type your full name.";err.style.display="block";return}
if(!drawn){err.textContent="Draw your signature in the box.";err.style.display="block";return}
if(!document.getElementById("agree").checked){err.textContent="Tick the box to confirm you agree to the terms.";err.style.display="block";return}
btn.disabled=true;btn.textContent="Signing…";
fetch(${JSON.stringify(`/f/contract/${token}`)},{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:name,image:c.toDataURL("image/png"),agree:true})}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||"Couldn't sign. Try again.");location.reload()})}).catch(function(e){err.textContent=e.message;err.style.display="block";btn.disabled=false;btn.textContent="Sign agreement"})})})();</script>`;

export async function GET(request: Request, context: RouteContext) {
  const { token } = await context.params;
  const found = await getByToken(token).catch(() => null);
  if (!found) return notFound();
  const { record: c, ownerId } = found;
  const origin = new URL(request.url).origin;
  if (c.status === "signed") {
    const html = await readSignedHtml(ownerId, c.id);
    if (!html) return notFound();
    const bar = `<div class="ct-bar"><span class="ct-ok">✓ Signed by <b>${esc(c.signature?.name || "")}</b> on ${esc(new Date(c.signedAt || "").toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" }))}</span><button class="ct-btn" onclick="print()">Download / print PDF</button></div>`;
    return new Response(html.replace("</style>", `${BAR_CSS}</style>`).replace(/<body>/, `<body>${bar}`), { headers: HEADERS });
  }
  await markViewed(ownerId, c.id).catch(() => undefined);
  const body = renderContractBody(c.data, { reference: c.reference, agencySignedAt: c.sentAt || undefined, agencyLogo: `${origin}/f2b-login-logo.png` });
  const bar = `<div class="ct-bar"><span>Please read and sign below · <b>Ref. ${esc(c.reference)}</b></span><button class="ct-btn" onclick="print()">Print</button></div>`;
  const sign = `<form class="ct-signbox" id="sign" novalidate><h2>Sign this agreement</h2><p>Signing for <b>${esc(c.data.parties.clientName)}</b>. Your name, signature, the date and time and your IP address are recorded with the signed copy, and a copy is emailed to you.</p>
    <label>Full name<input type="text" id="fullname" name="fullname" autocomplete="name" value="${esc(c.data.parties.signerName)}" maxlength="120" required></label>
    <div><label style="margin-bottom:6px">Signature</label><div class="ct-pad"><canvas id="pad" aria-label="Signature pad"></canvas><span id="hint">Draw your signature here</span><button type="button" id="clear">Clear</button></div></div>
    <label class="ct-agree"><input type="checkbox" id="agree" name="agree"> I have read and agree to this agreement, including the payment, notice and data protection terms, and I'm authorised to sign for ${esc(c.data.parties.clientName)}.</label>
    <div class="ct-err" id="err" role="alert"></div><button class="ct-submit" id="go" type="submit">Sign agreement</button></form>`;
  return new Response(contractPage(c.data.title, `${bar}${body}${sign}${signScript(token)}`, `${BAR_CSS}${SIGN_CSS}`), { headers: HEADERS });
}

export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const result = await signByToken(token, body, {
      ip: request.headers.get("cf-connecting-ip") || "", country: request.headers.get("cf-ipcountry") || "",
      userAgent: request.headers.get("user-agent") || "", origin: new URL(request.url).origin,
    });
    return Response.json({ ok: true, already: result.already }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ContractError) return Response.json({ error: error.message }, { status: error.status });
    console.error("contract sign", error);
    return Response.json({ error: "Couldn't sign right now. Please try again." }, { status: 500 });
  }
}
