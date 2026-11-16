"use client";

import { useEffect, useState } from "react";

const DEFAULT_STEPS = ["Gathering details…", "Connecting to your data sources…", "Reading performance data…", "Matching CRM leads and deals…", "Building charts…", "Checking every figure…", "Finalising your report…"];

export type GeneratingVariant = "report" | "payslip" | "accountant" | "leads";

/** €, £ or $ from the business's tax country (IE / GB / US); falls back to the currency code. */
export function currencySymbolFor(country?: string, currency?: string) {
  if (country === "GB") return "£";
  if (country === "US") return "$";
  if (country === "IE") return "€";
  const code = String(currency || "EUR").toUpperCase();
  return code === "GBP" ? "£" : code === "USD" || code === "CAD" || code === "AUD" || code === "NZD" ? "$" : "€";
}

function Monitor({ children }: { children: React.ReactNode }) {
  return <>
    <ellipse cx="160" cy="206" rx="110" ry="8" className="rga-shadow" />
    <rect x="132" y="168" width="56" height="26" rx="4" className="rga-stand" />
    <rect x="104" y="190" width="112" height="10" rx="5" className="rga-stand" />
    <rect x="30" y="14" width="260" height="160" rx="14" className="rga-frame" />
    <rect x="42" y="26" width="236" height="134" rx="8" fill="url(#rga-screen)" />
    <circle cx="160" cy="20" r="2" className="rga-cam" />
    {children}
  </>;
}

function ReportArt() {
  return <Monitor>
    <rect x="52" y="34" width="54" height="7" rx="3.5" className="rga-chip" />
    <circle cx="262" cy="38" r="5" className="rga-pulse" />
    {[0, 1, 2].map((i) => <g key={i} className="rga-kpi" style={{ animationDelay: `${i * 0.25}s` }}><rect x={52 + i * 46} y="48" width="40" height="22" rx="5" className="rga-tile" /><rect x={57 + i * 46} y="54" width="18" height="4" rx="2" className="rga-chip" /><rect x={57 + i * 46} y="61" width="26" height="5" rx="2.5" className="rga-ink" /></g>)}
    {[26, 40, 33, 52, 46, 62].map((h, i) => <rect key={i} x={54 + i * 15} y={150 - h} width="10" height={h} rx="2.5" className="rga-bar" style={{ animationDelay: `${0.15 * i}s` }} />)}
    <path d="M150 140 L170 128 L188 132 L206 112 L224 116 L242 96 L262 90 L262 150 L150 150 Z" fill="url(#rga-area)" className="rga-areafill" />
    <path d="M150 140 L170 128 L188 132 L206 112 L224 116 L242 96 L262 90" className="rga-line" />
    <circle cx="262" cy="90" r="4" className="rga-dot" />
    <g transform="translate(232 62)"><circle r="13" className="rga-ring" /><circle r="13" className="rga-ring-fill" transform="rotate(-90)" /></g>
  </Monitor>;
}

// A payslip being filled in on screen, with the currency coin for the business's country.
function PayslipArt({ symbol }: { symbol: string }) {
  return <Monitor>
    <rect x="70" y="34" width="120" height="120" rx="6" className="rga-tile" />
    <rect x="80" y="43" width="22" height="9" rx="3" className="rga-ink" />
    <rect x="108" y="45" width="46" height="5" rx="2.5" className="rga-chip" />
    {[0, 1, 2, 3].map((i) => <g key={i} className="rga-row" style={{ animationDelay: `${i * 0.35}s` }}><rect x="80" y={62 + i * 14} width="56" height="5" rx="2.5" className="rga-chip" /><rect x={150 - (i % 2) * 8} y={62 + i * 14} width={26 + (i % 2) * 8} height="5" rx="2.5" className="rga-ink" /></g>)}
    <rect x="80" y="122" width="100" height="1.5" className="rga-chip" />
    <rect x="80" y="130" width="36" height="7" rx="3" className="rga-chip" />
    <rect x="140" y="128" width="40" height="11" rx="4" className="rga-net" />
    <g className="rga-coin-bob"><circle cx="232" cy="88" r="26" className="rga-coin" /><circle cx="232" cy="88" r="20" className="rga-coin-inner" /><text x="232" y="97" textAnchor="middle" className="rga-coin-sym">{symbol}</text></g>
    {[0, 1, 2].map((i) => <ellipse key={i} cx="232" cy={146 - i * 6} rx="16" ry="4.5" className="rga-stack" style={{ animationDelay: `${i * 0.3}s` }} />)}
  </Monitor>;
}

