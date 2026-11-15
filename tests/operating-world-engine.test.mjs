import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  achievementsFromSnapshot, briefing, canBuy, financialSummary, guessIndustry, levelFromXp, operationalHealth,
  parseCommand, rewardWalkthrough, taxRaids, raidAmount, UPGRADES, nextUpgrade, upgradeTier, stageForLevel, workingHoursBetween, xpForLevel, DAILY_REWARD_CAP, allClearLine,
} from "../lib/operating-world/engine.ts";
import { OPERATING_WORLD_SCHEMA } from "../lib/operating-world/schema-sql.ts";

const NOW = "2026-11-18T10:00:00Z"; // a Wednesday
const START = "2026-11-10T00:00:00Z";
const allSources = { crm: true, conversations: true, invoicing: true, scheduling: true, tasks: true, books: true };
const lead = (id, over = {}) => ({ id, title: `Job ${id}`, name: `Customer ${id}`, value: 0, currency: "EUR", stage: "New lead", stagePosition: 0, firstPosition: 0, category: "open", createdAt: "2026-11-17T09:00:00Z", updatedAt: "2026-11-17T09:00:00Z", ...over });
const snap = (over = {}) => ({ now: NOW, leads: [], threads: [], replies: [], invoices: [], bookings: [], tasks: [], expenses: [], hasCalendars: false, sources: allSources, ...over });

test("levels: xp thresholds and stages", () => {
  assert.equal(xpForLevel(1), 0); assert.equal(xpForLevel(2), 100); assert.equal(xpForLevel(5), 1000);
  assert.equal(levelFromXp(0).level, 1); assert.equal(levelFromXp(99).level, 1); assert.equal(levelFromXp(100).level, 2); assert.equal(levelFromXp(4500).level, 10);
  assert.equal(stageForLevel(1).name, "Startup"); assert.equal(stageForLevel(5).name, "Established business"); assert.equal(stageForLevel(12).name, "Expanding business");
  assert.equal(stageForLevel(5).next?.level, 10);
});

test("working hours skip weekends", () => {
  // Fri 12:00 → Mon 12:00 = 12h Fri + 12h Mon = 24h
  assert.equal(workingHoursBetween("2026-11-13T12:00:00Z", "2026-11-16T12:00:00Z"), 24);
  assert.equal(workingHoursBetween("2026-11-14T00:00:00Z", "2026-11-16T00:00:00Z"), 0);
});

