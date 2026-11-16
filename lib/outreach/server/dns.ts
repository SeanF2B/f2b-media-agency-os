// Cloudflare DNS for sending domains: zone lookup/creation, applying a reviewed plan with a
// full change history (before/after for rollback), and public authentication checks.
import { planDomainDns, type DesiredDns, type DnsAction } from "@/lib/outreach/dns-plan.mjs";
import { dohAnswers, evaluateAuth } from "@/lib/outreach/deliverability.mjs";
import { cloudflareAccountId, cloudflareToken, db, nowIso, parseJson, uuid } from "./store";

const CF = "https://api.cloudflare.com/client/v4";
type CfRecord = { id: string; type: string; name: string; content: string; priority?: number };

async function cf<T = any>(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`${CF}${path}`, { method: init.method || "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok || payload?.success === false) throw Object.assign(new Error(`Cloudflare: ${String(payload?.errors?.[0]?.message || response.status).slice(0, 200)}`), { status: response.status });
  return payload as T;
}

async function token(ownerId: string) {
  const value = await cloudflareToken(ownerId);
  if (!value) throw new Error("Connect a Cloudflare token in Settings → Domains & DNS first.");
  return value;
}

export async function findZone(ownerId: string, domain: string): Promise<{ id: string; status: string; nameServers: string[] } | null> {
  const result = await cf(await token(ownerId), `/zones?name=${encodeURIComponent(domain)}`);
  const zone = result?.result?.[0];
  return zone ? { id: zone.id, status: zone.status, nameServers: zone.name_servers || [] } : null;
}

/** Registrar-bought domains get a zone automatically; this only creates one if it's missing. */
export async function ensureZone(ownerId: string, domain: string) {
  const existing = await findZone(ownerId, domain);
  if (existing) return existing;
  const accountId = cloudflareAccountId();
  if (!accountId) throw new Error("The Cloudflare account ID isn't configured.");
  const created = await cf(await token(ownerId), "/zones", { method: "POST", body: { name: domain, account: { id: accountId }, type: "full" } });
  return { id: created.result.id, status: created.result.status, nameServers: created.result.name_servers || [] };
}

export async function zoneRecords(ownerId: string, zoneId: string): Promise<CfRecord[]> {
  const out: CfRecord[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const result = await cf(await token(ownerId), `/zones/${zoneId}/dns_records?per_page=100&page=${page}`);
    out.push(...(result?.result || []).map((record: any) => ({ id: record.id, type: record.type, name: record.name, content: record.content, priority: record.priority })));
    if (page >= (result?.result_info?.total_pages || 1)) break;
  }
  return out;
}

async function managedRecordIds(ownerId: string, domain: string): Promise<string[]> {
  const rows = await db().prepare("SELECT record_id FROM outreach_dns_changes WHERE owner_id = ?1 AND domain = ?2 AND action = 'create' AND rolled_back_by IS NULL AND record_id IS NOT NULL").bind(ownerId, domain).all<{ record_id: string }>();
  return (rows.results || []).map((row) => row.record_id);
}

/** Plan, then (if apply) execute and log every change. Protected domains never change. */
export async function planAndApply(ownerId: string, { domain, desired, apply, actor, reason }: { domain: string; desired: DesiredDns; apply: boolean; actor: string; reason: string }) {
  const domainRow = await db().prepare("SELECT protected, zone_id FROM outreach_domains WHERE owner_id = ?1 AND domain = ?2").bind(ownerId, domain).first<{ protected: number; zone_id: string | null }>();
  const zone = domainRow?.zone_id ? { id: domainRow.zone_id } : await findZone(ownerId, domain);
  if (!zone) throw new Error(`${domain} isn't on Cloudflare yet.`);
  const existing = await zoneRecords(ownerId, zone.id);
  const plan = planDomainDns({ domain, protected: Boolean(domainRow?.protected), existing, managedRecordIds: await managedRecordIds(ownerId, domain), desired });
  if (!apply || !plan.actions.length) return { plan, applied: [] as string[] };
  const cfToken = await token(ownerId);
  const applied: string[] = [];
  for (const action of plan.actions) {
    const body = { type: action.type, name: action.name, content: action.content, ttl: 1, ...(action.priority !== undefined ? { priority: action.priority } : {}), ...(action.type === "CNAME" ? { proxied: false } : {}) };
    let recordId = action.recordId || null;
    if (action.op === "create") recordId = (await cf(cfToken, `/zones/${zone.id}/dns_records`, { method: "POST", body })).result.id;
    else if (action.op === "update") await cf(cfToken, `/zones/${zone.id}/dns_records/${action.recordId}`, { method: "PUT", body });
    else if (action.op === "delete") await cf(cfToken, `/zones/${zone.id}/dns_records/${action.recordId}`, { method: "DELETE" });
    await logChange(ownerId, { domain, zoneId: zone.id, recordId, action, actor, reason });
    applied.push(`${action.op} ${action.type} ${action.name}`);
  }
  return { plan, applied };
}

async function logChange(ownerId: string, { domain, zoneId, recordId, action, actor, reason }: { domain: string; zoneId: string; recordId: string | null; action: DnsAction; actor: string; reason: string }) {
  await db().prepare("INSERT INTO outreach_dns_changes (id, owner_id, domain, zone_id, record_id, action, record_type, record_name, before_json, after_json, reason, actor, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)")
    .bind(uuid(), ownerId, domain, zoneId, recordId, action.op, action.type, action.name, action.before ? JSON.stringify(action.before) : null, action.op === "delete" ? null : JSON.stringify({ type: action.type, name: action.name, content: action.content, priority: action.priority }), `${reason}: ${action.reason}`.slice(0, 300), actor, nowIso()).run();
}

/** Undo one logged change (re-create a deleted record, restore an updated one, delete a created one). */
export async function rollbackChange(ownerId: string, changeId: string, actor: string) {
  const row = await db().prepare("SELECT * FROM outreach_dns_changes WHERE owner_id = ?1 AND id = ?2").bind(ownerId, changeId).first<any>();
  if (!row) throw new Error("That DNS change wasn't found.");
  if (row.rolled_back_by) throw new Error("That change was already rolled back.");
  const cfToken = await token(ownerId);
  const before = parseJson<CfRecord | null>(row.before_json, null);
  if (row.action === "create" && row.record_id) await cf(cfToken, `/zones/${row.zone_id}/dns_records/${row.record_id}`, { method: "DELETE" });
  else if (row.action === "update" && before) await cf(cfToken, `/zones/${row.zone_id}/dns_records/${row.record_id}`, { method: "PUT", body: { type: before.type, name: before.name, content: before.content, ttl: 1, ...(before.priority !== undefined ? { priority: before.priority } : {}) } });
  else if (row.action === "delete" && before) await cf(cfToken, `/zones/${row.zone_id}/dns_records`, { method: "POST", body: { type: before.type, name: before.name, content: before.content, ttl: 1, ...(before.priority !== undefined ? { priority: before.priority } : {}) } });
  else throw new Error("This change can't be rolled back automatically.");
  const id = uuid();
  await db().prepare("INSERT INTO outreach_dns_changes (id, owner_id, domain, zone_id, record_id, action, record_type, record_name, before_json, after_json, reason, actor, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 'rollback', ?6, ?7, ?8, ?9, ?10, ?11, ?12)")
    .bind(id, ownerId, row.domain, row.zone_id, row.record_id, row.record_type, row.record_name, row.after_json, row.before_json, `Rollback of ${changeId}`, actor, nowIso()).run();
  await db().prepare("UPDATE outreach_dns_changes SET rolled_back_by = ?3 WHERE owner_id = ?1 AND id = ?2").bind(ownerId, changeId, id).run();
}

/** A-record lookup used for DNS blocklists (NXDOMAIN → []). */
export async function dohA(name: string): Promise<string[]> {
  const response = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=A`, { headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Public DNS lookup failed for ${name}.`);
  const body = await response.json() as { Status?: number; Answer?: Array<{ type: number; data: string }> };
  return (body.Answer || []).filter((answer) => answer.type === 1).map((answer) => answer.data);
}

