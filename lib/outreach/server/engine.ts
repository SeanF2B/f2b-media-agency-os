// Outreach scheduled engine — runs on the existing 5-minute cron.
// Each part is isolated: a failure in one never stops the others, and every external call is
// idempotent or explicitly not retried (sends, purchases).
import { getAgencyOwnerId } from "@/lib/ai-credentials";
import { addMessage, upsertThread } from "@/lib/conversations/core";
import { planTick, nextAfterSend } from "@/lib/outreach/scheduler.mjs";
import { dailyAllowance } from "@/lib/outreach/ramp.mjs";
import { contactVariables } from "@/lib/outreach/personalise.mjs";
import { renderCandidates, chooseFreshest, parseFingerprint, serialiseFingerprint } from "@/lib/outreach/copy-engine.mjs";
import { buildMessage, newMessageId, replySubject } from "@/lib/outreach/mime.mjs";
import { ruleClassify, buildClassifierMessages, parseClassifierOutput, decide } from "@/lib/outreach/reply-classifier.mjs";
import { replyActions } from "@/lib/outreach/reply-handling.mjs";
import { planPositiveReplyOpportunity, opportunityKey } from "@/lib/outreach/crm-link.mjs";
import { buildPlaybookContext, buildResponderMessages, parseJsonReply } from "@/lib/outreach/playbook.mjs";
import { scoreHealth } from "@/lib/outreach/health-score.mjs";
import { adaptiveBand } from "@/lib/outreach/deliverability.mjs";
import { createTelegram, formatPositiveAlert, formatOperationalAlert } from "@/lib/outreach/telegram.mjs";
import { findPlacement, exchangeSeedToken, summarisePlacement } from "@/lib/outreach/placement.mjs";
import { applyOutcome, runnableSteps, type ProvisionStep } from "@/lib/outreach/provisioning.mjs";
import { createRegistrar } from "@/lib/outreach/registrar.mjs";
import { env } from "cloudflare:workers";
import { decryptAiCredential } from "@/lib/ai-credentials";
import { aiText } from "./ai";
import { mailHost, mailboxPassword, type HostName, type InboundMessage } from "./hosts";
import { checkDomainAuth, ensureZone, planAndApply, findZone } from "./dns";
import { signUnsubscribe } from "./unsubscribe";
import { alertOnce, cloudflareAccountId, cloudflareToken, db, ensureOutreachSchema, getSettings, nowIso, parseJson, purchasesEnabled, telegramConfig, todayUtc, uuid, type OutreachSettings } from "./store";

type Row = Record<string, any>;
const placeholders = (count: number, start = 1) => Array.from({ length: count }, (_, index) => `?${index + start}`).join(", ");
const DAY = 86_400_000;

export async function processOutreach(now = new Date()): Promise<Record<string, unknown>> {
  const ownerId = await getAgencyOwnerId();
  if (!ownerId) return { skipped: "no owner" };
  await ensureOutreachSchema();
  const settings = await getSettings(ownerId);
  const report: Record<string, unknown> = {};
  const run = async (name: string, fn: () => Promise<unknown>) => { try { report[name] = await fn(); } catch (error) { report[name] = { error: error instanceof Error ? error.message : String(error) }; console.error(`outreach:${name}`, error); } };
  await run("send", () => sendTick(ownerId, settings, now));
  await run("replies", () => syncReplies(ownerId, settings, now));
  await run("provisioning", () => runProvisioning(ownerId, settings, now));
  await run("placement", () => checkPlacementTests(ownerId, now));
  if (now.getUTCMinutes() < 5) await run("health", () => healthPass(ownerId, settings, now));
  await run("auth", () => authChecks(ownerId, now));
  return report;
}

