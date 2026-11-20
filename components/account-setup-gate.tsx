"use client";

import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { ChannelIcon } from "./channel-icon";
import { F2B_MEDIA_MARK_EMAIL_BASE64 } from "@/lib/f2b-media-mark-email";

const WhatsAppSetup = lazy(() => import("./whatsapp-setup").then((m) => ({ default: m.WhatsAppSetup })));

type Item = { id: string; section: "operations" | "messaging" | "business"; name: string; detail: string; linked: boolean; required: boolean; available: boolean; href?: string; action?: "createFeed" | "whatsapp" };
type Setup = { name: string; staffId: string; isOwner: boolean; agencyAdmin: boolean; blocked: boolean; items: Item[] };

const ICONS: Record<string, string> = { calendar: "📅", social: "📣", "google-ads": "📈", "search-console": "🔎", ga4: "📊", "business-profile": "📍", "meta-ads": "📱", "google-drive": "🗂️", gmail: "🧾" };
const SKIP_KEY = "f2b-setup-skip";

/**
 * Shown straight after sign-in. Until every required connection is linked the OS stays closed;
 * once they're all done it opens on its own. Messaging is optional and can be added later.
 */
export function AccountSetupGate({ clients }: { clients: Array<{ id: string; name: string }> }) {
  const [setup, setSetup] = useState<Setup | null | "error">(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [waOpen, setWaOpen] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/account-setup", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) throw new Error();
      const data = await res.json() as Setup;
      setSetup(data);
      if (!data.blocked) setOpen(true);
    } catch { setSetup("error"); setOpen(true); } // never lock anyone out because the check itself failed
  }, []);
  useEffect(() => {
    try { if (sessionStorage.getItem(SKIP_KEY) === "1") setOpen(true); } catch { /* storage blocked */ }
    void load();
    const again = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [load]);

  if (open) return null;
  if (!setup || setup === "error") return <div className="asg-loading" role="status" aria-label="Loading"><style>{CSS}</style><i /></div>;

  const required = setup.items.filter((i) => i.required);
  const left = required.filter((i) => !i.linked).length;
  const pct = required.length ? Math.round(((required.length - left) / required.length) * 100) : 100;
  const makeFeed = async (item: Item) => {
    setBusy(item.id); setNote("");
    try {
      const r = await fetch("/api/scheduling", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "createFeed", staffId: setup.staffId }) });
      const j = await r.json() as { feedUrl?: string; error?: string };
      if (!r.ok || !j.feedUrl) throw new Error(j.error || "Couldn’t create your calendar link.");
      const isIos = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
      if (isIos) window.location.href = j.feedUrl.replace(/^https?:/, "webcal:");
      else { await navigator.clipboard?.writeText(j.feedUrl).catch(() => undefined); setNote("Calendar link copied. In Outlook: Add calendar → From internet → paste."); }
      await load();
    } catch (e) { setNote(e instanceof Error ? e.message : "Couldn’t create your calendar link."); }
    setBusy("");
  };
  const row = (item: Item) => <li key={item.id} className={item.linked ? "on" : !item.available ? "off" : ""}>
    <span className="asg-ico" aria-hidden="true">{item.section === "messaging" ? <ChannelIcon channel={item.id === "msg-whatsapp" ? "whatsapp" : item.id === "msg-instagram" ? "instagram" : "messenger"} size={20} /> : ICONS[item.id] || "🔗"}</span>
    <div className="asg-txt"><b>{item.name}{item.required && !item.linked && <em>Required</em>}</b><small>{item.detail}</small></div>
    <div className="asg-act">
      {item.linked ? <span className="asg-ok">✓ Linked</span> : <>
        {item.href && <a className="asg-btn" href={item.href}>{item.id === "calendar" ? "Google Calendar" : "Connect"}</a>}
        {item.action === "createFeed" && <button type="button" className="asg-ghost" disabled={busy === item.id} onClick={() => void makeFeed(item)}>{busy === item.id ? "…" : "Apple / Outlook"}</button>}
        {item.action === "whatsapp" && <button type="button" className="asg-btn" onClick={() => setWaOpen(true)}>Link or buy number</button>}
      </>}
    </div>
  </li>;
  const ops = setup.items.filter((i) => i.section === "operations");
  const biz = setup.items.filter((i) => i.section === "business");
  const msg = setup.items.filter((i) => i.section === "messaging");
  return <div className="asg" role="dialog" aria-modal="true" aria-label="Set up your account">
    <style>{CSS}</style>
    <div className="asg-card">
      <div className="asg-head"><img src={`data:image/png;base64,${F2B_MEDIA_MARK_EMAIL_BASE64}`} alt="F2B Media" /><div><small>ACCOUNT SETUP</small><h1>Hi {setup.name.split(" ")[0] || "there"}, let’s get you connected</h1><p>Link the essentials below and the workspace opens automatically.</p></div></div>
      <div className="asg-bar" aria-label={`${pct}% done`}><i style={{ width: `${pct}%` }} /></div>
      <p className="asg-count">{left ? `${left} left to link` : "All linked"}</p>

      <section><h2>Operations</h2><p>Calendars and social media for posts.</p><ul>{ops.map(row)}</ul></section>
      {biz.length > 0 && <section><h2>Business connections</h2><p>Only what isn’t linked yet for the agency.</p><ul>{biz.filter((i) => !i.linked).map(row)}{biz.every((i) => i.linked) && <li className="on"><span className="asg-ico">✓</span><div className="asg-txt"><b>Everything’s linked</b></div></li>}</ul></section>}
      <section><h2>Messaging <span className="asg-opt">Optional · add later</span></h2><p>WhatsApp, Instagram and Facebook chats in one inbox.</p><ul>{msg.map(row)}</ul></section>

      {note && <p className="asg-note" role="status">{note}</p>}
      <button type="button" className="asg-btn asg-open" disabled={left > 0} onClick={() => setOpen(true)}>{left > 0 ? `Link ${left} more to open the app` : "Open the app →"}</button>
      <div className="asg-foot"><a href="/logout">Sign out</a>{setup.isOwner && left > 0 && <button type="button" onClick={() => { try { sessionStorage.setItem(SKIP_KEY, "1"); } catch { /* ignore */ } setOpen(true); }}>Skip for now (owner only)</button>}</div>
    </div>
    {waOpen && <Suspense fallback={null}><WhatsAppSetup clients={clients} initialClientId="" onClose={() => { setWaOpen(false); void load(); }} onLive={() => void load()} /></Suspense>}
  </div>;
}

