import test from "node:test";
import assert from "node:assert/strict";
import { belongsTo, describeRecord, diffRecords, evaluate, externalHosts, formatEmail, formatTelegram, hackSignals, recordKey, repeatAfter } from "../lib/domain-guard.mjs";

const rec = (type, name, content, extra = {}) => recordKey({ type, name, content, ...extra });
const base = (over = {}) => ({
  domain: "client.ie",
  zone: { status: "active", paused: false, nameServers: ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"] },
  records: [rec("A", "client.ie", "192.0.2.1", { proxied: true }), rec("TXT", "client.ie", "v=spf1 -all")],
  settings: { always_use_https: "on", min_tls_version: "1.2", ssl: "full" },
  dnssec: "active",
  registrar: null,
  site: { ok: true, finalUrl: "https://client.ie/", hops: ["client.ie"], external: ["www.googletagmanager.com"], signals: [] },
  ...over,
});

test("record keys ignore ids and trailing dots", () => {
  assert.equal(recordKey({ id: "x", type: "cname", name: "WWW.client.ie.", content: "client.ie.", proxied: true }), "CNAME|www.client.ie|client.ie||1");
  assert.match(describeRecord(rec("MX", "client.ie", "mx.example.com", { priority: 10 })), /priority 10/);
});

test("diff finds added and removed records", () => {
  const { added, removed } = diffRecords([rec("A", "a.ie", "1.1.1.1")], [rec("A", "a.ie", "6.6.6.6")]);
  assert.equal(added.length, 1); assert.equal(removed.length, 1);
});

test("first run raises no change alerts for a healthy domain", () => {
  assert.deepEqual(evaluate(base(), null), []);
});

test("A record swapped to a new IP is critical", () => {
  const next = base({ records: [rec("A", "client.ie", "203.0.113.66", { proxied: false }), rec("TXT", "client.ie", "v=spf1 -all")] });
  const [finding] = evaluate(next, base());
  assert.equal(finding.severity, "critical");
  assert.match(finding.detail, /203\.0\.113\.66/);
});

test("TXT-only change is a warning, not critical", () => {
  const next = base({ records: [rec("A", "client.ie", "192.0.2.1", { proxied: true }), rec("TXT", "client.ie", "google-site-verification=abc")] });
  assert.equal(evaluate(next, base())[0].severity, "warning");
});

test("redirect to a new destination is critical", () => {
  const next = base({ site: { ok: true, finalUrl: "https://evil-casino.example/", hops: ["client.ie", "evil-casino.example"], external: [], signals: [] } });
  const finding = evaluate(next, base()).find((f) => f.key.includes("redirect:"));
  assert.equal(finding.severity, "critical");
});

test("new outside script on homepage is critical; known ones are ignored", () => {
  const next = base({ site: { ...base().site, external: ["www.googletagmanager.com", "cdn.badstuff.example"] } });
  const findings = evaluate(next, base());
  assert.equal(findings.length, 1);
  assert.match(findings[0].detail, /cdn\.badstuff\.example/);
});

test("nameserver change, paused zone and unlocked registrar are critical", () => {
  const findings = evaluate(base({ zone: { status: "active", paused: true, nameServers: ["ns1.attacker.example"] }, registrar: { locked: false, autoRenew: true, expiresAt: "2030-01-01" } }), base());
  const keys = findings.filter((f) => f.severity === "critical").map((f) => f.key);
  assert.ok(keys.some((k) => k.endsWith("zone-paused")));
  assert.ok(keys.some((k) => k.includes(":ns:")));
  assert.ok(keys.some((k) => k.endsWith("unlocked")));
});

test("site only flagged down after two failed checks in a row", () => {
  const down = { ok: false, error: "Could not connect" };
  assert.equal(evaluate(base({ site: down, failCount: 1 }), base()).length, 0);
  assert.equal(evaluate(base({ site: down, failCount: 2 }), base())[0].severity, "critical");
});

test("posture warnings for weak settings and pending DNSSEC", () => {
  const f = evaluate(base({ settings: { always_use_https: "off", min_tls_version: "1.0", ssl: "flexible" }, dnssec: "pending" }), null);
  assert.equal(f.length, 4);
  assert.ok(f.every((x) => x.severity === "warning"));
});

test("domain expiring soon without auto-renew", () => {
  const soon = new Date(Date.now() + 5 * 86_400_000).toISOString();
  assert.equal(evaluate(base({ registrar: { locked: true, autoRenew: false, expiresAt: soon } }), null)[0].severity, "critical");
});

test("external host extraction skips same-site and relative sources", () => {
  const html = `<script src="/a.js"></script><script src="https://www.client.ie/b.js"></script><script src="//cdn.other.example/x.js"></script><iframe src="https://www.youtube.com/embed/1"></iframe><form action="https://phish.example/post"></form><meta http-equiv="refresh" content="0;url=https://away.example/">`;
  assert.deepEqual(externalHosts(html, "client.ie"), ["away.example", "cdn.other.example", "phish.example", "www.youtube.com"]);
  assert.ok(belongsTo("www.client.ie", "client.ie")); assert.ok(!belongsTo("client.ie.evil.example", "client.ie"));
});

test("hack signals detect spam and obfuscation", () => {
  assert.deepEqual(hackSignals("<p>Roofing in Galway</p>"), []);
  assert.equal(hackSignals("<p>cheap viagra</p><script>eval(atob('x'))</script>").length, 2);
});

test("alert formats escape HTML and flag critical", () => {
  const findings = [{ severity: "critical", key: "k", title: "client.ie: <b>DNS</b> changed", detail: "+ A x → 1.2.3.4" }];
  const tg = formatTelegram(findings, "https://os.example");
  assert.match(tg.text, /SECURITY ALERT/); assert.match(tg.text, /&lt;b&gt;DNS/);
  assert.equal(tg.buttons[0].url, "https://os.example/?page=Settings&settings=domains");
  assert.match(formatEmail(findings).subject, /SECURITY ALERT/);
  assert.ok(repeatAfter("critical") < repeatAfter("warning"));
});
