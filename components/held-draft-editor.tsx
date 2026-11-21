"use client";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown, LayoutGrid, Plus } from "lucide-react";

// An AI reply waiting for approval (it contains a scheduling link). Click the text to edit it, swap the
// link for another booking calendar or page, or create a custom link, then approve, open the chat or dismiss.
// Used on the Dashboard (AI approvals) and inside the Conversations thread.

type Links = { pages: Array<{ name: string; url: string }>; calendars: Array<{ name: string; url: string; durationMin: number }>; staff?: Array<{ id: string; name: string }>; canCreate?: boolean };

const LINK_RE = /(https?:\/\/\S*\/f\/book\/[^\s)]+|(?<!\S)\/f\/book\/[^\s)]+|https?:\/\/\S*(?:calendly\.com|acuityscheduling\.com|squarespacescheduling\.com|cal\.com)\/[^\s)]*)/i;
const full = (u: string) => u.startsWith("/") && typeof window !== "undefined" ? `${window.location.origin}${u}` : u;
const slugify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "appointment";

/** Put this link in the reply: replaces the booking link already there, otherwise adds it on a new line. */
export function swapBookingLink(text: string, url: string) {
  return LINK_RE.test(text) ? text.replace(LINK_RE, url) : `${text.trim()}\n${url}`.trim();
}

