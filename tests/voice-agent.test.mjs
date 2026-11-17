import test from "node:test";
import assert from "node:assert/strict";
import { BLANK_AGENT, defaultGreeting, inCallWindow, peekCallToken, pickSlots, relayTwiml, relayVoice, sanitizeAgent, signCallToken, spokenTime, systemPrompt, transcriptText, verifyCallToken, voiceNoteBody, VOICE_NOTE_RE } from "../lib/voice-agent/core.ts";

test("sanitizeAgent keeps safe values, drops junk, merges with saved settings", () => {
  const a = sanitizeAgent({ inboundEnabled: true, voiceId: "nope", language: "xx", speed: 9, transferNumber: "085 123 4567", number: "+353911234567", calendarIds: ["a", 5, ""], outbound: { speed_to_lead: { enabled: true, channel: "whatsapp", delayMin: -3 } }, callWindow: { start: "25:00", end: "18:00", days: [1, 9, 2] } });
  assert.equal(a.inboundEnabled, true);
  assert.equal(a.voiceId, BLANK_AGENT.voiceId);
  assert.equal(a.language, "en-IE");
  assert.equal(a.speed, 1.2);
  assert.equal(a.transferNumber, ""); // national format is refused: international only
  assert.equal(a.number, "+353911234567");
  assert.deepEqual(a.calendarIds, ["a"]);
  assert.deepEqual(a.outbound.speed_to_lead, { enabled: true, channel: "whatsapp", delayMin: 0, script: "" });
  assert.equal(a.outbound.manual.enabled, true); // default on
  assert.deepEqual(a.callWindow, { start: "09:00", end: "18:00", days: [1, 2] });
  // A partial update keeps everything else.
  const b = sanitizeAgent({ outboundEnabled: true }, a);
  assert.equal(b.inboundEnabled, true);
  assert.equal(b.outboundEnabled, true);
  assert.equal(b.outbound.speed_to_lead.channel, "whatsapp");
});

test("call tokens: signed, tamper-proof and expiring", async () => {
  const t = await signCallToken("secret-token", "owner-1", "call-123", 60, Date.parse("2026-11-17T10:00:00Z"));
  assert.deepEqual((await verifyCallToken("secret-token", t, Date.parse("2026-11-17T10:00:30Z"))), { o: "owner-1", c: "call-123", e: Date.parse("2026-11-17T10:01:00Z") / 1000 });
  assert.equal(await verifyCallToken("other-secret", t, Date.parse("2026-11-17T10:00:30Z")), null);
  assert.equal(await verifyCallToken("secret-token", t, Date.parse("2026-11-17T10:02:00Z")), null);
  const [p, sig] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ o: "owner-2", c: "call-123", e: 9e9 })).toString("base64url");
  assert.equal(await verifyCallToken("secret-token", `${forged}.${sig}`), null);
  assert.equal(peekCallToken(t).o, "owner-1");
  assert.ok(p.length > 10);
});

test("TwiML hands the call to ConversationRelay with the chosen voice and escaped greeting", () => {
  const agent = sanitizeAgent({ voiceId: "aws-niamh", language: "en-IE" });
  const xml = relayTwiml({ wsUrl: "wss://x.dev/api/marketing-public/voice/relay?t=a.b", actionUrl: "https://x.dev/action?t=a.b", greeting: `Hi "Pat" & co`, agent, params: { greeting: "hi" } });
  assert.match(xml, /<Connect action="https:\/\/x\.dev\/action\?t=a\.b"><ConversationRelay /);
  assert.match(xml, /ttsProvider="Amazon" voice="Niamh-Neural"/);
  assert.match(xml, /welcomeGreeting="Hi &quot;Pat&quot; &amp; co"/);
  assert.match(xml, /<Parameter name="greeting" value="hi"\/>/);
  assert.equal(relayVoice({ voiceId: "custom", customVoice: "abc123", speed: 1.1 }).voice, "abc123-flash_v2_5-1.1_0.8_0.8");
  assert.equal(relayVoice({ voiceId: "el-george", customVoice: "", speed: 1 }).ttsProvider, "ElevenLabs");
});

test("greeting announces AI + recording", () => {
  const g = defaultGreeting({ agentName: "Sarah", greeting: "", recordCalls: true, announceRecording: true }, "Pro Roofers", "inbound");
  assert.match(g, /Pro Roofers/); assert.match(g, /AI assistant/); assert.match(g, /recorded/);
  const o = defaultGreeting({ agentName: "Sarah", greeting: "", recordCalls: false, announceRecording: true }, "Apex Ink", "outbound", "Mary Burke");
  assert.match(o, /^Hi Mary, it's Sarah/); assert.doesNotMatch(o, /recorded/);
});

test("call window respects local time and days", () => {
  const a = { timezone: "Europe/Dublin", callWindow: { start: "09:00", end: "19:00", days: [1, 2, 3, 4, 5] } };
  assert.equal(inCallWindow(a, Date.parse("2026-11-17T10:00:00Z")), true);  // Tue 10:00
  assert.equal(inCallWindow(a, Date.parse("2026-11-17T19:30:00Z")), false); // Tue 19:30
  assert.equal(inCallWindow(a, Date.parse("2026-11-22T10:00:00Z")), false); // Sunday
});

test("slots are spread out and read naturally", () => {
  const slots = [];
  for (const d of ["2026-11-19", "2026-11-20"]) for (let h = 9; h < 17; h++) slots.push({ start: `${d}T${String(h).padStart(2, "0")}:00:00Z` });
  const picks = pickSlots(slots, "Europe/Dublin", "any", 6);
  assert.ok(picks.length >= 4 && picks.length <= 6);
  assert.ok(new Set(picks.map((p) => p.slice(0, 10))).size === 2);
  assert.deepEqual(pickSlots(slots, "Europe/Dublin", "afternoon", 6).every((p) => Number(p.slice(11, 13)) >= 12), true);
  assert.equal(spokenTime("2026-11-19T10:30:00Z", "Europe/Dublin"), "Thursday 19 November at 10:30am");
});

test("voice note body + transcript format", () => {
  const body = voiceNoteBody({ callId: "abcd1234-ef", direction: "inbound", durationSec: 125, outcome: "Booked", summary: "Mary booked a quote." });
  assert.match(body, VOICE_NOTE_RE);
  assert.match(body, /Incoming AI call · 2:05 · Booked\nMary booked a quote\./);
  assert.equal(transcriptText([{ t: 0, who: "ai", text: "Hi" }, { t: 61500, who: "caller", text: "Hello" }]), "[0:00] AI: Hi\n[1:02] Caller: Hello");
});

test("system prompt lists bookable calendars and the purpose for outbound calls", () => {
  const p = systemPrompt({ agent: sanitizeAgent({ agentName: "Sam", instructions: "Ask for the Eircode." }), businessName: "Pro Roofers", knowledge: "Services: roofing", calendars: [{ id: "cal1", name: "Free quote visit", kind: "consultation", durationMin: 30, locationType: "onsite" }], direction: "outbound", purpose: "Confirm Thursday", caller: { name: "Mary", phone: "+353", known: true }, nowIso: "2026-11-17T10:00:00Z", script: "" });
  assert.match(p, /Free quote visit \[id cal1\]/); assert.match(p, /Purpose: Confirm Thursday/); assert.match(p, /Ask for the Eircode/); assert.match(p, /You are an AI/);
});
