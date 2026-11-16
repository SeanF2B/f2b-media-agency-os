"use client";
import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Camera, CheckCircle2, CircleDashed, Copy, Flame, Globe, Loader2, Lock, Mail, Plus, RefreshCw, Search, ShieldCheck, Sparkles, Trash2, Undo2, X, XCircle } from "lucide-react";
import { money, outreachAction, pct, ago, type Health, type Mailbox, type OutreachState } from "./outreach-api";
import type { DeliverabilityReport } from "@/lib/outreach/deliverability-report.mjs";

type Act = <T>(action: string, body?: Record<string, unknown>, success?: string) => Promise<T | null>;

// ============================ small visuals ============================
/** Warm-up flame: size and glow follow the real ramp position; only animates while ramping. */
export function FlameMeter({ progress, active, waiting = false }: { progress: number; active: boolean; waiting?: boolean }) {
  const level = Math.max(0, Math.min(1, progress));
  return <span className={`ox-flame ${active ? "live" : ""} ${waiting ? "waiting" : ""} ${level >= 1 ? "full" : ""}`} style={{ ["--lvl" as string]: String(0.45 + level * 0.55) }} title={active ? `Warming up · ${Math.round(level * 100)}%` : level >= 1 ? "Fully warmed" : "Not warming"} aria-label={active ? `Warming up ${Math.round(level * 100)} percent` : "Warm-up off"}>
    <Flame size={18} aria-hidden="true" />
  </span>;
}

export function HealthPill({ health }: { health: Partial<Health> }) {
  const [open, setOpen] = useState(false);
  const band = health.band || "grey";
  return <span className="ox-health-wrap">
    <button type="button" className={`ox-health ${band}`} onClick={() => setOpen(!open)} aria-expanded={open}>{typeof health.score === "number" ? health.score : "—"}<small>{health.label || "Insufficient data"}</small></button>
    {open && <span className="ox-health-pop" role="dialog" aria-label="Why this score">
      <b>{health.label || "Insufficient data"}{typeof health.score === "number" ? ` · ${health.score}/100` : ""}</b>
      {(health.factors || []).map((factor) => <span key={factor.key} className={factor.available ? "" : "na"}><i>{factor.label}</i>{factor.available ? `${factor.points}/${factor.max}` : "not measured"}<small>{factor.detail}</small></span>)}
      {(health.adaptive || []).length > 0 && <span className="ox-adapt">{health.adaptive!.join(" ")}</span>}
      {!health.factors?.length && <small>No data yet. Scores appear after the first hourly check.</small>}
    </span>}
  </span>;
}

const AuthDot = ({ label, value }: { label: string; value?: string }) => <span className={`ox-auth ${value || "na"}`} title={`${label}: ${value || "not checked"}`}>{value === "pass" ? <CheckCircle2 size={13} /> : value ? <XCircle size={13} /> : <CircleDashed size={13} />}{label}</span>;

// ============================ panel ============================
export function InfrastructurePanel({ state, act, reload }: { state: OutreachState; act: Act; reload: () => Promise<void> }) {
  const [section, setSection] = useState<"mailboxes" | "domains" | "setup" | "placement">(state.mailboxes.length ? "mailboxes" : "setup");
  const running = state.jobs.filter((job) => job.status === "running");
  return <div className="ox-stack">
    <div className="ox-seg ox-subtabs" role="tablist" aria-label="Infrastructure">{([["mailboxes", `Mailboxes (${state.mailboxes.length})`], ["domains", `Domains (${state.domains.length})`], ["setup", running.length ? `Set up · ${running[0].progress.percent}%` : "Add mailboxes"], ["placement", "Placement tests"]] as const).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={section === key} className={section === key ? "on" : ""} onClick={() => setSection(key)}>{label}</button>)}</div>
    <Connections state={state} act={act} />
    {section === "mailboxes" && <MailboxTable state={state} act={act} />}
    {section === "domains" && <Domains state={state} act={act} />}
    {section === "setup" && <Provisioning state={state} act={act} reload={reload} />}
    {section === "placement" && <Placement state={state} act={act} />}
  </div>;
}

function Connections({ state, act }: { state: OutreachState; act: Act }) {
  const find = (provider: string) => state.connections.find((connection) => connection.provider === provider);
  const items = [
    { key: "microsoft", label: "Microsoft 365", connection: find("microsoft") },
    { key: "google", label: "Google Workspace", connection: find("google") },
    { key: "telegram", label: "Telegram alerts", connection: find("telegram") },
  ];
  return <div className="ox-conn-row">{items.map((item) => <span key={item.key} className={`ox-conn ${item.connection?.status === "ok" ? "ok" : item.connection ? "warn" : "off"}`} title={item.connection?.lastError || ""}>{item.connection?.status === "ok" ? <CheckCircle2 size={14} /> : <CircleDashed size={14} />}{item.label}{item.key === "telegram" && item.connection?.config?.source === "worker-secret" ? " · existing bot" : ""}{item.key === "telegram" && item.connection?.status === "needs-chat" ? " · add chat ID" : ""}</span>)}
    <span className={`ox-conn ${state.purchasesEnabled ? "warn" : "ok"}`}><Lock size={14} /> Purchases {state.purchasesEnabled ? "enabled" : "locked"}</span>
    {find("telegram")?.status === "ok" && <button type="button" className="ox-link" onClick={() => void act("telegram-test", {}, "Test alert sent")}>Send test alert</button>}
  </div>;
}

export function SenderAvatar({ mailbox, size = 32 }: { mailbox: Pick<Mailbox, "photo" | "firstName" | "lastName" | "email">; size?: number }) {
  const initials = `${mailbox.firstName?.[0] || mailbox.email[0] || "?"}${mailbox.lastName?.[0] || ""}`.toUpperCase();
  return <span className="ox-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">{mailbox.photo ? <img src={mailbox.photo} alt="" /> : initials}</span>;
}

/** Centre-crops and resizes a real photo to a small square JPEG in the browser (keeps uploads tiny). */
function squarePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { reject(new Error("Choose a JPEG, PNG or WebP photo.")); return; }
    const url = URL.createObjectURL(file); const image = new Image();
    image.onload = () => {
      const side = Math.min(image.width, image.height); const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
      const context = canvas.getContext("2d"); if (!context) { reject(new Error("This browser can't resize images.")); return; }
      context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 256, 256);
      URL.revokeObjectURL(url); resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file couldn't be read as an image.")); };
    image.src = url;
  });
}

