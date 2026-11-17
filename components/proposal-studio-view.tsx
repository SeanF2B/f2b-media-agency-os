"use client";

// Operations → Reports → Proposals: AI Proposal Studio with a live slide editor.
// Pick a CRM client/prospect (or a new business + website) → extract their site (logo, photos, live screenshots,
// services) → import audits, reports, CRM notes and documents → choose services from the catalogue → AI writes
// a personalised, F2B-branded presentation → edit any text in place, swap images, reorder slides → share a
// client link or download a PDF. One engine with the reports system: same AI provider, CRM, R2 and loaders.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./proposal-studio.css";
import { ReportGeneratingAnimation } from "./report-generating-animation";
import { SERVICE_CATALOGUE, type CatalogueService } from "@/lib/proposals/catalogue";
import { SLIDE_KINDS, blankSlide, type ProposalBrand, type ProposalDeck, type ProposalInputs, type ProposalSource, type ProposalUpload, type SelectedService, type Slide, type SlideKind } from "@/lib/proposals/deck";
import { renderProposalHtml } from "@/lib/proposals/render";

type StudioClient = { id: string; name: string; logo?: string; status?: string };
type Proposal = {
  id: string; clientId: string | null; contactId: string | null; businessName: string; website: string; title: string; status: string;
  brand: ProposalBrand; inputs: ProposalInputs; services: SelectedService[]; deck: ProposalDeck | null; uploads: ProposalUpload[];
  shareToken: string | null; viewCount: number; viewedAt: string | null; approvedAt: string | null; createdAt: string; updatedAt: string;
};
type ListItem = { id: string; clientId: string | null; businessName: string; website: string; title: string; status: string; logo: string; viewCount: number; viewedAt: string | null; approvedAt: string | null; shared: boolean; updatedAt: string };
type SourceRef = { ref: string; label: string; kind: string; date: string };
type Prospect = { id: string; name: string; company: string; email: string };

const STATUS_LABEL: Record<string, string> = { draft: "Draft", ready: "Ready", sent: "Sent", viewed: "Viewed", approved: "Approved", declined: "Declined" };
const GEN_STEPS = ["Reading their website and brand…", "Reviewing audits, reports and call notes…", "Matching services to their goals…", "Writing personalised slide copy…", "Designing device mockups and graphics…", "Building the investment summary…", "Polishing your proposal…"];
const api = async <T,>(body: Record<string, unknown>): Promise<T> => {
  const response = await fetch("/api/proposals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Something went wrong. Try again.");
  return payload;
};
const fmtDate = (value: string | null) => value ? new Date(value).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" }) : "";
const humanize = (key: string) => key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).replace(/\bCta\b/, "Button");
const assetUrl = (proposalId: string) => (name: string) => `/api/proposals?asset=${encodeURIComponent(`${proposalId}/${name}`)}`;
const imgSrc = (proposalId: string, src: string) => src.startsWith("r2:") ? assetUrl(proposalId)(src.slice(3)) : src;
function setPath<T>(data: T, path: string, value: unknown): T {
  const clone = JSON.parse(JSON.stringify(data)) as any;
  const keys = path.split(".");
  let node = clone;
  keys.slice(0, -1).forEach((key, index) => { if (node[key] == null) node[key] = /^\d+$/.test(keys[index + 1]) ? [] : {}; node = node[key]; });
  node[keys[keys.length - 1]] = value;
  return clone;
}
const AGENCY_LOGO = typeof window !== "undefined" ? `${window.location.origin}/f2b-login-logo.png` : "/f2b-login-logo.png";

/** ✨ beside a text field: Suggest (empty) / Improve (filled), Shorter, or 3 alternatives. */
function AiSuggest({ proposalId, field, label, value, onChange, slideKind }: { proposalId: string; field: string; label: string; value: string; onChange: (next: string) => void; slideKind?: string }) {
  const [busy, setBusy] = useState(false); const [open, setOpen] = useState(false); const [alts, setAlts] = useState<string[]>([]); const [undo, setUndo] = useState<string | null>(null); const [error, setError] = useState("");
  const run = async (mode: string) => {
    setBusy(true); setError(""); setOpen(false); setAlts([]);
    try {
      const { suggestions } = await api<{ suggestions: string[] }>({ action: "suggest", id: proposalId, field, label, current: value, slideKind, mode });
      if (mode === "alternatives") setAlts(suggestions);
      else { setUndo(value); onChange(suggestions[0]); window.setTimeout(() => setUndo(null), 10_000); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "AI unavailable."); }
    finally { setBusy(false); }
  };
  return <span className="ps-ai">
    <button type="button" className={`ps-ai-btn ${busy ? "busy" : ""}`} disabled={busy} onClick={() => setOpen((v) => !v)} title={value.trim() ? "Improve with AI" : "Suggest with AI"} aria-label={`AI suggest for ${label}`}><SparkIcon />{busy ? "Writing…" : value.trim() ? "AI" : "AI Suggest"}</button>
    {open && <span className="ps-ai-menu" role="menu"><button type="button" onClick={() => void run(value.trim() ? "improve" : "suggest")}>{value.trim() ? "Improve" : "Suggest"}</button>{value.trim() && <button type="button" onClick={() => void run("shorter")}>Make shorter</button>}<button type="button" onClick={() => void run("alternatives")}>3 alternatives</button></span>}
    {undo !== null && <button type="button" className="ps-ai-undo" onClick={() => { onChange(undo); setUndo(null); }}>Undo</button>}
    {alts.length > 0 && <span className="ps-ai-alts">{alts.map((alt, index) => <button type="button" key={index} onClick={() => { setUndo(value); onChange(alt); setAlts([]); }}>{alt}</button>)}<button type="button" className="ps-ai-close" onClick={() => setAlts([])}>Close</button></span>}
    {error && <span className="ps-ai-err" role="alert">{error}</span>}
  </span>;
}
function SparkIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" /></svg>; }

function TextField({ proposalId, field, label, value, onChange, rows = 1, placeholder, ai = true }: { proposalId: string; field: string; label: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; ai?: boolean }) {
  return <label className="ps-field" data-no-ai>
    <span className="ps-label">{label}{ai && <AiSuggest proposalId={proposalId} field={field} label={label} value={value} onChange={onChange} />}</span>
    {rows > 1 ? <textarea rows={rows} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /> : <input value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />}
  </label>;
}

