// End-to-end: the real Outreach server code (actions + scheduled engine) against a real SQLite
// database with every app migration applied. Only the outside world is simulated, at the network
// edge: Microsoft Graph, public DNS (dns.google), OpenRouter and Telegram. One mailbox, no purchases.
//
// Run: node --experimental-transform-types --import ./tests/e2e/register.mjs --test tests/e2e/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createD1 } from "./d1-shim.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OWNER = "owner-e2e";
const DOMAIN = "f2b-outreach-demo.ie";
const MAILBOX = `sean@${DOMAIN}`;
const ctx = { ownerId: OWNER, actor: "e2e", origin: "https://agency.test" };

// ---------------------------------------------------------------- environment
const DB = createD1(root);
assert.deepEqual(DB.failures, [], "every migration applies");
const env = globalThis.__OUTREACH_TEST_ENV__ = {
  DB,
  AGENCY_CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  OPENROUTER_API_KEY: "sk-or-test",
  TELEGRAM_BOT_TOKEN: "7012345678:AAH-existingF2BbotTokenForTests_xyz12", // reused from the server secrets, never a new bot
  TELEGRAM_CHAT_ID: "-1009876543210",
};
const now0 = new Date().toISOString();
DB.sqlite.prepare("INSERT INTO workspace_documents (id, owner_id, data, updated_at) VALUES ('f2b-agency', ?, '{}', ?)").run(OWNER, now0);
DB.sqlite.prepare("INSERT INTO crm_pipelines (id, owner_id, name, created_at, updated_at) VALUES ('pipe-1', ?, 'Sales', ?, ?)").run(OWNER, now0, now0);
[["st-new", "New lead", 0, "open"], ["st-replied", "Replied", 1, "open"], ["st-call", "Call booked", 2, "open"], ["st-won", "Won", 3, "won"]]
  .forEach(([id, name, position, category]) => DB.sqlite.prepare("INSERT INTO crm_pipeline_stages (id, owner_id, pipeline_id, name, position, category, created_at) VALUES (?, ?, 'pipe-1', ?, ?, ?, ?)").run(id, OWNER, name, position, category, now0));

// ---------------------------------------------------------------- the outside world
const dns = { dmarc: false, dkim: true };
const inbox = []; // messages that will arrive in the mailbox
const calls = []; const sentMime = []; const telegram = [];
let deltaToken = 0;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const answer = (type, data) => ({ Status: 0, Answer: data.map((value) => ({ type: { TXT: 16, MX: 15, CNAME: 5 }[type], data: type === "TXT" ? `"${value}"` : value })) });
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const method = (init.method || "GET").toUpperCase();
  calls.push(`${method} ${url.host}${url.pathname}`);
  if (url.host === "login.microsoftonline.com") return json({ access_token: "graph-token", expires_in: 3600, token_type: "Bearer" });
  if (url.host === "graph.microsoft.com") {
    const p = decodeURIComponent(url.pathname.replace("/v1.0", ""));
    if (p === "/organization") return json({ value: [{ id: "t1", displayName: "F2B Media", verifiedDomains: [{ name: "f2b.onmicrosoft.com", isInitial: true }] }] });
    if (p === `/users/${MAILBOX}/mailFolders/inbox`) return json({ id: "inbox" });
    if (p === `/users/${MAILBOX}/sendMail` && method === "POST") { sentMime.push(Buffer.from(String(init.body), "base64").toString("utf8")); return new Response(null, { status: 202 }); }
    if (p === `/users/${MAILBOX}/mailFolders/inbox/messages/delta`) {
      const primed = url.searchParams.has("$deltatoken");
      const value = primed ? inbox.splice(0) : [];
      deltaToken += 1;
      return json({ value, "@odata.deltaLink": `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MAILBOX)}/mailFolders/inbox/messages/delta?$deltatoken=${deltaToken}` });
    }
    return json({ error: { message: `unexpected Graph call ${method} ${p}` } }, 404);
  }
  if (url.host === "dns.google") {
    const name = url.searchParams.get("name"); const type = url.searchParams.get("type");
    if (name === DOMAIN && type === "TXT") return json(answer("TXT", ["v=spf1 include:spf.protection.outlook.com -all"]));
    if (name === DOMAIN && type === "MX") return json(answer("MX", ["0 f2b-outreach-demo-ie.mail.protection.outlook.com."]));
    if (name === `_dmarc.${DOMAIN}` && type === "TXT") return json(dns.dmarc ? answer("TXT", ["v=DMARC1; p=none; rua=mailto:dmarc@f2bmedia.com"]) : { Status: 3 });
    if (/^selector[12]\._domainkey\./.test(name) && type === "CNAME") return json(dns.dkim ? answer("CNAME", [`${name.split(".")[0]}-f2b-outreach-demo-ie._domainkey.f2b.onmicrosoft.com.`]) : { Status: 3 });
    return json({ Status: 3 });
  }
  if (url.host === "openrouter.ai") {
    const body = JSON.parse(String(init.body || "{}"));
    const usage = { input_tokens: 400, output_tokens: 60, cost: 0.01 };
    if (/classify replies/i.test(body.instructions || "")) {
      const text = JSON.stringify(body.input).toLowerCase();
      const label = /not interested/.test(text) ? "negative" : "positive";
      return json({ output_text: JSON.stringify({ label, confidence: 0.94, reason: "test" }), usage });
    }
    if (/draft replies/i.test(body.instructions || "")) return json({ output_text: JSON.stringify({ reply: "Great to hear, Aoife. Would Thursday at 11 suit for a 15-minute call?" }), usage });
    return json({ output_text: "{}", usage });
  }
  if (url.host === "api.telegram.org") {
    if (url.pathname.endsWith("/getMe")) return json({ ok: true, result: { username: "f2b_bot" } });
    if (url.pathname.endsWith("/sendMessage")) { telegram.push(JSON.parse(String(init.body))); return json({ ok: true, result: { message_id: telegram.length } }); }
    if (/setWebhook|getUpdates/.test(url.pathname)) throw new Error("The existing bot's webhook/updates must never be touched.");
  }
  throw new Error(`Unexpected network call in e2e: ${method} ${url.href}`);
};

