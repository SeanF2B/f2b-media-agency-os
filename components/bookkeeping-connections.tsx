"use client";

import { useState } from "react";

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

export function BookkeepingConnections({ scopeName, existingIds, onImport }: { scopeName: string; existingIds: string[]; onImport?: (entries: ImportedBookEntry[]) => Promise<void> | void }) {
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
        {onImport ? <label className="bs-ghost bookkeeping-upload">⬆ Upload bank statement (.csv)<input type="file" accept=".csv,text/csv" hidden onChange={(event) => { void readFile(event.target.files?.[0]); event.target.value = ""; }} /></label> : <p className="bookkeeping-muted">Open a client sub-account to import into its books.</p>}
        <p className="bookkeeping-muted">Live bank feed (automatic daily sync through open banking): not connected yet.</p>
      </div>
      <div className="bookkeeping-card">
        <h3>📧 Bookkeeping email</h3>
        <p>Connect an inbox so receipts and supplier invoices are picked up and logged as expenses automatically.</p>
        <p className="bookkeeping-muted">Email connection: not connected yet.</p>
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
