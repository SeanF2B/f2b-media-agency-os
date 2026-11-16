"use client";
// Leads → Outreach. Four compact tabs: Overview · Campaigns · Inbox · Infrastructure.
// Every animation reflects real backend state (polling while jobs run); nothing is simulated.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, CalendarClock, Check, ChevronRight, Copy, Inbox, LayoutDashboard, Mail, Pause, Play, Plus, Rocket, Send, Server, Settings2, Sparkles, Upload, Wand2, X } from "lucide-react";
import { lintEmail } from "@/lib/outreach/copy-engine.mjs";
import { ago, LABELS, money, num, outreachAction, outreachGet, pct, type Campaign, type OutreachState, type Step, type Variant } from "./outreach-api";
import { FlameMeter, HealthPill, InfrastructurePanel, PlaybookDrawer, SettingsDrawer } from "./outreach-infrastructure";
import "./outreach.css";

type Tab = "overview" | "campaigns" | "inbox" | "infrastructure";
type LeadList = { id: string; name: string; count: number };
const TABS: Array<[Tab, string, typeof LayoutDashboard]> = [["overview", "Overview", LayoutDashboard], ["campaigns", "Campaigns", Rocket], ["inbox", "Inbox", Inbox], ["infrastructure", "Infrastructure", Server]];

export function OutreachView({ clients = [], leadLists = [] }: { clients?: Array<{ id: string; name: string }>; leadLists?: LeadList[] }) {
  const initial = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const [tab, setTab] = useState<Tab>((["overview", "campaigns", "inbox", "infrastructure"] as Tab[]).find((item) => item === initial.get("outreachTab")) || (initial.get("reply") ? "inbox" : "overview"));
  const [state, setState] = useState<OutreachState | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(initial.get("seed") || "");
  const [range, setRange] = useState({ from: "", to: "", campaign: "", preset: "30" });
  const [drawer, setDrawer] = useState<"" | "playbook" | "settings">("");
  const [costs, setCosts] = useState(false);

  const load = useCallback(async (withCosts = costs) => {
    try { setState(await outreachGet({ from: range.from, to: range.to, campaign: range.campaign, costs: withCosts ? "1" : "" })); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load Outreach."); }
  }, [range.from, range.to, range.campaign, costs]);
  useEffect(() => { void load(); }, [load]);
  // Live progress: poll only while provisioning is genuinely running.
  const running = Boolean(state?.jobs.some((job) => job.status === "running"));
  useEffect(() => { if (!running) return; const timer = window.setInterval(() => void load(), 5000); return () => window.clearInterval(timer); }, [running, load]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(""), 4500); return () => window.clearTimeout(timer); }, [toast]);

  const act = useCallback(async <T,>(action: string, body: Record<string, unknown> = {}, success?: string): Promise<T | null> => {
    try { const result = await outreachAction<T>(action, body); if (success) setToast(success); await load(); return result; }
    catch (reason) { setToast(""); setError(reason instanceof Error ? reason.message : "That didn't work."); return null; }
  }, [load]);

  return <section className="ox" aria-label="Outreach">
    <div className="ox-bar">
      <nav className="ox-tabs" role="tablist" aria-label="Outreach sections">
        {TABS.map(([key, label, Icon]) => <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? "on" : ""} onClick={() => setTab(key)}><Icon size={15} aria-hidden="true" /> {label}{key === "inbox" && state?.overview.reviewQueue ? <span className="ox-dot" aria-label={`${state.overview.reviewQueue} to review`}>{state.overview.reviewQueue}</span> : null}</button>)}
      </nav>
      <div className="ox-bar-actions">
        <button type="button" className="ox-icon" onClick={() => setDrawer("playbook")} title="AI Playbook" aria-label="AI Playbook"><BookOpen size={17} /></button>
        <button type="button" className="ox-icon" onClick={() => setDrawer("settings")} title="Outreach settings" aria-label="Outreach settings"><Settings2 size={17} /></button>
      </div>
    </div>
    {error && <div className="ox-alert" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="Dismiss"><X size={15} /></button></div>}
    {toast && <div className="ox-toast" role="status"><Check size={15} /> {toast}</div>}
    {!state && !error && <div className="ox-skeleton" role="status" aria-label="Loading Outreach"><span /><span /><span /></div>}
    {state && <div className="ox-body" key={tab}>
      {tab === "overview" && <OverviewTab state={state} range={range} setRange={setRange} showCosts={costs} onShowCosts={() => { setCosts(true); void load(true); }} onGo={setTab} />}
      {tab === "campaigns" && <CampaignsTab state={state} clients={clients} leadLists={leadLists} act={act} reload={load} onPlaybook={() => setDrawer("playbook")} />}
      {tab === "inbox" && <InboxTab state={state} act={act} focus={initial.get("reply") || ""} />}
      {tab === "infrastructure" && <InfrastructurePanel state={state} act={act} reload={load} />}
    </div>}
    {drawer === "playbook" && state && <PlaybookDrawer kinds={state.playbookKinds} clients={clients} onClose={() => setDrawer("")} />}
    {drawer === "settings" && state && <SettingsDrawer state={state} act={act} onClose={() => setDrawer("")} />}
  </section>;
}