/** Sender name and real photo for one mailbox — pushed to Microsoft 365 / Google so recipients see them. */
function SenderDrawer({ mailbox, act, onClose }: { mailbox: Mailbox; act: Act; onClose: () => void }) {
  const [firstName, setFirstName] = useState(mailbox.firstName);
  const [lastName, setLastName] = useState(mailbox.lastName);
  const [photo, setPhoto] = useState<string | null | undefined>(undefined); // undefined = unchanged, null = remove
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const preview = photo === undefined ? mailbox.photo : photo || "";
  const save = async () => {
    setBusy(true); setError("");
    const result = await act<{ synced: boolean; syncError: string }>("mailbox-profile", { id: mailbox.id, firstName, lastName, ...(photo !== undefined ? { photo } : {}) }, "Sender profile saved");
    setBusy(false);
    if (result && !result.synced && result.syncError) { setError(`Saved here, but the mailbox account wasn't updated: ${result.syncError}`); return; }
    if (result) onClose();
  };
  return <div className="ox-drawer-backdrop" onClick={onClose}><aside className="ox-drawer" role="dialog" aria-label={`Sender profile for ${mailbox.email}`} onClick={(event) => event.stopPropagation()}>
    <header><h2>Sender profile</h2><button type="button" className="ox-icon" onClick={onClose} aria-label="Close"><X size={16} /></button></header>
    <p className="ox-muted">{mailbox.email} · shown as the From name and profile photo in {mailbox.host === "google" ? "Gmail" : "Outlook"}.</p>
    <div className="ox-row"><SenderAvatar mailbox={{ ...mailbox, firstName, lastName, photo: preview }} size={72} />
      <div className="ox-stack" style={{ gap: 6 }}>
        <label className="secondary-button ox-upload"><Camera size={15} /> {preview ? "Replace photo" : "Upload photo"}<input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void squarePhoto(file).then(setPhoto).catch((reason) => setError(reason.message)); event.target.value = ""; }} /></label>
        {preview && <button type="button" className="ox-link" onClick={() => setPhoto(null)}>Remove photo</button>}
      </div>
    </div>
    <small className="ox-muted">Use a real photo of the person who handles these replies. It's cropped square and resized here before upload.</small>
    <div className="ox-grid2">
      <label className="ox-field">First name<input value={firstName} maxLength={40} onChange={(event) => setFirstName(event.target.value)} /></label>
      <label className="ox-field">Last name<input value={lastName} maxLength={40} onChange={(event) => setLastName(event.target.value)} /></label>
    </div>
    <p className="ox-muted">Recipients will see: <b>{`${firstName} ${lastName}`.trim() || "—"}</b> &lt;{mailbox.email}&gt;</p>
    {error && <p className="ox-warn-text"><AlertTriangle size={14} /> {error}</p>}
    <div className="ox-row-end"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="button" className="primary-button" disabled={busy || !firstName.trim()} onClick={() => void save()}>{busy ? <Loader2 size={15} className="ox-spin" /> : null} Save</button></div>
  </aside></div>;
}

type WarmupResult = { email: string; state: "started" | "already" | "fixing" | "needs-you"; message: string };

/** What one click on the flame did, mailbox by mailbox — and anything that genuinely needs you. */
function WarmupResults({ results, onClose }: { results: WarmupResult[]; onClose: () => void }) {
  const icon = (state: WarmupResult["state"]) => state === "started" || state === "already" ? <Flame size={16} className="ox-good-text" /> : state === "fixing" ? <Loader2 size={16} className="ox-spin" /> : <AlertTriangle size={16} className="ox-warn-text" />;
  return <div className="ox-drawer-backdrop" onClick={onClose}><aside className="ox-drawer" role="dialog" aria-label="Warm-up" onClick={(event) => event.stopPropagation()}>
    <header><h2>Warm-up</h2><button type="button" className="ox-icon" onClick={onClose} aria-label="Close"><X size={16} /></button></header>
    <ul className="ox-warm-results">{results.map((item) => <li key={item.email} className={item.state}>{icon(item.state)}<span><b>{item.email}</b><small>{item.message}</small></span></li>)}</ul>
    {results.some((item) => item.state === "fixing" || item.state === "needs-you") && <p className="ox-muted">You can close this. Outreach re-checks DNS every few minutes and starts warm-up on its own once everything passes.</p>}
    <div className="ox-row-end"><button type="button" className="primary-button" onClick={onClose}>Done</button></div>
  </aside></div>;
}

