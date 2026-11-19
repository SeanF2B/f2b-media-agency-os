"use client";
import { useEffect, useState } from "react";

// Staff onboarding: a link the agency copies from a Team card and sends (WhatsApp, text, email). The teammate
// opens it on their phone or computer, signs in, and sets themselves up in a few taps:
//   Google Calendar sync · Apple / Outlook (iCal) calendar · add the OS to their home screen.

export const staffSetupLink = (staffId: string) => `${window.location.origin}/?setup=${encodeURIComponent(staffId)}`;

/** Copy / share buttons for a Team card. */
export function StaffSetupLinkButtons({ staffId, name }: { staffId: string; name: string }) {
  const [done, setDone] = useState("");
  const link = typeof window === "undefined" ? "" : staffSetupLink(staffId);
  const copy = async (e: React.MouseEvent) => { e.stopPropagation(); try { await navigator.clipboard.writeText(link); setDone("Copied ✓"); } catch { window.prompt("Copy this setup link", link); } window.setTimeout(() => setDone(""), 2200); };
  const share = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const text = `Hi ${name.split(/[\s|]/)[0] || "there"}, here's your link to set up your F2B account (calendar sync and the app on your phone): ${link}`;
    if (navigator.share) { try { await navigator.share({ title: "Set up your F2B account", text, url: link }); return; } catch { /* cancelled */ } }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  };
  return <div className="ssu-btns">
    <style>{BTN_CSS}</style>
    <button type="button" onClick={copy} title="Copy a link this person opens to set up their calendar and the app">{done || "Copy setup link"}</button>
    <button type="button" onClick={share} title="Send by WhatsApp, text or email">Send</button>
  </div>;
}

type Me = { id: string; name: string; email: string };
type Person = { id: string; google?: string; feedUrl?: string; canEdit?: boolean };

/** Opens when the app is loaded with ?setup=… : guided setup for the signed-in teammate. */
export function StaffSetup({ me, onClose }: { me: Me; onClose: () => void }) {
  const [person, setPerson] = useState<Person | null>(null);
  const [googleOk, setGoogleOk] = useState(true);
  const [feed, setFeed] = useState("");
  const [msg, setMsg] = useState("");
  const isIos = typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isAndroid = typeof navigator !== "undefined" && /Android/.test(navigator.userAgent);
  useEffect(() => {
    let live = true;
    fetch("/api/scheduling", { cache: "no-store" }).then((r) => r.json()).then((j: { staff?: Person[]; googleAvailable?: boolean }) => {
      if (!live) return; const p = (j.staff || []).find((s) => s.id === me.id) || { id: me.id }; setPerson(p); setFeed(p.feedUrl || ""); setGoogleOk(j.googleAvailable !== false);
    }).catch(() => { if (live) setPerson({ id: me.id }); });
    return () => { live = false; };
  }, [me.id]);
  const makeFeed = async () => {
    setMsg("");
    try { const r = await fetch("/api/scheduling", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "createFeed", staffId: me.id }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || "Couldn’t create the calendar link."); setFeed(j.feedUrl); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Couldn’t create the calendar link."); }
  };
  const webcal = feed.replace(/^https?:/, "webcal:");
  const first = me.name.split(/[\s|]/)[0] || "there";
  return <div className="ssu-overlay" role="dialog" aria-modal="true" aria-label="Set up your account">
    <style>{CSS}</style>
    <div className="ssu">
      <button type="button" className="ssu-x" aria-label="Close" onClick={onClose}>×</button>
      <small>WELCOME</small>
      <h2>Hi {first}, let’s set you up</h2>
      <p className="ssu-lead">Three quick steps. You can do them on your phone right now.</p>

      <ol className="ssu-steps">
        <li className={person?.google ? "done" : ""}>
          <b>1 · Sync your Google Calendar</b>
          <p>Appointments booked for you show in your Google Calendar, and your busy times stop double bookings.</p>
          {person?.google ? <span className="ssu-ok">✓ Connected as {person.google}</span> : googleOk ? <a className="ssu-btn" href={`/api/scheduling?connect=${encodeURIComponent(me.id)}`}>Connect Google Calendar</a> : <span className="ssu-muted">Google Calendar isn’t available yet. Use step 2 instead.</span>}
        </li>
        <li className={feed ? "done" : ""}>
          <b>2 · Apple or Outlook calendar</b>
          <p>Use this if you use the iPhone Calendar or Outlook. Your bookings appear there automatically.</p>
          {!feed ? <button type="button" className="ssu-btn" onClick={makeFeed}>Create my calendar link</button> : <div className="ssu-row">
            <a className="ssu-btn" href={webcal}>{isIos ? "Add to iPhone Calendar" : "Add to my calendar"}</a>
            <button type="button" className="ssu-ghost" onClick={() => { void navigator.clipboard?.writeText(feed); setMsg("Calendar link copied ✓ Paste it into Outlook → Add calendar → From internet."); }}>Copy link (Outlook)</button>
          </div>}
          {msg && <span className="ssu-muted">{msg}</span>}
        </li>
        <li>
          <b>3 · Put the app on your phone</b>
          {isIos ? <p>Tap the <b>Share</b> button in Safari, then <b>Add to Home Screen</b>. It opens like an app.</p> : isAndroid ? <p>Tap the <b>⋮</b> menu in Chrome, then <b>Add to Home screen</b> (or <b>Install app</b>).</p> : <p>Open this same link on your phone, then add it to your home screen from the browser menu.</p>}
        </li>
      </ol>
      <button type="button" className="ssu-btn ssu-done" onClick={onClose}>I’m done, take me to the OS</button>
    </div>
  </div>;
}

