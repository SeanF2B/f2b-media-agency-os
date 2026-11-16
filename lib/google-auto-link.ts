import { hasGoogleSearchConsoleConnection, listGoogleSearchConsoleProperties } from "@/lib/google-search-console-direct";
import { hasGoogleAnalyticsDirectConnection, listGoogleAnalyticsProperties } from "@/lib/google-analytics-direct";
import { matchGoogleProperties } from "@/lib/google-property-match.mjs";

// Automatic Google property linking for every active client.
// Lists the Search Console sites and GA4 properties the connected Google login can see, and fills each
// client's empty Search Console / GA4 / website field on a unique, confident match (same rules as the
// Integrations "auto-link" button). Never overwrites a field that already has a value.
// Runs from the cron (at most every 6 hours) and on demand from SEO screens (at most every 10 minutes).

const STATUS_TABLE = "CREATE TABLE IF NOT EXISTS google_autolink_status (owner_id TEXT PRIMARY KEY, ran_at TEXT NOT NULL, summary TEXT NOT NULL)";

type Client = { id: string; name?: string; status?: string; website?: string | null; wordpressSiteUrl?: string | null; email?: string | null; googleSearchConsoleAccountId?: string | null; googleAnalyticsAccountId?: string | null };
export type AutoLinkSummary = { ranAt: string; searchConsoleProperties: string[]; analyticsProperties: number; linked: Array<{ clientId: string; clientName: string; searchConsole?: string; analytics?: string; website?: string }>; stillMissing: Array<{ clientId: string; clientName: string; searchConsole: boolean; analytics: boolean }>; notes: string[] };

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

  // Report who still has nothing linked, so the OS can show exactly what's missing.
  const after = await db.prepare("SELECT json_extract(data, '$.clients') AS clients FROM workspace_documents WHERE id = 'f2b-agency'").first<{ clients: string }>();
  let fresh: Client[] = [];
  try { fresh = JSON.parse(after?.clients || "[]"); } catch { fresh = active; }
  const stillMissing = fresh.filter((c) => c?.id && !/inactive|paused|archived|lost/i.test(String(c.status || "")))
    .map((c) => ({ clientId: c.id, clientName: c.name || "Client", searchConsole: !String(c.googleSearchConsoleAccountId || "").trim(), analytics: !String(c.googleAnalyticsAccountId || "").trim() }))
    .filter((c) => c.searchConsole || c.analytics);

  const summary: AutoLinkSummary = { ranAt: now.toISOString(), searchConsoleProperties: gsc.map((p) => p.id), analyticsProperties: ga4.length, linked, stillMissing, notes };
  await db.prepare("INSERT INTO google_autolink_status (owner_id, ran_at, summary) VALUES (?1, ?2, ?3) ON CONFLICT(owner_id) DO UPDATE SET ran_at = excluded.ran_at, summary = excluded.summary").bind(ownerId, summary.ranAt, JSON.stringify(summary)).run();
  return summary;
}
