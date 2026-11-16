"use client";
import { useEffect, useRef, useState } from "react";

export type CampaignOption = { value: string; name: string; client?: string; logo?: string; spend?: number; status?: string };
const isActive = (o: CampaignOption) => !/paus|remov|disabl|archiv|delet|end/i.test(o.status || "") || (o.spend || 0) > 0;

/** Campaign dropdown with client logos and spend. Shows active campaigns by default, paused ones on request. */
export function CampaignPicker({ options, value, onChange, currency = "EUR", label = "Campaign" }: { options: CampaignOption[]; value: string; onChange: (v: string) => void; currency?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close); }, [open]);
  const money = (n: number) => { try { return new Intl.NumberFormat("en-IE", { style: "currency", currency, maximumFractionDigits: 0 }).format(n); } catch { return `€${Math.round(n)}`; } };
  const active = options.filter(isActive);
  const list = (showAll ? options : active).slice().sort((a, b) => (b.spend || 0) - (a.spend || 0));
  const current = options.find((o) => o.value === value);
  const total = active.reduce((a, o) => a + (o.spend || 0), 0);
  const Logo = ({ o }: { o?: CampaignOption }) => o?.logo ? <img className="cp-logo" src={o.logo} alt="" /> : <span className="cp-logo cp-logo-fb">{(o?.client || o?.name || "•").slice(0, 1)}</span>;
  return <div className="cp" ref={ref}>
    <button type="button" className="cp-trigger" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen((v) => !v)}>
      {current ? <><Logo o={current} /><span className="cp-name">{current.client ? `${current.client} · ` : ""}{current.name}</span>{current.spend != null && <b className="cp-spend">{money(current.spend)}</b>}</> : <><span className="cp-name">All active campaigns ({active.length})</span>{total > 0 && <b className="cp-spend">{money(total)}</b>}</>}<span className="cp-caret" aria-hidden="true">▾</span>
    </button>
    {open && <div className="cp-menu" role="listbox">
      <button type="button" role="option" aria-selected={!value} className={`cp-opt ${!value ? "is-on" : ""}`} onClick={() => { onChange(""); setOpen(false); }}><span className="cp-logo cp-logo-fb">∑</span><span className="cp-name">All active campaigns ({active.length})</span>{total > 0 && <b className="cp-spend">{money(total)}</b>}</button>
      {list.map((o) => <button type="button" role="option" key={o.value} aria-selected={o.value === value} className={`cp-opt ${o.value === value ? "is-on" : ""} ${isActive(o) ? "" : "is-paused"}`} onClick={() => { onChange(o.value); setOpen(false); }}><Logo o={o} /><span className="cp-name"><span>{o.name}</span>{o.client && <small>{o.client}{isActive(o) ? "" : " · paused"}</small>}</span><b className="cp-spend">{o.spend != null ? money(o.spend) : ""}</b></button>)}
      {!list.length && <p className="cp-empty">No active campaigns in this period.</p>}
      {options.length > active.length && <button type="button" className="cp-toggle" onClick={() => setShowAll((v) => !v)}>{showAll ? "Hide paused campaigns" : `Show paused (${options.length - active.length})`}</button>}
    </div>}
  </div>;
}
