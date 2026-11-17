import test from "node:test";
import assert from "node:assert/strict";
import { nextStatus, parseApprovedTemplates, renderTemplate, templateVariables, windowState, WINDOW_MS } from "../lib/conversations/whatsapp.ts";

test("24-hour window is open right after the customer writes and closes after 24h", () => {
  const now = Date.parse("2026-11-17T19:00:00Z");
  assert.equal(windowState("", now).open, false);
  assert.equal(windowState(undefined, now).open, false);
  const fresh = windowState(new Date(now - 3 * 3_600_000).toISOString(), now);
  assert.equal(fresh.open, true);
  assert.equal(fresh.label, "21h left");
  assert.equal(windowState(new Date(now - WINDOW_MS + 5 * 60_000).toISOString(), now).label, "5m left");
  assert.equal(windowState(new Date(now - WINDOW_MS - 1).toISOString(), now).open, false);
});

test("delivery ticks never go backwards, failures always show", () => {
  assert.equal(nextStatus("", "sent"), "sent");
  assert.equal(nextStatus("sent", "delivered"), "delivered");
  assert.equal(nextStatus("read", "delivered"), "read"); // callbacks can arrive out of order
  assert.equal(nextStatus("delivered", "undelivered"), "undelivered");
  assert.equal(nextStatus("failed", "read"), "failed");
  assert.equal(nextStatus("sent", "nonsense"), "sent");
});

test("template blanks are found and filled", () => {
  assert.deepEqual(templateVariables("Hi {{1}}, thanks from {{2}}. {{1}}!"), ["1", "2"]);
  assert.equal(renderTemplate("Hi {{1}}, from {{ 2 }}", { 1: "Mary", 2: "Pro Roofers" }), "Hi Mary, from Pro Roofers");
  assert.equal(renderTemplate("Hi {{1}}", {}), "Hi {{1}}");
});

test("only approved WhatsApp templates are offered", () => {
  const json = { contents: [
    { sid: "HX" + "a".repeat(32), friendly_name: "follow_up", language: "en", variables: { 1: "name" }, types: { "twilio/text": { body: "Hi {{1}}, any update?" } }, approval_requests: { name: "follow_up", category: "UTILITY", status: "approved" } },
    { sid: "HX" + "b".repeat(32), friendly_name: "promo", language: "en", types: { "twilio/text": { body: "Sale!" } }, approval_requests: { whatsapp: { name: "promo", category: "MARKETING", status: "pending" } } },
    { sid: "HX" + "c".repeat(32), friendly_name: "card", language: "en_GB", types: { "twilio/card": { title: "Your quote from {{1}}" } }, approval_requests: { whatsapp: { name: "quote_card", category: "UTILITY", status: "APPROVED" } } },
    { sid: "bad", types: {}, approval_requests: { status: "approved" } },
  ] };
  const list = parseApprovedTemplates(json);
  assert.deepEqual(list.map((t) => t.name), ["follow_up", "quote_card"]);
  assert.equal(list[0].category, "utility");
  assert.deepEqual(list[0].variables, ["1"]);
  assert.equal(list[1].body, "Your quote from {{1}}");
  assert.deepEqual(parseApprovedTemplates(null), []);
});
