import test from "node:test";
import assert from "node:assert/strict";
import { pageSpeedApiErrorMessage } from "../lib/pagespeed-errors.ts";

test("PageSpeed zero daily quota asks for an enabled API key instead of suggesting a wait", () => {
  const body = JSON.stringify({ error: { message: "Quota exceeded for Queries per day", details: [{ quota_limit_value: "0", quota_metric: "pagespeedonline.googleapis.com/default" }] } });
  assert.match(pageSpeedApiErrorMessage(429, body), /no daily API quota enabled/i);
  assert.match(pageSpeedApiErrorMessage(429, body), /GOOGLE_PAGESPEED_API_KEY/);
});

test("PageSpeed transient rate limits still suggest waiting before retry", () => {
  assert.match(pageSpeedApiErrorMessage(429, JSON.stringify({ error: { message: "Too many requests" } })), /Wait before retrying/);
});

test("PageSpeed access errors name the required API setup", () => {
  assert.match(pageSpeedApiErrorMessage(403, "{}"), /enable the PageSpeed Insights API/);
});