// ============================ Overview ============================
function OverviewTab({ state, range, setRange, showCosts, onShowCosts, onGo }: { state: OutreachState; range: { from: string; to: string; campaign: string; preset: string }; setRange: (value: { from: string; to: string; campaign: string; preset: string }) => void; showCosts: boolean; onShowCosts: () => void; onGo: (tab: Tab) => void }) {
  const o = state.overview;
  const setPreset = (preset: string) => { if (preset === "custom") { setRange({ ...range, preset }); return; } const to = new Date(); const from = new Date(Date.now() - (Number(preset) - 1) * 86_400_000); setRange({ ...range, preset, from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }); };
  const healthBand = o.health === null ? "grey" : o.health >= 80 ? "green" : o.health >= 60 ? "amber" : "red";
  const cards: Array<{ label: string; value: string; hint?: string; tone?: string; go?: Tab }> = [
    { label: "Positive replies", value: num(o.positive), hint: `${pct(o.positiveRate)} of emails sent`, tone: "good", go: "inbox" },
    { label: "Qualified leads", value: num(o.qualified), hint: "Outreach deals at Qualified or later" },
    { label: "Meetings booked", value: num(o.meetings), hint: "From your pipeline's meeting stage" },
    { label: "Emails sent", value: num(o.sent), hint: `${num(o.replies)} replies` },
    { label: "Active campaigns", value: num(o.activeCampaigns), go: "campaigns" },
    { label: "Sending mailboxes", value: num(o.activeMailboxes), hint: `${o.warming} warming up`, go: "infrastructure" },
    { label: "Deliverability health", value: o.health === null ? "Not enough data" : `${o.health}/100`, tone: healthBand, go: "infrastructure" },
  ];
  return <div className="ox-stack">
    <div className="ox-filters">
      <div className="ox-seg" role="group" aria-label="Date range">{[["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["custom", "Custom"]].map(([key, label]) => <button key={key} type="button" className={range.preset === key ? "on" : ""} onClick={() => setPreset(key)}>{label}</button>)}</div>
      {range.preset === "custom" && <><input type="date" aria-label="From" value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} /><input type="date" aria-label="To" value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} /></>}
      <select aria-label="Campaign" value={range.campaign} onChange={(event) => setRange({ ...range, campaign: event.target.value })}><option value="">All campaigns</option>{state.campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select>
    </div>
    {o.issues.length > 0 && <div className="ox-issues" role="region" aria-label="Needs attention">{o.issues.slice(0, 6).map((issue, index) => <p key={index} className={issue.level}><b>{issue.level === "critical" ? "Critical" : "Warning"}</b> {issue.text}</p>)}</div>}
    <div className="ox-kpis">{cards.map((card, index) => <button key={card.label} type="button" className={`ox-kpi ${card.tone || ""}`} style={{ animationDelay: `${index * 40}ms` }} onClick={() => card.go && onGo(card.go)} disabled={!card.go}><span>{card.label}</span><strong>{card.value}</strong>{card.hint && <small>{card.hint}</small>}</button>)}</div>
    <div className="ox-panel ox-costs">
      <header><div><h3>Monthly running cost</h3><p>Real figures only: your seat price, Cloudflare renewal prices and the AI cost OpenRouter reports{state.costs.fxDate ? `, in ${state.costs.currency} (US$ prices converted at the ECB rate of ${state.costs.fxDate})` : ""}.{state.settings.expenseSync.enabled ? " Added to Books → Expenses automatically." : ""}</p></div><strong>{money(state.costs.totalCents, state.costs.currency)}</strong></header>
      <ul>{state.costs.lines.map((line) => <li key={line.key}><span>{line.label}<small>{line.source}{line.detail ? ` · ${line.detail}` : ""}{!line.complete ? " · some items unpriced" : ""}</small></span><b>{money(line.cents, state.costs.currency)}</b></li>)}</ul>
      {state.costs.perMailboxCents !== null && <p className="ox-muted">≈ {money(state.costs.perMailboxCents, state.costs.currency)} per mailbox per month.</p>}
      {!showCosts ? <button type="button" className="ox-link" onClick={onShowCosts}>Check OpenRouter account spend this month</button> : <p className="ox-muted">OpenRouter account spend this month (all features, not just Outreach): {state.costs.openRouterAccountMonthUsd === null ? "not reported by the key" : `$${state.costs.openRouterAccountMonthUsd.toFixed(2)}`}</p>}
    </div>
    {state.campaigns.length > 0 && <div className="ox-panel"><header><h3>Campaigns</h3></header><table className="ox-table"><thead><tr><th>Campaign</th><th>Status</th><th>Sent</th><th>Replies</th><th>Positive</th><th>Positive rate</th></tr></thead><tbody>{state.campaigns.map((campaign) => <tr key={campaign.id}><td>{campaign.name}</td><td><span className={`ox-status ${campaign.status}`}>{campaign.status}</span></td><td>{num(campaign.stats.sent)}</td><td>{num(campaign.stats.replies)}</td><td>{num(campaign.stats.positive)}</td><td>{pct(campaign.stats.sent ? campaign.stats.positive / campaign.stats.sent : null)}</td></tr>)}</tbody></table></div>}
  </div>;
}

// ============================ Campaigns ============================
const EMPTY_VARIANT = (id = "A"): Variant => ({ id, subject: "", body: "", weight: 1 });
const newCampaign = (): Campaign => ({ id: "", name: "", status: "draft", clientId: null, niche: "", offer: "", mailboxIds: [], schedule: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", tz: "recipient", fallbackTz: "Europe/Dublin" }, dailyCap: 0, lawfulBasis: "", pipelineId: null, stageId: null, updatedAt: "", steps: [{ delayDays: 0, variants: [EMPTY_VARIANT()] }], stats: { sent: 0, replies: 0, positive: 0 } });

function CampaignsTab({ state, clients, leadLists, act, reload, onPlaybook }: { state: OutreachState; clients: Array<{ id: string; name: string }>; leadLists: LeadList[]; act: <T>(action: string, body?: Record<string, unknown>, success?: string) => Promise<T | null>; reload: () => Promise<void>; onPlaybook: () => void }) {
  const [editing, setEditing] = useState<Campaign | null>(null);
  if (editing) return <CampaignBuilder initial={editing} state={state} clients={clients} leadLists={leadLists} act={act} reload={reload} onClose={() => { setEditing(null); void reload(); }} onPlaybook={onPlaybook} />;
  return <div className="ox-stack">
    <div className="ox-row-between"><p className="ox-muted">Build a campaign in five steps. Nothing sends until SPF, DKIM and DMARC pass on every sending domain.</p><button type="button" className="primary-button" onClick={() => setEditing(newCampaign())}><Plus size={16} /> New campaign</button></div>
    {state.campaigns.length === 0 ? <div className="ox-empty"><Rocket size={28} /><h3>No campaigns yet</h3><p>Start with your leads, let the AI draft a sequence from your Playbook, pick warmed mailboxes and launch.</p><button type="button" className="primary-button" onClick={() => setEditing(newCampaign())}>Create your first campaign</button></div> :
      <div className="ox-cards">{state.campaigns.map((campaign) => <article key={campaign.id} className="ox-campaign">
        <header><h3>{campaign.name}</h3><span className={`ox-status ${campaign.status}`}>{campaign.status}</span></header>
        <p className="ox-muted">{campaign.steps.length} email{campaign.steps.length === 1 ? "" : "s"} · {campaign.mailboxIds.length} mailbox{campaign.mailboxIds.length === 1 ? "" : "es"}{campaign.niche ? ` · ${campaign.niche}` : ""}</p>
        <dl><div><dt>Sent</dt><dd>{num(campaign.stats.sent)}</dd></div><div><dt>Replies</dt><dd>{num(campaign.stats.replies)}</dd></div><div><dt>Positive</dt><dd>{num(campaign.stats.positive)}</dd></div></dl>
        <footer>
          <button type="button" className="secondary-button" onClick={() => setEditing(campaign)}>Open</button>
          {campaign.status === "active" ? <button type="button" className="secondary-button" onClick={() => void act("campaign-status", { id: campaign.id, status: "paused" }, "Campaign paused")}><Pause size={14} /> Pause</button> : <button type="button" className="secondary-button" onClick={async () => { const result = await act<{ ok: boolean; blockers?: string[] }>("campaign-status", { id: campaign.id, status: "active" }); if (result && !result.ok) setEditing({ ...campaign, _blockers: result.blockers } as never); }}><Play size={14} /> {campaign.status === "draft" ? "Launch" : "Resume"}</button>}
          <button type="button" className="ox-icon" title="Duplicate" aria-label={`Duplicate ${campaign.name}`} onClick={() => void act("campaign-duplicate", { id: campaign.id }, "Campaign duplicated")}><Copy size={15} /></button>
        </footer>
      </article>)}</div>}
  </div>;
}

const STEPS = ["Leads", "Emails", "Mailboxes", "Schedule", "Review & launch"];

function CampaignBuilder({ initial, state, clients, leadLists, act, reload, onClose, onPlaybook }: { initial: Campaign & { _blockers?: string[] }; state: OutreachState; clients: Array<{ id: string; name: string }>; leadLists: LeadList[]; act: <T>(action: string, body?: Record<string, unknown>, success?: string) => Promise<T | null>; reload: () => Promise<void>; onClose: () => void; onPlaybook: () => void }) {
  const [campaign, setCampaign] = useState<Campaign>(initial);
  const [step, setStep] = useState(initial._blockers ? 4 : 0);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [blockers, setBlockers] = useState<string[]>(initial._blockers || []);
  const timer = useRef<number | null>(null);
  const idRef = useRef(initial.id);
  const update = (patch: Partial<Campaign>) => setCampaign((current) => ({ ...current, ...patch }));

  // Automatic saving: debounce every change.
  const save = useCallback(async (value: Campaign) => {
    if (!value.name.trim()) return;
    setSaved("saving");
    const result = await outreachAction<{ id: string }>("campaign-save", { ...value, id: idRef.current || undefined }).catch(() => null);
    if (result?.id) { idRef.current = result.id; setCampaign((current) => current.id ? current : { ...current, id: result.id }); setSaved("saved"); } else setSaved("idle");
  }, []);
  useEffect(() => { if (timer.current) window.clearTimeout(timer.current); timer.current = window.setTimeout(() => void save(campaign), 900); return () => { if (timer.current) window.clearTimeout(timer.current); }; }, [campaign, save]);

  const launch = async () => { await save(campaign); const result = await act<{ ok: boolean; blockers?: string[] }>("campaign-status", { id: idRef.current, status: "active" }); if (result?.ok) { await reload(); onClose(); } else setBlockers(result?.blockers || []); };

  return <div className="ox-builder">
    <header className="ox-builder-head">
      <button type="button" className="ox-link" onClick={onClose}>← Campaigns</button>
      <input className="ox-title-input" value={campaign.name} onChange={(event) => update({ name: event.target.value })} placeholder="Campaign name" aria-label="Campaign name" />
      <span className={`ox-save ${saved}`} aria-live="polite">{saved === "saving" ? "Saving…" : saved === "saved" ? "Saved" : campaign.name ? "" : "Name it to save"}</span>
    </header>
    <ol className="ox-stepper">{STEPS.map((label, index) => <li key={label} className={index === step ? "on" : index < step ? "done" : ""}><button type="button" onClick={() => setStep(index)}><span>{index < step ? <Check size={13} /> : index + 1}</span>{label}</button></li>)}</ol>
    <div className="ox-builder-body">
      {step === 0 && <LeadsStep campaignId={idRef.current} campaign={campaign} update={update} clients={clients} leadLists={leadLists} act={act} ensureSaved={async () => { await save(campaign); return idRef.current; }} cooldown={state.settings.cooldownDays} />}
      {step === 1 && <EmailsStep campaign={campaign} update={update} onPlaybook={onPlaybook} />}
      {step === 2 && <div className="ox-stack"><p className="ox-muted">Pick warmed-up mailboxes. Follow-ups always come from the same mailbox as the first email.</p><div className="ox-pick">{state.mailboxes.length === 0 ? <p className="ox-muted">No mailboxes yet — add them in Infrastructure.</p> : state.mailboxes.map((mailbox) => { const on = campaign.mailboxIds.includes(mailbox.id); return <label key={mailbox.id} className={on ? "on" : ""}><input type="checkbox" checked={on} onChange={() => update({ mailboxIds: on ? campaign.mailboxIds.filter((id) => id !== mailbox.id) : [...campaign.mailboxIds, mailbox.id] })} /><FlameMeter progress={mailbox.rampProgress} active={mailbox.status === "ramping"} /><span><b>{mailbox.email}</b><small>{mailbox.status} · {mailbox.sentToday}/{mailbox.limitToday} today</small></span><HealthPill health={mailbox.health} /></label>; })}</div></div>}
      {step === 3 && <ScheduleStep campaign={campaign} update={update} />}
      {step === 4 && <div className="ox-stack">
        <div className="ox-panel"><h3>Lawful basis</h3><p className="ox-muted">Required before launch. EU/Irish rules restrict cold email: record why contacting this list is legitimate (e.g. "B2B: published business addresses of roofing companies; offer relevant to their role; opt-out in every email").</p><textarea rows={3} value={campaign.lawfulBasis} onChange={(event) => update({ lawfulBasis: event.target.value })} aria-label="Lawful basis" /></div>
        <div className="ox-panel ox-summary"><h3>Summary</h3><ul><li><b>{campaign.steps.length}</b> email{campaign.steps.length === 1 ? "" : "s"} with {campaign.steps.reduce((total, item) => total + item.variants.length, 0)} variants</li><li><b>{campaign.mailboxIds.length}</b> mailbox{campaign.mailboxIds.length === 1 ? "" : "es"}</li><li>Sends {(campaign.schedule.days || []).length} days a week, {campaign.schedule.start}–{campaign.schedule.end} {campaign.schedule.tz === "recipient" ? "in each recipient's time zone" : campaign.schedule.tz}</li><li>Stops automatically on any reply, unsubscribe or bounce. Out-of-office pauses follow-ups for a week.</li></ul></div>
        {blockers.length > 0 && <div className="ox-issues" role="alert"><p className="critical"><b>Not ready to launch</b></p>{blockers.map((blocker) => <p key={blocker} className="warning">{blocker}</p>)}</div>}
        <div className="ox-row-end"><button type="button" className="primary-button ox-launch" onClick={() => void launch()} disabled={!campaign.name || !campaign.lawfulBasis.trim()}><Rocket size={16} /> Launch campaign</button></div>
      </div>}
    </div>
    <footer className="ox-builder-foot">{step > 0 && <button type="button" className="secondary-button" onClick={() => setStep(step - 1)}>Back</button>}{step < 4 && <button type="button" className="primary-button" onClick={() => setStep(step + 1)}>Next <ChevronRight size={15} /></button>}</footer>
  </div>;
}

function LeadsStep({ campaignId, campaign, update, clients, leadLists, act, ensureSaved, cooldown }: { campaignId: string; campaign: Campaign; update: (patch: Partial<Campaign>) => void; clients: Array<{ id: string; name: string }>; leadLists: LeadList[]; act: <T>(action: string, body?: Record<string, unknown>, success?: string) => Promise<T | null>; ensureSaved: () => Promise<string>; cooldown: number }) {
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<{ summary: { total: number; create?: number; link?: number; skip?: number; reasons?: Record<string, number> } } | null>(null);
  const [allowPersonal, setAllowPersonal] = useState(false);
  const [busy, setBusy] = useState(false);
  const reasonText: Record<string, string> = { "invalid-syntax": "invalid address", disposable: "disposable address", "duplicate-in-file": "duplicate in file", suppressed: "unsubscribed / suppressed", "personal-mailbox": "personal mailbox (Gmail etc.)", "already-in-a-sequence": "already in another campaign", "contacted-recently": `contacted in the last ${cooldown} days` };
  const runPreview = async (text: string, personal = allowPersonal) => { setBusy(true); const result = await act<typeof preview>("import-preview", { csv: text, allowPersonalMailboxes: personal }); setPreview(result); setBusy(false); };
  return <div className="ox-stack">
    <div className="ox-grid2">
      <label className="ox-field">Name for this audience (niche)<input value={campaign.niche} onChange={(event) => update({ niche: event.target.value })} placeholder="e.g. Roofers in Galway" /></label>
      <label className="ox-field">Client (optional)<select value={campaign.clientId || ""} onChange={(event) => update({ clientId: event.target.value || null })}><option value="">F2B Media (agency)</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
      <label className="ox-field ox-span2">Offer<input value={campaign.offer} onChange={(event) => update({ offer: event.target.value })} placeholder="What you're offering this audience" /></label>
    </div>
    <div className="ox-drop">
      <Upload size={22} />
      <p><b>Import a CSV</b> — needs an email column; names, company, website, city and any custom columns become personalisation fields.</p>
      <label className="secondary-button"><input type="file" accept=".csv,text/csv" hidden onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; const text = await file.text(); setCsv(text); await runPreview(text); }} />Choose CSV</label>
      {leadLists.length > 0 && <select aria-label="Use a Lead Factory list" defaultValue="" onChange={async (event) => { if (!event.target.value) return; const result = await act<{ csv: string }>("import-lead-list", { listId: event.target.value }); if (result) { setCsv(result.csv); await runPreview(result.csv); } }}><option value="">…or use a Lead Factory list</option>{leadLists.map((list) => <option key={list.id} value={list.id}>{list.name} ({list.count})</option>)}</select>}
    </div>
    {busy && <div className="ox-progress"><span /></div>}
    {preview && <div className="ox-panel">
      <h3>{num(preview.summary.total)} rows checked</h3>
      <ul className="ox-checks"><li className="good">{num(preview.summary.create || 0)} new contacts</li><li className="good">{num(preview.summary.link || 0)} already in your CRM (linked, not duplicated)</li><li className="warn">{num(preview.summary.skip || 0)} skipped</li></ul>
      {preview.summary.reasons && Object.keys(preview.summary.reasons).length > 0 && <p className="ox-muted">Skipped: {Object.entries(preview.summary.reasons).map(([reason, count]) => `${count} ${reasonText[reason] || reason}`).join(" · ")}</p>}
      <label className="ox-check"><input type="checkbox" checked={allowPersonal} onChange={(event) => { setAllowPersonal(event.target.checked); void runPreview(csv, event.target.checked); }} /> Include personal mailboxes (only if you have consent — ePrivacy rules)</label>
      <button type="button" className="primary-button" disabled={!campaign.name} onClick={async () => { const id = campaignId || await ensureSaved(); if (!id) return; const result = await act<{ created: number; linked: number; enrolled: number }>("import-commit", { campaignId: id, csv, allowPersonalMailboxes: allowPersonal }); if (result) setPreview(null); }}>{campaign.name ? "Add these leads to the campaign" : "Name the campaign first"}</button>
    </div>}
  </div>;
}

const AI_ACTIONS: Array<[string, string]> = [["rewrite", "Rewrite"], ["shorten", "Shorten"], ["personalise", "Personalise"], ["cta", "Improve CTA"], ["variations", "Variations"], ["subjects", "Subject lines"]];

function EmailsStep({ campaign, update, onPlaybook }: { campaign: Campaign; update: (patch: Partial<Campaign>) => void; onPlaybook: () => void }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [subjects, setSubjects] = useState<string[]>([]);
  const setSteps = (steps: Step[]) => update({ steps });
  const setVariant = (stepIndex: number, variantIndex: number, patch: Partial<Variant>) => setSteps(campaign.steps.map((step, i) => i !== stepIndex ? step : { ...step, variants: step.variants.map((variant, j) => j !== variantIndex ? variant : { ...variant, ...patch }) }));
  const ai = async (task: string, stepIndex?: number, variantIndex?: number) => {
    setBusy(`${task}:${stepIndex ?? ""}:${variantIndex ?? ""}`); setError("");
    try {
      const draft = stepIndex === undefined ? "" : campaign.steps[stepIndex].variants[variantIndex ?? 0].body;
      const { result } = await outreachAction<{ result: any }>("ai-copy", { task, campaign: { name: campaign.name, niche: campaign.niche, offer: campaign.offer }, clientId: campaign.clientId, draft, steps: Math.max(3, campaign.steps.length) });
      if (task === "sequence" && Array.isArray(result.steps)) setSteps(result.steps.map((item: any, index: number) => ({ delayDays: index === 0 ? 0 : Number(item.delayDays) || 3, variants: (item.variants || []).map((variant: any, j: number) => ({ id: String.fromCharCode(65 + j), subject: String(variant.subject || ""), body: String(variant.body || ""), weight: 1 })) })));
      else if (task === "subjects") setSubjects(result.subjects || []);
      else if (task === "variations" && stepIndex !== undefined) setSteps(campaign.steps.map((step, i) => i !== stepIndex ? step : { ...step, variants: [...step.variants, ...(result.variants || []).slice(0, 4 - step.variants.length).map((variant: any, j: number) => ({ id: String.fromCharCode(65 + step.variants.length + j), subject: String(variant.subject || ""), body: String(variant.body || ""), weight: 1 }))] }));
      else if (stepIndex !== undefined && result.body) setVariant(stepIndex, variantIndex ?? 0, { body: String(result.body) });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The AI couldn't help this time."); }
    setBusy("");
  };
  return <div className="ox-stack">
    <div className="ox-row-between"><p className="ox-muted">Merge fields: <code>{"{{first_name}}"}</code> <code>{"{{company|your business}}"}</code> <code>{"{{opener}}"}</code> · spintax <code>{"{Hi|Hello}"}</code>. Each send picks the freshest version so no two emails read the same.</p>
      <div className="ox-row"><button type="button" className="secondary-button" onClick={onPlaybook}><BookOpen size={14} /> Playbook</button><button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => void ai("sequence")}><Sparkles size={15} /> {busy.startsWith("sequence") ? "Writing…" : "Generate sequence"}</button></div></div>
    {error && <p className="ox-alert" role="alert">{error}</p>}
    {subjects.length > 0 && <div className="ox-chips">{subjects.map((subject) => <button key={subject} type="button" onClick={() => setVariant(0, 0, { subject })}>{subject}</button>)}</div>}
    {campaign.steps.map((step, stepIndex) => <div key={stepIndex} className="ox-email">
      <header><b>{stepIndex === 0 ? "First email" : `Follow-up ${stepIndex}`}</b>{stepIndex > 0 && <label className="ox-inline">after <input type="number" min={1} max={30} value={step.delayDays} onChange={(event) => setSteps(campaign.steps.map((item, i) => i === stepIndex ? { ...item, delayDays: Number(event.target.value) } : item))} /> days</label>}
        {campaign.steps.length > 1 && <button type="button" className="ox-icon" aria-label="Remove email" onClick={() => setSteps(campaign.steps.filter((_, i) => i !== stepIndex))}><X size={15} /></button>}</header>
      {step.variants.map((variant, variantIndex) => { const lint = lintEmail({ subject: variant.subject, body: variant.body.replace(/\{\{[^}]+\}\}/g, "x"), step: stepIndex }); return <div key={variant.id} className="ox-variant">
        <div className="ox-row-between"><span className="ox-tag">Variant {variant.id}</span>{step.variants.length > 1 && <button type="button" className="ox-link" onClick={() => setSteps(campaign.steps.map((item, i) => i === stepIndex ? { ...item, variants: item.variants.filter((_, j) => j !== variantIndex) } : item))}>Remove</button>}</div>
        <input value={variant.subject} onChange={(event) => setVariant(stepIndex, variantIndex, { subject: event.target.value })} placeholder={stepIndex === 0 ? "Subject" : "Subject (leave empty to reply in the same thread)"} aria-label="Subject" />
        <textarea rows={7} value={variant.body} onChange={(event) => setVariant(stepIndex, variantIndex, { body: event.target.value })} placeholder="Write the email, or press Generate sequence" aria-label="Email body" />
        <div className="ox-ai-row">{AI_ACTIONS.map(([task, label]) => <button key={task} type="button" disabled={Boolean(busy) || (!variant.body && task !== "subjects")} onClick={() => void ai(task, stepIndex, variantIndex)}><Wand2 size={13} /> {busy === `${task}:${stepIndex}:${variantIndex}` ? "…" : label}</button>)}</div>
        {lint.issues.length > 0 && <ul className="ox-lint">{lint.issues.map((issue) => <li key={issue.code + issue.message} className={issue.level}>{issue.message}</li>)}</ul>}
      </div>; })}
      {step.variants.length < 4 && <button type="button" className="ox-link" onClick={() => setSteps(campaign.steps.map((item, i) => i === stepIndex ? { ...item, variants: [...item.variants, EMPTY_VARIANT(String.fromCharCode(65 + item.variants.length))] } : item))}>+ A/B variant</button>}
    </div>)}
    {campaign.steps.length < 6 && <button type="button" className="secondary-button" onClick={() => setSteps([...campaign.steps, { delayDays: 3, variants: [EMPTY_VARIANT()] }])}><Plus size={14} /> Add follow-up</button>}
  </div>;
}

function ScheduleStep({ campaign, update }: { campaign: Campaign; update: (patch: Partial<Campaign>) => void }) {
  const schedule = campaign.schedule;
  const set = (patch: Partial<Campaign["schedule"]>) => update({ schedule: { ...schedule, ...patch } });
  const days = schedule.days || [1, 2, 3, 4, 5];
  return <div className="ox-stack">
    <div className="ox-seg" role="group" aria-label="Sending days">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, index) => { const day = index + 1; const on = days.includes(day); return <button key={label} type="button" className={on ? "on" : ""} onClick={() => set({ days: on ? days.filter((item) => item !== day) : [...days, day].sort() })}>{label}</button>; })}</div>
    <div className="ox-grid2">
      <label className="ox-field">From<input type="time" value={schedule.start || "09:00"} onChange={(event) => set({ start: event.target.value })} /></label>
      <label className="ox-field">Until<input type="time" value={schedule.end || "17:00"} onChange={(event) => set({ end: event.target.value })} /></label>
      <label className="ox-field">Time zone<select value={schedule.tz || "recipient"} onChange={(event) => set({ tz: event.target.value })}><option value="recipient">Each recipient's time zone (when known)</option><option value="Europe/Dublin">Ireland</option><option value="Europe/London">UK</option><option value="America/New_York">US Eastern</option><option value="America/Los_Angeles">US Pacific</option></select></label>
      <label className="ox-field">Campaign daily cap<input type="number" min={0} value={campaign.dailyCap} onChange={(event) => update({ dailyCap: Number(event.target.value) })} /><small>0 = only each mailbox's warm-up limit applies</small></label>
    </div>
    <p className="ox-muted"><CalendarClock size={14} /> Mailboxes send at most one email every few minutes, never more than one email to the same company per round, and never above their warm-up limit.</p>
  </div>;
}

