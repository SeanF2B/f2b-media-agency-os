"use client";

import { useSampleData } from "@/hooks/use-sample-data";
import { appAlert, appConfirm, appPrompt } from "./app-dialog";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ImagePlus, Sparkles, CalendarDays, ChevronLeft, ChevronRight, Clock, Copy, Link2, MapPin, Plus, RefreshCw, Settings2, Trash2, UserRound, Users, Video, Phone, Building2 } from "lucide-react";
import "./scheduling.css";
import { ReportGeneratingAnimation } from "./report-generating-animation";
import { computePayslip, maskPps, normalisePps, validPps, DEFAULT_PERSON, EMPTY_YTD, type PayrollEmployer, type PayrollPerson } from "@/lib/scheduling/payroll";
import type { PayLine, PayslipRecord } from "@/lib/scheduling/payroll-store";

type DayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
type Window = [string, string];
type Question = { id: string; label: string; required?: boolean; type?: "text" | "textarea" | "select"; options?: string[] };
type Calendar = { id: string; clientId: string; name: string; slug: string; kind: "service" | "consultation"; description: string; durationMin: number; bufferBefore: number; bufferAfter: number; slotInterval: number; minNoticeMin: number; maxDaysAhead: number; dailyLimit: number; locationType: "onsite" | "phone" | "video" | "office"; locationDetail: string; price: number; currency: string; color: string; assignMode: "customer_pick" | "round_robin" | "collective"; staffIds: string[]; questions: Question[]; stageId: string; confirmationMessage: string; redirectUrl: string; active: boolean; timezone: string };
type StaffReview = { id: string; author: string; rating: number; text: string; source: string; date: string };
type StaffProfile = { showReviews: boolean; showPhotos: boolean; title: string; bio: string; reviews: StaffReview[]; photos: Array<{ url: string; caption: string }>; payType?: "none" | "hourly" | "commission"; payRate?: number };
type Staff = { id: string; name: string; email?: string; role?: string; avatar?: string; profile?: StaffProfile | null; timezone?: string; weekly?: Partial<Record<DayKey, Window[]>>; blocked?: string[]; dailyLimit: number; google: string; feedUrl: string; canEdit: boolean };
type Booking = { id: string; clientId: string; calendarId: string; start: string; end: string; status: "booked" | "cancelled" | "completed" | "no_show"; staffIds: string[]; contactId: string | null; name: string; email: string; phone: string; answers: Array<{ label: string; value: string }>; notes: string; source: string; channel: string; meetLink: string; createdBy: string; createdAt: string };
type Data = { calendars: Calendar[]; bookings: Booking[]; staff: Staff[]; clients: Array<{ id: string; name: string; logo: string }>; scope: string | null; canManage: boolean; isAdmin: boolean; meId: string; googleAvailable: boolean; emailReady: boolean; publicBase: string };
type Slot = { start: string; end: string; staffIds: string[] };

const DAY_LIST: Array<[DayKey, string]> = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]];
const SHOW_LEGACY_DASH = false as boolean; // old Scheduling dashboard (replaced by the shared appointments panel)
const HOURS_FROM = 7, HOURS_TO = 21, PX_DEFAULT = 0.9;
const STATUS_LABEL: Record<Booking["status"], string> = { booked: "Booked", cancelled: "Cancelled", completed: "Completed", no_show: "No-show" };
// Studio-style businesses (tattoo, piercing) always work from their own studio, so a per-appointment location isn't asked.
const isStudioBusiness = (data: Data, cal?: Calendar) => { const client = data.clients.find((c) => c.id === (cal?.clientId || data.scope || "")); return /tattoo|\bink\b|piercing/i.test(`${client?.name || ""} ${cal?.name || ""}`); };
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

// A reference photo attached to the booking (e.g. the tattoo design), shown on the calendar.
function bookingPhoto(b: Booking): string {
  const v = b.answers.find((a) => /^Photo/i.test(a.label) && /^(https:\/\/|\/media\/|\/api\/marketing-public\/media)/.test(a.value))?.value || "";
  return v;
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

export function SchedulingView({ scopeClientId, onAddStaff, onEditStaff }: { scopeClientId: string; onAddStaff?: () => void; onEditStaff?: (staffId: string) => void }) {
  // Stretch the day so 07:00–21:00 fills the window (calendar always in full view).
  const weekRef = useRef<HTMLDivElement>(null);
  const [PX_PER_MIN, setPpm] = useState(PX_DEFAULT);
  const [realData, setData] = useState<Data | null>(null);
  const [sample] = useSampleData();
  const [sampleMoves, setSampleMoves] = useState<Record<string, string>>({});
  const site = useSiteSample(scopeClientId, sample);
  const sampleClientName = realData?.clients.find((c) => c.id === scopeClientId)?.name || "";
  const data = useMemo(() => {
    if (!sample || !realData) return realData;
    const demo = sampleSchedule(realData, mondayOf(new Date()), sampleClientName, site);
    return { ...demo, canManage: realData.canManage, isAdmin: realData.isAdmin, meId: realData.meId, googleAvailable: realData.googleAvailable, bookings: demo.bookings.map((b) => sampleMoves[b.id] ? { ...b, start: sampleMoves[b.id], end: new Date(Date.parse(sampleMoves[b.id]) + Date.parse(b.end) - Date.parse(b.start)).toISOString() } : b) };
  }, [sample, realData, sampleClientName, site, sampleMoves]);
  const [tab, setTab] = useState<"dashboard" | "calendar" | "appointments" | "calendars" | "availability">("calendar"); // Scheduling opens on the calendar
  useEffect(() => {
    const fit = () => { const el = weekRef.current; if (!el) return; const top = el.getBoundingClientRect().top; const room = window.innerHeight - top - 52 - 24; setPpm(Math.max(1.05, Math.min(2.2, room / ((HOURS_TO - HOURS_FROM) * 60)))); };
    fit(); const t = window.setTimeout(fit, 250); window.addEventListener("resize", fit);
    return () => { window.clearTimeout(t); window.removeEventListener("resize", fit); };
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const [dashDate, setDashDate] = useState(() => new Date());
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
  const [editProfile, setEditProfile] = useState<Staff | null>(null);
  const [listMode, setListMode] = useState<"upcoming" | "past" | "cancelled">("upcoming");
  const dragRef = useRef<{ id: string; grabMin: number } | null>(null);
  const [sel, setSel] = useState<{ day: string; a: number; b: number; moved: boolean } | null>(null); // drag on empty time to create
  const [dropHint, setDropHint] = useState<{ day: string; min: number } | null>(null);
  const moveBooking = async (b: Booking, dayKey: string, minOfDay: number) => {
    const start = new Date(`${dayKey}T00:00:00`); start.setMinutes(minOfDay);
    if (start.toISOString() === new Date(b.start).toISOString()) return;
    const dur = Date.parse(b.end) - Date.parse(b.start);
    if (b.id.startsWith("sample-")) { setSampleMoves((m) => ({ ...m, [b.id]: start.toISOString() })); setNote(`Sample: moved ${b.name} to ${time(start.toISOString())} (not saved).`); return; }
    setData((d) => d ? { ...d, bookings: d.bookings.map((x) => x.id === b.id ? { ...x, start: start.toISOString(), end: new Date(start.getTime() + dur).toISOString() } : x) } : d);
    try { await api(scopeClientId, { action: "updateBooking", id: b.id, start: start.toISOString() }); setNote(`Moved ${b.name} to ${start.toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" })} at ${time(start.toISOString())}.`); }
    catch (e) { setError(errText(e, "Couldn't move that appointment.")); }
    void load();
  };

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
  const personOf = (id: string) => { const p = staffById.get(id); return p ? { name: p.name.split("|")[0].trim(), avatar: p.avatar } : { name: "?" }; };
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
    {sample && <div className="dh-sample-banner">Showing sample appointments{site.team.length ? ` with ${sampleClientName || "the client"}’s own team${site.gallery?.length || Object.keys(site.work || {}).length ? " and photos of their work" : ""}` : site.services.length ? ` built from ${sampleClientName || "the client"}’s website` : ""} — drag, open and demo freely; nothing is saved. Turn off “Sample data” for real bookings.{scopeClientId && !site.team.length && !site.services.length ? " Add the client’s website to their profile to show their real team and services." : ""}</div>}
    {!data.emailReady && <div className="iv-warn">Email isn't set up on the server, so confirmations and reminders won't send yet. Bookings still save.</div>}

    <AiBar scope={scopeClientId} data={data} onCalendar={(c) => setEditCal(c)} onCreateCalendar={async (c) => Boolean(await act({ action: "saveCalendar", calendar: c }, `“${c.name}” created. Copy its booking link from Booking calendars.`))} onAppointment={(a) => setNewAppt(a)} onHours={async (hours) => { for (const h of hours) { const person = data.staff.find((x) => x.id === h.staffId); await act({ action: "saveAvailability", staffId: h.staffId, weekly: h.weekly, blocked: [...new Set([...(person?.blocked || []), ...h.daysOff])], dailyLimit: h.dailyLimit || person?.dailyLimit || 0, timezone: person?.timezone || "Europe/Dublin" }); } setNote("Working hours updated."); setTab("availability"); }} />
    <div className="iv-stats"><div><small>Next 7 days</small><b>{stats.upcoming}</b></div><div><small>Booked this month</small><b>{stats.month}</b></div><div><small>Show-up rate</small><b>{stats.showRate === null ? "—" : `${stats.showRate}%`}</b></div><div className={stats.noShow ? "bad" : ""}><small>No-shows</small><b>{stats.noShow}</b></div>
      <div className="sch-perstaff"><small>This month by person</small>{stats.perStaff.length ? stats.perStaff.map(({ s, n }) => <span key={s.id}><Avatar person={s} size={20} /> {s.name.split(" ")[0]} <b>{n}</b></span>) : <span className="iv-small">No bookings yet</span>}</div></div>

    <div className="sch-toolbar">
      <div className="iv-tabs" role="tablist" aria-label="Scheduling sections">{([["dashboard", "Dashboard"], ["calendar", "Calendar"], ["appointments", "Appointments"], ["calendars", "Booking calendars"], ["availability", "Staff & availability"]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
      {(tab === "calendar" || tab === "appointments") && <div className="sch-filters">
        <label className="sch-select"><Users size={14} /><select aria-label="Filter by staff member" value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)}><option value="">Everyone</option>{data.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="sch-select"><CalendarDays size={14} /><select aria-label="Filter by booking calendar" value={calFilter} onChange={(e) => setCalFilter(e.target.value)}><option value="">All calendars</option>{data.calendars.map((c) => <option key={c.id} value={c.id}>{data.scope === null && c.clientId ? `${clientName(c.clientId)} · ` : ""}{c.name}</option>)}</select></label>
      </div>}
    </div>

    {tab === "dashboard" && <AppointmentsDashboard scopeClientId={scopeClientId} sample={sample} clientName={sampleClientName} onOpen={() => setTab("calendar")} />}
    {SHOW_LEGACY_DASH && (() => {
      const key = ymd(dashDate); const isToday = key === todayKey;
      const dayList = visible.filter((b) => ymd(new Date(b.start)) === key && b.status !== "cancelled").sort((x, y) => x.start.localeCompare(y.start));
      const statusOf = (b: Booking): [string, string] => { const now = Date.now(), st = Date.parse(b.start), en = Date.parse(b.end); if (b.status === "no_show") return ["No-show", "bad"]; if (b.status === "completed" || en < now) return ["Done", "done"]; if (st <= now && now <= en) return ["In progress", "live"]; return ["Confirmed", "ok"]; };
      const dayKeyName = (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as DayKey[])[dashDate.getDay()];
      const mins = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + (m || 0); };
      const hm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
      const staffSlots = (st: Staff) => {
        if (st.blocked?.includes(key)) return [{ from: "", to: "", state: "off" as const }];
        const windows = st.weekly?.[dayKeyName] || [];
        const booked = dayList.filter((b) => b.staffIds.includes(st.id)).map((b) => { const s0 = new Date(b.start), e0 = new Date(b.end); return [s0.getHours() * 60 + s0.getMinutes(), e0.getHours() * 60 + e0.getMinutes(), b] as const; });
        const out: Array<{ from: string; to: string; state: "booked" | "free" | "off"; who?: string }> = [];
        for (const w of windows) { let cur = mins(w[0]); const end = mins(w[1]); for (const [bs, be, b] of booked.filter(([bs, be]) => be > cur && bs < end).sort((x, y) => x[0] - y[0])) { if (bs > cur) out.push({ from: hm(cur), to: hm(bs), state: "free" }); out.push({ from: hm(Math.max(bs, cur)), to: hm(Math.min(be, end)), state: "booked", who: b.name }); cur = Math.max(cur, be); } if (cur < end) out.push({ from: hm(cur), to: hm(end), state: "free" }); }
        return out;
      };
      return <div className="sch-dash">
        <div className="iv-card sch-dash-appts">
          <div className="sch-dash-head"><h3>{isToday ? "Today’s appointments" : dashDate.toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "short" })}</h3><div className="sch-dash-nav"><button type="button" className="iv-btn" aria-label="Previous day" onClick={() => setDashDate(addDays(dashDate, -1))}><ChevronLeft size={15} /></button><input type="date" value={key} onChange={(e) => e.target.value && setDashDate(new Date(`${e.target.value}T12:00:00`))} aria-label="Pick a date" /><button type="button" className="iv-btn" aria-label="Next day" onClick={() => setDashDate(addDays(dashDate, 1))}><ChevronRight size={15} /></button><button type="button" className="iv-btn" style={{ visibility: isToday ? "hidden" : "visible" }} onClick={() => setDashDate(new Date())}>Today</button></div></div>
          <div className="sch-dash-stats"><span><b>{dayList.length}</b> booked</span><span><b>{dayList.filter((b) => statusOf(b)[0] === "Confirmed").length}</b> to come</span><span><b>{dayList.filter((b) => statusOf(b)[0] === "Done").length}</b> done</span>{dayList.some((b) => b.status === "no_show") && <span><b>{dayList.filter((b) => b.status === "no_show").length}</b> no-show</span>}</div>
          {dayList.length ? <ul className="sch-dash-list">{dayList.map((b) => { const [label, tone] = statusOf(b); const cal = calById.get(b.calendarId); return <li key={b.id} onClick={() => setDetail(b)}><time>{time(b.start)}</time>{b.staffIds.length ? <span className="sch-dash-avs">{b.staffIds.slice(0, 2).map((id) => <Avatar key={id} person={personOf(id)} size={30} />)}</span> : <span className="sch-dash-av" style={{ ["--c" as string]: cal?.color || "#2563eb" }}>{(b.name || "?").slice(0, 1).toUpperCase()}</span>}<span className="sch-dash-who"><b>{b.name}</b><small>{cal?.name || ""}</small><small className="sch-dash-staff">{b.staffIds.map((id) => staffById.get(id)?.name.split(" ")[0]).filter(Boolean).join(", ")}</small></span><span className={`sch-dash-status ${tone}`}>{label}</span></li>; })}</ul> : <p className="iv-small sch-dash-empty">Nothing booked{isToday ? " today" : " on this day"}.</p>}
        </div>
        <div className="iv-card sch-dash-staff-card">
          <div className="sch-dash-head"><h3>Staff availability</h3><span className="iv-small">{dashDate.toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" })}</span></div>
          <div className="sch-avail-list">{data.staff.map((st) => {
            const slots = staffSlots(st);
            const off = !slots.length || slots[0].state === "off";
            const working = slots.filter((x) => x.state !== "off");
            const dayStart = working.length ? mins(working[0].from) : 0, dayEnd = working.length ? mins(working[working.length - 1].to) : 1;
            const freeMins = working.filter((x) => x.state === "free").reduce((n, x) => n + mins(x.to) - mins(x.from), 0);
            const bookedCount = working.filter((x) => x.state === "booked").length;
            const summary = off ? (slots[0]?.state === "off" ? "Day off" : "Not working") : !bookedCount ? "Free all day" : freeMins ? `${Math.floor(freeMins / 60)}h${freeMins % 60 ? ` ${freeMins % 60}m` : ""} free` : "Fully booked";
            return <div key={st.id} className={`sch-avail-row${off ? " off" : ""}`}>
              <Avatar person={st} size={32} />
              <div className="sch-avail-name"><b>{st.name.split("|")[0].trim()}</b><small>{working.length ? `${working[0].from}–${working[working.length - 1].to}` : st.role}</small></div>
              <div className="sch-avail-track" aria-hidden="true">{working.map((x, i) => <i key={i} className={x.state} title={x.state === "booked" ? `${x.from}–${x.to} · ${x.who || "Booked"}` : `${x.from}–${x.to} free`} style={{ left: `${((mins(x.from) - dayStart) / Math.max(1, dayEnd - dayStart)) * 100}%`, width: `${((mins(x.to) - mins(x.from)) / Math.max(1, dayEnd - dayStart)) * 100}%` }} />)}</div>
              <span className={`sch-avail-pill ${off ? "off" : !bookedCount ? "free" : freeMins ? "some" : "full"}`}>{summary}</span>
            </div>; })}</div>
        </div>
      </div>;
    })()}
    {tab === "calendar" && <div className="iv-card sch-week-card">
      <div className="sch-week-nav"><button type="button" className="iv-btn" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))}><ChevronLeft size={15} /></button><button type="button" className="iv-btn" onClick={() => setWeek(mondayOf(new Date()))}>Today</button><button type="button" className="iv-btn" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))}><ChevronRight size={15} /></button>
        <b>{week.toLocaleDateString("en-IE", { day: "numeric", month: "short" })} – {addDays(week, 6).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" })}</b>
        <button type="button" className="iv-btn" aria-label="Refresh" onClick={() => void load()}><RefreshCw size={14} /></button></div>
      <div className="sch-week" ref={weekRef} style={{ ["--sch-h" as string]: `${(HOURS_TO - HOURS_FROM) * 60 * PX_PER_MIN}px` }}>
        <div className="sch-hours">{Array.from({ length: HOURS_TO - HOURS_FROM }, (_, i) => <span key={i} style={{ top: i * 60 * PX_PER_MIN }}>{String(HOURS_FROM + i).padStart(2, "0")}:00</span>)}</div>
        {days.map((d) => { const key = ymd(d); const dayBookings = visible.filter((b) => ymd(new Date(b.start)) === key);
          return <div key={key} className={`sch-day${key === todayKey ? " today" : ""}`}>
            <div className="sch-day-head"><small>{d.toLocaleDateString("en-IE", { weekday: "short" })}</small><b>{d.getDate()}</b></div>
            <div className="sch-day-body"
              onDragOver={(e) => { if (!dragRef.current) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); const m = Math.max(HOURS_FROM * 60, Math.min(HOURS_TO * 60 - 15, Math.round(((e.clientY - rect.top) / PX_PER_MIN - dragRef.current.grabMin) / 15) * 15 + HOURS_FROM * 60)); if (!dropHint || dropHint.day !== key || dropHint.min !== m) setDropHint({ day: key, min: m }); }}
              onDragLeave={(e) => { if (e.currentTarget === e.target) setDropHint(null); }}
              onDrop={(e) => { e.preventDefault(); const drag = dragRef.current; dragRef.current = null; const hint = dropHint; setDropHint(null); const b = drag && data?.bookings.find((x) => x.id === drag.id); if (b && hint) void moveBooking(b, hint.day, hint.min); }}
              onPointerDown={(e) => { if (e.target !== e.currentTarget || e.button !== 0) return; const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); const m = Math.max(HOURS_FROM * 60, Math.min(HOURS_TO * 60 - 15, Math.floor(((e.clientY - rect.top) / PX_PER_MIN) / 15) * 15 + HOURS_FROM * 60)); (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId); setSel({ day: key, a: m, b: m + 30, moved: false }); }}
              onPointerMove={(e) => { if (!sel || sel.day !== key) return; const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); const m = Math.max(HOURS_FROM * 60, Math.min(HOURS_TO * 60, Math.ceil(((e.clientY - rect.top) / PX_PER_MIN) / 15) * 15 + HOURS_FROM * 60)); const b = Math.max(sel.a + 15, m); if (b !== sel.b) setSel({ ...sel, b, moved: true }); }}
              onPointerUp={() => { if (!sel || sel.day !== key) return; const { a, b, moved } = sel; setSel(null); setNewAppt({ date: key, time: `${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`, durationMin: moved ? b - a : undefined }); }}
              onPointerCancel={() => setSel(null)}
              title="Click or drag on an empty time to add an appointment">
              {sel?.day === key && <div className="sch-sel" style={{ top: (sel.a - HOURS_FROM * 60) * PX_PER_MIN, height: Math.max(14, (sel.b - sel.a) * PX_PER_MIN) }}><b>{String(Math.floor(sel.a / 60)).padStart(2, "0")}:{String(sel.a % 60).padStart(2, "0")} – {String(Math.floor(sel.b / 60)).padStart(2, "0")}:{String(sel.b % 60).padStart(2, "0")}</b><small>{sel.b - sel.a >= 60 ? `${Math.floor((sel.b - sel.a) / 60)}h${(sel.b - sel.a) % 60 ? ` ${(sel.b - sel.a) % 60}m` : ""}` : `${sel.b - sel.a} min`}</small></div>}
              {Array.from({ length: HOURS_TO - HOURS_FROM }, (_, i) => <i key={i} className="sch-line" style={{ top: i * 60 * PX_PER_MIN }} />)}
              {key === todayKey && (() => { const n = new Date(); const m = n.getHours() * 60 + n.getMinutes() - HOURS_FROM * 60; return m > 0 && m < (HOURS_TO - HOURS_FROM) * 60 ? <i className="sch-now" style={{ top: m * PX_PER_MIN }} /> : null; })()}
              {dropHint?.day === key && <i className="sch-drop-hint" style={{ top: (dropHint.min - HOURS_FROM * 60) * PX_PER_MIN }}><b>{String(Math.floor(dropHint.min / 60)).padStart(2, "0")}:{String(dropHint.min % 60).padStart(2, "0")}</b></i>}
              {(() => { // side-by-side lanes for overlapping appointments
                const sorted = [...dayBookings].sort((a, z) => a.start.localeCompare(z.start)); const laneEnd: number[] = []; const lane = new Map<string, number>(); const groupOf = new Map<string, number>(); let group = 0, groupEnd = 0; const groupLanes: number[] = [];
                for (const b of sorted) { const st = Date.parse(b.start), en = Date.parse(b.end); if (st >= groupEnd) { group++; laneEnd.length = 0; } groupEnd = Math.max(groupEnd, en); let l = laneEnd.findIndex((x) => x <= st); if (l < 0) { l = laneEnd.length; laneEnd.push(en); } else laneEnd[l] = en; lane.set(b.id, l); groupOf.set(b.id, group); groupLanes[group] = Math.max(groupLanes[group] || 0, l + 1); }
                (dayBookings as Array<Booking & { _lane?: number; _lanes?: number }>).forEach((b) => { b._lane = lane.get(b.id) || 0; b._lanes = groupLanes[groupOf.get(b.id) || 0] || 1; });
                return null; })()}
              {dayBookings.map((b) => { const s = new Date(b.start), e = new Date(b.end); const top = Math.max(0, (s.getHours() * 60 + s.getMinutes() - HOURS_FROM * 60) * PX_PER_MIN); const height = Math.max(22, ((e.getTime() - s.getTime()) / 60000) * PX_PER_MIN - 2); const cal = calById.get(b.calendarId);
                const canDrag = b.status === "booked" && (data?.canManage || b.staffIds.includes(data?.meId || ""));
                return <button key={b.id} type="button" className={`sch-block ${b.status}${canDrag ? " draggable" : ""}${height < 44 ? " short" : ""}`} style={{ top, height, left: `calc(${((b as Booking & { _lane?: number })._lane || 0) * 100 / ((b as Booking & { _lanes?: number })._lanes || 1)}% + 3px)`, width: `calc(${100 / ((b as Booking & { _lanes?: number })._lanes || 1)}% - 6px)`, right: "auto", ["--c" as string]: cal?.color || "#2563eb" }} draggable={canDrag}
                  onDragStart={(ev) => { const r = (ev.currentTarget as HTMLElement).getBoundingClientRect(); dragRef.current = { id: b.id, grabMin: (ev.clientY - r.top) / PX_PER_MIN }; ev.dataTransfer.effectAllowed = "move"; ev.dataTransfer.setData("text/plain", b.id); (ev.currentTarget as HTMLElement).classList.add("dragging"); }}
                  onDragEnd={(ev) => { (ev.currentTarget as HTMLElement).classList.remove("dragging"); dragRef.current = null; setDropHint(null); }}
                  onClick={() => setDetail(b)} title={`${time(b.start)} ${cal?.name || ""} · ${b.name}`}>
                  <span className="sch-block-avs">{b.staffIds.slice(0, 3).map((id) => <Avatar key={id} person={staffById.get(id) || { name: "?" }} size={20} />)}</span><b>{time(b.start)} {b.name}</b><span>{cal?.name}</span><em>{b.staffIds.map((id) => staffById.get(id)?.name.split(" ")[0]).filter(Boolean).join(", ")}</em>{height >= 72 && (() => { const pic = bookingPhoto(b); return pic ? <img className="sch-block-img" src={pic} alt="" loading="lazy" draggable={false} onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = "none"; }} /> : null; })()}</button>; })}
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
        const groups: Array<[string, string]> = []; // e.g. ["Mon–Fri", "09:00–17:00"]
        for (const [k, l] of days) { const hours = (s.weekly?.[k] || []).map((w) => `${w[0]}–${w[1]}`).join(", "); const last = groups[groups.length - 1]; const prevKey = days[days.findIndex(([x]) => x === k) - 1]?.[0]; if (last && last[1] === hours && prevKey && DAY_LIST.findIndex(([x]) => x === k) - DAY_LIST.findIndex(([x]) => x === prevKey) === 1) last[0] = `${last[0].split("–")[0]}–${l.slice(0, 3)}`; else groups.push([l.slice(0, 3), hours]); }
        const rating = s.profile?.reviews.length ? (s.profile.reviews.reduce((n, r) => n + r.rating, 0) / s.profile.reviews.length).toFixed(1) : "";
        const offSoon = s.blocked?.filter((d) => d >= todayKey).length || 0;
        return <div key={s.id} className="iv-card sch-staff sch-staff-clean">
          <div className="sch-staff-top"><Avatar person={s} size={42} /><div><b>{s.name.split("|")[0].trim()}</b><small>{s.profile?.title || (s.name.includes("|") ? s.name.split("|")[1].trim() : s.role)}</small></div>
            {(onEditStaff || s.canEdit || data.canManage) && <button type="button" className="iv-btn sch-edit-btn" onClick={() => onEditStaff ? onEditStaff(s.id) : setEditAvail(s)}><Settings2 size={13} /> Edit</button>}</div>
          <div className="sch-staff-lines">
            <span><Clock size={13} /> {groups.length ? groups.map(([d, h]) => `${d} ${h}`).join(" · ") : <span className="iv-need-text">No working hours, so nobody can book them</span>}</span>
            {offSoon > 0 && <span className="iv-small">🏖 {offSoon} day{offSoon === 1 ? "" : "s"} off coming up</span>}
          </div>
          <div className="sch-staff-chips">
            <span className={`sch-chip-status ${s.google ? "on" : ""}`}><img src="https://www.gstatic.com/images/branding/product/1x/calendar_2020q4_48dp.png" alt="" width={14} height={14} />{s.google ? "Google synced" : "Google not connected"}</span>
            <span className={`sch-chip-status ${s.feedUrl ? "on" : ""}`}>📅 {s.feedUrl ? "Apple/Outlook feed on" : "No calendar feed"}</span>
            {rating && <span className={`sch-chip-status ${s.profile?.showReviews ? "on gold" : ""}`}>★ {rating} · {s.profile?.reviews.length}</span>}
          </div>
        </div>; })}
      {onAddStaff && <button type="button" className="iv-card sch-staff sch-add-staff" onClick={onAddStaff}><span className="sch-add-plus">＋</span><b>Add staff</b><small>Invite a team member, then connect their calendar</small></button>}
    </div>}

    {newAppt && realData && <NewAppointment data={realData} scope={scopeClientId} initial={newAppt} onClose={() => setNewAppt(null)} onSaved={async (msg) => { setNewAppt(null); setNote(msg); await load(); }} onCalendarsChanged={() => void load()} />}
    {catchUpOpen && !detail && !newAppt && <CatchUp data={data} scope={scopeClientId} onClose={() => setCatchUpOpen(false)} onChanged={() => void load()} />}
    {detail && <AppointmentDetail key={detail.id} data={data} scope={scopeClientId} booking={detail} onClose={() => setDetail(null)} onSaved={async (msg) => { setDetail(null); setNote(msg); await load(); }} />}
    {editCal && <CalendarEditor data={data} value={editCal} busy={busy} onClose={() => setEditCal(null)} onSave={async (cal) => { const out = await act({ action: "saveCalendar", calendar: cal }, cal.id ? "Booking calendar saved." : "Booking calendar created. Copy its link or embed code to start taking bookings."); if (out) setEditCal(null); }} onDelete={editCal.id ? async () => { if (!(await appConfirm("Delete this booking calendar? Its booking link will stop working."))) return; const out = await act({ action: "deleteCalendar", id: editCal.id }, "Booking calendar deleted."); if (out) setEditCal(null); } : undefined} />}
    {editProfile && <Modal title={`${editProfile.name.split("|")[0].trim()}: booking profile`} wide onClose={() => { setEditProfile(null); void load(); }} footer={<button type="button" className="primary-button" onClick={() => { setEditProfile(null); void load(); }}>Done</button>}><StaffShowcaseEditor staffId={editProfile.id} scope={scopeClientId} staffName={editProfile.name} /></Modal>}
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