// Accountant at work: receipts checked off under a magnifying glass, a calculator totting up in the local currency.
function AccountantArt({ symbol }: { symbol: string }) {
  // Receipt outline with a torn (zig-zag) bottom edge, drawn right to left back to the start.
  const receipt = (x: number, y: number, w: number, h: number) => { let d = `M${x} ${y} H${x + w} V${y + h}`; for (let i = w; i > 0; i -= 8) d += ` L${x + i - 4} ${y + h + 5} L${x + Math.max(i - 8, 0)} ${y + h}`; return `${d} Z`; };
  return <>
    <ellipse cx="160" cy="204" rx="130" ry="9" className="rga-shadow" />
    <rect x="20" y="168" width="280" height="30" rx="8" className="rga-desk" />
    {[0, 1, 2].map((i) => { const x = 34 + i * 52, y = 40 + (i % 2) * 10; return <g key={i} className="rga-receipt" style={{ animationDelay: `${i * 0.6}s` }} transform={`rotate(${(i - 1) * 5} ${x + 22} ${y + 60})`}>
      <path d={receipt(x, y, 44, 110)} className="rga-paper" />
      <rect x={x + 8} y={y + 10} width="20" height="5" rx="2.5" className="rga-ink" />
      {[0, 1, 2, 3].map((r) => <rect key={r} x={x + 8} y={y + 24 + r * 12} width={r === 3 ? 18 : 28} height="4" rx="2" className="rga-chip" />)}
      <rect x={x + 8} y={y + 80} width="28" height="2" className="rga-chip" />
      <text x={x + 36} y={y + 98} textAnchor="end" className="rga-receipt-amt">{symbol}{[49, 120, 18][i]}</text>
      <g className="rga-tick" style={{ animationDelay: `${0.6 + i * 0.6}s` }}><circle cx={x + 36} cy={y + 12} r="8" className="rga-tick-bg" /><path d={`M${x + 32} ${y + 12} l3 3 l5 -6`} className="rga-tick-mark" /></g>
    </g>; })}
    <g className="rga-glass"><circle cx="70" cy="110" r="22" className="rga-lens" /><circle cx="70" cy="110" r="22" className="rga-lens-rim" /><rect x="84" y="126" width="9" height="30" rx="4.5" transform="rotate(-40 88 140)" className="rga-handle" /></g>
    <g transform="translate(200 70)">
      <rect width="86" height="104" rx="10" className="rga-calc" />
      <rect x="9" y="9" width="68" height="24" rx="5" className="rga-calc-screen" />
      <text x="71" y="27" textAnchor="end" className="rga-calc-digits">{symbol}<tspan className="rga-calc-count">187</tspan></text>
      {[0, 1, 2, 3].map((r) => [0, 1, 2].map((c) => <rect key={`${r}${c}`} x={10 + c * 23} y={41 + r * 15} width="19" height="11" rx="3" className={`rga-key${(r * 3 + c) % 4 === 1 ? " hot" : ""}`} style={{ animationDelay: `${((r * 3 + c) % 5) * 0.28}s` }} />))}
    </g>
    <g className="rga-coin-bob" transform="translate(0 0)"><circle cx="252" cy="44" r="16" className="rga-coin" /><circle cx="252" cy="44" r="12" className="rga-coin-inner" /><text x="252" y="50" textAnchor="middle" className="rga-coin-sym small">{symbol}</text></g>
  </>;
}