// ============================ Inbox ============================
type InboxItem = { id: string; threadId: string; label: string; confidence: number; needsReview: boolean; status: string; suggestedReply: string; receivedAt: string; subject: string; body: string; prospect: { name: string; email: string; company: string }; campaign: string; mailbox: string; opportunityId: string | null };
const INBOX_FILTERS = ["positive", "review", "question", "objection", "referral", "negative", "out-of-office", "unsubscribe", "bounce", "all"];

function InboxTab({ state, act, focus }: { state: OutreachState; act: <T>(action: string, body?: Record<string, unknown>, success?: string) => Promise<T | null>; focus: string }) {
  const [label, setLabel] = useState("positive");
  const [filters, setFilters] = useState({ campaignId: "", mailboxId: "", domain: "", status: "open" });
  const [data, setData] = useState<{ items: InboxItem[]; counts: Array<{ label: string; n: number }> } | null>(null);
  const [selected, setSelected] = useState<string>(focus);
  const [thread, setThread] = useState<Array<{ id: string; direction: string; body: string; created_at: string }>>([]);
  const [draft, setDraft] = useState("");
  const [learn, setLearn] = useState(true);
  const [sending, setSending] = useState(false);
  const refresh = useCallback(async () => { const result = await outreachAction<typeof data>("inbox-list", { label, ...filters }).catch(() => null); setData(result); }, [label, filters]);
  useEffect(() => { void refresh(); }, [refresh]);
  const current = data?.items.find((item) => item.id === selected) || null;
  useEffect(() => { if (!current) return; setDraft(current.suggestedReply || ""); void outreachAction<{ messages: typeof thread }>("inbox-thread", { threadId: current.threadId }).then((result) => setThread(result.messages)).catch(() => setThread([])); }, [current?.id]);
  const count = (key: string) => key === "review" ? state.overview.reviewQueue : key === "all" ? (data?.counts || []).reduce((total, row) => total + Number(row.n), 0) : Number(data?.counts.find((row) => row.label === key)?.n || 0);
  const domains = useMemo(() => [...new Set(state.mailboxes.map((mailbox) => mailbox.domain))], [state.mailboxes]);
  return <div className="ox-inbox">
    <aside>
      <div className="ox-chips ox-labels">{INBOX_FILTERS.map((key) => <button key={key} type="button" className={label === key ? "on" : ""} onClick={() => { setLabel(key); setSelected(""); }}>{LABELS[key]}{count(key) ? <span>{count(key)}</span> : null}</button>)}</div>
      <div className="ox-inbox-filters">
        <select aria-label="Campaign" value={filters.campaignId} onChange={(event) => setFilters({ ...filters, campaignId: event.target.value })}><option value="">All campaigns</option>{state.campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select>
        <select aria-label="Mailbox" value={filters.mailboxId} onChange={(event) => setFilters({ ...filters, mailboxId: event.target.value })}><option value="">All mailboxes</option>{state.mailboxes.map((mailbox) => <option key={mailbox.id} value={mailbox.id}>{mailbox.email}</option>)}</select>
        <select aria-label="Domain" value={filters.domain} onChange={(event) => setFilters({ ...filters, domain: event.target.value })}><option value="">All domains</option>{domains.map((domain) => <option key={domain} value={domain}>{domain}</option>)}</select>
        <select aria-label="Status" value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="open">Needs a reply</option><option value="sent">Replied</option><option value="archived">Archived</option><option value="all">Everything</option></select>
      </div>
      <ul className="ox-thread-list">{(data?.items || []).map((item) => <li key={item.id}><button type="button" className={selected === item.id ? "on" : ""} onClick={() => setSelected(item.id)}>
        <span className="ox-row-between"><b>{item.prospect.name || item.prospect.email}</b><small>{ago(item.receivedAt)}</small></span>
        <small>{item.prospect.company || item.campaign}</small>
        <span className="ox-snippet">{String(item.body || "").split("\n\n").slice(1).join(" ").slice(0, 110)}</span>
        <span className={`ox-label ${item.label}`}>{LABELS[item.label] || item.label}{item.needsReview ? " · check" : ""}</span>
      </button></li>)}
      {data && data.items.length === 0 && <li className="ox-empty-small"><Mail size={18} /> Nothing here{label === "positive" ? " yet — positive replies land here first" : ""}.</li>}</ul>
    </aside>
    <section className="ox-reader" aria-live="polite">{!current ? <div className="ox-empty"><Inbox size={28} /><p>Choose a conversation.</p></div> : <>
      <header><div><h3>{current.prospect.name || current.prospect.email}</h3><p className="ox-muted">{current.prospect.email}{current.prospect.company ? ` · ${current.prospect.company}` : ""} · {current.campaign} · via {current.mailbox}</p></div>
        <div className="ox-row"><span className={`ox-label ${current.label}`}>{LABELS[current.label]} · {Math.round(current.confidence * 100)}%</span>
          <select aria-label="Reclassify" value="" onChange={(event) => event.target.value && void act("reply-update", { id: current.id, label: event.target.value }, "Reclassified").then(refresh)}><option value="">Reclassify…</option>{Object.entries(LABELS).filter(([key]) => !["all", "review", "needs-review"].includes(key)).map(([key, text]) => <option key={key} value={key}>{text}</option>)}</select>
          <button type="button" className="secondary-button" onClick={() => void act("reply-update", { id: current.id, status: "archived" }, "Archived").then(() => { setSelected(""); void refresh(); })}>Archive</button></div></header>
      {current.opportunityId && <p className="ox-pill-good">Added to your pipeline</p>}
      <div className="ox-messages">{thread.map((message) => <article key={message.id} className={message.direction === "in" ? "in" : "out"}><small>{message.direction === "in" ? "Them" : "You"} · {ago(message.created_at)}</small><pre>{message.body}</pre></article>)}</div>
      <div className="ox-compose">
        <label className="ox-field">{current.suggestedReply ? "AI-drafted reply — edit before sending" : "Your reply"}<textarea rows={6} value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
        <div className="ox-row-between"><label className="ox-check"><input type="checkbox" checked={learn} onChange={(event) => setLearn(event.target.checked)} /> Teach the AI from my edits</label>
          <button type="button" className="primary-button" disabled={!draft.trim() || sending} onClick={async () => { setSending(true); const result = await act<{ learned: boolean }>("reply-send", { id: current.id, body: draft, saveCorrection: learn }, "Reply sent"); setSending(false); if (result) void refresh(); }}><Send size={15} /> {sending ? "Sending…" : "Approve & send"}</button></div>
      </div>
    </>}</section>
  </div>;
}