// ============================ sending ============================
async function sendTick(ownerId: string, settings: OutreachSettings, now: Date) {
  const database = db();
  const campaigns = (await database.prepare("SELECT * FROM outreach_campaigns WHERE owner_id = ?1 AND status = 'active'").bind(ownerId).all<Row>()).results || [];
  if (!campaigns.length) return { sent: 0, reason: "no active campaigns" };
  const due = ((await database.prepare("SELECT * FROM outreach_enrollments WHERE status = 'active' AND next_send_at <= ?1 AND owner_id = ?2 ORDER BY next_send_at LIMIT 40").bind(now.toISOString(), ownerId).all<Row>()).results || []).filter((row) => campaigns.some((campaign) => campaign.id === row.campaign_id));
  if (!due.length) return { sent: 0, reason: "nothing due" };
  const campaignIds = [...new Set(due.map((row) => row.campaign_id as string))];
  const steps = (await database.prepare(`SELECT * FROM outreach_steps WHERE campaign_id IN (${placeholders(campaignIds.length)}) ORDER BY position`).bind(...campaignIds).all<Row>()).results || [];
  const mailboxIds = [...new Set(campaigns.flatMap((campaign) => parseJson<string[]>(campaign.mailbox_ids_json, [])))];
  if (!mailboxIds.length) return { sent: 0, reason: "no mailboxes assigned" };
  const mailboxes = (await database.prepare(`SELECT * FROM outreach_mailboxes WHERE owner_id = ?1 AND id IN (${placeholders(mailboxIds.length, 2)})`).bind(ownerId, ...mailboxIds).all<Row>()).results || [];
  const day = todayUtc();
  const counts = Object.fromEntries(((await database.prepare(`SELECT mailbox_id, sent FROM outreach_mailbox_days WHERE day = ?1 AND mailbox_id IN (${placeholders(mailboxIds.length, 2)})`).bind(day, ...mailboxIds).all<Row>()).results || []).map((row) => [row.mailbox_id, Number(row.sent)]));
  const domains = Object.fromEntries(((await database.prepare("SELECT domain, registered_at, last_check_json FROM outreach_domains WHERE owner_id = ?1").bind(ownerId).all<Row>()).results || []).map((row) => [row.domain, row]));
  const campaignSent = Object.fromEntries(((await database.prepare(`SELECT campaign_id, COUNT(*) AS n FROM outreach_sends WHERE owner_id = ?1 AND sent_at >= ?2 AND status = 'sent' GROUP BY campaign_id`).bind(ownerId, `${day}T00:00:00.000Z`).all<Row>()).results || []).map((row) => [row.campaign_id, Number(row.n)]));

  const mailboxState: Record<string, { id: string; status: string; remaining: number; lastSentAt: string | null; minGapSeconds: number }> = {};
  for (const mailbox of mailboxes) {
    const health = parseJson<Row>(mailbox.health_json, {});
    const check = parseJson<Row>(domains[mailbox.domain]?.last_check_json, {});
    const band = adaptiveBand({ healthBand: health.band || "grey", placementInboxRate: health.placementInboxRate ?? null, authAllPass: check.checkedAt ? Boolean(check.spf === "pass" && check.dkim === "pass" && check.dmarc === "pass") : false }).band;
    const allowance = dailyAllowance({ rampStartedAt: mailbox.ramp_started_at, targetDaily: mailbox.target_daily, domainRegisteredAt: domains[mailbox.domain]?.registered_at || null, healthBand: band, sentToday: counts[mailbox.id] || 0, now });
    mailboxState[mailbox.id] = { id: mailbox.id, status: mailbox.status, remaining: allowance.remaining, lastSentAt: mailbox.last_sent_at, minGapSeconds: mailbox.min_gap_seconds };
  }
  const campaignState = Object.fromEntries(campaigns.map((campaign) => [campaign.id, {
    status: campaign.status, schedule: parseJson(campaign.schedule_json, {}), mailboxIds: parseJson<string[]>(campaign.mailbox_ids_json, []), dailyCap: campaign.daily_cap, sentToday: campaignSent[campaign.id] || 0,
    steps: steps.filter((step) => step.campaign_id === campaign.id).map((step) => ({ delayDays: step.delay_days, variants: parseJson<Array<{ id: string; subject: string; body: string; weight?: number }>>(step.variants_json, []) })),
  }]));
  const emails = due.map((row) => String(row.email));
  const suppressedRows = (await database.prepare(`SELECT value FROM outreach_suppressions WHERE owner_id = ?1 AND value IN (${placeholders(emails.length * 2, 2)})`).bind(ownerId, ...emails, ...emails.map((email) => `@${email.split("@")[1]}`)).all<Row>()).results || [];
  const plan = planTick({ now, due: due.map((row) => ({ id: row.id, campaignId: row.campaign_id, email: row.email, step: row.next_step, nextSendAt: row.next_send_at, mailboxId: row.mailbox_id, timeZone: parseJson<Row>(row.vars_json, {}).time_zone || "" })), campaigns: campaignState, mailboxes: mailboxState, suppressed: new Set(suppressedRows.map((row) => String(row.value))) });

  for (const stop of plan.stops) await database.prepare("UPDATE outreach_enrollments SET status = ?2, stop_reason = ?3, updated_at = ?4 WHERE id = ?1").bind(stop.id, stop.reason === "completed" ? "completed" : "stopped", stop.reason, nowIso()).run();
  const hosts = new Map<string, Awaited<ReturnType<typeof mailHost>>>();
  const recentByCampaign = new Map<string, Set<string>[]>();
  let sent = 0; const failures: string[] = [];
  for (const planned of plan.sends) {
    const enrollment = due.find((row) => row.id === planned.enrollmentId)!;
    const campaign = campaigns.find((row) => row.id === planned.campaignId)!;
    const mailbox = mailboxes.find((row) => row.id === planned.mailboxId)!;
    const claim = await database.prepare(`INSERT INTO outreach_sends (id, owner_id, idempotency_key, enrollment_id, campaign_id, step, variant_id, mailbox_id, message_id, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, '', 'claimed', ?9)
      ON CONFLICT(owner_id, idempotency_key) DO UPDATE SET status = 'claimed', mailbox_id = excluded.mailbox_id, created_at = excluded.created_at WHERE outreach_sends.status = 'failed'`).bind(uuid(), ownerId, planned.idempotencyKey, planned.enrollmentId, planned.campaignId, planned.step, planned.variantId, planned.mailboxId, nowIso()).run();
    if (!claim.meta?.changes) continue; // already sent (or uncertain) — never send twice
    try {
      const contact = await database.prepare("SELECT first_name, last_name, company, email FROM crm_contacts WHERE id = ?1").bind(enrollment.contact_id).first<Row>();
      const vars = parseJson<Row>(enrollment.vars_json, {});
      const stepDef = campaignState[campaign.id].steps[planned.step];
      const variant = stepDef.variants.find((item: { id: string }) => item.id === planned.variantId) || stepDef.variants[0];
      if (!recentByCampaign.has(campaign.id)) recentByCampaign.set(campaign.id, ((await database.prepare("SELECT body_fingerprint FROM outreach_sends WHERE campaign_id = ?1 AND status = 'sent' ORDER BY sent_at DESC LIMIT 30").bind(campaign.id).all<Row>()).results || []).map((row) => parseFingerprint(row.body_fingerprint)));
      const recent = recentByCampaign.get(campaign.id)!;
      const enrollState = parseJson<Row>(enrollment.variant_json, {});
      const candidates = renderCandidates({ variants: [variant], variables: contactVariables(contact || { email: enrollment.email }, vars), openers: Array.isArray(vars.openers) ? vars.openers : [], enrollmentId: enrollment.id, step: planned.step, subjectFallback: enrollState.firstSubject ? replySubject(enrollState.firstSubject) : "" });
      const { chosen } = chooseFreshest(candidates, recent, { step: planned.step });
      if (!chosen) throw Object.assign(new Error("Missing personalisation data for this contact — paused instead of sending a broken email."), { permanent: true, pauseEnrollment: true });
      const unsubscribeUrl = settings.appUrl ? `${settings.appUrl.replace(/\/$/, "")}/api/marketing-public/outreach-unsubscribe?t=${encodeURIComponent(await signUnsubscribe(ownerId, enrollment.id, enrollment.email))}` : "";
      const footer = [mailbox.signature_html ? "" : mailbox.display_name, settings.senderAddress, unsubscribeUrl ? `Not relevant? Reply "no thanks" or unsubscribe: ${unsubscribeUrl}` : `Not relevant? Just reply "no thanks" and I won't email again.`].filter(Boolean).join("\n");
      const messageId = newMessageId(mailbox.email);
      const subject = chosen.subject || replySubject(enrollState.firstSubject || "");
      const raw = buildMessage({ from: { name: mailbox.display_name, email: mailbox.email }, to: { name: [contact?.first_name, contact?.last_name].filter(Boolean).join(" "), email: enrollment.email }, subject, text: `${chosen.body}\n\n${footer}`, messageId, inReplyTo: planned.step > 0 ? enrollment.first_message_id || undefined : undefined, unsubscribeUrl: unsubscribeUrl || undefined, unsubscribeMailto: mailbox.email });
      if (!hosts.has(mailbox.host)) hosts.set(mailbox.host, await mailHost(ownerId, mailbox.host as HostName));
      await hosts.get(mailbox.host)!.sendMime(mailbox.host_user_id || mailbox.email, raw);
      const sentAt = nowIso();
      recent.unshift(chosen.print);
      const thread = await upsertThread(ownerId, { channel: "email" as never, ourNumber: String(mailbox.email).toLowerCase(), contact: enrollment.email, contactName: [contact?.first_name, contact?.last_name].filter(Boolean).join(" "), clientId: campaign.client_id || "" });
      const message = await addMessage(ownerId, thread.id, { direction: "out", sender: "staff", body: `${subject}\n\n${chosen.body}` });
      const next = nextAfterSend({ step: planned.step, steps: campaignState[campaign.id].steps, sentAt, jitterMinutes: Math.floor(Math.random() * 90) });
      await database.batch([
        database.prepare("UPDATE outreach_sends SET status = 'sent', message_id = ?2, sent_at = ?3, conv_message_id = ?4, body_fingerprint = ?5, variant_id = ?6 WHERE owner_id = ?1 AND idempotency_key = ?7").bind(ownerId, messageId, sentAt, message.id, serialiseFingerprint(chosen.print), chosen.variantId, planned.idempotencyKey),
        database.prepare("INSERT INTO outreach_mailbox_days (mailbox_id, day, sent) VALUES (?1, ?2, 1) ON CONFLICT(mailbox_id, day) DO UPDATE SET sent = sent + 1").bind(mailbox.id, todayUtc()),
        database.prepare("UPDATE outreach_mailboxes SET last_sent_at = ?2, updated_at = ?2 WHERE id = ?1").bind(mailbox.id, sentAt),
        database.prepare("UPDATE outreach_enrollments SET next_step = ?2, next_send_at = ?3, status = ?4, mailbox_id = ?5, thread_id = ?6, first_message_id = CASE WHEN first_message_id = '' THEN ?7 ELSE first_message_id END, variant_json = ?8, updated_at = ?9 WHERE id = ?1")
          .bind(enrollment.id, next.nextStep, next.nextSendAt, next.status, mailbox.id, thread.id, messageId, JSON.stringify({ ...enrollState, firstSubject: enrollState.firstSubject || subject }), sentAt),
      ]);
      sent += 1;
    } catch (error: any) {
      const uncertain = error?.code === "network" || error?.status === 0;
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${mailbox.email}: ${message}`);
      await database.batch([
        database.prepare("UPDATE outreach_sends SET status = ?3, error = ?4 WHERE owner_id = ?1 AND idempotency_key = ?2").bind(ownerId, planned.idempotencyKey, uncertain ? "unknown" : "failed", message.slice(0, 300)),
        database.prepare("INSERT INTO outreach_mailbox_days (mailbox_id, day, errors) VALUES (?1, ?2, 1) ON CONFLICT(mailbox_id, day) DO UPDATE SET errors = errors + 1").bind(mailbox.id, todayUtc()),
      ]);
      if (error?.pauseEnrollment) await database.prepare("UPDATE outreach_enrollments SET status = 'paused', stop_reason = ?2, updated_at = ?3 WHERE id = ?1").bind(enrollment.id, message.slice(0, 200), nowIso()).run();
      if (error?.status === 401 || error?.status === 403) {
        await database.prepare("UPDATE outreach_mailboxes SET status = 'error', paused_reason = ?2, updated_at = ?3 WHERE id = ?1").bind(mailbox.id, message.slice(0, 200), nowIso()).run();
        await criticalAlert(ownerId, settings, `mailbox-auth:${mailbox.id}`, `Mailbox ${mailbox.email} can't send`, message);
      }
    }
  }
  return { sent, planned: plan.sends.length, skipped: plan.skipped.length, failures };
}

