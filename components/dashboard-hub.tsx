"use client";
import { useSampleData } from "@/hooks/use-sample-data";
import { useAppointmentUpdates } from "@/components/appointment-updates";
import { useEffect, useMemo, useState, type ReactNode, lazy, Suspense } from "react";
import { BarChart3, BookOpen, CalendarCheck, CalendarPlus, CheckCircle2, ClipboardList, Workflow, Image as ImageIcon, Mail, MessageSquare, MousePointerClick, Phone, Sparkles, TrendingUp, UserPlus, Users } from "lucide-react";
import { BrandIcon } from "./brand-icon";

// ROAS and close rate, graded only when there's enough data to judge fairly.
export type SalesStats = { leads: number; won: number; wonValue: number; adsLeads: number; adsWon: number; adsWonValue: number; periodLabel: string };
type Grade = "good" | "ok" | "low" | "na";
function roasGrade(wonValue: number, spend: number | null, leads: number): { value: string; grade: Grade; tip: string } {
  if (!spend || spend <= 0) return { value: "—", grade: "na", tip: "" };
  const roas = wonValue / spend;
  const value = `${roas.toFixed(roas >= 10 ? 0 : 1)}×`;
  if (spend < 200 && leads < 10) return { value, grade: "na", tip: "" }; // too early to judge
  if (roas >= 4) return { value, grade: "good", tip: "" };
  if (roas >= 2) return { value, grade: "ok", tip: "" };
  return { value, grade: "low", tip: roas === 0 ? "No won revenue is linked to ad leads yet. Mark won deals in the pipeline (with their value) so ad results show up, then check the search terms and landing page if deals still aren't closing." : `Every €1 on ads is bringing back €${roas.toFixed(2)} in won work. Check search terms for wasted spend, tighten locations and keywords, and follow up ad leads faster.` };
}
function closeGrade(won: number, leads: number): { value: string; grade: Grade; tip: string } {
  if (!leads) return { value: "—", grade: "na", tip: "" };
  const pct = Math.round((won / leads) * 100);
  const value = `${pct}%`;
  if (leads < 10) return { value, grade: "na", tip: "" }; // too few leads to judge
  if (pct >= 25) return { value, grade: "good", tip: "" };
  if (pct >= 15) return { value, grade: "ok", tip: "" };
  return { value, grade: "low", tip: `Only ${won} of ${leads} leads became won jobs. Reply to new leads within the hour, follow up quotes after 2 and 7 days, and check that won deals are being marked as Won in the pipeline.` };
}
function GradeTip({ tip }: { tip: string }) {
  return <details className="dh-grade-tip"><summary>Room for improvement</summary><p role="note">{tip}</p></details>;
}
function GradedRow({ icon, label, value, grade, tip, detail }: { icon: ReactNode; label: string; value: string; grade: Grade; tip: string; detail: string }) {
  return <div className={`dh-split-row dh-graded dh-grade-${grade}`} title={detail}><span className="dh-split-ico">{icon}</span><span>{label}{grade === "low" && <GradeTip tip={tip} />}</span><b>{value}</b></div>;
}
const AppointmentsDashboard = lazy(() => import("./scheduling-view").then((module) => ({ default: module.AppointmentsDashboard })));
import { CampaignPicker } from "./campaign-picker";

type HubTask = { id: string; clientId: string; title: string; status: string; assigneeId: string; due?: string; dueAt?: string; completedAt?: string; service?: string; reviewStatus?: string; reviewApproverId?: string; aiRunState?: string; aiApprovals?: Array<{ status: string }> };
type HubClient = { id: string; name: string; logo?: string; googleAdsAccountId?: string; appointmentBased?: boolean };
type HubStaff = { id: string; name: string; isBot?: boolean };
type Stat = { value: number; previous: number | null } | null;
type Marketing = {
  currency: string; visits: (Stat & { metric?: string }) | null; visitsNote: string; adSpend: Stat; adClicks: Stat; impressions?: Stat; conversions?: Stat; cpc?: Stat; costPerConversion?: Stat; adsNote: string; businessProfile?: { views: number | null; calls: number | null; directions: number | null; websiteClicks: number | null; previous: { impressions: number | null; calls: number | null; directions: number | null; websiteClicks: number | null } | null } | null; trustpilot?: { status: string; rating?: number | null; total?: number | null; url?: string }; split?: Split; gsc?: Gsc | null; googleCampaigns?: Array<{ id: string; name: string; status: string; spend: number; clicks: number; impressions: number; conversions: number }>; meta?: { spend: number; impressions: number; clicks: number; leads: number; cpc: number | null; costPerLead: number | null; accounts: number; linkedAccounts: number; campaigns?: Array<{ id: string; name: string; status: string; spend: number; clicks: number; impressions: number; leads: number }> } | null; metaNote?: string; scope?: string; accounts?: number; linkedAccounts?: number; calls: Stat; profileClicks: Stat; businessNote: string; leads: Stat;
  google: { position: number | null; previous: number | null; tracked: number; top3: number; keywords?: Array<{ keyword: string; position: number | null; previous: number | null; volume: number | null }> } | null; rankNote: string;
  chatgpt: { share: number; previous: number | null; prompts: number; mentioned: number; questions?: Array<{ prompt: string; mentioned: boolean; position: number | null; competitors: string[]; at?: string }> } | null; aiNote: string; bing: null; bingNote: string; adsDetail?: AdsDetail | null;
};
type Gsc = { error?: string; property?: string; clicks?: number; previousClicks?: number | null; impressions?: number; position?: number | null; previousPosition?: number | null; queriesTracked?: number; pages?: Array<{ page: string; url?: string; clicks: number; impressions: number; position: number | null }>; queries?: Array<{ query: string; clicks: number; impressions: number; position: number | null }>; trending?: Array<{ query: string; impressions: number; change: number }> };
type AdsDetail = { error?: string; landingPages: Array<{ campaignId: string; url: string; clicks: number; impressions: number; spend: number; conversions: number }>; keywords: Array<{ campaignId: string; keyword: string; matchType: string; clicks: number; impressions: number; spend: number; conversions: number; qualityScore: number | null }> };
type Split = { organic: { clicks: number | null; visits: number | null; calls: number | null; leads: number | null }; paid: { clicks: number | null; calls: number | null; callConversions: number | null; leads: number | null; conversions: number | null }; otherLeads: number | null; notes: { organic: string; paid: string } };
type Metrics = { clientId: string; marketing: Marketing | null; appointments: Array<{ id: string; name: string; start: string; end?: string; status?: string; clientId: string; channel: string; calendar?: string; staff?: string }>; emails: { total: number; failed?: number; delivered?: number; people?: number; replies?: number; last?: string; configured?: boolean; recent: Array<{ to: string; subject: string; at: string; failed?: boolean }> } };

