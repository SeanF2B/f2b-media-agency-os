"use client";

import "./crm-automations.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { readFocusClient, useFocusClient } from "@/lib/focus-client";
import { AlertTriangle, Bell, CalendarCheck, CalendarClock, CalendarX, ChevronRight, CircleCheck, Columns3, Copy, Euro, FileInput, GitBranch, Hourglass, ListTodo, Mail, PhoneCall, Plus, Search, ShieldAlert, Tag, Trash2, UserPlus, UserX, Workflow, Zap, type LucideIcon } from "lucide-react";
import { AutomationBuilder } from "@/components/crm-automation-builder";
import { SCHEDULING_TEMPLATES, nodeSummary, triggerLabel, type AutomationNode } from "@/lib/crm-automations/model";

type Item = { id: string; name: string; status: "on" | "off"; triggerType: string; trigger: AutomationNode | null; steps?: Array<{ type: string; label: string; summary: string }>; sendsEmail: boolean; lastRunAt: string | null; totalRuns: number; updatedAt: string };
type FormRuleSet = { formId: string; formIds?: string[]; formName: string; clientId: string; clientName: string; status: string; notify: string[]; rules: Array<{ when: string; then: string[]; kinds?: string[] }> };
type Payload = { others?: Array<Item & { clientName: string; scopeId?: string }>; formRules?: FormRuleSet[]; scope: string; clients: Array<{ id: string; name: string }>; automations: Item[]; killSwitch: { paused: boolean; pausedBy: string | null; pausedAt: string | null }; notifications: Array<{ id: string; title: string; body: string; read_at: string | null; created_at: string }> };
type Dialog = { kind: "new" } | { kind: "confirm-email"; id: string; name: string; subjects: string[]; scope?: string } | { kind: "problems"; problems: string[] } | { kind: "delete"; id: string; name: string } | { kind: "bulk-delete"; rows: Row[] } | { kind: "kill"; paused: boolean } | null;

type ClientInfo = { id: string; name: string; logo?: string; color?: string; branding?: { primary?: string; logo?: string } };
type Step = { icon: LucideIcon; text: string; when?: string };
type Row = { key: string; kind: "workflow" | "form"; id: string; formIds: string[]; name: string; clientId: string; clientName: string; on: boolean; triggerIcon: LucideIcon; triggerText: string; triggerDetail: string; steps: Step[]; lastRunAt: string | null; totalRuns: number | null; sendsEmail: boolean };

const TRIGGER_ICONS: Record<string, LucideIcon> = { appointment_before: Hourglass, appointment_after: CalendarCheck, form_lead: FileInput, onboarding_started: FileInput, tag_added: Tag, stage_changed: Columns3, task_completed: CircleCheck, audit_completed: CircleCheck, appointment_completed: CircleCheck, schedule: CalendarClock, appointment_rescheduled: CalendarClock, appointment_booked: CalendarCheck, appointment_cancelled: CalendarX, payment_failed: CalendarX, appointment_no_show: UserX, guidance_requested: Bell, checkout_completed: Euro };
const STEP_ICONS: Record<string, LucideIcon> = { send_email: Mail, set_value: Euro, add_tag: Tag, remove_tag: Tag, move_stage: Columns3, create_task: ListTodo, notify: Bell, ai_call: PhoneCall, wait: Hourglass, if_else: GitBranch, tag: Tag, urgent: AlertTriangle, stage: Columns3 };
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "•";

function ClientMark({ client, name }: { client?: ClientInfo; name: string }) {
  const logo = client?.logo || client?.branding?.logo || "";
  const color = client?.branding?.primary || client?.color || "#5c6570";
  if (!client && name === "Agency") return <span className="cau-logo"><img src="/f2b-home-icon.png" alt="" /></span>;
  return <span className="cau-logo" title={name}>{logo ? <img src={logo} alt="" /> : <i style={{ background: color }}>{initials(name)}</i>}</span>;
}