type HoursValue = { weekly: Partial<Record<DayKey, Window[]>>; blocked: string[]; dailyLimit: number; timezone: string };
function HoursForm({ staff, onChange }: { staff: Staff; onChange: (v: HoursValue) => void }) {
  const [weekly, setWeekly] = useState<Partial<Record<DayKey, Window[]>>>(staff.weekly || {});
  const [blocked, setBlocked] = useState<string[]>(staff.blocked || []);
  const [limit, setLimit] = useState(staff.dailyLimit || 0);
  const [tz, setTz] = useState(staff.timezone || "Europe/Dublin");
  const [off, setOff] = useState("");
  useEffect(() => { onChange({ weekly, blocked, dailyLimit: limit, timezone: tz }); }, [weekly, blocked, limit, tz]); // eslint-disable-line react-hooks/exhaustive-deps
  const setDay = (k: DayKey, w: Window[]) => setWeekly((x) => ({ ...x, [k]: w }));
  const today = ymd(new Date());
  return <>
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
  </>;
}

function AvailabilityEditor({ staff, busy, onClose, onSave }: { staff: Staff; busy: boolean; onClose: () => void; onSave: (v: HoursValue) => void }) {
  const [value, setValue] = useState<HoursValue | null>(null);
  return <Modal title={`${staff.name}: hours & days off`} onClose={onClose} footer={<><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="button" className="primary-button" disabled={busy || !value} onClick={() => value && onSave(value)}>{busy ? "Saving…" : "Save"}</button></>}>
    <HoursForm staff={staff} onChange={setValue} />
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

type ApptDraft = { date: string; time: string; durationMin?: number; images?: string[]; calendarId?: string; staffIds?: string[]; name?: string; email?: string; phone?: string; notes?: string };

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
  const [location, setLocation] = useState("");
  const [duration, setDuration] = useState(initial.durationMin || 0); // 0 = the appointment type's own length
  const [price, setPrice] = useState("");
  const [images, setImages] = useState<string[]>(() => (initial.images || []).slice(0, 3));
  const [uploading, setUploading] = useState(0);
  const uploadImages = async (files: FileList | null) => {
    const list = [...(files || [])].filter((f) => f.type.startsWith("image/")).slice(0, 3 - images.length);
    for (const file of list) {
      setUploading((n) => n + 1);
      try {
        const q = new URLSearchParams({ scope: scope || "agency", folder: "Appointment photos", name: file.name.slice(0, 120) });
        const res = await fetch(`/api/media-library?${q}`, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
        const out = await res.json().catch(() => ({})) as { item?: { url: string }; error?: string };
        if (!res.ok || !out.item?.url) throw new Error(out.error || "Upload failed");
        setImages((cur) => [...cur, out.item!.url].slice(0, 3));
      } catch (e) { setErr(errText(e, "That image couldn't be uploaded.")); }
      finally { setUploading((n) => n - 1); }
    }
  };
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
  const showLocation = Boolean(cal) && !isStudioBusiness(data, cal) && !cal!.questions.some((q) => /address|eircode|location/i.test(q.label)) && cal!.locationType !== "video";
  const when = custom ? (customTime ? `${new Date(`${date}T12:00:00`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" })} at ${customTime}` : "") : slot ? longDate(slot) : "";
  const save = async () => {
    setBusy(true); setErr("");
    try {
      const start = custom ? new Date(`${date}T${customTime}:00`).toISOString() : slot;
      if (!form.name.trim()) throw new Error("Add the customer's name.");
      if (!start) throw new Error("Pick a time.");
      if (custom && !staffIds.length) throw new Error("Choose who the appointment is with.");
      await api(scope, { action: "book", calendarId, start, staffIds, force: custom, ...form, answers, location: showLocation ? location : "", durationMin: duration || undefined, price: Number(price) || undefined, images, notify });
      onSaved(`Booked: ${form.name} · ${when}.`);
    } catch (e) { setErr(errText(e, "Couldn't book this appointment.")); }
    finally { setBusy(false); }
  };
  return <Modal title="New appointment" wide onClose={onClose} footer={<><span className="sch-foot-summary">{when ? <>📅 {when}</> : "Pick a time"}</span><span style={{ flex: 1 }} /><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="button" className="primary-button" disabled={busy || uploading > 0 || !form.name.trim() || !calendarId || (!custom && !slot)} onClick={() => void save()}>{busy ? "Booking…" : "Book appointment"}</button></>}>
    {err && <div className="iv-error" role="alert">{err}</div>}
    <h3 className="sch-h3">1 · Who's it for?</h3>
    <div className="iv-grid">
      <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} autoFocus placeholder="Customer name" /></Field>
      <Field label="Phone"><input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={40} /></Field>
      <Field label="Email"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={160} /></Field>
    </div>
    <h3 className="sch-h3">2 · What and with who?</h3>
    {!calendars.length ? <div className="iv-small">Getting things ready…</div> : <>
      <div className="sch-type-pick">{calendars.map((c) => <button key={c.id} type="button" className={c.id === calendarId ? "on" : ""} style={{ ["--c" as string]: c.color }} onClick={() => setCalendarId(c.id)}><b>{c.name}</b><small>{c.id === calendarId && duration ? (duration >= 60 ? `${duration / 60 % 1 ? (duration / 60).toFixed(1) : duration / 60} h` : `${duration} min`) : `${c.durationMin} min`}{data.scope === null && c.clientId ? ` · ${data.clients.find((x) => x.id === c.clientId)?.name || ""}` : ""}</small></button>)}</div>
      <div className="sch-staff-pick compact">
        {!custom && <button type="button" className={staffIds.length ? "" : "on"} aria-pressed={!staffIds.length} onClick={() => { setStaffIds([]); setSlot(""); }}><span className="sch-avatar" style={{ width: 26, height: 26, fontSize: 12 }}>★</span><span><b>{cal?.assignMode === "collective" ? "Everyone on this type" : "Anyone free"}</b></span></button>}
        {pool.map((s) => { const on = staffIds.includes(s.id); return <button key={s.id} type="button" className={on ? "on" : ""} aria-pressed={on} onClick={() => { setStaffIds(on ? staffIds.filter((x) => x !== s.id) : [...staffIds, s.id]); setSlot(""); }}><Avatar person={s} size={26} /><span><b>{s.name}</b></span></button>; })}
      </div>
      {staffIds.length > 1 && !custom && <div className="iv-small">They'll all be booked together, so only times when everyone is free are shown.</div>}
    </>}
    <h3 className="sch-h3">3 · When?</h3>
    <div className="sch-daystrip">{days.map((d) => { const k = ymd(d); return <button key={k} type="button" className={date === k ? "on" : ""} onClick={() => { setDate(k); setSlot(""); }}><small>{d.toLocaleDateString("en-IE", { weekday: "short" })}</small><b>{d.getDate()}</b><small>{d.toLocaleDateString("en-IE", { month: "short" })}</small></button>; })}
      <label className="sch-otherdate" title="Pick another date"><CalendarDays size={15} /><input type="date" aria-label="Other date" value={date} onChange={(e) => { setDate(e.target.value); setSlot(""); }} /></label></div>
    {custom ? <div className="sch-inline"><input type="time" aria-label="Time" value={customTime} onChange={(e) => setCustomTime(e.target.value)} /><button type="button" className="iv-btn" onClick={() => setCustom(false)}>Show free times instead</button></div>
      : cal ? <><SlotPicker data={data} scope={scope} calendarId={calendarId} staffIds={staffIds} date={date} value={slot} onPick={(s) => setSlot(s.start)} /><button type="button" className="sch-linkbtn" onClick={useAnyTime}>Need a time that isn't listed? Pick any time</button></> : null}
    {cal?.questions.length ? <><h3 className="sch-h3">Details</h3><div className="iv-grid">{cal.questions.map((q) => <Field key={q.id} label={q.label}>{q.type === "select" ? <select value={answers[q.id] || ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}><option value="">Choose…</option>{(q.options || []).map((o) => <option key={o}>{o}</option>)}</select> : <input value={answers[q.id] || ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />}</Field>)}</div></> : null}
    {cal && <><h3 className="sch-h3">Length, price &amp; photos</h3><div className="iv-grid">
      <Field label="How long?"><select value={duration} onChange={(e) => setDuration(Number(e.target.value))}><option value={0}>Default ({cal.durationMin} min)</option>{[...new Set([15, 30, 45, 60, 90, 120, 180, 240, 300, 360, 480, ...(duration ? [duration] : [])])].sort((a, b) => a - b).filter((m) => m !== cal.durationMin).map((m) => <option key={m} value={m}>{m < 60 ? `${m} min` : `${m / 60 % 1 ? (m / 60).toFixed(1) : m / 60} hour${m === 60 ? "" : "s"}`}</option>)}</select></Field>
      <Field label={`Price (${cal.currency || "EUR"})`}><input type="number" inputMode="decimal" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={cal.price ? String(cal.price) : "Optional"} /></Field>
    </div>
    <div className="sch-appt-photos">{images.map((u) => <span key={u} className="sch-appt-photo"><img src={u} alt="" /><button type="button" aria-label="Remove photo" onClick={() => setImages(images.filter((x) => x !== u))}>×</button></span>)}
      {images.length < 3 && <label className="sch-appt-photo add">{uploading ? "Uploading…" : <><ImagePlus size={18} /><small>Add image</small></>}<input type="file" accept="image/*" multiple hidden onChange={(e) => { void uploadImages(e.target.files); e.target.value = ""; }} /></label>}</div></>}
    {showLocation && <Field label={cal!.locationType === "phone" ? "Location (optional)" : cal!.locationType === "office" ? "Location (leave blank for your office)" : "Location / site address"}><input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} placeholder={cal!.locationType === "office" ? cal!.locationDetail || "Your office" : "e.g. 12 Main St, Oranmore, H91 X2Y3"} /></Field>}
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
    try { if (booking.id.startsWith("sample-")) { onSaved("Sample appointment — nothing was saved (turn off Sample data to make real changes)."); return; } await api(scope, { action: "updateBooking", id: booking.id, ...body }); onSaved(msg); }
    catch (e) { setErr(errText(e, "Couldn't update this appointment.")); }
    finally { setBusy(false); }
  };
  const staffChanged = staffIds.join(",") !== booking.staffIds.join(",");
  const [photos, setPhotos] = useState<string[]>(() => booking.answers.filter((a) => /^Photo/i.test(a.label) && /^(https:\/\/|\/media\/|\/api\/marketing-public\/media)/.test(a.value)).map((a) => a.value));
  const [zoom, setZoom] = useState<number | null>(null);
  const [uploading, setUploading] = useState(0);
  const isSample = booking.id.startsWith("sample-");
  const addPhotos = async (files: FileList | null) => {
    const list = [...(files || [])].filter((f) => f.type.startsWith("image/")).slice(0, 12 - photos.length);
    const urls: string[] = [];
    for (const file of list) {
      setUploading((n) => n + 1);
      try {
        if (isSample) { urls.push(URL.createObjectURL(file)); continue; }
        const q = new URLSearchParams({ scope: scope || "agency", folder: "Appointment photos", name: file.name.slice(0, 120) });
        const res = await fetch(`/api/media-library?${q}`, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
        const out = await res.json().catch(() => ({})) as { item?: { url: string }; error?: string };
        if (!res.ok || !out.item?.url) throw new Error(out.error || "Upload failed");
        urls.push(out.item.url);
      } catch (e) { setErr(errText(e, "A photo couldn't be uploaded.")); }
      finally { setUploading((n) => n - 1); }
    }
    if (!urls.length) return;
    setPhotos((cur) => [...cur, ...urls]);
    if (!isSample) { try { await api(scope, { action: "updateBooking", id: booking.id, addPhotos: urls }); } catch (e) { setErr(errText(e, "Couldn't save the photos.")); } }
  };
  const removePhoto = async (u: string) => {
    setPhotos((cur) => cur.filter((x) => x !== u));
    if (!isSample && !u.startsWith("blob:")) { try { await api(scope, { action: "updateBooking", id: booking.id, removePhoto: u }); } catch (e) { setErr(errText(e, "Couldn't remove the photo.")); } }
  };
  return <Modal title={`${cal?.name || "Appointment"} · ${booking.name}`} wide onClose={onClose}>
    {err && <div className="iv-error" role="alert">{err}</div>}
    <div className="sch-detail">
      <div><small>When</small><b>{longDate(booking.start)}–{time(booking.end)}</b></div>
      <div><small>Status</small><b className={`sch-status-text ${booking.status}`}>{STATUS_LABEL[booking.status]}</b></div>
      <div><small>Customer</small><b>{booking.name}</b>{booking.phone && <a href={`tel:${booking.phone}`}>{booking.phone}</a>}{booking.email && <a href={`mailto:${booking.email}`}>{booking.email}</a>}</div>
      <div><small>Where</small><b>{cal ? (cal.locationType === "onsite" ? "On-site" : cal.locationType === "video" ? "Google Meet" : cal.locationType === "phone" ? "Phone call" : "Office") : "—"}</b>{booking.meetLink && <a href={booking.meetLink} target="_blank" rel="noopener noreferrer">Join Meet</a>}</div>
      <div><small>Source</small><b>{booking.source === "public" ? "Online booking" : `Added by ${booking.createdBy || "team"}`}</b>{booking.channel && <span className="iv-small">{booking.channel}</span>}</div>
      {booking.answers.filter((a) => a.value && !/^Photo/i.test(a.label)).map((a) => <div key={a.label}><small>{a.label}</small><b>{a.value}</b></div>)}
    </div>
    <h3 className="sch-h3">Photos</h3>
    <div className="sch-appt-photos">{photos.map((u, i) => <span key={u} className="sch-appt-photo"><button type="button" className="sch-photo-open" aria-label="View photo" onClick={() => setZoom(i)}><img src={u} alt="" /></button><button type="button" aria-label="Remove photo" onClick={() => void removePhoto(u)}>×</button></span>)}
      {photos.length < 12 && <label className="sch-appt-photo add">{uploading ? "Uploading…" : <><ImagePlus size={18} /><small>Add photos</small></>}<input type="file" accept="image/*" multiple hidden onChange={(e) => { void addPhotos(e.target.files); e.target.value = ""; }} /></label>}</div>
    {zoom !== null && photos[zoom] && <div className="sch-lightbox" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) setZoom(null); }}><button type="button" className="sch-lb-close" aria-label="Close" onClick={() => setZoom(null)}>×</button>{photos.length > 1 && <button type="button" className="sch-lb-nav prev" aria-label="Previous" onClick={() => setZoom((zoom - 1 + photos.length) % photos.length)}>‹</button>}<img src={photos[zoom]} alt="" />{photos.length > 1 && <button type="button" className="sch-lb-nav next" aria-label="Next" onClick={() => setZoom((zoom + 1) % photos.length)}>›</button>}</div>}
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
      {live && <button type="button" className="iv-btn danger" disabled={busy} onClick={async () => { if ((await appConfirm("Cancel this appointment? The customer will be emailed."))) void send({ status: "cancelled" }, "Appointment cancelled."); }}>Cancel appointment</button>}
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

