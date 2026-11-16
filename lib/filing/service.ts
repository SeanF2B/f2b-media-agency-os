import { env } from "cloudflare:workers";
import { gmailConnection, gmailOAuthReady, receiptsBetween } from "../bookkeeping-email.ts";
import { resolveAiProvider } from "../ai-provider.ts";
import { matchReceipts, mergeDraft, parseAmounts, recordAcknowledgement, recordOpened, settleAmbiguous, type BookRecord, type FilingReturn, type ReceiptCheckResult, type ReceiptEmail } from "./model.ts";

// Server side of "Get ready for filing": saved drafts (one row per business + return + period, read by an
// indexed key so it stays cheap on D1), the receipt scan and the filed acknowledgement.
export type FilingCtx = { ownerId: string; actor?: string };
type Db = D1Database;

async function ensure(db: Db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS filing_returns (owner_id TEXT NOT NULL, id TEXT NOT NULL, scope_id TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (owner_id, id))").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS filing_returns_scope ON filing_returns (owner_id, scope_id, updated_at)").run();
}
const db = () => { if (!env.DB) throw new Error("Storage isn't available."); return env.DB as Db; };

export async function listReturns(ctx: FilingCtx, scopeId: string): Promise<FilingReturn[]> {
  const d = db(); await ensure(d);
  const rows = await d.prepare("SELECT data FROM filing_returns WHERE owner_id = ?1 AND scope_id = ?2 ORDER BY updated_at DESC LIMIT 40").bind(ctx.ownerId, scopeId).all<{ data: string }>();
  return (rows.results || []).map((row) => JSON.parse(row.data) as FilingReturn);
}
export async function getReturn(ctx: FilingCtx, id: string): Promise<FilingReturn | null> {
  const d = db(); await ensure(d);
  const row = await d.prepare("SELECT data FROM filing_returns WHERE owner_id = ?1 AND id = ?2").bind(ctx.ownerId, id).first<{ data: string }>();
  return row ? JSON.parse(row.data) as FilingReturn : null;
}
async function put(ctx: FilingCtx, ret: FilingReturn) {
  const d = db(); await ensure(d);
  await d.prepare("INSERT INTO filing_returns (owner_id, id, scope_id, status, data, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(owner_id, id) DO UPDATE SET status = excluded.status, data = excluded.data, updated_at = excluded.updated_at")
    .bind(ctx.ownerId, ret.id, ret.scopeId, ret.status, JSON.stringify(ret), ret.updatedAt).run();
  return ret;
}

export async function saveDraft(ctx: FilingCtx, scopeId: string, incoming: FilingReturn): Promise<FilingReturn> {
  if (!incoming?.id || !incoming.returnTypeId || !incoming.periodKey) throw new Error("That draft is missing its return or period.");
  if (incoming.scopeId !== scopeId || !incoming.id.startsWith(`${scopeId}:`)) throw new Error("That draft belongs to a different business.");
  const body = JSON.stringify(incoming); if (body.length > 400_000) throw new Error("That draft is too large to save.");
  return put(ctx, mergeDraft(await getReturn(ctx, incoming.id), incoming, new Date().toISOString()));
}

export async function markOpened(ctx: FilingCtx, id: string): Promise<FilingReturn> {
  const ret = await getReturn(ctx, id); if (!ret) throw new Error("Save the draft before opening the filing service.");
  return put(ctx, recordOpened(ret, new Date().toISOString()));
}

export async function acknowledge(ctx: FilingCtx, id: string, ack: { reference: string; receivedAt?: string; note?: string }): Promise<FilingReturn> {
  const ret = await getReturn(ctx, id); if (!ret) throw new Error("That return hasn't been saved yet.");
  return put(ctx, recordAcknowledgement(ret, { ...ack, recordedBy: ctx.actor }, new Date().toISOString()));
}

