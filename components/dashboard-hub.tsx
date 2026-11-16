"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BarChart3, BookOpen, CalendarPlus, CheckCircle2, ClipboardList, Image as ImageIcon, Mail, MessageSquare, MousePointerClick, Phone, Plus, Sparkles, UserPlus, Users } from "lucide-react";
import { BrandIcon } from "./brand-icon";

type HubTask = { id: string; clientId: string; title: string; status: string; assigneeId: string; due?: string; dueAt?: string; completedAt?: string; service?: string };
type HubClient = { id: string; name: string; logo?: string; googleAdsAccountId?: string };
type HubStaff = { id: string; name: string; isBot?: boolean };
type Stat = { value: number; previous: number | null } | null;
type Marketing = {
  currency: string; visits: (Stat & { metric?: string }) | null; visitsNote: string; adSpend: Stat; adClicks: Stat; impressions?: Stat; conversions?: Stat; cpc?: Stat; costPerConversion?: Stat; adsNote: string; split?: Split; meta?: { spend: number; impressions: number; clicks: number; leads: number; cpc: number | null; costPerLead: number | null; accounts: number; linkedAccounts: number } | null; metaNote?: string; scope?: string; accounts?: number; linkedAccounts?: number; calls: Stat; profileClicks: Stat; businessNote: string; leads: Stat;
  google: { position: number | null; previous: number | null; tracked: number; top3: number } | null; rankNote: string;
  chatgpt: { share: number; previous: number | null; prompts: number; mentioned: number } | null; aiNote: string; bing: null; bingNote: string;
};
type Split = { organic: { clicks: number | null; visits: number | null; calls: number | null; leads: number | null }; paid: { clicks: number | null; calls: number | null; callConversions: number | null; leads: number | null; conversions: number | null }; otherLeads: number | null; notes: { organic: string; paid: string } };
type Metrics = { clientId: string; marketing: Marketing | null; appointments: Array<{ id: string; name: string; start: string; clientId: string; channel: string }>; emails: { total: number; recent: Array<{ to: string; subject: string; at: string }> } };

const CACHE_MS = 15 * 60_000;
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

