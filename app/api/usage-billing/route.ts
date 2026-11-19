import { env } from "cloudflare:workers";
import { authorizeAdmin, authorizeAdminOrSubAccount, respond } from "@/lib/settings-auth";
import { getChatGPTUser } from "../../chatgpt-auth";
import { audit, billable, ensureUsageTables, loadBilling, markupFor } from "@/lib/usage-meter";
import { draftUsageInvoices, previousMonth } from "@/lib/usage-billing";

// AI & SEO-data usage rebilling.
//  Agency admins: settings (markup slider, FX rate, SEO data on/off, minimum charge), per-client overrides,
//    usage report by client / feature / day with real cost and billable amount, request log and audit log.
//  Sub-account staff (their own sub-account only): usage and the marked-up amount — never cost or markup.
export const dynamic = "force-dynamic";
const okDate = (v: string | null, fb: string) => /^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v! : fb;
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function GET(request: Request) {
  if (!env.DB) return respond({ error: "The workspace database is unavailable." }, 503);
  const url = new URL(request.url);
  const end = okDate(url.searchParams.get("end"), new Date().toISOString().slice(0, 10));
  const start = okDate(url.searchParams.get("start"), `${end.slice(0, 7)}-01`);
  const from = `${start}T00:00:00.000Z`, to = new Date(Date.parse(`${end}T00:00:00Z`) + 86_400_000).toISOString();
  const clientId = url.searchParams.get("clientId") || "";
  const auth = await authorizeAdminOrSubAccount("view AI usage", "CRM");
  if (auth.error) return auth.error;
  await ensureUsageTables(env.DB);
  const b = await loadBilling(env.DB, auth.ownerId);
  const kinds = b.settings.includeSeoData ? ["ai", "seo_data"] : ["ai"];
  const inKinds = kinds.map((_, i) => `?${i + 4}`).join(",");

  // Sub-account view: only their own client, only billable amounts.
  if (auth.scope) {
    if (!clientId || !auth.scope.includes(clientId)) return respond({ error: "Choose your sub-account." }, 403);
    const mk = markupFor(b, clientId);
    const feats = (await env.DB.prepare(`SELECT feature, COUNT(*) AS calls, SUM(cost_usd) AS cost FROM usage_log WHERE owner_id = ?1 AND client_id = ?2 AND created_at >= ?3 AND created_at < ?${kinds.length + 4} AND kind IN (${kinds.map((_, i) => `?${i + 4}`).join(",")}) GROUP BY feature ORDER BY cost DESC`).bind(auth.ownerId, clientId, from, ...kinds, to).all<any>()).results || [];
    const days = (await env.DB.prepare(`SELECT substr(created_at,1,10) AS day, COUNT(*) AS calls, SUM(cost_usd) AS cost FROM usage_log WHERE owner_id = ?1 AND client_id = ?2 AND created_at >= ?3 AND created_at < ?${kinds.length + 4} AND kind IN (${kinds.map((_, i) => `?${i + 4}`).join(",")}) GROUP BY day ORDER BY day`).bind(auth.ownerId, clientId, from, ...kinds, to).all<any>()).results || [];
    const price = (c: number) => billable(c, b.settings.usdRate, mk);
    return respond({ view: "client", period: { start, end }, enabled: b.settings.enabled && b.clients.get(clientId)?.enabled !== false, total: r2(feats.reduce((t: number, f: any) => t + price(Number(f.cost) || 0), 0)), calls: feats.reduce((t: number, f: any) => t + Number(f.calls), 0), features: feats.map((f: any) => ({ feature: f.feature, calls: Number(f.calls), amount: price(Number(f.cost) || 0) })), days: days.map((d: any) => ({ day: d.day, calls: Number(d.calls), amount: price(Number(d.cost) || 0) })) });
  }

  // Agency view.
  const where = `owner_id = ?1 AND created_at >= ?2 AND created_at < ?3 AND kind IN (${inKinds})${clientId ? ` AND client_id = ?${kinds.length + 4}` : ""}`;
  const args = [auth.ownerId, from, to, ...kinds, ...(clientId ? [clientId] : [])];
  const [byClient, byFeature, byDay, log, auditRows, unattributed] = await Promise.all([
    env.DB.prepare(`SELECT client_id, COUNT(*) AS calls, SUM(input_tokens) AS input, SUM(output_tokens) AS output, SUM(cost_usd) AS cost, SUM(CASE WHEN kind='ai' THEN cost_usd ELSE 0 END) AS ai, SUM(CASE WHEN kind='seo_data' THEN cost_usd ELSE 0 END) AS seo, SUM(CASE WHEN invoice_id <> '' THEN cost_usd ELSE 0 END) AS invoiced FROM usage_log WHERE ${where} GROUP BY client_id ORDER BY cost DESC`).bind(...args).all<any>(),
    env.DB.prepare(`SELECT feature, kind, COUNT(*) AS calls, SUM(cost_usd) AS cost FROM usage_log WHERE ${where} GROUP BY feature, kind ORDER BY cost DESC LIMIT 60`).bind(...args).all<any>(),
    env.DB.prepare(`SELECT substr(created_at,1,10) AS day, COUNT(*) AS calls, SUM(cost_usd) AS cost FROM usage_log WHERE ${where} GROUP BY day ORDER BY day`).bind(...args).all<any>(),
    env.DB.prepare(`SELECT id, client_id, kind, provider, feature, model, input_tokens, output_tokens, cost_usd, cost_source, actor, created_at, invoice_id FROM usage_log WHERE ${where} ORDER BY created_at DESC LIMIT 200`).bind(...args).all<any>(),
    env.DB.prepare(`SELECT client_id, action, detail, actor, created_at FROM usage_billing_audit WHERE owner_id = ?1 AND action <> 'month-billed'${clientId ? " AND client_id = ?2" : ""} ORDER BY created_at DESC LIMIT 100`).bind(auth.ownerId, ...(clientId ? [clientId] : [])).all<any>(),
    env.DB.prepare(`SELECT COUNT(*) AS calls, SUM(cost_usd) AS cost FROM usage_log WHERE owner_id = ?1 AND created_at >= ?2 AND created_at < ?3 AND client_id = ''`).bind(auth.ownerId, from, to).first<any>(),
  ]);
  const mk = (id: string) => markupFor(b, id);
  return respond({
    view: "agency", period: { start, end }, settings: b.settings,
    overrides: [...b.clients.entries()].map(([id, v]) => ({ clientId: id, markupPct: v.markupPct, enabled: v.enabled })),
    clients: (byClient.results || []).map((r: any) => { const cost = Number(r.cost) || 0; return { clientId: r.client_id, calls: Number(r.calls), inputTokens: Number(r.input) || 0, outputTokens: Number(r.output) || 0, costUsd: cost, aiUsd: Number(r.ai) || 0, seoUsd: Number(r.seo) || 0, markupPct: r.client_id ? mk(r.client_id) : 0, billable: r.client_id ? billable(cost, b.settings.usdRate, mk(r.client_id)) : 0, invoicedUsd: Number(r.invoiced) || 0 }; }),
    features: (byFeature.results || []).map((r: any) => ({ feature: r.feature, kind: r.kind, calls: Number(r.calls), costUsd: Number(r.cost) || 0 })),
    days: (byDay.results || []).map((r: any) => ({ day: r.day, calls: Number(r.calls), costUsd: Number(r.cost) || 0 })),
    log: (log.results || []).map((r: any) => ({ id: r.id, clientId: r.client_id, kind: r.kind, provider: r.provider, feature: r.feature, model: r.model, inputTokens: r.input_tokens, outputTokens: r.output_tokens, costUsd: r.cost_usd, costSource: r.cost_source, actor: r.actor, at: r.created_at, invoiceId: r.invoice_id })),
    audit: (auditRows.results || []).map((r: any) => ({ clientId: r.client_id, action: r.action, detail: (() => { try { return JSON.parse(r.detail); } catch { return {}; } })(), actor: r.actor, at: r.created_at })),
    unattributed: { calls: Number(unattributed?.calls) || 0, costUsd: Number(unattributed?.cost) || 0 },
    lastMonth: previousMonth(new Date()),
  });
}

