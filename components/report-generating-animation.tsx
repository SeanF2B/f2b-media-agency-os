"use client";

import { useEffect, useState } from "react";

const DEFAULT_STEPS = ["Gathering details…", "Connecting to your data sources…", "Reading performance data…", "Matching CRM leads and deals…", "Building charts…", "Checking every figure…", "Finalising your report…"];

/** Animated "computer at work" shown while a report is generating: charts draw on a screen while the status line updates. */
export function ReportGeneratingAnimation({ steps = DEFAULT_STEPS, title = "Generating your report" }: { steps?: string[]; title?: string }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setIndex(0);
    const timer = window.setInterval(() => setIndex((current) => Math.min(current + 1, steps.length - 1)), 2200);
    return () => window.clearInterval(timer);
  }, [steps]);
  return (
    <div className="rga" role="status" aria-live="polite">
      <svg className="rga-art" viewBox="0 0 320 220" aria-hidden="true">
        <defs>
          <linearGradient id="rga-screen" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#f5f9ff" /><stop offset="1" stopColor="#e8f0fe" /></linearGradient>
          <linearGradient id="rga-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#2f6ff0" stopOpacity=".35" /><stop offset="1" stopColor="#2f6ff0" stopOpacity="0" /></linearGradient>
        </defs>
        <ellipse cx="160" cy="206" rx="110" ry="8" className="rga-shadow" />
        <rect x="132" y="168" width="56" height="26" rx="4" className="rga-stand" />
        <rect x="104" y="190" width="112" height="10" rx="5" className="rga-stand" />
        <rect x="30" y="14" width="260" height="160" rx="14" className="rga-frame" />
        <rect x="42" y="26" width="236" height="134" rx="8" fill="url(#rga-screen)" />
        <circle cx="160" cy="20" r="2" className="rga-cam" />
        {/* top bar */}
        <rect x="52" y="34" width="54" height="7" rx="3.5" className="rga-chip" />
        <circle cx="262" cy="38" r="5" className="rga-pulse" />
        {/* KPI tiles */}
        {[0, 1, 2].map((i) => <g key={i} className="rga-kpi" style={{ animationDelay: `${i * 0.25}s` }}><rect x={52 + i * 46} y="48" width="40" height="22" rx="5" className="rga-tile" /><rect x={57 + i * 46} y="54" width="18" height="4" rx="2" className="rga-chip" /><rect x={57 + i * 46} y="61" width="26" height="5" rx="2.5" className="rga-ink" /></g>)}
        {/* bar chart */}
        {[26, 40, 33, 52, 46, 62].map((h, i) => <rect key={i} x={54 + i * 15} y={150 - h} width="10" height={h} rx="2.5" className="rga-bar" style={{ animationDelay: `${0.15 * i}s` }} />)}
        {/* line + area */}
        <path d="M150 140 L170 128 L188 132 L206 112 L224 116 L242 96 L262 90 L262 150 L150 150 Z" fill="url(#rga-area)" className="rga-areafill" />
        <path d="M150 140 L170 128 L188 132 L206 112 L224 116 L242 96 L262 90" className="rga-line" />
        <circle cx="262" cy="90" r="4" className="rga-dot" />
        {/* donut */}
        <g transform="translate(232 62)"><circle r="13" className="rga-ring" /><circle r="13" className="rga-ring-fill" transform="rotate(-90)" /></g>
        {/* sparkles */}
        <path d="M296 30 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z" className="rga-spark" />
        <path d="M22 90 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" className="rga-spark s2" />
      </svg>
      <div className="rga-text">
        <b>{title}</b>
        <span key={index} className="rga-step">{steps[index]}</span>
        <div className="rga-progress" aria-hidden="true"><i style={{ width: `${Math.round(((index + 1) / steps.length) * 100)}%` }} /></div>
      </div>
    </div>
  );
}