export function DashboardHub({ scopeClientId, clients, tasks, staff, onNavigate, onAddTask, onOpenTask, adsPanel }: { adsPanel?: ReactNode; scopeClientId: string; clients: HubClient[]; tasks: HubTask[]; staff: HubStaff[]; onNavigate: (page: string) => void; onAddTask: () => void; onOpenTask?: (id: string) => void }) {
  const [pickedClient, setPickedClient] = useState(() => { try { return localStorage.getItem("f2b-dash-client") || ""; } catch { return ""; } });
  // Agency view defaults to all clients' Google Ads; a client can be picked for their full results.
  const clientId = scopeClientId || (clients.some((c) => c.id === pickedClient) ? pickedClient : (clients.find((c) => c.googleAdsAccountId) || clients[0])?.id || "");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAi, setShowAi] = useState(() => { try { return localStorage.getItem("f2b-dash-ai") !== "0"; } catch { return true; } });

  useEffect(() => {
    const key = `f2b-dash-metrics-v2:${clientId}`;
    try { const cached = JSON.parse(sessionStorage.getItem(key) || "null") as { at: number; data: Metrics } | null; if (cached && Date.now() - cached.at < CACHE_MS) { setMetrics(cached.data); return; } } catch { /* no cache */ }
    let live = true; setLoading(true);
    fetch(`/api/dashboard-metrics?clientId=${encodeURIComponent(clientId)}`).then((r) => r.ok ? r.json() as Promise<Metrics> : null).then((data) => { if (!live || !data) return; setMetrics(data); try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch { /* full */ } }).catch(() => undefined).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [clientId]);

  const bots = useMemo(() => new Set(staff.filter((s) => s.isBot).map((s) => s.id)), [staff]);
  const inScope = (t: HubTask) => !scopeClientId || t.clientId === scopeClientId;
  const upcoming = useMemo(() => tasks.filter((t) => inScope(t) && !/^done$/i.test(t.status) && (showAi || !bots.has(t.assigneeId))).sort((a, b) => (a.dueAt || a.due || "9999").localeCompare(b.dueAt || b.due || "9999")).slice(0, 6), [tasks, showAi, bots, scopeClientId]); // eslint-disable-line react-hooks/exhaustive-deps
  const completed = useMemo(() => tasks.filter((t) => inScope(t) && /^done$/i.test(t.status) && t.completedAt).sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || "")).slice(0, 6), [tasks, scopeClientId]); // eslint-disable-line react-hooks/exhaustive-deps
  const clientOf = (id: string) => clients.find((c) => c.id === id);
  const logo = (id: string) => { const c = clientOf(id); return c?.logo ? <img className="dh-logo" src={c.logo} alt="" /> : <span className="dh-logo dh-logo-fallback">{(c?.name || "•").slice(0, 1)}</span>; };
  const m = metrics?.marketing;
  const cur = m?.currency || "EUR";

  const actions: Array<{ label: string; hint: string; icon: ReactNode; run: () => void; tint: string }> = [
    { label: "New task", hint: "Add work for the team", icon: <Plus size={18} />, run: onAddTask, tint: "blue" },
    { label: "View leads", hint: "Pipeline & contacts", icon: <Users size={18} />, run: () => onNavigate("CRM"), tint: "violet" },
    { label: "Conversations", hint: "Texts, WhatsApp, email", icon: <MessageSquare size={18} />, run: () => onNavigate("Conversations"), tint: "teal" },
    { label: "New appointment", hint: "Book a call or visit", icon: <CalendarPlus size={18} />, run: () => onNavigate("Scheduling"), tint: "amber" },
    { label: "Upload media", hint: "Job photos & videos", icon: <ImageIcon size={18} />, run: () => onNavigate("Media Library"), tint: "pink" },
    { label: "Open books", hint: "Income & expenses", icon: <BookOpen size={18} />, run: () => onNavigate("Bookkeeping"), tint: "green" },
  ];

  return <div className="dh">
    <section className="dh-actions" aria-label="Quick actions">{actions.map((a) => <button type="button" key={a.label} className={`dh-action ${a.tint}`} onClick={a.run}><span className="dh-action-icon">{a.icon}</span><span><b>{a.label}</b><small>{a.hint}</small></span></button>)}</section>

    {adsPanel}
    <section className="panel dh-panel" aria-label="Website and marketing results">
      <div className="dh-head"><div><p className="eyebrow">📈 MARKETING · LAST 30 DAYS</p><h2>Website & search results</h2></div>
        {!scopeClientId && clients.length > 0 && <label className="dh-client"><span>Client</span><select value={clientId} onChange={(e) => { setPickedClient(e.target.value); try { localStorage.setItem("f2b-dash-client", e.target.value); } catch { /* ignore */ } }}>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      </div>
      {loading && !m ? <p className="dh-muted">Loading results…</p> : !m ? <p className="dh-muted">Results appear here once a client is chosen and you can view reports.</p> : <>
        {(() => { const sp = m.split; const v = (x: number | null | undefined) => x == null ? "—" : num(x);
          const Row = ({ icon, label, value, good }: { icon: ReactNode; label: string; value: string; good?: boolean }) => <div className={`dh-split-row ${good ? "good" : ""}`}><span className="dh-split-ico">{icon}</span><span>{label}</span><b>{value}</b></div>;
          return <div className="dh-split">
            <div className="dh-split-col"><div className="dh-split-head"><BrandIcon id="google" size={20} fallback={null} /><b>Organic</b><small>Google search & Maps (free)</small></div>
              <Row icon={<MousePointerClick size={15} />} label={sp?.organic.clicks != null ? "Search clicks" : "Website visits"} value={v(sp?.organic.clicks ?? sp?.organic.visits)} good={(sp?.organic.clicks ?? sp?.organic.visits ?? 0) > 0} />
              <Row icon={<Phone size={15} />} label="Calls (Business Profile)" value={v(sp?.organic.calls)} good={(sp?.organic.calls || 0) > 0} />
              <Row icon={<BrandIcon id="business-profile" size={15} fallback={<MousePointerClick size={15} />} />} label="Profile website clicks" value={v(m.profileClicks?.value)} good={(m.profileClicks?.value || 0) > 0} />
              <Row icon={<UserPlus size={15} />} label="Leads" value={v(sp?.organic.leads)} good={(sp?.organic.leads || 0) > 0} />
              {sp?.notes.organic && <em className="dh-split-note">{sp.notes.organic}</em>}
            </div>
            <div className="dh-split-col"><div className="dh-split-head"><BrandIcon id="google-ads" size={20} fallback={null} /><b>Google Ads</b><small>Paid search</small></div>
              <Row icon={<MousePointerClick size={15} />} label="Ad clicks" value={v(sp?.paid.clicks)} good={(sp?.paid.clicks || 0) > 0} />
              <Row icon={<Phone size={15} />} label={sp?.paid.callConversions ? "Calls from ads (call conversions)" : "Calls from ads"} value={v(sp?.paid.calls ?? sp?.paid.callConversions)} good={(sp?.paid.calls || 0) > 0} />
              <Row icon={<CheckCircle2 size={15} />} label="Conversions" value={v(sp?.paid.conversions)} good={(sp?.paid.conversions || 0) > 0} />
              <Row icon={<UserPlus size={15} />} label="Leads in CRM" value={v(sp?.paid.leads)} good={(sp?.paid.leads || 0) > 0} />
              {sp?.notes.paid && <em className="dh-split-note">{sp.notes.paid}</em>}
            </div>
            <div className="dh-split-total"><UserPlus size={16} /><span>All leads · 30 days</span><b>{v(m.leads?.value)}</b>{sp?.otherLeads ? <small>{sp.otherLeads} from other or unknown sources</small> : null}</div>
          </div>; })()}
        {m.scope !== "all" && <><h3 className="dh-sub">Where you show up</h3>
        <div className="dh-ranks">
          <div className="dh-rank"><div className="dh-rank-logos"><BrandIcon id="google" size={24} fallback={<span>G</span>} /><span className="dh-rank-also" title="Chrome and Safari use Google search"><BrandIcon id="chrome" size={14} fallback={null} /><BrandIcon id="safari" size={14} fallback={null} /></span></div><small>Google · Chrome & Safari</small><b>{m.google?.position != null ? `#${m.google.position}` : "—"}</b>{m.google ? <em>avg of {m.google.tracked} keywords · {m.google.top3} in top 3 <Delta now={m.google.position} before={m.google.previous} lowerIsBetter suffix="" /></em> : <em>{m.rankNote || "Not tracked yet"}</em>}</div>
          <div className="dh-rank"><div className="dh-rank-logos"><BrandIcon id="bing" size={24} fallback={<span>b</span>} /><span className="dh-rank-also" title="Microsoft Edge uses Bing search"><BrandIcon id="edge" size={14} fallback={null} /></span></div><small>Bing · Microsoft Edge</small><b>—</b><em>{m.bingNote}</em></div>
          <div className="dh-rank"><div className="dh-rank-logos"><BrandIcon id="chatgpt" size={24} fallback={<Sparkles size={18} />} /></div><small>ChatGPT</small><b>{m.chatgpt ? `${Math.round(m.chatgpt.share)}%` : "—"}</b>{m.chatgpt ? <em>mentioned in {m.chatgpt.mentioned} of {m.chatgpt.prompts} questions <Delta now={m.chatgpt.share} before={m.chatgpt.previous} suffix=" pts" /></em> : <em>{m.aiNote || "No AI check yet"}</em>}</div>
        </div></>}
      </>}
    </section>

    <div className="dh-grid">
      <section className="panel dh-panel"><div className="dh-head"><div><p className="eyebrow">📅 SCHEDULED</p><h2>Appointments</h2></div><button type="button" className="text-button" onClick={() => onNavigate("Scheduling")}>Open</button></div>
        {metrics?.appointments?.length ? <ul className="dh-list">{metrics.appointments.map((a) => <li key={a.id}>{logo(a.clientId)}<span><b>{a.name || "Appointment"}</b><small>{when(a.start)}{a.channel ? ` · ${a.channel}` : ""}</small></span></li>)}</ul> : <p className="dh-muted">{loading ? "Loading…" : "Nothing booked in the next 3 weeks."}</p>}
      </section>
      <section className="panel dh-panel"><div className="dh-head"><div><p className="eyebrow"><ClipboardList size={12} /> COMING UP</p><h2>Upcoming tasks</h2></div><label className={`task-ai-toggle ${showAi ? "is-on" : ""}`} title="Include tasks the AI is handling"><input type="checkbox" role="switch" checked={showAi} onChange={(e) => { setShowAi(e.target.checked); try { localStorage.setItem("f2b-dash-ai", e.target.checked ? "1" : "0"); } catch { /* ignore */ } }} /><span className="task-ai-toggle-track" aria-hidden="true"><span className="task-ai-toggle-thumb" /></span><b>AI tasks</b></label></div>
        {upcoming.length ? <ul className="dh-list">{upcoming.map((t) => <li key={t.id} onClick={() => onOpenTask?.(t.id)} className={onOpenTask ? "clickable" : ""}>{logo(t.clientId)}<span><b>{t.title}</b><small>{when(t.dueAt || t.due) || "No due date"}{bots.has(t.assigneeId) ? " · 🤖 AI" : ""}</small></span></li>)}</ul> : <p className="dh-muted">You’re all caught up.</p>}
      </section>
      <section className="panel dh-panel"><div className="dh-head"><div><p className="eyebrow"><CheckCircle2 size={12} /> DONE</p><h2>Recently completed</h2></div><button type="button" className="text-button" onClick={() => onNavigate("Tasks")}>All tasks</button></div>
        {completed.length ? <ul className="dh-list">{completed.map((t) => <li key={t.id}>{logo(t.clientId)}<span><b>{t.title}</b><small className="good">✓ {when(t.completedAt)}</small></span></li>)}</ul> : <p className="dh-muted">Nothing finished yet.</p>}
      </section>
      <section className="panel dh-panel"><div className="dh-head"><div><p className="eyebrow"><Mail size={12} /> LAST 30 DAYS</p><h2>Emails sent · {metrics ? num(metrics.emails.total) : "…"}</h2></div><button type="button" className="text-button" onClick={() => onNavigate("Conversations")}>Open</button></div>
        {metrics?.emails.recent.length ? <ul className="dh-list">{metrics.emails.recent.map((e, i) => <li key={i}><span className="dh-logo dh-logo-fallback"><Mail size={13} /></span><span><b>{e.subject || "(no subject)"}</b><small>{e.to} · {when(e.at)}</small></span></li>)}</ul> : <p className="dh-muted">{loading ? "Loading…" : "No emails sent yet."}</p>}
      </section>
    </div>
  </div>;
}
