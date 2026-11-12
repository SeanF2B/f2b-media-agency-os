import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function createWorker() {
  const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  const listeners = new Map();
  const store = new Map();
  const caches = {
    async open() {
      return { async put(key, value) { store.set(typeof key === "string" ? key : key.url, value); } };
    },
    async match(key) { return store.get(typeof key === "string" ? key : key.url); },
    async keys() { return []; },
  };
  let networkFetch = async () => {
    const response = new Response("online", { status: 200, headers: { "content-type": "text/html" } });
    Object.defineProperty(response, "url", { value: "https://agency.example/" });
    return response;
  };
  const self = {
    location: new URL("https://agency.example/"),
    clients: { async claim() {} },
    skipWaiting: async () => {},
    addEventListener(name, listener) { listeners.set(name, listener); },
  };
  vm.runInNewContext(source, { self, caches, URL, Response, fetch: (...args) => networkFetch(...args) });
  return {
    store,
    setFetch(fn) { networkFetch = fn; },
    async fetch(request) {
      let responsePromise;
      listeners.get("fetch")({ request, respondWith(value) { responsePromise = value; } });
      return { handled: responsePromise !== undefined, response: responsePromise ? await responsePromise : null };
    },
  };
}

test("offline service worker caches the generic app shell and restores it after a network failure", async () => {
  const worker = await createWorker();
  const page = { url: "https://agency.example/", method: "GET", mode: "navigate" };
  const online = (await worker.fetch(page)).response;
  assert.equal(await online.text(), "online");
  assert.equal(worker.store.has("https://agency.example/?app-shell-version=5"), true);

  worker.setFetch(async () => { throw new TypeError("offline"); });
  const restored = (await worker.fetch(page)).response;
  assert.equal(await restored.text(), "online");
});

test("workspace APIs are never intercepted or cached", async () => {
  const worker = await createWorker();
  const result = await worker.fetch({ url: "https://agency.example/api/workspace", method: "GET", mode: "cors" });
  assert.equal(result.handled, false);
  assert.equal(result.response, null);
  assert.equal(worker.store.size, 0);
});