export async function POST(request: Request) {
  const auth = await authorizeAdmin("manage AI rebilling");
  if (auth.error) return auth.error;
  const user = await getChatGPTUser();
  const actor = user?.email || "admin";
  let body: Record<string, unknown> = {};
  try { body = await request.json() as Record<string, unknown>; } catch { return respond({ error: "Send valid JSON." }, 400); }
  const db = env.DB!;
  await ensureUsageTables(db);
  const before = await loadBilling(db, auth.ownerId);
  const now = new Date().toISOString();
  const pct = (v: unknown) => Math.max(0, Math.min(1000, Math.round(Number(v) * 10) / 10));
  if (body.action === "settings") {
    const next = {
      enabled: body.enabled === undefined ? before.settings.enabled : Boolean(body.enabled),
      markupPct: body.markupPct === undefined ? before.settings.markupPct : pct(body.markupPct),
      usdRate: body.usdRate === undefined ? before.settings.usdRate : Math.max(0.1, Math.min(10, Number(body.usdRate) || before.settings.usdRate)),
      includeSeoData: body.includeSeoData === undefined ? before.settings.includeSeoData : Boolean(body.includeSeoData),
      minCharge: body.minCharge === undefined ? before.settings.minCharge : Math.max(0, Math.min(10000, Number(body.minCharge) || 0)),
    };
    await db.prepare("INSERT INTO usage_billing_settings (owner_id, enabled, markup_pct, usd_rate, include_seo_data, min_charge, updated_at, updated_by) VALUES (?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(owner_id) DO UPDATE SET enabled=excluded.enabled, markup_pct=excluded.markup_pct, usd_rate=excluded.usd_rate, include_seo_data=excluded.include_seo_data, min_charge=excluded.min_charge, updated_at=excluded.updated_at, updated_by=excluded.updated_by")
      .bind(auth.ownerId, next.enabled ? 1 : 0, next.markupPct, next.usdRate, next.includeSeoData ? 1 : 0, next.minCharge, now, actor).run();
    const { updatedAt: _a, updatedBy: _b, ...prev } = before.settings;
    await audit(db, auth.ownerId, "settings-changed", { before: prev, after: next }, actor);
    return respond({ ok: true, settings: { ...next, updatedAt: now, updatedBy: actor } });
  }
  if (body.action === "client") {
    const clientId = String(body.clientId || "");
    if (!/^[\w-]{4,80}$/.test(clientId)) return respond({ error: "Choose a client." }, 400);
    const prev = before.clients.get(clientId) || { markupPct: null, enabled: true };
    const markupPct = body.markupPct === null || body.markupPct === "" ? null : body.markupPct === undefined ? prev.markupPct : pct(body.markupPct);
    const enabled = body.enabled === undefined ? prev.enabled : Boolean(body.enabled);
    await db.prepare("INSERT INTO usage_billing_clients (owner_id, client_id, markup_pct, enabled, updated_at, updated_by) VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(owner_id, client_id) DO UPDATE SET markup_pct=excluded.markup_pct, enabled=excluded.enabled, updated_at=excluded.updated_at, updated_by=excluded.updated_by")
      .bind(auth.ownerId, clientId, markupPct, enabled ? 1 : 0, now, actor).run();
    await audit(db, auth.ownerId, "client-changed", { before: prev, after: { markupPct, enabled } }, actor, clientId);
    return respond({ ok: true });
  }
  if (body.action === "draft-invoices") {
    const month = /^\d{4}-\d{2}$/.test(String(body.month || "")) ? String(body.month) : previousMonth(new Date());
    const result = await draftUsageInvoices(month, actor);
    await audit(db, auth.ownerId, "manual-billing-run", { month, ...result }, actor);
    return respond({ ok: true, ...result });
  }
  return respond({ error: "Unknown action." }, 400);
}
