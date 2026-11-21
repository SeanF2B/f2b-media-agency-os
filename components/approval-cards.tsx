"use client";
// AI approvals as visual cards: who asked, what they asked (plus any photos they sent, e.g. tattoo references),
// a preview of the booking the AI wants to send (service, length, price, deposit and the one staff member the
// link is for), and a click-to-open pop-up with the conversation so far, where the reply can be edited,
// the artist swapped, then approved or dismissed.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { HeldDraftEditor } from "./held-draft-editor";

export type HeldCardItem = { id: string; threadId: string; body: string; name: string; channel: string; clientId: string; reason?: string; ask?: string; demo?: boolean; at?: string; minsAgo?: number; photos?: string[]; samplePhotos?: number };
type Cal = { id: string; name: string; slug: string; durationMin: number; price: number; currency?: string; color?: string; staffIds: string[] };
type Grp = { name: string; slug: string; calendarIds: string[] };
type Person = { id: string; name: string; avatar?: string; role?: string };
type Preview = { name: string; durationMin?: number; price?: number; currency?: string; color?: string; deposit?: string; staff: Person[]; pick?: Person; aiPick?: boolean };
type BookingData = { calendars: Cal[]; groups: Grp[]; staff: Person[]; work?: Record<string, string[]>; gallery?: string[] };
type Msg = { id: string; direction: string; sender?: string; body: string; created_at?: string };

const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Facebook", sms: "SMS", email: "Email" };
const money = (n: number, cur = "EUR") => { try { return new Intl.NumberFormat("en-IE", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n); } catch { return `€${n}`; } };
const slugOf = (body: string) => (body.match(/\/f\/book\/([a-z0-9-]+)/i) || [])[1] || "";
const ago = (h: HeldCardItem) => { const mins = h.minsAgo ?? (h.at ? Math.max(0, Math.round((Date.now() - Date.parse(h.at)) / 60000)) : 0); return mins < 60 ? `${mins || 1}m ago` : mins < 1440 ? `${Math.round(mins / 60)}h ago` : `${Math.round(mins / 1440)}d ago`; };
const initials = (n: string) => n.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
const nameOf = (n: string) => n.split("|")[0].trim();
const staffParam = (body: string) => { const m = body.match(/\/f\/book\/[^\s)]*[?&]staff=([^&\s)]+)/i); return m ? decodeURIComponent(m[1]) : ""; };
/** A deposit the reply actually mentions ("€50 deposit", "deposit of £40"). Never guessed. */
const depositIn = (body: string) => { const m = body.match(/([€£$]\s?\d+(?:[.,]\d{2})?)\s*(?:non-refundable\s*)?deposit|deposit\s*(?:of\s*)?([€£$]\s?\d+(?:[.,]\d{2})?)/i); return m ? (m[1] || m[2]).replace(/\s/g, "") : ""; };
const MEDIA_RE = /📷\s*(https:\/\/\S+|\/api\/marketing-public\/media\?f=\S+)/g;
const photosOf = (body: string) => [...body.matchAll(MEDIA_RE)].map((m) => m[1]);
/** Photos the customer sent: real ones come with the approval; sample ones are the client's own site images (same as the sample inbox). */
const photosFor = (h: HeldCardItem, data: BookingData | null) => h.photos?.length ? h.photos : h.demo && h.samplePhotos ? [...Object.values(data?.work || {}).flat(), ...(data?.gallery || [])].slice(0, h.samplePhotos) : [];

/** Booking calendars + staff for an account (real), or the client's own team from their website (sample). */
function useBookingData(clientId: string, demo: boolean) {
  const [d, setD] = useState<BookingData | null>(null);
  useEffect(() => {
    let live = true;
    const id = encodeURIComponent(clientId || "agency");
    const load = demo
      ? fetch(`/api/scheduling?clientId=${id}&view=site`).then((r) => r.ok ? r.json() : {}).then((s: { team?: string[]; photos?: Record<string, string>; work?: Record<string, string[]>; gallery?: string[] }) => ({ calendars: [], groups: [], work: s.work || {}, gallery: s.gallery || [], staff: (s.team || []).map((n, i) => ({ id: `s${i}`, name: nameOf(n), role: n.split("|")[1]?.trim() || "", avatar: s.photos?.[n] || s.photos?.[nameOf(n)] || "" })) }))
      : fetch(`/api/scheduling?clientId=${id}&from=${new Date().toISOString()}&to=${new Date(Date.now() + 86_400_000).toISOString()}`, { cache: "no-store" }).then((r) => r.ok ? r.json() : {}).then((j: { calendars?: Cal[]; groups?: Grp[]; staff?: Person[] }) => ({ calendars: j.calendars || [], groups: j.groups || [], staff: (j.staff || []).map((p) => ({ ...p, name: nameOf(p.name), role: p.name.split("|")[1]?.trim() || "" })) }));
    load.then((v) => { if (live) setD(v); }).catch(() => { if (live) setD({ calendars: [], groups: [], staff: [] }); });
    return () => { live = false; };
  }, [clientId, demo]);
  return d;
}