type AiResult = { action: "calendar" | "appointment" | "hours" | "answer" | "clarify"; reply: string; options?: string[]; calendar?: Partial<Calendar>; appointment?: ApptDraft & { contactId?: string; address?: string }; hours?: Array<{ staffId: string; weekly: Partial<Record<DayKey, Window[]>>; daysOff: string[]; dailyLimit: number }> };
type AiTurn = { role: "user" | "ai"; text: string };
const AI_EXAMPLES = ["Free 60 min roof survey with Pat and Mick, customer picks who, 30 min travel buffer", "Book John Murphy 087 123 4567 for a survey Tuesday at 10am with Pat", "I work Mon–Thu 8 till 4, off on 24 and 26 December", "15 min discovery call for F2B on Google Meet, round robin"];

/** "Ask AI" — a short conversation: describe what you need, answer any questions, then create, edit or change the draft. */
function AiBar({ scope, data, onCalendar, onCreateCalendar, onAppointment, onHours }: { scope: string; data: Data; onCalendar: (c: Partial<Calendar>) => void; onCreateCalendar: (c: Partial<Calendar>) => Promise<boolean>; onAppointment: (a: ApptDraft) => void; onHours: (h: NonNullable<AiResult["hours"]>) => Promise<void> }) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [thread, setThread] = useState<AiTurn[]>([]);
  const [result, setResult] = useState<AiResult | null>(null);
  const [draft, setDraft] = useState<AiResult | null>(null); // last real draft, for "change something"
  const [err, setErr] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [placeholder] = useState(() => AI_EXAMPLES[Math.floor(Math.random() * AI_EXAMPLES.length)]);
  const [suggestions, setSuggestions] = useState<Array<{ label: string; prompt: string; why: string }> | null>(null);
  useEffect(() => { let live = true; api<{ suggestions: Array<{ label: string; prompt: string; why: string }> }>(scope, { action: "suggest" }).then((r) => { if (live) setSuggestions(r.suggestions || []); }).catch(() => { if (live) setSuggestions([]); }); return () => { live = false; }; }, [scope]);
  const reset = () => { setThread([]); setResult(null); setDraft(null); setPrompt(""); setFollowUp(""); setErr(""); };
  const ask = async (text: string, keepThread = true) => {
    const clean = text.trim();
    if (!clean) return;
    const history = keepThread ? thread : [];
    setBusy(true); setErr("");
    try {
      const out = await api<AiResult>(scope, { action: "ai", prompt: clean, history, draft: keepThread && draft ? { action: draft.action, calendar: draft.calendar, appointment: draft.appointment, hours: draft.hours } : undefined });
      setThread([...history, { role: "user", text: clean }, { role: "ai", text: out.reply }]);
      setResult(out);
      if (out.action === "calendar" || out.action === "appointment" || out.action === "hours") setDraft(out);
      setFollowUp("");
    } catch (e) { setErr(errText(e, "The AI couldn't help with that.")); }
    finally { setBusy(false); }
  };
  const staffName = (id: string) => data.staff.find((s) => s.id === id)?.name || "Someone";
  const finish = async (mode: "create" | "edit") => {
    if (!result) return;
    if (result.action === "calendar" && result.calendar) { if (mode === "edit") { onCalendar(result.calendar); reset(); } else { setBusy(true); const ok = await onCreateCalendar(result.calendar); setBusy(false); if (ok) reset(); } return; }
    if (result.action === "appointment" && result.appointment) { onAppointment(result.appointment); reset(); return; }
    if (result.action === "hours" && result.hours) { setBusy(true); await onHours(result.hours); setBusy(false); reset(); }
  };
  const started = thread.length > 0;
  return <div className="sch-ai">
    {!started && <form className="sch-ai-bar" onSubmit={(e) => { e.preventDefault(); void ask(prompt, false); }}>
      <span className="sch-ai-icon"><Sparkles size={18} /></span>
      <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={`Ask AI to set up or book anything… e.g. “${placeholder}”`} aria-label="Ask AI to set up or book anything" maxLength={1500} />
      <button type="submit" className="primary-button" disabled={busy || !prompt.trim()}>{busy ? "Thinking…" : "Ask AI"}</button>
    </form>}
    {!started && !prompt && !busy && (suggestions === null ? <div className="sch-ai-chips"><span className="iv-small">Checking recent conversations for people to book…</span></div>
      : suggestions.length ? <div className="sch-ai-suggest"><small><Sparkles size={12} /> Suggested from your conversations &amp; new leads</small><div className="sch-ai-chips">{suggestions.map((x) => <button key={x.label} type="button" className="suggested" title={x.why} onClick={() => { setPrompt(x.prompt); void ask(x.prompt, false); }}><b>{x.label}</b>{x.why && <span>{x.why}</span>}</button>)}</div></div>
      : <div className="sch-ai-chips">{AI_EXAMPLES.map((x) => <button key={x} type="button" onClick={() => { setPrompt(x); void ask(x, false); }}>{x}</button>)}</div>)}
    {started && <div className="sch-ai-chat">
      <div className="sch-ai-chat-head"><span className="sch-ai-icon"><Sparkles size={16} /></span><b>Scheduling assistant</b><button type="button" className="iv-btn" onClick={reset}>Start over</button></div>
      <div className="sch-ai-turns">{thread.map((t, i) => <div key={i} className={`sch-ai-turn ${t.role}`}>{t.text}</div>)}{busy && <div className="sch-ai-turn ai typing"><i /><i /><i /></div>}</div>
      {result && !busy && result.action === "clarify" && <>
        {!!result.options?.length && <div className="sch-ai-options">{result.options.map((o) => <button key={o} type="button" onClick={() => void ask(o)}>{o}</button>)}</div>}
      </>}
      {result && !busy && (result.action === "calendar" || result.action === "appointment" || result.action === "hours") && <div className="sch-ai-result">
        {result.action === "calendar" && result.calendar && <ul><li><b>{result.calendar.name}</b> · {result.calendar.durationMin} min · {result.calendar.kind === "consultation" ? "Consultation" : "Service"} · {result.calendar.locationType === "video" ? "Google Meet" : result.calendar.locationType === "phone" ? "Phone" : result.calendar.locationType === "office" ? "Office" : "On-site"}</li><li>With: {(result.calendar.staffIds || []).map(staffName).join(", ") || "nobody yet"} · {MODE_LABEL[result.calendar.assignMode || "customer_pick"]}</li>{(result.calendar.bufferBefore || result.calendar.bufferAfter) ? <li>Buffers: {result.calendar.bufferBefore || 0} min before, {result.calendar.bufferAfter || 0} min after</li> : null}{result.calendar.questions?.length ? <li>Asks: {result.calendar.questions.map((q) => q.label).join(" · ")}</li> : null}</ul>}
        {result.action === "appointment" && result.appointment && <ul><li><b>{result.appointment.name || "Customer"}</b>{result.appointment.contactId ? " (existing contact)" : " (new contact)"}{result.appointment.phone ? ` · ${result.appointment.phone}` : ""}{result.appointment.email ? ` · ${result.appointment.email}` : ""}</li>{result.appointment.address ? <li>Site: {result.appointment.address}</li> : null}<li>{new Date(`${result.appointment.date}T12:00:00`).toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long" })}{result.appointment.time ? ` at ${result.appointment.time}` : ""}{result.appointment.staffIds?.length ? ` · with ${result.appointment.staffIds.map(staffName).join(", ")}` : ""}</li></ul>}
        {result.action === "hours" && result.hours && <ul>{result.hours.map((h) => <li key={h.staffId}><b>{staffName(h.staffId)}</b>: {DAY_LIST.filter(([k]) => h.weekly[k]?.length).map(([k, l]) => `${l.slice(0, 3)} ${(h.weekly[k] || []).map((w) => w.join("–")).join(", ")}`).join(" · ") || "no change to hours"}{h.daysOff.length ? ` · off ${h.daysOff.join(", ")}` : ""}</li>)}</ul>}
        <div className="iv-actions" style={{ justifyContent: "flex-start" }}>
          <button type="button" className="primary-button" onClick={() => void finish("create")}>{result.action === "calendar" ? "Create now" : result.action === "appointment" ? "Choose time & book" : "Apply hours"}</button>
          {result.action === "calendar" && <button type="button" className="secondary-button" onClick={() => void finish("edit")}>Edit all details</button>}
        </div>
      </div>}
      {result?.action !== "answer" || started ? <form className="sch-ai-reply" onSubmit={(e) => { e.preventDefault(); void ask(followUp); }}>
        <input value={followUp} onChange={(e) => setFollowUp(e.target.value)} placeholder={result?.action === "clarify" ? "Type your answer…" : "Change something… e.g. “make it 30 min and add Mick”"} aria-label="Reply to the assistant" maxLength={800} disabled={busy} autoFocus />
        <button type="submit" className="primary-button" disabled={busy || !followUp.trim()}>Send</button>
      </form> : null}
    </div>}
    {err && <div className="iv-error" role="alert">{err}</div>}
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

/** Reviews + photos customers see on the booking page. Used in the Team staff form and in Scheduling. Saves automatically. */
export function StaffShowcaseEditor({ staffId, scope = "", staffName = "" }: { staffId: string; scope?: string; staffName?: string }) {
  const [p, setP] = useState<StaffProfile | null>(null);
  const [status, setStatus] = useState("");
  const [paste, setPaste] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [draft, setDraft] = useState<StaffReview>({ id: "", author: "", rating: 5, text: "", source: "Google", date: "" });
  const dirty = useState(0);
  useEffect(() => {
    if (!staffId) return;
    let live = true;
    api<{ profile: StaffProfile | null }>(scope, { action: "getProfile", staffId }).then((r) => { if (live) setP(r.profile || { showReviews: false, showPhotos: false, title: "", bio: "", reviews: [], photos: [] }); }).catch((e) => { if (live) setStatus(errText(e, "Couldn't load the profile.")); });
    return () => { live = false; };
  }, [staffId, scope]);
  useEffect(() => {
    if (!p || !dirty[0]) return;
    setStatus("Saving…");
    const t = window.setTimeout(() => { api(scope, { action: "saveProfile", staffId, profile: p }).then(() => setStatus("Saved ✓")).catch((e) => setStatus(errText(e, "Couldn't save."))); }, 700);
    return () => window.clearTimeout(t);
  }, [p]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!staffId) return <div className="sch-showcase"><div className="sch-showcase-head"><b>Booking profile</b></div><p className="iv-small">Save this person first, then you can add reviews and photos customers see when booking.</p></div>;
  if (!p) return <div className="sch-showcase"><p className="iv-small">{status || "Loading booking profile…"}</p></div>;
  const update = (patch: Partial<StaffProfile>) => { dirty[1](dirty[0] + 1); setP({ ...p, ...patch }); };
  const addReview = () => { if (!draft.author.trim() && !draft.text.trim()) return; update({ reviews: [{ ...draft, id: `rv${Date.now().toString(36)}` }, ...p.reviews] }); setDraft({ id: "", author: "", rating: 5, text: "", source: draft.source, date: "" }); };
  const importPaste = () => {
    // One review per line: Name | stars | review text | source (optional)
    const rows = paste.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((line, i) => {
      const parts = line.split(/\s*[|\t]\s*/);
      const stars = Number((parts[1] || "").replace(/[^\d.]/g, "")) || (line.match(/★/g) || []).length || 5;
      return { id: `rv${Date.now().toString(36)}${i}`, author: parts[0] || "Customer", rating: Math.max(1, Math.min(5, Math.round(stars))), text: parts.slice(2, parts.length > 3 ? -1 : undefined).join(" ") || (parts.length === 1 ? "" : ""), source: parts.length > 3 ? parts[parts.length - 1] : "Google", date: "" };
    });
    if (rows.length) update({ reviews: [...rows, ...p.reviews].slice(0, 60), showReviews: true });
    setPaste(""); setShowPaste(false);
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files].filter((f) => f.type.startsWith("image/")).slice(0, 16 - p.photos.length);
    setUploading(list.length);
    const added: Array<{ url: string; caption: string }> = [];
    for (const file of list) {
      try {
        const q = new URLSearchParams({ scope: scope || "agency", folder: "Staff photos", name: file.name.slice(0, 120) });
        const res = await fetch(`/api/media-library?${q}`, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
        const out = await res.json().catch(() => ({})) as { item?: { url: string }; error?: string };
        if (!res.ok || !out.item?.url) throw new Error(out.error || "Upload failed");
        added.push({ url: out.item.url, caption: "" });
      } catch (e) { setStatus(errText(e, "A photo couldn't be uploaded.")); }
      setUploading((n) => n - 1);
    }
    if (added.length) update({ photos: [...p.photos, ...added], showPhotos: true });
  };
  const avg = p.reviews.length ? (p.reviews.reduce((n, r) => n + r.rating, 0) / p.reviews.length).toFixed(1) : "";
  return <div className="sch-showcase">
    <div className="sch-showcase-head"><b>Booking profile</b><small>What customers see when picking who to book</small><span className="sch-showcase-status">{status}</span></div>
    <div className="iv-grid"><Field label="Job title on booking page"><input value={p.title} onChange={(e) => update({ title: e.target.value })} maxLength={60} placeholder="e.g. Senior roofer" /></Field><Field label="Short intro (optional)"><input value={p.bio} onChange={(e) => update({ bio: e.target.value })} maxLength={400} placeholder="15 years fixing roofs across Galway" /></Field></div>
    <div className="sch-toggles">
      <label className="sch-toggle"><input type="checkbox" checked={p.showReviews} onChange={(e) => update({ showReviews: e.target.checked })} /><span /> <b>Show reviews</b>{avg && <small>★ {avg} · {p.reviews.length}</small>}</label>
      <label className="sch-toggle"><input type="checkbox" checked={p.showPhotos} onChange={(e) => update({ showPhotos: e.target.checked })} /><span /> <b>Show photos</b>{p.photos.length > 0 && <small>{p.photos.length}</small>}</label>
    </div>
    <ReviewLinkBar staffId={staffId} staffName={staffName || "this person"} scope={scope} />
    {p.showReviews && <div className="sch-showcase-block">
      <div className="sch-review-add">
        <input value={draft.author} onChange={(e) => setDraft({ ...draft, author: e.target.value })} placeholder="Customer name" maxLength={80} aria-label="Reviewer name" />
        <select value={draft.rating} onChange={(e) => setDraft({ ...draft, rating: Number(e.target.value) })} aria-label="Stars">{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)}</option>)}</select>
        <select value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} aria-label="Where the review is from">{["Google", "Facebook", "Trustpilot", "Checkatrade", "Website", "Other"].map((x) => <option key={x}>{x}</option>)}</select>
        <textarea value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} placeholder="What they said" rows={2} maxLength={800} aria-label="Review text" />
        <div className="sch-inline"><button type="button" className="iv-btn" onClick={addReview} disabled={!draft.author.trim() && !draft.text.trim()}><Plus size={13} /> Add review</button><button type="button" className="sch-linkbtn" onClick={() => setShowPaste(!showPaste)}>Paste lots at once</button></div>
      </div>
      {showPaste && <div className="sch-paste"><textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={5} placeholder={"One per line:  Name | stars | review | source\nMary Burke | 5 | Pat fixed our leak the same day | Google\nTom Walsh | 5 | Brilliant job on the chimney"} /><button type="button" className="iv-btn" onClick={importPaste} disabled={!paste.trim()}>Import reviews</button></div>}
      {p.reviews.length > 0 && <ul className="sch-reviews">{p.reviews.map((r) => <li key={r.id}><div><b>{r.author || "Customer"}</b> <span className="sch-stars">{"★".repeat(r.rating)}<i>{"★".repeat(5 - r.rating)}</i></span>{r.source && <small>{r.source}</small>}</div>{r.text && <p>{r.text}</p>}<button type="button" className="iv-x" aria-label="Remove review" onClick={() => update({ reviews: p.reviews.filter((x) => x.id !== r.id) })}>✕</button></li>)}</ul>}
    </div>}
    {p.showPhotos && <div className="sch-showcase-block">
      <div className="sch-photos">{p.photos.map((ph, i) => <figure key={ph.url + i}><img src={ph.url} alt={ph.caption || ""} loading="lazy" /><input value={ph.caption} onChange={(e) => update({ photos: p.photos.map((x, j) => j === i ? { ...x, caption: e.target.value } : x) })} placeholder="Caption" maxLength={120} aria-label="Photo caption" /><button type="button" className="iv-x" aria-label="Remove photo" onClick={() => update({ photos: p.photos.filter((_, j) => j !== i) })}>✕</button></figure>)}
        {p.photos.length < 16 && <label className="sch-photo-add"><input type="file" accept="image/*" multiple onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />{uploading ? `Uploading ${uploading}…` : <><Plus size={18} /><span>Add photos</span></>}</label>}</div>
      <small className="iv-small">Photos are saved to the Media Library (Staff photos folder).</small>
    </div>}
  </div>;
}

