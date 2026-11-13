// Saved client reports: manual "Save to history" and the automatic monthly SEO / Google Ads reports.
// The rendered HTML is stored in R2 (D1 fallback when no bucket) and indexed in client_report_archive.
// The monthly job runs from the 5-minute cron on the 1st–3rd of each month (Dublin time), at most two
// reports per run, so API and database load stay small and spread out.
import { buildClientReport, type ReportType } from "./client-report-data";
import { renderClientReportHtml } from "./client-report-render";
import { resolveAgencyLogoUrl } from "./report-branding";

export const APP_ORIGIN = "https://f2b-media-agency-os.f2b-media.workers.dev";
const TABLE = "CREATE TABLE IF NOT EXISTS client_report_archive (id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, client_id TEXT NOT NULL, type TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL, storage_key TEXT NOT NULL DEFAULT '', html TEXT, summary_json TEXT NOT NULL DEFAULT '{}')";
const INDEX = "CREATE UNIQUE INDEX IF NOT EXISTS client_report_archive_period_idx ON client_report_archive(owner_id, client_id, type, period_start, period_end, kind)";
let ready: Promise<void> | null = null;
export function ensureReportArchive(db: D1Database) {
  if (!ready) ready = db.batch([db.prepare(TABLE), db.prepare(INDEX)]).then(() => undefined).catch((error) => { ready = null; throw error; });
  return ready;
}

type Bucket = { put(key: string, value: string, options?: Record<string, unknown>): Promise<unknown>; get(key: string): Promise<{ text(): Promise<string> } | null> } | undefined;
type ArchiveWorkspace = { ownerId?: string; clients?: Array<{ id: string; name: string; status?: string; googleAdsAccountId?: string; googleAnalyticsAccountId?: string; googleSearchConsoleAccountId?: string; googleBusinessProfileLocationId?: string; services?: Array<{ name?: string }>; seoServices?: string[] }> };

export async function saveClientReport(db: D1Database, bucket: Bucket, workspace: ArchiveWorkspace, clientId: string, type: ReportType, period: { start: string; end: string }, kind: "monthly" | "manual", origin = APP_ORIGIN) {
  await ensureReportArchive(db);
  const report = await buildClientReport(db, workspace as never, clientId, type, period);
  const html = renderClientReportHtml(report, { origin, agencyIconUrl: resolveAgencyLogoUrl(origin) });
  const ownerId = String(workspace.ownerId || "");
  const id = crypto.randomUUID();
  const storageKey = bucket ? `client-reports/${ownerId}/${clientId}/${type}/${period.start}_${period.end}_${kind}_${id}.html` : "";
  if (bucket) await bucket.put(storageKey, html, { httpMetadata: { contentType: "text/html; charset=utf-8", cacheControl: "private, no-store" } });
  const summary = { leads: report.attribution.data?.current.leads ?? null, qualified: report.attribution.data?.current.qualified ?? null, wonRevenue: report.attribution.data?.current.wonRevenue ?? null, spend: report.ads?.data?.current.spend ?? null, missing: report.missing.map((m) => m.label) };
  await db.prepare("INSERT INTO client_report_archive (id, owner_id, client_id, type, period_start, period_end, kind, created_at, storage_key, html, summary_json) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11) ON CONFLICT(owner_id, client_id, type, period_start, period_end, kind) DO UPDATE SET id=excluded.id, created_at=excluded.created_at, storage_key=excluded.storage_key, html=excluded.html, summary_json=excluded.summary_json")
    .bind(id, ownerId, clientId, type, period.start, period.end, kind, report.generatedAt, storageKey, bucket ? null : html, JSON.stringify(summary)).run();
  return { id, report, html };
}

