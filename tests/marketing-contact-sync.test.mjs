import test from "node:test";
import assert from "node:assert/strict";
import { buildMarketingContactPayload, upsertMarketingContact } from "../lib/marketing-contact-sync.ts";

test("contact payload maps common form labels into the linked CRM contact schema", () => {
  const payload = buildMarketingContactPayload([
    { id: "name", label: "Your name" },
    { id: "email", label: "Contact email", type: "email" },
    { id: "phone", label: "Mobile number" },
    { id: "zip", label: "Eircode" },
    { id: "marketing", label: "Marketing consent" },
  ], { name: "Ada Lovelace", email: "ada@example.test", phone: "+353 1 234 5678", zip: "D02 X285", marketing: "yes" }, "loc-1", "Test form");
  assert.deepEqual(payload, {
    locationId: "loc-1", source: "Test form", name: "Ada Lovelace", email: "ada@example.test",
    phone: "+353 1 234 5678", postalCode: "D02 X285", firstName: "Ada", lastName: "Lovelace",
  });
  assert.equal(Object.hasOwn(payload, "marketing"), false);
});

test("address field type maps to the CRM address field even with a custom label", () => {
  const payload = buildMarketingContactPayload(
    [{ id: "email", label: "Email", type: "email" }, { id: "site", label: "Where is the property?", type: "address" }],
    { email: "ada@example.test", site: "14 Example Road, Dublin" },
    "loc-1",
    "Test form",
  );
  assert.deepEqual(payload, {
    locationId: "loc-1", source: "Test form", email: "ada@example.test", address1: "14 Example Road, Dublin",
  });
});

test("uploaded file names never enter mapped CRM contact fields", () => {
  const payload = buildMarketingContactPayload(
    [{ id: "file", label: "Email", type: "file" }, { id: "email", label: "Email address", type: "email" }],
    { file: "private-document.pdf", email: "ada@example.test" },
    "loc-1",
    "Test form",
  );
  assert.equal(payload.email, "ada@example.test");
  assert.equal(Object.hasOwn(payload, "address1"), false);
  assert.equal(Object.values(payload).includes("private-document.pdf"), false);
});

test("contact sync is skipped when a form has no usable email or phone", () => {
  const payload = buildMarketingContactPayload([{ id: "goal", label: "Project goal" }], { goal: "New roof" }, "loc-1", "Test form");
  assert.equal(payload, null);
});

test("explicit contact mappings override label guessing and never send consent answers", () => {
  const payload = buildMarketingContactPayload([
    { id: "lead", label: "Where should we reach you?", type: "text", contactField: "email" },
    { id: "private", label: "Private answer", contactField: "none" },
    { id: "consent", label: "Email", type: "consent", contactField: "email" },
  ], { lead: "ada@example.test", private: "sensitive", consent: "yes" }, "loc-1", "Test form");
  assert.deepEqual(payload, { locationId: "loc-1", source: "Test form", email: "ada@example.test" });
});

test("invalid explicitly mapped email answers are not sent to GoHighLevel", () => {
  const payload = buildMarketingContactPayload([{ id: "reply", label: "Reply channel", contactField: "email" }], { reply: "call me" }, "loc-1", "Test form");
  assert.equal(payload, null);
});

test("GHL upsert sends the mapped contact to the existing official v3 endpoint", async () => {
  let captured;
  const result = await upsertMarketingContact("test-access-token", { email: "ada@example.test", locationId: "loc-1" }, async (url, init) => {
    captured = { url, init };
    return Response.json({ new: true, contact: { id: "contact-123" } });
  });
  assert.equal(captured.url, "https://services.leadconnectorhq.com/contacts/upsert");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers.Version, "v3");
  assert.equal(captured.init.headers.Authorization, "Bearer test-access-token");
  assert.deepEqual(JSON.parse(captured.init.body), { email: "ada@example.test", locationId: "loc-1" });
  assert.deepEqual(result, { contactId: "contact-123", created: true });
});

test("GHL upsert failures are surfaced for the saved submission's sync status", async () => {
  await assert.rejects(
    upsertMarketingContact("test-access-token", { locationId: "loc-1" }, async () => Response.json({ message: "scope is missing" }, { status: 403 })),
    /HighLevel contact sync failed: scope is missing/,
  );
});