function previewFor(h: HeldCardItem, data: BookingData | null): Preview | null {
  const body = h.body, demo = Boolean(h.demo);
  const slug = slugOf(body); if (!slug) return null;
  const deposit = depositIn(body) || undefined;
  const all = data?.staff || [];
  const staffOf = (ids: string[]) => all.filter((p) => !ids.length || ids.includes(p.id));
  // Who the link is for: the staff member named in the link (?staff=…), else the only person on that calendar.
  const choose = (pool: Person[]): Pick<Preview, "pick" | "aiPick"> => { const wanted = staffParam(body); const named = wanted ? all.find((p) => p.id === wanted) : undefined; if (named) return { pick: named, aiPick: true }; return pool.length === 1 ? { pick: pool[0] } : {}; };
  const cal = data?.calendars.find((c) => c.slug === slug);
  if (cal) { const pool = staffOf(cal.staffIds); return { name: cal.name, durationMin: cal.durationMin, price: cal.price || undefined, currency: cal.currency, color: cal.color, deposit, staff: pool, ...choose(pool) }; }
  const grp = data?.groups.find((g) => g.slug === slug);
  if (grp) { const cals = (data?.calendars || []).filter((c) => grp.calendarIds.includes(c.id)); const pool = staffOf([...new Set(cals.flatMap((c) => c.staffIds))]); return { name: grp.name, deposit, staff: pool, price: cals.length ? Math.min(...cals.map((c) => c.price || 0)) || undefined : undefined, ...choose(pool) }; }
  if (!demo) return { name: "Booking link", deposit, staff: [], ...choose([]) };
  // Sample: guess the service from the link, and pick the one artist it's for: whoever's own work matches the
  // photos the customer sent (tattoo references), or the piercer for piercings.
  const kind = /tattoo/.test(slug) ? { name: "Tattoo session", durationMin: 120, price: 0 } : /consult/.test(slug) ? { name: "Free consultation", durationMin: 30, price: 0 } : /pierc/.test(slug) ? { name: "Piercings", durationMin: 20, price: 40 } : /quote|visit/.test(slug) ? { name: "Free quote visit", durationMin: 60, price: 0 } : { name: "Booking", durationMin: 60, price: 0 };
  const pics = photosFor(h, data);
  const byWork = pics.length ? Object.entries(data?.work || {}).find(([, imgs]) => imgs.some((u) => pics.includes(u)))?.[0] : "";
  const wanted = staffParam(body);
  const pick = (wanted && all.find((p) => p.id === wanted))
    || (byWork && all.find((p) => p.name === nameOf(byWork)))
    || (/pierc/.test(slug) ? all.find((p) => /pierc/i.test(`${p.role} ${p.name}`)) : undefined)
    || all[/pierc/.test(slug) ? all.length - 1 : 0];
  return { ...kind, price: kind.price || undefined, color: "#16a34a", deposit, staff: pick ? [pick] : [], pick, aiPick: Boolean(pick) };
}

const Face = ({ p, size }: { p: Person; size?: number }) => p.avatar && /^(https:|data:image\/|\/)/.test(p.avatar) ? <img src={p.avatar} alt="" style={size ? { width: size, height: size } : undefined} /> : <i style={size ? { width: size, height: size } : undefined}>{initials(p.name)}</i>;

