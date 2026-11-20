"use client";
// Client workroom → Contracts. Build a contract from the services you pick (scope of work is added for each
// one), with F2B's standard terms: 90-day minimum, 30 days' notice, billed on the 1st, subscription discount,
// services paused at 14 days overdue, ad-account downtime on the client, GDPR terms. Send it to sign online;
// once signed, the frozen signed copy is filed here on the client's profile. Agency admins only.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appConfirm } from "./app-dialog";
import { SendDocumentEmail, MailIcon, type DocumentEmailTarget } from "./send-document-email";
import "./client-contracts.css";

type Service = { name: string; monthlyFee: number; setupFee: number; notes: string };
type Data = {
  title: string; services: Service[];
  terms: { startDate: string; currency: "EUR" | "GBP" | "USD"; minimumTermDays: number; noticeDays: number; billingDay: number; overdueDays: number; subscriptionDiscountPct: number; extraTerms: string };
  parties: { providerName: string; providerAddress: string; providerEmail: string; providerSigner: string; governingLaw: string; clientName: string; clientAddress: string; signerName: string; signerEmail: string };
};
type Row = { id: string; reference: string; title: string; status: string; monthlyTotal: number; shared: boolean; sentAt: string | null; viewedAt: string | null; signedAt: string | null; signer: string; currency: string; updatedAt: string };
type Catalogue = Array<{ name: string; summary: string }>;

