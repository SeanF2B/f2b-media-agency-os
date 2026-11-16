"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ChevronDown, ChevronRight, CircleCheck, ClipboardCheck, ExternalLink, Loader2, Mail, Save, X } from "lucide-react";
import type { BusinessType, TaxSettings } from "@/lib/tax-rules";
import { taxCountry } from "@/lib/tax-rules";
import { countryLabel, draftFigures, filingId, filingScope, filingRoute, inPeriod, periodsFor, RETURN_TYPES, returnTypesFor, unresolvedIssues, type BookRecord, type BooksContext, type FilingPeriod, type FilingReturn, type ReceiptCheckResult, type ReceiptIssue, type ReturnTypeId } from "@/lib/filing/model";
import { flowReducer, initialFlow } from "@/lib/filing/flow";

type Props = { scopeId: string; businessName: string; logo?: string; tax?: TaxSettings; businessType?: BusinessType | ""; books?: BooksContext; records: BookRecord[]; currency?: string; onClose: () => void; onOpenSettings?: () => void };

const QUESTION = "Would you like AI to check your connected email and Books export for this filing period? It’ll match receipts to transactions and flag anything missing, duplicated, or unclear.";
const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const ISSUE_LABEL: Record<ReceiptIssue["type"], string> = { missing: "Missing receipt", duplicate: "Possible duplicate", unclear: "Unclear", unmatched_receipt: "Receipt with no transaction" };

async function api<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/filing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(json.error || "Something went wrong. Please try again.");
  return json;
}

