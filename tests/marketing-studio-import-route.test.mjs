import assert from "node:assert/strict";
import test from "node:test";
import { build } from "../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const workspace = {
  ownerId: "owner-1",
  staff: [],
  clients: [{ id: "client-1", wordpressSiteUrl: "https://www.example.com", services: [{ landingPageUrl: "https://offers.example.com/roofing" }] }],
};

class TestD1 {
  prepare() {
    return { first: async () => ({ data: JSON.stringify(workspace) }) };
  }
}

async function loadRoute() {
  const temp = await mkdtemp(path.join(os.tmpdir(), "f2b-marketing-import-route-"));
  const outfile = path.join(temp, "import-route.mjs");
  const mocks = {
    "cloudflare:workers": "export const env = globalThis.__marketingImportTestEnv;",
    "../../../chatgpt-auth": "export const getChatGPTUser = async () => ({ userId: 'owner-1', email: 'owner@example.test' });",
  };
  await build({
    entryPoints: [path.resolve("app/api/marketing-studio/import/route.ts")], outfile, bundle: true, platform: "node", format: "esm", target: "node24",
    plugins: [{ name: "marketing-import-route-mocks", setup(api) {
      api.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "cloudflare:workers", namespace: "marketing-import-test" }));
      api.onResolve({ filter: /chatgpt-auth/ }, () => ({ path: "../../../chatgpt-auth", namespace: "marketing-import-test" }));
      api.onLoad({ filter: /.*/, namespace: "marketing-import-test" }, (args) => ({ contents: mocks[args.path], loader: "js" }));
    } }],
  });
  const route = await import(`${pathToFileURL(outfile).href}?test=${Date.now()}`);
  return { route, dispose: () => rm(temp, { recursive: true, force: true }) };
}

function request(url = "https://www.example.com/landing", clientId = "client-1") {
  return new Request("https://crm.example.test/api/marketing-studio/import", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ clientId, url }),
  });
}

test("website import extracts page text and removes active script content", async () => {
  globalThis.__marketingImportTestEnv = { DB: new TestD1() };
  const originalFetch = globalThis.fetch;
  const isolated = await loadRoute();
  let fetched;
  globalThis.fetch = async (url, init) => {
    fetched = { url: String(url), init };
    return new Response('<html><head><title>Roofing quote</title><meta name="description" content="Get a quote"></head><body><h1>Book a roof inspection</h1><script>stealCookies()</script><form>secret form text</form><p>We reply within one day.</p></body></html>', { headers: { "content-type": "text/html; charset=utf-8" } });
  };
  try {
    const response = await isolated.route.POST(request());
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(fetched.url, "https://www.example.com/landing");
    assert.equal(fetched.init.redirect, "manual");
    assert.equal(body.source.title, "Roofing quote");
    assert.equal(body.source.description, "Get a quote");
    assert.match(body.source.text, /Book a roof inspection/);
    assert.match(body.source.text, /We reply within one day/);
    assert.doesNotMatch(body.source.text, /stealCookies|secret form text/);
    assert.equal(body.sourceUrl, "https://www.example.com/landing");
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__marketingImportTestEnv;
    await isolated.dispose();
  }
});

test("website import rejects a domain that is not saved on the selected client", async () => {
  globalThis.__marketingImportTestEnv = { DB: new TestD1() };
  const originalFetch = globalThis.fetch;
  const isolated = await loadRoute();
  let fetchCalled = false;
  globalThis.fetch = async () => { fetchCalled = true; throw new Error("must not fetch"); };
  try {
    const response = await isolated.route.POST(request("https://attacker.example/landing"));
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.match(body.error, /domain already saved/);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__marketingImportTestEnv;
    await isolated.dispose();
  }
});

test("website import stops cross-domain redirects and rejects unsafe URLs", async () => {
  globalThis.__marketingImportTestEnv = { DB: new TestD1() };
  const originalFetch = globalThis.fetch;
  const isolated = await loadRoute();
  let fetchCount = 0;
  globalThis.fetch = async () => { fetchCount++; return new Response(null, { status: 302, headers: { location: "https://evil.example/landing" } }); };
  try {
    const redirected = await isolated.route.POST(request("https://example.com/landing"));
    const redirectBody = await redirected.json();
    assert.equal(redirected.status, 502);
    assert.match(redirectBody.error, /different domain/);
    assert.equal(fetchCount, 1);

    const countBeforeUnsafe = fetchCount;
    const unsafe = await isolated.route.POST(request("http://127.0.0.1/admin"));
    assert.equal(unsafe.status, 400);
    assert.equal(fetchCount, countBeforeUnsafe);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__marketingImportTestEnv;
    await isolated.dispose();
  }
});
