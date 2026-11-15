"use client";

// Operating World — the CRM as a living miniature business.
// The game is only an interface: every real action happens inside the EXISTING CRM screens and task
// cards, which open here as in-game panels. Coins come from the server, which credits them from real
// completed records (idempotent). The owner taps the coins over each employee to collect them.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Bot, Coins, Gauge, History, Mic, Pause, Play, Send, Settings2, Sparkles, Volume2, VolumeX, Wand2, X, Zap, CalendarDays, Copy, Check, Loader2, Eye, EyeOff, Hammer, Lock, ChevronRight } from "lucide-react";
import { EMPLOYEES, EMPLOYEE_FOR_REWARD, REWARDS, UPGRADES, allClearLine, briefing, levelFromXp, nextUpgrade, reactionLine, rewardWalkthrough, stageForLevel, upgradeTier, workingHoursBetween, type Approach, type BriefingOption, type EmployeeId, type OwSnapshot, type PanelKind, type RewardKind, type UpgradeTrack, type WalkStep } from "@/lib/operating-world/engine";
import "./operating-world.css";

type Outfit = { hat: string; tool: string; outfit: string; label: string };
type Profile = { name: string; logo: string; primary: string; secondary: string; industry: string; industryGuessed: boolean; industryLabel: string; outfit: Outfit; characterName: string; website: string };
type Pending = { key: string; kind: string; coins: number; xp: number; label: string };
type Wallet = { coins: number; xp: number; level: number; xpIntoLevel: number; xpForNext: number; progress: number; stage: { name: string; floors: number; next: { level: number; name: string } | null }; owned: string[]; pending: Pending[]; recentRewards: Array<{ reward_key: string; kind: RewardKind; coins: number; label: string; created_at: string; collected_at?: string }>; actions: Array<{ id: string; actor: string; action: string; reason: string; records: string[]; status: string; created_at: string }> };
type Customer = { id: string; title: string; name: string; createdAt: string; stage: string; email?: string; phone?: string; nextStageId?: string; nextStage?: string; value: number; currency: string };
type WorldData = {
  scopeId: string; state: { mode: "manual" | "copilot" | "autopilot"; autopilotPaused: boolean; startedAt: string }; profile: Profile; wallet: Wallet;
  freshRewards: Array<{ key: string; kind: RewardKind; coins: number; xp: number; label: string }>; raids?: Array<{ key: string; coins: number; label: string }>; approaches: Approach[];
  health: { score: number; mood: string; issues: string[] }; finance: { paidThisMonth: Record<string, number>; outstanding: Record<string, number>; overdueCount: number };
  sources: Record<string, boolean>; customers: Customer[]; counts: { leads: number; unread: number; bookingsUpcoming: number; openTasks: number };
  upcoming: Array<{ id: string; name: string; startAt: string }>; crops?: Crop[]; agents?: Array<{ id: string; name: string; state: string; task: string }>; staffAtWork?: Array<{ id: string; name: string; task: string }>; visitors?: Array<{ id: string; name: string; stage: string }>; taxman?: boolean; shop: UpgradeTrack[]; industries: Array<{ id: string; label: string }>; aiReady: boolean;
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
function chime(kind: "coin" | "level" | "pop" | "shower" | "steal") {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext; if (!AC) return;
    const ctx = new AC();
    const notes = kind === "steal" ? [784, 622, 494, 392] : kind === "level" ? [523, 659, 784, 1046] : kind === "shower" ? [988, 1319, 1175, 1568, 1319, 1760] : kind === "coin" ? [988, 1319] : [660];
    const gap = kind === "shower" ? 0.07 : 0.09;
    notes.forEach((f, i) => { const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "triangle"; o.frequency.value = f; const t = ctx.currentTime + i * gap; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.11, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25); o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + 0.3); });
    setTimeout(() => ctx.close(), 1600);
  } catch { /* audio blocked until the first tap */ }
}