// Lead generation: pins drop on a map under a sweeping magnifier while business cards get qualified (tick) or skipped (cross).
function LeadsArt() {
  const pins: Array<[number, number]> = [[70, 70], [104, 96], [86, 128], [128, 62], [138, 118], [62, 108]];
  return <Monitor>
    <rect x="50" y="34" width="110" height="118" rx="6" className="rga-map" />
    <path d="M50 88 C80 80 110 104 160 92 M96 34 C92 70 112 110 104 152 M50 132 C90 122 120 140 160 130" className="rga-road" />
    <path d="M128 34 C130 60 150 72 160 70" className="rga-road thin" />
    {pins.map(([x, y], i) => <g key={i} className="rga-pin" style={{ animationDelay: `${i * 0.4}s` }}><path d={`M${x} ${y} c-5 -7 -7 -10 -7 -13 a7 7 0 0 1 14 0 c0 3 -2 6 -7 13z`} className={i % 3 === 2 ? "rga-pin-off" : "rga-pin-on"} /><circle cx={x} cy={y - 13} r="2.6" fill="#fff" /></g>)}
    <g className="rga-scan"><circle cx="78" cy="84" r="17" className="rga-lens" /><circle cx="78" cy="84" r="17" className="rga-lens-rim" /><rect x="90" y="96" width="7" height="20" rx="3.5" transform="rotate(-42 93 106)" className="rga-handle" /></g>
    {[0, 1, 2, 3].map((i) => { const y = 38 + i * 28, ok = i !== 2; return <g key={i} className="rga-lead" style={{ animationDelay: `${i * 0.6}s` }}>
      <rect x="170" y={y} width="98" height="22" rx="5" className="rga-tile" />
      <circle cx="182" cy={y + 11} r="6" className={ok ? "rga-avatar" : "rga-avatar off"} />
      <rect x="193" y={y + 6} width="42" height="4" rx="2" className="rga-ink" /><rect x="193" y={y + 13} width="30" height="3.5" rx="1.75" className="rga-chip" />
      <g className="rga-verdict" style={{ animationDelay: `${0.4 + i * 0.6}s` }}><circle cx="257" cy={y + 11} r="6.5" className={ok ? "rga-tick-bg" : "rga-cross-bg"} />{ok ? <path d={`M${253.5} ${y + 11} l2.4 2.4 l4.4 -5`} className="rga-tick-mark" /> : <path d={`M${254.5} ${y + 8.5} l5 5 M${259.5} ${y + 8.5} l-5 5`} className="rga-tick-mark" />}</g>
    </g>; })}
  </Monitor>;
}

/** Animated "at work" scene shown while something generates. `report` = charts on a computer (default),
 *  `payslip` = payslip + currency coin, `accountant` = receipts being checked and a calculator. */
export function ReportGeneratingAnimation({ steps = DEFAULT_STEPS, title = "Generating your report", variant = "report", symbol = "€", liveStep, progress, children }: { steps?: string[]; title?: string; variant?: GeneratingVariant; symbol?: string; liveStep?: string; progress?: number | null; children?: React.ReactNode }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setIndex(0);
    const timer = window.setInterval(() => setIndex((current) => Math.min(current + 1, steps.length - 1)), 2200);
    return () => window.clearInterval(timer);
  }, [steps]);
  return (
    <div className={`rga rga-${variant}`} role="status" aria-live="polite">
      <svg className="rga-art" viewBox="0 0 320 220" aria-hidden="true">
        <defs>
          <linearGradient id="rga-screen" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#f5f9ff" /><stop offset="1" stopColor="#e8f0fe" /></linearGradient>
          <linearGradient id="rga-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#2f6ff0" stopOpacity=".35" /><stop offset="1" stopColor="#2f6ff0" stopOpacity="0" /></linearGradient>
        </defs>
        {variant === "payslip" ? <PayslipArt symbol={symbol} /> : variant === "accountant" ? <AccountantArt symbol={symbol} /> : variant === "leads" ? <LeadsArt /> : <ReportArt />}
        <path d="M296 30 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" className="rga-spark" />
        <path d="M22 90 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" className="rga-spark s2" />
      </svg>
      <div className="rga-text">
        <b>{title}</b>
        <span key={liveStep ?? index} className="rga-step">{liveStep || steps[index]}</span>
        <div className="rga-progress" aria-hidden="true"><i style={{ width: `${Math.round((progress != null ? Math.max(0.04, Math.min(1, progress)) : (index + 1) / steps.length) * 100)}%` }} /></div>
        {children}
      </div>
    </div>
  );
}
