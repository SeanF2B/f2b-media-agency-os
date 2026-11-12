import test from "node:test";
import assert from "node:assert/strict";
import { countMappedWordPressClients } from "../lib/integration-site-mapping.ts";

test("WordPress mapping counts only exact configured client sites in shared or direct connections", () => {
  const clients = [
    { id: "client-1", wordpressSiteUrl: "https://www.example.ie/services/" },
    { id: "client-2", wordpressSiteUrl: "https://aldohandyman.ie" },
    { id: "client-3", wordpressSiteUrl: "https://unconnected.example" },
    { id: "client-4", wordpressSiteUrl: "not a url" },
    { id: "client-5" },
  ];
  const directConnections = [
    { client_id: "client-1", site_url: "https://example.ie" },
    { client_id: "client-3", site_url: "https://different.example" },
  ];
  const sharedSites = [{ url: "https://aldohandyman.ie/" }];

  assert.equal(countMappedWordPressClients(clients, directConnections, sharedSites), 2);
});

test("similar but different subdomains are not treated as the same WordPress site", () => {
  assert.equal(countMappedWordPressClients(
    [{ id: "client-1", wordpressSiteUrl: "https://blog.example.ie" }],
    [],
    [{ url: "https://example.ie" }],
  ), 0);
});