const CACHE_MS = 15 * 60_000;
// Demo figures for the agency dashboard's "Sample data" toggle (never saved anywhere).
const SAMPLE: Metrics = {
  clientId: "sample",
  marketing: { currency: "EUR", visits: { value: 1840, previous: 1510, metric: "Organic sessions" }, visitsNote: "", adSpend: { value: 1364, previous: 1290 }, adClicks: { value: 742, previous: 655 }, adsNote: "", calls: { value: 38, previous: 29 }, profileClicks: { value: 126, previous: 98 }, businessNote: "", leads: { value: 47, previous: null },
    split: { organic: { clicks: 912, visits: 1840, calls: 38, leads: 21 }, paid: { clicks: 742, calls: 17, callConversions: 17, leads: 19, conversions: 71 }, otherLeads: 7, notes: { organic: "", paid: "" } },
    google: { position: 4.2, previous: 5.8, tracked: 24, top3: 9, keywords: [["roofers galway", 2, 3, 590], ["roof repairs galway", 1, 2, 320], ["emergency roofer near me", 3, 6, 880], ["flat roof repair", 5, 7, 260], ["chimney repair galway", 4, 4, 140], ["gutter cleaning galway", 6, 9, 210], ["slate roof repair", 8, 11, 90], ["roof replacement cost ireland", 12, 15, 480]].map(([keyword, position, previous, volume]) => ({ keyword: String(keyword), position: Number(position), previous: Number(previous), volume: Number(volume) })) }, rankNote: "", chatgpt: { share: 42, previous: 30, prompts: 12, mentioned: 5, questions: [
      { prompt: "Who are the best roofers in Galway?", mentioned: true, position: 1, competitors: ["Western Roofing", "Atlantic Roofs"] },
      { prompt: "Recommend a reliable roof repair company near Oranmore", mentioned: true, position: 2, competitors: ["Corrib Roofing"] },
      { prompt: "Emergency roofer in Galway this weekend", mentioned: false, position: null, competitors: ["Atlantic Roofs", "RoofFix Ireland"] },
      { prompt: "How much does a new roof cost in Galway?", mentioned: false, position: null, competitors: ["Western Roofing"] },
      { prompt: "Best company for flat roof repairs in the west of Ireland", mentioned: true, position: 3, competitors: ["Corrib Roofing", "Atlantic Roofs"] },
    ] }, aiNote: "", bing: null, bingNote: "Sample: Bing tracking not set up" },
  appointments: [{ id: "s1", name: "Mary Walsh", calendar: "Kitchen survey", start: new Date(new Date().setHours(10, 0, 0, 0)).toISOString(), end: new Date(new Date().setHours(11, 0, 0, 0)).toISOString(), status: "confirmed", clientId: "", channel: "On site", staff: "Pat" }, { id: "s2", name: "John Byrne", calendar: "Roof quote", start: new Date(new Date().setHours(11, 30, 0, 0)).toISOString(), status: "confirmed", clientId: "", channel: "Phone", staff: "Mick" }, { id: "s3", name: "Aoife Kelly", calendar: "Consultation", start: new Date(new Date().setHours(14, 30, 0, 0)).toISOString(), status: "pending", clientId: "", channel: "Google Meet", staff: "Sean" }, { id: "s4", name: "Daniel Brooks", calendar: "Site visit", start: new Date(new Date().setHours(16, 0, 0, 0)).toISOString(), status: "confirmed", clientId: "", channel: "On site", staff: "Pat" }],
  emails: { total: 64, failed: 1, delivered: 63, people: 41, replies: 12, configured: true, recent: [{ to: "Mary Walsh", subject: "Your quote is ready", at: new Date(Date.now() - 2 * 3600_000).toISOString() }, { to: "John Byrne", subject: "Booking confirmed for Thursday", at: new Date(Date.now() - 20 * 3600_000).toISOString() }, { to: "Aoife Kelly", subject: "Invoice INV-0012", at: new Date(Date.now() - 44 * 3600_000).toISOString() }] },
};
// Sample Google Business Profile figures (views, calls, directions, website clicks) for the "Sample data" toggle.
const SAMPLE_GBP = { views: 3120, calls: 46, directions: 81, websiteClicks: 132, previous: { impressions: 2710, calls: 38, directions: 69, websiteClicks: 117 } } as unknown as NonNullable<NonNullable<Metrics["marketing"]>["businessProfile"]>;
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

// Small chevron buttons at the foot of a results card; each opens its list below the cards.
type DetailKey = "" | "org-pages" | "org-kw" | "org-trend" | "ads-pages" | "ads-kw";
function DetailToggles({ value, onChange, items }: { value: DetailKey; onChange: (v: DetailKey) => void; items: Array<[Exclude<DetailKey, "">, string]> }) {
  return <div className="dh-detail-toggles">{items.map(([k, label]) => <button type="button" key={k} className={`dh-detail-btn ${value === k ? "open" : ""}`} aria-expanded={value === k} onClick={() => onChange(value === k ? "" : k)}><span>{value === k ? "▲" : "▼"}</span>{label}</button>)}</div>;
}
// Demo landing pages and keywords for the "Sample data" toggle, built from the sample tracked keywords.
function sampleDetail(m: Marketing): { gsc: Gsc | null; ads: AdsDetail } {
  const kws = m.google?.keywords || [];
  const slug = (t: string) => "/" + t.toLowerCase().replace(/\b(near me|galway|cork|dublin|ireland|cost)\b/g, "").trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const pages = [{ page: "/", clicks: 388, impressions: 9100, position: 3.1 }, ...kws.slice(0, 6).map((k, i) => ({ page: slug(k.keyword) || "/services", clicks: Math.max(12, 160 - i * 24), impressions: Math.max(400, 4200 - i * 520), position: k.position }))];
  const seen = new Set<string>(); const uniq = pages.filter((p) => !seen.has(p.page) && seen.add(p.page));
  const site = "https://example.ie";
  return {
    gsc: { pages: uniq.map((p) => ({ ...p, url: site + p.page })), queries: kws.map((k, i) => ({ query: k.keyword, clicks: Math.max(4, 120 - i * 14), impressions: k.volume ? k.volume * 3 : 600, position: k.position })), trending: kws.slice(0, 4).map((k, i) => ({ query: k.keyword, impressions: k.volume ? k.volume * 3 : 600, change: 140 - i * 30 })) } as Gsc,
    ads: {
      landingPages: uniq.slice(0, 5).map((p, i) => ({ campaignId: "", url: site + p.page, clicks: [312, 188, 121, 76, 45][i], impressions: [4100, 2600, 1800, 1100, 700][i], spend: [560, 351, 238, 132, 83][i], conversions: [31, 19, 12, 6, 3][i] })),
      keywords: kws.slice(0, 8).map((k, i) => ({ campaignId: "", keyword: k.keyword, matchType: i % 3 === 0 ? "EXACT" : "PHRASE", clicks: [168, 141, 112, 88, 71, 64, 52, 46][i], impressions: [1900, 1500, 1300, 1000, 820, 760, 610, 540][i], spend: [302, 251, 207, 168, 129, 118, 101, 88][i], conversions: [17, 14, 11, 8, 7, 6, 5, 3][i], qualityScore: [8, 7, 9, 6, 7, 5, 6, 4][i] })),
    },
  };
}

