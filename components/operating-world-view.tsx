"use client";

// Operating World — the CRM as a living miniature business.
// The game is only an interface: every real action happens inside the EXISTING CRM screens and task
// cards, which open here as in-game panels. Coins come from the server, which credits them from real
// completed records (idempotent). The owner taps the coins over each employee to collect them.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Bot, Coins, Gauge, History, Mic, Pause, Play, Send, Settings2, Sparkles, Volume2, VolumeX, Wand2, X, Zap, CalendarDays, Copy, Check, Loader2, Eye, EyeOff, Hammer, Lock, ChevronRight } from "lucide-react";
import { EMPLOYEES, EMPLOYEE_FOR_REWARD, REWARDS, UPGRADES, allClearLine, briefing, levelFromXp, nextUpgrade, reactionLine, rewardWalkthrough, stageForLevel, upgradeTier, type Approach, type BriefingOption, type EmployeeId, type OwSnapshot, type PanelKind, type RewardKind, type UpgradeTrack, type WalkStep } from "@/lib/operating-world/engine";
import "./operating-world.css";

type Outfit = { hat: string; tool: string; outfit: string; label: string };
type Profile = { name: string; logo: string; primary: string; secondary: string; industry: string; industryGuessed: boolean; industryLabel: string; outfit: Outfit; characterName: string; website: string };
type Pending = { key: string; kind: string; coins: number; xp: number; label: string };
type Wallet = { coins: number; xp: number; level: number; xpIntoLevel: number; xpForNext: number; progress: number; stage: { name: string; floors: number; next: { level: number; name: string } | null }; owned: string[]; pending: Pending[]; recentRewards: Array<{ reward_key: string; kind: RewardKind; coins: number; label: string; created_at: string; collected_at?: string }>; actions: Array<{ id: string; actor: string; action: string; reason: string; records: string[]; status: string; created_at: string }> };
type Customer = { id: string; title: string; name: string; createdAt: string; stage: string; email?: string; phone?: string; nextStageId?: string; nextStage?: string; value: number; currency: string };
type WorldData = {
  scopeId: string; state: { mode: "manual" | "copilot" | "autopilot"; autopilotPaused: boolean; startedAt: string }; profile: Profile; wallet: Wallet;
  freshRewards: Array<{ key: string; kind: RewardKind; coins: number; xp: number; label: string }>; approaches: Approach[];
  health: { score: number; mood: string; issues: string[] }; finance: { paidThisMonth: Record<string, number>; outstanding: Record<string, number>; overdueCount: number };
  sources: Record<string, boolean>; customers: Customer[]; counts: { leads: number; unread: number; bookingsUpcoming: number; openTasks: number };
  upcoming: Array<{ id: string; name: string; startAt: string }>; shop: UpgradeTrack[]; industries: Array<{ id: string; label: string }>; aiReady: boolean;
};
type Toast = { id: number; employee: EmployeeId; text: string; coins: number };
export type OperatingWorldPanelRenderer = (kind: PanelKind, options: { focusId?: string; onDone: () => void }) => ReactNode;