// ============================ replies ============================
async function syncReplies(ownerId: string, settings: OutreachSettings, now: Date) {
  const database = db();
  const cutoff = new Date(now.getTime() - 4 * 60_000).toISOString();
  const mailboxes = (await database.prepare("SELECT * FROM outreach_mailboxes WHERE owner_id = ?1 AND status IN ('ramping', 'active', 'paused') AND (last_polled_at IS NULL OR last_polled_at < ?2) ORDER BY last_polled_at LIMIT 6").bind(ownerId, cutoff).all<Row>()).results || [];
  if (!mailboxes.length) return { processed: 0 };
  const ownAddresses = new Set(((await database.prepare("SELECT email FROM outreach_mailboxes WHERE owner_id = ?1").bind(ownerId).all<Row>()).results || []).map((row) => String(row.email).toLowerCase()));
  let processed = 0, errors = 0;
  for (const mailbox of mailboxes) {
    try {
      const host = await mailHost(ownerId, mailbox.host as HostName);
      const delta = await host.inboxDelta(mailbox.host_user_id || mailbox.email, mailbox.inbox_cursor || "");
      // Each message is handled on its own: one bad message never drops the rest of the batch.
      // Failed messages are retried on the next poll (the cursor only moves once none failed);
      // already-stored replies are skipped by their host message id, so nothing is handled twice.
      let failed = 0;
      for (const item of delta.items) {
        try {
          if (ownAddresses.has(item.from)) { await recordSelfTest(item); continue; }
          processed += Number(await handleInbound(ownerId, settings, mailbox, item));
        } catch (error) {
          failed += 1; errors += 1;
          console.error(`outreach:reply ${mailbox.email} ${item.id}`, error);
        }
      }
      const attempts = Number(parseJson<Row>(mailbox.health_json, {}).replyRetries || 0);
      const advance = !failed || attempts >= 3; // never get stuck forever on one poisoned message
      await database.prepare("UPDATE outreach_mailboxes SET inbox_cursor = ?2, last_polled_at = ?3, health_json = json_set(COALESCE(NULLIF(health_json, ''), '{}'), '$.replyRetries', ?4) WHERE id = ?1").bind(mailbox.id, advance ? delta.cursor : (mailbox.inbox_cursor || delta.cursor), nowIso(), advance ? 0 : attempts + 1).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await database.prepare("UPDATE outreach_mailboxes SET last_polled_at = ?2 WHERE id = ?1").bind(mailbox.id, nowIso()).run();
      if (/rejected|permission|401|403/i.test(message)) await criticalAlert(ownerId, settings, `mailbox-read:${mailbox.id}`, `Can't read replies for ${mailbox.email}`, message);
    }
  }
  return { processed, errors };
}

