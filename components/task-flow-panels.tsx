"use client";
/**
 * Task flow screens: the Approvals queue and History, plus the small schedule /
 * approval strip shown on board cards. All rules live in lib/task-flow.ts.
 */
import { useMemo, useState } from "react";
import "./task-flow.css";
import {
  OWNER_APPROVER_EMAIL, boardColumn, frequencyLabel, historyItems, needsOwnerDecision, scheduleLabel,
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

export function TaskApprovalsPanel({ tasks, clients, staff, canDecide, busyTaskId, onApprove, onReject, onOpenTask }: {
  tasks: PanelTask[];
  clients: FlowClient[];
  staff: FlowStaff[];
  canDecide: boolean;
  busyTaskId?: string;
  onApprove: (taskId: string, editedRequest: string, note: string) => void | Promise<unknown>;
  onReject: (taskId: string, note: string) => void | Promise<unknown>;
  onOpenTask?: (taskId: string) => void;
}) {
  const queue = useMemo(() => tasks.filter(needsOwnerDecision).sort((a, b) => (Date.parse(a.approvalRequest?.requestedAt || "") || 0) - (Date.parse(b.approvalRequest?.requestedAt || "") || 0)), [tasks]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (!queue.length) return <section className="tf-panel tf-empty"><b>Nothing waiting for your approval.</b><p>When an AI or teammate stops and moves a task to Pending, it lands here and an email goes to {OWNER_APPROVER_EMAIL}.</p></section>;
  return <section className="tf-panel" aria-label="Approvals">
    <header className="tf-panel-head"><div><h2>Approvals</h2><p>Edit anything before you approve. Approve → back to In progress, the AI finishes it and it goes straight to Done. Reject → Done.</p></div><span className="tf-count">{queue.length}</span></header>
    <div className="tf-list">{queue.map((task) => {
      const request = task.approvalRequest!;
      const client = clients.find((item) => item.id === task.clientId);
      const assignee = staff.find((item) => item.id === task.assigneeId);
      const draft = drafts[task.id] ?? request.request;
      const busy = busyTaskId === task.id;
      const adsChanges = (task.aiApprovals || []).filter((item) => item.status === "pending");
      return <article className="tf-card" key={task.id}>
        <header><ClientMark client={client} /><div className="tf-title"><b>{task.title}</b><small>{client?.name || "Internal"} · {assignee?.name || "Unassigned"} · asked {when(request.requestedAt)}</small></div>{onOpenTask && <button type="button" className="tf-link" onClick={() => onOpenTask(task.id)}>Open card</button>}</header>
        <p className="tf-reason"><span>⏳ Why it stopped</span>{request.reason}</p>
        <label className="tf-field"><span>{assignee?.isBot ? "What the AI is asking for" : "What they are asking for"} <small>Edit freely — your version is what gets done</small></span>
          <textarea rows={Math.min(14, Math.max(4, draft.split("\n").length + 1))} value={draft} disabled={!canDecide || busy} onChange={(event) => setDrafts((current) => ({ ...current, [task.id]: event.target.value }))} />
        </label>
        {(task.attachments || []).length > 0 && <details className="tf-details" open={(task.attachments || []).length <= 3}><summary>Attached files · {(task.attachments || []).length}</summary><Files task={task} /></details>}
        {adsChanges.length > 0 && <p className="tf-muted">Approving applies {adsChanges.length} proposed account change{adsChanges.length === 1 ? "" : "s"}: {adsChanges.map((item) => item.title).filter(Boolean).join(" · ")}</p>}
        <label className="tf-field"><span>Note to {assignee?.isBot ? "the AI" : "them"} <small>Optional</small></span>
          <input value={notes[task.id] || ""} disabled={!canDecide || busy} placeholder="e.g. Use the Salthill job photo" onChange={(event) => setNotes((current) => ({ ...current, [task.id]: event.target.value }))} />
        </label>
        <footer>
          <small className={`tf-mail is-${request.emailStatus || "queued"}`}>{request.emailStatus === "sent" ? `Emailed ${request.to}` : request.emailStatus === "failed" ? `Email failed: ${request.emailDetail || "unknown error"}` : request.emailStatus === "skipped" ? "Email not configured — waiting here" : `Emailing ${request.to}…`}</small>
          {canDecide ? <div className="tf-actions">
            <button type="button" className="secondary-button tf-reject" disabled={busy} onClick={() => void onReject(task.id, notes[task.id] || "")}>Reject</button>
            <button type="button" className="primary-button" disabled={busy || !draft.trim()} onClick={() => void onApprove(task.id, draft, notes[task.id] || "")}>{busy ? "Working…" : draft.trim() !== request.request.trim() ? "Approve with edits" : "Approve"}</button>
          </div> : <small className="tf-muted">Only the owner can decide.</small>}
        </footer>
      </article>;
    })}</div>
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
