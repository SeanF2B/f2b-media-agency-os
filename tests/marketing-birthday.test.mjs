import test from "node:test";
import assert from "node:assert/strict";
import { marketingDateFieldRunAt, parseMarketingBirthday, nextMarketingBirthday } from "../lib/marketing-birthday.js";

test("GoHighLevel birthday parser keeps only validated month and day", () => {
  assert.equal(parseMarketingBirthday("2000-01-05T00:00:00.000Z"), "01-05");
  assert.equal(parseMarketingBirthday("05/01/2000"), "05-01");
  assert.equal(parseMarketingBirthday("2000/02/29"), "02-29");
  assert.equal(parseMarketingBirthday("2001-02-29"), null);
  assert.equal(parseMarketingBirthday("32/01/2000"), null);
  assert.equal(parseMarketingBirthday("not a date"), null);
});

test("birthday queue chooses the next local occurrence and configured send time", () => {
  const before = nextMarketingBirthday("10-29", new Date("2026-10-27T12:00:00.000Z"), "Europe/Dublin", "09:00");
  assert.deepEqual(before, { runAt: "2026-10-29T09:00:00.000Z", year: 2026 });
  const after = nextMarketingBirthday("10-27", new Date("2026-10-27T12:00:00.000Z"), "Europe/Dublin", "09:00");
  assert.deepEqual(after, { runAt: "2027-10-27T08:00:00.000Z", year: 2027 });
});

test("birthday dates apply explicit leap-day policy and valid local times", () => {
  assert.deepEqual(nextMarketingBirthday("02-29", new Date("2025-01-01T00:00:00.000Z"), "UTC", "09:00", "feb28"), { runAt: "2025-02-28T09:00:00.000Z", year: 2025 });
  assert.deepEqual(nextMarketingBirthday("02-29", new Date("2025-01-01T00:00:00.000Z"), "UTC", "09:00", "mar1"), { runAt: "2025-03-01T09:00:00.000Z", year: 2025 });
  assert.deepEqual(nextMarketingBirthday("03-29", new Date("2026-03-28T00:00:00.000Z"), "Europe/Dublin", "01:30"), { runAt: "2026-03-29T01:00:00.000Z", year: 2026 });
  assert.equal(nextMarketingBirthday("13-01", new Date(), "Europe/Dublin", "09:00"), null);
});

test("GoHighLevel date fields schedule at tenant local time or their exact date-time", () => {
  assert.equal(marketingDateFieldRunAt("2026-10-30", "DATE", "Europe/Dublin", "10:30"), "2026-10-30T10:30:00.000Z");
  assert.equal(marketingDateFieldRunAt("2026-12-30", "DATE", "Europe/Dublin", "10:30"), "2026-12-30T10:30:00.000Z");
  assert.equal(marketingDateFieldRunAt("2026-10-30T10:30:00+01:00", "DATE_TIME", "Europe/Dublin"), "2026-10-30T09:30:00.000Z");
  assert.equal(marketingDateFieldRunAt("2026-02-29", "DATE", "UTC", "09:00"), null);
  assert.equal(marketingDateFieldRunAt("2026-10-30", "DATE_TIME", "UTC", "09:00"), null);
  assert.equal(marketingDateFieldRunAt("2026-10-30", "DATE", "Not/AZone", "09:00"), null);
});
