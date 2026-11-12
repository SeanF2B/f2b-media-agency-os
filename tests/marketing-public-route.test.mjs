import assert from "node:assert/strict";
import test from "node:test";
import { build } from "../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const publishedData = {
  heading: "Request a roofing quote",
  description: "Tell us how we can help.",
  seoTitle: "Roofing Quote | Example Roofing",
  seoDescription: "Request a roofing quote.",
  fields: [{ id: "email", label: "Email address", type: "email", required: true, options: [] }],
  sections: [],
  allowedDomains: ["https://client.example"],
  design: { brandColor: "#1877bd", backgroundColor: "#f5f7fa", textColor: "#18212f", fontFamily: "system", contentWidth: 760 },
  submitLabel: "Request a quote",
  currency: "EUR",
};

function asset(data = publishedData, overrides = {}) {
  return {
    id: "asset-12345678", owner_id: "owner-1", client_id: null, kind: "form", name: "Roofing quote",
    slug: "roofing-quote", status: "published", version: 3, data: JSON.stringify(data), ...overrides,
  };
}

class TestD1 {
  constructor(publishedAsset = asset()) { this.publishedAsset = publishedAsset; this.calls = []; }
  prepare(sql) {
    let values = [];
    const query = {
      sql,
      get values() { return values; },
      bind(...nextValues) { values = nextValues; return query; },
      first: async () => {
        this.calls.push({ method: "first", sql, values });
        if (sql.includes("FROM marketing_assets WHERE slug")) return this.publishedAsset;
        if (sql.includes("INSERT INTO marketing_submission_rate_limits")) return { request_count: 1 };
        return null;
      },
      run: async () => { this.calls.push({ method: "run", sql, values }); return { meta: { changes: 1 } }; },
      all: async () => { this.calls.push({ method: "all", sql, values }); return { results: [] }; },
    };
    return query;
  }
}

async function loadRoute() {
  const temp = await mkdtemp(path.join(os.tmpdir(), "f2b-marketing-public-route-"));
  const outfile = path.join(temp, "public-route.mjs");
  const mocks = {
    "cloudflare:workers": "export const env = globalThis.__marketingPublicTestEnv;",
    "marketing-automations": "export const enqueueMarketingAutomations = async () => ({ queued: 0 });",
    "gohighlevel-oauth": "export const getGhlLocationAccessToken = async () => { throw new Error('unexpected GoHighLevel call'); };",
  };
  await build({
    entryPoints: [path.resolve("app/api/marketing-public/route.ts")], outfile, bundle: true, platform: "node", format: "esm", target: "node24",
    plugins: [{ name: "marketing-public-route-mocks", setup(api) {
      api.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "cloudflare:workers", namespace: "marketing-public-test" }));
      api.onResolve({ filter: /marketing-automations/ }, () => ({ path: "marketing-automations", namespace: "marketing-public-test" }));
      api.onResolve({ filter: /gohighlevel-oauth/ }, () => ({ path: "gohighlevel-oauth", namespace: "marketing-public-test" }));
      api.onLoad({ filter: /.*/, namespace: "marketing-public-test" }, (args) => ({ contents: mocks[args.path], loader: "js" }));
    } }],
  });
  const route = await import(`${pathToFileURL(outfile).href}?test=${Date.now()}`);
  return { route, dispose: () => rm(temp, { recursive: true, force: true }) };
}

test("published public form renders crawlable content and records a page view for its owner", async () => {
  const db = new TestD1();
  globalThis.__marketingPublicTestEnv = { DB: db };
  const isolated = await loadRoute();
  try {
    const response = await isolated.route.GET(new Request("https://crm.example.test/api/marketing-public?slug=roofing-quote"));
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.match(html, /<h1>Request a roofing quote<\/h1>/);
    assert.match(html, /Tell us how we can help/);
    assert.match(html, /name="email"/);
    const pageView = db.calls.find((call) => call.sql.includes("INSERT INTO marketing_daily_analytics") && call.values[3] === undefined);
    assert.ok(pageView);
    assert.equal(pageView.values[0], "owner-1");
    assert.equal(pageView.values[1], "asset-12345678");
  } finally {
    delete globalThis.__marketingPublicTestEnv;
    await isolated.dispose();
  }
});

test("public submission saves validated answers and metrics under the published asset owner", async () => {
  const db = new TestD1();
  globalThis.__marketingPublicTestEnv = { DB: db };
  const isolated = await loadRoute();
  try {
    const response = await isolated.route.POST(new Request("https://crm.example.test/api/marketing-public?slug=roofing-quote", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "email=lead%40example.test",
    }));
    assert.equal(response.status, 303);
    assert.match(response.headers.get("location"), /submitted=1/);
    const submission = db.calls.find((call) => call.sql.includes("INSERT INTO marketing_submissions"));
    assert.ok(submission);
    assert.equal(submission.values[1], "owner-1");
    assert.equal(submission.values[2], "asset-12345678");
    const finalSubmission = db.calls.find((call) => call.sql.includes("UPDATE marketing_submissions SET data"));
    assert.ok(finalSubmission);
    assert.equal(finalSubmission.values[2], "owner-1");
    const saved = JSON.parse(finalSubmission.values[0]);
    assert.equal(saved.values.email, "lead@example.test");
    assert.equal(saved.contactSync.status, "not_linked");
    const metric = db.calls.find((call) => call.sql.includes("INSERT INTO marketing_daily_analytics") && call.values[3] === undefined);
    assert.ok(metric);
    assert.equal(metric.values[0], "owner-1");
    assert.equal(metric.values[1], "asset-12345678");
  } finally {
    delete globalThis.__marketingPublicTestEnv;
    await isolated.dispose();
  }
});

test("required-field and allowed-origin failures do not create public submissions", async () => {
  const db = new TestD1();
  globalThis.__marketingPublicTestEnv = { DB: db };
  const isolated = await loadRoute();
  try {
    const missingRequired = await isolated.route.POST(new Request("https://crm.example.test/api/marketing-public?slug=roofing-quote", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "",
    }));
    assert.equal(missingRequired.status, 200);
    assert.match(await missingRequired.text(), /Please complete all required fields/);
    assert.equal(db.calls.some((call) => call.sql.includes("INSERT INTO marketing_submissions")), false);

    const disallowedOrigin = await isolated.route.POST(new Request("https://crm.example.test/api/marketing-public?slug=roofing-quote", {
      method: "POST", headers: { origin: "https://attacker.example", "content-type": "application/x-www-form-urlencoded" }, body: "email=lead%40example.test",
    }));
    assert.equal(disallowedOrigin.status, 403);
    assert.equal(db.calls.some((call) => call.sql.includes("INSERT INTO marketing_submissions")), false);
  } finally {
    delete globalThis.__marketingPublicTestEnv;
    await isolated.dispose();
  }
});

test("unpublished slugs cannot be read as customer pages", async () => {
  const db = new TestD1(null);
  globalThis.__marketingPublicTestEnv = { DB: db };
  const isolated = await loadRoute();
  try {
    const response = await isolated.route.GET(new Request("https://crm.example.test/api/marketing-public?slug=draft-only"));
    assert.equal(response.status, 404);
    assert.match((await response.json()).error, /not be found/);
    assert.equal(db.calls.some((call) => call.sql.includes("INSERT INTO marketing_daily_analytics")), false);
  } finally {
    delete globalThis.__marketingPublicTestEnv;
    await isolated.dispose();
  }
});
