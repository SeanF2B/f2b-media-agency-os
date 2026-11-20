import { env } from "cloudflare:workers";
import { authorizeAdmin, authorizeAdminOrSubAccount, respond } from "@/lib/settings-auth";
import { getChatGPTUser } from "../../chatgpt-auth";
import { audit, billable, clearUnitCostCache, ensureUsageTables, loadBilling, markupFor, serviceBilled } from "@/lib/usage-meter";
import { SERVICES, isServiceKey, serviceOf } from "@/lib/usage-services";
import { runWithUsage } from "@/lib/usage-meter";
import { addCredit, cancellationEndDate, cancellations, creditBalance, creditHistory, ensureCreditTables } from "@/lib/usage-credits";
import { addDays, createInvoice, loadSettings, today } from "@/lib/invoicing/core";

async function workspaceInfo() {
  const row = await env.DB!.prepare("SELECT data FROM workspace_documents WHERE id='f2b-agency'").first<{ data: string }>();
  let ws: any = {}; try { ws = JSON.parse(row?.data || "{}"); } catch { /* empty */ }
  return { clients: (ws.clients || []) as any[], currency: String(ws.settings?.currency || "EUR"), adminEmail: String(ws.settings?.adminEmail || "sean@f2bmedia.com") };
}
/** Credit balance, history, cancellation requests and services for one client (shared by the client and agency views). */
async function accountFor(ownerId: string, clientId: string) {
  const info = await workspaceInfo();
  const client = info.clients.find((c) => String(c.id) === clientId);
  const [balance, history, cancels] = await Promise.all([creditBalance(env.DB!, ownerId, clientId), creditHistory(env.DB!, ownerId, clientId), cancellations(env.DB!, ownerId, clientId)]);
  return { currency: String(client?.currency || info.currency || "EUR"), credit: { balance, history }, cancellations: cancels, ourServices: ((client?.services || []) as any[]).map((x) => String(x.name || "")).filter(Boolean), noticeEnd: cancellationEndDate(new Date(), String(client?.startDate || client?.createdAt || "")) };
}
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
  const service = url.searchParams.get("service") || "";
  const allOn = SERVICES.map((d) => d.key).filter((k) => b.services.get(k)?.enabled !== false);
  const kinds = isServiceKey(service) ? [service] : auth.scope || url.searchParams.get("as") === "client" ? allOn : SERVICES.map((d) => d.key);
  const inKinds = kinds.map((_, i) => `?${i + 4}`).join(",");

  // Sub-account view: only their own client, only billable amounts.
  if (auth.scope || url.searchParams.get("as") === "client") {
    if (!clientId || (auth.scope && !auth.scope.includes(clientId))) return respond({ error: "Choose your sub-account." }, 403);
    const mk = markupFor(b, clientId);
    kinds.splice(0, kinds.length, ...kinds.filter((k) => serviceBilled(b, clientId, k)));
    if (!kinds.length) return respond({ ...(await accountFor(auth.ownerId, clientId)), services: [], view: "client", period: { start, end }, enabled: false, total: 0, calls: 0, features: [], days: [] });
    const feats = (await env.DB.prepare(`SELECT feature, COUNT(*) AS calls, SUM(cost_usd) AS cost FROM usage_log WHERE owner_id = ?1 AND client_id = ?2 AND created_at >= ?3 AND created_at < ?${kinds.length + 4} AND kind IN (${kinds.map((_, i) => `?${i + 4}`).join(",")}) GROUP BY feature ORDER BY cost DESC`).bind(auth.ownerId, clientId, from, ...kinds, to).all<any>()).results || [];
    const days = (await env.DB.prepare(`SELECT substr(created_at,1,10) AS day, COUNT(*) AS calls, SUM(cost_usd) AS cost FROM usage_log WHERE owner_id = ?1 AND client_id = ?2 AND created_at >= ?3 AND created_at < ?${kinds.length + 4} AND kind IN (${kinds.map((_, i) => `?${i + 4}`).join(",")}) GROUP BY day ORDER BY day`).bind(auth.ownerId, clientId, from, ...kinds, to).all<any>()).results || [];
    const price = (c: number) => billable(c, b.settings.usdRate, mk);
    const perKind = (await env.DB.prepare(`SELECT kind, COUNT(*) AS calls, SUM(input_tokens) AS units, SUM(cost_usd) AS cost FROM usage_log WHERE owner_id = ?1 AND client_id = ?2 AND created_at >= ?3 AND created_at < ?${kinds.length + 4} AND kind IN (${kinds.map((_, i) => `?${i + 4}`).join(",")}) GROUP BY kind`).bind(auth.ownerId, clientId, from, ...kinds, to).all<any>()).results || [];
    const account = await accountFor(auth.ownerId, clientId);
    return respond({ ...account, services: perKind.map((r: any) => { const d = serviceOf(r.kind); return { key: r.kind, label: d?.label.split(" (")[0] || r.kind, unit: d?.unit || "request", qty: d?.pricing === "unit" ? Number(r.units) || 0 : Number(r.calls), amount: billable(Number(r.cost) || 0, b.settings.usdRate, markupFor(b, clientId, r.kind)) }; }), view: "client", period: { start, end }, enabled: b.settings.enabled && b.clients.get(clientId)?.enabled !== false, total: r2(feats.reduce((t: number, f: any) => t + price(Number(f.cost) || 0), 0)), calls: feats.reduce((t: number, f: any) => t + Number(f.calls), 0), features: feats.map((f: any) => ({ feature: f.feature, calls: Number(f.calls), amount: price(Number(f.cost) || 0) })), days: days.map((d: any) => ({ day: d.day, calls: Number(d.calls), amount: price(Number(d.cost) || 0) })) });
  }

  // Agency view.
  const where = `owner_id = ?1 AND created_at >= ?2 AND created_at < ?3 AND kind IN (${inKinds})${clientId ? ` AND client_id = ?${kinds.length + 4}` : ""}`;
  const args = [auth.ownerId, from, to, ...kinds, ...(clientId ? [clientId] : [])];
  const [byKind, byClientKind, byClient, byFeature, byDay, log, auditRows, unattributed] = await Promise.all([
    env.DB.prepare(`SELECT kind, COUNT(*) AS calls, SUM(input_tokens) AS units, SUM(cost_usd) AS cost FROM usage_log WHERE ${where} GROUP BY kind`).bind(...args).all<any>(),
    env.DB.prepare(`SELECT client_id, kind, SUM(cost_usd) AS cost FROM usage_log WHERE ${where} AND client_id <> '' GROUP BY client_id, kind`).bind(...args).all<any>(),
    env.DB.prepare(`SELECT client_id, COUNT(*) AS calls, SUM(input_tokens) AS input, SUM(output_tokens) AS output, SUM(cost_usd) AS cost, SUM(CASE WHEN kind='ai' THEN cost_usd ELSE 0 END) AS ai, SUM(CASE WHEN kind='seo_data' THEN cost_usd ELSE 0 END) AS seo, SUM(CASE WHEN invoice_id <> '' THEN cost_usd ELSE 0 END) AS invoiced FROM usage_log WHERE ${where} GROUP BY client_id ORDER BY cost DESC`).bind(...args).all<any>(),
    env.DB.prepare(`SELECT feature, kind, COUNT(*) AS calls, SUM(cost_usd) AS cost FROM usage_log WHERE ${where} GROUP BY feature, kind ORDER BY cost DESC LIMIT 60`).bind(...args).all<any>(),
    env.DB.prepare(`SELECT substr(created_at,1,10) AS day, COUNT(*) AS calls, SUM(cost_usd) AS cost FROM usage_log WHERE ${where} GROUP BY day ORDER BY day`).bind(...args).all<any>(),
    env.DB.prepare(`SELECT id, client_id, kind, provider, feature, model, input_tokens, output_tokens, cost_usd, cost_source, actor, created_at, invoice_id FROM usage_log WHERE ${where} ORDER BY created_at DESC LIMIT 200`).bind(...args).all<any>(),
    env.DB.prepare(`SELECT client_id, action, detail, actor, created_at FROM usage_billing_audit WHERE owner_id = ?1 AND action <> 'month-billed'${clientId ? " AND client_id = ?2" : ""} ORDER BY created_at DESC LIMIT 100`).bind(auth.ownerId, ...(clientId ? [clientId] : [])).all<any>(),
    env.DB.prepare(`SELECT COUNT(*) AS calls, SUM(cost_usd) AS cost FROM usage_log WHERE owner_id = ?1 AND created_at >= ?2 AND created_at < ?3 AND client_id = ''`).bind(auth.ownerId, from, to).first<any>(),
  ]);
  const mk = (id: string) => markupFor(b, id);
  // To bill per client = each service's cost at that service's markup, only for services billed to that client.
  const bill = new Map<string, number>(); const kindCost = new Map<string, Record<string, number>>();
  for (const r of (byClientKind.results || []) as any[]) {
    const cost = Number(r.cost) || 0; const k = kindCost.get(r.client_id) || {}; k[r.kind] = (k[r.kind] || 0) + cost; kindCost.set(r.client_id, k);
    if (serviceBilled(b, r.client_id, r.kind)) bill.set(r.client_id, (bill.get(r.client_id) || 0) + billable(cost, b.settings.usdRate, markupFor(b, r.client_id, r.kind)));
  }
  const kindRows = (byKind.results || []) as any[];
  return respond({
    ...(clientId ? { account: await accountFor(auth.ownerId, clientId) } : {}),
    services: SERVICES.map((d) => { const st = b.services.get(d.key)!; const r = kindRows.find((x) => x.kind === d.key); return { ...d, enabled: st.enabled, markupPct: st.markupPct, unitUsd: st.unitUsd, calls: Number(r?.calls) || 0, units: Number(r?.units) || 0, costUsd: Number(r?.cost) || 0, active: st.enabled && (Number(r?.calls) > 0 || d.key === "ai" || d.key === "seo_data") }; }),
    clientServices: [...b.clientServices.entries()].map(([clientId, m]) => ({ clientId, services: Object.fromEntries(m) })),
    view: "agency", period: { start, end }, settings: b.settings,
    overrides: [...b.clients.entries()].map(([id, v]) => ({ clientId: id, markupPct: v.markupPct, enabled: v.enabled })),
    clients: (byClient.results || []).map((r: any) => { const cost = Number(r.cost) || 0; return { clientId: r.client_id, calls: Number(r.calls), inputTokens: Number(r.input) || 0, outputTokens: Number(r.output) || 0, costUsd: cost, aiUsd: Number(r.ai) || 0, seoUsd: Number(r.seo) || 0, markupPct: r.client_id ? mk(r.client_id) : 0, billable: r.client_id ? Math.round((bill.get(r.client_id) || 0) * 100) / 100 : 0, byService: kindCost.get(r.client_id) || {}, invoicedUsd: Number(r.invoiced) || 0 }; }),
    features: (byFeature.results || []).map((r: any) => ({ feature: r.feature, kind: r.kind, calls: Number(r.calls), costUsd: Number(r.cost) || 0 })),
    days: (byDay.results || []).map((r: any) => ({ day: r.day, calls: Number(r.calls), costUsd: Number(r.cost) || 0 })),
    log: (log.results || []).map((r: any) => ({ id: r.id, clientId: r.client_id, kind: r.kind, provider: r.provider, feature: r.feature, model: r.model, inputTokens: r.input_tokens, outputTokens: r.output_tokens, costUsd: r.cost_usd, costSource: r.cost_source, actor: r.actor, at: r.created_at, invoiceId: r.invoice_id })),
    audit: (auditRows.results || []).map((r: any) => ({ clientId: r.client_id, action: r.action, detail: (() => { try { return JSON.parse(r.detail); } catch { return {}; } })(), actor: r.actor, at: r.created_at })),
    unattributed: { calls: Number(unattributed?.calls) || 0, costUsd: Number(unattributed?.cost) || 0 },
    lastMonth: previousMonth(new Date()),
  });
}