function BookingPreview({ p }: { p: Preview }) {
  const meta = [p.durationMin ? (p.durationMin >= 60 ? `${p.durationMin / 60} hr${p.durationMin > 60 ? "s" : ""}` : `${p.durationMin} min`) : "", p.price ? money(p.price, p.currency) : p.price === 0 && !p.deposit ? "Free" : ""].filter(Boolean).join(" · ") || "Booking page";
  return <div className="ac-book" style={{ ["--c" as string]: p.color || "var(--brand-primary,#2563eb)" }}>
    <span className="ac-book-ico" aria-hidden="true">📅</span>
    <span className="ac-book-main"><b>{p.name}</b><small>{meta}{p.deposit && <em className="ac-dep">{p.deposit} deposit</em>}</small></span>
    {p.pick
      ? <span className="ac-who" title={p.aiPick ? `AI picked ${p.pick.name} for this` : `Booking with ${p.pick.name}`}><Face p={p.pick} /><span><b>{p.pick.name.split(" ")[0]}</b><small>{p.aiPick ? "AI pick" : p.pick.role || "Staff"}</small></span></span>
      : p.staff.length > 0 && <span className="ac-faces" title={p.staff.map((s) => s.name).join(", ")}>{p.staff.slice(0, 3).map((s) => <Face key={s.id} p={s} />)}{p.staff.length > 3 && <em>+{p.staff.length - 3}</em>}</span>}
  </div>;
}

/** Small thumbnails of the photos the customer sent; never makes the card taller than one row. */
function Pics({ urls, onOpen }: { urls: string[]; onOpen?: (u: string) => void }) {
  if (!urls.length) return null;
  return <span className="ac-pics">{urls.slice(0, 3).map((u, i) => <button key={u} type="button" className="ac-pic" aria-label="Open photo" onClick={(e) => { if (onOpen) { e.stopPropagation(); onOpen(u); } }}><img src={u} alt="" loading="lazy" />{i === 2 && urls.length > 3 && <em>+{urls.length - 3}</em>}</button>)}</span>;
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
    <div className="ac-grid">{items.map((h) => { const p = previewFor(h, data); const pics = photosFor(h, data); const client = !scopeClientId ? clientLogo(h.clientId) : undefined;
      return <article key={h.id} className="ac-card" role="button" tabIndex={0} onClick={() => setOpen(h)} onKeyDown={(e) => { if (e.key === "Enter") setOpen(h); }}>
        <header><span className={`ac-ch ${h.channel}`}>{CHANNEL[h.channel] || h.channel}</span><b>{h.name}</b><small>{ago(h)}</small>{client?.logo ? <img className="ac-logo" src={client.logo} alt={client.name} title={client.name} /> : null}</header>
        {(h.ask || pics.length > 0) && <div className={`ac-ask${pics.length ? " has-pics" : ""}`}>{h.ask ? <span>“{h.ask}”</span> : <span>Sent {pics.length === 1 ? "a photo" : `${pics.length} photos`}</span>}<Pics urls={pics} /></div>}
        {p && <BookingPreview p={p} />}
        <p className="ac-reply"><span>AI reply</span>{h.body.replace(/https?:\/\/\S+/g, "🔗 link")}</p>
        <footer onClick={(e) => e.stopPropagation()}>
          <button type="button" className="ac-ok" disabled={busyId === h.id} onClick={() => onApprove(h, h.body)}>Approve &amp; send</button>
          <button type="button" className="ac-edit" onClick={() => setOpen(h)}>Edit</button>
          <button type="button" className="ac-no" disabled={busyId === h.id} onClick={() => onDismiss(h)}>Reject</button>
        </footer>
      </article>; })}</div>
    {open && <HeldDetail h={open} data={data} photos={photosFor(open, data)} busy={busyId === open.id} onClose={() => setOpen(null)} onApprove={(t) => { onApprove(open, t); setOpen(null); }} onDismiss={() => { onDismiss(open); setOpen(null); }} onOpenChat={() => onOpenChat(open)} onError={onError} scopeClientId={scopeClientId} />}
  </>;
}

