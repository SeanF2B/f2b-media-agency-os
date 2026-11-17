import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { inflateSync } from "node:zlib";
import * as E from "../lib/onboarding/engine.mjs";

test("routes share one question bank and conditional steps drop out", () => {
  for (const route of ["grow", "audit", "guidance"]) for (const step of E.ROUTE_STEPS[route]) for (const key of step.questions || []) assert.ok(E.QUESTIONS[key], `${route}.${step.key} → ${key}`);
  assert.deepEqual(E.stepsFor("grow", {}).map((step) => step.key), ["source", "confirm", "template", "goal", "help", "customers", "budget", "contact", "plan"]);
  assert.ok(E.ROUTE_STEPS.audit.every((step) => !step.when) && E.stepsFor("guidance", {}).length === 5);
  assert.equal(E.cleanAnswers({ template: "luxury" }).template, "luxury");
  assert.equal(E.cleanAnswers({ template: "neon" }).template, undefined);
  assert.equal(E.resumeStep("grow", {}, ""), "source");
  assert.equal(E.resumeStep("grow", { businessName: "Pro Roofers" }, "template"), "template");
});

test("answers are cleaned: unknown keys, bad options and junk dropped", () => {
  const out = E.cleanAnswers({ businessName: "  Acme\u0000 ", goal: "Hack", servicesWanted: ["SEO", "Bogus"], email: "nope", phone: "+353 (87) 123 4567", website: "www.Acme.ie/path", evil: "x" });
  assert.deepEqual(out, { businessName: "Acme", servicesWanted: ["SEO"], phone: "+353871234567", website: "https://acme.ie" });
  assert.equal(E.normaliseDomain("http://localhost"), "");
  assert.equal(E.normaliseDomain("10.0.0.1"), "");
  assert.equal(E.domainFromEmail("pat@gmail.com"), "");
  assert.equal(E.domainFromEmail("pat@proroofersgalway.ie"), "proroofersgalway.ie");
});

test("profile merge: confirmed facts are never overwritten by extraction, manual wins", () => {
  let p = E.mergeProfile({}, { businessName: "Acme Roofing", phone: "091 123456" }, "website");
  assert.equal(p.businessName.confirmed, false);
  p = E.confirmProfileFields(p, ["businessName"]);
  p = E.mergeProfile(p, { businessName: "ACME LTD" }, "upload");
  assert.equal(p.businessName.value, "Acme Roofing");
  p = E.mergeProfile(p, { phone: "000" }, "ai");
  assert.equal(p.phone.value, "091 123456", "lower-ranked source doesn't replace");
  p = E.mergeProfile(p, { businessName: "Acme Roofing Galway" }, "manual");
  assert.equal(p.businessName.value, "Acme Roofing Galway");
  assert.deepEqual(E.unconfirmedFields(p).map((f) => f.field), ["phone"]);
  assert.equal(E.answersFromProfile(p, { businessName: "Typed" }).businessName, "Typed");
});

test("AI: factual fields never call AI; claim guard strips unsupported claims", () => {
  assert.equal(E.isFactualField("phone"), true);
  assert.equal(E.isFactualField("Telephone number"), true);
  assert.equal(E.isFactualField("description"), false);
  assert.equal(E.aiActionAllowed("suggest", "email", "email", "").ok, false);
  assert.equal(E.aiActionAllowed("improve", "description", "textarea", "").ok, false);
  assert.equal(E.aiActionAllowed("alternatives", "description", "textarea", "").ok, true);
  const { text, removed } = E.guardClaims("We fix roofs across Galway. Award-winning team with 25 years of experience. Fully insured. Free quotes.", "We have 25 years of experience fixing roofs.");
  assert.match(text, /We fix roofs/);
  assert.match(text, /Free quotes/);
  assert.doesNotMatch(text, /Award/);
  assert.doesNotMatch(text, /insured/);
  assert.equal(removed.length, 2);
  assert.match(E.buildAssistInstructions("shorter", { audience: "customer" }), /Never invent/);
  assert.deepEqual(E.parseAssistReply("alternatives", '```json\n{"options":["A","B","C"]}\n```'), ["A", "B", "C"]);
  assert.deepEqual(E.parseAssistReply("suggest", "- Galway\n- Mayo", { list: true }), ["Galway\nMayo"]);
});