test("rewards only for real completed work after start, each record once", () => {
  const s = snap({
    leads: [
      lead("a", { stagePosition: 1, stage: "Contacted", updatedAt: "2026-11-17T12:00:00Z" }), // responded → reward
      lead("b"), // still new → no reward
      lead("c", { stagePosition: 1, createdAt: "2026-11-01T09:00:00Z", updatedAt: "2026-11-17T12:00:00Z" }), // created before start → no
      lead("d", { stagePosition: 5, category: "won", stage: "Won", updatedAt: "2026-11-17T15:00:00Z" }), // won + responded
    ],
    invoices: [
      { id: "i1", number: "INV-1", clientName: "X", status: "paid", dueDate: "2026-11-30", sentAt: "2026-11-12T10:00:00Z", paidAt: "2026-11-15", total: 100, currency: "EUR", createdAt: "2026-11-12T09:00:00Z" },
      { id: "i2", number: "INV-2", clientName: "Y", status: "draft", dueDate: "2026-11-30", sentAt: "", paidAt: "", total: 50, currency: "EUR", createdAt: "2026-11-12T09:00:00Z" },
    ],
    bookings: [{ id: "b1", name: "Sarah", startAt: "2026-11-20T10:00:00Z", status: "booked", createdAt: "2026-11-16T10:00:00Z" }, { id: "b2", name: "Old", startAt: "2026-11-20T10:00:00Z", status: "cancelled", createdAt: "2026-11-16T10:00:00Z" }],
    tasks: [{ id: "t1", title: "Follow up", status: "Done", priority: "Normal", due: "", completedAt: "2026-11-16T10:00:00Z", createdAt: "" }],
    expenses: [{ id: "e1", description: "Fuel", amount: 40, date: "2026-11-12", hasReceipt: true }, { id: "e2", description: "Lunch", amount: 10, date: "2026-11-12", hasReceipt: false }, { id: "e3", description: "Google Ads", amount: 300, date: "2026-11-12", hasReceipt: false, category: "Advertising & marketing" }],
  });
  const keys = achievementsFromSnapshot(s, START).map((a) => a.key).sort();
  assert.deepEqual(keys, ["adspend:e3", "booking:b1", "expense:e2", "inv-new:i1", "inv-new:i2", "inv-paid:i1", "inv-sent:i1", "lead:a", "lead:d", "receipt:e1", "task:t1", "won:d"].sort());
  const walk = rewardWalkthrough(achievementsFromSnapshot(s, START), "x");
  assert.equal(walk.reduce((n, w) => n + w.keys.length, 0), 12);
  assert.ok(walk.find((w) => w.employee === "marketing").items[0].includes("Ad spend"));
  // Idempotency through the real ledger primary key.
  const db = new DatabaseSync(":memory:"); for (const sql of OPERATING_WORLD_SCHEMA) db.exec(sql);
  const ins = db.prepare("INSERT OR IGNORE INTO ow_ledger (owner_id, scope_id, reward_key, kind, coins, xp, label, earned_at, created_at) VALUES ('o','',?,?,?,?,?,?,?)");
  const collect = db.prepare("UPDATE ow_ledger SET collected_at=? WHERE owner_id='o' AND scope_id='' AND collected_at=''");
  for (let round = 0; round < 3; round++) for (const a of achievementsFromSnapshot(s, START)) ins.run(a.key, a.kind, a.coins, a.xp, a.label, a.at, NOW);
  const row = db.prepare("SELECT COUNT(*) n, SUM(coins) c FROM ow_ledger").get();
  assert.equal(row.n, 12); assert.equal(row.c, 20 + 20 + 100 + 40 + 50 + 30 + 20 + 50 + 10 + 10 + 10 + 10);
  // Collecting twice only collects once.
  assert.equal(collect.run(NOW).changes, 12); assert.equal(collect.run(NOW).changes, 0);
});

test("daily cap stops reward farming", () => {
  const tasks = Array.from({ length: 60 }, (_, i) => ({ id: `t${i}`, title: "x", status: "Done", priority: "", due: "", completedAt: "2026-11-16T10:00:00Z", createdAt: "" }));
  assert.equal(achievementsFromSnapshot(snap({ tasks }), START).length, DAILY_REWARD_CAP);
  const contacts = Array.from({ length: 60 }, (_, i) => ({ id: `c${i}`, name: "x", createdAt: "2026-11-16T10:00:00Z" }));
  assert.equal(achievementsFromSnapshot(snap({ contacts }), START).length, DAILY_REWARD_CAP);
});

test("briefing reflects real data and never invents activity", () => {
  assert.deepEqual(briefing(snap()), []);
  assert.match(allClearLine("x"), /\w/);
  const b = briefing(snap({ leads: [lead("1", { createdAt: "2026-11-16T08:00:00Z" }), lead("2"), lead("3"), lead("4"), lead("5")] }));
  assert.equal(b[0].employee, "receptionist"); assert.equal(b[0].count, 5); assert.equal(b[0].mood, "panicked");
  assert.match(b[0].line, /five|\b5\b/i);
  assert.ok(b[0].options.some((o) => o.label === "Let AI prepare all responses"));
  assert.equal(b[0].options.find((o) => o.label === "Show the most urgent lead").focusId, "1");
  // Same data, same day → same words (no random flicker).
  assert.equal(briefing(snap({ leads: [lead("1")] }))[0].line, briefing(snap({ leads: [lead("1")] }))[0].line);
  // A disconnected source produces no approach rather than a fake zero.
  assert.deepEqual(briefing(snap({ leads: [lead("1")], sources: { ...allSources, crm: false } })), []);
});

