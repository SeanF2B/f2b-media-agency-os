"use client";

import { useEffect, useState } from "react";
import { CalendarCheck } from "lucide-react";

// "Appointment updates": finished appointments nobody has marked (showed / no-show / cancelled).
// One shared card + list, used on the Dashboard and the Scheduling dashboard.
export function useAppointmentUpdates({ scopeClientId, sample, enabled, onOpenScheduling }: { scopeClientId?: string; sample: boolean; enabled: boolean; onOpenScheduling?: () => void }) {
  // Appointments that have finished but nobody has marked (attended / no-show / cancelled) yet.
  type ApptRow = { id: string; name: string; start: string; end: string; status: "booked" | "cancelled" | "completed" | "no_show"; staffIds: string[]; calendarId: string; phone?: string };
  const [apptRows, setApptRows] = useState<ApptRow[] | null>(null);
  const [apptMeta, setApptMeta] = useState<{ staff: Map<string, string>; calendars: Map<string, string> }>({ staff: new Map(), calendars: new Map() });
  const [apptOpen, setApptOpen] = useState(false);
  const [apptTab, setApptTab] = useState<"todo" | "completed" | "no_show" | "cancelled">("todo");
  const [apptBusy, setApptBusy] = useState("");
  const [apptErr, setApptErr] = useState("");
  const apptCutoff = Date.now() - 15 * 60_000;
  const apptTodo = (apptRows || []).filter((b) => b.status === "booked" && Date.parse(b.end) < apptCutoff).sort((a, b) => a.start.localeCompare(b.start));
  const apptUpdates = apptRows ? { n: apptTodo.length, oldestHours: apptTodo.length ? Math.round((Date.now() - Date.parse(apptTodo[0].end)) / 3_600_000) : 0 } : null;
  useEffect(() => {
    if (!enabled) { setApptRows(null); return; }
    if (sample) { // demo: three to mark plus some history; marking only changes this screen
      const h = (hoursAgo: number, len = 1) => { const e = new Date(Date.now() - hoursAgo * 3_600_000); const st = new Date(e.getTime() - len * 3_600_000); return { start: st.toISOString(), end: e.toISOString() }; };
      setApptRows([
        { id: "s1", name: "Mary Burke", ...h(3), status: "booked", staffIds: [], calendarId: "" },
        { id: "s2", name: "John Doyle", ...h(26), status: "booked", staffIds: [], calendarId: "" },
        { id: "s3", name: "Sinéad Kelly", ...h(30), status: "booked", staffIds: [], calendarId: "" },
        { id: "s4", name: "Tom Walsh", ...h(50), status: "completed", staffIds: [], calendarId: "" },
        { id: "s5", name: "Aoife Ryan", ...h(75), status: "completed", staffIds: [], calendarId: "" },
        { id: "s6", name: "Ciarán Byrne", ...h(98), status: "no_show", staffIds: [], calendarId: "" },
        { id: "s7", name: "Niamh Walsh", ...h(140), status: "cancelled", staffIds: [], calendarId: "" },
      ]);
      return;
    }
    let live = true;
    const from = new Date(Date.now() - 30 * 86_400_000).toISOString(), to = new Date().toISOString();
    fetch(`/api/scheduling?clientId=${encodeURIComponent(scopeClientId || "agency")}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((j: { bookings?: ApptRow[]; staff?: Array<{ id: string; name: string }>; calendars?: Array<{ id: string; name: string }> } | null) => {
        if (!live || !j) return;
        setApptRows((j.bookings || []).filter((b) => Date.parse(b.start) <= Date.now()));
        setApptMeta({ staff: new Map((j.staff || []).map((x) => [x.id, x.name])), calendars: new Map((j.calendars || []).map((x) => [x.id, x.name])) });
      }).catch(() => {});
    return () => { live = false; };
  }, [enabled, sample, scopeClientId]);
  const markAppt = async (id: string, status: "completed" | "no_show" | "cancelled") => {
    setApptErr(""); setApptBusy(id);
    try {
      if (!sample) {
        const r = await fetch(`/api/scheduling?clientId=${encodeURIComponent(scopeClientId || "agency")}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "updateBooking", id, status, notify: false }) });
        if (!r.ok) { const j = await r.json().catch(() => ({})) as { error?: string }; throw new Error(j.error || "Couldn’t update that appointment."); }
      }
      setApptRows((rows) => (rows || []).map((b) => b.id === id ? { ...b, status } : b));
    } catch (e) { setApptErr(e instanceof Error ? e.message : "Couldn’t update that appointment."); }
    finally { setApptBusy(""); }
  };
  const card = (onToggle?: () => void) => {
    if (!enabled || !apptUpdates) return null;

        // amber as they build up, red when there are 5+ or one has waited over 2 days
        const t = !apptUpdates.n ? "clear" : apptUpdates.n >= 5 || apptUpdates.oldestHours >= 48 ? "overload" : "waiting";
        return <button type="button" className={`dh-approval dh-appt-updates ${t} ${apptOpen ? "open" : ""}`} aria-expanded={apptOpen} onClick={() => { setApptOpen(!apptOpen); setApptTab("todo"); onToggle?.(); }} title="Mark finished appointments as showed, no-show or cancelled">
          <span className="dh-approval-icon"><CalendarCheck size={18} /></span>
          <span className="dh-approval-text"><b>Appointment updates</b><small>{!apptUpdates.n ? "All appointments marked" : t === "overload" ? `${apptUpdates.n} to mark — ${apptUpdates.oldestHours >= 48 ? `oldest ${Math.floor(apptUpdates.oldestHours / 24)} days ago` : "catch up"}` : `${apptUpdates.n} finished, not marked yet`}</small></span>
          <span className="dh-approval-n">{apptUpdates.n || "✓"}</span></button>;
        };
  const list = !(apptOpen && apptRows) ? null : (() => {
      const lists = { todo: apptTodo, completed: apptRows.filter((b) => b.status === "completed"), no_show: apptRows.filter((b) => b.status === "no_show"), cancelled: apptRows.filter((b) => b.status === "cancelled") };
      const rows = apptTab === "todo" ? lists.todo : [...lists[apptTab]].sort((a, b) => b.start.localeCompare(a.start));
      const done = lists.completed.length + lists.no_show.length;
      const when = (iso: string) => new Date(iso).toLocaleString("en-IE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      const who = (b: ApptRow) => [b.staffIds.map((id) => apptMeta.staff.get(id)).filter(Boolean).join(", "), apptMeta.calendars.get(b.calendarId)].filter(Boolean).join(" · ");
      return <section className="dh-appr-list dh-appt-list" aria-label="Appointment updates">
        <div className="dh-appr-list-head"><b>Appointments · last 30 days</b><button type="button" className="text-button" onClick={() => setApptOpen(false)}>Close</button></div>
        <div className="dh-appt-stats"><span><b>{done ? Math.round((lists.completed.length / done) * 100) : 0}%</b> show-up rate</span><span><b>{lists.completed.length}</b> showed</span><span><b>{lists.no_show.length}</b> no-shows</span><span><b>{lists.cancelled.length}</b> cancelled</span></div>
        <div className="dh-appt-tabs" role="tablist">{([["todo", "To mark"], ["completed", "Showed"], ["no_show", "No-shows"], ["cancelled", "Cancelled"]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={apptTab === k} className={apptTab === k ? "on" : ""} onClick={() => setApptTab(k)}>{l} <i>{lists[k].length}</i></button>)}</div>
        {apptErr && <p className="dh-appt-err" role="alert">{apptErr}</p>}
        {rows.length ? rows.slice(0, 40).map((b) => <div key={b.id} className={`dh-appr-item dh-appt-row ${b.status}`}><span className="dh-appr-dot" /><span className="dh-appr-main"><b>{b.name || "Appointment"}</b><small>{when(b.start)}{who(b) ? ` · ${who(b)}` : ""}</small></span>
          <span className="dh-appr-acts">{b.status === "booked" ? <>
            <button type="button" className="dh-appr-ok" disabled={apptBusy === b.id} onClick={() => void markAppt(b.id, "completed")}>Showed</button>
            <button type="button" className="dh-appr-no" disabled={apptBusy === b.id} onClick={() => void markAppt(b.id, "no_show")}>No-show</button>
            <button type="button" className="dh-appr-open" disabled={apptBusy === b.id} onClick={() => void markAppt(b.id, "cancelled")}>Cancelled</button>
          </> : <span className={`dh-appt-badge ${b.status}`}>{b.status === "completed" ? "Showed" : b.status === "no_show" ? "No-show" : "Cancelled"}</span>}</span></div>)
          : <p className="dh-muted">{apptTab === "todo" ? "Everything’s marked. Nice one." : "None in the last 30 days."}</p>}
        <div className="dh-appt-foot">{onOpenScheduling && <button type="button" className="text-button" onClick={onOpenScheduling}>Open Scheduling →</button>}{sample && <small>Sample data — marking here doesn’t save.</small>}</div>
      </section>;
    })();
  return { card, list, open: apptOpen, setOpen: setApptOpen };
}