export async function listClientReports(db: D1Database, ownerId: string, clientId: string) {
  await ensureReportArchive(db);
  const rows = await db.prepare("SELECT id, type, period_start, period_end, kind, created_at, summary_json FROM client_report_archive WHERE owner_id = ?1 AND client_id = ?2 AND kind IN ('monthly', 'manual') ORDER BY period_end DESC, created_at DESC LIMIT 36").bind(ownerId, clientId).all<{ id: string; type: string; period_start: string; period_end: string; kind: string; created_at: string; summary_json: string }>();
  return (rows.results || []).map((row) => ({ id: row.id, type: row.type, periodStart: row.period_start, periodEnd: row.period_end, kind: row.kind, createdAt: row.created_at, summary: (() => { try { return JSON.parse(row.summary_json); } catch { return {}; } })() }));
}

export async function readClientReportHtml(db: D1Database, bucket: Bucket, ownerId: string, id: string) {
  await ensureReportArchive(db);
  const row = await db.prepare("SELECT storage_key, html FROM client_report_archive WHERE owner_id = ?1 AND id = ?2").bind(ownerId, id).first<{ storage_key: string; html: string | null }>();
  if (!row) return null;
  if (row.html) return row.html;
  if (row.storage_key && bucket) return (await (await bucket.get(row.storage_key))?.text()) || null;
  return null;
}

function dublinParts(now: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(now).map((p) => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) };
}
const wantsAds = (client: NonNullable<ArchiveWorkspace["clients"]>[number]) => Boolean(String(client.googleAdsAccountId || "").replace(/\D/g, "")) && (client.services || []).some((s) => /google ads|ppc/i.test(String(s.name || "")));
const wantsSeo = (client: NonNullable<ArchiveWorkspace["clients"]>[number]) => (client.services || []).some((s) => /seo|search engine/i.test(String(s.name || ""))) || Boolean(client.seoServices?.length);

/** Monthly job: previous calendar month's SEO / Google Ads report for each client with that service. */
export async function processMonthlyClientReports(db: D1Database | undefined, bucket: Bucket, now = new Date()) {
  if (!db) return { saved: 0 };
  const today = dublinParts(now);
  if (today.day > 3 || today.hour < 7) return { saved: 0 };
  const start = new Date(Date.UTC(today.year, today.month - 2, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(today.year, today.month - 1, 0)).toISOString().slice(0, 10);
  const doc = await db.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!doc?.data) return { saved: 0 };
  const workspace = JSON.parse(doc.data) as ArchiveWorkspace;
  await ensureReportArchive(db);
  const backoff = new Date(now.getTime() - 6 * 3_600_000).toISOString();
  const done = new Set(((await db.prepare("SELECT client_id, type FROM client_report_archive WHERE owner_id = ?1 AND period_start = ?2 AND period_end = ?3 AND (kind = 'monthly' OR (kind = 'monthly_failed' AND created_at > ?4))").bind(String(workspace.ownerId || ""), start, end, backoff).all<{ client_id: string; type: string }>()).results || []).map((row) => `${row.client_id}|${row.type}`));
  const due: Array<[string, ReportType]> = [];
  for (const client of workspace.clients || []) {
    if (client.status && /inactive|paused|archived|lost/i.test(client.status)) continue;
    if (wantsAds(client) && !done.has(`${client.id}|ads`)) due.push([client.id, "ads"]);
    if (wantsSeo(client) && !done.has(`${client.id}|seo`)) due.push([client.id, "seo"]);
  }
  let saved = 0;
  for (const [clientId, type] of due.slice(0, 2)) {
    try { await saveClientReport(db, bucket, workspace, clientId, type, { start, end }, "monthly"); saved++; }
    catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.error("Monthly client report failed", clientId, type, message);
      await db.prepare("INSERT INTO client_report_archive (id, owner_id, client_id, type, period_start, period_end, kind, created_at, summary_json) VALUES (?1,?2,?3,?4,?5,?6,'monthly_failed',?7,?8) ON CONFLICT(owner_id, client_id, type, period_start, period_end, kind) DO UPDATE SET created_at=excluded.created_at, summary_json=excluded.summary_json").bind(crypto.randomUUID(), String(workspace.ownerId || ""), clientId, type, start, end, now.toISOString(), JSON.stringify({ error: message.slice(0, 300) })).run().catch(() => undefined);
    }
  }
  return { saved, remaining: Math.max(0, due.length - 2) };
}
