// End-to-end: the real "Get ready for filing" server code against SQLite with every app migration applied.
// Only Gmail and OpenRouter are simulated.
//
// Run: node --experimental-transform-types --import ./tests/e2e/register.mjs --test tests/e2e/filing.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createD1 } from "./d1-shim.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DB = createD1(root);
const env = globalThis.__OUTREACH_TEST_ENV__ = { DB, AGENCY_CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"), OPENROUTER_API_KEY: "sk-or-test", GOOGLE_ADS_CLIENT_ID: "cid", GOOGLE_ADS_CLIENT_SECRET: "secret", GOOGLE_ADS_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64") };
const now0 = new Date().toISOString();
DB.sqlite.prepare("INSERT INTO workspace_documents (id, owner_id, data, updated_at) VALUES ('f2b-agency', 'owner-1', '{}', ?)").run(now0);

const aiCalls = [];
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://openrouter.ai/")) { const body = JSON.parse(init.body); aiCalls.push(body); const items = JSON.parse(body.messages[1].content); const picks = Object.fromEntries(items.map((i) => [i.recordId, i.candidates.find((c) => /Office Hub/.test(c.from))?.emailId || null])); return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ picks }) } }] }), { status: 200 }); }
  throw new Error(`Unexpected network call: ${url}`);
};

const svc = await import("../../lib/filing/service.ts");
const model = await import("../../lib/filing/model.ts");
const ctx = { ownerId: "owner-1", actor: "sean@agency.test" };
const scope = "client-pro-roofers";
const tax = { country: "IE", vatRegistered: true, vatNumber: "IE1234567T" };
const type = model.RETURN_TYPES["ie-vat3"];
const period = model.periodsFor(type, "2026-11-16")[0]; // Sep–Oct 2026
const records = [
  { id: "inc-1", kind: "Income", date: "2026-09-04", description: "Roof repair", category: "Income", amount: 2460 },
  { id: "exp-1", kind: "Expense", date: "2026-09-10", description: "Screwfix order", category: "Materials", amount: 123 },
  { id: "exp-2", kind: "Expense", date: "2026-09-20", description: "Stationery", category: "Office", amount: 50 },
  { id: "exp-3", kind: "Expense", date: "2026-10-02", description: "Van insurance", category: "Insurance", amount: 410 },
  { id: "old", kind: "Expense", date: "2026-07-01", description: "Outside the period", category: "Office", amount: 5 },
];
const emails = [
  { id: "g1", from: "Screwfix", subject: "Your receipt", snippet: "Total €123.00", date: "2026-09-10", attachments: ["r.pdf"] },
  { id: "g2", from: "Office Hub", subject: "Receipt", snippet: "€50.00", date: "2026-09-20", attachments: [] },
  { id: "g3", from: "Paper Co", subject: "Receipt", snippet: "€50.00", date: "2026-09-21", attachments: [] },
];
const newDraft = () => ({ id: model.filingId(scope, type.id, period.key), scopeId: scope, returnTypeId: type.id, periodKey: period.key, periodLabel: period.label, periodStart: period.start, periodEnd: period.end, businessName: "Pro Roofers Galway", country: "IE", status: "draft", receiptCheck: { state: "skipped" }, resolvedIssueIds: [], createdAt: "", updatedAt: "" });

test("migrations apply", () => assert.deepEqual(DB.failures, []));

test("disconnected email: the scan reports it instead of failing, so the user can connect or continue without scan", async () => {
  const res = await svc.scanReceipts(ctx, scope, period, records, { fetchEmails: async () => { throw new Error("should not be called"); } });
  assert.deepEqual(res, { connected: false, ready: true });
});