test("acquisition source tracking", () => {
  assert.equal(E.readAcquisition({ params: { utm_source: "outreach", utm_medium: "email" } }).channel, "Cold email");
  assert.equal(E.readAcquisition({ params: new URLSearchParams("gclid=abc") }).channel, "Google Ads");
  assert.equal(E.readAcquisition({ embedHost: "f2bmedia.com" }).channel, "Website embed");
  assert.equal(E.readAcquisition({ params: { ref: "pat" } }).channel, "Referral");
  assert.equal(E.readAcquisition({ referrer: "https://www.google.com/" }).channel, "Organic search");
});

test("CRM matching prevents duplicates: email, then phone, then domain", () => {
  const contacts = [{ id: "1", email: "pat@acme.ie", phone: "" }, { id: "2", email: "", phone: "087 123 4567" }, { id: "3", email: "info@other.ie" }];
  assert.equal(E.planContactMatch(contacts, { email: "PAT@acme.ie" }).contact.id, "1");
  assert.equal(E.planContactMatch(contacts, { email: "new@x.ie", phone: "+353871234567" }).contact.id, "2");
  assert.equal(E.planContactMatch(contacts, { email: "sales@other.ie", domain: "other.ie" }).matchedBy, "domain");
  assert.equal(E.planContactMatch(contacts, { email: "x@y.ie" }).contact, null);
  assert.deepEqual(E.contactFill({ first_name: "Pat", phone: "" }, { first_name: "P", phone: "1234567" }), { phone: "1234567" });
});

test("limits: defaults, staff multiplier, sanitised settings", () => {
  const limits = E.normaliseLimits({ auditsPerVisitorPerDay: "5", staffMultiplier: 0, globalAiPerDay: -3, allowAnonymousGeneration: "yes" });
  assert.equal(limits.auditsPerVisitorPerDay, 5);
  assert.equal(limits.staffMultiplier, 1);
  assert.equal(limits.globalAiPerDay, E.DEFAULT_LIMITS.globalAiPerDay);
  assert.equal(limits.allowAnonymousGeneration, false);
  assert.deepEqual(E.limitBuckets("audit", { visitor: "v" }), [["audit:v:v", 3], ["audit:global", 150]]);
  assert.deepEqual(E.limitBuckets("fresh_audit", { domain: "a.ie", staff: true }), [["audit:d:a.ie", 10]]);
});

test("site signals and prospect findings are labelled verified / ai / unavailable", () => {
  const html = `<html><head><title>Acme</title><script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234"></script></head><body><form></form></body></html>`;
  const signals = E.detectSiteSignals(html, "https://acme.ie");
  assert.equal(signals.ga4, true);
  assert.equal(signals.viewport, false);
  assert.equal(signals.googleAdsTag, false);
  const findings = E.prospectFindings({ signals, website: { status: "ok", data: { speed: { score: 34, lcp: "6.1 s" }, pagesChecked: 5, brokenLinks: 2, sitemapUrls: null, issues: [] } }, local: { status: "ok", data: { keyword: "roofer", location: "Galway", rank: null, rating: null, reviewCount: null, competitors: [{ name: "Top Roofs", rank: 1 }] } }, answers: { goal: "More enquiries quickly" } });
  assert.ok(findings.every((f) => ["verified", "ai", "unavailable"].includes(f.basis)));
  assert.ok(findings.find((f) => f.title === "Slow on mobile" && f.basis === "verified"));
  assert.ok(findings.find((f) => f.area === "Existing advertising" && f.basis === "unavailable"));
  assert.ok(findings.find((f) => f.basis === "ai" && f.service === "Google Ads"));
  assert.equal(findings[0].priority, "high");
  const free = E.splitFreeFindings(findings, false, 3);
  assert.equal(free.visible.length, 3);
  assert.ok(free.locked > 0);
  assert.ok(free.teaser.every((t) => !("evidence" in t)));
  assert.equal(E.splitFreeFindings(findings, true).locked, 0);
  const scores = E.auditScores(findings, { data: { speed: { score: 34 } } });
  assert.equal(scores.speed, 34);
  const rec = E.recommendServices(findings, { goal: "More enquiries quickly" });
  assert.equal(rec.combined, true);
  assert.ok(rec.services.some((s) => s.service === "Google Ads"));
  assert.equal(E.auditProgress(["site", "crawl"]), 40);
  assert.equal(E.nextAuditStage(["site"]), "crawl");
  assert.deepEqual(E.resumeForAction("website", "audit"), { route: "grow", step: "template", preview: "website" });
});

