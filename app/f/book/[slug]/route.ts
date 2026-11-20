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
.rate{display:block;margin-top:4px;font-size:12px;font-weight:700;color:#b45309}
.profile{margin-top:14px;border:1px solid var(--line);border-radius:16px;padding:14px;display:grid;gap:10px;background:var(--bg)}
.profile-top{display:flex;gap:10px;align-items:center}.profile-top>div:last-child{display:grid}.profile-top small{color:var(--muted);font-size:12px}
.av.sm{width:46px;height:46px;margin:0;font-size:16px}.bio{margin:0;color:#334155;font-size:14px;line-height:1.5}
.photos{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}.photos a{flex:0 0 auto}.photos img{width:120px;height:90px;object-fit:cover;border-radius:10px;display:block}
.reviews{display:grid;gap:8px}.review{background:#fff;border:1px solid var(--line);border-radius:12px;padding:10px 12px}.review>div{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.review small{color:var(--muted);font-size:11px}.review p{margin:6px 0 0;font-size:14px;line-height:1.5;color:#334155}
.wz-bar{height:5px;background:var(--line);border-radius:99px;margin:16px 22px 0;overflow:hidden}.wz-bar i{display:block;height:100%;background:var(--brand);border-radius:99px;transition:width .35s ease}
.wz{padding:22px 22px 26px;animation:wzin .28s ease}@keyframes wzin{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.wz-q{font-size:22px;font-weight:800;margin:0 0 6px;line-height:1.25}.wz-hint{color:var(--muted);font-size:14px;margin:0 0 16px}
.wz input,.wz textarea,.wz select{font-size:17px;padding:14px 14px;border-radius:14px}
.wz-nav{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:18px}.wz-back{border:0;background:none;color:var(--muted);font:inherit;font-weight:700;cursor:pointer;padding:8px 0}.wz-back:hover{color:var(--ink)}
.wz-next{min-width:140px}.wz-skip{border:0;background:none;color:var(--brand);font:inherit;font-weight:700;cursor:pointer}
.wz-sum{display:grid;gap:8px;background:var(--bg);border:1px solid var(--line);border-radius:16px;padding:14px 16px;font-size:15px}.wz-sum div{display:flex;gap:10px}.wz-sum b{min-width:72px;color:var(--muted);font-weight:700}
.wz-step{font-size:12px;font-weight:800;letter-spacing:.06em;color:var(--brand);text-transform:uppercase;margin-bottom:6px}
.sample-tag{display:inline-block;margin:12px 22px 0;background:#fff7ed;color:#9a3412;border:1px solid #fdba74;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:700}
.svc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}.svc{display:flex;flex-direction:column;text-align:left;border:1.5px solid var(--line);border-radius:18px;background:#fff;overflow:hidden;cursor:pointer;font:inherit;color:inherit;padding:0;text-decoration:none;transition:.15s}.svc:hover{border-color:var(--brand);transform:translateY(-2px);box-shadow:0 10px 26px color-mix(in srgb,var(--brand) 16%,transparent)}.svc-img{aspect-ratio:16/9;background:color-mix(in srgb,var(--brand) 12%,#fff);display:grid;place-items:center;font-size:30px;font-weight:800;color:var(--brand)}.svc-img img{width:100%;height:100%;object-fit:cover;display:block}.svc-body{padding:12px 14px 14px;display:grid;gap:6px}.svc-body b{font-size:16px}.svc-body p{margin:0;color:#475569;font-size:13.5px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.svc-meta{display:flex;flex-wrap:wrap;gap:6px}.svc-meta span{font-size:12px;background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:3px 9px;color:#334155}.svc-team{display:flex;align-items:center;margin-top:2px}.svc-team i{width:26px;height:26px;border-radius:50%;border:2px solid #fff;margin-left:-6px;background:color-mix(in srgb,var(--brand) 16%,#fff);color:var(--brand);display:grid;place-items:center;font-style:normal;font-size:10px;font-weight:800;overflow:hidden}.svc-team i:first-child{margin-left:0}.svc-team img{width:100%;height:100%;object-fit:cover}.back{display:inline-block;margin:14px 22px 0;color:var(--brand);font-weight:700;font-size:14px;text-decoration:none}
.stars{color:#f59e0b;letter-spacing:1px;font-size:13px}.more{border:0;background:none;color:var(--brand);font:inherit;font-weight:700;cursor:pointer;justify-self:start;padding:0}
</style></head><body><div class="wrap"><div class="card" id="app"><div class="skeleton">Loading…</div></div><div class="foot">Secure booking · powered by F2B Media</div></div>
<script>
(function(){
var SLUG=${JSON.stringify(slug)},MANAGE=${manage ? "true" : "false"};
var API="/api/marketing-public/scheduling";var app=document.getElementById("app");
var qs=new URLSearchParams(location.search);var TOKEN=qs.get("t")||"";
var SAMPLE=qs.get("sample")==="1";var DEMO=null;try{if(SAMPLE&&qs.get("demo"))DEMO=JSON.parse(decodeURIComponent(escape(atob(qs.get("demo")))))}catch(e){DEMO=null}
var DEMO_REV=[["Aoife B.","Honestly the best experience, so friendly and really took the time to get it right."],["Ciarán D.","Brilliant from start to finish. Would recommend to anyone."],["Megan W.","Super professional, on time and the result was even better than I hoped."]];
function demoInfo(){var d=DEMO;return {sample:true,business:{name:(d.b&&d.b.name)||"Your business",logo:"",color:(d.b&&d.b.color)||"#2563eb",phone:""},calendar:Object.assign({slug:SLUG,kind:"service",description:"",durationMin:30,location:"",price:0,currency:"EUR",color:"#2563eb",assignMode:"customer_pick",questions:[],timezone:"Europe/Dublin",maxDaysAhead:60,confirmationMessage:""},d.c||{}),staff:(d.s||[]).map(function(p){return {id:p.id,name:p.name,avatar:p.avatar||"",title:p.title||"",profile:{title:p.title||"",bio:"",photos:[],reviews:DEMO_REV.map(function(r){return {author:r[0],rating:5,text:r[1],source:"Google"}}),reviewCount:3,rating:5}}})}}
function demoSlots(){var by={};for(var d=0;d<7;d++){var day=addDays(state.weekStart,d);by[day]=[];var dt=new Date(day+"T12:00:00Z");var wd=dt.getUTCDay();if(wd===0)continue;[9,10,11,13,14,15,16].forEach(function(hh,k){if((d+k)%3===0)return;var t=new Date(day+"T"+(hh<10?"0":"")+hh+":"+((d+hh)%2?"30":"00")+":00");if(t.getTime()>Date.now()+3600000)by[day].push({start:t.toISOString(),staffIds:[]})})}return by}var state={wz:0,ans:{},info:null,staffId:"",weekStart:null,slots:{},day:"",slot:null,booking:null,busy:false,error:""};
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
var BACK=(qs.get("back")||"").replace(/[^a-z0-9-]/g,"").slice(0,64);
function keepQs(extra){var q=new URLSearchParams(location.search);q.delete("back");q.delete("t");if(extra)q.set("back",extra);var t=q.toString();return t?"?"+t:""}
function money(n,c){try{return new Intl.NumberFormat("en-IE",{style:"currency",currency:c||"EUR",maximumFractionDigits:n%1?2:0}).format(n)}catch(e){return n+" "+(c||"")}}
function renderGroup(){var g=state.group,b=g.business;document.documentElement.style.setProperty("--brand",b.color||"#2563eb");document.title=g.group.name+" · "+b.name;app.innerHTML="";
 app.appendChild(h("div",{class:"top"},[b.logo?h("img",{src:b.logo,alt:b.name}):null,h("div",{},[h("div",{class:"biz",text:b.name}),h("div",{class:"title",text:g.group.name})])]));
 if(g.group.intro)app.appendChild(h("div",{class:"desc",text:g.group.intro}));
 var grid=h("div",{class:"svc-grid"},g.services.map(function(sv){var team=h("div",{class:"svc-team"},sv.staff.map(function(p){return h("i",{title:p.name},[p.avatar?h("img",{src:p.avatar,alt:p.name}):document.createTextNode(initials(p.name))])}));
  return h("a",{class:"svc",href:"/f/book/"+encodeURIComponent(sv.slug)+keepQs(g.group.slug)},[h("div",{class:"svc-img"},[sv.image?h("img",{src:sv.image,alt:sv.name}):document.createTextNode(initials(sv.name))]),h("div",{class:"svc-body"},[h("b",{text:sv.name}),sv.description?h("p",{text:sv.description}):null,h("div",{class:"svc-meta"},[h("span",{text:"⏱ "+sv.durationMin+" min"}),sv.price>0?h("span",{text:money(sv.price,sv.currency)}):null,sv.location?h("span",{text:sv.location}):null]),sv.staff.length?team:null])])}));
 app.appendChild(h("div",{class:"step"},[h("h2",{text:g.services.length?"1. Choose a service":"No services are open for booking right now."}),grid]));resize()}
function render(){if(state.group&&!state.info)return renderGroup();app.innerHTML="";var i=state.info;if(!i){app.appendChild(h("div",{class:"skeleton",text:state.error||"Loading…"}));return resize()}
 if(BACK&&!MANAGE)app.appendChild(h("a",{class:"back",href:"/f/book/"+BACK+keepQs(""),text:"← All services"}));
 if(state.done){return renderDone()}
 header().forEach(function(n){if(n)app.appendChild(n)});
 if(MANAGE&&state.booking&&!state.rescheduling){return renderManage()}
 if(!MANAGE)return renderWizard();
 var c=i.calendar;
 if(c.assignMode==="customer_pick"&&i.staff.length>1){var s=h("div",{class:"step"},[h("h2",{text:"1. Who would you like?"})]);var g=h("div",{class:"staff"});
  g.appendChild(h("button",{type:"button",class:"who"+(state.staffId===""?" on":""),on:{click:function(){pickStaff("")}}},[h("div",{class:"av",text:"★"}),h("b",{text:"Anyone available"}),h("small",{text:"Most times"})]));
  i.staff.forEach(function(p){var pr=p.profile;g.appendChild(h("button",{type:"button",class:"who"+(state.staffId===p.id?" on":""),on:{click:function(){pickStaff(p.id)}}},[h("div",{class:"av"},[p.avatar?h("img",{src:p.avatar,alt:""}):document.createTextNode(initials(p.name))]),h("b",{text:p.name}),p.title?h("small",{text:p.title}):null,pr&&pr.reviewCount?h("span",{class:"rate",text:"★ "+pr.rating.toFixed(1)+" · "+pr.reviewCount+" review"+(pr.reviewCount===1?"":"s")}):null]))});
  s.appendChild(g);var chosen=i.staff.filter(function(p){return p.id===state.staffId})[0];if(chosen&&chosen.profile)s.appendChild(profilePanel(chosen));app.appendChild(s)}
 else if(i.staff.length===1&&i.staff[0].profile){app.appendChild(h("div",{class:"step"},[profilePanel(i.staff[0])]))}
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
// ---- One question at a time (new booking flow) ----
function wzSteps(){var i=state.info,c=i.calendar,list=[];if(c.assignMode==="customer_pick"&&i.staff.length>1)list.push({k:"staff"});list.push({k:"day"},{k:"time"},{k:"name",q:"What's your name?",type:"text",auto:"name",req:true},{k:"phone",q:"What's the best number to reach you?",hint:"For a reminder and if we need to get in touch.",type:"tel",auto:"tel"},{k:"email",q:"And your email?",hint:"We'll send your confirmation here. Phone or email is needed.",type:"email",auto:"email"});
 (c.questions||[]).forEach(function(q){list.push({k:"q_"+q.id,q:q.label,type:q.type||"text",req:!!q.required,options:q.options||[]})});list.push({k:"notes",q:"Anything else we should know?",hint:"Optional.",type:"textarea"},{k:"confirm"});return list}
function wzGo(n){var steps=wzSteps();state.wz=Math.max(0,Math.min(steps.length-1,n));state.error="";render();try{app.scrollIntoView({block:"start",behavior:"smooth"})}catch(e){}}
function wzFrame(steps,title,hint,body,nav){var pct=Math.round((state.wz+1)/steps.length*100);app.appendChild(h("div",{class:"wz-bar"},[h("i",{style:"width:"+pct+"%"})]));
 var box=h("div",{class:"wz"},[h("div",{class:"wz-step",text:"Step "+(state.wz+1)+" of "+steps.length}),h("h2",{class:"wz-q",text:title}),hint?h("p",{class:"wz-hint",text:hint}):null,body,state.error?h("div",{class:"err",style:"margin-top:12px",text:state.error}):null,nav]);app.appendChild(box);resize()}
function wzNav(next,label,disabled,skip){return h("div",{class:"wz-nav"},[state.wz>0?h("button",{type:"button",class:"wz-back",on:{click:function(){wzGo(state.wz-1)}},text:"← Back"}):h("span"),h("span",{style:"display:flex;gap:14px;align-items:center"},[skip?h("button",{type:"button",class:"wz-skip",on:{click:skip},text:"Skip"}):null,next?h("button",{type:"button",class:"btn wz-next",disabled:!!disabled,on:{click:next},text:label||"Next"}):null])])}
function renderWizard(){var i=state.info,c=i.calendar,steps=wzSteps();if(state.wz>=steps.length)state.wz=steps.length-1;var st=steps[state.wz];
 if(SAMPLE)app.appendChild(h("span",{class:"sample-tag",text:"Sample preview · nothing is booked"}));
 if(st.k==="staff"){var g=h("div",{class:"staff"});g.appendChild(h("button",{type:"button",class:"who"+(state.staffId===""&&state.pickedStaff?" on":""),on:{click:function(){state.pickedStaff=true;pickStaff("")}}},[h("div",{class:"av",text:"★"}),h("b",{text:"Anyone available"}),h("small",{text:"Most times"})]));
  i.staff.forEach(function(p){var pr=p.profile;g.appendChild(h("button",{type:"button",class:"who"+(state.staffId===p.id?" on":""),on:{click:function(){state.pickedStaff=true;pickStaff(p.id)}}},[h("div",{class:"av"},[p.avatar?h("img",{src:p.avatar,alt:""}):document.createTextNode(initials(p.name))]),h("b",{text:p.name}),p.title?h("small",{text:p.title}):null,pr&&pr.reviewCount?h("span",{class:"rate",text:"★ "+pr.rating.toFixed(1)+" · "+pr.reviewCount+" review"+(pr.reviewCount===1?"":"s")}):null]))});
  var chosen=i.staff.filter(function(p){return p.id===state.staffId})[0];var body=h("div",{},[g,chosen&&chosen.profile?profilePanel(chosen):null]);
  return wzFrame(steps,"Who would you like to see?","Tap someone to see their reviews and work.",body,wzNav(function(){wzGo(state.wz+1)},chosen?"Continue with "+chosen.name.split(" ")[0]:"Continue",!state.pickedStaff))}
 if(st.k==="day"){var today=localDate(new Date()),ws=state.weekStart;var nav=h("div",{class:"nav"},[h("button",{type:"button",disabled:ws<=today,on:{click:function(){state.weekStart=addDays(ws,-7);loadSlots()}},text:"‹ Earlier"}),h("span",{class:"muted",text:fmt(ws+"T12:00:00Z",{month:"long",year:"numeric"})}),h("button",{type:"button",on:{click:function(){state.weekStart=addDays(ws,7);loadSlots()}},text:"Later ›"})]);var days=h("div",{class:"days"});
  for(var d=0;d<7;d++){(function(date){var list=state.slots[date];var count=list?list.length:null;days.appendChild(h("button",{type:"button",class:"day"+(state.day===date?" on":""),disabled:count===0||count===null&&state.loading,on:{click:function(){state.day=date;state.slot=null;wzGo(state.wz+1)}}},[h("small",{text:fmt(date+"T12:00:00Z",{weekday:"short"})}),h("b",{text:fmt(date+"T12:00:00Z",{day:"numeric"})}),h("span",{text:count===null?"…":count?count+" free":"Full"})]))})(addDays(ws,d))}
  return wzFrame(steps,"Which day suits you?",c.name+" · "+c.durationMin+" min",h("div",{},[nav,days]),wzNav(null))}
 if(st.k==="time"){var slots=(state.slots[state.day]||[]);var tg=h("div",{class:"times"});slots.forEach(function(sl){tg.appendChild(h("button",{type:"button",class:"time"+(state.slot&&state.slot.start===sl.start?" on":""),on:{click:function(){state.slot=sl;wzGo(state.wz+1)}},text:fmt(sl.start,{hour:"2-digit",minute:"2-digit"})}))});
  return wzFrame(steps,"What time on "+(state.day?fmt(state.day+"T12:00:00Z",{weekday:"long",day:"numeric",month:"long"}):"that day")+"?","Times shown in "+tz().replace("_"," ")+" time.",slots.length?tg:h("p",{class:"muted",text:"No times left that day. Go back and pick another."}),wzNav(null))}
 if(st.k==="confirm"){var who=i.staff.filter(function(p){return p.id===state.staffId})[0];var a=state.ans;
  var sum=h("div",{class:"wz-sum"},[h("div",{},[h("b",{text:"When"}),h("span",{text:state.slot?fmt(state.slot.start,{weekday:"long",day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"}):"—"})]),h("div",{},[h("b",{text:"What"}),h("span",{text:c.name+" · "+c.durationMin+" min"})]),who?h("div",{},[h("b",{text:"With"}),h("span",{text:who.name})]):null,h("div",{},[h("b",{text:"Name"}),h("span",{text:a.name||""})]),a.phone?h("div",{},[h("b",{text:"Phone"}),h("span",{text:a.phone})]):null,a.email?h("div",{},[h("b",{text:"Email"}),h("span",{text:a.email})]):null]);
  return wzFrame(steps,"All good?","Check your details, then confirm.",h("div",{},[sum,h("input",{class:"hp",id:"hpw",tabindex:"-1",autocomplete:"off","aria-hidden":"true"})]),wzNav(submitWizard,state.busy?"Booking…":"Confirm booking",state.busy||!state.slot))}
 // a single question
 var val=state.ans[st.k]||"";var input;
 if(st.type==="textarea")input=h("textarea",{rows:"4",maxlength:"2000"});
 else if(st.type==="select"){input=h("select",{},[h("option",{value:"",text:"Choose…"})].concat(st.options.map(function(o){return h("option",{value:o,text:o})})))}
 else input=h("input",{type:st.type==="tel"?"tel":st.type==="email"?"email":"text",autocomplete:st.auto||"off",maxlength:"160"});
 input.value=val;input.addEventListener("input",function(){state.ans[st.k]=input.value});
 var go=function(){var v=String(state.ans[st.k]||"").trim();if(st.req&&!v){state.error="Please fill this in.";return render()}if(st.type==="email"&&v&&!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(v)){state.error="That email doesn't look right.";return render()}
  if(st.k==="email"&&!v&&!String(state.ans.phone||"").trim()){state.error="Please add an email or a phone number so we can confirm.";return render()}wzGo(state.wz+1)};
 input.addEventListener("keydown",function(e){if(e.key==="Enter"&&st.type!=="textarea"){e.preventDefault();go()}});
 wzFrame(steps,st.q,st.hint||"",input,wzNav(go,"Next",false,st.req?null:function(){state.ans[st.k]="";go()}));
 setTimeout(function(){try{input.focus({preventScroll:true})}catch(e){}},50)}
function submitWizard(){var a=state.ans,hp=document.getElementById("hpw");if(!state.slot)return;
 if(SAMPLE){state.done={start:state.slot.start,staff:state.info.staff.filter(function(p){return p.id===state.staffId}).map(function(p){return p.name})};return render()}
 var answers={};(state.info.calendar.questions||[]).forEach(function(q){answers[q.id]=String(a["q_"+q.id]||"")});state.busy=true;state.error="";render();
 api("",{action:"book",cal:SLUG,start:state.slot.start,staffId:state.staffId,name:a.name||"",email:String(a.email||"").trim(),phone:String(a.phone||"").trim(),notes:a.notes||"",answers:answers,website:hp?hp.value:"",attribution:attribution(),page:document.referrer||location.href})
 .then(function(r){state.busy=false;if(r.redirectUrl){try{(window.top||window).location.href=r.redirectUrl;return}catch(_){location.href=r.redirectUrl;return}}state.done=r;try{parent.postMessage({type:"f2b-booking-complete",start:r.start},"*")}catch(_){}render()})
 .catch(function(err){state.busy=false;state.error=err.message;if(/taken/i.test(err.message)){state.slot=null;state.slots={};var steps=wzSteps();for(var k=0;k<steps.length;k++)if(steps[k].k==="day"){state.wz=k;break}loadSlots()}else render()})}
function stars(n){return "★★★★★".slice(0,n)+"☆☆☆☆☆".slice(0,5-n)}
function profilePanel(p){var pr=p.profile,box=h("div",{class:"profile"});
 box.appendChild(h("div",{class:"profile-top"},[h("div",{class:"av sm"},[p.avatar?h("img",{src:p.avatar,alt:""}):document.createTextNode(initials(p.name))]),h("div",{},[h("b",{text:p.name}),pr.title?h("small",{text:pr.title}):null,pr.reviewCount?h("span",{class:"rate",text:"★ "+pr.rating.toFixed(1)+" from "+pr.reviewCount+" review"+(pr.reviewCount===1?"":"s")}):null])]));
 if(pr.bio)box.appendChild(h("p",{class:"bio",text:pr.bio}));
 if(pr.photos&&pr.photos.length){var strip=h("div",{class:"photos"});pr.photos.forEach(function(ph){strip.appendChild(h("a",{href:ph.url,target:"_blank",rel:"noopener",title:ph.caption||""},[h("img",{src:ph.url,alt:ph.caption||("Work by "+p.name),loading:"lazy"})]))});box.appendChild(strip)}
 if(pr.reviews&&pr.reviews.length){var list=h("div",{class:"reviews"});var shown=state.allReviews?pr.reviews:pr.reviews.slice(0,3);shown.forEach(function(r){list.appendChild(h("div",{class:"review"},[h("div",{},[h("b",{text:r.author||"Customer"}),h("span",{class:"stars",text:stars(r.rating)}),r.source?h("small",{text:r.source}):null]),r.text?h("p",{text:r.text}):null]))});box.appendChild(list);if(pr.reviews.length>3&&!state.allReviews)box.appendChild(h("button",{type:"button",class:"more",on:{click:function(){state.allReviews=true;render()}},text:"Show all "+pr.reviews.length+" reviews"}))}
 return box}
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
function loadSlots(){if(DEMO){state.slots=demoSlots();state.loading=false;if(!state.day||!state.slots[state.day]||!state.slots[state.day].length){state.day=Object.keys(state.slots).filter(function(k){return state.slots[k].length})[0]||""}return render()}state.loading=true;render();var p="?cal="+encodeURIComponent(state.info.calendar.slug)+"&date="+state.weekStart+"&days=7"+(state.staffId?"&staffId="+encodeURIComponent(state.staffId):"")+(SAMPLE?"&sample=1":"");
 api(p).then(function(r){var by={};for(var d=0;d<7;d++)by[addDays(state.weekStart,d)]=[];(r.slots||[]).forEach(function(s){var k=localDate(new Date(s.start));if(by[k])by[k].push(s)});state.slots=by;state.loading=false;
  if(!state.day||!by[state.day]||!by[state.day].length){state.day=Object.keys(by).filter(function(k){return by[k].length})[0]||""}render()})
 .catch(function(err){state.loading=false;state.error=err.message;render()})}
var first=MANAGE?api("?manage="+encodeURIComponent(TOKEN)).then(function(r){if(!r.calendar||!r.business)throw new Error("This appointment can't be changed online. Please contact us.");state.booking=r.booking;return r}):(DEMO?Promise.resolve(demoInfo()):api("?cal="+encodeURIComponent(SLUG)+(SAMPLE?"&sample=1":"")));
first.then(function(r){state.info=r;state.weekStart=localDate(new Date());var pre=qs.get("staff");if(pre&&r.staff&&r.staff.some(function(p){return p.id===pre}))state.staffId=pre;if(!MANAGE)loadSlots();else render()}).catch(function(err){
 // Not a single calendar: maybe a booking page (several services under one link).
 if(MANAGE){state.error=err.message;return render()}
 api("?group="+encodeURIComponent(SLUG)).then(function(g){state.group=g;render()}).catch(function(){state.error=err.message;render()})});
window.addEventListener("resize",resize);
})();
</script></body></html>`;

export async function GET(request: Request, context: RouteContext) {
  const { slug } = await context.params;
  const manage = slug === "manage";
  if (!manage && !/^[a-z0-9-]{1,64}$/.test(slug)) return new Response("Not found", { status: 404 });
  return new Response(PAGE(manage ? "" : slug, manage), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Content-Security-Policy": "default-src 'self'; img-src 'self' https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors *; base-uri 'none'; form-action 'self'" } });
}
