"use client";

import "./crm-automations.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { readFocusClient, useFocusClient } from "@/lib/focus-client";
import { Bell, Copy, Mail, Plus, ShieldAlert, Trash2, Zap } from "lucide-react";
import { AutomationBuilder } from "@/components/crm-automation-builder";
import { SCHEDULING_TEMPLATES, nodeSummary, triggerLabel, type AutomationNode } from "@/lib/crm-automations/model";

type Item = { id: string; name: string; status: "on" | "off"; triggerType: string; trigger: AutomationNode | null; sendsEmail: boolean; lastRunAt: string | null; totalRuns: number; updatedAt: string };
type FormRuleSet = { formId: string; formName: string; clientId: string; clientName: string; status: string; notify: string[]; rules: Array<{ when: string; then: string[] }> };
type Payload = { others?: Array<Item & { clientName: string; scopeId?: string }>; formRules?: FormRuleSet[]; scope: string; clients: Array<{ id: string; name: string }>; automations: Item[]; killSwitch: { paused: boolean; pausedBy: string | null; pausedAt: string | null }; notifications: Array<{ id: string; title: string; body: string; read_at: string | null; created_at: string }> };
type Dialog = { kind: "new" } | { kind: "confirm-email"; id: string; name: string; subjects: string[] } | { kind: "problems"; problems: string[] } | { kind: "delete"; id: string; name: string } | { kind: "kill"; paused: boolean } | null;

