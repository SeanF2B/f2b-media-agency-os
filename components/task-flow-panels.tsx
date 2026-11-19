"use client";
/**
 * Task flow screens: the Approvals queue and History, plus the small schedule /
 * approval strip shown on board cards. All rules live in lib/task-flow.ts.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./task-flow.css";
import {
  OWNER_APPROVER_EMAIL, boardColumn, frequencyLabel, historyItems, needsOwnerDecision, requestTextFromTask, scheduleLabel,
  type FlowAttachment, type FlowTask,
} from "@/lib/task-flow";

type FlowClient = { id: string; name: string; logo?: string; color?: string };
type FlowStaff = { id: string; name: string; isBot?: boolean };
type PanelTask = FlowTask & { title: string; service?: string; priority?: string; aiFeedback?: string; aiInstructions?: string; notes?: string; aiApprovals?: Array<{ id?: string; status: string; title?: string; rationale?: string }> };

const fileUrl = (taskId: string, file: FlowAttachment, preview = false) => `/api/tasks/files?taskId=${encodeURIComponent(taskId)}&id=${encodeURIComponent(file.id)}${preview ? "&preview=1" : ""}`;
const when = (iso?: string) => iso ? new Date(iso).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" }) : "";
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "•";

function ClientMark({ client }: { client?: FlowClient }) {
  return <span className={`tf-client ${client?.logo ? "has-logo" : ""}`} style={{ background: client?.logo ? undefined : client?.color || "#3a393d" }} title={client?.name || "Internal"}>
    {client?.logo ? <img src={client.logo} alt="" /> : initials(client?.name || "Internal")}
  </span>;
}

function Files({ task }: { task: PanelTask }) {
  const files = task.attachments || [];
  if (!files.length) return <p className="tf-muted">No files attached.</p>;
  return <ul className="tf-files">{files.map((file) => <li key={file.id}>
    {file.type.startsWith("image/")
      ? <a href={fileUrl(task.id, file, true)} target="_blank" rel="noreferrer" className="tf-file-thumb"><img src={fileUrl(task.id, file, true)} alt={file.name} loading="lazy" /></a>
      : <span className="tf-file-icon" aria-hidden="true">{/pdf/.test(file.type) ? "📄" : /html/.test(file.type) ? "📊" : "📎"}</span>}
    <span className="tf-file-name">{file.name}<small>{(file.size / 1024).toFixed(0)} KB · {file.uploadedBy}</small></span>
    <a className="tf-icon-btn" href={fileUrl(task.id, file, true)} target="_blank" rel="noreferrer" title="Open">👁</a>
    <a className="tf-icon-btn" href={fileUrl(task.id, file)} title="Download">⬇</a>
  </li>)}</ul>;
}

/** Small strip on a board card: date + frequency in To do, reason + approval state in Pending. */
export function TaskFlowCardMeta({ task, botIds }: { task: PanelTask; botIds: ReadonlySet<string> }) {
  const column = boardColumn(task, botIds);
  if (column === "todo") return <div className="tf-card-meta is-todo" title="Scheduled">
    <span>📅 {scheduleLabel(task)}</span><span>🔁 {frequencyLabel(task)}</span>
  </div>;
  if (column === "pending" && task.approvalRequest?.status === "awaiting") {
    const mail = task.approvalRequest.emailStatus;
    return <div className="tf-card-meta is-pending">
      <span>📨 Awaiting approval · {mail === "sent" ? "emailed" : mail === "failed" ? "email failed — open Approvals" : mail === "skipped" ? "in Approvals" : "sending to"} {OWNER_APPROVER_EMAIL}</span>
    </div>;
  }
  if (column === "in_progress" && task.approvalGrantedAt) return <div className="tf-card-meta is-approved"><span>✅ Approved — the AI is finishing it</span></div>;
  return null;
}