async function api<T>(body?: unknown, query = ""): Promise<T> {
  const res = await fetch(`/api/contracts${query}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const json = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || "Something went wrong.");
  return json;
}
const sym = (c: string) => c === "GBP" ? "£" : c === "USD" ? "$" : "€";
const fmt = (n: number, c: string) => `${sym(c)}${n.toLocaleString("en-IE", { maximumFractionDigits: 2 })}`;
const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" }) : "";
const STATUS: Record<string, string> = { draft: "Draft", sent: "Sent", viewed: "Opened", signed: "Signed", void: "Cancelled" };

const DocIcon = ({ size = 16 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h5" /></svg>;
const PenIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>;
const LinkIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></svg>;
const EyeIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>;
const DownIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>;
const BinIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></svg>;

export function ClientContracts({ clientId, clientName, onCount }: { clientId: string; clientName: string; onCount?: (n: number) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [fresh, setFresh] = useState<Data | null>(null);
  const [catalogue, setCatalogue] = useState<Catalogue>([]);
  const [laws, setLaws] = useState<string[]>(["Ireland"]);
  const [edit, setEdit] = useState<{ id: string | null; data: Data } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [emailTarget, setEmailTarget] = useState<DocumentEmailTarget | null>(null);
  const [agencyOpen, setAgencyOpen] = useState(false);
  const onCountRef = useRef(onCount); onCountRef.current = onCount;

  const load = useCallback(async () => {
    try {
      const r = await api<{ contracts: Row[]; draft: Data; catalogue: Catalogue; laws: string[] }>(undefined, `?clientId=${encodeURIComponent(clientId)}`);
      setRows(r.contracts); setFresh(r.draft); setCatalogue(r.catalogue); setLaws(r.laws); onCountRef.current?.(r.contracts.filter((c) => c.status !== "void").length);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't load contracts."); setRows([]); }
  }, [clientId]);
  useEffect(() => { setRows(null); setEdit(null); setError(""); setNote(""); void load(); }, [load]);
  useEffect(() => { if (!note) return; const t = window.setTimeout(() => setNote(""), 3500); return () => window.clearTimeout(t); }, [note]);

  const startNew = () => { if (fresh) { setEdit({ id: null, data: JSON.parse(JSON.stringify(fresh)) }); setAgencyOpen(!fresh.parties.providerAddress); setError(""); } };
  const openEdit = async (id: string) => {
    setBusy(id); setError("");
    try { const r = await api<{ contract: { id: string; data: Data } }>(undefined, `?id=${encodeURIComponent(id)}`); setEdit({ id: r.contract.id, data: r.contract.data }); setAgencyOpen(false); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't open the contract."); } finally { setBusy(""); }
  };
  const save = async (then?: "preview" | "send" | "link") => {
    if (!edit) return null;
    setBusy("save"); setError("");
    try {
      const r = edit.id ? await api<{ contract: { id: string; data: Data } }>({ action: "update", id: edit.id, data: edit.data }) : await api<{ contract: { id: string; data: Data } }>({ action: "create", clientId, data: edit.data });
      const id = r.contract.id;
      setEdit({ id, data: r.contract.data });
      await load();
      if (then === "preview") window.open(`/api/contracts?html=${encodeURIComponent(id)}`, "_blank", "noopener");
      if (then === "send") { setEmailTarget({ kind: "contract", id }); }
      if (then === "link") await copyLink(id);
      if (!then) setNote("Contract saved");
      return id;
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't save the contract."); return null; } finally { setBusy(""); }
  };
  const copyLink = async (id: string) => {
    setBusy(`link-${id}`); setError("");
    try {
      const r = await api<{ url: string }>({ action: "share", id });
      await navigator.clipboard.writeText(r.url).catch(() => undefined);
      setNote("Signing link copied"); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't create the link."); } finally { setBusy(""); }
  };
  const remove = async (row: Row) => {
    const sent = row.status !== "draft";
    if (!(await appConfirm(sent ? `Cancel “${row.title}” (${row.reference})? The signing link will stop working.` : `Delete the draft “${row.title}”?`))) return;
    setBusy(row.id);
    try { await api(sent ? { action: "void", id: row.id } : { action: "delete", id: row.id }); if (edit?.id === row.id) setEdit(null); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't update the contract."); } finally { setBusy(""); }
  };

  const d = edit?.data;
  const set = (patch: (draft: Data) => void) => setEdit((cur) => { if (!cur) return cur; const next = JSON.parse(JSON.stringify(cur.data)) as Data; patch(next); return { ...cur, data: next }; });
  const totals = useMemo(() => {
    if (!d) return { monthly: 0, setup: 0, discounted: 0 };
    const monthly = d.services.reduce((s, x) => s + (Number(x.monthlyFee) || 0), 0), setup = d.services.reduce((s, x) => s + (Number(x.setupFee) || 0), 0);
    return { monthly, setup, discounted: Math.round(monthly * (1 - (Number(d.terms.subscriptionDiscountPct) || 0) / 100) * 100) / 100 };
  }, [d]);
  const toggleService = (name: string) => set((x) => { const i = x.services.findIndex((s) => s.name === name); if (i >= 0) x.services.splice(i, 1); else x.services.push({ name, monthlyFee: 0, setupFee: 0, notes: "" }); });
  const signedRows = (rows || []).filter((r) => r.status === "signed");

  return <section className="cc-panel">
    <div className="workroom-head"><div><h3><span className="cc-h-icon"><DocIcon /></span> Contracts</h3><p>Build a contract from the services you pick, send it to sign online, and the signed copy is filed here.</p></div>{!edit && <button type="button" className="primary-button cc-new" onClick={startNew} disabled={!fresh}>＋ New contract</button>}</div>
    {error && <div className="form-error" role="alert">{error}</div>}
    {note && <div className="cc-note" role="status">✓ {note}</div>}

    {edit && d && <div className="cc-editor">
      <div className="cc-ed-head"><input className="cc-title" value={d.title} maxLength={120} onChange={(e) => set((x) => { x.title = e.target.value; })} aria-label="Contract title" data-no-ai /><button type="button" className="cc-x" aria-label="Close editor" onClick={() => setEdit(null)}>✕</button></div>

      <h4>1 · Services &amp; scope of work</h4>
      <p className="cc-hint">Pick the services this contract covers. The scope of work for each one is written into the contract automatically.</p>
      <div className="cc-svc-grid">{catalogue.map((s) => { const on = d.services.some((x) => x.name === s.name); return <button key={s.name} type="button" className={`cc-svc ${on ? "on" : ""}`} aria-pressed={on} onClick={() => toggleService(s.name)} title={s.summary}><i aria-hidden="true">{on ? "✓" : "＋"}</i><span>{s.name}</span></button>; })}</div>
      {d.services.length > 0 && <div className="cc-lines">
        <div className="cc-line cc-line-head"><span>Service</span><span>Setup</span><span>Monthly</span><span>Notes (optional)</span><span /></div>
        {d.services.map((s, i) => <div className="cc-line" key={`${s.name}-${i}`}>
          <b>{s.name}</b>
          <label><span className="cc-cur">{sym(d.terms.currency)}</span><input type="number" min={0} step="1" value={s.setupFee || ""} placeholder="0" onChange={(e) => set((x) => { x.services[i].setupFee = Number(e.target.value) || 0; })} aria-label={`${s.name} setup fee`} /></label>
          <label><span className="cc-cur">{sym(d.terms.currency)}</span><input type="number" min={0} step="1" value={s.monthlyFee || ""} placeholder="0" onChange={(e) => set((x) => { x.services[i].monthlyFee = Number(e.target.value) || 0; })} aria-label={`${s.name} monthly fee`} /></label>
          <input type="text" value={s.notes} maxLength={600} placeholder="e.g. 2 advice posts a month" onChange={(e) => set((x) => { x.services[i].notes = e.target.value; })} aria-label={`${s.name} notes`} />
          <button type="button" className="cc-icon" title={`Remove ${s.name}`} aria-label={`Remove ${s.name}`} onClick={() => set((x) => { x.services.splice(i, 1); })}>✕</button>
        </div>)}
        <div className="cc-totals"><span>Setup <b>{fmt(totals.setup, d.terms.currency)}</b></span><span>Monthly <b>{fmt(totals.monthly, d.terms.currency)}</b></span>{d.terms.subscriptionDiscountPct > 0 && totals.monthly > 0 && <span className="cc-disc">By subscription <b>{fmt(totals.discounted, d.terms.currency)}</b></span>}</div>
      </div>}

      <h4>2 · Billing</h4>
      <div className="cc-grid">
        <label className="field"><span>Start date</span><input type="date" value={d.terms.startDate} onChange={(e) => set((x) => { x.terms.startDate = e.target.value; })} /></label>
        <label className="field"><span>Currency</span><select value={d.terms.currency} onChange={(e) => set((x) => { x.terms.currency = e.target.value as Data["terms"]["currency"]; })}><option value="EUR">€ Euro</option><option value="GBP">£ Sterling</option><option value="USD">$ US dollar</option></select></label>
        <label className="field"><span>Subscription payment discount</span><span className="cc-pct"><input type="number" min={0} max={50} step="0.5" value={d.terms.subscriptionDiscountPct} onChange={(e) => set((x) => { x.terms.subscriptionDiscountPct = Number(e.target.value) || 0; })} /><i>%</i></span></label>
      </div>
      <ul className="cc-std" aria-label="Standard terms">
        <li><b>{d.terms.minimumTermDays}-day</b> minimum term</li><li><b>{d.terms.noticeDays} days'</b> notice</li><li>Billed monthly on the <b>1st</b></li><li>Paused at <b>{d.terms.overdueDays} days</b> overdue</li><li>Ad-account downtime: <b>fees still apply</b></li><li><b>GDPR</b> &amp; data processing</li>
      </ul>

      <h4>3 · Client details</h4>
      <div className="cc-grid">
        <label className="field"><span>Business / legal name</span><input value={d.parties.clientName} maxLength={160} onChange={(e) => set((x) => { x.parties.clientName = e.target.value; })} placeholder={clientName} /></label>
        <label className="field"><span>Business address</span><input value={d.parties.clientAddress} maxLength={300} onChange={(e) => set((x) => { x.parties.clientAddress = e.target.value; })} placeholder="Street, town, county" /></label>
        <label className="field"><span>Person signing</span><input value={d.parties.signerName} maxLength={120} onChange={(e) => set((x) => { x.parties.signerName = e.target.value; })} placeholder="Full name" /></label>
        <label className="field"><span>Their email</span><input type="email" value={d.parties.signerEmail} maxLength={200} onChange={(e) => set((x) => { x.parties.signerEmail = e.target.value; })} placeholder="name@business.ie" data-no-ai /></label>
      </div>

      <button type="button" className="cc-fold" aria-expanded={agencyOpen} onClick={() => setAgencyOpen(!agencyOpen)}>{agencyOpen ? "▾" : "▸"} Your agency details <small>{d.parties.providerName}{d.parties.providerAddress ? "" : " · add your address"}</small></button>
      {agencyOpen && <div className="cc-grid">
        <label className="field"><span>Agency legal name</span><input value={d.parties.providerName} maxLength={120} onChange={(e) => set((x) => { x.parties.providerName = e.target.value; })} /></label>
        <label className="field"><span>Agency address</span><input value={d.parties.providerAddress} maxLength={300} onChange={(e) => set((x) => { x.parties.providerAddress = e.target.value; })} placeholder="Registered address" /></label>
        <label className="field"><span>Agency email</span><input type="email" value={d.parties.providerEmail} maxLength={200} onChange={(e) => set((x) => { x.parties.providerEmail = e.target.value; })} data-no-ai /></label>
        <label className="field"><span>Signing for the agency</span><input value={d.parties.providerSigner} maxLength={120} onChange={(e) => set((x) => { x.parties.providerSigner = e.target.value; })} /></label>
        <label className="field"><span>Governing law</span><select value={d.parties.governingLaw} onChange={(e) => set((x) => { x.parties.governingLaw = e.target.value; })}>{laws.map((l) => <option key={l}>{l}</option>)}</select></label>
        <p className="cc-hint full">Saved as your default for future contracts.</p>
      </div>}

      <label className="field cc-extra"><span>Additional terms (optional)</span><textarea rows={3} maxLength={3000} value={d.terms.extraTerms} onChange={(e) => set((x) => { x.terms.extraTerms = e.target.value; })} placeholder="Anything specific to this client" /></label>

      <div className="cc-actions">
        <button type="button" className="secondary-button" onClick={() => setEdit(null)} disabled={busy === "save"}>Cancel</button>
        <button type="button" className="secondary-button" onClick={() => void save("preview")} disabled={busy === "save"}><EyeIcon /> Preview</button>
        <button type="button" className="secondary-button" onClick={() => void save()} disabled={busy === "save"}>{busy === "save" ? "Saving…" : "Save draft"}</button>
        <button type="button" className="secondary-button" onClick={() => void save("link")} disabled={busy === "save" || !d.services.length}><LinkIcon /> Copy signing link</button>
        <button type="button" className="primary-button" onClick={() => void save("send")} disabled={busy === "save" || !d.services.length}><MailIcon size={15} /> Send to sign</button>
      </div>
    </div>}

    {rows === null ? <div className="page-loading" role="status" aria-label="Loading…"><i /></div> : rows.length === 0 && !edit ? <div className="empty-note">No contracts yet. Create one from this client’s services and send it to sign online.</div> : <div className="cc-list">
      {signedRows.length > 0 && <small className="cc-group">Signed · on file</small>}
      {[...signedRows, ...rows.filter((r) => r.status !== "signed")].map((r, i) => <div key={r.id}>
        {i === signedRows.length && signedRows.length > 0 && <small className="cc-group">Other contracts</small>}
        <article className={`cc-row s-${r.status}`}>
          <span className="cc-row-icon"><DocIcon size={18} /></span>
          <div className="cc-row-main"><b>{r.title}</b><small>{r.reference} · {r.monthlyTotal ? `${fmt(r.monthlyTotal, r.currency)}/mo · ` : ""}{r.status === "signed" ? `Signed by ${r.signer} · ${day(r.signedAt)}` : r.viewedAt ? `Opened ${day(r.viewedAt)}` : r.sentAt ? `Sent ${day(r.sentAt)}` : `Updated ${day(r.updatedAt)}`}</small></div>
          <span className={`cc-pill s-${r.status}`}>{STATUS[r.status] || r.status}</span>
          <span className="cc-row-actions">
            <a className="cc-icon" href={`/api/contracts?html=${encodeURIComponent(r.id)}`} target="_blank" rel="noopener" title={r.status === "signed" ? "View signed copy" : "Preview"} aria-label={`View ${r.title}`}><EyeIcon /></a>
            {r.status === "signed" && <a className="cc-icon" href={`/api/contracts?html=${encodeURIComponent(r.id)}&print=1`} target="_blank" rel="noopener" title="Download PDF" aria-label={`Download ${r.title} as PDF`}><DownIcon /></a>}
            {r.status !== "void" && r.status !== "signed" && <button type="button" className="cc-icon" title="Edit" aria-label={`Edit ${r.title}`} disabled={busy === r.id} onClick={() => void openEdit(r.id)}><PenIcon /></button>}
            {r.status !== "void" && <button type="button" className="cc-icon" title="Copy link" aria-label={`Copy link for ${r.title}`} disabled={busy === `link-${r.id}`} onClick={() => void copyLink(r.id)}><LinkIcon /></button>}
            {r.status !== "void" && <button type="button" className="cc-icon" title={r.status === "signed" ? "Email signed copy" : "Send to sign"} aria-label={`Email ${r.title}`} onClick={() => setEmailTarget({ kind: "contract", id: r.id })}><MailIcon size={15} /></button>}
            {r.status !== "signed" && r.status !== "void" && <button type="button" className="cc-icon danger" title={r.status === "draft" ? "Delete draft" : "Cancel contract"} aria-label={`Remove ${r.title}`} disabled={busy === r.id} onClick={() => void remove(r)}><BinIcon /></button>}
          </span>
        </article>
      </div>)}
    </div>}
    <SendDocumentEmail target={emailTarget} onClose={() => setEmailTarget(null)} onSent={() => { setNote("Contract sent"); void load(); }} />
  </section>;
}