export function HeldDraftEditor({ body, clientId, contactName = "", demo = false, busy = false, compact = false, onApprove, onDismiss, onOpenChat, onError }: {
  body: string; clientId: string; contactName?: string; demo?: boolean; busy?: boolean; compact?: boolean;
  onApprove: (text: string) => void; onDismiss: () => void; onOpenChat?: () => void; onError?: (message: string) => void;
}) {
  const [text, setText] = useState(() => body.replace(LINK_RE, (m) => full(m)));
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [links, setLinks] = useState<Links | null>(null);
  const [custom, setCustom] = useState<null | { name: string; minutes: number; who: string; busy: boolean }>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (editing) { const el = area.current; el?.focus(); el?.setSelectionRange(el.value.length, el.value.length); } }, [editing]);
  const current = (text.match(LINK_RE) || [])[0] || "";

  const openMenu = async () => {
    setMenu((m) => !m);
    if (links) return;
    const sampleLinks = (): Links => { const base = `${window.location.origin}/f/book/`; const name = slugify(contactName ? "studio" : "studio"); void name; const fromBody = (current.match(/\/f\/book\/([a-z0-9-]+?)(?:-consultation|-piercings|-free-quote|-tattoo)?(?:\?.*)?$/i) || [])[1] || "your-business";
      return { pages: [{ name: "All services", url: `${base}${fromBody}` }], calendars: [{ name: "Tattoo session", url: `${base}${fromBody}-tattoo`, durationMin: 120 }, { name: "Free consultation", url: `${base}${fromBody}-consultation`, durationMin: 30 }, { name: "Phone consultation", url: `${base}${fromBody}-phone`, durationMin: 10 }, { name: "Piercings", url: `${base}${fromBody}-piercings`, durationMin: 20 }], staff: [], canCreate: true }; };
    try {
      const r = await fetch(`/api/scheduling?view=links&clientId=${encodeURIComponent(clientId || "agency")}`, { cache: "no-store" });
      const j = r.ok ? await r.json() as Links : null;
      setLinks(j && (j.pages.length || j.calendars.length || !demo) ? j : sampleLinks());
    } catch { setLinks(demo ? sampleLinks() : { pages: [], calendars: [] }); }
  };
  const pick = (url: string) => { setText((t) => swapBookingLink(t, url)); setMenu(false); setCustom(null); };
  const createCustom = async () => {
    if (!custom) return;
    if (demo) { pick(`${window.location.origin}/f/book/${slugify(custom.name)}`); return; }
    const team = (links?.staff || []).map((p) => p.id);
    const staffIds = custom.who === "anyone" ? team : [custom.who];
    if (!staffIds.length) { onError?.("This account has no team members who can take bookings yet. Add one in Team (with an email)."); return; }
    setCustom({ ...custom, busy: true });
    try {
      const r = await fetch(`/api/scheduling?clientId=${encodeURIComponent(clientId || "agency")}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "saveCalendar", calendar: { name: custom.name.trim() || "Appointment", durationMin: custom.minutes, kind: "service", staffIds, assignMode: staffIds.length > 1 ? "round_robin" : "customer_pick", clientId } }) });
      const j = await r.json().catch(() => ({})) as { calendar?: { slug: string; name: string; durationMin: number }; error?: string };
      if (!r.ok || !j.calendar) throw new Error(j.error || "Couldn't create the booking link.");
      const url = `${window.location.origin}/f/book/${j.calendar.slug}`;
      setLinks((l) => l ? { ...l, calendars: [{ name: j.calendar!.name, url, durationMin: j.calendar!.durationMin }, ...l.calendars] } : l);
      pick(url);
    } catch (e) { onError?.(e instanceof Error ? e.message : "Couldn't create the booking link."); setCustom((c) => c && { ...c, busy: false }); }
  };

  return <div className={`hd-edit${compact ? " compact" : ""}`}>
    {editing
      ? <textarea ref={area} className="hd-text" rows={3} value={text} maxLength={1900} onChange={(e) => setText(e.target.value)} onBlur={() => setEditing(false)} aria-label="Edit the reply" />
      : <button type="button" className="hd-text hd-text-view" onClick={() => setEditing(true)} title="Click to edit">{text}</button>}
    <div className="hd-bar">
      <span className="hd-linkpick">
        <button type="button" className="hd-link-btn" aria-haspopup="menu" aria-expanded={menu} onClick={() => void openMenu()}><CalendarDays size={15} aria-hidden="true" /><span>{current ? "Change booking link" : "Add booking link"}</span><ChevronDown size={14} aria-hidden="true" /></button>
        {menu && <><button type="button" className="hd-scrim" aria-label="Close" onClick={() => { setMenu(false); setCustom(null); }} /><div className="hd-menu" role="menu"><b>Booking link</b>
          {!links ? <small>Loading…</small> : <>
            {links.pages.map((l) => <button key={l.url} type="button" role="menuitemradio" aria-checked={full(current) === l.url} className={full(current) === l.url ? "on" : ""} onClick={() => pick(l.url)}><span className="hd-ico page"><LayoutGrid size={15} /></span><span>{l.name}<small>Booking page · all services</small></span></button>)}
            {links.calendars.map((l) => <button key={l.url} type="button" role="menuitemradio" aria-checked={full(current) === l.url} className={full(current) === l.url ? "on" : ""} onClick={() => pick(l.url)}><span className="hd-ico"><CalendarDays size={15} /></span><span>{l.name}<small>Calendar · {l.durationMin} min</small></span></button>)}
            {!links.pages.length && !links.calendars.length && !custom && <small>No booking calendars for this account yet.</small>}
            {(links.canCreate || demo) && !custom && <button type="button" role="menuitem" className="hd-new" onClick={() => setCustom({ name: contactName ? `Appointment for ${contactName.split(" ")[0]}` : "Appointment", minutes: 30, who: "anyone", busy: false })}><span className="hd-ico new"><Plus size={15} /></span><span>Create a custom link<small>Pick a length and who it's with</small></span></button>}
            {custom && <div className="hd-form">
              <label>Name<input value={custom.name} maxLength={120} autoFocus onChange={(e) => setCustom({ ...custom, name: e.target.value })} /></label>
              <div className="hd-row"><label>Length<select value={custom.minutes} onChange={(e) => setCustom({ ...custom, minutes: Number(e.target.value) })}>{[15, 20, 30, 45, 60, 90, 120, 180, 240].map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60} hr${m > 60 ? "s" : ""}`}</option>)}</select></label>
                <label>With<select value={custom.who} onChange={(e) => setCustom({ ...custom, who: e.target.value })}><option value="anyone">Anyone available</option>{(links.staff || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
              <div className="hd-row"><button type="button" className="secondary-button" onClick={() => setCustom(null)}>Back</button><button type="button" className="primary-button" disabled={custom.busy} onClick={() => void createCustom()}>{custom.busy ? "Creating…" : demo ? "Create (sample)" : "Create & use link"}</button></div>
            </div>}
          </>}
        </div></>}
      </span>
      <span className="hd-acts">
        <button type="button" className="hd-ok" disabled={busy || !text.trim()} onClick={() => onApprove(text.trim())}>{busy ? "Sending…" : "Approve & send"}</button>
        {onOpenChat && <button type="button" className="hd-open" onClick={onOpenChat}>Open chat</button>}
        <button type="button" className="hd-no" disabled={busy} onClick={onDismiss}>Dismiss</button>
      </span>
    </div>
  </div>;
}