const api = async (path: string, init?: RequestInit) => {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const data = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status}).`);
  return data;
};
const readPref = (key: string, fallback: string) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const writePref = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };
const readSession = (key: string) => { try { return sessionStorage.getItem(key); } catch { return null; } };
const writeSession = (key: string, value: string) => { try { sessionStorage.setItem(key, value); } catch { /* private mode */ } };
const money = (by: Record<string, number>) => Object.keys(by).length ? Object.entries(by).map(([c, v]) => new Intl.NumberFormat("en-IE", { style: "currency", currency: c }).format(v)).join(" + ") : "—";
const PANEL_TITLES: Record<PanelKind, string> = { leads: "Pipeline", contacts: "Contacts", conversations: "Conversations", scheduling: "Scheduling", invoicing: "Invoicing", books: "Books", expense: "Record a receipt", tasks: "Tasks", task: "New task", "lead-replies": "AI-prepared replies", "lead-detail": "Lead" };
const sumCoins = (list: Pending[]) => list.reduce((n, p) => n + p.coins, 0);

// ───────────── Sound (tiny synthesised chimes) ─────────────
function chime(kind: "coin" | "level" | "pop" | "shower") {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext; if (!AC) return;
    const ctx = new AC();
    const notes = kind === "level" ? [523, 659, 784, 1046] : kind === "shower" ? [988, 1319, 1175, 1568, 1319, 1760] : kind === "coin" ? [988, 1319] : [660];
    const gap = kind === "shower" ? 0.07 : 0.09;
    notes.forEach((f, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "triangle"; o.frequency.value = f; const t = ctx.currentTime + i * gap; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.11, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25); o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.3); });
    setTimeout(() => ctx.close(), 1600);
  } catch { /* audio blocked until the first tap */ }
}

// ───────────── Characters (original SVG art) ─────────────
function Person({ x, y, body, skin = "#f2c9a0", hat = "none", tool = "none", outfit = "casual", trim, scale = 1, mood, label, className = "" }: { x: number; y: number; body: string; skin?: string; hat?: string; tool?: string; outfit?: string; trim?: string; scale?: number; mood?: string; label?: string; className?: string }) {
  const s = scale;
  // Position lives on the outer group; animations target the inner group so CSS transforms never override placement.
  return <g className={`ow-person ${className}`} transform={`translate(${x} ${y}) scale(${s})`} aria-label={label}><g className="ow-person-body">
    <ellipse cx="0" cy="34" rx="14" ry="4" fill="rgba(0,0,0,.18)" />
    <rect x="-8" y="16" width="6" height="16" rx="3" fill="#2b3442" /><rect x="2" y="16" width="6" height="16" rx="3" fill="#2b3442" />
    <rect x="-12" y="-6" width="24" height="26" rx="9" fill={outfit === "scrubs" ? "#5ec4c4" : body} />
    {outfit === "hivis" && <><rect x="-12" y="2" width="24" height="3.5" fill="#fff9" /><rect x="-12" y="10" width="24" height="3.5" fill="#fff9" /></>}
    {outfit === "overalls" && <><rect x="-7" y="-4" width="2.5" height="12" fill="#0003" /><rect x="4.5" y="-4" width="2.5" height="12" fill="#0003" /><rect x="-8" y="6" width="16" height="12" rx="3" fill="#0002" /></>}
    {outfit === "apron" && <rect x="-8" y="2" width="16" height="18" rx="4" fill="#1f2937cc" />}
    {outfit === "smart" && <path d="M-3 -6 L0 4 L3 -6 Z" fill={trim || "#fff"} />}
    {trim && outfit !== "smart" && <rect x="-12" y="17" width="24" height="3" fill={trim} />}
    <circle cx="0" cy="-16" r="11" fill={skin} />
    <circle cx="-4" cy="-17" r="1.6" fill="#1b1b1b" /><circle cx="4" cy="-17" r="1.6" fill="#1b1b1b" />
    {mood === "panicked" ? <ellipse cx="0" cy="-10" rx="3" ry="3.4" fill="#5b1f1f" /> : mood === "concerned" ? <path d="M-4 -10 q4 -3 8 0" stroke="#5b1f1f" strokeWidth="1.6" fill="none" /> : <path d="M-4 -11 q4 4 8 0" stroke="#5b1f1f" strokeWidth="1.6" fill="none" />}
    {hat === "hardhat" && <><path d="M-12 -21 a12 11 0 0 1 24 0 z" fill="#facc15" /><rect x="-14" y="-22" width="28" height="3.5" rx="1.5" fill="#eab308" /></>}
    {hat === "cap" && <><path d="M-11 -22 a11 9 0 0 1 22 0 z" fill={trim || body} /><rect x="2" y="-23" width="13" height="3" rx="1.5" fill={trim || body} /></>}
    {hat === "beanie" && <path d="M-11 -20 a11 11 0 0 1 22 0 z" fill="#111827" />}
    {tool === "hammer" && <g transform="translate(15 2) rotate(25)"><rect x="-1.5" y="-2" width="3" height="18" fill="#8b5a2b" /><rect x="-6" y="-5" width="12" height="5" rx="1" fill="#6b7280" /></g>}
    {tool === "drill" && <g transform="translate(14 4)"><rect x="0" y="-4" width="12" height="7" rx="2" fill="#f59e0b" /><rect x="2" y="3" width="4" height="9" rx="1" fill="#111827" /><rect x="12" y="-2" width="5" height="2" fill="#9ca3af" /></g>}
    {tool === "wrench" && <g transform="translate(16 2) rotate(30)"><rect x="-1.5" y="0" width="3" height="16" rx="1.5" fill="#9ca3af" /><circle cx="0" cy="-1" r="4" fill="none" stroke="#9ca3af" strokeWidth="3" /></g>}
    {tool === "tattoo" && <g transform="translate(15 4) rotate(-20)"><rect x="-2" y="-2" width="5" height="12" rx="2" fill="#374151" /><rect x="-0.5" y="10" width="1.5" height="5" fill="#d1d5db" /></g>}
    {tool === "mirror" && <g transform="translate(16 2) rotate(20)"><rect x="-1" y="0" width="2" height="14" fill="#d1d5db" /><circle cx="0" cy="-2" r="3" fill="#e0f2fe" stroke="#9ca3af" /></g>}
    {tool === "scissors" && <g transform="translate(16 4)"><circle cx="-2" cy="8" r="2.5" fill="none" stroke="#ef4444" strokeWidth="1.5" /><circle cx="3" cy="8" r="2.5" fill="none" stroke="#ef4444" strokeWidth="1.5" /><path d="M-1 6 L5 -4 M2 6 L-4 -4" stroke="#9ca3af" strokeWidth="1.5" /></g>}
    {tool === "swatch" && <g transform="translate(14 0)"><rect x="0" y="0" width="5" height="12" fill="#f87171" /><rect x="4" y="1" width="5" height="12" fill="#60a5fa" /><rect x="8" y="2" width="5" height="12" fill="#34d399" /></g>}
    {tool === "laptop" && <g transform="translate(10 6)"><rect x="0" y="0" width="14" height="9" rx="1" fill="#1f2937" /><rect x="-2" y="9" width="18" height="2" rx="1" fill="#6b7280" /></g>}
    {tool === "clipboard" && <g transform="translate(13 2)"><rect x="0" y="0" width="10" height="13" rx="1.5" fill="#f5deb3" /><rect x="3" y="-1.5" width="4" height="3" rx="1" fill="#6b7280" /></g>}
  </g></g>;
}

function Building({ floors, primary, secondary, name, logo, sign }: { floors: number; primary: string; secondary: string; name: string; logo: string; sign: number }) {
  // Ground floor (door + sign) is fixed; each Headquarters tier adds a floor of windows above it.
  const ground = 100, floorH = 44, h = ground + (floors - 1) * floorH + 30, top = 330 - h, w = 260 + Math.min(floors, 4) * 30, x = 500 - w / 2;
  const cols = Math.max(3, Math.floor((w - 30) / 56));
  return <g className="ow-building">
    <rect x={x + 10} y={top + 10} width={w} height={h} rx="10" fill="rgba(0,0,0,.12)" />
    <rect x={x} y={top} width={w} height={h} rx="10" fill="#f8f4ec" stroke="#d8cdb8" strokeWidth="2" />
    <path d={`M${x - 12} ${top} L500 ${top - 46} L${x + w + 12} ${top} Z`} fill={secondary} />
    {sign >= 2 && <g className="ow-neon"><rect x={500 - 80} y={top - 40} width="160" height="22" rx="6" fill="#111827" stroke={primary} strokeWidth="2" /><text x="500" y={top - 25} textAnchor="middle" fontSize="11" fontWeight="800" fill="#fff">{name.slice(0, 22).toUpperCase()}</text></g>}
    <rect x={x + 14} y={top + 12} width={w - 28} height="6" rx="3" fill={primary} opacity=".85" />
    {Array.from({ length: floors - 1 }).map((_, f) => <g key={f}>{Array.from({ length: cols }).map((__, i) => <rect key={i} x={x + 15 + i * ((w - 30) / cols) + ((w - 30) / cols - 34) / 2} y={330 - ground - (f + 1) * floorH + 6} width="34" height="26" rx="4" fill="#bfe3f5" stroke="#9cc6dc" />)}</g>)}
    <rect x={x + 22} y="282" width="44" height="30" rx="4" fill="#bfe3f5" stroke="#9cc6dc" /><rect x={x + w - 66} y="282" width="44" height="30" rx="4" fill="#bfe3f5" stroke="#9cc6dc" />
    <rect x="470" y="272" width="60" height="58" rx="6" fill={primary} /><circle cx="520" cy="302" r="3" fill="#fff" />
    <rect x={500 - 110} y="240" width="220" height="26" rx="8" fill={sign >= 1 ? "#111827" : secondary} stroke={sign >= 1 ? primary : "none"} strokeWidth="2.5" />
    {logo ? <image href={logo} x={500 - 104} y="243" width="20" height="20" preserveAspectRatio="xMidYMid meet" /> : null}
    <text x={logo ? 512 : 500} y="258" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff">{name.slice(0, 26)}</text>
  </g>;
}

function Workshop({ tier, primary, secondary }: { tier: number; primary: string; secondary: string }) {
  if (!tier) return null;
  if (tier === 1) return <g><rect x="150" y="285" width="70" height="45" rx="4" fill="#a16207" /><path d="M144 287 L185 262 L226 287 Z" fill="#78350f" /><rect x="175" y="302" width="20" height="28" fill="#451a03" /></g>;
  const w = tier === 2 ? 130 : 170, x = 250 - w;
  return <g><rect x={x} y={tier === 2 ? 262 : 240} width={w} height={tier === 2 ? 68 : 90} rx="6" fill="#e5e7eb" stroke="#cbd5e1" strokeWidth="2" /><rect x={x} y={tier === 2 ? 262 : 240} width={w} height="12" rx="6" fill={secondary} />
    <rect x={x + 14} y={tier === 2 ? 286 : 268} width={w - 28} height={tier === 2 ? 44 : 62} rx="3" fill="#9ca3af" />{Array.from({ length: tier === 2 ? 5 : 7 }).map((_, i) => <rect key={i} x={x + 14} y={(tier === 2 ? 290 : 272) + i * 8} width={w - 28} height="2" fill="#6b7280" />)}
    <text x={x + w / 2} y={tier === 2 ? 283 : 263} textAnchor="middle" fontSize="9" fontWeight="800" fill={primary}>{tier === 2 ? "WORKSHOP" : "WAREHOUSE"}</text></g>;
}

function Vehicle({ x, y, primary, name, big }: { x: number; y: number; primary: string; name: string; big?: boolean }) {
  const w = big ? 120 : 92;
  return <g transform={`translate(${x} ${y})`}><rect x="0" y="0" width={w} height="40" rx="8" fill={primary} /><rect x="6" y="6" width="28" height="16" rx="3" fill="#bfe3f5" /><text x={big ? 62 : 50} y="27" fontSize="9" fill="#fff" fontWeight="700">{name.slice(0, 12)}</text><circle cx="20" cy="42" r="9" fill="#1f2937" /><circle cx={w - 20} cy="42" r="9" fill="#1f2937" /></g>;
}

/** A tappable stack of coins floating over an employee — real rewards waiting to be collected. */
function CoinBubble({ x, y, amount, onCollect, label }: { x: number; y: number; amount: number; onCollect: () => void; label: string }) {
  return <g className="ow-coin-bubble" transform={`translate(${x} ${y})`} role="button" tabIndex={0} aria-label={label} onClick={onCollect} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onCollect(); } }}>
    <g className="ow-coin-bob"><circle r="17" fill="#fff" stroke="#f59e0b" strokeWidth="2.5" /><circle r="11" fill="#fbbf24" stroke="#d97706" strokeWidth="2" /><text y="4" textAnchor="middle" fontSize="11" fontWeight="900" fill="#78350f">★</text>
      <rect x="-20" y="18" width="40" height="15" rx="7.5" fill="#78350f" /><text y="29" textAnchor="middle" fontSize="10" fontWeight="800" fill="#fff">+{amount}</text></g>
  </g>;
}

// ───────────── Demo scenario (clearly labelled; never touches real data) ─────────────
function demoSnapshot(): OwSnapshot {
  const now = new Date(); const iso = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString(); const day = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();
  const lead = (id: string, name: string, h: number) => ({ id, title: "Driveway quotation", name, value: 0, currency: "EUR", stage: "New lead", stagePosition: 0, firstPosition: 0, category: "open" as const, createdAt: iso(h), updatedAt: iso(h) });
  return { now: now.toISOString(), leads: [lead("d1", "Sarah Kelly", 40), lead("d2", "James Byrne", 30), lead("d3", "Aoife Walsh", 5), lead("d4", "Liam Doyle", 3), lead("d5", "Niamh Ryan", 1)], threads: [], replies: [],
    invoices: [{ id: "di1", number: "INV-0042", clientName: "Murphy Builders", status: "draft", dueDate: day(14).slice(0, 10), sentAt: "", paidAt: "", total: 1250, currency: "EUR", createdAt: iso(2) }],
    bookings: [], tasks: [{ id: "dt1", title: "Upload completed driveway photos", status: "To do", priority: "High", due: now.toISOString().slice(0, 10), completedAt: "", createdAt: iso(20) }],
    expenses: [{ id: "de1", description: "Builders' merchant", amount: 86.4, date: now.toISOString().slice(0, 10), hasReceipt: false }], hasCalendars: true,
    sources: { crm: true, conversations: true, invoicing: true, scheduling: true, tasks: true, books: true } };
}
const DEMO_PENDING: Pending[] = [
  { key: "demo-ad", kind: "ad_spend_logged", coins: 10, xp: 10, label: "Ad spend logged in Books · Google Ads" },
  { key: "demo-c1", kind: "contact_added", coins: 5, xp: 5, label: "New contact added · Sarah Kelly" },
  { key: "demo-inv", kind: "invoice_paid", coins: 40, xp: 60, label: "Payment confirmed · INV-0039" },
];
type DemoState = { coins: number; xp: number; owned: string[]; pending: Pending[] };
const DEMO_START: DemoState = { coins: 650, xp: 880, owned: ["garden:1"], pending: DEMO_PENDING };

// ───────────── Main view ─────────────
export function OperatingWorldView({ scopeClientId, renderPanel, openNative, saving = false }: { scopeClientId: string; renderPanel: OperatingWorldPanelRenderer; openNative?: (kind: PanelKind) => boolean; saving?: boolean }) {
  const scope = scopeClientId || "agency";
  const [data, setData] = useState<WorldData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [panel, setPanelState] = useState<{ kind: PanelKind; focusId?: string } | null>(null);
  const [index, setIndex] = useState(0);
  const [snoozed, setSnoozed] = useState<Record<string, string>>(() => { try { return JSON.parse(readPref(`ow-snooze:${scope}`, "{}")); } catch { return {}; } });
  const [sound, setSound] = useState(() => readPref("ow-sound", "on") === "on");
  const [reduced, setReduced] = useState(() => readPref("ow-motion", "") === "reduced" || (typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [coinBurst, setCoinBurst] = useState(0);
  const [levelUp, setLevelUp] = useState("");
  const [drawer, setDrawer] = useState<"" | "upgrades" | "settings" | "history">("");
  const [command, setCommand] = useState("");
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandAnswer, setCommandAnswer] = useState("");
  const [listening, setListening] = useState(false);
  const [demo, setDemo] = useState(false);
  const [demoState, setDemoState] = useState<DemoState>(DEMO_START);
  const [walk, setWalk] = useState<{ steps: WalkStep[]; at: number } | null>(null);
  const [collecting, setCollecting] = useState(false);
  const lastLevel = useRef(0);
  const toastId = useRef(0);
  const prefs = useRef({ sound, reduced }); prefs.current = { sound, reduced }; // read in callbacks so toggling never triggers a reload

  // Some task cards are the app's own pop-ups (new expense with receipt upload, new task) — open those directly.
  const setPanel = (next: { kind: PanelKind; focusId?: string } | null) => { if (next && openNative?.(next.kind)) return; setPanelState(next); };

  const toast = useCallback((items: Array<{ employee: EmployeeId; text: string; coins: number }>) => {
    const next = items.slice(0, 4).map((t) => ({ ...t, id: ++toastId.current }));
    setToasts((all) => [...all, ...next].slice(-4));
    next.forEach((t) => setTimeout(() => setToasts((all) => all.filter((x) => x.id !== t.id)), prefs.current.reduced ? 2500 : 4200));
  }, []);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const next = await api(`/api/operating-world?clientId=${encodeURIComponent(scope)}`) as WorldData;
      setData(next); setError("");
      const seed = new Date().toISOString().slice(0, 13);
      // New rewards while the page is open: the employee shouts about it and coins appear over their head.
      if (lastLevel.current && next.freshRewards?.length) {
        toast(next.freshRewards.map((r) => ({ employee: EMPLOYEE_FOR_REWARD[r.kind] || "receptionist", text: `${reactionLine(r.kind, seed + r.key)} Tap the coins to collect.`, coins: r.coins })));
        if (prefs.current.sound) chime("pop");
      }
      // Logging on: a walkthrough of what the team earned and why (once per session per account).
      if (!lastLevel.current && next.wallet.pending.length && !readSession(`ow-walk:${scope}`)) {
        setWalk({ steps: rewardWalkthrough(next.wallet.pending, seed), at: 0 });
        writeSession(`ow-walk:${scope}`, "1");
        if (prefs.current.sound) chime("coin"); // browsers may hold this until the first tap
      }
      lastLevel.current = next.wallet.level;
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't load Operating World."); }
    finally { setLoading(false); }
  }, [scope, toast]);

  useEffect(() => { void load(); }, [load]);
  // Two-way sync: work done in the normal CRM screens shows up when the owner comes back to the tab.
  useEffect(() => { const onFocus = () => { if (!panel && !demo) void load(true); }; window.addEventListener("focus", onFocus); return () => window.removeEventListener("focus", onFocus); }, [load, panel, demo]);
  // When the app finishes saving (e.g. an expense or task added from its own pop-up), re-read so rewards and the briefing update.
  const wasSaving = useRef(saving);
  useEffect(() => { if (wasSaving.current && !saving && !panel && !demo) void load(true); wasSaving.current = saving; }, [saving, panel, demo, load]);

  const today = new Date().toISOString().slice(0, 10);
  const approaches = useMemo(() => {
    const list = demo ? briefing(demoSnapshot()) : data?.approaches || [];
    return list.filter((a) => snoozed[a.id] !== `${today}:${a.count}`);
  }, [data, demo, snoozed, today]);
  const current = approaches[Math.min(index, Math.max(0, approaches.length - 1))];
  useEffect(() => { setIndex(0); }, [approaches.length]);

  // ── Wallet (real or demo) ──
  const wallet = useMemo(() => {
    if (!data) return null;
    if (!demo) return data.wallet;
    const lvl = levelFromXp(demoState.xp);
    return { ...data.wallet, coins: demoState.coins, xp: demoState.xp, ...lvl, stage: stageForLevel(lvl.level), owned: demoState.owned, pending: demoState.pending };
  }, [data, demo, demoState]);

  const collect = async (keys?: string[]) => {
    if (!wallet || collecting) return;
    const items = keys ? wallet.pending.filter((p) => keys.includes(p.key)) : wallet.pending;
    if (!items.length) return;
    const coins = sumCoins(items);
    if (prefs.current.sound) chime(items.length > 2 ? "shower" : "coin");
    setCoinBurst((n) => n + 1);
    const beforeLevel = wallet.level;
    if (demo) {
      setDemoState((s) => { const xp = s.xp + items.reduce((n, p) => n + p.xp, 0); return { ...s, coins: s.coins + coins, xp, pending: s.pending.filter((p) => !items.includes(p)) }; });
      const after = levelFromXp(demoState.xp + items.reduce((n, p) => n + p.xp, 0)).level;
      if (after > beforeLevel) { setLevelUp(`Level ${after}! ${stageForLevel(after).name}`); if (prefs.current.sound) setTimeout(() => chime("level"), 500); }
      return;
    }
    setCollecting(true);
    try {
      const r = await api("/api/operating-world", { method: "POST", body: JSON.stringify({ action: "collect", clientId: scope, keys: keys || undefined }) });
      setData((d) => d ? { ...d, wallet: r.wallet } : d);
      if (r.wallet.level > beforeLevel) { setLevelUp(`Level ${r.wallet.level}! ${r.wallet.stage.name}`); lastLevel.current = r.wallet.level; if (prefs.current.sound) setTimeout(() => chime("level"), 500); }
    } catch (e) { setCommandAnswer(e instanceof Error ? e.message : "Couldn't collect coins."); }
    finally { setCollecting(false); }
  };

  const buy = async (trackId: string) => {
    if (!wallet) return;
    const next = nextUpgrade(trackId, wallet.owned);
    if (!next) return;
    const track = UPGRADES.find((t) => t.id === trackId)!;
    if (demo) {
      if (wallet.level < next.minLevel) throw new Error(`Unlocks at level ${next.minLevel}.`);
      if (demoState.coins < next.price) throw new Error(`You need ${next.price - demoState.coins} more coins.`);
      setDemoState((s) => ({ ...s, coins: s.coins - next.price, owned: [...s.owned, `${trackId}:${next.tier}`] }));
    } else {
      await api("/api/operating-world", { method: "POST", body: JSON.stringify({ action: "buy", clientId: scope, itemId: trackId }) }).then((r) => setData((d) => d ? { ...d, wallet: r.wallet } : d));
    }
    if (prefs.current.sound) chime("level");
    toast([{ employee: trackId === "hq" ? "projects" : trackId === "fleet" || trackId === "workshop" ? "projects" : trackId === "reception" ? "receptionist" : trackId === "signage" || trackId === "garden" ? "marketing" : "sales", text: `${track.name} upgraded: ${next.name}! ${next.perk}.`, coins: 0 }]);
  };

  const choose = (option: BriefingOption, approach: Approach) => {
    if (option.snooze) { const next = { ...snoozed, [approach.id]: `${today}:${approach.count}` }; setSnoozed(next); if (!demo) writePref(`ow-snooze:${scope}`, JSON.stringify(next)); if (prefs.current.sound) chime("pop"); return; }
    if (demo) { demoAct(approach); return; }
    if (option.panel) setPanel({ kind: option.panel, focusId: option.focusId });
  };
  const closePanel = () => { setPanelState(null); void load(true); };

  // Demo: scripted outcome, local only, labelled. Coins appear over the employee to collect.
  const demoAct = (approach: Approach) => {
    const kind: RewardKind = approach.employee === "receptionist" ? "lead_responded" : approach.employee === "accountant" ? "invoice_sent" : approach.employee === "calendar" ? "appointment_booked" : "follow_up";
    const n = Math.max(1, approach.count);
    const items = Array.from({ length: n }, (_, i) => ({ key: `demo-${approach.id}-${i}`, kind, coins: REWARDS[kind].coins, xp: REWARDS[kind].xp, label: `${REWARDS[kind].label} (demo)` }));
    setDemoState((s) => ({ ...s, pending: [...s.pending, ...items] }));
    toast([{ employee: approach.employee, text: `${reactionLine(kind, approach.id)} Tap the coins to collect.`, coins: sumCoins(items) }]);
    if (prefs.current.sound) chime("pop");
    setSnoozed((s) => ({ ...s, [approach.id]: `${today}:${approach.count}` }));
  };

  const runCommand = async (text = command) => {
    if (!text.trim()) return;
    if (demo) { setCommandAnswer("Demo mode: commands are switched off so nothing real is touched."); return; }
    setCommandBusy(true); setCommandAnswer("");
    try {
      const { intent } = await api("/api/operating-world", { method: "POST", body: JSON.stringify({ action: "command", clientId: scope, text }) });
      setCommandAnswer(intent.answer || "");
      if (intent.panel) setPanel({ kind: intent.panel });
    } catch (e) { setCommandAnswer(e instanceof Error ? e.message : "That didn't work."); }
    finally { setCommandBusy(false); }
  };
  const voice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setCommandAnswer("Voice input isn't supported in this browser. Type your request instead."); return; }
    const rec = new SR(); rec.lang = "en-IE"; rec.interimResults = false; setListening(true);
    rec.onresult = (e: any) => { const t = e.results?.[0]?.[0]?.transcript || ""; setCommand(t); void runCommand(t); };
    rec.onend = () => setListening(false); rec.onerror = () => setListening(false); rec.start();
  };
  const post = async (payload: Record<string, unknown>) => api("/api/operating-world", { method: "POST", body: JSON.stringify({ clientId: scope, ...payload }) });
  const exitDemo = () => { setDemo(false); setDemoState(DEMO_START); try { setSnoozed(JSON.parse(readPref(`ow-snooze:${scope}`, "{}"))); } catch { setSnoozed({}); } };

  if (loading && !data) return <div className="ow-root ow-loading" role="status"><Loader2 className="ow-spin" /> Opening your business…</div>;
  if (error && !data) return <div className="ow-root ow-error" role="alert"><p>{error}</p><button type="button" onClick={() => void load()}>Try again</button></div>;
  if (!data || !wallet) return null;

  const p = data.profile; const w = wallet;
  const tier = (id: string) => upgradeTier(w.owned, id);
  const floors = 1 + tier("hq");
  const customers = demo ? demoSnapshot().leads : data.customers;
  const waitingIds = new Set(customers.filter((c) => Date.now() - Date.parse(c.createdAt) > 24 * 3_600_000).map((c) => c.id));
  const healthMood = demo ? "busy" : data.health.mood;
  const approaching = current?.employee;
  const stations: Record<EmployeeId, [number, number]> = { receptionist: [342, 366], sales: [640, 400], accountant: [740, 380], projects: [255, 392], marketing: [150, 440], calendar: [860, 440] };
  const pendingByEmployee = new Map<EmployeeId, Pending[]>();
  for (const item of w.pending) { const emp = EMPLOYEE_FOR_REWARD[item.kind as RewardKind] || "receptionist"; pendingByEmployee.set(emp, [...(pendingByEmployee.get(emp) || []), item]); }
  const pendingTotal = sumCoins(w.pending);
  const upgradesReady = UPGRADES.filter((t) => { const n = nextUpgrade(t.id, w.owned); return n && w.level >= n.minLevel && w.coins >= n.price; }).length;

  return <div className={`ow-root mood-${healthMood}${reduced ? " ow-reduced" : ""}`} style={{ ["--ow-primary" as string]: p.primary, ["--ow-secondary" as string]: p.secondary }}>
    {demo && <div className="ow-demo-banner" role="note"><Eye size={16} /> Demo — sample customers and figures. Nothing here is real, saved or sent. <button type="button" onClick={exitDemo}>Exit demo</button></div>}

    <header className="ow-hud">
      <div className="ow-hud-id">{p.logo ? <img src={p.logo} alt="" /> : <span className="ow-hud-dot" />}<div><b>{p.name}</b><small>Level {w.level} · {w.stage.name}</small></div></div>
      <div className="ow-xp" aria-label={`Experience: ${w.xpIntoLevel} of ${w.xpForNext} to the next level`}><div style={{ width: `${Math.round(w.progress * 100)}%` }} /><span>{w.xpIntoLevel} / {w.xpForNext} XP</span></div>
      <div className={`ow-coins${coinBurst ? " bump" : ""}`} key={coinBurst} title="Virtual game coins — not real money"><Coins size={18} /> {w.coins.toLocaleString("en-IE")}</div>
      {pendingTotal > 0 && <button type="button" className="ow-collect-all" onClick={() => void collect()} disabled={collecting}><Sparkles size={16} /> Collect {pendingTotal}</button>}
      <div className="ow-hud-actions">
        <button type="button" className={upgradesReady ? "has-dot" : ""} onClick={() => setDrawer(drawer === "upgrades" ? "" : "upgrades")} aria-label={`Upgrades${upgradesReady ? `, ${upgradesReady} ready` : ""}`} title="Upgrades"><Hammer size={18} />{upgradesReady > 0 && <i>{upgradesReady}</i>}</button>
        <button type="button" onClick={() => setDrawer(drawer === "history" ? "" : "history")} aria-label="Rewards and action history" title="History"><History size={18} /></button>
        <button type="button" onClick={() => setDrawer(drawer === "settings" ? "" : "settings")} aria-label="Game settings" title="Settings"><Settings2 size={18} /></button>
        <button type="button" onClick={() => { const n = !sound; setSound(n); writePref("ow-sound", n ? "on" : "off"); if (n) chime("coin"); }} aria-label={sound ? "Mute sounds" : "Turn sounds on"} title="Sound">{sound ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
        <button type="button" onClick={() => { const n = !reduced; setReduced(n); writePref("ow-motion", n ? "reduced" : "full"); }} aria-label={reduced ? "Turn animations on" : "Reduce motion"} title="Motion">{reduced ? <Play size={18} /> : <Pause size={18} />}</button>
      </div>
    </header>

    <form className="ow-command" onSubmit={(e) => { e.preventDefault(); void runCommand(); }}>
      <Sparkles size={18} aria-hidden="true" />
      <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Ask your team… “Who haven't we replied to?”, “Record this receipt”, “How much have we earned this month?”" aria-label="Business command" />
      <button type="button" className={`ghost${listening ? " on" : ""}`} onClick={voice} aria-label="Speak a command" title="Voice"><Mic size={18} /></button>
      <button type="submit" disabled={commandBusy} aria-label="Run command">{commandBusy ? <Loader2 size={18} className="ow-spin" /> : <Send size={18} />}</button>
    </form>
    {commandAnswer && <div className="ow-answer" role="status"><Bot size={16} /><p>{commandAnswer}</p><button type="button" className="ghost" onClick={() => setCommandAnswer("")} aria-label="Dismiss"><X size={14} /></button></div>}

    <div className="ow-layout">
      <section className="ow-stage" aria-label="Your business">
        <svg viewBox="0 0 1000 560" role="img" aria-label={`${p.name} headquarters with ${customers.length} customers waiting`}>
          <defs><linearGradient id="ow-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#bfe7ff" /><stop offset="1" stopColor="#eaf7ff" /></linearGradient></defs>
          <rect width="1000" height="560" fill="url(#ow-sky)" className="ow-sky" />
          <circle cx="900" cy="70" r="34" fill="#ffe27a" className="ow-sun" />
          <g className="ow-clouds"><ellipse cx="160" cy="80" rx="60" ry="18" fill="#fff" /><ellipse cx="200" cy="70" rx="40" ry="16" fill="#fff" /><ellipse cx="640" cy="60" rx="50" ry="14" fill="#fff" /></g>
          <path d="M0 330 Q500 300 1000 330 L1000 560 L0 560 Z" fill="#9bd77f" className="ow-grass" />
          <path d="M470 330 L420 560 L580 560 L530 330 Z" fill="#e8dcc4" />
          <Workshop tier={tier("workshop")} primary={p.primary} secondary={p.secondary} />
          {tier("garden") >= 2 && <g>{[[40, 300], [790, 300]].map(([tx, ty]) => <g key={tx}><rect x={tx - 6} y={ty - 10} width="12" height="45" fill="#7c4a1e" /><circle cx={tx} cy={ty - 26} r="30" fill="#4ade80" /><circle cx={tx - 16} cy={ty - 12} r="18" fill="#22c55e" /></g>)}</g>}
          <Building floors={floors} primary={p.primary} secondary={p.secondary} name={p.name} logo={p.logo} sign={tier("signage")} />
          {/* Reception: desk → lounge → concierge */}
          {tier("reception") >= 2 && <g><rect x="250" y="452" width="56" height="18" rx="7" fill="#7c3aed" opacity=".75" /><rect x="250" y="446" width="56" height="10" rx="5" fill="#6d28d9" opacity=".75" /><circle cx="318" cy="452" r="9" fill="#16a34a" /><rect x="315" y="458" width="6" height="12" fill="#92400e" /></g>}
          <rect x="370" y="372" width="110" height="26" rx="6" fill={tier("reception") >= 3 ? "#f1f5f9" : tier("reception") >= 1 ? "#a16207" : "#c9a77c"} stroke={tier("reception") >= 3 ? "#cbd5e1" : "none"} strokeWidth="2" />
          <text x="425" y="389" textAnchor="middle" fontSize="11" fill={tier("reception") >= 3 ? "#334155" : "#fff"} fontWeight="800">RECEPTION</text>
          {tier("reception") >= 3 && <rect x="460" y="336" width="80" height="8" rx="4" fill={p.primary} opacity=".8" />}
          {(tier("garden") >= 1 || healthMood === "thriving") && <g className="ow-flowers">{[90, 130, 170, 830, 870, 910].map((fx) => <g key={fx}><rect x={fx - 1} y="345" width="2" height="12" fill="#4d7c0f" /><circle cx={fx} cy="343" r="6" fill={fx % 3 ? "#f472b6" : "#facc15"} /></g>)}</g>}
          {tier("garden") >= 3 && <g className="ow-fountain"><ellipse cx="900" cy="520" rx="46" ry="13" fill="#93c5fd" stroke="#60a5fa" strokeWidth="3" /><rect x="896" y="492" width="8" height="28" fill="#cbd5e1" /><circle cx="900" cy="488" r="8" fill="#bfdbfe" /></g>}
          {tier("cafe") >= 1 && <g><rect x="680" y="500" width="64" height="8" rx="3" fill="#8b5a2b" /><rect x="685" y="508" width="5" height="12" fill="#5b3a1a" /><rect x="734" y="508" width="5" height="12" fill="#5b3a1a" /><rect x="752" y="482" width="22" height="28" rx="4" fill="#78350f" /><circle cx="763" cy="478" r="6" fill="#fde68a" /></g>}
          {tier("cafe") >= 2 && <g>{[640, 790].map((cx) => <g key={cx}><path d={`M${cx - 26} 470 Q${cx} 446 ${cx + 26} 470 Z`} fill={p.primary} /><rect x={cx - 1.5} y="470" width="3" height="30" fill="#6b7280" /><ellipse cx={cx} cy="502" rx="16" ry="5" fill="#e5e7eb" /></g>)}</g>}
          {tier("fleet") >= 1 && <g className="ow-van"><Vehicle x={0} y={0} primary={p.primary} name={p.name} big={tier("fleet") >= 2} /></g>}
          {tier("fleet") >= 3 && <Vehicle x={20} y={392} primary={p.secondary} name={p.name} />}
          {(healthMood === "busy" || healthMood === "struggling") && <g className="ow-paper"><rect x="455" y="362" width="22" height="6" fill="#fff" stroke="#ccc" /><rect x="457" y="356" width="22" height="6" fill="#fff" stroke="#ccc" />{healthMood === "struggling" && <rect x="454" y="350" width="22" height="6" fill="#fff" stroke="#ccc" />}</g>}
          {/* Customers = real new leads */}
          {customers.slice(0, 8).map((c, i) => { const waiting = waitingIds.has(c.id); const cx = 330 + (i % 4) * 34, cy = 440 + Math.floor(i / 4) * 52; return <g key={c.id} className={`ow-customer${waiting ? " impatient" : ""}`} style={{ animationDelay: `${i * 0.15}s` }} onClick={() => { if (!demo) setPanel({ kind: "lead-detail", focusId: c.id }); }} role="button" tabIndex={0} aria-label={`${c.name || c.title}${waiting ? ", waiting over a day" : ""}`} onKeyDown={(e) => { if (e.key === "Enter" && !demo) setPanel({ kind: "lead-detail", focusId: c.id }); }}>
            <Person x={cx} y={cy} body={["#60a5fa", "#a78bfa", "#fb7185", "#34d399", "#fbbf24"][i % 5]} skin={["#f2c9a0", "#c68642", "#8d5524", "#e0ac69"][i % 4]} mood={waiting ? "concerned" : "calm"} scale={0.9} label={c.name} />
            {waiting && <g transform={`translate(${cx} ${cy - 32})`}><circle r="8" fill="#ef4444" /><text y="4" textAnchor="middle" fontSize="11" fill="#fff" fontWeight="800">!</text></g>}
          </g>; })}
          {/* Employees — the AI agent's personalities */}
          {(Object.keys(EMPLOYEES) as EmployeeId[]).map((id) => { const [ex, ey] = stations[id]; const active = id === approaching; const tx = active ? 520 : ex, ty = active ? 470 : ey; return <g key={id} className={`ow-employee${active ? " approaching" : ""} mood-${active ? current?.mood : "calm"}`} style={{ transform: `translate(${tx - ex}px, ${ty - ey}px)` }}>
            <Person x={ex} y={ey} body={EMPLOYEES[id].colour} mood={active ? current?.mood : healthMood === "struggling" ? "concerned" : "calm"} tool={id === "accountant" || id === "projects" ? "clipboard" : id === "marketing" ? "laptop" : "none"} label={`${EMPLOYEES[id].name}, ${EMPLOYEES[id].title}`} />
            <text x={ex} y={ey + 50} textAnchor="middle" fontSize="10" fill="#1f2937" fontWeight="700">{EMPLOYEES[id].name}</text>
          </g>; })}
          {/* Collectable coins over each employee */}
          {[...pendingByEmployee.entries()].map(([id, items]) => { const [ex, ey] = stations[id]; const active = id === approaching; return <CoinBubble key={id} x={active ? 520 : ex} y={(active ? 470 : ey) - 58} amount={sumCoins(items)} label={`Collect ${sumCoins(items)} coins from ${EMPLOYEES[id].name}`} onCollect={() => void collect(items.map((x) => x.key))} />; })}
          {/* The owner */}
          <Person x={580} y={470} body={p.secondary} trim={tier("outfit") >= 2 ? "#d4a017" : p.primary} hat={p.outfit.hat} tool={p.outfit.tool} outfit={p.outfit.outfit} scale={1.25} label={`${p.characterName} (you)`} className={tier("outfit") >= 2 ? "ow-gold" : tier("outfit") >= 1 ? "ow-fresh" : ""} />
          <text x="580" y="530" textAnchor="middle" fontSize="12" fontWeight="800" fill="#111827">{p.characterName}</text>
          {coinBurst > 0 && !reduced && <g key={coinBurst} className="ow-coin-fly">{[0, 1, 2, 3, 4, 5].map((k) => <circle key={k} cx={500 + k * 14} cy={420} r="8" fill="#fbbf24" stroke="#d97706" strokeWidth="2" style={{ animationDelay: `${k * 0.06}s` }} />)}</g>}
        </svg>

        <div className={`ow-dialogue${current ? "" : " clear"}`} aria-live="polite">
          {current ? <>
            <div className="ow-speaker" style={{ background: EMPLOYEES[current.employee].colour }}>{EMPLOYEES[current.employee].name.charAt(0)}</div>
            <div className="ow-speech">
              <small>{EMPLOYEES[current.employee].name} · {EMPLOYEES[current.employee].title}{approaches.length > 1 ? ` · ${Math.min(index, approaches.length - 1) + 1} of ${approaches.length}` : ""}</small>
              <p className={current.mood === "panicked" ? "shout" : ""}>{current.line}</p>
              <span className="ow-detail">{current.detail}</span>
              <div className="ow-options">{current.options.map((o) => <button type="button" key={o.label} className={o.snooze ? "ghost" : ""} onClick={() => choose(o, current)}>{o.label}</button>)}</div>
            </div>
            {approaches.length > 1 && <button type="button" className="ow-next ghost" onClick={() => setIndex((index + 1) % approaches.length)} aria-label="Next update"><ChevronRight size={20} /></button>}
          </> : <><div className="ow-speaker ok"><Check size={20} /></div><div className="ow-speech"><p>{allClearLine(today)}</p><span className="ow-detail">Nothing needs you right now. New enquiries, invoices and appointments will appear here as they happen.</span></div></>}
        </div>
      </section>

      <aside className="ow-side">
        <section className="ow-card"><h3><Zap size={16} /> Task queue</h3>
          {approaches.length ? <ol className="ow-queue">{approaches.map((a, i) => <li key={a.id}><button type="button" onClick={() => setIndex(i)} className={a === current ? "on" : ""}><span className="dot" style={{ background: EMPLOYEES[a.employee].colour }} /><span>{a.line}</span><em className={a.urgency >= 75 ? "hot" : ""}>{a.urgency >= 75 ? "Urgent" : a.urgency >= 50 ? "Soon" : "FYI"}</em></button></li>)}</ol> : <p className="ow-muted">All caught up.</p>}
        </section>
        <section className="ow-card"><h3><Hammer size={16} /> Next upgrade</h3>
          {(() => { const t = UPGRADES.map((track) => ({ track, next: nextUpgrade(track.id, w.owned) })).filter((x) => x.next).sort((a, b) => (a.next!.minLevel - b.next!.minLevel) || (a.next!.price - b.next!.price))[0];
            if (!t) return <p className="ow-muted">Everything is fully upgraded. Legendary.</p>;
            const locked = w.level < t.next!.minLevel, short = w.coins < t.next!.price;
            return <div className="ow-next-up"><b>{t.track.name}: {t.next!.name}</b><small>{t.next!.perk}</small><div className="ow-mini-bar"><div style={{ width: `${Math.min(100, Math.round(w.coins / t.next!.price * 100))}%` }} /></div><small>{locked ? `Unlocks at level ${t.next!.minLevel}` : short ? `${t.next!.price - w.coins} more coins needed` : "Ready to build!"}</small><button type="button" onClick={() => setDrawer("upgrades")}>{locked || short ? "See all upgrades" : `Build for ${t.next!.price}`}</button></div>; })()}
        </section>
        <section className="ow-card"><h3><Gauge size={16} /> Operational health</h3>
          <div className={`ow-health h-${healthMood}`}><div style={{ width: `${demo ? 55 : data.health.score}%` }} /></div>
          <p className="ow-muted">{demo ? "Demo" : `${data.health.score}/100 · ${data.health.mood}`}</p>
          {!demo && data.health.issues.length > 0 && <ul className="ow-issues">{data.health.issues.map((i) => <li key={i}>{i}</li>)}</ul>}
        </section>
        {!demo && !data.scopeId && data.sources.invoicing && <section className="ow-card real-money"><h3>Real money</h3><p><b>Paid this month:</b> {money(data.finance.paidThisMonth)}</p><p><b>Outstanding:</b> {money(data.finance.outstanding)}</p><small className="ow-muted">Only invoices marked paid count as money received. Coins are virtual.</small></section>}
        <section className="ow-card"><h3><CalendarDays size={16} /> Coming up</h3>{!demo && data.upcoming.length ? <ul className="ow-upcoming">{data.upcoming.map((b) => <li key={b.id}><b>{new Date(b.startAt).toLocaleString("en-IE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</b> {b.name}</li>)}</ul> : <p className="ow-muted">{data.sources.scheduling ? "No upcoming appointments." : "Scheduling isn't set up for this account yet."}</p>}<button type="button" className="ow-link" onClick={() => setPanel({ kind: "scheduling" })} disabled={demo}>Book an appointment</button></section>
        <section className="ow-card"><h3><Wand2 size={16} /> Quick actions</h3><div className="ow-quick">
          {(["leads", "conversations", "scheduling", "tasks", "expense", "books", "contacts", ...(data.scopeId ? [] : ["invoicing"])] as PanelKind[]).map((k) => <button type="button" key={k} className="ghost" disabled={demo} onClick={() => setPanel({ kind: k })}>{PANEL_TITLES[k]}</button>)}
          {!demo && <button type="button" className="ghost" onClick={() => { setDemo(true); setSnoozed({}); setDemoState(DEMO_START); }}><Eye size={14} /> Try the demo</button>}
        </div></section>
      </aside>
    </div>

    <div className="ow-toasts" aria-live="polite">{toasts.map((t) => <div className="ow-toast" key={t.id}><span className="ow-speaker sm" style={{ background: EMPLOYEES[t.employee].colour }}>{EMPLOYEES[t.employee].name.charAt(0)}</span><p>{t.text}</p>{t.coins > 0 && <b>+{t.coins} <Coins size={14} /></b>}</div>)}</div>
    {levelUp && <div className="ow-modal-scrim"><div className="ow-levelup" role="alertdialog" aria-label="Level up"><Sparkles size={30} /><h2>{levelUp}</h2><p>New upgrades may be unlocked — check the Headquarters track.</p><div className="ow-options center"><button type="button" onClick={() => { setLevelUp(""); setDrawer("upgrades"); }}>See upgrades</button><button type="button" className="ghost" onClick={() => setLevelUp("")}>Later</button></div></div></div>}

    {walk && walk.steps.length > 0 && (() => { const step = walk.steps[walk.at]; const last = walk.at === walk.steps.length - 1; const total = walk.steps.reduce((n, s) => n + s.coins, 0); return <div className="ow-modal-scrim"><div className="ow-walk" role="dialog" aria-label="Welcome back">
      {walk.at === 0 && <div className="ow-walk-head"><Coins size={22} /><div><b>Welcome back, {p.characterName}!</b><small>While you were away your team earned <strong>{total} coins</strong> from real work. Here's why:</small></div></div>}
      <div className="ow-walk-step" key={walk.at}><span className="ow-speaker" style={{ background: EMPLOYEES[step.employee].colour }}>{EMPLOYEES[step.employee].name.charAt(0)}</span><div><small>{EMPLOYEES[step.employee].name} · {EMPLOYEES[step.employee].title}</small><p>{step.line}</p><ul>{step.items.slice(0, 6).map((it, i) => <li key={i}>{it}</li>)}{step.items.length > 6 && <li>…and {step.items.length - 6} more</li>}</ul><b className="ow-walk-coins">+{step.coins} coins · +{step.xp} XP</b></div></div>
      <div className="ow-walk-foot"><span className="ow-dots">{walk.steps.map((_, i) => <i key={i} className={i === walk.at ? "on" : ""} />)}</span>
        <button type="button" className="ghost" onClick={() => setWalk(null)}>Skip</button>
        {last ? <button type="button" onClick={() => { setWalk(null); void collect(); }}><Sparkles size={16} /> Collect {total} coins</button> : <button type="button" onClick={() => { if (prefs.current.sound) chime("coin"); setWalk({ ...walk, at: walk.at + 1 }); }}>Next <ChevronRight size={16} /></button>}
      </div></div></div>; })()}

    {drawer && <Drawer kind={drawer} data={data} wallet={w} demo={demo} onClose={() => setDrawer("")} post={post} buy={buy} onChanged={() => void load(true)} />}

    {panel && <div className="ow-panel" role="dialog" aria-label={PANEL_TITLES[panel.kind]}>
      <header><button type="button" onClick={closePanel}><ArrowLeft size={18} /> Back to {p.name}</button><b>{PANEL_TITLES[panel.kind]}</b><button type="button" onClick={closePanel} aria-label="Close"><X size={18} /></button></header>
      <div className="ow-panel-body">
        {panel.kind === "lead-replies" || panel.kind === "lead-detail"
          ? <LeadReplies scope={scope} focusId={panel.kind === "lead-detail" ? panel.focusId : undefined} customers={data.customers} mode={data.state.mode} post={post} onOpen={(k) => setPanel({ kind: k })} />
          : renderPanel(panel.kind, { focusId: panel.focusId, onDone: closePanel })}
      </div>
    </div>}
  </div>;
}

// ───────────── AI-prepared replies (Copilot: draft → owner approves → existing send pipeline) ─────────────
function LeadReplies({ scope, focusId, customers, mode, post, onOpen }: { scope: string; focusId?: string; customers: Customer[]; mode: string; post: (p: Record<string, unknown>) => Promise<any>; onOpen: (k: PanelKind) => void }) {
  type Draft = { id: string; subject: string; body: string; missing: string[]; lead: Customer & { pipelineId?: string }; status?: "sending" | "sent" | "error"; note?: string };
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [usedAi, setUsedAi] = useState<boolean | null>(null);
  const [copied, setCopied] = useState("");
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState("");
  const focus = focusId ? customers.find((c) => c.id === focusId) : undefined;

  const prepare = async () => {
    setBusy(true); setErr("");
    try { const r = await post({ action: "draftReplies", ids: focusId ? [focusId] : undefined }); setDrafts(r.drafts || []); setUsedAi(Boolean(r.usedAi)); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't prepare replies."); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (!focusId && mode !== "manual") void prepare(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (id: string, patch: Partial<Draft>) => setDrafts((all) => all.map((d) => d.id === id ? { ...d, ...patch } : d));
  const approve = async (d: Draft) => {
    update(d.id, { status: "sending", note: "" });
    try {
      const { threadId } = await post({ action: "emailThread", opportunityId: d.id });
      const sent = await fetch("/api/conversations", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "send", id: threadId, subject: d.subject, body: d.body }) });
      const sj = await sent.json().catch(() => ({})) as any;
      if (!sent.ok) throw new Error(sj.error || "The email didn't send.");
      let moved = "";
      if (d.lead.nextStageId) {
        const mv = await fetch(`/api/crm?clientId=${encodeURIComponent(scope)}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "moveOpportunity", id: d.id, stageId: d.lead.nextStageId }) });
        moved = mv.ok ? ` Moved to “${d.lead.nextStage}”.` : " Sent, but the pipeline stage couldn't be updated — move it in the Pipeline.";
      }
      await post({ action: "log", actor: "Owner (approved AI draft)", what: `Replied to ${d.lead.name || d.lead.title}`, reason: "Owner approved the prepared reply", records: [`opportunity:${d.id}`, `thread:${threadId}`] }).catch(() => undefined);
      update(d.id, { status: "sent", note: `Email sent and logged in Conversations.${moved}` });
    } catch (e) { update(d.id, { status: "error", note: e instanceof Error ? e.message : "Couldn't send." }); }
  };

  return <div className="ow-replies">
    {focus && <article className="ow-lead-card"><h3>{focus.name || focus.title}</h3><p>{focus.title}</p><dl><dt>Stage</dt><dd>{focus.stage}</dd><dt>Waiting since</dt><dd>{new Date(focus.createdAt).toLocaleString("en-IE")}</dd>{focus.email && <><dt>Email</dt><dd><a href={`mailto:${focus.email}`}>{focus.email}</a></dd></>}{focus.phone && <><dt>Phone</dt><dd><a href={`tel:${focus.phone}`}>{focus.phone}</a></dd></>}{focus.value > 0 && <><dt>Value</dt><dd>{new Intl.NumberFormat("en-IE", { style: "currency", currency: focus.currency }).format(focus.value)}</dd></>}</dl>
      <div className="ow-options"><button type="button" onClick={() => void prepare()} disabled={busy}><Wand2 size={14} /> Prepare a reply</button><button type="button" className={booking ? "" : "ghost"} onClick={() => setBooking(!booking)}><CalendarDays size={14} /> Book an appointment</button><button type="button" className="ghost" onClick={() => onOpen("leads")}>Open in Pipeline</button><button type="button" className="ghost" onClick={() => onOpen("conversations")}>Conversations</button></div>{booking && !booked && <BookingPicker scope={scope} customer={focus} onBooked={(t) => { setBooked(t); void post({ action: "log", actor: "Owner", what: `Booked ${focus.name || focus.title}`, reason: "Booked from the lead card in Operating World", records: [`opportunity:${focus.id}`] }).catch(() => undefined); }} onMore={() => onOpen("scheduling")} />}{booked && <p className="ow-ok">{booked} Coins will appear over Cal shortly.</p>}</article>}
    {!focus && <p className="ow-muted">Drafts only — nothing is sent until you approve each one. Replies go out through your normal Conversations email and appear there.</p>}
    {mode === "manual" && !focus && !drafts.length && <button type="button" onClick={() => void prepare()} disabled={busy}><Wand2 size={14} /> Prepare drafts</button>}
    {busy && <p className="ow-muted" role="status"><Loader2 size={14} className="ow-spin" /> The receptionist is drafting…</p>}
    {err && <p className="ow-err" role="alert">{err}</p>}
    {usedAi === false && drafts.length > 0 && <p className="ow-muted">AI isn't connected, so these are standard templates. Connect an AI provider in Settings → API Keys for tailored replies.</p>}
    {drafts.map((d) => <article key={d.id} className={`ow-draft s-${d.status || "new"}`}>
      <header><b>{d.lead.name || d.lead.title}</b><span>{d.lead.email || "no email on file"}</span></header>
      <label>Subject<input value={d.subject} onChange={(e) => update(d.id, { subject: e.target.value })} disabled={d.status === "sent"} /></label>
      <label>Message<textarea rows={6} value={d.body} onChange={(e) => update(d.id, { body: e.target.value })} disabled={d.status === "sent"} /></label>
      {d.missing.length > 0 && <p className="ow-missing">Asks for: {d.missing.join(", ")}</p>}
      <div className="ow-options">
        {d.status !== "sent" && <button type="button" onClick={() => void approve(d)} disabled={d.status === "sending" || !d.lead.email}>{d.status === "sending" ? <Loader2 size={14} className="ow-spin" /> : <Send size={14} />} Approve & send</button>}
        <button type="button" className="ghost" onClick={async () => { try { await navigator.clipboard.writeText(`${d.subject}\n\n${d.body}`); setCopied(d.id); setTimeout(() => setCopied(""), 1500); } catch { /* clipboard blocked */ } }}>{copied === d.id ? <Check size={14} /> : <Copy size={14} />} Copy</button>
        {d.lead.phone && <a className="ow-btn ghost" href={`tel:${d.lead.phone}`}>Call instead</a>}
      </div>
      {d.note && <p className={d.status === "error" ? "ow-err" : "ow-ok"}>{d.note}</p>}
    </article>)}
  </div>;
}