const when = (value: string | null) => (value ? new Date(value).toLocaleString("en-IE", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Never");

/**
 * Automations page. `clientId` comes from the app's client switcher when one is present
 * (null/"" = agency view). Without it, the page shows its own small account picker.
 */
export function CrmAutomationsView({ clientId }: { clientId?: string | null }) {
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
        const item = data?.automations.find((automation) => automation.id === id);
        setDialog({ kind: "confirm-email", id, name: item?.name || "This automation", subjects: (payload.emailSubjects as string[]) || [] });
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
    setDialog(null); setNewName(""); await load(); setOpenId(String(payload.id));
  };

  if (openId) return <div className="ca-root"><AutomationBuilder id={openId} scope={openScope ?? scope} onBack={() => { setOpenId(""); setOpenScope(null); void load(); }} onToggle={(id, next) => toggle(id, next)} onChanged={() => void load()} />{dialog && renderDialog()}{toast && <div className="ca-toast" role="status">{toast}</div>}</div>;

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
      <div className="ca-dialog-actions"><button type="button" className="secondary-button" onClick={close}>Not yet</button><button type="button" className="primary-button" onClick={async () => { const id = dialog.id; close(); await toggle(id, "on", true); }}>Yes, switch on</button></div>
    </>;
    if (dialog.kind === "problems") content = <>
      <h3>A few things to finish first</h3>
      <ul className="ca-list">{dialog.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
      <div className="ca-dialog-actions"><button type="button" className="primary-button" onClick={close}>OK</button></div>
    </>;
    if (dialog.kind === "delete") content = <>
      <h3>Delete &ldquo;{dialog.name}&rdquo;?</h3>
      <p>This removes the automation and its run history. Anyone part-way through it will stop. This can&apos;t be undone.</p>
      <div className="ca-dialog-actions"><button type="button" className="secondary-button" onClick={close}>Cancel</button><button type="button" className="primary-button ca-danger" onClick={async () => { const { response, payload } = await post({ action: "delete", id: dialog.id }); close(); setToast(response.ok ? "Automation deleted." : payload.error || "Could not delete."); await load(); }}>Delete</button></div>
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
      <div><p className="eyebrow">⚡ WORKSPACE · {scopeName.toUpperCase()}</p><h1>Automations</h1><p className="muted">Let the CRM follow up for you: when something happens, do the next steps automatically.</p></div>
      <div className="ca-heading-actions">
        {!controlled && data && <label className="ca-scope"><span>Account</span><select value={scope} onChange={(event) => setLocalScope(event.target.value)}><option value="">Agency</option>{data.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>}
        <button type="button" className="primary-button" onClick={() => setDialog({ kind: "new" })}><Plus size={16} /> New automation</button>
      </div>
    </div>

    {error && <div className="ca-banner danger">{error}</div>}
    {data?.killSwitch.paused && <div className="ca-banner danger"><ShieldAlert size={18} /><span><b>All automations are paused for {scopeName}.</b> Nothing will run until you resume.{data.killSwitch.pausedBy ? ` Paused by ${data.killSwitch.pausedBy} on ${when(data.killSwitch.pausedAt)}.` : ""}</span><button type="button" className="secondary-button" onClick={() => setDialog({ kind: "kill", paused: false })}>Resume</button></div>}

    {!data && !error && <div className="ca-empty"><p>Loading automations…</p></div>}
    {data && data.automations.length === 0 && !(data.others?.length) && !(data.formRules?.length) && <div className="ca-empty-card">
      <span className="ca-empty-icon"><Zap size={26} /></span>
      <h2>No automations yet</h2>
      <p>For example: when someone fills in your website form, tag them, send a welcome email, wait two days, then remind you to call.</p>
      <button type="button" className="primary-button" onClick={() => setDialog({ kind: "new" })}><Plus size={16} /> Create your first automation</button>
    </div>}

    {data && !scope && data.automations.length === 0 && ((data.others?.length || 0) > 0 || (data.formRules?.length || 0) > 0) && <p className="ca-muted ca-agency-none">No agency-level automations yet — client and website-form automations are listed below.</p>}
    {data && data.automations.length > 0 && <div className="ca-table-wrap"><table className="ca-table">
      <thead><tr><th>Name</th><th>Starts when</th><th>Status</th><th>Last run</th><th className="num">Total runs</th><th><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{data.automations.map((item) => <tr key={item.id}>
        <td><button type="button" className="ca-link" onClick={() => setOpenId(item.id)}>{item.name}</button>{item.sendsEmail && <span className="ca-tag-mini" title="Sends emails"><Mail size={12} /> Email</span>}</td>
        <td><span className="ca-trigger-cell"><b>{triggerLabel(item.trigger?.config?.type)}</b>{item.trigger?.config?.type ? <small>{nodeSummary(item.trigger)}</small> : null}</span></td>
        <td><label className={`ca-switch ${item.status === "on" ? "on" : ""}`}><input type="checkbox" checked={item.status === "on"} disabled={busy === item.id} onChange={(event) => void toggle(item.id, event.target.checked ? "on" : "off")} aria-label={`Switch ${item.name} ${item.status === "on" ? "off" : "on"}`} /><span className="ca-switch-track"><span /></span>{item.status === "on" ? "On" : "Off"}</label></td>
        <td>{when(item.lastRunAt)}</td>
        <td className="num">{item.totalRuns.toLocaleString("en-IE")}</td>
        <td className="ca-row-actions">
          <button type="button" className="ca-icon-btn" title="Duplicate" aria-label={`Duplicate ${item.name}`} onClick={async () => { const { response, payload } = await post({ action: "duplicate", id: item.id }); setToast(response.ok ? "Copy created (switched off)." : payload.error || "Could not duplicate."); await load(); }}><Copy size={15} /></button>
          <button type="button" className="ca-icon-btn" title="Delete" aria-label={`Delete ${item.name}`} onClick={() => setDialog({ kind: "delete", id: item.id, name: item.name })}><Trash2 size={15} /></button>
        </td>
      </tr>)}</tbody>
    </table></div>}

    {data && !scope && (data.others?.length || 0) > 0 && <section className="ca-section"><h2 className="ca-section-title">Client automations <span>{data.others!.length}</span></h2><div className="ca-table-wrap"><table className="ca-table">
      <thead><tr><th>Name</th><th>Client</th><th>Starts when</th><th>Status</th><th>Last run</th><th className="num">Total runs</th></tr></thead>
      <tbody>{data.others!.map((item) => <tr key={item.id}>
        <td><button type="button" className="ca-link" onClick={() => { setOpenScope(item.scopeId || ""); setOpenId(item.id); }}>{item.name}</button>{item.sendsEmail && <span className="ca-tag-mini" title="Sends emails"><Mail size={12} /> Email</span>}</td>
        <td><span className="ca-client-chip">{item.clientName}</span></td>
        <td><span className="ca-trigger-cell"><b>{triggerLabel(item.trigger?.config?.type)}</b>{item.trigger?.config?.type ? <small>{nodeSummary(item.trigger)}</small> : null}</span></td>
        <td><label className={`ca-switch ${item.status === "on" ? "on" : ""}`}><input type="checkbox" checked={item.status === "on"} disabled={busy === item.id} onChange={(event) => void toggle(item.id, event.target.checked ? "on" : "off", false, item.scopeId || "")} aria-label={`Switch ${item.name} ${item.status === "on" ? "off" : "on"}`} /><span className="ca-switch-track"><span /></span>{item.status === "on" ? "On" : "Off"}</label></td>
        <td>{when(item.lastRunAt)}</td>
        <td className="num">{item.totalRuns.toLocaleString("en-IE")}</td>
      </tr>)}</tbody>
    </table></div></section>}

    {data && !scope && (data.formRules?.length || 0) > 0 && <section className="ca-section"><h2 className="ca-section-title">Website form automations <span>{data.formRules!.length}</span></h2><p className="ca-muted">Built into each website form. Edit them in Operations → Forms.</p><div className="ca-form-rules">{data.formRules!.map((form) => <article key={form.formId} className="ca-form-rule-card">
      <header><b>{form.formName}</b><span className="ca-client-chip">{form.clientName}</span><span className={`ca-form-status ${form.status === "live" ? "on" : ""}`}>{form.status === "live" ? "Live" : "Paused"}</span></header>
      <ul>
        <li><span className="ca-when">Every submission</span><span>→ Create lead in Leads{form.notify.length ? ` · Email ${form.notify.join(", ")}` : ""}</span></li>
        {form.rules.map((rule, index) => <li key={index}><span className="ca-when">When {rule.when}</span><span>→ {rule.then.join(" · ") || "No action"}</span></li>)}
      </ul>
    </article>)}</div></section>}

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
