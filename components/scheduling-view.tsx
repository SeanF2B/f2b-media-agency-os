"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Sparkles, CalendarDays, ChevronLeft, ChevronRight, Clock, Copy, Link2, MapPin, Plus, RefreshCw, Settings2, Trash2, UserRound, Users, Video, Phone, Building2 } from "lucide-react";
import "./scheduling.css";

type DayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
type Window = [string, string];
type Question = { id: string; label: string; required?: boolean; type?: "text" | "textarea" | "select"; options?: string[] };
type Calendar = { id: string; clientId: string; name: string; slug: string; kind: "service" | "consultation"; description: string; durationMin: number; bufferBefore: number; bufferAfter: number; slotInterval: number; minNoticeMin: number; maxDaysAhead: number; dailyLimit: number; locationType: "onsite" | "phone" | "video" | "office"; locationDetail: string; price: number; currency: string; color: string; assignMode: "customer_pick" | "round_robin" | "collective"; staffIds: string[]; questions: Question[]; stageId: string; confirmationMessage: string; redirectUrl: string; active: boolean; timezone: string };
type Staff = { id: string; name: string; email?: string; role?: string; avatar?: string; timezone?: string; weekly?: Partial<Record<DayKey, Window[]>>; blocked?: string[]; dailyLimit: number; google: string; feedUrl: string; canEdit: boolean };
type Booking = { id: string; clientId: string; calendarId: string; start: string; end: string; status: "booked" | "cancelled" | "completed" | "no_show"; staffIds: string[]; contactId: string | null; name: string; email: string; phone: string; answers: Array<{ label: string; value: string }>; notes: string; source: string; channel: string; meetLink: string; createdBy: string; createdAt: string };
type Data = { calendars: Calendar[]; bookings: Booking[]; staff: Staff[]; clients: Array<{ id: string; name: string; logo: string }>; scope: string | null; canManage: boolean; isAdmin: boolean; meId: string; googleAvailable: boolean; emailReady: boolean; publicBase: string };
type Slot = { start: string; end: string; staffIds: string[] };