/** "Request a review": a personal link per staff member, shared by copy / email / WhatsApp / text. */
export function ReviewLinkBar({ staffId, staffName, scope = "" }: { staffId: string; staffName: string; scope?: string }) {
  const [url, setUrl] = useState("");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");
  const first = staffName.split("|")[0].trim().split(" ")[0] || "us";
  const load = async () => {
    setOpen(true); setErr("");
    if (url) return;
    try { setUrl((await api<{ url: string }>(scope, { action: "reviewLink", staffId })).url); } catch (e) { setErr(errText(e, "Couldn't create the review link.")); }
  };
  const message = `Hi! Thanks for choosing us. Would you mind leaving a quick review for ${first}? It takes 30 seconds: ${url}`;
  const copy = async () => { try { await navigator.clipboard.writeText(url); } catch { const t = document.createElement("textarea"); t.value = url; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); } setCopied(true); window.setTimeout(() => setCopied(false), 1800); };
  if (!open) return <button type="button" className="iv-btn" onClick={() => void load()}>⭐ Request a review</button>;
  return <div className="sch-revlink">
    <span className="sch-revlink-label">Review link for {first}</span>
    {err ? <span className="iv-error">{err}</span> : !url ? <span className="iv-small">Creating link…</span> : <>
      <code title={url}>{url.replace(/^https?:\/\//, "")}</code>
      <div className="sch-revlink-actions">
        <button type="button" className="iv-btn" onClick={() => void copy()}>{copied ? "✓ Copied" : "Copy link"}</button>
        <a className="iv-btn" href={`mailto:?subject=${encodeURIComponent(`Could you review ${first}?`)}&body=${encodeURIComponent(message)}`}>Email</a>
        <a className="iv-btn" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
        <a className="iv-btn" href={`sms:?&body=${encodeURIComponent(message)}`}>Text</a>
        <a className="iv-btn" href={url} target="_blank" rel="noopener noreferrer">Preview</a>
      </div>
      <small className="iv-small">Reviews left here appear on {first}'s booking profile straight away{""} and {first} gets an email.</small>
    </>}
  </div>;
}

/** Everything Scheduling-related for one person, shown inside the Team "edit staff" window. */
export function StaffSchedulingPanel({ staffId, staffName = "", scope = "" }: { staffId: string; staffName?: string; scope?: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [hours, setHours] = useState<HoursValue | null>(null);
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<"hours" | "sync" | "">("");
  const load = useCallback(async () => { try { setData(await api<Data>(scope, undefined, `&from=${new Date().toISOString()}&to=${addDays(new Date(), 1).toISOString()}`)); } catch (e) { setStatus(errText(e, "Scheduling couldn't load.")); } }, [scope]);
  useEffect(() => { if (staffId) void load(); }, [staffId, load]);
  if (!staffId) return <section className="sch-panel"><div className="sch-panel-head"><b>📅 Scheduling</b></div><p className="iv-small">Save this person first, then set their working hours, connect their calendar and add reviews & photos.</p></section>;
  const person = data?.staff.find((x) => x.id === staffId);
  const act = async (body: Record<string, unknown>, ok: string) => { setStatus("Saving…"); try { await api(scope, body); setStatus(ok); await load(); } catch (e) { setStatus(errText(e, "Couldn't save.")); } };
  return <section className="sch-panel">
    <div className="sch-panel-head"><b>📅 Scheduling</b><small>Hours, calendar sync, reviews and photos for bookings</small><span className="sch-showcase-status">{status}</span></div>
    {!data ? <p className="iv-small">{status || "Loading…"}</p> : !person ? <p className="iv-small">This person isn't bookable in this account (AI teammates and people without an email can't take appointments).</p> : <>
      <div className="sch-panel-row">
        <button type="button" className={`sch-panel-toggle${open === "hours" ? " on" : ""}`} onClick={() => setOpen(open === "hours" ? "" : "hours")}><Clock size={14} /> <b>Working hours &amp; days off</b><small>{DAY_LIST.filter(([k]) => person.weekly?.[k]?.length).length} days a week</small></button>
        <button type="button" className={`sch-panel-toggle${open === "sync" ? " on" : ""}`} onClick={() => setOpen(open === "sync" ? "" : "sync")}><CalendarDays size={14} /> <b>Calendar sync</b><small>{person.google ? "Google connected" : "Not connected"}</small></button>
      </div>
      {open === "hours" && <div className="sch-panel-body"><HoursForm staff={person} onChange={setHours} /><div className="iv-actions" style={{ justifyContent: "flex-start" }}><button type="button" className="primary-button" disabled={!hours} onClick={() => hours && void act({ action: "saveAvailability", staffId, ...hours }, "Hours saved ✓")}>Save hours</button></div></div>}
      {open === "sync" && <div className="sch-panel-body sch-sync">
        <div><img src="https://www.gstatic.com/images/branding/product/1x/calendar_2020q4_48dp.png" alt="" width={18} height={18} /><span>{person.google ? <>Google: <b>{person.google}</b></> : "Google Calendar not connected"}</span>
          {person.canEdit && (person.google ? <button type="button" className="iv-btn danger" onClick={() => void act({ action: "disconnectGoogle", staffId }, "Google disconnected.")}>Disconnect</button> : data.googleAvailable ? <><a className="iv-btn" href={`/api/scheduling?${scopeQs(scope)}&connect=${encodeURIComponent(staffId)}`}>Connect</a><button type="button" className="iv-btn" onClick={() => { void navigator.clipboard?.writeText(`${window.location.origin}/api/scheduling?${scopeQs(scope)}&connect=${encodeURIComponent(staffId)}`); setStatus("Connect link copied ✓"); }}>Copy link</button></> : null)}</div>
        <div><span>📅</span><span>Apple / Outlook calendar feed</span>{person.canEdit && (person.feedUrl ? <button type="button" className="iv-btn" onClick={() => { void navigator.clipboard?.writeText(person.feedUrl); setStatus("Feed link copied ✓"); }}>Copy feed link</button> : <button type="button" className="iv-btn" onClick={() => void act({ action: "createFeed", staffId }, "Feed link ready ✓")}>Create feed link</button>)}</div>
      </div>}
      <StaffShowcaseEditor staffId={staffId} scope={scope} staffName={staffName || person.name} />
    </>}
  </section>;
}

/** Dashboard panel for appointment-based businesses: staff selector, Day (appointments + availability) and Week calendar. */
export function AppointmentsDashboard({ scopeClientId, onOpen, sample = false, clientName = "" }: { scopeClientId: string; onOpen: () => void; sample?: boolean; clientName?: string }) {
  const [realData, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [view, setView] = useState<"day" | "week" | "month">(() => { try { const v = localStorage.getItem("f2b-dash-appt-view"); return v === "week" || v === "month" ? v : "day"; } catch { return "day"; } });
  const [staffId, setStaffId] = useState("");
  const [day, setDay] = useState(() => new Date());
  const week = mondayOf(day);
  const monthFirst = new Date(day.getFullYear(), day.getMonth(), 1); const gridStart = mondayOf(monthFirst); // month view: 6 weeks from the Monday on/before the 1st
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let live = true;
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const from = new Date(Math.min(addDays(week, -1).getTime(), monthStart.getTime(), addDays(gridStart, -1).getTime())), to = new Date(Math.max(addDays(week, 8).getTime(), addDays(new Date(), 8).getTime(), addDays(gridStart, 43).getTime()));
    api<Data>(scopeClientId, undefined, `&from=${from.toISOString()}&to=${to.toISOString()}`).then((d) => { if (live) { setData(d); setErr(""); } }).catch((e) => { if (live) setErr(errText(e, "Appointments couldn't load.")); });
    return () => { live = false; };
  }, [scopeClientId, ymd(week), ymd(gridStart), refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const [detail, setDetail] = useState<Booking | null>(null);
  const site = useSiteSample(scopeClientId, sample);
  const data = useMemo(() => sample ? sampleSchedule(realData, mondayOf(new Date()), clientName, site) : realData, [sample, realData, clientName, site]); // eslint-disable-line react-hooks/exhaustive-deps
  if (err && !realData && !sample) return null; // no Scheduling access: hide quietly
  const setMode = (m: "day" | "week" | "month") => { setView(m); try { localStorage.setItem("f2b-dash-appt-view", m); } catch { /* optional */ } };
  const bookings = (data?.bookings || []).filter((b) => b.status !== "cancelled" && (!staffId || b.staffIds.includes(staffId)));
  const staff = (data?.staff || []).filter((p) => !staffId || p.id === staffId);
  const calById = new Map((data?.calendars || []).map((c) => [c.id, c]));
  const nameOf = (id: string) => data?.staff.find((p) => p.id === id)?.name.split("|")[0].trim().split(" ")[0] || "";
  const personOf = (id: string) => { const p = data?.staff.find((x) => x.id === id); return p ? { name: p.name.split("|")[0].trim(), avatar: (p as { avatar?: string }).avatar } : { name: "?" }; };
  const key = ymd(day); const isToday = key === ymd(new Date());
  const dayList = bookings.filter((b) => ymd(new Date(b.start)) === key).sort((a, b) => a.start.localeCompare(b.start));
  const mins = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + (m || 0); };
  const dk = (["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as DayKey[])[day.getDay()];
  const all = (data?.bookings || []).filter((b) => !staffId || b.staffIds.includes(staffId));
  const nowMs = Date.now(), monthStartMs = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const todayKey = ymd(new Date());
  const ov = {
    today: all.filter((b) => b.status !== "cancelled" && ymd(new Date(b.start)) === todayKey).length,
    week: all.filter((b) => b.status === "booked" && Date.parse(b.start) >= nowMs && Date.parse(b.start) < nowMs + 7 * 86_400_000).length,
    month: all.filter((b) => b.status !== "cancelled" && Date.parse(b.start) >= monthStartMs && Date.parse(b.start) < new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).getTime()).length,
    done: all.filter((b) => b.status === "completed").length, noShow: all.filter((b) => b.status === "no_show").length,
    cancelled: all.filter((b) => b.status === "cancelled" && Date.parse(b.start) >= monthStartMs && Date.parse(b.start) < new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).getTime()).length,
    next: all.filter((b) => b.status === "booked" && Date.parse(b.start) >= nowMs).sort((a, b) => a.start.localeCompare(b.start))[0],
  };
  const step = (dir: 1 | -1) => setDay(view === "month" ? new Date(day.getFullYear(), day.getMonth() + dir, 1) : addDays(day, (view === "day" ? 1 : 7) * dir));
  const showRate = ov.done + ov.noShow ? Math.round((ov.done / (ov.done + ov.noShow)) * 100) : null;
  return <section className="panel sch-dash-panel" aria-label="Appointments">
    <div className="sch-dash-panel-head">
      <div><p className="eyebrow">📅 APPOINTMENTS{sample && <span className="sch-sample-tag">Sample data</span>}</p><h2>{view === "day" ? (isToday ? "Today" : day.toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "short" })) : view === "month" ? monthFirst.toLocaleDateString("en-IE", { month: "long", year: "numeric" }) : `Week of ${week.toLocaleDateString("en-IE", { day: "numeric", month: "short" })}`}</h2></div>
      <div className="sch-dash-panel-tools">
        <label className="sch-select"><Users size={14} /><select aria-label="Staff member" value={staffId} onChange={(e) => setStaffId(e.target.value)}><option value="">Everyone</option>{(data?.staff || []).map((p) => <option key={p.id} value={p.id}>{p.name.split("|")[0].trim()}</option>)}</select></label>
        <div className="sch-seg" role="tablist" aria-label="View"><button type="button" role="tab" aria-selected={view === "day"} className={view === "day" ? "on" : ""} onClick={() => setMode("day")}>Day</button><button type="button" role="tab" aria-selected={view === "week"} className={view === "week" ? "on" : ""} onClick={() => setMode("week")}>Week</button><button type="button" role="tab" aria-selected={view === "month"} className={view === "month" ? "on" : ""} onClick={() => setMode("month")}>Month</button></div>
        <button type="button" className="iv-btn" aria-label="Previous" onClick={() => step(-1)}><ChevronLeft size={15} /></button>
        <button type="button" className="iv-btn" disabled={isToday && view !== "month"} onClick={() => setDay(new Date())}>Today</button>
        <button type="button" className="iv-btn" aria-label="Next" onClick={() => step(1)}><ChevronRight size={15} /></button>
        <button type="button" className="text-button" onClick={onOpen}>Open Scheduling ↗</button>
      </div>
    </div>
    {data && <div className="sch-dash-overview">
      <div><small>Today</small><b>{ov.today}</b></div>
      <div><small>Next 7 days</small><b>{ov.week}</b></div>
      <div><small>This month</small><b>{ov.month}</b>{ov.cancelled ? <em>{ov.cancelled} cancelled</em> : null}</div>
      <div><small>Show-up rate</small><b>{showRate === null ? "—" : `${showRate}%`}</b></div>
      <div className={ov.noShow ? "bad" : ""}><small>No-shows</small><b>{ov.noShow}</b></div>
      <div className="sch-dash-next"><small>Next appointment</small>{ov.next ? <><b>{ov.next.name}</b><em>{new Date(ov.next.start).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" })} · {time(ov.next.start)}{ov.next.staffIds.length ? ` · ${ov.next.staffIds.map(nameOf).filter(Boolean).join(", ")}` : ""}</em></> : <b className="muted">None booked</b>}</div>
    </div>}
    {!data ? <p className="dh-muted">Loading appointments…</p> : view === "day" ? <div className="sch-dash-day">
      <div className="sch-dash-day-list">
        <div className="sch-dash-stats"><span><b>{dayList.length}</b> booked</span><span><b>{dayList.filter((b) => Date.parse(b.start) > Date.now()).length}</b> to come</span><span><b>{dayList.filter((b) => b.status === "completed" || Date.parse(b.end) < Date.now()).length}</b> done</span></div>
        {dayList.length ? <ul className="sch-dash-list">{dayList.map((b) => { const cal = calById.get(b.calendarId); return <li key={b.id} onClick={() => setDetail(b)}><time>{time(b.start)}</time>{b.staffIds.length ? <span className="sch-dash-avs">{b.staffIds.slice(0, 2).map((id) => <Avatar key={id} person={personOf(id)} size={30} />)}</span> : <span className="sch-dash-av" style={{ ["--c" as string]: cal?.color || "#2563eb" }}>{(b.name || "?").slice(0, 1).toUpperCase()}</span>}<span className="sch-dash-who"><b>{b.name}</b><small>{cal?.name || ""}{b.staffIds.length ? ` · ${b.staffIds.map(nameOf).filter(Boolean).join(", ")}` : ""}</small></span>{bookingPhoto(b) ? <img className="sch-dash-thumb" src={bookingPhoto(b)} alt="" loading="lazy" /> : null}</li>; })}</ul> : <p className="dh-muted">Nothing booked{isToday ? " today" : " this day"}.</p>}
      </div>
      {(() => { // Staff timeline: shared hour axis, each booking drawn on its own row
        const rows = staff.map((p) => { const off = p.blocked?.includes(key); const windows = off ? [] : p.weekly?.[dk] || []; const items = dayList.filter((b) => b.staffIds.includes(p.id)); return { p, off, windows, items }; });
        const starts = rows.flatMap((r) => r.windows.map((w) => mins(w[0]))).concat(dayList.map((b) => { const d = new Date(b.start); return d.getHours() * 60 + d.getMinutes(); }));
        const ends = rows.flatMap((r) => r.windows.map((w) => mins(w[1]))).concat(dayList.map((b) => { const d = new Date(b.end); return d.getHours() * 60 + d.getMinutes(); }));
        const from = Math.floor((starts.length ? Math.min(...starts) : 540) / 60) * 60, to = Math.ceil((ends.length ? Math.max(...ends) : 1050) / 60) * 60;
        const span = Math.max(60, to - from); const pct = (m: number) => `${Math.max(0, Math.min(100, ((m - from) / span) * 100))}%`;
        const hours = Array.from({ length: span / 60 + 1 }, (_, i) => from + i * 60);
        const nowM = new Date().getHours() * 60 + new Date().getMinutes();
        return <div className="sch-tl">
          <div className="sch-tl-axis"><span /><div className="sch-tl-hours">{hours.map((h) => <em key={h} style={{ left: pct(h) }}>{String(Math.floor(h / 60)).padStart(2, "0")}:00</em>)}</div><span /></div>
          {rows.map(({ p, off, windows, items }) => {
            const total = windows.reduce((n, w) => n + mins(w[1]) - mins(w[0]), 0);
            const used = items.reduce((n, b) => n + (Date.parse(b.end) - Date.parse(b.start)) / 60000, 0); const free = Math.max(0, total - used);
            const next = items.find((b) => Date.parse(b.start) > Date.now());
            const summary = off ? "Day off" : !windows.length ? "Not working" : !items.length ? "Free all day" : free ? `${Math.floor(free / 60)}h${free % 60 ? ` ${Math.round(free % 60)}m` : ""} free` : "Fully booked";
            return <div key={p.id} className={`sch-tl-row${!windows.length ? " off" : ""}`}>
              <div className="sch-tl-who"><Avatar person={p} size={34} /><span><b>{p.name.split("|")[0].trim()}</b><small>{windows.length ? `${windows[0][0]}–${windows[windows.length - 1][1]}` : off ? "Day off" : "Not working"}{items.length ? ` · ${items.length}` : ""}</small>{next && isToday ? <small className="sch-tl-next">Next {time(next.start)} · {next.name.split(" ")[0]}</small> : null}</span></div>
              <div className="sch-tl-track">
                {hours.map((h) => <i key={h} className="sch-tl-grid" style={{ left: pct(h) }} />)}
                {windows.map((w, i) => <i key={`w${i}`} className="sch-tl-free" style={{ left: pct(mins(w[0])), width: `calc(${pct(mins(w[1]))} - ${pct(mins(w[0]))})` }} />)}
                {items.map((b) => { const s0 = new Date(b.start), e0 = new Date(b.end); const a0 = s0.getHours() * 60 + s0.getMinutes(), z0 = e0.getHours() * 60 + e0.getMinutes(); const cal = calById.get(b.calendarId); const wide = (z0 - a0) / span > 0.1;
                  return <button key={b.id} type="button" className={`sch-tl-item ${b.status}${wide ? "" : " narrow"}`} style={{ left: pct(a0), width: `calc(${pct(z0)} - ${pct(a0)})`, ["--c" as string]: cal?.color || "var(--brand-primary,#2563eb)" }} title={`${time(b.start)}–${time(b.end)} · ${b.name} · ${cal?.name || ""}`} onClick={() => setDetail(b)}>{wide ? <><b>{time(b.start)}</b><span>{b.name.split(" ")[0]}</span></> : <b>{time(b.start)}</b>}</button>; })}
                {isToday && nowM > from && nowM < to && <i className="sch-tl-now" style={{ left: pct(nowM) }} />}
              </div>
              <span className={`sch-avail-pill ${!windows.length ? "off" : !items.length ? "free" : free ? "some" : "full"}`}>{summary}</span>
            </div>; })}
        </div>; })()}
    </div> : view === "month" ? <div className="sch-dash-month">
      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((w) => <small key={w} className="sch-month-dow">{w}</small>)}
      {Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)).map((d) => { const k = ymd(d); const list = bookings.filter((b) => ymd(new Date(b.start)) === k).sort((a, b) => a.start.localeCompare(b.start)); const other = d.getMonth() !== monthFirst.getMonth();
        return <div key={k} className={`sch-month-cell${other ? " other" : ""}${k === todayKey ? " today" : ""}`}>
          <button type="button" className="sch-month-date" onClick={() => { setDay(d); setMode("day"); }} aria-label={`Open ${d.toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long" })}`}><b>{d.getDate()}</b>{list.length > 0 && <em>{list.length}</em>}</button>
          {list.slice(0, 3).map((b) => { const cal = calById.get(b.calendarId); return <button type="button" key={b.id} className={`sch-month-chip ${b.status}`} style={{ ["--c" as string]: cal?.color || "#2563eb" }} onClick={() => setDetail(b)} title={`${time(b.start)} ${b.name} · ${cal?.name || ""}${b.staffIds.length ? ` · ${b.staffIds.map(nameOf).filter(Boolean).join(", ")}` : ""}`}>{b.staffIds[0] ? <Avatar person={personOf(b.staffIds[0])} size={16} /> : null}<b>{time(b.start)}</b><span>{b.name.split(" ")[0]}</span></button>; })}
          {list.length > 3 && <button type="button" className="sch-month-more" onClick={() => { setDay(d); setMode("day"); }}>+{list.length - 3} more</button>}
        </div>; })}
    </div> : <div className="sch-dash-week">{Array.from({ length: 7 }, (_, i) => addDays(week, i)).map((d) => { const k = ymd(d); const list = bookings.filter((b) => ymd(new Date(b.start)) === k).sort((a, b) => a.start.localeCompare(b.start)); return <div key={k} className={`sch-dash-wday${k === ymd(new Date()) ? " today" : ""}`}>
      <button type="button" className="sch-dash-wday-head" onClick={() => { setDay(d); setMode("day"); }}><small>{d.toLocaleDateString("en-IE", { weekday: "short" })}</small><b>{d.getDate()}</b>{list.length > 0 && <em>{list.length}</em>}</button>
      <div className="sch-dash-wday-body">{list.length ? list.slice(0, 6).map((b) => { const cal = calById.get(b.calendarId); return <button type="button" key={b.id} className="sch-dash-chip" style={{ ["--c" as string]: cal?.color || "#2563eb" }} onClick={() => setDetail(b)} title={`${time(b.start)} ${b.name} · ${cal?.name || ""}`}><span className="sch-chip-top"><b>{time(b.start)}</b><span className="sch-chip-avs">{b.staffIds.slice(0, 2).map((id) => <Avatar key={id} person={personOf(id)} size={20} />)}</span></span><span>{b.name}</span>{(() => { const pic = bookingPhoto(b); return pic ? <img className="sch-chip-img" src={pic} alt="" loading="lazy" onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = "none"; }} /> : null; })()}</button>; }) : <span className="sch-dash-free">Free</span>}{list.length > 6 && <small className="iv-small">+{list.length - 6} more</small>}</div>
    </div>; })}</div>}
    {data && realData?.isAdmin && <StaffHoursPanel data={data} scopeClientId={scopeClientId} sample={sample} />}
    {detail && data && <AppointmentDetail key={detail.id} data={data} scope={scopeClientId} booking={detail} onClose={() => setDetail(null)} onSaved={(msg) => { setDetail(null); void msg; setRefresh((n) => n + 1); }} />}
  </section>;
}

