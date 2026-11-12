"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type SetupKind = "google_ads" | "seo";
type StepStatus = "not_started" | "in_progress" | "needs_approval" | "complete" | "blocked";
type SetupStep = { id: string; status: StepStatus; notes: string; evidence: string; taskId?: string };
type SavedWorkflow = { kind: SetupKind; clientId: string; updatedAt: string; updatedBy: string; steps: SetupStep[] };
type LiveTask = { id: string; title?: string; status?: string; aiRunState?: string; aiProgressText?: string; aiProgressAt?: string; aiRunStartedAt?: string; aiFeedback?: string; aiRunAt?: string; aiNotificationDetail?: string };
type Staff = { id: string; name: string; isBot?: boolean; avatar?: string };
type PlanStep = { id: string; title: string; summary: string; tool: string; gate?: string };
const plans: Record<SetupKind, PlanStep[]> = {
  google_ads: [
    { id: "account_research", title: "Account & business research", summary: "Confirm the linked Ads account, client details, website, goals and account readiness.", tool: "Client record · Google Ads connection" },
    { id: "campaign_strategy", title: "Campaign strategy", summary: "Set campaign type, locations, budget, bidding and conversion goals for review.", tool: "Google Ads · Campaigns", gate: "Approve the strategy before creating campaign structure." },
    { id: "keyword_research", title: "Keyword research", summary: "Research genuine keyword demand, group intent and record match types and negatives.", tool: "Google Ads · Keyword Planner" },
    { id: "campaign_structure", title: "Campaign structure", summary: "Prepare campaigns, ad groups and keyword mapping. Keep new campaigns paused.", tool: "Google Ads · Campaigns", gate: "Campaign changes need explicit approval." },
    { id: "landing_page", title: "Landing page build", summary: "Prepare an editable client-branded landing page using the existing Sites workspace.", tool: "Sites · Landing Pages", gate: "Review the draft before publishing." },
    { id: "relevance", title: "Keyword, ad & page relevance", summary: "Check the path from search intent through ad copy, landing page and conversion action.", tool: "Google Ads · Ads & copy · Sites" },
    { id: "ads_assets", title: "Ads & assets", summary: "Prepare headlines, descriptions, sitelinks and other supported assets for review.", tool: "Google Ads · Ads & copy · All assets", gate: "Preview and approve every proposed asset before applying it." },
    { id: "lead_capture", title: "Forms & lead capture", summary: "Check forms, phone, email, chat and the destination for submitted leads.", tool: "Sites · Forms · CRM" },
    { id: "tracking", title: "Conversion tracking", summary: "Set up supported conversion events and require live evidence before calling them verified.", tool: "Google Ads · Analytics · Sites" },
    { id: "business_profile", title: "Google Business Profile", summary: "Optionally check profile access, locations and eligible location assets.", tool: "Google Business Profile", gate: "Optional · profile changes need approval." },
    { id: "prelaunch_audit", title: "Pre-launch audit", summary: "Review targeting, budget, keywords, assets, landing page, forms and tracking blockers.", tool: "Google Ads audit · Sites" },
    { id: "launch", title: "Launch & verification", summary: "Enable only after final approval, then read back the live status and save the evidence.", tool: "Google Ads · Campaigns", gate: "Never launches without your explicit approval." },
  ],
  seo: [
    { id: "connections", title: "Connections", summary: "Check Search Console, Analytics, Business Profile and WordPress access for this client.", tool: "SEO · Sites · Integrations" },
    { id: "business_research", title: "Business research", summary: "Collect the services, service areas, competitors and existing website details.", tool: "Client record · Website" },
    { id: "technical_audit", title: "Technical SEO audit", summary: "Review crawlability, indexing, speed, metadata, redirects and technical issues.", tool: "SEO · Technical · Sites" },
    { id: "keyword_research", title: "Keyword research", summary: "Use connected provider data for demand, difficulty, relevance and intent.", tool: "SEO · Keyword ideas" },
    { id: "keyword_mapping", title: "Keyword mapping", summary: "Map evidence-backed keywords to existing or proposed pages and avoid cannibalisation.", tool: "SEO · Queries · Pages & content" },
    { id: "content_strategy", title: "Content strategy", summary: "Identify missing service/location pages and prioritised content improvements.", tool: "SEO · Pages & content" },
    { id: "content_creation", title: "SEO content creation", summary: "Draft keyword-aligned content with claims grounded in client facts.", tool: "SEO agent · Sites", gate: "Content stays a draft until approved." },
    { id: "page_building", title: "SEO page building", summary: "Create editable WordPress/Elementor drafts through the existing Sites workspace.", tool: "Sites · SEO Pages", gate: "Do not publish without approval." },
    { id: "on_page", title: "On-page optimisation", summary: "Review titles, descriptions, headings, links, images and structured data.", tool: "Sites · SEO Pages" },
    { id: "local_seo", title: "Local SEO", summary: "Review Business Profile, service areas, local pages and citation opportunities.", tool: "SEO · Local SEO" },
    { id: "backlinks", title: "Backlink research", summary: "Find relevant, legitimate link opportunities and prepare outreach for review.", tool: "SEO · Backlinks", gate: "Outreach requires approval." },
    { id: "tracking_review", title: "Tracking & final review", summary: "Verify source connections, save baselines and agree the approved ongoing plan.", tool: "SEO · Performance · Analytics" },
  ],
};
const emptyStep = (id: string): SetupStep => ({ id, status: "not_started", notes: "", evidence: "" });
const statusLabel: Record<StepStatus, string> = { not_started: "Not started", in_progress: "In progress", needs_approval: "Needs approval", complete: "Complete", blocked: "Blocked" };

