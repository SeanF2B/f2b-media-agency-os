"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { PhoneActionIcon, toPhoneHref, toWhatsAppNumber, WhatsAppActionIcon } from "@/components/contact-action-icons";

type Contact = { id: string; client_id?: string | null; first_name: string; last_name: string; email: string; phone: string; company: string; source: string; notes: string; updated_at: string };
type Stage = { id: string; name: string; position: number; category: "open" | "won" | "lost" };
type Pipeline = { id: string; name: string; description: string; stages: Stage[] };
type Opportunity = { id: string; pipeline_id: string; stage_id: string; contact_id?: string | null; client_id?: string | null; title: string; value: number; currency: string; assigned_to?: string | null; expected_close_date?: string | null; notes: string; first_name?: string; last_name?: string; email?: string; phone?: string; company?: string; stage_name?: string; updated_at: string };
type Payload = { contacts: Contact[]; pipelines: Pipeline[]; opportunities: Opportunity[]; activities: Array<{ id: string; opportunity_id?: string; contact_id?: string; body: string; created_at: string }>; clients: Array<{ id: string; name: string; company?: string; logo?: string; email?: string; phone?: string; contact?: string }>; staff: Array<{ id: string; name: string; avatar?: string }> };
type OpportunityDrag = { id: string; pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number; width: number; source: HTMLElement; preview?: HTMLElement; overStage?: HTMLElement; moved: boolean; removeListeners?: () => void };
type StageDrag = { id: string; pointerId: number; startX: number; startY: number; moved: boolean; overId: string; removeListeners?: () => void };
type DragPointEvent = Pick<PointerEvent, "pointerId" | "clientX" | "clientY" | "preventDefault" | "stopPropagation">;

const empty: Payload = { contacts: [], pipelines: [], opportunities: [], activities: [], clients: [], staff: [] };
const money = (value: number, currency: string) => new Intl.NumberFormat("en-IE", { style: "currency", currency: currency || "EUR", maximumFractionDigits: 0 }).format(Number(value) || 0);

