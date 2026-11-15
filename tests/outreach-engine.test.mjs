import test from "node:test";
import assert from "node:assert/strict";
import { dailyAllowance, rampProgress } from "../lib/outreach/ramp.mjs";
import { renderTemplate, contactVariables, templateVariables } from "../lib/outreach/personalise.mjs";
import { buildMessage, encodeHeader, replySubject, base64url } from "../lib/outreach/mime.mjs";
import { planTick, inSendWindow, pickVariant, nextAfterSend } from "../lib/outreach/scheduler.mjs";
import { parseCsv, prepareImport, checkEmail } from "../lib/outreach/leads.mjs";
import { matchContact, contactPatch, planPositiveReplyOpportunity, opportunityKey } from "../lib/outreach/crm-link.mjs";

const day = (n) => new Date(Date.UTC(2026, 10, 2 + n, 10, 0)).toISOString(); // 2 Nov 2026 is a Monday

// ---------- ramp ----------
test("ramp starts at 5, adds 3 a day, stops at target", () => {
  assert.equal(dailyAllowance({ rampStartedAt: day(0), targetDaily: 30, now: day(0) }).limit, 5);
  assert.equal(dailyAllowance({ rampStartedAt: day(0), targetDaily: 30, now: day(4) }).limit, 17);
  assert.equal(dailyAllowance({ rampStartedAt: day(0), targetDaily: 30, now: day(20) }).phase, "active");
  assert.equal(dailyAllowance({ rampStartedAt: day(0), targetDaily: 500, now: day(60) }).limit, 50);
});
test("new domains are held, amber halves, red stops, not started sends nothing", () => {
  assert.equal(dailyAllowance({ rampStartedAt: day(0), targetDaily: 30, domainRegisteredAt: day(0), now: day(8) }).limit, 15);
  assert.equal(dailyAllowance({ rampStartedAt: day(0), targetDaily: 30, healthBand: "amber", now: day(20) }).limit, 15);
  assert.equal(dailyAllowance({ rampStartedAt: day(0), targetDaily: 30, healthBand: "red", now: day(20) }).limit, 0);
  assert.equal(dailyAllowance({ rampStartedAt: null, targetDaily: 30 }).limit, 0);
  assert.equal(dailyAllowance({ rampStartedAt: day(0), targetDaily: 30, sentToday: 4, now: day(0) }).remaining, 1);
  assert.equal(rampProgress({ rampStartedAt: day(0), targetDaily: 29, now: day(4) }), 0.5);
});

// ---------- personalisation ----------
test("variables, fallbacks and spintax render; missing vars block the send", () => {
  const vars = contactVariables({ first_name: "Pat", company: "" });
  const ok = renderTemplate("Hi {{first_name}}, quick one about {{company|your roofing business}}. {Thanks|Cheers}", vars, "e1");
  assert.equal(ok.ok, true);
  assert.match(ok.text, /^Hi Pat, quick one about your roofing business\. (Thanks|Cheers)$/);
  assert.equal(renderTemplate("{Thanks|Cheers}", vars, "e1").text, renderTemplate("{Thanks|Cheers}", vars, "e1").text);
  const bad = renderTemplate("Saw {{custom_line}} on your site", vars);
  assert.deepEqual([bad.ok, bad.missing], [false, ["custom_line"]]);
  assert.deepEqual(templateVariables("{{first_name}} {{company|x}} {{city}}"), ["first_name", "city"]);
});

// ---------- MIME ----------
test("message has threading and one-click unsubscribe headers", () => {
  const raw = buildMessage({ from: { name: "Sean Kelly", email: "sean@f2b-growth.com" }, to: { name: "Pat", email: "pat@proroofers.ie" }, subject: "Re: roofs", text: "Hi Pat\nThanks", messageId: "<b@f2b-growth.com>", inReplyTo: "<a@f2b-growth.com>", unsubscribeUrl: "https://os.example/u/abc" });
  assert.match(raw, /^From: "Sean Kelly" <sean@f2b-growth\.com>\r\n/);
  assert.match(raw, /\r\nIn-Reply-To: <a@f2b-growth\.com>\r\nReferences: <a@f2b-growth\.com>\r\n/);
  assert.match(raw, /List-Unsubscribe: <https:\/\/os\.example\/u\/abc>/);
  assert.match(raw, /List-Unsubscribe-Post: List-Unsubscribe=One-Click/);
  assert.ok(!/\n(?!\r)/.test(raw.replace(/\r\n/g, "")), "CRLF only");
  assert.equal(encodeHeader("Plain"), "Plain");
  assert.match(encodeHeader("Fáilte"), /^=\?UTF-8\?B\?/);
  assert.equal(replySubject("Re: roofs"), "Re: roofs");
  assert.ok(!/[+/=]/.test(base64url("??>>")));
  assert.throws(() => buildMessage({ from: { email: "bad" }, to: { email: "a@b.co" }, subject: "x", text: "y", messageId: "<x@y>" }));
});