// Demo schedule for the Dashboard "Sample data" toggle (never saved). Uses the account's real team when there is one.
type SiteSample = { services: string[]; locations: string[]; team: string[]; photos?: Record<string, string>; work?: Record<string, string[]>; gallery?: string[] };
const EMPTY_SITE: SiteSample = { services: [], locations: [], team: [], photos: {}, work: {}, gallery: [] };
// The client's real services, areas and team (from their profile + website) to make demo data look like their business.
function useSiteSample(scope: string, enabled: boolean): SiteSample {
  const [site, setSite] = useState<SiteSample>(EMPTY_SITE);
  useEffect(() => {
    if (!enabled || !scope) { setSite(EMPTY_SITE); return; }
    let live = true;
    fetch(`/api/scheduling?clientId=${encodeURIComponent(scope)}&view=site`, { credentials: "same-origin" }).then((r) => r.ok ? r.json() : EMPTY_SITE).then((v: SiteSample) => { if (live) setSite({ services: v.services || [], locations: v.locations || [], team: v.team || [], photos: v.photos || {}, work: v.work || {}, gallery: v.gallery || [] }); }).catch(() => undefined);
    return () => { live = false; };
  }, [scope, enabled]);
  return site;
}
function sampleSchedule(real: Data | null, week: Date, clientName: string, site: SiteSample = EMPTY_SITE): Data {
  const fallbackStaff: Staff[] = [["s1", "Aoife Murphy", "Senior consultant"], ["s2", "Ciarán Walsh", "Technician"], ["s3", "Niamh Byrne", "Bookings"]].map(([id, name, role]) => ({ id, name, role, dailyLimit: 0, google: "", feedUrl: "", canEdit: false, weekly: { mon: [["09:00", "17:30"]], tue: [["09:00", "17:30"]], wed: [["09:00", "17:30"]], thu: [["09:00", "17:30"]], fri: [["09:00", "16:00"]] } as Partial<Record<DayKey, Window[]>>, blocked: [] }));
  const siteStaff: Staff[] = site.team.map((name, i) => ({ ...fallbackStaff[0], id: `site-staff-${i}`, name, role: /tattoo|ink/i.test(clientName) ? "Artist" : "", avatar: site.photos?.[name] || "" }));
  // The team named on the client's website wins; otherwise their account team; otherwise demo names.
  const staff = (siteStaff.length >= 2 ? siteStaff : real?.staff.length ? real.staff : siteStaff.length ? siteStaff : fallbackStaff).slice(0, 6).map((p) => ({ ...p, weekly: p.weekly && Object.keys(p.weekly).length ? p.weekly : fallbackStaff[0].weekly }));
  const trade = site.services.length >= 2 ? site.services.slice(0, 3) : /roof/i.test(clientName) ? ["Roof survey", "Repair quote", "Gutter check"] : /interior|kitchen|design/i.test(clientName) ? ["Design consultation", "Site measure", "Showroom visit"] : /ink|tattoo/i.test(clientName) ? ["Tattoo consultation", "Session", "Touch-up"] : ["Consultation", "Site visit", "Follow-up call"];
  const colours = ["#2563eb", "#16a34a", "#d97706"];
  const calendars = trade.map((name, i) => ({ id: `sample-cal-${i}`, clientId: "", name, slug: `sample-${i}`, kind: i === 0 ? "consultation" : "service", description: "", durationMin: /consult|touch|check|call|piercing|quote|measure/i.test(name) ? 30 : /tattoo|session|sleeve|realism|cover|black|colour|color|fine line|anime|portrait/i.test(name) ? 180 : /survey|visit|install|repair/i.test(name) ? 90 : 60, bufferBefore: 0, bufferAfter: 15, slotInterval: 30, minNoticeMin: 0, maxDaysAhead: 60, dailyLimit: 0, locationType: "onsite", locationDetail: "", price: 0, currency: "EUR", color: colours[i], assignMode: "customer_pick", staffIds: staff.map((p) => p.id), questions: [], stageId: "", confirmationMessage: "", redirectUrl: "", active: true, timezone: "Europe/Dublin" } as Calendar));
  const people = ["Mary Burke", "Tom Walsh", "Sinéad Kelly", "John Doyle", "Emma Ryan", "Patrick Nolan", "Orla Gallagher", "Dave Kennedy", "Ciara Moran", "Liam O'Brien", "Grace Lynch", "Seán Fitzgerald"];
  const bookings: Booking[] = [];
  const now = Date.now();
  let seed = Number(ymd(week).replace(/-/g, "")) % 9973;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let d = -35; d < 49; d++) {
    const day = addDays(week, d); if (day.getDay() === 0) continue;
    const count = day.getDay() === 6 ? 1 : 2 + Math.floor(rand() * 3);
    for (let n = 0; n < count; n++) {
      const cal = calendars[Math.floor(rand() * calendars.length)]; const person = staff[Math.floor(rand() * staff.length)];
      // Starts on the half hour and always finishes within that person's working day (no sessions running past closing).
      const win = (person.weekly?.[(["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as DayKey[])[day.getDay()]] || [["09:00", "17:30"]])[0] || ["09:00", "17:30"];
      const toM = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
      const open = toM(win[0]), latest = Math.max(open, toM(win[1]) - cal.durationMin);
      const startM = open + Math.floor(rand() * (Math.floor((latest - open) / 30) + 1)) * 30;
      const start = new Date(day); start.setHours(Math.floor(startM / 60), startM % 60, 0, 0);
      const end = new Date(start.getTime() + cal.durationMin * 60_000);
      const past = end.getTime() < now; const r = rand();
      const pics = site.work?.[person.name]?.length ? site.work[person.name] : site.gallery || [];
      const photo = pics.length ? pics[Math.floor(rand() * pics.length)] : "";
      const where = site.locations.length && !/tattoo|ink|piercing/i.test(clientName) ? [{ label: "Location", value: site.locations[Math.floor(rand() * site.locations.length)] }] : [];
      bookings.push({ id: `sample-${d}-${n}`, clientId: "", calendarId: cal.id, start: start.toISOString(), end: end.toISOString(), status: past ? (r < 0.08 ? "no_show" : r < 0.13 ? "cancelled" : "completed") : (r < 0.05 ? "cancelled" : "booked"), staffIds: [person.id], contactId: null, name: people[Math.floor(rand() * people.length)], email: "", phone: "", answers: [...where, ...(photo ? [{ label: /tattoo|ink|piercing/i.test(clientName + trade.join(" ")) ? "Photo of the design" : "Photo", value: photo }] : [])], notes: "", source: "public", channel: rand() < 0.5 ? "Google Ads" : "Google search", meetLink: "", createdBy: "", createdAt: start.toISOString() });
    }
  }
  calendars.forEach((c) => { if (!c.price) c.price = c.durationMin >= 180 ? 320 : c.durationMin >= 90 ? 150 : c.durationMin >= 60 ? 90 : 50; });
  // Deposits on most bookings (kept on no-shows), so the earnings panel has something real to show.
  bookings.forEach((b, i) => { const price = calendars.find((c) => c.id === b.calendarId)?.price || 0; if (price >= 80 && i % 3 !== 2) b.answers = [...b.answers, { label: "Deposit", value: `€${Math.max(20, Math.round(price * 0.2 / 10) * 10)}` }]; });
  return { calendars, bookings, staff, clients: real?.clients || [], scope: real?.scope ?? null, canManage: false, isAdmin: false, meId: "", googleAvailable: false, emailReady: true, publicBase: real?.publicBase || "" };
}

// Book straight from somewhere else (e.g. a conversation): loads the account's calendars, then the usual New appointment form.
export function QuickBook({ scopeClientId, prefill, onClose, onBooked }: { scopeClientId: string; prefill: { name?: string; phone?: string; email?: string; notes?: string; images?: string[] }; onClose: () => void; onBooked?: (msg: string) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { let live = true; api<Data>(scopeClientId, undefined, `&from=${new Date().toISOString()}&to=${addDays(new Date(), 14).toISOString()}`).then((d) => { if (live) setData(d); }).catch((e) => { if (live) setErr(errText(e, "Scheduling couldn't load.")); }); return () => { live = false; }; }, [scopeClientId]);
  if (err) return <Modal title="Book appointment" onClose={onClose}><div className="iv-error" role="alert">{err}</div></Modal>;
  if (!data) return <Modal title="Book appointment" onClose={onClose}><p className="iv-small">Loading calendars…</p></Modal>;
  return <NewAppointment data={data} scope={scopeClientId} initial={{ date: ymd(new Date()), time: "", ...prefill }} onClose={onClose} onSaved={(msg) => { onBooked?.(msg); onClose(); }} onCalendarsChanged={() => undefined} />;
}

// Staff hours & earnings from appointments: pick a period (day / week / month / custom dates) and a person.
// Earnings use each person's pay setting (hourly rate or % commission of the appointment price).
function StaffHoursPanel({ data: base, scopeClientId, sample }: { data: Data; scopeClientId: string; sample: boolean }) {
  const [period, setPeriod] = useState<"day" | "week" | "month" | "custom">(() => { try { const v = localStorage.getItem("f2b-staff-hours-period2"); return v === "day" || v === "week" || v === "custom" ? v : "month"; } catch { return "month"; } });
  const [anchor, setAnchor] = useState(() => new Date());
  const [from, setFrom] = useState(() => ymd(addDays(new Date(), -30)));
  const [to, setTo] = useState(() => ymd(new Date()));
  const [who, setWho] = useState("");
  const [own, setOwn] = useState<Data | null>(null);
  const [pay, setPay] = useState<Record<string, { payType: "none" | "hourly" | "commission"; payRate: number }>>({});
  const [editPay, setEditPay] = useState("");
  const [cover, setCover] = useState<null | { staffId: string; to: string; from: string; until: string; dayOff: boolean }>(null);
  const [coverMsg, setCoverMsg] = useState("");
  const [covering, setCovering] = useState(false);
  const [tick, setTick] = useState(0);
  const [std, setStd] = useState<{ payType: "none" | "hourly" | "commission"; payRate: number }>({ payType: "commission", payRate: 70 });
  const [editStd, setEditStd] = useState(false);
  useEffect(() => { if (sample) return; let live = true; api<{ payType: "none" | "hourly" | "commission"; payRate: number }>(scopeClientId, { action: "getDefaultPay" }).then((r) => { if (live) setStd({ payType: r.payType, payRate: r.payRate }); }).catch(() => undefined); return () => { live = false; }; }, [sample, scopeClientId]);
  const range = useMemo(() => {
    if (period === "custom") { const a = new Date(`${from}T00:00:00`), b = addDays(new Date(`${to}T00:00:00`), 1); return { a, b: b > a ? b : addDays(a, 1) }; }
    if (period === "day") { const a = new Date(anchor); a.setHours(0, 0, 0, 0); return { a, b: addDays(a, 1) }; }
    if (period === "week") { const a = mondayOf(anchor); return { a, b: addDays(a, 7) }; }
    const a = new Date(anchor.getFullYear(), anchor.getMonth(), 1); return { a, b: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1) };
  }, [period, anchor, from, to]);
  // Real data: fetch exactly the chosen period (it can be further back than the dashboard loads).
  useEffect(() => {
    if (sample) { setOwn(null); return; }
    let live = true;
    api<Data>(scopeClientId, undefined, `&from=${range.a.toISOString()}&to=${range.b.toISOString()}`).then((d) => { if (live) setOwn(d); }).catch(() => undefined);
    return () => { live = false; };
  }, [sample, scopeClientId, range.a.getTime(), range.b.getTime(), tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const data = own || base;
  const cal = new Map(data.calendars.map((c) => [c.id, c]));
  const money = (n: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: data.calendars[0]?.currency || "EUR", maximumFractionDigits: 0 }).format(n);
  const priceOf = (b: Booking) => { const a = b.answers.find((x) => /^price$/i.test(x.label))?.value || ""; const n = Number(a.replace(/[^0-9.]/g, "")); return n > 0 ? n : (cal.get(b.calendarId)?.price || 0); };
  const payOf = (p: Staff) => pay[p.id] || (p.profile?.payType && p.profile.payType !== "none" ? { payType: p.profile.payType, payRate: p.profile.payRate || 0 } : { ...std, standard: true } as { payType: "none" | "hourly" | "commission"; payRate: number; standard?: boolean });
  const inRangeAll = data.bookings.filter((b) => Date.parse(b.start) >= range.a.getTime() && Date.parse(b.start) < range.b.getTime());
  const inRange = inRangeAll.filter((b) => b.status !== "cancelled");
  const depositOf = (b: Booking) => { const v = b.answers.find((x) => /^deposit/i.test(x.label))?.value || ""; const n = Number(v.replace(/[^0-9.]/g, "")); return n > 0 ? n : 0; };
  const people = data.staff.filter((p) => !who || p.id === who);
  const rows = people.map((p) => {
    const share = (b: Booking) => 1 / Math.max(1, b.staffIds.length);
    const mineAll = inRangeAll.filter((b) => b.staffIds.includes(p.id));
    const mine = mineAll.filter((b) => b.status !== "cancelled");
    const hrs = (list: Booking[]) => list.reduce((n, b) => n + (Date.parse(b.end) - Date.parse(b.start)) / 3_600_000, 0);
    const worked = mine.filter((b) => b.status === "completed" || (b.status === "booked" && Date.parse(b.end) < Date.now()));
    const upcoming = mine.filter((b) => b.status === "booked" && Date.parse(b.end) >= Date.now());
    const lostList = mineAll.filter((b) => b.status === "no_show" || b.status === "cancelled");
    const value = (list: Booking[]) => list.reduce((n, b) => n + priceOf(b) * share(b), 0);
    const revenue = value(worked), aheadRevenue = value(upcoming), lost = value(lostList);
    const deposits = mineAll.reduce((n, b) => n + depositOf(b) * share(b), 0);
    const pr = payOf(p); const workedH = hrs(worked), upcomingH = hrs(upcoming);
    const cut = (v: number, h: number) => pr.payType === "hourly" ? h * pr.payRate : pr.payType === "commission" ? v * pr.payRate / 100 : 0;
    return { p, count: mine.length, workedH, upcomingH, noShows: lostList.filter((b) => b.status === "no_show").length, revenue, aheadRevenue, lost, deposits, earned: cut(revenue, workedH), scheduledPay: cut(aheadRevenue, upcomingH), pr };
  });
  const tot = rows.reduce((t, r) => ({ h: t.h + r.workedH, u: t.u + r.upcomingH, n: t.n + r.count, rev: t.rev + r.revenue, sched: t.sched + r.aheadRevenue, lost: t.lost + r.lost, dep: t.dep + r.deposits, earn: t.earn + r.earned, earnS: t.earnS + r.scheduledPay }), { h: 0, u: 0, n: 0, rev: 0, sched: 0, lost: 0, dep: 0, earn: 0, earnS: 0 });
  const maxH = Math.max(1, ...rows.map((r) => r.workedH + r.upcomingH));
  const label = period === "custom" ? `${new Date(`${from}T12:00:00`).toLocaleDateString("en-IE", { day: "numeric", month: "short" })} – ${new Date(`${to}T12:00:00`).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" })}` : period === "day" ? range.a.toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" }) : period === "week" ? `Week of ${range.a.toLocaleDateString("en-IE", { day: "numeric", month: "short" })}` : range.a.toLocaleDateString("en-IE", { month: "long", year: "numeric" });
  const setP = (v: typeof period) => { setPeriod(v); try { localStorage.setItem("f2b-staff-hours-period2", v); } catch { /* optional */ } };
  const step = (dir: 1 | -1) => setAnchor(period === "month" ? new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1) : addDays(anchor, (period === "day" ? 1 : 7) * dir));
  const savePay = async (p: Staff, v: { payType: "none" | "hourly" | "commission"; payRate: number }) => {
    setPay((cur) => ({ ...cur, [p.id]: v })); setEditPay("");
    if (sample) return;
    try { await api(scopeClientId, { action: "saveProfile", staffId: p.id, profile: { ...(p.profile || { showReviews: false, showPhotos: false, title: "", bio: "", reviews: [], photos: [] }), ...v } }); } catch { /* keeps the local value */ }
  };
  const saveStd = async (v: { payType: "none" | "hourly" | "commission"; payRate: number }) => { setStd(v); setEditStd(false); if (!sample) { try { await api(scopeClientId, { action: "saveDefaultPay", ...v }); } catch { /* keeps the local value */ } } };
  const rule = (pr: { payType: string; payRate: number; standard?: boolean }) => pr.payType === "hourly" ? `${money(pr.payRate)}/h` : pr.payType === "commission" ? `${pr.payRate}% / ${100 - pr.payRate}%${pr.standard ? " · standard" : ""}` : "No pay set";
  return <section className="sch-earn" aria-label="Staff hours and earnings">
    <div className="sch-earn-head">
      <div><p className="eyebrow">⏱ STAFF HOURS &amp; EARNINGS <span className="admin-badge" title="Only admins can see staff pay and business profit">ADMIN</span></p><h3>{label}</h3></div>
      <div className="sch-dash-panel-tools">
        <label className="sch-select"><Users size={14} /><select aria-label="Staff member" value={who} onChange={(e) => setWho(e.target.value)}><option value="">Everyone</option>{data.staff.map((p) => <option key={p.id} value={p.id}>{p.name.split("|")[0].trim()}</option>)}</select></label>
        <div className="sch-seg" role="tablist" aria-label="Period">{(["day", "week", "month", "custom"] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={period === k} className={period === k ? "on" : ""} onClick={() => setP(k)}>{k === "custom" ? "Dates" : k[0].toUpperCase() + k.slice(1)}</button>)}</div>
        {period === "custom" ? <span className="sch-earn-dates"><input type="date" aria-label="From" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} /><span>→</span><input type="date" aria-label="To" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} /></span>
          : <><button type="button" className="iv-btn" aria-label="Previous" onClick={() => step(-1)}><ChevronLeft size={15} /></button><button type="button" className="iv-btn" onClick={() => setAnchor(new Date())}>Now</button><button type="button" className="iv-btn" aria-label="Next" onClick={() => step(1)}><ChevronRight size={15} /></button></>}
      </div>
    </div>
    <div className="sch-earn-totals">
      <div><small>Earned</small><b>{money(tot.rev)}</b><em>{tot.h.toFixed(1)}h done</em></div>
      <div><small>Scheduled</small><b>{money(tot.sched)}</b><em>{tot.u.toFixed(1)}h booked · {tot.n} appts</em></div>
      <div className="lost"><small>Lost</small><b>{money(tot.lost)}</b><em>no-shows &amp; cancellations</em></div>
      <div><small>Deposits paid</small><b>{money(tot.dep)}</b><em>held on bookings</em></div>
      <div className="earn"><small>Staff pay</small><b>{money(tot.earn)}</b><em>+{money(tot.earnS)} when scheduled work is done</em></div>
      <div className="profit"><small>Business profit <span className="admin-badge" title="Only admins see this">ADMIN</span></small><b>{money(tot.rev - tot.earn)}</b><em>{tot.rev > 0 ? `${Math.round(((tot.rev - tot.earn) / tot.rev) * 100)}% of earned · ` : ""}+{money(Math.max(0, tot.sched - tot.earnS))} scheduled</em></div>
    </div>
    <div className="sch-earn-split"><span>Standard split</span>{editStd ? <PayEditor value={std} onSave={(v) => void saveStd(v)} onCancel={() => setEditStd(false)} /> : <button type="button" className="sch-earn-chip" onClick={() => setEditStd(true)}>{std.payType === "commission" ? `Staff ${std.payRate}% · Business ${100 - std.payRate}%` : std.payType === "hourly" ? `${money(std.payRate)} per hour` : "Set split"} ✎</button>}<small>Used for everyone unless you set their own.</small><span style={{ flex: 1 }} /><button type="button" className="sch-earn-chip" onClick={() => window.dispatchEvent(new CustomEvent("f2b-open-books-tab", { detail: "payslips" }))} title="Open Books → Payslips">🧾 Payslips →</button><button type="button" className="sch-earn-chip" disabled={!tot.earn} onClick={() => { if (sample) { setCoverMsg("Sample data — nothing added to Books."); return; } window.dispatchEvent(new CustomEvent("f2b-staff-pay-expense", { detail: { entries: rows.filter((r) => r.earned > 0).map((r) => ({ id: `staffpay-${r.p.id}-${ymd(range.a)}-${ymd(range.b)}`, description: `Staff pay · ${r.p.name.split("|")[0].trim()} · ${label}`, amount: r.earned, date: ymd(addDays(range.b, -1) < new Date() ? addDays(range.b, -1) : new Date()), clientId: data.scope || scopeClientId || "" })) } })); setCoverMsg(`Staff pay for ${label} sent to Books (Staff wages).`); }}>➕ Add pay to Books</button></div>
    {coverMsg && <p className="sch-earn-note" role="status">{coverMsg}</p>}
    {cover && (() => { const person = data.staff.find((p) => p.id === cover.staffId); const a = new Date(`${cover.from}T00:00:00`).getTime(), z = addDays(new Date(`${cover.until}T00:00:00`), 1).getTime();
      const affected = data.bookings.filter((b) => b.status === "booked" && b.staffIds.includes(cover.staffId) && Date.parse(b.start) >= a && Date.parse(b.start) < z);
      const run = async () => {
        if (!cover.to) return; setCovering(true); let moved = 0, failed = 0;
        for (const b of affected) {
          if (sample || b.id.startsWith("sample-")) { moved++; continue; }
          try { await api(scopeClientId, { action: "updateBooking", id: b.id, staffIds: [...new Set(b.staffIds.map((x) => x === cover.staffId ? cover.to : x))], notify: false }); moved++; } catch { failed++; }
        }
        if (cover.dayOff && person && !sample) {
          const days: string[] = []; for (let d = new Date(`${cover.from}T12:00:00`); d.getTime() < z; d = addDays(d, 1)) days.push(ymd(d));
          try { await api(scopeClientId, { action: "saveAvailability", staffId: person.id, weekly: person.weekly || {}, blocked: [...new Set([...(person.blocked || []), ...days])], dailyLimit: person.dailyLimit || 0, timezone: person.timezone }); } catch { /* the move still stands */ }
        }
        const coverName = data.staff.find((p) => p.id === cover.to)?.name.split("|")[0].trim() || "cover";
        setCoverMsg(`${coverName} now has ${moved} of the appointment${moved === 1 ? "" : "s"} for ${person?.name.split("|")[0].trim()}${failed ? ` · ${failed} couldn't move (that person may be busy)` : ""}${sample ? " (sample — nothing saved)" : ""}.`);
        setCovering(false); setCover(null); if (!sample) setTick((t) => t + 1);
      };
      return <div className="sch-cover" role="dialog" aria-label="Arrange cover">
        <b>Reassign {person?.name.split("|")[0].trim()}'s bookings</b><small className="iv-small">Off sick or away? Their booked appointments move to someone else for these dates.</small>
        <div className="sch-cover-grid">
          <label>From<input type="date" value={cover.from} onChange={(e) => e.target.value && setCover({ ...cover, from: e.target.value, until: e.target.value > cover.until ? e.target.value : cover.until })} /></label>
          <label>Until<input type="date" value={cover.until} min={cover.from} onChange={(e) => e.target.value && setCover({ ...cover, until: e.target.value })} /></label>
          <label>Covered by<select value={cover.to} onChange={(e) => setCover({ ...cover, to: e.target.value })}><option value="">Choose…</option>{data.staff.filter((p) => p.id !== cover.staffId).map((p) => <option key={p.id} value={p.id}>{p.name.split("|")[0].trim()}</option>)}</select></label>
        </div>
        <label className="iv-check iv-small"><input type="checkbox" checked={cover.dayOff} onChange={(e) => setCover({ ...cover, dayOff: e.target.checked })} /> Mark {person?.name.split("|")[0].trim()} as off these days (no new bookings)</label>
        <p className="iv-small">{affected.length ? `${affected.length} booked appointment${affected.length === 1 ? "" : "s"} will move to the cover person. Customers aren't emailed.` : "No booked appointments in these dates."}</p>
        <div className="sch-cover-actions"><button type="button" className="secondary-button" onClick={() => setCover(null)}>Cancel</button><button type="button" className="primary-button" disabled={!cover.to || covering} onClick={() => void run()}>{covering ? "Moving…" : `Move ${affected.length} booking${affected.length === 1 ? "" : "s"}`}</button></div>
      </div>; })()}
    <div className="sch-earn-table">
      <div className="sch-earn-row head"><span>Staff</span><span>Earned</span><span>Scheduled</span><span>Lost</span><span>Deposits</span><span>Staff pay</span><span /></div>
      {rows.map((r) => <div key={r.p.id} className="sch-earn-row">
        <div className="sch-tl-who"><Avatar person={r.p} size={32} /><span><b>{r.p.name.split("|")[0].trim()}</b><small>{r.workedH.toFixed(1)}h done · {r.upcomingH.toFixed(1)}h booked</small></span></div>
        <div className="sch-earn-cell"><b>{money(r.revenue)}</b></div>
        <div className="sch-earn-cell"><b>{money(r.aheadRevenue)}</b></div>
        <div className="sch-earn-cell lost"><b>{money(r.lost)}</b>{r.noShows > 0 && <em>{r.noShows} no-show{r.noShows === 1 ? "" : "s"}</em>}</div>
        <div className="sch-earn-cell"><b>{money(r.deposits)}</b></div>
        <div className="sch-earn-cell earn">{editPay === r.p.id ? <PayEditor value={r.pr} onSave={(v) => void savePay(r.p, v)} onCancel={() => setEditPay("")} /> : <><b>{money(r.earned)}{r.scheduledPay > 0 && <small> +{money(r.scheduledPay)}</small>}</b><button type="button" className="sch-earn-chip sm" onClick={() => setEditPay(r.p.id)} title="Change this person's pay">{r.pr.payType === "hourly" ? `${money(r.pr.payRate)}/h` : r.pr.payType === "commission" ? `${r.pr.payRate}%${(r.pr as { standard?: boolean }).standard ? "" : " (own)"}` : "Set pay"}</button></>}</div>
        <button type="button" className="sch-earn-cover" title={`Off sick or away? Move ${r.p.name.split("|")[0].trim()}'s bookings to someone else`} onClick={() => setCover({ staffId: r.p.id, to: "", from: ymd(new Date()), until: ymd(new Date()), dayOff: true })}>Reassign</button>
      </div>)}
      {!rows.length && <p className="dh-muted">No staff to show.</p>}
    </div>
  </section>;
}

function PayEditor({ value, onSave, onCancel }: { value: { payType: "none" | "hourly" | "commission"; payRate: number }; onSave: (v: { payType: "none" | "hourly" | "commission"; payRate: number }) => void; onCancel: () => void }) {
  const [t, setT] = useState(value.payType === "none" ? "commission" : value.payType);
  const [rate, setRate] = useState(value.payRate ? String(value.payRate) : "");
  return <span className="sch-pay-edit"><select value={t} onChange={(e) => setT(e.target.value as "hourly" | "commission")}><option value="commission">% of price</option><option value="hourly">Per hour</option></select><input type="number" min={0} step="0.5" value={rate} placeholder={t === "hourly" ? "€/h" : "%"} onChange={(e) => setRate(e.target.value)} autoFocus /><button type="button" className="iv-btn ok" onClick={() => onSave({ payType: Number(rate) > 0 ? t : "none", payRate: Number(rate) || 0 })}>Save</button><button type="button" className="iv-btn" onClick={onCancel}>×</button></span>;
}


// ================= Payslips (Books → Payslips, admins only) =================
// Built from each person's finished appointments and pay split, with Irish PAYE / USC / PRSI worked out from their
// payroll details (PPS number, RPN tax credits and cut-off point). Issued payslips go into a register for year-to-date figures.
type PayRule = { payType: "none" | "hourly" | "commission"; payRate: number };
type Business = { name: string; logo: string };
const PERIOD_PRESETS = [["thisMonth", "This month"], ["lastMonth", "Last month"], ["thisWeek", "This week"], ["lastWeek", "Last week"], ["custom", "Custom dates"]] as const;
type PeriodKey = typeof PERIOD_PRESETS[number][0];
const fmtDate = (s: string) => s ? new Date(`${s}T12:00:00`).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" }) : "";
const firstName = (n: string) => n.split("|")[0].trim();
// Demo PPS numbers with a correct check letter (sample mode only).
const demoPps = (i: number) => { const d = String(2345678 + i * 1111).slice(0, 7); let sum = 0; for (let k = 0; k < 7; k++) sum += Number(d[k]) * (8 - k); const rem = sum % 23; return `${d}${rem === 0 ? "W" : String.fromCharCode(64 + rem)}`; };

function periodRange(key: PeriodKey, from: string, to: string) {
  const now = new Date(); const wk = mondayOf(now);
  if (key === "thisWeek") return { a: wk, b: addDays(wk, 6) };
  if (key === "lastWeek") return { a: addDays(wk, -7), b: addDays(wk, -1) };
  if (key === "thisMonth") return { a: new Date(now.getFullYear(), now.getMonth(), 1), b: new Date(now.getFullYear(), now.getMonth() + 1, 0) };
  if (key === "lastMonth") return { a: new Date(now.getFullYear(), now.getMonth() - 1, 1), b: new Date(now.getFullYear(), now.getMonth(), 0) };
  const a = new Date(`${from}T00:00:00`), b = new Date(`${to}T00:00:00`); return { a, b: b < a ? a : b };
}

export function PayslipsView({ scopeClientId, business }: { scopeClientId: string; business: Business }) {
  const [sample] = useSampleData();
  const [real, setReal] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [payroll, setPayroll] = useState<{ employer: PayrollEmployer; people: Record<string, PayrollPerson>; slips: PayslipRecord[] } | null>(null);
  const [std, setStd] = useState<PayRule>({ payType: "commission", payRate: 70 });
  const [demoSlips, setDemoSlips] = useState<PayslipRecord[]>([]);
  const [demoPeople, setDemoPeople] = useState<Record<string, PayrollPerson>>({});
  const [demoEmployer, setDemoEmployer] = useState<PayrollEmployer | null>(null);
  const [view, setView] = useState<PayslipRecord | null>(null);
  const [editPerson, setEditPerson] = useState("");
  const [editEmployer, setEditEmployer] = useState(false);
  const year = new Date().getFullYear();
  const site = useSiteSample(scopeClientId, sample);
  const load = useCallback(async () => {
    try {
      const from = new Date(year - 1, 11, 1), to = addDays(new Date(), 2);
      const [d, p, s] = await Promise.all([
        api<Data>(scopeClientId, undefined, `&from=${from.toISOString()}&to=${to.toISOString()}`),
        api<{ employer: PayrollEmployer; people: Record<string, PayrollPerson>; slips: PayslipRecord[] }>(scopeClientId, { action: "getPayroll", year }),
        api<PayRule>(scopeClientId, { action: "getDefaultPay" }).catch(() => null),
      ]);
      setReal(d); setPayroll(p); if (s) setStd({ payType: s.payType, payRate: s.payRate }); setErr("");
    } catch (e) { setErr(errText(e, "Payroll couldn't load.")); }
  }, [scopeClientId, year]);
  useEffect(() => { void load(); }, [load]);
  const data = useMemo(() => sample ? sampleSchedule(real, mondayOf(new Date()), business.name, site) : real, [sample, real, business.name, site]); // eslint-disable-line react-hooks/exhaustive-deps
  const head = <header className="crv-head ps-head"><div><h2>Payslips <span className="admin-badge" title="Only admins can see payroll">ADMIN</span></h2><p>Branded payslips for <b>{business.name}</b>, built from each person&apos;s finished appointments and pay split, with PAYE, USC and PRSI.</p></div>{data && (payroll || sample) && <button type="button" className="secondary-button" onClick={() => setEditEmployer(true)}>Employer details</button>}</header>;
  if (err && !sample) return <section className="crv ps-view">{head}<p className="dh-muted">{err}</p></section>;
  if (!data || (!payroll && !sample)) return <section className="crv ps-view">{head}<p className="dh-muted">Loading payroll…</p></section>;
  const employer: PayrollEmployer = sample ? (demoEmployer || { name: business.name, address: "12 Main Street, Galway, H91 X2Y3", employerNo: "1234567FA", phone: "091 555 0100", email: "" }) : { ...payroll!.employer, name: payroll!.employer.name || business.name };
  const people: Record<string, PayrollPerson> = sample ? Object.fromEntries(data.staff.map((p, i) => [p.id, demoPeople[p.id] || { ...DEFAULT_PERSON, pps: demoPps(i), employeeNo: `E${String(i + 1).padStart(3, "0")}` }])) : payroll!.people;
  const slips = sample ? demoSlips : payroll!.slips;
  const payOf = (p: Staff): PayRule => p.profile?.payType && p.profile.payType !== "none" ? { payType: p.profile.payType, payRate: p.profile.payRate || 0 } : std;
  const currency = data.calendars[0]?.currency || "EUR";
  const savePerson = async (id: string, person: PayrollPerson) => { if (sample) { setDemoPeople((m) => ({ ...m, [id]: person })); return person; } const r = await api<{ person: PayrollPerson }>(scopeClientId, { action: "savePayrollPerson", staffId: id, person }); setPayroll((cur) => cur ? { ...cur, people: { ...cur.people, [id]: r.person } } : cur); return r.person; };
  const removeSlip = async (s: PayslipRecord) => { if (!(await appConfirm(`Delete payslip #${s.number} for ${s.staffName}?`))) return; if (sample) { setDemoSlips((l) => l.filter((x) => x.key !== s.key)); return; } try { await api(scopeClientId, { action: "deletePayslip", key: s.key }); setPayroll((cur) => cur ? { ...cur, slips: cur.slips.filter((x) => x.key !== s.key) } : cur); } catch (e) { await appAlert(errText(e, "Couldn't delete it.")); } };
  return <section className="crv ps-view" aria-label="Payslips">
    {head}
    {sample && <p className="ps-banner">Sample data: demo PPS numbers and figures. Nothing is saved.</p>}
    {!sample && !employer.employerNo && <p className="ps-banner warn">Add your Revenue employer registration number under <button type="button" className="text-button" onClick={() => setEditEmployer(true)}>Employer details</button>.</p>}
    <PayslipCreator data={data} people={people} employer={employer} business={business} slips={slips} payOf={payOf} currency={currency} sample={sample} scopeClientId={scopeClientId} onEditPerson={setEditPerson}
      onIssued={(rec) => { if (sample) setDemoSlips((list) => [rec, ...list.filter((s) => s.key !== rec.key)]); else setPayroll((cur) => cur ? { ...cur, slips: [rec, ...cur.slips.filter((s) => s.key !== rec.key)] } : cur); }} />
    <div className="crv-history">
      <h3>Saved payslips</h3>
      <p className="crv-sub">Every payslip you issue is kept here for {year}; year-to-date figures come from this list.</p>
      {slips.length ? <ul>{[...slips].sort((a, b) => b.payDate.localeCompare(a.payDate) || b.number - a.number).map((s) => { const p = data.staff.find((x) => x.id === s.staffId); return <li key={s.key}>
        <Avatar person={p || { name: s.staffName }} size={34} />
        <span><b>{s.staffName} · {fmtDate(s.periodStart)} – {fmtDate(s.periodEnd)}</b><small>Payslip #{s.number} · paid {fmtDate(s.payDate)} · gross {moneyOf(s.result.gross, currency)} · net <b>{moneyOf(s.result.net, currency)}</b></small></span>
        <button type="button" className="secondary-button" onClick={() => setView(s)}>View</button>
        <button type="button" className="secondary-button" onClick={() => printPayslip(s, business, currency)}>PDF</button>
        <button type="button" className="text-button ps-del" aria-label={`Delete payslip ${s.number}`} onClick={() => void removeSlip(s)}>Delete</button>
      </li>; })}</ul> : <p className="muted">No saved payslips for {business.name} yet.</p>}
    </div>
    {view && <div className="bt-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setView(null); }}><div className="bt ps" role="dialog" aria-modal="true" aria-label="Payslip">
      <header className="bt-head"><div><p className="eyebrow">🧾 PAYSLIP #{view.number}</p><h2>{view.staffName}</h2></div><button type="button" className="bt-x" aria-label="Close" onClick={() => setView(null)}>×</button></header>
      <div className="ps-body"><PayslipDoc rec={view} business={business} currency={currency} /></div>
      <footer className="bt-foot"><span style={{ flex: 1 }} /><button type="button" className="primary-button" onClick={() => printPayslip(view, business, currency)}>Download PDF</button></footer>
    </div></div>}
    {editPerson && <PayrollPersonModal person={data.staff.find((p) => p.id === editPerson)} value={people[editPerson]} sample={sample} onClose={() => setEditPerson("")} onSave={(v) => savePerson(editPerson, v)} />}
    {editEmployer && <div className="bt-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditEmployer(false); }}><div className="bt ps ps-form" role="dialog" aria-modal="true" aria-label="Employer details">
      <header className="bt-head"><div><p className="eyebrow">EMPLOYER DETAILS <span className="admin-badge">ADMIN</span></p><h2>{employer.name || business.name}</h2><p>Shown at the top of every payslip.</p></div><button type="button" className="bt-x" aria-label="Close" onClick={() => setEditEmployer(false)}>×</button></header>
      <div className="ps-body"><PayrollEmployerForm value={employer} business={business} onSave={async (v) => { if (sample) setDemoEmployer(v); else { const r = await api<{ employer: PayrollEmployer }>(scopeClientId, { action: "savePayrollEmployer", employer: v }); setPayroll((cur) => cur ? { ...cur, employer: r.employer } : cur); } setEditEmployer(false); }} /></div>
    </div></div>}
  </section>;
}

const moneyOf = (n: number, currency: string) => { try { return new Intl.NumberFormat("en-IE", { style: "currency", currency }).format(n); } catch { return `€${n.toFixed(2)}`; } };

function PayslipCreator({ data, people, employer, business, slips, payOf, currency, sample, scopeClientId, onIssued, onEditPerson }: { data: Data; people: Record<string, PayrollPerson>; employer: PayrollEmployer; business: Business; slips: PayslipRecord[]; payOf: (p: Staff) => PayRule; currency: string; sample: boolean; scopeClientId: string; onIssued: (rec: PayslipRecord) => void; onEditPerson: (id: string) => void }) {
  const [who, setWho] = useState(data.staff[0]?.id || "");
  const [period, setPeriod] = useState<PeriodKey>(sample ? "thisMonth" : "lastMonth");
  const [from, setFrom] = useState(() => ymd(addDays(new Date(), -30)));
  const [to, setTo] = useState(() => ymd(new Date()));
  const range = periodRange(period, from, to);
  const [payDate, setPayDate] = useState("");
  const [extras, setExtras] = useState<PayLine[]>([]);
  const [cuts, setCuts] = useState<PayLine[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [shown, setShown] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const [generating, setGenerating] = useState(false);
  const genTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(genTimer.current), []);
  const whoName = firstName(data.staff.find((p) => p.id === who)?.name || "");
  const genSteps = useMemo(() => ["Gathering details…", `Finding ${whoName}'s finished appointments…`, "Working out PAYE, USC and PRSI…", "Adding your logo and year-to-date totals…"], [whoName]);
  const generate = () => { setMsg(""); setShown(false); setGenerating(true); window.clearTimeout(genTimer.current); genTimer.current = window.setTimeout(() => { setGenerating(false); setShown(true); }, 4600); };
  useEffect(() => { if (!data.staff.some((p) => p.id === who)) setWho(data.staff[0]?.id || ""); }, [data.staff, who]);
  const reset = () => { window.clearTimeout(genTimer.current); setGenerating(false); setShown(false); setMsg(""); setExtras([]); setCuts([]); setAdjust(false); };
  const person = data.staff.find((p) => p.id === who);
  const details = people[who] || { ...DEFAULT_PERSON };
  const periodStart = ymd(range.a), periodEnd = ymd(range.b), pay = payDate || periodEnd;
  const cal = new Map(data.calendars.map((c) => [c.id, c]));
  const priceOf = (b: Booking) => { const n = Number((b.answers.find((x) => /^price$/i.test(x.label))?.value || "").replace(/[^0-9.]/g, "")); return n > 0 ? n : (cal.get(b.calendarId)?.price || 0); };
  const rule = person ? payOf(person) : { payType: "none" as const, payRate: 0 };
  const done = person ? data.bookings.filter((b) => b.staffIds.includes(who) && ymd(new Date(b.start)) >= periodStart && ymd(new Date(b.start)) <= periodEnd && (b.status === "completed" || (b.status === "booked" && Date.parse(b.end) < Date.now()))) : [];
  // One earnings line per service: count, hours and value at this person's split.
  const groups = new Map<string, { n: number; h: number; v: number }>();
  for (const b of done) { const share = 1 / Math.max(1, b.staffIds.length); const k = cal.get(b.calendarId)?.name || "Appointments"; const g = groups.get(k) || { n: 0, h: 0, v: 0 }; g.n++; g.h += (Date.parse(b.end) - Date.parse(b.start)) / 3_600_000 * share; g.v += priceOf(b) * share; groups.set(k, g); }
  const workLines: PayLine[] = [...groups.entries()].map(([k, g]) => ({ label: k, detail: rule.payType === "hourly" ? `${g.n} appt${g.n === 1 ? "" : "s"} · ${g.h.toFixed(1)}h @ ${moneyOf(rule.payRate, currency)}/h` : `${g.n} appt${g.n === 1 ? "" : "s"} · ${g.h.toFixed(1)}h · ${moneyOf(g.v, currency)} work @ ${rule.payRate}%`, amount: Math.round((rule.payType === "hourly" ? g.h * rule.payRate : rule.payType === "commission" ? g.v * rule.payRate / 100 : 0) * 100) / 100 })).filter((l) => l.amount > 0);
  const earnings = [...workLines, ...extras.filter((l) => l.label && l.amount)];
  const deductions = cuts.filter((l) => l.label && l.amount);
  const key = `${who}:${periodStart}:${periodEnd}`;
  const already = slips.find((s) => s.key === key);
  const localCompute = (): PayslipRecord => {
    const ytd = slips.filter((s) => s.staffId === who && s.key !== key && s.payDate.slice(0, 4) === pay.slice(0, 4) && (s.payDate < pay || (s.payDate === pay && s.key < key))).reduce((t, s) => ({ gross: t.gross + s.result.gross, taxable: t.taxable + s.result.taxable, paye: t.paye + s.result.paye, usc: t.usc + s.result.usc, prsi: t.prsi + s.result.prsiEE, net: t.net + s.result.net, pension: t.pension + s.result.pension }), { ...EMPTY_YTD });
    const result = computePayslip({ person: details, gross: earnings.reduce((n, l) => n + l.amount, 0), otherDeductions: deductions.reduce((n, l) => n + Math.abs(l.amount), 0), payDate: pay, periodStart, periodEnd, ytd });
    return { key, number: already?.number || slips.reduce((m, s) => Math.max(m, s.number || 0), 0) + 1, staffId: who, staffName: firstName(person?.name || ""), role: person?.role || "", payDate: pay, periodStart, periodEnd, issuedAt: new Date().toISOString(), note, earnings, deductions, employer, person: details, result };
  };
  const preview = shown && person ? localCompute() : null;
  const issue = async () => {
    if (!person) return; setBusy(true); setMsg("");
    try {
      const rec = sample ? localCompute() : (await api<{ slip: PayslipRecord }>(scopeClientId, { action: "issuePayslip", staffId: who, payDate: pay, periodStart, periodEnd, earnings, deductions, note })).slip;
      onIssued(rec);
      if (!sample && rec.result.gross > 0) {
        const entries = [{ id: `payslip-${rec.key}`, description: `Wages · ${rec.staffName} · payslip #${rec.number} (${fmtDate(periodStart)} – ${fmtDate(periodEnd)})`, amount: rec.result.gross, date: rec.payDate, clientId: data.scope || scopeClientId || "" }];
        if (rec.result.prsiER > 0) entries.push({ id: `payslip-er-${rec.key}`, description: `Employer PRSI · ${rec.staffName} · payslip #${rec.number}`, amount: rec.result.prsiER, date: rec.payDate, clientId: data.scope || scopeClientId || "" });
        window.dispatchEvent(new CustomEvent("f2b-staff-pay-expense", { detail: { entries } }));
      }
      setMsg(sample ? "Sample: saved on this screen only (nothing added to Books)." : `Payslip #${rec.number} saved and added to Books (wages${rec.result.prsiER > 0 ? " + employer PRSI" : ""}).`);
    } catch (e) { setMsg(errText(e, "Couldn't save the payslip.")); }
    setBusy(false);
  };
  const lineEditor = (list: PayLine[], set: (l: PayLine[]) => void, kind: "pay" | "cut") => <div className="ps-lines">
    {list.map((l, i) => <div key={i} className="ps-line"><input aria-label="Description" value={l.label} placeholder={kind === "pay" ? "e.g. Tips, bonus, holiday pay" : "e.g. Advance repaid"} maxLength={120} onChange={(e) => set(list.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} /><input aria-label="Amount" type="number" step="0.01" min={0} value={l.amount || ""} placeholder="0.00" onChange={(e) => set(list.map((x, j) => j === i ? { ...x, amount: Number(e.target.value) || 0 } : x))} /><button type="button" className="iv-btn" aria-label="Remove" onClick={() => set(list.filter((_, j) => j !== i))}>×</button></div>)}
    <button type="button" className="text-button" onClick={() => set([...list, { label: "", detail: "", amount: 0 }])}>+ {kind === "pay" ? "Add pay" : "Add deduction"}</button>
  </div>;
  return <>
    <div className="crv-types ps-staff" role="radiogroup" aria-label="Staff member">
      {data.staff.map((p) => { const d = people[p.id]; const r = payOf(p); const ppsOk = d?.employment === "contractor" || validPps(d?.pps || ""); return <button key={p.id} type="button" role="radio" aria-checked={who === p.id} className={`crv-type ${who === p.id ? "on" : ""}`} onClick={() => { setWho(p.id); reset(); }}>
        <Avatar person={p} size={40} />
        <span><b>{firstName(p.name)}</b><small>{r.payType === "hourly" ? `${moneyOf(r.payRate, currency)}/h` : r.payType === "commission" ? `${r.payRate}% split` : "No pay set"} · {d?.employment === "contractor" ? "Contractor" : ppsOk ? `PPS ${maskPps(d!.pps)}` : <em className="ps-missing">PPS missing</em>}</small></span>
      </button>; })}
      {!data.staff.length && <p className="dh-muted">No staff in this account yet.</p>}
    </div>
    <div className="crv-controls">
      <label className="crv-field"><span>Period</span><select value={period} onChange={(e) => { setPeriod(e.target.value as PeriodKey); reset(); }}>{PERIOD_PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      {period === "custom" && <><label className="crv-field"><span>From</span><input type="date" value={from} max={to} onChange={(e) => { if (e.target.value) { setFrom(e.target.value); reset(); } }} /></label><label className="crv-field"><span>To</span><input type="date" value={to} min={from} onChange={(e) => { if (e.target.value) { setTo(e.target.value); reset(); } }} /></label></>}
      <label className="crv-field"><span>Pay date</span><input type="date" value={pay} onChange={(e) => setPayDate(e.target.value)} /></label>
      <span className="crv-range">{fmtDate(periodStart)} – {fmtDate(periodEnd)} · {done.length} finished appointment{done.length === 1 ? "" : "s"}{person ? <> · <button type="button" className="text-button" onClick={() => onEditPerson(who)}>{firstName(person.name)}&apos;s payroll details</button></> : null}</span>
      <button type="button" className="primary-button crv-go" disabled={!person || generating} onClick={generate}>{generating ? "Generating…" : shown ? "Regenerate" : "Generate preview"}</button>
    </div>
    {generating && person && <ReportGeneratingAnimation title={`Generating ${firstName(person.name)}'s payslip`} steps={genSteps} />}
    {preview && <div className="crv-preview ps-preview">
      <div className="crv-bar">
        <span className="crv-live">{already ? `Payslip #${already.number} already saved for this period — saving again replaces it` : "Preview · not saved yet"}</span>
        <span className="crv-spacer" />
        <button type="button" className={`secondary-button ${adjust ? "on" : ""}`} onClick={() => setAdjust((v) => !v)}>{adjust ? "Hide extras" : "Add pay or deductions"}</button>
        <button type="button" className="secondary-button" onClick={() => printPayslip(preview, business, currency)}>Download PDF</button>
        <button type="button" className="primary-button" disabled={busy || !earnings.length} onClick={() => void issue()}>{busy ? "Saving…" : already ? "Save again" : "Save payslip"}</button>
      </div>
      {msg && <p className="crv-notice" role="status">{msg}</p>}
      {adjust && <div className="ps-two">
        <div><h4>Extra pay</h4>{lineEditor(extras, setExtras, "pay")}</div>
        <div><h4>Other deductions</h4>{lineEditor(cuts, setCuts, "cut")}<label className="ps-notelabel">Note on the payslip<input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Paid by bank transfer" /></label></div>
      </div>}
      {!earnings.length && <p className="dh-muted">No finished appointments for {firstName(person!.name)} in this period. Use “Add pay or deductions” to add pay by hand.</p>}
      <PayslipDoc rec={preview} business={business} currency={currency} />
    </div>}
  </>;
}

function PayslipDoc({ rec, business, currency }: { rec: PayslipRecord; business: Business; currency: string }) {
  const r = rec.result; const m = (n: number) => moneyOf(n, currency);
  const contractor = r.employment === "contractor";
  const basisLabel = r.basis === "cumulative" ? "Cumulative" : r.basis === "week1" ? (rec.person.frequency === "monthly" ? "Month 1" : "Week 1") : "Emergency";
  const logo = business.logo && /^(https?:|data:image\/|\/)/.test(business.logo) ? business.logo : "";
  return <div className="ps-doc" id={`payslip-${rec.key}`}>
    <div className="ps-top">
      <div className="ps-brand">{logo ? <img src={logo} alt={rec.employer.name || business.name} data-keep-logo="" /> : null}<div><b>{rec.employer.name || business.name}</b>{rec.employer.address && <div>{rec.employer.address}</div>}{rec.employer.employerNo && <div>Employer reg. no. {rec.employer.employerNo}</div>}</div></div>
      <div className="ps-title"><h1>{contractor ? "Payment statement" : "Payslip"}</h1><div>No. {rec.number}</div><div>Pay date {fmtDate(rec.payDate)}</div></div>
    </div>
    <div className="ps-meta">
      <div><small>Employee</small><b>{rec.staffName}</b>{rec.role && <em>{rec.role}</em>}</div>
      <div><small>PPS number</small><b>{contractor ? "n/a" : (rec.person.pps || "Not provided")}</b>{rec.person.employeeNo && <em>Employee no. {rec.person.employeeNo}</em>}</div>
      <div><small>Pay period</small><b>{fmtDate(rec.periodStart)} – {fmtDate(rec.periodEnd)}</b><em>{contractor ? "Self-employed" : `${rec.person.frequency[0].toUpperCase()}${rec.person.frequency.slice(1)} · period ${r.period} of ${r.periods}`}</em></div>
      <div><small>Tax details</small><b>{contractor ? "Not on PAYE" : `${basisLabel} basis · PRSI ${r.prsiClass}${r.prsiWeeks ? ` (${r.prsiWeeks} wk${r.prsiWeeks === 1 ? "" : "s"})` : ""}`}</b><em>{contractor ? "" : `USC ${rec.person.uscStatus}`}</em></div>
    </div>
    <div className="ps-cols">
      <table><thead><tr><th>Earnings</th><th className="r">Amount</th></tr></thead><tbody>
        {rec.earnings.map((l, i) => <tr key={i}><td>{l.label}{l.detail && <small>{l.detail}</small>}</td><td className="r">{m(l.amount)}</td></tr>)}
        <tr className="tot"><td>Gross pay</td><td className="r">{m(r.gross)}</td></tr>
      </tbody></table>
      <table><thead><tr><th>Deductions</th><th className="r">Amount</th></tr></thead><tbody>
        {!contractor && <><tr><td>PAYE income tax{r.payeHigher > 0 && r.payeStandard > 0 ? <small>20%: {m(r.payeStandard)} · 40%: {m(r.payeHigher)}</small> : null}</td><td className="r">{m(r.paye)}</td></tr>
        <tr><td>USC</td><td className="r">{m(r.usc)}</td></tr>
        <tr><td>PRSI (employee, class {r.prsiClass})</td><td className="r">{m(r.prsiEE)}</td></tr>
        {r.pension > 0 && <tr><td>Pension ({rec.person.pensionPct}%)</td><td className="r">{m(r.pension)}</td></tr>}</>}
        {rec.deductions.map((l, i) => <tr key={i}><td>{l.label}</td><td className="r">{m(Math.abs(l.amount))}</td></tr>)}
        <tr className="tot"><td>Total deductions</td><td className="r">{m(r.totalDeductions)}</td></tr>
      </tbody></table>
    </div>
    <div className="ps-net"><div><small>Net pay</small><b>{m(r.net)}</b><em>{rec.person.paymentMethod}</em></div></div>
    {!contractor && <div className="ps-cols ps-small">
      <table><thead><tr><th colSpan={2}>This period</th></tr></thead><tbody>
        <tr><td>Tax credits</td><td className="r">{m(r.taxCredits)}</td></tr>
        <tr><td>Standard rate cut-off point</td><td className="r">{m(r.srcop)}</td></tr>
        <tr><td>Taxable pay</td><td className="r">{m(r.taxable)}</td></tr>
        <tr><td>Employer PRSI (paid by employer)</td><td className="r">{m(r.prsiER)}</td></tr>
      </tbody></table>
      <table><thead><tr><th colSpan={2}>Year to date ({rec.payDate.slice(0, 4)})</th></tr></thead><tbody>
        <tr><td>Gross pay</td><td className="r">{m(r.ytd.gross)}</td></tr>
        <tr><td>PAYE</td><td className="r">{m(r.ytd.paye)}</td></tr>
        <tr><td>USC</td><td className="r">{m(r.ytd.usc)}</td></tr>
        <tr><td>Employee PRSI</td><td className="r">{m(r.ytd.prsi)}</td></tr>
        <tr><td>Net pay</td><td className="r">{m(r.ytd.net)}</td></tr>
      </tbody></table>
    </div>}
    {rec.note && <p className="ps-note">{rec.note}</p>}
    {r.notes.map((n, i) => <p key={i} className="ps-note warn">{n}</p>)}
    <p className="ps-foot">Issued {new Date(rec.issuedAt).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" })} · Earnings from appointment records. {contractor ? "" : `PAYE, USC and PRSI worked out with ${rec.payDate.slice(0, 4)} Irish rates from the tax credits and cut-off point on file. Check them against the employee's Revenue Payroll Notification (RPN) and report each payment to Revenue.`}</p>
  </div>;
}

function printPayslip(rec: PayslipRecord, business: Business, currency: string) {
  const host = document.createElement("div"); host.style.position = "fixed"; host.style.left = "-10000px"; document.body.appendChild(host);
  import("react-dom/client").then(({ createRoot }) => {
    const root = createRoot(host); root.render(<PayslipDoc rec={rec} business={business} currency={currency} />);
    window.setTimeout(() => {
      const html = host.innerHTML; root.unmount(); host.remove();
      const w = window.open("", "_blank", "width=860,height=1100"); if (!w) { void appAlert("Allow pop-ups to print the payslip."); return; }
      w.document.write(`<!doctype html><html><head><title>Payslip ${rec.number} · ${rec.staffName.replace(/[<>]/g, "")}</title><style>${PAYSLIP_PRINT_CSS}</style></head><body>${html}<script>window.onload=()=>{setTimeout(()=>window.print(),250)}<\/script></body></html>`);
      w.document.close();
    }, 60);
  }).catch(() => { host.remove(); });
}

const PAYSLIP_PRINT_CSS = `body{font-family:Inter,Arial,sans-serif;color:#101828;margin:28px;font-size:12px}.ps-doc{max-width:780px;margin:0 auto}.ps-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:2px solid #101828;padding-bottom:12px}.ps-brand{display:flex;gap:12px;align-items:center}.ps-brand img{max-height:56px;max-width:160px;object-fit:contain}.ps-brand b{font-size:15px}.ps-title{text-align:right}.ps-title h1{font-size:22px;margin:0 0 4px}.ps-meta{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}.ps-meta div{border:1px solid #e4e7ec;border-radius:8px;padding:8px}.ps-meta small{display:block;font-size:9.5px;color:#667085;text-transform:uppercase;letter-spacing:.04em}.ps-meta b{display:block;font-size:12px}.ps-meta em{display:block;font-style:normal;color:#667085;font-size:10.5px}.ps-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:6px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eaecf0;vertical-align:top}th{font-size:9.5px;text-transform:uppercase;color:#667085;letter-spacing:.04em}td small{display:block;color:#667085;font-size:10px}.r{text-align:right;white-space:nowrap}tr.tot td{font-weight:700;border-top:1.5px solid #101828}.ps-net{display:flex;justify-content:flex-end;margin:14px 0}.ps-net div{border:2px solid #101828;border-radius:10px;padding:10px 18px;text-align:right}.ps-net small{display:block;font-size:10px;text-transform:uppercase;color:#667085}.ps-net b{font-size:24px}.ps-net em{display:block;font-style:normal;color:#667085;font-size:10.5px}.ps-small td,.ps-small th{font-size:11px}.ps-note{margin:10px 0 0;color:#475467}.ps-note.warn{color:#b54708}.ps-foot{margin-top:20px;font-size:9.5px;color:#98a2b3}`;

function PayrollPersonModal({ person, value, sample, onClose, onSave }: { person?: Staff; value?: PayrollPerson; sample: boolean; onClose: () => void; onSave: (p: PayrollPerson) => Promise<PayrollPerson> }) {
  const [form, setForm] = useState<PayrollPerson>({ ...DEFAULT_PERSON, ...(value || {}) });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof PayrollPerson>(k: K, v: PayrollPerson[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    const pps = normalisePps(form.pps);
    if (form.employment === "employee" && pps && !validPps(pps)) { setMsg("That PPS number isn't valid. It's 7 digits then one or two letters, e.g. 1234567TA."); return; }
    setBusy(true); try { await onSave({ ...form, pps }); onClose(); } catch (e) { setMsg(errText(e, "Couldn't save.")); } setBusy(false);
  };
  return <div className="bt-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="bt ps ps-form" role="dialog" aria-modal="true" aria-label="Payroll details">
    <header className="bt-head"><div><p className="eyebrow">PAYROLL DETAILS <span className="admin-badge">ADMIN</span></p><h2>{firstName(person?.name || "")}</h2><p>Copy the tax credits, cut-off point and USC status from their Revenue Payroll Notification (RPN).</p></div><button type="button" className="bt-x" aria-label="Close" onClick={onClose}>×</button></header>
    <div className="ps-body"><div className="form-grid ps-grid">
      <label>Employment<select value={form.employment} onChange={(e) => set("employment", e.target.value as PayrollPerson["employment"])}><option value="employee">Employee (PAYE)</option><option value="contractor">Self-employed contractor</option></select></label>
      <label>PPS number<input value={form.pps} maxLength={12} autoComplete="off" placeholder="1234567TA" onChange={(e) => set("pps", e.target.value.toUpperCase())} /></label>
      <label>Employee / works no.<input value={form.employeeNo} maxLength={30} onChange={(e) => set("employeeNo", e.target.value)} /></label>
      <label>Pay frequency<select value={form.frequency} onChange={(e) => set("frequency", e.target.value as PayrollPerson["frequency"])}><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option><option value="monthly">Monthly</option></select></label>
      {form.employment === "employee" && <>
        <label>Tax basis<select value={form.basis} onChange={(e) => set("basis", e.target.value as PayrollPerson["basis"])}><option value="cumulative">Cumulative</option><option value="week1">Week 1 / Month 1</option><option value="emergency">Emergency</option></select></label>
        <label>Annual tax credits (€)<input type="number" min={0} step="1" value={form.taxCredits} onChange={(e) => set("taxCredits", Number(e.target.value) || 0)} /></label>
        <label>Annual cut-off point (€)<input type="number" min={0} step="1" value={form.srcop} onChange={(e) => set("srcop", Number(e.target.value) || 0)} /></label>
        <label>USC status<select value={form.uscStatus} onChange={(e) => set("uscStatus", e.target.value as PayrollPerson["uscStatus"])}><option value="ordinary">Ordinary</option><option value="reduced">Reduced (medical card)</option><option value="exempt">Exempt</option></select></label>
        <label>PRSI class<select value={form.prsiClass} onChange={(e) => set("prsiClass", e.target.value as PayrollPerson["prsiClass"])}><option value="A">A (most employees)</option><option value="S">S (proprietary director)</option><option value="M">M (no PRSI)</option></select></label>
        <label>Pension contribution (%)<input type="number" min={0} max={100} step="0.5" value={form.pensionPct} onChange={(e) => set("pensionPct", Number(e.target.value) || 0)} /></label>
      </>}
      <label>Start date<input type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} /></label>
      <label>Payment method<input value={form.paymentMethod} maxLength={60} onChange={(e) => set("paymentMethod", e.target.value)} /></label>
    </div>{sample && <p className="iv-small">Sample data: changes stay on this screen only.</p>}</div>
    <footer className="bt-foot"><span className="bt-status">{msg}</span><span style={{ flex: 1 }} /><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="button" className="primary-button" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button></footer>
  </div></div>;
}

function PayrollEmployerForm({ value, business, onSave }: { value: PayrollEmployer; business: Business; onSave: (v: PayrollEmployer) => Promise<void> }) {
  const [form, setForm] = useState<PayrollEmployer>(value);
  const [msg, setMsg] = useState("");
  const set = (k: keyof PayrollEmployer, v: string) => setForm((f) => ({ ...f, [k]: v }));
  return <div className="ps-employer">
    <div className="ps-brand-preview">{business.logo ? <img src={business.logo} alt="" data-keep-logo="" /> : <span className="dh-muted">No logo</span>}<small>The logo comes from this account's branding.</small></div>
    <div className="form-grid ps-grid">
      <label>Business name on payslips<input value={form.name} placeholder={business.name} maxLength={120} onChange={(e) => set("name", e.target.value)} /></label>
      <label>Employer registration no. (Revenue)<input value={form.employerNo} placeholder="e.g. 1234567FA" maxLength={20} onChange={(e) => set("employerNo", e.target.value.toUpperCase())} /></label>
      <label className="span2">Business address<input value={form.address} maxLength={300} onChange={(e) => set("address", e.target.value)} /></label>
      <label>Phone<input value={form.phone} maxLength={40} onChange={(e) => set("phone", e.target.value)} /></label>
      <label>Email<input type="email" value={form.email} maxLength={120} onChange={(e) => set("email", e.target.value)} /></label>
    </div>
    <div className="ps-actions"><span className="bt-status" role="status">{msg}</span><span style={{ flex: 1 }} /><button type="button" className="primary-button" onClick={async () => { try { await onSave(form); setMsg("Saved."); } catch (e) { setMsg(errText(e, "Couldn't save.")); } }}>Save employer details</button></div>
  </div>;
}