function HeldDetail({ h, data, photos, busy, onClose, onApprove, onDismiss, onOpenChat, onError, scopeClientId }: { h: HeldCardItem; data: BookingData | null; photos: string[]; busy: boolean; onClose: () => void; onApprove: (text: string) => void; onDismiss: () => void; onOpenChat: () => void; onError: (m: string) => void; scopeClientId: string }) {
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [zoom, setZoom] = useState("");
  // Swapping the artist rewrites ?staff= on the booking link, so the booking page opens on that person.
  const [staffOverride, setStaffOverride] = useState<string | null>(null);
  const body = staffOverride === null ? h.body : withStaff(h.body, staffOverride);
  const preview = previewFor({ ...h, body }, data);
  const pool = !h.demo ? preview?.staff || [] : data?.staff || [];
  const canSwap = pool.length > 1;
  useEffect(() => {
    if (h.demo) { setMsgs([...photos.map((u, i) => ({ id: `p${i}`, direction: "in", body: `📷 ${u}` })), { id: "a", direction: "in", body: `Hi! ${h.ask || "Could I book in?"}` }]); return; }
    let live = true;
    fetch(`/api/conversations?view=thread&id=${encodeURIComponent(h.threadId)}`, { cache: "no-store" }).then((r) => r.ok ? r.json() : { messages: [] }).then((j: { messages?: Msg[] }) => { if (live) setMsgs((j.messages || []).filter((m) => m.id !== h.id).slice(-12)); }).catch(() => { if (live) setMsgs([]); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h, photos.join("|")]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  const history: ReactNode = useMemo(() => !msgs ? <p className="ac-muted">Loading the conversation…</p> : !msgs.length ? <p className="ac-muted">No earlier messages.</p> : msgs.map((m) => { const pics = photosOf(m.body); const text = m.body.replace(MEDIA_RE, "").trim(); return <div key={m.id} className={`ac-msg ${m.direction === "in" || m.direction === "inbound" ? "in" : "out"}`}>{text && <p>{text}</p>}{pics.length > 0 && <span className="ac-msg-pics">{pics.map((u) => <button key={u} type="button" onClick={() => setZoom(u)} aria-label="Open photo"><img src={u} alt="" loading="lazy" /></button>)}</span>}{m.created_at && <small>{new Date(m.created_at).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small>}</div>; }), [msgs]);
  return <div className="ac-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="ac-modal" role="dialog" aria-modal="true" aria-label={`Approve reply to ${h.name}`}>
      <header><div><b>Send {h.name} a booking link?</b><small>{CHANNEL[h.channel] || h.channel} · {ago(h)}{h.reason ? ` · ${h.reason}` : ""}</small></div><button type="button" className="ac-x" aria-label="Close" onClick={onClose}>×</button></header>
      <div className="ac-modal-body">
        <section className="ac-history" aria-label="Conversation so far"><b className="ac-label">Conversation</b>{history}</section>
        <section className="ac-side">
          {photos.length > 0 && <><b className="ac-label">Photos {h.name.split(" ")[0]} sent</b><Pics urls={photos.slice(0, 6)} onOpen={setZoom} /></>}
          {preview && <><b className="ac-label">Booking they’ll get</b><BookingPreview p={preview} /></>}
          {canSwap && <div className="ac-swap" role="radiogroup" aria-label="Who the booking is with">{pool.map((p) => <button key={p.id} type="button" role="radio" aria-checked={preview?.pick?.id === p.id} className={preview?.pick?.id === p.id ? "on" : ""} onClick={() => setStaffOverride(p.id)}><Face p={p} /><span>{p.name.split(" ")[0]}</span></button>)}<button type="button" role="radio" aria-checked={!preview?.pick} className={!preview?.pick ? "on" : ""} onClick={() => setStaffOverride("")}><i>★</i><span>Anyone</span></button></div>}
          <b className="ac-label">AI reply — edit before sending</b>
          <HeldDraftEditor key={staffOverride ?? "ai"} body={body} clientId={h.clientId || scopeClientId} contactName={h.name} demo={h.demo} busy={busy} onApprove={onApprove} onDismiss={onDismiss} onOpenChat={onOpenChat} onError={onError} />
        </section>
      </div>
    </div>
    {zoom && <div className="ac-zoom" role="presentation" onMouseDown={() => setZoom("")}><img src={zoom} alt="Photo the customer sent" /></div>}
  </div>;
}

/** Set (or clear, with "") the ?staff= on the booking link in a reply. */
function withStaff(text: string, staffId: string) {
  return text.replace(/(\S*\/f\/book\/[a-z0-9-]+)(\?[^\s)]*)?/i, (_m, base: string, q = "") => { const sp = new URLSearchParams(q.replace(/^\?/, "")); if (staffId) sp.set("staff", staffId); else sp.delete("staff"); const qs = sp.toString(); return qs ? `${base}?${qs}` : base; });
}
