"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BarChart3, BookOpen, CalendarPlus, CheckCircle2, ClipboardList, Image as ImageIcon, Mail, MessageSquare, MousePointerClick, Phone, Plus, Sparkles, UserPlus, Users } from "lucide-react";
import { BrandIcon } from "./brand-icon";
import { CampaignPicker } from "./campaign-picker";

type HubTask = { id: string; clientId: string; title: string; status: string; assigneeId: string; due?: string; dueAt?: string; completedAt?: string; service?: string; reviewStatus?: string; aiRunState?: string; aiApprovals?: Array<{ status: string }> };
type HubClient = { id: string; name: string; logo?: string; googleAdsAccountId?: string; appointmentBased?: boolean };
type HubStaff = { id: string; name: string; isBot?: boolean };
type Stat = { value: number; previous: number | null } | null;
type Marketing = {
  currency: string; visits: (Stat & { metric?: string }) | null; visitsNote: string; adSpend: Stat; adClicks: Stat; impressions?: Stat; conversions?: Stat; cpc?: Stat; costPerConversion?: Stat; adsNote: string; split?: Split; gsc?: Gsc | null; googleCampaigns?: Array<{ id: string; name: string; status: string; spend: number; clicks: number; impressions: number; conversions: number }>; meta?: { spend: number; impressions: number; clicks: number; leads: number; cpc: number | null; costPerLead: number | null; accounts: number; linkedAccounts: number; campaigns?: Array<{ id: string; name: string; status: string; spend: number; clicks: number; impressions: number; leads: number }> } | null; metaNote?: string; scope?: string; accounts?: number; linkedAccounts?: number; calls: Stat; profileClicks: Stat; businessNote: string; leads: Stat;
  google: { position: number | null; previous: number | null; tracked: number; top3: number } | null; rankNote: string;
  chatgpt: { share: number; previous: number | null; prompts: number; mentioned: number } | null; aiNote: string; bing: null; bingNote: string;
};
type Gsc = { error?: string; property?: string; clicks?: number; previousClicks?: number | null; impressions?: number; position?: number | null; previousPosition?: number | null; queriesTracked?: number; pages?: Array<{ page: string; clicks: number; impressions: number; position: number | null }>; queries?: Array<{ query: string; clicks: number; impressions: number; position: number | null }>; trending?: Array<{ query: string; impressions: number; change: number }> };
type Split = { organic: { clicks: number | null; visits: number | null; calls: number | null; leads: number | null }; paid: { clicks: number | null; calls: number | null; callConversions: number | null; leads: number | null; conversions: number | null }; otherLeads: number | null; notes: { organic: string; paid: string } };
type Metrics = { clientId: string; marketing: Marketing | null; appointments: Array<{ id: string; name: string; start: string; end?: string; status?: string; clientId: string; channel: string; calendar?: string; staff?: string }>; emails: { total: number; failed?: number; delivered?: number; people?: number; replies?: number; last?: string; configured?: boolean; recent: Array<{ to: string; subject: string; at: string; failed?: boolean }> } };

