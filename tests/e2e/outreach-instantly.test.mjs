// End-to-end: one-click flame with Instantly as the warm-up network. Real Outreach server code and
// SQLite; Microsoft Graph, public DNS, Instantly API v2 and Telegram are simulated at the network edge.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createD1 } from "./d1-shim.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OWNER = "owner-instantly";
const DOMAIN = "f2b-warm-demo.ie";
const MAILBOX = `aoife@${DOMAIN}`;
const ctx = { ownerId: OWNER, actor: "owner@agency.test", origin: "https://agency.test" };
const DB = createD1(root);
const env = globalThis.__OUTREACH_TEST_ENV__ = {
  DB, AGENCY_CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
  TELEGRAM_BOT_TOKEN: "7012345678:AAH-existingF2BbotTokenForTests_xyz12", TELEGRAM_CHAT_ID: "-1009876543210",
};
const now0 = new Date().toISOString();
DB.sqlite.prepare("INSERT INTO workspace_documents (id, owner_id, data, updated_at) VALUES ('f2b-agency', ?, '{}', ?)").run(OWNER, now0);

const instantly = { accounts: new Map(), warmup: new Set(), oauth: new Map(), calls: [] };
const telegram = [];
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const txt = (values) => ({ Status: 0, Answer: values.map((value) => ({ type: 16, data: `"${value}"` })) });
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url);
  const method = (init.method || "GET").toUpperCase();
  if (url.host === "login.microsoftonline.com") return json({ access_token: "t", expires_in: 3600 });
  if (url.host === "graph.microsoft.com") {
    const p = decodeURIComponent(url.pathname.replace("/v1.0", ""));
    if (p === "/organization") return json({ value: [{ id: "t1", displayName: "F2B", verifiedDomains: [{ name: "f2b.onmicrosoft.com", isInitial: true }] }] });
    if (p === `/users/${MAILBOX}/mailFolders/inbox`) return json({ id: "inbox" });
    if (p.endsWith("/messages/delta")) return json({ value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/x?$deltatoken=1" });
    return json({ error: { message: `unexpected ${p}` } }, 404);
  }
  if (url.host === "dns.google") {
    const name = url.searchParams.get("name"); const type = url.searchParams.get("type");
    if (name === DOMAIN && type === "TXT") return json(txt(["v=spf1 include:spf.protection.outlook.com -all"]));
    if (name === DOMAIN && type === "MX") return json({ Status: 0, Answer: [{ type: 15, data: "0 f2b-warm-demo-ie.mail.protection.outlook.com." }] });
    if (name === `_dmarc.${DOMAIN}` && type === "TXT") return json(txt(["v=DMARC1; p=none"]));
    if (/^selector[12]\._domainkey\./.test(name)) return json({ Status: 0, Answer: [{ type: 5, data: `${name.split(".")[0]}-x._domainkey.f2b.onmicrosoft.com.` }] });
    return json({ Status: 3 });
  }
  if (url.host === "api.instantly.ai") {
    assert.equal(init.headers.Authorization, "Bearer inst_live_key_0123456789abcdef");
    const p = url.pathname.replace("/api/v2", ""); const body = init.body ? JSON.parse(String(init.body)) : {};
    instantly.calls.push(`${method} ${p}`);
    if (p === "/accounts" && method === "GET") return json({ items: [...instantly.accounts.values()] });
    if (p.startsWith("/accounts/") && method === "GET" && !p.includes("warmup")) {
      const account = instantly.accounts.get(decodeURIComponent(p.slice("/accounts/".length)));
      return account ? json(account) : json({ statusCode: 404, error: "Not Found", message: "Resource not found" }, 404);
    }
    if (p === "/oauth/microsoft/init" && method === "POST") { const id = `sess-${instantly.oauth.size + 1}`; instantly.oauth.set(id, "pending"); return json({ session_id: id, auth_url: `https://login.microsoftonline.com/instantly-consent?s=${id}`, expires_at: new Date(Date.now() + 600_000).toISOString() }); }
    if (p.startsWith("/oauth/session/status/")) {
      const id = p.split("/").pop(); const status = instantly.oauth.get(id);
      return json(status === "success" ? { status, email: MAILBOX, name: "Aoife", account_id: "acc-1" } : { status });
    }
    if (p === "/accounts/warmup/enable") { body.emails.forEach((email) => { instantly.warmup.add(email); const account = instantly.accounts.get(email); if (account) account.warmup_status = 1; }); return json({ id: "job-1", status: "pending" }); }
    if (p === "/accounts/warmup/disable") { body.emails.forEach((email) => { instantly.warmup.delete(email); const account = instantly.accounts.get(email); if (account) account.warmup_status = 0; }); return json({ id: "job-2", status: "pending" }); }
    if (p === "/accounts/warmup-analytics") return json({ email_date_data: {}, aggregate_data: Object.fromEntries(body.emails.map((email) => [email, { sent: 120, received: 118, landed_inbox: 111, landed_spam: 7, health_score_label: "94%", health_score: 94 }])) });
    return json({ statusCode: 404, message: `unexpected ${method} ${p}` }, 404);
  }
  if (url.host === "api.telegram.org") { if (url.pathname.endsWith("/sendMessage")) telegram.push(JSON.parse(String(init.body))); return json({ ok: true, result: {} }); }
  throw new Error(`Unexpected network call: ${method} ${url.href}`);
};

const { runAction, loadState } = await import(path.join(root, "lib/outreach/server/actions.ts"));
const { processOutreach } = await import(path.join(root, "lib/outreach/server/engine.ts"));
const act = (action, body = {}) => runAction(ctx, { action, ...body });
const one = (sql, ...params) => DB.sqlite.prepare(sql).get(...params);
const box = async () => (await loadState(ctx, new URLSearchParams())).mailboxes.find((item) => item.email === MAILBOX);
let mailboxId = "";

test("connect Microsoft and Instantly (key verified, stored encrypted)", async () => {
  await act("connect-microsoft", { tenantId: "f2b.onmicrosoft.com", clientId: "11111111-2222-3333-4444-555555555555", clientSecret: "secret-value-123" });
  const result = await act("connect-instantly", { apiKey: "inst_live_key_0123456789abcdef" });
  assert.equal(result.ok, true);
  const stored = one("SELECT * FROM outreach_connections WHERE owner_id = ? AND provider = 'instantly'", OWNER);
  assert.equal(stored.status, "ok");
  assert.ok(!JSON.stringify(stored).includes("inst_live_key"), "API key is never stored in plain text");
  await act("connect-existing-mailbox", { host: "microsoft", email: MAILBOX, displayName: "Aoife Byrne", manageDns: true });
  mailboxId = one("SELECT id FROM outreach_mailboxes WHERE email = ?", MAILBOX).id;
});

test("flame click: DNS passes, mailbox isn't in Instantly yet → one sign-in link", async () => {
  const { results: [item] } = await act("warmup-auto", { ids: [mailboxId] });
  assert.equal(item.state, "connect");
  assert.match(item.authUrl, /^https:\/\/login\.microsoftonline\.com\/instantly-consent/);
  assert.equal(item.mailboxId, mailboxId);
  const state = await box();
  assert.equal(state.external.connecting, true);
  assert.equal(one("SELECT status FROM outreach_mailboxes WHERE id = ?", mailboxId).status, "setup");
});

test("after the sign-in, Instantly warm-up switches on and the flame counts the days", async () => {
  assert.equal((await act("instantly-connect-status", { id: mailboxId })).state, "pending");
  instantly.oauth.set("sess-1", "success");
  instantly.accounts.set(MAILBOX, { email: MAILBOX, status: 1, warmup_status: 0, stat_warmup_score: null });
  const done = await act("instantly-connect-status", { id: mailboxId });
  assert.equal(done.state, "started");
  assert.ok(instantly.warmup.has(MAILBOX));
  const state = await box();
  assert.equal(state.external.connecting, false);
  assert.equal(state.external.day, 1); assert.equal(state.external.days, 14); assert.equal(state.external.ready, false);
  const again = await act("warmup-auto", { ids: [mailboxId] });
  assert.equal(again.results[0].state, "already");
});

test("campaigns can't launch during Instantly warm-up (but can be unlocked early)", async () => {
  const saved = await act("campaign-save", { name: "Test", mailboxIds: [mailboxId], lawfulBasis: "Legitimate interest, B2B.", steps: [{ variants: [{ subject: "Hi {{first_name}}", body: "Hi {{first_name}}, quick question." }] }] });
  const launch = await act("campaign-status", { id: saved.id, status: "active" });
  assert.equal(launch.ok, false);
  assert.ok(launch.blockers.some((text) => /still warming with Instantly \(day 1 of 14\)/.test(text)));
});

test("engine pulls Instantly's warm-up numbers into the flame and the report", async () => {
  const tickAt = new Date(Date.now() + 2 * 3600_000);
  const report = await processOutreach(tickAt);
  assert.equal(report.instantly.refreshed, 1);
  const state = await box();
  assert.deepEqual({ sent: state.external.stats.sent, inbox: state.external.stats.inbox, spam: state.external.stats.spam, score: state.external.stats.healthScore }, { sent: 120, inbox: 111, spam: 7, score: 94 });
  const deliverability = await act("deliverability-report", { id: mailboxId });
  assert.equal(deliverability.externalWarmup.provider, "Instantly");
  assert.ok(deliverability.findings.some((item) => /Warm-up emails reach the inbox 94\.\d%/.test(item.text)));
  const costs = (await loadState(ctx, new URLSearchParams())).costs;
  assert.ok(costs.lines.some((line) => line.key === "instantly" && line.cents === 4700), "Instantly plan appears in monthly costs");
});

test("after 14 days the mailbox unlocks for campaigns by itself, with full ramp credit", async () => {
  await processOutreach(new Date(Date.now() + 15 * 86_400_000));
  const row = one("SELECT status, ramp_started_at, health_json FROM outreach_mailboxes WHERE id = ?", mailboxId);
  assert.equal(row.status, "ramping");
  assert.equal(row.ramp_started_at, JSON.parse(row.health_json).external.startedAt, "ramp counts from the first Instantly warm-up day");
  assert.ok(instantly.warmup.has(MAILBOX), "Instantly keeps warming in the background");
});

test("a banned account raises one critical alert; pausing stops Instantly warm-up", async () => {
  instantly.accounts.get(MAILBOX).warmup_status = -1;
  await processOutreach(new Date(Date.now() + 16 * 86_400_000));
  await processOutreach(new Date(Date.now() + 16 * 86_400_000 + 3600_000));
  const alerts = telegram.filter((message) => /Instantly warm-up problem/.test(message.text));
  assert.equal(alerts.length, 1, "critical infrastructure alert sent once, not every hour");
  instantly.accounts.get(MAILBOX).warmup_status = 1;
  await act("warmup-pause", { id: mailboxId });
  assert.ok(!instantly.warmup.has(MAILBOX));
  assert.equal(one("SELECT status FROM outreach_mailboxes WHERE id = ?", mailboxId).status, "paused");
  assert.equal((await box()).external.paused, true);
});
