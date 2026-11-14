"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";

// Monday-style table view of tasks: grouped by client, coloured status and priority labels, inline edits.
type TableTask = { id: string; clientId: string; title: string; assigneeId: string; status: string; priority: string; service: string; estimate: number; due?: string; completedAt?: string };
type TableClient = { id: string; name: string; color?: string; logo?: string };
type TableStaff = { id: string; name: string; isBot?: boolean };

const STATUS_COLOURS: Record<string, string> = { "To do": "#8a94a6", "In progress": "#f2a531", Blocked: "#8c6cf2", Done: "#2fb36d" };
const PRIORITY_COLOURS: Record<string, string> = { Urgent: "#e5484d", High: "#f0703a", Normal: "#4d8ef7", Low: "#9aa5b1" };
const PRIORITIES = ["Urgent", "High", "Normal", "Low"];

export function TaskTable({ tasks, clients, staff, statuses, onStatus, onEdit, onChangeDate, renderAvatar }: {
  tasks: TableTask[]; clients: TableClient[]; staff: TableStaff[];
  statuses: Array<{ label: string; value: string }>;
  onStatus: (id: string, status: string) => void; onEdit: (id: string) => void; onChangeDate: (id: string, due: string) => void;
  renderAvatar: (staffId: string) => ReactNode;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<"due" | "priority" | "status" | "title">("due");
  const [hideDone, setHideDone] = useState(true);
  const clientById = useMemo(() => new Map(clients.map((client) => [client.id, client])), [clients]);
  const staffById = useMemo(() => new Map(staff.map((member) => [member.id, member])), [staff]);
  const statusLabel = (value: string) => statuses.find((item) => item.value === value)?.label || value;
  const today = new Date().toISOString().slice(0, 10);
  const groups = useMemo(() => {
    const visible = tasks.filter((task) => !hideDone || task.status !== "Done");
    const map = new Map<string, TableTask[]>();
    for (const task of visible) map.set(task.clientId || "", [...(map.get(task.clientId || "") || []), task]);
    const rank = (task: TableTask) => sort === "priority" ? PRIORITIES.indexOf(task.priority) : sort === "status" ? statuses.findIndex((item) => item.value === task.status) : 0;
    const cmp = (a: TableTask, b: TableTask) => sort === "title" ? a.title.localeCompare(b.title) : sort === "due" ? (a.due || "9999").localeCompare(b.due || "9999") : rank(a) - rank(b) || (a.due || "9999").localeCompare(b.due || "9999");
    return [...map.entries()].map(([clientId, list]) => ({ clientId, name: clientById.get(clientId)?.name || "Internal / no client", colour: clientById.get(clientId)?.color || "#7c8a96", list: list.sort(cmp) })).sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks, hideDone, sort, clientById, statuses]);
  const toggle = (id: string) => setCollapsed((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const sortButton = (key: typeof sort, label: string) => <button type="button" className={`tt-sort ${sort === key ? "active" : ""}`} onClick={() => setSort(key)}>{label}{sort === key ? " ↓" : ""}</button>;

  return <section className="task-table-view" aria-label="Task table">
    <div className="tt-toolbar">
      <span className="tt-count">{groups.reduce((n, group) => n + group.list.length, 0)} tasks · {groups.length} groups</span>
      <label className="tt-toggle"><input type="checkbox" checked={hideDone} onChange={(event) => setHideDone(event.target.checked)} /> Hide done</label>
      <button type="button" className="text-button" onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(groups.map((group) => group.clientId)))}>{collapsed.size ? "Expand all" : "Collapse all"}</button>
    </div>
    <div className="tt-wrap"><table className="tt-table">
      <thead><tr><th className="tt-title-col">{sortButton("title", "Task")}</th><th>Owner</th><th>{sortButton("status", "Status")}</th><th>{sortButton("priority", "Priority")}</th><th>{sortButton("due", "Due")}</th><th>Service</th><th className="num">Estimate</th></tr></thead>
      <tbody>{groups.map((group) => <Fragment key={group.clientId || "none"}>
        <tr className="tt-group" style={{ ["--tt-group" as string]: group.colour }}><td colSpan={7}><button type="button" className="tt-group-toggle" aria-expanded={!collapsed.has(group.clientId)} onClick={() => toggle(group.clientId)}><span className="tt-caret" aria-hidden="true">{collapsed.has(group.clientId) ? "▸" : "▾"}</span><b>{group.name}</b><span className="tt-group-meta">{group.list.length} task{group.list.length === 1 ? "" : "s"} · {group.list.filter((task) => task.status === "Done").length} done</span></button>
          <span className="tt-group-bar" aria-hidden="true">{statuses.map((item) => { const n = group.list.filter((task) => task.status === item.value).length; return n ? <i key={item.value} title={`${item.label}: ${n}`} style={{ flex: n, background: STATUS_COLOURS[item.value] || "#999" }} /> : null; })}</span></td></tr>
        {!collapsed.has(group.clientId) && group.list.map((task) => { const owner = staffById.get(task.assigneeId); const overdue = task.due && task.due < today && task.status !== "Done"; return <tr key={task.id} className="tt-row" style={{ ["--tt-group" as string]: group.colour }}>
          <td className="tt-title-col"><button type="button" className="tt-title" onClick={() => onEdit(task.id)} title="Open task">{task.title}</button></td>
          <td><span className="tt-owner">{renderAvatar(task.assigneeId)}<span>{owner?.name?.split("|")[0].trim() || "Unassigned"}</span></span></td>
          <td className="tt-pill-cell"><select className="tt-pill" aria-label={`Status of ${task.title}`} value={task.status} style={{ background: STATUS_COLOURS[task.status] || "#8a94a6" }} onChange={(event) => onStatus(task.id, event.target.value)}>{statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}{!statuses.some((item) => item.value === task.status) && <option value={task.status}>{statusLabel(task.status)}</option>}</select></td>
          <td className="tt-pill-cell"><span className="tt-pill tt-pill-static" style={{ background: PRIORITY_COLOURS[task.priority] || "#9aa5b1" }}>{task.priority || "Normal"}</span></td>
          <td><input type="date" className={`tt-date ${overdue ? "overdue" : ""}`} aria-label={`Due date for ${task.title}`} value={task.due || ""} onChange={(event) => onChangeDate(task.id, event.target.value)} /></td>
          <td><span className="tt-service">{task.service || "—"}</span></td>
          <td className="num">{task.estimate ? `${task.estimate}h` : "—"}</td>
        </tr>; })}
      </Fragment>)}</tbody>
    </table></div>
    {!groups.length && <p className="tt-empty">No tasks to show{hideDone ? " (done tasks are hidden)" : ""}.</p>}
  </section>;
}