export function DashboardHub({ isAdmin = false, salesStats = null, activityPanel = null, scopeClientId, clients, tasks, staff, onNavigate, onAddTask, onOpenTask, onReviewTask, currentStaffId = "", adsPanel, valuePanel, periodStart = "", periodEnd = "", periodLabel = "Last 30 days", focusClientId = "" }: { isAdmin?: boolean; salesStats?: SalesStats | null; activityPanel?: ReactNode; focusClientId?: string; periodStart?: string; periodEnd?: string; periodLabel?: string; adsPanel?: ReactNode; valuePanel?: ReactNode; scopeClientId: string; clients: HubClient[]; tasks: HubTask[]; staff: HubStaff[]; onNavigate: (page: string) => void; onAddTask: () => void; onOpenTask?: (id: string) => void; onReviewTask?: (id: string, action: "approve" | "request_changes") => void; currentStaffId?: string }) {
  const [pickedClient, setPickedClient] = useState(() => { try { return localStorage.getItem("f2b-dash-client") || ""; } catch { return ""; } });
  // Agency view defaults to all clients' Google Ads; a client can be picked for their full results.
  const clientId = scopeClientId || (clients.some((c) => c.id === focusClientId) ? focusClientId : (clients.find((c) => c.googleAdsAccountId) || clients[0])?.id || ""); void pickedClient; void setPickedClient;
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [apprOpen, setApprOpen] = useState<"" | "ai" | "human">("");
  const [rankOpen, setRankOpen] = useState<"" | "google" | "chatgpt">("");
  // Drop-down under the Organic / Google Ads cards: landing pages (URLs) and keywords.
  const [detail, setDetail] = useState<DetailKey>("");
  const [mSrc, setMSrc] = useState<"organic" | "ads" | "meta">("organic"); // phones: one marketing source at a time
  const [sample] = useSampleData();
  // Won deals from the CRM (sample figures when Sample is on).
  const sales: SalesStats | null = sample ? { leads: 47, won: 12, wonValue: 18400, adsLeads: 19, adsWon: 5, adsWonValue: 7600, periodLabel: "sample" } : salesStats;
  const [apptRange, setApptRange] = useState<"today" | "tomorrow" | "week" | "all" | "date">("today");
  const [apptDate, setApptDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [gReviews, setGReviews] = useState<{ total: number | null; averageRating: number | null } | null>(null);
  useEffect(() => { setGReviews(null); if (!clientId) return; let live = true; fetch(`/api/local-seo?clientId=${encodeURIComponent(clientId)}&range=last_30d`).then((r) => r.ok ? r.json() : null).then((j: { reviews?: { total: number | null; averageRating: number | null } } | null) => { if (live && j?.reviews) setGReviews({ total: j.reviews.total, averageRating: j.reviews.averageRating }); }).catch(() => undefined); return () => { live = false; }; }, [clientId]);
  const [gCamp, setGCamp] = useState("");
  const [mCamp, setMCamp] = useState("");
  useEffect(() => { setGCamp(""); setMCamp(""); setDetail(""); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [showAi, setShowAi] = useState(() => { try { return localStorage.getItem("f2b-dash-ai") !== "0"; } catch { return true; } });

  useEffect(() => {
    const key = `f2b-dash-metrics-v6:${clientId}:${periodStart}:${periodEnd}`;
    try { const cached = JSON.parse(sessionStorage.getItem(key) || "null") as { at: number; data: Metrics } | null; if (cached && Date.now() - cached.at < CACHE_MS) { setMetrics(cached.data); return; } } catch { /* no cache */ }
    let live = true; setLoading(true);
    fetch(`/api/dashboard-metrics?clientId=${encodeURIComponent(clientId)}&start=${periodStart}&end=${periodEnd}`).then((r) => r.ok ? r.json() as Promise<Metrics> : null).then((data) => { if (!live || !data) return; setMetrics(data); try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch { /* full */ } }).catch(() => undefined).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [clientId, periodStart, periodEnd]);

  const bots = useMemo(() => new Set(staff.filter((s) => s.isBot).map((s) => s.id)), [staff]);
  // All accounts selected: Marketing is per client, so it waits for a client pick (never shows a random one).
  const marketingPicked = Boolean(scopeClientId) || sample || clients.some((c) => c.id === focusClientId);
  const inScope = (t: HubTask) => !scopeClientId || t.clientId === scopeClientId;
  const upcoming = useMemo(() => tasks.filter((t) => inScope(t) && !/^done$/i.test(t.status) && (showAi || !bots.has(t.assigneeId))).sort((a, b) => (a.dueAt || a.due || "9999").localeCompare(b.dueAt || b.due || "9999")).slice(0, 6), [tasks, showAi, bots, scopeClientId]); // eslint-disable-line react-hooks/exhaustive-deps
  const completed = useMemo(() => tasks.filter((t) => inScope(t) && /^done$/i.test(t.status) && t.completedAt).sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || "")).slice(0, 6), [tasks, scopeClientId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Approvals waiting on the signed-in person (the owner sees everything unassigned too).
  const mineFor = (t: HubTask, approver?: string) => !currentStaffId || approver === currentStaffId || (!approver && t.assigneeId === currentStaffId);
  const aiList = tasks.filter((t) => inScope(t) && ((t.aiApprovals || []).some((a) => a.status === "pending") || t.aiRunState === "needs_review"));
  const humanList = tasks.filter((t) => inScope(t) && t.reviewStatus === "submitted");
  const aiPending = aiList.length, humanPending = humanList.length;
  const aiMine = aiList.filter((t) => mineFor(t)), humanMine = humanList.filter((t) => mineFor(t, t.reviewApproverId));
  const OVERLOAD = 5;
  const tone = (mine: number) => mine >= OVERLOAD ? "overload" : mine > 0 ? "waiting" : "clear";
  const clientOf = (id: string) => clients.find((c) => c.id === id);
  const logo = (id: string) => { const c = clientOf(id); return c?.logo ? <img className="dh-logo" src={c.logo} alt="" /> : <span className="dh-logo dh-logo-fallback">{(c?.name || "•").slice(0, 1)}</span>; };
  // Sample keywords / ChatGPT questions follow this account's own services and town (from its website when known).
  const [siteSample, setSiteSample] = useState<{ services: string[]; locations: string[] } | null>(null);
  useEffect(() => {
    if (!sample || !scopeClientId) { setSiteSample(null); return; }
    let live = true;
    fetch(`/api/scheduling?clientId=${encodeURIComponent(scopeClientId)}&view=site`).then((r) => r.ok ? r.json() : null).then((v: { services?: string[]; locations?: string[] } | null) => { if (live && v) setSiteSample({ services: v.services || [], locations: v.locations || [] }); }).catch(() => undefined);
    return () => { live = false; };
  }, [sample, scopeClientId]);
  const view = sample ? sampleFor(SAMPLE, clients.find((c) => c.id === scopeClientId)?.name || "", siteSample) : metrics;
  const m = view?.marketing;
  const cur = m?.currency || "EUR";

  const showAppts = !scopeClientId || clients.find((c) => c.id === scopeClientId)?.appointmentBased !== false;
  const appt = useAppointmentUpdates({ scopeClientId, sample, enabled: showAppts, onOpenScheduling: () => onNavigate("Scheduling") });
  const actions: Array<{ label: string; hint: string; icon: ReactNode; run: () => void; tint: string }> = [
    ...(!scopeClientId ? [{ label: "Operations", hint: "Tasks, ads, SEO, websites", icon: <Workflow size={18} />, run: () => onNavigate("Operations"), tint: "violet" }] : []),
    { label: "View leads", hint: "Pipeline & contacts", icon: <Users size={18} />, run: () => onNavigate("CRM"), tint: "violet" },
    { label: "Conversations", hint: "Texts, WhatsApp, email", icon: <MessageSquare size={18} />, run: () => onNavigate("Conversations"), tint: "teal" },
    ...(showAppts ? [{ label: "New appointment", hint: "Book a call or visit", icon: <CalendarPlus size={18} />, run: () => onNavigate("Scheduling"), tint: "amber" }] : []),
    { label: "Upload media", hint: "Job photos & videos", icon: <ImageIcon size={18} />, run: () => onNavigate("Media Library"), tint: "pink" },
    { label: "Open books", hint: "Income & expenses", icon: <BookOpen size={18} />, run: () => onNavigate("Bookkeeping"), tint: "green" },
  ];

  return <div className="dh">
    {sample && <div className="dh-sample-banner">Showing sample figures for demos — turn off “Sample” in the top bar for your real numbers.</div>}
    <section className="dh-actions" aria-label="Quick actions">{actions.map((a) => <button type="button" key={a.label} className={`dh-action ${a.tint}`} onClick={a.run}><span className="dh-action-icon">{a.icon}</span><span><b>{a.label}</b><small>{a.hint}</small></span></button>)}</section>

    <section className="dh-approvals" aria-label="Pending approvals">
      {[{ key: "ai" as const, label: "AI approvals", n: aiPending, mine: aiMine.length, icon: <Sparkles size={18} />, hint: "Changes the AI wants you to approve" }, { key: "human" as const, label: "Team approvals", n: humanPending, mine: humanMine.length, icon: <Users size={18} />, hint: "Work your team submitted for review" }].map((a) => { const t = tone(a.mine); return <button type="button" key={a.key} className={`dh-approval ${t} ${apprOpen === a.key ? "open" : ""}`} aria-expanded={apprOpen === a.key} onClick={() => { setApprOpen(apprOpen === a.key ? "" : a.key); appt.setOpen(false); }}><span className="dh-approval-icon">{a.icon}</span><span className="dh-approval-text"><b>{a.label}</b><small>{t === "overload" ? `${a.mine} waiting on you — catch up` : a.mine ? `${a.mine} waiting on you` : a.n ? `${a.n} with others · nothing for you` : "All done"}</small></span><span className="dh-approval-n">{a.mine || (a.n ? a.n : "✓")}</span></button>; })}
      {appt.card(() => setApprOpen(""))}
    </section>
    {apprOpen && (() => { const list = apprOpen === "ai" ? aiList : humanList; const who = (id?: string) => staff.find((p) => p.id === id)?.name || ""; return <section className="dh-appr-list" aria-label="Approvals">
      <div className="dh-appr-list-head"><b>{apprOpen === "ai" ? "AI approvals" : "Team approvals"}</b><button type="button" className="text-button" onClick={() => setApprOpen("")}>Close</button></div>
      {list.length ? list.map((t) => { const mine = mineFor(t, apprOpen === "human" ? t.reviewApproverId : undefined); return <div key={t.id} className={`dh-appr-item ${mine ? "mine" : ""}`}><span className="dh-appr-dot" /><span className="dh-appr-main"><b>{t.title}</b><small>{apprOpen === "human" ? `Submitted by ${who(t.assigneeId) || "the team"}${t.reviewApproverId ? ` · approver ${who(t.reviewApproverId)}` : ""}` : `${who(t.assigneeId) || "AI"} · ${t.service || "Task"}`}{mine ? " · needs you" : ""}</small></span>
        <span className="dh-appr-acts">{apprOpen === "human" && onReviewTask && mine && <><button type="button" className="dh-appr-ok" onClick={() => onReviewTask(t.id, "approve")}>Approve</button><button type="button" className="dh-appr-no" onClick={() => onReviewTask(t.id, "request_changes")}>Changes</button></>}{onOpenTask && <button type="button" className="dh-appr-open" onClick={() => onOpenTask(t.id)}>Open</button>}</span></div>; })
        : <p className="dh-muted">Nothing waiting. 🎉</p>}
    </section>; })()}
    {appt.list}
    {showAppts && <Suspense fallback={null}><AppointmentsDashboard key={scopeClientId || "agency"} showStaffHours scopeClientId={scopeClientId} sample={sample} clientName={clients.find((c) => c.id === scopeClientId)?.name || ""} periodStart={periodStart} periodEnd={periodEnd} periodLabel={periodLabel} onOpen={() => onNavigate("Scheduling")} /></Suspense>}
    {/* Admin-only money & marketing sections (tagged ADMIN) */}
    {isAdmin && valuePanel}
    {isAdmin && <section className="panel dh-panel" aria-label="Website and marketing results" data-admin="">
      <div className="dh-head"><div><p className="eyebrow">📈 {periodLabel.toUpperCase()}</p><h2>Marketing</h2></div>
        {!scopeClientId && marketingPicked && <span className="dh-client-note">{clients.find((c) => c.id === clientId)?.name}</span>}
      </div>
      {!marketingPicked ? <p className="dh-muted">Marketing results are per client — pick a client in the top bar to see theirs.</p> : loading && !m ? <><p className="dh-muted">Loading results…</p></> : !m ? <></> : <>
        {(() => { const sp = m.split; const v = (x: number | null | undefined) => x == null ? "—" : num(x);
          const Row = ({ icon, label, value, good }: { icon: ReactNode; label: string; value: string; good?: boolean }) => <div className={`dh-split-row ${good ? "good" : ""}`}><span className="dh-split-ico">{icon}</span><span>{label}</span><b>{value}</b></div>;
          return <><div className="dh-msrc" role="tablist" aria-label="Marketing source">{([["organic", "Organic"], ["ads", "Google Ads"], ["meta", "Meta"]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={mSrc === k} className={mSrc === k ? "on" : ""} onClick={() => { setMSrc(k); setDetail(""); }}>{l}</button>)}</div>
          <div className={`dh-split m-src-${mSrc}`}>
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
              <DetailToggles value={detail} onChange={setDetail} items={[["org-pages", "Landing pages"], ["org-kw", "Keywords"], ["org-trend", "Trending"]]} />
            </div>
            {(() => { const camps = m.googleCampaigns || []; const c = camps.find((x) => x.id === gCamp); const spend = c ? c.spend : m.adSpend?.value; const clicks = c ? c.clicks : sp?.paid.clicks; const conv = c ? c.conversions : sp?.paid.conversions;
              return <div className="dh-split-col"><div className="dh-split-head"><BrandIcon id="google-ads" size={20} fallback={null} /><b>Google Ads</b>{camps.length > 0 && <div className="dh-camp-wrap"><CampaignPicker label="Google Ads campaign" currency={cur} value={gCamp} onChange={setGCamp} options={camps.map((x) => ({ value: x.id, name: x.name, logo: clientOf(clientId)?.logo, spend: x.spend, status: x.status }))} /></div>}</div>
                <div className="dh-split-row expense"><span className="dh-split-ico"><span className="dh-cur">€</span></span><span>Spend</span><b>{spend != null ? money(spend, cur) : "—"}</b></div>
                <Row icon={<MousePointerClick size={15} />} label="Ad clicks" value={v(clicks)} good={(clicks || 0) > 0} />
                <Row icon={<span className="dh-cur">€</span>} label="Avg. CPC" value={spend != null && clicks ? money2(spend / clicks, cur) : "—"} />
                <Row icon={<CheckCircle2 size={15} />} label="Conversions" value={v(conv)} good={(conv || 0) > 0} />
                {!c && <Row icon={<Phone size={15} />} label="Calls from ads" value={v(sp?.paid.calls ?? sp?.paid.callConversions)} good={(sp?.paid.calls || 0) > 0} />}
                {!c && <Row icon={<UserPlus size={15} />} label="Leads in CRM" value={v(sp?.paid.leads)} good={(sp?.paid.leads || 0) > 0} />}
                {!c && sales && (() => { const r = roasGrade(sales.adsWonValue, spend ?? null, sales.adsLeads); return <GradedRow icon={<TrendingUp size={15} />} label="Return on ad spend" value={r.value} grade={r.grade} tip={r.tip} detail={spend ? `${money(sales.adsWonValue, cur)} won from ${money(spend, cur)} spend` : "No spend yet"} />; })()}
                {!c && sales && (() => { const r = closeGrade(sales.adsWon, sales.adsLeads); return <GradedRow icon={<CheckCircle2 size={15} />} label="Ads close rate" value={r.value} grade={r.grade} tip={r.tip} detail={`${sales.adsWon} won of ${sales.adsLeads} leads`} />; })()}
                {sp?.notes.paid && <em className="dh-split-note">{sp.notes.paid}</em>}
                <DetailToggles value={detail} onChange={setDetail} items={[["ads-pages", "Landing pages"], ["ads-kw", "Keywords"]]} />
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
            <div className="dh-split-total"><UserPlus size={16} /><span>All leads · 30 days</span><b>{v(m.leads?.value)}</b>{sp?.otherLeads ? <small>{sp.otherLeads} from other or unknown sources</small> : null}
              {sales && (() => { const r = closeGrade(sales.won, sales.leads); return <span className={`dh-close dh-grade-${r.grade}`} title={`${sales.won} won of ${sales.leads} leads (${sales.periodLabel})`}><span>Close rate</span><b>{r.value}</b>{r.grade === "low" && <GradeTip tip={r.tip} />}</span>; })()}
            </div>
          </div></>; })()}
        {detail && (() => {
          const d: { gsc: Gsc | null; ads: AdsDetail | null } = sample ? sampleDetail(m) : { gsc: m.gsc && !m.gsc.error ? m.gsc : null, ads: m.adsDetail || null };
          const camp = (m.googleCampaigns || []).find((x) => x.id === gCamp);
          const ads: AdsDetail | null = d.ads;
          const adPages = (ads?.landingPages || []).filter((r) => !gCamp || r.campaignId === gCamp);
          const adKws = (ads?.keywords || []).filter((r) => !gCamp || r.campaignId === gCamp);
          const pathOf = (u: string) => { try { const x = new URL(u); return { path: (x.pathname + x.search) || "/", host: x.hostname.replace(/^www\./, "") }; } catch { return { path: u || "/", host: "" }; } };
          const Link = ({ url, path }: { url?: string; path: string }) => url && /^https?:/.test(url) ? <a className="dh-rank-term dh-link" href={url} target="_blank" rel="noreferrer" title={url} onClick={(e) => e.stopPropagation()}>{path}</a> : <span className="dh-rank-term" title={path}>{path}</span>;
          const close = <button type="button" className="text-button" onClick={() => setDetail("")}>Close</button>;
          const empty = (t: string) => <p className="dh-muted">{t}</p>;
          if (detail === "org-pages") { const rows = d.gsc?.pages || []; return <div className="dh-rank-drop dh-detail"><div className="dh-rank-drop-head"><b>Organic landing pages</b><span><small>From Search Console · clicks</small>{close}</span></div>
            {rows.length ? rows.map((p) => <div key={p.page} className="dh-rank-row dh-detail-row"><span className={`dh-pos ${p.position == null ? "" : p.position <= 3 ? "top" : p.position <= 10 ? "mid" : "low"}`}>{p.position != null ? `#${p.position}` : "—"}</span><Link url={p.url} path={p.page} /><b>{num(p.clicks)} clicks</b><small>{num(p.impressions)} seen</small></div>) : empty(m.gsc?.error || "No landing pages from Google yet. Connect Search Console in Operations → Launchpad.")}</div>; }
          if (detail === "org-kw") { const rows = d.gsc?.queries?.length ? d.gsc.queries.map((q) => ({ term: q.query, pos: q.position, extra: `${num(q.clicks)} clicks`, sub: `${num(q.impressions)} seen` })) : (m.google?.keywords || []).map((k) => ({ term: k.keyword, pos: k.position, extra: k.volume != null ? `${num(k.volume)}/mo` : "", sub: "tracked" }));
            return <div className="dh-rank-drop dh-detail"><div className="dh-rank-drop-head"><b>Organic keywords</b><span><small>{d.gsc?.queries?.length ? "Searches people used to find the site" : "Tracked keywords"}</small>{close}</span></div>
            {rows.length ? rows.map((r) => <div key={r.term} className="dh-rank-row dh-detail-row"><span className={`dh-pos ${r.pos == null ? "" : r.pos <= 3 ? "top" : r.pos <= 10 ? "mid" : "low"}`}>{r.pos != null ? `#${Math.round(r.pos * 10) / 10}` : "—"}</span><span className="dh-rank-term">{r.term}</span><b>{r.extra}</b><small>{r.sub}</small></div>) : empty("No organic keywords yet. Connect Search Console or add keywords in Operations → SEO.")}</div>; }
          if (detail === "org-trend") { const rows = d.gsc?.trending || []; return <div className="dh-rank-drop dh-detail"><div className="dh-rank-drop-head"><b>Trending searches</b><span><small>Growing vs the previous period</small>{close}</span></div>
            {rows.length ? rows.map((q) => <div key={q.query} className="dh-rank-row dh-detail-row"><span className="dh-pos top">▲</span><span className="dh-rank-term">{q.query}</span><b className="good">+{num(q.change)}</b><small>{num(q.impressions)} seen</small></div>) : empty("No rising searches vs the previous period.")}</div>; }
          const scopeNote = camp ? camp.name : "All campaigns";
          if (detail === "ads-pages") { const rows = adPages; const merged = [...rows.reduce((map, r) => { const g = map.get(r.url) || { ...r, clicks: 0, impressions: 0, spend: 0, conversions: 0 }; g.clicks += r.clicks; g.impressions += r.impressions; g.spend += r.spend; g.conversions += r.conversions; map.set(r.url, g); return map; }, new Map<string, AdsDetail["landingPages"][number]>()).values()].sort((a, b) => b.clicks - a.clicks);
            return <div className="dh-rank-drop dh-detail"><div className="dh-rank-drop-head"><b>Ad landing pages</b><span><small>{scopeNote}</small>{close}</span></div>
            {merged.length ? merged.map((r) => { const u = pathOf(r.url); return <div key={r.url} className="dh-rank-row dh-detail-row"><span className={`dh-pos ${r.conversions > 0 ? "top" : "mid"}`}>{r.conversions > 0 ? `${num(r.conversions)} conv` : "0 conv"}</span><Link url={r.url} path={u.path} /><b>{num(r.clicks)} clicks</b><small>{money(r.spend, cur)}{r.clicks ? ` · ${money2(r.spend / r.clicks, cur)} CPC` : ""}{u.host ? ` · ${u.host}` : ""}</small></div>; }) : empty(d.ads?.error || (m.adsDetail === undefined && !sample ? "Link a Google Ads account to this client to see landing pages." : "No landing page clicks in this period."))}</div>; }
          if (detail === "ads-kw") { const rows = adKws.slice().sort((a, b) => b.clicks - a.clicks || b.spend - a.spend);
            return <div className="dh-rank-drop dh-detail"><div className="dh-rank-drop-head"><b>Ad keywords</b><span><small>{scopeNote}</small>{close}</span></div>
            {rows.length ? rows.map((k, i) => <div key={`${k.keyword}-${k.matchType}-${i}`} className="dh-rank-row dh-detail-row"><span className={`dh-pos ${k.qualityScore == null ? "" : k.qualityScore >= 7 ? "top" : k.qualityScore >= 5 ? "mid" : "low"}`} title="Quality score">{k.qualityScore != null ? `QS ${k.qualityScore}` : "—"}</span><span className="dh-rank-term">{k.keyword}<em className="dh-match">{k.matchType.toLowerCase()}</em></span><b>{num(k.clicks)} clicks</b><small>{money(k.spend, cur)} · {num(k.conversions)} conv</small></div>) : empty(d.ads?.error || "No keywords with impressions in this period.")}</div>; }
          return null;
        })()}
        {(() => { const bp = sample ? SAMPLE_GBP : m.businessProfile; const tp = sample ? { status: "ok", rating: 4.8, total: 63 } as typeof m.trustpilot : m.trustpilot; const gR = sample ? { total: 214, averageRating: 4.9 } : gReviews; return <>
          <h3 className="dh-sub">Reviews &amp; Google Business</h3>
          <div className="dh-reviews">
            <div className="dh-review"><BrandIcon id="business-profile" size={22} fallback={null} /><span><b>{gR?.averageRating != null ? `${gR.averageRating.toFixed(1)} ★` : "—"}</b><small>{gR?.total != null ? `${num(gR.total)} Google reviews` : "Google reviews · connect Business Profile"}</small></span></div>
            <div className="dh-review"><BrandIcon id="facebook" size={22} fallback={null} /><span><b>{sample ? "4.7 ★" : "—"}</b><small>{sample ? "88 Facebook reviews" : "Facebook reviews · connect the Facebook Page"}</small></span></div>
            <div className="dh-review"><BrandIcon id="trustpilot" size={22} fallback={null} /><span><b>{tp?.status === "ok" && tp.rating != null ? `${tp.rating.toFixed(1)} ★` : "—"}</b><small>{tp?.status === "ok" ? `${num(tp.total || 0)} Trustpilot reviews` : tp?.status === "not_found" ? "Not on Trustpilot yet" : tp?.status === "no_website" ? "Trustpilot · add the website" : "Trustpilot"}</small></span></div>
          </div>
          <div className="dh-tiles dh-gbp">
            <Tile icon={<BrandIcon id="business-profile" size={20} fallback={null} />} label="Profile views" value={bp?.views != null ? num(bp.views) : "—"}><Delta now={bp?.views} before={bp?.previous?.impressions} /></Tile>
            <Tile icon={<Phone size={18} />} label="Calls" value={bp?.calls != null ? num(bp.calls) : "—"} tone={(bp?.calls || 0) > 0 ? "good" : ""}><Delta now={bp?.calls} before={bp?.previous?.calls} /></Tile>
            <Tile icon={<span>🧭</span>} label="Directions" value={bp?.directions != null ? num(bp.directions) : "—"}><Delta now={bp?.directions} before={bp?.previous?.directions} /></Tile>
            <Tile icon={<MousePointerClick size={18} />} label="Website clicks" value={bp?.websiteClicks != null ? num(bp.websiteClicks) : "—"}><Delta now={bp?.websiteClicks} before={bp?.previous?.websiteClicks} /></Tile>
          </div>
          {!bp && <p className="dh-muted">{m.businessNote || "Connect this client’s Google Business Profile to see views, calls and directions."}</p>}
        </>; })()}
        {m.scope !== "all" && <><h3 className="dh-sub">Where you show up</h3>
        <div className="dh-ranks">
          <div className={`dh-rank dh-rank-click ${rankOpen === "google" ? "open" : ""}`} role="button" tabIndex={0} aria-expanded={rankOpen === "google"} onClick={() => setRankOpen(rankOpen === "google" ? "" : "google")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setRankOpen(rankOpen === "google" ? "" : "google"); } }}><span className="dh-rank-chev">{rankOpen === "google" ? "▲" : "▼"} Keywords</span><div className="dh-rank-logos"><BrandIcon id="google" size={24} fallback={<span>G</span>} /><span className="dh-rank-also" title="Chrome and Safari use Google search"><BrandIcon id="chrome" size={14} fallback={null} /><BrandIcon id="safari" size={14} fallback={null} /></span></div><small>Google · Chrome & Safari</small>{m.google ? <><b>{m.google.position != null ? `#${m.google.position}` : "—"}</b><em>avg of {m.google.tracked} keywords · {m.google.top3} in top 3 <Delta now={m.google.position} before={m.google.previous} lowerIsBetter suffix="" /></em></> : m.gsc && !m.gsc.error && m.gsc.position != null ? <><b>#{m.gsc.position}</b><em>avg position across {num(m.gsc.queriesTracked || 0)} searches (Search Console) <Delta now={m.gsc.position} before={m.gsc.previousPosition} lowerIsBetter suffix="" /></em></> : <><b>—</b><em>{m.gsc?.error || m.rankNote || "Not tracked yet"}</em></>}</div>
          <div className="dh-rank"><div className="dh-rank-logos"><BrandIcon id="bing" size={24} fallback={<span>b</span>} /><span className="dh-rank-also" title="Microsoft Edge uses Bing search"><BrandIcon id="edge" size={14} fallback={null} /></span></div><small>Bing · Microsoft Edge</small><b>—</b><em>{m.bingNote}</em></div>
          <div className={`dh-rank dh-rank-click ${rankOpen === "chatgpt" ? "open" : ""}`} role="button" tabIndex={0} aria-expanded={rankOpen === "chatgpt"} onClick={() => setRankOpen(rankOpen === "chatgpt" ? "" : "chatgpt")} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setRankOpen(rankOpen === "chatgpt" ? "" : "chatgpt"); } }}><span className="dh-rank-chev">{rankOpen === "chatgpt" ? "▲" : "▼"} Questions</span><div className="dh-rank-logos"><BrandIcon id="chatgpt" size={24} fallback={<Sparkles size={18} />} /></div><small>ChatGPT</small><b>{m.chatgpt ? `${Math.round(m.chatgpt.share)}%` : "—"}</b>{m.chatgpt ? <em>mentioned in {m.chatgpt.mentioned} of {m.chatgpt.prompts} questions <Delta now={m.chatgpt.share} before={m.chatgpt.previous} suffix=" pts" /></em> : <em>{m.aiNote || "No AI check yet"}</em>}</div>
        </div>
        {rankOpen === "google" && (() => {
          const rows = m.google?.keywords?.length ? m.google.keywords.map((k) => ({ term: k.keyword, pos: k.position, prev: k.previous, extra: k.volume != null ? `${num(k.volume)}/mo` : "" }))
            : (m.gsc?.queries || []).map((q) => ({ term: q.query, pos: q.position, prev: null as number | null, extra: `${num(q.clicks)} clicks` }));
          return <div className="dh-rank-drop"><div className="dh-rank-drop-head"><b>Google keywords</b><small>{m.google?.keywords?.length ? "Daily rank checks" : rows.length ? "From Search Console" : ""}</small></div>
            {rows.length ? rows.map((r) => { const ch = r.pos != null && r.prev != null ? r.prev - r.pos : null; return <div key={r.term} className="dh-rank-row"><span className={`dh-pos ${r.pos == null ? "" : r.pos <= 3 ? "top" : r.pos <= 10 ? "mid" : "low"}`}>{r.pos != null ? `#${Math.round(r.pos * 10) / 10}` : "—"}</span><span className="dh-rank-term">{r.term}</span>{ch ? <b className={ch > 0 ? "good" : "bad"}>{ch > 0 ? "▲" : "▼"} {Math.abs(Math.round(ch * 10) / 10)}</b> : <b className="flat">–</b>}<small>{r.extra}</small></div>; })
              : <p className="dh-muted">No keywords tracked yet. Add keywords in Operations → SEO to see each position here.</p>}
          </div>; })()}
        {rankOpen === "chatgpt" && <div className="dh-rank-drop"><div className="dh-rank-drop-head"><b>ChatGPT questions</b><small>Latest answer for each question</small></div>
          {m.chatgpt?.questions?.length ? m.chatgpt.questions.map((q) => <div key={q.prompt} className="dh-rank-row ai"><span className={`dh-pos ${q.mentioned ? "top" : "low"}`}>{q.mentioned ? (q.position ? `#${q.position}` : "✓") : "✗"}</span><span className="dh-rank-term">{q.prompt}</span><b className={q.mentioned ? "good" : "bad"}>{q.mentioned ? "Mentioned" : "Not mentioned"}</b><small>{q.competitors.length ? `Also named: ${q.competitors.join(", ")}` : ""}</small></div>)
            : <p className="dh-muted">No ChatGPT checks yet. Run one in Operations → AI visibility.</p>}
        </div>}
        </>}
      </>}
    </section>}

    {isAdmin && adsPanel && <div className="dh-ads-wrap">{adsPanel}</div>}
    {isAdmin && activityPanel}
    {isAdmin && <div className="dh-grid">

      <section className="panel dh-panel dh-email" data-admin=""><div className="dh-head"><div><p className="eyebrow"><Mail size={12} /> {periodLabel.toUpperCase()}</p><h2>Emails &amp; health</h2></div><button type="button" className="text-button" onClick={() => onNavigate("Conversations")}>Open inbox →</button></div>
        {(() => { const e = view?.emails; if (!e) return <p className="dh-muted">{loading ? "Loading…" : "No emails yet."}</p>; const rate = e.total ? Math.round(((e.delivered ?? e.total) / e.total) * 100) : null; const tone = rate == null ? "" : rate >= 98 ? "good" : rate >= 90 ? "warn" : "bad"; return <>
          {(() => { const deliv = e.total ? ((e.delivered ?? e.total) / e.total) * 100 : null; const bounce = e.total ? ((e.failed || 0) / e.total) * 100 : null; const reply = e.people ? Math.min(100, ((e.replies || 0) / e.people) * 100) : null;
            const score = e.total ? Math.max(0, Math.min(100, Math.round((deliv ?? 0) * 0.7 + Math.min(30, (reply ?? 0) * 1.5) - (bounce ?? 0) * 2 + (e.configured === false ? -20 : 0)))) : null;
            const label = score == null ? "No data" : score >= 80 ? "Excellent" : score >= 60 ? "Good" : score >= 40 ? "Fair" : "Poor";
            const R = 70, C = Math.PI * R, pct = (score ?? 0) / 100;
            const row = (icon: ReactNode, name: string, value: string, good: boolean | null, rec: string) => <div className="dh-eh-row"><span className="dh-eh-ico">{icon}</span><span>{name}</span><b className={good == null ? "" : good ? "good" : "bad"}>{value}</b><small>{rec}</small></div>;
            return <div className="dh-eh">
              <div className="dh-eh-gauge"><svg viewBox="0 0 180 104" width="180" height="104" aria-hidden="true"><path d="M20 94 A70 70 0 0 1 160 94" fill="none" stroke="rgba(127,138,160,.2)" strokeWidth="12" strokeLinecap="round" /><path d="M20 94 A70 70 0 0 1 160 94" fill="none" stroke="var(--brand-primary, #1f6feb)" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${pct * C} ${C}`} /></svg><b>{score ?? "—"}</b><small>Deliverability score</small><span className={`dh-eh-badge ${score == null ? "" : score >= 60 ? "good" : "bad"}`}>{label}</span></div>
              <div className="dh-eh-table"><div className="dh-eh-row head"><span /><span>Metric</span><b>Health</b><small>Recommended</small></div>
                {row(<Mail size={14} />, "Deliveries", deliv == null ? "—" : `${deliv.toFixed(1)}%`, deliv == null ? null : deliv >= 98, "98%+")}
                {row(<span>↩</span>, "Bounce / failed", bounce == null ? "—" : `${bounce.toFixed(1)}%`, bounce == null ? null : bounce <= 2, "under 2%")}
                {row(<MessageSquare size={14} />, "Reply rate", reply == null ? "—" : `${reply.toFixed(1)}%`, reply == null ? null : reply >= 5, "5%+")}
                {row(<span>👁</span>, "Open rate", "Not tracked", null, "turn on open tracking")}
                {row(<MousePointerClick size={14} />, "Click rate", "Not tracked", null, "turn on click tracking")}
                {row(<span>⚙</span>, "Sending setup", e.configured === false ? "Not set up" : "Healthy", e.configured !== false, "domain verified")}
              </div>
            </div>; })()}
          {e.recent.length ? <ul className="dh-list dh-email-list">{e.recent.map((m, i) => <li key={i}><span className={`dh-logo dh-logo-fallback ${m.failed ? "is-bad" : ""}`}>{m.failed ? "!" : <Mail size={13} />}</span><span><b>{m.subject || "(no subject)"}</b><small>{m.to} · {when(m.at)}{m.failed ? " · failed" : ""}</small></span></li>)}</ul> : <p className="dh-muted">No emails sent in this period.</p>}
        </>; })()}
      </section>
    </div>}
  </div>;
}

// Make the demo search terms and AI questions match the account (tattoo studio in Cork, roofer in Galway…).
function sampleFor(base: Metrics, clientName: string, site: { services: string[]; locations: string[] } | null): Metrics {
  if (!base.marketing) return base;
  const n = clientName.toLowerCase();
  const trade = /tattoo|ink|poppy|piercing/.test(n) ? "tattoo" : /roof/.test(n) ? "roofer" : /hair|salon|beauty|mua|lash|brow/.test(n) ? "beauty" : /plumb|heat/.test(n) ? "plumber" : /electric/.test(n) ? "electrician" : /handy|maint|property/.test(n) ? "handyman" : /interior|kitchen|design/.test(n) ? "interiors" : "business";
  const defaults: Record<string, string[]> = { tattoo: ["Tattoo studio", "Fine line tattoo", "Cover up tattoo", "Piercing", "Black and grey tattoo"], roofer: ["Roofers", "Roof repairs", "Flat roof repair", "Chimney repair", "Gutter cleaning"], beauty: ["Makeup artist", "Bridal makeup", "Lash extensions", "Brow lamination", "Beauty salon"], plumber: ["Plumber", "Boiler service", "Emergency plumber", "Heating repair", "Bathroom fitting"], electrician: ["Electrician", "Fuse board upgrade", "EV charger install", "Emergency electrician", "Lighting install"], handyman: ["Handyman", "Property maintenance", "Painting and decorating", "Odd jobs", "Gutter cleaning"], interiors: ["Interior designer", "Kitchen design", "Home renovation", "Bathroom design", "Fitted wardrobes"], business: ["Local services", "Consultation", "Quote", "Best rated", "Near me"] };
  const services = (site?.services.length ? site.services : defaults[trade]).map((x) => x.replace(/\s+(tattoos?|designs?)$/i, (m) => m).toLowerCase()).slice(0, 5);
  const town = (site?.locations.find((l) => !/quarter|street|road/i.test(l)) || (/cork|poppy/.test(n) ? "Cork" : /galway|roof/.test(n) ? "Galway" : /birmingham|apex/.test(n) ? "Birmingham" : "Dublin")).trim();
  const t = town.toLowerCase();
  const rows: Array<[string, number, number, number]> = [
    [`${services[0]} ${t}`, 2, 3, 720], [`best ${trade === "business" ? services[0] : trade} ${t}`, 1, 2, 390], [`${services[1] || services[0]} near me`, 3, 6, 880], [`${services[2] || services[0]} ${t}`, 5, 7, 260],
    [`${services[3] || services[0]} ${t}`, 4, 4, 140], [`${services[4] || services[1] || services[0]} near me`, 6, 9, 210], [`${services[1] || services[0]} prices ${t}`, 8, 11, 90], [`${services[0]} open now`, 12, 15, 480],
  ];
  const keywords = rows.map(([keyword, position, previous, volume]) => ({ keyword, position, previous, volume }));
  const label = trade === "business" ? services[0] : trade === "tattoo" ? "tattoo studio" : trade;
  const questions = [
    { prompt: `Who is the best ${label} in ${town}?`, mentioned: true, position: 1, competitors: [] as string[] },
    { prompt: `Recommend a ${services[1] || label} near ${town}`, mentioned: true, position: 2, competitors: [] },
    { prompt: `Where can I get ${services[2] || services[0]} in ${town} this weekend?`, mentioned: false, position: null, competitors: [] },
    { prompt: `How much does ${services[0]} cost in ${town}?`, mentioned: false, position: null, competitors: [] },
    { prompt: `Most trusted ${label} in ${town} with good reviews`, mentioned: true, position: 3, competitors: [] },
  ];
  return { ...base, marketing: { ...base.marketing, google: base.marketing.google ? { ...base.marketing.google, keywords } : null, chatgpt: base.marketing.chatgpt ? { ...base.marketing.chatgpt, questions } : null } };
}
