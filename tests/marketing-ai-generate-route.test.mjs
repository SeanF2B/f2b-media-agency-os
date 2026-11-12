import test from "node:test";
import assert from "node:assert/strict";
import { build } from "../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

class TestD1 {
  prepare(sql) {
    const query = {
      bind: (...values) => { query.values = values; return query; },
      first: async () => sql.includes("workspace_documents") ? { data: JSON.stringify({ ownerId: "owner-1", staff: [] }) } : null,
      run: async () => ({ meta: { changes: 1 } }),
    };
    return query;
  }
}

const field = (overrides) => ({
  id: "field-1", label: "Question", type: "text", required: false, step: 1, options: [], pricePerUnit: 0,
  rateTiers: [], unitLabel: "", showWhen: null, priceWhen: null, calculation: null, contactField: "auto", ...overrides,
});

function output(fields, sections = []) {
  return {
    heading: "A clear next step", description: "", submitLabel: "Continue", currency: "EUR",
    design: { brandColor: "#1877bd", backgroundColor: "#f5f7fa", textColor: "#18212f", fontFamily: "system", contentWidth: 760 },
    sections, fields, nodes: [],
  };
}

async function loadRoute() {
  const temp = await mkdtemp(path.join(os.tmpdir(), "f2b-marketing-ai-route-"));
  const outfile = path.join(temp, "generate-route.mjs");
  const mocks = {
    "cloudflare:workers": "export const env = globalThis.__marketingAiTestEnv;",
    "../../../chatgpt-auth": "export const getChatGPTUser = async () => ({ userId: 'owner-1', email: 'owner@example.test' });",
  };
  await build({
    entryPoints: [path.resolve("app/api/marketing-studio/generate/route.ts")], outfile, bundle: true, platform: "node", format: "esm", target: "node24",
    plugins: [{ name: "marketing-ai-route-mocks", setup(api) {
      api.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "cloudflare:workers", namespace: "marketing-ai-test" }));
      api.onResolve({ filter: /chatgpt-auth/ }, () => ({ path: "../../../chatgpt-auth", namespace: "marketing-ai-test" }));
      api.onLoad({ filter: /.*/, namespace: "marketing-ai-test" }, (args) => ({ contents: mocks[args.path], loader: "js" }));
    } }],
  });
  const route = await import(`${pathToFileURL(outfile).href}?test=${Date.now()}`);
  return { route, dispose: () => rm(temp, { recursive: true, force: true }) };
}

