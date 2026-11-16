// Public "leave a review" page for one staff member: /f/review/<token>. Reviews go straight onto their booking profile.
type RouteContext = { params: Promise<{ token: string }> };

const PAGE = (token: string) => `<!doctype html>
<html lang="en-IE"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Leave a review</title>
<style>
:root{--brand:#2563eb;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--bg:#f8fafc}
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--ink)}
.wrap{max-width:520px;margin:0 auto;padding:20px 14px 40px}.card{background:#fff;border:1px solid var(--line);border-radius:22px;box-shadow:0 10px 40px rgba(15,23,42,.07);overflow:hidden}
.hero{padding:26px 22px 18px;text-align:center;background:linear-gradient(180deg,color-mix(in srgb,var(--brand) 10%,#fff),#fff)}
.av{width:92px;height:92px;border-radius:50%;margin:0 auto 12px;background:color-mix(in srgb,var(--brand) 16%,#fff);color:var(--brand);display:grid;place-items:center;font-weight:800;font-size:32px;overflow:hidden;border:4px solid #fff;box-shadow:0 6px 20px rgba(15,23,42,.12)}.av img{width:100%;height:100%;object-fit:cover}
h1{font-size:22px;margin:0}.title{color:var(--muted);font-size:14px;margin-top:3px}.biz{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:700;margin-bottom:12px}
.rate{display:inline-block;margin-top:8px;font-size:13px;font-weight:700;color:#b45309;background:#fffbeb;border-radius:999px;padding:4px 10px}
.bio{margin:12px auto 0;color:#334155;font-size:14px;line-height:1.55;max-width:420px}
.photos{display:flex;gap:8px;overflow-x:auto;padding:0 22px 6px}.photos img{width:110px;height:82px;object-fit:cover;border-radius:10px;flex:0 0 auto}
.recent{padding:6px 22px 0;display:grid;gap:8px}.recent div{background:var(--bg);border-radius:12px;padding:9px 12px;font-size:13px;color:#334155}.recent b{color:var(--ink)}
form{padding:20px 22px 24px;display:grid;gap:14px;border-top:1px solid var(--line);margin-top:16px}
.q{font-weight:800;font-size:17px;text-align:center}
.stars{display:flex;justify-content:center;gap:6px}.stars button{border:0;background:none;font-size:42px;line-height:1;cursor:pointer;color:#d6dde2;padding:2px;transition:transform .12s,color .12s}
.stars button.on{color:#f59e0b}.stars button:hover{transform:scale(1.12)}
.label{text-align:center;color:var(--muted);font-size:13px;min-height:18px}
label{display:grid;gap:5px;font-size:13px;font-weight:700}input,textarea{font:inherit;font-weight:400;padding:12px;border:1px solid #cbd5e1;border-radius:12px;width:100%;color:var(--ink);background:#fff}
input:focus,textarea:focus{outline:2px solid color-mix(in srgb,var(--brand) 40%,transparent);border-color:var(--brand)}
.btn{border:0;background:var(--brand);color:#fff;font:inherit;font-weight:800;padding:14px 18px;border-radius:999px;cursor:pointer;font-size:16px}.btn:disabled{opacity:.55}
.err{background:#fef2f2;color:#b91c1c;border-radius:12px;padding:10px 12px;font-size:14px}.hp{position:absolute;left:-9999px}
.done{padding:40px 22px;text-align:center}.tick{width:70px;height:70px;border-radius:50%;background:#dcfce7;color:#16a34a;display:grid;place-items:center;margin:0 auto 14px;font-size:34px}
.foot{text-align:center;color:var(--muted);font-size:12px;margin-top:14px}.skeleton{padding:50px;text-align:center;color:var(--muted)}
</style></head><body><div class="wrap"><div class="card" id="app"><div class="skeleton">Loading…</div></div><div class="foot">Powered by F2B Media</div></div>
<script>
(function(){
var TOKEN=${JSON.stringify(token)},API="/api/marketing-public/scheduling",app=document.getElementById("app");
var state={info:null,rating:0,busy:false,error:"",done:false};
var WORDS=["","Poor","Not great","OK","Great","Excellent!"];
function h(tag,attrs,kids){var e=document.createElement(tag);attrs=attrs||{};for(var k in attrs){if(k==="text")e.textContent=attrs[k];else if(k==="on")for(var ev in attrs.on)e.addEventListener(ev,attrs.on[ev]);else if(attrs[k]!==false&&attrs[k]!=null)e.setAttribute(k,attrs[k]===true?"":attrs[k]);}(kids||[]).forEach(function(c){if(c)e.appendChild(typeof c==="string"?document.createTextNode(c):c)});return e}
function initials(n){return String(n||"?").split(/\\s+/).map(function(p){return p[0]||""}).join("").slice(0,2).toUpperCase()}
function render(){app.innerHTML="";var i=state.info;if(!i){app.appendChild(h("div",{class:"skeleton",text:state.error||"Loading…"}));return}
 var s=i.staff;document.title="Review "+s.name;
 if(state.done){app.appendChild(h("div",{class:"done"},[h("div",{class:"tick",text:"✓"}),h("h1",{text:"Thank you!"}),h("p",{class:"bio",text:"Your review for "+s.name+" has been saved. It really helps."})]));return}
 app.appendChild(h("div",{class:"hero"},[h("div",{class:"biz",text:i.business.name}),h("div",{class:"av"},[s.avatar?h("img",{src:s.avatar,alt:""}):document.createTextNode(initials(s.name))]),h("h1",{text:s.name}),s.title?h("div",{class:"title",text:s.title}):null,s.reviewCount?h("span",{class:"rate",text:"★ "+s.rating.toFixed(1)+" · "+s.reviewCount+" review"+(s.reviewCount===1?"":"s")}):null,s.bio?h("p",{class:"bio",text:s.bio}):null]));
 if(s.photos&&s.photos.length){var p=h("div",{class:"photos"});s.photos.forEach(function(ph){p.appendChild(h("img",{src:ph.url,alt:ph.caption||"",loading:"lazy"}))});app.appendChild(p)}
 if(s.recent&&s.recent.length){var r=h("div",{class:"recent"});s.recent.forEach(function(x){r.appendChild(h("div",{},[h("b",{text:x.author+" "}),document.createTextNode("★".repeat(x.rating)+(x.text?" — "+x.text:""))]))});app.appendChild(r)}
 var f=h("form",{on:{submit:submit}});
 f.appendChild(h("div",{class:"q",text:"How did "+s.name.split(" ")[0]+" do?"}));
 var st=h("div",{class:"stars",role:"radiogroup","aria-label":"Rating"});for(var n=1;n<=5;n++){(function(n){st.appendChild(h("button",{type:"button",class:n<=state.rating?"on":"","aria-label":n+" star"+(n>1?"s":""),"aria-pressed":n===state.rating?"true":"false",on:{click:function(){state.rating=n;state.error="";render()}},text:"★"}))})(n)}
 f.appendChild(st);f.appendChild(h("div",{class:"label",text:WORDS[state.rating]}));
 f.appendChild(h("label",{},["Your review",h("textarea",{name:"text",rows:"4",maxlength:"800",placeholder:"What went well? What did "+s.name.split(" ")[0]+" do for you?"})]));
 f.appendChild(h("label",{},["Your name",h("input",{name:"author",required:true,maxlength:"80",autocomplete:"name",placeholder:"e.g. Mary B."})]));
 f.appendChild(h("input",{class:"hp",name:"website",tabindex:"-1",autocomplete:"off","aria-hidden":"true"}));
 if(state.error)f.appendChild(h("div",{class:"err",text:state.error}));
 f.appendChild(h("button",{class:"btn",type:"submit",disabled:state.busy,text:state.busy?"Sending…":"Submit review"}));
 app.appendChild(f)}
function submit(e){e.preventDefault();var fd=new FormData(e.target);if(!state.rating){state.error="Tap the stars to give a rating.";return render()}
 var keep={text:fd.get("text"),author:fd.get("author")};state.busy=true;render();
 fetch(API,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"review",token:TOKEN,rating:state.rating,text:keep.text,author:keep.author,website:fd.get("website")})}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||"Something went wrong.");return j})})
 .then(function(){state.busy=false;state.done=true;render()}).catch(function(err){state.busy=false;state.error=err.message;render();var t=app.querySelector("textarea"),a=app.querySelector("input[name=author]");if(t)t.value=keep.text||"";if(a)a.value=keep.author||""})}
fetch(API+"?review="+encodeURIComponent(TOKEN),{cache:"no-store"}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||"This review link isn't active.");return j})}).then(function(j){state.info=j;render()}).catch(function(err){state.error=err.message;render()});
})();
</script></body></html>`;

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  if (!/^[a-f0-9]{32,64}$/.test(token)) return new Response("Not found", { status: 404 });
  return new Response(PAGE(token), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Content-Security-Policy": "default-src 'self'; img-src 'self' https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors *; base-uri 'none'; form-action 'self'" } });
}
