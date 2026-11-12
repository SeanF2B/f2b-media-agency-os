"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft, Bell, CalendarClock, CircleCheck, Columns3, Copy, FileInput, FlaskConical, GitBranch, History, Hourglass, ListTodo,
  Mail, Maximize, MessageSquare, Minus, Plus, Search, Tag, Trash2, X, Zap,
} from "lucide-react";
import {
  ACTIONS, CONDITION_FIELDS, MERGE_FIELDS, STAGE_OPS, TAG_OPS, TEXT_OPS, TRIGGERS,
  type AutomationDefinition, type AutomationNode, type Branch, type ConditionRule, type ConditionSet,
  duplicateNode, insertNode, newId, nodeById, nodeSummary, nodeTitle, outgoing, readinessProblems, removeNode,
} from "@/lib/crm-automations/model";

type Options = { pipelines: Array<{ id: string; name: string; stages: Array<{ id: string; name: string }> }>; forms: Array<{ name: string; kind: string }>; tags: string[]; staff: Array<{ id: string; name: string; isBot: boolean }>; emailReady: boolean };
type RunRow = { id: string; status: string; dry_run: number; trigger_summary: string; error: string | null; started_at: string; finished_at: string | null; first_name: string | null; last_name: string | null; email: string | null };
type StepRow = { node_id: string; title: string; status: string; detail: string; created_at: string; updated_at: string };
type Loaded = { automation: { id: string; name: string; status: "on" | "off"; sendsEmail: boolean; definition: AutomationDefinition }; options: Options; runs: RunRow[] };

const ICONS: Record<string, typeof Mail> = { FileInput, Tag, Columns3, CircleCheck, CalendarClock, Mail, Bell, Hourglass, GitBranch, MessageSquare, ListTodo, TagRemove: Tag };
const iconFor = (node: AutomationNode) => {
  if (node.type === "trigger") return ICONS[TRIGGERS.find((item) => item.type === node.config?.type)?.icon || ""] || Zap;
  if (node.type === "remove_tag") return Tag;
  return ICONS[ACTIONS.find((item) => item.type === node.type)?.icon || ""] || Zap;
};

const NODE_W = 300, NODE_H = 76, GAP_Y = 64, BRANCH_GAP = 48, END_H = 36;
type Placed = { node: AutomationNode; x: number; y: number };
type Slot = { afterId: string; branch?: Branch; x: number; y: number; kind: "edge" | "end"; fromX: number; fromY: number; label?: string };

// Lays the tree out top-to-bottom; an If/Else puts its Yes path on the left and No path on the right.
function layout(def: AutomationDefinition) {
  const widths = new Map<string, number>();
  const width = (id: string | null): number => {
    if (!id) return NODE_W;
    if (widths.has(id)) return widths.get(id) as number;
    const node = nodeById(def, id);
    let value = NODE_W;
    if (node?.type === "if_else") value = width(outgoing(def, id, "yes")?.target || null) + BRANCH_GAP + width(outgoing(def, id, "no")?.target || null);
    else if (node) value = Math.max(NODE_W, width(outgoing(def, id)?.target || null));
    widths.set(id, value);
    return value;
  };
  const placed: Placed[] = [], slots: Slot[] = [];
  const place = (id: string, cx: number, y: number) => {
    const node = nodeById(def, id); if (!node) return;
    placed.push({ node, x: cx - NODE_W / 2, y });
    const bottom = y + NODE_H;
    if (node.type === "if_else") {
      const yesId = outgoing(def, id, "yes")?.target || null, noId = outgoing(def, id, "no")?.target || null;
      const total = width(yesId) + BRANCH_GAP + width(noId);
      const yesX = cx - total / 2 + width(yesId) / 2, noX = cx + total / 2 - width(noId) / 2;
      for (const [branch, childId, childX] of [["yes", yesId, yesX], ["no", noId, noX]] as const) {
        const childY = bottom + GAP_Y + 18;
        slots.push({ afterId: id, branch, x: childX, y: bottom + (GAP_Y + 18) / 2 + 9, kind: childId ? "edge" : "end", fromX: cx, fromY: bottom, label: branch === "yes" ? "Yes" : "No" });
        if (childId) place(childId, childX, childY);
      }
      return;
    }
    const child = outgoing(def, id)?.target || null;
    slots.push({ afterId: id, x: cx, y: bottom + GAP_Y / 2, kind: child ? "edge" : "end", fromX: cx, fromY: bottom });
    if (child) place(child, cx, bottom + GAP_Y);
  };
  const trigger = def.nodes.find((node) => node.type === "trigger");
  if (trigger) place(trigger.id, 0, 0);
  const xs = placed.flatMap((item) => [item.x, item.x + NODE_W]), ys = [...placed.map((item) => item.y + NODE_H), ...slots.map((slot) => slot.y + END_H)];
  const bounds = { minX: Math.min(...xs, -NODE_W / 2), maxX: Math.max(...xs, NODE_W / 2), minY: 0, maxY: Math.max(...ys, NODE_H) };
  return { placed, slots, bounds };
}

