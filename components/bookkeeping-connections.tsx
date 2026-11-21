"use client";

import { useEffect, useState } from "react";

export type ImportedBookEntry = { id: string; kind: "Income" | "Expense"; date: string; description: string; category: string; amount: number };

const AD_PATTERN = /google\s*ads|googleads|facebk|facebook|meta\s*ads|meta platforms|instagram|tiktok\s*ads|linkedin\s*ads|microsoft\s*ads|bing\s*ads/i;

function splitCsvLine(line: string, delimiter: string) {
  const cells: string[] = []; let current = ""; let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') { if (quoted && line[i + 1] === '"') { current += '"'; i += 1; } else quoted = !quoted; }
    else if (char === delimiter && !quoted) { cells.push(current.trim()); current = ""; }
    else current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseDate(value: string) {
  const text = value.trim();
  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  match = text.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
  if (match) { const year = match[3].length === 2 ? `20${match[3]}` : match[3]; return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`; }
  match = text.match(/^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\s+(\d{4})/);
  if (match) { const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(match[2].toLowerCase()) + 1; if (month) return `${match[3]}-${String(month).padStart(2, "0")}-${match[1].padStart(2, "0")}`; }
  return "";
}

const parseAmount = (value: string) => { const cleaned = String(value || "").replace(/[€£$\s]/g, "").replace(/,(?=\d{3}(\D|$))/g, "").replace(",", "."); const number = Number(cleaned.replace(/[()]/g, "")); return Number.isFinite(number) ? (/^\(.*\)$/.test(cleaned) ? -number : number) : NaN; };

// Reads a bank statement CSV (most Irish/UK banks: AIB, BOI, Revolut, PTSB, Monzo, Starling…) into income and expense lines.
export function parseBankStatementCsv(text: string): { entries: ImportedBookEntry[]; skipped: number; error?: string } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return { entries: [], skipped: 0, error: "That file has no rows." };
  const delimiter = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ";" : ",";
  const headers = splitCsvLine(lines[0], delimiter).map((header) => header.toLowerCase());
  const find = (...names: RegExp[]) => headers.findIndex((header) => names.some((name) => name.test(header)));
  const dateCol = find(/date/, /completed/, /started/);
  const descCol = find(/description/, /details/, /narrative/, /payee/, /merchant/, /name/, /reference/);
  const amountCol = headers.findIndex((header) => /amount|value/.test(header) && !/debit|credit|paid|money|withdraw|deposit|balance|fee/.test(header));
  const debitCol = find(/debit/, /paid out/, /money out/, /withdraw/);
  const creditCol = find(/credit/, /paid in/, /money in/, /deposit/);
  if (dateCol < 0 || descCol < 0 || (amountCol < 0 && debitCol < 0 && creditCol < 0)) return { entries: [], skipped: 0, error: "Couldn’t find date, description and amount columns. Export the statement as CSV from your bank and try again." };
  const entries: ImportedBookEntry[] = []; let skipped = 0;
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line, delimiter);
    const date = parseDate(cells[dateCol] || ""); const description = (cells[descCol] || "").replace(/\s+/g, " ").trim();
    let amount = NaN;
    if (amountCol >= 0 && cells[amountCol]) amount = parseAmount(cells[amountCol]);
    else { const debit = debitCol >= 0 ? parseAmount(cells[debitCol] || "") : NaN; const credit = creditCol >= 0 ? parseAmount(cells[creditCol] || "") : NaN; amount = Number.isFinite(credit) && credit !== 0 ? Math.abs(credit) : Number.isFinite(debit) && debit !== 0 ? -Math.abs(debit) : NaN; }
    if (!date || !description || !Number.isFinite(amount) || amount === 0) { skipped += 1; continue; }
    const kind = amount > 0 ? "Income" : "Expense";
    const value = Math.round(Math.abs(amount) * 100) / 100;
    const key = `${date}|${description.toLowerCase()}|${value}|${kind}`;
    let hash = 0; for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
    entries.push({ id: `bank-${date}-${(hash >>> 0).toString(36)}`, kind, date, description: description.slice(0, 160), category: kind === "Income" ? "Income" : AD_PATTERN.test(description) ? "Advertising & marketing" : "Other", amount: value });
  }
  return { entries, skipped };
}

export function BookkeepingConnections({ scopeName, existingIds, onImport, savedEmail = "", onSaveEmail, scopeId = "agency" }: { scopeName: string; scopeId?: string; existingIds: string[]; onImport?: (entries: ImportedBookEntry[]) => Promise<void> | void; savedEmail?: string; onSaveEmail?: (email: string) => Promise<void> | void }) {
  const [gmail, setGmail] = useState<{ ready: boolean; connected: boolean; email?: string; error?: string; expired?: boolean; receipts?: Array<{ id: string; from: string; subject: string; date: string; attachments: string[] }> } | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState("");
  useEffect(() => {
    let live = true;
    fetch(`/api/bookkeeping-email?scope=${encodeURIComponent(scopeId)}&receipts=1`, { cache: "no-store" }).then((r) => r.json()).then((j) => { if (live) setGmail(j.error && !j.connected ? { ready: true, connected: false } : j); }).catch(() => { if (live) setGmail({ ready: true, connected: false }); });
    try { const q = new URLSearchParams(window.location.search).get("gmailConnection"); if (q) setEmailMsg(q === "connected" ? "✓ Gmail connected." : q === "cancelled" ? "Gmail connection was cancelled." : q === "refresh-token-missing" ? "Google didn't grant offline access. Try connecting again." : q === "scope-missing" ? "Google didn't give permission to read the inbox. Connect again and tick the box that lets F2B read your email on Google's screen." : q === "admin-required" ? "Only an owner or admin can connect the bookkeeping inbox." : q === "sign-in-required" ? "Sign in to the OS first, then connect Gmail." : "Gmail couldn't be connected. Try again, and pick the same Google account you get receipts on."); } catch { /* no window */ }
    return () => { live = false; };
  }, [scopeId]);
  const disconnectGmail = async () => {
    setEmailBusy(true);
    try { await fetch("/api/bookkeeping-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "disconnect", scope: scopeId }) }); setGmail((g) => g ? { ...g, connected: false, receipts: [] } : g); setEmailMsg("Inbox disconnected."); void onSaveEmail?.(""); }
    finally { setEmailBusy(false); }
  };
  const [preview, setPreview] = useState<{ entries: ImportedBookEntry[]; skipped: number; duplicates: number; fileName: string } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const money = (n: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" }).format(n);
  const readFile = async (file?: File) => {
    if (!file) return; setMessage("");
    const result = parseBankStatementCsv(await file.text());
    if (result.error) { setPreview(null); setMessage(result.error); return; }
    const known = new Set(existingIds);
    const fresh = result.entries.filter((entry) => !known.has(entry.id));
    setPreview({ entries: fresh, skipped: result.skipped, duplicates: result.entries.length - fresh.length, fileName: file.name });
  };
  const confirm = async () => {
    if (!preview || !onImport) return; setBusy(true);
    try { await onImport(preview.entries); setMessage(`✓ Imported ${preview.entries.length} transactions into ${scopeName}’s books.`); setPreview(null); }
    catch (cause) { setMessage(cause instanceof Error ? cause.message : "Couldn’t import. Please try again."); }
    finally { setBusy(false); }
  };
  const income = preview?.entries.filter((e) => e.kind === "Income").reduce((s, e) => s + e.amount, 0) || 0;
  const expenses = preview?.entries.filter((e) => e.kind === "Expense").reduce((s, e) => s + e.amount, 0) || 0;
  return <section className="bs bookkeeping" aria-labelledby="bookkeeping-heading">
    <header className="bs-head"><div><p className="eyebrow">MONEY &amp; TAX</p><h2 id="bookkeeping-heading">Bookkeeping connections</h2><p>Bring {scopeName}’s bank transactions and receipts into Expenses &amp; Tax so the books and tax estimate stay up to date.</p></div></header>
    <div className="bookkeeping-grid">
      <div className="bookkeeping-card">
        <h3>🏦 Business bank account</h3>
        <p>Import a statement CSV from the bank (AIB, Bank of Ireland, PTSB, Revolut Business, Monzo, Starling and most others). Money in becomes income, money out becomes expenses, ad platform charges are tagged as ad spend, and rows already imported are skipped.</p>
        {onImport ? <label className="bs-save bookkeeping-upload bookkeeping-connect" role="button" tabIndex={0}>⬆ Upload bank statement (.csv)<input type="file" accept=".csv,text/csv" hidden onChange={(event) => { void readFile(event.target.files?.[0]); event.target.value = ""; }} /></label> : <p className="bookkeeping-muted">Open a client sub-account to import into its books.</p>}
        <p className="bookkeeping-muted">Live bank feed (automatic daily sync through open banking): not connected yet.</p>
      </div>
      <div className="bookkeeping-card">
        <h3>📧 Bookkeeping email</h3>
        <p>Connect the Gmail inbox where receipts and supplier invoices arrive. Recent receipts show here so they can be logged in the books.</p>
        {gmail === null ? <p className="bookkeeping-muted">Checking connection…</p> : !gmail.ready ? <p className="bookkeeping-muted">Google sign-in isn't configured for this app yet.</p> : gmail.connected ? <div className="bookkeeping-email-row">
          <p className="bookkeeping-connected"><span className="bookkeeping-dot" aria-hidden="true" /> Connected to <b>{gmail.email || "Gmail"}</b></p>
          {gmail.error && <p className="bookkeeping-message" role="alert">{gmail.error}{gmail.expired && <> <a className="bs-save bookkeeping-reconnect" href={`/api/bookkeeping-email/connect?scope=${encodeURIComponent(scopeId)}`}>Reconnect</a></>}</p>}
          {gmail.receipts && gmail.receipts.length > 0 ? <ul className="bookkeeping-receipts">{gmail.receipts.slice(0, 8).map((r) => <li key={r.id}><span>{r.date}</span><b title={r.subject}>{r.subject || "(no subject)"}</b><small>{r.from}{r.attachments.length ? ` · 📎 ${r.attachments[0]}${r.attachments.length > 1 ? ` +${r.attachments.length - 1}` : ""}` : ""}</small></li>)}</ul> : !gmail.error && <p className="bookkeeping-muted">No receipts or invoices with attachments in the last 90 days.</p>}
          <div className="bs-actions"><a className="bs-ghost" href={`/api/bookkeeping-email/connect?scope=${encodeURIComponent(scopeId)}`}>Switch inbox</a><button type="button" className="bs-ghost" disabled={emailBusy} onClick={() => void disconnectGmail()}>Disconnect</button></div>
        </div> : <a className="bs-save bookkeeping-connect bookkeeping-google" href={`/api/bookkeeping-email/connect?scope=${encodeURIComponent(scopeId)}`}><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.2 14.6 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12S6.6 21.8 12 21.8c6.9 0 9.2-4.9 9.2-7.4 0-.5 0-.9-.1-1.3H12z"/></svg> Connect Gmail</a>}
        {emailMsg && <p className="bookkeeping-message" role="status">{emailMsg}</p>}
      </div>
    </div>
    {preview && <div className="bookkeeping-preview" role="region" aria-label="Import preview">
      <p><b>{preview.fileName}</b>: {preview.entries.length} new transactions · {money(income)} in · {money(expenses)} out{preview.duplicates ? ` · ${preview.duplicates} already imported` : ""}{preview.skipped ? ` · ${preview.skipped} rows skipped` : ""}</p>
      <div className="bookkeeping-rows">{preview.entries.slice(0, 8).map((entry) => <div key={entry.id}><span>{entry.date}</span><b>{entry.description}</b><small>{entry.category === "Advertising & marketing" ? "Ad spend" : entry.kind}</small><strong>{entry.kind === "Income" ? "+" : "−"}{money(entry.amount)}</strong></div>)}{preview.entries.length > 8 && <small>…and {preview.entries.length - 8} more</small>}</div>
      <div className="bs-actions"><button type="button" className="bs-ghost" onClick={() => setPreview(null)}>Cancel</button><button type="button" className="bs-save" disabled={busy || !preview.entries.length} onClick={() => void confirm()}>{busy ? "Importing…" : `Import ${preview.entries.length} transactions`}</button></div>
    </div>}
    {message && <p className="bookkeeping-message" role="status">{message}</p>}
  </section>;
}