test("pricing: setup fees one-off, management monthly, bundle discount, never ad spend", () => {
  const quote = E.buildQuote({}, { services: ["Google Ads", "SEO", "Nonsense"], manager: true });
  assert.deepEqual(quote.services, ["Google Ads", "SEO"]);
  assert.equal(quote.oneOff, 30000 + 25000);
  assert.equal(quote.monthly, Math.round(350 * 0.9 * 100) + Math.round(450 * 0.9 * 100) + 25000);
  assert.ok(quote.lines.every((line) => !/spend/i.test(line.label)));
  assert.match(quote.adSpendNote, /billed directly/);
  const fields = new Map(E.checkoutFormFields(quote, { successUrl: "https://x/s", cancelUrl: "https://x/c", sessionRef: "onb_1", customerEmail: "a@b.ie" }));
  assert.equal(fields.get("mode"), "subscription");
  assert.equal(fields.get("line_items[0][price_data][unit_amount]"), "30000");
  assert.equal(fields.get("line_items[1][price_data][recurring][interval]"), "month");
  assert.equal(E.checkoutIdempotencyKey("s1", quote), E.checkoutIdempotencyKey("s1", E.buildQuote({}, { services: ["SEO", "Google Ads"], manager: true })));
  const priced = E.normalisePricing({ services: { SEO: { monthly: "999", setupFee: -5 } }, bundleDiscountPercent: 90 });
  assert.equal(priced.services.SEO.monthly, 999);
  assert.equal(priced.services.SEO.setupFee, 250);
  assert.equal(priced.bundleDiscountPercent, 10);
  assert.equal(E.isTestKey("sk_test_123"), true);
  assert.equal(E.isLiveKey("sk_test_123"), false);
});

test("Stripe webhook signatures verify and outcomes map to statuses", async () => {
  const secret = "whsec_test", payload = JSON.stringify({ id: "evt_1" }), t = 1_700_000_000;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  assert.equal(await E.verifyStripeSignature(payload, `t=${t},v1=${sig}`, secret, { nowSeconds: t + 10 }), true);
  assert.equal(await E.verifyStripeSignature(payload, `t=${t},v1=${sig}`, secret, { nowSeconds: t + 1000 }), false, "stale");
  assert.equal(await E.verifyStripeSignature(payload + " ", `t=${t},v1=${sig}`, secret, { nowSeconds: t }), false, "tampered");
  const done = E.stripeEventOutcome({ type: "checkout.session.completed", livemode: false, data: { object: { id: "cs_1", client_reference_id: "onb_1", subscription: "sub_1", payment_status: "paid", amount_total: 100, currency: "eur" } } });
  assert.equal(done.kind, "checkout_completed");
  assert.equal(done.sessionRef, "onb_1");
  assert.equal(E.nextPaymentStatus("", done), "paid");
  assert.equal(E.nextPaymentStatus("paid", { kind: "checkout_expired", paymentStatus: "abandoned" }), "paid");
  assert.equal(E.nextPaymentStatus("paid", E.stripeEventOutcome({ type: "invoice.payment_failed", data: { object: { subscription: "sub_1" } } })), "failed");
  assert.equal(E.nextPaymentStatus("paid", E.stripeEventOutcome({ type: "customer.subscription.deleted", data: { object: { id: "sub_1" } } })), "cancelled");
});