type View = { x: number; y: number; k: number };
const clampK = (k: number) => Math.min(1.8, Math.max(0.3, k));

export function AutomationBuilder({ id, scope, onBack, onToggle, onChanged }: { id: string; scope: string; onBack: () => void; onToggle: (id: string, next: "on" | "off") => Promise<boolean>; onChanged: () => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const [definition, setDefinition] = useState<AutomationDefinition | null>(null);
  const [name, setName] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [menu, setMenu] = useState<{ afterId: string; branch?: Branch; x: number; y: number } | null>(null);
  const [panel, setPanel] = useState<"" | "test" | "history">("");
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; pinch?: number; k?: number } | null>(null);
  const fitted = useRef(false);

  const load = useCallback(async () => {
    const response = await fetch(`/api/crm-automations?scope=${encodeURIComponent(scope)}&id=${encodeURIComponent(id)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({ error: "Could not load this automation." })) as Loaded & { error?: string };
    if (!response.ok) { setError(payload.error || "Could not load this automation."); return; }
    setLoaded(payload);
    setDefinition((current) => (dirty && current ? current : payload.automation.definition));
    setName((current) => (dirty && current ? current : payload.automation.name));
  }, [id, scope, dirty]);
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 4200); return () => clearTimeout(timer); }, [toast]);

  const options = loaded?.options;
  const stageName = useCallback((stageId: string) => options?.pipelines.flatMap((pipeline) => pipeline.stages).find((stage) => stage.id === stageId)?.name || "a stage", [options]);
  const staffName = useCallback((staffId: string) => options?.staff.find((member) => member.id === staffId)?.name || "a teammate", [options]);
  const graph = useMemo(() => (definition ? layout(definition) : null), [definition]);

  const fit = useCallback(() => {
    const element = canvasRef.current; if (!element || !graph) return;
    const rect = element.getBoundingClientRect();
    const w = graph.bounds.maxX - graph.bounds.minX + 120, h = graph.bounds.maxY - graph.bounds.minY + 120;
    const k = clampK(Math.min(rect.width / w, rect.height / h, 1));
    setView({ k, x: rect.width / 2 - ((graph.bounds.minX + graph.bounds.maxX) / 2) * k, y: Math.max(40, (rect.height - (graph.bounds.maxY - graph.bounds.minY) * k) / 2) });
  }, [graph]);
  useLayoutEffect(() => { if (graph && !fitted.current) { fitted.current = true; fit(); } }, [graph, fit]);

  // Wheel / trackpad zoom around the cursor (non-passive so the page doesn't scroll).
  useEffect(() => {
    const element = canvasRef.current; if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect(), px = event.clientX - rect.left, py = event.clientY - rect.top;
      setView((current) => { const k = clampK(current.k * Math.exp(-event.deltaY * 0.0015)); return { k, x: px - ((px - current.x) * k) / current.k, y: py - ((py - current.y) * k) / current.k }; });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [loaded]);

  const zoomBy = (factor: number) => {
    const rect = canvasRef.current?.getBoundingClientRect(); if (!rect) return;
    const px = rect.width / 2, py = rect.height / 2;
    setView((current) => { const k = clampK(current.k * factor); return { k, x: px - ((px - current.x) * k) / current.k, y: py - ((py - current.y) * k) / current.k }; });
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest("[data-no-pan]")) return;
    setMenu(null);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const list = [...pointers.current.values()];
    if (list.length === 2) drag.current = { x: (list[0].x + list[1].x) / 2, y: (list[0].y + list[1].y) / 2, vx: view.x, vy: view.y, pinch: Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y), k: view.k };
    else drag.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    if (!pointers.current.has(event.pointerId) || !drag.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const list = [...pointers.current.values()], start = drag.current;
    if (list.length === 2 && start.pinch && start.k) {
      const rect = canvasRef.current?.getBoundingClientRect(); if (!rect) return;
      const cx = (list[0].x + list[1].x) / 2 - rect.left, cy = (list[0].y + list[1].y) / 2 - rect.top;
      const k = clampK(start.k * (Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y) / start.pinch));
      const ox = start.x - rect.left, oy = start.y - rect.top;
      setView({ k, x: cx - ((ox - start.vx) * k) / start.k, y: cy - ((oy - start.vy) * k) / start.k });
    } else setView((current) => ({ ...current, x: start.vx + event.clientX - start.x, y: start.vy + event.clientY - start.y }));
  };
  const onPointerUp = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    const list = [...pointers.current.values()];
    drag.current = list.length === 1 ? { x: list[0].x, y: list[0].y, vx: view.x, vy: view.y } : null;
  };

  const change = (next: AutomationDefinition) => { setDefinition(next); setDirty(true); };
  const addStep = (type: string) => {
    if (!menu || !definition) return;
    const node: AutomationNode = { id: newId(), type: type as AutomationNode["type"], config: type === "wait" ? { amount: 1, unit: "days" } : type === "if_else" ? { conditions: { match: "all", rules: [] } } : type === "notify" ? { email: true } : {} };
    const movesSteps = type === "if_else" && outgoing(definition, menu.afterId, menu.branch);
    change(insertNode(definition, menu.afterId, node, menu.branch));
    setMenu(null); setSelected(node.id);
    if (movesSteps) setToast("The steps below were moved onto the Yes path.");
  };

  const save = async () => {
    if (!definition) return;
    setSaving(true);
    try {
      const response = await fetch("/api/crm-automations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", scope, id, name, definition }) });
      const payload = await response.json().catch(() => ({})) as { error?: string; notice?: string };
      if (!response.ok) { setToast(payload.error || "Could not save."); return; }
      setDirty(false); setToast(payload.notice || "Saved."); onChanged();
      await load();
    } finally { setSaving(false); }
  };

  const back = () => { if (dirty && !window.confirm("You have unsaved changes. Leave without saving?")) return; onBack(); };

  if (error) return <div className="ca-empty"><p>{error}</p><button type="button" className="secondary-button" onClick={onBack}>Back to automations</button></div>;
  if (!loaded || !definition || !graph) return <div className="ca-empty"><p>Loading automation…</p></div>;

  const live = loaded.automation.status === "on";
  const problems = readinessProblems(definition);
  const selectedNode = selected ? nodeById(definition, selected) : null;
  const dotSize = 22 * view.k;

  return <section className="ca-builder" aria-label={`Automation builder: ${name}`}>
    <header className="ca-builder-bar">
      <button type="button" className="ca-icon-btn" onClick={back} aria-label="Back to automations"><ArrowLeft size={18} /></button>
      <input className="ca-name-input" value={name} onChange={(event) => { setName(event.target.value); setDirty(true); }} aria-label="Automation name" placeholder="Name this automation" maxLength={120} />
      <label className={`ca-switch ${live ? "on" : ""}`} title={dirty ? "Save your changes first" : undefined}>
        <input type="checkbox" checked={live} disabled={dirty} onChange={async (event) => { if (await onToggle(id, event.target.checked ? "on" : "off")) await load(); }} />
        <span className="ca-switch-track"><span /></span>{live ? "On" : "Off"}
      </label>
      <div className="ca-bar-actions">
        <button type="button" className="secondary-button" onClick={() => setPanel(panel === "history" ? "" : "history")}><History size={15} /> Run history</button>
        <button type="button" className="secondary-button" onClick={() => setPanel(panel === "test" ? "" : "test")}><FlaskConical size={15} /> Test run</button>
        <button type="button" className="primary-button" onClick={save} disabled={!dirty || saving}>{saving ? "Saving…" : dirty ? "Save changes" : "Saved"}</button>
      </div>
    </header>
    {problems.length > 0 && <div className="ca-hint" role="status"><b>Before you switch this on:</b> {problems.slice(0, 3).join(" ")}{problems.length > 3 ? ` (+${problems.length - 3} more)` : ""}</div>}

    <div className="ca-workspace">
      <div ref={canvasRef} className="ca-canvas" style={{ backgroundSize: `${dotSize}px ${dotSize}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <div className="ca-stage" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
          <svg className="ca-lines" style={{ left: graph.bounds.minX - 40, top: -20, width: graph.bounds.maxX - graph.bounds.minX + 80, height: graph.bounds.maxY + 80 }} viewBox={`${graph.bounds.minX - 40} -20 ${graph.bounds.maxX - graph.bounds.minX + 80} ${graph.bounds.maxY + 80}`} aria-hidden="true">
            {graph.slots.map((slot) => {
              const target = graph.placed.find((item) => item.node.id === (outgoing(definition, slot.afterId, slot.branch)?.target));
              const endY = target ? target.y : slot.y + 4;
              const toX = slot.x;
              const midY = slot.fromY + (slot.branch ? 18 : 0);
              const d = slot.branch ? `M ${slot.fromX} ${slot.fromY} L ${slot.fromX} ${midY} L ${toX} ${midY} L ${toX} ${endY}` : `M ${slot.fromX} ${slot.fromY} L ${toX} ${endY}`;
              return <path key={`${slot.afterId}-${slot.branch || "next"}`} d={d} className={slot.kind === "end" ? "ca-line end" : "ca-line"} />;
            })}
          </svg>
          {graph.slots.map((slot) => <div key={`slot-${slot.afterId}-${slot.branch || "next"}`} className={`ca-slot ${slot.kind}`} style={{ left: slot.x, top: slot.y }} data-no-pan>
            {slot.label && <span className={`ca-branch-label ${slot.branch}`}>{slot.label}</span>}
            <button type="button" className="ca-plus" aria-label={`Add a step${slot.label ? ` on the ${slot.label} path` : ""}`} onClick={(event) => { const rect = canvasRef.current?.getBoundingClientRect(); setMenu({ afterId: slot.afterId, branch: slot.branch, x: event.clientX - (rect?.left || 0), y: event.clientY - (rect?.top || 0) }); }}><Plus size={14} /></button>
            {slot.kind === "end" && <span className="ca-end-label">End</span>}
          </div>)}
          {graph.placed.map(({ node, x, y }) => {
            const Icon = iconFor(node);
            return <button key={node.id} type="button" data-no-pan className={`ca-node ${node.type === "trigger" ? "trigger" : ""} ${node.type === "if_else" ? "branch" : ""} ${selected === node.id ? "selected" : ""}`} style={{ left: x, top: y, width: NODE_W, height: NODE_H }} onClick={() => { setSelected(node.id); setMenu(null); }}>
              <span className={`ca-node-icon t-${node.type}`}><Icon size={18} /></span>
              <span className="ca-node-text"><small>{node.type === "trigger" ? "When this happens" : nodeTitle(node)}</small><b>{node.type === "trigger" ? nodeTitle(node) : nodeSummary(node, { stageName, staffName })}</b>{node.type === "trigger" && <em>{nodeSummary(node, { stageName, staffName })}</em>}</span>
            </button>;
          })}
        </div>

        {menu && <div className="ca-menu" data-no-pan style={{ left: Math.max(8, menu.x - 130), top: menu.y + 12 }} role="menu" aria-label="Choose a step">
          <div className="ca-menu-head"><b>Add a step</b><button type="button" className="ca-icon-btn" onClick={() => setMenu(null)} aria-label="Close"><X size={15} /></button></div>
          {ACTIONS.map((action) => { const Icon = ICONS[action.icon] || Zap; return <button key={action.type} type="button" role="menuitem" disabled={action.comingSoon} onClick={() => addStep(action.type)}>
            <span className={`ca-node-icon small t-${action.type}`}><Icon size={15} /></span><span><b>{action.label}</b><small>{action.help}</small></span>{action.comingSoon && <em className="ca-soon">Coming soon</em>}
          </button>; })}
        </div>}

        <div className="ca-zoom" data-no-pan>
          <button type="button" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out"><Minus size={15} /></button>
          <span>{Math.round(view.k * 100)}%</span>
          <button type="button" onClick={() => zoomBy(1.2)} aria-label="Zoom in"><Plus size={15} /></button>
          <button type="button" onClick={fit} aria-label="Fit to screen" title="Fit to screen"><Maximize size={15} /></button>
        </div>
      </div>

      {selectedNode && <StepPanel key={selectedNode.id} node={selectedNode} options={loaded.options} definition={definition}
        onCancel={() => setSelected("")}
        onSave={(config) => { change({ ...definition, nodes: definition.nodes.map((node) => node.id === selectedNode.id ? { ...node, config } : node) }); setSelected(""); }}
        onDelete={() => {
          if (selectedNode.type === "if_else" && !window.confirm("Delete this If / Else and every step on both of its paths?")) return;
          change(removeNode(definition, selectedNode.id)); setSelected("");
        }}
        onDuplicate={() => { change(duplicateNode(definition, selectedNode.id)); setSelected(""); setToast("Step duplicated below the original."); }} />}
      {!selectedNode && panel === "test" && <TestPanel id={id} scope={scope} definition={definition} onClose={() => setPanel("")} />}
      {!selectedNode && panel === "history" && <HistoryPanel runs={loaded.runs} onRefresh={load} onClose={() => setPanel("")} />}
    </div>
    {toast && <div className="ca-toast" role="status">{toast}</div>}
  </section>;
}

// ---------- side panel: edit one step ----------
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="ca-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function StepPanel({ node, options, onSave, onCancel, onDelete, onDuplicate }: { node: AutomationNode; options: Options; definition: AutomationDefinition; onSave: (config: Record<string, unknown>) => void; onCancel: () => void; onDelete: () => void; onDuplicate: () => void }) {
  const [config, setConfig] = useState<Record<string, unknown>>(() => JSON.parse(JSON.stringify(node.config || {})));
  const set = (patch: Record<string, unknown>) => setConfig((current) => ({ ...current, ...patch }));
  const str = (key: string) => String(config[key] ?? "");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const pipeline = options.pipelines.find((item) => item.id === str("pipelineId"));
  const people = options.staff.filter((member) => !member.isBot), bots = options.staff.filter((member) => member.isBot);
  const tagList = <datalist id="ca-tags">{options.tags.map((tag) => <option key={tag} value={tag} />)}</datalist>;
  const Icon = iconFor({ ...node, config });

  const insertMerge = (token: string) => {
    const element = bodyRef.current; const value = str("body");
    if (!element) { set({ body: value + token }); return; }
    const start = element.selectionStart ?? value.length, end = element.selectionEnd ?? value.length;
    set({ body: value.slice(0, start) + token + value.slice(end) });
    requestAnimationFrame(() => { element.focus(); element.setSelectionRange(start + token.length, start + token.length); });
  };

  let body: ReactNode = null;
  if (node.type === "trigger") {
    body = <>
      <div className="ca-choice-list" role="radiogroup" aria-label="What starts this automation?">
        {TRIGGERS.map((trigger) => { const TIcon = ICONS[trigger.icon] || Zap; return <button key={trigger.type} type="button" role="radio" aria-checked={config.type === trigger.type} className={config.type === trigger.type ? "active" : ""} onClick={() => setConfig({ type: trigger.type, ...(trigger.type === "schedule" ? { mode: "once" } : {}) })}>
          <TIcon size={16} /><span><b>{trigger.label}</b><small>{trigger.help}</small></span>
        </button>; })}
      </div>
      {config.type === "form_lead" && <Field label="Which form?" hint="Leads from this form will start the automation.">
        <select value={str("formName")} onChange={(event) => set({ formName: event.target.value })}><option value="">Any website form</option>{options.forms.map((form) => <option key={form.name} value={form.name}>{form.name}</option>)}</select>
      </Field>}
      {config.type === "tag_added" && <Field label="Tag" hint="Starts whenever this tag is added to a contact."><input list="ca-tags" value={str("tag")} onChange={(event) => set({ tag: event.target.value })} placeholder="e.g. hot lead" maxLength={60} />{tagList}</Field>}
      {config.type === "stage_changed" && <>
        <Field label="Pipeline"><select value={str("pipelineId")} onChange={(event) => set({ pipelineId: event.target.value, fromStageId: "", toStageId: "" })}><option value="">Choose a pipeline</option>{options.pipelines.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        {pipeline && <><Field label="Moved from"><select value={str("fromStageId")} onChange={(event) => set({ fromStageId: event.target.value })}><option value="">Any stage</option>{pipeline.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></Field>
          <Field label="Moved to"><select value={str("toStageId")} onChange={(event) => set({ toStageId: event.target.value })}><option value="">Any stage</option>{pipeline.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></Field></>}
      </>}
      {config.type === "task_completed" && <>
        <Field label="Which tasks?" hint="Runs for the contact the task belongs to (tasks made by an automation remember their contact).">
          <select value={str("match") || "any"} onChange={(event) => set({ match: event.target.value })}><option value="any">Any task for this account</option><option value="automation">Only tasks created by automations</option><option value="title">Tasks whose title contains…</option></select>
        </Field>
        {config.match === "title" && <Field label="Title contains"><input value={str("titleContains")} onChange={(event) => set({ titleContains: event.target.value })} placeholder="e.g. Call back" maxLength={80} /></Field>}
      </>}
      {config.type === "schedule" && <>
        <Field label="How often?"><select value={str("mode") || "once"} onChange={(event) => set({ mode: event.target.value })}><option value="once">Once</option><option value="recurring">On repeat</option></select></Field>
        {config.mode === "recurring" ? <>
          <Field label="Repeat"><select value={str("repeat") || "daily"} onChange={(event) => set({ repeat: event.target.value })}><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option></select></Field>
          {config.repeat === "weekly" && <Field label="On"><select value={str("weekday") || "1"} onChange={(event) => set({ weekday: Number(event.target.value) })}>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, index) => <option key={day} value={index}>{day}</option>)}</select></Field>}
          {config.repeat === "monthly" && <Field label="Day of the month" hint="1–28"><input type="number" min={1} max={28} value={str("monthDay") || "1"} onChange={(event) => set({ monthDay: Number(event.target.value) })} /></Field>}
          <Field label="At (Irish time)"><input type="time" value={str("time") || "09:00"} onChange={(event) => set({ time: event.target.value })} /></Field>
        </> : <Field label="Date and time (Irish time)"><input type="datetime-local" value={str("at")} onChange={(event) => set({ at: event.target.value })} /></Field>}
        <Field label="Who goes through it?" hint="Leave empty for everyone in this account (up to 500 contacts each time)."><input list="ca-tags" value={str("audienceTag")} onChange={(event) => set({ audienceTag: event.target.value })} placeholder="Only contacts with this tag (optional)" maxLength={60} />{tagList}</Field>
      </>}
    </>;
  } else if (node.type === "send_email") {
    body = <>
      {!options.emailReady && <p className="ca-note">Email sending isn&apos;t set up yet, so this step can be built and tested but won&apos;t send until RESEND_API_KEY and TASK_NOTIFICATION_FROM are added.</p>}
      <Field label="Subject"><input value={str("subject")} onChange={(event) => set({ subject: event.target.value })} placeholder="e.g. Thanks for getting in touch, {{contact.first_name}}" maxLength={200} /></Field>
      <Field label="Message" hint="Plain text. Leave a blank line between paragraphs."><textarea ref={bodyRef} rows={9} value={str("body")} onChange={(event) => set({ body: event.target.value })} placeholder={"Hi {{contact.first_name}},\n\nThanks for your enquiry. We'll be in touch shortly.\n\nThe F2B Media team"} /></Field>
      <div className="ca-chips" aria-label="Insert a personal detail">{MERGE_FIELDS.map((field) => <button key={field.token} type="button" onClick={() => insertMerge(field.token)}>+ {field.label}</button>)}</div>
    </>;
  } else if (node.type === "add_tag" || node.type === "remove_tag") {
    body = <Field label="Tag" hint={node.type === "add_tag" ? "Adding a tag can start other automations." : undefined}><input list="ca-tags" value={str("tag")} onChange={(event) => set({ tag: event.target.value })} placeholder="e.g. booked call" maxLength={60} />{tagList}</Field>;
  } else if (node.type === "move_stage") {
    body = <>
      <Field label="Pipeline"><select value={str("pipelineId")} onChange={(event) => set({ pipelineId: event.target.value, stageId: "" })}><option value="">Choose a pipeline</option>{options.pipelines.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      {pipeline && <Field label="Move to stage" hint="If the contact has no deal in this pipeline yet, one is created."><select value={str("stageId")} onChange={(event) => set({ stageId: event.target.value })}><option value="">Choose a stage</option>{pipeline.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></Field>}
    </>;
  } else if (node.type === "create_task") {
    body = <>
      <Field label="Task title"><input value={str("title")} onChange={(event) => set({ title: event.target.value })} placeholder="e.g. Call {{contact.first_name}} back" maxLength={200} /></Field>
      <Field label="Assign to"><select value={str("assigneeId")} onChange={(event) => set({ assigneeId: event.target.value })}><option value="">Nobody yet</option>{people.length > 0 && <optgroup label="People">{people.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</optgroup>}{bots.length > 0 && <optgroup label="Bots">{bots.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</optgroup>}</select></Field>
      <Field label="Due in (days)" hint="0 means today."><input type="number" min={0} max={365} value={str("dueInDays") || "0"} onChange={(event) => set({ dueInDays: Number(event.target.value) })} /></Field>
      <Field label="Notes (optional)"><textarea rows={4} value={str("notes")} onChange={(event) => set({ notes: event.target.value })} placeholder="Anything the person should know. The contact's details are added automatically." /></Field>
    </>;
  } else if (node.type === "notify") {
    const ids = Array.isArray(config.recipientIds) ? config.recipientIds.map(String) : [];
    body = <>
      <Field label="Alert message"><input value={str("message")} onChange={(event) => set({ message: event.target.value })} placeholder="e.g. New lead: {{contact.full_name}}" maxLength={500} /></Field>
      <fieldset className="ca-field"><span>Who gets it?</span><small>Nobody ticked means the agency owner.</small>
        {people.map((member) => <label key={member.id} className="ca-check"><input type="checkbox" checked={ids.includes(member.id)} onChange={(event) => set({ recipientIds: event.target.checked ? [...ids, member.id] : ids.filter((item) => item !== member.id) })} />{member.name}</label>)}
      </fieldset>
      <label className="ca-check"><input type="checkbox" checked={config.email !== false} onChange={(event) => set({ email: event.target.checked })} />Also send it by email</label>
    </>;
  } else if (node.type === "wait") {
    body = <>
      <Field label="Wait"><select value={str("mode") || "for"} onChange={(event) => set({ mode: event.target.value })}><option value="for">For a set time</option><option value="until">Until a date</option></select></Field>
      {config.mode === "until" ? <Field label="Until (Irish time)"><input type="datetime-local" value={str("until")} onChange={(event) => set({ until: event.target.value })} /></Field>
        : <div className="ca-row"><Field label="How long"><input type="number" min={1} max={525600} value={str("amount") || "1"} onChange={(event) => set({ amount: Number(event.target.value) })} /></Field><Field label="&nbsp;"><select value={str("unit") || "days"} onChange={(event) => set({ unit: event.target.value })}><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option></select></Field></div>}
      <p className="ca-note">Waits are checked every 5 minutes, so a step may run up to 5 minutes later than the exact time.</p>
    </>;
  } else if (node.type === "if_else") {
    const conditions = (config.conditions as ConditionSet) || { match: "all", rules: [] };
    const setRules = (rules: ConditionRule[]) => set({ conditions: { ...conditions, rules } });
    body = <>
      <Field label="Go down the Yes path when"><select value={conditions.match} onChange={(event) => set({ conditions: { ...conditions, match: event.target.value } })}><option value="all">all of these are true</option><option value="any">any of these is true</option></select></Field>
      {conditions.rules.map((rule, index) => {
        const field = CONDITION_FIELDS.find((item) => item.value === rule.field) || CONDITION_FIELDS[0];
        const ops = field.kind === "tag" ? TAG_OPS : field.kind === "stage" ? STAGE_OPS : TEXT_OPS;
        const update = (patch: Partial<ConditionRule>) => setRules(conditions.rules.map((item, at) => (at === index ? { ...item, ...patch } : item)));
        return <div className="ca-rule" key={index}>
          <select aria-label="Field" value={rule.field} onChange={(event) => { const next = CONDITION_FIELDS.find((item) => item.value === event.target.value); update({ field: event.target.value, op: next?.kind === "tag" ? "has" : "is", value: "" }); }}>{CONDITION_FIELDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
          <select aria-label="Check" value={rule.op} onChange={(event) => update({ op: event.target.value })}>{ops.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}</select>
          {field.kind === "stage" ? <select aria-label="Stage" value={rule.value || ""} onChange={(event) => update({ value: event.target.value })}><option value="">Choose a stage</option>{options.pipelines.map((item) => <optgroup key={item.id} label={item.name}>{item.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</optgroup>)}</select>
            : rule.op === "is_empty" || rule.op === "not_empty" ? <span /> : <input aria-label="Value" list={field.kind === "tag" ? "ca-tags" : undefined} value={rule.value || ""} onChange={(event) => update({ value: event.target.value })} placeholder={field.kind === "tag" ? "tag name" : "value"} />}
          <button type="button" className="ca-icon-btn" aria-label="Remove rule" onClick={() => setRules(conditions.rules.filter((_, at) => at !== index))}><X size={14} /></button>
        </div>;
      })}
      {tagList}
      <button type="button" className="secondary-button ca-add-rule" onClick={() => setRules([...conditions.rules, { field: "tag", op: "has", value: "" }])}><Plus size={14} /> Add a rule</button>
    </>;
  }

  return <aside className="ca-panel" aria-label="Edit step" data-no-pan>
    <div className="ca-panel-head"><span className={`ca-node-icon t-${node.type}`}><Icon size={18} /></span><div><small>{node.type === "trigger" ? "Trigger" : "Step"}</small><h3>{nodeTitle({ ...node, config })}</h3></div><button type="button" className="ca-icon-btn" onClick={onCancel} aria-label="Close"><X size={16} /></button></div>
    <div className="ca-panel-body">{body}</div>
    <div className="ca-panel-foot">
      {node.type !== "trigger" && <div className="ca-panel-secondary">
        {node.type !== "if_else" && <button type="button" className="ca-text-btn" onClick={onDuplicate}><Copy size={14} /> Duplicate</button>}
        <button type="button" className="ca-text-btn danger" onClick={onDelete}><Trash2 size={14} /> Delete</button>
      </div>}
      <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
      <button type="button" className="primary-button" onClick={() => onSave(config)}>Save step</button>
    </div>
  </aside>;
}

// ---------- test run ----------
function TestPanel({ id, scope, definition, onClose }: { id: string; scope: string; definition: AutomationDefinition; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<Array<{ id: string; first_name: string; last_name: string; email: string; phone: string }>>([]);
  const [contactId, setContactId] = useState("");
  const [result, setResult] = useState<{ contact: { name: string; email: string }; steps: Array<{ nodeId: string; title: string; status: string; detail: string }> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/crm-automations?scope=${encodeURIComponent(scope)}&contacts=${encodeURIComponent(query)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as { contacts?: typeof contacts };
      setContacts(payload.contacts || []);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, scope]);
  const run = async () => {
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/crm-automations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "testRun", scope, id, contactId, definition }) });
      const payload = await response.json().catch(() => ({})) as typeof result & { error?: string };
      if (!response.ok || !payload) { setError(payload?.error || "The test couldn't run."); return; }
      setResult(payload);
    } finally { setBusy(false); }
  };
  return <aside className="ca-panel" aria-label="Test run" data-no-pan>
    <div className="ca-panel-head"><span className="ca-node-icon t-test"><FlaskConical size={18} /></span><div><small>Safe preview</small><h3>Test run</h3></div><button type="button" className="ca-icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
    <div className="ca-panel-body">
      <p className="ca-note">Pick a contact to see exactly what would happen at each step. Nothing is sent and nothing in the CRM changes.</p>
      <label className="ca-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, email or phone" /></label>
      <div className="ca-contact-list">{contacts.length ? contacts.map((contact) => <button key={contact.id} type="button" className={contactId === contact.id ? "active" : ""} onClick={() => setContactId(contact.id)}><b>{[contact.first_name, contact.last_name].filter(Boolean).join(" ") || "No name"}</b><small>{contact.email || contact.phone || "No email or phone"}</small></button>) : <p className="ca-muted">No contacts found in this account.</p>}</div>
      {error && <p className="ca-error">{error}</p>}
      {result && <ol className="ca-timeline">{result.steps.map((step, index) => <li key={`${step.nodeId}-${index}`} className={step.status}><b>{step.title}</b><p>{step.detail}</p></li>)}</ol>}
    </div>
    <div className="ca-panel-foot"><button type="button" className="primary-button" disabled={!contactId || busy} onClick={run}>{busy ? "Running test…" : "Run test"}</button></div>
  </aside>;
}

// ---------- run history ----------
const statusLabel: Record<string, string> = { running: "Running", waiting: "Waiting", completed: "Finished", failed: "Failed", cancelled: "Stopped" };
function HistoryPanel({ runs, onRefresh, onClose }: { runs: RunRow[]; onRefresh: () => void; onClose: () => void }) {
  const [open, setOpen] = useState("");
  const [steps, setSteps] = useState<StepRow[]>([]);
  const show = async (runId: string) => {
    if (open === runId) { setOpen(""); return; }
    setOpen(runId); setSteps([]);
    const response = await fetch(`/api/crm-automations?runId=${encodeURIComponent(runId)}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as { steps?: StepRow[] };
    setSteps(payload.steps || []);
  };
  const when = (value: string | null) => (value ? new Date(value).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
  return <aside className="ca-panel" aria-label="Run history" data-no-pan>
    <div className="ca-panel-head"><span className="ca-node-icon t-history"><History size={18} /></span><div><small>Last 50 runs</small><h3>Run history</h3></div><button type="button" className="ca-icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
    <div className="ca-panel-body">
      <button type="button" className="ca-text-btn" onClick={onRefresh}>Refresh</button>
      {runs.length === 0 ? <p className="ca-muted">No one has gone through this automation yet. Runs and test runs will show up here.</p> : <ul className="ca-runs">{runs.map((run) => <li key={run.id}>
        <button type="button" onClick={() => show(run.id)} aria-expanded={open === run.id}>
          <span><b>{[run.first_name, run.last_name].filter(Boolean).join(" ") || run.email || "Contact"}</b><small>{run.dry_run ? "Test run · " : ""}{when(run.started_at)}</small></span>
          <em className={`ca-pill ${run.dry_run ? "test" : run.status}`}>{run.dry_run ? "Test" : statusLabel[run.status] || run.status}</em>
        </button>
        {run.error && <p className="ca-error">{run.error}</p>}
        {open === run.id && <ol className="ca-timeline">{steps.length ? steps.map((step) => <li key={step.node_id} className={step.status}><b>{step.title}</b><p>{step.detail}</p><time>{when(step.updated_at)}</time></li>) : <li className="ca-muted">Loading steps…</li>}</ol>}
      </li>)}</ul>}
    </div>
  </aside>;
}
