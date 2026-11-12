import test from "node:test";
import assert from "node:assert/strict";
import {
  deliverGhlMarketingMessage,
  isGhlContactSuppressed,
  marketingConsentGranted,
  marketingMessageChannel,
  parseGhlMarketingMessageStatus,
  parseMarketingCustomerMessage,
  renderMarketingMessageTemplate,
  validateMarketingCustomerMessage,
} from "../lib/marketing-automation-message.js";

const fields = [
  { id: "email", type: "email", label: "Email address" },
  { id: "name", type: "text", label: "Your name" },
  { id: "emailConsent", type: "consent", label: "Email updates", required: true },
  { id: "file", type: "file", label: "Attachment" },
];

test("customer messages require a required consent field from the published source", () => {
  const config = JSON.stringify({ consentFieldId: "emailConsent", subject: "Thanks {{name}}", message: "We received your request, {{name}}." });
  assert.equal(validateMarketingCustomerMessage(config, "customerEmail", fields), null);
  assert.match(validateMarketingCustomerMessage(JSON.stringify({ ...JSON.parse(config), consentFieldId: "name" }), "customerEmail", fields), /required consent checkbox/);
  assert.match(validateMarketingCustomerMessage(JSON.stringify({ ...JSON.parse(config), message: "See {{file}}" }), "customerEmail", fields), /not an available answer/);
  assert.equal(marketingConsentGranted("emailConsent", fields, { emailConsent: "yes" }), true);
  assert.equal(marketingConsentGranted("emailConsent", fields, { emailConsent: "no" }), false);
  assert.equal(marketingConsentGranted("missing", fields, { missing: "yes" }), false);
});

test("customer message config keeps channels explicit and templates plain text", () => {
  assert.equal(marketingMessageChannel("customerEmail"), "Email");
  assert.equal(marketingMessageChannel("customerSms"), "SMS");
  assert.equal(marketingMessageChannel("customerWhatsapp"), "WhatsApp");
  assert.equal(parseMarketingCustomerMessage(JSON.stringify({ consentFieldId: "emailConsent", message: "Hello" }), "customerEmail"), null);
  assert.equal(renderMarketingMessageTemplate("Hi {{name}} {{missing}}", { name: "Sean" }), "Hi Sean ");
});

test("GHL per-channel and global do-not-contact settings prevent delivery", () => {
  assert.equal(isGhlContactSuppressed({ dnd: true }, "Email"), true);
  assert.equal(isGhlContactSuppressed({ dndSettings: { Email: { status: "active" } } }, "Email"), true);
  assert.equal(isGhlContactSuppressed({ inboundDndSettings: { all: { status: "active" } } }, "SMS"), true);
  assert.equal(isGhlContactSuppressed({ dndSettings: { whatsApp: { status: "active" } } }, "WhatsApp"), true);
  assert.equal(isGhlContactSuppressed({ dnd: false, dndSettings: { email: { status: "inactive" } } }, "Email"), false);
});

test("GHL message sends verify contact consent status before a channel-specific send", async () => {
  const calls = [];
  const request = async (...args) => {
    calls.push(args);
    if (args[2].startsWith("/contacts/")) return { payload: { contact: { id: "contact-1", dnd: false } } };
    return { payload: { messageId: "message-1" } };
  };
  const result = await deliverGhlMarketingMessage({ request, ownerId: "owner-1", clientId: "client-1", contactId: "contact-1", nodeType: "customerEmail", subject: "Thanks", message: "Received" });
  assert.deepEqual(result, { status: "sent", channel: "Email", providerMessageId: "message-1" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0][2], "/contacts/contact-1");
  assert.equal(calls[1][2], "/conversations/messages");
  assert.deepEqual(calls[1][4], { type: "Email", contactId: "contact-1", message: "Received", status: "pending", subject: "Thanks" });
});

test("SMS and WhatsApp delivery use their explicit GoHighLevel message channels", async () => {
  for (const [nodeType, channel] of [["customerSms", "SMS"], ["customerWhatsapp", "WhatsApp"]]) {
    const calls = [];
    const request = async (...args) => {
      calls.push(args);
      return args[2].startsWith("/contacts/") ? { payload: { contact: { id: "contact-1" } } } : { payload: { messageId: `message-${channel}` } };
    };
    const result = await deliverGhlMarketingMessage({ request, ownerId: "owner-1", clientId: "client-1", contactId: "contact-1", nodeType, message: "Thanks for your request." });
    assert.equal(result.status, "sent");
    assert.equal(result.channel, channel);
    assert.equal(calls[1][4].type, channel);
    assert.equal(calls[1][4].status, "pending");
    assert.equal("subject" in calls[1][4], false);
  }
});

test("message status read-back is bound to the expected message, contact and location", () => {
  const expected = { messageId: "message-1", contactId: "contact-1", locationId: "location-1" };
  assert.deepEqual(parseGhlMarketingMessageStatus({ message: { id: "message-1", contactId: "contact-1", locationId: "location-1", status: "delivered" } }, expected), { messageId: "message-1", status: "delivered" });
  assert.equal(parseGhlMarketingMessageStatus({ id: "message-1", contactId: "someone-else", locationId: "location-1", status: "delivered" }, expected), null);
  assert.equal(parseGhlMarketingMessageStatus({ id: "message-1", contactId: "contact-1", locationId: "other-location", status: "delivered" }, expected), null);
  assert.equal(parseGhlMarketingMessageStatus({ id: "message-1", contactId: "contact-1", locationId: "location-1", status: "unknown-provider-state" }, expected), null);
});

test("GHL suppression or an unverifiable contact prevents a send", async () => {
  let sends = 0;
  const suppressed = await deliverGhlMarketingMessage({ request: async (...args) => args[2].startsWith("/contacts/") ? { payload: { contact: { id: "contact-1", dndSettings: { SMS: { status: "active" } } } } } : (sends++, { payload: { messageId: "m1" } }), ownerId: "o", clientId: "c", contactId: "contact-1", nodeType: "customerSms", message: "Hello" });
  assert.equal(suppressed.status, "blocked");
  assert.equal(sends, 0);
  const unknownContact = await deliverGhlMarketingMessage({ request: async () => ({ payload: { contact: { id: "other-contact" } } }), ownerId: "o", clientId: "c", contactId: "contact-1", nodeType: "customerSms", message: "Hello" });
  assert.equal(unknownContact.status, "blocked");
});