/** Deliverability & spam report for one mailbox — all from real checks and our own send records. */
function ReportDrawer({ mailbox, onClose }: { mailbox: Mailbox; onClose: () => void }) {
  const [report, setReport] = useState<(DeliverabilityReport & { generatedAt: string; domain: string; dmarcRecord: string }) | null>(null);
  const [error, setError] = useState("");
  const load = () => { setReport(null); setError(""); outreachAction<DeliverabilityReport & { generatedAt: string; domain: string; dmarcRecord: string }>("deliverability-report", { id: mailbox.id }).then(setReport).catch((reason) => setError(reason instanceof Error ? reason.message : "Couldn't build the report.")); };
  useEffect(load, [mailbox.id]);
  const stateIcon = (state: string) => state === "pass" || state === "clear" ? <CheckCircle2 size={14} /> : state === "unknown" ? <CircleDashed size={14} /> : <XCircle size={14} />;
  return <div className="ox-drawer-backdrop" onClick={onClose}><aside className="ox-drawer wide ox-report" role="dialog" aria-label={`Deliverability report for ${mailbox.email}`} onClick={(event) => event.stopPropagation()}>
    <header><h2>Deliverability report</h2><div className="ox-row"><button type="button" className="ox-icon" onClick={load} aria-label="Refresh"><RefreshCw size={15} /></button><button type="button" className="ox-icon" onClick={onClose} aria-label="Close"><X size={16} /></button></div></header>
    <p className="ox-muted">{mailbox.email}{report ? ` · checked ${ago(report.generatedAt)}` : ""}</p>
    {error && <p className="ox-warn-text"><AlertTriangle size={14} /> {error}</p>}
    {!report && !error && <div className="ox-empty-small"><Loader2 size={16} className="ox-spin" /> Checking DNS, blocklists and sending history…</div>}
    {report && <>
      <div className={`ox-verdict ${report.verdict}`}><Activity size={18} /><b>{report.headline}</b></div>
      <section><h3>Spam & engagement · last 30 days</h3><div className="ox-rate-grid">{report.rates.map((item) => <div key={item.key} className={`ox-rate ${item.tone || ""}`}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div></section>
      <section><h3>Authentication</h3><div className="ox-auth-row">{report.auth.map((item) => <span key={item.key} className={`ox-auth ${item.state}`}>{stateIcon(item.state)} {item.label}</span>)}</div>{report.dmarcRecord && <code className="ox-dmarc">{report.dmarcRecord}</code>}</section>
      <section><h3>Domain blocklists</h3><ul className="ox-bl">{report.blocklists.map((item) => <li key={item.id} className={item.state}>{stateIcon(item.state)} <b>{item.name}</b> <small>{item.note}</small></li>)}</ul></section>
      <section><h3>Inbox placement</h3>{report.placement ? <><p><b>{pct(report.placement.inboxRate)}</b> reached the inbox · {ago(report.placement.completedAt)}</p><ul className="ox-bl">{report.placement.results.map((item, index) => <li key={index} className={item.placement === "inbox" ? "clear" : item.placement === "missing" ? "unknown" : "listed"}>{stateIcon(item.placement === "inbox" ? "clear" : item.placement === "missing" ? "unknown" : "listed")} <b>{item.provider}</b> <small>{item.placement}</small></li>)}</ul></> : <p className="ox-muted">No test yet. Connect free test inboxes under Placement and run one.</p>}</section>
      <section><h3>Sending speed</h3><p>{report.throttle.limitToday ?? "—"} emails allowed today{report.throttle.rampDay ? ` · warm-up day ${report.throttle.rampDay}` : ""} · safety band <span className={`ox-status ${report.throttle.band === "green" ? "active" : report.throttle.band === "red" ? "error" : "paused"}`}>{report.throttle.band}</span></p><small className="ox-muted">Volume rises only while these signals stay healthy, slows on amber and stops on red.</small></section>
      {report.findings.length > 0 && <section><h3>What we found</h3><ul className="ox-findings">{report.findings.map((item, index) => <li key={index} className={item.tone}>{item.text}</li>)}</ul></section>}
      {report.actions.length > 0 && <section><h3>What to do</h3><ol className="ox-actions">{report.actions.map((item) => <li key={item}>{item}</li>)}</ol></section>}
    </>}
  </aside></div>;
}

function MailboxTable({ state, act }: { state: OutreachState; act: Act }) {
  const [editing, setEditing] = useState<Mailbox | null>(null);
  const [reportFor, setReportFor] = useState<Mailbox | null>(null);
  const [warmResults, setWarmResults] = useState<WarmupResult[] | null>(null);
  const warm = async (ids: string[]) => {
    const result = await act<{ results: WarmupResult[] }>("warmup-auto", { ids });
    if (!result) return;
    const allStarted = result.results.every((item) => item.state === "started" || item.state === "already");
    if (!allStarted || result.results.length > 1) setWarmResults(result.results);
  };
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState<"domain" | "group">("domain");
  const [prompt, setPrompt] = useState<{ op: string; label: string } | null>(null);
  const [value, setValue] = useState("");
  const rows = state.mailboxes.filter((mailbox) => !query || `${mailbox.email} ${mailbox.group} ${mailbox.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  const groups = useMemo(() => { const map = new Map<string, Mailbox[]>(); for (const mailbox of rows) { const key = (groupBy === "domain" ? mailbox.domain : mailbox.group) || "Ungrouped"; map.set(key, [...(map.get(key) || []), mailbox]); } return [...map.entries()]; }, [rows, groupBy]);
  const all = selected.length === rows.length && rows.length > 0;
  const bulk = async (op: string, extra?: string) => { await act("mailboxes-bulk", { ids: selected, op, value: extra }, "Updated"); setPrompt(null); setValue(""); };
  if (!state.mailboxes.length) return <div className="ox-empty"><Mail size={28} /><h3>No mailboxes yet</h3><p>Use <b>Add mailboxes</b> to set up domains and inboxes automatically, or connect an existing mailbox to try the full workflow with one inbox.</p></div>;
  return <div className="ox-stack">
    <div className="ox-filters"><label className="ox-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search mailboxes, groups, tags" aria-label="Search mailboxes" /></label><div className="ox-seg">{(["domain", "group"] as const).map((key) => <button key={key} type="button" className={groupBy === key ? "on" : ""} onClick={() => setGroupBy(key)}>By {key}</button>)}</div></div>
    {selected.length > 0 && <div className="ox-bulk" role="toolbar" aria-label="Bulk actions">
      <b>{selected.length} selected</b>
      <button type="button" className="ox-fire" onClick={() => void warm(selected)}><Flame size={15} /> Start warm-up</button>
      <button type="button" onClick={() => void bulk("pause")}>Pause</button>
      <button type="button" onClick={() => void bulk("resume")}>Resume</button>
      <button type="button" onClick={() => setPrompt({ op: "assign", label: "Assign to campaign" })}>Assign to campaign</button>
      <button type="button" onClick={() => setPrompt({ op: "group", label: "Group name" })}>Group</button>
      <button type="button" onClick={() => setPrompt({ op: "tag", label: "Tag" })}>Tag</button>
      <button type="button" onClick={() => setPrompt({ op: "target", label: "Daily target (1–50)" })}>Daily target</button>
      <button type="button" className="ox-icon" onClick={() => setSelected([])} aria-label="Clear selection"><X size={15} /></button>
      {prompt && <span className="ox-bulk-prompt">{prompt.op === "assign" ? <select autoFocus value={value} onChange={(event) => setValue(event.target.value)} aria-label="Campaign"><option value="">Choose…</option>{state.campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}</select> : <input autoFocus value={value} onChange={(event) => setValue(event.target.value)} placeholder={prompt.label} aria-label={prompt.label} />}<button type="button" className="primary-button" disabled={!value} onClick={() => void bulk(prompt.op, value)}>Apply</button></span>}
    </div>}
    <div className="ox-table-wrap"><table className="ox-table ox-mailboxes"><thead><tr><th><input type="checkbox" aria-label="Select all" checked={all} onChange={() => setSelected(all ? [] : rows.map((mailbox) => mailbox.id))} /></th><th>Mailbox</th><th>Warm-up</th><th>Today</th><th>Health</th><th>Report</th><th>Campaigns</th><th>Cost / mo</th></tr></thead>
      {groups.map(([group, items]) => <tbody key={group}><tr className="ox-group"><td colSpan={8}>{group} <small>{items.length}</small></td></tr>{items.map((mailbox) => <tr key={mailbox.id} className={selected.includes(mailbox.id) ? "sel" : ""}>
        <td><input type="checkbox" aria-label={`Select ${mailbox.email}`} checked={selected.includes(mailbox.id)} onChange={() => setSelected(selected.includes(mailbox.id) ? selected.filter((id) => id !== mailbox.id) : [...selected, mailbox.id])} /></td>
        <td><button type="button" className="ox-sender" onClick={() => setEditing(mailbox)} title="Edit sender name and photo"><SenderAvatar mailbox={mailbox} /><span><b>{mailbox.displayName || mailbox.email}</b><small>{mailbox.email}</small></span></button><small>{mailbox.host === "google" ? "Google" : "Microsoft"} · <span className={`ox-status ${mailbox.status}`}>{mailbox.status}</span>{mailbox.tags.map((tag) => <span key={tag} className="ox-tag">{tag}</span>)}</small>{mailbox.pausedReason && <small className="ox-warn-text">{mailbox.pausedReason}</small>}</td>
        <td><button type="button" className="ox-flame-btn" onClick={() => void (mailbox.status === "ramping" ? act("mailboxes-bulk", { ids: [mailbox.id], op: "warmup-pause" }, "Warm-up paused") : warm([mailbox.id]))} title={mailbox.warmupPending ? `Waiting for DNS — starts automatically. ${mailbox.authMissing.join(" ")}` : mailbox.status === "ramping" ? "Click to pause warm-up" : "Click to warm up — Outreach fixes the DNS and starts when it passes"}><FlameMeter progress={mailbox.rampProgress} active={mailbox.status === "ramping"} waiting={mailbox.warmupPending} />{mailbox.warmupPending ? <small>Waiting for DNS…</small> : <small>{mailbox.status === "ramping" ? `${Math.round(mailbox.rampProgress * 100)}%` : mailbox.rampProgress >= 1 ? "Warm" : "Start"}</small>}</button></td>
        <td><span className="ox-meter" aria-label={`${mailbox.sentToday} of ${mailbox.limitToday} sent today`}><span style={{ width: `${mailbox.limitToday ? Math.min(100, (mailbox.sentToday / mailbox.limitToday) * 100) : 0}%` }} /></span><small>{mailbox.sentToday}/{mailbox.limitToday}</small></td>
        <td><HealthPill health={mailbox.health} /></td>
        <td><button type="button" className="ox-link" onClick={() => setReportFor(mailbox)}><Activity size={14} /> Report</button></td>
        <td>{mailbox.campaigns.map((campaign) => campaign.name).join(", ") || <span className="ox-muted">—</span>}</td>
        <td>{money(mailbox.monthlyCostCents)}</td>
      </tr>)}</tbody>)}
    </table></div>
    {editing && <SenderDrawer mailbox={editing} act={act} onClose={() => setEditing(null)} />}
    {reportFor && <ReportDrawer mailbox={reportFor} onClose={() => setReportFor(null)} />}
    {warmResults && <WarmupResults results={warmResults} onClose={() => setWarmResults(null)} />}
  </div>;
}

function Domains({ state, act }: { state: OutreachState; act: Act }) {
  const [plan, setPlan] = useState<{ domain: string; data: any } | null>(null);
  const [history, setHistory] = useState<{ domain: string; changes: any[] } | null>(null);
  const [script, setScript] = useState("");
  if (!state.domains.length) return <div className="ox-empty"><Globe size={28} /><p>Domains appear here once you add mailboxes.</p></div>;
  return <div className="ox-stack">
    <div className="ox-row-between"><p className="ox-muted">Checked against public DNS every 12 hours. Campaigns can't launch unless SPF, DKIM and DMARC all pass.</p>{state.domains.some((domain) => domain.host === "microsoft" && domain.check.dkim !== "pass") && <button type="button" className="secondary-button" onClick={async () => { const result = await act<{ script: string }>("dkim-script"); if (result) setScript(result.script); }}><ShieldCheck size={15} /> DKIM script (all domains)</button>}</div>
    {script && <div className="ox-panel"><header><h3>Turn on DKIM for every Microsoft domain</h3><button type="button" className="ox-icon" onClick={() => setScript("")} aria-label="Close"><X size={15} /></button></header><p className="ox-muted">Microsoft has no API for this step. Paste into Azure Cloud Shell or Exchange Online PowerShell once; the OS detects DKIM within the hour.</p><pre className="ox-code">{script}</pre><button type="button" className="secondary-button" onClick={() => void navigator.clipboard.writeText(script)}><Copy size={14} /> Copy</button></div>}
    <div className="ox-domain-grid">{state.domains.map((domain) => <article key={domain.id} className={`ox-domain ${domain.check.allPass ? "ok" : domain.check.checkedAt ? "bad" : ""}`}>
      <header><b>{domain.domain}</b>{domain.protected && <span className="ox-tag" title="Primary business domain — automation never changes its DNS"><Lock size={11} /> protected</span>}</header>
      <div className="ox-auth-row"><AuthDot label="SPF" value={domain.check.spf} /><AuthDot label="DKIM" value={domain.check.dkim} /><AuthDot label="DMARC" value={domain.check.dmarc} /><AuthDot label="MX" value={domain.check.mx} /></div>
      {(domain.check.details || []).length > 0 && <p className="ox-muted">{domain.check.details!.join(" ")}</p>}
      <small className="ox-muted">Checked {ago(domain.check.checkedAt)}{domain.annualCostCents ? ` · ${money(domain.annualCostCents)}/yr` : ""}</small>
      <footer>
        <button type="button" className="secondary-button" onClick={() => void act("domain-check", { domain: domain.domain }, "Checked")}><RefreshCw size={13} /> Check</button>
        {!domain.protected && <button type="button" className="secondary-button" onClick={async () => { const data = await act<any>("dns-plan", { domain: domain.domain }); if (data) setPlan({ domain: domain.domain, data }); }}>Repair</button>}
        <button type="button" className="ox-link" onClick={async () => { const data = await act<{ changes: any[] }>("dns-history", { domain: domain.domain }); if (data) setHistory({ domain: domain.domain, changes: data.changes }); }}>History</button>
        <button type="button" className="ox-link" onClick={() => void act("domain-protect", { domain: domain.domain, protected: !domain.protected }, domain.protected ? "Unprotected" : "Protected")}>{domain.protected ? "Unprotect" : "Protect"}</button>
      </footer>
    </article>)}</div>
    {plan && <div className="crm-modal-backdrop" role="dialog" aria-label={`DNS repair for ${plan.domain}`}><div className="crm-modal">
      <h2>DNS repair · {plan.domain}</h2>
      {plan.data.plan.actions.length === 0 && plan.data.plan.conflicts.length === 0 && <p>Everything the platform manages is already correct.</p>}
      {plan.data.plan.actions.length > 0 && <><h3>Changes</h3><ul className="ox-plan">{plan.data.plan.actions.map((action: any, index: number) => <li key={index}><b>{action.op}</b> {action.type} {action.name} {action.content ? <code>{action.content}</code> : null}<small>{action.reason}</small></li>)}</ul></>}
      {plan.data.plan.conflicts.length > 0 && <><h3>Left alone (needs you)</h3><ul className="ox-plan bad">{plan.data.plan.conflicts.map((conflict: any, index: number) => <li key={index}>{conflict.message}</li>)}</ul></>}
      {plan.data.plan.warnings.map((warning: string) => <p key={warning} className="ox-warn-text">{warning}</p>)}
      <footer><button type="button" className="secondary-button" onClick={() => setPlan(null)}>Close</button>{plan.data.plan.actions.length > 0 && <button type="button" className="primary-button" onClick={async () => { await act("dns-plan", { domain: plan.domain, apply: true }, "DNS updated — every change can be rolled back"); setPlan(null); }}>Apply {plan.data.plan.actions.length} change{plan.data.plan.actions.length === 1 ? "" : "s"}</button>}</footer>
    </div></div>}
    {history && <div className="crm-modal-backdrop" role="dialog" aria-label={`DNS history for ${history.domain}`}><div className="crm-modal">
      <h2>DNS history · {history.domain}</h2>
      {history.changes.length === 0 ? <p className="ox-muted">No changes made by the platform.</p> : <ul className="ox-plan">{history.changes.map((change) => <li key={change.id}><b>{change.action}</b> {change.record_type} {change.record_name}<small>{change.reason} · {change.actor} · {ago(change.created_at)}</small>{change.action !== "rollback" && !change.rolled_back_by && <button type="button" className="ox-link" onClick={async () => { await act("dns-rollback", { changeId: change.id }, "Rolled back"); setHistory(null); }}><Undo2 size={13} /> Roll back</button>}{change.rolled_back_by && <small>rolled back</small>}</li>)}</ul>}
      <footer><button type="button" className="secondary-button" onClick={() => setHistory(null)}>Close</button></footer>
    </div></div>}
  </div>;
}

// ============================ provisioning ============================
type Offer = { domain: string; available: boolean; currency: string; registrationCents: number; renewalCents: number; reason: string };
type Identity = { firstName: string; lastName: string; local: string };

function Provisioning({ state, act, reload }: { state: OutreachState; act: Act; reload: () => Promise<void> }) {
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [host, setHost] = useState<"microsoft" | "google">(state.connections.find((connection) => connection.provider === "google" && connection.status === "ok") && !state.connections.find((connection) => connection.provider === "microsoft" && connection.status === "ok") ? "google" : "microsoft");
  const [business, setBusiness] = useState("");
  const [offers, setOffers] = useState<Offer[]>([]);
  const [picked, setPicked] = useState<Record<string, Offer & { buy: boolean }>>({});
  const [owned, setOwned] = useState("");
  const [perDomain, setPerDomain] = useState(2);
  const [identities, setIdentities] = useState<Identity[]>([{ firstName: "", lastName: "", local: "" }, { firstName: "", lastName: "", local: "" }]);
  const [group, setGroup] = useState("");
  const [review, setReview] = useState<any>(null);
  const [approve, setApprove] = useState(false);
  const [busy, setBusy] = useState("");
  const [existing, setExisting] = useState({ email: "", displayName: "", manageDns: true });
  useEffect(() => { setIdentities((current) => Array.from({ length: perDomain }, (_, index) => current[index] || { firstName: "", lastName: "", local: "" })); }, [perDomain]);
  const order = () => ({ host, domains: [...Object.values(picked).map((offer) => ({ domain: offer.domain, buy: offer.buy, registrationCents: offer.registrationCents, renewalCents: offer.renewalCents, currency: offer.currency })), ...owned.split(/[\s,]+/).map((domain) => domain.trim().toLowerCase()).filter(Boolean).map((domain) => ({ domain, buy: false }))], inboxesPerDomain: perDomain, identities: identities.map((identity) => ({ ...identity, local: identity.local || identity.firstName.toLowerCase() })), group });
  const hostConnected = state.connections.some((connection) => connection.provider === host && connection.status === "ok");
  return <div className="ox-stack">
    {state.jobs.filter((job) => job.status === "running" || job.progress.failed).map((job) => <JobTimeline key={job.id} job={job} act={act} />)}
    <div className="ox-seg" role="group">{([["new", "New domains & mailboxes"], ["existing", "Connect an existing mailbox"]] as const).map(([key, label]) => <button key={key} type="button" className={mode === key ? "on" : ""} onClick={() => setMode(key)}>{label}</button>)}</div>
    <div className="ox-seg" role="group" aria-label="Mail host">{(["microsoft", "google"] as const).map((key) => <button key={key} type="button" className={host === key ? "on" : ""} onClick={() => setHost(key)}>{key === "microsoft" ? "Microsoft 365" : "Google Workspace"}{state.connections.some((connection) => connection.provider === key && connection.status === "ok") ? " ✓" : ""}</button>)}</div>
    {!hostConnected && <p className="ox-warn-text"><AlertTriangle size={14} /> Connect {host === "microsoft" ? "Microsoft 365" : "Google Workspace"} in Settings (⚙︎ top right) first.</p>}
    {mode === "existing" ? <div className="ox-panel"><h3>Try the whole workflow with one mailbox</h3><p className="ox-muted">Uses a mailbox that already exists in your connected account. Then click its flame: Outreach fixes the domain's email DNS and starts warm-up as soon as it passes.</p>
      <div className="ox-grid2"><label className="ox-field">Mailbox email<input value={existing.email} onChange={(event) => setExisting({ ...existing, email: event.target.value })} placeholder="you@yourdomain.com" /></label><label className="ox-field">Sender name<input value={existing.displayName} onChange={(event) => setExisting({ ...existing, displayName: event.target.value })} placeholder="Sean Kelly" /></label></div>
      <button type="button" className="primary-button" disabled={!hostConnected || !existing.email} onClick={() => void act("connect-existing-mailbox", { host, ...existing, targetDaily: 10 }, "Mailbox connected — authentication checked")}>Connect mailbox</button>
      <label className="ox-check"><input type="checkbox" checked={existing.manageDns} onChange={(event) => setExisting({ ...existing, manageDns: event.target.checked })} /> Let Outreach manage this domain's email DNS (SPF, DMARC, MX on Cloudflare)</label>
      <small className="ox-muted">Use a dedicated outreach domain. Your main business domain is always protected and never changed.</small></div> : <>
      <div className="ox-panel"><h3>1 · Domains</h3>
        <div className="ox-row"><input value={business} onChange={(event) => setBusiness(event.target.value)} placeholder="Business name, e.g. F2B Media" aria-label="Business name" /><button type="button" className="primary-button" disabled={!business || busy === "suggest"} onClick={async () => { setBusy("suggest"); const result = await act<{ offers: Offer[] }>("domains-suggest", { businessName: business }); setBusy(""); if (result) setOffers(result.offers); }}>{busy === "suggest" ? <Loader2 className="ox-spin" size={15} /> : <Sparkles size={15} />} Suggest domains</button></div>
        {offers.length > 0 && <div className="ox-offers">{offers.map((offer) => { const on = Boolean(picked[offer.domain]); return <button key={offer.domain} type="button" disabled={!offer.available} className={on ? "on" : ""} onClick={() => setPicked((current) => { const next = { ...current }; if (on) delete next[offer.domain]; else next[offer.domain] = { ...offer, buy: true }; return next; })}><b>{offer.domain}</b><small>{offer.available ? `${money(offer.registrationCents, offer.currency)} first year · ${money(offer.renewalCents, offer.currency)}/yr` : "Taken"}</small>{on && <CheckCircle2 size={15} />}</button>; })}</div>}
        {offers.length > 0 && <div className="ox-row"><button type="button" className="ox-link" onClick={() => setPicked(Object.fromEntries(offers.filter((offer) => offer.available).slice(0, 5).map((offer) => [offer.domain, { ...offer, buy: true }])))}>Select the 5 cheapest available</button><button type="button" className="ox-link" onClick={() => setPicked({})}>Clear</button></div>}
        <label className="ox-field">Domains you already own (on Cloudflare), comma-separated<input value={owned} onChange={(event) => setOwned(event.target.value)} placeholder="tryf2bmedia.com, getf2b.com" /></label>
      </div>
      <div className="ox-panel"><h3>2 · Inboxes & sender identities</h3>
        <div className="ox-row"><label className="ox-inline">Inboxes per domain <select value={perDomain} onChange={(event) => setPerDomain(Number(event.target.value))}>{[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}</select></label><label className="ox-inline">Group <input value={group} onChange={(event) => setGroup(event.target.value)} placeholder="e.g. Roofing" /></label></div>
        {identities.map((identity, index) => <div key={index} className="ox-identity"><input value={identity.firstName} onChange={(event) => setIdentities(identities.map((item, i) => i === index ? { ...item, firstName: event.target.value } : item))} placeholder="First name" aria-label={`First name ${index + 1}`} /><input value={identity.lastName} onChange={(event) => setIdentities(identities.map((item, i) => i === index ? { ...item, lastName: event.target.value } : item))} placeholder="Last name" aria-label={`Last name ${index + 1}`} /><input value={identity.local} onChange={(event) => setIdentities(identities.map((item, i) => i === index ? { ...item, local: event.target.value } : item))} placeholder={identity.firstName ? identity.firstName.toLowerCase() : "mailbox name"} aria-label={`Mailbox name ${index + 1}`} /><span className="ox-muted">@domain</span></div>)}
      </div>
      <div className="ox-panel"><h3>3 · Review costs & approve</h3>
        <button type="button" className="secondary-button" disabled={!hostConnected || busy === "review"} onClick={async () => { setBusy("review"); const result = await act<any>("provision-plan", order()); setBusy(""); setReview(result); }}>{busy === "review" ? "Checking…" : "Review"}</button>
        {review && <div className="ox-review">
          <ul><li><b>{review.plan.domains}</b> domains · <b>{review.plan.mailboxes}</b> mailboxes · {review.plan.steps.length} automated steps</li><li>Upfront: <b>{money(review.costs.upfrontCents, review.costs.currency)}</b> (domain registrations)</li><li>Monthly: <b>{money(review.costs.monthlyCents, review.costs.currency)}</b> ({money(review.costs.mailboxMonthlyCents)} mailboxes + domain renewals ÷ 12)</li>{host === "microsoft" && review.seats?.length > 0 && <li>Free Exchange seats: <b>{review.seats.reduce((total: number, seat: any) => total + seat.free, 0)}</b> (buy more in the Microsoft admin centre; the setup waits for them)</li>}<li>One guided step per domain: DKIM (no API from {host === "microsoft" ? "Microsoft" : "Google"}).</li></ul>
          {review.buying.length > 0 && <label className="ox-check ox-approve"><input type="checkbox" checked={approve} onChange={(event) => setApprove(event.target.checked)} /> I approve buying {review.buying.length} domain{review.buying.length === 1 ? "" : "s"}: {review.buying.join(", ")}</label>}
          {review.buying.length > 0 && !review.purchasesEnabled && <p className="ox-warn-text"><Lock size={13} /> Purchasing is switched off on the server, so the setup will pause at "Buy domain" and nothing will be charged.</p>}
          <button type="button" className="primary-button ox-launch" disabled={busy === "start" || (review.buying.length > 0 && !approve)} onClick={async () => { setBusy("start"); const result = await act("provision-start", { ...order(), approvePurchase: approve }, "Setup started"); setBusy(""); if (result) { setReview(null); setPicked({}); setOffers([]); await reload(); } }}>Start automatic setup</button>
        </div>}
      </div>
    </>}
  </div>;
}

function JobTimeline({ job, act }: { job: OutreachState["jobs"][number]; act: Act }) {
  const byDomain = useMemo(() => { const map = new Map<string, typeof job.steps>(); for (const step of job.steps) map.set(step.domain, [...(map.get(step.domain) || []), step]); return [...map.entries()]; }, [job.steps]);
  return <div className="ox-panel ox-job" aria-live="polite">
    <header><div><h3>Setting up {job.input.domains?.length || 0} domain{job.input.domains?.length === 1 ? "" : "s"}</h3><p className="ox-muted">{job.progress.done} of {job.progress.total} steps · {job.progress.state === "ready-dkim-pending" ? "ready — DKIM still to switch on" : job.progress.state.replace("-", " ")}</p></div><strong>{job.progress.percent}%</strong></header>
    <div className="ox-progress"><span style={{ width: `${job.progress.percent}%` }} className={job.status === "running" ? "live" : ""} /></div>
    {byDomain.map(([domain, steps]) => <div key={domain} className="ox-timeline"><b>{domain}</b><ol>{steps.map((step) => <li key={step.key} className={step.status}>
      <span className="ox-tl-icon">{step.status === "done" ? <CheckCircle2 size={15} /> : step.status === "failed" ? <XCircle size={15} /> : step.status === "pending" ? <CircleDashed size={15} /> : <Loader2 size={15} className="ox-spin" />}</span>
      <span><b>{step.label}{step.email ? ` · ${step.email}` : ""}</b>{step.message && <small>{step.message}</small>}{step.manual && step.status !== "done" && <small>{step.note}</small>}</span>
      {(step.status === "failed" || (step.status === "waiting" && step.manual)) && <button type="button" className="ox-link" onClick={() => void act("job-retry", { jobId: job.id, stepKey: step.key }, "Retrying")}>Retry</button>}
    </li>)}</ol></div>)}
  </div>;
}

// ============================ placement ============================
function Placement({ state, act }: { state: OutreachState; act: Act }) {
  const [mailboxId, setMailboxId] = useState(state.mailboxes[0]?.id || "");
  const connect = async (provider: "gmail" | "outlook") => { const result = await act<{ url: string }>("seed-connect-url", { provider }); if (result?.url) window.location.href = result.url; };
  return <div className="ox-stack">
    <div className="ox-panel"><h3>Seed inboxes (free)</h3><p className="ox-muted">Free Gmail and Outlook.com accounts you own. The OS sends a real test email to each one and reads — read-only — whether it landed in the inbox, a tab, or spam. No paid subscription needed.</p>
      <ul className="ox-seeds">{state.seeds.map((seed) => <li key={seed.id}><Mail size={14} /> {seed.email} <span className={`ox-status ${seed.status === "ok" ? "active" : "error"}`}>{seed.status}</span>{seed.last_error && <small className="ox-warn-text">{seed.last_error}</small>}<button type="button" className="ox-icon" aria-label={`Remove ${seed.email}`} onClick={() => void act("seed-remove", { id: seed.id }, "Seed removed")}><Trash2 size={14} /></button></li>)}</ul>
      <div className="ox-row"><button type="button" className="secondary-button" disabled={!state.seedAppsConfigured.gmail} onClick={() => void connect("gmail")}><Plus size={14} /> Gmail seed</button><button type="button" className="secondary-button" disabled={!state.seedAppsConfigured.outlook} onClick={() => void connect("outlook")}><Plus size={14} /> Outlook.com seed</button></div>
      {(!state.seedAppsConfigured.gmail || !state.seedAppsConfigured.outlook) && <p className="ox-muted">One-time server setup needed for {[!state.seedAppsConfigured.gmail && "Gmail", !state.seedAppsConfigured.outlook && "Outlook.com"].filter(Boolean).join(" and ")} seed sign-in (free OAuth apps).</p>}
    </div>
    <div className="ox-panel"><h3>Run a test</h3><div className="ox-row"><select value={mailboxId} onChange={(event) => setMailboxId(event.target.value)} aria-label="Mailbox to test">{state.mailboxes.map((mailbox) => <option key={mailbox.id} value={mailbox.id}>{mailbox.email}</option>)}</select><button type="button" className="primary-button" disabled={!mailboxId || !state.seeds.length} onClick={() => void act("placement-run", { mailboxId }, "Test sent — results in a few minutes")}>Send test</button></div>
      <p className="ox-muted">Results feed the health score: under 60% inbox halves that mailbox's volume, under 25% pauses it.</p></div>
    {state.placementTests.length > 0 && <div className="ox-panel"><h3>Results</h3><table className="ox-table"><thead><tr><th>Mailbox</th><th>When</th><th>Inbox</th><th>Detail</th></tr></thead><tbody>{state.placementTests.map((test) => <tr key={test.id}><td>{state.mailboxes.find((mailbox) => mailbox.id === test.mailboxId)?.email || "—"}</td><td>{ago(test.createdAt)}</td><td>{test.status === "done" ? <b className={test.inboxRate !== null && test.inboxRate >= 0.6 ? "ox-good-text" : "ox-warn-text"}>{pct(test.inboxRate)}</b> : <span className="ox-muted"><Loader2 size={13} className="ox-spin" /> checking</span>}</td><td>{test.results.map((result) => <span key={result.seed} className={`ox-label ${result.placement === "inbox" ? "positive" : result.placement === "spam" ? "spam" : "neutral"}`}>{result.provider}: {result.placement}</span>)}</td></tr>)}</tbody></table></div>}
  </div>;
}

// ============================ drawers ============================
export function SettingsDrawer({ state, act, onClose }: { state: OutreachState; act: Act; onClose: () => void }) {
  const s = state.settings;
  const [form, setForm] = useState({ cooldownDays: s.cooldownDays, bookingUrl: s.bookingUrl, ms: s.seatPriceCents.microsoft ?? "", google: s.seatPriceCents.google ?? "", workers: s.workersPlanCents ?? "", defaultTargetDaily: s.defaultTargetDaily, dmarcReportEmail: s.dmarcReportEmail, senderAddress: s.senderAddress, appUrl: s.appUrl });
  const [ms, setMs] = useState({ tenantId: "", clientId: "", clientSecret: "" });
  const [google, setGoogle] = useState({ adminEmail: "", serviceAccountJson: "" });
  const telegram = state.connections.find((connection) => connection.provider === "telegram");
  const [tg, setTg] = useState({ chatId: String(telegram?.config?.chatId || ""), botToken: "" });
  const [suppress, setSuppress] = useState("");
  return <div className="ox-drawer-backdrop" onClick={onClose}><aside className="ox-drawer" onClick={(event) => event.stopPropagation()} aria-label="Outreach settings">
    <header><h2>Outreach settings</h2><button type="button" className="ox-icon" onClick={onClose} aria-label="Close"><X size={17} /></button></header>
    <section><h3>Sending rules</h3>
      <label className="ox-field">Re-contact gap (days)<input type="number" min={0} value={form.cooldownDays} onChange={(event) => setForm({ ...form, cooldownDays: Number(event.target.value) })} /><small>0 turns it off. Unsubscribes and complaints are always permanent.</small></label>
      <label className="ox-field">Default daily target per mailbox<input type="number" min={1} max={50} value={form.defaultTargetDaily} onChange={(event) => setForm({ ...form, defaultTargetDaily: Number(event.target.value) })} /></label>
      <label className="ox-field">Booking link<input value={form.bookingUrl} onChange={(event) => setForm({ ...form, bookingUrl: event.target.value })} placeholder="https://…" /></label>
      <label className="ox-field">Postal address for the email footer<input value={form.senderAddress} onChange={(event) => setForm({ ...form, senderAddress: event.target.value })} /></label>
      <label className="ox-field">DMARC report email<input value={form.dmarcReportEmail} onChange={(event) => setForm({ ...form, dmarcReportEmail: event.target.value })} /></label>
      <label className="ox-field">App address (for unsubscribe and alert links)<input value={form.appUrl} onChange={(event) => setForm({ ...form, appUrl: event.target.value })} /></label>
    </section>
    <section><h3>Real costs</h3>
      <div className="ox-grid2"><label className="ox-field">Microsoft seat (cents/mo)<input type="number" value={form.ms} onChange={(event) => setForm({ ...form, ms: event.target.value as never })} /></label><label className="ox-field">Google seat (cents/mo)<input type="number" value={form.google} onChange={(event) => setForm({ ...form, google: event.target.value as never })} /></label><label className="ox-field">Workers plan (cents/mo)<input type="number" value={form.workers} onChange={(event) => setForm({ ...form, workers: event.target.value as never })} /></label></div>
      <button type="button" className="primary-button" onClick={() => void act("save-settings", { cooldownDays: form.cooldownDays, bookingUrl: form.bookingUrl, defaultTargetDaily: form.defaultTargetDaily, senderAddress: form.senderAddress, dmarcReportEmail: form.dmarcReportEmail, appUrl: form.appUrl, seatPriceCents: { microsoft: form.ms, google: form.google }, workersPlanCents: form.workers }, "Settings saved")}>Save</button>
    </section>
    <section><h3>Microsoft 365</h3><p className="ox-muted">An Entra app with User.ReadWrite.All, Domain.ReadWrite.All, Organization.Read.All, Mail.Send and Mail.ReadBasic.All (admin consent).</p>
      <input placeholder="Tenant ID" value={ms.tenantId} onChange={(event) => setMs({ ...ms, tenantId: event.target.value })} /><input placeholder="Application (client) ID" value={ms.clientId} onChange={(event) => setMs({ ...ms, clientId: event.target.value })} /><input type="password" placeholder="Client secret" value={ms.clientSecret} onChange={(event) => setMs({ ...ms, clientSecret: event.target.value })} />
      <button type="button" className="secondary-button" onClick={() => void act("connect-microsoft", ms, "Microsoft checked")}>Connect & verify</button></section>
    <section><h3>Google Workspace</h3><p className="ox-muted">Service account with domain-wide delegation (directory, site verification, gmail.send, gmail.readonly).</p>
      <input placeholder="Super-admin email" value={google.adminEmail} onChange={(event) => setGoogle({ ...google, adminEmail: event.target.value })} />
      <label className="secondary-button"><input type="file" accept=".json,application/json" hidden onChange={async (event) => { const file = event.target.files?.[0]; if (file) setGoogle({ ...google, serviceAccountJson: await file.text() }); }} />{google.serviceAccountJson ? "Key loaded ✓" : "Upload JSON key"}</label>
      <button type="button" className="secondary-button" disabled={!google.serviceAccountJson} onClick={() => void act("connect-google", google, "Google checked")}>Connect & verify</button></section>
    <section><h3>Telegram</h3><p className="ox-muted">{telegram?.config?.source === "worker-secret" ? "Using your existing F2B bot from the server secrets." : telegram?.config?.source === "saved-api-key" ? "Using the Telegram key saved under Settings → Other API keys." : "No bot found in the server secrets. Paste your existing F2B bot token once (send-only; its current setup isn't touched)."}</p>
      <input placeholder="Chat ID to alert" value={tg.chatId} onChange={(event) => setTg({ ...tg, chatId: event.target.value })} />
      {!telegram?.config?.source && <input type="password" placeholder="Existing bot token" value={tg.botToken} onChange={(event) => setTg({ ...tg, botToken: event.target.value })} />}
      <button type="button" className="secondary-button" onClick={() => void act("connect-telegram", tg, "Telegram connected")}>Save</button></section>
    <section><h3>Suppression list <small>({state.suppressionCount})</small></h3><div className="ox-row"><input placeholder="email@company.com or @company.com" value={suppress} onChange={(event) => setSuppress(event.target.value)} /><button type="button" className="secondary-button" disabled={!suppress} onClick={async () => { await act("suppression-add", { value: suppress }, "Suppressed"); setSuppress(""); }}>Add</button></div></section>
  </aside></div>;
}

type Entry = { id: string; kind: string; title: string; body: string; evidence: string; client_id: string | null; updated_at: string };

export function PlaybookDrawer({ kinds, clients, onClose }: { kinds: Record<string, string>; clients: Array<{ id: string; name: string }>; onClose: () => void }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState({ id: "", kind: "rule", title: "", body: "", evidence: "hypothesis", clientId: "" });
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const load = async () => { try { setEntries((await outreachAction<{ entries: Entry[] }>("playbook-list")).entries); } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't load."); } };
  useEffect(() => { void load(); }, []);
  const save = async () => { try { await outreachAction("playbook-save", draft); setDraft({ id: "", kind: draft.kind, title: "", body: "", evidence: "hypothesis", clientId: "" }); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't save."); } };
  const shown = entries.filter((entry) => !filter || entry.kind === filter);
  return <div className="ox-drawer-backdrop" onClick={onClose}><aside className="ox-drawer wide" onClick={(event) => event.stopPropagation()} aria-label="AI Playbook">
    <header><h2>AI Playbook</h2><button type="button" className="ox-icon" onClick={onClose} aria-label="Close"><X size={17} /></button></header>
    <p className="ox-muted">Everything the copywriter and sales responder learn from: instructions, approved examples, documents, verified case studies and your corrections. Mark only real results as proven — the AI never presents a hypothesis as fact.</p>
    {error && <p className="ox-alert">{error}</p>}
    <section className="ox-pb-form">
      <div className="ox-grid2"><label className="ox-field">Type<select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value })}>{Object.entries(kinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="ox-field">Client (optional)<select value={draft.clientId} onChange={(event) => setDraft({ ...draft, clientId: event.target.value })}><option value="">All campaigns</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label></div>
      <input placeholder="Title (optional)" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
      <textarea rows={draft.kind === "document" ? 8 : 4} placeholder={draft.kind === "document" ? "Paste the document text, or upload a .txt / .md file" : draft.kind === "correction" ? "e.g. Never open with a compliment about their website." : "Write it the way you'd brief a new team member."} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
      <div className="ox-row-between">
        <div className="ox-row">{draft.kind === "document" && <label className="secondary-button"><input type="file" accept=".txt,.md,.csv,text/plain,text/markdown" hidden onChange={async (event) => { const file = event.target.files?.[0]; if (file) setDraft({ ...draft, title: draft.title || file.name, body: (await file.text()).slice(0, 200_000) }); }} />Upload text file</label>}
          {["case-study", "campaign", "example"].includes(draft.kind) && <label className="ox-check"><input type="checkbox" checked={draft.evidence === "proven"} onChange={(event) => setDraft({ ...draft, evidence: event.target.checked ? "proven" : "hypothesis" })} /> Proven real result</label>}</div>
        <button type="button" className="primary-button" disabled={!draft.body.trim()} onClick={() => void save()}>{draft.id ? "Update" : "Add to Playbook"}</button>
      </div>
    </section>
    <div className="ox-chips"><button type="button" className={!filter ? "on" : ""} onClick={() => setFilter("")}>All ({entries.length})</button>{Object.entries(kinds).filter(([key]) => entries.some((entry) => entry.kind === key)).map(([key, label]) => <button key={key} type="button" className={filter === key ? "on" : ""} onClick={() => setFilter(key)}>{label} ({entries.filter((entry) => entry.kind === key).length})</button>)}</div>
    <ul className="ox-pb-list">{shown.map((entry) => <li key={entry.id}><div><span className="ox-tag">{kinds[entry.kind] || entry.kind}</span>{entry.evidence === "proven" && <span className="ox-tag good">proven</span>}<b>{entry.title}</b></div><p>{entry.body.slice(0, 280)}{entry.body.length > 280 ? "…" : ""}</p><div className="ox-row"><button type="button" className="ox-link" onClick={() => setDraft({ id: entry.id, kind: entry.kind, title: entry.title, body: entry.body, evidence: entry.evidence, clientId: entry.client_id || "" })}>Edit</button><button type="button" className="ox-link" onClick={async () => { await outreachAction("playbook-delete", { id: entry.id }); await load(); }}>Delete</button></div></li>)}
      {!shown.length && <li className="ox-muted">Start with your agency info, offers and three writing rules — the copywriter uses them straight away.</li>}</ul>
  </aside></div>;
}