// ---------- scheduler ----------
const steps = [{ variants: [{ id: "A", weight: 1 }, { id: "B", weight: 1 }] }, { delayDays: 3, variants: [{ id: "F1", weight: 1 }] }];
const baseCampaign = { status: "active", schedule: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", tz: "Europe/Dublin" }, mailboxIds: ["m1", "m2"], steps };
const mailboxes = () => ({ m1: { id: "m1", status: "active", remaining: 2, minGapSeconds: 240 }, m2: { id: "m2", status: "ramping", remaining: 1, minGapSeconds: 240 } });

test("send window respects days, hours and time zone", () => {
  assert.equal(inSendWindow(day(0), baseCampaign.schedule), true);                         // Mon 10:00 Dublin
  assert.equal(inSendWindow(day(5), baseCampaign.schedule), false);                        // Saturday
  assert.equal(inSendWindow(day(0), { ...baseCampaign.schedule, tz: "recipient" }, "America/New_York"), false); // 05:00 in NY
});

test("one send per mailbox per tick, load-balanced, company spacing, suppression stops", () => {
  const due = [
    { id: "e1", campaignId: "c1", email: "a@acme.ie", step: 0, nextSendAt: day(0) },
    { id: "e2", campaignId: "c1", email: "b@acme.ie", step: 0, nextSendAt: day(0) },
    { id: "e3", campaignId: "c1", email: "c@other.ie", step: 0, nextSendAt: day(0) },
    { id: "e4", campaignId: "c1", email: "d@blocked.ie", step: 0, nextSendAt: day(0) },
    { id: "e5", campaignId: "c1", email: "e@third.ie", step: 0, nextSendAt: day(0) },
  ];
  const plan = planTick({ now: day(0), due, campaigns: { c1: baseCampaign }, mailboxes: mailboxes(), suppressed: new Set(["@blocked.ie"]) });
  assert.deepEqual(plan.sends.map((send) => [send.enrollmentId, send.mailboxId]), [["e1", "m1"], ["e3", "m2"]]);
  assert.deepEqual(plan.stops, [{ id: "e4", reason: "suppressed" }]);
  assert.ok(plan.skipped.some((item) => item.id === "e2" && item.reason === "company-spacing"));
  assert.ok(plan.skipped.some((item) => item.id === "e5" && item.reason === "no-capacity"));
  assert.equal(plan.sends[0].idempotencyKey, "e1:0");
});

test("follow-ups wait for their own mailbox; min gap is enforced; paused campaigns send nothing", () => {
  const boxes = mailboxes(); boxes.m1.lastSentAt = new Date(new Date(day(0)).getTime() - 60_000).toISOString();
  const plan = planTick({ now: day(0), due: [{ id: "e1", campaignId: "c1", email: "a@x.ie", step: 1, nextSendAt: day(0), mailboxId: "m1" }], campaigns: { c1: baseCampaign }, mailboxes: boxes, suppressed: new Set() });
  assert.deepEqual([plan.sends.length, plan.skipped[0].reason], [0, "mailbox-busy"]);
  const paused = planTick({ now: day(0), due: [{ id: "e1", campaignId: "c1", email: "a@x.ie", step: 0, nextSendAt: day(0) }], campaigns: { c1: { ...baseCampaign, status: "paused" } }, mailboxes: mailboxes(), suppressed: new Set() });
  assert.equal(paused.sends.length, 0);
});

test("variant choice is deterministic and next step timing is right", () => {
  assert.equal(pickVariant(steps[0].variants, "e1:0").id, pickVariant(steps[0].variants, "e1:0").id);
  assert.equal(pickVariant([{ id: "off", weight: 0 }, { id: "on", weight: 1 }], "x").id, "on");
  assert.deepEqual(nextAfterSend({ step: 0, steps, sentAt: day(0) }), { nextStep: 1, nextSendAt: day(3), status: "active" });
  assert.equal(nextAfterSend({ step: 1, steps, sentAt: day(0) }).status, "completed");
});

// ---------- leads ----------
test("CSV parser handles quotes, commas and CRLF", () => {
  assert.deepEqual(parseCsv('Email,Company\r\n"a@x.ie","Kelly, Sons & Co"\r\n'), [["Email", "Company"], ["a@x.ie", "Kelly, Sons & Co"]]);
});

test("import de-duplicates, links CRM contacts and blocks ineligible rows", () => {
  const csv = "Name,Email,Company,Industry\nPat McDonagh,pat@proroofers.ie,Pro Roofers,Roofing\nPat Again,PAT@proroofers.ie,Pro Roofers,Roofing\nJo,jo@gmail.com,,\nBad,not-an-email,,\nAnn,ann@known.ie,Known Ltd,\nSue,sue@blocked.ie,,\nTom,tom@recent.ie,,\n";
  const result = prepareImport(csv, { existingContacts: new Map([["ann@known.ie", { id: "c-ann" }]]), suppressed: new Set(["@blocked.ie"]), lastContacted: new Map([["tom@recent.ie", "2026-11-01T00:00:00Z"]]), now: new Date("2026-11-14T00:00:00Z") });
  const byEmail = Object.fromEntries(result.rows.map((row) => [row.email + (row.reason === "duplicate-in-file" ? "#2" : ""), row]));
  assert.equal(byEmail["pat@proroofers.ie"].action, "create");
  assert.equal(byEmail["pat@proroofers.ie"].first_name, "Pat");
  assert.equal(byEmail["pat@proroofers.ie"].custom.industry, "Roofing");
  assert.equal(byEmail["pat@proroofers.ie#2"].action, "skip");
  assert.equal(byEmail["jo@gmail.com"].reason, "personal-mailbox");
  assert.equal(byEmail["not-an-email"].reason, "invalid-syntax");
  assert.deepEqual([byEmail["ann@known.ie"].action, byEmail["ann@known.ie"].contact_id], ["link", "c-ann"]);
  assert.equal(byEmail["sue@blocked.ie"].reason, "suppressed");
  assert.equal(byEmail["tom@recent.ie"].reason, "contacted-recently");
  assert.deepEqual([result.summary.create, result.summary.link], [1, 1]);
  assert.deepEqual(checkEmail("info@acme.ie").flags, ["role-address"]);
});

// ---------- CRM link ----------
test("contacts match by email and client scope; patches never overwrite", () => {
  const list = [{ id: "a", email: "x@y.ie", client_id: "client1" }, { id: "b", email: "X@Y.ie", client_id: null }];
  assert.equal(matchContact(list, { email: "x@y.ie", clientId: "client1" }).id, "a");
  assert.equal(matchContact(list, { email: "x@y.ie" }).id, "b");
  assert.deepEqual(contactPatch({ first_name: "Pat", company: "" }, { first_name: "Patrick", company: "Pro Roofers" }), { company: "Pro Roofers" });
});

test("positive replies create one deal, move it forward, never reopen won/lost", () => {
  const target = { pipelineId: "p", stageId: "s-replied", stagePosition: 1 };
  const created = planPositiveReplyOpportunity({ existing: null, target, contactId: "c1", contactName: "Pat", company: "Pro Roofers", campaignName: "Roofers Q4" });
  assert.equal(created.op, "create");
  assert.equal(created.values.source_submission_id, opportunityKey("c1"));
  assert.equal(planPositiveReplyOpportunity({ existing: { id: "o", stage_id: "s0", stage_category: "open", stage_position: 0 }, target }).op, "move");
  assert.equal(planPositiveReplyOpportunity({ existing: { id: "o", stage_id: "s3", stage_category: "open", stage_position: 3 }, target }).op, "touch");
  assert.equal(planPositiveReplyOpportunity({ existing: { id: "o", stage_id: "w", stage_category: "won", stage_position: 5 }, target }).op, "none");
});

test("embedded schema matches the migration file", async () => {
  const { readFileSync } = await import("node:fs");
  const { OUTREACH_SCHEMA } = await import("../lib/outreach/schema-sql.mjs");
  // Comments are removed before splitting, so a ";" inside a comment can never cut a statement.
  const sql = readFileSync(new URL("../drizzle/0049_outreach.sql", import.meta.url), "utf8").split("\n").map((line) => line.replace(/--.*$/, "")).join("\n");
  const statements = sql.split(";").map((part) => part.replace(/\s+/g, " ").trim()).filter(Boolean);
  assert.deepEqual(OUTREACH_SCHEMA, statements);
  // Every statement must be complete and valid SQLite on its own (that's how the app runs them).
  const { DatabaseSync } = await import("node:sqlite");
  const sqlite = new DatabaseSync(":memory:");
  for (const statement of OUTREACH_SCHEMA) assert.doesNotThrow(() => sqlite.prepare(statement).run(), statement.slice(0, 80));
});