export async function POST(request: Request) {
  if (!env.DB) return respond({ error: "The workspace database is unavailable." }, 503);
  let raw: Record<string, unknown> = {};
  try { raw = await request.clone().json() as Record<string, unknown>; } catch { return respond({ error: "Send valid JSON." }, 400); }
  // Actions a client's own sub-account staff can take (and agency admins on their behalf).
  if (raw.action === "credit-buy" || raw.action === "cancel-request" || raw.action === "cancel-withdraw") {
    const who = await authorizeAdminOrSubAccount("manage account billing", "CRM");
    if (who.error) return who.error;
    const clientId = String(raw.clientId || "");
    if (!/^[\w-]{4,80}$/.test(clientId) || (who.scope && !who.scope.includes(clientId))) return respond({ error: "Choose your account." }, 403);
    const user = await getChatGPTUser(); const actor = user?.email || "client";
    await ensureCreditTables(env.DB); await ensureUsageTables(env.DB);
    const info = await workspaceInfo(); const client = info.clients.find((c) => String(c.id) === clientId);
    if (!client) return respond({ error: "Account not found." }, 404);
    const name = String(client.company || client.name || "Client");
    if (raw.action === "credit-buy") {
      const amount = Math.round(Number(raw.amount) * 100) / 100;
      if (!(amount >= 5 && amount <= 5000)) return respond({ error: "Choose an amount between 5 and 5,000." }, 400);
      const s = await loadSettings(who.ownerId); const issue = today(); const currency = String(client.currency || info.currency || "EUR");
      const invoiceId = await createInvoice(who.ownerId, { clientId, clientName: name, clientEmail: String(client.email || ""), issueDate: issue, dueDate: addDays(issue, Math.min(7, s.paymentTermsDays || 7)), currency, items: [{ description: "Account credit top-up (AI, messaging, calls and email usage)", qty: 1, unit: amount }], vatRate: 0, notes: "Credit is added to your account as soon as this invoice is paid." });
      const inv = await env.DB.prepare("SELECT public_token, number FROM inv_invoices WHERE id=?1").bind(invoiceId).first<{ public_token: string; number: string }>();
      await env.DB.prepare("UPDATE inv_invoices SET status='sent', sent_at=?2 WHERE id=?1 AND status='draft'").bind(invoiceId, new Date().toISOString()).run();
      await addCredit(env.DB, who.ownerId, clientId, { amount, kind: "topup", note: `Top-up · invoice ${inv?.number || ""}`.trim(), invoiceId, status: "pending", actor });
      await audit(env.DB, who.ownerId, "credit-requested", { amount, invoiceId }, actor, clientId);
      const origin = new URL(request.url).origin;
      return respond({ ok: true, link: inv?.public_token ? `${origin}/api/marketing-public/invoice?token=${inv.public_token}` : "", number: inv?.number || "" });
    }
    if (raw.action === "cancel-request") {
      const services = (Array.isArray(raw.services) ? raw.services : []).map(String).filter((x) => ((client.services || []) as any[]).some((s) => String(s.name) === x)).slice(0, 20);
      if (!services.length) return respond({ error: "Pick the services to cancel." }, 400);
      const endDate = cancellationEndDate(new Date(), String(client.startDate || client.createdAt || ""));
      const id = crypto.randomUUID(), now = new Date().toISOString(), reason = String(raw.reason || "").slice(0, 1000);
      await env.DB.prepare("INSERT INTO service_cancellations (id, owner_id, client_id, services, reason, end_date, status, requested_by, created_at) VALUES (?1,?2,?3,?4,?5,?6,'requested',?7,?8)").bind(id, who.ownerId, clientId, JSON.stringify(services), reason, endDate, actor, now).run();
      await audit(env.DB, who.ownerId, "cancellation-requested", { services, endDate, reason }, actor, clientId);
      // Tell the agency (not billed to the client).
      if (env.RESEND_API_KEY && env.TASK_NOTIFICATION_FROM) await runWithUsage({ clientId: "" }, () => fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: env.TASK_NOTIFICATION_FROM, to: [info.adminEmail], subject: `Cancellation request · ${name}`, text: `${name} asked to cancel: ${services.join(", ")}.\nServices end on ${endDate} (30 days' notice, after the 90-day minimum term).\nRequested by ${actor}.${reason ? `\nReason: ${reason}` : ""}\n\nOpen the client in the OS to confirm or withdraw it.` }) })).catch(() => undefined);
      return respond({ ok: true, endDate });
    }
    const id = String(raw.id || "");
    await env.DB.prepare("UPDATE service_cancellations SET status='withdrawn', decided_by=?3, decided_at=?4 WHERE id=?1 AND client_id=?2 AND owner_id=?5 AND status='requested'").bind(id, clientId, actor, new Date().toISOString(), who.ownerId).run();
    await audit(env.DB, who.ownerId, "cancellation-withdrawn", { id }, actor, clientId);
    return respond({ ok: true });
  }
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
  if (body.action === "service") {
    const key = body.service;
    if (!isServiceKey(key)) return respond({ error: "Unknown service." }, 400);
    const prev = before.services.get(key)!;
    const next = {
      enabled: body.enabled === undefined ? prev.enabled : Boolean(body.enabled),
      markupPct: body.markupPct === undefined ? prev.markupPct : body.markupPct === null || body.markupPct === "" ? null : pct(body.markupPct),
      unitUsd: body.unitUsd === undefined ? prev.unitUsd : body.unitUsd === null || body.unitUsd === "" ? null : Math.max(0, Math.min(100, Number(body.unitUsd) || 0)),
    };
    await db.prepare("INSERT INTO usage_services (owner_id, service, enabled, markup_pct, unit_cost_usd, updated_at, updated_by) VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(owner_id, service) DO UPDATE SET enabled=excluded.enabled, markup_pct=excluded.markup_pct, unit_cost_usd=excluded.unit_cost_usd, updated_at=excluded.updated_at, updated_by=excluded.updated_by")
      .bind(auth.ownerId, key, next.enabled ? 1 : 0, next.markupPct, next.unitUsd, now, actor).run();
    if (key === "seo_data") await db.prepare("UPDATE usage_billing_settings SET include_seo_data = ?2 WHERE owner_id = ?1").bind(auth.ownerId, next.enabled ? 1 : 0).run();
    clearUnitCostCache();
    await audit(db, auth.ownerId, "service-changed", { service: key, before: { enabled: prev.enabled, markupPct: prev.markupPct, unitUsd: prev.unitUsd }, after: next }, actor);
    return respond({ ok: true });
  }
  if (body.action === "client-service") {
    const clientId = String(body.clientId || ""), key = body.service;
    if (!/^[\w-]{4,80}$/.test(clientId) || !isServiceKey(key)) return respond({ error: "Choose a client and service." }, 400);
    const enabled = Boolean(body.enabled);
    await db.prepare("INSERT INTO usage_client_services (owner_id, client_id, service, enabled, updated_at, updated_by) VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(owner_id, client_id, service) DO UPDATE SET enabled=excluded.enabled, updated_at=excluded.updated_at, updated_by=excluded.updated_by")
      .bind(auth.ownerId, clientId, key, enabled ? 1 : 0, now, actor).run();
    await audit(db, auth.ownerId, "client-service-changed", { service: key, enabled }, actor, clientId);
    return respond({ ok: true });
  }
  if (body.action === "credit-add") {
    const clientId = String(body.clientId || ""), amount = Math.round(Number(body.amount) * 100) / 100;
    if (!/^[\w-]{4,80}$/.test(clientId) || !amount || Math.abs(amount) > 100000) return respond({ error: "Enter an amount." }, 400);
    await addCredit(db, auth.ownerId, clientId, { amount, kind: amount > 0 ? "topup" : "adjustment", note: String(body.note || (amount > 0 ? "Credit added by the agency" : "Adjustment")).slice(0, 300), actor });
    await audit(db, auth.ownerId, "credit-added", { amount, note: body.note || "" }, actor, clientId);
    return respond({ ok: true });
  }
  if (body.action === "cancel-decide") {
    const id = String(body.id || ""), status = body.status === "confirmed" ? "confirmed" : "withdrawn";
    const row = await db.prepare("SELECT client_id FROM service_cancellations WHERE id=?1 AND owner_id=?2").bind(id, auth.ownerId).first<{ client_id: string }>();
    if (!row) return respond({ error: "Request not found." }, 404);
    await db.prepare("UPDATE service_cancellations SET status=?2, decided_by=?3, decided_at=?4 WHERE id=?1").bind(id, status, actor, now).run();
    await audit(db, auth.ownerId, `cancellation-${status}`, { id }, actor, row.client_id);
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
