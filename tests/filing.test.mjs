import assert from "node:assert/strict";
import test from "node:test";
import { draftFigures, filingId, filingRoute, matchReceipts, parseAmounts, periodsFor, recordAcknowledgement, recordOpened, mergeDraft, returnTypesFor, settleAmbiguous, unresolvedIssues, RETURN_TYPES, ROS_URL, HMRC_SA_URL, IRS_FREE_FILE_URL } from "../lib/filing/model.ts";
import { flowReducer, initialFlow } from "../lib/filing/flow.ts";

const draft = (over = {}) => ({ id: filingId("client-1", "ie-vat3", "2026-09"), scopeId: "client-1", returnTypeId: "ie-vat3", periodKey: "2026-09", periodLabel: "Sep–Oct 2026", periodStart: "2026-09-01", periodEnd: "2026-10-31", businessName: "Pro Roofers Galway", country: "IE", status: "draft", receiptCheck: { state: "skipped" }, resolvedIssueIds: [], createdAt: "", updatedAt: "", ...over });
const records = [
  { id: "r1", kind: "Income", date: "2026-09-04", description: "Roof repair – Salthill", category: "Income", amount: 2460 },
  { id: "r2", kind: "Expense", date: "2026-09-10", description: "Screwfix order", category: "Materials", amount: 123 },
  { id: "r3", kind: "Expense", date: "2026-09-10", description: "Screwfix order", category: "Materials", amount: 123 },
  { id: "r4", kind: "Expense", date: "2026-09-15", description: "Google Ads", category: "Advertising & marketing", amount: 300, receiptFileId: "file-9", receiptName: "google-invoice.pdf" },
  { id: "r5", kind: "Expense", date: "2026-10-02", description: "Van insurance", category: "Insurance", amount: 410 },
  { id: "r6", kind: "Expense", date: "2026-10-05", description: "Fuel", category: "Motor", amount: 60 },
  { id: "r7", kind: "Expense", date: "2026-10-06", description: "Fuel top up", category: "Motor", amount: 45 },
];

test("return types follow the tax country, company type and registrations", () => {
  assert.deepEqual(returnTypesFor({ country: "IE", vatRegistered: true }, "sole_trader").map((t) => t.id), ["ie-form11", "ie-vat3"]);
  assert.deepEqual(returnTypesFor({ country: "GB" }, "company").map((t) => t.id), ["gb-ct600"]);
  assert.deepEqual(returnTypesFor({ country: "US", usState: "NY" }, "").map((t) => t.id), ["us-1040", "us-1120", "us-state"]);
  assert.deepEqual(returnTypesFor({ country: "OTHER" }, "sole_trader"), []);
});

test("filing periods: Irish VAT is bi-monthly, UK VAT quarterly, UK Self Assessment runs 6 April to 5 April", () => {
  const ie = periodsFor(RETURN_TYPES["ie-vat3"], "2026-11-16");
  assert.equal(ie[0].label, "Sep–Oct 2026"); assert.equal(ie[0].end, "2026-10-31"); assert.equal(ie[0].ended, true);
  assert.equal(ie[1].label, "Nov–Dec 2026"); assert.equal(ie[1].ended, false);
  assert.equal(periodsFor(RETURN_TYPES["gb-vat"], "2026-11-16")[0].label, "Jul–Sep 2026");
  const sa = periodsFor(RETURN_TYPES["gb-sa100"], "2026-11-16")[0];
  assert.deepEqual([sa.label, sa.start, sa.end], ["Tax year 2025/26", "2025-04-06", "2026-04-05"]);
  assert.equal(periodsFor(RETURN_TYPES["ie-form11"], "2026-11-16")[0].key, "2025");
});

test("draft figures use the relevant tax maths and every figure traces back to its records", () => {
  const vat = draftFigures(RETURN_TYPES["ie-vat3"], records, { country: "IE", vatRegistered: true });
  const output = vat.lines.find((l) => l.id === "output"), input = vat.lines.find((l) => l.id === "input");
  assert.equal(output.amount, 460); // 2460 incl. 23% VAT → 460 VAT
  assert.deepEqual(input.recordIds, ["r2", "r3", "r4", "r6", "r7"], "insurance carries no VAT, so it's left out");
  assert.equal(vat.estimate, Math.round((460 - (123 + 123 + 300 + 60 + 45) * 0.23 / 1.23) * 100) / 100);
  const form11 = draftFigures(RETURN_TYPES["ie-form11"], records, { country: "IE" }, { household: "single" });
  assert.equal(form11.lines.find((l) => l.id === "profit").amount, 2460 - 1061);
  assert.ok(form11.estimateLines.some((l) => /USC/.test(l.label)));
  const us = draftFigures(RETURN_TYPES["us-1120"], records, { country: "US" });
  assert.equal(us.estimate, Math.round((2460 - 1061) * 0.21 * 100) / 100);
});

