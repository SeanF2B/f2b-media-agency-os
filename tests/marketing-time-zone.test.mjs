import test from "node:test";
import assert from "node:assert/strict";
import { formatMarketingLocalDateTime, parseMarketingLocalDateTime } from "../lib/marketing-time-zone.js";
import { parseWaitUntil } from "../lib/marketing-automation.js";
import { parseMarketingTrigger, serializeMarketingTrigger } from "../lib/marketing-trigger.js";

test("automation schedule conversion follows selected zone and daylight saving changes", () => {
  assert.equal(parseMarketingLocalDateTime("2026-01-15T09:00", "Europe/Dublin"), "2026-01-15T09:00:00.000Z");
  assert.equal(parseMarketingLocalDateTime("2026-07-15T09:00", "Europe/Dublin"), "2026-07-15T08:00:00.000Z");
  assert.equal(parseMarketingLocalDateTime("2026-07-15T09:00", "America/New_York"), "2026-07-15T13:00:00.000Z");
  assert.equal(parseMarketingLocalDateTime("2026-10-25T01:30", "Europe/Dublin"), "2026-10-25T00:30:00.000Z");
  assert.equal(formatMarketingLocalDateTime("2026-07-15T08:00:00.000Z", "Europe/Dublin"), "2026-07-15T09:00");
});

test("automation schedule conversion rejects invalid dates and DST gaps", () => {
  assert.equal(parseMarketingLocalDateTime("2026-02-30T09:00", "Europe/Dublin"), null);
  assert.equal(parseMarketingLocalDateTime("2026-03-29T01:30", "Europe/Dublin"), null);
  assert.equal(parseMarketingLocalDateTime("2026-07-15T09:00", "Not/A_Time_Zone"), null);
  assert.equal(parseWaitUntil(JSON.stringify({ dateTime: "2026-07-15T08:00:00.000Z", timeZone: "Not/A_Time_Zone" })), null);
});

test("workflow timezone metadata persists while execution remains scheduled in UTC", () => {
  const runAt = parseMarketingLocalDateTime("2026-07-15T09:00", "Europe/Dublin");
  const parsed = parseMarketingTrigger(serializeMarketingTrigger("specific_date_time", "", runAt, "Europe/Dublin"));
  assert.equal(parsed.runAt, "2026-07-15T08:00:00.000Z");
  assert.equal(parsed.timeZone, "Europe/Dublin");
  assert.deepEqual(parseWaitUntil(JSON.stringify({ dateTime: runAt, timeZone: "Europe/Dublin" })), { runAt });
});