// ───────────── In-game booking (calendar assistant): real slots → existing Scheduling "book" ─────────────
function BookingPicker({ scope, customer, onBooked, onMore }: { scope: string; customer: Customer; onBooked: (text: string) => void; onMore: () => void }) {
  type Cal = { id: string; name: string };
  type Slot = { start: string; end: string; staffIds: string[] };
  const [cals, setCals] = useState<Cal[] | null>(null);
  const [calId, setCalId] = useState("");
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [picked, setPicked] = useState("");
  const [notes, setNotes] = useState("");
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const q = `clientId=${encodeURIComponent(scope)}`;
  useEffect(() => { api(`/api/scheduling?view=calendars&${q}`).then((r) => { setCals(r.calendars || []); if (r.calendars?.[0]) setCalId(r.calendars[0].id); }).catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load calendars.")); }, [q]);
  useEffect(() => { if (!calId) return; setSlots(null); setPicked(""); api(`/api/scheduling?view=slots&calendarId=${encodeURIComponent(calId)}&date=${new Date().toISOString().slice(0, 10)}&days=10&${q}`).then((r) => setSlots(r.slots || [])).catch((e) => setErr(e instanceof Error ? e.message : "Couldn't load times.")); }, [calId, q]);
  const book = async () => {
    setBusy(true); setErr("");
    try {
      // The existing Scheduling route re-checks availability before saving, so a taken slot can't be double-booked.
      const r = await api(`/api/scheduling?${q}`, { method: "POST", body: JSON.stringify({ action: "book", calendarId: calId, start: picked, name: customer.name || customer.title, email: customer.email || "", phone: customer.phone || "", notes, notify }) });
      onBooked(`Booked for ${new Date(r.booking?.start || picked).toLocaleString("en-IE", { weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.${notify && customer.email ? " Confirmation sent." : ""}`);
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't book that time."); setSlots(null); api(`/api/scheduling?view=slots&calendarId=${encodeURIComponent(calId)}&date=${new Date().toISOString().slice(0, 10)}&days=10&${q}`).then((r) => setSlots(r.slots || [])).catch(() => undefined); }
    finally { setBusy(false); }
  };
  if (cals && !cals.length) return <div className="ow-book"><p className="ow-muted">No booking calendars for this account yet.</p><button type="button" className="ghost" onClick={onMore}>Set one up in Scheduling</button></div>;
  const list = (slots || []).slice(0, showAll ? 12 : 3);
  return <div className="ow-book">
    <div className="ow-book-head"><span className="ow-speaker sm" style={{ background: EMPLOYEES.calendar.colour }}>C</span><p>{slots === null ? "Checking the diary…" : slots.length ? `I've checked the calendar — ${slots.length === 1 ? "this time is" : `these ${Math.min(list.length, slots.length)} times are`} free.` : "No free times in the next 10 days."}</p></div>
    {cals && cals.length > 1 && <label>Appointment type<select value={calId} onChange={(e) => setCalId(e.target.value)}>{cals.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
    {slots === null ? <Loader2 size={16} className="ow-spin" /> : <div className="ow-slots">{list.map((s) => <button type="button" key={s.start} className={picked === s.start ? "" : "ghost"} onClick={() => setPicked(s.start)}>{new Date(s.start).toLocaleString("en-IE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</button>)}{slots.length > 3 && !showAll && <button type="button" className="ghost" onClick={() => setShowAll(true)}>More times</button>}</div>}
    {picked && <><label>Notes<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Site address, access, what to bring…" /></label>
      <label className="ow-check"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} disabled={!customer.email} /> Send the customer a confirmation{customer.email ? "" : " (no email on file)"}</label>
      <div className="ow-options"><button type="button" onClick={() => void book()} disabled={busy}>{busy ? <Loader2 size={14} className="ow-spin" /> : <CalendarDays size={14} />} Confirm booking</button><button type="button" className="ghost" onClick={onMore}>Staff, duration & more</button></div></>}
    {err && <p className="ow-err" role="alert">{err}</p>}
  </div>;
}

// ───────────── Drawers: upgrades, settings, history ─────────────
function Drawer({ kind, data, wallet: w, demo, onClose, post, buy, onChanged }: { kind: "upgrades" | "settings" | "history"; data: WorldData; wallet: Wallet; demo: boolean; onClose: () => void; post: (p: Record<string, unknown>) => Promise<any>; buy: (trackId: string) => Promise<void>; onChanged: () => void }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [form, setForm] = useState({ industry: data.profile.industry, primary: data.profile.primary, secondary: data.profile.secondary, characterName: data.profile.characterName, website: data.profile.website });
  const act = async (payload: Record<string, unknown>, ok: string) => { if (demo) { setMsg({ ok: false, text: "Demo mode: settings are switched off." }); return; } setMsg(null); try { await post(payload); setMsg({ ok: true, text: ok }); onChanged(); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "That didn't work." }); } };
  const upgrade = async (id: string) => { setBusy(id); setMsg(null); try { await buy(id); } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Couldn't upgrade." }); } finally { setBusy(""); } };
  return <div className="ow-modal-scrim drawer" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}><aside className="ow-drawer" role="dialog" aria-label={kind}>
    <header><b>{kind === "upgrades" ? "Upgrade your business" : kind === "settings" ? "Your business & AI" : "Rewards & history"}</b><button type="button" className="ghost" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
    {kind === "upgrades" && <>
      <div className="ow-balance"><Coins size={18} /> <b>{w.coins.toLocaleString("en-IE")}</b> coins · Level {w.level}</div>
      <p className="ow-muted">Earn coins from real work, collect them from your team, then spend them here. Levels unlock higher tiers.</p>
      <ul className="ow-tracks">{UPGRADES.map((t) => { const have = upgradeTier(w.owned, t.id); const next = nextUpgrade(t.id, w.owned); const locked = next ? w.level < next.minLevel : false; const short = next ? w.coins < next.price : false; return <li key={t.id}>
        <div className="ow-track-top"><b>{t.name}</b><span className="ow-pips" aria-label={`Tier ${have} of ${t.tiers.length}`}>{t.tiers.map((x) => <i key={x.tier} className={x.tier <= have ? "on" : ""} />)}</span></div>
        <small>{have ? `Now: ${t.tiers[have - 1].name}` : "Not built yet"}</small>
        {next ? <div className="ow-track-next"><div><b>{next.name}</b><small>{next.perk}</small></div>
          <button type="button" disabled={locked || short || busy === t.id} className={locked || short ? "ghost" : ""} onClick={() => void upgrade(t.id)}>{locked ? <><Lock size={13} /> Level {next.minLevel}</> : busy === t.id ? <Loader2 size={13} className="ow-spin" /> : <><Coins size={13} /> {next.price.toLocaleString("en-IE")}</>}</button></div>
          : <small className="ow-ok">Fully upgraded</small>}
      </li>; })}</ul>
    </>}
    {kind === "settings" && <>
      <h4>Character & branding</h4>
      <label>Industry {data.profile.industryGuessed && <em>(guessed — please check)</em>}<select value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })}>{data.industries.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</select></label>
      <label>Your character's name<input value={form.characterName} maxLength={30} onChange={(e) => setForm({ ...form, characterName: e.target.value })} /></label>
      <div className="ow-colours"><label>Primary<input type="color" value={form.primary} onChange={(e) => setForm({ ...form, primary: e.target.value })} /></label><label>Secondary<input type="color" value={form.secondary} onChange={(e) => setForm({ ...form, secondary: e.target.value })} /></label></div>
      <label>Website<input value={form.website} placeholder="https://…" onChange={(e) => setForm({ ...form, website: e.target.value })} /></label>
      <small className="ow-muted">Colours and logo come from the account's branding; changes here only affect the game.</small>
      <button type="button" onClick={() => void act({ action: "saveProfile", ...form }, "Saved.")}>Save character</button>
      <h4>AI operating mode</h4>
      <div className="ow-modes">{(["manual", "copilot", "autopilot"] as const).map((m) => <button type="button" key={m} className={data.state.mode === m ? "on" : "ghost"} onClick={() => void act({ action: "setMode", mode: m, autopilotPaused: true }, `Mode: ${m}`)}>{m === "manual" ? "Manual" : m === "copilot" ? "Copilot" : "Autopilot"}</button>)}</div>
      <p className="ow-muted">{data.state.mode === "manual" ? "AI spots what needs doing and recommends. You do the work." : data.state.mode === "copilot" ? "AI prepares replies and actions; you approve each one before anything is sent." : "Autopilot only runs rules you've switched on in Automations. Money and other important actions always need your approval."}</p>
      {data.state.mode === "autopilot" && <button type="button" className={data.state.autopilotPaused ? "" : "danger"} onClick={() => void act({ action: "setMode", mode: "autopilot", autopilotPaused: !data.state.autopilotPaused }, data.state.autopilotPaused ? "Autopilot running" : "Autopilot paused")}>{data.state.autopilotPaused ? <><Play size={14} /> Resume autopilot</> : <><Pause size={14} /> Pause autopilot</>}</button>}
      {!data.aiReady && <p className="ow-err">No AI provider connected — drafts use templates. Add one in Settings → API Keys.</p>}
      <h4>Connected data</h4>
      <ul className="ow-sources">{Object.entries(data.sources).map(([k, v]) => <li key={k} className={v ? "on" : ""}>{v ? <Check size={12} /> : <EyeOff size={12} />} {k}</li>)}</ul>
    </>}
    {kind === "history" && <>
      <h4>How you earn coins</h4>
      <ul className="ow-earn">{(Object.keys(REWARDS) as RewardKind[]).map((k) => <li key={k}><span>{REWARDS[k].label}</span><b>+{REWARDS[k].coins}</b></li>)}</ul>
      <h4>Recent rewards</h4>
      {w.recentRewards.length ? <ul className="ow-history">{w.recentRewards.map((r) => <li key={r.reward_key}><b>+{r.coins}</b> {r.label}<time>{new Date(r.created_at).toLocaleString("en-IE")}{r.collected_at ? "" : " · waiting to collect"}</time></li>)}</ul> : <p className="ow-muted">Rewards appear when real work is completed — here or in the normal CRM screens.</p>}
      <h4>Action history</h4>
      {w.actions.length ? <ul className="ow-history">{w.actions.map((a) => <li key={a.id}><b>{a.actor}</b> {a.action}<small>{a.reason}{a.records.length ? ` · ${a.records.length} record${a.records.length === 1 ? "" : "s"}` : ""} · {a.status}</small><time>{new Date(a.created_at).toLocaleString("en-IE")}</time></li>)}</ul> : <p className="ow-muted">Nothing yet.</p>}
    </>}
    {msg && <p className={msg.ok ? "ow-ok" : "ow-err"} role="status">{msg.text}</p>}
  </aside></div>;
}
