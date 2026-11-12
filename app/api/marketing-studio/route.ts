import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { emailTemplateFieldIds, parseStaffEmailConfig } from "../../../lib/marketing-automation-email.js";
import { normalizeMarketingAutomationNodeType, normalizeMarketingAutomationPosition, validateMarketingAutomationNodes } from "../../../lib/marketing-automation.js";
import { isMarketingGhlContactTrigger, MARKETING_SUBMISSION_TRIGGERS, parseMarketingTrigger, type MarketingConversionToolKind } from "../../../lib/marketing-trigger.js";
import { GHL_AUTOMATION_CONTACT_FIELDS } from "../../../lib/gohighlevel-webhook";
import { resolveMarketingPublication } from "../../../lib/marketing-publication.js";
import { stampMarketingPublicationVersion } from "../../../lib/marketing-quote-snapshot.js";
import { parseMarketingContactUpdate } from "../../../lib/marketing-contact-update.js";
import { marketingMessageTemplateFieldIds, parseGhlMarketingMessageStatus, validateMarketingCustomerMessage } from "../../../lib/marketing-automation-message.js";
import { ghlLocationRequest } from "../../../lib/gohighlevel-oauth";
import { validateMarketingCalculator, validateMarketingRules, validateMarketingSectionRules, type MarketingField, type MarketingVisibility } from "../../../lib/marketing-rules";
import { normalizeMarketingSections } from "../../../lib/marketing-sections";
import { deleteMarketingReusableBlock, listMarketingReusableBlocks, saveMarketingReusableBlock } from "../../../lib/marketing-reusable-blocks";
import { marketingSubmissionFileKeys } from "../../../lib/marketing-submission-files";
import { deleteMarketingSubmission } from "../../../lib/marketing-submission-delete";
import { getMarketingSubmissionRetention, normalizeMarketingSubmissionRetentionDays, saveMarketingSubmissionRetention } from "../../../lib/marketing-submission-retention";
import { listMarketingAuditEvents, marketingAuditInsert, type MarketingAuditAction, type MarketingAuditKind } from "../../../lib/marketing-audit-events";
import { normalizeMarketingDesign } from "../../../lib/marketing-design";
import { summarizeMarketingAnalytics } from "../../../lib/marketing-analytics";
import { buildMarketingPageResult, normalizeMarketingPage } from "../../../lib/marketing-pagination.js";
import { customMarketingDateWindow, googleAnalyticsDateWindow } from "../../../lib/seo-performance";

export const dynamic = "force-dynamic";
const kinds = new Set(["funnel", "form", "survey", "calculator", "automation"]);
type WorkspaceData = { ownerId?: string; staff?: Array<{ id?: string; email?: string; role?: string; isBot?: boolean }>; clients?: Array<{ id: string }> };

async function ownerContext(user: { userId: string; email: string }) {
  if (!env.DB) return null;
  const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!row?.data) return null;
  let data: WorkspaceData;
  try { data = JSON.parse(row.data); } catch { return null; }
  const ownerId = String(data.ownerId || "");
  const allowed = ownerId === user.userId || data.staff?.some((member) => member.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(member.role || ""));
  const actorId = ownerId === user.userId ? ownerId : data.staff?.find((member) => member.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(member.role || ""))?.id || user.userId;
  return allowed && ownerId ? { ownerId, actorId, data } : null;
}