test("Yes, check receipts: matches the connected inbox to Books for the period, uses AI for same-amount receipts, flags the rest", async () => {
  DB.sqlite.exec("CREATE TABLE IF NOT EXISTS bookkeeping_gmail (owner_id TEXT NOT NULL, scope_id TEXT NOT NULL, encrypted_refresh_token TEXT NOT NULL, token_iv TEXT NOT NULL, account_email TEXT NOT NULL DEFAULT '', connected_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (owner_id, scope_id))");
  DB.sqlite.prepare("INSERT INTO bookkeeping_gmail VALUES ('owner-1', ?, 'x', 'y', 'books@proroofers.ie', ?, ?)").run(scope, now0, now0);
  let asked;
  const res = await svc.scanReceipts(ctx, scope, { start: period.start, end: period.end }, records, { fetchEmails: async (_saved, start, end) => { asked = [start, end]; return emails; } });
  assert.deepEqual(asked, [period.start, period.end]);
  assert.equal(res.connected, true);
  const r = res.result;
  assert.equal(r.account, "books@proroofers.ie");
  assert.deepEqual(r.matches.map((m) => `${m.recordId}→${m.emailId}:${m.by}`).sort(), ["exp-1→g1:rules", "exp-2→g2:ai"]);
  assert.equal(aiCalls.length, 1, "AI only asked about the ambiguous one");
  assert.ok(r.issues.some((i) => i.type === "missing" && i.recordIds[0] === "exp-3"));
  assert.ok(r.issues.some((i) => i.type === "unmatched_receipt" && i.emailId === "g3"));
  assert.ok(!JSON.stringify(r).includes("Outside the period"));
  globalThis.__lastCheck = r;
});

test("draft persistence: save, list and resume; another business can't overwrite it", async () => {
  const draft = { ...newDraft(), receiptCheck: { state: "checked", result: globalThis.__lastCheck }, resolvedIssueIds: [] };
  const saved = await svc.saveDraft(ctx, scope, draft);
  assert.equal(saved.status, "draft"); assert.ok(saved.createdAt);
  await svc.saveDraft(ctx, scope, { ...saved, resolvedIssueIds: ["missing:exp-3"] });
  const listed = await svc.listReturns(ctx, scope);
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0].resolvedIssueIds, ["missing:exp-3"]);
  assert.equal(listed[0].createdAt, saved.createdAt);
  assert.equal(model.unresolvedIssues(listed[0]).length, globalThis.__lastCheck.issues.length - 1);
  await assert.rejects(svc.saveDraft(ctx, "another-client", draft), /different business/);
  assert.equal((await svc.listReturns(ctx, "another-client")).length, 0);
});

test("opening the filing service leaves the return status unchanged; the acknowledgement marks it filed and is saved against the period", async () => {
  const id = model.filingId(scope, type.id, period.key);
  const opened = await svc.markOpened(ctx, id);
  assert.equal(opened.status, "draft"); assert.equal(opened.openedFilingAt.length, 1);
  assert.equal((await svc.getReturn(ctx, id)).status, "draft");
  await assert.rejects(svc.acknowledge(ctx, id, { reference: "" }), /acknowledgement/);
  const filed = await svc.acknowledge(ctx, id, { reference: "ROS-998877", receivedAt: "2026-11-16" });
  assert.equal(filed.status, "filed");
  const stored = await svc.getReturn(ctx, id);
  assert.deepEqual([stored.status, stored.acknowledgement.reference, stored.acknowledgement.receivedAt, stored.periodKey, stored.returnTypeId, stored.acknowledgement.recordedBy], ["filed", "ROS-998877", "2026-11-16", period.key, "ie-vat3", "sean@agency.test"]);
  const resaved = await svc.saveDraft(ctx, scope, { ...stored, status: "draft", acknowledgement: undefined });
  assert.equal(resaved.status, "filed", "a later save can't un-file it"); assert.equal(resaved.acknowledgement.reference, "ROS-998877");
});

test("draft figures for the reviewed period come from the period's Books records", () => {
  const figures = model.draftFigures(type, model.inPeriod(records, period), tax);
  assert.equal(figures.lines.find((l) => l.id === "output").amount, 460);
  assert.ok(!figures.lines.some((l) => l.recordIds.includes("old")));
});