const CACHE_MS = 15 * 60_000;
// Demo figures for the agency dashboard's "Sample data" toggle (never saved anywhere).
const SAMPLE: Metrics = {
  clientId: "sample",
  marketing: { currency: "EUR", visits: { value: 1840, previous: 1510, metric: "Organic sessions" }, visitsNote: "", adSpend: { value: 1364, previous: 1290 }, adClicks: { value: 742, previous: 655 }, adsNote: "", calls: { value: 38, previous: 29 }, profileClicks: { value: 126, previous: 98 }, businessNote: "", leads: { value: 47, previous: null },
    split: { organic: { clicks: 912, visits: 1840, calls: 38, leads: 21 }, paid: { clicks: 742, calls: 17, callConversions: 17, leads: 19, conversions: 71 }, otherLeads: 7, notes: { organic: "", paid: "" } },
    google: { position: 4.2, previous: 5.8, tracked: 24, top3: 9 }, rankNote: "", chatgpt: { share: 42, previous: 30, prompts: 12, mentioned: 5 }, aiNote: "", bing: null, bingNote: "Sample: Bing tracking not set up" },
  appointments: [{ id: "s1", name: "Mary Walsh", calendar: "Kitchen survey", start: new Date(new Date().setHours(10, 0, 0, 0)).toISOString(), end: new Date(new Date().setHours(11, 0, 0, 0)).toISOString(), status: "confirmed", clientId: "", channel: "On site", staff: "Pat" }, { id: "s2", name: "John Byrne", calendar: "Roof quote", start: new Date(new Date().setHours(11, 30, 0, 0)).toISOString(), status: "confirmed", clientId: "", channel: "Phone", staff: "Mick" }, { id: "s3", name: "Aoife Kelly", calendar: "Consultation", start: new Date(new Date().setHours(14, 30, 0, 0)).toISOString(), status: "pending", clientId: "", channel: "Google Meet", staff: "Sean" }, { id: "s4", name: "Daniel Brooks", calendar: "Site visit", start: new Date(new Date().setHours(16, 0, 0, 0)).toISOString(), status: "confirmed", clientId: "", channel: "On site", staff: "Pat" }],
  emails: { total: 64, failed: 1, delivered: 63, people: 41, replies: 12, configured: true, recent: [{ to: "Mary Walsh", subject: "Your quote from Renew Electrical", at: new Date(Date.now() - 2 * 3600_000).toISOString() }, { to: "John Byrne", subject: "Booking confirmed for Thursday", at: new Date(Date.now() - 20 * 3600_000).toISOString() }, { to: "Aoife Kelly", subject: "Invoice INV-0012", at: new Date(Date.now() - 44 * 3600_000).toISOString() }] },
};
const money = (n: number, currency: string) => { try { return new Intl.NumberFormat("en-IE", { style: "currency", currency, maximumFractionDigits: 0 }).format(n); } catch { return `€${Math.round(n)}`; } };
const money2 = (n: number, currency: string) => { try { return new Intl.NumberFormat("en-IE", { style: "currency", currency, maximumFractionDigits: 2 }).format(n); } catch { return `€${n.toFixed(2)}`; } };
const num = (n: number) => new Intl.NumberFormat("en-IE").format(Math.round(n));
const when = (iso?: string) => { if (!iso) return ""; const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso); if (Number.isNaN(d.getTime())) return ""; const today = new Date(); const diff = Math.round((new Date(d.toDateString()).getTime() - new Date(today.toDateString()).getTime()) / 86_400_000); const time = iso.length > 10 ? ` · ${d.toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" })}` : ""; return (diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : diff === -1 ? "Yesterday" : d.toLocaleDateString("en-IE", { day: "numeric", month: "short" })) + time; };

// Change badge: green when it's better, soft red when worse. `lowerIsBetter` for positions and spend.
function Delta({ now, before, lowerIsBetter = false, suffix = "%" }: { now: number | null | undefined; before: number | null | undefined; lowerIsBetter?: boolean; suffix?: string }) {
  if (now == null || before == null || before === 0) return null;
  const change = suffix === "%" ? Math.round(((now - before) / Math.abs(before)) * 100) : Math.round((now - before) * 10) / 10;
  if (!change) return <span className="dh-delta flat">no change</span>;
  const good = lowerIsBetter ? change < 0 : change > 0;
  return <span className={`dh-delta ${good ? "good" : "bad"}`}>{change > 0 ? "▲" : "▼"} {Math.abs(change)}{suffix}</span>;
}

function Tile({ icon, label, value, note, tone = "", children }: { icon: ReactNode; label: string; value: ReactNode; note?: string; tone?: "" | "expense" | "good"; children?: ReactNode }) {
  return <div className={`dh-tile ${tone}`}><span className="dh-tile-icon">{icon}</span><div className="dh-tile-body"><small>{label}</small><b>{value}</b>{children}{note && <em>{note}</em>}</div></div>;
}

