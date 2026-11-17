import { getSettings, agencyOwnerId, agencyBranding } from "./server";

// The public onboarding experience at /f/start (and /f/start/<personalised token>). One self-contained, fast,
// mobile-first page: no framework bundle, inline CSS + script under a strict nonce CSP. Embeddable on the sites
// listed in Online onboarding → Settings (frame-ancestors), and it reports its height to the parent page.
// All user/AI text is inserted with textContent, never innerHTML.

export async function renderStartPage(request: Request, token = "") {
  let embedHosts: string[] = ["f2bmedia.com"];
  let brand = { primary: "#1463ff", secondary: "#1e3a8a", logo: "", name: "F2B Media" };
  try { embedHosts = (await getSettings(await agencyOwnerId())).embedOrigins; brand = await agencyBranding(); } catch { /* defaults */ }
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const ancestors = ["'self'", ...embedHosts.flatMap((host) => [`https://${host}`, `https://*.${host}`])].join(" ");
  const csp = [
    "default-src 'none'", `script-src 'nonce-${nonce}' https://challenges.cloudflare.com`, "style-src 'unsafe-inline'", "img-src 'self' https: data:", "font-src 'self'",
    "connect-src 'self'", "frame-src 'self' https://challenges.cloudflare.com", `frame-ancestors ${ancestors}`, "base-uri 'none'", "form-action 'self'",
  ].join("; ");
  const safeToken = String(token || "").replace(/[^\w.-]/g, "").slice(0, 1500);
  // Account colours: the agency's brand primary/secondary drive every button, gradient and highlight.
  const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const n = parseInt(brand.primary.slice(1), 16), lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  const mark = brand.logo ? `<img src="${esc(brand.logo)}" alt="${esc(brand.name)}" class="logo">` : `<i>${esc(brand.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 3).toUpperCase())}</i><span>${esc(brand.name)}</span>`;
  const html = PAGE.replace(/__NONCE__/g, nonce).replace("__TOKEN__", safeToken)
    .replace("--brand:#1463ff;--brand2:#7c3aed;", `--brand:${brand.primary};--brand2:${brand.secondary};--onbrand:${lum > 0.62 ? "#0f172a" : "#fff"};`)
    .replace('<div class="brand"><i>F2B</i><span>F2B Media</span></div>', `<div class="brand">${mark}</div>`)
    .replace(/· F2B Media<\/title>/, `· ${esc(brand.name)}</title>`)
    .replace('<meta name="theme-color" content="#0b1220">', `<meta name="theme-color" content="${brand.secondary}">`);
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "Content-Security-Policy": csp, "X-Robots-Tag": token ? "noindex" : "index, follow", "Referrer-Policy": "strict-origin-when-cross-origin", "X-Content-Type-Options": "nosniff" } });
}