test("signed links expire and reject tampering; visitor hash is stable per day", async () => {
  const token = await E.makeLinkToken("s3cret", { c: "contact_1", k: "crm", e: 2_000_000_000 });
  assert.deepEqual(await E.readLinkToken("s3cret", token, 1_900_000_000), { c: "contact_1", k: "crm", e: 2_000_000_000 });
  assert.equal(await E.readLinkToken("s3cret", token, 2_000_000_001), null);
  assert.equal(await E.readLinkToken("other", token), null);
  assert.equal(await E.readLinkToken("s3cret", token.replace(/^./, "x")), null);
  assert.equal(await E.hashVisitor("k", "1.2.3.4", "ua", "2026-11-17"), await E.hashVisitor("k", "1.2.3.4", "ua", "2026-11-17"));
});

test("uploads are validated by real bytes; scripts and executables rejected", () => {
  assert.equal(E.validateUpload("logo.png", "image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0])).kind, "png");
  assert.equal(E.validateUpload("brochure.pdf", "application/pdf", new TextEncoder().encode("%PDF-1.7")).kind, "pdf");
  assert.equal(E.validateUpload("fake.pdf", "application/pdf", new TextEncoder().encode("MZ\u0090")).ok, false);
  assert.equal(E.validateUpload("run.exe", "", new Uint8Array([0x89, 0x50, 0x4e, 0x47])).ok, false);
  assert.equal(E.validateUpload("x.svg", "image/svg+xml", new TextEncoder().encode('<svg onload="alert(1)"></svg>')).ok, false);
  assert.equal(E.validateUpload("ok.svg", "image/svg+xml", new TextEncoder().encode('<svg viewBox="0 0 1 1"></svg>')).kind, "svg");
  assert.equal(E.htmlToText("<p>Hi&nbsp;<b>there</b></p><script>x()</script>"), "Hi there");
});

test("PDF text extraction reads plain and Flate streams", () => {
  const content = Buffer.from("BT /F1 12 Tf (Roof repairs in Galway) Tj [(Free) -250 (quotes)] TJ ET");
  const flate = deflateSync(content);
  const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n1 0 obj\n<< /Length 10 /Filter /FlateDecode >>\nstream\n"), flate, Buffer.from("\nendstream\nendobj\n")]);
  const text = E.pdfText(new Uint8Array(pdf), (data) => new Uint8Array(inflateSync(data)));
  assert.match(text, /Roof repairs in Galway/);
  assert.match(text, /Free\s*quotes/);
});

test("zip pre-scan lists entries without unpacking and refuses unsafe paths", async () => {
  // Minimal stored-zip builder (no dependency needed).
  const zipSync = (files) => {
    const enc = new TextEncoder(), locals = [], centrals = []; let offset = 0;
    for (const [name, data] of Object.entries(files)) {
      const n = enc.encode(name);
      const local = new Uint8Array(30 + n.length + data.length); const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, n.length, true); local.set(n, 30); local.set(data, 30 + n.length);
      const central = new Uint8Array(46 + n.length); const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, n.length, true); cv.setUint32(42, offset, true); central.set(n, 46);
      locals.push(local); centrals.push(central); offset += local.length;
    }
    const cdSize = centrals.reduce((sum, c) => sum + c.length, 0);
    const end = new Uint8Array(22); const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, centrals.length, true); ev.setUint16(10, centrals.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
    const out = new Uint8Array(offset + cdSize + 22); let at = 0;
    for (const part of [...locals, ...centrals, end]) { out.set(part, at); at += part.length; }
    return out;
  };
  const ok = zipSync({ "index.html": new TextEncoder().encode("<h1>Hi</h1>"), "about/index.html": new TextEncoder().encode("<p>About</p>") });
  const listing = E.zipEntries(ok);
  assert.equal(listing.ok, true);
  assert.deepEqual(listing.entries.map((e) => e.name).sort(), ["about/index.html", "index.html"]);
  const bad = zipSync({ "../evil.html": new Uint8Array([1]) });
  assert.equal(E.zipEntries(bad).ok, false);
  assert.equal(E.zipEntries(ok, { maxBytes: 5 }).ok, false);
});