async function recordSelfTest(item: InboundMessage) {
  const token = /F2B-SELFTEST-([A-Z0-9]{8,})/.exec(`${item.subject} ${item.text}`)?.[1];
  if (!token) return;
  await db().prepare("UPDATE outreach_job_steps SET result_json = json_set(result_json, '$.receivedAt', ?2) WHERE status IN ('pending','retry') AND json_extract(result_json, '$.testToken') = ?1").bind(token, nowIso()).run();
}

async function handleInbound(ownerId: string, settings: OutreachSettings, mailbox: Row, item: InboundMessage): Promise<boolean> {
  const database = db();
  let enrollment = await database.prepare("SELECT * FROM outreach_enrollments WHERE owner_id = ?1 AND email = ?2 AND mailbox_id = ?3 ORDER BY updated_at DESC LIMIT 1").bind(ownerId, item.from, mailbox.id).first<Row>();
  if (!enrollment) {
    // Bounces come from a mailer-daemon; match the failed recipient inside the notice.
    const quoted = [...new Set((item.text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []).map((value) => value.toLowerCase()))].slice(0, 20);
    if (quoted.length) enrollment = await database.prepare(`SELECT * FROM outreach_enrollments WHERE owner_id = ?1 AND mailbox_id = ?2 AND email IN (${placeholders(quoted.length, 3)}) ORDER BY updated_at DESC LIMIT 1`).bind(ownerId, mailbox.id, ...quoted).first<Row>();
  }
  if (!enrollment) return false; // not an Outreach conversation — left alone, nothing stored
  const seen = await database.prepare("SELECT 1 FROM outreach_replies WHERE owner_id = ?1 AND mailbox_id = ?2 AND host_message_id = ?3").bind(ownerId, mailbox.id, item.id).first();
  if (seen) return false;

  let result = ruleClassify({ from: item.from, subject: item.subject, text: item.text, headers: item.headers });
  if (!result) {
    try {
      const lastOut = await database.prepare("SELECT body FROM conv_messages WHERE thread_id = ?1 AND direction = 'out' ORDER BY created_at DESC LIMIT 1").bind(enrollment.thread_id || "").first<Row>();
      const campaign = await database.prepare("SELECT name FROM outreach_campaigns WHERE id = ?1").bind(enrollment.campaign_id).first<Row>();
      result = parseClassifierOutput(await aiText(ownerId, "classify", buildClassifierMessages({ subject: item.subject, text: item.text }, { campaignName: campaign?.name || "", ourLastMessage: lastOut?.body || "" }) as never, { maxOutputTokens: 120 }));
    } catch { result = null; }
  }
  const decision = decide(result);
  const actions = replyActions(decision);
  const contact = await database.prepare("SELECT id, first_name, last_name, company, client_id FROM crm_contacts WHERE id = ?1").bind(enrollment.contact_id).first<Row>();
  const campaign = await database.prepare("SELECT * FROM outreach_campaigns WHERE id = ?1").bind(enrollment.campaign_id).first<Row>();
  const thread = await upsertThread(ownerId, { channel: "email" as never, ourNumber: String(mailbox.email).toLowerCase(), contact: enrollment.email, contactName: [contact?.first_name, contact?.last_name].filter(Boolean).join(" ") || item.fromName, clientId: campaign?.client_id || "" });
  const message = await addMessage(ownerId, thread.id, { direction: "in", sender: "customer", body: `${item.subject}\n\n${item.text}`.slice(0, 4000) });
  const now = nowIso();
  const statements = [
    database.prepare("INSERT INTO outreach_replies (conv_message_id, owner_id, thread_id, contact_id, campaign_id, mailbox_id, host_message_id, internet_message_id, subject, label, confidence, needs_review, label_source, received_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)")
      .bind(message.id, ownerId, thread.id, enrollment.contact_id, enrollment.campaign_id, mailbox.id, item.id, item.messageId || "", item.subject.slice(0, 300), decision.label, decision.confidence, decision.needsReview ? 1 : 0, decision.source, item.receivedAt, now),
    database.prepare(`INSERT INTO outreach_mailbox_days (mailbox_id, day, replies, positive, bounced, complaints) VALUES (?1, ?2, 1, ?3, ?4, ?5) ON CONFLICT(mailbox_id, day) DO UPDATE SET replies = replies + 1, positive = positive + excluded.positive, bounced = bounced + excluded.bounced, complaints = complaints + excluded.complaints`)
      .bind(mailbox.id, todayUtc(), decision.label === "positive" ? 1 : 0, decision.label === "bounce" ? 1 : 0, decision.label === "spam" ? 1 : 0),
  ];
  if (actions.stopSequence) statements.push(database.prepare("UPDATE outreach_enrollments SET status = ?2, stop_reason = ?3, updated_at = ?4 WHERE id = ?1").bind(enrollment.id, decision.label === "unsubscribe" ? "unsubscribed" : decision.label === "bounce" ? "bounced" : "replied", `Reply: ${decision.label}`, now));
  if (actions.pauseUntil) statements.push(database.prepare("UPDATE outreach_enrollments SET next_send_at = ?2, updated_at = ?3 WHERE id = ?1").bind(enrollment.id, new Date(Date.now() + 7 * DAY).toISOString(), now));
  if (actions.suppress) statements.push(database.prepare("INSERT INTO outreach_suppressions (owner_id, value, reason, source, created_at) VALUES (?1, ?2, ?3, 'reply', ?4) ON CONFLICT(owner_id, value) DO UPDATE SET reason = CASE WHEN outreach_suppressions.reason IN ('unsubscribe','complaint') THEN outreach_suppressions.reason ELSE excluded.reason END").bind(ownerId, enrollment.email, actions.suppress, now));
  await database.batch(statements);

  let opportunityId: string | null = null;
  if (actions.opportunity && contact) opportunityId = await upsertOpportunity(ownerId, contact, campaign);
  let suggested = "";
  if (actions.draftReply) suggested = await draftReply(ownerId, settings, thread.id, contact, campaign).catch(() => "");
  await database.prepare("UPDATE outreach_replies SET suggested_reply = ?2, reply_status = ?3, opportunity_id = ?4 WHERE conv_message_id = ?1").bind(message.id, suggested, suggested ? "drafted" : "open", opportunityId).run();
  if (actions.notify) {
    const telegram = await telegramConfig(ownerId);
    if (telegram?.chatId) {
      const alert = formatPositiveAlert({ prospectName: [contact?.first_name, contact?.last_name].filter(Boolean).join(" ") || item.fromName, prospectEmail: item.from, company: contact?.company, campaign: campaign?.name, replyText: item.text, suggestedReply: suggested, confidence: decision.confidence, conversationUrl: settings.appUrl ? `${settings.appUrl.replace(/\/$/, "")}/?page=CRM&leads=outreach&reply=${encodeURIComponent(message.id)}` : undefined });
      // A Telegram problem never blocks reply handling; the reply is already saved and visible in the Inbox.
      try {
        await createTelegram(telegram).send(alert.text, alert.buttons);
        await database.prepare("UPDATE outreach_replies SET notified_at = ?2 WHERE conv_message_id = ?1 AND notified_at IS NULL").bind(message.id, nowIso()).run();
      } catch (error) { console.error("outreach:telegram", error); }
    }
  }
  return true;
}

