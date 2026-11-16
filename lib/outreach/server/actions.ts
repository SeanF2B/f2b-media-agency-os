// Outreach API actions. Every action runs as an authorised agency admin (checked in the route).
import { env } from "cloudflare:workers";
import { decryptAiCredential, encryptAiCredential } from "@/lib/ai-credentials";
import { upsertThread, addMessage } from "@/lib/conversations/core";
import { createTelegram } from "@/lib/outreach/telegram.mjs";
import { createRegistrar, suggestDomainNames } from "@/lib/outreach/registrar.mjs";
import { planProvisioning, estimateCosts, jobProgress } from "@/lib/outreach/provisioning.mjs";
import { buildDkimScript } from "@/lib/outreach/providers/microsoft-graph.mjs";
import { prepareImport, parseCsv } from "@/lib/outreach/leads.mjs";
import { campaignAuthGate } from "@/lib/outreach/deliverability.mjs";
import { canRemoveSuppression } from "@/lib/outreach/reply-handling.mjs";
import { buildPlaybookContext, buildCopywriterMessages, correctionFromEdit, parseJsonReply, KINDS } from "@/lib/outreach/playbook.mjs";
import { buildMessage, newMessageId, replySubject } from "@/lib/outreach/mime.mjs";
import { rampProgress, dailyAllowance } from "@/lib/outreach/ramp.mjs";
import { DOMAIN_BLOCKLISTS, interpretBlocklist, buildDeliverabilityReport } from "@/lib/outreach/deliverability-report.mjs";
import { monthlyCosts } from "@/lib/outreach/costs.mjs";
import { newPlacementToken, seedAuthorizeUrl } from "@/lib/outreach/placement.mjs";
import { templateVariables } from "@/lib/outreach/personalise.mjs";
import { aiText, openRouterMonthUsd } from "./ai";
import { mailHost, verifyHost, type HostName } from "./hosts";
import { checkDomainAuth, dohA, planAndApply, rollbackChange } from "./dns";
import { audit, cloudflareAccountId, cloudflareToken, db, ensureOutreachSchema, getSettings, listConnections, nowIso, parseJson, purchasesEnabled, removeConnection, saveConnection, saveSettings, telegramConfig, todayUtc, uuid, type OutreachSettings } from "./store";

type Row = Record<string, any>;
type Ctx = { ownerId: string; actor: string; origin: string };
export class ActionError extends Error { constructor(message: string, public status = 400) { super(message); } }
const placeholders = (count: number, start = 1) => Array.from({ length: count }, (_, index) => `?${index + start}`).join(", ");
const str = (value: unknown, max = 500) => String(value ?? "").trim().slice(0, max);
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const domainRe = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

// ============================ state ============================
export async function loadState(ctx: Ctx, query: URLSearchParams) {
  await ensureOutreachSchema();
  const database = db();
  const { ownerId } = ctx;
  const settings = await getSettings(ownerId);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.get("from") || "") ? String(query.get("from")) : new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.get("to") || "") ? String(query.get("to")) : todayUtc();
  const campaignFilter = str(query.get("campaign"), 60);
  const [connections, telegram, mailboxRows, domainRows, campaignRows, jobRows, seedRows, testRows, suppressions] = await Promise.all([
    listConnections(ownerId), telegramConfig(ownerId).catch(() => null),
    database.prepare("SELECT * FROM outreach_mailboxes WHERE owner_id = ?1 ORDER BY domain, email").bind(ownerId).all<Row>(),
    database.prepare("SELECT * FROM outreach_domains WHERE owner_id = ?1 ORDER BY domain").bind(ownerId).all<Row>(),
    database.prepare("SELECT * FROM outreach_campaigns WHERE owner_id = ?1 ORDER BY updated_at DESC LIMIT 100").bind(ownerId).all<Row>(),
    database.prepare("SELECT * FROM outreach_jobs WHERE owner_id = ?1 AND kind = 'provision' ORDER BY created_at DESC LIMIT 10").bind(ownerId).all<Row>(),
    database.prepare("SELECT id, provider, email, status, last_error FROM outreach_seeds WHERE owner_id = ?1").bind(ownerId).all<Row>(),
    database.prepare("SELECT * FROM outreach_placement_tests WHERE owner_id = ?1 ORDER BY created_at DESC LIMIT 20").bind(ownerId).all<Row>(),
    database.prepare("SELECT COUNT(*) AS n FROM outreach_suppressions WHERE owner_id = ?1").bind(ownerId).first<Row>(),
  ]);
  const mailboxes = mailboxRows.results || [];
  const day = todayUtc();
  const todayCounts = mailboxes.length ? Object.fromEntries(((await database.prepare(`SELECT mailbox_id, sent FROM outreach_mailbox_days WHERE day = ?1 AND mailbox_id IN (${placeholders(mailboxes.length, 2)})`).bind(day, ...mailboxes.map((mailbox) => mailbox.id)).all<Row>()).results || []).map((row) => [row.mailbox_id, Number(row.sent)])) : {};
  const domains = domainRows.results || [];
  const domainMap = Object.fromEntries(domains.map((domain) => [domain.domain, domain]));
  const campaigns = campaignRows.results || [];
  const campaignIds = campaigns.map((campaign) => campaign.id);
  const steps = campaignIds.length ? (await database.prepare(`SELECT * FROM outreach_steps WHERE campaign_id IN (${placeholders(campaignIds.length)}) ORDER BY position`).bind(...campaignIds).all<Row>()).results || [] : [];

  // Overview metrics for the date range (indexed queries only).
  const rangeStart = `${from}T00:00:00.000Z`; const rangeEnd = `${to}T23:59:59.999Z`;
  const campaignClause = campaignFilter ? " AND campaign_id = ?4" : "";
  const bind = campaignFilter ? [ownerId, rangeStart, rangeEnd, campaignFilter] : [ownerId, rangeStart, rangeEnd];
  const sentByCampaign = (await database.prepare(`SELECT campaign_id, COUNT(*) AS n FROM outreach_sends WHERE owner_id = ?1 AND status = 'sent' AND sent_at BETWEEN ?2 AND ?3${campaignClause} GROUP BY campaign_id`).bind(...bind).all<Row>()).results || [];
  const repliesByLabel = (await database.prepare(`SELECT campaign_id, label, COUNT(*) AS n FROM outreach_replies WHERE owner_id = ?1 AND received_at BETWEEN ?2 AND ?3${campaignClause} GROUP BY campaign_id, label`).bind(...bind).all<Row>()).results || [];
  const reviewCount = await database.prepare("SELECT COUNT(*) AS n FROM outreach_replies WHERE owner_id = ?1 AND needs_review = 1 AND reply_status IN ('open','drafted')").bind(ownerId).first<Row>();
  const meetings = await database.prepare("SELECT COUNT(*) AS n FROM crm_opportunities o JOIN crm_pipeline_stages s ON s.id = o.stage_id WHERE o.owner_id = ?1 AND o.source = 'Outreach' AND o.updated_at BETWEEN ?2 AND ?3 AND lower(s.name) LIKE '%meeting%'").bind(ownerId, rangeStart, rangeEnd).first<Row>().catch(() => null);
  const qualified = await database.prepare("SELECT COUNT(*) AS n FROM crm_opportunities o JOIN crm_pipeline_stages s ON s.id = o.stage_id WHERE o.owner_id = ?1 AND o.source = 'Outreach' AND o.updated_at BETWEEN ?2 AND ?3 AND (lower(s.name) LIKE '%qualif%' OR s.position >= (SELECT MIN(position) FROM crm_pipeline_stages s2 WHERE s2.pipeline_id = s.pipeline_id AND lower(s2.name) LIKE '%qualif%'))").bind(ownerId, rangeStart, rangeEnd).first<Row>().catch(() => null);
  const sum = (rows: Row[], filter: (row: Row) => boolean = () => true) => rows.filter(filter).reduce((total, row) => total + Number(row.n), 0);
  const sentTotal = sum(sentByCampaign);
  const positive = sum(repliesByLabel, (row) => row.label === "positive");

  const monthStart = `${day.slice(0, 7)}-01`;
  const aiUsage = (await database.prepare("SELECT feature, calls, tokens_in, tokens_out, cost_usd FROM outreach_ai_usage WHERE owner_id = ?1 AND day >= ?2").bind(ownerId, monthStart).all<Row>()).results || [];
  const costs = monthlyCosts({ mailboxes: mailboxes.map((mailbox) => ({ monthly_cost_cents: mailbox.monthly_cost_cents ?? null, status: mailbox.status })), domains: domains.map((domain) => ({ annual_cost_cents: domain.annual_cost_cents ?? null, protected: domain.protected })), aiUsage: aiUsage as never, openRouterMonthUsd: query.get("costs") === "1" ? await openRouterMonthUsd(ownerId) : null, workersPlanCents: settings.workersPlanCents });

  const jobs = await Promise.all((jobRows.results || []).map(async (job) => {
    const jobSteps = (await database.prepare("SELECT step_key, position, status, attempts, message, next_attempt_at, result_json FROM outreach_job_steps WHERE job_id = ?1 ORDER BY position").bind(job.id).all<Row>()).results || [];
    const shaped = jobSteps.map((row) => { const meta = parseJson<Row>(row.result_json, {}); return { key: row.step_key, position: row.position, status: row.status, attempts: row.attempts, message: row.message, nextAttemptAt: row.next_attempt_at, kind: meta.step?.kind, label: meta.step?.label, domain: meta.step?.domain, email: meta.step?.email, manual: Boolean(meta.step?.manual), chargeable: Boolean(meta.step?.chargeable), note: meta.step?.note }; });
    return { id: job.id, status: job.status, createdAt: job.created_at, input: parseJson<Row>(job.input_json, {}), progress: jobProgress(shaped as never), steps: shaped };
  }));

  const issues: Array<{ level: "critical" | "warning"; text: string }> = [];
  for (const mailbox of mailboxes) if (mailbox.status === "error" || mailbox.status === "paused") issues.push({ level: mailbox.status === "error" ? "critical" : "warning", text: `${mailbox.email}: ${mailbox.paused_reason || mailbox.status}` });
  for (const domain of domains) { const check = parseJson<Row>(domain.last_check_json, {}); if (check.checkedAt && !check.allPass && !domain.protected) issues.push({ level: "critical", text: `${domain.domain}: ${(check.details || []).join(" ")}` }); }
  for (const job of jobs) if (job.progress.failed) issues.push({ level: "critical", text: `Setup needs attention: ${job.steps.filter((step) => step.status === "failed").map((step) => `${step.label} (${step.email || step.domain}) — ${step.message}`).join("; ")}` });

  return {
    settings: { ...settings, appUrl: settings.appUrl || ctx.origin },
    purchasesEnabled: purchasesEnabled(),
    connections: [...connections.filter((connection) => connection.provider !== "telegram"), { provider: "telegram", status: telegram?.botToken ? (telegram.chatId ? "ok" : "needs-chat") : "missing", config: { chatId: telegram?.chatId || "", source: telegram?.source || null }, lastError: "", verifiedAt: null, fingerprint: telegram?.botToken ? telegram.botToken.slice(-4) : "" }],
    range: { from, to, campaign: campaignFilter },
    overview: {
      sent: sentTotal, positive, positiveRate: sentTotal ? positive / sentTotal : null, replies: sum(repliesByLabel), qualified: Number(qualified?.n || 0), meetings: Number(meetings?.n || 0),
      activeCampaigns: campaigns.filter((campaign) => campaign.status === "active").length, activeMailboxes: mailboxes.filter((mailbox) => ["active", "ramping"].includes(mailbox.status)).length,
      warming: mailboxes.filter((mailbox) => mailbox.status === "ramping").length, reviewQueue: Number(reviewCount?.n || 0), issues,
      health: (() => { const scored = mailboxes.map((mailbox) => parseJson<Row>(mailbox.health_json, {})).filter((health) => typeof health.score === "number"); return scored.length ? Math.round(scored.reduce((total, health) => total + health.score, 0) / scored.length) : null; })(),
    },
    costs,
    mailboxes: mailboxes.map((mailbox) => {
      const health = parseJson<Row>(mailbox.health_json, {});
      const allowance = dailyAllowance({ rampStartedAt: mailbox.ramp_started_at, targetDaily: mailbox.target_daily, domainRegisteredAt: domainMap[mailbox.domain]?.registered_at || null, healthBand: health.band || "grey", sentToday: todayCounts[mailbox.id] || 0 });
      return { id: mailbox.id, email: mailbox.email, domain: mailbox.domain, host: mailbox.host, displayName: mailbox.display_name, firstName: mailbox.first_name || String(mailbox.display_name || "").split(" ")[0] || "", lastName: mailbox.last_name || String(mailbox.display_name || "").split(" ").slice(1).join(" "), photo: mailbox.photo_data || "", profileSyncedAt: mailbox.profile_synced_at, warmupPending: Boolean(health.warmupRequestedAt) && !["ramping", "active"].includes(mailbox.status), authMissing: (parseJson<Row>(domainMap[mailbox.domain]?.last_check_json, {}).details || []) as string[], group: mailbox.group_label, tags: parseJson<string[]>(mailbox.tags_json, []), clientId: mailbox.client_id, status: mailbox.status, pausedReason: mailbox.paused_reason, targetDaily: mailbox.target_daily, sentToday: todayCounts[mailbox.id] || 0, limitToday: allowance.limit, rampPhase: allowance.phase, rampReason: allowance.reason, rampProgress: rampProgress({ rampStartedAt: mailbox.ramp_started_at, targetDaily: mailbox.target_daily }), health, monthlyCostCents: mailbox.monthly_cost_cents, renewsAt: mailbox.renews_at, campaigns: campaigns.filter((campaign) => parseJson<string[]>(campaign.mailbox_ids_json, []).includes(mailbox.id)).map((campaign) => ({ id: campaign.id, name: campaign.name })) };
    }),
    domains: domains.map((domain) => ({ id: domain.id, domain: domain.domain, host: domain.mail_host, protected: Boolean(domain.protected), check: parseJson<Row>(domain.last_check_json, {}), expiresAt: domain.expires_at, annualCostCents: domain.annual_cost_cents, dmarcStage: domain.dmarc_stage })),
    campaigns: campaigns.map((campaign) => ({
      id: campaign.id, name: campaign.name, status: campaign.status, clientId: campaign.client_id, niche: campaign.niche, offer: campaign.offer, mailboxIds: parseJson<string[]>(campaign.mailbox_ids_json, []), schedule: parseJson(campaign.schedule_json, {}), dailyCap: campaign.daily_cap, lawfulBasis: campaign.lawful_basis, pipelineId: campaign.pipeline_id, stageId: campaign.stage_id, updatedAt: campaign.updated_at,
      steps: steps.filter((step) => step.campaign_id === campaign.id).map((step) => ({ id: step.id, position: step.position, delayDays: step.delay_days, variants: parseJson(step.variants_json, []) })),
      stats: { sent: sum(sentByCampaign, (row) => row.campaign_id === campaign.id), replies: sum(repliesByLabel, (row) => row.campaign_id === campaign.id), positive: sum(repliesByLabel, (row) => row.campaign_id === campaign.id && row.label === "positive") },
    })),
    jobs,
    seeds: seedRows.results || [],
    placementTests: (testRows.results || []).map((test) => ({ id: test.id, mailboxId: test.mailbox_id, status: test.status, inboxRate: test.inbox_rate, results: parseJson(test.results_json, []), createdAt: test.created_at, completedAt: test.completed_at })),
    suppressionCount: Number(suppressions?.n || 0),
    playbookKinds: KINDS,
    seedAppsConfigured: { gmail: Boolean((env as unknown as Row).OUTREACH_SEED_GOOGLE_CLIENT_ID), outlook: Boolean((env as unknown as Row).OUTREACH_SEED_MS_CLIENT_ID) },
  };
}