const CSS = `
.asg-loading{position:fixed;inset:0;z-index:2000;display:grid;place-items:center;background:#0b1118}.asg-loading i{width:34px;height:34px;border-radius:50%;border:3px solid rgba(255,255,255,.15);border-top-color:#3d9ad0;animation:asgspin .8s linear infinite}@keyframes asgspin{to{transform:rotate(360deg)}}
.asg{position:fixed;inset:0;z-index:2000;overflow-y:auto;background:#0b1118;background-image:radial-gradient(900px 500px at 10% -10%,rgba(40,124,172,.32),transparent 60%),radial-gradient(700px 500px at 110% 110%,rgba(40,124,172,.2),transparent 60%);color:#eef3f8;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;display:flex;justify-content:center;padding:5vh 14px}
.asg-card{width:min(640px,100%);background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:22px;padding:28px 26px;box-shadow:0 30px 80px rgba(0,0,0,.45);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);height:max-content}
.asg-head{display:flex;gap:14px;align-items:flex-start}.asg-head img{width:46px;height:46px;border-radius:12px;background:#fff;padding:4px;object-fit:contain;flex:none}.asg-head small{font-size:11px;letter-spacing:1.4px;font-weight:800;color:#9fcdf2}.asg-head h1{margin:4px 0 4px;font-size:23px;line-height:1.25}.asg-head p{margin:0;color:#a9b6c3;font-size:14px}
.asg-bar{margin:20px 0 6px;height:8px;border-radius:99px;background:rgba(255,255,255,.1);overflow:hidden}.asg-bar i{display:block;height:100%;background:linear-gradient(90deg,#287cac,#4fb3e8);border-radius:99px;transition:width .4s}
.asg-count{margin:0 0 4px;font-size:12.5px;color:#a9b6c3;font-weight:700}
.asg section{margin-top:18px}.asg h2{font-size:15px;margin:0;display:flex;align-items:center;gap:8px}.asg section>p{margin:3px 0 10px;font-size:13px;color:#9aa8b5}.asg-opt{font-size:11px;font-weight:700;padding:3px 8px;border-radius:99px;background:rgba(255,255,255,.1);color:#c9d4de}
.asg ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.asg li{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:14px;border:1px solid rgba(255,255,255,.1);background:rgba(0,0,0,.18);transition:transform .15s,border-color .15s}.asg li:hover{transform:translateY(-1px);border-color:rgba(61,154,208,.5)}
.asg li.on{border-color:rgba(74,222,128,.45);background:rgba(21,128,61,.14)}.asg li.off{opacity:.6}
.asg-ico{width:36px;height:36px;border-radius:10px;background:rgba(255,255,255,.08);display:grid;place-items:center;font-size:18px;flex:none}
.asg-txt{flex:1;min-width:0}.asg-txt b{font-size:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.asg-txt em{font-style:normal;font-size:10.5px;font-weight:800;letter-spacing:.04em;color:#fbbf24;border:1px solid rgba(251,191,36,.45);border-radius:99px;padding:1px 7px}.asg-txt small{display:block;margin-top:2px;font-size:12.5px;color:#a9b6c3;line-height:1.4}
.asg-act{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.asg-btn{display:inline-flex;align-items:center;justify-content:center;padding:9px 14px;border-radius:10px;border:0;background:#287cac;color:#fff !important;font:inherit;font-size:13px;font-weight:700;text-decoration:none;cursor:pointer;white-space:nowrap;transition:transform .15s,background .15s}.asg-btn:hover{background:#3189bb;transform:translateY(-1px)}.asg-btn:disabled{opacity:.55;cursor:not-allowed;transform:none}
.asg-ghost{padding:8px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.22);background:transparent;color:#eef3f8;font:inherit;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap}.asg-ghost:hover{border-color:#3d9ad0}
.asg-ok{font-size:13px;font-weight:800;color:#86efac;white-space:nowrap}
.asg-note{margin:14px 0 0;font-size:13px;color:#9fcdf2}
.asg-open{width:100%;margin-top:22px;padding:14px;font-size:15px}
.asg-foot{margin-top:14px;display:flex;justify-content:space-between;font-size:13px}.asg-foot a,.asg-foot button{color:#8cc8f0;background:none;border:0;font:inherit;cursor:pointer;text-decoration:none;padding:0}
@media (max-width:600px){.asg{padding:0}.asg-card{border-radius:0;min-height:100%;padding:24px 16px}.asg li{flex-wrap:wrap}.asg-act{width:100%;justify-content:stretch}.asg-act>*{flex:1}}
`;
