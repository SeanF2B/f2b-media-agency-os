"use client";

import { appAlert, appConfirm, appPrompt } from "./app-dialog";
import { Fragment, useMemo, useState, type ReactNode } from "react";
import { BarChart3, LifeBuoy, CircleCheck, FileText, Globe, Mail, Megaphone, MapPin, PenLine, Phone, Search, Settings, Share2, Users, Wrench, type LucideIcon } from "lucide-react";

// A small icon per task, picked from its service (or the title when no service is set).
const TASK_ICON_RULES: Array<[RegExp, LucideIcon, string]> = [
  [/support|ticket|🎫/i, LifeBuoy, "#d92d20"],
  [/google ads|ppc|meta ads|facebook ads|\bads?\b|campaign/i, Megaphone, "#e8590c"], [/seo|keyword|rank|backlink|search console/i, Search, "#2f9e44"],
  [/crm|lead|pipeline|contact/i, Users, "#7048e8"], [/web|site|domain|wordpress|dns|landing/i, Globe, "#1c7ed6"],
  [/email|newsletter|mail/i, Mail, "#0c8599"], [/social|instagram|tiktok|linkedin|post/i, Share2, "#d6336c"],
  [/content|copy|blog|article|write/i, PenLine, "#5f3dc4"], [/report|analytics|ga4|audit/i, BarChart3, "#1971c2"],
  [/business profile|gbp|review|local|maps/i, MapPin, "#c92a2a"], [/call|phone|whatsapp/i, Phone, "#2b8a3e"],
  [/setup|onboard|connect|integrat|config/i, Settings, "#495057"], [/fix|repair|bug|maint/i, Wrench, "#868e96"], [/invoice|document|contract/i, FileText, "#495057"],
];
function TaskIcon({ service, title }: { service?: string; title: string }) {
  const hit = TASK_ICON_RULES.find(([pattern]) => pattern.test(service || "")) || TASK_ICON_RULES.find(([pattern]) => pattern.test(title));
  const [, Icon, colour] = hit || [null, CircleCheck, "#868e96"];
  return <span className="tt-task-icon" style={{ color: colour, background: `${colour}14` }} aria-hidden="true"><Icon size={14} strokeWidth={2} /></span>;
}

// Monday-style table view of tasks: grouped by client, coloured labels, inline edits, multi-select and bulk actions.
// Every change goes through the same handlers as the board, so the board updates live.
type TableTask = { id: string; clientId: string; title: string; assigneeId: string; status: string; priority: string; service: string; estimate: number; due?: string; repeat?: string; aiRunAt?: string; paused?: boolean };
type TableClient = { id: string; name: string; color?: string ; logo?: string };
type TableStaff = { id: string; name: string; isBot?: boolean };
export type TaskPatch = { status?: string; priority?: string; assigneeId?: string; due?: string };

const STATUS_COLOURS: Record<string, string> = { "To do": "#7f8aa0", "In progress": "#f0a431", Blocked: "#8c6cf2", Done: "#2fb36d", Cancelled: "#a0a7b0" };
const PRIORITY_COLOURS: Record<string, string> = { Urgent: "#e5484d", High: "#f0703a", Normal: "#4d8ef7", Low: "#9aa5b1" };
const PRIORITIES = ["Urgent", "High", "Normal", "Low"];
const shortDate = (iso?: string) => iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString("en-IE", { day: "numeric", month: "short" }) : "";