const BTN_CSS = `
.ssu-btns{display:flex;gap:6px;margin:8px 0 2px}
.ssu-btns button{flex:1;font:inherit;font-size:12.5px;font-weight:700;padding:7px 10px;border-radius:999px;border:1px solid rgba(127,127,127,.28);background:transparent;color:inherit;cursor:pointer;transition:transform .15s,border-color .15s}
.ssu-btns button:first-child{background:var(--brand-primary,#101828);color:#fff;border-color:transparent}
.ssu-btns button:hover{transform:translateY(-1px);border-color:var(--brand-primary,#101828)}
`;
const CSS = `
.ssu-overlay{position:fixed;inset:0;z-index:1200;background:rgba(16,24,40,.5);display:flex;align-items:flex-start;justify-content:center;padding:6vh 14px;overflow-y:auto}
.ssu{position:relative;width:min(520px,100%);background:#fff;color:#101828;border-radius:22px;padding:24px 22px 22px;box-shadow:0 24px 60px rgba(16,24,40,.3);display:flex;flex-direction:column;gap:10px}
body.f2b-dark .ssu,.dark-mode .ssu{background:#161b21;color:#e7ebef}
.ssu small{font-size:11px;font-weight:800;letter-spacing:.08em;opacity:.55}
.ssu h2{margin:0;font-size:24px;font-weight:800}
.ssu .ssu-lead{margin:0;font-size:14px;opacity:.75}
.ssu-x{position:absolute;top:14px;right:14px;width:34px;height:34px;border-radius:999px;border:1px solid rgba(127,127,127,.25);background:transparent;color:inherit;font-size:20px;cursor:pointer}
.ssu-steps{list-style:none;margin:6px 0;padding:0;display:flex;flex-direction:column;gap:10px}
.ssu-steps li{border:1px solid rgba(127,127,127,.18);border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:8px;align-items:flex-start}
.ssu-steps li.done{border-color:#86efac;background:#f0fdf4}
body.f2b-dark .ssu-steps li.done,.dark-mode .ssu-steps li.done{background:rgba(21,128,61,.14)}
.ssu-steps b{font-size:15px}.ssu-steps p{margin:0;font-size:13.5px;opacity:.8;line-height:1.45}
.ssu-row{display:flex;flex-wrap:wrap;gap:8px}
.ssu-btn{display:inline-flex;align-items:center;justify-content:center;padding:11px 18px;border-radius:999px;border:0;background:var(--brand-primary,#101828);color:#fff !important;font:inherit;font-size:14px;font-weight:700;text-decoration:none;cursor:pointer}
.ssu-ghost{padding:10px 16px;border-radius:999px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;font:inherit;font-size:14px;font-weight:600;cursor:pointer}
.ssu-ok{font-size:13.5px;font-weight:700;color:#15803d}.ssu-muted{font-size:12.5px;opacity:.7}
.ssu-done{width:100%;margin-top:4px;padding:14px}
@media (max-width:600px){.ssu-overlay{padding:0}.ssu{border-radius:0;min-height:100%;padding:56px 18px 28px}.ssu-btn,.ssu-ghost{width:100%}}
`;
