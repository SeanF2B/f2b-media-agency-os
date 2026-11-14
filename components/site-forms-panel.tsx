"use client";

import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { ArrowRight, ClipboardList, Pencil, GitBranch, GripVertical, History, Inbox, Plus, Settings2, Trash2, Zap } from "lucide-react";
import { FormSubmissionsView } from "./form-submissions-view";
import type { FormDefinition, FormField, FormRule, FormSettings } from "@/lib/site-forms";

// Operations → Forms: every client website form in one place.
// Pick a form → Submissions (history of every lead) · Logic (visual flow, drag to reorder, edit rules) · Settings · Change history.

type Client = { id: string; name: string; logo?: string; color?: string };
type FormRow = { id: string; clientId: string; clientName: string; formKey: string; name: string; site: string; definition: FormDefinition | null; settings: FormSettings | null; updatedAt: string; updatedBy: string; submissions: number; last30: number; lastAt: string };
type Stage = { id: string; label: string };
type Tab = "submissions" | "logic" | "settings" | "history";

const fmt = (iso: string) => iso ? new Date(iso).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
const ACTIONS: Record<string, string> = { tag: "Add tag", urgent: "Mark urgent (🚨 email)", stage: "Move to stage", notify: "Also email" };
const blankDef = (): FormDefinition => ({ steps: [{ id: "main", title: "Form" }], fields: [], rules: [] });
const blankSettings = (): FormSettings => ({ status: "live", notify: [], thankYouUrl: "", pages: { mode: "all", paths: [] } });

