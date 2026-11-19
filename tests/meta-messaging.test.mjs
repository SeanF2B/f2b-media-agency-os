import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { inboundBody, metaSendMode, metaVerifyToken, parseMetaWebhook, verifyMetaSignature } from "../lib/conversations/meta-rules.ts";

test("parses Messenger and Instagram messages, skips reads and own page ids", () => {
  const page = { object: "page", entry: [{ id: "111", messaging: [
    { sender: { id: "999" }, recipient: { id: "111" }, timestamp: 1763600000000, message: { mid: "m1", text: "Hi, how much for a roof repair?" } },
    { sender: { id: "999" }, recipient: { id: "111" }, read: { watermark: 1 } },
    { sender: { id: "111" }, recipient: { id: "999" }, message: { mid: "m2", text: "Thanks!", is_echo: true, app_id: 42 } },
  ] }] };
  const out = parseMetaWebhook(page);
  assert.equal(out.length, 2);
  assert.deepEqual([out[0].channel, out[0].accountId, out[0].contactId, out[0].echo], ["messenger", "111", "999", false]);
  assert.deepEqual([out[1].contactId, out[1].echo, out[1].appId], ["999", true, "42"]);
  const ig = parseMetaWebhook({ object: "instagram", entry: [{ id: "178", messaging: [{ sender: { id: "555" }, recipient: { id: "178" }, message: { mid: "x", attachments: [{ type: "image", payload: { url: "https://cdn.example/p.jpg" } }] } }] }] });
  assert.equal(ig[0].channel, "instagram");
  assert.equal(inboundBody(ig[0]), "📷 https://cdn.example/p.jpg");
  assert.deepEqual(parseMetaWebhook({ object: "whatsapp_business_account", entry: [] }), []);
});

test("webhook signature must match the app secret", async () => {
  const body = JSON.stringify({ object: "page", entry: [] });
  const good = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
  assert.equal(await verifyMetaSignature("s3cret", body, good), true);
  assert.equal(await verifyMetaSignature("other", body, good), false);
  assert.equal(await verifyMetaSignature("s3cret", body + " ", good), false);
  assert.equal(await verifyMetaSignature("s3cret", body, null), false);
  assert.match(await metaVerifyToken("s3cret"), /^f2b-[0-9a-f]{24}$/);
});

test("reply window: bot 24h only, staff up to 7 days with HUMAN_AGENT", () => {
  const now = Date.parse("2026-11-19T22:00:00Z"), h = 3_600_000;
  assert.deepEqual(metaSendMode(new Date(now - 2 * h).toISOString(), false, now), { ok: true });
  assert.equal(metaSendMode(new Date(now - 30 * h).toISOString(), false, now).ok, false);
  assert.deepEqual(metaSendMode(new Date(now - 30 * h).toISOString(), true, now), { ok: true, tag: "HUMAN_AGENT" });
  assert.equal(metaSendMode(new Date(now - 8 * 24 * h).toISOString(), true, now).ok, false);
  assert.equal(metaSendMode("", true, now).ok, false);
});