const DAY_LIST: Array<[DayKey, string]> = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]];
const HOURS_FROM = 7, HOURS_TO = 21, PX_PER_MIN = 0.9;
const STATUS_LABEL: Record<Booking["status"], string> = { booked: "Booked", cancelled: "Cancelled", completed: "Completed", no_show: "No-show" };
const MODE_LABEL: Record<Calendar["assignMode"], string> = { customer_pick: "Customer picks the person", round_robin: "Auto-assign (round robin)", collective: "Everyone together" };

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd); };
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" });
const longDate = (iso: string) => new Date(iso).toLocaleString("en-IE", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const initials = (name: string) => name.split(/\s+/).map((p) => p[0] || "").join("").slice(0, 2).toUpperCase();
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

function scopeQs(scope: string) { return `clientId=${encodeURIComponent(scope || "agency")}`; }
async function api<T>(scope: string, body?: unknown, qs = ""): Promise<T> {
  const res = await fetch(`/api/scheduling?${scopeQs(scope)}${qs}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const json = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || "Something went wrong.");
  return json;
}

function Avatar({ person, size = 28 }: { person?: { name: string; avatar?: string }; size?: number }) {
  const ok = person?.avatar && /^(https:|data:image\/)/.test(person.avatar);
  return <span className="sch-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} title={person?.name}>{ok ? <img src={person!.avatar} alt="" /> : initials(person?.name || "?")}</span>;
}

function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return <div className="iv-modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={`iv-dialog sch-dialog${wide ? " wide" : ""}`}><header><h2>{title}</h2><button type="button" className="iv-x" aria-label="Close" onClick={onClose}>✕</button></header>{children}{footer && <footer>{footer}</footer>}</div>
  </div>;
}

export function SchedulingView({ scopeClientId }: { scopeClientId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [tab, setTab] = useState<"calendar" | "appointments" | "calendars" | "availability">("calendar");
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const [staffFilter, setStaffFilter] = useState("");
  const [calFilter, setCalFilter] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [newAppt, setNewAppt] = useState<ApptDraft | null>(null);
  const [catchUpOpen, setCatchUpOpen] = useState(true);
  const [detail, setDetail] = useState<Booking | null>(null);
  const [editCal, setEditCal] = useState<Partial<Calendar> | null>(null);
  const [editAvail, setEditAvail] = useState<Staff | null>(null);
  const [listMode, setListMode] = useState<"upcoming" | "past" | "cancelled">("upcoming");

  const load = useCallback(async () => {
    try {
      const from = addDays(week, -35), to = addDays(week, 70);
      setData(await api<Data>(scopeClientId, undefined, `&from=${from.toISOString()}&to=${to.toISOString()}`));
      setError("");
    } catch (e) { setError(errText(e, "Scheduling could not load.")); }
  }, [scopeClientId, week]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("schedulingGoogle");
    if (!p) return;
    if (p === "connected") { setNote("Google Calendar connected. Busy times now block bookings, and new bookings appear in Google."); setTab("availability"); }
    else setError(p === "refresh-token-missing" ? "Google didn't return long-term access. Remove F2B from your Google account's third-party access, then connect again." : p === "not-allowed" ? "You can only connect your own calendar." : p === "not-configured" ? "Google sign-in isn't set up on the server yet." : p === "cancelled" ? "Google Calendar connection was cancelled." : "Google Calendar couldn't be connected. Please try again.");
    const url = new URL(window.location.href); url.searchParams.delete("schedulingGoogle"); window.history.replaceState(null, "", url.toString());
  }, []);

  const act = async (body: Record<string, unknown>, ok?: string) => {
    setBusy(true); setError(""); setNote("");
    try { const out = await api<Record<string, unknown>>(scopeClientId, body); if (ok) setNote(ok); await load(); return out; }
    catch (e) { setError(errText(e, "Something went wrong.")); return null; }
    finally { setBusy(false); }
  };

  const calById = useMemo(() => new Map((data?.calendars || []).map((c) => [c.id, c])), [data]);
  const staffById = useMemo(() => new Map((data?.staff || []).map((s) => [s.id, s])), [data]);
  const clientName = (id: string) => (id ? data?.clients.find((c) => c.id === id)?.name || "Client" : "Agency");
  const visible = useMemo(() => (data?.bookings || []).filter((b) => (!staffFilter || b.staffIds.includes(staffFilter)) && (!calFilter || b.calendarId === calFilter)), [data, staffFilter, calFilter]);

  const stats = useMemo(() => {
    const now = Date.now(), monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    const list = visible;
    const upcoming = list.filter((b) => b.status === "booked" && Date.parse(b.start) >= now && Date.parse(b.start) < now + 7 * 86_400_000).length;
    const month = list.filter((b) => b.status !== "cancelled" && Date.parse(b.start) >= monthStart);
    const done = list.filter((b) => b.status === "completed").length, noShow = list.filter((b) => b.status === "no_show").length;
    const perStaff = (data?.staff || []).map((s) => ({ s, n: month.filter((b) => b.staffIds.includes(s.id)).length })).filter((x) => x.n).sort((a, b) => b.n - a.n).slice(0, 4);
    return { upcoming, month: month.length, showRate: done + noShow ? Math.round((done / (done + noShow)) * 100) : null, noShow, perStaff };
  }, [visible, data]);

  if (!data) return <section className="sch" aria-label="Scheduling"><div className="empty-state" role="status">{error || "Loading Scheduling…"}</div></section>;
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const todayKey = ymd(new Date());

  return <section className="sch" aria-label="Scheduling">
    <header className="iv-head"><div><p className="eyebrow">SCHEDULING</p><h1>Appointments &amp; bookings</h1><p>Service calendars, consultations and staff availability, synced with Google Calendar and Apple / Outlook.</p></div>
      <div className="iv-head-actions">{data.canManage && <button type="button" className="secondary-button" onClick={() => setEditCal(blankCalendar(data))}><Plus size={15} /> New booking calendar</button>}<button type="button" className="primary-button" onClick={() => setNewAppt({ date: ymd(new Date()), time: "" })}><Plus size={15} /> New appointment</button></div></header>
    {error && <div className="iv-error" role="alert">{error}</div>}{note && <div className="iv-note" role="status">{note}</div>}
    {!data.emailReady && <div className="iv-warn">Email isn't set up on the server, so confirmations and reminders won't send yet. Bookings still save.</div>}

    <AiBar scope={scopeClientId} data={data} onCalendar={(c) => setEditCal(c)} onAppointment={(a) => setNewAppt(a)} onHours={async (hours) => { for (const h of hours) { const person = data.staff.find((x) => x.id === h.staffId); await act({ action: "saveAvailability", staffId: h.staffId, weekly: h.weekly, blocked: [...new Set([...(person?.blocked || []), ...h.daysOff])], dailyLimit: h.dailyLimit || person?.dailyLimit || 0, timezone: person?.timezone || "Europe/Dublin" }); } setNote("Working hours updated."); setTab("availability"); }} />
    <div className="iv-stats"><div><small>Next 7 days</small><b>{stats.upcoming}</b></div><div><small>Booked this month</small><b>{stats.month}</b></div><div><small>Show-up rate</small><b>{stats.showRate === null ? "—" : `${stats.showRate}%`}</b></div><div className={stats.noShow ? "bad" : ""}><small>No-shows</small><b>{stats.noShow}</b></div>
      <div className="sch-perstaff"><small>This month by person</small>{stats.perStaff.length ? stats.perStaff.map(({ s, n }) => <span key={s.id}><Avatar person={s} size={20} /> {s.name.split(" ")[0]} <b>{n}</b></span>) : <span className="iv-small">No bookings yet</span>}</div></div>

    <div className="sch-toolbar">
      <div className="iv-tabs" role="tablist" aria-label="Scheduling sections">{([["calendar", "Calendar"], ["appointments", "Appointments"], ["calendars", "Booking calendars"], ["availability", "Staff & availability"]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
      {(tab === "calendar" || tab === "appointments") && <div className="sch-filters">
        <label className="sch-select"><Users size={14} /><select aria-label="Filter by staff member" value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)}><option value="">Everyone</option>{data.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="sch-select"><CalendarDays size={14} /><select aria-label="Filter by booking calendar" value={calFilter} onChange={(e) => setCalFilter(e.target.value)}><option value="">All calendars</option>{data.calendars.map((c) => <option key={c.id} value={c.id}>{data.scope === null && c.clientId ? `${clientName(c.clientId)} · ` : ""}{c.name}</option>)}</select></label>
      </div>}
    </div>

    {tab === "calendar" && <div className="iv-card sch-week-card">
      <div className="sch-week-nav"><button type="button" className="iv-btn" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))}><ChevronLeft size={15} /></button><button type="button" className="iv-btn" onClick={() => setWeek(mondayOf(new Date()))}>Today</button><button type="button" className="iv-btn" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))}><ChevronRight size={15} /></button>
        <b>{week.toLocaleDateString("en-IE", { day: "numeric", month: "short" })} – {addDays(week, 6).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" })}</b>
        <button type="button" className="iv-btn" aria-label="Refresh" onClick={() => void load()}><RefreshCw size={14} /></button></div>
      <div className="sch-week" style={{ ["--sch-h" as string]: `${(HOURS_TO - HOURS_FROM) * 60 * PX_PER_MIN}px` }}>
        <div className="sch-hours">{Array.from({ length: HOURS_TO - HOURS_FROM }, (_, i) => <span key={i} style={{ top: i * 60 * PX_PER_MIN }}>{String(HOURS_FROM + i).padStart(2, "0")}:00</span>)}</div>
        {days.map((d) => { const key = ymd(d); const dayBookings = visible.filter((b) => ymd(new Date(b.start)) === key);
          return <div key={key} className={`sch-day${key === todayKey ? " today" : ""}`}>
            <div className="sch-day-head"><small>{d.toLocaleDateString("en-IE", { weekday: "short" })}</small><b>{d.getDate()}</b></div>
            <div className="sch-day-body" onClick={(e) => { if (e.target !== e.currentTarget) return; const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); const mins = Math.floor(((e.clientY - rect.top) / PX_PER_MIN) / 30) * 30 + HOURS_FROM * 60; setNewAppt({ date: key, time: `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}` }); }} title="Click an empty time to add an appointment">
              {Array.from({ length: HOURS_TO - HOURS_FROM }, (_, i) => <i key={i} className="sch-line" style={{ top: i * 60 * PX_PER_MIN }} />)}
              {key === todayKey && (() => { const n = new Date(); const m = n.getHours() * 60 + n.getMinutes() - HOURS_FROM * 60; return m > 0 && m < (HOURS_TO - HOURS_FROM) * 60 ? <i className="sch-now" style={{ top: m * PX_PER_MIN }} /> : null; })()}
              {dayBookings.map((b) => { const s = new Date(b.start), e = new Date(b.end); const top = Math.max(0, (s.getHours() * 60 + s.getMinutes() - HOURS_FROM * 60) * PX_PER_MIN); const height = Math.max(22, ((e.getTime() - s.getTime()) / 60000) * PX_PER_MIN - 2); const cal = calById.get(b.calendarId);
                return <button key={b.id} type="button" className={`sch-block ${b.status}`} style={{ top, height, ["--c" as string]: cal?.color || "#2563eb" }} onClick={() => setDetail(b)} title={`${time(b.start)} ${cal?.name || ""} · ${b.name}`}>
                  <b>{time(b.start)} {b.name}</b><span>{cal?.name}</span><em>{b.staffIds.map((id) => staffById.get(id)?.name.split(" ")[0]).filter(Boolean).join(", ")}</em></button>; })}
            </div></div>; })}
      </div>
    </div>}

    {tab === "appointments" && <div className="iv-card">
      <div className="iv-filters">{(["upcoming", "past", "cancelled"] as const).map((m) => <button key={m} type="button" className={listMode === m ? "on" : ""} onClick={() => setListMode(m)}>{m === "upcoming" ? "Upcoming" : m === "past" ? "Past" : "Cancelled"}</button>)}</div>
      {(() => { const now = Date.now(); const rows = visible.filter((b) => listMode === "cancelled" ? b.status === "cancelled" : listMode === "upcoming" ? b.status !== "cancelled" && Date.parse(b.end) >= now : b.status !== "cancelled" && Date.parse(b.end) < now).sort((a, b) => listMode === "upcoming" ? a.start.localeCompare(b.start) : b.start.localeCompare(a.start));
        return rows.length ? <div className="sch-list">{rows.map((b) => { const cal = calById.get(b.calendarId); return <button key={b.id} type="button" className="sch-row" onClick={() => setDetail(b)}>
          <span className="sch-dot" style={{ background: cal?.color }} /><span className="sch-when"><b>{new Date(b.start).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" })}</b><small>{time(b.start)}–{time(b.end)}</small></span>
          <span className="sch-what"><b>{b.name}</b><small>{cal?.name || "Deleted calendar"}{data.scope === null ? ` · ${clientName(b.clientId)}` : ""}{b.channel ? ` · ${b.channel}` : ""}</small></span>
          <span className="sch-who">{b.staffIds.map((id) => <Avatar key={id} person={staffById.get(id) || { name: "?" }} size={24} />)}</span>
          <span className={`iv-pill sch-status ${b.status}`}>{STATUS_LABEL[b.status]}</span></button>; })}</div> : <div className="iv-empty">No {listMode} appointments in this range.</div>; })()}
    </div>}

    {tab === "calendars" && <div className="sch-cal-grid">
      {data.calendars.map((c) => <div key={c.id} className={`iv-card sch-cal${c.active ? "" : " off"}`} style={{ ["--c" as string]: c.color }}>
        <div className="sch-cal-top"><span className="sch-cal-kind">{c.kind === "consultation" ? "Consultation" : "Service"}</span>{data.scope === null && <span className="iv-small">{clientName(c.clientId)}</span>}{!c.active && <span className="iv-pill">Off</span>}</div>
        <h3>{c.name}</h3>
        <div className="sch-cal-meta"><span><Clock size={13} /> {c.durationMin} min{c.bufferBefore || c.bufferAfter ? ` · buffer ${c.bufferBefore}/${c.bufferAfter}` : ""}</span><span>{c.locationType === "video" ? <Video size={13} /> : c.locationType === "phone" ? <Phone size={13} /> : c.locationType === "office" ? <Building2 size={13} /> : <MapPin size={13} />} {c.locationType === "onsite" ? "On-site" : c.locationType === "phone" ? "Phone" : c.locationType === "video" ? "Google Meet" : "Office"}</span><span><UserRound size={13} /> {MODE_LABEL[c.assignMode]}</span></div>
        <div className="sch-cal-staff">{c.staffIds.map((id) => <Avatar key={id} person={staffById.get(id) || { name: "?" }} size={26} />)}{!c.staffIds.length && <span className="iv-need-text iv-small">No staff added yet</span>}</div>
        <div className="iv-actions">
          <button type="button" className="iv-btn" onClick={() => { void navigator.clipboard?.writeText(`${data.publicBase}${c.slug}`); setNote(`Booking link copied: ${data.publicBase}${c.slug}`); }}><Link2 size={13} /> Copy link</button>
          <button type="button" className="iv-btn" onClick={() => { void navigator.clipboard?.writeText(embedCode(`${data.publicBase}${c.slug}`)); setNote("Embed code copied. Paste it into the client's website where the booking form should appear."); }}><Copy size={13} /> Embed</button>
          <a className="iv-btn" href={`${data.publicBase}${c.slug}`} target="_blank" rel="noopener noreferrer">Preview</a>
          {data.canManage && <button type="button" className="iv-btn" onClick={() => setEditCal(c)}><Settings2 size={13} /> Edit</button>}
        </div></div>)}
      {!data.calendars.length && <div className="iv-card sch-empty"><CalendarDays size={28} /><b>No booking calendars yet</b><p className="iv-small">Create one for each service (e.g. “Roof survey”) or consultation. Each gets its own booking link and website widget.</p>{data.canManage && <button type="button" className="primary-button" onClick={() => setEditCal(blankCalendar(data))}><Plus size={15} /> New booking calendar</button>}</div>}
    </div>}

    {tab === "availability" && <div className="sch-staff-grid">
      {data.staff.map((s) => { const days = DAY_LIST.filter(([k]) => s.weekly?.[k]?.length);
        return <div key={s.id} className="iv-card sch-staff">
          <div className="sch-staff-top"><Avatar person={s} size={40} /><div><b>{s.name}</b><small>{s.role}{s.dailyLimit ? ` · max ${s.dailyLimit}/day` : ""}</small></div></div>
          <div className="sch-hours-sum">{days.length ? days.map(([k, l]) => <span key={k}><b>{l.slice(0, 3)}</b> {(s.weekly?.[k] || []).map((w) => `${w[0]}–${w[1]}`).join(", ")}</span>) : <span className="iv-need-text iv-small">No working hours set, so nobody can book this person.</span>}{s.blocked?.filter((d) => d >= todayKey).length ? <span className="iv-small">{s.blocked.filter((d) => d >= todayKey).length} day(s) off coming up</span> : null}</div>
          <div className="sch-sync">
            <div><img src="https://www.gstatic.com/images/branding/product/1x/calendar_2020q4_48dp.png" alt="" width={18} height={18} /><span>{s.google ? <>Google: <b>{s.google}</b></> : "Google Calendar not connected"}</span>
              {s.canEdit && (s.google ? <button type="button" className="iv-btn danger" disabled={busy} onClick={() => void act({ action: "disconnectGoogle", staffId: s.id }, "Google Calendar disconnected.")}>Disconnect</button> : data.googleAvailable ? <a className="iv-btn" href={`/api/scheduling?${scopeQs(scopeClientId)}&connect=${encodeURIComponent(s.id)}`}>Connect</a> : <span className="iv-small">Not set up on server</span>)}</div>
            <div><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="4" fill="#fff" stroke="#e11d48" strokeWidth="1.6" /><rect x="3" y="4" width="18" height="5" rx="2" fill="#e11d48" /><text x="12" y="18" textAnchor="middle" fontSize="8" fontWeight="700" fill="#111">31</text></svg><span>Apple / Outlook calendar feed</span>
              {s.canEdit && (s.feedUrl ? <><button type="button" className="iv-btn" onClick={() => { void navigator.clipboard?.writeText(s.feedUrl); setNote("Feed link copied. On iPhone: Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar, then paste. On Mac: Calendar → File → New Calendar Subscription. In Outlook: Add calendar → Subscribe from web."); }}>Copy link</button><button type="button" className="iv-btn" title="Make a new private link (the old one stops working)" onClick={() => void act({ action: "rotateFeed", staffId: s.id }, "New private feed link created. Re-subscribe with the new link.")}><RefreshCw size={12} /></button></> : <button type="button" className="iv-btn" onClick={() => void act({ action: "createFeed", staffId: s.id }, "Private feed link ready. Click Copy link.")}>Create link</button>)}</div>
          </div>
          {(s.canEdit || data.canManage) && <div className="iv-actions"><button type="button" className="iv-btn" onClick={() => setEditAvail(s)}><Clock size={13} /> Edit hours &amp; days off</button></div>}
        </div>; })}
    </div>}

    {newAppt && <NewAppointment data={data} scope={scopeClientId} initial={newAppt} onClose={() => setNewAppt(null)} onSaved={async (msg) => { setNewAppt(null); setNote(msg); await load(); }} onCalendarsChanged={() => void load()} />}
    {catchUpOpen && !detail && !newAppt && <CatchUp data={data} scope={scopeClientId} onClose={() => setCatchUpOpen(false)} onChanged={() => void load()} />}
    {detail && <AppointmentDetail key={detail.id} data={data} scope={scopeClientId} booking={detail} onClose={() => setDetail(null)} onSaved={async (msg) => { setDetail(null); setNote(msg); await load(); }} />}
    {editCal && <CalendarEditor data={data} value={editCal} busy={busy} onClose={() => setEditCal(null)} onSave={async (cal) => { const out = await act({ action: "saveCalendar", calendar: cal }, cal.id ? "Booking calendar saved." : "Booking calendar created. Copy its link or embed code to start taking bookings."); if (out) setEditCal(null); }} onDelete={editCal.id ? async () => { if (!window.confirm("Delete this booking calendar? Its booking link will stop working.")) return; const out = await act({ action: "deleteCalendar", id: editCal.id }, "Booking calendar deleted."); if (out) setEditCal(null); } : undefined} />}
    {editAvail && <AvailabilityEditor staff={editAvail} busy={busy} onClose={() => setEditAvail(null)} onSave={async (v) => { const out = await act({ action: "saveAvailability", staffId: editAvail.id, ...v }, `${editAvail.name}'s availability saved.`); if (out) setEditAvail(null); }} />}
  </section>;
}

function embedCode(url: string) {
  return `<iframe src="${url}" title="Book an appointment" style="width:100%;min-height:720px;border:0" loading="lazy"></iframe>\n<script>window.addEventListener("message",function(e){if(e.data&&e.data.type==="f2b-booking-height"){document.querySelectorAll('iframe[src^="${url}"]').forEach(function(f){f.style.height=(e.data.height+20)+"px"})}});</script>`;
}

function blankCalendar(data: Data): Partial<Calendar> {
  return { name: "", kind: "service", clientId: data.scope || "", durationMin: 60, bufferBefore: 0, bufferAfter: 15, slotInterval: 30, minNoticeMin: 240, maxDaysAhead: 60, dailyLimit: 0, locationType: "onsite", locationDetail: "", price: 0, currency: "EUR", color: "#2563eb", assignMode: "customer_pick", staffIds: data.meId ? [data.meId] : [], questions: [{ id: "address", label: "Address / Eircode", required: true }], confirmationMessage: "", redirectUrl: "", active: true };
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) { return <label>{label}{children}{hint && <small className="iv-hint">{hint}</small>}</label>; }

function CalendarEditor({ data, value, busy, onClose, onSave, onDelete }: { data: Data; value: Partial<Calendar>; busy: boolean; onClose: () => void; onSave: (c: Partial<Calendar>) => void; onDelete?: () => void }) {
  const [c, setC] = useState<Partial<Calendar>>(value);
  const set = (p: Partial<Calendar>) => setC((x) => ({ ...x, ...p }));
  const questions = c.questions || [];
  const staffPool = data.staff;
  return <Modal title={c.id ? "Edit booking calendar" : "New booking calendar"} wide onClose={onClose} footer={<>{onDelete && <button type="button" className="iv-btn danger" onClick={onDelete}><Trash2 size={13} /> Delete</button>}<span style={{ flex: 1 }} /><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="button" className="primary-button" disabled={busy || !String(c.name || "").trim()} onClick={() => onSave(c)}>{busy ? "Saving…" : "Save"}</button></>}>
    <div className="iv-grid">
      <Field label="Name"><input value={c.name || ""} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Free roof survey" maxLength={120} autoFocus /></Field>
      <Field label="Type"><select value={c.kind} onChange={(e) => set({ kind: e.target.value as Calendar["kind"] })}><option value="service">Service appointment</option><option value="consultation">Consultation</option></select></Field>
      {data.scope === null && !c.id ? <Field label="Account"><select value={c.clientId || ""} onChange={(e) => set({ clientId: e.target.value })}><option value="">Agency (F2B)</option>{data.clients.map((cl) => <option key={cl.id} value={cl.id}>{cl.name}</option>)}</select></Field> : <Field label="Colour"><input type="color" value={c.color || "#2563eb"} onChange={(e) => set({ color: e.target.value })} /></Field>}
    </div>
    <Field label="Description (shown on the booking page)"><textarea rows={2} value={c.description || ""} onChange={(e) => set({ description: e.target.value })} maxLength={1500} placeholder="What happens at this appointment?" /></Field>
    <h3 className="sch-h3">Timing</h3>
    <div className="iv-grid">
      <Field label="Length (minutes)"><input type="number" min={5} max={600} value={c.durationMin ?? 60} onChange={(e) => set({ durationMin: Number(e.target.value) })} /></Field>
      <Field label="Buffer before (min)" hint="Prep / travel time blocked before"><input type="number" min={0} max={240} value={c.bufferBefore ?? 0} onChange={(e) => set({ bufferBefore: Number(e.target.value) })} /></Field>
      <Field label="Buffer after (min)" hint="Wrap-up / travel time blocked after"><input type="number" min={0} max={240} value={c.bufferAfter ?? 0} onChange={(e) => set({ bufferAfter: Number(e.target.value) })} /></Field>
      <Field label="Start times every"><select value={c.slotInterval ?? 30} onChange={(e) => set({ slotInterval: Number(e.target.value) })}>{[15, 20, 30, 45, 60, 90, 120].map((n) => <option key={n} value={n}>{n} minutes</option>)}</select></Field>
      <Field label="Minimum notice"><select value={c.minNoticeMin ?? 240} onChange={(e) => set({ minNoticeMin: Number(e.target.value) })}>{[[0, "None"], [60, "1 hour"], [120, "2 hours"], [240, "4 hours"], [720, "12 hours"], [1440, "1 day"], [2880, "2 days"], [10080, "1 week"]].map(([n, l]) => <option key={n} value={n}>{l}</option>)}</select></Field>
      <Field label="Bookable up to (days ahead)"><input type="number" min={1} max={365} value={c.maxDaysAhead ?? 60} onChange={(e) => set({ maxDaysAhead: Number(e.target.value) })} /></Field>
      <Field label="Max bookings per day" hint="0 = no limit"><input type="number" min={0} max={100} value={c.dailyLimit ?? 0} onChange={(e) => set({ dailyLimit: Number(e.target.value) })} /></Field>
      <Field label="Location"><select value={c.locationType} onChange={(e) => set({ locationType: e.target.value as Calendar["locationType"] })}><option value="onsite">On-site at the customer's address</option><option value="phone">Phone call</option><option value="video">Video call (Google Meet)</option><option value="office">At our office</option></select></Field>
      <Field label={c.locationType === "office" ? "Office address" : c.locationType === "phone" ? "Who calls who?" : "Location note"}><input value={c.locationDetail || ""} onChange={(e) => set({ locationDetail: e.target.value })} maxLength={300} placeholder={c.locationType === "phone" ? "We'll call you" : c.locationType === "office" ? "Unit 4, Galway" : "Optional"} /></Field>
      <Field label="Price (optional)" hint="Shown on the booking page and set as the deal value"><input type="number" min={0} step="0.01" value={c.price ?? 0} onChange={(e) => set({ price: Number(e.target.value) })} /></Field>
    </div>
    <h3 className="sch-h3">Who takes these bookings</h3>
    <Field label="How people are assigned"><select value={c.assignMode} onChange={(e) => set({ assignMode: e.target.value as Calendar["assignMode"] })}><option value="customer_pick">Customer picks the person (or “Anyone available”)</option><option value="round_robin">Auto-assign: least busy person first</option><option value="collective">Everyone together (only times when all are free)</option></select></Field>
    <div className="sch-staff-pick">{staffPool.map((s) => { const on = (c.staffIds || []).includes(s.id); return <button key={s.id} type="button" className={on ? "on" : ""} aria-pressed={on} onClick={() => set({ staffIds: on ? (c.staffIds || []).filter((x) => x !== s.id) : [...(c.staffIds || []), s.id] })}><Avatar person={s} size={30} /><span><b>{s.name}</b><small>{s.role}</small></span></button>; })}</div>
    <h3 className="sch-h3">Booking form questions</h3>
    <div className="sch-questions">{questions.map((q, i) => <div key={i} className="sch-q">
      <input value={q.label} onChange={(e) => set({ questions: questions.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} placeholder="Question" maxLength={140} />
      <select value={q.type || "text"} onChange={(e) => set({ questions: questions.map((x, j) => j === i ? { ...x, type: e.target.value as Question["type"] } : x) })}><option value="text">Short answer</option><option value="textarea">Long answer</option><option value="select">Dropdown</option></select>
      {q.type === "select" && <input value={(q.options || []).join(", ")} onChange={(e) => set({ questions: questions.map((x, j) => j === i ? { ...x, options: e.target.value.split(",").map((o) => o.trim()) } : x) })} placeholder="Options, comma separated" />}
      <label className="iv-check iv-small"><input type="checkbox" checked={Boolean(q.required)} onChange={(e) => set({ questions: questions.map((x, j) => j === i ? { ...x, required: e.target.checked } : x) })} /> Required</label>
      <button type="button" className="iv-btn danger" aria-label="Remove question" onClick={() => set({ questions: questions.filter((_, j) => j !== i) })}><Trash2 size={13} /></button></div>)}
      <button type="button" className="iv-btn" onClick={() => set({ questions: [...questions, { id: `q${Date.now().toString(36)}`, label: "", required: false, type: "text" }] })}><Plus size={13} /> Add question</button></div>
    <h3 className="sch-h3">After booking</h3>
    <div className="iv-grid">
      <Field label="Confirmation message" hint="Shown on screen and in the confirmation email"><textarea rows={2} value={c.confirmationMessage || ""} onChange={(e) => set({ confirmationMessage: e.target.value })} maxLength={1000} placeholder="Thanks! We'll text you the day before." /></Field>
      <Field label="Thank-you page (optional)" hint="Send people to this https:// page so conversions can be tracked"><input value={c.redirectUrl || ""} onChange={(e) => set({ redirectUrl: e.target.value })} placeholder="https://client.ie/thank-you" maxLength={500} /></Field>
      <Field label="Status"><label className="iv-check"><input type="checkbox" checked={c.active !== false} onChange={(e) => set({ active: e.target.checked })} /> Taking bookings</label></Field>
    </div>
    <p className="iv-small">Bookings create or update the contact in this account's CRM, move their deal to the “Appointment booked” stage (or the first open stage), and can trigger Automations.</p>
  </Modal>;
}

function AvailabilityEditor({ staff, busy, onClose, onSave }: { staff: Staff; busy: boolean; onClose: () => void; onSave: (v: { weekly: Partial<Record<DayKey, Window[]>>; blocked: string[]; dailyLimit: number; timezone: string }) => void }) {
  const [weekly, setWeekly] = useState<Partial<Record<DayKey, Window[]>>>(staff.weekly || {});
  const [blocked, setBlocked] = useState<string[]>(staff.blocked || []);
  const [limit, setLimit] = useState(staff.dailyLimit || 0);
  const [tz, setTz] = useState(staff.timezone || "Europe/Dublin");
  const [off, setOff] = useState("");
  const setDay = (k: DayKey, w: Window[]) => setWeekly((x) => ({ ...x, [k]: w }));
  const today = ymd(new Date());
  return <Modal title={`${staff.name}: hours & days off`} onClose={onClose} footer={<><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="button" className="primary-button" disabled={busy} onClick={() => onSave({ weekly, blocked, dailyLimit: limit, timezone: tz })}>{busy ? "Saving…" : "Save"}</button></>}>
    <div className="sch-weekly">{DAY_LIST.map(([k, l]) => { const w = weekly[k] || []; return <div key={k} className={`sch-wrow${w.length ? "" : " off"}`}>
      <label className="iv-check"><input type="checkbox" checked={w.length > 0} onChange={(e) => setDay(k, e.target.checked ? [["09:00", "17:00"]] : [])} /> <b>{l}</b></label>
      <div className="sch-windows">{w.length ? w.map((win, i) => <span key={i} className="sch-win"><input type="time" value={win[0]} onChange={(e) => setDay(k, w.map((x, j) => j === i ? [e.target.value, x[1]] : x))} /> – <input type="time" value={win[1]} onChange={(e) => setDay(k, w.map((x, j) => j === i ? [x[0], e.target.value] : x))} />{i > 0 && <button type="button" className="iv-btn danger" aria-label="Remove time block" onClick={() => setDay(k, w.filter((_, j) => j !== i))}>✕</button>}</span>) : <span className="iv-small">Unavailable</span>}
        {w.length > 0 && w.length < 4 && <button type="button" className="iv-btn" title="Add another time block (e.g. after lunch)" onClick={() => setDay(k, [...w, [w[w.length - 1][1] < "17:00" ? w[w.length - 1][1] : "13:00", "17:00"]])}><Plus size={12} /></button>}</div>
    </div>; })}</div>
    <div className="iv-grid">
      <Field label="Max appointments per day" hint="0 = no limit"><input type="number" min={0} max={100} value={limit} onChange={(e) => setLimit(Number(e.target.value))} /></Field>
      <Field label="Time zone"><select value={tz} onChange={(e) => setTz(e.target.value)}>{["Europe/Dublin", "Europe/London", "Europe/Madrid", "Europe/Paris", "America/New_York", "Australia/Sydney"].map((z) => <option key={z} value={z}>{z.replace("_", " ")}</option>)}</select></Field>
      <Field label="Add a day off"><span className="sch-inline"><input type="date" min={today} value={off} onChange={(e) => setOff(e.target.value)} /><button type="button" className="iv-btn" disabled={!off} onClick={() => { if (off && !blocked.includes(off)) setBlocked([...blocked, off].sort()); setOff(""); }}>Add</button></span></Field>
    </div>
    {blocked.filter((d) => d >= today).length > 0 && <div className="sch-chips">{blocked.filter((d) => d >= today).map((d) => <span key={d} className="sch-chip">{new Date(`${d}T12:00:00`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" })}<button type="button" aria-label={`Remove ${d}`} onClick={() => setBlocked(blocked.filter((x) => x !== d))}>✕</button></span>)}</div>}
    <p className="iv-small">Times already busy in a connected Google Calendar are blocked automatically.</p>
  </Modal>;
}

function SlotPicker({ data, scope, calendarId, staffIds, date, exclude, value, onPick }: { data: Data; scope: string; calendarId: string; staffIds: string[]; date: string; exclude?: string; value: string; onPick: (s: Slot) => void }) {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!calendarId || !date) return;
    let live = true; setSlots(null); setErr("");
    const staffQ = staffIds.length === 1 ? `&staffId=${encodeURIComponent(staffIds[0])}` : "";
    api<{ slots: Slot[] }>(scope, undefined, `&view=slots&calendarId=${encodeURIComponent(calendarId)}&date=${date}${staffQ}${exclude ? `&exclude=${encodeURIComponent(exclude)}` : ""}`).then((r) => { if (live) setSlots(staffIds.length > 1 ? r.slots.filter((s) => staffIds.every((id) => s.staffIds.includes(id))) : r.slots); }).catch((e) => { if (live) setErr(errText(e, "Couldn't load free times.")); });
    return () => { live = false; };
  }, [scope, calendarId, staffIds.join(","), date, exclude]); // eslint-disable-line react-hooks/exhaustive-deps
  void data;
  if (err) return <div className="iv-error">{err}</div>;
  if (!slots) return <div className="iv-small">Finding free times…</div>;
  if (!slots.length) return <div className="iv-small sch-noslots">No free times that day{staffIds.length ? " for the people selected" : ""}. Try another day, or pick any time below.</div>;
  return <div className="sch-times">{slots.map((s) => <button key={s.start} type="button" className={value === s.start ? "on" : ""} onClick={() => onPick(s)}>{time(s.start)}</button>)}</div>;
}

type ApptDraft = { date: string; time: string; calendarId?: string; staffIds?: string[]; name?: string; email?: string; phone?: string; notes?: string };

function NewAppointment({ data, scope, initial, onClose, onSaved, onCalendarsChanged }: { data: Data; scope: string; initial: ApptDraft; onClose: () => void; onSaved: (msg: string) => void; onCalendarsChanged: () => void }) {
  const [calendars, setCalendars] = useState<Calendar[]>(data.calendars);
  const [calendarId, setCalendarId] = useState(initial.calendarId || data.calendars.find((c) => c.active)?.id || data.calendars[0]?.id || "");
  const cal = calendars.find((c) => c.id === calendarId);
  const [staffIds, setStaffIds] = useState<string[]>(initial.staffIds || []);
  const [date, setDate] = useState(initial.date || ymd(new Date()));
  const [slot, setSlot] = useState("");
  const [custom, setCustom] = useState(Boolean(initial.time));
  const [customTime, setCustomTime] = useState(initial.time || "09:00");
  const [form, setForm] = useState({ name: initial.name || "", email: initial.email || "", phone: initial.phone || "", notes: initial.notes || "" });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // No appointment types yet? Make a simple "General appointment" so booking always works.
  useEffect(() => {
    if (calendars.length) return;
    let live = true;
    api<{ calendar: Calendar }>(scope, { action: "quickCalendar" }).then((r) => { if (!live) return; setCalendars([r.calendar]); setCalendarId(r.calendar.id); onCalendarsChanged(); }).catch((e) => { if (live) setErr(errText(e, "Couldn't get booking ready.")); });
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const firstRender = useState(true);
  useEffect(() => { if (firstRender[0]) { firstRender[1](false); return; } setStaffIds([]); setSlot(""); }, [calendarId]); // eslint-disable-line react-hooks/exhaustive-deps
  const pool = data.staff.filter((s) => cal?.staffIds.includes(s.id) || custom || staffIds.includes(s.id));
  const days = Array.from({ length: 14 }, (_, i) => addDays(new Date(), i));
  const useAnyTime = () => { setCustom(true); if (!staffIds.length) setStaffIds(data.meId && data.staff.some((s) => s.id === data.meId) ? [data.meId] : data.staff[0] ? [data.staff[0].id] : []); };
  const when = custom ? (customTime ? `${new Date(`${date}T12:00:00`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" })} at ${customTime}` : "") : slot ? longDate(slot) : "";
  const save = async () => {
    setBusy(true); setErr("");
    try {
      const start = custom ? new Date(`${date}T${customTime}:00`).toISOString() : slot;
      if (!form.name.trim()) throw new Error("Add the customer's name.");
      if (!start) throw new Error("Pick a time.");
      if (custom && !staffIds.length) throw new Error("Choose who the appointment is with.");
      await api(scope, { action: "book", calendarId, start, staffIds, force: custom, ...form, answers, notify });
      onSaved(`Booked: ${form.name} · ${when}.`);
    } catch (e) { setErr(errText(e, "Couldn't book this appointment.")); }
    finally { setBusy(false); }
  };
  return <Modal title="New appointment" wide onClose={onClose} footer={<><span className="sch-foot-summary">{when ? <>📅 {when}</> : "Pick a time"}</span><span style={{ flex: 1 }} /><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="button" className="primary-button" disabled={busy || !form.name.trim() || !calendarId || (!custom && !slot)} onClick={() => void save()}>{busy ? "Booking…" : "Book appointment"}</button></>}>
    {err && <div className="iv-error" role="alert">{err}</div>}
    <h3 className="sch-h3">1 · Who's it for?</h3>
    <div className="iv-grid">
      <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} autoFocus placeholder="Customer name" /></Field>
      <Field label="Phone"><input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={40} /></Field>
      <Field label="Email"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={160} /></Field>
    </div>
    <h3 className="sch-h3">2 · What and with who?</h3>
    {!calendars.length ? <div className="iv-small">Getting things ready…</div> : <>
      <div className="sch-type-pick">{calendars.map((c) => <button key={c.id} type="button" className={c.id === calendarId ? "on" : ""} style={{ ["--c" as string]: c.color }} onClick={() => setCalendarId(c.id)}><b>{c.name}</b><small>{c.durationMin} min{data.scope === null && c.clientId ? ` · ${data.clients.find((x) => x.id === c.clientId)?.name || ""}` : ""}</small></button>)}</div>
      <div className="sch-staff-pick compact">
        {!custom && <button type="button" className={staffIds.length ? "" : "on"} aria-pressed={!staffIds.length} onClick={() => { setStaffIds([]); setSlot(""); }}><span className="sch-avatar" style={{ width: 26, height: 26, fontSize: 12 }}>★</span><span><b>{cal?.assignMode === "collective" ? "Everyone on this type" : "Anyone free"}</b></span></button>}
        {pool.map((s) => { const on = staffIds.includes(s.id); return <button key={s.id} type="button" className={on ? "on" : ""} aria-pressed={on} onClick={() => { setStaffIds(on ? staffIds.filter((x) => x !== s.id) : [...staffIds, s.id]); setSlot(""); }}><Avatar person={s} size={26} /><span><b>{s.name}</b></span></button>; })}
      </div>
      {staffIds.length > 1 && <div className="iv-small">They'll all be booked together, so only times when everyone is free are shown.</div>}
    </>}
    <h3 className="sch-h3">3 · When?</h3>
    <div className="sch-daystrip">{days.map((d) => { const k = ymd(d); return <button key={k} type="button" className={date === k ? "on" : ""} onClick={() => { setDate(k); setSlot(""); }}><small>{d.toLocaleDateString("en-IE", { weekday: "short" })}</small><b>{d.getDate()}</b><small>{d.toLocaleDateString("en-IE", { month: "short" })}</small></button>; })}
      <label className="sch-otherdate" title="Pick another date"><CalendarDays size={15} /><input type="date" aria-label="Other date" value={date} onChange={(e) => { setDate(e.target.value); setSlot(""); }} /></label></div>
    {custom ? <div className="sch-inline"><input type="time" aria-label="Time" value={customTime} onChange={(e) => setCustomTime(e.target.value)} /><button type="button" className="iv-btn" onClick={() => setCustom(false)}>Show free times instead</button></div>
      : cal ? <><SlotPicker data={data} scope={scope} calendarId={calendarId} staffIds={staffIds} date={date} value={slot} onPick={(s) => setSlot(s.start)} /><button type="button" className="sch-linkbtn" onClick={useAnyTime}>Need a time that isn't listed? Pick any time</button></> : null}
    {cal?.questions.length ? <><h3 className="sch-h3">Details</h3><div className="iv-grid">{cal.questions.map((q) => <Field key={q.id} label={q.label}>{q.type === "select" ? <select value={answers[q.id] || ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}><option value="">Choose…</option>{(q.options || []).map((o) => <option key={o}>{o}</option>)}</select> : <input value={answers[q.id] || ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />}</Field>)}</div></> : null}
    <Field label="Notes (only your team sees these)"><textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={2000} /></Field>
    {(form.email.trim() || !form.phone) && <label className="iv-check iv-small"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Email the customer a confirmation</label>}
  </Modal>;
}

function AppointmentDetail({ data, scope, booking, onClose, onSaved }: { data: Data; scope: string; booking: Booking; onClose: () => void; onSaved: (msg: string) => void }) {
  const cal = data.calendars.find((c) => c.id === booking.calendarId);
  const [staffIds, setStaffIds] = useState<string[]>(booking.staffIds);
  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState(ymd(new Date(booking.start)));
  const [slot, setSlot] = useState("");
  const [custom, setCustom] = useState(false);
  const [customTime, setCustomTime] = useState(time(booking.start));
  const [notes, setNotes] = useState(booking.notes);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const live = booking.status === "booked";
  const send = async (body: Record<string, unknown>, msg: string) => {
    setBusy(true); setErr("");
    try { await api(scope, { action: "updateBooking", id: booking.id, ...body }); onSaved(msg); }
    catch (e) { setErr(errText(e, "Couldn't update this appointment.")); }
    finally { setBusy(false); }
  };
  const staffChanged = staffIds.join(",") !== booking.staffIds.join(",");
  return <Modal title={`${cal?.name || "Appointment"} · ${booking.name}`} wide onClose={onClose}>
    {err && <div className="iv-error" role="alert">{err}</div>}
    <div className="sch-detail">
      <div><small>When</small><b>{longDate(booking.start)}–{time(booking.end)}</b></div>
      <div><small>Status</small><b className={`sch-status-text ${booking.status}`}>{STATUS_LABEL[booking.status]}</b></div>
      <div><small>Customer</small><b>{booking.name}</b>{booking.phone && <a href={`tel:${booking.phone}`}>{booking.phone}</a>}{booking.email && <a href={`mailto:${booking.email}`}>{booking.email}</a>}</div>
      <div><small>Where</small><b>{cal ? (cal.locationType === "onsite" ? "On-site" : cal.locationType === "video" ? "Google Meet" : cal.locationType === "phone" ? "Phone call" : "Office") : "—"}</b>{booking.meetLink && <a href={booking.meetLink} target="_blank" rel="noopener noreferrer">Join Meet</a>}</div>
      <div><small>Source</small><b>{booking.source === "public" ? "Online booking" : `Added by ${booking.createdBy || "team"}`}</b>{booking.channel && <span className="iv-small">{booking.channel}</span>}</div>
      {booking.answers.filter((a) => a.value).map((a) => <div key={a.label}><small>{a.label}</small><b>{a.value}</b></div>)}
    </div>
    <h3 className="sch-h3">With</h3>
    <div className="sch-staff-pick compact">{data.staff.filter((s) => cal?.staffIds.includes(s.id) || staffIds.includes(s.id) || data.isAdmin).map((s) => { const on = staffIds.includes(s.id); return <button key={s.id} type="button" disabled={!live} className={on ? "on" : ""} aria-pressed={on} onClick={() => setStaffIds(on ? staffIds.filter((x) => x !== s.id) : [...staffIds, s.id])}><Avatar person={s} size={26} /><span><b>{s.name}</b></span></button>; })}</div>
    {live && staffChanged && <div className="iv-actions" style={{ justifyContent: "flex-start" }}><button type="button" className="primary-button" disabled={busy || !staffIds.length} onClick={() => void send({ staffIds }, "Appointment reassigned. Calendars updated.")}>Save new assignment</button><button type="button" className="iv-btn" onClick={() => setStaffIds(booking.staffIds)}>Undo</button></div>}
    {live && <>
      <h3 className="sch-h3">Reschedule</h3>
      {!moving ? <button type="button" className="iv-btn" onClick={() => setMoving(true)}><CalendarDays size={13} /> Pick a new time</button> : <>
        <div className="iv-grid"><Field label="New date"><input type="date" value={date} onChange={(e) => { setDate(e.target.value); setSlot(""); }} /></Field><Field label="Time"><label className="iv-check iv-small"><input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} /> Custom time</label>{custom && <input type="time" value={customTime} onChange={(e) => setCustomTime(e.target.value)} />}</Field></div>
        {!custom && <SlotPicker data={data} scope={scope} calendarId={booking.calendarId} staffIds={staffIds} date={date} exclude={booking.id} value={slot} onPick={(s) => setSlot(s.start)} />}
        <div className="iv-actions" style={{ justifyContent: "flex-start" }}><button type="button" className="primary-button" disabled={busy || (!custom && !slot)} onClick={() => void send({ start: custom ? new Date(`${date}T${customTime}:00`).toISOString() : slot, staffIds }, "Appointment moved. The customer has been emailed.")}>Move appointment</button></div>
      </>}
    </>}
    <Field label="Internal notes"><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></Field>
    <footer>
      {notes !== booking.notes && <button type="button" className="iv-btn" disabled={busy} onClick={() => void send({ notes }, "Notes saved.")}>Save notes</button>}
      <span style={{ flex: 1 }} />
      {booking.status !== "cancelled" && Date.parse(booking.start) <= Date.now() + 3_600_000 && <>
        <button type="button" className="iv-btn ok" disabled={busy || booking.status === "completed"} onClick={() => void send({ status: "completed" }, "Marked as completed.")}>Completed</button>
        <button type="button" className="iv-btn danger" disabled={busy || booking.status === "no_show"} onClick={() => void send({ status: "no_show" }, "Marked as a no-show.")}>No-show</button></>}
      {live && <button type="button" className="iv-btn danger" disabled={busy} onClick={() => { if (window.confirm("Cancel this appointment? The customer will be emailed.")) void send({ status: "cancelled" }, "Appointment cancelled."); }}>Cancel appointment</button>}
    </footer>
  </Modal>;
}

/** Small dashboard card: next appointments for the current account. */
export function SchedulingDashboardCard({ scopeClientId, onOpen }: { scopeClientId: string; onOpen: () => void }) {
  const [rows, setRows] = useState<Array<Booking & { calName: string; staffNames: string }> | null>(null);
  useEffect(() => {
    let live = true;
    const from = new Date(), to = addDays(from, 14);
    api<Data>(scopeClientId, undefined, `&from=${from.toISOString()}&to=${to.toISOString()}`).then((d) => {
      if (!live) return;
      const cals = new Map(d.calendars.map((c) => [c.id, c.name])), staff = new Map(d.staff.map((s) => [s.id, s.name]));
      setRows(d.bookings.filter((b) => b.status === "booked" && Date.parse(b.end) >= Date.now()).slice(0, 5).map((b) => ({ ...b, calName: cals.get(b.calendarId) || "", staffNames: b.staffIds.map((id) => staff.get(id)?.split(" ")[0]).filter(Boolean).join(", ") })));
    }).catch(() => { if (live) setRows([]); });
    return () => { live = false; };
  }, [scopeClientId]);
  if (rows === null || !rows.length) return null;
  return <div className="iv-card sch-dash"><div className="sch-dash-head"><b><CalendarDays size={15} /> Upcoming appointments</b><button type="button" className="iv-btn" onClick={onOpen}>Open Scheduling</button></div>
    {rows.map((b) => <button key={b.id} type="button" className="sch-dash-row" onClick={onOpen}><span className="sch-when"><b>{new Date(b.start).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" })}</b><small>{time(b.start)}</small></span><span className="sch-what"><b>{b.name}</b><small>{b.calName}{b.staffNames ? ` · ${b.staffNames}` : ""}</small></span></button>)}
  </div>;
}

type AiResult = { action: "calendar" | "appointment" | "hours" | "answer"; reply: string; calendar?: Partial<Calendar>; appointment?: ApptDraft; hours?: Array<{ staffId: string; weekly: Partial<Record<DayKey, Window[]>>; daysOff: string[]; dailyLimit: number }> };
const AI_EXAMPLES = ["Free 60 min roof survey with Pat and Mick, customer picks who, 30 min travel buffer", "Book John Murphy 087 123 4567 for a survey Tuesday at 10am with Pat", "I work Mon–Thu 8 till 4, off on 24 and 26 December", "15 min discovery call for F2B on Google Meet, round robin"];

/** "Ask AI" — describe what you need in plain English; the AI drafts it and you confirm. */
function AiBar({ scope, data, onCalendar, onAppointment, onHours }: { scope: string; data: Data; onCalendar: (c: Partial<Calendar>) => void; onAppointment: (a: ApptDraft) => void; onHours: (h: NonNullable<AiResult["hours"]>) => Promise<void> }) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiResult | null>(null);
  const [err, setErr] = useState("");
  const [placeholder] = useState(() => AI_EXAMPLES[Math.floor(Math.random() * AI_EXAMPLES.length)]);
  const ask = async (text = prompt) => {
    if (!text.trim()) return;
    setBusy(true); setErr(""); setResult(null);
    try { setResult(await api<AiResult>(scope, { action: "ai", prompt: text })); }
    catch (e) { setErr(errText(e, "The AI couldn't help with that.")); }
    finally { setBusy(false); }
  };
  const staffName = (id: string) => data.staff.find((s) => s.id === id)?.name || "Someone";
  const apply = async () => {
    if (!result) return;
    if (result.action === "calendar" && result.calendar) onCalendar(result.calendar);
    if (result.action === "appointment" && result.appointment) onAppointment(result.appointment);
    if (result.action === "hours" && result.hours) { setBusy(true); await onHours(result.hours); setBusy(false); }
    setResult(null); setPrompt("");
  };
  return <div className="sch-ai">
    <form className="sch-ai-bar" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
      <span className="sch-ai-icon"><Sparkles size={18} /></span>
      <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={`Ask AI to set up or book anything… e.g. “${placeholder}”`} aria-label="Ask AI to set up or book anything" maxLength={1500} />
      <button type="submit" className="primary-button" disabled={busy || !prompt.trim()}>{busy ? "Thinking…" : "Ask AI"}</button>
    </form>
    {!prompt && !result && !busy && <div className="sch-ai-chips">{AI_EXAMPLES.map((x) => <button key={x} type="button" onClick={() => { setPrompt(x); void ask(x); }}>{x}</button>)}</div>}
    {err && <div className="iv-error" role="alert">{err}</div>}
    {result && <div className="sch-ai-result">
      <p>{result.reply}</p>
      {result.action === "calendar" && result.calendar && <ul><li><b>{result.calendar.name}</b> · {result.calendar.durationMin} min · {result.calendar.kind === "consultation" ? "Consultation" : "Service"}</li><li>With: {(result.calendar.staffIds || []).map(staffName).join(", ") || "nobody yet"} · {MODE_LABEL[result.calendar.assignMode || "customer_pick"]}</li>{(result.calendar.bufferBefore || result.calendar.bufferAfter) ? <li>Buffers: {result.calendar.bufferBefore || 0} min before, {result.calendar.bufferAfter || 0} min after</li> : null}{result.calendar.questions?.length ? <li>Asks: {result.calendar.questions.map((q) => q.label).join(" · ")}</li> : null}</ul>}
      {result.action === "appointment" && result.appointment && <ul><li><b>{result.appointment.name || "Customer"}</b>{result.appointment.phone ? ` · ${result.appointment.phone}` : ""}</li><li>{new Date(`${result.appointment.date}T12:00:00`).toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long" })}{result.appointment.time ? ` at ${result.appointment.time}` : ""}{result.appointment.staffIds?.length ? ` · with ${result.appointment.staffIds.map(staffName).join(", ")}` : ""}</li></ul>}
      {result.action === "hours" && result.hours && <ul>{result.hours.map((h) => <li key={h.staffId}><b>{staffName(h.staffId)}</b>: {DAY_LIST.filter(([k]) => h.weekly[k]?.length).map(([k, l]) => `${l.slice(0, 3)} ${(h.weekly[k] || []).map((w) => w.join("–")).join(", ")}`).join(" · ") || "no change to hours"}{h.daysOff.length ? ` · off ${h.daysOff.join(", ")}` : ""}</li>)}</ul>}
      <div className="iv-actions" style={{ justifyContent: "flex-start" }}>
        {result.action !== "answer" && <button type="button" className="primary-button" disabled={busy} onClick={() => void apply()}>{result.action === "calendar" ? "Review & create" : result.action === "appointment" ? "Review & book" : "Apply hours"}</button>}
        <button type="button" className="iv-btn" onClick={() => setResult(null)}>Dismiss</button>
      </div>
    </div>}
  </div>;
}

/** Pops up on entry: asks about past appointments nobody has updated (showed / no-show / cancelled). */
function CatchUp({ data, scope, onClose, onChanged }: { data: Data; scope: string; onClose: () => void; onChanged: () => void }) {
  const [done, setDone] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [snoozed] = useState(() => { try { return sessionStorage.getItem("f2b-sched-catchup") === "later"; } catch { return false; } });
  const pending = data.bookings.filter((b) => b.status === "booked" && Date.parse(b.end) < Date.now() - 15 * 60_000 && !done.includes(b.id)).sort((a, b) => b.start.localeCompare(a.start));
  if (snoozed || !pending.length) return null;
  const b = pending[0];
  const cal = data.calendars.find((c) => c.id === b.calendarId);
  const staff = b.staffIds.map((id) => data.staff.find((s) => s.id === id)?.name.split(" ")[0]).filter(Boolean).join(" & ");
  const mark = async (status: string) => {
    setBusy(true); setErr("");
    try { await api(scope, { action: "updateBooking", id: b.id, status, notify: false }); setDone((d) => [...d, b.id]); onChanged(); }
    catch (e) { setErr(errText(e, "Couldn't update that appointment.")); }
    finally { setBusy(false); }
  };
  const later = () => { try { sessionStorage.setItem("f2b-sched-catchup", "later"); } catch { /* optional */ } onClose(); };
  return <div className="sch-catchup" role="dialog" aria-label="Appointment catch-up">
    <div className="sch-catchup-head"><span className="sch-star" aria-hidden="true">✦</span><div><b>Quick catch-up</b><small>{pending.length} past appointment{pending.length === 1 ? "" : "s"} still need{pending.length === 1 ? "s" : ""} an update</small></div><button type="button" className="iv-x" aria-label="Close" onClick={later}>✕</button></div>
    <p>Did <b>{b.name}</b> turn up for <b>{cal?.name || "their appointment"}</b> on {new Date(b.start).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" })} at {time(b.start)}{staff ? ` with ${staff}` : ""}?</p>
    {err && <div className="iv-error">{err}</div>}
    <div className="sch-catchup-actions">
      <button type="button" className="iv-btn ok" disabled={busy} onClick={() => void mark("completed")}>✓ Showed up</button>
      <button type="button" className="iv-btn danger" disabled={busy} onClick={() => void mark("no_show")}>No-show</button>
      <button type="button" className="iv-btn" disabled={busy} onClick={() => void mark("cancelled")}>It was cancelled</button>
      <button type="button" className="sch-linkbtn" onClick={() => setDone((d) => [...d, b.id])}>Skip</button>
    </div>
    <small className="iv-small">No-shows and completed visits can trigger your Automations (e.g. a review request).</small>
  </div>;
}