test("onboarding migration matches the runtime schema, replays twice and creates every table", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { readFile } = await import("node:fs/promises");
  const { ONBOARDING_SCHEMA_SQL } = await import("../lib/onboarding/schema-sql.mjs");
  const migration = await readFile(new URL("../drizzle/0051_onboarding_engine.sql", import.meta.url), "utf8");
  assert.ok(migration.includes(ONBOARDING_SCHEMA_SQL.trim()), "migration file and runtime schema are the same SQL");
  const db = new DatabaseSync(":memory:");
  db.exec(migration); db.exec(migration);
  const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
  for (const table of ["onboarding_sessions", "onboarding_business_profiles", "onboarding_audits", "onboarding_usage", "onboarding_files", "onboarding_settings", "stripe_events", "stripe_invoice_links"]) assert.ok(names.has(table), table);
  // Usage limiter SQL: increments until the cap, then refuses.
  const take = (max) => db.prepare("INSERT INTO onboarding_usage (bucket, usage_date, request_count) VALUES ('audit:v:x', '2026-11-17', 1) ON CONFLICT(bucket, usage_date) DO UPDATE SET request_count = request_count + 1 WHERE request_count < ? RETURNING request_count").get(max);
  assert.equal(take(3).request_count, 1); assert.equal(take(3).request_count, 2); assert.equal(take(3).request_count, 3); assert.equal(take(3), undefined);
  // Stripe events are claimed once.
  const claim = () => db.prepare("INSERT OR IGNORE INTO stripe_events (id, owner_id, type, processed_at) VALUES ('evt_1', 'o', 'x', 'now')").run().changes;
  assert.equal(claim(), 1); assert.equal(claim(), 0);
  db.close();
});

test("website reading works without AI and AI errors never leak keys to customers", () => {
  const basics = E.extractBasicsFromHtml(`<title>Roof Repairs | Apex Roofing</title><meta name="description" content="Roof repairs &amp; flat roofs."><script type="application/ld+json">{"@graph":[{"@type":"RoofingContractor","name":"Apex Roofing","telephone":"091 123456","areaServed":["Galway","Mayo"]}]}</script>`, "https://apex.ie");
  assert.equal(basics.company, "Apex Roofing");
  assert.equal(basics.description, "Roof repairs & flat roofs.");
  assert.equal(basics.serviceAreas, "Galway, Mayo");
  assert.equal(basics.phone, "091 123456");
  const message = E.friendlyAiError("This request requires more credits, or fewer max_tokens. https://openrouter.ai/workspaces/default/keys/abc", "customer");
  assert.doesNotMatch(message, /openrouter|https?:|credit/i);
  assert.match(E.friendlyAiError("requires more credits", "agency"), /out of credit/);
});

test("Launch builds their new website from a template with their logo, colours and real photos", () => {
  const photos = E.siteImages(`<meta property="og:image" content="/hero.jpg"><img src="/logo.png"><img src="/team.jpg" width="900"><img src="/icon.jpg" width="32"><img src="/x.svg">`, "https://apex.ie");
  assert.deepEqual(photos, ["https://apex.ie/hero.jpg", "https://apex.ie/team.jpg"]);
  assert.equal(E.pickTemplate("Tattoo studio"), "luxury");
  assert.equal(E.pickTemplate("Roofing contractor"), "bold");
  assert.equal(E.pickTemplate("Dental clinic"), "professional");
  const site = E.buildPreviewSite({ answers: { businessName: "Apex Roofing", services: "Roof repairs, Flat roofs", serviceAreas: "Galway, Mayo", industry: "Roofing" }, profile: { logo: { value: "https://apex.ie/logo.png" }, primaryColour: { value: "#e4572e" } }, images: photos });
  assert.equal(site.template, "bold");
  assert.equal(site.theme.logo, "https://apex.ie/logo.png");
  assert.equal(site.theme.primary, "#e4572e");
  assert.equal(site.page.blocks[0].type, "hero");
  assert.equal(site.page.blocks[0].props.image, "https://apex.ie/hero.jpg");
  assert.equal(site.page.blocks[0].props.title, "Roof repairs in Galway");
  assert.ok(!site.page.blocks.some((b) => ["reviews", "stats"].includes(b.type)), "no invented reviews or stats");
  assert.equal(E.buildPreviewSite({ answers: { businessName: "Apex" }, template: "luxury" }).theme.font, "luxury");
});
