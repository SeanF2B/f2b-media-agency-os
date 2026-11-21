"use client";
// AI approvals as visual cards: who asked, what they asked, a preview of the booking the AI wants to send
// (service, length, price, staff faces), and a click-to-open pop-up with the conversation so far, where the
// reply can be edited, approved or dismissed.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { HeldDraftEditor } from "./held-draft-editor";

export type HeldCardItem = { id: string; threadId: string; body: string; name: string; channel: string; clientId: string; reason?: string; ask?: string; demo?: boolean; at?: string; minsAgo?: number };
type Cal = { id: string; name: string; slug: string; durationMin: number; price: number; currency?: string; color?: string; staffIds: string[] };
type Grp = { name: string; slug: string; calendarIds: string[] };
type Person = { id: string; name: string; avatar?: string };
type Preview = { name: string; durationMin?: number; price?: number; currency?: string; color?: string; staff: Person[] };
type Msg = { id: string; direction: string; sender?: string; body: string; created_at?: string };

const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Facebook", sms: "SMS", email: "Email" };
const money = (n: number, cur = "EUR") => { try { return new Intl.NumberFormat("en-IE", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n); } catch { return `€${n}`; } };
const slugOf = (body: string) => (body.match(/\/f\/book\/([a-z0-9-]+)/i) || [])[1] || "";
const ago = (h: HeldCardItem) => { const mins = h.minsAgo ?? (h.at ? Math.max(0, Math.round((Date.now() - Date.parse(h.at)) / 60000)) : 0); return mins < 60 ? `${mins || 1}m ago` : mins < 1440 ? `${Math.round(mins / 60)}h ago` : `${Math.round(mins / 1440)}d ago`; };
const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

/** Booking calendars + staff for an account (real), or the client's own team from their website (sample). */
function useBookingData(clientId: string, demo: boolean) {
  const [d, setD] = useState<{ calendars: Cal[]; groups: Grp[]; staff: Person[] } | null>(null);
  useEffect(() => {
    let live = true;
    const id = encodeURIComponent(clientId || "agency");
    const load = demo
      ? fetch(`/api/scheduling?clientId=${id}&view=site`).then((r) => r.ok ? r.json() : {}).then((s: { team?: string[]; photos?: Record<string, string> }) => ({ calendars: [], groups: [], staff: (s.team || []).map((n, i) => ({ id: `s${i}`, name: n, avatar: s.photos?.[n] || "" })) }))
      : fetch(`/api/scheduling?clientId=${id}&from=${new Date().toISOString()}&to=${new Date(Date.now() + 86_400_000).toISOString()}`, { cache: "no-store" }).then((r) => r.ok ? r.json() : {}).then((j: { calendars?: Cal[]; groups?: Grp[]; staff?: Person[] }) => ({ calendars: j.calendars || [], groups: j.groups || [], staff: j.staff || [] }));
    load.then((v) => { if (live) setD(v); }).catch(() => { if (live) setD({ calendars: [], groups: [], staff: [] }); });
    return () => { live = false; };
  }, [clientId, demo]);
  return d;
}

function previewFor(body: string, data: { calendars: Cal[]; groups: Grp[]; staff: Person[] } | null, demo: boolean): Preview | null {
  const slug = slugOf(body); if (!slug) return null;
  const staffOf = (ids: string[]) => (data?.staff || []).filter((p) => !ids.length || ids.includes(p.id)).slice(0, 5);
  const cal = data?.calendars.find((c) => c.slug === slug);
  if (cal) return { name: cal.name, durationMin: cal.durationMin, price: cal.price || undefined, currency: cal.currency, color: cal.color, staff: staffOf(cal.staffIds) };
  const grp = data?.groups.find((g) => g.slug === slug);
  if (grp) { const cals = (data?.calendars || []).filter((c) => grp.calendarIds.includes(c.id)); return { name: grp.name, staff: staffOf([...new Set(cals.flatMap((c) => c.staffIds))]), price: cals.length ? Math.min(...cals.map((c) => c.price || 0)) || undefined : undefined }; }
  if (!demo) return { name: "Booking link", staff: [] };
  // Sample: guess the service from the link (…-consultation, …-piercings, …-free-quote).
  const kind = /consult/.test(slug) ? { name: "Free consultation", durationMin: 30, price: 0 } : /pierc/.test(slug) ? { name: "Piercings", durationMin: 20, price: 40 } : /quote|visit/.test(slug) ? { name: "Free quote visit", durationMin: 60, price: 0 } : { name: "Booking", durationMin: 60, price: 0 };
  return { ...kind, color: "#16a34a", staff: staffOf([]) };
}

function BookingPreview({ p }: { p: Preview }) {
  return <div className="ac-book" style={{ ["--c" as string]: p.color || "var(--brand-primary,#2563eb)" }}>
    <span className="ac-book-ico" aria-hidden="true">📅</span>
    <span className="ac-book-main"><b>{p.name}</b><small>{[p.durationMin ? `${p.durationMin} min` : "", p.price ? money(p.price, p.currency) : p.price === 0 ? "Free" : ""].filter(Boolean).join(" · ") || "Booking page"}</small></span>
    {p.staff.length > 0 && <span className="ac-faces" title={p.staff.map((s) => s.name.split("|")[0].trim()).join(", ")}>{p.staff.slice(0, 4).map((s) => s.avatar && /^(https:|data:image\/)/.test(s.avatar) ? <img key={s.id} src={s.avatar} alt="" /> : <i key={s.id}>{initials(s.name.split("|")[0])}</i>)}{p.staff.length > 4 && <em>+{p.staff.length - 4}</em>}</span>}
  </div>;
}

