"use client";

import { useEffect, useState } from "react";
import { logoFileToDataUrl, normalizeBranding, type Branding } from "@/lib/branding";

const SWATCHES = ["#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#0ea5e9", "#64748b"];
const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v.trim());

function Colour({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return <div className="cb-colour"><span className="cb-label">{label}</span>
    <div className="cb-colour-row"><input type="color" aria-label={`${label} picker`} value={value} onChange={(e) => onChange(e.target.value)} />
      <input className="cb-hex" aria-label={`${label} hex`} value={text} maxLength={7} spellCheck={false} onChange={(e) => { setText(e.target.value); if (isHex(e.target.value)) onChange(e.target.value.trim().toLowerCase()); }} onBlur={() => setText(value)} /></div>
    <div className="cb-swatches" role="group" aria-label={`${label} presets`}>{SWATCHES.map((c) => <button type="button" key={c} className={c === value ? "on" : ""} style={{ background: c }} aria-label={c} onClick={() => onChange(c)} />)}</div></div>;
}

/** Per-client brand: their own logo and two colours. While that client is selected, the whole app (CRM included) uses them. */
export function ClientBranding({ clientName, value, agency, onSave }: { clientName: string; value?: Partial<Branding>; agency?: Partial<Branding>; onSave: (next: Branding | null) => Promise<void> | void }) {
  const base = normalizeBranding(agency);
  const own = value && (value.primary || value.secondary || value.logo) ? normalizeBranding({ ...base, ...value }) : null;
  const start = own || { ...base, logo: "", name: "" };
  const [draft, setDraft] = useState<Branding>(start);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setDraft(own || { ...base, logo: "", name: "" }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [JSON.stringify(value), JSON.stringify(agency)]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(start);
  const run = async (next: Branding | null) => { setBusy(true); setError(""); try { await onSave(next); } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); } finally { setBusy(false); } };
  return <section className="cb-card" aria-label={`${clientName} brand`}>
    <header className="cb-head"><div><h2>{clientName} brand</h2><p>Their own logo and colours, used across the app while {clientName} is selected.</p></div>
      <span className={`cb-status ${own ? "on" : ""}`}>{own ? "Custom brand on" : "Using agency brand"}</span></header>
    <div className="cb-body">
      <div className="cb-logo"><span className="cb-label">Logo</span>
        <div className="cb-logo-box">{draft.logo ? <img src={draft.logo} alt="" /> : <span>No logo</span>}</div>
        <div className="cb-logo-actions"><label className="secondary-button">{draft.logo ? "Change" : "Upload"}<input type="file" accept="image/*" hidden onChange={async (event) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; try { setError(""); const logo = await logoFileToDataUrl(file); setDraft((d) => ({ ...d, logo })); } catch (e) { setError(e instanceof Error ? e.message : "That logo could not be used."); } }} /></label>
          {draft.logo && <button type="button" className="cb-link" onClick={() => setDraft((d) => ({ ...d, logo: "" }))}>Remove</button>}</div></div>
      <Colour label="Primary colour" value={draft.primary} onChange={(primary) => setDraft((d) => ({ ...d, primary }))} />
      <Colour label="Secondary colour" value={draft.secondary} onChange={(secondary) => setDraft((d) => ({ ...d, secondary }))} />
    </div>
    {error && <p className="cb-error" role="alert">{error}</p>}
    <footer className="cb-foot">{own && <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(null)}>Use agency brand</button>}
      <button type="button" className="primary-button" disabled={busy || !dirty} onClick={() => void run(draft)}>{busy ? "Saving…" : "Save brand"}</button></footer>
  </section>;
}