export function ProposalStudioView({ clients, defaultClientId }: { clients: StudioClient[]; defaultClientId?: string }) {
  const [list, setList] = useState<ListItem[] | null>(null);
  const [catalogue, setCatalogue] = useState<CatalogueService[]>(SERVICE_CATALOGUE);
  const [openId, setOpenId] = useState("");
  const [creating, setCreating] = useState(false);
  const [showCatalogue, setShowCatalogue] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { const response = await fetch("/api/proposals", { cache: "no-store" }); const payload = await response.json() as { proposals?: ListItem[]; catalogue?: CatalogueService[]; error?: string }; if (!response.ok) throw new Error(payload.error || "Proposals are unavailable."); setList(payload.proposals || []); if (payload.catalogue?.length) setCatalogue(payload.catalogue); }
    catch (reason) { setList([]); setError(reason instanceof Error ? reason.message : "Proposals are unavailable."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const clientLogo = (id: string | null) => clients.find((client) => client.id === id)?.logo || "";

  if (openId) return <ProposalWorkspace id={openId} catalogue={catalogue} onBack={() => { setOpenId(""); void load(); }} />;
  return <section className="ps" aria-label="Proposals">
    <header className="ps-head">
      <div><h2>Proposals</h2><p>Premium, personalised marketing proposals built from the prospect&apos;s own website, your audits and call notes — edit live, share a link or download a PDF.</p></div>
      <div className="ps-head-actions"><button type="button" className="secondary-button" onClick={() => setShowCatalogue(true)}>Service catalogue</button><button type="button" className="primary-button" onClick={() => setCreating(true)}>+ New proposal</button></div>
    </header>
    {error && <p className="error-text" role="alert">{error}</p>}
    {list === null ? <div className="page-loading" role="status" aria-label="Loading proposals…"><i /></div> : list.length ? <div className="ps-grid">{list.map((item) => {
      const logo = item.logo || clientLogo(item.clientId);
      return <article key={item.id} className="ps-card" onClick={() => setOpenId(item.id)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") setOpenId(item.id); }}>
        <div className="ps-card-top">{logo ? <img src={logo} alt="" /> : <span className="ps-mono">{item.businessName.slice(0, 2).toUpperCase()}</span>}<span className={`ps-status s-${item.status}`}>{STATUS_LABEL[item.status] || item.status}</span></div>
        <b>{item.businessName}</b><small>{item.website.replace(/^https?:\/\//, "").replace(/\/$/, "") || "No website"}</small>
        <small className="ps-meta">Updated {fmtDate(item.updatedAt)}{item.shared ? ` · ${item.viewCount} view${item.viewCount === 1 ? "" : "s"}` : ""}{item.approvedAt ? ` · approved ${fmtDate(item.approvedAt)}` : ""}</small>
        <div className="ps-card-actions" onClick={(event) => event.stopPropagation()}>
          <button type="button" className="text-button" onClick={() => setOpenId(item.id)}>Open</button>
          <button type="button" className="text-button" onClick={async () => { try { const { proposal } = await api<{ proposal: Proposal }>({ action: "duplicate", id: item.id }); setOpenId(proposal.id); } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't duplicate."); } }}>Duplicate</button>
          <button type="button" className="text-button danger" onClick={async () => { if (!window.confirm(`Delete the proposal for ${item.businessName}? Its share link stops working.`)) return; try { await api({ action: "delete", id: item.id }); void load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't delete."); } }}>Delete</button>
        </div>
      </article>;
    })}</div> : <div className="ps-empty"><b>No proposals yet</b><p>Create your first one — pick a client or prospect from the CRM, or just enter a business name and website.</p><button type="button" className="primary-button" onClick={() => setCreating(true)}>+ New proposal</button></div>}
    {creating && <NewProposal clients={clients} defaultClientId={defaultClientId} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setOpenId(id); }} />}
    {showCatalogue && <CatalogueEditor catalogue={catalogue} onClose={() => setShowCatalogue(false)} onSaved={(next) => { setCatalogue(next); setShowCatalogue(false); }} />}
  </section>;
}

function NewProposal({ clients, defaultClientId, onClose, onCreated }: { clients: StudioClient[]; defaultClientId?: string; onClose: () => void; onCreated: (id: string) => void }) {
  const active = clients.filter((client) => client.status !== "Inactive" && client.status !== "Archived" && !/^agency$/i.test(client.name.trim()));
  const [mode, setMode] = useState<"prospect" | "client" | "new">("prospect");
  const [clientId, setClientId] = useState(defaultClientId && active.some((c) => c.id === defaultClientId) ? defaultClientId : "");
  const [query, setQuery] = useState(""); const [prospects, setProspects] = useState<Prospect[]>([]); const [contactId, setContactId] = useState("");
  const [name, setName] = useState(""); const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => {
    if (mode !== "prospect") return;
    const timer = window.setTimeout(() => { fetch(`/api/proposals?prospects=${encodeURIComponent(query)}`, { cache: "no-store" }).then((r) => r.json()).then((p: { prospects?: Prospect[] }) => setProspects(p.prospects || [])).catch(() => setProspects([])); }, 250);
    return () => window.clearTimeout(timer);
  }, [query, mode]);
  const create = async () => {
    setBusy(true); setError("");
    try {
      const body = mode === "client" ? { clientId, website } : mode === "prospect" ? { contactId, website } : { businessName: name, website };
      const { proposal } = await api<{ proposal: Proposal }>({ action: "create", ...body });
      onCreated(proposal.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't create the proposal."); setBusy(false); }
  };
  const ready = mode === "client" ? Boolean(clientId) : mode === "prospect" ? Boolean(contactId) : Boolean(name.trim());
  return <div className="ps-modal-back" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="ps-modal" role="dialog" aria-modal="true" aria-label="New proposal" data-no-ai>
      <header><h3>New proposal</h3><button type="button" className="ps-x" onClick={onClose} aria-label="Close">×</button></header>
      <div className="ps-seg" role="tablist">{([["prospect", "CRM prospect"], ["client", "Existing client"], ["new", "New business"]] as const).map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={mode === key} className={mode === key ? "on" : ""} onClick={() => setMode(key)}>{label}</button>)}</div>
      {mode === "client" && <div className="ps-pick">{active.length ? active.map((client) => <button type="button" key={client.id} className={`ps-pick-row ${clientId === client.id ? "on" : ""}`} onClick={() => setClientId(client.id)}>{client.logo ? <img src={client.logo} alt="" /> : <span className="ps-mono sm">{client.name.slice(0, 2).toUpperCase()}</span>}<b>{client.name}</b></button>) : <p className="muted">No active clients.</p>}</div>}
      {mode === "prospect" && <><input className="ps-search" placeholder="Search prospects by name, company or email" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
        <div className="ps-pick">{prospects.length ? prospects.map((p) => <button type="button" key={p.id} className={`ps-pick-row ${contactId === p.id ? "on" : ""}`} onClick={() => setContactId(p.id)}><span className="ps-mono sm">{(p.company || p.name || "?").slice(0, 2).toUpperCase()}</span><span><b>{p.company || p.name || "Unnamed"}</b><small>{[p.company ? p.name : "", p.email].filter(Boolean).join(" · ")}</small></span></button>) : <p className="muted">No matching prospects in the agency CRM.</p>}</div></>}
      {mode === "new" && <label className="ps-field"><span className="ps-label">Business name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Red Island Interiors" autoFocus /></label>}
      <label className="ps-field"><span className="ps-label">Website {mode !== "new" && <small>(optional — uses the CRM website if blank)</small>}</span><input value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="https://theirbusiness.ie" /></label>
      {error && <p className="error-text" role="alert">{error}</p>}
      <footer><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="button" className="primary-button" disabled={!ready || busy} onClick={() => void create()}>{busy ? "Creating…" : "Create & extract website"}</button></footer>
    </div>
  </div>;
}

function CatalogueEditor({ catalogue, onClose, onSaved }: { catalogue: CatalogueService[]; onClose: () => void; onSaved: (next: CatalogueService[]) => void }) {
  const [items, setItems] = useState(catalogue.map((item) => ({ ...item })));
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const patch = (index: number, change: Partial<CatalogueService>) => setItems((current) => current.map((item, i) => i === index ? { ...item, ...change } : item));
  return <div className="ps-modal-back" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="ps-modal wide" role="dialog" aria-modal="true" aria-label="Service catalogue" data-no-ai>
      <header><h3>Service catalogue</h3><button type="button" className="ps-x" onClick={onClose} aria-label="Close">×</button></header>
      <p className="muted">Default copy and pricing used in every new proposal. You can still change prices per proposal.</p>
      <div className="ps-cat">{items.map((item, index) => <details key={item.key} className="ps-cat-item"><summary><b>{item.name}</b><span>{item.setupFee ? `€${item.setupFee} setup · ` : ""}€{item.monthlyFee}/mo{item.addon ? " · add-on" : ""}</span></summary>
        <div className="ps-cat-grid">
          <label className="ps-field"><span className="ps-label">Name</span><input value={item.name} onChange={(e) => patch(index, { name: e.target.value })} /></label>
          <label className="ps-field"><span className="ps-label">Setup fee</span><input type="number" min={0} value={item.setupFee} onChange={(e) => patch(index, { setupFee: Number(e.target.value) })} /></label>
          <label className="ps-field"><span className="ps-label">Monthly fee</span><input type="number" min={0} value={item.monthlyFee} onChange={(e) => patch(index, { monthlyFee: Number(e.target.value) })} /></label>
          <label className="ps-check"><input type="checkbox" checked={Boolean(item.addon)} onChange={(e) => patch(index, { addon: e.target.checked })} /> Optional add-on by default</label>
          <label className="ps-field full"><span className="ps-label">Tagline</span><input value={item.tagline} onChange={(e) => patch(index, { tagline: e.target.value })} /></label>
          <label className="ps-field full"><span className="ps-label">Summary</span><textarea rows={3} value={item.summary} onChange={(e) => patch(index, { summary: e.target.value })} /></label>
          <label className="ps-field full"><span className="ps-label">Deliverables (one per line)</span><textarea rows={4} value={item.deliverables.join("\n")} onChange={(e) => patch(index, { deliverables: e.target.value.split("\n") })} /></label>
          <label className="ps-field full"><span className="ps-label">Ad spend note</span><input value={item.mediaNote || ""} onChange={(e) => patch(index, { mediaNote: e.target.value })} /></label>
        </div></details>)}</div>
      {error && <p className="error-text" role="alert">{error}</p>}
      <footer><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="button" className="primary-button" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { const { catalogue: saved } = await api<{ catalogue: CatalogueService[] }>({ action: "catalogue", catalogue: items.map((item) => ({ ...item, deliverables: item.deliverables.map((d) => d.trim()).filter(Boolean) })) }); onSaved(saved); } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't save."); setBusy(false); } }}>{busy ? "Saving…" : "Save catalogue"}</button></footer>
    </div>
  </div>;
}

function ProposalWorkspace({ id, catalogue, onBack }: { id: string; catalogue: CatalogueService[]; onBack: () => void }) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [sources, setSources] = useState<SourceRef[]>([]);
  const [tab, setTab] = useState<"brief" | "editor">("brief");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty" | "error">("saved");
  const [busy, setBusy] = useState(""); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef<Proposal | null>(null);
  latest.current = proposal;

  const reload = useCallback(async () => {
    const response = await fetch(`/api/proposals?id=${encodeURIComponent(id)}`, { cache: "no-store" });
    const payload = await response.json() as { proposal?: Proposal; sources?: SourceRef[]; error?: string };
    if (!response.ok || !payload.proposal) throw new Error(payload.error || "That proposal couldn't be opened.");
    setProposal(payload.proposal); setSources(payload.sources || []);
    return payload.proposal;
  }, [id]);
  const flush = useCallback(async () => {
    window.clearTimeout(timer.current);
    const patch = pending.current; pending.current = {};
    if (!Object.keys(patch).length) return;
    setSaveState("saving");
    try { await api({ action: "update", id, patch }); setSaveState(Object.keys(pending.current).length ? "dirty" : "saved"); }
    catch (reason) { pending.current = { ...patch, ...pending.current }; setSaveState("error"); setError(reason instanceof Error ? reason.message : "Couldn't save."); }
  }, [id]);
  /** Local change + debounced autosave of the changed top-level parts. */
  const change = useCallback((next: Partial<Proposal>) => {
    setProposal((current) => current ? { ...current, ...next } : current);
    for (const key of ["brand", "inputs", "services", "deck", "status", "title"] as const) if (key in next) pending.current[key] = next[key];
    setSaveState("dirty");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 900);
  }, [flush]);
  useEffect(() => () => { void flush(); }, [flush]);

  useEffect(() => {
    let alive = true;
    reload().then((loaded) => {
      if (!alive) return;
      if (loaded.deck) setTab("editor");
      else if (loaded.website && !loaded.brand.screenshotDesktop && !loaded.brand.description) void extract(loaded.website);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "That proposal couldn't be opened."));
    return () => { alive = false; };
  }, [reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (label: string, work: () => Promise<void>) => { await flush(); setBusy(label); setError(""); setNotice(""); try { await work(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Something went wrong."); } finally { setBusy(""); } };
  const extract = (website?: string) => run("extract", async () => {
    const result = await api<{ proposal: Proposal; found: { pages: boolean; images: number; screenshots: number; logo: boolean } }>({ action: "extract", id, website: website || latest.current?.brand.website });
    setProposal(result.proposal);
    setNotice(`Website read: ${result.found.pages ? "content & services" : "no readable text"}, ${result.found.images} photo${result.found.images === 1 ? "" : "s"}, ${result.found.screenshots}/2 screenshots${result.found.logo ? ", logo" : ""}.`);
    const fresh = await fetch(`/api/proposals?id=${encodeURIComponent(id)}`, { cache: "no-store" }).then((r) => r.json()).catch(() => null) as { sources?: SourceRef[] } | null;
    if (fresh?.sources) setSources(fresh.sources);
  });
  const generate = () => run("generate", async () => {
    const result = await api<{ proposal: Proposal; warning?: string }>({ action: "generate", id });
    setProposal(result.proposal); if (result.warning) setNotice(result.warning); setTab("editor");
  });
  const uploadOne = async (file: File) => {
    await flush();
    const form = new FormData(); form.set("id", id); form.set("file", file);
    const response = await fetch("/api/proposals", { method: "POST", body: form });
    const payload = await response.json() as { proposal?: Proposal; asset?: string; error?: string };
    if (!response.ok || !payload.proposal) throw new Error(payload.error || `Couldn't upload ${file.name}.`);
    return payload as { proposal: Proposal; asset: string };
  };
  const upload = (files: FileList | File[] | null) => run("upload", async () => {
    for (const file of Array.from(files || []).slice(0, 10)) setProposal((await uploadOne(file)).proposal);
  });

  if (!proposal) return <section className="ps">{error ? <><button type="button" className="text-button" onClick={onBack}>← All proposals</button><p className="error-text" role="alert">{error}</p></> : <div className="page-loading" role="status" aria-label="Loading proposal…"><i /></div>}</section>;
  const logo = proposal.brand.logo ? imgSrc(proposal.id, proposal.brand.logo) : "";
  return <section className={`ps ps-work ${tab === "editor" ? "is-editor" : ""}`} aria-label={`Proposal for ${proposal.businessName}`}>
    <header className="ps-workbar">
      <button type="button" className="text-button" onClick={() => { void flush(); onBack(); }}>← All proposals</button>
      <span className="ps-work-title">{logo ? <img src={logo} alt="" /> : null}<input aria-label="Proposal title" data-no-ai value={proposal.title} onChange={(event) => change({ title: event.target.value })} /></span>
      <div className="ps-seg" role="tablist" aria-label="Proposal steps"><button type="button" role="tab" aria-selected={tab === "brief"} className={tab === "brief" ? "on" : ""} onClick={() => setTab("brief")}>1 · Brief</button><button type="button" role="tab" aria-selected={tab === "editor"} className={tab === "editor" ? "on" : ""} disabled={!proposal.deck} onClick={() => setTab("editor")}>2 · Design &amp; edit</button></div>
      <span className={`ps-save ${saveState}`}>{saveState === "saving" ? "Saving…" : saveState === "dirty" ? "Unsaved" : saveState === "error" ? "Not saved" : "Saved"}</span>
      <select className="ps-status-select" aria-label="Status" value={proposal.status} onChange={(event) => change({ status: event.target.value })}>{Object.entries(STATUS_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
    </header>
    {error && <p className="error-text" role="alert">{error}</p>}
    {notice && <p className="ps-notice" role="status">{notice}</p>}
    {busy === "generate" ? <ReportGeneratingAnimation steps={GEN_STEPS} title={`Designing ${proposal.businessName}'s proposal`} /> : tab === "brief"
      ? <Brief proposal={proposal} catalogue={catalogue} sources={sources} busy={busy} change={change} onExtract={extract} onUpload={upload} onImport={(ref) => run("import", async () => { const { proposal: next } = await api<{ proposal: Proposal }>({ action: "import", id, ref }); setProposal(next); })} onGenerate={generate} />
      : proposal.deck && <Editor proposal={proposal} change={change} flush={flush} setProposal={setProposal} onUpload={upload} uploadOne={uploadOne} onRegenerate={() => { if (window.confirm("Rewrite the whole proposal from the brief? Your text edits will be replaced.")) void generate(); }} />}
  </section>;
}

function Brief({ proposal, catalogue, sources, busy, change, onExtract, onUpload, onImport, onGenerate }: {
  proposal: Proposal; catalogue: CatalogueService[]; sources: SourceRef[]; busy: string; change: (next: Partial<Proposal>) => void;
  onExtract: (website?: string) => void; onUpload: (files: FileList | File[] | null) => void; onImport: (ref: string) => void; onGenerate: () => void;
}) {
  const { brand, inputs } = proposal;
  const setBrand = (patch: Partial<ProposalBrand>) => change({ brand: { ...brand, ...patch } });
  const setInputs = (patch: Partial<ProposalInputs>) => change({ inputs: { ...inputs, ...patch } });
  const selected = new Map(proposal.services.map((item) => [item.key, item]));
  const toggle = (item: CatalogueService) => change({ services: selected.has(item.key) ? proposal.services.filter((s) => s.key !== item.key) : [...proposal.services, { key: item.key, setupFee: item.setupFee, monthlyFee: item.monthlyFee, addon: Boolean(item.addon) }] });
  const patchService = (key: string, patch: Partial<SelectedService>) => change({ services: proposal.services.map((s) => s.key === key ? { ...s, ...patch } : s) });
  const groups = [...new Set(catalogue.map((item) => item.group))];
  const imported = new Set(inputs.sources.map((source) => source.id));
  const symbol = inputs.currency === "GBP" ? "£" : inputs.currency === "USD" ? "$" : "€";
  const core = proposal.services.filter((s) => !s.addon);
  const total = { setup: core.reduce((sum, s) => sum + s.setupFee, 0), monthly: core.reduce((sum, s) => sum + s.monthlyFee, 0) };
  const shots = [["Desktop screenshot", brand.screenshotDesktop], ["Phone screenshot", brand.screenshotMobile]] as const;
  return <div className="ps-brief" data-no-ai>
    <section className="ps-card-sec">
      <h3><span>1</span>Business &amp; branding</h3>
      <div className="ps-row">
        <label className="ps-field grow"><span className="ps-label">Website</span><input value={brand.website} placeholder="https://theirbusiness.ie" onChange={(event) => setBrand({ website: event.target.value })} /></label>
        <button type="button" className="primary-button ps-extract" disabled={busy === "extract" || !brand.website.trim()} onClick={() => onExtract(brand.website)}>{busy === "extract" ? "Reading website…" : brand.description ? "Re-extract website" : "Extract from website"}</button>
      </div>
      {busy === "extract" && <p className="ps-working"><i />Reading pages, logo, colours and photos, and taking live desktop &amp; phone screenshots… (about 20 seconds)</p>}
      <div className="ps-brand">
        <div className="ps-logo-box">{brand.logo ? <img src={imgSrc(proposal.id, brand.logo)} alt="Logo" /> : <span>No logo</span>}<small>Logo</small></div>
        {shots.map(([label, src]) => <div key={label} className={`ps-shot ${label.startsWith("Phone") ? "phone" : ""}`}>{src ? <img src={imgSrc(proposal.id, src)} alt={label} /> : <span>{label}</span>}<small>{label}</small></div>)}
        {brand.colours.length > 0 && <div className="ps-colours">{brand.colours.map((colour) => <i key={colour} style={{ background: colour }} title={colour} />)}<small>Brand colours</small></div>}
      </div>
      <div className="ps-grid2">
        <TextField proposalId={proposal.id} field="businessName" label="Business name" value={brand.businessName} onChange={(v) => setBrand({ businessName: v })} ai={false} />
        <TextField proposalId={proposal.id} field="areas" label="Areas served" value={brand.areas} onChange={(v) => setBrand({ areas: v })} />
        <TextField proposalId={proposal.id} field="description" label="What they do" value={brand.description} onChange={(v) => setBrand({ description: v })} rows={3} />
        <TextField proposalId={proposal.id} field="services" label="Their services" value={brand.services} onChange={(v) => setBrand({ services: v })} rows={3} />
      </div>
      <div className="ps-images"><span className="ps-label">Photos for mockups <small>({brand.images.length}) · drag photos here to add · × to remove</small></span>
        <div className="ps-thumbs ps-drop" onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("over"); }} onDragLeave={(event) => event.currentTarget.classList.remove("over")} onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove("over"); onUpload(Array.from(event.dataTransfer.files as FileList)); }}>{brand.images.map((src) => <span key={src} className="ps-thumb"><img src={imgSrc(proposal.id, src)} alt="" loading="lazy" /><button type="button" aria-label="Remove photo" onClick={() => setBrand({ images: brand.images.filter((item) => item !== src) })}>×</button></span>)}
          <label className="ps-thumb add"><input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf,text/plain,.md,.csv,.html" multiple hidden onChange={(event) => { onUpload(event.currentTarget.files); event.currentTarget.value = ""; }} />{busy === "upload" ? "Uploading…" : "+ Upload"}</label></div>
      </div>
    </section>

    <section className="ps-card-sec">
      <h3><span>2</span>Audits, reports, notes &amp; documents</h3>
      <p className="muted">Everything imported here is used by AI to personalise the proposal. Upload PDFs or text files (brochures, briefs, requirements) and their text is read automatically.</p>
      {sources.length > 0 && <div className="ps-sources">{sources.map((source) => <button type="button" key={source.ref} className={`ps-source ${imported.has(source.ref) ? "on" : ""}`} disabled={busy === "import" || imported.has(source.ref)} onClick={() => onImport(source.ref)}><b>{imported.has(source.ref) ? "✓ " : "+ "}{source.label}</b>{source.date && <small>{fmtDate(source.date)}</small>}</button>)}</div>}
      {inputs.sources.length > 0 ? <ul className="ps-imported">{inputs.sources.map((source) => <li key={source.id}><span className={`ps-kind k-${source.kind}`}>{source.kind}</span><b>{source.label}</b><small>{source.text.slice(0, 140)}…</small><button type="button" className="text-button" onClick={() => setInputs({ sources: inputs.sources.filter((item) => item.id !== source.id) })}>Remove</button></li>)}</ul> : <p className="muted">Nothing imported yet{sources.length ? " — pick a source above" : ""}.</p>}
      <label className="ps-upload"><input type="file" multiple hidden accept="application/pdf,text/plain,.md,.csv,.html,image/png,image/jpeg,image/webp" onChange={(event) => { onUpload(event.currentTarget.files); event.currentTarget.value = ""; }} />{busy === "upload" ? "Uploading…" : "Upload documents or images"}</label>
    </section>

    <section className="ps-card-sec">
      <h3><span>3</span>Discovery call &amp; requirements</h3>
      <div className="ps-grid2">
        <TextField proposalId={proposal.id} field="discoveryNotes" label="Discovery call notes" value={inputs.discoveryNotes} onChange={(v) => setInputs({ discoveryNotes: v })} rows={6} placeholder="Paste or type what you learned on the call…" />
        <TextField proposalId={proposal.id} field="requirements" label="Client requirements" value={inputs.requirements} onChange={(v) => setInputs({ requirements: v })} rows={6} placeholder="What they've asked for, budget, timing…" />
        <TextField proposalId={proposal.id} field="goal" label="Goal" value={inputs.goal} onChange={(v) => setInputs({ goal: v })} rows={3} placeholder="What will this proposal achieve for them?" />
        <TextField proposalId={proposal.id} field="audience" label="Target audience" value={inputs.audience} onChange={(v) => setInputs({ audience: v })} rows={3} placeholder="Homeowners renovating, Architects…" />
        <TextField proposalId={proposal.id} field="instructions" label="Extra instructions for AI" value={inputs.instructions} onChange={(v) => setInputs({ instructions: v })} rows={2} placeholder="e.g. Emphasise referrals; keep it short; mention the Wicklow expansion" />
      </div>
    </section>

    <section className="ps-card-sec">
      <h3><span>4</span>Services</h3>
      {groups.map((group) => <div key={group} className="ps-svc-group"><span className="ps-label">{group}</span><div className="ps-svcs">{catalogue.filter((item) => item.group === group).map((item) => { const on = selected.get(item.key); return <div key={item.key} className={`ps-svc ${on ? "on" : ""}`}>
        <button type="button" className="ps-svc-main" aria-pressed={Boolean(on)} onClick={() => toggle(item)}><i>{on ? "✓" : "+"}</i><span><b>{item.name}</b><small>{item.tagline}</small></span></button>
        {on && <div className="ps-svc-price"><label>Setup {symbol}<input type="number" min={0} value={on.setupFee} onChange={(event) => patchService(item.key, { setupFee: Number(event.target.value) || 0 })} /></label><label>Monthly {symbol}<input type="number" min={0} value={on.monthlyFee} onChange={(event) => patchService(item.key, { monthlyFee: Number(event.target.value) || 0 })} /></label><label className="ps-check"><input type="checkbox" checked={on.addon} onChange={(event) => patchService(item.key, { addon: event.target.checked })} />Optional add-on</label></div>}
      </div>; })}</div></div>)}
      <div className="ps-grid3">
        <label className="ps-field"><span className="ps-label">Start month</span><input type="month" value={inputs.startMonth} onChange={(event) => setInputs({ startMonth: event.target.value })} /></label>
        <label className="ps-field"><span className="ps-label">Currency</span><select value={inputs.currency} onChange={(event) => setInputs({ currency: event.target.value })}><option value="EUR">€ EUR</option><option value="GBP">£ GBP</option><option value="USD">$ USD</option></select></label>
        <TextField proposalId={proposal.id} field="terms" label="Terms" value={inputs.terms} onChange={(v) => setInputs({ terms: v })} placeholder="3-month minimum…" />
      </div>
    </section>

    <div className="ps-generate">
      <span>{proposal.services.length ? <>Core package: <b>{symbol}{total.setup.toLocaleString("en-IE")}</b> setup · <b>{symbol}{total.monthly.toLocaleString("en-IE")}</b>/month{proposal.services.some((s) => s.addon) ? ` · ${proposal.services.filter((s) => s.addon).length} add-on(s)` : ""}</> : "Select at least one service"}</span>
      <button type="button" className="primary-button big" disabled={!proposal.services.length || Boolean(busy)} onClick={onGenerate}><SparkIcon /> {proposal.deck ? "Regenerate proposal with AI" : "Generate proposal with AI"}</button>
    </div>
  </div>;
}

function Editor({ proposal, change, flush, setProposal, onUpload, uploadOne, onRegenerate }: { proposal: Proposal; change: (next: Partial<Proposal>) => void; flush: () => Promise<void>; setProposal: (p: Proposal) => void; onUpload: (files: FileList | File[] | null) => void; uploadOne: (file: File) => Promise<{ proposal: Proposal; asset: string }>; onRegenerate: () => void }) {
  const deck = proposal.deck!;
  const [selectedId, setSelectedId] = useState(deck.slides[0]?.id || "");
  const [renderKey, setRenderKey] = useState(0);
  const [picker, setPicker] = useState<{ slide: string; key: string } | null>(null);
  const [rewrite, setRewrite] = useState(""); const [rewriting, setRewriting] = useState(false); const [rewriteError, setRewriteError] = useState("");
  const [sharing, setSharing] = useState(false); const [copied, setCopied] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const deckRef = useRef(deck); deckRef.current = deck;
  const brandRef = useRef(proposal.brand); brandRef.current = proposal.brand;
  const selected = deck.slides.find((slide) => slide.id === selectedId) || deck.slides[0];
  const rerender = () => setRenderKey((key) => key + 1);
  const setDeck = (next: ProposalDeck, redraw = true) => { change({ deck: next }); if (redraw) rerender(); };
  const updateSlide = (slideId: string, data: Record<string, any>, redraw = true) => setDeck({ ...deckRef.current, slides: deckRef.current.slides.map((slide) => slide.id === slideId ? { ...slide, data } : slide) }, redraw);

  // The preview only re-renders on structural/inspector changes; typing inside the slides updates state silently.
  const html = useMemo(() => renderProposalHtml(deckRef.current, brandRef.current, { editable: true, assetUrl: assetUrl(proposal.id), agencyLogo: AGENCY_LOGO, focusSlide: selectedId }),
    [renderKey, proposal.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as { type?: string; slide?: string; path?: string; value?: string; key?: string };
      if (data.type === "f2b-proposal-edit" && data.slide && data.path) {
        const slide = deckRef.current.slides.find((item) => item.id === data.slide);
        if (slide) updateSlide(slide.id, setPath(slide.data, data.path, String(data.value ?? "").replace(/\n{3,}/g, "\n\n")), false);
      } else if (data.type === "f2b-proposal-image" && data.slide && data.key) setPicker({ slide: data.slide, key: data.key });
      else if (data.type === "f2b-proposal-image-delete" && data.slide && data.key) setSlotImage(data.slide, data.key, data.key.startsWith("brand.") ? "" : "none");
      else if (data.type === "f2b-proposal-set-image" && data.slide && data.key && /^https:\/\//.test(String((data as { src?: string }).src || ""))) setSlotImage(data.slide, data.key, String((data as { src?: string }).src));
      else if (data.type === "f2b-proposal-drop" && data.slide && data.key && (data as { file?: unknown }).file instanceof Blob) {
        const file = (data as unknown as { file: File }).file; const slideId = data.slide, key = data.key;
        uploadOne(file).then(({ proposal: next, asset }) => { setProposal(next); brandLive.current = next.brand; setSlotImage(slideId, key, asset); }).catch((reason) => { window.alert(reason instanceof Error ? reason.message : "Couldn't upload that image."); rerender(); });
      }
      else if ((data.type === "f2b-proposal-select" || data.type === "f2b-proposal-visible") && data.slide) setSelectedId(data.slide);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const scrollTo = (slideId: string) => { setSelectedId(slideId); frame.current?.contentWindow?.postMessage({ type: "f2b-proposal-scroll", slide: slideId }, "*"); };
  const move = (index: number, delta: number) => { const slides = [...deck.slides]; const [item] = slides.splice(index, 1); slides.splice(Math.max(0, Math.min(slides.length, index + delta)), 0, item); setDeck({ ...deck, slides }); };
  const brandLive = useRef(proposal.brand); brandLive.current = proposal.brand;
  const setSlotImage = (slideId: string, key: string, src: string) => {
    if (key.startsWith("brand.")) change({ brand: { ...brandLive.current, [key.slice(6)]: src } });
    else { const slide = deckRef.current.slides.find((item) => item.id === slideId); if (slide) updateSlide(slide.id, setPath(slide.data, key, src), false); }
    window.setTimeout(rerender, 0);
  };
  const pickImage = (src: string) => { if (!picker) return; setSlotImage(picker.slide, picker.key, src); setPicker(null); };
  const fullHtml = (print: boolean) => renderProposalHtml(deck, proposal.brand, { assetUrl: (name) => `${window.location.origin}${assetUrl(proposal.id)(name)}`, agencyLogo: AGENCY_LOGO, printButton: true, title: proposal.title }).replace("</body>", print ? `<script>window.addEventListener("load",function(){document.fonts.ready.then(function(){setTimeout(function(){print()},500)})})</script></body>` : "</body>");
  const openWindow = (print: boolean) => { const win = window.open("", "_blank"); if (!win) { window.alert("Allow pop-ups for this site to open the proposal."); return; } win.document.open(); win.document.write(fullHtml(print)); win.document.close(); };
  const shareUrl = proposal.shareToken ? `${window.location.origin}/f/proposal/${proposal.shareToken}` : "";
  const toggleShare = async (enable: boolean) => { setSharing(true); try { await flush(); const { proposal: next } = await api<{ proposal: Proposal }>({ action: "share", id: proposal.id, enable }); setProposal(next); } catch (reason) { window.alert(reason instanceof Error ? reason.message : "Couldn't update the share link."); } finally { setSharing(false); } };
  const doRewrite = async () => {
    if (!selected) return;
    setRewriting(true); setRewriteError("");
    try { await flush(); const { proposal: next } = await api<{ proposal: Proposal }>({ action: "rewrite", id: proposal.id, slideId: selected.id, instruction: rewrite }); setProposal(next); deckRef.current = next.deck!; setRewrite(""); rerender(); }
    catch (reason) { setRewriteError(reason instanceof Error ? reason.message : "AI couldn't rewrite this slide."); }
    finally { setRewriting(false); }
  };
  const kindLabel = (kind: SlideKind) => SLIDE_KINDS.find((item) => item.kind === kind)?.label || kind;
  const slideTitle = (slide: Slide) => String(slide.data.heading || slide.data.title || slide.data.cardTitle || kindLabel(slide.kind)).replace(/:$/, "").slice(0, 40);
  const images = [...new Set([proposal.brand.screenshotDesktop, proposal.brand.screenshotMobile, proposal.brand.logo, ...proposal.brand.images].filter(Boolean))];

  return <div className="ps-editor">
    <div className="ps-toolbar">
      <span className="ps-hint">Click any text on a slide to edit it · click an image to swap it</span>
      <label className="ps-accent" title="Accent colour">Accent<input type="color" value={deck.accent} onChange={(event) => setDeck({ ...deck, accent: event.target.value })} /></label>
      <button type="button" className="secondary-button" onClick={onRegenerate}><SparkIcon /> Regenerate</button>
      <button type="button" className="secondary-button" onClick={() => openWindow(false)}>Full screen</button>
      <button type="button" className="secondary-button" onClick={() => openWindow(true)}>Download PDF</button>
      {shareUrl ? <span className="ps-share"><input readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} aria-label="Share link" data-no-ai /><button type="button" className="primary-button" onClick={async () => { try { await navigator.clipboard.writeText(shareUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ } }}>{copied ? "Copied" : "Copy link"}</button><button type="button" className="text-button" disabled={sharing} onClick={() => void toggleShare(false)}>Turn off</button>{proposal.viewCount > 0 && <small>{proposal.viewCount} view{proposal.viewCount === 1 ? "" : "s"}</small>}</span>
        : <button type="button" className="primary-button" disabled={sharing} onClick={() => void toggleShare(true)}>{sharing ? "Creating link…" : "Share link"}</button>}
    </div>
    <div className="ps-editor-grid">
      <aside className="ps-slides" aria-label="Slides">
        <ol>{deck.slides.map((slide, index) => <li key={slide.id} className={`${slide.id === selected?.id ? "on" : ""} ${slide.hidden ? "hidden" : ""}`}>
          <button type="button" className="ps-slide-btn" onClick={() => scrollTo(slide.id)}><span className="ps-slide-n">{index + 1}</span><span><b>{slideTitle(slide)}</b><small>{kindLabel(slide.kind)}{slide.hidden ? " · hidden" : ""}</small></span></button>
          <span className="ps-slide-tools"><button type="button" title="Move up" disabled={!index} onClick={() => move(index, -1)}>↑</button><button type="button" title="Move down" disabled={index === deck.slides.length - 1} onClick={() => move(index, 1)}>↓</button><button type="button" title={slide.hidden ? "Show slide" : "Hide slide"} onClick={() => setDeck({ ...deck, slides: deck.slides.map((item) => item.id === slide.id ? { ...item, hidden: !item.hidden } : item) })}>{slide.hidden ? "◌" : "◉"}</button><button type="button" title="Delete slide" onClick={() => { if (window.confirm(`Delete the "${slideTitle(slide)}" slide?`)) setDeck({ ...deck, slides: deck.slides.filter((item) => item.id !== slide.id) }); }}>×</button></span>
        </li>)}</ol>
        <label className="ps-add"><span>+ Add slide</span><select value="" onChange={(event) => { const kind = event.target.value as SlideKind; if (!kind) return; const slide = blankSlide(kind, proposal.brand, proposal.inputs.currency); const at = Math.max(0, deck.slides.findIndex((item) => item.id === selected?.id)) + 1; const slides = [...deck.slides]; slides.splice(at, 0, slide); setDeck({ ...deck, slides }); setSelectedId(slide.id); }}><option value="">Choose…</option>{SLIDE_KINDS.map((item) => <option key={item.kind} value={item.kind}>{item.label} — {item.hint}</option>)}</select></label>
      </aside>
      <div className="ps-stage"><iframe ref={frame} title="Proposal live preview" srcDoc={html} sandbox="allow-scripts allow-same-origin allow-modals" /></div>
      <aside className="ps-inspector" aria-label="Slide content" data-no-ai>
        {selected && <>
          <h4>{kindLabel(selected.kind)} <small>slide {deck.slides.indexOf(selected) + 1}</small></h4>
          <div className="ps-rewrite"><span className="ps-label"><SparkIcon /> Rewrite this slide with AI</span><textarea rows={2} value={rewrite} placeholder="e.g. Make it punchier and focus on kitchen renovations" onChange={(event) => setRewrite(event.target.value)} /><button type="button" className="primary-button" disabled={rewriting} onClick={() => void doRewrite()}>{rewriting ? "Rewriting…" : "Rewrite slide"}</button>{rewriteError && <p className="error-text" role="alert">{rewriteError}</p>}</div>
          <DataEditor proposalId={proposal.id} slide={selected} onChange={(data) => updateSlide(selected.id, data)} />
        </>}
      </aside>
    </div>
    {picker && <div className="ps-modal-back" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPicker(null); }}>
      <div className="ps-modal wide" role="dialog" aria-modal="true" aria-label="Choose image" data-no-ai>
        <header><h3>Choose an image</h3><button type="button" className="ps-x" onClick={() => setPicker(null)} aria-label="Close">×</button></header>
        <p className="muted">Click an image to use it, drag one in from your computer, or remove the image from this spot.</p>
        <div className="ps-thumbs big ps-drop" onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add("over"); }} onDragLeave={(event) => event.currentTarget.classList.remove("over")} onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove("over"); const file = Array.from(event.dataTransfer.files as FileList).find((item: File) => item.type.startsWith("image/")); const target = picker; if (file && target) { setPicker(null); uploadOne(file).then(({ proposal: next, asset }) => { setProposal(next); brandLive.current = next.brand; setSlotImage(target.slide, target.key, asset); }).catch((reason) => window.alert(reason instanceof Error ? reason.message : "Couldn't upload that image.")); } }}>{images.map((src) => <button type="button" key={src} className="ps-thumb" onClick={() => pickImage(src)}><img src={imgSrc(proposal.id, src)} alt="" loading="lazy" /></button>)}
          <label className="ps-thumb add"><input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; const target = picker; if (file && target) { setPicker(null); uploadOne(file).then(({ proposal: next, asset }) => { setProposal(next); brandLive.current = next.brand; setSlotImage(target.slide, target.key, asset); }).catch((reason) => window.alert(reason instanceof Error ? reason.message : "Couldn't upload that image.")); } }} />+ Upload</label></div>
        <button type="button" className="text-button danger" onClick={() => { if (picker) { setSlotImage(picker.slide, picker.key, picker.key.startsWith("brand.") ? "" : "none"); setPicker(null); } }}>Remove image from this spot</button>
        <form className="ps-row" onSubmit={(event) => { event.preventDefault(); const value = String(new FormData(event.currentTarget).get("url") || "").trim(); if (/^https:\/\//.test(value)) pickImage(value); }}><label className="ps-field grow"><span className="ps-label">…or paste an image URL</span><input name="url" placeholder="https://…" /></label><button type="submit" className="secondary-button">Use URL</button></form>
      </div>
    </div>}
  </div>;
}

/** Generic editor for a slide's text data (strings, lists and lists of items), each with AI Suggest. */
function DataEditor({ proposalId, slide, onChange }: { proposalId: string; slide: Slide; onChange: (data: Record<string, any>) => void }) {
  const set = (path: string, value: unknown) => onChange(setPath(slide.data, path, value));
  const entries = Object.entries(slide.data).filter(([key]) => !["serviceKey", "images", "searchTerm"].includes(key));
  const field = (path: string, label: string, value: string) => <label className="ps-field" key={path}>
    <span className="ps-label">{label}<AiSuggest proposalId={proposalId} field={path.split(".").pop() || path} label={label} value={value} onChange={(v) => set(path, v)} slideKind={slide.kind} /></span>
    {value.length > 60 ? <textarea rows={Math.min(6, Math.ceil(value.length / 42))} value={value} onChange={(event) => set(path, event.target.value)} /> : <input value={value} onChange={(event) => set(path, event.target.value)} />}
  </label>;
  return <div className="ps-data">{entries.map(([key, value]) => {
    const label = humanize(key);
    if (typeof value === "string") return field(key, label, value);
    if (Array.isArray(value)) {
      const blank = typeof value[0] === "object" && value[0] ? Object.fromEntries(Object.keys(value[0]).map((k) => [k, k === "serviceKey" ? value[0][k] : ""])) : "";
      return <fieldset key={key} className="ps-list"><legend>{label}</legend>
        {value.map((item, index) => <div key={index} className="ps-list-item">
          {typeof item === "string" ? field(`${key}.${index}`, `${label.replace(/s$/, "")} ${index + 1}`, item) : item && typeof item === "object" ? Object.entries(item).filter(([k]) => k !== "serviceKey").map(([k, v]) => field(`${key}.${index}.${k}`, humanize(k), String(v ?? ""))) : null}
          <button type="button" className="text-button danger" onClick={() => set(key, value.filter((_, i) => i !== index))}>Remove</button>
        </div>)}
        {value.length < 12 && <button type="button" className="text-button" onClick={() => set(key, [...value, blank])}>+ Add {label.toLowerCase().replace(/s$/, "")}</button>}
      </fieldset>;
    }
    return null;
  })}</div>;
}