async function upsertOpportunity(ownerId: string, contact: Row, campaign: Row | null): Promise<string | null> {
  const database = db();
  const pipelineId = campaign?.pipeline_id || (await database.prepare("SELECT id FROM crm_pipelines WHERE owner_id = ?1 AND archived = 0 ORDER BY created_at LIMIT 1").bind(ownerId).first<Row>())?.id;
  if (!pipelineId) return null;
  const stages = (await database.prepare("SELECT id, position, category FROM crm_pipeline_stages WHERE owner_id = ?1 AND pipeline_id = ?2 ORDER BY position").bind(ownerId, pipelineId).all<Row>()).results || [];
  const target = stages.find((stage) => stage.id === campaign?.stage_id) || stages.filter((stage) => stage.category === "open")[1] || stages.find((stage) => stage.category === "open");
  if (!target) return null;
  const existing = await database.prepare("SELECT o.id, o.stage_id, s.category AS stage_category, s.position AS stage_position FROM crm_opportunities o JOIN crm_pipeline_stages s ON s.id = o.stage_id WHERE o.owner_id = ?1 AND o.source_submission_id = ?2").bind(ownerId, opportunityKey(contact.id)).first<Row>();
  const plan = planPositiveReplyOpportunity({ existing: existing ? { id: existing.id, stage_id: existing.stage_id, stage_category: existing.stage_category, stage_position: existing.stage_position } : null, target: { pipelineId, stageId: target.id, stagePosition: target.position }, contactId: contact.id, contactName: [contact.first_name, contact.last_name].filter(Boolean).join(" "), company: contact.company, campaignName: campaign?.name || "" });
  const now = nowIso();
  if (plan.op === "create" && plan.values) {
    const id = uuid();
    await database.prepare("INSERT INTO crm_opportunities (id, owner_id, pipeline_id, stage_id, contact_id, client_id, title, value, currency, source, source_submission_id, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 'EUR', ?8, ?9, ?10, ?11, ?11) ON CONFLICT DO NOTHING")
      .bind(id, ownerId, plan.values.pipeline_id, plan.values.stage_id, contact.id, campaign?.client_id || contact.client_id || null, plan.values.title, plan.values.source, plan.values.source_submission_id, plan.values.notes, now).run();
    await database.prepare("INSERT INTO crm_activities (id, owner_id, opportunity_id, contact_id, activity_type, body, created_by, created_at) VALUES (?1, ?2, ?3, ?4, 'note', ?5, 'Outreach', ?6)").bind(uuid(), ownerId, id, contact.id, `Positive reply to "${campaign?.name || "campaign"}".`, now).run().catch(() => undefined);
    return id;
  }
  if (plan.op === "move" && existing) await database.prepare("UPDATE crm_opportunities SET stage_id = ?2, updated_at = ?3 WHERE id = ?1").bind(existing.id, target.id, now).run();
  return existing?.id || null;
}

async function draftReply(ownerId: string, settings: OutreachSettings, threadId: string, contact: Row | null, campaign: Row | null): Promise<string> {
  const database = db();
  const history = ((await database.prepare("SELECT direction, body FROM conv_messages WHERE thread_id = ?1 ORDER BY created_at DESC LIMIT 12").bind(threadId).all<Row>()).results || []).reverse().map((row) => ({ direction: row.direction as "in" | "out", body: String(row.body) }));
  const entries = (await database.prepare("SELECT id, kind, title, body, evidence, client_id, updated_at FROM outreach_playbook WHERE owner_id = ?1").bind(ownerId).all<Row>()).results || [];
  const playbook = buildPlaybookContext(entries as never, { purpose: "responder", query: history.map((message) => message.body).join(" ").slice(-1500), clientId: campaign?.client_id || null });
  const reply = parseJsonReply(await aiText(ownerId, "responder", buildResponderMessages({ prospect: { name: [contact?.first_name, contact?.last_name].filter(Boolean).join(" "), company: contact?.company }, campaignName: campaign?.name || "", history, bookingUrl: settings.bookingUrl }, playbook.text) as never, { maxOutputTokens: 600 }));
  return String(reply?.reply || "").slice(0, 3000);
}

// ============================ provisioning ============================
function rowToStep(row: Row): ProvisionStep {
  const meta = parseJson<Row>(row.result_json, {});
  return { ...(meta.step || {}), key: row.step_key, position: row.position, status: row.status, attempts: row.attempts, nextAttemptAt: row.next_attempt_at, message: row.message, result: meta };
}