const { runAction, loadState } = await import(path.join(root, "lib/outreach/server/actions.ts"));
const { processOutreach } = await import(path.join(root, "lib/outreach/server/engine.ts"));
const act = (action, body = {}) => runAction(ctx, { action, ...body });
const one = (sql, ...params) => DB.sqlite.prepare(sql).get(...params);
const all = (sql, ...params) => DB.sqlite.prepare(sql).all(...params);

// The next weekday 10:00 UTC (09:00–17:00 Dublin sending window), safely after "now".
function nextWeekdayMorning() {
  const date = new Date(); date.setUTCDate(date.getUTCDate() + 1); date.setUTCHours(10, 10, 0, 0);
  while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}
let clock = nextWeekdayMorning();
const tick = async (minutes = 10) => { clock = new Date(clock.getTime() + minutes * 60_000); return processOutreach(clock); };
// Headers plus every base64 text part decoded, so assertions read what the recipient reads.
const readable = (mime) => mime.replace(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)(?=\r\n--)/g, (_, data) => `\r\n${Buffer.from(data.replace(/\r\n/g, ""), "base64").toString("utf8")}`);
const graphMessage = (id, from, name, subject, text) => ({ id, internetMessageId: `<${id}@mail.test>`, conversationId: `c-${from}`, subject, receivedDateTime: clock.toISOString(), from: { emailAddress: { address: from, name } }, body: { contentType: "text", content: text } });

// ---------------------------------------------------------------- the workflow
let mailboxId = "", campaignId = "";

test("1. connect the existing Microsoft 365 tenant (no purchase)", async () => {
  const result = await act("connect-microsoft", { tenantId: "f2b.onmicrosoft.com", clientId: "11111111-2222-3333-4444-555555555555", clientSecret: "secret-value-123" });
  assert.equal(result.ok, true);
  const stored = one("SELECT * FROM outreach_connections WHERE owner_id = ? AND provider = 'microsoft'", OWNER);
  assert.equal(stored.status, "ok");
  assert.ok(!JSON.stringify(stored).includes("secret-value-123"), "the client secret is stored encrypted only");
});

test("2. connect one existing mailbox; its domain is protected and DMARC is missing", async () => {
  const result = await act("connect-existing-mailbox", { host: "microsoft", email: MAILBOX, displayName: "Sean Murphy" });
  assert.equal(result.check.allPass, false);
  assert.equal(result.check.dmarc, "missing");
  const domain = one("SELECT * FROM outreach_domains WHERE owner_id = ? AND domain = ?", OWNER, DOMAIN);
  assert.equal(domain.protected, 1, "a connected existing domain is protected by default — its DNS is never changed");
  mailboxId = one("SELECT id FROM outreach_mailboxes WHERE email = ?", MAILBOX).id;
});