export function CrmView({ onOpenClient }: { onOpenClient: (clientId: string) => void }) {
  const [data, setData] = useState<Payload>(empty);
  const [tab, setTab] = useState<"Pipeline" | "Contacts">("Pipeline");
  const [pipelineId, setPipelineId] = useState("");
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [modal, setModal] = useState<"contact" | "contact-details" | "opportunity" | "pipeline" | "stage" | "edit-stage" | "delete-stage" | "" > ("");
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [editingStage, setEditingStage] = useState<Stage | null>(null);
  const [viewingContact, setViewingContact] = useState<Opportunity | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draggingId, setDraggingId] = useState("");
  const [droppedId, setDroppedId] = useState("");
  const [draggingStageId, setDraggingStageId] = useState("");
  const [stageDropTargetId, setStageDropTargetId] = useState("");
  const dragRef = useRef<OpportunityDrag | null>(null);
  const stageDragRef = useRef<StageDrag | null>(null);
  useEffect(() => {
    const clearDragSelection = () => document.body.classList.remove("agency-card-drag-active");
    window.addEventListener("blur", clearDragSelection);
    document.addEventListener("pointercancel", clearDragSelection, true);
    return () => {
      window.removeEventListener("blur", clearDragSelection);
      document.removeEventListener("pointercancel", clearDragSelection, true);
      clearDragSelection();
    };
  }, []);

  const load = useCallback(async () => {
    const params = new URLSearchParams(); if (search.trim()) params.set("search", search.trim());
    const response = await fetch(`/api/crm?${params}`, { cache: "no-store" });
    const result = await response.json() as Payload & { error?: string };
    if (!response.ok) throw new Error(result.error || "CRM could not be loaded.");
    setData(result); setPipelineId((current) => result.pipelines.some((item) => item.id === current) ? current : result.pipelines[0]?.id || "");
  }, [search]);
  useEffect(() => {
    let current = true;
    const params = new URLSearchParams(); if (search.trim()) params.set("search", search.trim());
    void fetch(`/api/crm?${params}`, { cache: "no-store" }).then(async (response) => {
      const result = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(result.error || "CRM could not be loaded.");
      if (current) { setData(result); setPipelineId((selected) => result.pipelines.some((item) => item.id === selected) ? selected : result.pipelines[0]?.id || ""); }
    }).catch((reason) => { if (current) setError(reason instanceof Error ? reason.message : "CRM could not be loaded."); });
    return () => { current = false; };
  }, [search]);

  const save = async (payload: Record<string, unknown>) => {
    setBusy(true); setError("");
    try { const response = await fetch("/api/crm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); const result = await response.json() as { error?: string }; if (!response.ok) throw new Error(result.error || "Could not save this CRM change."); await load(); setModal(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save this CRM change."); }
    finally { setBusy(false); }
  };

  const pipeline = data.pipelines.find((item) => item.id === pipelineId) || data.pipelines[0];
  const viewingClient = data.clients.find((client) => client.id === viewingContact?.client_id);
  const opportunities = useMemo(() => data.opportunities.filter((item) => (!pipeline || item.pipeline_id === pipeline.id) && (!clientFilter || item.client_id === clientFilter)), [data.opportunities, pipeline, clientFilter]);
  const visibleContacts = useMemo(() => data.contacts.filter((item) => (!clientFilter || item.client_id === clientFilter) && (!search.trim() || [item.first_name, item.last_name, item.email, item.company, item.phone].some((value) => String(value || "").toLowerCase().includes(search.trim().toLowerCase())))), [data.contacts, clientFilter, search]);
  const personName = (item: Opportunity) => [item.first_name, item.last_name].filter(Boolean).join(" ") || item.email || "No contact linked";

  const moveOpportunity = async (id: string, stageId: string) => {
    const previousStage = data.opportunities.find((item) => item.id === id)?.stage_id;
    if (!previousStage || previousStage === stageId) return;
    setError("");
    setData((current) => ({ ...current, opportunities: current.opportunities.map((item) => item.id === id ? { ...item, stage_id: stageId, updated_at: new Date().toISOString() } : item) }));
    try {
      const response = await fetch("/api/crm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "moveOpportunity", id, stageId }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not move this opportunity.");
    } catch (reason) {
      setData((current) => ({ ...current, opportunities: current.opportunities.map((item) => item.id === id && item.stage_id === stageId ? { ...item, stage_id: previousStage } : item) }));
      setError(reason instanceof Error ? reason.message : "Could not move this opportunity.");
    }
  };
  const updateOpportunityMeta = async (item: Opportunity, patch: { assigned_to?: string | null; expected_close_date?: string | null }) => {
    const previous = { assigned_to: item.assigned_to, expected_close_date: item.expected_close_date };
    setError("");
    setData((current) => ({ ...current, opportunities: current.opportunities.map((entry) => entry.id === item.id ? { ...entry, ...patch, updated_at: new Date().toISOString() } : entry) }));
    try {
      const response = await fetch("/api/crm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "updateOpportunityMeta", id: item.id, assignedTo: Object.hasOwn(patch, "assigned_to") ? patch.assigned_to || "" : item.assigned_to || "", expectedCloseDate: Object.hasOwn(patch, "expected_close_date") ? patch.expected_close_date || "" : item.expected_close_date || "" }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not update this opportunity.");
    } catch (reason) {
      setData((current) => ({ ...current, opportunities: current.opportunities.map((entry) => entry.id === item.id ? { ...entry, ...previous } : entry) }));
      setError(reason instanceof Error ? reason.message : "Could not update this opportunity.");
    }
  };

  const swapStages = async (stage: Stage, other: Stage) => {
    if (!pipeline) return;
    setError("");
    const original = pipeline.stages;
    const next = [...original];
    const from = next.findIndex((item) => item.id === stage.id), to = next.findIndex((item) => item.id === other.id);
    if (from < 0 || to < 0) return;
    [next[from], next[to]] = [next[to], next[from]];
    setData((current) => ({ ...current, pipelines: current.pipelines.map((item) => item.id === pipeline.id ? { ...item, stages: next.map((entry, position) => ({ ...entry, position })) } : item) }));
    try {
      const response = await fetch("/api/crm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "swapStages", pipelineId: pipeline.id, stageId: stage.id, otherStageId: other.id }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not reorder these stages.");
    } catch (reason) {
      setData((current) => ({ ...current, pipelines: current.pipelines.map((item) => item.id === pipeline.id ? { ...item, stages: original } : item) }));
      setError(reason instanceof Error ? reason.message : "Could not reorder these stages.");
    }
  };

  const reorderStages = async (sourceId: string, targetId: string) => {
    if (!pipeline || !sourceId || sourceId === targetId) return;
    const original = pipeline.stages;
    const next = [...original];
    const from = next.findIndex((item) => item.id === sourceId);
    const to = next.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const ordered = next.map((entry, position) => ({ ...entry, position }));
    setData((current) => ({ ...current, pipelines: current.pipelines.map((item) => item.id === pipeline.id ? { ...item, stages: ordered } : item) }));
    setError("");
    try {
      const response = await fetch("/api/crm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reorderStages", pipelineId: pipeline.id, stageIds: ordered.map((entry) => entry.id) }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not reorder these stages.");
    } catch (reason) {
      setData((current) => ({ ...current, pipelines: current.pipelines.map((item) => item.id === pipeline.id ? { ...item, stages: original } : item) }));
      setError(reason instanceof Error ? reason.message : "Could not reorder these stages.");
    }
  };

  const beginStagePointerDrag = (event: ReactPointerEvent<HTMLButtonElement>, stageId: string) => {
    if (event.button !== 0 || stageDragRef.current) return;
    event.preventDefault();
    const drag: StageDrag = { id: stageId, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false, overId: "" };
    stageDragRef.current = drag;
    const onMove = (pointerEvent: PointerEvent) => {
      if (stageDragRef.current !== drag || pointerEvent.pointerId !== drag.pointerId) return;
      if (!drag.moved && Math.hypot(pointerEvent.clientX - drag.startX, pointerEvent.clientY - drag.startY) < 6) return;
      pointerEvent.preventDefault();
      if (!drag.moved) { drag.moved = true; setDraggingStageId(drag.id); }
      const target = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)?.closest<HTMLElement>(".crm-stage[data-crm-stage]");
      const nextTargetId = target?.dataset.crmStage || "";
      if (drag.overId !== nextTargetId) { drag.overId = nextTargetId; setStageDropTargetId(nextTargetId); }
    };
    const clear = () => {
      drag.removeListeners?.();
      if (stageDragRef.current === drag) stageDragRef.current = null;
      setDraggingStageId("");
      setStageDropTargetId("");
    };
    const onUp = (pointerEvent: PointerEvent) => {
      if (stageDragRef.current !== drag || pointerEvent.pointerId !== drag.pointerId) return;
      if (drag.moved && drag.overId && drag.overId !== drag.id) void reorderStages(drag.id, drag.overId);
      clear();
    };
    const onCancel = (pointerEvent: PointerEvent) => { if (pointerEvent.pointerId === drag.pointerId) clear(); };
    window.addEventListener("pointermove", onMove, { capture: true, passive: false });
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onCancel, true);
    drag.removeListeners = () => { window.removeEventListener("pointermove", onMove, true); window.removeEventListener("pointerup", onUp, true); window.removeEventListener("pointercancel", onCancel, true); };
  };

  const initializeDrag = (card: HTMLElement, pointerId: number, clientX: number, clientY: number) => {
    const rect = card.getBoundingClientRect();
    dragRef.current = { id: card.dataset.opportunityId || "", pointerId, startX: clientX, startY: clientY, offsetX: clientX - rect.left, offsetY: clientY - rect.top, width: rect.width, source: card, moved: false };
  };
  const isOpportunityControl = (target: EventTarget | null) => target instanceof HTMLElement && Boolean(target.closest("button,select,a,input,textarea,label,details,summary"));
  const moveDrag = (event: DragPointEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 7) return;
    event.preventDefault();
    if (!drag.moved) {
      drag.moved = true;
      window.getSelection()?.removeAllRanges();
      document.body.classList.add("agency-card-drag-active");
      const preview = drag.source.cloneNode(true) as HTMLElement;
      preview.classList.remove("is-dragging", "is-just-dropped");
      preview.classList.add("crm-opportunity-drag-preview");
      preview.removeAttribute("draggable");
      preview.setAttribute("aria-hidden", "true");
      preview.querySelectorAll<HTMLElement>("[id]").forEach((node) => node.removeAttribute("id"));
      const originalNodes = [drag.source, ...Array.from(drag.source.querySelectorAll<HTMLElement>("*"))];
      const previewNodes = [preview, ...Array.from(preview.querySelectorAll<HTMLElement>("*"))];
      originalNodes.forEach((node, index) => {
        const target = previewNodes[index];
        if (!target) return;
        const style = window.getComputedStyle(node);
        for (let i = 0; i < style.length; i += 1) {
          const property = style.item(i);
          target.style.setProperty(property, style.getPropertyValue(property));
        }
      });
      drag.source.classList.add("is-dragging");
      preview.style.position = "fixed";
      preview.style.left = `${event.clientX - drag.offsetX}px`;
      preview.style.top = `${event.clientY - drag.offsetY}px`;
      preview.style.width = `${drag.width}px`;
      preview.style.margin = "0";
      preview.style.zIndex = "2147483000";
      preview.style.pointerEvents = "none";
      preview.style.opacity = "1";
      preview.style.transform = "scale(1.025) rotate(-.4deg)";
      preview.style.boxShadow = "0 18px 40px rgba(9,30,48,.28),0 4px 12px rgba(30,137,190,.2)";
      document.body.appendChild(preview);
      drag.preview = preview;
      setDraggingId(drag.id);
    }
    if (drag.preview) {
      drag.preview.style.left = `${event.clientX - drag.offsetX}px`;
      drag.preview.style.top = `${event.clientY - drag.offsetY}px`;
    }
    const overStage = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(".crm-stage[data-crm-stage]") || undefined;
    if (drag.overStage !== overStage) {
      drag.overStage?.classList.remove("is-drop-target");
      overStage?.classList.add("is-drop-target");
      drag.overStage = overStage;
    }
  };
  const finishDrag = (event: DragPointEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (drag.moved) {
      event.preventDefault();
      event.stopPropagation();
      const stage = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(".crm-stage[data-crm-stage]") || drag.overStage || Array.from(document.querySelectorAll<HTMLElement>(".crm-stage[data-crm-stage]")).find((column) => {
        const rect = column.getBoundingClientRect();
        return event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      });
      const stageId = stage?.dataset.crmStage;
      if (stageId) {
        setDroppedId(drag.id);
        window.setTimeout(() => setDroppedId((current) => current === drag.id ? "" : current), 450);
        void moveOpportunity(drag.id, stageId);
      }
    }
    drag.removeListeners?.();
    drag.preview?.remove();
    drag.source.classList.remove("is-dragging");
    drag.overStage?.classList.remove("is-drop-target");
    document.body.classList.remove("agency-card-drag-active");
    setDraggingId("");
  };
  const cancelDrag = (event: DragPointEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    drag.removeListeners?.();
    drag.preview?.remove();
    drag.source.classList.remove("is-dragging");
    drag.overStage?.classList.remove("is-drop-target");
    document.body.classList.remove("agency-card-drag-active");
    setDraggingId("");
  };
  const beginMouseDrag = (event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0 || isOpportunityControl(event.target)) return;
    initializeDrag(event.currentTarget, -1, event.clientX, event.clientY);
    const asDragPoint = (mouseEvent: MouseEvent): DragPointEvent => ({ pointerId: -1, clientX: mouseEvent.clientX, clientY: mouseEvent.clientY, preventDefault: () => mouseEvent.preventDefault(), stopPropagation: () => mouseEvent.stopPropagation() });
    const onMove = (mouseEvent: MouseEvent) => moveDrag(asDragPoint(mouseEvent));
    const onUp = (mouseEvent: MouseEvent) => finishDrag(asDragPoint(mouseEvent));
    window.addEventListener("mousemove", onMove, { capture: true, passive: false });
    window.addEventListener("mouseup", onUp, true);
    dragRef.current!.removeListeners = () => { window.removeEventListener("mousemove", onMove, true); window.removeEventListener("mouseup", onUp, true); };
  };
  const beginPointerDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" || event.button !== 0 || isOpportunityControl(event.target)) return;
    initializeDrag(event.currentTarget, event.pointerId, event.clientX, event.clientY);
    const onMove = (pointerEvent: PointerEvent) => moveDrag(pointerEvent);
    const onUp = (pointerEvent: PointerEvent) => finishDrag(pointerEvent);
    const onCancel = (pointerEvent: PointerEvent) => cancelDrag(pointerEvent);
    window.addEventListener("pointermove", onMove, { capture: true, passive: false });
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onCancel, true);
    dragRef.current!.removeListeners = () => { window.removeEventListener("pointermove", onMove, true); window.removeEventListener("pointerup", onUp, true); window.removeEventListener("pointercancel", onCancel, true); };
  };

  return <section className="crm-workspace">
    <header className="crm-heading"><div><span className="crm-eyebrow">SALES WORKSPACE</span><h1>Pipeline</h1><p>Keep contacts and your sales pipeline together.</p></div><div className="crm-actions"><button type="button" className="primary-button" onClick={() => { setEditingContact(null); setModal(tab === "Contacts" ? "contact" : "opportunity"); }}>＋ {tab === "Contacts" ? "Add contact" : "New opportunity"}</button></div></header>
    <nav className="crm-tabs" role="tablist" aria-label="CRM sections">{(["Contacts", "Pipeline"] as const).map((item) => <button type="button" role="tab" aria-selected={tab === item} className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item === "Contacts" ? "👥" : "🔀"} {item}</button>)}</nav>
    <div className="crm-toolbar"><label>Search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, email, company…" /></label><label>Client<select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}><option value="">All clients</option>{data.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>{tab === "Pipeline" && <><label>Pipeline<select value={pipeline?.id || ""} onChange={(event) => setPipelineId(event.target.value)}>{data.pipelines.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button type="button" className="secondary-button" onClick={() => setModal("stage")} disabled={!pipeline}>＋ Add stage</button><button type="button" className="secondary-button" onClick={() => setModal("pipeline")}>＋ New pipeline</button></>}</div>
    {error && <div className="crm-error" role="alert">{error}</div>}
    {tab === "Pipeline" && <div className="crm-kanban" style={{ "--crm-stage-count": Math.max(pipeline?.stages.length || 1, 1) } as CSSProperties}>{pipeline?.stages.map((stage, stageIndex) => <section className={`crm-stage ${stage.category} ${draggingStageId === stage.id ? "is-stage-being-dragged" : ""} ${stageDropTargetId === stage.id ? "is-stage-drop-target" : ""}`} data-crm-stage={stage.id} key={stage.id}><header className={`crm-stage-header ${stageDropTargetId === stage.id ? "is-stage-drop-target" : ""}`} onDragOver={(event) => { if (!draggingStageId) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setStageDropTargetId(stage.id); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setStageDropTargetId(""); }} onDrop={(event) => { if (!draggingStageId) return; event.preventDefault(); const sourceId = event.dataTransfer.getData("text/plain") || draggingStageId; setDraggingStageId(""); setStageDropTargetId(""); void reorderStages(sourceId, stage.id); }}><div className="crm-stage-title"><div className="crm-stage-heading"><button type="button" className="crm-stage-drag-handle" onPointerDown={(event) => beginStagePointerDrag(event, stage.id)} aria-label={`Drag to reorder ${stage.name}`} title="Drag to reorder stage">⠿</button><h2>{stage.name}</h2></div><span>{opportunities.filter((item) => item.stage_id === stage.id).length}</span></div><div className="crm-stage-actions"><button type="button" className="crm-stage-action" aria-label={`Move ${stage.name} left`} title="Move stage left" disabled={stageIndex === 0} onClick={() => { const other = pipeline!.stages[stageIndex - 1]; if (other) void swapStages(stage, other); }}>←</button><button type="button" className="crm-stage-action" aria-label={`Move ${stage.name} right`} title="Move stage right" disabled={stageIndex === (pipeline?.stages.length || 1) - 1} onClick={() => { const other = pipeline!.stages[stageIndex + 1]; if (other) void swapStages(stage, other); }}>→</button><button type="button" className="crm-stage-action" aria-label={`Rename ${stage.name}`} title="Rename stage" onClick={() => { setEditingStage(stage); setModal("edit-stage"); }}>✎</button><button type="button" className="crm-stage-action danger" aria-label={`Delete ${stage.name}`} title="Delete stage" onClick={() => { setEditingStage(stage); setModal("delete-stage"); }}>×</button></div></header>{opportunities.filter((item) => item.stage_id === stage.id).map((item) => { const linkedClient = data.clients.find((client) => client.id === item.client_id); const contact = linkedClient?.contact?.trim() || personName(item); const companyName = linkedClient?.company?.trim() || item.company?.trim() || linkedClient?.name || ""; const email = linkedClient?.email?.trim() || item.email || ""; const phoneValue = linkedClient?.phone?.trim() || item.phone || ""; const whatsappNumber = toWhatsAppNumber(phoneValue); const assignedStaff = data.staff.find((member) => member.id === item.assigned_to); const hasContactDetails = Boolean(companyName || contact || email || phoneValue || linkedClient?.logo); return <article data-opportunity-id={item.id} className={`crm-opportunity ${draggingId === item.id ? "is-dragging" : ""} ${droppedId === item.id ? "is-just-dropped" : ""}`} key={item.id} draggable={false} onMouseDown={beginMouseDrag} onPointerDown={beginPointerDrag}><div className="crm-opportunity-heading"><span className="crm-opportunity-icon" aria-hidden="true">💼</span><b>{item.title}</b></div>{hasContactDetails && <div className="crm-opportunity-client"><div className={`crm-opportunity-client-logo ${linkedClient?.logo ? "has-logo" : ""}`}>{linkedClient?.logo ? <img src={linkedClient.logo} alt={`${linkedClient.name} logo`} /> : <span aria-hidden="true">🏢</span>}</div><div className="crm-opportunity-client-info">{companyName && <b title={companyName}>{companyName}</b>}{contact && <span title={contact}>{contact}</span>}{email && <a className="crm-opportunity-contact-link" href={`mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`Following up: ${item.title}`)}`} title={email}><span aria-hidden="true">✉</span><span className="crm-contact-value">{email}</span></a>}{phoneValue && <div className="crm-opportunity-phone"><a className="crm-opportunity-contact-link crm-phone-number" href={toPhoneHref(phoneValue)} title={`Call ${phoneValue}`}><PhoneActionIcon className="crm-contact-inline-icon" /><span className="crm-contact-value">{phoneValue}</span></a><a className="crm-opportunity-contact-link whatsapp crm-contact-icon-only" href={`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(`Hi ${contact || companyName}, following up about ${item.title}.`)}`} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${phoneValue}`} title={`WhatsApp ${phoneValue}`}><WhatsAppActionIcon className="crm-contact-inline-icon" /></a></div>}</div></div>}<div className="crm-opportunity-value"><span aria-hidden="true">💰</span><strong>{money(item.value, item.currency)}</strong></div>{item.expected_close_date && <small className="crm-opportunity-target"><span aria-hidden="true">📅</span> Target {item.expected_close_date}</small>}<div className="crm-card-shortcuts" aria-label="Client and contact shortcuts">{linkedClient && <button type="button" className="crm-stage-action" title={`Open ${linkedClient.name} client profile`} aria-label={`Open ${linkedClient.name} client profile`} onClick={() => onOpenClient(linkedClient.id)}>🏢</button>}<button type="button" className="crm-stage-action" title={`View ${contact} contact details`} aria-label={`View ${contact} contact details`} onClick={() => { setViewingContact(item); setModal("contact-details"); }}>👤</button></div><div className="crm-opportunity-meta-controls"><label className="crm-opportunity-assignee" title="Assigned teammate"><span className="crm-assignee-avatar" aria-hidden="true">{assignedStaff?.avatar ? <img src={assignedStaff.avatar} alt="" /> : (assignedStaff?.name || "?").split(/\s+/).map((part) => part[0]).join("").slice(0, 2)}</span><select aria-label={`Assign ${item.title}`} value={item.assigned_to || ""} onChange={(event) => void updateOpportunityMeta(item, { assigned_to: event.target.value || null })}><option value="">Unassigned</option>{data.staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><label title="Target date"><span aria-hidden="true">📅</span><input type="date" aria-label={`Set target date for ${item.title}`} value={item.expected_close_date?.slice(0, 10) || ""} onChange={(event) => void updateOpportunityMeta(item, { expected_close_date: event.target.value || null })} /></label></div><details><summary>Notes & activity ({data.activities.filter((note) => note.opportunity_id === item.id).length})</summary>{item.notes && <p>{item.notes}</p>}{data.activities.filter((note) => note.opportunity_id === item.id).map((note) => <p key={note.id}>{note.body}<small> · {new Date(note.created_at).toLocaleString("en-IE")}</small></p>)}<form onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const text = String(new FormData(form).get("body") || "").trim(); if (text) { void save({ action: "addActivity", opportunityId: item.id, body: text }); form.reset(); } }}><textarea name="body" rows={2} placeholder="Add a follow-up note" required /><button type="submit" className="secondary-button">＋ Add note</button></form></details><label className="crm-move"><span aria-hidden="true">📌</span> Move to<select value={item.stage_id} onChange={(event) => void moveOpportunity(item.id, event.target.value)}>{pipeline!.stages.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label></article>; })}{!opportunities.some((item) => item.stage_id === stage.id) && <div className="crm-empty-stage">Drop an opportunity here</div>}</section>)}</div>}
    {tab === "Contacts" && <div className="crm-table-wrap"><table className="crm-table"><thead><tr><th>Contact</th><th>Company</th><th>Client</th><th>Source</th><th>Updated</th><th></th></tr></thead><tbody>{visibleContacts.map((contact) => <tr key={contact.id}><td><b>{[contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Unnamed contact"}</b><small>{contact.email}{contact.phone ? ` · ${contact.phone}` : ""}</small><details><summary>Notes & activity ({data.activities.filter((note) => note.contact_id === contact.id).length})</summary>{contact.notes && <small>{contact.notes}</small>}{data.activities.filter((note) => note.contact_id === contact.id).map((note) => <small key={note.id}>{note.body} · {new Date(note.created_at).toLocaleDateString("en-IE")}</small>)}<form onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const text = String(new FormData(form).get("body") || "").trim(); if (text) { void save({ action: "addActivity", contactId: contact.id, body: text }); form.reset(); } }}><textarea name="body" rows={2} placeholder="Add a contact note" required /><button type="submit" className="secondary-button">＋ Add note</button></form></details></td><td>{contact.company || "—"}</td><td>{data.clients.find((item) => item.id === contact.client_id)?.name || "—"}</td><td>{contact.source}</td><td>{new Date(contact.updated_at).toLocaleDateString("en-IE")}</td><td><button type="button" className="secondary-button" onClick={() => { setEditingContact(contact); setModal("contact"); }}>Edit</button></td></tr>)}</tbody></table>{!visibleContacts.length && <p className="crm-empty">No contacts yet. Add a contact or connect a form to start building your list.</p>}</div>}
    {!data.pipelines.length && tab === "Pipeline" && <p className="crm-empty">Loading your first sales pipeline…</p>}

    {modal && <div className="crm-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(""); }}><form className="crm-modal" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const read = (key: string) => String(form.get(key) || ""); if (modal === "contact") void save({ action: "saveContact", id: read("id"), firstName: read("firstName"), lastName: read("lastName"), email: read("email"), phone: read("phone"), company: read("company"), clientId: read("clientId"), notes: read("notes") }); if (modal === "opportunity") void save({ action: "createOpportunity", title: read("title"), pipelineId: pipeline?.id, stageId: read("stageId"), contactId: read("contactId"), clientId: read("clientId"), assignedTo: read("assignedTo"), value: read("value"), expectedCloseDate: read("expectedCloseDate"), notes: read("notes") }); if (modal === "pipeline") void save({ action: "createPipeline", name: read("name"), description: read("description"), stages: read("stages").split(",").map((x) => x.trim()).filter(Boolean) }); if (modal === "stage") void save({ action: "createStage", pipelineId: pipeline?.id, name: read("name") }); if (modal === "edit-stage" && editingStage) void save({ action: "updateStage", pipelineId: pipeline?.id, stageId: editingStage.id, name: read("name") }); if (modal === "delete-stage" && editingStage) void save({ action: "deleteStage", pipelineId: pipeline?.id, stageId: editingStage.id, moveToStageId: read("moveToStageId") }); }}>
      <h2>{modal === "contact" ? "Add contact" : modal === "contact-details" ? "Contact details" : modal === "opportunity" ? "New opportunity" : modal === "pipeline" ? "Create pipeline" : modal === "stage" ? "Add pipeline stage" : modal === "edit-stage" ? "Rename stage" : "Delete stage"}</h2>
      {modal === "contact" && <><input type="hidden" name="id" value={editingContact?.id || ""} /><div className="crm-form-grid"><label>First name<input name="firstName" defaultValue={editingContact?.first_name} /></label><label>Last name<input name="lastName" defaultValue={editingContact?.last_name} /></label><label>Email<input type="email" name="email" defaultValue={editingContact?.email} /></label><label>Phone<input name="phone" defaultValue={editingContact?.phone} /></label><label>Company<input name="company" defaultValue={editingContact?.company} /></label><label>Client<select name="clientId" defaultValue={editingContact?.client_id || ""}><option value="">No client</option>{data.clients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div><label>Notes<textarea name="notes" rows={3} defaultValue={editingContact?.notes} /></label></>}
      {modal === "contact-details" && viewingContact && <div className="crm-contact-detail-card"><b>{viewingClient?.contact || personName(viewingContact)}</b>{viewingClient?.name && <p>{viewingClient.name}</p>}{viewingClient?.email || viewingContact.email ? <p><span>Email</span><a href={`mailto:${encodeURIComponent(viewingClient?.email || viewingContact.email || "")}`}>{viewingClient?.email || viewingContact.email}</a></p> : null}{viewingClient?.phone || viewingContact.phone ? <p><span>Phone</span><a href={`tel:${(viewingClient?.phone || viewingContact.phone || "").replace(/[^+\d]/g, "")}`}>{viewingClient?.phone || viewingContact.phone}</a></p> : null}{viewingContact.notes && <p><span>Notes</span>{viewingContact.notes}</p>}{viewingContact.client_id && <button type="button" className="secondary-button" onClick={() => { setModal(""); onOpenClient(viewingContact.client_id!); }}>🏢 Open {data.clients.find((item) => item.id === viewingContact.client_id)?.name || "client"}</button>}</div>}
      {modal === "opportunity" && <><label>Opportunity name<input name="title" required /></label><div className="crm-form-grid"><label>Contact<select name="contactId"><option value="">No contact linked</option>{data.contacts.map((item) => <option key={item.id} value={item.id}>{[item.first_name, item.last_name].filter(Boolean).join(" ") || item.email}</option>)}</select></label><label>Client<select name="clientId"><option value="">No client</option>{data.clients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Stage<select name="stageId">{pipeline?.stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Assigned to<select name="assignedTo"><option value="">Unassigned</option>{data.staff.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Value (€)<input type="number" name="value" min="0" step="0.01" defaultValue="0" /></label><label>Target close date<input type="date" name="expectedCloseDate" /></label></div><label>Notes<textarea name="notes" rows={3} /></label></>}
      {modal === "pipeline" && <><label>Name<input name="name" required /></label><label>Description<input name="description" /></label><label>Stages, in order<input name="stages" defaultValue="New lead, Contacted, Qualified, Appointment booked, Proposal sent, Won, Lost" /><small>Separate stages with commas. Won and Lost stages are added if missing.</small></label></>}
      {modal === "stage" && <><p>Add a stage to {pipeline?.name || "this pipeline"}. You can name it anything that fits your sales process.</p><label>Stage name<input name="name" maxLength={80} placeholder="e.g. Needs follow-up" required autoFocus /></label></>}
      {modal === "edit-stage" && editingStage && <><p>Change the name of this stage. Opportunities already in it will stay in place.</p><label>Stage name<input name="name" maxLength={80} defaultValue={editingStage.name} required autoFocus /></label></>}
      {modal === "delete-stage" && editingStage && <>{(() => { const count = opportunities.filter((item) => item.stage_id === editingStage.id).length; const targets = pipeline?.stages.filter((item) => item.id !== editingStage.id) || []; return <><p>Delete <b>{editingStage.name}</b> from {pipeline?.name || "this pipeline"}?{count ? ` Its ${count} ${count === 1 ? "opportunity will" : "opportunities will"} be moved first.` : " This stage is empty."}</p>{count > 0 && <label>Move opportunities to<select name="moveToStageId" defaultValue={targets[0]?.id} required>{targets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</>; })()}</>}
      <footer><button type="button" className="secondary-button" onClick={() => setModal("")}>{modal === "contact-details" ? "Close" : "Cancel"}</button>{modal !== "contact-details" && <button type="submit" className={modal === "delete-stage" ? "danger-button" : "primary-button"} disabled={busy}>{busy ? "Saving…" : modal === "delete-stage" ? "Delete stage" : "Save"}</button>}</footer>
    </form></div>}
  </section>;
}