async function runProvisioning(ownerId: string, settings: OutreachSettings, now: Date) {
  const database = db();
  const jobs = (await database.prepare("SELECT * FROM outreach_jobs WHERE owner_id = ?1 AND kind = 'provision' AND status IN ('running') ORDER BY created_at LIMIT 3").bind(ownerId).all<Row>()).results || [];
  let ran = 0;
  for (const job of jobs) {
    const rows = (await database.prepare("SELECT * FROM outreach_job_steps WHERE job_id = ?1 ORDER BY position").bind(job.id).all<Row>()).results || [];
    let steps = rows.map(rowToStep);
    // Manual DKIM steps that are waiting get re-checked here too.
    const candidates = [...runnableSteps(steps, now.getTime()), ...steps.filter((step) => step.manual && step.status === "waiting" && (!step.nextAttemptAt || new Date(step.nextAttemptAt).getTime() <= now.getTime()))].slice(0, 2);
    for (const step of candidates) {
      ran += 1;
      const input = parseJson<Row>(job.input_json, {});
      let outcome: { ok?: boolean; waiting?: boolean; permanent?: boolean; message?: string; result?: Record<string, unknown>; retryInMinutes?: number };
      try { outcome = await executeStep(ownerId, settings, job, input, step); }
      catch (error: any) { outcome = error?.waiting ? { waiting: true, message: error.message, retryInMinutes: 30 } : { ok: false, message: error instanceof Error ? error.message : String(error) }; }
      const next = applyOutcome(step, outcome, now.getTime());
      const meta = { ...(step.result || {}), ...(outcome.result || {}), step: { ...step, result: undefined, status: undefined, attempts: undefined } };
      await database.prepare("UPDATE outreach_job_steps SET status = ?3, attempts = ?4, next_attempt_at = ?5, message = ?6, result_json = ?7, updated_at = ?8 WHERE job_id = ?1 AND step_key = ?2").bind(job.id, step.key, next.status, next.attempts, next.nextAttemptAt || null, String(next.message || "").slice(0, 400), JSON.stringify(meta), nowIso()).run();
      steps = steps.map((item) => item.key === step.key ? next : item);
      if (next.status === "failed") await criticalAlert(ownerId, settings, `provision:${job.id}:${step.key}`, `Setup step failed: ${step.label} (${step.email || step.domain})`, String(next.message || ""));
    }
    const remaining = steps.filter((step) => !step.manual && !["done", "skipped"].includes(step.status));
    if (!remaining.length) await database.prepare("UPDATE outreach_jobs SET status = 'done', updated_at = ?2 WHERE id = ?1").bind(job.id, nowIso()).run();
  }
  return { stepsRun: ran };
}