export function HeldApprovalCards({ items, scopeClientId, clientLogo, busyId, onApprove, onDismiss, onOpenChat, onError }: {
  items: HeldCardItem[]; scopeClientId: string; clientLogo: (clientId: string) => { name: string; logo?: string } | undefined; busyId: string;
  onApprove: (h: HeldCardItem, text: string) => void; onDismiss: (h: HeldCardItem) => void; onOpenChat: (h: HeldCardItem) => void; onError: (m: string) => void;
}) {
  const [open, setOpen] = useState<HeldCardItem | null>(null);
  const demo = items.some((h) => h.demo);
  const data = useBookingData(items[0]?.clientId || scopeClientId, demo);
  if (!items.length) return null;
  return <>
    <div className="ac-grid">{items.map((h) => { const p = previewFor(h.body, data, Boolean(h.demo)); const client = !scopeClientId ? clientLogo(h.clientId) : undefined;
      return <article key={h.id} className="ac-card" role="button" tabIndex={0} onClick={() => setOpen(h)} onKeyDown={(e) => { if (e.key === "Enter") setOpen(h); }}>
        <header><span className={`ac-ch ${h.channel}`}>{CHANNEL[h.channel] || h.channel}</span><b>{h.name}</b><small>{ago(h)}</small>{client?.logo ? <img className="ac-logo" src={client.logo} alt={client.name} title={client.name} /> : null}</header>
        {h.ask && <p className="ac-ask">“{h.ask}”</p>}
        {p && <BookingPreview p={p} />}
        <p className="ac-reply"><span>AI reply</span>{h.body.replace(/https?:\/\/\S+/g, "🔗 link")}</p>
        <footer onClick={(e) => e.stopPropagation()}>
          <button type="button" className="ac-ok" disabled={busyId === h.id} onClick={() => onApprove(h, h.body)}>Approve &amp; send</button>
          <button type="button" className="ac-edit" onClick={() => setOpen(h)}>Edit</button>
          <button type="button" className="ac-no" disabled={busyId === h.id} onClick={() => onDismiss(h)}>Reject</button>
        </footer>
      </article>; })}</div>
    {open && <HeldDetail h={open} preview={previewFor(open.body, data, Boolean(open.demo))} busy={busyId === open.id} onClose={() => setOpen(null)} onApprove={(t) => { onApprove(open, t); setOpen(null); }} onDismiss={() => { onDismiss(open); setOpen(null); }} onOpenChat={() => onOpenChat(open)} onError={onError} scopeClientId={scopeClientId} />}
  </>;
}

function HeldDetail({ h, preview, busy, onClose, onApprove, onDismiss, onOpenChat, onError, scopeClientId }: { h: HeldCardItem; preview: Preview | null; busy: boolean; onClose: () => void; onApprove: (text: string) => void; onDismiss: () => void; onOpenChat: () => void; onError: (m: string) => void; scopeClientId: string }) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  useEffect(() => {
    if (h.demo) { setMsgs([{ id: "a", direction: "in", body: `Hi! ${h.ask || "Could I book in?"}` }]); return; }
    let live = true;
    fetch(`/api/conversations?view=thread&id=${encodeURIComponent(h.threadId)}`, { cache: "no-store" }).then((r) => r.ok ? r.json() : { messages: [] }).then((j: { messages?: Msg[] }) => { if (live) setMsgs((j.messages || []).filter((m) => m.id !== h.id).slice(-12)); }).catch(() => { if (live) setMsgs([]); });
    return () => { live = false; };
  }, [h]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const history: ReactNode = useMemo(() => !msgs ? <p className="ac-muted">Loading the conversation…</p> : !msgs.length ? <p className="ac-muted">No earlier messages.</p> : msgs.map((m) => <div key={m.id} className={`ac-msg ${m.direction === "in" || m.direction === "inbound" ? "in" : "out"}`}><p>{m.body}</p>{m.created_at && <small>{new Date(m.created_at).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small>}</div>), [msgs]);
  return <div className="ac-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="ac-modal" role="dialog" aria-modal="true" aria-label={`Approve reply to ${h.name}`}>
      <header><div><b>Send {h.name} a booking link?</b><small>{CHANNEL[h.channel] || h.channel} · {ago(h)}{h.reason ? ` · ${h.reason}` : ""}</small></div><button type="button" className="ac-x" aria-label="Close" onClick={onClose}>×</button></header>
      <div className="ac-modal-body">
        <section className="ac-history" aria-label="Conversation so far"><b className="ac-label">Conversation</b>{history}</section>
        <section className="ac-side">
          {preview && <><b className="ac-label">Booking they’ll get</b><BookingPreview p={preview} /></>}
          <b className="ac-label">AI reply — edit before sending</b>
          <HeldDraftEditor body={h.body} clientId={h.clientId || scopeClientId} contactName={h.name} demo={h.demo} busy={busy} onApprove={onApprove} onDismiss={onDismiss} onOpenChat={onOpenChat} onError={onError} />
        </section>
      </div>
    </div>
  </div>;
}
