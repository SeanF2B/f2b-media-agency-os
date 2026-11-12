"use client";

import { useEffect, useState } from "react";
import { ColorField } from "@/components/business-settings";
import { DEFAULT_BRANDING, logoFileToDataUrl, normalizeBranding, type Branding } from "@/lib/branding";

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
  return <section className="bs-card client-brand-card" aria-label={`${clientName} brand`}>
    <header className="bs-head"><div><h2>{clientName} brand</h2><p>Their own logo and colours. Shown in the app, including the pipeline, while {clientName} is selected.</p></div></header>
    <div className="bs-grid">
      <div className="bs-field"><span className="bs-label">Logo</span>
        <div className="bs-logo">{draft.logo ? <img src={draft.logo} alt="" /> : <span className="bs-logo-empty">No logo</span>}
          <label className="secondary-button">Upload logo<input type="file" accept="image/*" hidden onChange={async (event) => { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; try { setError(""); setDraft((d) => ({ ...d, logo: "" })); const logo = await logoFileToDataUrl(file); setDraft((d) => ({ ...d, logo })); } catch (e) { setError(e instanceof Error ? e.message : "That logo could not be used."); } }} /></label>
          {draft.logo && <button type="button" className="secondary-button" onClick={() => setDraft((d) => ({ ...d, logo: "" }))}>Remove</button>}</div></div>
      <ColorField label="Primary colour" value={draft.primary} onChange={(primary) => setDraft((d) => ({ ...d, primary }))} />
      <ColorField label="Secondary colour" value={draft.secondary} onChange={(secondary) => setDraft((d) => ({ ...d, secondary }))} />
    </div>
    {error && <p className="bs-error" role="alert">{error}</p>}
    <footer className="bs-foot">
      <button type="button" className="primary-button" disabled={busy || !dirty} onClick={() => void run(draft)}>{busy ? "Saving…" : "Save brand"}</button>
      {own && <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(null)}>Use agency brand</button>}
      <span className="bs-hint">{own ? "Custom brand on." : "Using the agency brand."}</span>
    </footer>
  </section>;
}
export { DEFAULT_BRANDING };