async function doh(name: string, type: "TXT" | "MX" | "CNAME"): Promise<string[]> {
  const response = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, { headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Public DNS lookup failed for ${name}.`);
  return dohAnswers(await response.json(), type);
}

/** Checks what the world actually sees (public DNS), then stores the result on the domain. */
export async function checkDomainAuth(ownerId: string, domain: string, host: "microsoft" | "google" | "smtp", selectors: string[]) {
  const [apexTxt, dmarcTxt, mx] = await Promise.all([doh(domain, "TXT"), doh(`_dmarc.${domain}`, "TXT"), doh(domain, "MX")]);
  const dkim: Record<string, string[]> = {};
  for (const selector of selectors) {
    const name = `${selector}._domainkey.${domain}`;
    dkim[selector] = [...await doh(name, "CNAME").catch(() => []), ...await doh(name, "TXT").catch(() => [])];
  }
  const result = { ...evaluateAuth({ host, apexTxt, dmarcTxt, mx, dkim }), checkedAt: nowIso() };
  await db().prepare("UPDATE outreach_domains SET last_check_json = ?3, last_checked_at = ?4, updated_at = ?4 WHERE owner_id = ?1 AND domain = ?2").bind(ownerId, domain, JSON.stringify(result), result.checkedAt).run();
  return result;
}
