import { env } from "cloudflare:workers";
import { googleSearchConsoleAccessToken, hasGoogleSearchConsoleConnection, listGoogleSearchConsoleProperties } from "@/lib/google-search-console-direct";
import { decryptAiCredential } from "@/lib/ai-credentials";
import { hasGoogleAnalyticsDirectConnection, listGoogleAnalyticsProperties } from "@/lib/google-analytics-direct";
import { hostOf, matchGoogleProperties } from "@/lib/google-property-match.mjs";

// Automatic Google property linking for every active client.
// Lists the Search Console sites and GA4 properties the connected Google login can see, and fills each
// client's empty Search Console / GA4 / website field on a unique, confident match (same rules as the
// Integrations "auto-link" button). Never overwrites a field that already has a value.
// Runs from the cron (at most every 6 hours) and on demand from SEO screens (at most every 10 minutes).

const STATUS_TABLE = "CREATE TABLE IF NOT EXISTS google_autolink_status (owner_id TEXT PRIMARY KEY, ran_at TEXT NOT NULL, summary TEXT NOT NULL)";

type Client = { id: string; name?: string; status?: string; website?: string | null; wordpressSiteUrl?: string | null; email?: string | null; googleSearchConsoleAccountId?: string | null; googleAnalyticsAccountId?: string | null };
export type AutoLinkSummary = { ranAt: string; searchConsoleProperties: string[]; analyticsProperties: number; linked: Array<{ clientId: string; clientName: string; searchConsole?: string; analytics?: string; website?: string }>; stillMissing: Array<{ clientId: string; clientName: string; searchConsole: boolean; analytics: boolean; reason?: string }>; notes: string[] };


// ---------- Adding a client's domain to Search Console (verify via Cloudflare DNS) ----------
const nameKey = (v: unknown) => String(v || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "").replace(/(ltd|limited|services|service|the|ireland|galway|dublin)/g, "");

async function cloudflareDnsToken(db: D1Database, ownerId: string) {
  const secret = String((env as unknown as Record<string, string | undefined>).CLOUDFLARE_DNS_API_TOKEN || "").trim();
  if (secret) return secret;
  try {
    const row = await db.prepare("SELECT encrypted_key, key_iv FROM agency_cloudflare_dns_token WHERE owner_id = ?1").bind(ownerId).first<{ encrypted_key: string; key_iv: string }>();
    return row ? (await decryptAiCredential(row.key_iv, row.encrypted_key)).trim() : "";
  } catch { return ""; }
}