export function MarketingSetupWizard({ kind, clientId, clientName, canEdit, agents, onOpenTaskList, onOpenTool, onOpenSites, canOpenSites = false }: { kind: SetupKind; clientId: string; clientName: string; canEdit: boolean; agents: Staff[]; onOpenTaskList: () => void; onOpenTool: (stepId: string) => void; onOpenSites?: () => void; canOpenSites?: boolean }) {
  const plan = plans[kind];
  const [selectedId, setSelectedId] = useState(plan[0].id);
  const [steps, setSteps] = useState<SetupStep[]>(plan.map((step) => emptyStep(step.id)));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [agentId, setAgentId] = useState(agents[0]?.id || "f2b-ai-agent");
  const [starting, setStarting] = useState(false);
  const [linkedTask, setLinkedTask] = useState<LiveTask | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPendingStep = useRef<SetupStep | null>(null);
  const selectedPlan = plan.find((item) => item.id === selectedId) || plan[0];
  const selected = steps.find((item) => item.id === selectedPlan.id) || emptyStep(selectedPlan.id);
  const counts = useMemo(() => ({ complete: steps.filter((item) => item.status === "complete").length, blocked: steps.filter((item) => item.status === "blocked").length, approval: steps.filter((item) => item.status === "needs_approval").length }), [steps]);
  const progress = Math.round(counts.complete / plan.length * 100);

  useEffect(() => {
    setLoading(true); setError(""); setNotice(""); setSelectedId(plan[0].id); setSteps(plan.map((step) => emptyStep(step.id)));
    const controller = new AbortController();
    void fetch(`/api/setup-workflows?kind=${kind}&clientId=${encodeURIComponent(clientId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const result = await response.json() as { workflow?: SavedWorkflow | null; error?: string }; if (!response.ok) throw new Error(result.error || "Could not load this setup."); return result.workflow; })
      .then((workflow) => { if (workflow) setSteps(plan.map((step) => workflow.steps.find((saved) => saved.id === step.id) || emptyStep(step.id))); })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load this setup."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [clientId, kind]);

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  useEffect(() => {
    setLinkedTask(null);
    if (!selected.taskId) return;
    let cancelled = false;
    async function refreshTask() {
      try {
        const response = await fetch("/api/tasks/live", { cache: "no-store" });
        const result = await response.json() as { tasks?: LiveTask[] };
        if (!cancelled) setLinkedTask((result.tasks || []).find((task) => task.id === selected.taskId) || null);
      } catch { if (!cancelled) setLinkedTask(null); }
    }
    void refreshTask();
    const timer = setInterval(() => void refreshTask(), 7000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [selected.taskId]);

  async function saveStep(next: SetupStep) {
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/setup-workflows", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, clientId, step: next }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Could not save the setup step.");
      setNotice(`Saved ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save the setup step."); }
    finally { setSaving(false); }
  }

  function update(patch: Partial<SetupStep>) {
    const next = { ...selected, ...patch };
    setSteps((current) => current.map((item) => item.id === next.id ? next : item));
    latestPendingStep.current = next;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const pending = latestPendingStep.current;
      if (pending) void saveStep(pending);
      latestPendingStep.current = null;
    }, 450);
  }

  function flushPendingSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const pending = latestPendingStep.current;
    latestPendingStep.current = null;
    if (pending) void saveStep(pending);
  }

  async function assignStepToAgent() {
    if (starting || !canEdit) return;
    setStarting(true); setError(""); setNotice("");
    const now = new Date();
    const due = now.toISOString().slice(0, 10);
    const dueAt = new Date(now.getTime() + 60_000).toISOString();
    const taskNotes = [
      `Setup workflow: ${kind === "google_ads" ? "Google Ads" : "SEO"} · ${selectedPlan.title}`,
      `Client: ${clientName}`,
      `Stage goal: ${selectedPlan.summary}`,
      selectedPlan.gate ? `Approval gate: ${selectedPlan.gate}` : "Do not claim completion without evidence.",
      selected.notes ? `Owner context:\n${selected.notes}` : "",
      selected.evidence ? `Existing evidence:\n${selected.evidence}` : "",
      "Work only within the existing connected integrations and the selected client's access. Report completed, blocked, and unverified items separately. Do not publish, launch, or make consequential changes without explicit approval.",
    ].filter(Boolean).join("\n\n");
    try {
      const response = await fetch("/api/assistant/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, service: kind === "google_ads" ? "Google Ads" : "SEO", title: `${selectedPlan.title} · ${clientName}`, due, dueAt, repeat: "None", assigneeId: agentId, notes: taskNotes }) });
      const result = await response.json() as { task?: { id?: string }; error?: string };
      if (!response.ok) throw new Error(result.error || "The AI task could not be assigned.");
      const nextStep = { ...selected, status: "in_progress" as const, taskId: result.task?.id };
      setSteps((current) => current.map((item) => item.id === nextStep.id ? nextStep : item));
      latestPendingStep.current = null;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      await saveStep(nextStep);
      setNotice("AI task assigned to the existing task queue. Its actual run state appears there.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The AI task could not be assigned."); }
    finally { setStarting(false); }
  }

  const selectedIndex = plan.findIndex((step) => step.id === selectedPlan.id);
  const linkedTaskStatus = linkedTask?.aiRunState === "running" ? "AI is working now" : linkedTask?.aiRunState === "scheduled" ? "AI task is queued" : linkedTask?.aiRunState === "completed" ? "AI task finished" : linkedTask?.aiRunState === "needs_review" ? "AI finished · review needed" : linkedTask?.status || "Task created";
  return <section className="marketing-setup marketing-setup-simple" aria-label={`${kind === "google_ads" ? "Google Ads" : "SEO"} setup workspace`}>
    <header className="marketing-setup-head"><div><span className="eyebrow">{kind === "google_ads" ? "GOOGLE ADS" : "SEO"} CHECKLIST</span><h2>{kind === "google_ads" ? "Google Ads setup" : "SEO setup"} · {clientName}</h2><p>Choose a step. Update its status, or assign it to AI.</p></div><div className="marketing-setup-progress"><strong>{counts.complete} / {plan.length}</strong><span>steps complete · {progress}%</span><div className="marketing-setup-progress-track"><i style={{ width: `${progress}%` }} /></div></div></header>
    <div className="marketing-setup-summary"><span>✅ {counts.complete} done</span><span>🟡 {counts.approval} need approval</span><span>⛔ {counts.blocked} blocked</span><span>{saving ? "Saving…" : notice || "Changes save automatically"}</span></div>
    {error && <p className="marketing-setup-error" role="alert">{error}</p>}
    <div className="marketing-setup-simple-layout">
      <nav className="marketing-setup-steps" aria-label="Setup steps">{plan.map((step, index) => { const saved = steps.find((item) => item.id === step.id) || emptyStep(step.id); return <button type="button" key={step.id} className={step.id === selectedPlan.id ? "is-selected" : ""} aria-current={step.id === selectedPlan.id ? "step" : undefined} onClick={() => setSelectedId(step.id)}><span className={`setup-step-marker status-${saved.status}`}>{saved.status === "complete" ? "✓" : index + 1}</span><span className="setup-step-copy"><b>{step.title}</b><small>{statusLabel[saved.status]}</small></span><span className="marketing-setup-step-arrow" aria-hidden="true">›</span></button>; })}</nav>
      <article className="marketing-setup-current"><div className="marketing-setup-current-head"><div><span className={`setup-state status-${selected.status}`}>Step {selectedIndex + 1} · {statusLabel[selected.status]}</span><h3>{selectedPlan.title}</h3><p>{selectedPlan.summary}</p></div><div className="marketing-setup-tool-actions"><span className="setup-tool-label">{selectedPlan.tool}</span><button type="button" className="secondary-button" onClick={() => selectedPlan.id === "landing_page" || selectedPlan.id === "page_building" ? onOpenSites?.() : onOpenTool(selectedPlan.id)} disabled={(selectedPlan.id === "landing_page" || selectedPlan.id === "page_building") && !canOpenSites}>Open related tool</button></div></div>
        {selectedPlan.gate && <p className="marketing-setup-gate">{selectedPlan.gate}</p>}
        <div className="marketing-setup-actions"><label><span>Status</span><select value={selected.status} disabled={!canEdit || loading} onChange={(event) => update({ status: event.target.value as StepStatus })} onBlur={flushPendingSave}><option value="not_started">Not started</option><option value="in_progress">In progress</option><option value="needs_approval">Needs approval</option><option value="complete">Complete</option><option value="blocked">Blocked</option></select></label><label><span>AI agent</span><select value={agentId} disabled={!canEdit || !agents.length} onChange={(event) => setAgentId(event.target.value)}>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label><button type="button" className="primary-button" disabled={!canEdit || starting || loading || !agents.length} onClick={() => void assignStepToAgent()}>{starting ? "Assigning…" : selected.taskId ? "Assign again to AI" : "Assign to AI"}</button><button type="button" className="secondary-button" onClick={onOpenTaskList}>View AI tasks</button></div>
        {selected.taskId && <div className="marketing-setup-task-link" role="status"><b>{linkedTask ? linkedTaskStatus : "AI task linked"}</b><span>{linkedTask?.aiProgressText || linkedTask?.aiFeedback || "Open AI tasks to see the full task and its result."}</span>{linkedTask?.aiProgressAt && <small>Updated {new Date(linkedTask.aiProgressAt).toLocaleString("en-IE")}</small>}</div>}
        <details className="marketing-setup-more"><summary>Notes and evidence <small>Optional context for this step</small></summary><div><label className="marketing-setup-field"><span>Notes</span><textarea value={selected.notes} onChange={(event) => update({ notes: event.target.value })} onBlur={flushPendingSave} maxLength={6000} rows={3} placeholder="Anything the team or AI should know." disabled={!canEdit || loading} /></label><label className="marketing-setup-field"><span>Evidence or result</span><textarea value={selected.evidence} onChange={(event) => update({ evidence: event.target.value })} onBlur={flushPendingSave} maxLength={6000} rows={3} placeholder="Add a link, result, or reason this step is blocked." disabled={!canEdit || loading} /></label></div></details>
        {!canEdit && <p className="marketing-setup-readonly">View only · ask an owner to change this setup.</p>}
      </article>
    </div>
  </section>;
}