test("amounts are read from email subjects and snippets", () => {
  assert.deepEqual(parseAmounts("Your Screwfix receipt — Total €123.00"), [123]);
  assert.deepEqual(parseAmounts("Invoice £1,200.50 due"), [1200.5]);
  assert.deepEqual(parseAmounts("Amount 45,00 EUR paid"), [45]);
  assert.deepEqual(parseAmounts("Thanks for your order"), []);
});

test("receipt matching: attached receipts, email matches, duplicates, missing and unclear items", () => {
  const emails = [
    { id: "e1", from: "Screwfix", subject: "Your Screwfix receipt", snippet: "Total €123.00", date: "2026-09-10", attachments: ["r.pdf"] },
    { id: "e2", from: "Circle K", subject: "Receipt", snippet: "€60.00 fuel", date: "2026-10-05", attachments: [] },
    { id: "e3", from: "Unknown Ltd", subject: "Invoice 553", snippet: "Total €999.00", date: "2026-10-01", attachments: ["i.pdf"] },
    { id: "e4", from: "Newsletter", subject: "Your monthly bill is ready", snippet: "Log in to view", date: "2026-10-01", attachments: [] },
  ];
  const result = matchReceipts(records, emails);
  const byRecord = Object.fromEntries(result.matches.map((m) => [m.recordId, m]));
  assert.equal(byRecord.r4.via, "attached");
  assert.equal(byRecord.r2.emailId, "e1");
  assert.equal(byRecord.r6.emailId, "e2");
  const types = result.issues.map((i) => `${i.type}:${i.recordIds.join(",") || i.emailId}`).sort();
  assert.deepEqual(types, ["duplicate:r2,r3", "missing:r3", "missing:r5", "missing:r7", "unclear:e4", "unmatched_receipt:e3"].sort());
});

test("receipts with the same amount go to the AI; unsettled ones become unclear items", () => {
  const recs = [{ id: "a", kind: "Expense", date: "2026-09-02", description: "Office supplies", category: "Office", amount: 50 }];
  const emails = [{ id: "m1", from: "Shop A", subject: "Receipt €50.00", date: "2026-09-02", attachments: [] }, { id: "m2", from: "Shop B", subject: "Receipt €50.00", date: "2026-09-03", attachments: [] }];
  const first = matchReceipts(recs, emails);
  assert.deepEqual(first.ambiguous, [{ recordId: "a", emailIds: ["m1", "m2"] }]);
  assert.equal(settleAmbiguous(first, { a: "m2" }, recs).matches[0].by, "ai");
  assert.equal(settleAmbiguous(first, { a: "not-a-candidate" }, recs).issues.find((i) => i.recordIds[0] === "a").type, "unclear");
  assert.equal(settleAmbiguous(first, {}, recs).issues.find((i) => i.recordIds[0] === "a").type, "unclear");
});

test("country routing: Ireland → ROS, UK → HMRC or MTD software, US → provider or state route, unsupported explains what's needed", () => {
  for (const id of ["ie-form11", "ie-ct1", "ie-vat3"]) assert.deepEqual([filingRoute(RETURN_TYPES[id], { country: "IE" }).supported, filingRoute(RETURN_TYPES[id], { country: "IE" }).url], [true, ROS_URL]);
  assert.equal(filingRoute(RETURN_TYPES["gb-sa100"], { country: "GB" }).url, HMRC_SA_URL);
  const noMtd = filingRoute(RETURN_TYPES["gb-vat"], { country: "GB", vatRegistered: true });
  assert.equal(noMtd.supported, false); assert.match(noMtd.needs[0], /MTD-compatible software/);
  const mtd = filingRoute(RETURN_TYPES["gb-vat"], { country: "GB", vatRegistered: true, filingSoftware: { name: "FreeAgent", url: "https://app.freeagent.com/" } });
  assert.deepEqual([mtd.supported, mtd.service, mtd.url], [true, "FreeAgent", "https://app.freeagent.com/"]);
  assert.match(filingRoute(RETURN_TYPES["gb-ct600"], { country: "GB" }).reason, /closed on 31 March 2026/);
  assert.equal(filingRoute(RETURN_TYPES["us-1040"], { country: "US" }).url, IRS_FREE_FILE_URL);
  assert.equal(filingRoute(RETURN_TYPES["us-1120"], { country: "US" }).supported, false);
  assert.equal(filingRoute(RETURN_TYPES["us-state"], { country: "US", usState: "NY" }).supported, false);
  assert.equal(filingRoute(RETURN_TYPES["us-state"], { country: "US", usState: "NY", usStateFilingUrl: "https://www.tax.ny.gov/" }).url, "https://www.tax.ny.gov/");
  assert.equal(filingRoute(RETURN_TYPES["ie-vat3"], { country: "GB" }).supported, false, "a return for another country is never routed");
  assert.equal(filingRoute(RETURN_TYPES["gb-vat"], { country: "GB", filingSoftware: { name: "Bad", url: "javascript:alert(1)" } }).supported, false);
});

