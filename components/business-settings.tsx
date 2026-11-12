"use client";

import { useEffect, useState } from "react";
import { CURRENCIES } from "@/lib/display-currency";
import { DEFAULT_BRANDING, logoFileToDataUrl, normalizeBranding, type Branding } from "@/lib/branding";
import { TAX_COUNTRIES, taxCountry, type BusinessType, type TaxCountry, type TaxSettings } from "@/lib/tax-rules";

export type BusinessSettingsValue = { currency?: string; branding?: Partial<Branding>; tax?: TaxSettings };
type Draft = { name: string; logo: string; primary: string; secondary: string; currency: string; country: TaxCountry; defaultBusinessType: "" | BusinessType; otherPersonalRate: string; otherCompanyRate: string };

const PRESETS = ["#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#0ea5e9", "#64748b"];
const hex = (value: string) => /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim().toLowerCase() : "";

function toDraft(value: BusinessSettingsValue): Draft {
  const branding = normalizeBranding(value.branding);
  return { name: branding.name, logo: branding.logo, primary: branding.primary, secondary: branding.secondary, currency: value.currency || "EUR", country: taxCountry(value.tax), defaultBusinessType: value.tax?.defaultBusinessType || "", otherPersonalRate: String(value.tax?.otherPersonalRate ?? 20), otherCompanyRate: String(value.tax?.otherCompanyRate ?? 20) };
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return <div className="bs-field"><span className="bs-label">{label}</span>
    <div className="bs-color"><input type="color" aria-label={`${label} picker`} value={value} onChange={(event) => onChange(event.target.value)} />
      <input className="bs-hex" aria-label={`${label} hex`} value={text} maxLength={7} spellCheck={false} onChange={(event) => { setText(event.target.value); const ok = hex(event.target.value); if (ok) onChange(ok); }} onBlur={() => setText(value)} /></div>
    <div className="bs-swatches" role="group" aria-label={`${label} presets`}>{PRESETS.map((color) => <button type="button" key={color} className={color === value ? "on" : ""} style={{ background: color }} aria-label={color} onClick={() => onChange(color)} />)}</div></div>;
}