async function cfApi<T>(token: string, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, { method: init?.method || "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: init?.body === undefined ? undefined : JSON.stringify(init.body), signal: AbortSignal.timeout(15_000) });
  const json = await res.json().catch(() => null) as { success?: boolean; result?: T; errors?: Array<{ message?: string }> } | null;
  if (!res.ok || !json?.success) throw new Error(json?.errors?.[0]?.message || `Cloudflare returned ${res.status}.`);
  return json.result as T;
}

async function googleCall<T>(token: string, url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, { method: init?.method || "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: init?.body === undefined ? undefined : JSON.stringify(init.body), signal: AbortSignal.timeout(20_000) });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 403 && /insufficient|scope/i.test(text)) throw new Error("SCOPE");
    throw new Error(`Google returned ${res.status}: ${text.replace(/\s+/g, " ").slice(0, 160)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/** Verify `host` with a DNS TXT record on its Cloudflare zone, then add sc-domain:host to Search Console. */
async function addDomainToSearchConsole(googleToken: string, cfToken: string, zoneId: string, host: string) {
  const site = { type: "INET_DOMAIN", identifier: host };
  const { token } = await googleCall<{ token: string }>(googleToken, "https://www.googleapis.com/siteVerification/v1/token", { method: "POST", body: { site, verificationMethod: "DNS_TXT" } });
  const existing = await cfApi<Array<{ content: string }>>(cfToken, `/zones/${zoneId}/dns_records?type=TXT&name=${encodeURIComponent(host)}&per_page=100`);
  if (!existing.some((r) => r.content.replace(/"/g, "") === token)) {
    await cfApi(cfToken, `/zones/${zoneId}/dns_records`, { method: "POST", body: { type: "TXT", name: host, content: `"${token}"`, ttl: 1, comment: "Google Search Console verification (F2B OS)" } });
  }
  try { await googleCall(googleToken, "https://www.googleapis.com/siteVerification/v1/webResource?verificationMethod=DNS_TXT", { method: "POST", body: { site } }); }
  catch (e) { if (e instanceof Error && e.message === "SCOPE") throw e; throw new Error("DNS record added; Google hasn’t seen it yet. Will retry automatically."); }
  const property = `sc-domain:${host}`;
  await googleCall(googleToken, `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}`, { method: "PUT" });
  return property;
}

export async function lastAutoLink(db: D1Database, ownerId: string) {
  await db.prepare(STATUS_TABLE).run();
  const row = await db.prepare("SELECT ran_at, summary FROM google_autolink_status WHERE owner_id = ?1").bind(ownerId).first<{ ran_at: string; summary: string }>();
  if (!row) return null;
  try { return JSON.parse(row.summary) as AutoLinkSummary; } catch { return null; }
}

export async function autoLinkGoogleProperties(db: D1Database | undefined, minIntervalMs: number, now = new Date()): Promise<AutoLinkSummary | null> {
  if (!db) return null;
  const doc = await db.prepare("SELECT owner_id, updated_at, json_extract(data, '$.clients') AS clients FROM workspace_documents WHERE id = 'f2b-agency'").first<{ owner_id: string; updated_at: string; clients: string }>();
  if (!doc) return null;
  const ownerId = doc.owner_id;
  const previous = await lastAutoLink(db, ownerId);
  if (previous && now.getTime() - Date.parse(previous.ranAt) < minIntervalMs) return previous;

  let clients: Client[] = [];
  try { clients = JSON.parse(doc.clients || "[]"); } catch { clients = []; }
  const notes: string[] = [];
  let gsc: Array<{ id: string }> = [];
  let ga4: Array<{ id: string; name: string; accountName: string }> = [];
  if (await hasGoogleSearchConsoleConnection(ownerId)) {
    try { gsc = await listGoogleSearchConsoleProperties(ownerId); } catch (e) { notes.push(e instanceof Error ? e.message : "Search Console properties could not be listed."); }
  } else notes.push("Search Console isn’t connected.");
  if (await hasGoogleAnalyticsDirectConnection(ownerId)) {
    try { ga4 = await listGoogleAnalyticsProperties(ownerId); } catch (e) { notes.push(e instanceof Error ? e.message : "GA4 properties could not be listed."); }
  } else notes.push("Google Analytics isn’t connected.");

  const active = clients.filter((c) => c?.id && !/inactive|paused|archived|lost/i.test(String(c.status || "")));
  const matches = matchGoogleProperties(active, gsc, ga4) as AutoLinkSummary["linked"];

  // Write each match with json_set on that client's own fields only, guarded by "still empty",
  // so nothing a person typed is ever replaced and the rest of the workspace is untouched.
  const linked: AutoLinkSummary["linked"] = [];
  for (const match of matches) {
    const index = clients.findIndex((c) => c.id === match.clientId);
    if (index < 0) continue;
    const base = `$.clients[${index}]`;
    const sets: string[] = []; const binds: string[] = []; const guards: string[] = [];
    const add = (field: string, value?: string) => {
      if (!value) return;
      binds.push(value);
      sets.push(`'${base}.${field}', ?${binds.length}`);
      guards.push(`COALESCE(json_extract(data, '${base}.${field}'), '') = ''`);
    };
    add("googleSearchConsoleAccountId", match.searchConsole);
    add("googleAnalyticsAccountId", match.analytics);
    add("wordpressSiteUrl", match.website);
    if (!sets.length) continue;
    binds.push(match.clientId);
    const idParam = binds.length;
    binds.push(`google-autolink-${crypto.randomUUID()}`);
    const stampParam = binds.length;
    // Apply each field separately so one already-filled field doesn't block the others.
    for (let i = 0; i < sets.length; i++) {
      const res = await db.prepare(`UPDATE workspace_documents SET data = json_set(data, ${sets[i]}), updated_at = ?${stampParam} WHERE id = 'f2b-agency' AND json_extract(data, '${base}.id') = ?${idParam} AND ${guards[i]}`).bind(...binds).run();
      if (!res.meta?.changes) continue;
      const field = sets[i].includes("googleSearchConsoleAccountId") ? "searchConsole" : sets[i].includes("googleAnalyticsAccountId") ? "analytics" : "website";
      const entry = linked.find((l) => l.clientId === match.clientId) || (linked.push({ clientId: match.clientId, clientName: match.clientName }), linked[linked.length - 1]);
      entry[field] = match[field];
    }
  }

  // Clients whose site isn't in Search Console at all: add + verify it when its domain is on Cloudflare.
  const reasons = new Map<string, string>();
  const gscHosts = new Set(gsc.map((p) => String(p.id).replace(/^sc-domain:/, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase()));
  const linkedIds = new Set(linked.filter((l) => l.searchConsole).map((l) => l.clientId));
  const needing = active.filter((c) => !String(c.googleSearchConsoleAccountId || "").trim() && !linkedIds.has(c.id));
  if (needing.length && await hasGoogleSearchConsoleConnection(ownerId)) {
    const cfToken = await cloudflareDnsToken(db, ownerId);
    let zones: Array<{ id: string; name: string }> = [];
    if (cfToken) { try { zones = await cfApi(cfToken, "/zones?per_page=100&status=active"); } catch (e) { notes.push(`Cloudflare zones couldn’t be listed: ${e instanceof Error ? e.message : "error"}`); } }
    let googleToken = "";
    try { googleToken = await googleSearchConsoleAccessToken(ownerId); } catch (e) { notes.push(e instanceof Error ? e.message : "Google access failed."); }
    let scopeMissing = false;
    for (const client of needing) {
      const siteHost = hostOf(client.wordpressSiteUrl || client.website || "");
      const mailHost = String(client.email || "").includes("@") ? String(client.email).split("@")[1].toLowerCase() : hostOf(client.email || "");
      let zone = zones.find((z) => z.name === siteHost) || (siteHost ? zones.find((z) => siteHost.endsWith(`.${z.name}`)) : undefined) || zones.find((z) => z.name === mailHost);
      if (!zone && !siteHost) {
        const k = nameKey(client.name);
        const byName = k.length >= 4 ? zones.filter((z) => nameKey(z.name.split(".")[0]).includes(k) || (nameKey(z.name.split(".")[0]).length >= 5 && k.includes(nameKey(z.name.split(".")[0])))) : [];
        const roots = [...new Set(byName.map((z) => z.name.split(".")[0]))];
        if (byName.length === 1) zone = byName[0];
        else if (roots.length === 1 && byName.length > 1) { reasons.set(client.id, `More than one domain matches (${byName.map((z) => z.name).join(", ")}). Add the client’s website to pick one.`); continue; }
      }
      const host = zone ? zone.name : siteHost;
      if (!host) { reasons.set(client.id, "No website on this client yet."); continue; }
      if (gscHosts.has(host)) continue;
      if (!zone) { reasons.set(client.id, `${host} isn’t in Search Console and its DNS isn’t on Cloudflare, so it can’t be verified automatically. Add it in Search Console under the connected Google login.`); continue; }
      if (!cfToken) { reasons.set(client.id, "Cloudflare DNS token missing."); continue; }
      if (!googleToken || scopeMissing) { reasons.set(client.id, scopeMissing ? "Reconnect Search Console once so the OS can add and verify sites." : "Google access unavailable."); continue; }
      try {
        const property = await addDomainToSearchConsole(googleToken, cfToken, zone.id, host);
        const index = clients.findIndex((c) => c.id === client.id);
        const base = `$.clients[${index}]`;
        const res = await db.prepare(`UPDATE workspace_documents SET data = json_set(data, '${base}.googleSearchConsoleAccountId', ?1), updated_at = ?3 WHERE id = 'f2b-agency' AND json_extract(data, '${base}.id') = ?2 AND COALESCE(json_extract(data, '${base}.googleSearchConsoleAccountId'), '') = ''`).bind(property, client.id, `google-autolink-${crypto.randomUUID()}`).run();
        if (res.meta?.changes) linked.push({ clientId: client.id, clientName: client.name || "Client", searchConsole: property });
        gscHosts.add(host);
      } catch (e) {
        if (e instanceof Error && e.message === "SCOPE") { scopeMissing = true; reasons.set(client.id, "Reconnect Search Console once so the OS can add and verify sites."); }
        else reasons.set(client.id, e instanceof Error ? e.message.slice(0, 200) : "Couldn’t add the site to Search Console.");
      }
    }
    if (scopeMissing) notes.push("Search Console was connected read-only. Reconnect it once to let the OS add and verify client sites.");
  }

  // Report who still has nothing linked, so the OS can show exactly what's missing.
  const after = await db.prepare("SELECT json_extract(data, '$.clients') AS clients FROM workspace_documents WHERE id = 'f2b-agency'").first<{ clients: string }>();
  let fresh: Client[] = [];
  try { fresh = JSON.parse(after?.clients || "[]"); } catch { fresh = active; }
  const stillMissing = fresh.filter((c) => c?.id && !/inactive|paused|archived|lost/i.test(String(c.status || "")))
    .map((c) => ({ clientId: c.id, clientName: c.name || "Client", searchConsole: !String(c.googleSearchConsoleAccountId || "").trim(), analytics: !String(c.googleAnalyticsAccountId || "").trim(), ...(reasons.get(c.id) ? { reason: reasons.get(c.id) } : {}) }))
    .filter((c) => c.searchConsole || c.analytics);

  const summary: AutoLinkSummary = { ranAt: now.toISOString(), searchConsoleProperties: gsc.map((p) => p.id), analyticsProperties: ga4.length, linked, stillMissing, notes };
  await db.prepare("INSERT INTO google_autolink_status (owner_id, ran_at, summary) VALUES (?1, ?2, ?3) ON CONFLICT(owner_id) DO UPDATE SET ran_at = excluded.ran_at, summary = excluded.summary").bind(ownerId, summary.ranAt, JSON.stringify(summary)).run();
  return summary;
}
