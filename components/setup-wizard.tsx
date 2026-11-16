"use client";

import "./setup-wizard.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Download, Plus, RefreshCw, Sparkles, Trash2, Wand2 } from "lucide-react";
import { AI_SOURCE, adsRowProblems, emptyBrief, newRowId, stepsFor, type SetupBrief, type SetupDraft, type SetupKind, type SetupRow, type SetupStepDef, type SetupStepState } from "@/lib/setup-steps";

// Google Ads / SEO → Setup: step-by-step, AI-guided setup per client. Shows what already exists (live data)
// before AI proposes anything, keeps AI suggestions and live data labelled separately, saves every change as a
// draft (resume after refresh) and never publishes, spends or contacts anyone.

type LiveItem = Record<string, string | number | null>;
type Live = { status: "loading" | "ready" | "none" | "error"; message?: string; source?: string; items: LiveItem[]; columns?: Array<[string, string]>; importable?: boolean; summary?: unknown };

const SOURCE_LABEL = (source: string) => source === AI_SOURCE ? "AI" : source.replace(/^Live · /, "Live · ");
const csvCell = (v: string) => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
const money = (v: unknown) => typeof v === "number" ? `€${v.toFixed(2)}` : "";
const ANALYSIS_RANGE = "last_90d";

async function getJson<T>(url: string): Promise<{ ok: boolean; json: T }> {
  const response = await fetch(url, { cache: "no-store" });
  return { ok: response.ok, json: await response.json().catch(() => ({})) as T };
}

