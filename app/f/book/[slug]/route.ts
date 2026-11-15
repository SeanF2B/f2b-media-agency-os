// Public booking page: /f/book/<calendar-slug>  (also /f/book/manage?t=<token> for reschedule / cancel).
// Self-contained page (no app bundle) so it loads fast and can be embedded in an <iframe> on client websites.
type RouteContext = { params: Promise<{ slug: string }> };

const PAGE = (slug: string, manage: boolean) => `<!doctype html>
<html lang="en-IE"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Book an appointment</title>
<style>
:root{--brand:#2563eb;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--bg:#f8fafc}
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--ink)}
.wrap{max-width:860px;margin:0 auto;padding:22px 14px 40px}.card{background:#fff;border:1px solid var(--line);border-radius:20px;box-shadow:0 10px 40px rgba(15,23,42,.06);overflow:hidden}
.top{display:flex;gap:14px;align-items:center;padding:20px 22px;border-bottom:1px solid var(--line)}.top img{max-height:46px;max-width:140px;object-fit:contain}
.biz{font-size:13px;color:var(--muted);font-weight:600}.title{font-size:22px;font-weight:800;margin:2px 0 0}
.meta{display:flex;flex-wrap:wrap;gap:8px;padding:14px 22px 0}.pill{font-size:13px;background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:6px 11px;color:#334155}
.desc{padding:12px 22px 0;color:#334155;line-height:1.55;font-size:15px;white-space:pre-wrap}
.step{padding:18px 22px}.step h2{font-size:15px;margin:0 0 12px;letter-spacing:.02em}
.staff{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.who{border:1.5px solid var(--line);border-radius:16px;padding:14px 10px;background:#fff;cursor:pointer;text-align:center;font:inherit;transition:.15s}
.who:hover,.day:hover,.time:hover{border-color:var(--brand);transform:translateY(-1px);box-shadow:0 6px 18px color-mix(in srgb,var(--brand) 18%,transparent)}
.who.on,.day.on,.time.on{border-color:var(--brand);background:color-mix(in srgb,var(--brand) 9%,#fff)}
.av{width:58px;height:58px;border-radius:50%;margin:0 auto 8px;background:color-mix(in srgb,var(--brand) 16%,#fff);color:var(--brand);display:grid;place-items:center;font-weight:800;font-size:20px;overflow:hidden}.av img{width:100%;height:100%;object-fit:cover}
.who b{display:block;font-size:14px}.who small{color:var(--muted);font-size:12px}
.days{display:grid;grid-template-columns:repeat(7,1fr);gap:8px}.day{border:1.5px solid var(--line);border-radius:14px;padding:10px 4px;text-align:center;background:#fff;cursor:pointer;font:inherit}
.day small{display:block;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.06em}.day b{display:block;font-size:19px;margin:2px 0}.day span{font-size:11px;color:var(--muted)}
.day:disabled{opacity:.35;cursor:not-allowed;transform:none;box-shadow:none}
.nav{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.nav button{border:1px solid var(--line);background:#fff;border-radius:10px;padding:7px 12px;cursor:pointer;font:inherit}
.times{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px}.time{border:1.5px solid var(--line);border-radius:12px;padding:10px;background:#fff;cursor:pointer;font:inherit;font-weight:700}
form{display:grid;gap:12px}label{display:grid;gap:5px;font-size:13px;font-weight:700}input,textarea,select{font:inherit;font-weight:400;padding:11px 12px;border:1px solid #cbd5e1;border-radius:12px;width:100%;background:#fff;color:var(--ink)}
input:focus,textarea:focus,select:focus{outline:2px solid color-mix(in srgb,var(--brand) 40%,transparent);border-color:var(--brand)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:600px){.grid2{grid-template-columns:1fr}.days{grid-template-columns:repeat(4,1fr)}}
.btn{border:0;background:var(--brand);color:#fff;font:inherit;font-weight:800;padding:13px 18px;border-radius:999px;cursor:pointer}.btn:disabled{opacity:.6}.btn.ghost{background:#fff;color:var(--ink);border:1px solid var(--line)}
.err{background:#fef2f2;color:#b91c1c;border-radius:12px;padding:10px 12px;font-size:14px}.muted{color:var(--muted);font-size:13px}.hp{position:absolute;left:-9999px}
.done{padding:34px 22px;text-align:center}.tick{width:64px;height:64px;border-radius:50%;background:color-mix(in srgb,var(--brand) 14%,#fff);color:var(--brand);display:grid;place-items:center;margin:0 auto 14px;font-size:32px}
.summary{background:var(--bg);border-radius:14px;padding:12px 14px;font-size:14px;margin-bottom:4px}.foot{text-align:center;color:var(--muted);font-size:12px;margin-top:14px}
.skeleton{padding:40px;text-align:center;color:var(--muted)}
</style></head><body><div class="wrap"><div class="card" id="app"><div class="skeleton">Loading…</div></div><div class="foot">Secure booking · powered by F2B Media</div></div>
<script>
(function(){
var SLUG=${JSON.stringify(slug)},MANAGE=${manage ? "true" : "false"};
var API="/api/marketing-public/scheduling";var app=document.getElementById("app");
var qs=new URLSearchParams(location.search);var TOKEN=qs.get("t")||"";
var state={info:null,staffId:"",weekStart:null,slots:{},day:"",slot:null,booking:null,busy:false,error:""};
function h(tag,attrs,kids){var e=document.createElement(tag);attrs=attrs||{};for(var k in attrs){if(k==="text")e.textContent=attrs[k];else if(k==="on")for(var ev in attrs.on)e.addEventListener(ev,attrs.on[ev]);else if(attrs[k]!==false&&attrs[k]!=null)e.setAttribute(k,attrs[k]===true?"":attrs[k]);}(kids||[]).forEach(function(c){if(c)e.appendChild(typeof c==="string"?document.createTextNode(c):c)});return e}
function api(path,body){return fetch(API+path,body?{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}:{cache:"no-store"}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||"Something went wrong.");return j})})}
function tz(){return (state.info&&state.info.calendar&&state.info.calendar.timezone)||"Europe/Dublin"}
function fmt(iso,o){return new Intl.DateTimeFormat("en-IE",Object.assign({timeZone:tz()},o)).format(new Date(iso))}
function localDate(d){var p=new Intl.DateTimeFormat("en-CA",{timeZone:tz(),year:"numeric",month:"2-digit",day:"2-digit"}).format(d);return p}
function addDays(s,n){var d=new Date(s+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
function resize(){try{parent.postMessage({type:"f2b-booking-height",height:document.body.scrollHeight},"*")}catch(e){}}
function initials(n){return String(n||"?").split(/\\s+/).map(function(p){return p[0]||""}).join("").slice(0,2).toUpperCase()}
function attribution(){var a={};["utm_source","utm_medium","utm_campaign","gclid","gbraid","wbraid"].forEach(function(k){var v=qs.get(k);if(v)a[k]=v});var ref=document.referrer||"";try{var ru=new URL(ref);if(ru.host!==location.host){a.referrer=ref;["utm_source","utm_medium","utm_campaign","gclid","gbraid","wbraid"].forEach(function(k){var v=ru.searchParams.get(k);if(v&&!a[k])a[k]=v})}}catch(e){}return a}
function header(){var i=state.info,c=i.calendar,b=i.business;document.documentElement.style.setProperty("--brand",b.color||c.color||"#2563eb");document.title=c.name+" · "+b.name;
 var top=h("div",{class:"top"},[b.logo?h("img",{src:b.logo,alt:b.name}):null,h("div",{},[h("div",{class:"biz",text:b.name}),h("div",{class:"title",text:c.name})])]);
 var meta=h("div",{class:"meta"},[h("span",{class:"pill",text:"⏱ "+c.durationMin+" min"}),c.location?h("span",{class:"pill",text:"📍 "+c.location}):null,c.price?h("span",{class:"pill",text:new Intl.NumberFormat("en-IE",{style:"currency",currency:c.currency||"EUR"}).format(c.price)}):h("span",{class:"pill",text:c.kind==="consultation"?"Free consultation":"No charge to book"})]);
 return [top,meta,c.description?h("div",{class:"desc",text:c.description}):null]}
function render(){app.innerHTML="";var i=state.info;if(!i){app.appendChild(h("div",{class:"skeleton",text:state.error||"Loading…"}));return resize()}
 if(state.done){return renderDone()}
 header().forEach(function(n){if(n)app.appendChild(n)});
 if(MANAGE&&state.booking&&!state.rescheduling){return renderManage()}
 var c=i.calendar;
 if(c.assignMode==="customer_pick"&&i.staff.length>1){var s=h("div",{class:"step"},[h("h2",{text:"1. Who would you like?"})]);var g=h("div",{class:"staff"});
  g.appendChild(h("button",{type:"button",class:"who"+(state.staffId===""?" on":""),on:{click:function(){pickStaff("")}}},[h("div",{class:"av",text:"★"}),h("b",{text:"Anyone available"}),h("small",{text:"Most times"})]));
  i.staff.forEach(function(p){g.appendChild(h("button",{type:"button",class:"who"+(state.staffId===p.id?" on":""),on:{click:function(){pickStaff(p.id)}}},[h("div",{class:"av"},[p.avatar?h("img",{src:p.avatar,alt:""}):document.createTextNode(initials(p.name))]),h("b",{text:p.name}),p.title?h("small",{text:p.title}):null]))});
  s.appendChild(g);app.appendChild(s)}
 else if(c.assignMode==="collective"&&i.staff.length){app.appendChild(h("div",{class:"step"},[h("div",{class:"muted",text:"You'll meet with "+i.staff.map(function(p){return p.name}).join(", ")+"."})]))}
 var n=(c.assignMode==="customer_pick"&&i.staff.length>1)?2:1;
 var step=h("div",{class:"step"},[h("h2",{text:n+". Pick a day"})]);
 var today=localDate(new Date());var ws=state.weekStart;var nav=h("div",{class:"nav"},[h("button",{type:"button",disabled:ws<=today,on:{click:function(){state.weekStart=addDays(ws,-7);loadSlots()}},text:"‹ Earlier"}),h("span",{class:"muted",text:fmt(ws+"T12:00:00Z",{month:"long",year:"numeric"})}),h("button",{type:"button",on:{click:function(){state.weekStart=addDays(ws,7);loadSlots()}},text:"Later ›"})]);
 step.appendChild(nav);var days=h("div",{class:"days"});
 for(var d=0;d<7;d++){(function(date){var list=state.slots[date];var count=list?list.length:null;days.appendChild(h("button",{type:"button",class:"day"+(state.day===date?" on":""),disabled:count===0||count===null&&state.loading,on:{click:function(){state.day=date;state.slot=null;render()}}},[h("small",{text:fmt(date+"T12:00:00Z",{weekday:"short"})}),h("b",{text:fmt(date+"T12:00:00Z",{day:"numeric"})}),h("span",{text:count===null?"…":count?count+" free":"Full"})]))})(addDays(ws,d))}
 step.appendChild(days);app.appendChild(step);
 if(state.day&&state.slots[state.day]&&state.slots[state.day].length){var ts=h("div",{class:"step"},[h("h2",{text:(n+1)+". Pick a time · "+fmt(state.day+"T12:00:00Z",{weekday:"long",day:"numeric",month:"long"})})]);var tg=h("div",{class:"times"});
  state.slots[state.day].forEach(function(sl){tg.appendChild(h("button",{type:"button",class:"time"+(state.slot&&state.slot.start===sl.start?" on":""),on:{click:function(){state.slot=sl;render();var f=document.getElementById("details");if(f)f.scrollIntoView({behavior:"smooth",block:"start"})}},text:fmt(sl.start,{hour:"2-digit",minute:"2-digit"})}))});
  ts.appendChild(tg);ts.appendChild(h("div",{class:"muted",style:"margin-top:8px",text:"Times shown in "+tz().replace("_"," ")+" time."}));app.appendChild(ts)}
 if(state.slot){app.appendChild(MANAGE?renderReschedule(n+2):renderForm(n+2))}
 if(state.error)app.appendChild(h("div",{class:"step"},[h("div",{class:"err",text:state.error})]));
 resize()}
function pickStaff(id){state.staffId=id;state.slot=null;state.slots={};loadSlots()}
function renderForm(n){var c=state.info.calendar;var f=h("form",{id:"details",on:{submit:submit}});
 f.appendChild(h("div",{class:"summary",text:"📅 "+fmt(state.slot.start,{weekday:"long",day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"})}));
 f.appendChild(h("div",{class:"grid2"},[h("label",{},["Your name",h("input",{name:"name",required:true,autocomplete:"name",maxlength:"120"})]),h("label",{},["Phone",h("input",{name:"phone",type:"tel",autocomplete:"tel",maxlength:"40"})])]));
 f.appendChild(h("label",{},["Email",h("input",{name:"email",type:"email",autocomplete:"email",maxlength:"160"})]));
 (c.questions||[]).forEach(function(q){var input=q.type==="textarea"?h("textarea",{name:"q_"+q.id,rows:"3",required:!!q.required,maxlength:"1000"}):q.type==="select"?h("select",{name:"q_"+q.id,required:!!q.required},[h("option",{value:"",text:"Choose…"})].concat((q.options||[]).map(function(o){return h("option",{value:o,text:o})}))):h("input",{name:"q_"+q.id,required:!!q.required,maxlength:"1000"});f.appendChild(h("label",{},[q.label+(q.required?" *":""),input]))});
 f.appendChild(h("label",{},["Anything else we should know?",h("textarea",{name:"notes",rows:"3",maxlength:"2000"})]));
 f.appendChild(h("input",{class:"hp",name:"website",tabindex:"-1",autocomplete:"off","aria-hidden":"true"}));
 f.appendChild(h("button",{class:"btn",type:"submit",disabled:state.busy,text:state.busy?"Booking…":"Confirm booking"}));
 f.appendChild(h("div",{class:"muted",text:"We'll send a confirmation with a link to reschedule or cancel."}));
 return h("div",{class:"step"},[h("h2",{text:n+". Your details"}),f])}
function submit(e){e.preventDefault();var fd=new FormData(e.target);var email=String(fd.get("email")||"").trim(),phone=String(fd.get("phone")||"").trim();if(!email&&!phone){state.error="Please add an email or phone number so we can confirm.";return render()}
 var answers={};(state.info.calendar.questions||[]).forEach(function(q){answers[q.id]=String(fd.get("q_"+q.id)||"")});
 state.busy=true;state.error="";render();
 api("",{action:"book",cal:SLUG,start:state.slot.start,staffId:state.staffId,name:fd.get("name"),email:email,phone:phone,notes:fd.get("notes"),answers:answers,website:fd.get("website"),attribution:attribution(),page:document.referrer||location.href})
 .then(function(r){state.busy=false;if(r.redirectUrl){try{(window.top||window).location.href=r.redirectUrl;return}catch(_){location.href=r.redirectUrl;return}}state.done=r;try{parent.postMessage({type:"f2b-booking-complete",start:r.start},"*")}catch(_){}render()})
 .catch(function(err){state.busy=false;state.error=err.message;if(/taken/i.test(err.message)){state.slot=null;state.slots={};loadSlots()}else render()})}
function renderDone(){var d=state.done,c=state.info.calendar;app.appendChild(h("div",{class:"done"},[h("div",{class:"tick",text:"✓"}),h("div",{class:"title",text:d.cancelled?"Appointment cancelled":d.moved?"Appointment moved":"You're booked in!"}),
 d.cancelled?null:h("p",{text:c.name+" · "+fmt(d.start,{weekday:"long",day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"})+(d.staff&&d.staff.length?" with "+d.staff.join(", "):"")}),
 !d.cancelled&&c.confirmationMessage?h("p",{class:"muted",text:c.confirmationMessage}):null,d.meetLink?h("p",{},[h("a",{href:d.meetLink,target:"_blank",rel:"noopener",text:"Join link (Google Meet)"})]):null,
 d.cancelled?h("a",{class:"btn",href:"/f/book/"+encodeURIComponent(c.slug),text:"Book another time"}):h("p",{class:"muted",text:"A confirmation is on its way. You can reschedule or cancel from the link in it."})]));resize()}
function renderManage(){var b=state.booking;var s=h("div",{class:"step"},[h("h2",{text:"Your appointment"}),h("div",{class:"summary"},[h("div",{text:"📅 "+fmt(b.start,{weekday:"long",day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"})}),b.staff&&b.staff.length?h("div",{text:"👤 With "+b.staff.join(", ")}):null,h("div",{text:"Status: "+(b.status==="booked"?"Confirmed":b.status==="cancelled"?"Cancelled":b.status==="completed"?"Completed":"Missed")})])]);
 if(b.meetLink)s.appendChild(h("p",{},[h("a",{href:b.meetLink,target:"_blank",rel:"noopener",text:"Join link (Google Meet)"})]));
 if(b.canChange){s.appendChild(h("div",{style:"display:flex;gap:10px;flex-wrap:wrap;margin-top:12px"},[h("button",{class:"btn",type:"button",on:{click:function(){state.rescheduling=true;loadSlots()}},text:"Reschedule"}),h("button",{class:"btn ghost",type:"button",disabled:state.busy,on:{click:cancel},text:"Cancel appointment"})]))}
 else if(b.status==="booked")s.appendChild(h("p",{class:"muted",text:"It's too close to the appointment to change it online — please call us."+(state.info.business&&state.info.business.phone?" "+state.info.business.phone:"")}));
 if(state.error)s.appendChild(h("div",{class:"err",text:state.error}));app.appendChild(s);resize()}
function renderReschedule(n){return h("div",{class:"step",id:"details"},[h("h2",{text:n+". Confirm the new time"}),h("div",{class:"summary",text:"📅 "+fmt(state.slot.start,{weekday:"long",day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"})}),h("button",{class:"btn",type:"button",disabled:state.busy,on:{click:function(){state.busy=true;render();api("",{action:"reschedule",token:TOKEN,start:state.slot.start}).then(function(r){state.busy=false;state.done={moved:true,start:r.start,staff:state.booking.staff};render()}).catch(function(err){state.busy=false;state.error=err.message;state.slot=null;state.slots={};loadSlots()})}},text:state.busy?"Saving…":"Move my appointment"})])}
function cancel(){if(!confirm("Cancel this appointment?"))return;state.busy=true;render();api("",{action:"cancel",token:TOKEN}).then(function(){state.busy=false;state.done={cancelled:true};render()}).catch(function(err){state.busy=false;state.error=err.message;render()})}
function loadSlots(){state.loading=true;render();var p="?cal="+encodeURIComponent(state.info.calendar.slug)+"&date="+state.weekStart+"&days=7"+(state.staffId?"&staffId="+encodeURIComponent(state.staffId):"");
 api(p).then(function(r){var by={};for(var d=0;d<7;d++)by[addDays(state.weekStart,d)]=[];(r.slots||[]).forEach(function(s){var k=localDate(new Date(s.start));if(by[k])by[k].push(s)});state.slots=by;state.loading=false;
  if(!state.day||!by[state.day]||!by[state.day].length){state.day=Object.keys(by).filter(function(k){return by[k].length})[0]||""}render()})
 .catch(function(err){state.loading=false;state.error=err.message;render()})}
var first=MANAGE?api("?manage="+encodeURIComponent(TOKEN)).then(function(r){if(!r.calendar||!r.business)throw new Error("This appointment can't be changed online. Please contact us.");state.booking=r.booking;return r}):api("?cal="+encodeURIComponent(SLUG));
first.then(function(r){state.info=r;state.weekStart=localDate(new Date());if(!MANAGE)loadSlots();else render()}).catch(function(err){state.error=err.message;render()});
window.addEventListener("resize",resize);
})();
</script></body></html>`;

export async function GET(request: Request, context: RouteContext) {
  const { slug } = await context.params;
  const manage = slug === "manage";
  if (!manage && !/^[a-z0-9-]{1,64}$/.test(slug)) return new Response("Not found", { status: 404 });
  return new Response(PAGE(manage ? "" : slug, manage), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Content-Security-Policy": "default-src 'self'; img-src 'self' https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors *; base-uri 'none'; form-action 'self'" } });
}