// ───────────── Isometric art (original, Clash-of-Clans-inspired) ─────────────
const T = 30; // half a tile's width in px
const iso = (x: number, y: number, z = 0): [number, number] => [500 + (x - y) * T, 110 + (x + y) * (T / 2) - z];
const pts = (list: Array<[number, number]>) => list.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
function shade(hex: string, amount: number) {
  const n = parseInt((/^#[0-9a-f]{6}$/i.test(hex) ? hex : "#3b82f6").slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount))));
  return `#${[f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
const lerp = (a: [number, number], b: [number, number], t: number): [number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** A 3D block: top + the two faces that face the viewer. */
function IsoBox({ x, y, w, d, h, z = 0, color, topColor }: { x: number; y: number; w: number; d: number; h: number; z?: number; color: string; topColor?: string }) {
  const A = iso(x, y, z + h), B = iso(x + w, y, z + h), C = iso(x + w, y + d, z + h), D = iso(x, y + d, z + h);
  const Bb = iso(x + w, y, z), Cb = iso(x + w, y + d, z), Db = iso(x, y + d, z);
  return <g><polygon points={pts([D, C, Cb, Db])} fill={shade(color, -0.12)} /><polygon points={pts([C, B, Bb, Cb])} fill={shade(color, -0.28)} /><polygon points={pts([A, B, C, D])} fill={topColor || shade(color, 0.12)} /></g>;
}
/** Chunky pyramid roof with eaves. */
function IsoRoof({ x, y, w, d, z, rise, color }: { x: number; y: number; w: number; d: number; z: number; rise: number; color: string }) {
  const e = 0.18, A = iso(x - e, y - e, z), B = iso(x + w + e, y - e, z), C = iso(x + w + e, y + d + e, z), D = iso(x - e, y + d + e, z), P = iso(x + w / 2, y + d / 2, z + rise);
  return <g><polygon points={pts([A, B, P])} fill={shade(color, 0.05)} /><polygon points={pts([D, C, P])} fill={shade(color, -0.05)} /><polygon points={pts([C, B, P])} fill={shade(color, -0.25)} /><polyline points={pts([D, C, B])} fill="none" stroke={shade(color, -0.45)} strokeWidth="2.5" strokeLinejoin="round" /></g>;
}
/** Door on the left (front-left) face of a block. */
function IsoDoor({ x, y, w, d, h, color }: { x: number; y: number; w: number; d: number; h: number; color: string }) {
  const Db = iso(x, y + d), Cb = iso(x + w, y + d), u1 = lerp(Db, Cb, 0.38), u2 = lerp(Db, Cb, 0.62);
  return <g><polygon points={pts([u1, u2, [u2[0], u2[1] - h], [u1[0], u1[1] - h]])} fill={color} /><circle cx={u2[0] - 4} cy={u2[1] - h / 2} r="1.6" fill="#fde68a" /></g>;
}
/** Windows on the right face of a block, one row per floor. */
function IsoWindows({ x, y, w, d, floors, floorH, base = 10, glow = false }: { x: number; y: number; w: number; d: number; floors: number; floorH: number; base?: number; glow?: boolean }) {
  const Cb = iso(x + w, y + d), Bb = iso(x + w, y), out: ReactNode[] = [];
  for (let f = 0; f < floors; f++) for (const t of [0.25, 0.62]) {
    const a = lerp(Cb, Bb, t), b = lerp(Cb, Bb, t + 0.18), z = base + f * floorH;
    out.push(<polygon key={`${f}-${t}`} points={pts([[a[0], a[1] - z], [b[0], b[1] - z], [b[0], b[1] - z - floorH * 0.5], [a[0], a[1] - z - floorH * 0.5]])} fill={glow ? "#fde68a" : "#bae6fd"} stroke="rgba(0,0,0,.18)" strokeWidth="1" />);
  }
  return <>{out}</>;
}
function IsoTile({ x, y, w = 1, d = 1, fill, opacity = 1 }: { x: number; y: number; w?: number; d?: number; fill: string; opacity?: number }) {
  return <polygon points={pts([iso(x, y), iso(x + w, y), iso(x + w, y + d), iso(x, y + d)])} fill={fill} opacity={opacity} />;
}

/** A tappable building: lifts on hover, squashes on tap, shows its name plate. */
function Spot({ id, label, poked, onTap, children, labelAt, badge }: { id: string; label: string; poked: string; onTap: () => void; children: ReactNode; labelAt: [number, number]; badge?: number }) {
  return <g className={`ow-spot${poked === id ? " poked" : ""}`} role="button" tabIndex={0} aria-label={label} onClick={onTap} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTap(); } }}>
    <g className="ow-spot-body">{children}</g>
    <g className="ow-plate" transform={`translate(${labelAt[0]} ${labelAt[1]})`}><rect x={-label.length * 3.6 - 10} y="-12" width={label.length * 7.2 + 20} height="22" rx="11" fill="#111827" opacity=".85" /><text y="3.5" textAnchor="middle" fontSize="11" fontWeight="800" fill="#fff">{label}</text></g>
    {badge ? <g transform={`translate(${labelAt[0] + 34} ${labelAt[1] - 16})`} className="ow-badge"><circle r="10" fill="#ef4444" stroke="#fff" strokeWidth="2" /><text y="4" textAnchor="middle" fontSize="11" fontWeight="900" fill="#fff">{badge > 9 ? "9+" : badge}</text></g> : null}
  </g>;
}

type BeanLook = { color: string; accessory?: "headset" | "tie" | "glasses" | "hardhat" | "beret" | "clock" | "crown"; hat?: string; tool?: string; trim?: string; tie?: boolean; shades?: boolean; crown?: boolean };
/** Adult characters: realistic proportions, role-based clothing, one neutral stylised tone (no skin tones), understated faces. */
function Bean({ at, look, mood = "calm", scale = 1, className = "", label, onTap, alert }: { at: [number, number]; look: BeanLook; mood?: string; scale?: number; className?: string; label: string; onTap?: () => void; alert?: boolean }) {
  const jacket = look.color, jacketDark = shade(jacket, -0.28), skin = "#d6d3d1", skinShade = "#bcb8b4", hair = "#3f3f46";
  const hivis = look.accessory === "hardhat";
  const trousers = hivis ? "#44403c" : look.accessory === "headset" ? "#1f2937" : "#334155";
  const brows = mood === "panicked" || mood === "concerned";
  const hairStyle = look.accessory === "headset" ? "bun" : look.accessory === "glasses" ? "bob" : look.accessory === "beret" ? "wave" : look.accessory === "tie" ? "part" : "short";
  return <g className={`ow-bean ow-person-adult ${className}`} transform={`translate(${at[0]} ${at[1]}) scale(${scale})`} role={onTap ? "button" : undefined} tabIndex={onTap ? 0 : undefined} aria-label={label} onClick={onTap} onKeyDown={onTap ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onTap(); } } : undefined}>
    <ellipse cx="0" cy="1" rx="10" ry="3.5" fill="rgba(0,0,0,.22)" />
    <g className="ow-bean-body">
      {/* legs + shoes */}
      <rect x="-5" y="-19" width="4.2" height="19" rx="1.6" fill={trousers} /><rect x="0.8" y="-19" width="4.2" height="19" rx="1.6" fill={shade(trousers, -0.15)} />
      <ellipse cx="-3" cy="0" rx="3.4" ry="1.6" fill="#18181b" /><ellipse cx="3" cy="0" rx="3.4" ry="1.6" fill="#18181b" />
      {/* torso + arms */}
      <rect x="-10.5" y="-34" width="3.4" height="15" rx="1.7" fill={jacketDark} /><rect x="7.1" y="-34" width="3.4" height="15" rx="1.7" fill={jacketDark} />
      <circle cx="-8.8" cy="-18.5" r="1.8" fill={skin} /><circle cx="8.8" cy="-18.5" r="1.8" fill={skin} />
      <path d="M-8 -35 h16 a2 2 0 0 1 2 2 v15 h-20 v-15 a2 2 0 0 1 2 -2z" fill={jacket} />
      {!hivis && <path d="M-3.2 -35 L0 -29 L3.2 -35 Z" fill="#f8fafc" />}
      {hivis && <><rect x="-8" y="-29" width="16" height="2" fill="#fef08a" opacity=".9" /><rect x="-8" y="-23" width="16" height="2" fill="#fef08a" opacity=".9" /></>}
      {(look.accessory === "tie" || look.tie) && <path d="M-1.2 -33 L1.2 -33 L1.6 -24 L0 -22 L-1.6 -24 Z" fill={look.accessory === "tie" ? "#7f1d1d" : "#111827"} />}
      {look.accessory === "beret" && <path d="M-7 -35 q7 5 14 0 l-1 3 q-6 4 -12 0z" fill="#be185d" />}
      {/* neck + head */}
      <rect x="-1.6" y="-38" width="3.2" height="3.5" fill={skinShade} />
      <ellipse cx="0" cy="-43" rx="5.4" ry="6.1" fill={skin} />
      {hairStyle === "bun" && <><path d="M-5.6 -44 a5.6 5.6 0 0 1 11.2 0 q-5.6 -3 -11.2 0z" fill={hair} /><circle cx="0" cy="-50" r="2.6" fill={hair} /></>}
      {hairStyle === "part" && <path d="M-5.6 -43.5 q0 -7 6 -6.6 q5.6 0.4 5.2 6 q-3 -3.4 -6.4 -3.2 q-3 0.2 -4.8 3.8z" fill={hair} />}
      {hairStyle === "bob" && <path d="M-6 -40 q-1 -10 6 -10 q7 0 6 10 l-1.6 0 q0 -5 -4.4 -6 q-4 1 -4.4 6z" fill={hair} />}
      {hairStyle === "wave" && <path d="M-5.8 -44 q1 -7 6 -6.6 q5 0 5.6 6.4 q-1.8 -2 -3 -1 q-1.5 -2 -3 -0.6 q-1.6 -1.6 -3 0 q-1.4 -1.4 -2.6 1.8z" fill={hair} />}
      {hairStyle === "short" && !look.hat && !hivis && <path d="M-5.4 -44 a5.4 5.4 0 0 1 10.8 0 q-5.4 -2.4 -10.8 0z" fill={hair} />}
      <circle cx="-2" cy="-43" r="0.9" fill="#27272a" /><circle cx="2" cy="-43" r="0.9" fill="#27272a" />
      {brows && <><path d="M-3.4 -45.6 L-0.8 -45" stroke="#27272a" strokeWidth=".8" strokeLinecap="round" /><path d="M3.4 -45.6 L0.8 -45" stroke="#27272a" strokeWidth=".8" strokeLinecap="round" /></>}
      {mood === "panicked" ? <ellipse cx="0" cy="-39.6" rx="1.1" ry="1.3" fill="#27272a" /> : mood === "concerned" ? <path d="M-1.6 -39.3 q1.6 -1 3.2 0" stroke="#27272a" strokeWidth=".8" fill="none" strokeLinecap="round" /> : <path d="M-1.6 -40 q1.6 1.2 3.2 0" stroke="#27272a" strokeWidth=".8" fill="none" strokeLinecap="round" />}
      {/* role details */}
      {look.accessory === "headset" && <><path d="M-5.6 -44 a5.6 5.6 0 0 1 11.2 0" stroke="#18181b" strokeWidth="1.1" fill="none" /><rect x="-6.6" y="-45" width="2" height="3.6" rx="1" fill="#18181b" /><path d="M-5.6 -41.6 q0.6 3 3.2 2.6" stroke="#18181b" strokeWidth=".8" fill="none" /></>}
      {look.accessory === "glasses" && <><rect x="-4.2" y="-44.4" width="3.4" height="2.6" rx="1" fill="none" stroke="#18181b" strokeWidth=".7" /><rect x="0.8" y="-44.4" width="3.4" height="2.6" rx="1" fill="none" stroke="#18181b" strokeWidth=".7" /></>}
      {(hivis || look.hat === "hardhat") && <><path d="M-6 -45.5 a6 5.4 0 0 1 12 0 z" fill="#facc15" /><rect x="-7" y="-46.2" width="14" height="1.8" rx=".9" fill="#ca8a04" /></>}
      {look.hat === "cap" && <><path d="M-5.6 -45.4 a5.6 4.8 0 0 1 11.2 0 z" fill={look.trim || jacketDark} /><rect x="1" y="-46" width="7" height="1.6" rx=".8" fill={look.trim || jacketDark} /></>}
      {look.hat === "beanie" && <path d="M-5.6 -44.5 a5.6 5.6 0 0 1 11.2 0 z" fill="#27272a" />}
      {look.accessory === "clock" && <g transform="translate(9 -26)"><rect x="0" y="0" width="6" height="8" rx="1" fill="#e2e8f0" stroke="#475569" strokeWidth=".6" /><rect x="1" y="1.4" width="4" height=".8" fill="#0ea5e9" /></g>}
      {look.shades && <><rect x="-4.6" y="-44.4" width="3.8" height="2.2" rx="1" fill="#0f172a" /><rect x="0.8" y="-44.4" width="3.8" height="2.2" rx="1" fill="#0f172a" /></>}
      {(look.crown || look.accessory === "crown") && <path d="M-4.4 -49 L-4.4 -53 L-2.2 -51 L0 -54 L2.2 -51 L4.4 -53 L4.4 -49 Z" fill="#d4a017" stroke="#92400e" strokeWidth=".5" />}
      {look.tool === "hammer" && <g transform="translate(10 -22) rotate(20)"><rect x="-0.8" y="0" width="1.6" height="10" fill="#78350f" /><rect x="-3" y="-1.5" width="6" height="2.5" rx=".6" fill="#71717a" /></g>}
      {look.tool === "drill" && <g transform="translate(9 -22)"><rect x="0" y="-2" width="7" height="4" rx="1" fill="#f59e0b" /><rect x="1" y="2" width="2.4" height="4" fill="#18181b" /></g>}
      {look.tool === "wrench" && <g transform="translate(10 -22) rotate(25)"><rect x="-0.8" y="0" width="1.6" height="9" rx=".8" fill="#a1a1aa" /><circle cx="0" cy="-0.6" r="2.2" fill="none" stroke="#a1a1aa" strokeWidth="1.4" /></g>}
      {(look.tool === "laptop" || look.accessory === "beret") && <g transform="translate(8 -25)"><rect x="0" y="0" width="7" height="9" rx="1" fill="#18181b" /><rect x=".8" y=".8" width="5.4" height="7" rx=".6" fill="#38bdf8" opacity=".7" /></g>}
      {(look.tool === "clipboard" || look.tool === "swatch" || look.tool === "mirror" || look.tool === "scissors" || look.tool === "tattoo") && <g transform="translate(8.5 -26)"><rect x="0" y="0" width="6" height="8" rx="1" fill="#fef3c7" stroke="#92400e" strokeWidth=".6" /></g>}
    </g>
    {alert && <g className="ow-alert" transform="translate(0 -62)"><circle r="7" fill="#dc2626" stroke="#fff" strokeWidth="1.8" /><text y="3.6" textAnchor="middle" fontSize="10" fontWeight="900" fill="#fff">!</text></g>}
  </g>;
}

/** Tappable coin stack over whoever earned it. */
function CoinBubble({ x, y, amount, onCollect, label }: { x: number; y: number; amount: number; onCollect: () => void; label: string }) {
  return <g className="ow-coin-bubble" transform={`translate(${x} ${y})`} role="button" tabIndex={0} aria-label={label} onClick={onCollect} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onCollect(); } }}>
    <g className="ow-coin-bob"><circle r="15" fill="#fbbf24" stroke="#b45309" strokeWidth="2.5" /><circle r="10" fill="none" stroke="#fde68a" strokeWidth="2" /><path d="M-4 -6 L4 -6 L1.5 6 L-1.5 6 Z" fill="#b45309" opacity=".0" /><text y="5" textAnchor="middle" fontSize="13" fontWeight="900" fill="#92400e">★</text>
      <rect x="-19" y="16" width="38" height="16" rx="8" fill="#78350f" stroke="#fff" strokeWidth="1.5" /><text y="28" textAnchor="middle" fontSize="10.5" fontWeight="900" fill="#fff">+{amount}</text></g>
  </g>;
}

// Where everyone lives on the island (grid units, 0–12).
const EMP_SPOTS: Record<EmployeeId, [number, number]> = { receptionist: [7.0, 8.7], accountant: [4.2, 9.0], calendar: [3.0, 7.0], projects: [2.9, 11.7], sales: [9.0, 7.0], marketing: [7.9, 2.0] };
const GRASS_SPOTS: Array<[number, number]> = [[1.2, 8.2], [8.2, 2.2], [3.6, 3.6], [8.6, 6.8], [0.9, 10.8], [11.2, 5.6], [4.0, 0.8], [6.9, 10.4], [2.2, 11.6], [10.8, 11.5]];
const EMP_LOOK: Record<EmployeeId, BeanLook> = {
  receptionist: { color: "#9d4b6e", accessory: "headset" }, sales: { color: "#1e3a5f", accessory: "tie" }, accountant: { color: "#2f5d50", accessory: "glasses" },
  projects: { color: "#ea7a1f", accessory: "hardhat" }, marketing: { color: "#5b4a8a", accessory: "beret" }, calendar: { color: "#2a6f97", accessory: "clock" },
};
const IDLE_LINES: Record<EmployeeId, string[]> = {
  receptionist: ["Phones are quiet… for now.", "I'll shout the second someone walks in!", "Reception's spotless, boss."],
  sales: ["Got my lucky tie on today.", "Every lead is a future job!", "Let's close something big."],
  accountant: ["Books are balanced. Bliss.", "Receipts in, coins out!", "I love a tidy spreadsheet."],
  projects: ["Kit's sorted and ready.", "Hard hat on, let's build.", "On site and on time."],
  marketing: ["Our brand's looking sharp!", "Thinking up the next big idea…", "Reviews feed isn't connected yet — I'm ready when it is."],
  calendar: ["Diary's under control.", "Want me to fill tomorrow?", "Tick-tock, I've got the times."],
};

/** A crop = a real open lead. Grows with its pipeline stage, wilts when neglected, ripens when the job is won. */
type Crop = { id: string; name: string; growth: number; ripe: boolean; wilting: boolean };
function CropPlant({ at, crop, onTap }: { at: [number, number]; crop: Crop; onTap?: () => void }) {
  const leaf = crop.wilting ? "#a3a35a" : "#22c55e", leafDark = crop.wilting ? "#8a7f3d" : "#15803d";
  const g = crop.ripe ? 4 : Math.min(3, crop.growth);
  return <g className={`ow-crop${crop.ripe ? " ripe" : ""}${crop.wilting ? " wilting" : ""}`} transform={`translate(${at[0]} ${at[1]})`} role={onTap ? "button" : undefined} tabIndex={onTap ? 0 : undefined} aria-label={`${crop.name}: ${crop.ripe ? "job won — ready to harvest" : crop.wilting ? "wilting, needs attention" : ["just planted", "sprouting", "growing", "nearly there"][g]}`} onClick={onTap} onKeyDown={onTap ? (e) => { if (e.key === "Enter") onTap(); } : undefined}>
    <ellipse cx="0" cy="0" rx="9" ry="4" fill="#7c2d12" opacity=".55" />
    <g className="ow-crop-body">
      {g === 0 && <ellipse cx="0" cy="-2" rx="5" ry="3" fill="#92400e" />}
      {g >= 1 && <path d="M0 0 V-8" stroke={leafDark} strokeWidth="2" />}
      {g >= 1 && <><ellipse cx="-4" cy="-9" rx="4" ry="2.2" fill={leaf} transform="rotate(-30 -4 -9)" /><ellipse cx="4" cy="-9" rx="4" ry="2.2" fill={leaf} transform="rotate(30 4 -9)" /></>}
      {g >= 2 && <><path d="M0 -8 V-18" stroke={leafDark} strokeWidth="2" /><ellipse cx="-5" cy="-16" rx="5" ry="2.6" fill={leaf} transform="rotate(-35 -5 -16)" /><ellipse cx="5" cy="-17" rx="5" ry="2.6" fill={leaf} transform="rotate(35 5 -17)" /></>}
      {g >= 3 && !crop.ripe && <circle cx="0" cy="-21" r="3.5" fill={crop.wilting ? "#a16207" : "#fde047"} />}
      {crop.ripe && <><circle cx="0" cy="-23" r="7" fill="#f97316" stroke="#c2410c" strokeWidth="1.5" /><path d="M0 -30 V-27" stroke="#15803d" strokeWidth="2" /><path className="ow-sparkle" d="M10 -30 l1.5 3 3 1.5 -3 1.5 -1.5 3 -1.5 -3 -3 -1.5 3 -1.5z" fill="#fde047" /></>}
    </g>
  </g>;
}


// ───────────── Lifestyle upgrades ─────────────
function Home({ tier, primary, secondary }: { tier: number; primary: string; secondary: string }) {
  if (!tier) return <IsoTile x={8.8} y={0.8} w={2.2} d={1.8} fill="#ffffff" opacity={0.12} />;
  if (tier === 1) return <g><IsoBox x={9.0} y={1.0} w={1.6} d={1.4} h={26} color="#fde68a" /><IsoRoof x={9.0} y={1.0} w={1.6} d={1.4} z={26} rise={22} color="#b91c1c" /><IsoDoor x={9.0} y={1.0} w={1.6} d={1.4} h={16} color="#7c2d12" /><IsoWindows x={9.0} y={1.0} w={1.6} d={1.4} floors={1} floorH={18} base={6} glow /></g>;
  if (tier === 2) return <g><IsoBox x={8.8} y={0.8} w={2.2} d={1.8} h={50} color="#f8fafc" /><IsoRoof x={8.8} y={0.8} w={2.2} d={1.8} z={50} rise={18} color={secondary} /><IsoWindows x={8.8} y={0.8} w={2.2} d={1.8} floors={2} floorH={20} base={8} glow /><IsoDoor x={8.8} y={0.8} w={2.2} d={1.8} h={18} color={primary} /><polyline points={pts([iso(8.7, 2.7, 26), iso(11.1, 2.7, 26)])} stroke="#94a3b8" strokeWidth="3" /></g>;
  const L = iso(8.6, 2.8), R = iso(11.3, 2.8);
  return <g><IsoBox x={8.6} y={0.6} w={2.7} d={2.2} h={62} color="#f5f5f4" /><IsoRoof x={8.6} y={0.6} w={2.7} d={2.2} z={62} rise={20} color="#1f2937" /><IsoWindows x={8.6} y={0.6} w={2.7} d={2.2} floors={2} floorH={24} base={10} glow />
    {[0.2, 0.4, 0.6, 0.8].map((t) => { const c = lerp(L, R, t); return <rect key={t} x={c[0] - 2.5} y={c[1] - 58} width="5" height="58" fill="#fff" stroke="#d6d3d1" />; })}
    <IsoDoor x={8.6} y={0.6} w={2.7} d={2.2} h={26} color="#a16207" /><polyline points={pts([iso(8.4, 3.2, 10), iso(11.5, 3.2, 10)])} stroke="#fbbf24" strokeWidth="2.5" strokeDasharray="3 3" /></g>;
}
function Pool({ tier, primary }: { tier: number; primary: string }) {
  if (!tier) return null;
  const w = tier >= 2 ? 2.0 : 1.4;
  return <g className="ow-pool"><IsoTile x={8.7} y={3.2} w={w + 0.3} d={1.0} fill={tier >= 3 ? "#d6a77a" : "#e5e7eb"} /><IsoTile x={8.85} y={3.35} w={w} d={0.7} fill="#38bdf8" /><IsoTile x={8.95} y={3.42} w={w - 0.3} d={0.25} fill="#bae6fd" opacity={0.7} />
    {tier >= 2 && [0, 1].map((i) => { const [sx, sy] = iso(8.9 + i * 0.7, 4.35); return <rect key={i} x={sx - 9} y={sy - 4} width="18" height="5" rx="2" fill="#fff" stroke="#cbd5e1" />; })}
    {tier >= 3 && (() => { const [sx, sy] = iso(9.6, 3.7); return <g className="ow-float"><ellipse cx={sx} cy={sy} rx="7" ry="4" fill="none" stroke="#f472b6" strokeWidth="3.5" /><path d={`M${sx + 22} ${sy - 30} Q${sx + 36} ${sy - 44} ${sx + 50} ${sy - 30} Z`} fill={primary} /><rect x={sx + 35} y={sy - 30} width="2" height="24" fill="#6b7280" /></g>; })()}
  </g>;
}
function Car({ tier, primary }: { tier: number; primary: string }) {
  if (!tier) return null;
  const [x, y] = iso(8.4, 8.0);
  const body = tier >= 3 ? (tier >= 4 ? "#111827" : "#dc2626") : primary;
  const len = tier === 2 ? 44 : 38, tall = tier === 2 ? 20 : tier >= 3 ? 11 : 15;
  return <g className="ow-car" transform={`translate(${x} ${y}) rotate(26.6)`}>
    <ellipse cx="0" cy="4" rx={len / 2 + 4} ry="5" fill="rgba(0,0,0,.2)" />
    <rect x={-len / 2} y={-tall} width={len} height={tall} rx={tier >= 3 ? 6 : 4} fill={body} />
    <path d={tier >= 3 ? `M${-len / 6} ${-tall} L${-len / 12} ${-tall - 7} L${len / 5} ${-tall - 7} L${len / 3} ${-tall} Z` : `M${-len / 4} ${-tall} L${-len / 6} ${-tall - 9} L${len / 4} ${-tall - 9} L${len / 3} ${-tall} Z`} fill={tier >= 4 ? "#fbbf24" : "#bae6fd"} opacity=".9" />
    {[-len / 3, len / 3].map((cx) => <circle key={cx} cx={cx} cy="0" r="4.5" fill="#111827" stroke={tier >= 4 ? "#fbbf24" : "#9ca3af"} strokeWidth="2" />)}
  </g>;
}
function Air({ tier, primary, reduced }: { tier: number; primary: string; reduced: boolean }) {
  if (!tier) return null;
  const [hx, hy] = iso(1.1, 8.0);
  return <g>
    <IsoTile x={0.3} y={7.2} w={1.6} d={1.6} fill="#475569" /><IsoTile x={0.45} y={7.35} w={1.3} d={1.3} fill="#64748b" />
    <text x={hx} y={hy + 5} textAnchor="middle" fontSize="14" fontWeight="900" fill="#fbbf24">H</text>
    {tier >= 2 && <g transform={`translate(${hx} ${hy - 8})`}><ellipse cx="0" cy="0" rx="16" ry="9" fill={primary} stroke={shade(primary, -0.4)} strokeWidth="1.5" /><ellipse cx="5" cy="-2" rx="7" ry="5" fill="#bae6fd" /><rect x="-30" y="-3" width="18" height="3" rx="1.5" fill={shade(primary, -0.3)} /><rect x="-1" y="-14" width="2" height="6" fill="#374151" /><g className={reduced ? "" : "ow-rotor"}><rect x="-26" y="-16" width="52" height="2.5" rx="1.2" fill="#1f2937" /></g></g>}
    {tier >= 3 && <g className="ow-jet"><g transform="translate(0 40)"><path d="M0 0 L46 -4 L58 0 L46 4 Z" fill="#fff" stroke="#94a3b8" /><path d="M20 -2 L30 -16 L36 -2 Z" fill={primary} /><path d="M20 2 L30 16 L36 2 Z" fill={primary} /><path d="M2 0 L-6 -10 L6 -2 Z" fill={primary} /><circle cx="48" cy="0" r="1.6" fill="#38bdf8" /></g></g>}
  </g>;
}


// ───────────── Town life: walkers, agents, the Tax Man ─────────────
/** Moves its children along a route forever (SVG animateMotion). Static at the start point when motion is reduced. */
function Walker({ route, dur, reduced, delay = 0, children }: { route: Array<[number, number]>; dur: number; reduced: boolean; delay?: number; children: ReactNode }) {
  const d = `M${route.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L")}`;
  if (reduced) return <g transform={`translate(${route[0][0]} ${route[0][1]})`}>{children}</g>;
  return <g>{children}<animateMotion dur={`${dur}s`} begin={`${-delay}s`} repeatCount="indefinite" path={d} calcMode="linear" /></g>;
}
const there = (a: [number, number], b: [number, number]) => [iso(...a), iso(...b), iso(...b), iso(...a), iso(...a)];
const ROUTES: Array<Array<[number, number]>> = [
  there([6.0, 8.2], [4.6, 10.9]), there([7.2, 8.0], [9.2, 6.8]), there([5.2, 8.1], [2.4, 6.9]), there([8.6, 6.6], [10.4, 9.9]), there([8.5, 4.2], [8.2, 2.6]),
];
function Robot({ sleeping, label, onTap }: { sleeping?: boolean; label: string; onTap?: () => void }) {
  return <g className={`ow-robot${sleeping ? " sleeping" : ""}`} role="button" tabIndex={0} aria-label={label} onClick={onTap} onKeyDown={(e) => { if (e.key === "Enter") onTap?.(); }}>
    <ellipse cx="0" cy="1" rx="10" ry="3.5" fill="rgba(0,0,0,.2)" />
    <g className="ow-bean-body">
      <rect x="-10" y="-26" width="20" height="24" rx="6" fill="#e2e8f0" stroke="#64748b" strokeWidth="1.5" />
      <rect x="-7" y="-22" width="14" height="9" rx="3" fill="#0f172a" />
      {sleeping ? <><path d="M-5 -17 h3 M2 -17 h3" stroke="#38bdf8" strokeWidth="1.6" strokeLinecap="round" /></> : <><circle cx="-3" cy="-17.5" r="1.8" fill="#38bdf8" className="ow-led" /><circle cx="3" cy="-17.5" r="1.8" fill="#38bdf8" className="ow-led" /></>}
      <path d="M0 -26 V-32" stroke="#64748b" strokeWidth="1.5" /><circle cx="0" cy="-33" r="2.2" fill="#f43f5e" className="ow-led" />
      {!sleeping && <rect x="8" y="-14" width="8" height="10" rx="1" fill="#fde68a" stroke="#92400e" strokeWidth=".8" />}
    </g>
    {sleeping && <text x="10" y="-30" fontSize="11" fontWeight="900" fill="#475569" className="ow-zzz">z z z</text>}
  </g>;
}
function TaxMan({ at, onTap }: { at: [number, number]; onTap: () => void }) {
  return <g className="ow-taxman" transform={`translate(${at[0]} ${at[1]})`} role="button" tabIndex={0} aria-label="The Tax Man: expenses are missing receipts" onClick={onTap} onKeyDown={(e) => { if (e.key === "Enter") onTap(); }}>
    <ellipse cx="0" cy="1" rx="13" ry="4.5" fill="rgba(0,0,0,.22)" />
    <g className="ow-bean-body">
      <rect x="-12" y="-36" width="24" height="35" rx="12" fill="#334155" stroke="#0f172a" strokeWidth="1.5" />
      <path d="M-3 -20 L0 -8 L3 -20 Z" fill="#fff" /><path d="M-1.5 -19 L0 -15 L1.5 -19 Z" fill="#b91c1c" />
      <ellipse cx="-4.5" cy="-27" rx="3.6" ry="4.2" fill="#fff" /><ellipse cx="4.5" cy="-27" rx="3.6" ry="4.2" fill="#fff" /><circle cx="-4" cy="-26.5" r="1.8" fill="#111827" /><circle cx="5" cy="-26.5" r="1.8" fill="#111827" />
      <circle cx="4.5" cy="-27" r="5" fill="none" stroke="#fbbf24" strokeWidth="1.4" /><path d="M9.5 -27 q3 6 1 12" stroke="#fbbf24" strokeWidth="1" fill="none" />
      <path d="M-6 -33 q6 3 12 0" stroke="#e5e7eb" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <rect x="-9" y="-50" width="18" height="14" rx="2" fill="#111827" /><rect x="-13" y="-37" width="26" height="3.5" rx="1.5" fill="#111827" /><rect x="-9" y="-41" width="18" height="2.5" fill="#b91c1c" />
      <g className="ow-knock"><rect x="-17" y="-24" width="6" height="12" rx="3" fill="#334155" /><circle cx="-14" cy="-26" r="3.4" fill="#e5e7eb" /></g>
      <rect x="9" y="-16" width="9" height="12" rx="1" fill="#f8fafc" stroke="#64748b" strokeWidth=".8" />
    </g>
    <g className="ow-alert" transform="translate(0 -62)"><rect x="-18" y="-9" width="36" height="16" rx="8" fill="#b91c1c" stroke="#fff" strokeWidth="1.5" /><text y="3" textAnchor="middle" fontSize="9" fontWeight="900" fill="#fff">KNOCK</text></g>
  </g>;
}

/** Picture for each upgrade track in the shop. */
function UpgradeArt({ id, tier, primary, secondary }: { id: string; tier: number; primary: string; secondary: string }) {
  const g = (children: ReactNode) => <svg viewBox="0 0 80 60" width="80" height="60" aria-hidden="true" className="ow-up-art"><rect width="80" height="60" rx="12" fill="#e0f2fe" /><ellipse cx="40" cy="50" rx="30" ry="6" fill="#86d36b" />{children}</svg>;
  switch (id) {
    case "hq": return g(<><rect x="20" y={22 - tier * 2} width="40" height={28 + tier * 2} rx="3" fill="#f5efe3" stroke="#d6cfc2" /><path d={`M16 ${23 - tier * 2} L40 ${8 - tier * 2} L64 ${23 - tier * 2} Z`} fill={secondary} /><rect x="35" y="38" width="10" height="12" fill={primary} />{Array.from({ length: Math.min(3, 1 + tier) }).map((_, i) => <g key={i}><rect x="24" y={26 - tier * 2 + i * 8} width="8" height="5" fill="#bae6fd" /><rect x="48" y={26 - tier * 2 + i * 8} width="8" height="5" fill="#bae6fd" /></g>)}</>);
    case "reception": return g(<><rect x="16" y="32" width="48" height="16" rx="3" fill={tier >= 3 ? "#f1f5f9" : "#a16207"} stroke="#78350f" /><rect x="14" y="28" width="52" height="6" rx="2" fill={primary} /><circle cx="52" cy="22" r="6" fill="#16a34a" /><rect x="22" y="36" width="20" height="3" rx="1.5" fill="#fbbf24" /></>);
    case "garden": return g(<>{tier >= 3 ? <><ellipse cx="40" cy="44" rx="20" ry="7" fill="#60a5fa" stroke="#cbd5e1" strokeWidth="3" /><rect x="38" y="26" width="4" height="16" fill="#e2e8f0" /><circle cx="40" cy="24" r="5" fill="#bfdbfe" /></> : tier >= 2 ? <><rect x="37" y="30" width="6" height="18" fill="#78350f" /><circle cx="40" cy="24" r="14" fill="#22c55e" /></> : <>{[22, 34, 46, 58].map((x, i) => <g key={x}><rect x={x - 1} y="38" width="2" height="10" fill="#4d7c0f" /><circle cx={x} cy="36" r="5" fill={i % 2 ? "#facc15" : "#f472b6"} /></g>)}</>}</>);
    case "workshop": return g(<><rect x="14" y="24" width="52" height="26" rx="2" fill="#e5e7eb" stroke="#94a3b8" /><rect x="14" y="20" width="52" height="7" rx="2" fill={secondary} /><rect x="22" y="31" width="36" height="19" fill="#9ca3af" />{[34, 38, 42, 46].map((y) => <line key={y} x1="22" x2="58" y1={y} y2={y} stroke="#6b7280" />)}</>);
    case "fleet": return g(<><rect x="12" y="28" width="46" height="18" rx="4" fill={primary} /><rect x="56" y="32" width="12" height="14" rx="3" fill={primary} /><rect x="58" y="34" width="8" height="6" rx="1" fill="#bae6fd" /><circle cx="24" cy="48" r="5" fill="#111827" /><circle cx="56" cy="48" r="5" fill="#111827" /></>);
    case "signage": return g(<><rect x="12" y="20" width="56" height="20" rx="6" fill="#111827" stroke={primary} strokeWidth="2.5" /><text x="40" y="34" textAnchor="middle" fontSize="10" fontWeight="900" fill="#fff">OPEN</text><rect x="38" y="40" width="4" height="10" fill="#57534e" /></>);
    case "cafe": return g(<><path d="M20 30 Q40 12 60 30 Z" fill={primary} /><rect x="39" y="30" width="2" height="16" fill="#6b7280" /><ellipse cx="40" cy="47" rx="16" ry="4" fill="#f1f5f9" /><rect x="52" y="36" width="8" height="9" rx="2" fill="#78350f" /></>);
    case "renovation": return g(<><rect x="18" y="16" width="34" height="34" fill={tier >= 3 ? "#292524" : tier >= 2 ? "#7dd3fc" : "#f5efe3"} stroke="#94a3b8" /><g transform="translate(50 20) rotate(30)"><rect x="0" y="0" width="16" height="8" rx="2" fill={primary} /><rect x="6" y="8" width="4" height="16" fill="#78350f" /></g></>);
    case "interior": return g(<><rect x="14" y="14" width="52" height="36" rx="4" fill="#fef3c7" /><path d="M40 14 V22" stroke="#92400e" /><path d="M32 22 h16 l-4 6 h-8 z" fill="#fbbf24" /><rect x="18" y="34" width="22" height="12" rx="3" fill={primary} /><circle cx="56" cy="38" r="6" fill="#16a34a" /><rect x="54" y="42" width="4" height="6" fill="#92400e" /></>);
    case "home": return g(<>{tier >= 3 ? <><rect x="12" y="20" width="56" height="30" fill="#f5f5f4" stroke="#d6d3d1" />{[20, 32, 44, 56].map((x) => <rect key={x} x={x} y="24" width="3" height="26" fill="#fff" stroke="#d6d3d1" />)}<path d="M8 21 L40 8 L72 21 Z" fill="#1f2937" /></> : <><rect x="22" y="28" width="36" height="22" fill="#fde68a" /><path d="M18 29 L40 14 L62 29 Z" fill="#b91c1c" /><rect x="36" y="38" width="8" height="12" fill="#7c2d12" /></>}</>);
    case "pool": return g(<><rect x="12" y="30" width="56" height="18" rx="6" fill="#e5e7eb" /><rect x="16" y="33" width="48" height="12" rx="4" fill="#38bdf8" /><path d="M20 38 q6 -4 12 0 t12 0 t12 0" stroke="#bae6fd" strokeWidth="2" fill="none" /><ellipse cx="54" cy="38" rx="5" ry="3" fill="none" stroke="#f472b6" strokeWidth="2.5" /></>);
    case "car": return g(<><rect x="14" y="32" width="52" height={tier >= 3 ? 10 : 14} rx="6" fill={tier >= 4 ? "#111827" : tier >= 3 ? "#dc2626" : primary} /><path d={tier >= 3 ? "M28 32 L34 24 L50 24 L56 32 Z" : "M24 32 L30 20 L50 20 L58 32 Z"} fill="#bae6fd" /><circle cx="26" cy="46" r="6" fill="#111827" stroke={tier >= 4 ? "#fbbf24" : "#9ca3af"} strokeWidth="2" /><circle cx="54" cy="46" r="6" fill="#111827" stroke={tier >= 4 ? "#fbbf24" : "#9ca3af"} strokeWidth="2" /></>);
    case "air": return g(tier >= 3 ? <><path d="M10 30 L58 26 L72 30 L58 34 Z" fill="#fff" stroke="#94a3b8" /><path d="M34 28 L46 12 L52 28 Z" fill={primary} /><path d="M34 32 L46 48 L52 32 Z" fill={primary} /></> : tier >= 2 ? <><ellipse cx="40" cy="32" rx="16" ry="9" fill={primary} /><ellipse cx="45" cy="30" rx="7" ry="5" fill="#bae6fd" /><rect x="10" y="29" width="16" height="3" fill={primary} /><rect x="14" y="18" width="52" height="2.5" fill="#1f2937" /></> : <><ellipse cx="40" cy="42" rx="24" ry="9" fill="#475569" /><text x="40" y="46" textAnchor="middle" fontSize="12" fontWeight="900" fill="#fbbf24">H</text></>);
    case "wardrobe": return g(<><path d="M28 18 L36 14 L44 14 L52 18 L58 28 L52 30 L52 50 L28 50 L28 30 L22 28 Z" fill={primary} />{tier >= 2 && <path d="M38 16 L42 16 L41 34 L40 36 L39 34 Z" fill="#111827" />}{tier >= 4 && <path d="M30 12 L30 6 L35 9 L40 4 L45 9 L50 6 L50 12 Z" fill="#fbbf24" />}{tier >= 3 && <rect x="30" y="24" width="20" height="4" rx="2" fill="#111827" />}</>);
    default: return g(null);
  }
}


// ───────────── Inside HQ: every department is a room ─────────────
type RoomId = EmployeeId | "boss";
const ROOM_ORDER: RoomId[] = ["receptionist", "sales", "accountant", "calendar", "projects", "marketing", "boss"];
const ROOM_NAME: Record<RoomId, string> = { receptionist: "Reception", sales: "Sales", accountant: "Accounts", calendar: "Scheduling", projects: "Projects", marketing: "Marketing", boss: "Your office" };
function RoomArt({ id, primary, secondary, logo, look, mood }: { id: RoomId; primary: string; secondary: string; logo: string; look: BeanLook; mood: string }) {
  const wall = id === "boss" ? shade(secondary, 0.55) : shade(EMPLOYEES[id].colour, 0.72);
  return <svg viewBox="0 0 240 130" className="ow-room-art" aria-hidden="true">
    <polygon points="0,30 120,0 240,30 240,130 0,130" fill={wall} />
    <polygon points="0,88 120,62 240,88 120,130" fill="#d6cfc4" /><polygon points="0,88 120,130 120,131 0,131" fill="#c7bfb2" /><polygon points="240,88 120,130 120,131 240,131" fill="#bfb6a8" />
    <line x1="0" y1="88" x2="120" y2="62" stroke="#00000014" strokeWidth="2" /><line x1="240" y1="88" x2="120" y2="62" stroke="#00000014" strokeWidth="2" />
    {id === "receptionist" && <><rect x="70" y="78" width="100" height="22" rx="4" fill="#57534e" /><rect x="66" y="74" width="108" height="6" rx="3" fill={primary} /><circle cx="160" cy="70" r="4" fill="#d4a017" /><circle cx="200" cy="70" r="12" fill="#3f6212" /><rect x="196" y="80" width="8" height="12" fill="#78350f" /></>}
    {id === "sales" && <><rect x="150" y="22" width="60" height="40" rx="3" fill="#fff" stroke="#cbd5e1" />{[0, 1, 2, 3].map((i) => <rect key={i} x={158 + i * 12} y={52 - i * 8} width="8" height={6 + i * 8} fill={i === 3 ? "#16a34a" : "#94a3b8"} />)}<rect x="60" y="84" width="80" height="12" rx="3" fill="#44403c" /></>}
    {id === "accountant" && <><rect x="60" y="84" width="90" height="12" rx="3" fill="#44403c" />{[0, 1, 2].map((i) => <g key={i}>{[0, 1, 2, 3].map((j) => <ellipse key={j} cx={170 + i * 16} cy={92 - j * 3} rx="6" ry="2.2" fill="#d4a017" stroke="#92400e" strokeWidth=".6" />)}</g>)}<rect x="30" y="24" width="40" height="30" rx="2" fill="#fff" stroke="#cbd5e1" /><path d="M36 46 L46 36 L54 42 L64 30" stroke="#16a34a" strokeWidth="2" fill="none" /></>}
    {id === "calendar" && <><rect x="140" y="18" width="70" height="50" rx="3" fill="#fff" stroke="#cbd5e1" /><rect x="140" y="18" width="70" height="10" fill={primary} />{Array.from({ length: 12 }).map((_, i) => <rect key={i} x={146 + (i % 4) * 16} y={32 + Math.floor(i / 4) * 11} width="11" height="8" fill={i === 5 ? "#fde68a" : "#f1f5f9"} />)}<rect x="60" y="84" width="80" height="12" rx="3" fill="#44403c" /></>}
    {id === "projects" && <><rect x="140" y="80" width="80" height="14" rx="2" fill="#78350f" /><rect x="146" y="72" width="60" height="10" fill="#1d4ed8" opacity=".85" /><path d="M150 76 h50 M160 73 v8 M180 73 v8" stroke="#bfdbfe" strokeWidth="1" /><path d="M40 96 a10 8 0 0 1 20 0 z" fill="#facc15" /></>}
    {id === "marketing" && <><rect x="150" y="24" width="56" height="46" rx="3" fill={primary} />{logo ? <image href={logo} x="160" y="30" width="36" height="34" preserveAspectRatio="xMidYMid meet" /> : <text x="178" y="52" textAnchor="middle" fontSize="11" fontWeight="900" fill="#fff">AD</text>}<path d="M156 70 L150 100 M200 70 L206 100" stroke="#57534e" strokeWidth="3" /></>}
    {id === "boss" && <><rect x="150" y="16" width="70" height="44" rx="3" fill="#bfdbfe" stroke="#94a3b8" strokeWidth="3" /><path d="M150 50 L170 34 L186 46 L200 30 L220 44 V60 H150 Z" fill="#6f9a5a" /><rect x="50" y="82" width="120" height="16" rx="4" fill="#3b2a1e" /><path d="M40 70 h8 v-10 q4 -6 8 0 v10 h8" fill="#d4a017" /></>}
    <g transform="translate(110 104)"><Bean at={[0, 0]} scale={1.55} look={look} mood={mood} label="" /></g>
  </svg>;
}

function InsideHQ({ focus, data, approaches, wallet, onOpen, onAct, onClose, onFocus }: { focus: RoomId; data: WorldData; approaches: Approach[]; wallet: Wallet; onOpen: (k: PanelKind) => void; onAct: (a: "upgrades" | "history" | "settings") => void; onClose: () => void; onFocus: (r: RoomId) => void }) {
  const p = data.profile;
  const refs = useRef<Record<string, HTMLElement | null>>({});
  useEffect(() => { refs.current[focus]?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [focus]);
  const actions: Record<RoomId, Array<{ label: string; panel?: PanelKind; act?: "upgrades" | "history" | "settings" }>> = {
    receptionist: [{ label: "Reply to new leads", panel: "lead-replies" }, { label: "Conversations", panel: "conversations" }, { label: "Contacts", panel: "contacts" }],
    sales: [{ label: "Open the pipeline", panel: "leads" }, { label: "Contacts", panel: "contacts" }],
    accountant: [{ label: "Record a receipt", panel: "expense" }, { label: "Books", panel: "books" }, ...(data.scopeId ? [] : [{ label: "Invoices", panel: "invoicing" as PanelKind }])],
    calendar: [{ label: "Book & manage appointments", panel: "scheduling" }],
    projects: [{ label: "Task list", panel: "tasks" }, { label: "New task", panel: "task" }],
    marketing: [{ label: "Contacts", panel: "contacts" }],
    boss: [{ label: "Upgrades", act: "upgrades" }, { label: "Rewards & history", act: "history" }, { label: "Settings", act: "settings" }],
  };
  const counts: Partial<Record<RoomId, number>> = { receptionist: data.counts.leads + data.counts.unread, calendar: data.counts.bookingsUpcoming, projects: data.counts.openTasks };
  return <div className="ow-modal-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="ow-inside" role="dialog" aria-label={`Inside ${p.name} headquarters`}>
    <header>{p.logo ? <img src={p.logo} alt="" /> : null}<div><b>Inside {p.name} HQ</b><small>Level {wallet.level} · {wallet.stage.name} · tap a department</small></div><button type="button" className="ghost" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
    <div className="ow-rooms">{ROOM_ORDER.map((id) => {
      const approach = id === "boss" ? undefined : approaches.find((a) => a.employee === id);
      const person = id === "boss" ? { name: p.characterName, title: "Owner" } : EMPLOYEES[id];
      const look: BeanLook = id === "boss" ? { color: p.primary, trim: p.secondary, hat: p.outfit.hat === "hardhat" ? undefined : p.outfit.hat, tool: undefined, tie: true } : EMP_LOOK[id];
      const n = counts[id];
      return <article key={id} ref={(el) => { refs.current[id] = el; }} className={`ow-room${focus === id ? " focus" : ""}${approach && approach.urgency >= 75 ? " hot" : ""}`} onClick={() => onFocus(id)}>
        <RoomArt id={id} primary={p.primary} secondary={p.secondary} logo={p.logo} look={look} mood={approach?.mood || "calm"} />
        <div className="ow-room-body">
          <div className="ow-room-head"><b>{ROOM_NAME[id]}</b><span>{person.name} · {person.title}</span>{n ? <em>{n}</em> : null}</div>
          <p className={approach && approach.urgency >= 75 ? "hot" : ""}>{approach ? approach.line : id === "boss" ? `${wallet.coins.toLocaleString("en-IE")} coins · ${wallet.pending.length ? `${sumCoins(wallet.pending)} waiting to collect` : "all collected"}` : id === "marketing" ? "Reviews and social aren't connected yet — I'll speak up when they are." : "All calm in here."}</p>
          {approach?.detail && <small>{approach.detail}</small>}
          <div className="ow-options">{actions[id].map((a, i) => <button type="button" key={a.label} className={i === 0 ? "" : "ghost"} onClick={(e) => { e.stopPropagation(); if (a.panel) onOpen(a.panel); else if (a.act) onAct(a.act); }}>{a.label}</button>)}</div>
        </div>
      </article>;
    })}</div>
  </div></div>;
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
  const [poked, setPoked] = useState("");
  const [inside, setInside] = useState<RoomId | null>(null);
  const [raid, setRaid] = useState<{ coins: number; count: number; n: number } | null>(null);
  const [bubble, setBubble] = useState<{ text: string; at: [number, number]; n: number } | null>(null);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      // The Tax Man struck: play the raid.
      if (next.raids?.length) {
        const coins = next.raids.reduce((n, r) => n + r.coins, 0);
        setTimeout(() => {
          setRaid({ coins, count: next.raids!.length, n: Date.now() });
          if (prefs.current.sound) setTimeout(() => chime("steal"), 2200);
          setTimeout(() => toast([{ employee: "accountant", text: coins ? `The Tax Man just stole ${coins} coins! ${next.raids!.length} expense${next.raids!.length === 1 ? " has" : "s have"} gone a week without a receipt — add receipts to keep him away.` : `The Tax Man came for coins but your wallet was empty. Add receipts to keep him away.`, coins: 0 }]), 2400);
          setTimeout(() => setRaid(null), 6200);
        }, lastLevel.current ? 200 : 1200);
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
  const say = (id: string, text: string, at: [number, number]) => {
    setPoked(id); setTimeout(() => setPoked((cur) => (cur === id ? "" : cur)), 450);
    setBubble({ text, at, n: Date.now() });
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    bubbleTimer.current = setTimeout(() => setBubble(null), 3800);
    if (prefs.current.sound) chime("pop");
  };
  const openLead = (id: string) => setPanel({ kind: "lead-detail", focusId: id });
  const tapEmployee = (id: EmployeeId) => {
    const own = approaches.findIndex((a) => a.employee === id);
    if (own >= 0) setIndex(own);
    const lines = IDLE_LINES[id];
    say(id, own >= 0 ? approaches[own].line : lines[Math.floor(Math.random() * lines.length)], ((at) => [at[0], at[1] - 62] as [number, number])(iso(...EMP_SPOTS[id])));
    setTimeout(() => setInside(id), 650);
  };
  const tapOwner = () => { const at = iso(7.0, 11.5); setTimeout(() => setInside("boss"), 650); say("owner", approaches.length ? `${approaches.length} thing${approaches.length === 1 ? "" : "s"} need${approaches.length === 1 ? "s" : ""} me. Let's go!` : "Business is booming. Coffee time!", [at[0], at[1] - 58]); };
  const tapBuilding = (which: EmployeeId | "hq" | "farm") => {
    if (demo && which !== "hq" && which !== "marketing") { say(`b-${which}`, "Demo: buildings open your real screens outside the demo.", [500, 200]); return; }
    setPoked(`b-${which === "receptionist" ? "reception" : which === "accountant" ? "accounts" : which}`); setTimeout(() => setPoked(""), 450);
    if (prefs.current.sound) chime("pop");
    if (which === "hq") { setInside("boss"); return; }
    if (which === "marketing") { setInside("marketing"); return; }
    const target: Record<string, PanelKind> = { receptionist: customers.length ? "lead-replies" : "conversations", accountant: data.scopeId ? "books" : "invoicing", calendar: "scheduling", projects: "tasks", sales: "leads", farm: "leads" };
    setPanel({ kind: target[which] });
  };
  const floors = 1 + tier("hq");
  const customers = demo ? demoSnapshot().leads : data.customers;
  const waitingIds = new Set(customers.filter((c) => Date.now() - Date.parse(c.createdAt) > 24 * 3_600_000).map((c) => c.id));
  const healthMood = demo ? "busy" : data.health.mood;
  const approaching = current?.employee;
  const crops: Crop[] = demo ? demoSnapshot().leads.map((l, i) => ({ id: l.id, name: l.name, growth: i % 4, ripe: i === 4, wilting: i === 0 })) : (data.crops || []);
  const grassTufts: Array<[number, number]> = (healthMood === "struggling" ? GRASS_SPOTS : healthMood === "busy" ? GRASS_SPOTS.slice(0, 6) : healthMood === "steady" ? GRASS_SPOTS.slice(0, 2) : []);
  const pendingByEmployee = new Map<EmployeeId, Pending[]>();
  for (const item of w.pending) { const emp = EMPLOYEE_FOR_REWARD[item.kind as RewardKind] || "receptionist"; pendingByEmployee.set(emp, [...(pendingByEmployee.get(emp) || []), item]); }
  const pendingTotal = sumCoins(w.pending);
  const upgradesReady = UPGRADES.filter((t) => { const n = nextUpgrade(t.id, w.owned); return n && w.level >= n.minLevel && w.coins >= n.price; }).length;

  return <div className={`ow-root mood-${healthMood}${reduced ? " ow-reduced" : ""}`} style={{ ["--ow-primary" as string]: p.primary, ["--ow-secondary" as string]: p.secondary }}>
    {demo && <div className="ow-demo-banner" role="note"><Eye size={16} /> Demo — sample customers and figures. Nothing here is real, saved or sent. <button type="button" onClick={exitDemo}>Exit demo</button></div>}

    <header className="ow-hud">
      <div className="ow-hud-id">{p.logo ? <img src={p.logo} alt="" /> : <span className="ow-hud-dot" />}<div><b>{p.name}</b><small>Level {w.level} · {w.stage.name}</small></div></div>
      <div className="ow-xp" aria-label={`Experience: ${w.xpIntoLevel} of ${w.xpForNext} to the next level`}><div style={{ width: `${Math.round(w.progress * 100)}%` }} /><span>{w.xpIntoLevel} / {w.xpForNext} XP</span></div>
      <div className={`ow-coins${coinBurst ? " bump" : ""}${raid ? " robbed" : ""}`} key={`${coinBurst}-${raid?.n || 0}`} title="Virtual game coins — not real money"><Coins size={18} /> {w.coins.toLocaleString("en-IE")}</div>
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
        <div className="ow-stage-wrap">
        <svg viewBox="0 0 1000 560" role="img" aria-label={`${p.name} headquarters with ${customers.length} customers waiting`}>
          <defs>
            <linearGradient id="ow-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#a5c8dc" /><stop offset="1" stopColor="#e8f0f4" /></linearGradient>
            <linearGradient id="ow-grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#93b878" /><stop offset="1" stopColor="#6f9a5a" /></linearGradient>
          </defs>
          <rect width="1000" height="560" fill="url(#ow-sky)" className="ow-sky" />
          <g className="ow-clouds"><ellipse cx="140" cy="70" rx="58" ry="16" fill="#fff" opacity=".9" /><ellipse cx="180" cy="60" rx="36" ry="15" fill="#fff" opacity=".9" /><ellipse cx="820" cy="54" rx="50" ry="13" fill="#fff" opacity=".85" /><ellipse cx="860" cy="46" rx="30" ry="12" fill="#fff" opacity=".85" /></g>
          <ellipse cx="500" cy="318" rx="430" ry="214" fill="#7fa9c0" opacity=".35" className="ow-water" />
          {/* Island */}
          <polygon points={pts([iso(0, 12), iso(12, 12), iso(12, 12, -28), iso(0, 12, -28)])} fill="#8a6a4a" />
          <polygon points={pts([iso(12, 12), iso(12, 0), iso(12, 0, -28), iso(12, 12, -28)])} fill="#6f5439" />
          <polygon points={pts([iso(0, 12, -2), iso(12, 12, -2), iso(12, 0, -2)])} fill="none" stroke="#557a45" strokeWidth="4" />
          <polygon points={pts([iso(0, 0), iso(12, 0), iso(12, 12), iso(0, 12)])} fill="url(#ow-grass)" className="ow-grass" />
          {Array.from({ length: 72 }).map((_, i) => { const gx = (i % 6) * 2 + (Math.floor(i / 6) % 2), gy = Math.floor(i / 6); return <IsoTile key={i} x={gx} y={gy} fill="#ffffff" opacity={0.06} />; })}
          {/* Path from HQ door to the shore, and the plaza */}
          <IsoTile x={5.4} y={7.7} w={1.2} d={4.3} fill="#e2d6bd" />
          <IsoTile x={3.6} y={7.7} w={5.2} d={1.6} fill="#e2d6bd" />
          {tier("reception") >= 3 && <IsoTile x={5.65} y={7.8} w={0.7} d={4.2} fill="#9f1239" opacity={0.85} />}{tier("reception") >= 2 && (() => { const [sx, sy] = iso(8.4, 9.0); return <g><rect x={sx - 16} y={sy - 10} width="32" height="10" rx="4" fill="#57534e" /><rect x={sx - 16} y={sy - 15} width="32" height="7" rx="3" fill="#44403c" /><circle cx={sx + 22} cy={sy - 10} r="7" fill="#3f6212" /></g>; })()}
          {(tier("garden") >= 1 || healthMood === "thriving") && <g className="ow-flowers">{[[0.5, 11.3], [1.4, 11.4], [11.3, 1.2], [11.4, 2.4], [0.6, 2.0], [11.2, 8.8], [4.6, 11.4], [9.2, 0.6]].map(([fx, fy], i) => { const [sx, sy] = iso(fx, fy); return <g key={i}><circle cx={sx - 4} cy={sy} r="3.5" fill="#c084a0" /><circle cx={sx + 4} cy={sy - 1} r="3.5" fill="#e3c26a" /><circle cx={sx} cy={sy + 2.5} r="3.5" fill="#5f8f4a" /></g>; })}</g>}

          {/* Marketing billboard (Mia) */}
          <Spot id="b-marketing" label="Marketing" poked={poked} labelAt={iso(6, 1.3, 78)} onTap={() => tapBuilding("marketing")}>
            <IsoBox x={5.2} y={1.25} w={0.12} d={0.12} h={30} color="#57534e" /><IsoBox x={6.7} y={1.25} w={0.12} d={0.12} h={30} color="#57534e" />
            <polygon points={pts([iso(4.9, 1.4, 28), iso(7.1, 1.4, 28), iso(7.1, 1.4, 66), iso(4.9, 1.4, 66)])} fill={p.primary} stroke={shade(p.primary, -0.4)} strokeWidth="2.5" />
            {p.logo && (() => { const [lx, ly] = iso(5.25, 1.4, 47); return <image href={p.logo} x={lx - 11} y={ly - 11} width="22" height="22" preserveAspectRatio="xMidYMid meet" transform={`rotate(26.6 ${lx} ${ly})`} />; })()}
            {(() => { const [bx, by] = iso(6, 1.4, 47); return <text x={bx} y={by + 4} textAnchor="middle" fontSize="11" fontWeight="900" fill="#fff" transform={`rotate(26.6 ${bx} ${by})`}>{p.name.length > 13 ? `${p.name.slice(0, 12)}…` : p.name}</text>; })()}
          </Spot>
          {/* Workshop (Pete) — site tent → shed → workshop → warehouse */}
          <Spot id="b-projects" label={tier("workshop") >= 3 ? "Warehouse" : tier("workshop") >= 2 ? "Workshop" : tier("workshop") >= 1 ? "Tool shed" : "Site office"} poked={poked} labelAt={iso(1.5, 10.5, tier("workshop") >= 2 ? 80 : 62)} onTap={() => tapBuilding("projects")}>
            {tier("workshop") === 0 ? <IsoRoof x={0.8} y={9.9} w={1.4} d={1.3} z={0} rise={32} color="#16a34a" />
              : tier("workshop") === 1 ? <><IsoBox x={0.8} y={9.9} w={1.5} d={1.3} h={24} color="#b45309" /><IsoRoof x={0.8} y={9.9} w={1.5} d={1.3} z={24} rise={18} color="#78350f" /><IsoDoor x={0.8} y={9.9} w={1.5} d={1.3} h={16} color="#451a03" /></>
              : (() => { const ww = tier("workshop") >= 3 ? 2.2 : 1.8, hh = tier("workshop") >= 3 ? 44 : 32; const Db = iso(0.5, 11.4), Cb = iso(0.5 + ww, 11.4), a = lerp(Db, Cb, 0.2), b = lerp(Db, Cb, 0.8), dh = hh - 10; return <><IsoBox x={0.5} y={9.6} w={ww} d={1.8} h={hh} color="#e5e7eb" /><IsoRoof x={0.5} y={9.6} w={ww} d={1.8} z={hh} rise={14} color={p.secondary} /><polygon points={pts([a, b, [b[0], b[1] - dh], [a[0], a[1] - dh]])} fill="#9ca3af" />{Array.from({ length: 5 }).map((_, i) => <line key={i} x1={a[0]} y1={a[1] - (i + 1) * dh / 6} x2={b[0]} y2={b[1] - (i + 1) * dh / 6} stroke="#6b7280" strokeWidth="1.5" />)}</>; })()}
          </Spot>
          {tier("garden") >= 2 && [[0.6, 0.7], [3.6, 0.5], [0.5, 3.6], [11.4, 6.4]].map(([tx, ty]) => { const [sx, sy] = iso(tx, ty); return <g key={`${tx}-${ty}`} className="ow-tree"><rect x={sx - 3.5} y={sy - 22} width="7" height="22" rx="2" fill="#78350f" /><circle cx={sx} cy={sy - 34} r="18" fill="#22c55e" /><circle cx={sx - 9} cy={sy - 26} r="12" fill="#16a34a" /><circle cx={sx + 8} cy={sy - 40} r="10" fill="#4ade80" /></g>; })}
          {tier("garden") >= 3 && (() => { const [fx, fy] = iso(3.9, 3.7); return <g className="ow-fountain"><ellipse cx={fx} cy={fy} rx="30" ry="15" fill="#cbd5e1" /><ellipse cx={fx} cy={fy - 3} rx="25" ry="11.5" fill="#60a5fa" /><rect x={fx - 3} y={fy - 26} width="6" height="22" fill="#e2e8f0" /><circle cx={fx} cy={fy - 30} r="7" fill="#bfdbfe" className="ow-splash" /></g>; })()}
          {/* Lifestyle: home, pool, helipad */}
          <Spot id="b-home" label={tier("home") ? UPGRADES.find((u) => u.id === "home")!.tiers[tier("home") - 1].name : "Build your home"} poked={poked} labelAt={iso(9.9, 1.8, tier("home") >= 2 ? 96 : 70)} onTap={() => tapBuilding("hq")}><Home tier={tier("home")} primary={p.primary} secondary={p.secondary} /></Spot>
          <Pool tier={tier("pool")} primary={p.primary} />
          <Air tier={tier("air")} primary={p.primary} reduced={reduced} />
          {/* Headquarters — grows with each Headquarters tier */}
          {(() => { const t = tier("hq"), w = t >= 2 ? 4.0 : 3.6, h = 58 + t * 22, x0 = 4.2, y0 = 4.1; const L = iso(x0, y0 + w), R = iso(x0 + w, y0 + w); const b1 = lerp(L, R, 0.18), b2 = lerp(L, R, 0.82); const apex = iso(x0 + w / 2, y0 + w / 2, h + 40); return <Spot id="b-hq" label="Enter headquarters" poked={poked} labelAt={[apex[0], apex[1] - 34]} badge={customers.length || undefined} onTap={() => tapBuilding("hq")}>
            <IsoBox x={x0 - 0.15} y={y0 - 0.15} w={w + 0.3} d={w + 0.3} h={8} color="#a8a29e" />
            <IsoBox x={x0} y={y0} w={w} d={w} h={h} z={8} color={tier("renovation") >= 3 ? "#292524" : tier("renovation") >= 2 ? "#7dd3fc" : tier("renovation") >= 1 ? shade(p.primary, 0.75) : "#f5efe3"} />
            {tier("renovation") >= 3 && <polyline points={pts([iso(x0, y0 + w, h + 8), iso(x0 + w, y0 + w, h + 8), iso(x0 + w, y0, h + 8)])} fill="none" stroke="#fbbf24" strokeWidth="3" />}
            <IsoWindows x={x0} y={y0} w={w} d={w} floors={1 + t} floorH={22} base={22} glow={tier("interior") >= 1 || healthMood === "thriving"} />
            {tier("interior") >= 2 && Array.from({ length: 1 + t }).map((_, f) => [0.3, 0.67].map((u) => { const a = lerp(iso(x0 + w, y0 + w), iso(x0 + w, y0), u); return <circle key={`${f}-${u}`} cx={a[0]} cy={a[1] - 22 - f * 22 - 4} r="3" fill="#16a34a" />; }))}
            {tier("interior") >= 3 && (() => { const a = lerp(iso(x0 + w, y0 + w), iso(x0 + w, y0), 0.5); return <path className="ow-sparkle" d={`M${a[0]} ${a[1] - 40} l2 4 4 2 -4 2 -2 4 -2 -4 -4 -2 4 -2z`} fill="#fde047" />; })()}
            {(Object.keys(EMPLOYEES) as EmployeeId[]).map((id, i) => { const a = lerp(iso(x0 + w, y0 + w), iso(x0 + w, y0), 0.06 + i * 0.155), b2x = lerp(iso(x0 + w, y0 + w), iso(x0 + w, y0), 0.06 + i * 0.155 + 0.12); return <polygon key={id} points={pts([[a[0], a[1] - 14], [b2x[0], b2x[1] - 14], [b2x[0], b2x[1] - 18], [a[0], a[1] - 18]])} fill={EMPLOYEES[id].colour} opacity=".9" />; })}
            <IsoRoof x={x0} y={y0} w={w} d={w} z={h + 8} rise={40} color={p.secondary} />
            <IsoDoor x={x0} y={y0} w={w} d={w} h={26} color={p.primary} />
            <polygon points={pts([[b1[0], b1[1] - h + 2], [b2[0], b2[1] - h + 2], [b2[0], b2[1] - h + 20], [b1[0], b1[1] - h + 20]])} fill={tier("signage") >= 1 ? "#111827" : shade(p.secondary, -0.1)} stroke={tier("signage") >= 1 ? p.primary : "none"} strokeWidth="2" />
            {p.logo && (() => { const m = lerp(b1, b2, 0.08); return <image href={p.logo} x={m[0] - 2} y={m[1] - h + 2} width="16" height="16" preserveAspectRatio="xMidYMid meet" transform={`rotate(26.6 ${m[0] + 6} ${m[1] - h + 10})`} />; })()}
            {(() => { const m = lerp(b1, b2, 0.5); return <text x={m[0]} y={m[1] - h + 15} textAnchor="middle" fontSize="9.5" fontWeight="900" fill="#fff" transform={`rotate(26.6 ${m[0]} ${m[1] - h + 11})`}>{p.name.length > 16 ? `${p.name.slice(0, 15)}…` : p.name}</text>; })()}
            <g className="ow-flag" transform={`translate(${apex[0]} ${apex[1]})`}><rect x="-1.2" y="-30" width="2.4" height="30" fill="#57534e" /><path d="M1 -30 L22 -24 L1 -18 Z" fill={p.primary} /></g>
            {tier("signage") >= 2 && <g className="ow-neon" transform={`translate(${apex[0]} ${apex[1] + 22})`}><rect x="-62" y="-12" width="124" height="20" rx="6" fill="#111827" stroke={p.primary} strokeWidth="2" /><text y="3" textAnchor="middle" fontSize="10" fontWeight="900" fill="#fff">{p.name.slice(0, 18).toUpperCase()}</text></g>}
            {healthMood === "struggling" && <g className="ow-storm" transform={`translate(${apex[0]} ${apex[1] - 60})`}><ellipse cx="0" cy="0" rx="36" ry="13" fill="#64748b" /><ellipse cx="-20" cy="4" rx="20" ry="10" fill="#475569" /></g>}
          </Spot>; })()}
          {/* Staff café */}
          {tier("cafe") >= 1 && (() => { const [cx, cy] = iso(3.1, 7.7); return <g><rect x={cx - 22} y={cy - 8} width="44" height="6" rx="3" fill="#92400e" /><rect x={cx - 18} y={cy - 2} width="4" height="8" fill="#78350f" /><rect x={cx + 14} y={cy - 2} width="4" height="8" fill="#78350f" />
            {tier("cafe") >= 2 && [-34, 34].map((dx) => <g key={dx}><path d={`M${cx + dx - 20} ${cy - 30} Q${cx + dx} ${cy - 46} ${cx + dx + 20} ${cy - 30} Z`} fill={p.primary} /><rect x={cx + dx - 1.2} y={cy - 30} width="2.4" height="26" fill="#6b7280" /><ellipse cx={cx + dx} cy={cy - 4} rx="11" ry="4" fill="#f1f5f9" /></g>)}</g>; })()}
          <Car tier={tier("car")} primary={p.primary} />
          {/* Fleet */}
          {tier("fleet") >= 1 && <g className="ow-van-iso"><IsoBox x={9.7} y={10.3} w={tier("fleet") >= 2 ? 1.6 : 1.2} d={0.7} h={20} z={4} color={p.primary} /><IsoBox x={9.4} y={10.3} w={0.35} d={0.7} h={14} z={4} color={shade(p.primary, -0.15)} />{[[9.8, 11.0], [10.7, 11.0]].map(([wx, wy]) => { const [sx, sy] = iso(wx, wy); return <ellipse key={wx} cx={sx} cy={sy} rx="5" ry="3.5" fill="#111827" />; })}</g>}
          {tier("fleet") >= 3 && <g><IsoBox x={10.6} y={8.9} w={1.0} d={0.6} h={18} z={4} color={p.secondary} /></g>}

          {/* Farm: every crop is a real open lead */}
          <Spot id="b-farm" label={`Lead farm · ${crops.length}`} poked={poked} labelAt={iso(10.8, 8.6, 46)} onTap={() => tapBuilding("farm")}>
            <IsoTile x={9.9} y={7.3} w={1.9} d={2.7} fill="#92400e" />
            {Array.from({ length: 6 }).map((_, r) => <IsoTile key={r} x={9.95} y={7.4 + r * 0.44} w={1.8} d={0.2} fill="#7c2d12" opacity={0.6} />)}
            <polyline points={pts([iso(9.85, 10.05, 6), iso(11.85, 10.05, 6), iso(11.85, 7.25, 6)])} fill="none" stroke="#a16207" strokeWidth="2.5" strokeDasharray="5 4" />
          </Spot>
          {crops.slice(0, 12).map((c, i) => <CropPlant key={c.id} at={iso(10.25 + (i % 3) * 0.6, 7.6 + Math.floor(i / 3) * 0.62)} crop={c} onTap={demo ? undefined : () => openLead(c.id)} />)}
          {/* Long grass grows while work piles up */}
          {grassTufts.map(([gx, gy], i) => { const [sx, sy] = iso(gx, gy); return <g key={i} className="ow-grass-tuft"><path d={`M${sx - 6} ${sy} q2 -14 4 0 M${sx - 1} ${sy} q1 -18 3 0 M${sx + 3} ${sy} q3 -13 5 0`} fill="#3f8f2f" stroke="#2f6f22" strokeWidth="1" /></g>; })}
          {/* Customers = real new leads queuing outside. Longest wait at the front; the longer they wait, the more fed up they get. */}
          {[...customers].sort((x, y) => x.createdAt.localeCompare(y.createdAt)).slice(0, 8).map((c, i) => { const hrs = c.createdAt ? workingHoursBetween(c.createdAt, new Date().toISOString()) : 0; const mood = hrs >= 72 ? "angry" : hrs >= 24 ? "bored" : hrs >= 4 ? "impatient" : "calm"; const at = iso(6, 9.2 + i * 0.4); const label = `${c.name || c.title}: ${mood === "calm" ? "just arrived" : mood === "impatient" ? "getting impatient" : mood === "bored" ? "bored — waiting over a working day" : "fed up — waiting over three working days"}`; return <g key={c.id} className={`ow-customer q-${mood}`} style={{ animationDelay: `${i * 0.12}s` }}>
            <Bean at={at} look={{ color: mood === "angry" ? "#b91c1c" : ["#5f7a99", "#7a6a8c", "#8c6a5f", "#5f8c76", "#8c7d5f", "#6a738c"][i % 6] }} mood={mood === "calm" ? "calm" : mood === "impatient" ? "concerned" : "panicked"} scale={1.0} className={mood === "calm" ? "" : "impatient"} alert={mood === "angry" || mood === "bored"} label={label} onTap={demo ? undefined : () => openLead(c.id)} />
            {mood === "bored" && <path className="ow-sweat" d={`M${at[0] + 10} ${at[1] - 30} q3 5 0 7 q-3 -2 0 -7z`} fill="#60a5fa" />}
            {mood === "angry" && <g className="ow-steam">{[-6, 6].map((dx) => <circle key={dx} cx={at[0] + dx} cy={at[1] - 40} r="3.5" fill="#e5e7eb" />)}</g>}
          </g>; })}
          {/* The Tax Man knocks when this month's expenses are missing receipts */}
          {(demo || data.taxman) && <TaxMan at={iso(6.6, 8.3)} onTap={() => { if (demo) { say("taxman", "Receipts, please! (demo)", ((a) => [a[0], a[1] - 70] as [number, number])(iso(6.6, 8.3))); return; } say("taxman", "Ahem. Some expenses this month have no receipts.", ((a) => [a[0], a[1] - 70] as [number, number])(iso(6.6, 8.3))); setTimeout(() => setPanel({ kind: "expense" }), 700); }} />}
          {/* Town life: AI agents at work (or snoozing until their scheduled run), staff on jobs, leads visiting */}
          {(demo ? [{ id: "d-a1", name: "SEO agent", state: "working", task: "Monthly SEO audit" }, { id: "d-a2", name: "Ads agent", state: "scheduled", task: "Weekly Google Ads check" }] : data.agents || []).map((a, i) => a.state === "working"
            ? <Walker key={a.id} route={ROUTES[i % ROUTES.length]} dur={13 + i * 2} delay={i * 3} reduced={reduced}><Robot label={`${a.name}: working on ${a.task}`} onTap={() => say(`agent-${a.id}`, `${a.name}: working on “${a.task}”`, [500, 210])} /></Walker>
            : <g key={a.id} transform={`translate(${iso(4.1 + i * 0.5, 8.3)[0]} ${iso(4.1 + i * 0.5, 8.3)[1]})`}><Robot sleeping label={`${a.name}: scheduled — ${a.task}`} onTap={() => say(`agent-${a.id}`, `${a.name}: snoozing until “${a.task}” is due`, [iso(4.1 + i * 0.5, 8.3)[0], iso(4.1 + i * 0.5, 8.3)[1] - 44])} /></g>)}
          {(data.staffAtWork || []).map((m, i) => <Walker key={m.id} route={ROUTES[(i + 2) % ROUTES.length].slice().reverse()} dur={15 + i * 2} delay={i * 4 + 2} reduced={reduced}><Bean at={[0, 0]} scale={0.85} look={{ color: "#3f5f6f", tie: true }} className="walker" label={`${m.name}: ${m.task}`} onTap={() => say(`staff-${m.id}`, `${m.name}: ${m.task}`, [500, 210])} /></Walker>)}
          {(data.visitors || []).map((v, i) => { const route = /appoint|visit|consult|book/i.test(v.stage) ? there([5.0, 8.4], [2.4, 6.8]) : /propos|quote|negot/i.test(v.stage) ? there([7.4, 8.3], [9.0, 6.8]) : there([8.6, 7.0], [9.6, 9.6]); return <Walker key={v.id} route={route} dur={16 + i * 3} delay={i * 5} reduced={reduced}><Bean at={[0, 0]} scale={0.7} look={{ color: ["#8c7d5f", "#6a738c", "#5f8c76", "#8c6a5f"][i % 4] }} className="walker" label={`${v.name} (${v.stage})`} onTap={demo ? undefined : () => openLead(v.id)} /></Walker>; })}
          {/* Employees — one AI, six personalities */}
          {(Object.keys(EMPLOYEES) as EmployeeId[]).sort((a, b) => (EMP_SPOTS[a][0] + EMP_SPOTS[a][1]) - (EMP_SPOTS[b][0] + EMP_SPOTS[b][1])).map((id) => { const at = iso(...EMP_SPOTS[id]); const talking = id === approaching; return <g key={id}>
            <Bean at={at} scale={1.25} look={EMP_LOOK[id]} mood={talking ? current?.mood : healthMood === "struggling" ? "concerned" : "calm"} className={`staff ${talking ? "talking" : ""} ${poked === id ? "poked" : ""} idle-${id}`} label={`${EMPLOYEES[id].name}, ${EMPLOYEES[id].title}`} onTap={() => tapEmployee(id)} alert={talking && (current?.urgency || 0) >= 75} />
            <text x={at[0]} y={at[1] + 14} textAnchor="middle" fontSize="10" fontWeight="800" fill="#1c1917" className="ow-name">{EMPLOYEES[id].name}</text>
          </g>; })}
          {/* The owner */}
          {(() => { const at = iso(7.0, 11.5); return <g><Bean at={at} scale={1.45} look={{ color: tier("wardrobe") >= 1 ? shade(p.primary, -0.08) : p.primary, trim: p.secondary, hat: tier("wardrobe") >= 4 ? undefined : p.outfit.hat, tool: p.outfit.tool, tie: tier("wardrobe") >= 2, shades: tier("wardrobe") >= 3, crown: tier("wardrobe") >= 4 }} className={`owner ${poked === "owner" ? "poked" : ""}`} label={`${p.characterName} (you)`} onTap={() => tapOwner()} /><text x={at[0]} y={at[1] + 18} textAnchor="middle" fontSize="11" fontWeight="900" fill="#14532d">{p.characterName}</text></g>; })()}
          {/* Collectable coins */}
          {[...pendingByEmployee.entries()].map(([id, items]) => { const at = iso(...EMP_SPOTS[id]); return <CoinBubble key={id} x={at[0]} y={at[1] - 84} amount={sumCoins(items)} label={`Collect ${sumCoins(items)} coins from ${EMPLOYEES[id].name}`} onCollect={() => void collect(items.map((x) => x.key))} />; })}
          {raid && (() => { const door = iso(6.2, 8.4), shore = iso(6.0, 12.8); return <g key={raid.n} className="ow-raid">
            <g><TaxMan at={[0, 0]} onTap={() => setPanel({ kind: "expense" })} />{!reduced && <animateMotion dur="5.6s" repeatCount="1" fill="freeze" keyPoints="0;0.5;0.5;1" keyTimes="0;0.38;0.6;1" calcMode="linear" path={`M${shore[0]} ${shore[1]} L${door[0]} ${door[1]} L${shore[0]} ${shore[1]}`} />}{reduced && <set attributeName="transform" to={`translate(${door[0]} ${door[1]})`} />}</g>
            <g className="ow-raid-coins" transform={`translate(${door[0]} ${door[1] - 70})`}>{[0, 1, 2, 3].map((k) => <circle key={k} cx={(k - 1.5) * 9} cy="0" r="6" fill="#fbbf24" stroke="#b45309" strokeWidth="1.5" style={{ animationDelay: `${2.1 + k * 0.08}s` }} />)}<text className="ow-raid-text" y="-14" textAnchor="middle" fontSize="16" fontWeight="900" fill="#b91c1c" stroke="#fff" strokeWidth="3" paintOrder="stroke">−{raid.coins}</text></g>
          </g>; })()}
          {coinBurst > 0 && !reduced && <g key={coinBurst} className="ow-coin-fly">{[0, 1, 2, 3, 4, 5].map((k) => <circle key={k} cx={480 + k * 10} cy={380} r="8" fill="#fbbf24" stroke="#b45309" strokeWidth="2" style={{ animationDelay: `${k * 0.06}s` }} />)}</g>}
        </svg>
        {bubble && <div className="ow-bubble" style={{ left: `${bubble.at[0] / 10}%`, top: `${bubble.at[1] / 5.6}%` }} key={bubble.n}>{bubble.text}</div>}
        </div>

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

    {inside && <InsideHQ focus={inside} data={data} approaches={approaches} wallet={w} onFocus={setInside} onClose={() => setInside(null)} onOpen={(k) => { if (demo) return; setInside(null); setPanel({ kind: k }); }} onAct={(a) => { setInside(null); setDrawer(a); }} />}
    {drawer && <Drawer kind={drawer} data={data} wallet={w} demo={demo} onClose={() => setDrawer("")} post={post} buy={buy} onChanged={() => void load(true)} />}

    {panel && (panel.kind === "lead-replies" || panel.kind === "lead-detail") && <div className="ow-modal-scrim" onClick={(e) => { if (e.target === e.currentTarget) closePanel(); }}><div className="ow-card-modal" role="dialog" aria-label={PANEL_TITLES[panel.kind]}>
      <header><b>{panel.kind === "lead-detail" ? "Customer" : "AI-prepared replies"}</b><button type="button" className="ghost" onClick={closePanel} aria-label="Close"><X size={18} /></button></header>
      <LeadReplies scope={scope} focusId={panel.kind === "lead-detail" ? panel.focusId : undefined} customers={[...data.customers, ...(data.crops || []).filter((c) => !data.customers.some((x) => x.id === c.id)).map((c) => ({ id: c.id, title: c.name, name: c.name, createdAt: "", stage: "", value: 0, currency: "EUR" }))]} mode={data.state.mode} post={post} onOpen={(k) => setPanel({ kind: k })} />
    </div></div>}
    {panel && panel.kind !== "lead-replies" && panel.kind !== "lead-detail" && <div className="ow-panel" role="dialog" aria-label={PANEL_TITLES[panel.kind]}>
      <header><button type="button" onClick={closePanel}><ArrowLeft size={18} /> Back to {p.name}</button><b>{PANEL_TITLES[panel.kind]}</b><button type="button" onClick={closePanel} aria-label="Close"><X size={18} /></button></header>
      <div className="ow-panel-body">{renderPanel(panel.kind, { focusId: panel.focusId, onDone: closePanel })}</div>
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
      {(["business", "lifestyle"] as const).map((group) => <div key={group}><h4 className="ow-group-title">{group === "business" ? "Your business" : "Your lifestyle"}</h4><ul className="ow-tracks">{UPGRADES.filter((t) => t.group === group).map((t) => { const have = upgradeTier(w.owned, t.id); const next = nextUpgrade(t.id, w.owned); const locked = next ? w.level < next.minLevel : false; const short = next ? w.coins < next.price : false; return <li key={t.id}>
        <div className="ow-track-row"><UpgradeArt id={t.id} tier={Math.max(1, Math.min(t.tiers.length, have + 1))} primary={data.profile.primary} secondary={data.profile.secondary} /><div className="ow-track-info"><div className="ow-track-top"><b>{t.name}</b><span className="ow-pips" aria-label={`Tier ${have} of ${t.tiers.length}`}>{t.tiers.map((x) => <i key={x.tier} className={x.tier <= have ? "on" : ""} />)}</span></div>
        <small>{have ? `Now: ${t.tiers[have - 1].name}` : "Not built yet"}</small>
        {next ? <div className="ow-track-next"><div><b>{next.name}</b><small>{next.perk}</small></div>
          <button type="button" disabled={locked || short || busy === t.id} className={locked || short ? "ghost" : ""} onClick={() => void upgrade(t.id)}>{locked ? <><Lock size={13} /> Level {next.minLevel}</> : busy === t.id ? <Loader2 size={13} className="ow-spin" /> : <><Coins size={13} /> {next.price.toLocaleString("en-IE")}</>}</button></div>
          : <small className="ow-ok">Fully upgraded</small>}
      </div></div></li>; })}</ul></div>)}
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