async function executeStep(ownerId: string, settings: OutreachSettings, job: Row, input: Row, step: ProvisionStep): Promise<{ ok?: boolean; waiting?: boolean; permanent?: boolean; message?: string; result?: Record<string, unknown>; retryInMinutes?: number }> {
  const database = db();
  const host = await mailHost(ownerId, input.host as HostName);
  switch (step.kind) {
    case "purchase": {
      const tokenValue = await cloudflareToken(ownerId);
      const registrar = createRegistrar({ apiToken: tokenValue || "", accountId: cloudflareAccountId(), purchasesEnabled: purchasesEnabled() });
      const approval = { approvedBy: String(job.approved_by || ""), approvedAt: String(job.approved_at || ""), domains: (input.domains || []).filter((item: Row) => item.buy).map((item: Row) => String(item.domain)) };
      try {
        const result = await registrar.register(step.domain, { approval });
        await database.prepare("INSERT INTO outreach_domains (id, owner_id, domain, mail_host, registrar, registered_at, annual_cost_cents, currency, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'cloudflare', ?5, ?6, ?7, ?5, ?5) ON CONFLICT(owner_id, domain) DO UPDATE SET registrar = 'cloudflare', registered_at = COALESCE(outreach_domains.registered_at, excluded.registered_at)")
          .bind(uuid(), ownerId, step.domain, input.host, nowIso(), (input.domains || []).find((item: Row) => item.domain === step.domain)?.renewalCents ?? null, "USD").run();
        return { ok: true, message: result.alreadyOwned ? "Already owned." : `Registration ${result.status}.` };
      } catch (error: any) {
        if (error?.code === "purchases-disabled" || error?.code === "not-approved") return { waiting: true, message: error.message, retryInMinutes: 60 };
        throw error;
      }
    }
    case "zone": {
      const zone = await ensureZone(ownerId, step.domain);
      await database.prepare("INSERT INTO outreach_domains (id, owner_id, domain, zone_id, mail_host, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) ON CONFLICT(owner_id, domain) DO UPDATE SET zone_id = excluded.zone_id, mail_host = excluded.mail_host, updated_at = excluded.updated_at").bind(uuid(), ownerId, step.domain, zone.id, input.host, nowIso()).run();
      return zone.status === "active" ? { ok: true, message: "Zone active." } : { waiting: true, message: `Zone is ${zone.status}; nameservers: ${zone.nameServers.join(", ")}`, retryInMinutes: 15 };
    }
    case "host-domain": await host.addDomain(step.domain); return { ok: true, message: `Added to ${host.name === "microsoft" ? "Microsoft 365" : "Google Workspace"}.` };
    case "host-verify": {
      const records = await host.verificationRecords(step.domain);
      const zone = await findZone(ownerId, step.domain);
      if (zone && records.length) await addTxtIfMissing(ownerId, zone.id, step.domain, records[0].content);
      try { await host.verifyDomain(step.domain); return { ok: true, message: "Domain verified." }; }
      catch { return { waiting: true, message: "Waiting for the verification record to propagate.", retryInMinutes: 10 }; }
    }
    case "mail-dns": {
      const service = await host.serviceRecords(step.domain);
      const mx = service.filter((record) => record.type === "MX").map((record) => ({ host: record.content, priority: record.priority ?? 0 }));
      const { plan, applied } = await planAndApply(ownerId, { domain: step.domain, desired: { mx, spfIncludes: [host.spfInclude], dmarc: { policy: "none", rua: settings.dmarcReportEmail || undefined } }, apply: true, actor: "provisioning", reason: "Mailbox setup" });
      if (plan.conflicts.length) return { permanent: true, message: plan.conflicts.map((conflict: { message: string }) => conflict.message).join(" ") };
      return { ok: true, message: applied.length ? applied.join(", ") : "Records already correct." };
    }
    case "dkim": {
      const check = await checkDomainAuth(ownerId, step.domain, host.name, host.dkimSelectors);
      return check.dkim === "pass" ? { ok: true, message: "DKIM verified." } : { waiting: true, message: step.note || "Waiting for DKIM.", retryInMinutes: 60 };
    }
    case "propagation": {
      const check = await checkDomainAuth(ownerId, step.domain, host.name, host.dkimSelectors);
      return check.spf === "pass" && check.dmarc === "pass" && check.mx === "pass" ? { ok: true, message: "SPF, DMARC and MX visible publicly." } : { waiting: true, message: check.details.join(" "), retryInMinutes: 10 };
    }
    case "mailbox": {
      const identity = step.identity!;
      const created = await host.createMailbox({ email: step.email!, displayName: `${identity.firstName} ${identity.lastName}`.trim(), firstName: identity.firstName, lastName: identity.lastName, password: mailboxPassword() });
      const userRef = String(created.id || created.primaryEmail || created.userPrincipalName || step.email);
      await database.prepare("INSERT INTO outreach_mailboxes (id, owner_id, email, domain, host, host_user_id, display_name, group_label, status, target_daily, monthly_cost_cents, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'setup', ?9, ?10, ?11, ?11) ON CONFLICT(owner_id, email) DO UPDATE SET host_user_id = excluded.host_user_id, updated_at = excluded.updated_at")
        .bind(uuid(), ownerId, step.email, step.domain, host.name, userRef, `${identity.firstName} ${identity.lastName}`.trim(), String(input.group || ""), settings.defaultTargetDaily, settings.seatPriceCents[host.name] ?? null, nowIso()).run();
      return { ok: true, message: "Mailbox created.", result: { userRef } };
    }
    case "license": { const userRef = await mailboxRef(ownerId, step.email!); await host.assignSeat(userRef); return { ok: true, message: "Seat assigned." }; }
    case "connect": {
      const userRef = await mailboxRef(ownerId, step.email!);
      return await host.mailboxReady(userRef) ? { ok: true, message: "Connected." } : { waiting: true, message: "Mailbox is still being created by the host.", retryInMinutes: 5 };
    }
    case "test": {
      const meta = step.result || {};
      if (meta.receivedAt) return { ok: true, message: "Sent and received." };
      if (meta.sentAt && Date.now() - new Date(String(meta.sentAt)).getTime() < 30 * 60_000) return { waiting: true, message: "Waiting for the test email to arrive…", retryInMinutes: 3, result: meta };
      const token = crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
      const userRef = await mailboxRef(ownerId, step.email!);
      await host.sendMime(userRef, buildMessage({ from: { email: step.email! }, to: { email: step.to! }, subject: `Setup check F2B-SELFTEST-${token}`, text: `Automatic setup check. F2B-SELFTEST-${token}`, messageId: newMessageId(step.email!) }));
      return { waiting: true, message: "Test email sent; checking it arrives…", retryInMinutes: 3, result: { testToken: token, sentAt: nowIso() } };
    }
    case "ramp": {
      await database.prepare("UPDATE outreach_mailboxes SET status = 'ramping', ramp_started_at = COALESCE(ramp_started_at, ?2), updated_at = ?2 WHERE owner_id = ?1 AND email = ?3").bind(ownerId, nowIso(), step.email).run();
      return { ok: true, message: "Warm-up started." };
    }
    default: return { permanent: true, message: `Unknown step ${step.kind}.` };
  }
}

async function mailboxRef(ownerId: string, email: string) {
  const row = await db().prepare("SELECT host_user_id FROM outreach_mailboxes WHERE owner_id = ?1 AND email = ?2").bind(ownerId, email).first<Row>();
  return String(row?.host_user_id || email);
}

async function addTxtIfMissing(ownerId: string, zoneId: string, name: string, content: string) {
  const tokenValue = await cloudflareToken(ownerId);
  if (!tokenValue) throw new Error("Cloudflare token missing.");
  const list = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?type=TXT&name=${encodeURIComponent(name)}`, { headers: { Authorization: `Bearer ${tokenValue}` } }).then((response) => response.json() as Promise<any>);
  if ((list?.result || []).some((record: Row) => String(record.content).replace(/"/g, "") === content)) return;
  const created = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, { method: "POST", headers: { Authorization: `Bearer ${tokenValue}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "TXT", name, content, ttl: 1 }) }).then((response) => response.json() as Promise<any>);
  await db().prepare("INSERT INTO outreach_dns_changes (id, owner_id, domain, zone_id, record_id, action, record_type, record_name, after_json, reason, actor, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 'create', 'TXT', ?3, ?6, 'Mail host domain verification', 'provisioning', ?7)").bind(uuid(), ownerId, name, zoneId, created?.result?.id || null, JSON.stringify({ type: "TXT", name, content }), nowIso()).run();
}