const cleanRecords = (records: unknown): BookRecord[] => (Array.isArray(records) ? records : []).slice(0, 3000).map((r) => r as Record<string, unknown>).filter((r) => r && typeof r.id === "string" && (r.kind === "Income" || r.kind === "Expense") && /^\d{4}-\d{2}-\d{2}$/.test(String(r.date)) && Number.isFinite(Number(r.amount)))
  .map((r) => ({ id: String(r.id).slice(0, 120), kind: r.kind as "Income" | "Expense", date: String(r.date), description: String(r.description || "").slice(0, 200), category: String(r.category || "").slice(0, 80), amount: Math.abs(Number(r.amount)), receiptFileId: r.receiptFileId ? String(r.receiptFileId).slice(0, 120) : undefined, receiptName: r.receiptName ? String(r.receiptName).slice(0, 120) : undefined }));

// Ask the AI to pick between receipts that share an amount. Returns {} when AI isn't configured or fails — the rule-based result still stands.
async function aiPicks(ctx: FilingCtx, ambiguous: Array<{ recordId: string; emailIds: string[] }>, records: BookRecord[], emails: ReceiptEmail[]): Promise<{ picks: Record<string, string | null>; used: boolean; note?: string }> {
  if (!ambiguous.length) return { picks: {}, used: false };
  const provider = await resolveAiProvider(env as never, ctx.ownerId).catch(() => null);
  if (!provider) return { picks: {}, used: false, note: "AI isn't connected, so receipts with the same amount are left for you to choose." };
  const items = ambiguous.slice(0, 25).map((a) => { const r = records.find((x) => x.id === a.recordId)!; return { recordId: a.recordId, transaction: { date: r.date, description: r.description, category: r.category, amount: r.amount }, candidates: a.emailIds.map((id) => { const e = emails.find((x) => x.id === id)!; return { emailId: id, date: e.date, from: e.from, subject: e.subject, snippet: (e.snippet || "").slice(0, 200) }; }) }; });
  try {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(25000), body: JSON.stringify({ model: provider.model, temperature: 0, response_format: { type: "json_object" }, messages: [
      { role: "system", content: "You match bookkeeping transactions to receipt emails. For each transaction choose the one candidate email that is clearly its receipt (same supplier, date and amount), or null if none is clearly right. Never guess. Reply as JSON: {\"picks\":{\"<recordId>\":\"<emailId or null>\"}}." },
      { role: "user", content: JSON.stringify(items) },
    ] }) });
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(String(body.choices?.[0]?.message?.content || "{}").replace(/^```(?:json)?|```$/g, "").trim()) as { picks?: Record<string, string | null> };
    return { picks: parsed.picks && typeof parsed.picks === "object" ? parsed.picks : {}, used: true };
  } catch { return { picks: {}, used: false, note: "The AI check didn't respond, so receipts with the same amount are left for you to choose." }; }
}

export type ScanResponse = { connected: false; ready: boolean } | { connected: true; result: ReceiptCheckResult };

export async function scanReceipts(ctx: FilingCtx, scopeId: string, period: { start: string; end: string }, rawRecords: unknown, deps: { fetchEmails?: typeof receiptsBetween } = {}): Promise<ScanResponse> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period?.start || "") || !/^\d{4}-\d{2}-\d{2}$/.test(period?.end || "")) throw new Error("Pick a filing period first.");
  if (!gmailOAuthReady()) return { connected: false, ready: false };
  const saved = await gmailConnection(ctx.ownerId, scopeId);
  if (!saved) return { connected: false, ready: true };
  const records = cleanRecords(rawRecords).filter((r) => r.date >= period.start && r.date <= period.end);
  const emails = await (deps.fetchEmails || receiptsBetween)(saved, period.start, period.end);
  const first = matchReceipts(records, emails);
  const ai = await aiPicks(ctx, first.ambiguous, records, emails);
  const settled = settleAmbiguous(first, ai.picks, records, emails.map((e) => ({ ...e, amounts: parseAmounts(`${e.subject} ${e.snippet || ""}`) })));
  return { connected: true, result: { scannedAt: new Date().toISOString(), account: saved.account_email, emailCount: emails.length, matches: settled.matches, issues: settled.issues, emails: emails.slice(0, 120), aiUsed: ai.used, aiNote: ai.note } };
}
