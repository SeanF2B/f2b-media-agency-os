import test from "node:test";
import assert from "node:assert/strict";
import { isMetaChangeValueCurrent, isMetaChangeValueValid, isMetaEntityStatusValid, toMetaBudgetMinorUnits } from "../lib/meta-ads-approval.ts";

test("Meta daily budgets use the ad account currency's minor unit precision", () => {
  assert.equal(toMetaBudgetMinorUnits(12.34, "EUR"), 1234);
  assert.equal(toMetaBudgetMinorUnits(1200, "JPY"), 1200);
  assert.throws(() => toMetaBudgetMinorUnits(12.345, "EUR"), /supports 2 decimal places/);
  assert.throws(() => toMetaBudgetMinorUnits(-1, "EUR"), /greater than zero/);
  assert.throws(() => toMetaBudgetMinorUnits(10, ""), /currency/);
});

test("Meta approval applies only while the live value still matches the staged value", () => {
  assert.equal(isMetaChangeValueCurrent("status", { status: "ACTIVE", dailyBudgetMinor: 1000 }, "ACTIVE"), true);
  assert.equal(isMetaChangeValueCurrent("status", { status: "PAUSED", dailyBudgetMinor: 1000 }, "ACTIVE"), false);
  assert.equal(isMetaChangeValueCurrent("daily_budget", { status: "ACTIVE", dailyBudgetMinor: 1234 }, "1234"), true);
  assert.equal(isMetaChangeValueCurrent("daily_budget", { status: "ACTIVE", dailyBudgetMinor: null }, "1234"), false);
});

test("Meta proposals accept only campaign pause, resume and positive budget actions", () => {
  assert.equal(isMetaChangeValueValid("status", "PAUSED"), true);
  assert.equal(isMetaChangeValueValid("status", "ACTIVE"), true);
  assert.equal(isMetaChangeValueValid("status", "DELETED"), false);
  assert.equal(isMetaChangeValueValid("daily_budget", "1000"), true);
  assert.equal(isMetaChangeValueValid("daily_budget", "0"), false);
  assert.equal(isMetaChangeValueValid("campaign_name", "x"), false);
});

test("Meta ad set and ad edits allow only pause or resume", () => {
  assert.equal(isMetaEntityStatusValid("ad_set", "PAUSED"), true);
  assert.equal(isMetaEntityStatusValid("ad", "ACTIVE"), true);
  assert.equal(isMetaEntityStatusValid("campaign", "PAUSED"), false);
  assert.equal(isMetaEntityStatusValid("ad", "DELETED"), false);
});