/** Live data for a step, read from the app's existing read-only endpoints. Nothing paid is run here. */
async function loadLive(kind: SetupKind, stepId: string, clientId: string): Promise<Live> {
  const ads = (section = "") => getJson<{ status?: string; message?: string; rows?: Array<Record<string, any>>; ads?: Array<Record<string, any>>; assets?: Array<Record<string, any>>; current?: { campaigns?: Array<Record<string, any>> }; source?: string }>(`/api/google-ads/workspace?${new URLSearchParams({ clientId, range: ANALYSIS_RANGE, ...(section ? { section } : {}) })}`);
  const adsBlocked = (status?: string, message?: string): Live | null => status === "not_mapped" ? { status: "none", message: "No Google Ads account is linked to this client yet, so this is a fresh setup. Link the account in Clients → Edit client to compare with live campaigns.", items: [] } : status === "missing_connection" || status === "unavailable" ? { status: "error", message: message || "Google Ads data isn’t available right now.", items: [] } : null;
  if (kind === "ads") {
    if (stepId === "structure") {
      const [base, groups] = await Promise.all([ads(), ads("ad_groups")]);
      const blocked = adsBlocked(base.json.status, base.json.message); if (blocked) return blocked;
      const campaigns = (base.json.current?.campaigns || []).map((c) => ({ campaign: c.name, adGroup: "", status: c.status, spend: c.spend }));
      const adGroups = (groups.json.rows || []).map((r) => ({ campaign: r.campaignName, adGroup: r.adGroupName || r.name, status: r.status, spend: r.spend }));
      const items = adGroups.length ? adGroups : campaigns;
      return { status: items.length ? "ready" : "none", message: items.length ? undefined : "The account has no campaigns yet.", source: "Live · Google Ads (last 90 days)", items, columns: [["campaign", "Campaign"], ["adGroup", "Ad group"], ["status", "Status"], ["spend", "Spend"]], summary: { campaigns: campaigns.map((c) => c.campaign), adGroups: adGroups.map((a) => `${a.campaign} › ${a.adGroup}`).slice(0, 120) } };
    }
    if (stepId === "keywords" || stepId === "negatives") {
      const res = await ads(stepId === "keywords" ? "keywords" : "search_terms");
      const blocked = adsBlocked(res.json.status, res.json.message); if (blocked) return blocked;
      const rows = res.json.rows || [];
      if (stepId === "keywords") {
        const items = rows.map((r) => ({ keyword: r.name, matchType: r.matchType, adGroup: r.adGroupName, clicks: r.clicks, conversions: r.conversions }));
        return { status: items.length ? "ready" : "none", message: items.length ? undefined : "No keywords in the account yet.", source: "Live · Google Ads (last 90 days)", items, columns: [["keyword", "Keyword"], ["matchType", "Match"], ["adGroup", "Ad group"], ["clicks", "Clicks"], ["conversions", "Conv."]], summary: items.slice(0, 200).map((i) => `${i.keyword} [${i.matchType}] · ${i.adGroup}`) };
      }
      const items = rows.map((r) => ({ term: r.name, triggeredBy: r.triggeringKeyword || "", clicks: r.clicks, cost: r.spend, conversions: r.conversions })).sort((a, b) => Number(b.cost || 0) - Number(a.cost || 0));
      return { status: items.length ? "ready" : "none", message: items.length ? undefined : "No search terms recorded in the last 90 days, so negatives are suggested from the brief.", source: "Live · Google Ads search terms (last 90 days)", items: items.map((i) => ({ ...i, cost: money(i.cost) })), columns: [["term", "Search term"], ["triggeredBy", "Keyword"], ["clicks", "Clicks"], ["cost", "Cost"], ["conversions", "Conv."]], summary: items.slice(0, 150).map((i) => ({ term: i.term, clicks: i.clicks, cost: i.cost, conversions: i.conversions })) };
    }
    if (stepId === "ads" || stepId === "assets") {
      const res = await ads(stepId);
      const blocked = adsBlocked(res.json.status, res.json.message); if (blocked) return blocked;
      if (stepId === "ads") {
        const items = (res.json.ads || []).map((a) => ({ adGroup: a.adGroupName, headlines: (a.headlines || []).map((h: { text: string }) => h.text).join(" | "), url: (a.finalUrls || [])[0] || "", status: a.status }));
        return { status: items.length ? "ready" : "none", message: items.length ? undefined : "No responsive search ads in the account yet.", source: "Live · Google Ads API", items, columns: [["adGroup", "Ad group"], ["headlines", "Headlines"], ["url", "Final URL"], ["status", "Status"]], summary: items.slice(0, 40) };
      }
      const items = (res.json.assets || []).map((a) => ({ type: a.type, text: a.assetName || a.fieldType, scope: a.campaignName || a.scope, status: a.status }));
      return { status: items.length ? "ready" : "none", message: items.length ? undefined : res.json.message || "No assets linked in the account yet.", source: "Live · Google Ads API", items, columns: [["type", "Type"], ["text", "Asset"], ["scope", "Where"], ["status", "Status"]], summary: items.slice(0, 80) };
    }
    if (stepId === "conversions") {
      const response = await fetch("/api/setup-drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "live-conversions", kind, clientId }) });
      const json = await response.json().catch(() => ({})) as { actions?: Array<{ name: string; status: string; category: string }>; adsError?: string; forms?: Array<{ form: string; count: number; adsLeads: number }> };
      const items: LiveItem[] = [...(json.actions || []).map((a) => ({ item: a.name, kind: `Google Ads · ${a.category.toLowerCase().replace(/_/g, " ")}`, detail: a.status })), ...(json.forms || []).map((f) => ({ item: f.form, kind: "Website form (OS)", detail: `${f.count} leads in 90 days · ${f.adsLeads} from Google Ads` }))];
      return { status: items.length ? "ready" : "none", message: [json.adsError, !(json.forms || []).length ? "No website form leads recorded in the last 90 days." : ""].filter(Boolean).join(" "), source: "Live · Google Ads + OS form log", items, columns: [["item", "Conversion / form"], ["kind", "Type"], ["detail", "Status / data"]], summary: { actions: json.actions || [], forms: json.forms || [], note: json.adsError || "" } };
    }
  }
  if (stepId === "keywords" || stepId === "content") {
    const res = await getJson<{ keywords?: Array<{ keyword: string; location: string; avgMonthlySearches: number | null; groupId: string }>; groups?: Array<{ id: string; name: string }> }>(`/api/seo/saved-keywords?clientId=${encodeURIComponent(clientId)}`);
    const group = (id: string) => (res.json.groups || []).find((g) => g.id === id)?.name || "";
    const items = (res.json.keywords || []).map((k) => ({ keyword: k.keyword, topic: group(k.groupId), location: k.location, volume: k.avgMonthlySearches }));
    return { status: items.length ? "ready" : "none", message: items.length ? undefined : "No saved keyword research yet. Run live research in the Keywords tab (paid lookups ask first), or let AI draft a starting list.", source: "Live · Saved keyword research", items, columns: [["keyword", "Keyword"], ["topic", "Group"], ["location", "Location"], ["volume", "Monthly searches"]], importable: stepId === "keywords", summary: items.slice(0, 200).map((i) => `${i.keyword}${i.topic ? ` (${i.topic})` : ""}`) };
  }
  if (stepId === "competitors") {
    const res = await getJson<{ competitorHistory?: Array<{ createdAt: string; competitors: Array<{ competitorDomain: string; keywords: Array<{ keyword: string; monthlySearches: number | null; competitorUrl: string | null }> }> }> }>(`/api/seo/keywords?clientId=${encodeURIComponent(clientId)}`);
    const run = (res.json.competitorHistory || [])[0];
    const items = run ? run.competitors.flatMap((c) => c.keywords.slice(0, 25).map((k) => ({ competitor: c.competitorDomain, gap: k.keyword, page: k.competitorUrl || "", volume: k.monthlySearches }))) : [];
    return { status: items.length ? "ready" : "none", message: items.length ? undefined : "No competitor research run yet. Run it in the Competitors tab (paid, asks first) to see real keyword gaps; AI can draft hypotheses meanwhile.", source: run ? `Live · DataForSEO competitor gaps (${new Date(run.createdAt).toLocaleDateString("en-IE")})` : "", items, columns: [["competitor", "Competitor"], ["gap", "Keyword gap"], ["page", "Their page"], ["volume", "Monthly searches"]], importable: true, summary: items.slice(0, 80) };
  }
  if (stepId === "backlinks") {
    const [checks, tracked] = await Promise.all([getJson<{ history?: Array<{ target: string; checkedAt: string; summary?: { backlinks?: number | null; referringDomains?: number | null } }> }>(`/api/seo/backlinks?clientId=${encodeURIComponent(clientId)}`), getJson<{ opportunities?: Array<{ sourceUrl: string; sourceDomain: string; status: string; note: string }> }>(`/api/seo/backlinks/outreach?clientId=${encodeURIComponent(clientId)}`)]);
    const last = (checks.json.history || [])[0];
    const items: LiveItem[] = (tracked.json.opportunities || []).map((o) => ({ site: o.sourceDomain || o.sourceUrl, url: o.sourceUrl, status: o.status, note: o.note }));
    const message = [last ? `Last backlink check (${last.target}, ${new Date(last.checkedAt).toLocaleDateString("en-IE")}): ${last.summary?.backlinks ?? "—"} backlinks from ${last.summary?.referringDomains ?? "—"} referring domains.` : "No backlink check run yet (Backlinks tab, paid, asks first).", items.length ? "" : "No tracked follow-ups yet."].filter(Boolean).join(" ");
    return { status: items.length || last ? "ready" : "none", message, source: "Live · DataForSEO checks + tracked follow-ups", items, columns: [["site", "Site"], ["status", "Status"], ["note", "Note"]], importable: true, summary: { lastCheck: last || null, tracked: items.slice(0, 60) } };
  }
  return { status: "none", items: [] };
}

/** Turn live items into plan rows (labelled as live data, metrics kept only from the live source). */
function importRows(stepId: string, live: Live): SetupRow[] {
  const src = live.source || "Live data";
  if (stepId === "keywords") return live.items.map((i) => ({ id: newRowId(), source: src, topic: String(i.topic || ""), keyword: String(i.keyword || ""), location: String(i.location || ""), intent: "", targetPage: "", volume: i.volume == null ? "" : String(i.volume) }));
  if (stepId === "competitors") return live.items.map((i) => ({ id: newRowId(), source: src, competitor: String(i.competitor || ""), gap: String(i.gap || ""), page: String(i.page || ""), note: "", volume: i.volume == null ? "" : String(i.volume) }));
  if (stepId === "backlinks") return live.items.map((i) => ({ id: newRowId(), source: src, type: /live/i.test(String(i.status)) ? "Existing link" : "Opportunity", target: String(i.url || i.site || ""), approach: String(i.note || ""), followUp: "", status: /live/i.test(String(i.status)) ? "Won" : /contacted|replied/i.test(String(i.status)) ? "Contacted" : "To contact" }));
  return [];
}

export function SetupWizard({ kind, clientId, clientName, onOpenTab, onEditClient }: { kind: SetupKind; clientId: string; clientName: string; onOpenTab?: (tab: string) => void; onEditClient?: () => void }) {
  const steps = stepsFor(kind);
  const [draft, setDraft] = useState<SetupDraft | null>(null);
  const [loadError, setLoadError] = useState("");
  const [stepId, setStepId] = useState(steps[0].id);
  const [saveState, setSaveState] = useState<"" | "saving" | "saved" | "error">("");
  const [savedAt, setSavedAt] = useState("");
  const [live, setLive] = useState<Record<string, Live>>({});
  const [busy, setBusy] = useState("");
  const [request, setRequest] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [briefOpen, setBriefOpen] = useState(false);
  const dirty = useRef(false);
  const loadedFor = useRef("");

  // Load (or resume) the draft for this client and section.
  useEffect(() => {
    let cancelled = false; setLoadError(""); setLive({}); setNote(""); setError(""); dirty.current = false;
    void getJson<{ draft?: SetupDraft; error?: string }>(`/api/setup-drafts?kind=${kind}&clientId=${encodeURIComponent(clientId)}`).then(({ ok, json }) => {
      if (cancelled) return;
      if (!ok || !json.draft) { setLoadError(json.error || "Setup couldn’t load."); return; }
      loadedFor.current = clientId;
      setDraft({ brief: { ...emptyBrief(), ...json.draft.brief }, steps: json.draft.steps || {} }); setSavedAt(json.draft.updatedAt || "");
      const firstOpen = steps.find((st) => (json.draft!.steps?.[st.id]?.status || "empty") !== "reviewed");
      setStepId(firstOpen?.id || steps[0].id);
      const b = json.draft.brief || emptyBrief(); setBriefOpen(!b.website || !b.services || !b.locations);
    }).catch(() => { if (!cancelled) setLoadError("Setup couldn’t load."); });
    return () => { cancelled = true; };
  }, [kind, clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Autosave a moment after any change.
  useEffect(() => {
    if (!draft || !dirty.current || loadedFor.current !== clientId) return;
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      void fetch("/api/setup-drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", kind, clientId, draft }) }).then(async (r) => {
        const j = await r.json().catch(() => ({})) as { updatedAt?: string; error?: string };
        if (!r.ok) throw new Error(j.error || "Couldn’t save");
        dirty.current = false; setSaveState("saved"); setSavedAt(j.updatedAt || new Date().toISOString());
      }).catch(() => setSaveState("error"));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [draft, kind, clientId]);

  // Live data for the open step (read-only, cached per step).
  useEffect(() => {
    if (!draft || live[stepId]) return;
    setLive((cur) => ({ ...cur, [stepId]: { status: "loading", items: [] } }));
    void loadLive(kind, stepId, clientId).then((result) => setLive((cur) => ({ ...cur, [stepId]: result }))).catch((e) => setLive((cur) => ({ ...cur, [stepId]: { status: "error", message: e instanceof Error ? e.message : "Live data couldn’t load.", items: [] } })));
  }, [stepId, draft, kind, clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback((fn: (d: SetupDraft) => SetupDraft) => { dirty.current = true; setDraft((d) => d ? fn(d) : d); }, []);
  const step = steps.find((s) => s.id === stepId)!;
  const state: SetupStepState = draft?.steps[stepId] || { rows: [], status: "empty" };
  const setStep = (patch: Partial<SetupStepState>) => update((d) => ({ ...d, steps: { ...d.steps, [stepId]: { ...(d.steps[stepId] || { rows: [], status: "empty" }), ...patch } } }));
  const setRows = (rows: SetupRow[]) => setStep({ rows, status: rows.length ? (state.status === "reviewed" ? "draft" : state.status === "empty" ? "draft" : state.status) : "empty", savedAt: new Date().toISOString() });
  const setBrief = (patch: Partial<SetupBrief>) => update((d) => ({ ...d, brief: { ...d.brief, ...patch } }));
  const missing = draft ? (["website", "services", "locations"] as const).filter((k) => !draft.brief[k].trim()) : [];

  const previous = useMemo(() => {
    if (!draft) return {};
    const out: Record<string, unknown> = {};
    for (const st of steps) { if (st.id === stepId) break; const rows = draft.steps[st.id]?.rows || []; if (rows.length) out[st.title] = rows.slice(0, 60).map(({ id: _id, source: _src, ...rest }) => rest); }
    return out;
  }, [draft, stepId, steps]);

  const generate = async () => {
    if (!draft) return;
    setBusy("generate"); setError(""); setNote("");
    try {
      const liveData = live[stepId];
      const response = await fetch("/api/setup-drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "generate", kind, clientId, step: stepId, brief: draft.brief, previous, live: liveData?.status === "ready" ? { source: liveData.source, data: liveData.summary } : { note: liveData?.message || "No live data" }, request, current: request.trim() ? state.rows.map(({ id: _id, ...rest }) => rest) : [] }) });
      const json = await response.json().catch(() => ({})) as { rows?: SetupRow[]; note?: string; generatedAt?: string; error?: string };
      if (!response.ok || !json.rows) throw new Error(json.error || "AI couldn’t draft this step.");
      const keep = request.trim() ? [] : state.rows.filter((r) => r.source !== AI_SOURCE); // keep imported live rows on a fresh generate
      setStep({ rows: [...keep, ...json.rows], status: "draft", generatedAt: json.generatedAt, note: json.note || "" });
      setNote(json.note || ""); setRequest("");
    } catch (e) { setError(e instanceof Error ? e.message : "AI couldn’t draft this step."); }
    finally { setBusy(""); }
  };
  const fillBrief = async () => {
    if (!draft) return;
    setBusy("brief"); setError("");
    try {
      const response = await fetch("/api/setup-drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "brief", kind, clientId, brief: draft.brief }) });
      const json = await response.json().catch(() => ({})) as { suggestions?: Partial<SetupBrief>; error?: string };
      if (!response.ok || !json.suggestions) throw new Error(json.error || "AI couldn’t fill the gaps.");
      const patch: Partial<SetupBrief> = {};
      for (const [k, v] of Object.entries(json.suggestions)) if (v && !String(draft.brief[k as keyof SetupBrief] || "").trim()) patch[k as keyof SetupBrief] = v;
      setBrief(patch);
    } catch (e) { setError(e instanceof Error ? e.message : "AI couldn’t fill the gaps."); }
    finally { setBusy(""); }
  };
  const exportCsv = () => {
    const cols = step.columns;
    const lines = [["Source", ...cols.map((c) => c.label)].map(csvCell).join(","), ...state.rows.map((r) => [SOURCE_LABEL(r.source), ...cols.map((c) => String(r[c.key] || ""))].map(csvCell).join(","))];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${clientName} - ${kind === "ads" ? "Google Ads" : "SEO"} - ${step.title}.csv`.replace(/[\\/:*?"<>|]/g, ""); a.click(); URL.revokeObjectURL(a.href);
  };

  if (loadError) return <div className="sw-empty" role="alert">{loadError}</div>;
  if (!draft) return <div className="page-loading" role="status" aria-label="Loading setup…"><i /></div>;
  const nextStep = steps.find((st) => (draft.steps[st.id]?.status || "empty") !== "reviewed");
  const liveData = live[stepId];
  const problems = kind === "ads" ? state.rows.map((r) => ({ id: r.id, list: adsRowProblems(stepId, r) })).filter((p) => p.list.length) : [];

  return <div className="sw">
    <div className="sw-top">
      <div className="sw-next">{nextStep ? <><b>Next:</b> {nextStep.title}{nextStep.id !== stepId && <button type="button" className="text-button" onClick={() => setStepId(nextStep.id)}>Go</button>}</> : <><Check size={15} /> Every step reviewed</>}</div>
      <span className={`sw-save ${saveState}`} role="status">{saveState === "saving" ? "Saving…" : saveState === "error" ? "Couldn’t save, retrying on next change" : savedAt ? `Draft saved ${new Date(savedAt).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "Drafts save automatically"}</span>
    </div>

    <section className={`sw-brief ${briefOpen ? "open" : ""}`}>
      <button type="button" className="sw-brief-head" onClick={() => setBriefOpen((o) => !o)} aria-expanded={briefOpen}>{briefOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}<b>Business details</b><span>{missing.length ? `${missing.length} needed: ${missing.join(", ")}` : `${draft.brief.services.split(",").filter(Boolean).length} services · ${draft.brief.locations || "no areas"}`}</span></button>
      {briefOpen && <div className="sw-brief-body">
        <div className="sw-brief-grid">
          {([["website", "Website"], ["services", "Services (comma-separated)"], ["locations", "Areas served"], ["audience", "Ideal customer"], ["landingPages", "Landing pages (one per line)"], ["notes", "Anything else (offers, proof points, what to avoid)"]] as Array<[keyof SetupBrief, string]>).map(([key, label]) => <label key={key} className={key === "landingPages" || key === "notes" ? "wide" : ""}><span>{label}{(["website", "services", "locations"] as string[]).includes(key) && !draft.brief[key].trim() && <em>Needed</em>}</span>{key === "landingPages" || key === "notes" ? <textarea rows={3} value={draft.brief[key]} onChange={(e) => setBrief({ [key]: e.target.value })} /> : <input value={draft.brief[key]} onChange={(e) => setBrief({ [key]: e.target.value })} />}</label>)}
        </div>
        <div className="sw-row"><button type="button" className="secondary-button" disabled={busy === "brief"} onClick={() => void fillBrief()}><Wand2 size={15} /> {busy === "brief" ? "Filling…" : "AI: fill the gaps"}</button>{!draft.brief.website && onEditClient && <button type="button" className="text-button" onClick={onEditClient}>Add client website</button>}<small>Saved with this setup only; your client record isn’t changed.</small></div>
      </div>}
    </section>

    <nav className="sw-steps" aria-label="Setup steps">{steps.map((st, i) => { const status = draft.steps[st.id]?.status || "empty"; return <button key={st.id} type="button" className={`${st.id === stepId ? "on" : ""} ${status}`} aria-current={st.id === stepId ? "step" : undefined} onClick={() => { setStepId(st.id); setNote(""); setError(""); }}><i>{status === "reviewed" ? <Check size={12} /> : i + 1}</i><span>{st.title}</span></button>; })}</nav>

    <section className="sw-step">
      <header className="sw-step-head"><div><h3>{step.title}</h3><p>{step.intro}</p></div><span className={`sw-status ${state.status}`}>{state.status === "reviewed" ? "Reviewed" : state.status === "draft" ? "Draft" : "Not started"}</span></header>

      <LivePanel def={step} live={liveData} onImport={liveData?.importable ? () => setRows([...state.rows, ...importRows(stepId, liveData)]) : undefined} onRefresh={() => setLive((cur) => { const next = { ...cur }; delete next[stepId]; return next; })} onOpenTab={onOpenTab} kind={kind} />

      <div className="sw-ai">
        <Sparkles size={16} aria-hidden="true" />
        <input value={request} onChange={(e) => setRequest(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && busy !== "generate") void generate(); }} placeholder={state.rows.length ? "Tell AI what to change (e.g. “add an emergency ad group”), or regenerate" : `AI drafts this step from the details${liveData?.status === "ready" ? " and the live data above" : ""}`} aria-label="What should AI change?" />
        <button type="button" className="primary-button" disabled={busy === "generate" || missing.includes("services")} title={missing.includes("services") ? "Add the services first" : ""} onClick={() => void generate()}>{busy === "generate" ? "Drafting…" : request.trim() ? <><Sparkles size={14} /> Apply</> : state.rows.some((r) => r.source === AI_SOURCE) ? <><RefreshCw size={14} /> Regenerate</> : <><Sparkles size={14} /> Draft with AI</>}</button>
      </div>
      {(note || state.note) && <p className="sw-note"><Sparkles size={13} /> {note || state.note}</p>}
      {error && <p className="sw-error" role="alert">{error}</p>}

      {state.rows.length ? <div className="sw-rows">{state.rows.map((row) => <RowCard key={row.id} def={step} row={row} problems={problems.find((p) => p.id === row.id)?.list || []} onChange={(patch) => setRows(state.rows.map((r) => r.id === row.id ? { ...r, ...patch } : r))} onDelete={() => setRows(state.rows.filter((r) => r.id !== row.id))} />)}</div>
        : <div className="sw-empty">Nothing planned yet. Draft it with AI{liveData?.importable && liveData.items.length ? ", add the live data above" : ""} or add rows yourself.</div>}

      <footer className="sw-actions">
        <button type="button" className="secondary-button" onClick={() => setRows([...state.rows, { id: newRowId(), source: "Added by you" } as SetupRow])}><Plus size={15} /> Add row</button>
        {state.rows.length > 0 && <button type="button" className="secondary-button" onClick={exportCsv}><Download size={15} /> Export CSV</button>}
        {problems.length > 0 && <span className="sw-warn">{problems.length} row{problems.length === 1 ? "" : "s"} over Google Ads limits</span>}
        <span className="sw-spacer" />
        {state.rows.length > 0 && state.status !== "reviewed" && <button type="button" className="primary-button" disabled={problems.length > 0} title={problems.length ? "Fix the rows over Google Ads limits first" : ""} onClick={() => { setStep({ status: "reviewed" }); const idx = steps.findIndex((s) => s.id === stepId); if (steps[idx + 1]) setStepId(steps[idx + 1].id); }}><Check size={15} /> Mark reviewed &amp; continue</button>}
        {state.status === "reviewed" && <button type="button" className="text-button" onClick={() => setStep({ status: "draft" })}>Reopen</button>}
      </footer>
      <p className="sw-foot">Plans only: nothing is published to {kind === "ads" ? "Google Ads" : "the website"}, no money is spent and no one is contacted. Use Export CSV (e.g. for Google Ads Editor) or apply changes from the {kind === "ads" ? "Campaigns tab with approval" : "website builder"}.</p>
    </section>
  </div>;
}

function LivePanel({ def, live, onImport, onRefresh, onOpenTab, kind }: { def: SetupStepDef; live?: Live; onImport?: () => void; onRefresh: () => void; onOpenTab?: (tab: string) => void; kind: SetupKind }) {
  const [open, setOpen] = useState(false);
  if (!live || live.status === "loading") return <div className="sw-live loading"><b>{def.live}</b><span>Checking what already exists…</span></div>;
  const research = kind === "seo" && def.id === "competitors" ? "competitors" : kind === "seo" && def.id === "backlinks" ? "backlinks" : kind === "seo" && def.id === "keywords" ? "keywords" : "";
  return <div className={`sw-live ${live.status}`}>
    <div className="sw-live-head"><b>{def.live}</b>{live.source && live.items.length > 0 && <span className="sw-badge live">{live.source}</span>}{live.items.length > 0 && <button type="button" className="text-button" onClick={() => setOpen((o) => !o)}>{open ? "Hide" : `Show ${live.items.length}`}</button>}{onImport && live.items.length > 0 && <button type="button" className="secondary-button" onClick={onImport}><Plus size={14} /> Add to plan</button>}{research && onOpenTab && <button type="button" className="text-button" onClick={() => onOpenTab(research)}>Run live research ↗</button>}<button type="button" className="text-button" onClick={onRefresh} aria-label="Refresh live data"><RefreshCw size={13} /></button></div>
    {live.message && <p>{live.message}</p>}
    {open && live.items.length > 0 && live.columns && <div className="sw-live-table"><table><thead><tr>{live.columns.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead><tbody>{live.items.slice(0, 60).map((item, i) => <tr key={i}>{live.columns!.map(([key]) => <td key={key}>{item[key] == null || item[key] === "" ? "—" : typeof item[key] === "number" ? Number(item[key]).toLocaleString("en-IE", { maximumFractionDigits: 2 }) : String(item[key])}</td>)}</tr>)}</tbody></table>{live.items.length > 60 && <small>Showing 60 of {live.items.length}.</small>}</div>}
  </div>;
}

function RowCard({ def, row, problems, onChange, onDelete }: { def: SetupStepDef; row: SetupRow; problems: string[]; onChange: (patch: Record<string, string>) => void; onDelete: () => void }) {
  return <article className={`sw-card ${problems.length ? "bad" : ""}`}>
    <div className="sw-card-top"><span className={`sw-badge ${row.source === AI_SOURCE ? "ai" : row.source.startsWith("Live") ? "live" : "you"}`}>{row.source === AI_SOURCE ? "AI suggestion" : row.source}</span><button type="button" className="sw-del" aria-label="Remove row" onClick={onDelete}><Trash2 size={14} /></button></div>
    <div className="sw-fields">{def.columns.map((col) => {
      const value = String(row[col.key] || "");
      if (col.type === "metric") return <label key={col.key} className="metric"><span>{col.label}</span><b title={value ? "From live data" : "No verified data"}>{value ? Number(value).toLocaleString("en-IE") : "—"}</b></label>;
      const counter = col.limit ? <small className={value.length > col.limit ? "over" : ""}>{value.length}/{col.limit}</small> : null;
      if (col.type === "select") return <label key={col.key}><span>{col.label}</span><select value={value} onChange={(e) => onChange({ [col.key]: e.target.value })}><option value="">—</option>{col.options!.map((o) => <option key={o}>{o}</option>)}{value && !col.options!.includes(value) && <option>{value}</option>}</select></label>;
      if (col.type === "lines") { const lines = value.split("\n").filter((l) => l.trim()); const over = lines.filter((l) => col.lineLimit && l.trim().length > col.lineLimit).length; return <label key={col.key} className="wide"><span>{col.label} <small className={over || (col.maxLines && lines.length > col.maxLines) ? "over" : ""}>{lines.length}{col.maxLines ? `/${col.maxLines}` : ""}{over ? ` · ${over} too long` : ""}</small></span><textarea rows={Math.min(8, Math.max(3, lines.length + 1))} value={value} onChange={(e) => onChange({ [col.key]: e.target.value })} /></label>; }
      if (col.type === "long") return <label key={col.key} className="wide"><span>{col.label}</span><textarea rows={2} value={value} onChange={(e) => onChange({ [col.key]: e.target.value })} /></label>;
      return <label key={col.key}><span>{col.label} {counter}</span><input value={value} onChange={(e) => onChange({ [col.key]: e.target.value })} inputMode={col.type === "url" ? "url" : undefined} /></label>;
    })}</div>
    {problems.length > 0 && <ul className="sw-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
  </article>;
}