// ============================ actions ============================
export async function runAction(ctx: Ctx, body: Row): Promise<Row> {
  await ensureOutreachSchema();
  const action = str(body.action, 60);
  const handler = HANDLERS[action];
  if (!handler) throw new ActionError("Unknown action.");
  return handler(ctx, body);
}

/** Plans (and optionally applies) the mail DNS a domain needs: MX, SPF include, DMARC. Protected domains are never changed. */
async function repairDomainDns(ctx: Ctx, domain: string, apply: boolean, reason: string) {
  const row = await db().prepare("SELECT mail_host FROM outreach_domains WHERE owner_id = ?1 AND domain = ?2").bind(ctx.ownerId, domain).first<Row>();
  if (!row || !["microsoft", "google"].includes(row.mail_host)) throw new ActionError("Domain not found or not on a connected mail host.", 404);
  const host = await mailHost(ctx.ownerId, row.mail_host);
  const settings = await getSettings(ctx.ownerId);
  const service = await host.serviceRecords(domain);
  const desired = { mx: service.filter((record) => record.type === "MX").map((record) => ({ host: record.content, priority: record.priority ?? 0 })), spfIncludes: [host.spfInclude], dmarc: { policy: "none" as const, rua: settings.dmarcReportEmail || undefined } };
  const result = await planAndApply(ctx.ownerId, { domain, desired, apply, actor: ctx.actor, reason });
  if (apply) await audit(ctx.ownerId, ctx.actor, "dns-apply", domain, { applied: result.applied });
  return result;
}

const DKIM_HELP: Record<string, string> = {
  google: "Switch on DKIM in Google Admin → Apps → Google Workspace → Gmail → Authenticate email → Generate new record, then Start authentication. Outreach keeps checking and starts warm-up once it's live.",
  microsoft: "Switch on DKIM in Microsoft Defender → Email & collaboration → Policies → Email authentication settings → DKIM (or run the bulk script from Domains). Outreach keeps checking and starts warm-up once it's live.",
};

