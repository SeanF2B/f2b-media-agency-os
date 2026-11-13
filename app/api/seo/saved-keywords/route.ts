import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getGoogleAdsKeywordHistoricalMetrics, suggestGoogleAdsGeoTargets } from "@/lib/google-ads-direct";

// Saved keywords and keyword groups, per client.
// One row per client + keyword + location + language (duplicates are merged, never stored twice).
// Every read is an indexed lookup on (owner_id, client_id) — no table scans.

export const dynamic = "force-dynamic";
const respond = (error: string, status = 400) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

const KEYWORDS_SQL = `CREATE TABLE IF NOT EXISTS seo_saved_keywords (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, client_id TEXT NOT NULL, keyword TEXT NOT NULL, keyword_norm TEXT NOT NULL,
  location TEXT NOT NULL, geo TEXT NOT NULL DEFAULT '', language TEXT NOT NULL DEFAULT 'English', group_id TEXT, tags TEXT NOT NULL DEFAULT '[]',
  avg_monthly_searches INTEGER, competition TEXT, competition_index INTEGER, low_bid REAL, high_bid REAL, difficulty INTEGER,
  source TEXT NOT NULL DEFAULT '', metrics_source TEXT NOT NULL DEFAULT '', last_checked_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (owner_id, client_id, keyword_norm, location, language))`;
const GROUPS_SQL = `CREATE TABLE IF NOT EXISTS seo_keyword_groups (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, client_id TEXT NOT NULL, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  UNIQUE (owner_id, client_id, name))`;
let tablesReady = false;
async function ensureTables(db: D1Database) {
  if (tablesReady) return;
  await db.batch([
    db.prepare(KEYWORDS_SQL), db.prepare(GROUPS_SQL),
    db.prepare("CREATE INDEX IF NOT EXISTS seo_saved_keywords_client ON seo_saved_keywords (owner_id, client_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS seo_keyword_groups_client ON seo_keyword_groups (owner_id, client_id)"),
  ]);
  tablesReady = true;
}

const TAGS = ["SEO", "Google Ads", "Priority", "Negative"] as const;
const normKeyword = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
const cleanText = (value: unknown, max = 120) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const num = (value: unknown) => value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);

type Row = { id: string; keyword: string; location: string; geo: string; language: string; group_id: string | null; tags: string; avg_monthly_searches: number | null; competition: string | null; competition_index: number | null; low_bid: number | null; high_bid: number | null; difficulty: number | null; source: string; metrics_source: string; last_checked_at: string | null; created_at: string; updated_at: string };
const toKeyword = (row: Row) => ({ id: row.id, keyword: row.keyword, location: row.location, geo: row.geo, language: row.language, groupId: row.group_id || "", tags: (() => { try { return JSON.parse(row.tags) as string[]; } catch { return []; } })(), avgMonthlySearches: row.avg_monthly_searches, competition: row.competition || "", competitionIndex: row.competition_index, lowTopOfPageBid: row.low_bid, highTopOfPageBid: row.high_bid, difficulty: row.difficulty, source: row.source, metricsSource: row.metrics_source, lastCheckedAt: row.last_checked_at, createdAt: row.created_at });

async function access(clientId: string) {
  const user = await getChatGPTUser();
  if (!user) return { error: respond("Sign in to manage saved keywords.", 401) };
  if (!env.DB) return { error: respond("The workspace database is unavailable.", 503) };
  const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string }>();
  if (!row?.data) return { error: respond("The workspace is unavailable.", 503) };
  const workspace = JSON.parse(row.data);
  const profile = (workspace.staff || []).find((item: any) => !item.isBot && (item.id === user.userId || item.email?.toLowerCase() === user.email.toLowerCase()));
  const admin = workspace.ownerId === user.userId || ["Owner", "Admin"].includes(profile?.role || "");
  if (!admin) return { error: respond("Only an owner or admin can manage keyword research.", 403) };
  const ownerId = String(workspace.ownerId || user.userId);
  const client = clientId ? (workspace.clients || []).find((item: any) => item.id === clientId) : null;
  if (clientId && !client) return { error: respond("Choose a client in this workspace.", 404) };
  return { db: env.DB, ownerId, client };
}