// ============================ health, auth, placement ============================
async function healthPass(ownerId: string, settings: OutreachSettings, now: Date) {
  const database = db();
  const since = new Date(now.getTime() - 7 * DAY).toISOString().slice(0, 10);
  const mailboxes = (await database.prepare("SELECT * FROM outreach_mailboxes WHERE owner_id = ?1 AND status IN ('ramping', 'active', 'paused', 'error')").bind(ownerId).all<Row>()).results || [];
  const domains = Object.fromEntries(((await database.prepare("SELECT domain, last_check_json FROM outreach_domains WHERE owner_id = ?1").bind(ownerId).all<Row>()).results || []).map((row) => [row.domain, parseJson<Row>(row.last_check_json, {})]));
  let paused = 0;
  for (const mailbox of mailboxes) {
    const totals = await database.prepare("SELECT COALESCE(SUM(sent),0) AS sent, COALESCE(SUM(bounced),0) AS bounced, COALESCE(SUM(complaints),0) AS complaints, COALESCE(SUM(errors),0) AS errors FROM outreach_mailbox_days WHERE mailbox_id = ?1 AND day >= ?2").bind(mailbox.id, since).first<Row>();
    const latestTest = await database.prepare("SELECT inbox_rate FROM outreach_placement_tests WHERE owner_id = ?1 AND mailbox_id = ?2 AND status = 'done' ORDER BY completed_at DESC LIMIT 1").bind(ownerId, mailbox.id).first<Row>();
    const check = domains[mailbox.domain] || {};
    const health = scoreHealth({ auth: check.checkedAt ? { spf: check.spf, dkim: check.dkim, dmarc: check.dmarc, mx: check.mx } : {}, connection: mailbox.status === "error" ? "error" : mailbox.last_polled_at ? "ok" : null, sent: Number(totals?.sent || 0), bounced: Number(totals?.bounced || 0), complaints: Number(totals?.complaints || 0), sendErrors: Number(totals?.errors || 0), inboxPlacementRate: latestTest?.inbox_rate ?? null });
    const adaptive = adaptiveBand({ healthBand: health.band, placementInboxRate: latestTest?.inbox_rate ?? null, authAllPass: check.checkedAt ? check.allPass : undefined });
    await database.prepare("UPDATE outreach_mailboxes SET health_json = ?2, updated_at = ?3 WHERE id = ?1").bind(mailbox.id, JSON.stringify({ ...health, band: adaptive.band, adaptive: adaptive.reasons, placementInboxRate: latestTest?.inbox_rate ?? null, scoredAt: nowIso() }), nowIso()).run();
    if ((health.pause.required || adaptive.band === "red") && ["ramping", "active"].includes(mailbox.status)) {
      const reason = [...health.pause.reasons, ...adaptive.reasons].join(" ") || "Safety threshold reached.";
      await database.prepare("UPDATE outreach_mailboxes SET status = 'paused', paused_reason = ?2, updated_at = ?3 WHERE id = ?1").bind(mailbox.id, reason.slice(0, 300), nowIso()).run();
      await criticalAlert(ownerId, settings, `paused:${mailbox.id}`, `Sending paused for ${mailbox.email}`, reason);
      paused += 1;
    }
  }
  return { scored: mailboxes.length, paused };
}

async function authChecks(ownerId: string, now: Date) {
  const database = db();
  const stale = new Date(now.getTime() - 12 * 3_600_000).toISOString();
  const domains = (await database.prepare("SELECT domain, mail_host, last_check_json FROM outreach_domains WHERE owner_id = ?1 AND protected = 0 AND (last_checked_at IS NULL OR last_checked_at < ?2) LIMIT 3").bind(ownerId, stale).all<Row>()).results || [];
  const settings = await getSettings(ownerId);
  for (const row of domains) {
    const before = parseJson<Row>(row.last_check_json, {});
    const selectors = row.mail_host === "google" ? ["google"] : row.mail_host === "microsoft" ? ["selector1", "selector2"] : [];
    const after = await checkDomainAuth(ownerId, row.domain, (row.mail_host || "smtp") as never, selectors).catch(() => null);
    if (after && before.allPass && !after.allPass) await criticalAlert(ownerId, settings, `auth:${row.domain}`, `Email authentication broke on ${row.domain}`, after.details.join(" "));
  }
  return { checked: domains.length };
}

async function checkPlacementTests(ownerId: string, now: Date) {
  const database = db();
  const tests = (await database.prepare("SELECT * FROM outreach_placement_tests WHERE owner_id = ?1 AND status = 'waiting' AND created_at < ?2 LIMIT 2").bind(ownerId, new Date(now.getTime() - 3 * 60_000).toISOString()).all<Row>()).results || [];
  if (!tests.length) return { checked: 0 };
  const seeds = (await database.prepare("SELECT * FROM outreach_seeds WHERE owner_id = ?1 AND status = 'ok'").bind(ownerId).all<Row>()).results || [];
  const vars = env as unknown as Record<string, string | undefined>;
  for (const test of tests) {
    const results: Array<{ seed: string; provider: string; placement: string }> = [];
    for (const seed of seeds) {
      try {
        const refreshToken = await decryptAiCredential(seed.token_iv, seed.encrypted_token);
        const credentials = seed.provider === "gmail" ? { clientId: vars.OUTREACH_SEED_GOOGLE_CLIENT_ID || "", clientSecret: vars.OUTREACH_SEED_GOOGLE_CLIENT_SECRET || "" } : { clientId: vars.OUTREACH_SEED_MS_CLIENT_ID || "", clientSecret: vars.OUTREACH_SEED_MS_CLIENT_SECRET || "" };
        const { accessToken } = await exchangeSeedToken(seed.provider, { ...credentials, redirectUri: "", code: "", refreshToken });
        results.push({ seed: seed.email, provider: seed.provider, placement: await findPlacement(seed.provider, accessToken, test.token) });
      } catch (error) {
        await database.prepare("UPDATE outreach_seeds SET status = 'error', last_error = ?2, updated_at = ?3 WHERE id = ?1").bind(seed.id, (error instanceof Error ? error.message : String(error)).slice(0, 200), nowIso()).run();
      }
    }
    const old = now.getTime() - new Date(test.created_at).getTime() > 30 * 60_000;
    const allFound = results.length > 0 && results.every((result) => result.placement !== "missing");
    if (allFound || old) {
      const summary = summarisePlacement(results);
      await database.prepare("UPDATE outreach_placement_tests SET status = 'done', results_json = ?2, inbox_rate = ?3, completed_at = ?4 WHERE id = ?1").bind(test.id, JSON.stringify(results), summary.inboxRate, nowIso()).run();
    } else await database.prepare("UPDATE outreach_placement_tests SET results_json = ?2 WHERE id = ?1").bind(test.id, JSON.stringify(results)).run();
  }
  return { checked: tests.length };
}

// ============================ alerts ============================
/** Only critical infrastructure failures alert (once a day per issue). Routine events never do. */
export async function criticalAlert(ownerId: string, settings: OutreachSettings, key: string, title: string, detail: string) {
  const telegram = await telegramConfig(ownerId);
  if (!telegram?.chatId) return false;
  return alertOnce(ownerId, key, detail, async () => { const alert = formatOperationalAlert({ title, detail, url: settings.appUrl ? `${settings.appUrl.replace(/\/$/, "")}/?page=CRM&leads=outreach` : undefined }); await createTelegram(telegram).send(alert.text, alert.buttons); });
}