function normalizeDraft(input: unknown, kind: string) {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const name = String(body.name || "Untitled project").trim().slice(0, 120) || "Untitled project";
  const clientId = String(body.clientId || "").trim().slice(0, 120) || null;
  const status = body.status === "published" ? "published" : body.status === "active" ? "active" : body.status === "paused" ? "paused" : "draft";
  const source = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data as Record<string, unknown> : {};
  const fields = Array.isArray(source.fields) ? source.fields.slice(0, 60).map((raw, index) => {
    const field = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const options = Array.isArray(field.options) ? field.options.slice(0, 40).map((option) => { const item = option && typeof option === "object" ? option as Record<string, unknown> : {}; return { label: String(item.label || "Option").slice(0, 160), value: String(item.value || item.label || "option").slice(0, 160), price: Math.max(0, Math.min(1_000_000, Number(item.price) || 0)), ...(kind === "survey" && Number.isInteger(Number(item.nextStep)) ? { nextStep: Math.min(10, Math.max(1, Number(item.nextStep))) } : {}) }; }) : [];
    const fieldId = String(field.id || `field-${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || `field-${index + 1}`;
    const showWhen = field.showWhen && typeof field.showWhen === "object" ? field.showWhen as Record<string, unknown> : null;
    const min = Number.isFinite(Number(field.min)) ? Number(field.min) : undefined;
    const max = Number.isFinite(Number(field.max)) ? Number(field.max) : undefined;
    const operator = ["equals", "notEquals", "greaterThan", "lessThan", "contains", "isEmpty", "isNotEmpty"].includes(String(showWhen?.operator)) ? String(showWhen?.operator) : "equals";
    const conditions = Array.isArray(showWhen?.conditions) ? showWhen.conditions.slice(0, 8).map((rawCondition) => { const condition = rawCondition && typeof rawCondition === "object" ? rawCondition as Record<string, unknown> : {}; return { fieldId: String(condition.fieldId || "").slice(0, 64), operator: ["equals", "notEquals", "greaterThan", "lessThan", "contains", "isEmpty", "isNotEmpty"].includes(String(condition.operator)) ? String(condition.operator) : "equals", value: String(condition.value ?? condition.equals ?? "").slice(0, 160) }; }).filter((condition) => condition.fieldId) : [];
    const normalizedVisibility = conditions.length ? { mode: showWhen?.mode === "or" ? "or" : "and", conditions } : showWhen && typeof showWhen.fieldId === "string" ? { fieldId: showWhen.fieldId.slice(0, 64), operator, value: String(showWhen.value ?? showWhen.equals ?? "").slice(0, 160) } : null;
    const type = ["text", "email", "tel", "address", "number", "date", "time", "select", "radio", "multiselect", "textarea", "checkbox", "consent", "file", "hidden", "heading", "description", "divider", "progress"].includes(String(field.type)) ? String(field.type) : "text";
    const contentOnly = ["heading", "description", "divider", "progress"].includes(type);
    return { id: fieldId, label: String(field.label || `Question ${index + 1}`).slice(0, 160), type, required: contentOnly ? false : Boolean(field.required), description: String(field.description || "").slice(0, 1000), placeholder: String(field.placeholder || "").slice(0, 300), defaultValue: String(field.defaultValue || "").slice(0, 1000), ...(min === undefined ? {} : { min: Math.max(-1_000_000, Math.min(1_000_000, min)) }), ...(max === undefined ? {} : { max: Math.max(-1_000_000, Math.min(1_000_000, max)) }), options, contactField: ["name", "firstName", "lastName", "email", "phone", "companyName", "address1", "city", "state", "postalCode", "none"].includes(String(field.contactField)) ? String(field.contactField) : undefined, pricePerUnit: Math.max(0, Math.min(1_000_000, Number(field.pricePerUnit) || 0)), step: Math.min(10, Math.max(1, Number(field.step) || 1)), ...(normalizedVisibility ? { showWhen: normalizedVisibility } : {}) };
  }) : [];
  const sections = normalizeMarketingSections(source.sections);
  const funnelSteps = Array.isArray(source.funnelSteps) ? source.funnelSteps.slice(0, 10).map((raw) => { const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {}; return { title: String(item.title || "Step").slice(0, 100), heading: String(item.heading || "").slice(0, 160), body: String(item.body || "").slice(0, 2000) }; }) : [];
  const nodes = Array.isArray(source.nodes) ? source.nodes.slice(0, 60).map((raw) => { const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {}; const position = normalizeMarketingAutomationPosition(item.position); return { id: String(item.id || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64), type: normalizeMarketingAutomationNodeType(item.type), label: String(item.label || "Step").slice(0, 160), config: String(item.config || "").slice(0, 6000), ...(position ? { position } : {}) }; }) : [];
  const allowedDomains = Array.isArray(source.allowedDomains) ? source.allowedDomains.slice(0, 20).map((entry) => String(entry).trim().slice(0, 253)).filter(Boolean) : [];
  const capture = source.crmCapture && typeof source.crmCapture === "object" ? source.crmCapture as Record<string, unknown> : {};
  const crmCapture = (kind === "form" || kind === "survey") && capture.createOpportunity === true ? { createOpportunity: true, pipelineId: String(capture.pipelineId || "").slice(0, 80), stageId: String(capture.stageId || "").slice(0, 80), title: String(capture.title || name).slice(0, 200), value: Math.max(0, Math.min(100_000_000, Number(capture.value) || 0)), assignedTo: String(capture.assignedTo || "").slice(0, 80) } : undefined;
  const normalizedData = { heading: String(source.heading || name).slice(0, 160), description: String(source.description || "").slice(0, 4000), seoTitle: String(source.seoTitle || source.heading || name).slice(0, 160), seoDescription: String(source.seoDescription || source.description || "").slice(0, 300), canonicalUrl: (() => { try { const url = new URL(String(source.canonicalUrl || "")); return url.protocol === "https:" ? url.toString().slice(0, 2000) : ""; } catch { return ""; } })(), ogImageUrl: (() => { try { const url = new URL(String(source.ogImageUrl || "")); return url.protocol === "https:" ? url.toString().slice(0, 2000) : ""; } catch { return ""; } })(), noIndex: Boolean(source.noIndex), design: normalizeMarketingDesign(source.design), submitLabel: String(source.submitLabel || "Submit").slice(0, 80), currency: /^[A-Za-z]{3}$/.test(String(source.currency || "EUR")) ? String(source.currency || "EUR").toUpperCase() : "EUR", fixedFee: Math.max(0, Math.min(1_000_000, Number(source.fixedFee) || 0)), minimumCharge: Math.max(0, Math.min(1_000_000, Number(source.minimumCharge) || 0)), percentageAdjustmentPercent: Math.max(-100, Math.min(1000, Number(source.percentageAdjustmentPercent) || 0)), discountPercent: Math.max(0, Math.min(100, Number(source.discountPercent) || 0)), taxPercent: Math.max(0, Math.min(100, Number(source.taxPercent) || 0)), sections, funnelSteps, fields, nodes, allowedDomains, ...(crmCapture ? { crmCapture } : {}) };
  const data = JSON.stringify(normalizedData);
  if (data.length > 500_000) throw new Error("This project is too large to save.");
  return { name, clientId, status, data };
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in before opening the builder." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "The private workspace database is unavailable." }, { status: 503 });
  const context = await ownerContext(user);
  if (!context) return Response.json({ error: "Only an agency owner or admin can manage these projects." }, { status: 403 });
  const url = new URL(request.url);
  if (url.searchParams.get("ghlDateFields") === "1") {
    const clientId = String(url.searchParams.get("clientId") || "");
    if (!clientId || !context.data.clients?.some((client) => client.id === clientId)) return Response.json({ error: "Choose a client in this workspace." }, { status: 404 });
    try {
      const link = await env.DB.prepare("SELECT location_id FROM gohighlevel_location_links WHERE owner_id = ?1 AND client_id = ?2").bind(context.ownerId, clientId).first<{ location_id: string }>();
      if (!link) return Response.json({ error: "Link this client to a GoHighLevel location first." }, { status: 409 });
      const response = await ghlLocationRequest(context.ownerId, clientId, `/locations/${encodeURIComponent(link.location_id)}/customFields?model=contact`);
      const fields = Array.isArray((response.payload as { customFields?: unknown[] }).customFields) ? (response.payload as { customFields: Array<Record<string, unknown>> }).customFields : [];
      const contactFields = fields.filter((field) => field.model === "contact").slice(0, 200).map((field) => ({ id: String(field.id || "").slice(0, 120), name: String(field.name || "Contact field").slice(0, 160), dataType: String(field.dataType || "TEXT") })).filter((field) => /^[A-Za-z0-9_-]{8,120}$/.test(field.id));
      return Response.json({ dateFields: contactFields.filter((field) => ["DATE", "DATE_TIME"].includes(field.dataType)), statusFields: contactFields }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) { return Response.json({ error: error instanceof Error ? error.message.slice(0, 300) : "GoHighLevel date fields could not be loaded." }, { status: 502 }); }
  }
  if (url.searchParams.get("publishedSources") === "1") {
    const rows = await env.DB.prepare("SELECT id, client_id AS clientId, kind, name, slug, published_data AS publishedData FROM marketing_assets WHERE owner_id = ?1 AND kind IN ('funnel','form','survey','calculator') AND published_data IS NOT NULL ORDER BY updated_at DESC LIMIT 200").bind(context.ownerId).all<Record<string, unknown>>();
    const sources = (rows.results || []).map((row) => {
      const published = safeJson(row.publishedData) as { fields?: Array<Record<string, unknown>> };
      return { id: String(row.id), clientId: row.clientId ? String(row.clientId) : null, kind: String(row.kind), name: String(row.name || "Published tool"), slug: String(row.slug), fields: (published.fields || []).slice(0, 60).map((field) => ({ id: String(field.id || "").slice(0, 64), label: String(field.label || "").slice(0, 160), type: String(field.type || "text").slice(0, 40), required: field.required === true })) };
    });
    return Response.json({ sources }, { headers: { "Cache-Control": "no-store" } });
  }
  const submissionsFor = url.searchParams.get("submissions") === "1" ? url.searchParams.get("assetId") || "" : "";
  if (submissionsFor) {
    const owned = await env.DB.prepare("SELECT id FROM marketing_assets WHERE owner_id = ?1 AND id = ?2").bind(context.ownerId, submissionsFor).first();
    if (!owned) return Response.json({ error: "That project was not found for this workspace." }, { status: 404 });
    const rows = await env.DB.prepare("SELECT id, kind, data, created_at AS createdAt FROM marketing_submissions WHERE owner_id = ?1 AND asset_id = ?2 ORDER BY created_at DESC LIMIT 100").bind(context.ownerId, submissionsFor).all();
    return Response.json({ submissions: (rows.results || []).map((row: Record<string, unknown>) => ({ ...row, data: safeJson(row.data) })) }, { headers: { "Cache-Control": "no-store" } });
  }
  const analyticsFor = url.searchParams.get("analytics") === "1" ? url.searchParams.get("assetId") || "" : "";
  if (analyticsFor) {
    const owned = await env.DB.prepare("SELECT id FROM marketing_assets WHERE owner_id = ?1 AND id = ?2 AND kind IN ('funnel','form','survey','calculator')").bind(context.ownerId, analyticsFor).first();
    if (!owned) return Response.json({ error: "That project was not found for this workspace." }, { status: 404 });
    const range = url.searchParams.get("range") || "last_30d";
    const dateWindow = range === "custom"
      ? customMarketingDateWindow(url.searchParams.get("from") || "", url.searchParams.get("to") || "")
      : ["last_7d", "last_30d", "last_90d"].includes(range) ? googleAnalyticsDateWindow(range as "last_7d" | "last_30d" | "last_90d") : null;
    if (!dateWindow) return Response.json({ error: "Choose a 7, 30, 90-day or valid custom date range up to 366 days." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    const [rows, attributionRows, previousRows, previousAttributionRows] = await Promise.all([
      env.DB.prepare("SELECT metric_date AS metricDate, page_loads AS pageLoads, submissions FROM marketing_daily_analytics WHERE owner_id = ?1 AND asset_id = ?2 AND metric_date BETWEEN ?3 AND ?4 ORDER BY metric_date DESC LIMIT 366").bind(context.ownerId, analyticsFor, dateWindow.current.start, dateWindow.current.end).all(),
      env.DB.prepare("SELECT COALESCE(NULLIF(json_extract(data, '$.attribution.utm_source'), ''), 'Not tagged') AS source, COALESCE(NULLIF(json_extract(data, '$.attribution.utm_medium'), ''), '') AS medium, COALESCE(NULLIF(json_extract(data, '$.attribution.utm_campaign'), ''), '') AS campaign, COUNT(*) AS submissions FROM marketing_submissions WHERE owner_id = ?1 AND asset_id = ?2 AND date(created_at) BETWEEN ?3 AND ?4 GROUP BY source, medium, campaign ORDER BY submissions DESC, source, medium, campaign LIMIT 20").bind(context.ownerId, analyticsFor, dateWindow.current.start, dateWindow.current.end).all().catch(() => ({ results: [] })),
      env.DB.prepare("SELECT metric_date AS metricDate, page_loads AS pageLoads, submissions FROM marketing_daily_analytics WHERE owner_id = ?1 AND asset_id = ?2 AND metric_date BETWEEN ?3 AND ?4 ORDER BY metric_date DESC LIMIT 366").bind(context.ownerId, analyticsFor, dateWindow.previous.start, dateWindow.previous.end).all(),
      env.DB.prepare("SELECT COALESCE(NULLIF(json_extract(data, '$.attribution.utm_source'), ''), 'Not tagged') AS source, COALESCE(NULLIF(json_extract(data, '$.attribution.utm_medium'), ''), '') AS medium, COALESCE(NULLIF(json_extract(data, '$.attribution.utm_campaign'), ''), '') AS campaign, COUNT(*) AS submissions FROM marketing_submissions WHERE owner_id = ?1 AND asset_id = ?2 AND date(created_at) BETWEEN ?3 AND ?4 GROUP BY source, medium, campaign ORDER BY submissions DESC, source, medium, campaign LIMIT 20").bind(context.ownerId, analyticsFor, dateWindow.previous.start, dateWindow.previous.end).all().catch(() => ({ results: [] })),
    ]);
    const current = summarizeMarketingAnalytics((rows.results || []) as Array<{ metricDate: string; pageLoads: number; submissions: number }>, (attributionRows.results || []) as Array<{ source: string | null; medium: string | null; campaign: string | null; submissions: number }>);
    const previous = summarizeMarketingAnalytics((previousRows.results || []) as Array<{ metricDate: string; pageLoads: number; submissions: number }>, (previousAttributionRows.results || []) as Array<{ source: string | null; medium: string | null; campaign: string | null; submissions: number }>);
    return Response.json({ analytics: { ...current, previous: { pageLoads: previous.pageLoads, submissions: previous.submissions, submissionRate: previous.submissionRate, byCampaign: previous.byCampaign }, dateWindow: { ...dateWindow.current, previous: dateWindow.previous } } }, { headers: { "Cache-Control": "no-store" } });
  }
  const historyFor = url.searchParams.get("history") === "1" ? url.searchParams.get("assetId") || "" : "";
  if (historyFor) {
    const owned = await env.DB.prepare("SELECT id FROM marketing_assets WHERE owner_id = ?1 AND id = ?2").bind(context.ownerId, historyFor).first();
    if (!owned) return Response.json({ error: "That project was not found for this workspace." }, { status: 404 });
    const versions = await env.DB.prepare("SELECT version, saved_at AS savedAt FROM marketing_asset_versions WHERE owner_id = ?1 AND asset_id = ?2 ORDER BY version DESC LIMIT 25").bind(context.ownerId, historyFor).all();
    return Response.json({ versions: versions.results || [] }, { headers: { "Cache-Control": "no-store" } });
  }
  const executionsFor = url.searchParams.get("executions") === "1" ? url.searchParams.get("assetId") || "" : "";
  if (executionsFor) {
    const owned = await env.DB.prepare("SELECT id FROM marketing_assets WHERE owner_id = ?1 AND id = ?2 AND kind = 'automation'").bind(context.ownerId, executionsFor).first();
    if (!owned) return Response.json({ error: "That automation was not found for this workspace." }, { status: 404 });
    const rows = await env.DB.prepare("SELECT id, trigger_key AS triggerKey, status, input, result, run_at AS runAt, created_at AS createdAt, updated_at AS updatedAt FROM marketing_executions WHERE owner_id = ?1 AND automation_id = ?2 ORDER BY created_at DESC LIMIT 50").bind(context.ownerId, executionsFor).all();
    return Response.json({ executions: rows.results || [] }, { headers: { "Cache-Control": "no-store" } });
  }
  const kind = url.searchParams.get("kind") || "";
  if (kind && !kinds.has(kind)) return Response.json({ error: "Choose a supported builder." }, { status: 400 });
  const page = normalizeMarketingPage({ limit: url.searchParams.get("limit"), offset: url.searchParams.get("offset") });
  const limitParam = kind ? 3 : 2;
  const offsetParam = kind ? 4 : 3;
  const result = await env.DB.prepare(`SELECT id, client_id AS clientId, kind, folder_id AS folderId, name, slug, status, version, data, published_data IS NOT NULL AS hasPublishedVersion, created_at AS createdAt, updated_at AS updatedAt FROM marketing_assets WHERE owner_id = ?1 ${kind ? "AND kind = ?2" : ""} ORDER BY updated_at DESC, id DESC LIMIT ?${limitParam} OFFSET ?${offsetParam}`).bind(...(kind ? [context.ownerId, kind, page.limit + 1, page.offset] : [context.ownerId, page.limit + 1, page.offset])).all();
  const assetPage = buildMarketingPageResult((result.results || []) as Record<string, unknown>[], page) as { items: Record<string, unknown>[]; hasMore: boolean; nextOffset: number | null };
  const folderResult = await env.DB.prepare(`SELECT id, kind, name, created_at AS createdAt FROM marketing_folders WHERE owner_id = ?1 ${kind ? "AND kind = ?2" : ""} ORDER BY name COLLATE NOCASE`).bind(...(kind ? [context.ownerId, kind] : [context.ownerId])).all();
  const reusableBlocks = kind === "funnel" ? await listMarketingReusableBlocks(env.DB, context.ownerId) : [];
  const submissionRetentionDays = await getMarketingSubmissionRetention(env.DB, context.ownerId);
  const auditEvents = kind ? await listMarketingAuditEvents(env.DB, context.ownerId, kind as MarketingAuditKind, 30) : [];
  return Response.json({ assets: assetPage.items.map((row) => ({ ...row, data: safeJson(row.data) })), hasMoreAssets: assetPage.hasMore, nextAssetOffset: assetPage.nextOffset, folders: folderResult.results || [], reusableBlocks, submissionRetentionDays, auditEvents }, { headers: { "Cache-Control": "no-store" } });
}

function safeJson(value: unknown) { try { return JSON.parse(String(value || "{}")); } catch { return {}; } }

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in before saving a project." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "The private workspace database is unavailable." }, { status: 503 });
  const context = await ownerContext(user);
  if (!context) return Response.json({ error: "Only an agency owner or admin can manage these projects." }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 550_000) return Response.json({ error: "This project is too large to save." }, { status: 413 });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: "Send valid project data." }, { status: 400 }); }
  const kind = String(body.kind || "");
  if (!kinds.has(kind)) return Response.json({ error: "Choose a supported builder." }, { status: 400 });
  if (body.action === "saveSubmissionRetention") {
    const days = normalizeMarketingSubmissionRetentionDays(body.retentionDays);
    if (days === undefined) return Response.json({ error: "Choose never, 30, 90, 180 or 365 days." }, { status: 400 });
    await saveMarketingSubmissionRetention(env.DB, context.ownerId, days);
    const now = new Date().toISOString();
    await marketingAuditInsert(env.DB, { id: crypto.randomUUID(), ownerId: context.ownerId, actorId: context.actorId, clientId: null, resourceType: "workspace", resourceId: "workspace", projectKind: "workspace", action: "retention_changed", createdAt: now }).run();
    return Response.json({ submissionRetentionDays: days }, { headers: { "Cache-Control": "no-store" } });
  }
  if (body.action === "refreshMessageStatus") {
    if (kind !== "automation") return Response.json({ error: "Message status is available for automation runs." }, { status: 400 });
    const automationId = String(body.automationId || "").slice(0, 100);
    const executionId = String(body.executionId || "").slice(0, 100);
    const nodeId = String(body.nodeId || "").slice(0, 64);
    const execution = await env.DB.prepare("SELECT result FROM marketing_executions WHERE owner_id = ?1 AND automation_id = ?2 AND id = ?3").bind(context.ownerId, automationId, executionId).first<{ result: string }>();
    const automation = await env.DB.prepare("SELECT client_id AS clientId FROM marketing_assets WHERE owner_id = ?1 AND id = ?2 AND kind = 'automation'").bind(context.ownerId, automationId).first<{ clientId: string | null }>();
    if (!execution || !automation?.clientId || !nodeId) return Response.json({ error: "That message run was not found for this workspace." }, { status: 404 });
    const result = safeJson(execution.result) as { externalMessages?: Record<string, { status?: string; providerMessageId?: string; channel?: string; contactId?: string; deliveryStatus?: string; checkedAt?: string }> };
    const delivery = result.externalMessages?.[nodeId];
    if (delivery?.status !== "sent" || !delivery.providerMessageId || !delivery.contactId) return Response.json({ error: "This run has no verifiable GoHighLevel message to check." }, { status: 409 });
    const link = await env.DB.prepare("SELECT location_id AS locationId FROM gohighlevel_location_links WHERE owner_id = ?1 AND client_id = ?2").bind(context.ownerId, automation.clientId).first<{ locationId: string }>();
    if (!link) return Response.json({ error: "The client is no longer linked to its GoHighLevel location." }, { status: 409 });
    let providerResponse: Awaited<ReturnType<typeof ghlLocationRequest>>;
    try {
      providerResponse = await ghlLocationRequest(context.ownerId, automation.clientId, `/conversations/messages/${encodeURIComponent(delivery.providerMessageId)}`, "GET", undefined, "2021-04-15");
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message.slice(0, 300) : "GoHighLevel message status could not be checked." }, { status: 502 });
    }
    if (providerResponse.location.locationId !== link.locationId) return Response.json({ error: "The linked GoHighLevel location changed; the message status was not saved." }, { status: 409 });
    const verified = parseGhlMarketingMessageStatus(providerResponse.payload, { messageId: delivery.providerMessageId, contactId: delivery.contactId, locationId: link.locationId });
    if (!verified) return Response.json({ error: "GoHighLevel returned a message that could not be matched to this run and contact." }, { status: 502 });
    const checkedAt = new Date().toISOString();
    result.externalMessages![nodeId] = { ...delivery, deliveryStatus: verified.status, checkedAt };
    await env.DB.prepare("UPDATE marketing_executions SET result = ?1, updated_at = ?2 WHERE owner_id = ?3 AND automation_id = ?4 AND id = ?5").bind(JSON.stringify(result), checkedAt, context.ownerId, automationId, executionId).run();
    return Response.json({ messageId: verified.messageId, deliveryStatus: verified.status, checkedAt }, { headers: { "Cache-Control": "no-store" } });
  }
  if (body.action === "saveReusableBlock") {
    if (kind !== "funnel") return Response.json({ error: "Reusable sections are available for Funnels." }, { status: 400 });
    const name = String(body.name || "Reusable section").trim().replace(/\s+/g, " ").slice(0, 100);
    if (!name || !body.section || typeof body.section !== "object" || Array.isArray(body.section)) return Response.json({ error: "Choose a funnel section and give it a name." }, { status: 400 });
    const reusableBlock = await saveMarketingReusableBlock(env.DB, context.ownerId, name, body.section);
    return Response.json({ reusableBlock }, { status: 201 });
  }
  if (body.action === "deleteReusableBlock") {
    const id = String(body.id || "").slice(0, 100);
    if (kind !== "funnel" || !id) return Response.json({ error: "Choose a saved reusable section." }, { status: 400 });
    if (!await deleteMarketingReusableBlock(env.DB, context.ownerId, id)) return Response.json({ error: "That reusable section was not found for this workspace." }, { status: 404 });
    return Response.json({ ok: true });
  }
  if (body.action === "createFolder") {
    const folderName = String(body.name || "").trim().replace(/\s+/g, " ").slice(0, 80);
    if (!folderName) return Response.json({ error: "Enter a folder name." }, { status: 400 });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      await env.DB.prepare("INSERT INTO marketing_folders (id, owner_id, kind, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)").bind(id, context.ownerId, kind, folderName, now).run();
    } catch (reason) {
      if (String(reason).toLowerCase().includes("unique")) return Response.json({ error: "A folder with that name already exists here." }, { status: 409 });
      throw reason;
    }
    return Response.json({ folder: { id, kind, name: folderName, createdAt: now } }, { status: 201 });
  }
  if (kind === "automation" && typeof body.activation === "string") {
    const id = String(body.id || "").slice(0, 100);
    const targetStatus = body.activation === "active" ? "active" : body.activation === "paused" ? "paused" : "";
    if (!id || !targetStatus) return Response.json({ error: "Choose an automation and an active or paused state." }, { status: 400 });
    const current = await env.DB.prepare("SELECT client_id, data, name FROM marketing_assets WHERE owner_id = ?1 AND id = ?2 AND kind = 'automation'").bind(context.ownerId, id).first<{ client_id: string | null; data: string; name: string }>();
    if (!current) return Response.json({ error: "That automation was not found for this workspace." }, { status: 404 });
    if (targetStatus === "active") {
      const data = safeJson(current.data) as { nodes?: Array<{ id?: string; type?: string; label?: string; config?: string }> };
      const nodes = Array.isArray(data.nodes) ? data.nodes : [];
      const workflowError = validateMarketingAutomationNodes(nodes, current.client_id);
      if (workflowError) return Response.json({ error: workflowError }, { status: 400 });
      const trigger = parseMarketingTrigger(String(nodes[0].config || ""));
      const triggerDefinition = MARKETING_SUBMISSION_TRIGGERS.find((item) => item.id === trigger.event);
      if (!triggerDefinition) return Response.json({ error: "Choose a supported workflow trigger." }, { status: 400 });
      const scheduledTrigger = trigger.event === "specific_date_time";
      const ghlContactTrigger = isMarketingGhlContactTrigger(trigger.event);
      const ghlWebhookTrigger = ghlContactTrigger && !trigger.assetSlug;
      if (["tag_added", "tag_removed"].includes(trigger.event) && !trigger.tagName) return Response.json({ error: "Choose the GoHighLevel tag this automation should watch." }, { status: 400 });
      if (scheduledTrigger && Date.parse(trigger.runAt || "") <= Date.now()) return Response.json({ error: "Choose a future date and time before activating this workflow." }, { status: 400 });
      const source = scheduledTrigger || ghlWebhookTrigger ? null : await env.DB.prepare("SELECT id, client_id, kind, published_data AS publishedData FROM marketing_assets WHERE owner_id = ?1 AND slug = ?2 AND kind IN ('funnel','form','survey','calculator') AND published_data IS NOT NULL").bind(context.ownerId, trigger.assetSlug).first<{ id: string; client_id: string | null; kind: MarketingConversionToolKind; publishedData: string }>();
      if (!scheduledTrigger && !ghlWebhookTrigger && (!source || !triggerDefinition.kinds.includes(source.kind))) return Response.json({ error: "Publish a conversion tool that matches the selected trigger before activating this workflow." }, { status: 400 });
      if (ghlWebhookTrigger) {
        if (!current.client_id) return Response.json({ error: "Choose a client before using a GoHighLevel contact trigger." }, { status: 400 });
        const link = await env.DB.prepare("SELECT location_id FROM gohighlevel_location_links WHERE owner_id = ?1 AND client_id = ?2").bind(context.ownerId, current.client_id).first<{ location_id: string }>();
        if (!link) return Response.json({ error: "Link this client to its GoHighLevel location before activating contact triggers." }, { status: 400 });
        if (trigger.event === "date_field") {
          try {
            const customFields = await ghlLocationRequest(context.ownerId, current.client_id, `/locations/${encodeURIComponent(link.location_id)}/customFields?model=contact`);
            const available = ((customFields.payload as { customFields?: Array<Record<string, unknown>> }).customFields || []).find((field) => String(field.id) === trigger.customFieldId && field.model === "contact" && field.dataType === trigger.customFieldType);
            if (!available) return Response.json({ error: "That date field is not available in the linked GoHighLevel location. Refresh the field list and choose a contact DATE or DATE_TIME field." }, { status: 400 });
          } catch (error) { return Response.json({ error: error instanceof Error ? error.message.slice(0, 300) : "The GoHighLevel date field could not be verified." }, { status: 502 }); }
        }
      }
      if (current.client_id && source?.client_id && current.client_id !== source.client_id) return Response.json({ error: "The workflow and published conversion tool must belong to the same client." }, { status: 400 });
      for (const node of nodes.slice(1)) {
        const config = String(node.config || "").trim();
        if (node.type === "task" && (!current.client_id || !config)) return Response.json({ error: "Task steps need a selected client and a task title." }, { status: 400 });
        if (node.type === "tag" && (scheduledTrigger || !current.client_id || !/^(add|remove)\s*:\s*\S.{0,98}$/i.test(config))) return Response.json({ error: "Tag steps need a contact trigger or a submission-synced contact and an action such as add: New Lead." }, { status: 400 });
        if (node.type === "updateContact") {
          if (ghlWebhookTrigger && ["contact_updated", "tag_added", "tag_removed", "appointment_created", "appointment_approaching", "opportunity_status_changed", "opportunity_stage_changed", "birthday", "date_field", "customer_replied"].includes(trigger.event)) return Response.json({ error: "This GoHighLevel event cannot update its source contact because that can retrigger the workflow or lacks submitted contact answers. Use a task, staff email, condition, or end step instead." }, { status: 400 });
          if (scheduledTrigger || !current.client_id || (!source && !ghlWebhookTrigger)) return Response.json({ error: "Update contact steps need a selected client and a trigger that provides a synced contact." }, { status: 400 });
          const published = source ? safeJson(source.publishedData) as { fields?: Array<{ id?: string; type?: string }> } : { fields: ghlWebhookTrigger ? GHL_AUTOMATION_CONTACT_FIELDS : [] };
          const mapping = parseMarketingContactUpdate(config, published.fields || []);
          if (mapping.error) return Response.json({ error: mapping.error }, { status: 400 });
        }
        if (["customerEmail", "customerSms", "customerWhatsapp"].includes(String(node.type))) {
          if (ghlWebhookTrigger) return Response.json({ error: "Customer messages require a published submission with a required consent answer. A GoHighLevel contact event alone is not consent." }, { status: 400 });
          if (scheduledTrigger || !current.client_id || !source || source.client_id !== current.client_id) return Response.json({ error: "Customer messages need a published conversion tool and workflow linked to the same client." }, { status: 400 });
          const published = safeJson(source.publishedData) as { fields?: Array<{ id?: string; label?: string; type?: string; required?: boolean }> };
          const messageError = validateMarketingCustomerMessage(config, String(node.type), published.fields || []);
          if (messageError) return Response.json({ error: messageError }, { status: 400 });
          const parsed = JSON.parse(config) as { subject?: string; message?: string };
          const fieldIds = new Set((published.fields || []).filter((field) => !["consent", "file", "hidden", "heading", "description", "divider", "progress"].includes(String(field.type || ""))).map((field) => String(field.id || "")));
          const usedFields = [...marketingMessageTemplateFieldIds(parsed.message || ""), ...marketingMessageTemplateFieldIds(parsed.subject || "")];
          if (usedFields.some((fieldId) => !fieldIds.has(fieldId))) return Response.json({ error: "Customer message templates can use only ordinary answers from the published form." }, { status: 400 });
          const link = await env.DB.prepare("SELECT location_id FROM gohighlevel_location_links WHERE owner_id = ?1 AND client_id = ?2").bind(context.ownerId, current.client_id).first();
          if (!link) return Response.json({ error: "Link this client to a GoHighLevel sub-account before activating customer messages." }, { status: 400 });
        }
        if (scheduledTrigger && node.type === "condition") return Response.json({ error: "A scheduled workflow has no submission answers to compare in a condition." }, { status: 400 });
        if (node.type === "email") {
          const email = parseStaffEmailConfig(config);
          if (!email) return Response.json({ error: "Staff email steps need a staff recipient, a subject, and a message (maximum 200 and 5000 characters)." }, { status: 400 });
          const recipient = context.data.staff?.find((member) => member.id === email.recipientStaffId && !member.isBot && typeof member.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(member.email));
          if (!recipient) return Response.json({ error: "Choose an existing team member with a valid email address. Customer recipients are not allowed in this step." }, { status: 400 });
          const published = source ? safeJson(source.publishedData) as { fields?: Array<{ id?: string }> } : { fields: ghlWebhookTrigger ? GHL_AUTOMATION_CONTACT_FIELDS : [] };
          const fieldIds = new Set((published.fields || []).map((field) => String(field.id || "")));
          const usedFields = [...emailTemplateFieldIds(email.subject), ...emailTemplateFieldIds(email.body)].filter((fieldId) => !["clientName", "formName"].includes(fieldId));
          const invalidField = usedFields.find((fieldId) => !fieldIds.has(fieldId));
          if (invalidField) return Response.json({ error: `Email template uses “{{${invalidField}}}”, which is not a field on the selected published form.` }, { status: 400 });
        }
        if (!["condition", "wait", "waitUntil", "task", "tag", "updateContact", "email", "customerEmail", "customerSms", "customerWhatsapp", "end", "stop"].includes(String(node.type))) return Response.json({ error: `The ${node.type} step is not available for activation yet.` }, { status: 409 });
      }
    }
    const now = new Date().toISOString();
    const auditAction: MarketingAuditAction = targetStatus === "active" ? "automation_activated" : "automation_paused";
    const result = await env.DB.batch([
      env.DB.prepare("UPDATE marketing_assets SET status = ?1, updated_at = ?2 WHERE owner_id = ?3 AND id = ?4").bind(targetStatus, now, context.ownerId, id),
      marketingAuditInsert(env.DB, { id: crypto.randomUUID(), ownerId: context.ownerId, actorId: context.actorId, clientId: current.client_id, resourceType: "project", resourceId: id, resourceLabel: current.name, projectKind: "automation", action: auditAction, createdAt: now }),
    ]);
    if (!result[0]?.meta.changes) return Response.json({ error: "That automation was not found for this workspace." }, { status: 404 });
    if (targetStatus === "paused") await env.DB.prepare("UPDATE marketing_executions SET status = 'cancelled', updated_at = ?1, result = '{\"detail\":\"Automation paused by an owner.\"}' WHERE owner_id = ?2 AND automation_id = ?3 AND status = 'queued'").bind(now, context.ownerId, id).run();
    return Response.json({ ok: true, status: targetStatus });
  }
  const normalized = normalizeDraft(body, kind);
  if (normalized.clientId && !context.data.clients?.some((client) => client.id === normalized.clientId)) return Response.json({ error: "Choose a client in this workspace." }, { status: 404 });
  const folderId = String(body.folderId || "").trim().slice(0, 100) || null;
  if (folderId) {
    const folder = await env.DB.prepare("SELECT id FROM marketing_folders WHERE owner_id = ?1 AND id = ?2 AND kind = ?3").bind(context.ownerId, folderId, kind).first();
    if (!folder) return Response.json({ error: "Choose a folder in this builder." }, { status: 404 });
  }
  type SavedSection = { showWhen?: MarketingVisibility; children?: SavedSection[] };
  const savedData = safeJson(normalized.data) as { fields?: Array<{ id?: string; step?: number; showWhen?: { fieldId?: string }; options?: Array<{ nextStep?: number }> }>; sections?: SavedSection[]; funnelSteps?: unknown[] };
  if (normalized.status === "published" && kind === "funnel" && (savedData.funnelSteps?.length || 0) < 2) return Response.json({ error: "A published funnel needs at least two steps." }, { status: 400 });
  if (normalized.status === "published" && ["form", "survey", "calculator"].includes(kind) && !(savedData.fields?.length)) return Response.json({ error: "Add at least one question before publishing." }, { status: 400 });
  if (["form", "survey", "calculator", "funnel"].includes(kind)) {
    const error = validateMarketingRules((savedData.fields || []) as MarketingField[], kind === "survey");
    if (error) return Response.json({ error }, { status: 400 });
  }
  if (kind === "funnel") {
    const error = validateMarketingSectionRules((savedData.fields || []) as MarketingField[], savedData.sections || []);
    if (error) return Response.json({ error }, { status: 400 });
  }
  if (kind === "calculator") {
    const error = validateMarketingCalculator((savedData.fields || []) as MarketingField[]);
    if (error) return Response.json({ error }, { status: 400 });
  }
  if (kind === "automation" && normalized.status === "active") return Response.json({ error: "Automations stay in draft until a delivery provider and consent rules are configured." }, { status: 409 });
  const now = new Date().toISOString();
  const id = String(body.id || "").trim().slice(0, 100);
  if (body.unpublish === true && (!id || kind === "automation")) return Response.json({ error: "Choose a saved published page or form to unpublish." }, { status: 400 });
  if (id) {
    const existing = await env.DB.prepare("SELECT version, data, published_data AS publishedData FROM marketing_assets WHERE owner_id = ?1 AND id = ?2 AND kind = ?3").bind(context.ownerId, id, kind).first<{ version: number; data: string; publishedData: string | null }>();
    if (!existing) return Response.json({ error: "That project was not found for this workspace." }, { status: 404 });
    let nextData = normalized.data;
    let nextStatus = normalized.status;
    if (body.restoreVersion !== undefined) {
      const restoreVersion = Number(body.restoreVersion);
      if (!Number.isInteger(restoreVersion) || restoreVersion < 1) return Response.json({ error: "Choose a valid saved version." }, { status: 400 });
      const snapshot = await env.DB.prepare("SELECT data FROM marketing_asset_versions WHERE owner_id = ?1 AND asset_id = ?2 AND version = ?3").bind(context.ownerId, id, restoreVersion).first<{ data: string }>();
      if (!snapshot) return Response.json({ error: "That saved version could not be found." }, { status: 404 });
      nextData = snapshot.data;
      nextStatus = "draft";
    }
    const publication = resolveMarketingPublication({ status: nextStatus, nextData, existingPublishedData: existing.publishedData, unpublish: body.unpublish === true });
    nextStatus = publication.status;
    const publishedData = publication.publishedData !== null && nextStatus === "published"
      ? stampMarketingPublicationVersion(publication.publishedData, existing.version + 1)
      : publication.publishedData;
    const auditAction: MarketingAuditAction = body.restoreVersion !== undefined ? "version_restored" : body.unpublish === true ? "project_unpublished" : publication.publishedData !== null && nextStatus === "published" ? "project_published" : "project_saved";
    const result = await env.DB.batch([
      env.DB.prepare("INSERT OR IGNORE INTO marketing_asset_versions (owner_id, asset_id, version, data, saved_at) VALUES (?1, ?2, ?3, ?4, ?5)").bind(context.ownerId, id, existing.version, existing.data, now),
      env.DB.prepare("UPDATE marketing_assets SET client_id = ?1, folder_id = ?2, name = ?3, status = ?4, data = ?5, published_data = ?6, version = version + 1, updated_at = ?7 WHERE owner_id = ?8 AND id = ?9 AND kind = ?10").bind(normalized.clientId, folderId, normalized.name, nextStatus, nextData, publishedData, now, context.ownerId, id, kind),
      env.DB.prepare("DELETE FROM marketing_asset_versions WHERE owner_id = ?1 AND asset_id = ?2 AND version < (SELECT MAX(version) - 24 FROM marketing_asset_versions WHERE owner_id = ?1 AND asset_id = ?2)").bind(context.ownerId, id),
      marketingAuditInsert(env.DB, { id: crypto.randomUUID(), ownerId: context.ownerId, actorId: context.actorId, clientId: normalized.clientId, resourceType: "project", resourceId: id, resourceLabel: normalized.name, projectKind: kind as MarketingAuditKind, action: auditAction, createdAt: now }),
    ]).then((rows) => rows[1]);
    if (!result.meta.changes) return Response.json({ error: "That project was not found for this workspace." }, { status: 404 });
    const asset = await env.DB.prepare("SELECT id, client_id AS clientId, kind, folder_id AS folderId, name, slug, status, version, data, published_data IS NOT NULL AS hasPublishedVersion, created_at AS createdAt, updated_at AS updatedAt FROM marketing_assets WHERE owner_id = ?1 AND id = ?2").bind(context.ownerId, id).first<Record<string, unknown>>();
    return Response.json({ asset: asset && { ...asset, data: safeJson(asset.data) } });
  }
  const newId = crypto.randomUUID();
  const slug = `${kind}-${newId.slice(0, 8)}`;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO marketing_assets (id, owner_id, client_id, kind, folder_id, name, slug, status, version, data, published_data, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?10, ?11, ?11)").bind(newId, context.ownerId, normalized.clientId, kind, folderId, normalized.name, slug, normalized.status, normalized.data, normalized.status === "published" ? stampMarketingPublicationVersion(normalized.data, 1) : null, now),
    env.DB.prepare("INSERT INTO marketing_asset_versions (owner_id, asset_id, version, data, saved_at) VALUES (?1, ?2, 1, ?3, ?4)").bind(context.ownerId, newId, normalized.data, now),
    marketingAuditInsert(env.DB, { id: crypto.randomUUID(), ownerId: context.ownerId, actorId: context.actorId, clientId: normalized.clientId, resourceType: "project", resourceId: newId, resourceLabel: normalized.name, projectKind: kind as MarketingAuditKind, action: "project_created", createdAt: now }),
  ]);
  return Response.json({ asset: { id: newId, clientId: normalized.clientId, kind, folderId, name: normalized.name, slug, status: normalized.status, version: 1, hasPublishedVersion: normalized.status === "published", data: safeJson(normalized.data), createdAt: now, updatedAt: now } }, { status: 201 });
}

export async function DELETE(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in before deleting a project." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "The private workspace database is unavailable." }, { status: 503 });
  const context = await ownerContext(user);
  if (!context) return Response.json({ error: "Only an agency owner or admin can manage these projects." }, { status: 403 });
  const url = new URL(request.url);
  const submissionId = url.searchParams.get("submissionId") || "";
  if (submissionId) {
    if (!/^[\w-]{1,120}$/.test(submissionId)) return Response.json({ error: "That submission was not found." }, { status: 404 });
    const now = new Date().toISOString();
    const result = await deleteMarketingSubmission(env.DB, env.BUCKET, context.ownerId, submissionId, (submission) => marketingAuditInsert(env.DB!, { id: crypto.randomUUID(), ownerId: context.ownerId, actorId: context.actorId, clientId: submission.clientId, resourceType: "submission", resourceId: submissionId, resourceLabel: submission.resourceLabel ? `${submission.resourceLabel} · submission` : "Submission", projectKind: submission.projectKind as MarketingAuditKind, action: "submission_deleted", createdAt: now }));
    if (result.status === "not_found") return Response.json({ error: "That submission was not found in this workspace." }, { status: 404 });
    if (result.status === "storage_unavailable") return Response.json({ error: "The attachment store is unavailable. The submission was kept so it can be safely deleted later." }, { status: 503 });
    if (result.status === "attachment_delete_failed") return Response.json({ error: "An attached file could not be removed, so the submission was kept. Please retry." }, { status: 503 });
    return Response.json({ ok: true, deletedSubmissionId: result.submissionId, assetId: result.assetId });
  }
  const id = url.searchParams.get("id") || "";
  if (!id) return Response.json({ error: "Choose a project to delete." }, { status: 400 });
  const project = await env.DB.prepare("SELECT client_id AS clientId, kind, name FROM marketing_assets WHERE owner_id = ?1 AND id = ?2").bind(context.ownerId, id).first<{ clientId: string | null; kind: MarketingAuditKind; name: string }>();
  if (!project) return Response.json({ error: "That project was not found." }, { status: 404 });
  const attachmentRows = await env.DB.prepare("SELECT id, data FROM marketing_submissions WHERE owner_id = ?1 AND asset_id = ?2").bind(context.ownerId, id).all<{ id: string; data: string }>();
  const attachmentKeys = (attachmentRows.results || []).flatMap((row) => marketingSubmissionFileKeys(context.ownerId, row.id, row.data));
  const result = await env.DB.batch([
    env.DB.prepare("DELETE FROM marketing_asset_versions WHERE owner_id = ?1 AND asset_id = ?2").bind(context.ownerId, id),
    env.DB.prepare("DELETE FROM marketing_submissions WHERE owner_id = ?1 AND asset_id = ?2").bind(context.ownerId, id),
    env.DB.prepare("DELETE FROM marketing_executions WHERE owner_id = ?1 AND automation_id = ?2").bind(context.ownerId, id),
    env.DB.prepare("DELETE FROM marketing_assets WHERE owner_id = ?1 AND id = ?2").bind(context.ownerId, id),
    marketingAuditInsert(env.DB, { id: crypto.randomUUID(), ownerId: context.ownerId, actorId: context.actorId, clientId: project.clientId, resourceType: "project", resourceId: id, resourceLabel: project.name, projectKind: project.kind, action: "project_deleted", createdAt: new Date().toISOString() }),
  ]).then((rows) => rows[3]);
  if (!result.meta.changes) return Response.json({ error: "That project was not found." }, { status: 404 });
  if (env.BUCKET && attachmentKeys.length) await Promise.all(attachmentKeys.map((key) => env.BUCKET!.delete(key).catch((error) => console.error("Could not remove a deleted submission attachment", error))));
  return Response.json({ ok: true });
}