test("health is operational and recovers when work is done", () => {
  const busy = snap({ leads: [lead("1", { createdAt: "2026-11-16T08:00:00Z" }), lead("2", { createdAt: "2026-11-16T08:00:00Z" })], threads: [{ id: "t", name: "A", channel: "sms", unread: 2, lastAt: NOW, preview: "hi" }] });
  const h = operationalHealth(busy); assert.ok(h.score < 85); assert.ok(h.issues.length >= 2);
  assert.equal(operationalHealth(snap()).score, 100);
});

test("finance summary counts only confirmed payments as money received", () => {
  const f = financialSummary(snap({ invoices: [
    { id: "1", number: "1", clientName: "", status: "paid", dueDate: "", sentAt: "", paidAt: "2026-11-05", total: 120.5, currency: "EUR", createdAt: "" },
    { id: "2", number: "2", clientName: "", status: "sent", dueDate: "", sentAt: "x", paidAt: "", total: 80, currency: "EUR", createdAt: "" },
    { id: "3", number: "3", clientName: "", status: "draft", dueDate: "", sentAt: "", paidAt: "", total: 999, currency: "EUR", createdAt: "" },
  ] }));
  assert.deepEqual(f.paidThisMonth, { EUR: 120.5 }); assert.deepEqual(f.outstanding, { EUR: 80 });
});

test("upgrade tracks: tiers in order, level-gated, coin-gated", () => {
  assert.ok(UPGRADES.length >= 6);
  assert.equal(upgradeTier([], "garden"), 0);
  assert.equal(nextUpgrade("garden", []).name, "Flower beds");
  assert.equal(canBuy("garden", [], 100, 1), null);
  assert.equal(upgradeTier(["garden:1", "garden:2"], "garden"), 2);
  assert.equal(nextUpgrade("garden", ["garden:1", "garden:2"]).name, "Fountain");
  assert.match(canBuy("garden", ["garden:1", "garden:2"], 1000, 1), /level 5/);
  assert.match(canBuy("garden", ["garden:1", "garden:2", "garden:3"], 9999, 50), /Fully/);
  assert.match(canBuy("garden", [], 10, 1), /more coins/);
  assert.match(canBuy("nope", [], 10, 1), /exist/);
});

test("industry guess and commands", () => {
  assert.equal(guessIndustry("Pro Roofers Galway"), "roofing");
  assert.equal(guessIndustry("Renew Electrical"), "electrician");
  assert.equal(guessIndustry("Red Island Interiors"), "interiors");
  assert.equal(guessIndustry("Inkwell Tattoo Studio"), "tattoo");
  assert.equal(guessIndustry("Acme Ltd"), "general");
  const s = snap({ invoices: [{ id: "1", number: "1", clientName: "", status: "paid", dueDate: "", sentAt: "", paidAt: "2026-11-05", total: 100, currency: "EUR", createdAt: "" }] });
  assert.match(parseCommand("How much have we earned this month?", s).answer, /EUR 100\.00/);
  assert.equal(parseCommand("Book James in for next Tuesday", s).panel, "scheduling");
  assert.equal(parseCommand("Record this receipt", s).panel, "expense");
  assert.equal(parseCommand("Chase every overdue invoice", s).panel, "invoicing");
  assert.equal(parseCommand("Prepare replies for all five new leads", s).panel, "lead-replies");
  assert.equal(parseCommand("Show me everyone we haven't replied to", s).panel, "leads");
  assert.ok(parseCommand("Sing me a song", s).needsAi);
});

test("tax man raids only week-old expenses without receipts, never below zero", () => {
  const ex = [
    { id: "a", description: "Fuel", amount: 1, date: "2026-11-10", hasReceipt: false },
    { id: "b", description: "Lunch", amount: 1, date: "2026-11-16", hasReceipt: false },
    { id: "c", description: "Tools", amount: 1, date: "2026-11-10", hasReceipt: true },
    { id: "d", description: "Ads", amount: 1, date: "2026-11-10", hasReceipt: false, category: "Advertising & marketing" },
    { id: "e", description: "Old", amount: 1, date: "2026-11-01", hasReceipt: false },
  ];
  assert.deepEqual(taxRaids(ex, START, NOW).map((r) => r.key), ["raid:a"]);
  assert.equal(raidAmount(100), 15); assert.equal(raidAmount(6), 6); assert.equal(raidAmount(-3), 0);
});