test("flow — Yes, check receipts: scan → results → review with matches; Back to review returns to the same draft", () => {
  let s = flowReducer(initialFlow, { type: "CHECK_RECEIPTS", draft: draft() });
  assert.equal(s.step, "scanning");
  const result = { scannedAt: "2026-11-16T09:00:00Z", account: "books@proroofers.ie", emailCount: 2, matches: [{ recordId: "r2", via: "email", emailId: "e1", by: "rules", reason: "x" }], issues: [{ id: "missing:r5", type: "missing", recordIds: ["r5"], message: "No receipt" }], emails: [], aiUsed: false };
  s = flowReducer(s, { type: "SCAN_DONE", result });
  assert.equal(s.step, "scan_results"); assert.equal(s.ret.receiptCheck.state, "checked");
  s = flowReducer(s, { type: "CONTINUE_TO_REVIEW" });
  assert.equal(s.step, "review");
  const before = s.ret;
  s = flowReducer(s, { type: "OPEN_CONFIRM" }); assert.equal(s.confirmOpen, true);
  s = flowReducer(s, { type: "BACK_TO_REVIEW" });
  assert.equal(s.step, "review"); assert.equal(s.confirmOpen, false); assert.equal(s.ret, before, "the draft is untouched");
  assert.equal(unresolvedIssues(s.ret).length, 1);
  s = flowReducer(s, { type: "RESOLVE", issueId: "missing:r5", resolved: true });
  assert.equal(unresolvedIssues(s.ret).length, 0);
});

test("flow — No, continue to review: opens review with the receipt check skipped", () => {
  const s = flowReducer(initialFlow, { type: "SKIP_CHECK", draft: draft() });
  assert.equal(s.step, "review"); assert.equal(s.ret.receiptCheck.state, "skipped");
});

test("flow — email disconnected offers Connect email or Continue without scan", () => {
  let s = flowReducer(flowReducer(initialFlow, { type: "CHECK_RECEIPTS", draft: draft() }), { type: "SCAN_DISCONNECTED" });
  assert.equal(s.step, "email_disconnected");
  s = flowReducer(s, { type: "CONTINUE_WITHOUT_SCAN" });
  assert.equal(s.step, "review"); assert.equal(s.ret.receiptCheck.state, "skipped"); assert.match(s.ret.receiptCheck.skippedReason, /isn't connected/);
});

test("flow — continuing to the filing service leaves the status unchanged; only an acknowledgement files it", () => {
  let s = flowReducer(initialFlow, { type: "SKIP_CHECK", draft: draft() });
  s = flowReducer(s, { type: "OPEN_CONFIRM" });
  const opened = recordOpened(s.ret, "2026-11-16T10:00:00Z");
  s = flowReducer(s, { type: "FILING_OPENED", ret: { ...opened, status: "filed" } }); // even a bad server reply can't flip it
  assert.equal(s.ret.status, "draft"); assert.equal(s.confirmOpen, false); assert.equal(s.step, "review"); assert.equal(s.ret.openedFilingAt.length, 1);
  assert.throws(() => recordAcknowledgement(s.ret, { reference: "  " }, "2026-11-16T10:05:00Z"), /acknowledgement/);
  const filed = recordAcknowledgement(s.ret, { reference: "ROS-12345", receivedAt: "2026-11-16" }, "2026-11-16T10:05:00Z");
  s = flowReducer(s, { type: "ACKNOWLEDGED", ret: filed });
  assert.equal(s.ret.status, "filed"); assert.equal(s.ret.acknowledgement.reference, "ROS-12345");
  assert.equal(flowReducer(s, { type: "OPEN_CONFIRM" }).confirmOpen, false, "a filed return can't be filed again");
});

test("saving a draft never marks it filed or drops an acknowledgement", () => {
  const filed = recordAcknowledgement(draft({ createdAt: "2026-11-01T00:00:00Z" }), { reference: "ACK-1" }, "2026-11-02T00:00:00Z");
  const merged = mergeDraft(filed, draft({ status: "draft", resolvedIssueIds: ["x"] }), "2026-11-03T00:00:00Z");
  assert.equal(merged.status, "filed"); assert.equal(merged.acknowledgement.reference, "ACK-1"); assert.equal(merged.createdAt, "2026-11-01T00:00:00Z");
  assert.equal(mergeDraft(null, draft({ status: "filed" }), "2026-11-03T00:00:00Z").status, "draft");
});