export function FilingFlow({ scopeId: rawScopeId, businessName, logo, tax, businessType, books = {}, records, currency = "EUR", onClose, onOpenSettings }: Props) {
  const scopeId = filingScope(rawScopeId);
  const types = useMemo(() => returnTypesFor(tax, businessType), [tax, businessType]);
  const [typeId, setTypeId] = useState<ReturnTypeId | "">(types[0]?.id || "");
  const type = typeId ? RETURN_TYPES[typeId] : null;
  const periods = useMemo(() => type ? periodsFor(type, todayKey()) : [], [type]);
  const [periodKey, setPeriodKey] = useState("");
  const period: FilingPeriod | undefined = periods.find((p) => p.key === periodKey) || periods[0];
  const [flow, dispatch] = useReducer(flowReducer, initialFlow);
  const [saved, setSaved] = useState<FilingReturn[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [trace, setTrace] = useState<string>("");
  const [ack, setAck] = useState({ reference: "", receivedAt: todayKey(), note: "" });
  const [savedAt, setSavedAt] = useState("");
  const money = (n: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: currency || "EUR" }).format(n || 0);
  const country = taxCountry(tax);

  useEffect(() => { let live = true; fetch(`/api/filing?scope=${encodeURIComponent(scopeId)}`, { cache: "no-store" }).then((r) => r.json()).then((j) => { if (live && Array.isArray(j.returns)) setSaved(j.returns); }).catch(() => {}); return () => { live = false; }; }, [scopeId]);
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { if (flow.confirmOpen) dispatch({ type: "BACK_TO_REVIEW" }); else onClose(); } }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [flow.confirmOpen, onClose]);

  // The return being worked on: live figures from the current Books records for its period.
  const ret = flow.ret;
  const retType = ret ? RETURN_TYPES[ret.returnTypeId] : type;
  const retPeriod = ret ? { start: ret.periodStart, end: ret.periodEnd } : period;
  const periodRecords = useMemo(() => retPeriod ? inPeriod(records, retPeriod) : [], [records, retPeriod?.start, retPeriod?.end]); // eslint-disable-line react-hooks/exhaustive-deps
  const recordById = useMemo(() => new Map(periodRecords.map((r) => [r.id, r])), [periodRecords]);
  const figures = useMemo(() => retType ? draftFigures(retType, periodRecords, tax, books) : null, [retType, periodRecords, tax, books]);
  const route = retType ? filingRoute(retType, tax) : null;
  const open = ret ? unresolvedIssues(ret) : [];
  const check: ReceiptCheckResult | undefined = ret?.receiptCheck.result;
  const emailById = useMemo(() => new Map((check?.emails || []).map((e) => [e.id, e])), [check]);

  const newDraft = (): FilingReturn | null => {
    if (!type || !period) return null;
    const existing = saved.find((s) => s.id === filingId(scopeId, type.id, period.key));
    return { ...(existing || {}), id: filingId(scopeId, type.id, period.key), scopeId, returnTypeId: type.id, periodKey: period.key, periodLabel: period.label, periodStart: period.start, periodEnd: period.end, businessName, country: type.country, status: existing?.status || "draft", receiptCheck: existing?.receiptCheck || { state: "skipped" }, resolvedIssueIds: existing?.resolvedIssueIds || [], createdAt: existing?.createdAt || "", updatedAt: existing?.updatedAt || "" };
  };

  // Save and resume: the draft is saved whenever it reaches review or changes there.
  const saveTimer = useRef<number | undefined>(undefined);
  const save = async (draft: FilingReturn) => {
    setBusy((b) => b || "save");
    try { const { return: stored } = await api<{ return: FilingReturn }>({ action: "save", scope: scopeId, return: { ...draft, businessName, figures: figures || undefined } }); dispatch({ type: "SAVED", ret: stored }); setSaved((list) => [stored, ...list.filter((s) => s.id !== stored.id)]); setSavedAt(new Date().toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" })); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn’t save the draft."); }
    finally { setBusy((b) => b === "save" ? "" : b); }
  };
  const draftKey = ret && flow.step === "review" ? `${ret.id}|${ret.receiptCheck.state}|${ret.receiptCheck.result?.scannedAt || ""}|${ret.resolvedIssueIds.join(",")}` : "";
  useEffect(() => { if (!draftKey || !ret || ret.status === "filed") return; window.clearTimeout(saveTimer.current); saveTimer.current = window.setTimeout(() => void save(ret), 500); return () => window.clearTimeout(saveTimer.current); }, [draftKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const checkReceipts = async () => {
    const draft = newDraft(); if (!draft || !period) return;
    setError(""); dispatch({ type: "CHECK_RECEIPTS", draft });
    try {
      const res = await api<{ connected: boolean; result?: ReceiptCheckResult }>({ action: "scan", scope: scopeId, period: { start: period.start, end: period.end }, records: inPeriod(records, period) });
      if (!res.connected || !res.result) dispatch({ type: "SCAN_DISCONNECTED" }); else dispatch({ type: "SCAN_DONE", result: res.result });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The receipt check didn’t finish."); dispatch({ type: "SCAN_FAILED" }); }
  };
  const skip = () => { const draft = newDraft(); if (draft) dispatch({ type: "SKIP_CHECK", draft }); };

  const continueToFiling = async () => {
    if (!ret || !route?.supported) return;
    window.open(route.url, "_blank", "noopener,noreferrer");
    setBusy("open");
    try { const { return: stored } = await api<{ return: FilingReturn }>({ action: "opened", scope: scopeId, id: ret.id }); dispatch({ type: "FILING_OPENED", ret: stored }); }
    catch { dispatch({ type: "FILING_OPENED", ret }); }
    finally { setBusy(""); }
  };
  const recordAck = async () => {
    if (!ret) return; setBusy("ack"); setError("");
    try { const { return: stored } = await api<{ return: FilingReturn }>({ action: "acknowledge", scope: scopeId, id: ret.id, ...ack }); dispatch({ type: "ACKNOWLEDGED", ret: stored }); setSaved((list) => [stored, ...list.filter((s) => s.id !== stored.id)]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn’t record the acknowledgement."); }
    finally { setBusy(""); }
  };

  const emailLink = (id: string) => `https://mail.google.com/mail/${check?.account ? `?authuser=${encodeURIComponent(check.account)}` : "u/0/"}#all/${encodeURIComponent(id)}`;
  const evidence = (recordId?: string, emailId?: string) => {
    const record = recordId ? recordById.get(recordId) : undefined; const email = emailId ? emailById.get(emailId) : undefined;
    return <span className="filing-evidence">
      {record?.receiptFileId && <a href={`/api/client-files?id=${encodeURIComponent(record.receiptFileId)}&preview=1`} target="_blank" rel="noreferrer"><ExternalLink size={12} aria-hidden="true" /> {record.receiptName || "Receipt"}</a>}
      {email && <a href={emailLink(email.id)} target="_blank" rel="noreferrer" title={email.snippet || email.subject}><Mail size={12} aria-hidden="true" /> {email.subject || "Email"}<small> · {email.from} · {email.date}</small></a>}
    </span>;
  };
  const recordRow = (id: string) => { const r = recordById.get(id); return r ? <span className="filing-rec"><span>{r.date}</span><b>{r.description}</b><small>{r.category}</small><strong className={r.kind === "Income" ? "in" : "out"}>{r.kind === "Income" ? "+" : "−"}{money(r.amount)}</strong></span> : <span className="filing-rec"><b>{id}</b><small>No longer in Books for this period</small></span>; };

  const summary = <dl className="filing-summary">
    <div><dt>Business</dt><dd className="filing-biz">{logo ? <img src={logo} alt="" /> : <i>{businessName.slice(0, 1).toUpperCase()}</i>}{businessName}</dd></div>
    <div><dt>Tax country</dt><dd>{countryLabel(country)}{tax?.vatNumber ? <small> · VAT {tax.vatNumber}</small> : null}</dd></div>
    <div><dt>Return type</dt><dd>{ret || flow.step !== "start" ? (retType?.label || "—") : types.length > 1 ? <select aria-label="Return type" value={typeId} onChange={(e) => { setTypeId(e.target.value as ReturnTypeId); setPeriodKey(""); }}>{types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select> : types[0]?.label || "—"}</dd></div>
    <div><dt>Filing period</dt><dd>{ret ? ret.periodLabel : flow.step !== "start" ? period?.label : periods.length ? <select aria-label="Filing period" value={period?.key || ""} onChange={(e) => setPeriodKey(e.target.value)}>{periods.map((p) => <option key={p.key} value={p.key}>{p.label}{p.ended ? "" : " (in progress)"}</option>)}</select> : "—"}</dd></div>
  </dl>;

  const body = (() => {
    if (!types.length) return <div className="filing-panel"><p><AlertTriangle size={14} aria-hidden="true" /> Filing isn’t supported for this tax country yet. Set the tax country to Ireland, the United Kingdom or the United States in Books → Settings.</p>{onOpenSettings && <button type="button" className="secondary-button" onClick={onOpenSettings}>Open Books settings</button>}</div>;
    if (flow.step === "start") {
      const resumable = saved.filter((s) => s.status !== "filed").slice(0, 4);
      return <>
        <div className="filing-ask"><p>{QUESTION}</p>
          <div className="filing-choice"><button type="button" className="primary-button" onClick={() => void checkReceipts()}><ClipboardCheck size={15} aria-hidden="true" /> Yes, check receipts</button><button type="button" className="secondary-button" onClick={skip}>No, continue to review</button></div></div>
        {resumable.length > 0 && <div className="filing-saved"><h3>Saved drafts</h3>{resumable.map((s) => <button type="button" key={s.id} onClick={() => dispatch({ type: "RESUME", ret: s })}><b>{RETURN_TYPES[s.returnTypeId]?.short} · {s.periodLabel}</b><small>Draft · saved {new Date(s.updatedAt).toLocaleDateString("en-IE", { day: "numeric", month: "short" })}{s.receiptCheck.state === "skipped" ? " · receipt check skipped" : ` · ${unresolvedIssues(s).length} to review`}</small><span>Resume →</span></button>)}</div>}
        {saved.some((s) => s.status === "filed") && <p className="filing-muted">Filed: {saved.filter((s) => s.status === "filed").slice(0, 3).map((s) => `${RETURN_TYPES[s.returnTypeId]?.short} ${s.periodLabel} (ack ${s.acknowledgement?.reference})`).join(" · ")}</p>}
      </>;
    }
    if (flow.step === "scanning") return <div className="filing-panel filing-loading" role="status"><Loader2 size={18} className="spin" aria-hidden="true" /> Checking the connected inbox and Books for {period?.label}…</div>;
    if (flow.step === "email_disconnected") return <div className="filing-panel"><p><Mail size={14} aria-hidden="true" /> The bookkeeping email isn’t connected for {businessName}, so receipts can’t be checked.</p>
      <div className="filing-choice"><a className="primary-button" href={`/api/bookkeeping-email/connect?scope=${encodeURIComponent(scopeId)}`}>Connect email</a><button type="button" className="secondary-button" onClick={() => dispatch({ type: "CONTINUE_WITHOUT_SCAN" })}>Continue without scan</button></div></div>;
    if (flow.step === "scan_results" && check) return <>
      <p className="filing-muted">Checked {check.emailCount} email{check.emailCount === 1 ? "" : "s"}{check.account ? ` in ${check.account}` : ""} against {periodRecords.length} Books record{periodRecords.length === 1 ? "" : "s"}.{check.aiNote ? ` ${check.aiNote}` : check.aiUsed ? " AI helped with receipts that shared an amount." : ""}</p>
      <h3 className="filing-h3"><CircleCheck size={14} aria-hidden="true" /> Matched receipts · {check.matches.length}</h3>
      <ul className="filing-list">{check.matches.map((m) => <li key={m.recordId}>{recordRow(m.recordId)}<span className="filing-why">{m.reason}{m.by === "ai" ? " · AI" : ""}</span>{evidence(m.recordId, m.emailId)}</li>)}{!check.matches.length && <li className="filing-muted">No receipts matched yet.</li>}</ul>
      <h3 className="filing-h3"><AlertTriangle size={14} aria-hidden="true" /> Needs review · {check.issues.length}</h3>
      <ul className="filing-list">{check.issues.map((i) => <li key={i.id}><span className={`filing-tag ${i.type}`}>{ISSUE_LABEL[i.type]}</span><span>{i.message}</span>{i.recordIds.map((id) => <span key={id}>{recordRow(id)}{evidence(id)}</span>)}{i.emailId && evidence(undefined, i.emailId)}</li>)}{!check.issues.length && <li className="filing-muted">Nothing to review.</li>}</ul>
      <div className="modal-actions"><button type="button" className="primary-button" onClick={() => dispatch({ type: "CONTINUE_TO_REVIEW" })}>Continue to review</button></div>
    </>;
    if (flow.step === "review" && ret && figures && route) return <>
      <div className="filing-badges"><span className={`filing-status ${ret.status}`}>{ret.status === "filed" ? "Filed" : "Draft"}</span>{ret.receiptCheck.state === "skipped" ? <span className="filing-tag skipped">Receipt check skipped</span> : <span className="filing-tag ok">Receipts checked · {check?.matches.length || 0} matched · {open.length} to review</span>}{savedAt && ret.status !== "filed" && <span className="filing-muted">Draft saved {savedAt}</span>}</div>
      <table className="filing-figures"><tbody>{figures.lines.map((line) => <FigureRow key={line.id} label={line.label} amount={money(line.amount)} note={line.note} emphasis={line.emphasis} open={trace === line.id} onToggle={() => setTrace(trace === line.id ? "" : line.id)} count={line.recordIds.length}>{line.recordIds.map((id) => <div key={id} className="filing-trace-row">{recordRow(id)}{evidence(id, check?.matches.find((m) => m.recordId === id)?.emailId)}</div>)}</FigureRow>)}
        <tr className="filing-estimate"><th>{figures.estimateLabel}</th><td>{retType?.kind === "state" ? "Not estimated" : money(figures.estimate)}</td></tr>
        {figures.estimateLines.map((l) => <tr key={l.label} className="filing-sub"><th>{l.label}</th><td>{money(l.amount)}</td></tr>)}</tbody></table>
      {figures.notes.map((n) => <p key={n} className="filing-muted">{n}</p>)}
      {(ret.receiptCheck.result?.issues.length || 0) > 0 && <><h3 className="filing-h3">Unresolved items · {open.length}</h3><ul className="filing-list">{ret.receiptCheck.result!.issues.map((i) => { const done = ret.resolvedIssueIds.includes(i.id); return <li key={i.id} className={done ? "done" : ""}><label className="filing-resolve"><input type="checkbox" checked={done} disabled={ret.status === "filed"} onChange={(e) => dispatch({ type: "RESOLVE", issueId: i.id, resolved: e.target.checked })} /> <span className={`filing-tag ${i.type}`}>{ISSUE_LABEL[i.type]}</span> {i.message}</label>{i.recordIds.map((id) => <span key={id}>{evidence(id)}</span>)}{i.emailId && evidence(undefined, i.emailId)}</li>; })}</ul></>}
      {ret.status === "filed" && ret.acknowledgement ? <div className="filing-panel filing-done"><CircleCheck size={16} aria-hidden="true" /> Filed. Acknowledgement <b>{ret.acknowledgement.reference}</b> received {ret.acknowledgement.receivedAt}, saved against {retType?.short} · {ret.periodLabel}.</div>
        : !route.supported ? <div className="filing-panel filing-unsupported"><p><AlertTriangle size={14} aria-hidden="true" /> {route.reason}</p><ul>{route.needs.map((n) => <li key={n}>{n}</li>)}</ul><p className="filing-muted">Your reviewed draft is saved and will be here when you come back.</p>{onOpenSettings && <button type="button" className="secondary-button" onClick={onOpenSettings}>Open Books settings</button>}</div>
        : flow.justOpened || (ret.openedFilingAt || []).length ? <div className="filing-panel"><p>{flow.justOpened ? `${route.service} opened in a new tab.` : `${route.service} was opened on ${new Date(ret.openedFilingAt!.at(-1)!).toLocaleDateString("en-IE", { day: "numeric", month: "short" })}.`} The return stays <b>Draft</b> until you record the filing acknowledgement.</p>
          <div className="form-grid filing-ack"><label className="field"><span>Acknowledgement / submission reference</span><input value={ack.reference} onChange={(e) => setAck({ ...ack, reference: e.target.value })} placeholder="e.g. ROS notice number or HMRC receipt ID" /></label><label className="field"><span>Received on</span><input type="date" value={ack.receivedAt} onChange={(e) => setAck({ ...ack, receivedAt: e.target.value })} /></label><label className="field full-field"><span>Note (optional)</span><input value={ack.note} onChange={(e) => setAck({ ...ack, note: e.target.value })} /></label></div>
          <button type="button" className="secondary-button" disabled={!ack.reference.trim() || busy === "ack"} onClick={() => void recordAck()}>{busy === "ack" ? "Saving…" : "Record acknowledgement & mark filed"}</button></div> : null}
      {ret.status !== "filed" && <div className="modal-actions"><button type="button" className="secondary-button" disabled={busy === "save"} onClick={() => void save(ret)}><Save size={14} aria-hidden="true" /> {busy === "save" ? "Saving…" : "Save draft"}</button>{route.supported && <button type="button" className="primary-button" onClick={() => dispatch({ type: "OPEN_CONFIRM" })}>{flow.justOpened || (ret.openedFilingAt || []).length ? `Open ${route.service} again` : `File with ${route.service}`}</button>}</div>}
    </>;
    return null;
  })();

  const confirm = flow.confirmOpen && ret && route?.supported ? <div className="modal-backdrop filing-confirm-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) dispatch({ type: "BACK_TO_REVIEW" }); }}><section className="modal filing-confirm" role="alertdialog" aria-modal="true" aria-labelledby="filing-confirm-title">
    <h2 id="filing-confirm-title">Are you sure you’re ready to file?</h2>
    <p>You’re about to open {route.service} for {businessName}’s {retType?.label} for {ret.periodLabel}. Review and submit your return there.</p>
    {(ret.receiptCheck.state === "skipped" || open.length > 0) && <div className="filing-warn" role="note">{ret.receiptCheck.state === "skipped" && <p><AlertTriangle size={14} aria-hidden="true" /> Receipt check skipped. Receipts weren’t matched to transactions for this period.</p>}{open.length > 0 && <><p><AlertTriangle size={14} aria-hidden="true" /> {open.length} unresolved receipt issue{open.length === 1 ? "" : "s"}:</p><ul>{open.slice(0, 5).map((i) => <li key={i.id}>{ISSUE_LABEL[i.type]}: {i.message}</li>)}{open.length > 5 && <li>…and {open.length - 5} more</li>}</ul></>}</div>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => dispatch({ type: "BACK_TO_REVIEW" })}>Back to review</button><button type="button" className="primary-button" disabled={busy === "open"} onClick={() => void continueToFiling()}>Continue to {route.service} <ExternalLink size={13} aria-hidden="true" /></button></div>
  </section></div> : null;

  const content = <div className="modal-backdrop filing-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !flow.confirmOpen) onClose(); }}>
    <section className="modal filing-modal" role="dialog" aria-modal="true" aria-labelledby="filing-title">
      <div className="modal-head"><div><p className="eyebrow">BOOKS · GET READY FOR FILING</p><h2 id="filing-title">{flow.step === "review" ? "Review the draft" : flow.step === "scan_results" ? "Receipt check" : "Get ready for filing"}</h2></div><button type="button" className="filing-close" aria-label="Close" onClick={onClose}><X size={18} /></button></div>
      {summary}
      {error && <p className="filing-error" role="alert">{error}</p>}
      {body}
      {flow.step === "review" && ret?.status !== "filed" && <button type="button" className="text-button filing-restart" onClick={() => dispatch({ type: "RESTART" })}>← Choose a different return or period</button>}
    </section>
    {confirm}
  </div>;
  return typeof document === "undefined" ? content : createPortal(content, document.body);
}

function FigureRow({ label, amount, note, emphasis, open, onToggle, count, children }: { label: string; amount: string; note?: string; emphasis?: boolean; open: boolean; onToggle: () => void; count: number; children: React.ReactNode }) {
  return <><tr className={emphasis ? "filing-total" : ""}><th><button type="button" className="filing-trace" aria-expanded={open} disabled={!count} onClick={onToggle} title={count ? "Show the records behind this figure" : "No records"}>{open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />} {label}</button>{note && <small> · {note}</small>}</th><td>{amount}<small>{count} record{count === 1 ? "" : "s"}</small></td></tr>
    {open && <tr className="filing-trace-body"><td colSpan={2}>{children}</td></tr>}</>;
}