export function TaskTable({ onQuickAdd, tasks, clients, staff, statuses, onStatus, onEdit, onChangeDate, onBulkUpdate, onBulkDelete, renderAvatar }: {
  tasks: TableTask[]; clients: TableClient[]; staff: TableStaff[];
  statuses: Array<{ label: string; value: string }>;
  onStatus: (id: string, status: string) => void; onEdit: (id: string) => void; onChangeDate: (id: string, due: string) => void;
  onBulkUpdate?: (ids: string[], patch: TaskPatch) => void; onBulkDelete?: (ids: string[]) => void;
  renderAvatar: (staffId: string) => ReactNode; onQuickAdd?: (clientId: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<"due" | "priority" | "status" | "title">("due");
  const [view, setView] = useState<"open" | "scheduled" | "overdue" | "all">("open");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const clientById = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);
  const staffById = useMemo(() => new Map(staff.map((member) => [member.id, member])), [staff]);
  const people = useMemo(() => staff.filter((member) => !member.isBot), [staff]);
  const today = new Date().toISOString().slice(0, 10);
  const isScheduled = (task: TableTask) => (task.repeat && task.repeat !== "None") || Boolean(task.aiRunAt) || Boolean(task.due && task.due > today && task.status === "To do");
  const isOpen = (task: TableTask) => task.status !== "Done" && task.status !== "Cancelled";
  const filtered = useMemo(() => tasks.filter((task) => view === "all" ? true : view === "open" ? isOpen(task) : view === "overdue" ? isOpen(task) && Boolean(task.due && task.due < today) : isOpen(task) && isScheduled(task)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, view, today]);
  const groups = useMemo(() => {
    const map = new Map<string, TableTask[]>();
    for (const task of filtered) map.set(task.clientId || "", [...(map.get(task.clientId || "") || []), task]);
    const rank = (task: TableTask) => sort === "priority" ? PRIORITIES.indexOf(task.priority) : sort === "status" ? statuses.findIndex((item) => item.value === task.status) : 0;
    const cmp = (a: TableTask, b: TableTask) => sort === "title" ? a.title.localeCompare(b.title) : sort === "due" ? (a.due || "9999").localeCompare(b.due || "9999") : rank(a) - rank(b) || (a.due || "9999").localeCompare(b.due || "9999");
    return [...map.entries()].map(([clientId, list]) => ({ clientId, name: clientById.get(clientId)?.name || "Internal", colour: clientById.get(clientId)?.color || "#7c8a96", logo: clientById.get(clientId)?.logo || "", list: list.sort(cmp) })).sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered, sort, clientById, statuses]);
  const visibleIds = groups.flatMap((group) => group.list.map((task) => task.id));
  const pickedIds = visibleIds.filter((id) => picked.has(id));
  const togglePick = (ids: string[], on: boolean) => setPicked((current) => { const next = new Set(current); ids.forEach((id) => on ? next.add(id) : next.delete(id)); return next; });
  const toggleGroup = (id: string) => setCollapsed((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const bulk = (patch: TaskPatch) => { if (!pickedIds.length) return; if (onBulkUpdate) onBulkUpdate(pickedIds, patch); else if (patch.status) pickedIds.forEach((id) => onStatus(id, patch.status!)); setPicked(new Set()); };
  const sortButton = (key: typeof sort, label: string) => <button type="button" className={`tt-sort ${sort === key ? "active" : ""}`} onClick={() => setSort(key)}>{label}{sort === key ? " ↓" : ""}</button>;
  const counts = { open: tasks.filter(isOpen).length, scheduled: tasks.filter((task) => isOpen(task) && isScheduled(task)).length, overdue: tasks.filter((task) => isOpen(task) && Boolean(task.due && task.due < today)).length, all: tasks.length };

  return <section className="task-table-view" aria-label="Task table">
    <div className="tt-toolbar">
      <div className="tt-views" role="tablist" aria-label="Table views">{([["open", "Open"], ["scheduled", "Scheduled & recurring"], ["overdue", "Overdue"], ["all", "All"]] as const).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={view === key} className={view === key ? "active" : ""} onClick={() => { setView(key); setPicked(new Set()); }}>{label}<span>{counts[key]}</span></button>)}</div>
      <button type="button" className="text-button tt-collapse" onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(groups.map((group) => group.clientId)))}>{collapsed.size ? "Expand all" : "Collapse all"}</button>
    </div>
    {pickedIds.length > 0 && <div className="tt-bulk" role="toolbar" aria-label="Bulk actions">
      <b>{pickedIds.length} selected</b>
      <label>Status<select value="" onChange={(event) => event.target.value && bulk({ status: event.target.value })}><option value="">Change…</option>{statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      {onBulkUpdate && <label>Priority<select value="" onChange={(event) => event.target.value && bulk({ priority: event.target.value })}><option value="">Change…</option>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>}
      {onBulkUpdate && <label>Owner<select value="" onChange={(event) => event.target.value && bulk({ assigneeId: event.target.value === "__none" ? "" : event.target.value })}><option value="">Change…</option>{people.map((member) => <option key={member.id} value={member.id}>{member.name.split("|")[0].trim()}</option>)}<option value="__none">Unassigned</option></select></label>}
      {onBulkUpdate && <label>Due<input type="date" onChange={(event) => event.target.value && bulk({ due: event.target.value })} /></label>}
      {onBulkDelete && <button type="button" className="tt-bulk-delete" onClick={async () => { if ((await appConfirm(`Delete ${pickedIds.length} task${pickedIds.length === 1 ? "" : "s"}? This can't be undone.`))) { onBulkDelete(pickedIds); setPicked(new Set()); } }}>Delete</button>}
      <button type="button" className="text-button" onClick={() => setPicked(new Set())}>Clear</button>
    </div>}
    <div className="tt-wrap"><table className="tt-table">
      <colgroup><col className="tt-c-check" /><col /><col className="tt-c-owner" /><col className="tt-c-pill" /><col className="tt-c-pill" /><col className="tt-c-date" /><col className="tt-c-repeat" /><col className="tt-c-service" /><col className="tt-c-est" /></colgroup>
      <thead><tr><th><input type="checkbox" aria-label="Select all shown" checked={visibleIds.length > 0 && pickedIds.length === visibleIds.length} onChange={(event) => togglePick(visibleIds, event.target.checked)} /></th><th>{sortButton("title", "Task")}</th><th>Owner</th><th>{sortButton("status", "Status")}</th><th>{sortButton("priority", "Priority")}</th><th>{sortButton("due", "Due")}</th><th>Repeats</th><th>Service</th><th className="num">Est.</th></tr></thead>
      <tbody>{groups.map((group) => { const ids = group.list.map((task) => task.id); const open = !collapsed.has(group.clientId); return <Fragment key={group.clientId || "none"}>
        <tr className="tt-group" style={{ ["--tt-group" as string]: group.colour }}>
          <td><input type="checkbox" aria-label={`Select all in ${group.name}`} checked={ids.every((id) => picked.has(id))} onChange={(event) => togglePick(ids, event.target.checked)} /></td>
          <td colSpan={8}><div className="tt-group-line"><button type="button" className="tt-group-toggle" aria-expanded={open} onClick={() => toggleGroup(group.clientId)}><span className="tt-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>{group.logo ? <span className="tt-logo" aria-hidden="true"><img src={group.logo} alt="" /></span> : <span className="tt-chip" aria-hidden="true" />}<b>{group.name}</b></button><span className="tt-group-meta">{group.list.length} task{group.list.length === 1 ? "" : "s"}</span>{onQuickAdd && <button type="button" className="tt-quick-add" title={`Add a task for ${group.name}`} aria-label={`Add a task for ${group.name}`} onClick={() => onQuickAdd(group.clientId)}>＋</button>}{(() => { const total = group.list.length || 1; const R = 9, C = 2 * Math.PI * R; let offset = 0; const parts = statuses.map((item) => ({ item, n: group.list.filter((task) => task.status === item.value).length })).filter((p) => p.n); return <span className="tt-group-ring" title={parts.map((p) => `${p.item.label}: ${p.n}`).join(" · ")}><svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="12" cy="12" r={R} fill="none" stroke="rgba(127,138,160,.2)" strokeWidth="4" />{parts.map((p) => { const len = p.n / total * C; const el = <circle key={p.item.value} cx="12" cy="12" r={R} fill="none" stroke={STATUS_COLOURS[p.item.value] || "#999"} strokeWidth="4" strokeDasharray={`${len} ${C}`} strokeDashoffset={-offset} transform="rotate(-90 12 12)" />; offset += len; return el; })}</svg><small>{parts.map((p) => <i key={p.item.value} style={{ background: STATUS_COLOURS[p.item.value] || "#999" }} title={p.item.label}>{p.n}</i>)}</small></span>; })()}</div></td>
        </tr>
        {open && group.list.map((task) => { const owner = staffById.get(task.assigneeId); const overdue = Boolean(task.due && task.due < today && isOpen(task)); return <tr key={task.id} className={`tt-row ${picked.has(task.id) ? "picked" : ""}`} style={{ ["--tt-group" as string]: group.colour }}>
          <td className="tt-check"><input type="checkbox" aria-label={`Select ${task.title}`} checked={picked.has(task.id)} onChange={(event) => togglePick([task.id], event.target.checked)} /></td>
          <td><span className="tt-title-wrap"><TaskIcon service={task.service} title={task.title} /><button type="button" className="tt-title" onClick={() => onEdit(task.id)} title={task.title}>{task.title}</button></span></td>
          <td><span className="tt-owner">{renderAvatar(task.assigneeId)}<span>{owner?.name?.split("|")[0].trim() || "Unassigned"}</span></span></td>
          <td><select className="tt-pill" aria-label={`Status of ${task.title}`} value={task.status} style={{ background: STATUS_COLOURS[task.status] || "#8a94a6" }} onChange={(event) => onStatus(task.id, event.target.value)}>{statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}{!statuses.some((item) => item.value === task.status) && <option value={task.status}>{task.status}</option>}</select></td>
          <td>{onBulkUpdate ? <select className="tt-pill" aria-label={`Priority of ${task.title}`} value={task.priority || "Normal"} style={{ background: PRIORITY_COLOURS[task.priority] || "#9aa5b1" }} onChange={(event) => onBulkUpdate([task.id], { priority: event.target.value })}>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select> : <span className="tt-pill" style={{ background: PRIORITY_COLOURS[task.priority] || "#9aa5b1" }}>{task.priority || "Normal"}</span>}</td>
          <td><label className={`tt-date ${overdue ? "overdue" : ""} ${task.due ? "" : "empty"}`}><span>{task.due ? shortDate(task.due) : "Set date"}</span><input type="date" aria-label={`Due date for ${task.title}`} value={task.due?.slice(0, 10) || ""} onClick={(event) => { try { (event.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* picker unavailable */ } }} onChange={(event) => onChangeDate(task.id, event.target.value)} /></label></td>
          <td>{task.repeat && task.repeat !== "None" ? <span className="tt-repeat">↻ {task.repeat}{task.paused ? " · paused" : ""}</span> : task.aiRunAt ? <span className="tt-repeat">⏱ {shortDate(task.aiRunAt)}</span> : <span className="tt-muted">—</span>}</td>
          <td><span className="tt-service">{task.service || "—"}</span></td>
          <td className="num">{task.estimate ? `${task.estimate}h` : <span className="tt-muted">—</span>}</td>
        </tr>; })}
      </Fragment>; })}</tbody>
    </table></div>
    {!groups.length && <p className="tt-empty">{view === "scheduled" ? "Nothing scheduled or recurring." : view === "overdue" ? "Nothing overdue." : "No tasks to show."}</p>}
  </section>;
}