test("3. warm-up refuses to start while authentication fails", async () => {
  const result = await act("mailboxes-bulk", { ids: [mailboxId], op: "warmup-start" });
  assert.equal(result.started, 0);
  assert.deepEqual(result.blocked, [MAILBOX]);
  assert.equal(one("SELECT status FROM outreach_mailboxes WHERE id = ?", mailboxId).status, "setup");
});

test("4. once DMARC is published, one click starts the ramp", async () => {
  dns.dmarc = true;
  const check = await act("domain-check", { domain: DOMAIN });
  assert.equal(check.check.allPass, true);
  const result = await act("mailboxes-bulk", { ids: [mailboxId], op: "warmup-start" });
  assert.equal(result.started, 1);
  assert.equal(one("SELECT status FROM outreach_mailboxes WHERE id = ?", mailboxId).status, "ramping");
  const state = await loadState(ctx, new URLSearchParams());
  const box = state.mailboxes.find((item) => item.id === mailboxId);
  assert.ok(box, "mailbox appears in Infrastructure");
  assert.ok(box.limitToday > 0 && box.limitToday <= 15, "day-one allowance is small");
});

test("5. campaign launch is blocked until lawful basis + fresh SPF/DKIM/DMARC pass", async () => {
  await act("save-settings", { appUrl: "https://agency.test", senderAddress: "F2B Media, Galway, Ireland" });
  const saved = await act("campaign-save", {
    name: "Galway roofers — website refresh", niche: "Roofers", offer: "Free website audit", mailboxIds: [mailboxId], pipelineId: "pipe-1", stageId: "st-replied",
    schedule: { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", tz: "recipient", fallbackTz: "Europe/Dublin" },
    steps: [
      { delayDays: 0, variants: [{ id: "A", subject: "Quick question about {{company}}", body: "Hi {{first_name}},\n\nI had a look at {{company}}'s website and noticed the quote form is hard to find on mobile. Would a short audit be useful?\n\nSean" }] },
      { delayDays: 3, variants: [{ id: "A", subject: "", body: "Hi {{first_name}}, just bumping this in case it got buried. Happy to send the audit over.\n\nSean" }] },
    ],
  });
  campaignId = saved.id;
  let launch = await act("campaign-status", { id: campaignId, status: "active" });
  assert.equal(launch.ok, false);
  assert.ok(launch.blockers.some((text) => /lawful basis/i.test(text)));

  await act("campaign-save", { id: campaignId, name: "Galway roofers — website refresh", mailboxIds: [mailboxId], pipelineId: "pipe-1", stageId: "st-replied", lawfulBasis: "Legitimate interest: B2B offer relevant to the recipient's role; business addresses only; opt-out in every email.", steps: [
    { delayDays: 0, variants: [{ id: "A", subject: "Quick question about {{company}}", body: "Hi {{first_name}},\n\nI had a look at {{company}}'s website and noticed the quote form is hard to find on mobile. Would a short audit be useful?\n\nSean" }] },
    { delayDays: 3, variants: [{ id: "A", subject: "", body: "Hi {{first_name}}, just bumping this in case it got buried. Happy to send the audit over.\n\nSean" }] },
  ] });

  dns.dkim = false; // DKIM disappears → the fresh check at launch must block
  launch = await act("campaign-status", { id: campaignId, status: "active" });
  assert.equal(launch.ok, false);
  assert.ok(launch.blockers.some((text) => text.includes(DOMAIN) && /SPF, DKIM and DMARC/.test(text)));
  assert.equal(one("SELECT status FROM outreach_campaigns WHERE id = ?", campaignId).status, "draft");

  dns.dkim = true;
  launch = await act("campaign-status", { id: campaignId, status: "active" });
  assert.deepEqual(launch, { ok: true });
});

test("6. import shares CRM contacts, skips suppressed and duplicates", async () => {
  DB.sqlite.prepare("INSERT INTO crm_contacts (id, owner_id, first_name, last_name, email, phone, company, source, notes, created_at, updated_at) VALUES ('existing-1', ?, 'Aoife', '', 'aoife@westroofing.ie', '', '', 'Website', '', ?, ?)").run(OWNER, now0, now0);
  await act("suppression-add", { value: "nope@blocked.ie", reason: "unsubscribe" });
  const csv = "email,first_name,last_name,company\naoife@westroofing.ie,Aoife,Byrne,West Roofing\nconor@atlanticroofs.ie,Conor,Walsh,Atlantic Roofs\nconor@atlanticroofs.ie,Conor,Walsh,Atlantic Roofs\nnope@blocked.ie,No,Thanks,Blocked Ltd\n";
  const result = await act("import-commit", { campaignId, csv });
  assert.equal(result.created, 1, "only Conor is new");
  assert.equal(result.linked, 1, "Aoife is the existing CRM contact, not a duplicate");
  assert.equal(result.enrolled, 2);
  assert.equal(one("SELECT COUNT(*) n FROM crm_contacts WHERE lower(email) = 'aoife@westroofing.ie'").n, 1);
  assert.equal(one("SELECT company FROM crm_contacts WHERE id = 'existing-1'").company, "West Roofing", "blank CRM fields are filled, never overwritten");
  const again = await act("import-commit", { campaignId, csv });
  assert.equal(again.enrolled, 0, "re-importing enrols nobody twice");
  assert.equal(one("SELECT COUNT(*) n FROM outreach_enrollments WHERE campaign_id = ?", campaignId).n, 2);
});

test("7. the scheduled engine sends personalised mail, once per contact, with one-click unsubscribe", async () => {
  for (let index = 0; index < 4 && sentMime.length < 2; index += 1) await tick(10);
  assert.equal(sentMime.length, 2, "both contacts emailed (one per tick, respecting the mailbox gap)");
  const aoife = sentMime.map(readable).find((mime) => /To: .*aoife@westroofing\.ie/i.test(mime));
  assert.ok(aoife, "Aoife got her email");
  assert.match(aoife, /Subject: Quick question about West Roofing/);
  assert.match(aoife, /Hi Aoife,/);
  assert.match(aoife, /List-Unsubscribe: <https:\/\/agency\.test\/api\/marketing-public\/outreach-unsubscribe\?t=/);
  assert.match(aoife, /List-Unsubscribe-Post: List-Unsubscribe=One-Click/);
  assert.ok(!sentMime.map(readable).some((mime) => mime.includes("{{")), "no unfilled placeholders");
  assert.match(aoife, /unsubscribe: https:\/\/agency\.test/i, "a visible opt-out in the body too");
  const before = sentMime.length;
  await tick(10); await tick(10);
  assert.equal(sentMime.length, before, "nothing is sent twice; follow-ups wait their 3 days");
  assert.equal(one("SELECT COUNT(*) n FROM outreach_sends WHERE campaign_id = ? AND status = 'sent'", campaignId).n, 2);
  assert.equal(one("SELECT COUNT(*) n FROM conv_messages WHERE direction = 'out'").n, 2, "sent emails appear in Conversations");
});

test("8. replies: positive → opportunity + one Telegram alert; out-of-office handled silently; strangers ignored", async () => {
  inbox.push(
    graphMessage("m1", "aoife@westroofing.ie", "Aoife Byrne", "Re: Quick question about West Roofing", "Yes, that would be useful — can you send it over? Happy to chat next week."),
    graphMessage("m2", "conor@atlanticroofs.ie", "Conor Walsh", "Automatic reply: Out of office", "I'm out of the office until Monday with limited access to email."),
    graphMessage("m3", "newsletter@random.io", "Random", "Our November deals", "Big savings this week."),
  );
  const report = await tick(10);
  assert.equal(report.replies.errors, 0);
  const replies = all("SELECT r.label, c.email FROM outreach_replies r JOIN crm_contacts c ON c.id = r.contact_id ORDER BY c.email");
  assert.deepEqual(replies.map((row) => [row.email, row.label]), [["aoife@westroofing.ie", "positive"], ["conor@atlanticroofs.ie", "out-of-office"]]);
  assert.equal(all("SELECT * FROM conv_messages WHERE body LIKE '%November deals%'").length, 0, "non-Outreach mail is never stored");

  const opportunity = one("SELECT * FROM crm_opportunities WHERE owner_id = ? AND source_submission_id = 'outreach:existing-1'", OWNER);
  assert.ok(opportunity, "a pipeline opportunity was created for the existing contact");
  assert.equal(opportunity.stage_id, "st-replied");
  assert.equal(opportunity.contact_id, "existing-1");

  assert.equal(telegram.length, 1, "exactly one immediate alert — only the positive reply");
  assert.equal(telegram[0].chat_id, env.TELEGRAM_CHAT_ID);
  assert.match(telegram[0].text, /Aoife/);
  assert.ok(!calls.some((call) => /setWebhook|getUpdates/.test(call)));

  const aoife = one("SELECT status, stop_reason FROM outreach_enrollments WHERE contact_id = 'existing-1'");
  assert.equal(aoife.status, "replied", "a genuine reply ends the sequence");
  const conor = one("SELECT status, next_send_at FROM outreach_enrollments WHERE email = 'conor@atlanticroofs.ie'");
  assert.equal(conor.status, "active", "out-of-office does not end the sequence");
  assert.ok(new Date(conor.next_send_at).getTime() > Date.now() + 6 * 86_400_000, "…it waits a week");
  const draft = one("SELECT suggested_reply, reply_status FROM outreach_replies WHERE contact_id = 'existing-1'");
  assert.equal(draft.reply_status, "drafted", "the AI responder drafted a reply for approval — nothing was auto-sent");
  assert.equal(sentMime.length, 2);
});

test("9. a second positive reply never duplicates the opportunity, thread or alert noise", async () => {
  inbox.push(graphMessage("m4", "aoife@westroofing.ie", "Aoife Byrne", "Re: Quick question about West Roofing", "Also — Thursday works for a call."));
  await tick(10);
  assert.equal(one("SELECT COUNT(*) n FROM crm_opportunities WHERE source_submission_id = 'outreach:existing-1'").n, 1);
  assert.equal(one("SELECT COUNT(*) n FROM conv_threads WHERE lower(contact) = 'aoife@westroofing.ie'").n, 1, "one conversation per contact");
  assert.equal(telegram.length, 2, "a new positive message in a live conversation (a meeting time) is worth an immediate ping");
});

test("10. unsubscribe is permanent and survives re-import", async () => {
  inbox.push(graphMessage("m5", "conor@atlanticroofs.ie", "Conor Walsh", "Re: Quick question about Atlantic Roofs", "Please unsubscribe me from these emails."));
  await tick(10);
  assert.equal(one("SELECT reason FROM outreach_suppressions WHERE value = 'conor@atlanticroofs.ie'").reason, "unsubscribe");
  assert.equal(one("SELECT status FROM outreach_enrollments WHERE email = 'conor@atlanticroofs.ie'").status, "unsubscribed");
  assert.equal(telegram.length, 2, "unsubscribes are handled silently");
  await act("campaign-save", { name: "Second campaign", mailboxIds: [mailboxId], steps: [{ variants: [{ subject: "Hi", body: "Hi {{first_name}}" }] }] }).then(async ({ id }) => {
    const result = await act("import-commit", { campaignId: id, csv: "email,first_name\nconor@atlanticroofs.ie,Conor\n" });
    assert.equal(result.enrolled, 0, "never contacted again");
  });
  await assert.rejects(() => act("suppression-remove", { value: "conor@atlanticroofs.ie" }), /unsubscribe|can't|cannot|permanent/i);
});

test("11. Overview shows real numbers and real costs; nothing was purchased", async () => {
  const state = await loadState(ctx, new URLSearchParams({ from: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), to: new Date(clock.getTime() + 86_400_000).toISOString().slice(0, 10) }));
  assert.equal(state.overview.sent, 2);
  assert.ok(state.overview.positive >= 1);
  assert.ok(state.costs && typeof state.costs.totalCents === "number");
  assert.ok(state.costs.lines.some((line) => /AI/i.test(line.label) && line.cents > 0), "recorded OpenRouter spend shows up");
  assert.ok(!calls.some((call) => /registrar|registrations/.test(call)), "no domain purchase calls");
  assert.ok(!calls.some((call) => call.startsWith("POST graph.microsoft.com/v1.0/users") && !call.includes("sendMail")), "no mailbox created");
  assert.ok(!calls.some((call) => /api\.cloudflare\.com.*dns_records/.test(call) && !call.startsWith("GET")), "the protected domain's DNS was never changed");
});