export function DashboardHub({ scopeClientId, clients, tasks, staff, onNavigate, onAddTask, onOpenTask, adsPanel, valuePanel, periodStart = "", periodEnd = "", periodLabel = "Last 30 days", focusClientId = "" }: { focusClientId?: string; periodStart?: string; periodEnd?: string; periodLabel?: string; adsPanel?: ReactNode; valuePanel?: ReactNode; scopeClientId: string; clients: HubClient[]; tasks: HubTask[]; staff: HubStaff[]; onNavigate: (page: string) => void; onAddTask: () => void; onOpenTask?: (id: string) => void }) {
  const [pickedClient, setPickedClient] = useState(() => { try { return localStorage.getItem("f2b-dash-client") || ""; } catch { return ""; } });
  // Agency view defaults to all clients' Google Ads; a client can be picked for their full results.
  const clientId = scopeClientId || (clients.some((c) => c.id === focusClientId) ? focusClientId : (clients.find((c) => c.googleAdsAccountId) || clients[0])?.id || ""); void pickedClient; void setPickedClient;
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [sample, setSample] = useState(() => { try { return localStorage.getItem("f2b-dash-sample") === "1"; } catch { return false; } });
  const [apptRange, setApptRange] = useState<"today" | "tomorrow" | "week" | "all" | "date">("today");
  const [apptDate, setApptDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [gCamp, setGCamp] = useState("");
  const [mCamp, setMCamp] = useState("");
  useEffect(() => { setGCamp(""); setMCamp(""); }, [clientId]);
  const [showAi, setShowAi] = useState(() => { try { return localStorage.getItem("f2b-dash-ai") !== "0"; } catch { return true; } });

  useEffect(() => {
    const key = `f2b-dash-metrics-v4:${clientId}:${periodStart}:${periodEnd}`;
    try { const cached = JSON.parse(sessionStorage.getItem(key) || "null") as { at: number; data: Metrics } | null; if (cached && Date.now() - cached.at < CACHE_MS) { setMetrics(cached.data); return; } } catch { /* no cache */ }
    let live = true; setLoading(true);
    fetch(`/api/dashboard-metrics?clientId=${encodeURIComponent(clientId)}&start=${periodStart}&end=${periodEnd}`).then((r) => r.ok ? r.json() as Promise<Metrics> : null).then((data) => { if (!live || !data) return; setMetrics(data); try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch { /* full */ } }).catch(() => undefined).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [clientId, periodStart, periodEnd]);

  const bots = useMemo(() => new Set(staff.filter((s) => s.isBot).map((s) => s.id)), [staff]);
  const inScope = (t: HubTask) => !scopeClientId || t.clientId === scopeClientId;
  const upcoming = useMemo(() => tasks.filter((t) => inScope(t) && !/^done$/i.test(t.status) && (showAi || !bots.has(t.assigneeId))).sort((a, b) => (a.dueAt || a.due || "9999").localeCompare(b.dueAt || b.due || "9999")).slice(0, 6), [tasks, showAi, bots, scopeClientId]); // eslint-disable-line react-hooks/exhaustive-deps
  const completed = useMemo(() => tasks.filter((t) => inScope(t) && /^done$/i.test(t.status) && t.completedAt).sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || "")).slice(0, 6), [tasks, scopeClientId]); // eslint-disable-line react-hooks/exhaustive-deps
  const aiPending = tasks.filter((t) => inScope(t) && ((t.aiApprovals || []).some((a) => a.status === "pending") || t.aiRunState === "needs_review")).length;
  const humanPending = tasks.filter((t) => inScope(t) && t.reviewStatus === "submitted").length;
  const clientOf = (id: string) => clients.find((c) => c.id === id);
  const logo = (id: string) => { const c = clientOf(id); return c?.logo ? <img className="dh-logo" src={c.logo} alt="" /> : <span className="dh-logo dh-logo-fallback">{(c?.name || "•").slice(0, 1)}</span>; };
  const view = !scopeClientId && sample ? SAMPLE : metrics;
  const m = view?.marketing;
  const cur = m?.currency || "EUR";

  const showAppts = !scopeClientId || clients.find((c) => c.id === scopeClientId)?.appointmentBased !== false;
  const actions: Array<{ label: string; hint: string; icon: ReactNode; run: () => void; tint: string }> = [
    { label: "New task", hint: "Add work for the team", icon: <Plus size={18} />, run: onAddTask, tint: "blue" },
    { label: "View leads", hint: "Pipeline & contacts", icon: <Users size={18} />, run: () => onNavigate("CRM"), tint: "violet" },
    { label: "Conversations", hint: "Texts, WhatsApp, email", icon: <MessageSquare size={18} />, run: () => onNavigate("Conversations"), tint: "teal" },
    ...(showAppts ? [{ label: "New appointment", hint: "Book a call or visit", icon: <CalendarPlus size={18} />, run: () => onNavigate("Scheduling"), tint: "amber" }] : []),
    { label: "Upload media", hint: "Job photos & videos", icon: <ImageIcon size={18} />, run: () => onNavigate("Media Library"), tint: "pink" },
    { label: "Open books", hint: "Income & expenses", icon: <BookOpen size={18} />, run: () => onNavigate("Bookkeeping"), tint: "green" },
  ];

  return <div className="dh">
    {!scopeClientId && <label className={`task-ai-toggle dh-sample-toggle ${sample ? "is-on" : ""}`} title="Show demo figures on the dashboard (nothing is saved)"><input type="checkbox" role="switch" checked={sample} onChange={(e) => { setSample(e.target.checked); try { localStorage.setItem("f2b-dash-sample", e.target.checked ? "1" : "0"); } catch { /* ignore */ } }} /><span className="task-ai-toggle-track" aria-hidden="true"><span className="task-ai-toggle-thumb" /></span><b>Sample data</b></label>}
    {!scopeClientId && sample && <div className="dh-sample-banner">Showing sample figures for demos — turn off “Sample data” for your real numbers.</div>}
    <section className="dh-actions" aria-label="Quick actions">{actions.map((a) => <button type="button" key={a.label} className={`dh-action ${a.tint}`} onClick={a.run}><span className="dh-action-icon">{a.icon}</span><span><b>{a.label}</b><small>{a.hint}</small></span></button>)}</section>

    <section className="dh-approvals" aria-label="Pending approvals">
      {[{ key: "ai", label: "AI approvals", n: aiPending, icon: <Sparkles size={18} />, hint: "Changes the AI wants you to approve" }, { key: "human", label: "Team approvals", n: humanPending, icon: <Users size={18} />, hint: "Work your team submitted for review" }].map((a) => <button type="button" key={a.key} className={`dh-approval ${a.n ? "waiting" : "clear"}`} onClick={() => onNavigate("Tasks")}><span className="dh-approval-icon">{a.icon}</span><span className="dh-approval-text"><b>{a.label}</b><small>{a.n ? a.hint : "All done"}</small></span><span className="dh-approval-n">{a.n ? a.n : "✓"}</span></button>)}
    </section>
    {valuePanel}
    <section className="panel dh-panel" aria-label="Website and marketing results">
      <div className="dh-head"><div><p className="eyebrow">📈 {periodLabel.toUpperCase()}</p><h2>Marketing</h2></div>
        {!scopeClientId && <span className="dh-client-note">{clients.find((c) => c.id === clientId)?.logo && <img src={clients.find((c) => c.id === clientId)?.logo} alt="" />}{clients.find((c) => c.id === clientId)?.name}{!focusClientId && <small> · change client in the top bar</small>}</span>}
      </div>
      {loading && !m ? <><p className="dh-muted">Loading results…</p></> : !m ? <></> : <>
        {(() => { const sp = m.split; const v = (x: number | null | undefined) => x == null ? "—" : num(x);
          const Row = ({ icon, label, value, good }: { icon: ReactNode; label: string; value: string; good?: boolean }) => <div className={`dh-split-row ${good ? "good" : ""}`}><span className="dh-split-ico">{icon}</span><span>{label}</span><b>{value}</b></div>;
          return <div className="dh-split">
            <div className="dh-split-col"><div className="dh-split-head"><BrandIcon id="google" size={20} fallback={null} /><b>Organic</b><small>Google search & Maps (free)</small></div>
              {(() => { const g = m.gsc && !m.gsc.error ? m.gsc : null; const clicks = g ? g.clicks : sp?.organic.clicks; return <>
                <Row icon={<MousePointerClick size={15} />} label={clicks != null ? "Google search clicks" : "Website visits"} value={v(clicks ?? sp?.organic.visits)} good={(clicks ?? sp?.organic.visits ?? 0) > 0} />
                {g && <Row icon={<BarChart3 size={15} />} label="Seen in Google (impressions)" value={v(g.impressions)} />}
                {g && g.position != null && <Row icon={<BrandIcon id="google" size={15} fallback={null} />} label="Avg. Google position" value={`#${g.position}`} good={g.position <= 10} />}
              </>; })()}
              <Row icon={<Phone size={15} />} label="Calls (Business Profile)" value={v(sp?.organic.calls)} good={(sp?.organic.calls || 0) > 0} />
              <Row icon={<BrandIcon id="business-profile" size={15} fallback={<MousePointerClick size={15} />} />} label="Profile website clicks" value={v(m.profileClicks?.value)} good={(m.profileClicks?.value || 0) > 0} />
              <Row icon={<UserPlus size={15} />} label="Leads" value={v(sp?.organic.leads)} good={(sp?.organic.leads || 0) > 0} />
              {m.gsc?.error ? <em className="dh-split-note">{m.gsc.error}</em> : !m.gsc && sp?.notes.organic ? <em className="dh-split-note">{sp.notes.organic}</em> : null}
            </div>
            {(() => { const camps = m.googleCampaigns || []; const c = camps.find((x) => x.id === gCamp); const spend = c ? c.spend : m.adSpend?.value; const clicks = c ? c.clicks : sp?.paid.clicks; const conv = c ? c.conversions : sp?.paid.conversions;
              return <div className="dh-split-col"><div className="dh-split-head"><BrandIcon id="google-ads" size={20} fallback={null} /><b>Google Ads</b>{camps.length > 0 && <div className="dh-camp-wrap"><CampaignPicker label="Google Ads campaign" currency={cur} value={gCamp} onChange={setGCamp} options={camps.map((x) => ({ value: x.id, name: x.name, logo: clientOf(clientId)?.logo, spend: x.spend, status: x.status }))} /></div>}</div>
                <div className="dh-split-row expense"><span className="dh-split-ico"><span className="dh-cur">€</span></span><span>Spend</span><b>{spend != null ? money(spend, cur) : "—"}</b></div>
                <Row icon={<MousePointerClick size={15} />} label="Ad clicks" value={v(clicks)} good={(clicks || 0) > 0} />
                <Row icon={<span className="dh-cur">€</span>} label="Avg. CPC" value={spend != null && clicks ? money2(spend / clicks, cur) : "—"} />
                <Row icon={<CheckCircle2 size={15} />} label="Conversions" value={v(conv)} good={(conv || 0) > 0} />
                {!c && <Row icon={<Phone size={15} />} label="Calls from ads" value={v(sp?.paid.calls ?? sp?.paid.callConversions)} good={(sp?.paid.calls || 0) > 0} />}
                {!c && <Row icon={<UserPlus size={15} />} label="Leads in CRM" value={v(sp?.paid.leads)} good={(sp?.paid.leads || 0) > 0} />}
                {sp?.notes.paid && <em className="dh-split-note">{sp.notes.paid}</em>}
              </div>; })()}
            {(() => { const meta = m.meta; const camps = meta?.campaigns || []; const c = camps.find((x) => x.id === mCamp); const spend = c ? c.spend : meta?.spend; const clicks = c ? c.clicks : meta?.clicks; const leads = c ? c.leads : meta?.leads;
              return <div className="dh-split-col"><div className="dh-split-head"><BrandIcon id="meta-ads" size={20} fallback={null} /><b>Meta Ads</b>{camps.length > 0 && <div className="dh-camp-wrap"><CampaignPicker label="Meta Ads campaign" currency={cur} value={mCamp} onChange={setMCamp} options={camps.map((x) => ({ value: x.id, name: x.name, logo: clientOf(clientId)?.logo, spend: x.spend, status: x.status }))} /></div>}</div>
                {meta ? <>
                  <div className="dh-split-row expense"><span className="dh-split-ico"><span className="dh-cur">€</span></span><span>Spend</span><b>{money(spend || 0, cur)}</b></div>
                  <Row icon={<MousePointerClick size={15} />} label="Clicks" value={v(clicks)} good={(clicks || 0) > 0} />
                  <Row icon={<span className="dh-cur">€</span>} label="Avg. CPC" value={clicks ? money2((spend || 0) / clicks, cur) : "—"} />
                  <Row icon={<UserPlus size={15} />} label="Leads" value={v(leads)} good={(leads || 0) > 0} />
                  <Row icon={<CheckCircle2 size={15} />} label="Cost per lead" value={leads ? money2((spend || 0) / leads, cur) : "—"} />
                </> : <em className="dh-split-note">{m.metaNote || "No Meta Ads account linked to this client."}</em>}
              </div>; })()}
            <div className="dh-split-total"><UserPlus size={16} /><span>All leads · 30 days</span><b>{v(m.leads?.value)}</b>{sp?.otherLeads ? <small>{sp.otherLeads} from other or unknown sources</small> : null}</div>
          </div>; })()}
        {m.gsc && !m.gsc.error && ((m.gsc.pages || []).length > 0 || (m.gsc.queries || []).length > 0) && <div className="dh-gsc">
          <div className="dh-gsc-col"><h3 className="dh-sub">Top pages from Google</h3>{(m.gsc.pages || []).map((p) => <div key={p.page} className="dh-gsc-row"><span title={p.page}>{p.page}</span><b>{num(p.clicks)}</b><small>{num(p.impressions)} seen{p.position != null ? ` · #${p.position}` : ""}</small></div>)}</div>
          <div className="dh-gsc-col"><h3 className="dh-sub">Top searches</h3>{(m.gsc.queries || []).map((q) => <div key={q.query} className="dh-gsc-row"><span title={q.query}>{q.query}</span><b>{num(q.clicks)}</b><small>{q.position != null ? `#${q.position}` : ""}</small></div>)}</div>
          <div className="dh-gsc-col"><h3 className="dh-sub">🔥 Trending searches</h3>{(m.gsc.trending || []).length ? (m.gsc.trending || []).map((q) => <div key={q.query} className="dh-gsc-row"><span title={q.query}>{q.query}</span><b className="good">▲ {num(q.change)}</b><small>{num(q.impressions)} seen</small></div>) : <p className="dh-muted">No rising searches vs the previous month.</p>}</div>
        </div>}
        {m.scope !== "all" && <><h3 className="dh-sub">Where you show up</h3>
        <div className="dh-ranks">
          <div className="dh-rank"><div className="dh-rank-logos"><BrandIcon id="google" size={24} fallback={<span>G</span>} /><span className="dh-rank-also" title="Chrome and Safari use Google search"><BrandIcon id="chrome" size={14} fallback={null} /><BrandIcon id="safari" size={14} fallback={null} /></span></div><small>Google · Chrome & Safari</small>{m.google ? <><b>{m.google.position != null ? `#${m.google.position}` : "—"}</b><em>avg of {m.google.tracked} keywords · {m.google.top3} in top 3 <Delta now={m.google.position} before={m.google.previous} lowerIsBetter suffix="" /></em></> : m.gsc && !m.gsc.error && m.gsc.position != null ? <><b>#{m.gsc.position}</b><em>avg position across {num(m.gsc.queriesTracked || 0)} searches (Search Console) <Delta now={m.gsc.position} before={m.gsc.previousPosition} lowerIsBetter suffix="" /></em></> : <><b>—</b><em>{m.gsc?.error || m.rankNote || "Not tracked yet"}</em></>}</div>
          <div className="dh-rank"><div className="dh-rank-logos"><BrandIcon id="bing" size={24} fallback={<span>b</span>} /><span className="dh-rank-also" title="Microsoft Edge uses Bing search"><BrandIcon id="edge" size={14} fallback={null} /></span></div><small>Bing · Microsoft Edge</small><b>—</b><em>{m.bingNote}</em></div>
          <div className="dh-rank"><div className="dh-rank-logos"><BrandIcon id="chatgpt" size={24} fallback={<Sparkles size={18} />} /></div><small>ChatGPT</small><b>{m.chatgpt ? `${Math.round(m.chatgpt.share)}%` : "—"}</b>{m.chatgpt ? <em>mentioned in {m.chatgpt.mentioned} of {m.chatgpt.prompts} questions <Delta now={m.chatgpt.share} before={m.chatgpt.previous} suffix=" pts" /></em> : <em>{m.aiNote || "No AI check yet"}</em>}</div>
        </div></>}
      </>}
    </section>

    {adsPanel && <div className="dh-ads-wrap">{adsPanel}</div>}
    <div className="dh-grid">

      <section className="panel dh-panel dh-email"><div className="dh-head"><div><p className="eyebrow"><Mail size={12} /> {periodLabel.toUpperCase()}</p><h2>Emails &amp; health</h2></div><button type="button" className="text-button" onClick={() => onNavigate("Conversations")}>Open inbox →</button></div>
        {(() => { const e = view?.emails; if (!e) return <p className="dh-muted">{loading ? "Loading…" : "No emails yet."}</p>; const rate = e.total ? Math.round(((e.delivered ?? e.total) / e.total) * 100) : null; const tone = rate == null ? "" : rate >= 98 ? "good" : rate >= 90 ? "warn" : "bad"; return <>
          <div className="dh-email-stats">
            <div className="dh-email-stat"><small>Sent</small><b>{num(e.total)}</b></div>
            <div className={`dh-email-stat ${tone}`}><small>Delivered</small><b>{rate == null ? "—" : `${rate}%`}</b></div>
            <div className={`dh-email-stat ${(e.failed || 0) > 0 ? "bad" : "good"}`}><small>Failed</small><b>{num(e.failed || 0)}</b></div>
            <div className="dh-email-stat"><small>People emailed</small><b>{num(e.people || 0)}</b></div>
            <div className="dh-email-stat"><small>Replies</small><b>{num(e.replies || 0)}</b></div>
            <div className={`dh-email-stat ${e.configured === false ? "bad" : "good"}`}><small>Sending</small><b>{e.configured === false ? "Not set up" : "Healthy"}</b></div>
          </div>
          {e.recent.length ? <ul className="dh-list dh-email-list">{e.recent.map((m, i) => <li key={i}><span className={`dh-logo dh-logo-fallback ${m.failed ? "is-bad" : ""}`}>{m.failed ? "!" : <Mail size={13} />}</span><span><b>{m.subject || "(no subject)"}</b><small>{m.to} · {when(m.at)}{m.failed ? " · failed" : ""}</small></span></li>)}</ul> : <p className="dh-muted">No emails sent in this period.</p>}
        </>; })()}
      </section>
    </div>
  </div>;
}