export function BusinessSettings({ value, onSave }: { value: BusinessSettingsValue; onSave: (next: BusinessSettingsValue) => Promise<void> | void }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(value));
  const [saved, setSaved] = useState<Draft>(() => toDraft(value));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => { const next = toDraft(value); setSaved(next); setDraft((current) => JSON.stringify(current) === JSON.stringify(saved) ? next : current); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [JSON.stringify(value)]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (patch: Partial<Draft>) => { setJustSaved(false); setDraft((current) => ({ ...current, ...patch })); };
  const save = async () => {
    setBusy(true); setError("");
    try {
      await onSave({
        currency: draft.currency,
        branding: draft.name || draft.logo || draft.primary !== DEFAULT_BRANDING.primary || draft.secondary !== DEFAULT_BRANDING.secondary ? { name: draft.name.trim(), logo: draft.logo, primary: draft.primary, secondary: draft.secondary } : undefined,
        tax: { country: draft.country, defaultBusinessType: draft.defaultBusinessType || undefined, otherPersonalRate: Math.min(80, Math.max(0, Number(draft.otherPersonalRate) || 0)), otherCompanyRate: Math.min(80, Math.max(0, Number(draft.otherCompanyRate) || 0)) },
      });
      setSaved(draft); setJustSaved(true); window.setTimeout(() => setJustSaved(false), 2500);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save. Please try again."); }
    finally { setBusy(false); }
  };
  const upload = (file?: File) => { if (!file) return; setError(""); void logoFileToDataUrl(file).then((logo) => set({ logo })).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not use that image.")); };
  const preview = { "--bs-primary": draft.primary, "--bs-secondary": draft.secondary } as React.CSSProperties;

  return <section className="bs" aria-labelledby="business-settings-heading">
    <header className="bs-head"><div><p className="eyebrow">WORKSPACE</p><h2 id="business-settings-heading">Business settings</h2><p>Your brand, currency and tax. Everything here applies across the whole workspace and every client.</p></div>
      <div className="bs-actions">{justSaved && <span className="bs-saved" role="status">✓ Saved</span>}{dirty && <button type="button" className="bs-ghost" onClick={() => { setDraft(saved); setError(""); }}>Discard</button>}<button type="button" className="bs-save" disabled={!dirty || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save changes"}</button></div></header>
    {error && <p className="bs-error" role="alert">{error}</p>}
    <div className="bs-body">
      <div className="bs-col">
        <div className="bs-group"><h3>Brand</h3>
          <div className="bs-field"><span className="bs-label">Logo</span>
            <div className="bs-logo"><span className="bs-logo-tile">{draft.logo ? <img src={draft.logo} alt="Logo" /> : <img src="/f2b-home-icon.png" alt="Default logo" className="dim" />}</span>
              <div className="bs-logo-actions"><label className="bs-btn">{draft.logo ? "Replace logo" : "Upload logo"}<input type="file" accept="image/*" hidden onChange={(event) => { upload(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /></label>{draft.logo && <button type="button" className="bs-link" onClick={() => set({ logo: "" })}>Remove</button>}<small>PNG, JPG, SVG or WebP · square works best</small></div></div></div>
          <label className="bs-field"><span className="bs-label">Business name</span><input className="bs-input" value={draft.name} maxLength={60} placeholder="F2B Media" onChange={(event) => set({ name: event.target.value })} /></label>
          <div className="bs-two"><ColorField label="Primary colour" value={draft.primary} onChange={(primary) => set({ primary })} /><ColorField label="Secondary colour" value={draft.secondary} onChange={(secondary) => set({ secondary })} /></div></div>
        <div className="bs-group"><h3>Money & tax</h3>
          <div className="bs-two">
            <label className="bs-field"><span className="bs-label">Currency</span><select className="bs-input" value={draft.currency} onChange={(event) => set({ currency: event.target.value })}>{CURRENCIES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
            <label className="bs-field"><span className="bs-label">Country for tax</span><select className="bs-input" value={draft.country} onChange={(event) => set({ country: event.target.value as TaxCountry })}>{TAX_COUNTRIES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
          </div>
          <div className="bs-field"><span className="bs-label">Default company type for clients</span>
            <div className="bs-seg" role="radiogroup" aria-label="Default company type">{([["", "Ask each time"], ["sole_trader", "Sole trader"], ["company", "Company"]] as const).map(([key, label]) => <button type="button" role="radio" aria-checked={draft.defaultBusinessType === key} key={key} className={draft.defaultBusinessType === key ? "on" : ""} onClick={() => set({ defaultBusinessType: key })}>{label}</button>)}</div></div>
          {draft.country === "OTHER" && <div className="bs-two"><label className="bs-field"><span className="bs-label">Personal tax rate (%)</span><input className="bs-input" inputMode="decimal" value={draft.otherPersonalRate} onChange={(event) => set({ otherPersonalRate: event.target.value.replace(/[^0-9.]/g, "") })} /></label><label className="bs-field"><span className="bs-label">Company tax rate (%)</span><input className="bs-input" inputMode="decimal" value={draft.otherCompanyRate} onChange={(event) => set({ otherCompanyRate: event.target.value.replace(/[^0-9.]/g, "") })} /></label></div>}
          <small className="bs-hint">Ireland uses 2026 rates, the United Kingdom 2026/27. Tax figures are estimates, not tax advice.</small></div>
      </div>
      <aside className="bs-preview" style={preview} aria-label="Live preview"><span className="bs-label">Live preview</span>
        <div className="bs-mock"><div className="bs-mock-side"><span className="bs-mock-logo">{draft.logo ? <img src={draft.logo} alt="" /> : <img src="/f2b-home-icon.png" alt="" />}</span><b>{draft.name || "Your business"}</b><i className="on" /><i /><i /></div>
          <div className="bs-mock-main"><div className="bs-mock-tabs"><span className="on">Board</span><span>Approvals</span><span>History</span></div><div className="bs-mock-card"><b>Website redesign</b><small>{draft.currency} · {TAX_COUNTRIES.find((item) => item.code === draft.country)?.label.replace(/ \(.*/, "")}</small><span className="bs-mock-chip">In progress</span></div><button type="button" className="bs-mock-btn" tabIndex={-1}>Primary action</button><button type="button" className="bs-mock-btn alt" tabIndex={-1}>Secondary</button></div></div></aside>
    </div>
  </section>;
}