export function SiteFormsPanel({ clients, clientId, onClient }: { clients: Client[]; clientId: string; onClient: (id: string) => void }) {
  const [forms, setForms] = useState<FormRow[] | null>(null);
  const [stages, setStages] = useState<Record<string, Stage[]>>({});
  const [error, setError] = useState("");
  const [openKey, setOpenKey] = useState("");
  const [tab, setTab] = useState<Tab>("submissions");
  const load = useCallback(async () => {
    setError("");
    try {
      const r = await fetch("/api/site-forms", { cache: "no-store" });
      const j = await r.json() as { forms?: FormRow[]; stages?: Record<string, Stage[]>; error?: string };
      if (!r.ok) throw new Error(j.error || "Forms unavailable.");
      setForms(j.forms || []); setStages(j.stages || {});
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Forms unavailable."); setForms([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const remove = async (f: FormRow) => {
    if (!window.confirm(`Delete “${f.name}” (${f.clientName}) from Forms?\n\nIts ${f.submissions} submission(s) stay in the CRM and nothing changes on the live website.`)) return;
    const r = await fetch(`/api/site-forms?key=${encodeURIComponent(f.formKey)}&clientId=${encodeURIComponent(f.clientId)}`, { method: "DELETE" });
    if (r.ok) setForms((list) => (list || []).filter((x) => x.formKey !== f.formKey)); else { const j = await r.json().catch(() => ({})) as { error?: string }; setError(j.error || "Could not delete the form."); }
  };
  const shown = (forms || []).filter((f) => !clientId || f.clientId === clientId);
  const open = (forms || []).find((f) => f.formKey === openKey) || null;
  const clientOf = (id: string) => clients.find((c) => c.id === id);

  if (open) return <FormDetail key={open.formKey} form={open} client={clientOf(open.clientId)} stages={stages[open.clientId] || []} clients={clients} tab={tab} onTab={setTab} onBack={() => setOpenKey("")} onSaved={(row) => setForms((list) => (list || []).map((f) => f.formKey === row.formKey ? { ...f, ...row } : f))} />;

  return <div className="sf-wrap">
    <div className="ops-toolbar"><label className="sf-pick">Client<select value={clientId} onChange={(e) => onClient(e.target.value)}><option value="">All clients</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><span className="muted">Every form on every client site. Open one to see its submissions, logic and settings.</span></div>
    {error && <p className="ops-empty" role="alert">{error}</p>}
    {forms === null ? <p className="ops-empty">Loading forms…</p> : !shown.length ? <p className="ops-empty">No forms yet for this client. Forms appear here once a site form is connected or receives its first submission.</p> :
      <div className="sf-grid">{shown.map((f) => { const c = clientOf(f.clientId); return <div role="button" tabIndex={0} key={f.formKey} className="sf-card" onClick={() => { setOpenKey(f.formKey); setTab("submissions"); }} onKeyDown={(e) => { if (e.key === "Enter") { setOpenKey(f.formKey); setTab("submissions"); } }}>
        <span className="sf-card-top">{c?.logo ? <img src={c.logo} alt="" /> : <i style={{ background: c?.color || "#d9dee3" }} />}<span><b>{f.name}</b><small>{f.clientName}{f.site ? ` · ${f.site}` : ""}</small></span><span className={`sf-status ${f.settings?.status === "paused" ? "off" : "on"}`}>{f.settings ? (f.settings.status === "paused" ? "Paused" : "Live") : "Not set up"}</span></span>
        <span className="sf-stats"><span><b>{f.submissions}</b> submissions</span><span><b>{f.last30}</b> last 30 days</span><span>Last: {fmt(f.lastAt)}</span></span>
        <span className="sf-meta">{f.definition ? `${f.definition.fields.length} questions · ${f.definition.rules.length} rules` : "Questions learned from submissions"}<span className="sf-card-actions"><button type="button" className="secondary-button" onClick={(e) => { e.stopPropagation(); setOpenKey(f.formKey); setTab("logic"); }}><Pencil size={13} /> Edit</button><button type="button" className="secondary-button danger-text" onClick={(e) => { e.stopPropagation(); void remove(f); }}><Trash2 size={13} /> Delete</button></span></span>
      </div>; })}</div>}
  </div>;
}

function FormDetail({ form, client, stages, clients, tab, onTab, onBack, onSaved }: { form: FormRow; client?: Client; stages: Stage[]; clients: Client[]; tab: Tab; onTab: (t: Tab) => void; onBack: () => void; onSaved: (row: Partial<FormRow> & { formKey: string }) => void }) {
  const [def, setDef] = useState<FormDefinition>(() => form.definition || blankDef());
  const [settings, setSettings] = useState<FormSettings>(() => form.settings || blankSettings());
  const [name, setName] = useState(form.name);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [history, setHistory] = useState<Array<{ id: string; summary: string; at: string; by: string }> | null>(null);
  const [summary, setSummary] = useState("");
  const editDef = (next: FormDefinition) => { setDef(next); setDirty(true); };
  const editSettings = (next: FormSettings) => { setSettings(next); setDirty(true); };
  useEffect(() => { if (tab === "history" && form.id && history === null) void fetch(`/api/site-forms?history=${encodeURIComponent(form.id)}`, { cache: "no-store" }).then((r) => r.json()).then((j) => setHistory(j.history || [])).catch(() => setHistory([])); }, [tab, form.id, history]);
  const save = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/site-forms", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: form.id || undefined, clientId: form.clientId, formKey: form.formKey, name, site: form.site, definition: def, settings, summary: summary.trim() || "Saved changes" }) });
      const j = await r.json() as { form?: FormRow; error?: string };
      if (!r.ok || !j.form) throw new Error(j.error || "Could not save.");
      onSaved({ ...j.form, formKey: form.formKey }); setDirty(false); setSummary(""); setHistory(null); setMsg("Saved.");
    } catch (reason) { setMsg(reason instanceof Error ? reason.message : "Could not save."); } finally { setBusy(false); }
  };
  const tabs: Array<[Tab, string, typeof Inbox]> = [["submissions", "Submissions", Inbox], ["logic", "Logic", GitBranch], ["settings", "Settings", Settings2], ["history", "Change history", History]];
  return <div className="sf-detail">
    <button type="button" className="text-button ops-back" onClick={onBack}>← All forms</button>
    <header className="sf-head"><span className="sf-card-top">{client?.logo ? <img src={client.logo} alt="" /> : <i style={{ background: client?.color || "#d9dee3" }} />}<span><input className="sf-name" value={name} onChange={(e) => { setName(e.target.value); setDirty(true); }} aria-label="Form name" /><small>{form.clientName}{form.site ? ` · ${form.site}` : ""} · {form.submissions} submissions</small></span></span>
      {tab !== "submissions" && <span className="sf-save"><input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What changed? (optional)" aria-label="Change note" /><button type="button" className="primary-button" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>{msg && <small role="status">{msg}</small>}</span>}
    </header>
    <nav className="ops-seg sf-tabs" role="tablist">{tabs.map(([key, label, Icon]) => <button type="button" role="tab" key={key} aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => onTab(key)}><Icon size={14} /> {label}</button>)}</nav>
    {tab === "submissions" && <FormSubmissionsView scopeClientId={form.clientId} clients={clients} active formKey={form.formKey} defaultPreset="12m" />}
    {tab === "logic" && <LogicEditor def={def} onChange={editDef} stages={stages} />}
    {tab === "settings" && <SettingsEditor settings={settings} onChange={editSettings} stages={stages} />}
    {tab === "history" && (!form.id ? <p className="ops-empty">No saved changes yet. Every save is recorded here with who changed what.</p> : history === null ? <p className="ops-empty">Loading history…</p> : !history.length ? <p className="ops-empty">No changes yet.</p> :
      <ol className="sf-history">{history.map((h) => <li key={h.id}><b>{h.summary}</b><small>{fmt(h.at)} · {h.by}</small></li>)}</ol>)}
  </div>;
}