test("AI survey route preserves branching and visibility while zeroing every generated option price", async () => {
  globalThis.__marketingAiTestEnv = { DB: new TestD1(), OPENAI_API_KEY: "test-key" };
  let requestPayload;
  const originalFetch = globalThis.fetch;
  const isolated = await loadRoute();
  globalThis.fetch = async (_url, init) => {
    requestPayload = JSON.parse(init.body);
    return Response.json({ output_text: JSON.stringify(output([
      field({ id: "property", label: "Property type", type: "radio", step: 1, options: [{ label: "Home", value: "home", price: 999, nextStep: 2 }, { label: "Business", value: "business", price: 1200, nextStep: 3 }] }),
      field({ id: "bedrooms", label: "Bedrooms", type: "number", step: 2, showWhen: { mode: "and", conditions: [{ fieldId: "property", operator: "equals", value: "home" }] } }),
      field({ id: "employees", label: "Employees", type: "number", step: 3, showWhen: { mode: "or", conditions: [{ fieldId: "property", operator: "equals", value: "business" }] } }),
    ])) });
  };
  try {
    const response = await isolated.route.POST(new Request("https://crm.example.test/api/marketing-studio/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "survey", prompt: "Route home owners and businesses to different questions." }) }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(requestPayload.text.format.strict, true);
    assert.ok(requestPayload.text.format.schema.properties.fields.items.required.includes("step"));
    assert.ok(requestPayload.text.format.schema.properties.fields.items.properties.showWhen);
    assert.equal(body.data.fields[0].options[0].nextStep, 2);
    assert.equal(body.data.fields[0].options[0].price, 0);
    assert.deepEqual(body.data.fields[2].showWhen, { mode: "or", conditions: [{ fieldId: "property", operator: "equals", value: "business" }] });
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__marketingAiTestEnv;
    isolated.dispose();
  }
});

test("AI calculator route retains tiered and conditional rules at zero prices and rejects invalid survey branches", async () => {
  globalThis.__marketingAiTestEnv = { DB: new TestD1(), OPENAI_API_KEY: "test-key" };
  const originalFetch = globalThis.fetch;
  const isolated = await loadRoute();
  let result;
  globalThis.fetch = async () => Response.json({ output_text: JSON.stringify(output([
    field({ id: "service", label: "Service", type: "select", options: [{ label: "Standard", value: "standard", price: 500 }] }),
    field({ id: "area", label: "Area", type: "number", pricePerUnit: 50, rateTiers: [{ upTo: 10, pricePerUnit: 75 }, { upTo: null, pricePerUnit: 50 }], priceWhen: { mode: "and", conditions: [{ fieldId: "service", operator: "equals", value: "standard" }] } }),
  ])) });
  try {
    const calculatorResponse = await isolated.route.POST(new Request("https://crm.example.test/api/marketing-studio/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "calculator", prompt: "Build a progressive area estimate." }) }));
    result = await calculatorResponse.json();
    assert.equal(calculatorResponse.status, 200);
    assert.equal(result.data.fields[0].options[0].price, 0);
    assert.deepEqual(result.data.fields[1].rateTiers, [{ upTo: 10, pricePerUnit: 0 }, { pricePerUnit: 0 }]);
    assert.deepEqual(result.data.fields[1].priceWhen, { mode: "and", conditions: [{ fieldId: "service", operator: "equals", value: "standard" }] });

    globalThis.fetch = async () => Response.json({ output_text: JSON.stringify(output([
      field({ id: "first", label: "First", type: "radio", step: 1, options: [{ label: "Next", value: "next", nextStep: 3 }] }),
      field({ id: "second", label: "Second", type: "text", step: 2 }),
    ])) });
    const surveyResponse = await isolated.route.POST(new Request("https://crm.example.test/api/marketing-studio/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "survey", prompt: "Make a valid survey." }) }));
    const survey = await surveyResponse.json();
    assert.equal(surveyResponse.status, 422);
    assert.match(survey.error, /existing later step/);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__marketingAiTestEnv;
    isolated.dispose();
  }
});

test("AI funnel route generates editable section rules and rejects references to unknown questions", async () => {
  globalThis.__marketingAiTestEnv = { DB: new TestD1(), OPENAI_API_KEY: "test-key" };
  const originalFetch = globalThis.fetch;
  const isolated = await loadRoute();
  const section = (fieldId) => ({ type: "text", heading: "Relevant details", body: "Only show this when the answer matches.", showWhen: { mode: "and", conditions: [{ fieldId, operator: "equals", value: "roofing" }] }, imageUrl: "", imageAlt: "", buttonLabel: "Learn more", buttonUrl: "", style: {}, layout: "stack", columns: [], children: [] });
  try {
    let requestPayload;
    globalThis.fetch = async (_url, init) => {
      requestPayload = JSON.parse(init.body);
      return Response.json({ output_text: JSON.stringify(output([field({ id: "service", label: "Service", type: "select", options: [{ label: "Roofing", value: "roofing" }] })], [section("service")])) });
    };
    const response = await isolated.route.POST(new Request("https://crm.example.test/api/marketing-studio/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "funnel", prompt: "Show relevant details based on service selection." }) }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.ok(requestPayload.text.format.schema.properties.sections.items.properties.showWhen);
    assert.ok(requestPayload.text.format.schema.properties.sections.items.properties.children.items.properties.showWhen);
    assert.deepEqual(body.data.sections[0].showWhen, { mode: "and", conditions: [{ fieldId: "service", operator: "equals", value: "roofing" }] });

    globalThis.fetch = async () => Response.json({ output_text: JSON.stringify(output([field({ id: "service" })], [section("missing-question")])) });
    const invalidResponse = await isolated.route.POST(new Request("https://crm.example.test/api/marketing-studio/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "funnel", prompt: "Create a conditional block." }) }));
    const invalidBody = await invalidResponse.json();
    assert.equal(invalidResponse.status, 422);
    assert.match(invalidBody.error, /missing condition question/);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__marketingAiTestEnv;
    isolated.dispose();
  }
});

test("AI screenshot request sends the image as visual input and returns an editable draft without publishing", async () => {
  globalThis.__marketingAiTestEnv = { DB: new TestD1(), OPENAI_API_KEY: "test-key" };
  const originalFetch = globalThis.fetch;
  const isolated = await loadRoute();
  const screenshot = "data:image/png;base64,iVBORw0KGgo=";
  let requestPayload;
  globalThis.fetch = async (_url, init) => {
    requestPayload = JSON.parse(init.body);
    return Response.json({ output_text: JSON.stringify(output([field({ id: "email", label: "Email", type: "email" })], [{ type: "hero", heading: "Roofing quote", body: "Tell us about the job.", showWhen: null, imageUrl: "https://untrusted.example/image.png", imageAlt: "", buttonLabel: "Continue", buttonUrl: "https://untrusted.example", style: {}, layout: "stack", columns: [], children: [] }])) });
  };
  try {
    const response = await isolated.route.POST(new Request("https://crm.example.test/api/marketing-studio/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "funnel", prompt: "Use the screenshot as a layout reference.", imageDataUrl: screenshot }) }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(requestPayload.store, false);
    assert.equal(requestPayload.input[0].content.find((item) => item.type === "input_image").image_url, screenshot);
    assert.equal(body.data.heading, "A clear next step");
    assert.equal(body.data.sections[0].heading, "Roofing quote");
    assert.equal(body.data.sections[0].imageUrl, "");
    assert.equal(body.data.sections[0].buttonUrl, "");
    assert.equal(body.data.status, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__marketingAiTestEnv;
    isolated.dispose();
  }
});