const PAGE = String.raw`<!doctype html>
<html lang="en-IE">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Get started · F2B Media</title>
<meta name="description" content="Grow your business with F2B Media: a free business audit, personalised marketing recommendations and a plan in minutes.">
<meta name="theme-color" content="#0b1220">
<style>
:root{--ink:#0f172a;--muted:#5b6476;--line:#e4e8ef;--bg:#f5f7fb;--card:#fff;--brand:#1463ff;--brand2:#7c3aed;--ok:#16a34a;--warn:#d97706;--bad:#dc2626;--radius:18px;color-scheme:light}
*{box-sizing:border-box}html,body{margin:0;padding:0}body{font:16px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:var(--ink);background:radial-gradient(1200px 600px at 10% -10%,color-mix(in srgb,var(--brand) 12%,transparent) 0,transparent 60%),radial-gradient(900px 500px at 110% 10%,color-mix(in srgb,var(--brand2) 12%,transparent) 0,transparent 55%),var(--bg);min-height:100vh;-webkit-font-smoothing:antialiased}
body.embed{background:transparent;min-height:0}
.wrap{max-width:720px;margin:0 auto;padding:max(16px,env(safe-area-inset-top)) 16px 40px}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:4px 0 14px}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:-.01em}
.brand img.logo{max-height:40px;max-width:180px;width:auto;object-fit:contain}.brand i{width:34px;height:34px;border-radius:11px;background:linear-gradient(135deg,var(--brand),var(--brand2));display:grid;place-items:center;color:#fff;font-style:normal;font-size:15px;box-shadow:0 6px 18px color-mix(in srgb,var(--brand) 35%,transparent)}
.save{font-size:12px;color:var(--muted)}
.bar{height:6px;border-radius:99px;background:#e6eaf2;overflow:hidden;margin-bottom:18px}.bar b{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--brand),var(--brand2));border-radius:99px;transition:width .5s cubic-bezier(.2,.8,.2,1)}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:22px;box-shadow:0 12px 40px rgba(15,23,42,.06)}.card.anim{animation:in .35s cubic-bezier(.2,.8,.2,1)}
@keyframes in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
h1{font-size:clamp(26px,6vw,36px);line-height:1.15;letter-spacing:-.02em;margin:0 0 8px}h2{font-size:22px;letter-spacing:-.01em;margin:0 0 6px}h3{font-size:16px;margin:0 0 4px}
p.lead{color:var(--muted);margin:0 0 18px;font-size:17px}
.assistant{display:flex;gap:10px;align-items:flex-start;margin:0 0 16px}.assistant .av{flex:none;width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,var(--brand),var(--brand2));box-shadow:0 0 0 4px color-mix(in srgb,var(--brand) 12%,#fff);position:relative}.assistant .av:after{content:"";position:absolute;inset:11px;border-radius:50%;background:#fff;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{transform:scale(.8);opacity:.9}50%{transform:scale(1.15);opacity:1}}
.assistant .msg{background:color-mix(in srgb,var(--brand) 8%,#fff);border-radius:4px 16px 16px 16px;padding:10px 14px;color:#1e293b;font-size:15px}
.routes{display:grid;gap:12px}
.route{display:flex;gap:14px;align-items:center;text-align:left;width:100%;padding:18px;border:1.5px solid var(--line);border-radius:16px;background:#fff;cursor:pointer;font:inherit;color:inherit;transition:transform .15s,border-color .15s,box-shadow .15s}
.route:hover,.route:focus-visible{transform:translateY(-2px);border-color:var(--brand);box-shadow:0 10px 26px color-mix(in srgb,var(--brand) 16%,transparent);outline:none}
.route .ic{flex:none;width:48px;height:48px;border-radius:14px;display:grid;place-items:center;font-size:22px;background:color-mix(in srgb,var(--brand) 10%,#fff)}
.route b{display:block;font-size:17px}.route span{color:var(--muted);font-size:14px}
.route .go{margin-left:auto;color:var(--brand);font-weight:800}
.q{margin:0 0 18px}.q label.l{display:block;font-weight:700;margin:0 0 6px}
input[type=text],input[type=email],input[type=tel],input[type=url],textarea,select{width:100%;font:inherit;font-size:16px;color:inherit;background:#fff;border:1.5px solid var(--line);border-radius:12px;padding:12px 14px;transition:border-color .15s,box-shadow .15s}
input:focus,textarea:focus,select:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 4px color-mix(in srgb,var(--brand) 14%,transparent)}
textarea{min-height:96px;resize:vertical}
.from{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px;font-size:12px;color:var(--muted)}
.tag{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;padding:3px 8px;border-radius:99px;background:color-mix(in srgb,var(--brand) 10%,#fff);color:color-mix(in srgb,var(--brand) 70%,#000)}.tag.ok{background:#dcfce7;color:#14532d}.tag.ai{background:#f3e8ff;color:#581c87}.tag.na{background:#f1f5f9;color:#334155}.tag.warn{background:#fef3c7;color:#78350f}
.mini{border:0;background:transparent;color:var(--brand);font:inherit;font-size:12px;font-weight:700;cursor:pointer;padding:2px 4px}
.aibar{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.aibtn{display:inline-flex;align-items:center;gap:5px;border:1px solid color-mix(in srgb,var(--brand) 25%,#fff);background:color-mix(in srgb,var(--brand) 6%,#fff);color:color-mix(in srgb,var(--brand) 70%,#000);border-radius:99px;padding:6px 11px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:transform .12s,background .12s}
.aibtn:hover{transform:translateY(-1px);background:color-mix(in srgb,var(--brand) 12%,#fff)}.aibtn[disabled]{opacity:.55;cursor:progress}
.chips{display:grid;gap:8px;margin-top:10px}
.chip{text-align:left;border:1.5px solid var(--line);background:#fff;border-radius:12px;padding:10px 12px;font:inherit;font-size:14px;cursor:pointer;color:inherit;transition:border-color .12s,transform .12s;white-space:pre-line}
.chip:hover{border-color:var(--brand);transform:translateY(-1px)}
.chipnote{font-size:12px;color:var(--muted)}
.opts{display:flex;flex-wrap:wrap;gap:8px}
.opt{border:1.5px solid var(--line);background:#fff;border-radius:99px;padding:9px 14px;font:inherit;font-size:14px;cursor:pointer;color:inherit;transition:all .12s}
.opt:hover{border-color:var(--brand)}.opt.on{background:var(--brand);color:var(--onbrand,#fff);border-color:var(--brand)}
.nav{display:flex;gap:10px;justify-content:space-between;align-items:center;margin-top:20px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:14px;padding:14px 20px;font:inherit;font-weight:800;font-size:16px;cursor:pointer;background:linear-gradient(135deg,var(--brand),var(--brand2));color:var(--onbrand,#fff);box-shadow:0 10px 24px color-mix(in srgb,var(--brand) 30%,transparent);transition:transform .12s,box-shadow .12s;min-height:50px}
.btn:hover{transform:translateY(-1px);box-shadow:0 14px 30px color-mix(in srgb,var(--brand) 38%,transparent)}.btn[disabled]{opacity:.6;cursor:progress;transform:none}
.btn.ghost{background:#fff;color:var(--ink);border:1.5px solid var(--line);box-shadow:none}
.btn.block{width:100%}
.link{border:0;background:transparent;color:var(--muted);font:inherit;font-weight:600;cursor:pointer;padding:10px}
.err{background:#fef2f2;color:#991b1b;border-radius:12px;padding:10px 12px;font-size:14px;margin:10px 0}
.ok{background:#f0fdf4;color:#14532d;border-radius:12px;padding:10px 12px;font-size:14px;margin:10px 0}
.sources{display:grid;gap:10px;margin:12px 0}
.drop{border:2px dashed #cbd5e1;border-radius:14px;padding:16px;text-align:center;color:var(--muted);font-size:14px;cursor:pointer;transition:border-color .15s,background .15s}
.drop:hover,.drop.over{border-color:var(--brand);background:color-mix(in srgb,var(--brand) 6%,#fff)}
.files{display:grid;gap:6px;margin-top:8px}.files div{display:flex;justify-content:space-between;font-size:13px;background:#f8fafc;border-radius:10px;padding:8px 10px}
.consent{display:flex;gap:10px;align-items:flex-start;font-size:14px;color:#334155;margin:6px 0}.consent input{width:20px;height:20px;margin-top:2px;flex:none}
.screen{position:relative;border-radius:16px;background:#0b1220;color:#cfe0ff;padding:18px;overflow:hidden;min-height:250px;box-shadow:inset 0 0 0 1px #1e293b}
.screen:before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(255,255,255,.03) 0 1px,transparent 1px 3px);pointer-events:none}
.screen .scan{position:absolute;left:0;right:0;height:60px;background:linear-gradient(180deg,transparent,color-mix(in srgb,var(--brand) 25%,transparent),transparent);animation:scan 2.2s linear infinite}
@keyframes scan{from{top:-60px}to{top:100%}}
.screen h3{color:#fff;font-size:15px;margin-bottom:10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.stage{display:flex;gap:10px;align-items:center;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;padding:5px 0;opacity:.55;transition:opacity .3s}
.stage.done,.stage.run{opacity:1}.stage .dot{width:16px;height:16px;border-radius:50%;border:2px solid #334155;flex:none;display:grid;place-items:center;font-size:10px}
.stage.done .dot{background:var(--ok);border-color:var(--ok);color:#fff}.stage.run .dot{border-color:#60a5fa;border-top-color:transparent;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.pct{font:800 40px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:#fff;margin-top:10px}
.scores{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin:14px 0}
.score{background:#f8fafc;border-radius:14px;padding:12px;text-align:center}.score svg{width:64px;height:64px}.score small{display:block;color:var(--muted);font-size:12px;margin-top:4px}
.finding{border:1px solid var(--line);border-radius:14px;padding:14px;margin:10px 0;background:#fff}
.finding .h{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:4px}.finding b{font-size:15px}.finding p{margin:4px 0;color:#334155;font-size:14px}.finding .act{color:#0f172a;font-weight:600}
.pri{width:8px;height:8px;border-radius:50%;flex:none}.pri.high{background:var(--bad)}.pri.medium{background:var(--warn)}.pri.low{background:#64748b}.pri.info{background:#94a3b8}
.locked{position:relative;border-radius:16px;overflow:hidden;margin:12px 0}
.locked .blur{filter:blur(5px);user-select:none;pointer-events:none}
.locked .gate{position:absolute;inset:0;display:grid;place-items:center;background:linear-gradient(180deg,rgba(255,255,255,.2),rgba(255,255,255,.95) 45%);padding:16px}
.services{display:grid;gap:10px;margin:12px 0}
.svc{display:flex;gap:12px;align-items:flex-start;border:1.5px solid var(--line);border-radius:14px;padding:14px;background:#fff;cursor:pointer;transition:border-color .12s}
.svc.on{border-color:var(--brand);background:color-mix(in srgb,var(--brand) 6%,#fff)}.svc input{width:20px;height:20px;margin-top:2px;flex:none}.svc small{display:block;color:var(--muted)}.svc .price{margin-left:auto;text-align:right;font-weight:800;white-space:nowrap}.svc .price small{font-weight:500}
.total{display:flex;justify-content:space-between;align-items:baseline;padding:14px 0;border-top:1px solid var(--line);margin-top:6px}.total b{font-size:20px}
.actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px;margin:12px 0}
.adprev{border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:8px 0;background:#fff;font-family:arial,sans-serif}.adprev .sp{font-size:12px;color:#202124}.adprev .t{color:#1a0dab;font-size:18px;line-height:1.3}.adprev .d{color:#4d5156;font-size:14px}
.siteprev{border-radius:14px;overflow:hidden;border:1px solid var(--line)}.siteprev .hero{padding:26px 18px;color:#fff}.siteprev .hero h3{font-size:22px;color:#fff}.siteprev .sec{padding:12px 18px;border-top:1px solid var(--line)}
.launch{display:grid;place-items:center;text-align:center;gap:10px;padding:26px 16px;border-radius:18px;background:linear-gradient(135deg,color-mix(in srgb,var(--brand2) 75%,#000),var(--brand2));color:#e6edff;margin:14px 0;position:relative;overflow:hidden}
.launch:before{content:"";position:absolute;inset:-40%;background:conic-gradient(from 0deg,transparent,color-mix(in srgb,var(--brand) 45%,transparent),transparent 30%);animation:spin 6s linear infinite}
.launch>*{position:relative}.launch h3{color:#fff;font-size:20px}.launch p{margin:0;color:#c7d2fe;font-size:14px;max-width:420px}
.launch .btn{font-size:18px;padding:16px 26px;margin-top:6px}
.chiprow{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.device{margin:14px auto 8px;border-radius:16px;background:#0b1220;padding:10px 10px 14px;box-shadow:0 20px 50px rgba(15,23,42,.25);transition:max-width .35s}
.device.laptop{max-width:100%}.device.phone{max-width:330px;border-radius:34px;padding:14px 10px 18px}
.device .dots{display:flex;gap:5px;margin:0 0 8px 4px}.device .dots i{width:8px;height:8px;border-radius:50%;background:#334155}
.device iframe{display:block;width:100%;border:0;border-radius:8px;background:#fff;height:520px}.device.phone iframe{height:600px;border-radius:22px}
.seg{display:inline-flex;border:1.5px solid var(--line);border-radius:99px;padding:3px;gap:2px}.seg button{border:0;background:transparent;border-radius:99px;padding:6px 12px;font:inherit;font-size:13px;font-weight:700;cursor:pointer;color:var(--muted)}.seg button.on{background:var(--brand);color:var(--onbrand,#fff)}
.bar2{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}
.pkg{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;padding:14px;border-radius:14px;background:#f8fafc;margin:12px 0}.pkg b{font-size:18px}
body.wide .wrap{max-width:1080px}body.wide .device.laptop iframe{height:640px}
.muted{color:var(--muted)}.small{font-size:13px}.center{text-align:center}.hide{display:none!important}
.foot{text-align:center;color:var(--muted);font-size:12px;margin-top:18px}
#ts{margin:14px 0 0;min-height:0}

/* ---- Duolingo-style shell ---- */
.mascot{display:flex;gap:12px;align-items:flex-end;margin:0 0 18px}
.mascot .face{flex:none;width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,var(--brand),var(--brand2));position:relative;animation:bob 2.6s ease-in-out infinite;box-shadow:0 8px 18px color-mix(in srgb,var(--brand) 30%,transparent)}
.mascot .face:before,.mascot .face:after{content:"";position:absolute;top:22px;width:9px;height:12px;border-radius:50%;background:#fff;animation:blink 4s infinite}
.mascot .face:before{left:17px}.mascot .face:after{right:17px}
.mascot .face i{position:absolute;left:21px;right:21px;bottom:15px;height:7px;border-radius:0 0 10px 10px;background:#fff}
@keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
@keyframes blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
.mascot .bubble{position:relative;background:#fff;border:2px solid var(--line);border-radius:16px;padding:12px 14px;font-weight:600;font-size:16px;line-height:1.4;color:#1e293b}
.mascot .bubble:before{content:"";position:absolute;left:-9px;bottom:16px;width:14px;height:14px;background:#fff;border-left:2px solid var(--line);border-bottom:2px solid var(--line);transform:rotate(45deg)}
.duo h2{font-size:24px;margin:0 0 14px}
.tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.tile{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:6px;text-align:left;border:2px solid var(--line);border-bottom-width:5px;background:#fff;border-radius:16px;padding:14px;font:inherit;font-weight:700;font-size:15px;color:inherit;cursor:pointer;transition:transform .08s,border-color .12s,background .12s;min-height:74px}
.tile:hover{border-color:color-mix(in srgb,var(--brand) 45%,var(--line))}
.tile:active{transform:translateY(3px);border-bottom-width:2px;margin-bottom:3px}
.tile .ti{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;background:color-mix(in srgb,var(--brand) 12%,#fff);color:var(--brand)}
.tile .ti svg{width:18px;height:18px}
.tile.on{border-color:var(--brand);background:color-mix(in srgb,var(--brand) 8%,#fff)}
.tile.on:after{content:"✓";position:absolute;top:10px;right:10px;width:22px;height:22px;border-radius:50%;background:var(--brand);color:var(--onbrand,#fff);display:grid;place-items:center;font-size:13px}
.tile.wide{grid-column:1/-1}
.btn3d{display:flex;width:100%;justify-content:center;align-items:center;gap:8px;border:0;border-radius:16px;padding:15px 20px;font:inherit;font-weight:800;font-size:17px;letter-spacing:.02em;text-transform:uppercase;background:var(--brand);color:var(--onbrand,#fff);box-shadow:0 5px 0 color-mix(in srgb,var(--brand) 60%,#000);cursor:pointer;transition:transform .08s,box-shadow .08s;min-height:54px}
.btn3d:active{transform:translateY(4px);box-shadow:0 1px 0 color-mix(in srgb,var(--brand) 60%,#000)}
.btn3d[disabled]{opacity:.55;cursor:progress}
.btn3d.ghost{background:#fff;color:var(--ink);border:2px solid var(--line);box-shadow:0 4px 0 var(--line)}
.duo-foot{position:sticky;bottom:0;background:linear-gradient(180deg,transparent,var(--card) 30%);padding:16px 0 calc(6px + env(safe-area-inset-bottom));margin-top:18px;display:grid;gap:8px}
.cheer{position:fixed;left:0;right:0;bottom:0;z-index:20;padding:16px 20px calc(16px + env(safe-area-inset-bottom));background:color-mix(in srgb,var(--brand) 14%,#fff);border-top:2px solid color-mix(in srgb,var(--brand) 30%,#fff);font-weight:800;font-size:18px;color:color-mix(in srgb,var(--brand) 80%,#000);display:flex;align-items:center;gap:10px;animation:up .25s ease-out}
.cheer b{width:34px;height:34px;border-radius:50%;background:var(--brand);color:var(--onbrand,#fff);display:grid;place-items:center}
@keyframes up{from{transform:translateY(100%)}to{transform:none}}
.mute{border:0;background:transparent;font-size:18px;cursor:pointer;padding:4px 6px;opacity:.7}
.skip{border:0;background:transparent;color:var(--muted);font:inherit;font-weight:700;cursor:pointer;padding:8px;text-align:center}
.biz{border:2px solid var(--line);border-radius:18px;padding:18px;display:grid;gap:12px;background:#fff}
.biz .top{display:flex;gap:12px;align-items:center;justify-content:flex-start;margin:0}.biz img{max-height:52px;max-width:150px;object-fit:contain;border-radius:8px;background:#f8fafc;padding:4px}
.biz .nm{font-size:20px;font-weight:800}.biz .ind{color:var(--muted);font-size:14px}
.sw{display:flex;gap:8px}.sw i{width:28px;height:28px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px var(--line)}
.tpls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.tpl{border:2px solid var(--line);border-bottom-width:5px;border-radius:16px;background:#fff;padding:8px;cursor:pointer;text-align:left;font:inherit;color:inherit;transition:transform .08s}
.tpl:active{transform:translateY(3px)}.tpl.on{border-color:var(--brand)}
.tpl .frame{position:relative;height:210px;border-radius:10px;overflow:hidden;background:#eef2f7}
.tpl .frame iframe{position:absolute;top:0;left:0;width:400%;height:400%;border:0;transform:scale(.25);transform-origin:0 0;pointer-events:none}
.tpl b{display:block;margin:8px 4px 0;font-size:15px}.tpl span{display:block;margin:0 4px 4px;color:var(--muted);font-size:12px}
/* ---- Reports-style generating graphic ---- */
.gen{display:grid;justify-items:center;gap:10px;padding:10px 0 4px;text-align:center}
.gen svg{width:min(320px,90%);height:auto}
.gen b{font-size:18px}.gen .step{color:#334155;font-size:15px;animation:in .4s ease both}
.gen .pbar{width:min(360px,100%);height:8px;border-radius:99px;background:#e2e8f0;overflow:hidden}.gen .pbar i{display:block;height:100%;background:linear-gradient(90deg,var(--brand),var(--brand2));border-radius:99px;transition:width .8s ease}
.m-shadow{fill:#1c2330;opacity:.08}.m-frame{fill:#1c2330}.m-stand{fill:#c7d0db}.m-chip{fill:#c9d6ea}.m-tile{fill:#fff;stroke:#dbe5f3}
.m-brand{fill:var(--brand)}.m-brand2{fill:var(--brand2)}.m-soft{fill:color-mix(in srgb,var(--brand) 25%,#fff)}
.m-pop{animation:mpop 2.4s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
@keyframes mpop{0%,100%{opacity:.45}50%{opacity:1}}
.m-drop{animation:mdrop 3s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
@keyframes mdrop{0%{opacity:0;transform:translateY(-12px)}20%,80%{opacity:1;transform:none}100%{opacity:0}}
.m-sweep{animation:msweep 3.2s ease-in-out infinite}
@keyframes msweep{0%,100%{transform:translate(0,0)}33%{transform:translate(90px,26px)}66%{transform:translate(40px,62px)}}
.m-hl{animation:mhl 3.2s ease-in-out infinite}
@keyframes mhl{0%,100%{fill:#c9d6ea}50%{fill:var(--brand)}}
.m-bar{fill:var(--brand);transform-box:fill-box;transform-origin:bottom;animation:mgrow 2.4s ease-in-out infinite}
@keyframes mgrow{0%{transform:scaleY(.15)}45%,75%{transform:scaleY(1)}100%{transform:scaleY(.15)}}
.m-line{fill:none;stroke:var(--brand2);stroke-width:3;stroke-linecap:round;stroke-dasharray:160;animation:mdraw 2.4s ease-in-out infinite}
@keyframes mdraw{0%{stroke-dashoffset:160}55%,80%{stroke-dashoffset:0}100%{stroke-dashoffset:160}}
.m-spark{fill:#f2b21b;transform-box:fill-box;transform-origin:center;animation:mtw 1.8s ease-in-out infinite}
@keyframes mtw{0%,100%{transform:scale(.5);opacity:.3}50%{transform:scale(1);opacity:1}}
@media (max-width:380px){.tiles,.tpls{grid-template-columns:1fr}}
@media (max-width:520px){.card{padding:18px;border-radius:16px}.nav .btn{flex:1}.route{padding:15px}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
</head>
<body>
<div class="wrap">
  <div class="top"><div class="brand"><i>F2B</i><span>F2B Media</span></div><span><span class="save" id="save"></span><button class="mute" id="mute" type="button" aria-label="Sound on">🔊</button></span></div>
  <div class="bar" id="bar"><b></b></div>
  <main id="app" aria-live="polite"><div class="card"><p class="muted">Loading…</p></div></main>
  <p class="foot">Secure · Your details are only used to prepare your recommendations.</p>
</div>
<script nonce="__NONCE__">
(function(){
"use strict";
var LINK = "__TOKEN__";
var API = "/api/marketing-public/onboarding";
var qs = new URLSearchParams(location.search);
var embed = qs.get("embed") === "1" || window.self !== window.top;
if (embed) document.body.classList.add("embed");
var state = { config: null, session: null, audit: null, quote: null, rec: null, picked: [], manager: false, busy: false, chips: {}, prev: {}, preview: null, error: "", tsToken: "" };
var app = document.getElementById("app");
var STORE = "f2b-onb-token";
function store(t){ try { if (t) localStorage.setItem(STORE, t); else localStorage.removeItem(STORE); } catch (e) {} }
function stored(){ try { return localStorage.getItem(STORE) || ""; } catch (e) { return ""; } }

function el(tag, attrs, kids){
  var n = document.createElement(tag);
  if (attrs) for (var k in attrs) { var v = attrs[k]; if (v == null || v === false) continue;
    if (k === "text") n.textContent = v; else if (k === "on") { for (var ev in v) n.addEventListener(ev, v[ev]); }
    else if (k === "cls") n.className = v; else if (k === "style") n.setAttribute("style", v); else n.setAttribute(k, v === true ? "" : v); }
  (kids || []).forEach(function(c){ if (c == null || c === false) return; n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
  return n;
}
function api(body){
  return fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" })
    .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(j){ if (!r.ok) { var e = new Error(j.error || "Something went wrong. Please try again."); e.status = r.status; throw e; } return j; }); });
}
function t(){ return state.session && state.session.token; }
function money(cents, cur){ try { return new Intl.NumberFormat("en-IE", { style: "currency", currency: cur || "EUR", maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100); } catch (e) { return (cents / 100).toFixed(0); } }
function saving(text){ document.getElementById("save").textContent = text || ""; }
function progress(){
  var s = state.session, b = document.querySelector("#bar b");
  if (!s) { b.style.width = "4%"; return; }
  var i = Math.max(0, s.steps.findIndex(function(x){ return x.key === s.step; }));
  b.style.width = Math.round(((i + 1) / s.steps.length) * 100) + "%";
}
function resize(){ if (!embed) return; try { parent.postMessage({ type: "f2b-onboarding-height", height: document.documentElement.scrollHeight }, "*"); } catch (e) {} }
new ResizeObserver(resize).observe(document.body);
function setSession(s){ state.session = s; if (s && s.token) store(s.token); progress(); }
function fail(e){ state.busy = false; state.error = e && e.message || "Something went wrong."; render(); }
function q(key){ return state.config.questions[key] || { label: key, kind: "text" }; }
function mountEl(node){ var key = "s:" + (state.session ? state.session.step + ":" + state.session.paymentStatus : "welcome"); if (state.shown !== key) node.classList.add("anim"); state.shown = key; app.replaceChildren(node); resize(); }
// Mounts a screen. Only a new screen slides in; updates to the same screen (taps, AI chips) never move it.
function mount(screenKey, kids){
  var card = el("div", { cls: "card" + (state.shown !== screenKey ? " anim" : "") }, kids);
  state.shown = screenKey;
  app.replaceChildren(card); resize();
}
function step(){ var s = state.session; return s && (s.steps.find(function(x){ return x.key === s.step; }) || s.steps[0]); }

// ---------- boot ----------
fetch(API + "?config=1", { credentials: "same-origin" }).then(function(r){ return r.json(); }).then(function(cfg){
  state.config = cfg;
  if (!cfg.enabled) { mountEl(el("div", { cls: "card" }, [el("h2", { text: "We're updating online onboarding" }), el("p", { cls: "lead", text: "Please get in touch and we'll help you directly." })])); return; }
  var token = LINK || stored();
  if (token) return api({ action: "start", link: token, query: location.search.slice(1), referrer: document.referrer, embedHost: embedHost() }).then(function(r){
    setSession(r.session);
    var paid = qs.get("paid");
    if (paid) return api({ action: "resume", t: t(), paid: paid }).then(function(x){ setSession(x.session); render(); });
    if (qs.get("route") && !state.session.answers.businessName && state.session.route !== qs.get("route")) return api({ action: "save", t: t(), route: qs.get("route"), step: "" }).then(function(x){ setSession(x.session); render(); });
    render();
  }).catch(function(){ store(""); LINK = ""; welcome(); });
  welcome();
}).catch(function(){ mountEl(el("div", { cls: "card" }, [el("p", { text: "We couldn't load this page. Please refresh." })])); });
function embedHost(){ try { return embed && document.referrer ? new URL(document.referrer).hostname : ""; } catch (e) { return ""; } }

function welcome(){
  progress();
  var pre = qs.get("route");
  var icons = { grow: "🚀", audit: "🔎", guidance: "🧭" };
  var routes = state.config.routes.map(function(r){
    return el("button", { cls: "route", type: "button", on: { click: function(){ begin(r.key); } } }, [el("span", { cls: "ic", text: icons[r.key] || "✨" }), el("span", {}, [el("b", { text: r.title }), el("span", { text: r.blurb })]), el("span", { cls: "go", text: "→" })]);
  });
  var card = el("div", { cls: "card" + (state.shown !== "welcome" ? " anim" : "") }, [
    el("div", { cls: "assistant" }, [el("span", { cls: "av" }), el("div", { cls: "msg", text: "Hi! I'm your marketing assistant. I'll work alongside you to understand your business and show you exactly where more customers can come from." })]),
    el("h1", { text: "How can we help today?" }),
    el("p", { cls: "lead", text: "Pick a starting point. It takes about 3 minutes and you can change direction any time." }),
    el("div", { cls: "routes" }, routes),
    el("div", { id: "ts" }),
    state.error ? el("div", { cls: "err", text: state.error }) : null,
  ]);
  state.shown = "welcome"; app.replaceChildren(card);
  turnstile();
  if (pre && state.config.routes.some(function(r){ return r.key === pre; }) && !state.config.turnstileSiteKey) begin(pre);
}
var tsReady = null;
function turnstile(){
  var key = state.config.turnstileSiteKey; if (!key || LINK) return;
  if (!tsReady) tsReady = new Promise(function(res){ window.__f2bTs = res; var s = document.createElement("script"); s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__f2bTs&render=explicit"; s.async = true; s.nonce = "__NONCE__"; document.head.appendChild(s); });
  tsReady.then(function(){ var box = document.getElementById("ts"); if (!box || box.dataset.done) return; box.dataset.done = "1"; window.turnstile.render(box, { sitekey: key, appearance: "interaction-only", callback: function(tok){ state.tsToken = tok; var pre = qs.get("route"); if (pre && !state.session && !state.busy) begin(pre); }, "error-callback": function(){ state.tsToken = ""; } }); });
}
function begin(route){
  if (state.busy) return;
  if (state.config.turnstileSiteKey && !LINK && !state.tsToken) { state.error = "Just a moment while we run a quick security check…"; welcome(); return; }
  state.busy = true; state.error = ""; saving("Starting…");
  api({ action: "start", route: route, turnstile: state.tsToken, link: LINK || undefined, query: location.search.slice(1), referrer: document.referrer, embedHost: embedHost() })
    .then(function(r){ state.busy = false; saving(""); setSession(r.session); if (r.session.route !== route && !LINK) return api({ action: "save", t: t(), route: route, step: "" }).then(function(x){ setSession(x.session); render(); }); render(); })
    .catch(function(e){ state.tsToken = ""; if (window.turnstile) try { window.turnstile.reset(); } catch (x) {} fail(e); welcome(); });
}

// ---------- render ----------
function render(){
  var s = state.session; if (!s) return welcome();
  progress(); resize();
  if (s.paymentStatus === "paid") return paidScreen();
  var st = step();
  if (st.result !== "plan") document.body.classList.remove("wide");
  if (st.result === "audit") return auditScreen();
  if (st.result === "plan") return planScreen();
  questionScreen(st);
}
function lines(){ return { source: "Let's start with your website. I'll read it and fill everything in for you.", confirm: "Here's what I found. Is this you?", template: "Love it. Pick a look for your new website. These are built live with your logo and colours.", goal: "Quick one! Tap whatever fits best.", help: "Nice! Pick as many as you like.", customers: "Tell me about your best customers. This shapes every page and ad we write.", budget: "Nearly done! No commitment, it just helps me plan.", contact: "Last one! Where should we send your new website?", offer: "What do you sell, and where?", situation: "Where are you today?", challenge: "Nearly there. What's getting in the way?", basics: "A little context." }; }
// ---------- sound + feedback ----------
var muted = (function(){ try { return localStorage.getItem("f2b-onb-mute") === "1"; } catch (e) { return false; } })();
var audio = null;
function tone(freq, at, len, vol){ try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); var o = audio.createOscillator(), g = audio.createGain(); o.type = "sine"; o.frequency.value = freq; g.gain.setValueAtTime(0, audio.currentTime + at); g.gain.linearRampToValueAtTime(vol, audio.currentTime + at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + at + len); o.connect(g); g.connect(audio.destination); o.start(audio.currentTime + at); o.stop(audio.currentTime + at + len + 0.02); } catch (e) {} }
function ding(big){ if (muted) return; tone(784, 0, 0.18, 0.12); tone(1175, 0.09, big ? 0.35 : 0.22, 0.1); if (big) tone(1568, 0.2, 0.4, 0.08); }
var mb = document.getElementById("mute");
function paintMute(){ mb.textContent = muted ? "🔇" : "🔊"; mb.setAttribute("aria-label", muted ? "Sound off" : "Sound on"); }
paintMute(); mb.addEventListener("click", function(){ muted = !muted; try { localStorage.setItem("f2b-onb-mute", muted ? "1" : "0"); } catch (e) {} paintMute(); if (!muted) ding(); });
var CHEERS = ["Nice!", "Great choice!", "Perfect!", "Got it!", "Love it!", "Brilliant!"];
function cheer(text){ ding(); var old = document.querySelector(".cheer"); if (old) old.remove(); var c = el("div", { cls: "cheer", role: "status" }, [el("b", { text: "✓" }), el("span", { text: text || CHEERS[Math.floor(Math.random() * CHEERS.length)] })]); document.body.appendChild(c); setTimeout(function(){ c.remove(); }, 900); }
function mascot(text){ return el("div", { cls: "mascot" }, [el("span", { cls: "face" }, [el("i")]), el("div", { cls: "bubble", text: text })]); }
var ICONS = { "More enquiries quickly": "M13 2 3 14h7l-1 8 10-12h-7z", "Rank higher on Google": "M11 4a7 7 0 1 0 4.9 12l4.6 4.6 1.4-1.4-4.6-4.6A7 7 0 0 0 11 4z", "A better website": "M3 4h18v12H3zM8 20h8M12 16v4", "All of the above": "M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z", "Not sure yet": "M9 9a3 3 0 1 1 4 2.8V14M12 18h.01", "Google Ads": "M4 17l6-11 6 11M7 12h6M18 6v12", "SEO": "M11 4a7 7 0 1 0 4.9 12l4.6 4.6 1.4-1.4-4.6-4.6A7 7 0 0 0 11 4z", "Website": "M3 4h18v12H3zM8 20h8M12 16v4", "Google Business Profile": "M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zM12 11a2 2 0 1 1 0-4 2 2 0 0 1 0 4z", "Meta Ads": "M2 12c2-5 5-7 7-4s4 7 6 4 3-4 7 0", "Email Marketing": "M3 6h18v12H3zM3 7l9 6 9-6" };
function icon(name){ var d = ICONS[name] || "M5 12l5 5L20 7"; var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "2"); svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round"); var path = document.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", d); svg.appendChild(path); return el("span", { cls: "ti" }, [svg]); }
// ---------- the Reports-style generating graphic (monitor scene) ----------
var MONITOR = '<ellipse cx="160" cy="206" rx="110" ry="8" class="m-shadow"/><rect x="132" y="168" width="56" height="26" rx="4" class="m-stand"/><rect x="104" y="190" width="112" height="10" rx="5" class="m-stand"/><rect x="30" y="14" width="260" height="160" rx="14" class="m-frame"/><rect x="42" y="26" width="236" height="134" rx="8" fill="#f5f9ff"/>';
var SPARKS = '<path d="M296 30 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" class="m-spark"/><path d="M22 90 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" class="m-spark" style="animation-delay:.9s"/>';
var ART = {
  read: MONITOR + '<rect x="42" y="26" width="236" height="16" class="m-brand2"/><rect x="50" y="31" width="34" height="6" rx="3" fill="#fff" class="m-pop"/><rect x="52" y="50" width="120" height="10" rx="4" class="m-hl"/><rect x="52" y="66" width="200" height="6" rx="3" class="m-hl" style="animation-delay:.4s"/><rect x="52" y="78" width="170" height="6" rx="3" class="m-hl" style="animation-delay:.8s"/><rect x="52" y="96" width="62" height="46" rx="5" class="m-tile"/><rect x="122" y="96" width="62" height="46" rx="5" class="m-tile"/><rect x="192" y="96" width="62" height="46" rx="5" class="m-tile"/><g class="m-sweep"><circle cx="90" cy="70" r="20" fill="rgba(255,255,255,.35)" stroke="var(--brand)" stroke-width="5"/><rect x="104" y="84" width="8" height="26" rx="4" transform="rotate(-40 108 97)" class="m-brand"/></g>' + SPARKS,
  build: MONITOR + '<rect x="42" y="26" width="236" height="18" class="m-brand2 m-drop"/><rect x="50" y="31" width="36" height="8" rx="3" fill="#fff" class="m-drop"/><rect x="42" y="44" width="236" height="44" class="m-brand m-drop" style="animation-delay:.4s"/><rect x="54" y="56" width="110" height="9" rx="4" fill="#fff" class="m-drop" style="animation-delay:.6s"/><rect x="54" y="70" width="44" height="10" rx="5" fill="#fff" class="m-drop" style="animation-delay:.8s"/><rect x="52" y="96" width="66" height="54" rx="6" class="m-tile m-drop" style="animation-delay:1s"/><rect x="127" y="96" width="66" height="54" rx="6" class="m-tile m-drop" style="animation-delay:1.2s"/><rect x="202" y="96" width="66" height="54" rx="6" class="m-tile m-drop" style="animation-delay:1.4s"/><rect x="60" y="104" width="50" height="22" rx="4" class="m-soft m-drop" style="animation-delay:1.1s"/><rect x="135" y="104" width="50" height="22" rx="4" class="m-soft m-drop" style="animation-delay:1.3s"/><rect x="210" y="104" width="50" height="22" rx="4" class="m-soft m-drop" style="animation-delay:1.5s"/>' + SPARKS,
  audit: MONITOR + '<rect x="52" y="34" width="54" height="7" rx="3.5" class="m-chip"/><circle cx="262" cy="38" r="5" class="m-brand m-pop"/><rect x="52" y="48" width="40" height="22" rx="5" class="m-tile m-pop"/><rect x="98" y="48" width="40" height="22" rx="5" class="m-tile m-pop" style="animation-delay:.25s"/><rect x="144" y="48" width="40" height="22" rx="5" class="m-tile m-pop" style="animation-delay:.5s"/><rect x="54" y="124" width="10" height="26" rx="2.5" class="m-bar"/><rect x="69" y="110" width="10" height="40" rx="2.5" class="m-bar" style="animation-delay:.15s"/><rect x="84" y="117" width="10" height="33" rx="2.5" class="m-bar" style="animation-delay:.3s"/><rect x="99" y="98" width="10" height="52" rx="2.5" class="m-bar" style="animation-delay:.45s"/><rect x="114" y="104" width="10" height="46" rx="2.5" class="m-bar" style="animation-delay:.6s"/><path d="M150 140 L170 128 L188 132 L206 112 L224 116 L242 96 L262 90" class="m-line"/>' + SPARKS,
};
function gen(variant, title, steps, index, pct){
  var art = document.createElement("div"); art.innerHTML = '<svg viewBox="0 0 320 220" aria-hidden="true">' + ART[variant] + '</svg>';
  return el("div", { cls: "gen", role: "status" }, [art.firstChild, el("b", { text: title }), el("span", { cls: "step", text: steps[Math.min(index, steps.length - 1)] || "" }), el("div", { cls: "pbar" }, [el("i", { style: "width:" + Math.max(6, Math.min(100, pct)) + "%" })])]);
}
// Runs a request while the monitor scene plays; steps advance on a timer but the bar only completes when the work does.
function generating(variant, title, steps, work){
  var i = 0; var paint = function(pct){ mountEl(el("div", { cls: "card duo" }, [gen(variant, title, steps, i, pct)])); };
  paint(8); var timer = setInterval(function(){ if (i < steps.length - 1) { i++; paint(Math.round((i / steps.length) * 90)); } }, 1700);
  return work().then(function(r){ clearInterval(timer); i = steps.length - 1; paint(100); return new Promise(function(res){ setTimeout(function(){ res(r); }, 450); }); }, function(e){ clearInterval(timer); throw e; });
}
function questionScreen(st){
  var s = state.session, kids = [];
  var idx = s.steps.findIndex(function(x){ return x.key === st.key; });
  var first = idx === 0;
  var say = first && s.route === "guidance" ? "Happy to help. A few quick questions and I'll recommend the strategy that fits your business and budget." : lines()[st.key] || st.title;
  kids.push(mascot(say));
  if (st.ui === "website") return websiteStep(st, kids);
  if (st.ui === "confirm" && !state.editBiz && hasProfile()) return confirmStep(st, kids);
  if (st.ui === "template") return templateStep(st, kids);
  kids.push(el("h2", { text: st.title }));
  if (st.extract && st.ui !== "website") kids.push(sourcesBlock());
  (st.questions || []).forEach(function(key){ if (st.extract && key === "website") return; kids.push(question(key, st)); });
  if (st.contact) kids.push(consentBox());
  if (state.error) kids.push(el("div", { cls: "err", text: state.error }));
  var singleTiles = st.ui === "tiles" && (st.questions || []).length === 1 && q(st.questions[0]).kind === "choice";
  kids.push(footer(st, idx, singleTiles));
  mountEl(el("div", { cls: "card duo" }, kids));
}
function footer(st, idx, hideContinue){
  var s = state.session;
  return el("div", { cls: "duo-foot" }, [
    hideContinue ? null : el("button", { cls: "btn3d", type: "button", id: "next", text: st.contact ? "Send me my website" : "Continue", on: { click: function(){ next(st); } } }),
    idx > 0 ? el("button", { cls: "skip", type: "button", text: "← Back", on: { click: function(){ go(s.steps[idx - 1].key); } } }) : null,
  ]);
}
function hasProfile(){ var p = state.session.profile || {}; return !!(p.businessName || p.description || p.services || p.logo); }
function websiteStep(st, kids){
  var s = state.session;
  kids.push(el("h2", { text: st.title }));
  var site = el("input", { id: "f_website", type: "url", placeholder: "yourbusiness.ie", autocomplete: "url", inputmode: "url" }); site.value = val("website");
  site.addEventListener("input", function(){ s.answers.website = site.value; });
  site.addEventListener("keydown", function(e){ if (e.key === "Enter") read(); });
  kids.push(el("div", { cls: "q" }, [site]));
  if (state.error) kids.push(el("div", { cls: "err", text: state.error }));
  function read(){
    if (!site.value.trim()) { state.error = "Pop your website address in first."; return render(); }
    state.error = ""; s.answers.website = site.value;
    generating("read", "Reading your website", ["Opening " + site.value.replace(/^https?:\/\//, ""), "Finding your logo and brand colours", "Reading your services and areas", "Picking out your photos", "Filling in your details"], function(){ return api({ action: "extract", t: t(), website: site.value }); })
      .then(function(r){ setSession(r.session); state.editBiz = false; cheer(r.filled ? "Found " + r.filled + " details!" : "Done!"); return api({ action: "save", t: t(), answers: state.session.answers, step: st.key, advance: true }); })
      .then(function(r){ setSession(r.session); render(); })
      .catch(function(e){ state.error = e.message; render(); });
  }
  var idx = s.steps.findIndex(function(x){ return x.key === st.key; });
  kids.push(el("div", { cls: "duo-foot" }, [
    el("button", { cls: "btn3d", type: "button", text: "Read my website", on: { click: read } }),
    el("button", { cls: "skip", type: "button", text: "I don't have a website", on: { click: function(){ state.editBiz = true; go(st.key, { advance: true }); } } }),
    el("details", {}, [el("summary", { cls: "small muted", text: "Or upload a brochure, logo or photos" }), sourcesBlock(true)]),
    idx > 0 ? el("button", { cls: "skip", type: "button", text: "← Back", on: { click: function(){ go(s.steps[idx - 1].key); } } }) : null,
  ]));
  mountEl(el("div", { cls: "card duo" }, kids));
}
function confirmStep(st, kids){
  var s = state.session, p = s.profile || {}, a = s.answers;
  var top = el("div", { cls: "top" }, [p.logo && /^https:\/\//.test(p.logo.value) ? el("img", { src: p.logo.value, alt: "", on: { error: function(ev){ ev.target.remove(); } } }) : null, el("div", {}, [el("div", { cls: "nm", text: a.businessName || (p.businessName && p.businessName.value) || "Your business" }), el("div", { cls: "ind", text: a.industry || (p.industry && p.industry.value) || "" })])]);
  var cols = [p.primaryColour, p.secondaryColour].filter(function(c){ return c && /^#[0-9a-f]{6}$/i.test(c.value); });
  var services = String(a.services || "").split(/[,\n]+/).map(function(x){ return x.trim(); }).filter(Boolean).slice(0, 8);
  var card = el("div", { cls: "biz" }, [top,
    a.description ? el("p", { cls: "small", style: "margin:0", text: a.description }) : null,
    services.length ? el("div", { cls: "chiprow" }, services.map(function(x){ return el("span", { cls: "tag", text: x }); })) : null,
    a.serviceAreas ? el("div", { cls: "small muted", text: "📍 " + a.serviceAreas }) : null,
    cols.length ? el("div", { cls: "sw" }, cols.map(function(c){ return el("i", { style: "background:" + c.value, title: c.value }); })) : null]);
  kids.push(el("h2", { text: st.title }), card);
  var idx = s.steps.findIndex(function(x){ return x.key === st.key; });
  kids.push(el("div", { cls: "duo-foot" }, [
    el("button", { cls: "btn3d", type: "button", text: "Yes, that's us!", on: { click: function(){ state.confirm = (s.unconfirmed || []).map(function(u){ return u.field; }); cheer("Brilliant!"); go(st.key, { advance: true }); } } }),
    el("button", { cls: "btn3d ghost", type: "button", text: "Edit details", on: { click: function(){ state.editBiz = true; render(); } } }),
    el("button", { cls: "skip", type: "button", text: "← Back", on: { click: function(){ go(s.steps[idx - 1].key); } } }),
  ]));
  mountEl(el("div", { cls: "card duo" }, kids));
}
function templateStep(st, kids){
  var s = state.session, chosen = s.answers.template;
  var tpls = [["bold", "Bold", "Strong and direct"], ["modern", "Modern", "Clean and friendly"], ["professional", "Professional", "Calm and trustworthy"], ["luxury", "Luxury", "Elegant and premium"]];
  kids.push(el("h2", { text: st.title }));
  kids.push(el("div", { cls: "tpls" }, tpls.map(function(tp){
    return el("button", { type: "button", cls: "tpl" + (chosen === tp[0] ? " on" : ""), "aria-pressed": chosen === tp[0] ? "true" : "false", on: { click: function(){ s.answers.template = tp[0]; cheer(tp[1] + "! Great choice."); go(st.key, { advance: true }); } } },
      [el("div", { cls: "frame" }, [el("iframe", { src: "/f/start/site/" + t() + "?draft=" + tp[0], title: tp[1] + " template preview", loading: "lazy", tabindex: "-1" })]), el("b", { text: tp[1] }), el("span", { text: tp[2] })]);
  })));
  var idx = s.steps.findIndex(function(x){ return x.key === st.key; });
  kids.push(el("div", { cls: "duo-foot" }, [el("button", { cls: "skip", type: "button", text: "← Back", on: { click: function(){ go(s.steps[idx - 1].key); } } })]));
  mountEl(el("div", { cls: "card duo" }, kids));
}
function val(key){ var a = state.session.answers[key]; return Array.isArray(a) ? a : (a || ""); }
function fromTag(key){
  var p = state.session.profile[key]; if (!p) return null;
  var unconfirmed = state.session.unconfirmed.some(function(u){ return u.field === key; });
  var label = { website: "From your website", upload: "From your files", crm: "From our records", manual: "Your answer", ai: "AI suggestion" }[p.source] || "Pre-filled";
  if (!unconfirmed || String(val(key)) !== p.value) return null;
  return el("div", { cls: "from" }, [el("span", { cls: "tag", text: label }), el("button", { cls: "mini", type: "button", text: "Looks right ✓", on: { click: function(ev){ ev.target.parentNode.replaceChildren(el("span", { cls: "tag ok", text: "Confirmed" })); state.confirm = (state.confirm || []).concat([key]); } } })]);
}
function question(key, st){
  var spec = q(key), box = el("div", { cls: "q" }), input;
  var tiles = st && st.ui === "tiles";
  if (!tiles || (spec.kind !== "choice" && spec.kind !== "multi")) box.appendChild(el("label", { cls: "l", for: "f_" + key, text: spec.label + (spec.required ? " *" : "") }));
  if (spec.kind === "choice" || spec.kind === "multi") {
    var cur = val(key), wrap = el("div", { cls: tiles ? "tiles" : "opts", role: spec.kind === "multi" ? "group" : "radiogroup", "aria-label": spec.label });
    spec.options.forEach(function(o, n){
      var on = spec.kind === "multi" ? cur.indexOf(o) >= 0 : cur === o;
      var last = tiles && n === spec.options.length - 1 && spec.options.length % 2 === 1;
      wrap.appendChild(el("button", { type: "button", "data-v": o, cls: (tiles ? "tile" + (last ? " wide" : "") : "opt") + (on ? " on" : ""), "aria-pressed": on ? "true" : "false", on: { click: function(){
        var a = state.session.answers;
        if (spec.kind === "multi") { var list = Array.isArray(a[key]) ? a[key].slice() : []; var i = list.indexOf(o); if (i >= 0) list.splice(i, 1); else { list.push(o); ding(); } a[key] = list; }
        else a[key] = o;
        // Update the buttons in place: no re-render, so nothing jumps.
        Array.prototype.forEach.call(wrap.children, function(btn){ var v = btn.getAttribute("data-v"), picked = spec.kind === "multi" ? a[key].indexOf(v) >= 0 : a[key] === v; btn.classList.toggle("on", picked); btn.setAttribute("aria-pressed", picked ? "true" : "false"); });
        // One-tap questions move straight on, Duolingo style.
        if (tiles && spec.kind === "choice" && st) { cheer(); setTimeout(function(){ next(st, true); }, 380); }
      } } }, tiles ? [icon(o), el("span", { text: o })] : [o]));
    });
    box.appendChild(wrap); return box;
  }
  var type = { email: "email", tel: "tel", url: "url" }[spec.kind] || "text";
  input = spec.kind === "textarea" ? el("textarea", { id: "f_" + key, placeholder: spec.placeholder || "", rows: 4 }) : el("input", { id: "f_" + key, type: type, placeholder: spec.placeholder || "", autocomplete: { email: "email", tel: "tel", contactName: "name", businessName: "organization", website: "url" }[key] || "off", inputmode: type === "tel" ? "tel" : type === "email" ? "email" : null });
  input.value = Array.isArray(val(key)) ? val(key).join(", ") : val(key);
  input.addEventListener("input", function(){ state.session.answers[key] = input.value; });
  box.appendChild(input);
  var tag = fromTag(key); if (tag) box.appendChild(tag);
  if (spec.ai) box.appendChild(aiBar(key, input));
  var chips = state.chips[key];
  if (chips && chips.length) box.appendChild(el("div", { cls: "chips" }, chips.map(function(c){ return el("button", { cls: "chip", type: "button", text: c, on: { click: function(){ state.session.answers[key] = c; state.prev[key] = c; state.chips[key] = []; render(); } } }); }).concat([el("span", { cls: "chipnote", text: "Tap one to use it — you can edit it after." })])));
  return box;
}
function aiBar(key, input){
  var bar = el("div", { cls: "aibar" });
  var has = !!String(input.value || "").trim();
  var acts = has ? [["improve", "✨ Improve my answer"], ["shorter", "Make it shorter"], ["professional", "More professional"], ["alternatives", "Alternatives"]] : [["suggest", "✨ Suggest with AI"], ["alternatives", "Show me options"]];
  if (state.session.profile && Object.keys(state.session.profile).length) acts.push(["extract", "From my website"]);
  if (state.prev[key]) acts.push(["regenerate", "↻ Regenerate"]);
  acts.forEach(function(a){ bar.appendChild(el("button", { cls: "aibtn", type: "button", text: a[1], on: { click: function(ev){ runAi(key, a[0], input, ev.currentTarget); } } })); });
  return bar;
}
function runAi(key, mode, input, btn){
  btn.disabled = true; btn.textContent = "Thinking…"; state.error = "";
  fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ action: "ai", t: t(), field: key, current: input.value, previous: state.prev[key] || "", mode: mode }) })
    .then(function(r){ return r.json().then(function(j){ if (!r.ok) throw new Error(j.error || "AI couldn't help with that."); return j; }); })
    .then(function(r){
      state.session.answers[key] = input.value;
      if (mode === "alternatives" || r.suggestions.length > 1) state.chips[key] = r.suggestions;
      else { state.chips[key] = [r.suggestions[0]]; }
      if (r.removedClaims) state.error = "";
      render();
    }).catch(function(e){ state.error = e.message; render(); });
}
function sourcesBlock(compact){
  var s = state.session, kids = [];
  var site = el("input", { id: "f_website", type: "url", placeholder: "yourbusiness.ie", autocomplete: "url", inputmode: "url" });
  site.value = val("website"); site.addEventListener("input", function(){ s.answers.website = site.value; });
  var read = el("button", { cls: "btn", type: "button", text: s.profile && s.profile.businessName ? "Re-read website" : "Read my website", on: { click: function(){
    if (!site.value.trim()) { state.error = "Enter your website address first."; return render(); }
    read.disabled = true; read.textContent = "Reading your site…"; state.error = "";
    api({ action: "extract", t: t(), website: site.value }).then(function(r){ setSession(r.session); state.notice = r.aiUsed === false ? (r.filled ? "I read the basics from your website (" + r.filled + " details). Fill in anything I missed — I'll suggest more when AI is back." : "I couldn't find much on your website — just type the details in.") : r.filled ? ("I found " + r.filled + " details on your website. Check them as you go.") : "I read your site — fill in anything I missed."; render(); }).catch(fail);
  } } });
  if (!compact) kids.push(el("div", { cls: "q" }, [el("label", { cls: "l", for: "f_website", text: q("website").label }), site, el("div", { cls: "aibar" }, [read])]));
  if (state.notice) kids.push(el("div", { cls: "ok", text: state.notice }));
  var fileInput = el("input", { type: "file", multiple: true, accept: ".pdf,.png,.jpg,.jpeg,.webp,.svg,.zip,.html,.htm,.txt", cls: "hide" });
  var purpose = el("select", { "aria-label": "What are you uploading?" }, [["document", "Brochure / PDF"], ["logo", "Logo"], ["brand", "Brand guidelines"], ["photo", "Business photos"], ["site", "Website files (.zip)"]].map(function(o){ return el("option", { value: o[0], text: o[1] }); }));
  var drop = el("div", { cls: "drop", role: "button", tabindex: "0", text: "Drop files here or tap to upload — brochures, PDFs, logos, brand guidelines, photos or website files", on: { click: function(){ fileInput.click(); }, keydown: function(e){ if (e.key === "Enter") fileInput.click(); }, dragover: function(e){ e.preventDefault(); drop.classList.add("over"); }, dragleave: function(){ drop.classList.remove("over"); }, drop: function(e){ e.preventDefault(); drop.classList.remove("over"); upload(e.dataTransfer.files, purpose.value); } } });
  fileInput.addEventListener("change", function(){ upload(fileInput.files, purpose.value); });
  var list = el("div", { cls: "files" }, (s.files || []).map(function(f){ return el("div", {}, [el("span", { text: f.name }), el("span", { cls: "muted", text: Math.max(1, Math.round(f.size / 1024)) + " KB" })]); }));
  var uploads = el("div", { cls: "sources" }, [purpose, drop, fileInput, list,
    (s.files || []).some(function(f){ return f.kind === "pdf" || f.kind === "zip" || f.kind === "html" || f.kind === "text"; }) ? el("button", { cls: "btn ghost", type: "button", text: "Pull details from my files", on: { click: function(ev){ ev.currentTarget.disabled = true; ev.currentTarget.textContent = "Reading your files…"; api({ action: "extract_uploads", t: t() }).then(function(r){ setSession(r.session); state.notice = "Done — I've filled in what your files mention."; state.editBiz = false; cheer("Got it!"); if (step().ui === "website") go(step().key, { advance: true }); else render(); }).catch(fail); } } }) : null]);
  if (compact) return uploads;
  kids.push(el("details", { open: (s.files || []).length ? true : null }, [el("summary", { cls: "small", text: "Or upload files instead" }), uploads]));
  kids.push(el("p", { cls: "small muted", text: "No website or files? Just continue and type the details in." }));
  return el("div", {}, kids);
}
function upload(files, purpose){
  var list = Array.prototype.slice.call(files || [], 0, 6); if (!list.length) return;
  saving("Uploading…"); state.error = "";
  list.reduce(function(p, f){ return p.then(function(){ var fd = new FormData(); fd.append("t", t()); fd.append("purpose", purpose); fd.append("file", f); return fetch(API + "/upload", { method: "POST", body: fd, credentials: "same-origin" }).then(function(r){ return r.json().then(function(j){ if (!r.ok) throw new Error(j.error || "Upload failed."); state.session.files = j.files; }); }); }); }, Promise.resolve())
    .then(function(){ saving("Uploaded"); render(); }).catch(function(e){ saving(""); fail(e); });
}
function consentBox(){
  var box = el("label", { cls: "consent" }, [el("input", { type: "checkbox", id: "consent" }), el("span", { text: state.config.consentText })]);
  if (state.session.consent) box.querySelector("input").checked = true;
  var mk = el("label", { cls: "consent small" }, [el("input", { type: "checkbox", id: "marketing" }), el("span", { text: "Also send me occasional marketing tips (optional)." })]);
  return el("div", {}, [box, mk]);
}
function collect(st){
  (st.questions || []).forEach(function(key){ var n = document.getElementById("f_" + key); if (n) state.session.answers[key] = n.value; });
  var site = document.getElementById("f_website"); if (site) state.session.answers.website = site.value;
}
function go(stepKey, extra){
  state.busy = true; state.error = ""; state.notice = ""; saving("Saving…");
  return api(Object.assign({ action: "save", t: t(), answers: state.session.answers, step: stepKey, confirm: state.confirm || [] }, extra || {})).then(function(r){ state.busy = false; state.confirm = []; saving("Saved"); setSession(r.session); window.scrollTo({ top: 0, behavior: "smooth" }); render(); }).catch(fail);
}
function next(st, auto){
  collect(st);
  var s = state.session, a = s.answers;
  var missing = (st.questions || []).filter(function(k){ return q(k).required && !String(a[k] || "").trim(); });
  if (missing.length) { state.error = "Please add: " + missing.map(function(k){ return q(k).label; }).join(", "); return render(); }
  var extra = {};
  if (st.contact) {
    var c = document.getElementById("consent");
    if (!a.email && !a.phone) { state.error = "Add an email or phone number so we can send your plan."; return render(); }
    if (!c || !c.checked) { state.error = "Please tick the box so we can contact you about your plan."; return render(); }
    extra.consent = true; extra.marketing = !!(document.getElementById("marketing") || {}).checked;
  }
  extra.advance = true;
  if (st.contact) ding(true); else if (!auto) cheer();
  if (st.ui === "confirm") state.editBiz = false;
  go(st.key, extra);
}

// ---------- audit ----------
function auditScreen(){
  var s = state.session;
  if (!state.audit || state.audit.id !== s.auditId) {
    mountEl(el("div", { cls: "card duo" }, [loader({ progress: 0, stages: state.config.auditStages.map(function(x){ return { label: x.label }; }) })]));
    api({ action: "audit_start", t: t() }).then(function(r){ state.audit = r.audit; setSession(Object.assign(s, { auditId: r.audit.id })); pump(); }).catch(function(e){ state.error = e.message; auditFailed(); });
    return;
  }
  if (state.audit.status !== "done") { mountEl(el("div", { cls: "card duo" }, [loader(state.audit)])); return; }
  report();
}
function pump(){
  if (!state.audit || state.audit.status === "done" || state.audit.status === "failed") { if (state.audit && state.audit.status === "failed") return auditFailed(); return render(); }
  mountEl(el("div", { cls: "card duo" }, [loader(state.audit)])); resize();
  api({ action: "audit_step", t: t() }).then(function(r){ state.audit = r.audit; setTimeout(pump, r.audit.status === "done" ? 0 : 400); }).catch(function(e){ state.error = e.message; setTimeout(pump, 2500); });
}
function loader(a){
  var stages = a.stages || [];
  var at = stages.findIndex(function(x){ return !x.done; });
  return gen("audit", "Auditing " + ((state.session && state.session.answers.website) || "your business").replace(/^https?:\/\//, ""), stages.map(function(x){ return x.label + "…"; }), at < 0 ? stages.length - 1 : at, a.progress || 4);
}
function auditFailed(){ mountEl(el("div", { cls: "card" }, [el("h2", { text: "We couldn't finish the audit" }), el("div", { cls: "err", text: state.error || "The website didn't respond." }), el("div", { cls: "nav" }, [el("button", { cls: "link", type: "button", text: "← Change website", on: { click: function(){ state.audit = null; go("source"); } } }), el("button", { cls: "btn", type: "button", text: "See recommendations", on: { click: function(){ go("contact"); } } })])])); }
function ring(v, label){
  var r = 26, c = 2 * Math.PI * r, pct = v == null ? 0 : Math.max(0, Math.min(100, v)), col = v == null ? "#cbd5e1" : pct >= 80 ? "#16a34a" : pct >= 50 ? "#d97706" : "#dc2626";
  var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 64 64");
  svg.innerHTML = '<circle cx="32" cy="32" r="26" fill="none" stroke="#e5e7eb" stroke-width="7"/><circle cx="32" cy="32" r="26" fill="none" stroke="' + col + '" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + (c * pct / 100) + ' ' + c + '" transform="rotate(-90 32 32)"/><text x="32" y="37" text-anchor="middle" font-size="16" font-weight="800" fill="#0f172a">' + (v == null ? "–" : Math.round(pct)) + '</text>';
  return el("div", { cls: "score" }, [svg, el("small", { text: v == null ? label + " · not measured" : label })]);
}
function basisTag(b){ return el("span", { cls: "tag " + (b === "verified" ? "ok" : b === "ai" ? "ai" : "na"), text: b === "verified" ? "Verified" : b === "ai" ? "AI recommendation" : "Unavailable" }); }
function findingCard(f){ return el("div", { cls: "finding" }, [el("div", { cls: "h" }, [el("span", { cls: "pri " + f.priority }), el("b", { text: f.title }), basisTag(f.basis), el("span", { cls: "tag", text: f.area })]), f.evidence ? el("p", { text: f.evidence }) : null, f.action ? el("p", { cls: "act", text: "→ " + f.action }) : null]); }
function report(){
  var a = state.audit, s = state.session, kids = [];
  kids.push(el("div", { cls: "assistant" }, [el("span", { cls: "av" }), el("div", { cls: "msg", text: a.unlocked ? "Here's your full report. Everything marked Verified was measured live; AI recommendations are my suggestions based on those facts." : "Here are your first findings. Unlock the full report to see every issue and your personalised recommendations." })]));
  kids.push(el("h2", { text: "Your audit: " + a.domain }));
  kids.push(el("p", { cls: "small muted", text: "Checked " + new Date(a.checkedAt).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" }) }));
  var sc = a.scores || {};
  kids.push(el("div", { cls: "scores" }, [ring(sc.speed, "Mobile speed"), ring(sc.website, "Conversion"), ring(sc.seo, "Technical SEO"), ring(sc.local, "Local visibility"), ring(sc.tracking, "Tracking")]));
  (a.findings || []).forEach(function(f){ kids.push(findingCard(f)); });
  if (!a.unlocked && a.locked) {
    var blur = el("div", { cls: "blur" }, (a.teaser || []).slice(0, 4).map(function(x){ return el("div", { cls: "finding" }, [el("div", { cls: "h" }, [el("span", { cls: "pri " + x.priority }), el("b", { text: x.title }), el("span", { cls: "tag", text: x.area })]), el("p", { text: "Evidence and the exact fix are in your full report." })]); }));
    kids.push(el("div", { cls: "locked" }, [blur, el("div", { cls: "gate" }, [unlockForm(a.locked)])]));
  } else {
    if (a.local && a.local.competitors && a.local.competitors.length) kids.push(el("div", { cls: "finding" }, [el("h3", { text: "Who's winning on Google Maps for “" + a.local.keyword + "”" }), el("p", { cls: "small", text: a.local.competitors.slice(0, 5).map(function(c){ return "#" + c.rank + " " + c.name + (c.reviewCount != null ? " (" + c.reviewCount + " reviews)" : ""); }).join(" · ") }), basisTag("verified")]));
    kids.push(el("div", { cls: "nav" }, [el("span"), el("button", { cls: "btn", type: "button", text: "See my recommendations →", on: { click: function(){ go("plan"); } } })]));
  }
  mountEl(el("div", { cls: "card" }, kids));
}
function unlockForm(n){
  var a = state.session.answers;
  var name = el("input", { type: "text", placeholder: "Your name", autocomplete: "name" }); name.value = a.contactName || "";
  var email = el("input", { type: "email", placeholder: "Email", autocomplete: "email", inputmode: "email" }); email.value = a.email || "";
  var phone = el("input", { type: "tel", placeholder: "Phone (optional)", autocomplete: "tel", inputmode: "tel" }); phone.value = a.phone || "";
  var consent = el("input", { type: "checkbox" });
  var btn = el("button", { cls: "btn block", type: "button", text: "Unlock my full report", on: { click: function(){
    state.error = ""; btn.disabled = true; btn.textContent = "Unlocking…";
    api({ action: "unlock", t: t(), contactName: name.value, email: email.value, phone: phone.value, consent: consent.checked }).then(function(r){ setSession(r.session); state.audit = r.audit; go("audit"); }).catch(function(e){ btn.disabled = false; btn.textContent = "Unlock my full report"; err.textContent = e.message; err.classList.remove("hide"); });
  } } });
  var err = el("div", { cls: "err hide" });
  return el("div", { cls: "card", style: "max-width:420px;width:100%" }, [el("h3", { text: n + " more finding" + (n === 1 ? "" : "s") + " + your recommendations" }), el("p", { cls: "small muted", text: "Free. We'll email you a copy too." }), el("div", { cls: "sources" }, [name, email, phone]), el("label", { cls: "consent" }, [consent, el("span", { text: state.config.consentText })]), err, btn]);
}

// ---------- plan: one Launch button → their new website → get started ----------
function planScreen(){
  var s = state.session;
  if (!state.rec) { mountEl(el("div", { cls: "card" }, [el("p", { cls: "muted", text: "Putting your recommendations together…" })])); api({ action: "recommend", t: t() }).then(function(r){ state.rec = r.recommendation; state.quote = r.quote; state.picked = r.quote.services.slice(); render(); }).catch(fail); return; }
  if (state.launching) return launchLoader();
  var r = state.rec, cfg = state.config, cur = cfg.pricing.currency, site = s.site, kids = [];
  kids.push(mascot(site ? "Here's your new website, built from our templates with your logo, colours and photos. Try another style, then get started when you're ready." : (r.headline || "Here's what I'd recommend.") + " Hit Launch and I'll build your new website right now."));
  kids.push(el("h2", { text: site ? "Your new website" : "Your plan" }));
  kids.push(el("div", { cls: "chiprow" }, (r.services || []).slice(0, 4).map(function(x){ return el("span", { cls: "tag ai", text: x.service }); })));
  if (!site) {
    kids.push(el("div", { cls: "launch" }, [el("h3", { text: "See your new website" }), el("p", { text: "We'll build it from our proven templates using your logo, brand colours and photos from your current site." }), el("button", { cls: "btn3d", style: "max-width:260px", type: "button", text: "🚀 Launch", on: { click: function(){ launch(""); } } })]));
  } else {
    var view = state.device || "laptop";
    kids.push(el("div", { cls: "bar2" }, [
      el("div", { cls: "seg", role: "tablist", "aria-label": "Preview size" }, [["laptop", "💻 Desktop"], ["phone", "📱 Phone"]].map(function(d){ return el("button", { type: "button", cls: view === d[0] ? "on" : "", text: d[1], on: { click: function(){ state.device = d[0]; var dev = document.querySelector(".device"); if (dev) { dev.className = "device " + d[0]; } Array.prototype.forEach.call(document.querySelectorAll(".seg button"), function(b){ b.classList.toggle("on", b.textContent === d[1]); }); } } }); })),
      el("a", { cls: "mini", href: site.previewUrl, target: "_blank", rel: "noopener", text: "Open full screen ↗" }),
    ]));
    kids.push(el("div", { cls: "device " + view }, [el("div", { cls: "dots" }, [el("i"), el("i"), el("i")]), el("iframe", { src: site.previewUrl, title: "Your new website preview", loading: "lazy" })]));
    kids.push(el("div", { cls: "chiprow", role: "group", "aria-label": "Template" }, (site.templates || []).map(function(tp){ return el("button", { type: "button", cls: "opt" + (tp.key === site.template ? " on" : ""), title: tp.blurb, text: tp.label, on: { click: function(){ if (tp.key !== site.template) launch(tp.key); } } }); })));
    if (!site.hasLogo || !site.photos) kids.push(el("p", { cls: "small muted", text: !site.hasLogo && !site.photos ? "We couldn't find a logo or photos on your current site, so this uses your name and colours. Your real photos go in when we build it." : !site.photos ? "No photos found on your current site yet. We'll add your real project photos when we build it." : "We couldn't find your logo on your site. Send it over and we'll add it." }));
    var qt = state.quote || { monthly: 0, oneOff: 0, adSpendNote: "" };
    kids.push(el("div", { cls: "pkg" }, [el("span", {}, [el("div", { cls: "small muted", text: (state.picked.join(" + ") || "Your package") }), el("b", { text: money(qt.monthly, cur) + "/mo" }), qt.oneOff ? el("span", { cls: "small muted", text: " + " + money(qt.oneOff, cur) + " setup" }) : null]), el("button", { cls: "mini", type: "button", text: state.editPkg ? "Done" : "Change", on: { click: function(){ state.editPkg = !state.editPkg; render(); } } })]));
    if (state.editPkg) kids.push(packageEditor());
    if (qt.adSpendNote) kids.push(el("p", { cls: "small muted", text: qt.adSpendNote }));
    if (state.error) kids.push(el("div", { cls: "err", text: state.error }));
    if (state.notice) kids.push(el("div", { cls: "ok", text: state.notice }));
    if (cfg.checkout !== "off") kids.push(el("button", { cls: "btn block", type: "button", id: "pay", text: "Get started" + (cfg.checkout === "test" ? " (test mode)" : ""), disabled: !state.picked.length || null, on: { click: checkout } }));
    kids.push(el("button", { cls: cfg.checkout !== "off" ? "link block" : "btn block", type: "button", text: "Book a free strategy call", style: "width:100%", on: { click: function(){ offer("call"); } } }));
  }
  if (!site && state.error) kids.push(el("div", { cls: "err", text: state.error }));
  document.body.classList.toggle("wide", !!site && !embed);
  mountEl(el("div", { cls: "card" }, kids));
}
function packageEditor(){
  var cfg = state.config, cur = cfg.pricing.currency, r = state.rec, box = el("div", { cls: "services" });
  Object.keys(cfg.pricing.services).forEach(function(k){
    var p = cfg.pricing.services[k], on = state.picked.indexOf(k) >= 0, recd = (r.services || []).some(function(x){ return x.service === k; });
    var c = el("input", { type: "checkbox" }); c.checked = on;
    c.addEventListener("change", function(){ var i = state.picked.indexOf(k); if (i >= 0) state.picked.splice(i, 1); else state.picked.push(k); requote(); });
    box.appendChild(el("label", { cls: "svc" + (on ? " on" : "") }, [c, el("span", {}, [el("b", { text: p.label }), recd ? el("span", { cls: "tag ai", text: "Recommended" }) : null]), el("span", { cls: "price" }, [el("span", { text: money(p.monthly * 100, cur) }), el("small", { text: "/mo" })])]));
  });
  if (cfg.pricing.manager) { var m = el("input", { type: "checkbox" }); m.checked = state.manager; m.addEventListener("change", function(){ state.manager = m.checked; requote(); }); box.appendChild(el("label", { cls: "svc" + (state.manager ? " on" : "") }, [m, el("span", {}, [el("b", { text: cfg.pricing.manager.label })]), el("span", { cls: "price" }, [el("span", { text: money(cfg.pricing.manager.monthly * 100, cur) }), el("small", { text: "/mo" })])])); }
  return box;
}
var LAUNCH_STEPS = ["Pulling your logo and brand colours", "Choosing the best template for your business", "Adding photos from your website", "Writing your pages", "Building your new website"];
function launchLoader(){
  var i = state.launchStep || 0;
  mountEl(el("div", { cls: "card duo" }, [gen("build", "Building " + (state.session.answers.businessName || "your new website"), LAUNCH_STEPS, i, Math.min(100, Math.round(((i + 1) / LAUNCH_STEPS.length) * 92)))]));
}
function launch(template){
  state.error = ""; state.launching = true; state.launchStep = 0; render();
  var timer = setInterval(function(){ if (state.launchStep < LAUNCH_STEPS.length - 1) { state.launchStep++; if (state.launching) launchLoader(); } }, template ? 350 : 1400);
  api({ action: "launch", t: t(), template: template || undefined }).then(function(r){
    clearInterval(timer); state.launchStep = LAUNCH_STEPS.length; launchLoader();
    setTimeout(function(){ state.launching = false; setSession(r.session); ding(true); render(); }, 450);
  }).catch(function(e){ clearInterval(timer); state.launching = false; fail(e); });
}
function requote(){ api({ action: "quote", t: t(), services: state.picked, manager: state.manager }).then(function(r){ state.quote = r.quote; render(); }).catch(fail); }
function offer(key){
  state.error = "";
  if (key === "website" || key === "ads") return preview(key === "ads" ? "ads" : "website");
  api({ action: "offer", t: t(), offer: key }).then(function(r){
    setSession(r.session);
    if (r.bookingUrl) { if (embed) window.open(r.bookingUrl, "_blank", "noopener"); else location.href = r.bookingUrl; return; }
    if (r.target && r.target.booking) { state.notice = "Thanks — we'll be in touch to book your strategy call."; state.error = ""; }
    state.rec = key === "call" ? state.rec : null; render();
  }).catch(fail);
}
function preview(kind){
  if (!state.session.unlocked && !state.session.staff) { state.error = "Add your contact details first (on the previous step) to see personalised previews."; return render(); }
  state.preview = { kind: kind, loading: true }; render();
  api({ action: "preview", t: t(), kind: kind }).then(function(r){ state.preview = r; render(); }).catch(function(e){ state.preview = null; fail(e); });
}
function previewBlock(){
  var p = state.preview;
  if (p.loading) return el("div", { cls: "finding" }, [el("p", { cls: "muted", text: p.kind === "ads" ? "Writing your Google Ads preview…" : "Sketching your improved website…" })]);
  if (p.kind === "ads") {
    var d = p.preview, h = d.headlines || [], ds = d.descriptions || [];
    var ads = [0, 1].map(function(i){ return el("div", { cls: "adprev" }, [el("div", { cls: "sp", text: "Sponsored · " + (d.domain || "") + (d.path ? "/" + d.path : "") }), el("div", { cls: "t", text: [h[i * 3], h[i * 3 + 1], h[i * 3 + 2]].filter(Boolean).join(" | ") }), el("div", { cls: "d", text: ds[i] || ds[0] || "" })]); });
    return el("div", { cls: "finding" }, [el("h3", { text: "Your Google Ads preview" }), el("div", {}, ads), d.keywords && d.keywords.length ? el("p", { cls: "small", text: "Keyword ideas: " + d.keywords.join(", ") }) : null, el("p", { cls: "small muted", text: p.note })]);
  }
  var w = p.preview, col = /^#[0-9a-f]{6}$/i.test(w.colours.primary || "") ? w.colours.primary : "#1463ff";
  return el("div", { cls: "finding" }, [el("h3", { text: "Your improved website (preview)" }), el("div", { cls: "siteprev" }, [el("div", { cls: "hero", style: "background:" + col }, [w.logo ? el("img", { src: w.logo, alt: "", style: "max-height:36px;margin-bottom:10px;background:#fff;border-radius:6px;padding:4px" }) : null, el("h3", { text: w.headline }), el("p", { text: w.subheadline }), el("span", { cls: "btn", style: "padding:10px 16px;min-height:0;font-size:14px", text: w.cta })])].concat((w.sections || []).map(function(sct){ return el("div", { cls: "sec" }, [el("b", { text: sct.title }), el("p", { cls: "small", text: sct.text })]); }))), el("p", { cls: "small muted", text: p.note })]);
}
function checkout(){
  var s = state.session;
  if (!s.consent || !s.answers.email) { state.error = "Add your email first (Contact step) so we can send your receipt."; return render(); }
  var btn = document.getElementById("pay"); btn.disabled = true; btn.textContent = "Opening secure checkout…";
  // Stripe Checkout can't run inside an iframe: when embedded, open it in a new tab straight from the click.
  var win = embed ? window.open("", "_blank") : null;
  api({ action: "checkout", t: t(), services: state.picked, manager: state.manager }).then(function(r){
    if (!/^https:\/\/checkout\.stripe\.com\//.test(r.url)) throw new Error("Checkout couldn't be opened.");
    if (win) { win.location.href = r.url; btn.textContent = "Checkout opened in a new tab"; } else location.href = r.url;
  }).catch(function(e){ if (win) win.close(); fail(e); });
}
function paidScreen(){
  var s = state.session;
  var kids = [el("div", { cls: "assistant" }, [el("span", { cls: "av" }), el("div", { cls: "msg", text: "Payment received — welcome to F2B Media! Next, connect your accounts so we can get to work straight away." })]), el("h1", { text: "You're all set 🎉" })];
  if (s.quote && s.quote.mode === "test") kids.push(el("p", { cls: "tag warn", text: "TEST MODE — no real payment was taken" }));
  if (s.connectUrl) {
    kids.push(el("p", { cls: "lead", text: "Taking you to connect Google Ads, Analytics, Search Console and your Business Profile…" }));
    kids.push(el("a", { cls: "btn block", href: s.connectUrl, target: embed ? "_blank" : null, rel: "noopener", text: "Connect my accounts →" }));
    if (!embed && !state.redirected) { state.redirected = true; setTimeout(function(){ location.href = s.connectUrl; }, 3500); }
  } else kids.push(el("p", { cls: "lead", text: "We're setting up your account now. You'll get an email with the next steps in a few minutes." }));
  mountEl(el("div", { cls: "card" }, kids));
  if (!s.connectUrl && !state.polling) { state.polling = true; setTimeout(function(){ state.polling = false; api({ action: "resume", t: t() }).then(function(r){ setSession(r.session); render(); }).catch(function(){}); }, 4000); }
}
})();
</script>
</body>
</html>`;