async function listAll(db: D1Database, ownerId: string, clientId: string) {
  const [groups, keywords] = await db.batch([
    db.prepare("SELECT id, name, sort_order FROM seo_keyword_groups WHERE owner_id = ?1 AND client_id = ?2 ORDER BY sort_order, name").bind(ownerId, clientId),
    db.prepare("SELECT * FROM seo_saved_keywords WHERE owner_id = ?1 AND client_id = ?2 ORDER BY keyword").bind(ownerId, clientId),
  ]);
  return {
    groups: ((groups.results || []) as Array<{ id: string; name: string; sort_order: number }>).map((group) => ({ id: group.id, name: group.name, sortOrder: group.sort_order })),
    keywords: ((keywords.results || []) as Row[]).map(toKeyword),
    tags: TAGS,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const geoSuggest = url.searchParams.get("geoSuggest");
  if (geoSuggest !== null) {
    const result = await access("");
    if ("error" in result) return result.error;
    try { return Response.json({ locations: await suggestGoogleAdsGeoTargets(result.ownerId, geoSuggest, (url.searchParams.get("country") || "").toUpperCase()) }, { headers: { "Cache-Control": "no-store" } }); }
    catch (error) { return respond(error instanceof Error ? error.message : "Location search failed.", 502); }
  }
  const clientId = url.searchParams.get("clientId") || "";
  if (!clientId) return respond("Choose a client.");
  const result = await access(clientId);
  if ("error" in result) return result.error;
  await ensureTables(result.db);
  return Response.json(await listAll(result.db, result.ownerId, clientId), { headers: { "Cache-Control": "no-store" } });
}

type SaveInput = { keyword?: string; location?: string; geo?: string; language?: string; avgMonthlySearches?: number | null; competition?: string; competitionIndex?: number | null; lowTopOfPageBid?: number | null; highTopOfPageBid?: number | null; difficulty?: number | null; source?: string; checkedAt?: string };

export async function POST(request: Request) {
  let body: { action?: string; clientId?: string; keywords?: SaveInput[]; groupId?: string; name?: string; ids?: string[]; add?: string[]; remove?: string[]; order?: string[] };
  try { body = await request.json() as typeof body; } catch { return respond("The request is not valid."); }
  const clientId = String(body.clientId || "");
  if (!clientId) return respond("Choose a client.");
  const result = await access(clientId);
  if ("error" in result) return result.error;
  const { db, ownerId, client } = result;
  await ensureTables(db);
  const now = new Date().toISOString();
  const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean).slice(0, 500) : [];
  const groupExists = async (groupId: string) => !groupId || Boolean(await db.prepare("SELECT id FROM seo_keyword_groups WHERE id = ?1 AND owner_id = ?2 AND client_id = ?3").bind(groupId, ownerId, clientId).first());
  // D1 allows at most 100 bound parameters per statement, so id lists are processed in chunks.
  const chunks = (list: string[], size = 80) => Array.from({ length: Math.ceil(list.length / size) }, (_, index) => list.slice(index * size, index * size + size));
  const marks = (list: string[], start: number) => list.map((_, index) => `?${index + start}`).join(",");
  let message = "";

  switch (body.action) {
    case "save": {
      const groupId = String(body.groupId || "");
      if (!(await groupExists(groupId))) return respond("That keyword group no longer exists.", 404);
      const items = (Array.isArray(body.keywords) ? body.keywords : []).slice(0, 500).map((item) => ({ ...item, keyword: cleanText(item.keyword, 80), location: cleanText(item.location) || "Ireland", language: cleanText(item.language, 40) || "English" })).filter((item) => item.keyword);
      if (!items.length) return respond("Choose at least one keyword to save.");
      // Insert new keywords; an existing client+keyword+location+language keeps its row, tags and history
      // and only moves into the chosen group when one is given.
      const statements = items.map((item) => db.prepare(`INSERT INTO seo_saved_keywords (id, owner_id, client_id, keyword, keyword_norm, location, geo, language, group_id, tags, avg_monthly_searches, competition, competition_index, low_bid, high_bid, difficulty, source, metrics_source, last_checked_at, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, '[]', ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16, ?17, ?18, ?18)
        ON CONFLICT (owner_id, client_id, keyword_norm, location, language) DO UPDATE SET group_id = COALESCE(?9, seo_saved_keywords.group_id), updated_at = ?18`)
        .bind(crypto.randomUUID(), ownerId, clientId, item.keyword, normKeyword(item.keyword), item.location, cleanText(item.geo, 20), item.language, groupId || null,
          num(item.avgMonthlySearches), cleanText(item.competition, 20) || null, num(item.competitionIndex), num(item.lowTopOfPageBid), num(item.highTopOfPageBid), num(item.difficulty), cleanText(item.source, 60) || "Keyword research", cleanText(item.checkedAt, 40) || now, now));
      const before = await db.prepare("SELECT COUNT(*) AS n FROM seo_saved_keywords WHERE owner_id = ?1 AND client_id = ?2").bind(ownerId, clientId).first<{ n: number }>();
      await db.batch(statements);
      const after = await db.prepare("SELECT COUNT(*) AS n FROM seo_saved_keywords WHERE owner_id = ?1 AND client_id = ?2").bind(ownerId, clientId).first<{ n: number }>();
      const added = Number(after?.n || 0) - Number(before?.n || 0);
      message = `${added} keyword${added === 1 ? "" : "s"} saved${items.length - added ? ` · ${items.length - added} already saved${groupId ? " (moved to this group)" : ""}` : ""}.`;
      break;
    }
    case "createGroup": {
      const name = cleanText(body.name, 60);
      if (!name) return respond("Give the group a name.");
      const exists = await db.prepare("SELECT id FROM seo_keyword_groups WHERE owner_id = ?1 AND client_id = ?2 AND lower(name) = lower(?3)").bind(ownerId, clientId, name).first();
      if (exists) return respond("A group with that name already exists for this client.", 409);
      const count = await db.prepare("SELECT COUNT(*) AS n FROM seo_keyword_groups WHERE owner_id = ?1 AND client_id = ?2").bind(ownerId, clientId).first<{ n: number }>();
      await db.prepare("INSERT INTO seo_keyword_groups (id, owner_id, client_id, name, sort_order, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(crypto.randomUUID(), ownerId, clientId, name, Number(count?.n || 0), now).run();
      message = `Group “${name}” created.`;
      break;
    }
    case "renameGroup": {
      const name = cleanText(body.name, 60);
      if (!name || !body.groupId) return respond("Choose a group and a new name.");
      const clash = await db.prepare("SELECT id FROM seo_keyword_groups WHERE owner_id = ?1 AND client_id = ?2 AND lower(name) = lower(?3) AND id != ?4").bind(ownerId, clientId, name, body.groupId).first();
      if (clash) return respond("A group with that name already exists for this client.", 409);
      await db.prepare("UPDATE seo_keyword_groups SET name = ?4 WHERE id = ?1 AND owner_id = ?2 AND client_id = ?3").bind(body.groupId, ownerId, clientId, name).run();
      message = `Group renamed to “${name}”.`;
      break;
    }
    case "deleteGroup": {
      if (!body.groupId) return respond("Choose a group.");
      // Keywords are never lost: they move to Ungrouped.
      await db.batch([
        db.prepare("UPDATE seo_saved_keywords SET group_id = NULL, updated_at = ?4 WHERE owner_id = ?1 AND client_id = ?2 AND group_id = ?3").bind(ownerId, clientId, body.groupId, now),
        db.prepare("DELETE FROM seo_keyword_groups WHERE id = ?3 AND owner_id = ?1 AND client_id = ?2").bind(ownerId, clientId, body.groupId),
      ]);
      message = "Group deleted · its keywords moved to Ungrouped.";
      break;
    }
    case "reorderGroups": {
      const order = (Array.isArray(body.order) ? body.order : []).map(String).slice(0, 200);
      if (order.length) await db.batch(order.map((id, index) => db.prepare("UPDATE seo_keyword_groups SET sort_order = ?4 WHERE id = ?1 AND owner_id = ?2 AND client_id = ?3").bind(id, ownerId, clientId, index)));
      message = "Groups reordered.";
      break;
    }
    case "move": {
      const groupId = String(body.groupId || "");
      if (!ids.length) return respond("Choose keywords to move.");
      if (!(await groupExists(groupId))) return respond("That keyword group no longer exists.", 404);
      await db.batch(chunks(ids).map((part) => db.prepare(`UPDATE seo_saved_keywords SET group_id = ?3, updated_at = ?4 WHERE owner_id = ?1 AND client_id = ?2 AND id IN (${marks(part, 5)})`).bind(ownerId, clientId, groupId || null, now, ...part)));
      message = `${ids.length} keyword${ids.length === 1 ? "" : "s"} moved.`;
      break;
    }
    case "tag": {
      if (!ids.length) return respond("Choose keywords to tag.");
      const add = (body.add || []).filter((tag) => (TAGS as readonly string[]).includes(tag));
      const remove = (body.remove || []).filter((tag) => (TAGS as readonly string[]).includes(tag));
      const found = await db.batch(chunks(ids).map((part) => db.prepare(`SELECT id, tags FROM seo_saved_keywords WHERE owner_id = ?1 AND client_id = ?2 AND id IN (${marks(part, 3)})`).bind(ownerId, clientId, ...part)));
      const updates = found.flatMap((chunk) => (chunk.results || []) as Array<{ id: string; tags: string }>).map((row) => {
        let tags: string[] = []; try { tags = JSON.parse(row.tags); } catch { tags = []; }
        const next = TAGS.filter((tag) => (tags.includes(tag) || add.includes(tag)) && !remove.includes(tag));
        return db.prepare("UPDATE seo_saved_keywords SET tags = ?3, updated_at = ?4 WHERE id = ?1 AND owner_id = ?2").bind(row.id, ownerId, JSON.stringify(next), now);
      });
      if (updates.length) await db.batch(updates);
      message = `Tags updated on ${updates.length} keyword${updates.length === 1 ? "" : "s"}.`;
      break;
    }
    case "remove": {
      if (!ids.length) return respond("Choose keywords to remove.");
      await db.batch(chunks(ids).map((part) => db.prepare(`DELETE FROM seo_saved_keywords WHERE owner_id = ?1 AND client_id = ?2 AND id IN (${marks(part, 3)})`).bind(ownerId, clientId, ...part)));
      message = `${ids.length} keyword${ids.length === 1 ? "" : "s"} removed from saved keywords.`;
      break;
    }
    case "refresh": {
      if (!ids.length) return respond("Choose keywords to refresh.");
      if (!client?.googleAdsAccountId) return respond("Refreshing metrics uses Google Keyword Planner. Map this client’s Google Ads account first.", 409);
      const rows = (await db.batch(chunks(ids.slice(0, 200)).map((part) => db.prepare(`SELECT * FROM seo_saved_keywords WHERE owner_id = ?1 AND client_id = ?2 AND id IN (${marks(part, 3)})`).bind(ownerId, clientId, ...part)))).flatMap((chunk) => (chunk.results || []) as Row[]);
      const byGeo = new Map<string, Row[]>();
      for (const row of rows) { const geo = /^\d+$/.test(row.geo) ? row.geo : "2372"; byGeo.set(geo, [...(byGeo.get(geo) || []), row]); }
      let updated = 0; const missing: string[] = [];
      const statements: D1PreparedStatement[] = [];
      for (const [geo, group] of byGeo) {
        const metrics = await getGoogleAdsKeywordHistoricalMetrics(ownerId, String(client.googleAdsAccountId), group.map((row) => row.keyword), geo);
        const lookup = new Map<string, (typeof metrics)[number]>();
        for (const item of metrics) { lookup.set(normKeyword(item.keyword), item); for (const variant of item.closeVariants) if (!lookup.has(normKeyword(variant))) lookup.set(normKeyword(variant), item); }
        for (const row of group) {
          const item = lookup.get(normKeyword(row.keyword));
          if (!item) { missing.push(row.keyword); continue; }
          updated++;
          statements.push(db.prepare("UPDATE seo_saved_keywords SET avg_monthly_searches = ?3, competition = ?4, competition_index = ?5, low_bid = ?6, high_bid = ?7, metrics_source = 'Google Keyword Planner', last_checked_at = ?8, updated_at = ?8 WHERE id = ?1 AND owner_id = ?2")
            .bind(row.id, ownerId, item.avgMonthlySearches, item.competition, item.competitionIndex, item.lowTopOfPageBid, item.highTopOfPageBid, now));
        }
      }
      if (statements.length) await db.batch(statements);
      message = `Metrics refreshed for ${updated} keyword${updated === 1 ? "" : "s"}${missing.length ? ` · Google returned no data for ${missing.length}` : ""}.`;
      break;
    }
    default:
      return respond("Unknown action.");
  }
  return Response.json({ message, ...(await listAll(db, ownerId, clientId)) }, { headers: { "Cache-Control": "no-store" } });
}