const when = (value: string | null) => (value ? new Date(value).toLocaleString("en-IE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Never");

/**
 * Automations page. `clientId` comes from the app's client switcher when one is present
 * (null/"" = agency view). Without it, the page shows its own small account picker.
 */
export function CrmAutomationsView({ clientId, clientList = [], onOpenForms }: { clientId?: string | null; clientList?: ClientInfo[]; onOpenForms?: () => void }) {
  const controlled = clientId !== undefined;
  const [localScope, setLocalScope] = useState("");
  const scope = controlled ? clientId || "" : localScope;
  const [rawData, setData] = useState<Payload | null>(null);
  // Agency view: when a client is picked in the top bar, show only that client's automations
  // (no refetch, the list just updates). Agency-level automations always show.
  const [focusClient, setFocusClientState] = useState(() => controlled && clientId ? "" : readFocusClient());
  useFocusClient(setFocusClientState, !scope);
  const data = useMemo(() => !rawData || scope || !focusClient ? rawData : { ...rawData, others: (rawData.others || []).filter((item) => item.scopeId === focusClient), formRules: (rawData.formRules || []).filter((form) => form.clientId === focusClient) }, [rawData, scope, focusClient]);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState("");
  const [openScope, setOpenScope] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "workflow" | "form" | "templates">("all");
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/crm-automations?scope=${encodeURIComponent(scope)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({ error: "Could not load automations." })) as Payload & { error?: string };
    if (!response.ok) { setError(payload.error || "Could not load automations."); return; }
    setError(""); setData(payload);
  }, [scope]);
  useEffect(() => { setOpenId(""); void load(); }, [load]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 4200); return () => clearTimeout(timer); }, [toast]);

  const post = async (body: Record<string, unknown>, scopeOverride?: string) => {
    const response = await fetch("/api/crm-automations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: scopeOverride ?? scope, ...body }) });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown> & { error?: string };
    return { response, payload };
  };

  /** Switch on/off, with the email confirmation step and plain-English problems. Returns true when it changed. */
  const toggle = useCallback(async (id: string, next: "on" | "off", confirmEmails = false, scopeOverride?: string): Promise<boolean> => {
    setBusy(id);
    try {
      const itemScope = scopeOverride ?? data?.others?.find((other) => other.id === id)?.scopeId;
      const { response, payload } = await post({ action: "setStatus", id, status: next, confirmEmails }, itemScope);
      if (response.status === 409 && payload.needsConfirmation) {
        const item = [...(data?.automations || []), ...(data?.others || [])].find((automation) => automation.id === id);
        setDialog({ kind: "confirm-email", id, name: item?.name || "This automation", subjects: (payload.emailSubjects as string[]) || [], scope: scopeOverride });
        return false;
      }
      if (response.status === 422 && Array.isArray(payload.problems)) { setDialog({ kind: "problems", problems: payload.problems as string[] }); return false; }
      if (!response.ok) { setToast(payload.error || "Could not change this automation."); return false; }
      setToast(next === "on" ? "Automation switched on." : "Automation switched off. Anyone part-way through has been stopped.");
      await load();
      return true;
    } finally { setBusy(""); }
  }, [data, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async (template?: string) => {
    const { response, payload } = await post({ action: "create", name: template ? "" : newName.trim() || "Untitled automation", ...(template ? { template } : {}) });
    if (!response.ok) { setToast(payload.error || "Could not create the automation."); return; }
    setDialog(null); setNewName(""); setOpenScope(null); await load(); setOpenId(String(payload.id));
  };

  // One list: agency workflows, every client's workflows and the rules built into website forms.
  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const nameOf = (id: string) => (id ? clientList.find((client) => client.id === id)?.name || data.clients.find((client) => client.id === id)?.name || "Client" : "Agency");
    const workflow = (item: Item, owner: string, ownerName: string): Row => ({
      key: `w:${item.id}`, kind: "workflow", id: item.id, formIds: [], name: item.name, clientId: owner, clientName: ownerName, on: item.status === "on",
      triggerIcon: TRIGGER_ICONS[String(item.trigger?.config?.type || "")] || Zap, triggerText: triggerLabel(item.trigger?.config?.type),
      triggerDetail: item.trigger?.config?.type ? nodeSummary(item.trigger) : "",
      steps: (item.steps || []).map((step) => ({ icon: STEP_ICONS[step.type] || Zap, text: step.summary && step.summary !== step.label ? `${step.label}: ${step.summary}` : step.label })),
      lastRunAt: item.lastRunAt, totalRuns: item.totalRuns, sendsEmail: item.sendsEmail,
    });
    const list: Row[] = [
      ...data.automations.map((item) => workflow(item, scope, nameOf(scope))),
      ...(data.others || []).map((item) => workflow(item, item.scopeId || "", item.clientName || nameOf(item.scopeId || ""))),
      ...(data.formRules || []).map((form): Row => ({
        key: `f:${form.formId}`, kind: "form", id: form.formId, formIds: form.formIds?.length ? form.formIds : [form.formId], name: form.formName, clientId: form.clientId, clientName: form.clientName, on: form.status === "live",
        triggerIcon: FileInput, triggerText: "Website form sent", triggerDetail: "Every submission",
        steps: [
          { icon: UserPlus, text: "Create lead in Leads" },
          ...(form.notify.length ? [{ icon: Mail, text: `Email ${form.notify.join(", ")}` }] : []),
          ...form.rules.flatMap((rule) => rule.then.map((text, index) => ({ icon: STEP_ICONS[rule.kinds?.[index] || ""] || Zap, text, when: index === 0 ? rule.when : undefined }))),
        ],
        lastRunAt: null, totalRuns: null, sendsEmail: form.notify.length > 0,
      })),
    ];
    return list.sort((a, b) => a.clientName.localeCompare(b.clientName) || a.name.localeCompare(b.name));
  }, [data, scope, clientList]);
  const counts = { templates: SCHEDULING_TEMPLATES.length, all: rows.length, workflow: rows.filter((row) => row.kind === "workflow").length, form: rows.filter((row) => row.kind === "form").length };
  const needle = query.trim().toLowerCase();
  const shown = rows.filter((row) => (kindFilter === "all" || row.kind === kindFilter) && (!needle || `${row.name} ${row.clientName} ${row.triggerText} ${row.steps.map((step) => step.text).join(" ")}`.toLowerCase().includes(needle)));

  /** Deletes workflows and website-form rules (one or many). */
  const deleteRows = async (list: Row[]) => {
    let failed = 0;
    for (const row of list.filter((entry) => entry.kind === "workflow")) { const { response } = await post({ action: "delete", id: row.id }, row.clientId); if (!response.ok) failed++; }
    const formIds = list.filter((entry) => entry.kind === "form").flatMap((entry) => entry.formIds);
    if (formIds.length) { const { response } = await post({ action: "deleteForms", formIds }, ""); if (!response.ok) failed++; }
    setPicked(new Set());
    setToast(failed ? "Some couldn't be deleted. Try again." : list.length === 1 ? "Deleted." : `${list.length} deleted.`);
    await load();
  };
  const templateScope = scope || focusClient || "";
  const templateClient = templateScope ? clientList.find((client) => client.id === templateScope)?.name || data?.clients.find((client) => client.id === templateScope)?.name || "this client" : "the agency";
  const useTemplate = async (key: string) => {
    const { response, payload } = await post({ action: "create", template: key }, templateScope);
    if (!response.ok) { setToast(payload.error || "Could not create from this template."); return; }
    await load(); setOpenScope(templateScope); setOpenId(String(payload.id));
  };

  if (openId) return <div className="ca-root"><AutomationBuilder id={openId} scope={openScope ?? scope} onBack={() => { setOpenId(""); setOpenScope(null); void load(); }} onToggle={(id, next) => toggle(id, next, false, openScope ?? scope)} onChanged={() => void load()} />{dialog && renderDialog()}{toast && <div className="ca-toast" role="status">{toast}</div>}</div>;

  function renderDialog() {
    if (!dialog) return null;
    const close = () => setDialog(null);
    let content = null;
    if (dialog.kind === "new") content = <>
      <h3>New automation</h3>
      <label className="ca-field"><span>Name</span><input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void create(); }} placeholder="e.g. Welcome new website leads" maxLength={120} /><small>You can change this later. New automations start switched off.</small></label>
      <div className="ca-dialog-actions"><button type="button" className="secondary-button" onClick={close}>Cancel</button><button type="button" className="primary-button" onClick={() => void create()}>Create and open</button></div>
      <div className="ca-templates"><b>Or start from a scheduling template</b><small>Created switched off, so you can check the wording first.</small>
        {SCHEDULING_TEMPLATES.map((t) => <button key={t.key} type="button" className="ca-template" onClick={() => void create(t.key)}><span><b>{t.name}</b><small>{t.help}</small></span><Plus size={15} /></button>)}
      </div>
    </>;
    if (dialog.kind === "confirm-email") content = <>
      <h3><Mail size={18} /> Switch on email sending?</h3>
      <p>&ldquo;{dialog.name}&rdquo; will send real emails to contacts as soon as it&apos;s on:</p>
      <ul className="ca-list">{dialog.subjects.map((subject, index) => <li key={index}>{subject || "(no subject)"}</li>)}</ul>
      <p className="ca-muted">Tip: use <b>Test run</b> in the builder first to check the wording. Only send to people who agreed to hear from you.</p>
      <div className="ca-dialog-actions"><button type="button" className="secondary-button" onClick={close}>Not yet</button><button type="button" className="primary-button" onClick={async () => { const id = dialog.id; const itemScope = dialog.scope; close(); await toggle(id, "on", true, itemScope); }}>Yes, switch on</button></div>
    </>;
    if (dialog.kind === "problems") content = <>
      <h3>A few things to finish first</h3>
      <ul className="ca-list">{dialog.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
      <div className="ca-dialog-actions"><button type="button" className="primary-button" onClick={close}>OK</button></div>
    </>;
    if (dialog.kind === "delete") content = <>
      <h3>Delete &ldquo;{dialog.name}&rdquo;?</h3>
      <p>This removes the automation and its run history. Anyone part-way through it will stop. This can&apos;t be undone.</p>
      <div className="ca-dialog-actions"><button type="button" className="secondary-button" onClick={() => { setOpenScope(null); close(); }}>Cancel</button><button type="button" className="primary-button ca-danger" onClick={async () => { const { response, payload } = await post({ action: "delete", id: dialog.id }, openScope ?? undefined); setOpenScope(null); close(); setToast(response.ok ? "Automation deleted." : payload.error || "Could not delete."); await load(); }}>Delete</button></div>
    </>;
    if (dialog.kind === "bulk-delete") content = <>
      <h3>Delete {dialog.rows.length === 1 ? `“${dialog.rows[0].name}”` : `${dialog.rows.length} automations`}?</h3>
      <ul className="ca-list">{dialog.rows.map((row) => <li key={row.key}>{row.name} · {row.clientName}</li>)}</ul>
      {dialog.rows.some((row) => row.kind === "form") && <p className="ca-muted">Website forms keep working: every submission still creates the lead in Leads and emails the client. Only the extra rules (custom recipients, tags, urgent) are removed.</p>}
      <p>This can&apos;t be undone.</p>
      <div className="ca-dialog-actions"><button type="button" className="secondary-button" onClick={close}>Cancel</button><button type="button" className="primary-button ca-danger" onClick={async () => { const list = dialog.rows; close(); await deleteRows(list); }}>Delete</button></div>
    </>;
    if (dialog.kind === "kill") content = <>
      <h3><ShieldAlert size={18} /> {dialog.paused ? "Pause every automation for this account?" : "Resume automations for this account?"}</h3>
      <p>{dialog.paused ? "Nothing will run for this account until you resume. Anyone part-way through an automation is stopped now and won't continue later." : "Automations that are switched on will start running again for new events. People stopped earlier won't restart."}</p>
      <div className="ca-dialog-actions"><button type="button" className="secondary-button" onClick={close}>Cancel</button><button type="button" className={`primary-button ${dialog.paused ? "ca-danger" : ""}`} onClick={async () => { const { response, payload } = await post({ action: "setKillSwitch", paused: dialog.paused }); close(); setToast(response.ok ? (dialog.paused ? "All automations paused for this account." : "Automations resumed.") : payload.error || "Could not change the kill switch."); await load(); }}>{dialog.paused ? "Pause everything" : "Resume"}</button></div>
    </>;
    return <div className="ca-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><div className="ca-dialog" role="dialog" aria-modal="true">{content}</div></div>;
  }

  const scopeName = scope ? data?.clients.find((client) => client.id === scope)?.name || "This client" : "Agency";
  const unread = (data?.notifications || []).filter((note) => !note.read_at).length;

  return <div className="ca-root">
    <div className="page-heading ca-heading">
      <div><p className="eyebrow">WORKSPACE · {scopeName.toUpperCase()}</p><h1>Automations</h1><p className="muted">Let the CRM follow up for you: when something happens, do the next steps automatically.</p></div>
      <div className="ca-heading-actions">
        {!controlled && data && <label className="ca-scope"><span>Account</span><select value={scope} onChange={(event) => setLocalScope(event.target.value)}><option value="">Agency</option>{data.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>}
        <button type="button" className="primary-button" onClick={() => setDialog({ kind: "new" })}><Plus size={16} /> New automation</button>
      </div>
    </div>

    {error && <div className="ca-banner danger">{error}</div>}
    {data?.killSwitch.paused && <div className="ca-banner danger"><ShieldAlert size={18} /><span><b>All automations are paused for {scopeName}.</b> Nothing will run until you resume.{data.killSwitch.pausedBy ? ` Paused by ${data.killSwitch.pausedBy} on ${when(data.killSwitch.pausedAt)}.` : ""}</span><button type="button" className="secondary-button" onClick={() => setDialog({ kind: "kill", paused: false })}>Resume</button></div>}

    {!data && !error && <div className="ca-empty"><p>Loading automations…</p></div>}
    {data && kindFilter !== "templates" && data.automations.length === 0 && !(data.others?.length) && !(data.formRules?.length) && <div className="ca-empty-card">
      <span className="ca-empty-icon"><Zap size={26} /></span>
      <h2>No automations yet</h2>
      <p>For example: when someone fills in your website form, tag them, send a welcome email, wait two days, then remind you to call.</p>
      <button type="button" className="primary-button" onClick={() => setDialog({ kind: "new" })}><Plus size={16} /> Create your first automation</button> <button type="button" className="secondary-button" onClick={() => setKindFilter("templates")}><Copy size={16} /> Browse templates</button>
    </div>}

    {data && (rows.length > 0 || kindFilter === "templates") && <section className="cau-wrap">
      <div className="cau-bar">
        <div className="cau-seg" role="tablist" aria-label="Automation type">{([["all", "All", Zap], ["workflow", "Workflows", Workflow], ["form", "Website forms", FileInput], ["templates", "Templates", Copy]] as Array<[typeof kindFilter, string, LucideIcon]>).map(([key, label, Icon]) => <button key={key} type="button" role="tab" aria-selected={kindFilter === key} className={kindFilter === key ? "on" : ""} onClick={() => setKindFilter(key)}><Icon size={14} />{label}<span>{counts[key]}</span></button>)}</div>
        {picked.size > 0 && kindFilter !== "templates" && <button type="button" className="secondary-button ca-danger-outline cau-bulk" onClick={() => setDialog({ kind: "bulk-delete", rows: rows.filter((row) => picked.has(row.key)) })}><Trash2 size={15} /> Delete {picked.size}</button>}
        <label className="cau-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search automations" aria-label="Search automations" /></label>
      </div>
      {kindFilter === "templates" ? <div className="cau-templates">
        <p className="ca-muted">Ready-made automations. Each one is created for {templateClient} switched off, so you can check the wording before turning it on.{!templateScope ? " Pick a client in the top bar to create it for them." : ""}</p>
        <div className="cau-template-grid">{SCHEDULING_TEMPLATES.map((template) => <button key={template.key} type="button" className="cau-template" onClick={() => void useTemplate(template.key)}><span className="cau-ico"><CalendarCheck size={15} /></span><span><b>{template.name}</b><small>{template.help}</small></span><Plus size={16} /></button>)}</div>
      </div> : <div className="cau-list">
        <div className="cau-head"><label className="cau-check" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label="Select all" checked={shown.length > 0 && shown.every((row) => picked.has(row.key))} onChange={(event) => setPicked(event.target.checked ? new Set(shown.map((row) => row.key)) : new Set())} /></label><span>Automation</span><span>Starts when</span><span>What it does</span><span>Status</span><span>Runs</span><span /></div>
        {shown.length === 0 && <p className="ca-muted cau-none">No automations match.</p>}
        {shown.map((row) => {
          const client = row.clientId ? clientList.find((entry) => entry.id === row.clientId) : undefined;
          const open = () => { if (row.kind === "workflow") { setOpenScope(row.clientId); setOpenId(row.id); } else onOpenForms?.(); };
          const TypeIcon = row.kind === "form" ? FileInput : Workflow;
          const TriggerIcon = row.triggerIcon;
          return <div key={row.key} className={`cau-row ${row.on ? "" : "off"}`} role="button" tabIndex={0} onClick={open} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) { event.preventDefault(); open(); } }} title={row.kind === "form" ? "Open in Forms" : "Open automation"}>
            <label className="cau-check" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${row.name}`} checked={picked.has(row.key)} onChange={(event) => setPicked((prev) => { const next = new Set(prev); if (event.target.checked) next.add(row.key); else next.delete(row.key); return next; })} /></label>
            <div className="cau-name"><ClientMark client={client} name={row.clientName} /><span><b>{row.name}</b><small><span className={`cau-type ${row.kind}`}><TypeIcon size={12} />{row.kind === "form" ? "Website form" : "Workflow"}</span>{row.clientName}</small></span></div>
            <div className="cau-trigger"><span className="cau-ico"><TriggerIcon size={15} /></span><span><b>{row.triggerText}</b>{row.triggerDetail && <small>{row.triggerDetail}</small>}</span></div>
            <ul className="cau-steps">{row.steps.length === 0 ? <li className="ca-muted">No steps yet</li> : row.steps.map((step, index) => { const StepIcon = step.icon; return <li key={index}>{step.when && <em>If {step.when}</em>}<span><StepIcon size={13} />{step.text}</span></li>; })}</ul>
            <div className="cau-status" onClick={(event) => event.stopPropagation()}>{row.kind === "workflow"
              ? <label className={`ca-switch ${row.on ? "on" : ""}`}><input type="checkbox" checked={row.on} disabled={busy === row.id} onChange={(event) => void toggle(row.id, event.target.checked ? "on" : "off", false, row.clientId)} aria-label={`Switch ${row.name} ${row.on ? "off" : "on"}`} /><span className="ca-switch-track"><span /></span>{row.on ? "On" : "Off"}</label>
              : <span className={`cau-pill ${row.on ? "on" : ""}`}>{row.on ? "Live" : "Paused"}</span>}</div>
            <div className="cau-runs">{row.totalRuns === null ? <small>—</small> : <><b>{row.totalRuns.toLocaleString("en-IE")}</b><small>{row.lastRunAt ? `Last ${when(row.lastRunAt)}` : "Not run yet"}</small></>}</div>
            <div className="cau-actions" onClick={(event) => event.stopPropagation()}>
              {row.kind === "workflow" && <button type="button" className="ca-icon-btn" title="Duplicate" aria-label={`Duplicate ${row.name}`} onClick={async () => { const { response, payload } = await post({ action: "duplicate", id: row.id }, row.clientId); setToast(response.ok ? "Copy created (switched off)." : payload.error || "Could not duplicate."); await load(); }}><Copy size={15} /></button>}
              <button type="button" className="ca-icon-btn" title="Delete" aria-label={`Delete ${row.name}`} onClick={() => setDialog({ kind: "bulk-delete", rows: [row] })}><Trash2 size={15} /></button>
              <button type="button" className="ca-icon-btn" title={row.kind === "form" ? "Open in Forms" : "Open"} aria-label={`Open ${row.name}`} onClick={open}><ChevronRight size={16} /></button>
            </div>
          </div>;
        })}
      </div>}
    </section>}

    {data && <div className="ca-lower">
      <section className="ca-card">
        <div className="ca-card-head"><h3><Bell size={16} /> Alerts {unread > 0 && <span className="ca-count">{unread}</span>}</h3>{unread > 0 && <button type="button" className="ca-text-btn" onClick={async () => { await post({ action: "markNotificationsRead" }); await load(); }}>Mark all read</button>}</div>
        {data.notifications.length === 0 ? <p className="ca-muted">Alerts from &ldquo;Notify me&rdquo; steps will appear here.</p> : <ul className="ca-alerts">{data.notifications.map((note) => <li key={note.id} className={note.read_at ? "" : "unread"}><b>{note.title}</b><small>{note.body} · {when(note.created_at)}</small></li>)}</ul>}
      </section>
      {!data.killSwitch.paused && <section className="ca-card ca-kill">
        <div className="ca-card-head"><h3><ShieldAlert size={16} /> Emergency stop</h3></div>
        <p className="ca-muted">Instantly pause every automation for {scopeName} and stop anyone part-way through.</p>
        <button type="button" className="secondary-button ca-danger-outline" onClick={() => setDialog({ kind: "kill", paused: true })}>Pause all for {scopeName}</button>
      </section>}
    </div>}
    {renderDialog()}
    {toast && <div className="ca-toast" role="status">{toast}</div>}
  </div>;
}