/** Plain-English, short version of an agent's request/reason (drops "Stopped:", "Waiting for X's approval (in Approvals):" etc.). */
function tidy(text = "") {
  return text
    .replace(/^\s*(stopped|blocked|paused)\s*[:\-–]\s*/i, "")
    .replace(/^\s*waiting (for|on) [^:(]*?approval\s*(\([^)]*\))?\s*[:\-–]?\s*/i, "")
    .replace(/^\s*(needs?|awaiting) (your |owner )?(approval|sign-?off)\s*[:\-–]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}
function shorten(text: string, max = 120) {
  const first = text.split(/(?<=[.!?])\s/)[0] || text;
  const base = first.length >= 40 ? first : text;
  return base.length > max ? `${base.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : base;
}
function ago(iso?: string) {
  const t = Date.parse(iso || ""); if (!t) return "";
  const m = Math.max(1, Math.round((Date.now() - t) / 60000));
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : m < 10080 ? `${Math.round(m / 1440)}d ago` : new Date(t).toLocaleDateString("en-IE", { day: "numeric", month: "short" });
}
const fileKind = (file: FlowAttachment) => file.type.startsWith("image/") ? "image" : /pdf/.test(file.type) ? "PDF" : /html/.test(file.type) ? "Report" : /zip/.test(file.type) || /\.zip$/i.test(file.name) ? "ZIP" : (file.name.split(".").pop() || "File").toUpperCase().slice(0, 4);

function Thumb({ task, client }: { task: PanelTask; client?: FlowClient }) {
  const files = task.attachments || [];
  const image = files.find((file) => file.type.startsWith("image/"));
  const other = files.find((file) => !file.type.startsWith("image/"));
  return <div className="tfa-thumb">
    {image ? <img src={fileUrl(task.id, image, true)} alt="" loading="lazy" />
      : other ? <span className="tfa-doc"><b>{fileKind(other)}</b><small>{other.name}</small></span>
      : <span className="tfa-blank">{client?.logo ? <img src={client.logo} alt="" /> : <b>{initials(client?.name || "F2B")}</b>}</span>}
    {files.length > 1 && <span className="tfa-count">+{files.length - 1}</span>}
  </div>;
}

export function TaskApprovalsPanel({ tasks, clients, staff, canDecide, busyTaskId, onApprove, onReject, onOpenTask, renderAvatar }: {
  tasks: PanelTask[];
  clients: FlowClient[];
  staff: FlowStaff[];
  canDecide: boolean;
  busyTaskId?: string;
  onApprove: (taskId: string, editedRequest: string, note: string) => void | Promise<unknown>;
  onReject: (taskId: string, note: string) => void | Promise<unknown>;
  onOpenTask?: (taskId: string) => void;
  renderAvatar?: (staffId: string) => ReactNode;
}) {
  const queue = useMemo(() => tasks.filter(needsOwnerDecision).sort((a, b) => (Date.parse(b.approvalRequest?.requestedAt || "") || 0) - (Date.parse(a.approvalRequest?.requestedAt || "") || 0)), [tasks]);
  const [openId, setOpenId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!openId) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpenId(""); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);
  if (!queue.length) return <section className="tf-panel tf-empty"><b>Nothing waiting for you.</b><p>When an AI or teammate needs a yes from you, it shows up here.</p></section>;

  const meta = (task: PanelTask) => {
    const request = task.approvalRequest!;
    const client = clients.find((item) => item.id === task.clientId);
    const assignee = staff.find((item) => item.id === task.assigneeId);
    // Older requests may only hold a status line; prefer the agent's actual draft when it posted one.
    const agentDraft = requestTextFromTask(task);
    const original = agentDraft && !request.request.includes(agentDraft.slice(0, 60)) ? agentDraft : request.request;
    // Don't repeat the title in the one-line summary.
    const stripTitle = (text: string) => { const t = task.title.trim(); return t && text.toLowerCase().startsWith(t.toLowerCase()) ? text.slice(t.length).replace(/^[\s:.\-–·>]+/, "") : text; };
    const summary = shorten(stripTitle(tidy(original)) || stripTitle(tidy(request.reason)) || "Needs your OK");
    const reason = tidy(request.reason);
    return { request, client, assignee, original, summary, reason };
  };
  const open = queue.find((task) => task.id === openId);
  const host = typeof document !== "undefined" ? (document.querySelector(".app-shell") || document.body) : null;

  const modal = open && (() => {
    const { request, client, assignee, original, reason } = meta(open);
    const draft = drafts[open.id] ?? tidy(original);
    const busy = busyTaskId === open.id;
    const edited = draft.trim() !== tidy(original).trim();
    const files = open.attachments || [];
    const adsChanges = (open.aiApprovals || []).filter((item) => item.status === "pending");
    const showReason = reason && !tidy(original).toLowerCase().includes(reason.toLowerCase().slice(0, 40)) && reason.toLowerCase() !== open.title.toLowerCase();
    return <div className="tfa-backdrop" role="dialog" aria-modal="true" aria-label={open.title} onMouseDown={(event) => { if (event.target === event.currentTarget) setOpenId(""); }}>
      <div className="tfa-modal">
        <header><ClientMark client={client} /><div className="tf-title"><b>{open.title}</b><small>{client?.name || "F2B Media"} · {assignee?.name || "Unassigned"}{open.service ? ` · ${open.service}` : ""} · {when(request.requestedAt)}</small></div><button type="button" className="tfa-x" aria-label="Close" onClick={() => setOpenId("")}>✕</button></header>
        {files.length > 0 && <div className="tfa-files">{files.map((file) => file.type.startsWith("image/")
          ? <a key={file.id} className="tfa-file is-image" href={fileUrl(open.id, file, true)} target="_blank" rel="noreferrer" title={file.name}><img src={fileUrl(open.id, file, true)} alt={file.name} loading="lazy" /></a>
          : <a key={file.id} className="tfa-file" href={fileUrl(open.id, file, true)} target="_blank" rel="noreferrer" title={`Open ${file.name}`}><b>{fileKind(file)}</b><small>{file.name}</small></a>)}</div>}
        <section className="tfa-ask">
          <div className="tfa-label"><span>What needs your OK</span>{canDecide && !editing && <button type="button" className="tf-link" onClick={() => setEditing(true)}>Edit</button>}</div>
          {editing ? <textarea rows={Math.min(12, Math.max(4, draft.split("\n").length + 1))} value={draft} disabled={!canDecide || busy} onChange={(event) => setDrafts((current) => ({ ...current, [open.id]: event.target.value }))} autoFocus />
            : <p className="tfa-text">{draft}</p>}
          {showReason && <p className="tfa-reason">{shorten(reason, 160)}</p>}
          {adsChanges.length > 0 && <p className="tfa-reason">Approving also applies: {adsChanges.map((item) => item.title).filter(Boolean).join(" · ")}</p>}
        </section>
        {canDecide && <input className="tfa-note" value={notes[open.id] || ""} disabled={busy} placeholder={`Note to ${assignee?.isBot ? "the AI" : assignee?.name?.split(" ")[0] || "them"} (optional)`} onChange={(event) => setNotes((current) => ({ ...current, [open.id]: event.target.value }))} />}
        <footer>
          {onOpenTask ? <button type="button" className="tf-link" onClick={() => { setOpenId(""); onOpenTask(open.id); }}>Open task</button> : <span />}
          {canDecide ? <div className="tf-actions">
            <button type="button" className="secondary-button tf-reject" disabled={busy} onClick={async () => { await onReject(open.id, notes[open.id] || ""); setOpenId(""); }}>Reject</button>
            <button type="button" className="primary-button" disabled={busy || !draft.trim()} onClick={async () => { await onApprove(open.id, edited ? draft : original, notes[open.id] || ""); setOpenId(""); }}>{busy ? "Working…" : edited ? "Approve with edits" : "Approve"}</button>
          </div> : <small className="tf-muted">Only the owner can decide.</small>}
        </footer>
      </div>
    </div>;
  })();

  return <section className="tf-panel tfa" aria-label="Approvals">
    <div className="tfa-grid">{queue.map((task) => {
      const { request, client, assignee, summary } = meta(task);
      return <button type="button" className="tfa-tile" key={task.id} onClick={() => { setOpenId(task.id); setEditing(false); }}>
        <Thumb task={task} client={client} />
        <span className="tfa-body">
          <span className="tfa-head"><ClientMark client={client} /><b>{task.title}</b></span>
          <span className="tfa-sum">{summary}</span>
          <span className="tfa-foot">
            <span className="tfa-agent">{renderAvatar ? renderAvatar(task.assigneeId || "") : null}{assignee?.name || "Unassigned"}</span>
            {task.service && <span className="tfa-src">{task.service}</span>}
            <time dateTime={request.requestedAt} title={when(request.requestedAt)}>{ago(request.requestedAt)}</time>
          </span>
        </span>
      </button>;
    })}</div>
    {modal && host ? createPortal(modal, host) : modal}
  </section>;
}

export function TaskHistoryPanel({ tasks, clients, staff, canSendBack, busyTaskId, onSendBack, onOpenTask }: {
  tasks: PanelTask[];
  clients: FlowClient[];
  staff: FlowStaff[];
  canSendBack: boolean;
  busyTaskId?: string;
  onSendBack: (taskId: string, editedRequest: string, note: string) => void | Promise<unknown>;
  onOpenTask?: (taskId: string) => void;
}) {
  const items = useMemo(() => historyItems(tasks) as Array<ReturnType<typeof historyItems>[number] & { task: PanelTask }>, [tasks]);
  const [editing, setEditing] = useState("");
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [shown, setShown] = useState(40);
  if (!items.length) return <section className="tf-panel tf-empty"><b>No finished tasks yet.</b><p>Done and rejected tasks appear here with every file, photo, ad creative, report and audit they produced.</p></section>;
  return <section className="tf-panel" aria-label="History">
    <header className="tf-panel-head"><div><h2>History</h2><p>Every finished task with its outcome and files. Edit and send anything back to the AI.</p></div><span className="tf-count">{items.length}</span></header>
    <div className="tf-list">{items.slice(0, shown).map(({ task, finishedAt, outcome, approval }) => {
      const client = clients.find((item) => item.id === task.clientId);
      const assignee = staff.find((item) => item.id === task.assigneeId);
      const approved = approval?.editedRequest || approval?.request || "";
      const isEditing = editing === task.id;
      return <article className={`tf-card is-${outcome}`} key={task.id}>
        <header><ClientMark client={client} /><div className="tf-title"><b>{task.title}</b><small>{client?.name || "Internal"} · {assignee?.name || "Unassigned"} · {when(finishedAt)}</small></div><span className={`tf-outcome is-${outcome}`}>{outcome === "rejected" ? "✕ Rejected" : approval?.status === "approved" ? "✓ Approved & done" : "✓ Done"}</span></header>
        {approval && <details className="tf-details"><summary>Approval · {approval.status}{approval.decidedBy ? ` by ${approval.decidedBy}` : ""}</summary>
          <p><b>Why it stopped:</b> {approval.reason}</p>
          <p><b>{approval.editedRequest ? "Approved version (edited)" : "Request"}:</b></p><pre>{approved}</pre>
          {approval.editedRequest && <><p><b>Original request:</b></p><pre>{approval.request}</pre></>}
          {approval.ownerNote && <p><b>Note:</b> {approval.ownerNote}</p>}
        </details>}
        <Files task={task} />
        {(task.flowHistory || []).length > 0 && <details className="tf-details"><summary>Timeline · {(task.flowHistory || []).length} steps</summary><ol className="tf-timeline">{(task.flowHistory || []).map((event) => <li key={event.id}><b>{event.action.replace(/_/g, " ")}</b> · {when(event.at)} · {event.by}{event.note ? <small>{event.note}</small> : null}</li>)}</ol></details>}
        {canSendBack && (isEditing ? <div className="tf-sendback">
          <label className="tf-field"><span>Your edits <small>Sent straight back to {assignee?.isBot ? "the AI" : "the assignee"} — no further approval</small></span><textarea rows={6} value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
          <label className="tf-field"><span>Note <small>Optional</small></span><input value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <div className="tf-actions"><button type="button" className="secondary-button" onClick={() => setEditing("")}>Cancel</button><button type="button" className="primary-button" disabled={busyTaskId === task.id || (!draft.trim() && !note.trim())} onClick={async () => { await onSendBack(task.id, draft, note); setEditing(""); }}>Send back to {assignee?.isBot ? "AI" : "assignee"}</button></div>
        </div> : <div className="tf-actions is-left">
          <button type="button" className="secondary-button" onClick={() => { setEditing(task.id); setDraft(approved || task.aiInstructions || task.notes || ""); setNote(""); }}>✎ Edit & send back</button>
          {onOpenTask && <button type="button" className="tf-link" onClick={() => onOpenTask(task.id)}>Open card</button>}
        </div>)}
      </article>;
    })}</div>
    {items.length > shown && <button type="button" className="secondary-button tf-more" onClick={() => setShown((count) => count + 40)}>Show more ({items.length - shown} older)</button>}
  </section>;
}