const HANDLERS: Record<string, (ctx: Ctx, body: Row) => Promise<Row>> = {
  async "save-settings"(ctx, body) {
    const patch: Partial<OutreachSettings> = {};
    if (body.cooldownDays !== undefined) patch.cooldownDays = Number(body.cooldownDays);
    if (body.bookingUrl !== undefined) { const url = str(body.bookingUrl, 400); if (url && !/^https:\/\//.test(url)) throw new ActionError("The booking link must start with https://"); patch.bookingUrl = url; }
    if (body.seatPriceCents) patch.seatPriceCents = { microsoft: numOrNull(body.seatPriceCents.microsoft), google: numOrNull(body.seatPriceCents.google), smtp: numOrNull(body.seatPriceCents.smtp) };
    if (body.workersPlanCents !== undefined) patch.workersPlanCents = numOrNull(body.workersPlanCents);
    if (body.defaultTargetDaily !== undefined) patch.defaultTargetDaily = Number(body.defaultTargetDaily);
    if (body.dmarcReportEmail !== undefined) { const value = str(body.dmarcReportEmail, 200); if (value && !emailRe.test(value)) throw new ActionError("Enter a valid DMARC report email."); patch.dmarcReportEmail = value; }
    if (body.senderAddress !== undefined) patch.senderAddress = str(body.senderAddress, 300);
    if (body.appUrl !== undefined) patch.appUrl = str(body.appUrl, 300);
    return { settings: await saveSettings(ctx.ownerId, patch) };
  },

  async "connect-microsoft"(ctx, body) {
    const tenantId = str(body.tenantId, 100), clientId = str(body.clientId, 100), clientSecret = str(body.clientSecret, 300);
    if (!/^[a-z0-9.-]{3,100}$/i.test(tenantId) || !/^[0-9a-f-]{36}$/i.test(clientId) || clientSecret.length < 10) throw new ActionError("Enter the tenant ID, application (client) ID and client secret.");
    await saveConnection(ctx.ownerId, "microsoft", { clientSecret }, { tenantId, clientId }, "unverified");
    const result = await verifyHost(ctx.ownerId, "microsoft");
    await audit(ctx.ownerId, ctx.actor, "connect-microsoft", tenantId, { ok: result.ok });
    return result;
  },
  async "connect-google"(ctx, body) {
    let serviceAccount: Row;
    try { serviceAccount = typeof body.serviceAccountJson === "string" ? JSON.parse(body.serviceAccountJson) : body.serviceAccountJson; } catch { throw new ActionError("That isn't a valid service-account JSON key."); }
    const adminEmail = str(body.adminEmail, 200).toLowerCase();
    if (!serviceAccount?.client_email || !serviceAccount?.private_key) throw new ActionError("The JSON key needs client_email and private_key.");
    if (!emailRe.test(adminEmail)) throw new ActionError("Enter the Google Workspace super-admin email.");
    await saveConnection(ctx.ownerId, "google", { serviceAccount: { client_email: serviceAccount.client_email, private_key: serviceAccount.private_key } }, { adminEmail, clientEmail: serviceAccount.client_email }, "unverified");
    const result = await verifyHost(ctx.ownerId, "google");
    await audit(ctx.ownerId, ctx.actor, "connect-google", adminEmail, { ok: result.ok });
    return result;
  },
  async "connect-telegram"(ctx, body) {
    const existing = await telegramConfig(ctx.ownerId);
    const chatId = str(body.chatId, 40);
    if (chatId && !/^-?\d{4,20}$/.test(chatId)) throw new ActionError("The chat ID is a number (group IDs start with -).");
    const botToken = str(body.botToken, 120);
    if (!existing?.botToken && !botToken) throw new ActionError("No existing bot token was found in the server secrets. Paste the existing F2B bot's token once.");
    await saveConnection(ctx.ownerId, "telegram", botToken ? { botToken } : { botToken: existing?.source === "outreach-settings" ? existing.botToken : "" }, { chatId: chatId || existing?.chatId || "" }, "ok");
    const config = await telegramConfig(ctx.ownerId);
    const me = config ? await createTelegram(config).verify() : null;
    return { ok: true, source: config?.source, bot: me };
  },
  async "telegram-test"(ctx) {
    const config = await telegramConfig(ctx.ownerId);
    if (!config?.chatId) throw new ActionError("Connect Telegram and add a chat ID first.");
    await createTelegram(config).send("✅ <b>F2B Outreach</b> is connected. You'll only hear from me about positive replies and critical infrastructure problems.");
    return { ok: true };
  },
  async "remove-connection"(ctx, body) {
    const provider = str(body.provider, 20);
    if (!["microsoft", "google", "telegram", "postmaster"].includes(provider)) throw new ActionError("Unknown connection.");
    await removeConnection(ctx.ownerId, provider as never);
    await audit(ctx.ownerId, ctx.actor, "remove-connection", provider);
    return { ok: true };
  },

  // ---------------- domains & provisioning ----------------
  async "domains-suggest"(ctx, body) {
    const registrar = await registrarFor(ctx.ownerId);
    const names = suggestDomainNames(str(body.businessName, 80), { count: 16 });
    const [offers, extra] = await Promise.all([names.length ? registrar.check(names) : Promise.resolve([]), str(body.businessName, 80) ? registrar.search(str(body.businessName, 80), { limit: 8 }).catch(() => []) : Promise.resolve([])]);
    const all = [...offers, ...extra].filter((offer, index, list) => list.findIndex((other) => other.domain === offer.domain) === index);
    return { offers: all.sort((a, b) => Number(b.available) - Number(a.available) || a.registrationCents - b.registrationCents) };
  },
  async "domains-check"(ctx, body) {
    const names = (Array.isArray(body.domains) ? body.domains : []).map((value: unknown) => str(value, 253).toLowerCase()).filter((value: string) => domainRe.test(value)).slice(0, 50);
    if (!names.length) throw new ActionError("Enter at least one domain.");
    return { offers: await (await registrarFor(ctx.ownerId)).check(names) };
  },
  async "provision-plan"(ctx, body) {
    const order = normaliseOrder(body);
    const plan = planProvisioning(order);
    const settings = await getSettings(ctx.ownerId);
    const costs = estimateCosts({ domains: order.domains, mailboxCount: plan.mailboxes, mailboxMonthlyCents: settings.seatPriceCents[order.host] ?? 0 });
    let seats: Array<{ sku: string; free: number; total: number }> = [];
    try { seats = await (await mailHost(ctx.ownerId, order.host)).seats(); } catch { /* not connected yet */ }
    return { plan, costs, seats, purchasesEnabled: purchasesEnabled(), buying: order.domains.filter((domain) => domain.buy).map((domain) => domain.domain) };
  },
  async "provision-start"(ctx, body) {
    const order = normaliseOrder(body);
    const buying = order.domains.filter((domain) => domain.buy).map((domain) => domain.domain);
    if (buying.length && body.approvePurchase !== true) throw new ActionError(`Tick "I approve buying ${buying.length} domain(s)" to continue. Nothing has been bought.`);
    const connections = await listConnections(ctx.ownerId);
    if (!connections.some((connection) => connection.provider === order.host && connection.status === "ok")) throw new ActionError(`Connect ${order.host === "microsoft" ? "Microsoft 365" : "Google Workspace"} first.`);
    const plan = planProvisioning(order);
    const idempotencyKey = await sha256(JSON.stringify({ host: order.host, domains: order.domains.map((domain) => domain.domain).sort(), identities: order.identities.map((identity) => identity.local).sort() }));
    const database = db();
    const jobId = uuid();
    const now = nowIso();
    const insert = await database.prepare("INSERT INTO outreach_jobs (id, owner_id, kind, idempotency_key, status, input_json, approved_by, approved_at, created_at, updated_at) VALUES (?1, ?2, 'provision', ?3, 'running', ?4, ?5, ?6, ?7, ?7) ON CONFLICT(owner_id, idempotency_key) DO NOTHING")
      .bind(jobId, ctx.ownerId, idempotencyKey, JSON.stringify(order), buying.length ? ctx.actor : null, buying.length ? now : null, now).run();
    if (!insert.meta?.changes) throw new ActionError("This exact setup is already running or finished — no duplicate domains or mailboxes were created.", 409);
    await database.batch(plan.steps.map((step) => database.prepare("INSERT INTO outreach_job_steps (job_id, step_key, position, status, attempts, message, result_json, updated_at) VALUES (?1, ?2, ?3, 'pending', 0, '', ?4, ?5)").bind(jobId, step.key, step.position, JSON.stringify({ step }), now)));
    await audit(ctx.ownerId, ctx.actor, "provision-start", jobId, { domains: order.domains.map((domain) => domain.domain), buying, mailboxes: plan.mailboxes, purchasesEnabled: purchasesEnabled() });
    return { jobId, steps: plan.steps.length };
  },
  async "job-retry"(ctx, body) {
    const jobId = str(body.jobId, 60), stepKey = str(body.stepKey, 300);
    const job = await db().prepare("SELECT id FROM outreach_jobs WHERE id = ?1 AND owner_id = ?2").bind(jobId, ctx.ownerId).first<Row>();
    if (!job) throw new ActionError("Job not found.", 404);
    await db().batch([
      db().prepare("UPDATE outreach_job_steps SET status = 'pending', attempts = 0, next_attempt_at = NULL, message = 'Retry requested' WHERE job_id = ?1 AND step_key = ?2 AND status IN ('failed', 'waiting', 'retry')").bind(jobId, stepKey),
      db().prepare("UPDATE outreach_jobs SET status = 'running', updated_at = ?2 WHERE id = ?1").bind(jobId, nowIso()),
    ]);
    await audit(ctx.ownerId, ctx.actor, "job-retry", `${jobId}/${stepKey}`);
    return { ok: true };
  },
  async "dkim-script"(ctx) {
    const rows = (await db().prepare("SELECT domain FROM outreach_domains WHERE owner_id = ?1 AND mail_host = 'microsoft' AND protected = 0").bind(ctx.ownerId).all<Row>()).results || [];
    const pending = rows.map((row) => String(row.domain));
    return { script: buildDkimScript(pending), domains: pending };
  },
  async "connect-existing-mailbox"(ctx, body) {
    const host = (body.host === "google" ? "google" : "microsoft") as HostName;
    const email = str(body.email, 200).toLowerCase();
    if (!emailRe.test(email)) throw new ActionError("Enter the mailbox email address.");
    const adapter = await mailHost(ctx.ownerId, host);
    if (!await adapter.mailboxReady(email)) throw new ActionError(`${email} isn't reachable through the connected ${host === "google" ? "Google Workspace" : "Microsoft 365"} account.`);
    const domain = email.split("@")[1];
    const settings = await getSettings(ctx.ownerId);
    const database = db();
    const now = nowIso();
    // Outreach may manage DNS only for a dedicated outreach domain, never your main business domain.
    const primaryDomain = (ctx.actor.split("@")[1] || "").toLowerCase();
    const manage = body.manageDns === true && domain !== primaryDomain;
    await database.batch([
      database.prepare("INSERT INTO outreach_domains (id, owner_id, domain, mail_host, protected, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) ON CONFLICT(owner_id, domain) DO NOTHING").bind(uuid(), ctx.ownerId, domain, host, manage ? 0 : 1, now),
      database.prepare("INSERT INTO outreach_mailboxes (id, owner_id, email, domain, host, host_user_id, display_name, group_label, status, target_daily, monthly_cost_cents, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?3, ?6, ?7, 'setup', ?8, ?9, ?10, ?10) ON CONFLICT(owner_id, email) DO NOTHING")
        .bind(uuid(), ctx.ownerId, email, domain, host, str(body.displayName, 80) || email.split("@")[0], str(body.group, 60), Math.min(settings.defaultTargetDaily, Number(body.targetDaily) || settings.defaultTargetDaily), settings.seatPriceCents[host] ?? null, now),
    ]);
    const check = await checkDomainAuth(ctx.ownerId, domain, host, adapter.dkimSelectors);
    await audit(ctx.ownerId, ctx.actor, "connect-existing-mailbox", email, { domain, auth: check.allPass });
    return { ok: true, check, protected: !manage, primaryDomain: domain === primaryDomain };
  },
  async "warmup-auto"(ctx, body) {
    // One click: check authentication, repair what Outreach is allowed to repair, start the ramp the
    // moment everything passes (the engine re-checks every few minutes), and say plainly what's left.
    const ids = (Array.isArray(body.ids) ? body.ids : []).map((value: unknown) => str(value, 60)).filter(Boolean).slice(0, 200);
    if (!ids.length) throw new ActionError("Select at least one mailbox.");
    const database = db();
    const rows = (await database.prepare(`SELECT m.id, m.email, m.domain, m.host, m.status, d.protected, d.mail_host FROM outreach_mailboxes m LEFT JOIN outreach_domains d ON d.owner_id = m.owner_id AND d.domain = m.domain WHERE m.owner_id = ?1 AND m.id IN (${placeholders(ids.length, 2)})`).bind(ctx.ownerId, ...ids).all<Row>()).results || [];
    const checked = new Map<string, Row>();
    const repaired = new Map<string, { applied: string[]; error?: string }>();
    const results: Array<{ email: string; state: "started" | "already" | "fixing" | "needs-you"; message: string }> = [];
    const now = nowIso();
    for (const row of rows) {
      if (["ramping", "active"].includes(row.status)) { results.push({ email: row.email, state: "already", message: "Already warming." }); continue; }
      const host = String(row.mail_host || row.host) as HostName;
      const selectors = host === "google" ? ["google"] : ["selector1", "selector2"];
      if (!checked.has(row.domain)) checked.set(row.domain, await checkDomainAuth(ctx.ownerId, row.domain, host as never, selectors));
      let check = checked.get(row.domain)!;
      if (!check.allPass && !row.protected && !repaired.has(row.domain)) {
        try {
          const fix = await repairDomainDns(ctx, row.domain, true, "One-click warm-up");
          repaired.set(row.domain, { applied: fix.applied });
          if (fix.applied.length) { check = await checkDomainAuth(ctx.ownerId, row.domain, host as never, selectors); checked.set(row.domain, check); }
        } catch (error) { repaired.set(row.domain, { applied: [], error: error instanceof Error ? error.message : "DNS couldn't be updated." }); }
      }
      if (check.allPass) {
        await database.prepare("UPDATE outreach_mailboxes SET status = 'ramping', ramp_started_at = COALESCE(ramp_started_at, ?3), paused_reason = '', health_json = json_remove(COALESCE(NULLIF(health_json, ''), '{}'), '$.warmupRequestedAt'), updated_at = ?3 WHERE owner_id = ?1 AND id = ?2").bind(ctx.ownerId, row.id, now).run();
        results.push({ email: row.email, state: "started", message: "Warm-up started." });
        continue;
      }
      // Remember the request; the engine starts warm-up by itself once the records pass.
      await database.prepare("UPDATE outreach_mailboxes SET health_json = json_set(COALESCE(NULLIF(health_json, ''), '{}'), '$.warmupRequestedAt', ?3), updated_at = ?3 WHERE owner_id = ?1 AND id = ?2").bind(ctx.ownerId, row.id, now).run();
      const repair = repaired.get(row.domain);
      const left: string[] = [];
      const details = (check.details || []) as string[];
      if (row.protected && (check.spf !== "pass" || check.dmarc !== "pass" || check.mx !== "pass")) left.push(`${row.domain} is protected, so Outreach won't change its DNS. ${details.filter((detail) => !/DKIM/.test(detail)).join(" ")} Turn off protection in Domains to let Outreach fix it, or add the records yourself.`);
      else if (repair?.error) left.push(repair.error);
      if (check.dkim !== "pass") left.push(DKIM_HELP[host] || "Publish DKIM for this domain.");
      const fixedNote = repair?.applied.length ? `Added/updated ${repair.applied.length} DNS record${repair.applied.length === 1 ? "" : "s"}. ` : "";
      results.push(left.length
        ? { email: row.email, state: "needs-you", message: `${fixedNote}${left.join(" ")}` }
        : { email: row.email, state: "fixing", message: `${fixedNote}Waiting for DNS to update — warm-up starts automatically when SPF, DKIM and DMARC pass.` });
    }
    await audit(ctx.ownerId, ctx.actor, "warmup-auto", `${rows.length} mailbox(es)`, { results: results.map((item) => `${item.email}:${item.state}`) });
    return { results };
  },
  async "deliverability-report"(ctx, body) {
    const database = db();
    const mailbox = await database.prepare("SELECT m.*, d.last_check_json, d.registered_at FROM outreach_mailboxes m LEFT JOIN outreach_domains d ON d.owner_id = m.owner_id AND d.domain = m.domain WHERE m.owner_id = ?1 AND m.id = ?2").bind(ctx.ownerId, str(body.id, 60)).first<Row>();
    if (!mailbox) throw new ActionError("Mailbox not found.", 404);
    const days = 30;
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const [day, replies, tests, dmarcTxt] = await Promise.all([
      database.prepare("SELECT COALESCE(SUM(sent),0) AS sent, COALESCE(SUM(bounced),0) AS bounced, COALESCE(SUM(complaints),0) AS complaints FROM outreach_mailbox_days WHERE mailbox_id = ?1 AND day >= ?2").bind(mailbox.id, since.slice(0, 10)).first<Row>(),
      database.prepare("SELECT COUNT(*) AS replies, SUM(CASE WHEN label IN ('positive','meeting-booked') THEN 1 ELSE 0 END) AS positive, SUM(CASE WHEN label = 'unsubscribe' THEN 1 ELSE 0 END) AS unsubscribes, SUM(CASE WHEN label = 'spam' THEN 1 ELSE 0 END) AS spam FROM outreach_replies WHERE owner_id = ?1 AND mailbox_id = ?2 AND received_at >= ?3 AND label NOT IN ('bounce','out-of-office')").bind(ctx.ownerId, mailbox.id, since).first<Row>(),
      database.prepare("SELECT completed_at, inbox_rate, results_json FROM outreach_placement_tests WHERE owner_id = ?1 AND mailbox_id = ?2 AND status = 'done' ORDER BY completed_at DESC LIMIT 3").bind(ctx.ownerId, mailbox.id).all<Row>(),
      fetch(`https://dns.google/resolve?name=${encodeURIComponent(`_dmarc.${mailbox.domain}`)}&type=TXT`, { headers: { Accept: "application/dns-json" } }).then((response) => response.json() as Promise<{ Answer?: Array<{ data: string }> }>).catch(() => ({ Answer: [] as Array<{ data: string }> })),
    ]);
    const blocklists = await Promise.all(DOMAIN_BLOCKLISTS.map(async (list) => {
      try { return interpretBlocklist(list, await dohA(`${mailbox.domain}.${list.zone}`)); } catch (error) { return interpretBlocklist(list, null, error); }
    }));
    const auth = parseJson<Row>(mailbox.last_check_json, {});
    const dmarcRecord = (dmarcTxt.Answer || []).map((answer) => String(answer.data).replace(/"/g, "")).find((value) => /v=DMARC1/i.test(value)) || "";
    const health = parseJson<Row>(mailbox.health_json, {});
    const allowance = dailyAllowance({ rampStartedAt: mailbox.ramp_started_at, targetDaily: mailbox.target_daily, domainRegisteredAt: mailbox.registered_at || null, healthBand: health.band || "grey", sentToday: 0 });
    const report = buildDeliverabilityReport({
      mailbox: { email: mailbox.email, status: mailbox.status, band: health.band, limitToday: allowance.limit, rampDay: mailbox.ramp_started_at ? Math.floor((Date.now() - Date.parse(mailbox.ramp_started_at)) / 86_400_000) + 1 : null, pausedReason: mailbox.paused_reason },
      auth: { ...auth, dmarcPolicy: /p=(\w+)/i.exec(dmarcRecord)?.[1]?.toLowerCase() },
      blocklists,
      stats: { days, sent: Number(day?.sent || 0), bounced: Number(day?.bounced || 0), complaints: Number(day?.complaints || 0) + Number(replies?.spam || 0), unsubscribes: Number(replies?.unsubscribes || 0), replies: Number(replies?.replies || 0), positive: Number(replies?.positive || 0) },
      placement: (tests.results || []).map((test) => ({ completedAt: test.completed_at, inboxRate: test.inbox_rate, results: parseJson(test.results_json, []) })),
      postmaster: health.postmaster || null,
      adaptive: health.adaptive || [],
    });
    return { email: mailbox.email, domain: mailbox.domain, generatedAt: nowIso(), dmarcRecord, ...report };
  },
  async "mailbox-profile"(ctx, body) {
    // The sender's real name and photo, pushed to the mailbox account so Outlook / Gmail show them.
    const database = db();
    const mailbox = await database.prepare("SELECT * FROM outreach_mailboxes WHERE owner_id = ?1 AND id = ?2").bind(ctx.ownerId, str(body.id, 60)).first<Row>();
    if (!mailbox) throw new ActionError("Mailbox not found.", 404);
    const clean = (value: unknown) => str(value, 40).replace(/[\r\n"<>]/g, "");
    const firstName = clean(body.firstName), lastName = clean(body.lastName);
    if (!firstName) throw new ActionError("Enter a first name.");
    let photo: string | null = null; let bytes: Uint8Array | null = null; let type = "image/jpeg";
    if (typeof body.photo === "string" && body.photo) {
      const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(body.photo);
      if (!match) throw new ActionError("Upload a JPEG or PNG photo.");
      if (match[2].length > 160_000) throw new ActionError("That photo is too large — use one under 100 KB (it's resized automatically in the app).");
      type = match[1]; photo = body.photo; bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
    }
    const removePhoto = body.photo === null;
    const displayName = `${firstName} ${lastName}`.trim();
    let synced = false; let syncError = "";
    if (mailbox.host === "microsoft" || mailbox.host === "google") {
      try {
        const host = await mailHost(ctx.ownerId, mailbox.host as HostName);
        const ref = mailbox.host_user_id || mailbox.email;
        await host.updateName(ref, { firstName, lastName });
        if (bytes) await host.setPhoto(ref, bytes, type);
        synced = true;
      } catch (error) { syncError = error instanceof Error ? error.message : "Couldn't update the mailbox account."; }
    }
    const now = nowIso();
    await database.prepare("UPDATE outreach_mailboxes SET first_name = ?3, last_name = ?4, display_name = ?5, photo_data = CASE WHEN ?6 IS NOT NULL THEN ?6 WHEN ?7 = 1 THEN '' ELSE photo_data END, profile_synced_at = CASE WHEN ?8 = 1 THEN ?9 ELSE profile_synced_at END, updated_at = ?9 WHERE owner_id = ?1 AND id = ?2")
      .bind(ctx.ownerId, mailbox.id, firstName, lastName, displayName, photo, removePhoto ? 1 : 0, synced ? 1 : 0, now).run();
    await audit(ctx.ownerId, ctx.actor, "mailbox-profile", mailbox.email, { synced, photo: Boolean(bytes), removedPhoto: removePhoto });
    return { ok: true, displayName, synced, syncError };
  },
  async "domain-check"(ctx, body) {
    const domain = str(body.domain, 253).toLowerCase();
    const row = await db().prepare("SELECT mail_host FROM outreach_domains WHERE owner_id = ?1 AND domain = ?2").bind(ctx.ownerId, domain).first<Row>();
    if (!row) throw new ActionError("Domain not found.", 404);
    const selectors = row.mail_host === "google" ? ["google"] : row.mail_host === "microsoft" ? ["selector1", "selector2"] : [];
    return { check: await checkDomainAuth(ctx.ownerId, domain, row.mail_host || "smtp", selectors) };
  },
  async "domain-protect"(ctx, body) {
    const domain = str(body.domain, 253).toLowerCase();
    await db().prepare("UPDATE outreach_domains SET protected = ?3, updated_at = ?4 WHERE owner_id = ?1 AND domain = ?2").bind(ctx.ownerId, domain, body.protected ? 1 : 0, nowIso()).run();
    await audit(ctx.ownerId, ctx.actor, body.protected ? "domain-protect" : "domain-unprotect", domain);
    return { ok: true };
  },
  async "dns-plan"(ctx, body) {
    return repairDomainDns(ctx, str(body.domain, 253).toLowerCase(), body.apply === true, "Repair from Infrastructure");
  },
  async "dns-history"(ctx, body) {
    const domain = str(body.domain, 253).toLowerCase();
    const rows = (await db().prepare("SELECT id, action, record_type, record_name, before_json, after_json, reason, actor, rolled_back_by, created_at FROM outreach_dns_changes WHERE owner_id = ?1 AND domain = ?2 ORDER BY created_at DESC LIMIT 50").bind(ctx.ownerId, domain).all<Row>()).results || [];
    return { changes: rows };
  },
  async "dns-rollback"(ctx, body) { await rollbackChange(ctx.ownerId, str(body.changeId, 60), ctx.actor); await audit(ctx.ownerId, ctx.actor, "dns-rollback", str(body.changeId, 60)); return { ok: true }; },

  // ---------------- mailboxes (bulk) ----------------
  async "mailboxes-bulk"(ctx, body) {
    const ids = (Array.isArray(body.ids) ? body.ids : []).map((value: unknown) => str(value, 60)).filter(Boolean).slice(0, 500);
    if (!ids.length) throw new ActionError("Select at least one mailbox.");
    const op = str(body.op, 40);
    const database = db();
    const now = nowIso();
    const where = `owner_id = ?1 AND id IN (${placeholders(ids.length, 3)})`;
    const run = (sql: string, value: unknown) => database.prepare(sql.replace("{W}", where)).bind(ctx.ownerId, value, ...ids).run();
    if (op === "warmup-start") {
      // Never ramp a mailbox whose domain fails authentication.
      const rows = (await database.prepare(`SELECT m.id, m.email, d.last_check_json FROM outreach_mailboxes m LEFT JOIN outreach_domains d ON d.owner_id = m.owner_id AND d.domain = m.domain WHERE m.owner_id = ?1 AND m.id IN (${placeholders(ids.length, 2)})`).bind(ctx.ownerId, ...ids).all<Row>()).results || [];
      const blocked = rows.filter((row) => !parseJson<Row>(row.last_check_json, {}).allPass).map((row) => row.email);
      const allowed = rows.filter((row) => !blocked.includes(row.email)).map((row) => row.id);
      if (allowed.length) await database.prepare(`UPDATE outreach_mailboxes SET status = 'ramping', ramp_started_at = COALESCE(ramp_started_at, ?2), paused_reason = '', updated_at = ?2 WHERE owner_id = ?1 AND id IN (${placeholders(allowed.length, 3)}) AND status IN ('setup', 'paused', 'active', 'ramping')`).bind(ctx.ownerId, now, ...allowed).run();
      return { started: allowed.length, blocked };
    }
    if (op === "warmup-pause" || op === "pause") await run("UPDATE outreach_mailboxes SET status = 'paused', paused_reason = 'Paused by you', updated_at = ?2 WHERE {W}", now);
    else if (op === "resume") await run("UPDATE outreach_mailboxes SET status = CASE WHEN ramp_started_at IS NULL THEN 'setup' ELSE 'ramping' END, paused_reason = '', updated_at = ?2 WHERE {W} AND status = 'paused'", now);
    else if (op === "group") await run("UPDATE outreach_mailboxes SET group_label = ?2 WHERE {W}", str(body.value, 60));
    else if (op === "client") await run("UPDATE outreach_mailboxes SET client_id = ?2 WHERE {W}", str(body.value, 60) || null);
    else if (op === "target") { const value = Math.max(1, Math.min(50, Math.floor(Number(body.value) || 30))); await run("UPDATE outreach_mailboxes SET target_daily = ?2 WHERE {W}", value); }
    else if (op === "tag") {
      const tag = str(body.value, 30); if (!tag) throw new ActionError("Enter a tag.");
      const rows = (await database.prepare(`SELECT id, tags_json FROM outreach_mailboxes WHERE owner_id = ?1 AND id IN (${placeholders(ids.length, 2)})`).bind(ctx.ownerId, ...ids).all<Row>()).results || [];
      await database.batch(rows.map((row) => database.prepare("UPDATE outreach_mailboxes SET tags_json = ?2 WHERE id = ?1").bind(row.id, JSON.stringify([...new Set([...parseJson<string[]>(row.tags_json, []), tag])]))));
    } else if (op === "assign" || op === "unassign") {
      const campaign = await database.prepare("SELECT id, mailbox_ids_json FROM outreach_campaigns WHERE owner_id = ?1 AND id = ?2").bind(ctx.ownerId, str(body.value, 60)).first<Row>();
      if (!campaign) throw new ActionError("Choose a campaign.");
      const current = new Set(parseJson<string[]>(campaign.mailbox_ids_json, []));
      ids.forEach((id: string) => op === "assign" ? current.add(id) : current.delete(id));
      await database.prepare("UPDATE outreach_campaigns SET mailbox_ids_json = ?2, updated_at = ?3 WHERE id = ?1").bind(campaign.id, JSON.stringify([...current]), now).run();
    } else throw new ActionError("Unknown bulk action.");
    await audit(ctx.ownerId, ctx.actor, `mailboxes-${op}`, `${ids.length} mailboxes`, { value: body.value ?? null });
    return { ok: true, updated: ids.length };
  },

  // ---------------- campaigns ----------------
  async "campaign-save"(ctx, body) {
    const database = db();
    const name = str(body.name, 120); if (!name) throw new ActionError("Give the campaign a name.");
    const steps = (Array.isArray(body.steps) ? body.steps : []).slice(0, 8).map((step: Row, index: number) => ({ delayDays: index === 0 ? 0 : Math.max(1, Math.min(30, Math.floor(Number(step.delayDays) || 3))), variants: (Array.isArray(step.variants) ? step.variants : []).slice(0, 4).map((variant: Row, variantIndex: number) => ({ id: str(variant.id, 20) || String.fromCharCode(65 + variantIndex), subject: str(variant.subject, 200), body: str(variant.body, 5000), weight: Math.max(0, Math.min(100, Number(variant.weight ?? 1))) })).filter((variant: Row) => variant.body) })).filter((step: Row) => step.variants.length);
    const schedule = { days: (Array.isArray(body.schedule?.days) ? body.schedule.days : [1, 2, 3, 4, 5]).map(Number).filter((day: number) => day >= 1 && day <= 7), start: /^\d{2}:\d{2}$/.test(body.schedule?.start) ? body.schedule.start : "09:00", end: /^\d{2}:\d{2}$/.test(body.schedule?.end) ? body.schedule.end : "17:00", tz: str(body.schedule?.tz, 60) || "recipient", fallbackTz: str(body.schedule?.fallbackTz, 60) || "Europe/Dublin" };
    const id = str(body.id, 60) || uuid();
    const now = nowIso();
    const existing = await database.prepare("SELECT status FROM outreach_campaigns WHERE id = ?1 AND owner_id = ?2").bind(id, ctx.ownerId).first<Row>();
    const mailboxIds = (Array.isArray(body.mailboxIds) ? body.mailboxIds : []).map((value: unknown) => str(value, 60)).filter(Boolean);
    const statements = [
      existing
        ? database.prepare("UPDATE outreach_campaigns SET name = ?3, client_id = ?4, niche = ?5, offer = ?6, mailbox_ids_json = ?7, schedule_json = ?8, daily_cap = ?9, lawful_basis = ?10, pipeline_id = ?11, stage_id = ?12, updated_at = ?13 WHERE id = ?1 AND owner_id = ?2")
          .bind(id, ctx.ownerId, name, str(body.clientId, 60) || null, str(body.niche, 120), str(body.offer, 500), JSON.stringify(mailboxIds), JSON.stringify(schedule), Math.max(0, Math.floor(Number(body.dailyCap) || 0)), str(body.lawfulBasis, 500), str(body.pipelineId, 60) || null, str(body.stageId, 60) || null, now)
        : database.prepare("INSERT INTO outreach_campaigns (id, owner_id, client_id, name, status, niche, offer, mailbox_ids_json, schedule_json, daily_cap, lawful_basis, pipeline_id, stage_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'draft', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)")
          .bind(id, ctx.ownerId, str(body.clientId, 60) || null, name, str(body.niche, 120), str(body.offer, 500), JSON.stringify(mailboxIds), JSON.stringify(schedule), Math.max(0, Math.floor(Number(body.dailyCap) || 0)), str(body.lawfulBasis, 500), str(body.pipelineId, 60) || null, str(body.stageId, 60) || null, now),
      database.prepare("DELETE FROM outreach_steps WHERE campaign_id = ?1").bind(id),
      ...steps.map((step: Row, index: number) => database.prepare("INSERT INTO outreach_steps (id, campaign_id, position, delay_days, variants_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)").bind(uuid(), id, index, step.delayDays, JSON.stringify(step.variants), now)),
    ];
    await database.batch(statements);
    const variables = [...new Set(steps.flatMap((step: Row) => step.variants.flatMap((variant: Row) => [...templateVariables(variant.subject), ...templateVariables(variant.body)])))];
    return { id, savedAt: now, variablesWithoutFallback: variables };
  },
  async "campaign-status"(ctx, body) {
    const database = db();
    const id = str(body.id, 60);
    const status = str(body.status, 20);
    if (!["active", "paused", "completed"].includes(status)) throw new ActionError("Unknown status.");
    const campaign = await database.prepare("SELECT * FROM outreach_campaigns WHERE id = ?1 AND owner_id = ?2").bind(id, ctx.ownerId).first<Row>();
    if (!campaign) throw new ActionError("Campaign not found.", 404);
    if (status === "active") {
      const blockers: string[] = [];
      if (!str(campaign.lawful_basis)) blockers.push("Record the lawful basis for contacting this list (Review step).");
      const stepCount = await database.prepare("SELECT COUNT(*) AS n FROM outreach_steps WHERE campaign_id = ?1").bind(id).first<Row>();
      if (!Number(stepCount?.n)) blockers.push("Add at least one email.");
      const mailboxIds = parseJson<string[]>(campaign.mailbox_ids_json, []);
      if (!mailboxIds.length) blockers.push("Choose at least one sending mailbox.");
      const mailboxes = mailboxIds.length ? (await database.prepare(`SELECT id, email, domain, host, status FROM outreach_mailboxes WHERE owner_id = ?1 AND id IN (${placeholders(mailboxIds.length, 2)})`).bind(ctx.ownerId, ...mailboxIds).all<Row>()).results || [] : [];
      for (const mailbox of mailboxes) if (!["ramping", "active"].includes(mailbox.status)) blockers.push(`${mailbox.email} isn't warmed up / active yet.`);
      // Fresh authentication check for every sending domain — never launch on stale or failing DNS.
      const checks: Record<string, Row> = {};
      for (const domain of [...new Set(mailboxes.map((mailbox) => String(mailbox.domain)))]) {
        const host = mailboxes.find((mailbox) => mailbox.domain === domain)!.host;
        checks[domain] = await checkDomainAuth(ctx.ownerId, domain, host, host === "google" ? ["google"] : ["selector1", "selector2"]).catch((error) => ({ spf: "missing", dkim: "missing", dmarc: "missing", details: [error instanceof Error ? error.message : "Check failed."], checkedAt: nowIso() }));
      }
      const gate = campaignAuthGate(mailboxes.map((mailbox) => ({ domain: String(mailbox.domain) })), checks as never);
      for (const item of gate.blocking) blockers.push(`${item.domain}: SPF, DKIM and DMARC must all pass — ${item.reason}`);
      if (blockers.length) return { ok: false, blockers };
    }
    await database.prepare("UPDATE outreach_campaigns SET status = ?3, launched_at = CASE WHEN ?3 = 'active' AND launched_at IS NULL THEN ?4 ELSE launched_at END, updated_at = ?4 WHERE id = ?1 AND owner_id = ?2").bind(id, ctx.ownerId, status, nowIso()).run();
    if (status !== "active") await database.prepare("UPDATE outreach_enrollments SET status = CASE WHEN ?2 = 'paused' THEN 'paused' ELSE 'stopped' END, updated_at = ?3 WHERE campaign_id = ?1 AND status = 'active'").bind(id, status, nowIso()).run();
    else await database.prepare("UPDATE outreach_enrollments SET status = 'active', next_send_at = COALESCE(next_send_at, ?2), updated_at = ?2 WHERE campaign_id = ?1 AND status = 'paused' AND stop_reason = ''").bind(id, nowIso()).run();
    await audit(ctx.ownerId, ctx.actor, `campaign-${status}`, id);
    return { ok: true };
  },
  async "campaign-duplicate"(ctx, body) {
    const database = db();
    const campaign = await database.prepare("SELECT * FROM outreach_campaigns WHERE id = ?1 AND owner_id = ?2").bind(str(body.id, 60), ctx.ownerId).first<Row>();
    if (!campaign) throw new ActionError("Campaign not found.", 404);
    const steps = (await database.prepare("SELECT * FROM outreach_steps WHERE campaign_id = ?1 ORDER BY position").bind(campaign.id).all<Row>()).results || [];
    const id = uuid(); const now = nowIso();
    await database.batch([
      database.prepare("INSERT INTO outreach_campaigns (id, owner_id, client_id, name, status, niche, offer, mailbox_ids_json, schedule_json, daily_cap, lawful_basis, pipeline_id, stage_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'draft', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)").bind(id, ctx.ownerId, campaign.client_id, `${campaign.name} (copy)`, campaign.niche, campaign.offer, campaign.mailbox_ids_json, campaign.schedule_json, campaign.daily_cap, campaign.lawful_basis, campaign.pipeline_id, campaign.stage_id, now),
      ...steps.map((step) => database.prepare("INSERT INTO outreach_steps (id, campaign_id, position, delay_days, variants_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)").bind(uuid(), id, step.position, step.delay_days, step.variants_json, now)),
    ]);
    return { id };
  },
  async "import-preview"(ctx, body) { return previewImport(ctx, str(body.csv, 2_000_000), Boolean(body.allowPersonalMailboxes)); },
  async "import-commit"(ctx, body) {
    const campaignId = str(body.campaignId, 60);
    const campaign = await db().prepare("SELECT id, client_id FROM outreach_campaigns WHERE id = ?1 AND owner_id = ?2").bind(campaignId, ctx.ownerId).first<Row>();
    if (!campaign) throw new ActionError("Save the campaign first.");
    const preview = await previewImport(ctx, str(body.csv, 2_000_000), Boolean(body.allowPersonalMailboxes));
    const database = db();
    const now = nowIso();
    let created = 0, linked = 0, enrolled = 0;
    const rows = preview.rows.filter((row: Row) => row.action !== "skip");
    for (let index = 0; index < rows.length; index += 40) {
      const chunk = rows.slice(index, index + 40);
      const statements: D1PreparedStatement[] = [];
      const enrollmentIndexes: number[] = [];
      for (const row of chunk) {
        let contactId = row.contact_id as string | undefined;
        if (!contactId) {
          contactId = uuid(); created += 1;
          statements.push(database.prepare("INSERT INTO crm_contacts (id, owner_id, client_id, first_name, last_name, email, phone, company, source, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'Outreach', '', ?9, ?9)").bind(contactId, ctx.ownerId, campaign.client_id || null, row.first_name, row.last_name, row.email, row.phone || "", row.company || "", now));
        } else {
          linked += 1;
          statements.push(database.prepare("UPDATE crm_contacts SET first_name = CASE WHEN first_name = '' THEN ?2 ELSE first_name END, last_name = CASE WHEN last_name = '' THEN ?3 ELSE last_name END, company = CASE WHEN company = '' THEN ?4 ELSE company END, updated_at = ?5 WHERE id = ?1").bind(contactId, row.first_name, row.last_name, row.company || "", now));
        }
        enrollmentIndexes.push(statements.length);
        statements.push(database.prepare("INSERT INTO outreach_enrollments (id, owner_id, campaign_id, contact_id, email, status, next_step, next_send_at, vars_json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, 'active', 0, ?6, ?7, ?6, ?6) ON CONFLICT DO NOTHING")
          .bind(uuid(), ctx.ownerId, campaignId, contactId, row.email, now, JSON.stringify({ ...row.custom, website: row.website || "", city: row.city || "", time_zone: row.time_zone || "" })));
      }
      const results = await database.batch(statements);
      enrolled += enrollmentIndexes.filter((resultIndex) => Number(results[resultIndex]?.meta?.changes || 0) > 0).length;
    }
    await audit(ctx.ownerId, ctx.actor, "import", campaignId, { created, linked, skipped: preview.summary.skip });
    return { created, linked, skipped: preview.summary.skip, reasons: preview.summary.reasons, enrolled };
  },
  async "import-lead-list"(ctx, body) {
    const row = await db().prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
    const workspace = parseJson<Row>(row?.data, {});
    const list = (workspace.leadLists || []).find((item: Row) => String(item.id) === str(body.listId, 80));
    if (!list) throw new ActionError("Lead Factory list not found.", 404);
    const header = ["email", "first name", "last name", "company", "website", "phone", "city"];
    const csv = [header.join(","), ...(list.rows || []).map((lead: Row) => [lead.email, lead.firstName || lead.first_name || "", lead.lastName || lead.last_name || "", lead.name || lead.company || "", lead.website || "", lead.phone || "", lead.city || lead.location || ""].map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
    return { csv, rows: (list.rows || []).length };
  },

  // ---------------- inbox ----------------
  async "inbox-list"(ctx, body) {
    const database = db();
    const label = str(body.label, 30) || "positive";
    const clauses = ["r.owner_id = ?1"]; const binds: unknown[] = [ctx.ownerId];
    if (label === "review") clauses.push("r.needs_review = 1");
    else if (label !== "all") { binds.push(label); clauses.push(`r.label = ?${binds.length}`); }
    const status = str(body.status, 20) || "open";
    if (status === "open") clauses.push("r.reply_status IN ('open', 'drafted')"); else if (status !== "all") { binds.push(status); clauses.push(`r.reply_status = ?${binds.length}`); }
    for (const [field, column] of [["campaignId", "r.campaign_id"], ["mailboxId", "r.mailbox_id"]] as const) if (str(body[field], 60)) { binds.push(str(body[field], 60)); clauses.push(`${column} = ?${binds.length}`); }
    if (str(body.domain, 253)) { binds.push(`%@${str(body.domain, 253)}`); clauses.push(`m.email LIKE ?${binds.length}`); }
    const rows = (await database.prepare(`SELECT r.*, c.first_name, c.last_name, c.company, c.email AS contact_email, msg.body, k.name AS campaign_name, m.email AS mailbox_email FROM outreach_replies r LEFT JOIN crm_contacts c ON c.id = r.contact_id LEFT JOIN conv_messages msg ON msg.id = r.conv_message_id LEFT JOIN outreach_campaigns k ON k.id = r.campaign_id LEFT JOIN outreach_mailboxes m ON m.id = r.mailbox_id WHERE ${clauses.join(" AND ")} ORDER BY r.received_at DESC LIMIT 100`).bind(...binds).all<Row>()).results || [];
    const counts = (await database.prepare("SELECT label, COUNT(*) AS n FROM outreach_replies WHERE owner_id = ?1 AND reply_status IN ('open','drafted') GROUP BY label").bind(ctx.ownerId).all<Row>()).results || [];
    return { items: rows.map((row) => ({ id: row.conv_message_id, threadId: row.thread_id, label: row.label, confidence: row.confidence, needsReview: Boolean(row.needs_review), status: row.reply_status, suggestedReply: row.suggested_reply, receivedAt: row.received_at, subject: row.subject, body: row.body, prospect: { name: [row.first_name, row.last_name].filter(Boolean).join(" "), email: row.contact_email, company: row.company }, campaign: row.campaign_name, mailbox: row.mailbox_email, opportunityId: row.opportunity_id, assignedTo: row.assigned_to })), counts };
  },
  async "inbox-thread"(ctx, body) {
    const rows = (await db().prepare("SELECT id, direction, sender, body, created_at FROM conv_messages WHERE owner_id = ?1 AND thread_id = ?2 ORDER BY created_at LIMIT 200").bind(ctx.ownerId, str(body.threadId, 60)).all<Row>()).results || [];
    return { messages: rows };
  },
  async "reply-update"(ctx, body) {
    const id = str(body.id, 60);
    const label = str(body.label, 30);
    const updates: string[] = []; const binds: unknown[] = [id, ctx.ownerId];
    if (label) { binds.push(label); updates.push(`label = ?${binds.length}, label_source = 'human', needs_review = 0, confidence = 1`); }
    if (str(body.status, 20)) { binds.push(str(body.status, 20)); updates.push(`reply_status = ?${binds.length}`); }
    if (body.assignedTo !== undefined) { binds.push(str(body.assignedTo, 120) || null); updates.push(`assigned_to = ?${binds.length}`); }
    if (!updates.length) throw new ActionError("Nothing to change.");
    binds.push(nowIso());
    await db().prepare(`UPDATE outreach_replies SET ${updates.join(", ")}, updated_at = ?${binds.length} WHERE conv_message_id = ?1 AND owner_id = ?2`).bind(...binds).run();
    if (label === "unsubscribe") {
      const reply = await db().prepare("SELECT c.email FROM outreach_replies r JOIN crm_contacts c ON c.id = r.contact_id WHERE r.conv_message_id = ?1").bind(id).first<Row>();
      if (reply?.email) await db().prepare("INSERT INTO outreach_suppressions (owner_id, value, reason, source, created_at) VALUES (?1, ?2, 'unsubscribe', 'reclassified', ?3) ON CONFLICT(owner_id, value) DO UPDATE SET reason = 'unsubscribe'").bind(ctx.ownerId, String(reply.email).toLowerCase(), nowIso()).run();
    }
    return { ok: true };
  },
  async "reply-send"(ctx, body) {
    const database = db();
    const reply = await database.prepare("SELECT r.*, m.email AS mailbox_email, m.host, m.host_user_id, m.display_name, c.email AS contact_email, c.first_name, c.last_name FROM outreach_replies r JOIN outreach_mailboxes m ON m.id = r.mailbox_id LEFT JOIN crm_contacts c ON c.id = r.contact_id WHERE r.conv_message_id = ?1 AND r.owner_id = ?2").bind(str(body.id, 60), ctx.ownerId).first<Row>();
    if (!reply) throw new ActionError("Reply not found.", 404);
    const text = str(body.body, 8000);
    if (!text) throw new ActionError("Write a reply first.");
    const suppressed = await database.prepare("SELECT reason FROM outreach_suppressions WHERE owner_id = ?1 AND value = ?2").bind(ctx.ownerId, String(reply.contact_email).toLowerCase()).first<Row>();
    if (suppressed && ["unsubscribe", "complaint"].includes(suppressed.reason)) throw new ActionError("This person unsubscribed — the system won't email them again.");
    const raw = buildMessage({ from: { name: reply.display_name, email: reply.mailbox_email }, to: { name: [reply.first_name, reply.last_name].filter(Boolean).join(" "), email: reply.contact_email }, subject: replySubject(reply.subject || ""), text, messageId: newMessageId(reply.mailbox_email), inReplyTo: reply.internet_message_id || undefined });
    await (await mailHost(ctx.ownerId, reply.host)).sendMime(reply.host_user_id || reply.mailbox_email, raw);
    const thread = await upsertThread(ctx.ownerId, { channel: "email" as never, ourNumber: String(reply.mailbox_email).toLowerCase(), contact: String(reply.contact_email).toLowerCase(), clientId: "" });
    await addMessage(ctx.ownerId, thread.id, { direction: "out", sender: "staff", body: text });
    await database.prepare("UPDATE outreach_replies SET reply_status = 'sent', updated_at = ?2 WHERE conv_message_id = ?1").bind(reply.conv_message_id, nowIso()).run();
    let learned = false;
    if (body.saveCorrection !== false && reply.suggested_reply) {
      const correction = correctionFromEdit({ before: reply.suggested_reply, after: text, note: str(body.correctionNote, 300) });
      if (correction) { await savePlaybookEntry(ctx.ownerId, { ...correction, title: "Responder correction" }); learned = true; }
    }
    await audit(ctx.ownerId, ctx.actor, "reply-send", reply.contact_email, { learned });
    return { ok: true, learned };
  },

  // ---------------- AI playbook & copy ----------------
  async "playbook-list"(ctx) { return { entries: (await db().prepare("SELECT * FROM outreach_playbook WHERE owner_id = ?1 ORDER BY kind, updated_at DESC").bind(ctx.ownerId).all<Row>()).results || [] }; },
  async "playbook-save"(ctx, body) {
    const kind = str(body.kind, 30);
    if (!KINDS[kind]) throw new ActionError("Choose what kind of knowledge this is.");
    const text = str(body.body, kind === "document" ? 200_000 : 8000);
    if (!text) throw new ActionError("Add some content.");
    if (kind === "case-study" && body.evidence === "proven" && !str(body.title, 200)) throw new ActionError("Name the client for a verified case study.");
    return { id: await savePlaybookEntry(ctx.ownerId, { id: str(body.id, 60) || undefined, kind, title: str(body.title, 200), body: text, evidence: body.evidence === "proven" ? "proven" : "hypothesis", client_id: str(body.clientId, 60) || null }) };
  },
  async "playbook-delete"(ctx, body) { await db().prepare("DELETE FROM outreach_playbook WHERE owner_id = ?1 AND id = ?2").bind(ctx.ownerId, str(body.id, 60)).run(); return { ok: true }; },
  async "ai-copy"(ctx, body) {
    const task = str(body.task, 20);
    const campaign = { name: str(body.campaign?.name, 120), niche: str(body.campaign?.niche, 120), offer: str(body.campaign?.offer, 500) };
    const entries = (await db().prepare("SELECT id, kind, title, body, evidence, client_id, updated_at FROM outreach_playbook WHERE owner_id = ?1").bind(ctx.ownerId).all<Row>()).results || [];
    const playbook = buildPlaybookContext(entries as never, { purpose: "copywriter", query: `${campaign.niche} ${campaign.offer} ${str(body.draft, 2000)}`, clientId: str(body.clientId, 60) || null, niche: campaign.niche });
    const raw = await aiText(ctx.ownerId, task === "analyse" ? "analyse" : "copy", buildCopywriterMessages({ task, campaign, steps: Math.max(1, Math.min(6, Number(body.steps) || 3)), draft: str(body.draft, 6000), instruction: str(body.instruction, 1000) }, playbook.text) as never, { maxOutputTokens: task === "sequence" ? 2000 : 900 });
    const result = parseJsonReply(raw);
    if (!result) throw new ActionError("The AI answer couldn't be read. Try again.");
    return { result, usedPlaybookEntries: playbook.usedIds.length };
  },
  async "ai-openers"(ctx, body) {
    const database = db();
    const campaign = await database.prepare("SELECT * FROM outreach_campaigns WHERE id = ?1 AND owner_id = ?2").bind(str(body.campaignId, 60), ctx.ownerId).first<Row>();
    if (!campaign) throw new ActionError("Campaign not found.", 404);
    const rows = (await database.prepare("SELECT e.id, e.vars_json, c.first_name, c.company FROM outreach_enrollments e JOIN crm_contacts c ON c.id = e.contact_id WHERE e.campaign_id = ?1 AND e.status = 'active' AND e.next_step = 0 AND json_extract(e.vars_json, '$.openers') IS NULL LIMIT 20").bind(campaign.id).all<Row>()).results || [];
    const entries = (await database.prepare("SELECT id, kind, title, body, evidence, client_id, updated_at FROM outreach_playbook WHERE owner_id = ?1 AND kind IN ('personalisation','tone','rule','avoid','correction')").bind(ctx.ownerId).all<Row>()).results || [];
    const playbook = buildPlaybookContext(entries as never, { purpose: "copywriter", clientId: campaign.client_id });
    let written = 0;
    for (const row of rows) {
      const facts = { first_name: row.first_name, company: row.company, ...parseJson<Row>(row.vars_json, {}) };
      const usable = Object.entries(facts).filter(([key, value]) => value && !["time_zone", "openers"].includes(key));
      if (usable.length < 2) continue; // not enough real facts — no invented personalisation
      const result = parseJsonReply(await aiText(ctx.ownerId, "opener", buildCopywriterMessages({ task: "opener", campaign: { name: campaign.name, niche: campaign.niche, offer: campaign.offer }, instruction: `Facts about this prospect (use only these): ${JSON.stringify(Object.fromEntries(usable))}. Write 2 different options. Return JSON: {"lines":["…","…"]}` }, playbook.text) as never, { maxOutputTokens: 200 }).catch(() => ""));
      const lines = (Array.isArray(result?.lines) ? result.lines : result?.line ? [result.line] : []).map((line: unknown) => str(line, 240)).filter(Boolean);
      if (!lines.length) continue;
      await database.prepare("UPDATE outreach_enrollments SET vars_json = json_set(vars_json, '$.openers', json(?2)) WHERE id = ?1").bind(row.id, JSON.stringify(lines)).run();
      written += 1;
    }
    return { written, checked: rows.length };
  },

  // ---------------- placement tests & seeds ----------------
  async "seed-connect-url"(ctx, body) {
    const provider = body.provider === "outlook" ? "outlook" : "gmail";
    const vars = env as unknown as Row;
    const clientId = provider === "gmail" ? vars.OUTREACH_SEED_GOOGLE_CLIENT_ID : vars.OUTREACH_SEED_MS_CLIENT_ID;
    if (!clientId) throw new ActionError(`The ${provider === "gmail" ? "Google" : "Microsoft"} sign-in app for seed inboxes isn't configured yet (one-time server setup).`);
    const state = await signState(ctx.ownerId, provider);
    return { url: seedAuthorizeUrl(provider, { clientId, redirectUri: `${ctx.origin}/api/outreach/seed-callback`, state }) };
  },
  async "seed-remove"(ctx, body) { await db().prepare("DELETE FROM outreach_seeds WHERE owner_id = ?1 AND id = ?2").bind(ctx.ownerId, str(body.id, 60)).run(); return { ok: true }; },
  async "placement-run"(ctx, body) {
    const database = db();
    const mailbox = await database.prepare("SELECT * FROM outreach_mailboxes WHERE owner_id = ?1 AND id = ?2").bind(ctx.ownerId, str(body.mailboxId, 60)).first<Row>();
    if (!mailbox) throw new ActionError("Mailbox not found.", 404);
    const seeds = (await database.prepare("SELECT email FROM outreach_seeds WHERE owner_id = ?1 AND status = 'ok'").bind(ctx.ownerId).all<Row>()).results || [];
    if (!seeds.length) throw new ActionError("Connect at least one seed inbox (a free Gmail or Outlook.com account you own) first.");
    const campaign = await database.prepare("SELECT k.id FROM outreach_campaigns k WHERE k.owner_id = ?1 AND k.mailbox_ids_json LIKE ?2 ORDER BY k.updated_at DESC LIMIT 1").bind(ctx.ownerId, `%${mailbox.id}%`).first<Row>();
    const step = campaign ? await database.prepare("SELECT variants_json FROM outreach_steps WHERE campaign_id = ?1 ORDER BY position LIMIT 1").bind(campaign.id).first<Row>() : null;
    const variant = parseJson<Row[]>(step?.variants_json, [])[0];
    const token = newPlacementToken();
    const subject = String(variant?.subject || "Quick question").replace(/\{\{[^}]+\}\}/g, "there").slice(0, 120);
    const text = `${String(variant?.body || "Hi there,\n\nIs this the right address for new enquiries?\n\nThanks").replace(/\{\{\s*([a-z_]+)\s*\|\s*([^}]*)\}\}/gi, "$2").replace(/\{\{[^}]+\}\}/g, "there")}\n\nRef ${token}`;
    const host = await mailHost(ctx.ownerId, mailbox.host);
    for (const seed of seeds) await host.sendMime(mailbox.host_user_id || mailbox.email, buildMessage({ from: { name: mailbox.display_name, email: mailbox.email }, to: { email: seed.email }, subject, text, messageId: newMessageId(mailbox.email) }));
    await database.batch([
      database.prepare("INSERT INTO outreach_placement_tests (id, owner_id, mailbox_id, token, status, created_at) VALUES (?1, ?2, ?3, ?4, 'waiting', ?5)").bind(uuid(), ctx.ownerId, mailbox.id, token, nowIso()),
      database.prepare(`INSERT INTO outreach_mailbox_days (mailbox_id, day, sent) VALUES (?1, ?2, ?3) ON CONFLICT(mailbox_id, day) DO UPDATE SET sent = sent + ${seeds.length}`).bind(mailbox.id, todayUtc(), seeds.length),
    ]);
    return { ok: true, seeds: seeds.length, token };
  },

  // ---------------- suppression ----------------
  async "suppression-add"(ctx, body) {
    const value = str(body.value, 254).toLowerCase();
    if (!emailRe.test(value) && !/^@[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) throw new ActionError("Enter an email address or @domain.");
    await db().prepare("INSERT INTO outreach_suppressions (owner_id, value, reason, source, created_at) VALUES (?1, ?2, 'manual', ?3, ?4) ON CONFLICT(owner_id, value) DO NOTHING").bind(ctx.ownerId, value, ctx.actor, nowIso()).run();
    await db().prepare("UPDATE outreach_enrollments SET status = 'stopped', stop_reason = 'suppressed', updated_at = ?3 WHERE owner_id = ?1 AND (email = ?2 OR email LIKE '%' || ?2) AND status IN ('active','paused')").bind(ctx.ownerId, value, nowIso()).run();
    return { ok: true };
  },
  async "suppression-remove"(ctx, body) {
    const value = str(body.value, 254).toLowerCase();
    const row = await db().prepare("SELECT reason FROM outreach_suppressions WHERE owner_id = ?1 AND value = ?2").bind(ctx.ownerId, value).first<Row>();
    if (!row) return { ok: true };
    if (!canRemoveSuppression(row.reason)) throw new ActionError("Unsubscribes and spam complaints are permanent and can't be removed.");
    await db().prepare("DELETE FROM outreach_suppressions WHERE owner_id = ?1 AND value = ?2").bind(ctx.ownerId, value).run();
    await audit(ctx.ownerId, ctx.actor, "suppression-remove", value);
    return { ok: true };
  },
};

// ============================ helpers ============================
function numOrNull(value: unknown) { const number = Number(value); return value === null || value === "" || !Number.isFinite(number) ? null : Math.max(0, Math.round(number)); }

async function sha256(text: string) { return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), (byte) => byte.toString(16).padStart(2, "0")).join(""); }

async function registrarFor(ownerId: string) {
  const token = await cloudflareToken(ownerId);
  if (!token) throw new ActionError("Connect a Cloudflare token in Settings → Domains & DNS first.");
  return createRegistrar({ apiToken: token, accountId: cloudflareAccountId(), purchasesEnabled: purchasesEnabled() });
}

function normaliseOrder(body: Row) {
  const host = (body.host === "google" ? "google" : "microsoft") as HostName;
  const domains = (Array.isArray(body.domains) ? body.domains : []).map((item: Row) => ({ domain: str(item.domain, 253).toLowerCase(), buy: Boolean(item.buy), registrationCents: Number(item.registrationCents) || 0, renewalCents: Number(item.renewalCents) || 0, currency: str(item.currency, 3) || "USD" })).filter((item: Row) => domainRe.test(item.domain)).slice(0, 50);
  if (!domains.length) throw new ActionError("Choose at least one domain.");
  const identities = (Array.isArray(body.identities) ? body.identities : []).map((identity: Row) => ({ firstName: str(identity.firstName, 40), lastName: str(identity.lastName, 40), local: str(identity.local, 40).toLowerCase().replace(/[^a-z0-9._-]/g, "") })).filter((identity: Row) => identity.firstName && identity.local).slice(0, 5);
  return { host, domains, identities, inboxesPerDomain: Math.max(1, Math.min(5, Math.floor(Number(body.inboxesPerDomain) || identities.length || 1))), group: str(body.group, 60) };
}

async function previewImport(ctx: Ctx, csv: string, allowPersonalMailboxes: boolean) {
  const database = db();
  const settings = await getSettings(ctx.ownerId);
  const rows = parseCsv(csv);
  if (rows.length > 5001) throw new ActionError("Import up to 5,000 rows at a time.");
  const emailIndex = (rows[0] || []).findIndex((cell) => /e-?mail/i.test(cell));
  const emails = emailIndex >= 0 ? [...new Set(rows.slice(1).map((row) => String(row[emailIndex] || "").trim().toLowerCase()).filter((value) => emailRe.test(value)))] : [];
  const existing = new Map<string, { id: string; client_id?: string | null }>();
  const suppressed = new Set<string>(); const lastContacted = new Map<string, string>(); const active = new Set<string>();
  for (let index = 0; index < emails.length; index += 90) {
    const chunk = emails.slice(index, index + 90);
    const domains = [...new Set(chunk.map((email) => `@${email.split("@")[1]}`))];
    const [contacts, suppressions, enrollments] = await Promise.all([
      database.prepare(`SELECT id, client_id, lower(email) AS email FROM crm_contacts WHERE owner_id = ?1 AND lower(email) IN (${placeholders(chunk.length, 2)})`).bind(ctx.ownerId, ...chunk).all<Row>(),
      database.prepare(`SELECT value FROM outreach_suppressions WHERE owner_id = ?1 AND value IN (${placeholders(chunk.length + domains.length, 2)})`).bind(ctx.ownerId, ...chunk, ...domains).all<Row>(),
      database.prepare(`SELECT email, status, updated_at FROM outreach_enrollments WHERE owner_id = ?1 AND email IN (${placeholders(chunk.length, 2)})`).bind(ctx.ownerId, ...chunk).all<Row>(),
    ]);
    for (const row of contacts.results || []) existing.set(row.email, { id: row.id, client_id: row.client_id });
    for (const row of suppressions.results || []) suppressed.add(row.value);
    for (const row of enrollments.results || []) { if (["active", "paused"].includes(row.status)) active.add(row.email); const previous = lastContacted.get(row.email); if (!previous || previous < row.updated_at) lastContacted.set(row.email, row.updated_at); }
  }
  return prepareImport(csv, { existingContacts: existing, suppressed, lastContacted, activeEnrolled: active, cooldownDays: settings.cooldownDays, allowPersonalMailboxes });
}

export async function savePlaybookEntry(ownerId: string, entry: { id?: string; kind: string; title?: string; body: string; evidence?: string; client_id?: string | null }) {
  const id = entry.id || uuid(); const now = nowIso();
  await db().prepare("INSERT INTO outreach_playbook (id, owner_id, kind, title, body, evidence, client_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8) ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, title = excluded.title, body = excluded.body, evidence = excluded.evidence, client_id = excluded.client_id, updated_at = excluded.updated_at")
    .bind(id, ownerId, entry.kind, entry.title || "", entry.body, entry.evidence === "proven" ? "proven" : "hypothesis", entry.client_id || null, now).run();
  return id;
}

async function stateKey() {
  const material = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`outreach-seed-state:${String(env.AGENCY_CREDENTIALS_ENCRYPTION_KEY || "")}`));
  return crypto.subtle.importKey("raw", material, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function signState(ownerId: string, provider: string) {
  const payload = btoa(JSON.stringify({ o: ownerId, p: provider, t: Date.now() })).replace(/=+$/, "");
  const signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", await stateKey(), new TextEncoder().encode(payload))))).replace(/[+/=]/g, "").slice(0, 32);
  return `${payload}.${signature}`;
}
export async function verifyState(state: string): Promise<{ ownerId: string; provider: "gmail" | "outlook" } | null> {
  const [payload, signature] = String(state || "").split(".");
  if (!payload || !signature) return null;
  const expected = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", await stateKey(), new TextEncoder().encode(payload))))).replace(/[+/=]/g, "").slice(0, 32);
  if (expected !== signature) return null;
  const data = parseJson<Row>(atob(payload), {});
  if (Date.now() - Number(data.t) > 15 * 60_000) return null;
  return { ownerId: String(data.o), provider: data.p === "outlook" ? "outlook" : "gmail" };
}
export async function saveSeed(ownerId: string, provider: "gmail" | "outlook", email: string, refreshToken: string) {
  const encrypted = await encryptAiCredential(refreshToken);
  const now = nowIso();
  await db().prepare("INSERT INTO outreach_seeds (id, owner_id, provider, email, encrypted_token, token_iv, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'ok', ?7, ?7) ON CONFLICT(owner_id, email) DO UPDATE SET encrypted_token = excluded.encrypted_token, token_iv = excluded.token_iv, status = 'ok', last_error = '', updated_at = excluded.updated_at")
    .bind(uuid(), ownerId, provider, email.toLowerCase(), encrypted.ciphertext, encrypted.iv, now).run();
}
export { decryptAiCredential };