function LogicEditor({ def, onChange, stages }: { def: FormDefinition; onChange: (d: FormDefinition) => void; stages: Stage[] }) {
  const [drag, setDrag] = useState<string>("");
  const [editing, setEditing] = useState<string>("");
  const byStep = useMemo(() => def.steps.map((step) => ({ step, fields: def.fields.filter((f) => f.step === step.id) })), [def]);
  const choiceFields = def.fields.filter((f) => f.options?.length);
  const setField = (id: string, patch: Partial<FormField>) => onChange({ ...def, fields: def.fields.map((f) => f.id === id ? { ...f, ...patch } : f) });
  const move = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const list = [...def.fields]; const from = list.findIndex((f) => f.id === fromId); const to = list.findIndex((f) => f.id === toId);
    if (from < 0 || to < 0) return; const [item] = list.splice(from, 1); item.step = list[to > from ? to - 1 : to]?.step || item.step; list.splice(to, 0, item); onChange({ ...def, fields: list });
  };
  const onDrop = (e: DragEvent, toId: string) => { e.preventDefault(); move(e.dataTransfer.getData("text/plain") || drag, toId); setDrag(""); };
  const setRule = (id: string, patch: Partial<FormRule>) => onChange({ ...def, rules: def.rules.map((r) => r.id === id ? { ...r, ...patch } : r) });
  const optionLabel = (fieldId: string, value: string) => def.fields.find((f) => f.id === fieldId)?.options?.find((o) => o.value === value)?.label || value;
  const conditionText = (f: FormField) => f.showWhen ? `Only if ${def.fields.find((x) => x.id === f.showWhen!.field)?.label || f.showWhen.field} = ${f.showWhen.equals.map((v) => optionLabel(f.showWhen!.field, v)).join(" or ")}` : "Always shown";

  return <div className="sf-logic">
    <p className="muted">Drag questions to reorder. Click a question to edit its wording, options and when it shows. Rules at the bottom decide what happens after someone submits.</p>
    <div className="sf-flow">{byStep.map(({ step, fields }, si) => <section key={step.id} className="sf-step">
      <header><span className="sf-step-n">Step {si + 1}</span><input value={step.title} onChange={(e) => onChange({ ...def, steps: def.steps.map((s) => s.id === step.id ? { ...s, title: e.target.value } : s) })} aria-label="Step title" /></header>
      {fields.map((f) => <article key={f.id} className={`sf-q ${f.showWhen ? "cond" : ""} ${drag === f.id ? "dragging" : ""}`} draggable onDragStart={(e) => { e.dataTransfer.setData("text/plain", f.id); setDrag(f.id); }} onDragEnd={() => setDrag("")} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, f.id)}>
        <div className="sf-q-row" onClick={() => setEditing(editing === f.id ? "" : f.id)}><GripVertical size={15} className="sf-grip" /><span><b>{f.label}</b>{f.required && <em> required</em>}<small>{f.showWhen ? <><GitBranch size={12} /> {conditionText(f)}</> : conditionText(f)}{f.options?.length ? ` · ${f.options.length} options` : ` · ${f.type}`}</small></span></div>
        {editing === f.id && <div className="sf-q-edit">
          <label>Question<input value={f.label} onChange={(e) => setField(f.id, { label: e.target.value })} /></label>
          <label className="sf-inline"><input type="checkbox" checked={Boolean(f.required)} onChange={(e) => setField(f.id, { required: e.target.checked })} /> Required</label>
          {f.options && <div className="sf-opts">{f.options.map((o, i) => <div key={i}><input value={o.label} onChange={(e) => setField(f.id, { options: f.options!.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} aria-label="Option" /><button type="button" className="text-button danger-text" onClick={() => setField(f.id, { options: f.options!.filter((_, j) => j !== i) })} aria-label="Remove option"><Trash2 size={13} /></button></div>)}<button type="button" className="text-button" onClick={() => setField(f.id, { options: [...(f.options || []), { label: "New option", value: `opt-${Date.now()}` }] })}><Plus size={13} /> Add option</button></div>}
          <label>Show this question<select value={f.showWhen ? f.showWhen.field : ""} onChange={(e) => setField(f.id, { showWhen: e.target.value ? { field: e.target.value, equals: [def.fields.find((x) => x.id === e.target.value)?.options?.[0]?.value || ""] } : undefined })}><option value="">Always</option>{choiceFields.filter((x) => x.id !== f.id).map((x) => <option key={x.id} value={x.id}>When “{x.label}” is…</option>)}</select></label>
          {f.showWhen && <div className="sf-chips">{(def.fields.find((x) => x.id === f.showWhen!.field)?.options || []).map((o) => { const on = f.showWhen!.equals.includes(o.value); return <button type="button" key={o.value} className={on ? "on" : ""} onClick={() => setField(f.id, { showWhen: { ...f.showWhen!, equals: on ? f.showWhen!.equals.filter((v) => v !== o.value) : [...f.showWhen!.equals, o.value] } })}>{o.label}</button>; })}</div>}
        </div>}
      </article>)}
      {!fields.length && <p className="muted sf-empty-step">Drop questions here.</p>}
    </section>)}
      <section className="sf-step sf-end"><header><span className="sf-step-n"><ClipboardList size={13} /> Submit</span></header><p className="muted">Saved to the CRM as a contact + opportunity, then the rules below run.</p></section>
    </div>
    <h3 className="sf-h3"><Zap size={15} /> After submit — rules</h3>
    <div className="sf-rules">{def.rules.map((r) => <div key={r.id} className="sf-rule">
      <span className="sf-rule-if">IF</span>
      <select value={r.when.field} onChange={(e) => setRule(r.id, { when: { field: e.target.value, equals: def.fields.find((x) => x.id === e.target.value)?.options?.[0]?.value || "" } })}>{choiceFields.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
      <span>=</span>
      <select value={r.when.equals} onChange={(e) => setRule(r.id, { when: { ...r.when, equals: e.target.value } })}>{(def.fields.find((x) => x.id === r.when.field)?.options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
      <ArrowRight size={15} />
      {r.then.map((a, i) => <span key={i} className="sf-action"><select value={a.action} onChange={(e) => setRule(r.id, { then: r.then.map((x, j) => j === i ? { ...x, action: e.target.value as typeof a.action, value: "" } : x) })}>{Object.entries(ACTIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        {a.action === "tag" || a.action === "notify" ? <input value={a.value} placeholder={a.action === "tag" ? "Tag" : "email@…"} onChange={(e) => setRule(r.id, { then: r.then.map((x, j) => j === i ? { ...x, value: e.target.value } : x) })} /> : a.action === "stage" ? <select value={a.value} onChange={(e) => setRule(r.id, { then: r.then.map((x, j) => j === i ? { ...x, value: e.target.value } : x) })}><option value="">Choose stage…</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select> : null}
        <button type="button" className="text-button danger-text" aria-label="Remove action" onClick={() => setRule(r.id, { then: r.then.filter((_, j) => j !== i) })}>×</button></span>)}
      <button type="button" className="text-button" onClick={() => setRule(r.id, { then: [...r.then, { action: "tag", value: "" }] })}><Plus size={13} /> action</button>
      <button type="button" className="text-button danger-text" aria-label="Delete rule" onClick={() => onChange({ ...def, rules: def.rules.filter((x) => x.id !== r.id) })}><Trash2 size={14} /></button>
    </div>)}
      <button type="button" className="secondary-button" disabled={!choiceFields.length} onClick={() => onChange({ ...def, rules: [...def.rules, { id: `r-${Date.now()}`, when: { field: choiceFields[0].id, equals: choiceFields[0].options?.[0]?.value || "" }, then: [{ action: "tag", value: "" }] }] })}><Plus size={14} /> Add rule</button>
    </div>
  </div>;
}

function SettingsEditor({ settings, onChange, stages }: { settings: FormSettings; onChange: (s: FormSettings) => void; stages: Stage[] }) {
  const [paths, setPaths] = useState(settings.pages.paths.join("\n"));
  return <div className="sf-settings">
    <label className="sf-inline"><input type="checkbox" checked={settings.status === "live"} onChange={(e) => onChange({ ...settings, status: e.target.checked ? "live" : "paused" })} /> Form is live</label>
    <label>Email new submissions to<input value={settings.notify.join(", ")} onChange={(e) => onChange({ ...settings, notify: e.target.value.split(/[,\s]+/).filter(Boolean) })} placeholder="owner@business.ie, office@…" /><small className="muted">Each lead is emailed here, with photos attached.</small></label>
    <label>New leads land in<select value={settings.stageId || ""} onChange={(e) => onChange({ ...settings, stageId: e.target.value })}><option value="">First open stage (default)</option>{stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
    <label>Thank-you page (for conversion tracking)<input value={settings.thankYouUrl || ""} onChange={(e) => onChange({ ...settings, thankYouUrl: e.target.value })} placeholder="/thank-you/" /></label>
    <label>Show on<select value={settings.pages.mode} onChange={(e) => onChange({ ...settings, pages: { ...settings.pages, mode: e.target.value as FormSettings["pages"]["mode"] } })}><option value="all">Every page</option><option value="include">Only these pages</option><option value="exclude">Every page except</option></select></label>
    {settings.pages.mode !== "all" && <label>Page URLs (one per line, * for wildcards)<textarea rows={4} value={paths} onChange={(e) => { setPaths(e.target.value); onChange({ ...settings, pages: { ...settings.pages, paths: e.target.value.split("\n").map((p) => p.trim()).filter(Boolean) } }); }} placeholder={"/contact/\n/roof-repair-*"} /></label>}
  </div>;
}
