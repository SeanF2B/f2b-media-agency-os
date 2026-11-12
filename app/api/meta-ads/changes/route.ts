import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getTeamPermissions, type TeamPermissions } from "@/lib/access-permissions";
import { canViewAiAssignedTask, isAiAssignedTask } from "@/lib/ai-task-access";
import { directMetaAdsManagementPermission, metaAdsConnectionExists, readDirectMetaCampaign, readDirectMetaEntity, updateDirectMetaCampaign, updateDirectMetaEntity, type DirectMetaEntityType } from "@/lib/meta-ads-direct";
import { isMetaChangeValueCurrent, isMetaChangeValueValid, isMetaEntityStatusValid, toMetaBudgetMinorUnits } from "@/lib/meta-ads-approval";

export const dynamic = "force-dynamic";
const reply = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
type MetaApprovalTask = Omit<Parameters<typeof isAiAssignedTask>[0], "aiApprovals"> & { id?: string; clientId?: string; aiApprovals?: Array<{ pendingChangeId?: string; status: string }> };
type MetaChangeRow = { id: string; account_id: string; campaign_id: string; campaign_name: string; field: "status" | "daily_budget"; currency: string; old_value: string; new_value: string; status: string };

async function getContext(user: { userId: string; email: string }) {
  if (!env.DB) return { error: "The workspace database is unavailable.", status: 503 as const };
  const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!row?.data) return { error: "The workspace could not be loaded.", status: 503 as const };
  const data = JSON.parse(row.data);
  const profile = (data.staff || []).find((member: { id?: string; email?: string; isBot?: boolean }) => !member.isBot && (member.id === user.userId || member.email?.toLowerCase() === user.email.toLowerCase()));
  const admin = data.ownerId === user.userId || ["Owner", "Admin"].includes(profile?.role || "");
  return { data, ownerId: String(data.ownerId || user.userId), profile, admin };
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return reply({ error: "Sign in to view Meta campaign changes." }, 401);
  const context = await getContext(user);
  if ("error" in context) return reply({ error: context.error }, context.status);
  const clientId = new URL(request.url).searchParams.get("clientId") || "";
  const client = (context.data.clients || []).find((item: { id: string }) => item.id === clientId);
  if (!client) return reply({ error: "Choose a client in this workspace." }, 404);
  const permissions = getTeamPermissions(context.profile?.role || "Viewer", context.profile?.permissions as Partial<TeamPermissions> | undefined);
  if (!context.admin && (!permissions.reports || Array.isArray(context.profile?.clientAccessIds) && !context.profile.clientAccessIds.includes(clientId))) return reply({ error: "You do not have access to this client's Meta Ads changes." }, 403);
  const [rows, entityRows] = await Promise.all([
    env.DB!.prepare("SELECT id, client_id AS clientId, account_id AS accountId, campaign_id AS campaignId, campaign_name AS campaignName, field, currency, old_value AS oldValue, new_value AS newValue, status, actor, created_at AS createdAt, decided_at AS decidedAt, result_detail AS resultDetail, verified FROM meta_ads_change_proposals WHERE owner_id = ?1 AND client_id = ?2 ORDER BY created_at DESC LIMIT 100").bind(context.ownerId, clientId).all(),
    env.DB!.prepare("SELECT id, client_id AS clientId, account_id AS accountId, entity_type AS entityType, entity_id AS entityId, entity_name AS entityName, campaign_id AS campaignId, campaign_name AS campaignName, old_status AS oldValue, new_status AS newValue, 'status' AS field, '' AS currency, status, actor, created_at AS createdAt, decided_at AS decidedAt, result_detail AS resultDetail, verified FROM meta_ads_entity_change_proposals WHERE owner_id = ?1 AND client_id = ?2 ORDER BY created_at DESC LIMIT 100").bind(context.ownerId, clientId).all(),
  ]);
  const connected = await metaAdsConnectionExists(context.ownerId);
  let canManage = false;
  let setupMessage = "Connect Meta Ads directly to prepare campaign changes.";
  if (connected) {
    try { canManage = await directMetaAdsManagementPermission(context.ownerId); setupMessage = canManage ? "Approved changes are applied through Meta and checked by reading the campaign back." : "Reconnect Meta Ads and grant ads_management permission to enable approved changes."; }
    catch (error) { setupMessage = error instanceof Error ? error.message : "Meta Ads permission could not be checked."; }
  }
  const proposals = [...(rows.results || []), ...(entityRows.results || [])].sort((a, b) => String((b as { createdAt?: string }).createdAt || "").localeCompare(String((a as { createdAt?: string }).createdAt || "")));
  return reply({ proposals, canManage, setupMessage });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return reply({ error: "Sign in before changing Meta campaigns." }, 401);
  if (!env.DB) return reply({ error: "The workspace database is unavailable." }, 503);
  const context = await getContext(user);
  if ("error" in context) return reply({ error: context.error }, context.status);
  let body: { action?: string; clientId?: string; campaignId?: string; proposalId?: string; taskId?: string; field?: string; value?: string | number; entityType?: string; entityId?: string; entityName?: string };
  try { body = await request.json() as typeof body; } catch { return reply({ error: "The Meta change request was not valid." }, 400); }
  const permissions = getTeamPermissions(context.profile?.role || "Viewer", context.profile?.permissions as Partial<TeamPermissions> | undefined);
  const clientId = String(body.clientId || "");
  const proposalId = String(body.proposalId || "");
  const taskId = String(body.taskId || "");
  if (!context.admin) {
    if (body.action === "stage" || !permissions.aiApprovals || Array.isArray(context.profile?.clientAccessIds) && !context.profile.clientAccessIds.includes(clientId)) return reply({ error: "Only an admin can stage a Meta Ads change here. AI task changes require the task approval permission and access to that client." }, 403);
    const linkedTask = ((context.data.tasks || []) as MetaApprovalTask[]).find((task) => task.id === taskId && task.clientId === clientId && isAiAssignedTask(task) && canViewAiAssignedTask(task, permissions, context.profile?.aiModeAccess || ["Meta Ads"]) && (task.aiApprovals || []).some((item) => item.pendingChangeId === proposalId && (item.status === "pending" || body.action === "reconcile" && item.status === "applying")));
    if (!linkedTask) return reply({ error: "This Meta Ads proposal is not linked to an AI task you can approve." }, 403);
  }
  const client = (context.data.clients || []).find((item: { id: string; metaAdsAccountId?: string }) => item.id === clientId);
  const accountId = String(client?.metaAdsAccountId || "").replace(/^act_/i, "").replace(/\D/g, "");
  if (!client || !/^\d{6,20}$/.test(accountId)) return reply({ error: "Map this client to a valid Meta Ads account before proposing a change." }, 400);
  if (body.action !== "reject" && body.action !== "reject_entity") {
    if (!(await metaAdsConnectionExists(context.ownerId))) return reply({ error: "Connect Meta Ads directly before proposing campaign changes. Windsor connections are read-only." }, 409);
    if (!(await directMetaAdsManagementPermission(context.ownerId))) return reply({ error: "This Meta login does not have the ads_management permission. Reconnect with the required approved permission before proposing changes." }, 403);
  }

  if (body.action === "stage") {
    const campaignId = String(body.campaignId || "").replace(/\D/g, "");
    if (!/^\d{6,24}$/.test(campaignId)) return reply({ error: "Choose a campaign with a valid Meta ID." }, 400);
    const field = body.field;
    if (field !== "status" && field !== "daily_budget") return reply({ error: "Choose pause, resume or daily budget." }, 400);
    let newValue: string;
    try {
      const campaign = await readDirectMetaCampaign(context.ownerId, accountId, campaignId);
      if (field === "status") {
        const value = String(body.value || "").toUpperCase();
        if (!["ACTIVE", "PAUSED"].includes(value)) return reply({ error: "Campaign status must be Active or Paused." }, 400);
        if (campaign.status === value) return reply({ error: `This campaign is already ${value.toLowerCase()}.` }, 409);
        newValue = value;
      } else {
        if (campaign.dailyBudgetMinor == null) return reply({ error: "Meta did not return a campaign daily budget. This campaign may use an ad set or lifetime budget; no change was staged." }, 409);
        newValue = String(toMetaBudgetMinorUnits(Number(body.value), campaign.currency));
        if (Number(newValue) === campaign.dailyBudgetMinor) return reply({ error: "The new daily budget matches the current budget." }, 409);
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await env.DB.prepare("INSERT INTO meta_ads_change_proposals (id, owner_id, client_id, account_id, campaign_id, campaign_name, field, currency, old_value, new_value, status, actor, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'pending', ?11, ?12)").bind(id, context.ownerId, clientId, accountId, campaign.id, campaign.name, field, campaign.currency, field === "daily_budget" ? String(campaign.dailyBudgetMinor) : campaign.status, newValue, user.displayName || user.email, now).run();
      return reply({ ok: true, proposalId: id, campaignName: campaign.name, field, oldValue: field === "daily_budget" ? campaign.dailyBudgetMinor : campaign.status, newValue, currency: campaign.currency, status: "pending" });
    } catch (error) { return reply({ error: error instanceof Error ? error.message : "Could not read this campaign to stage a change." }, 502); }
  }

  if (body.action === "stage_entity") {
    if (!context.admin) return reply({ error: "Only an owner or admin can stage Meta ad-set or ad changes." }, 403);
    const entityType = body.entityType;
    if (entityType !== "ad_set" && entityType !== "ad") return reply({ error: "Choose an ad set or ad." }, 400);
    const entityId = String(body.entityId || "").replace(/\D/g, "");
    const value = String(body.value || "").toUpperCase();
    if (!/^\d{6,24}$/.test(entityId) || !isMetaEntityStatusValid(entityType, value)) return reply({ error: "Choose a valid Meta item and pause or resume action." }, 400);
    try {
      const entity = await readDirectMetaEntity(context.ownerId, accountId, entityType as DirectMetaEntityType, entityId);
      if (entity.status === value) return reply({ error: `This ${entityType === "ad_set" ? "ad set" : "ad"} is already ${value.toLowerCase()}.` }, 409);
      const campaign = await readDirectMetaCampaign(context.ownerId, accountId, entity.campaignId);
      const id = crypto.randomUUID(), now = new Date().toISOString();
      await env.DB.prepare("INSERT INTO meta_ads_entity_change_proposals (id, owner_id, client_id, account_id, entity_type, entity_id, entity_name, campaign_id, campaign_name, old_status, new_status, status, actor, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'pending', ?12, ?13)").bind(id, context.ownerId, clientId, accountId, entityType, entity.id, entity.name, entity.campaignId, campaign.name, entity.status, value, user.displayName || user.email, now).run();
      return reply({ ok: true, proposalId: id, entityName: entity.name, campaignName: campaign.name, field: "status", oldValue: entity.status, newValue: value, status: "pending" });
    } catch (error) { return reply({ error: error instanceof Error ? error.message : "Could not read this Meta item to stage a change." }, 502); }
  }

  if (body.action === "approve_entity" || body.action === "reject_entity") {
    const id = String(body.proposalId || "");
    const proposal = await env.DB.prepare("SELECT * FROM meta_ads_entity_change_proposals WHERE id = ?1 AND owner_id = ?2 AND client_id = ?3").bind(id, context.ownerId, clientId).first<{ id: string; account_id: string; entity_type: DirectMetaEntityType; entity_id: string; entity_name: string; campaign_id: string; campaign_name: string; old_status: string; new_status: string; status: string }>();
    if (!proposal || proposal.account_id !== accountId) return reply({ error: "This Meta item change was not found for the currently linked client account." }, 404);
    if (proposal.status !== "pending") return reply({ error: "This Meta item change has already been decided or applied." }, 409);
    if (body.action === "reject_entity") {
      const updated = await env.DB.prepare("UPDATE meta_ads_entity_change_proposals SET status = 'rejected', actor = ?1, decided_at = ?2, result_detail = 'Rejected by the workspace owner; no Meta Ads change was made.' WHERE id = ?3 AND owner_id = ?4 AND status = 'pending'").bind(user.displayName || user.email, new Date().toISOString(), id, context.ownerId).run();
      return updated.meta.changes ? reply({ ok: true, status: "rejected" }) : reply({ error: "This proposal changed while you were deciding. Refresh the page." }, 409);
    }
    if (!isMetaEntityStatusValid(proposal.entity_type, proposal.new_status)) return reply({ error: "The saved Meta item change is invalid." }, 409);
    const claimed = await env.DB.prepare("UPDATE meta_ads_entity_change_proposals SET status = 'applying' WHERE id = ?1 AND owner_id = ?2 AND status = 'pending'").bind(id, context.ownerId).run();
    if (!claimed.meta.changes) return reply({ error: "This Meta item change is already being applied or used." }, 409);
    let writeAccepted = false;
    try {
      const before = await readDirectMetaEntity(context.ownerId, accountId, proposal.entity_type, proposal.entity_id);
      if (before.status !== proposal.old_status || before.campaignId !== proposal.campaign_id) throw new Error("The live Meta item changed after this proposal was prepared. No write was made; prepare a fresh proposal.");
      await updateDirectMetaEntity(context.ownerId, proposal.entity_id, proposal.new_status as "ACTIVE" | "PAUSED");
      writeAccepted = true;
      const after = await readDirectMetaEntity(context.ownerId, accountId, proposal.entity_type, proposal.entity_id);
      const verified = after.status === proposal.new_status && after.campaignId === proposal.campaign_id;
      const detail = verified ? `Meta live read-back confirmed ${proposal.entity_type === "ad_set" ? "ad set" : "ad"} “${proposal.entity_name}” is ${proposal.new_status}.` : `Meta accepted the update but the live read-back returned ${after.status}; the final state is unverified.`;
      const now = new Date().toISOString();
      await env.DB.prepare("UPDATE meta_ads_entity_change_proposals SET status = 'applied', actor = ?1, decided_at = ?2, result_detail = ?3, verified = ?4 WHERE id = ?5 AND owner_id = ?6 AND status = 'applying'").bind(user.displayName || user.email, now, detail, verified ? 1 : 0, id, context.ownerId).run();
      return reply({ ok: true, status: "applied", verified, detail });
    } catch (error) {
      const detail = writeAccepted ? "Meta accepted the item update, but live read-back failed. Check the item in Meta before trying another change." : error instanceof Error ? error.message : "Meta did not confirm this item change.";
      const status = writeAccepted ? "applied" : "failed";
      await env.DB.prepare("UPDATE meta_ads_entity_change_proposals SET status = ?1, actor = ?2, decided_at = ?3, result_detail = ?4, verified = 0 WHERE id = ?5 AND owner_id = ?6 AND status = 'applying'").bind(status, user.displayName || user.email, new Date().toISOString(), detail, id, context.ownerId).run();
      return reply({ ...(writeAccepted ? { ok: true } : { error: detail }), status, verified: false, detail }, writeAccepted ? 200 : 502);
    }
  }

  if (body.action === "reject" || body.action === "approve") {
    const id = String(body.proposalId || "");
    const proposal = await env.DB.prepare("SELECT * FROM meta_ads_change_proposals WHERE id = ?1 AND owner_id = ?2 AND client_id = ?3").bind(id, context.ownerId, clientId).first<MetaChangeRow>();
    if (!proposal || proposal.account_id !== accountId) return reply({ error: "This campaign change was not found for the currently linked client account." }, 404);
    if (proposal.status !== "pending") return reply({ error: "This campaign change has already been decided or applied." }, 409);
    if (body.action === "reject") {
      const now = new Date().toISOString();
      const updated = await env.DB.prepare("UPDATE meta_ads_change_proposals SET status = 'rejected', actor = ?1, decided_at = ?2, result_detail = 'Rejected by the workspace owner; no Meta Ads change was made.' WHERE id = ?3 AND owner_id = ?4 AND status = 'pending'").bind(user.displayName || user.email, now, id, context.ownerId).run();
      return updated.meta.changes ? reply({ ok: true, status: "rejected" }) : reply({ error: "This proposal changed while you were deciding. Refresh the page." }, 409);
    }
    const field = String(proposal.field) as "status" | "daily_budget";
    if (!isMetaChangeValueValid(field, proposal.new_value)) return reply({ error: "The saved proposal is invalid and was not applied." }, 409);
    const claimed = await env.DB.prepare("UPDATE meta_ads_change_proposals SET status = 'applying' WHERE id = ?1 AND owner_id = ?2 AND status = 'pending'").bind(id, context.ownerId).run();
    if (!claimed.meta.changes) return reply({ error: "This proposal is already being applied or has already been used." }, 409);
    let writeAccepted = false;
    try {
      const before = await readDirectMetaCampaign(context.ownerId, accountId, proposal.campaign_id);
      if (!isMetaChangeValueCurrent(field, before, proposal.old_value)) throw new Error("The live campaign changed after this proposal was prepared. No write was made; prepare a fresh proposal.");
      await updateDirectMetaCampaign(context.ownerId, proposal.campaign_id, field, field === "daily_budget" ? Number(proposal.new_value) : proposal.new_value);
      writeAccepted = true;
      const after = await readDirectMetaCampaign(context.ownerId, accountId, proposal.campaign_id);
      const actual = field === "status" ? after.status : after.dailyBudgetMinor == null ? "" : String(after.dailyBudgetMinor);
      const verified = actual === proposal.new_value;
      const digits = new Intl.NumberFormat("en", { style: "currency", currency: after.currency || "EUR" }).resolvedOptions().maximumFractionDigits ?? 2;
      const detail = verified ? `Meta read-back confirmed ${field === "status" ? `campaign status ${actual}` : `daily budget ${Number(actual) / (10 ** digits)} ${after.currency || "EUR"}`}.` : `Meta accepted the update but read-back returned ${actual || "no value"}; the final state is unverified.`;
      const now = new Date().toISOString();
      await env.DB.prepare("UPDATE meta_ads_change_proposals SET status = 'applied', actor = ?1, decided_at = ?2, result_detail = ?3, verified = ?4 WHERE id = ?5 AND owner_id = ?6 AND status = 'applying'").bind(user.displayName || user.email, now, detail, verified ? 1 : 0, id, context.ownerId).run();
      return reply({ ok: true, status: "applied", verified, detail });
    } catch (error) {
      const detail = writeAccepted
        ? "Meta accepted the campaign update, but the read-back check failed. The change is recorded as applied but unverified. Check the campaign in Meta before trying another change."
        : error instanceof Error ? error.message : "Meta did not confirm the change.";
      const finalStatus = writeAccepted ? "applied" : "failed";
      await env.DB.prepare("UPDATE meta_ads_change_proposals SET status = ?1, actor = ?2, decided_at = ?3, result_detail = ?4, verified = 0 WHERE id = ?5 AND owner_id = ?6 AND status = 'applying'").bind(finalStatus, user.displayName || user.email, new Date().toISOString(), detail, id, context.ownerId).run();
      return reply({ ...(writeAccepted ? { ok: true } : { error: detail }), status: finalStatus, verified: false, detail }, writeAccepted ? 200 : 502);
    }
  }
  if (body.action === "reconcile") {
    const id = String(body.proposalId || "");
    const proposal = await env.DB.prepare("SELECT * FROM meta_ads_change_proposals WHERE id = ?1 AND owner_id = ?2 AND client_id = ?3").bind(id, context.ownerId, clientId).first<MetaChangeRow>();
    if (!proposal || proposal.account_id !== accountId) return reply({ error: "This Meta Ads change was not found for the currently linked client account." }, 404);
    if (proposal.status !== "applying") return reply({ error: "This Meta Ads change is not waiting for a live status check." }, 409);
    try {
      const current = await readDirectMetaCampaign(context.ownerId, accountId, proposal.campaign_id);
      const actual = proposal.field === "status" ? current.status : current.dailyBudgetMinor == null ? "" : String(current.dailyBudgetMinor);
      const expectedNew = String(proposal.new_value);
      const expectedOld = String(proposal.old_value);
      const now = new Date().toISOString();
      if (actual === expectedNew) {
        const detail = `Meta live read-back confirmed ${proposal.field === "status" ? `campaign status ${actual}` : `daily budget ${actual} minor units ${current.currency}`}.`;
        await env.DB.prepare("UPDATE meta_ads_change_proposals SET status = 'applied', actor = ?1, decided_at = ?2, result_detail = ?3, verified = 1 WHERE id = ?4 AND owner_id = ?5 AND status = 'applying'").bind(user.displayName || user.email, now, detail, id, context.ownerId).run();
        return reply({ ok: true, applied: true, verified: true, checkedAt: now, detail });
      }
      const detail = actual === expectedOld
        ? "Meta live read-back confirms the previous value is still in place. No change is confirmed; this proposal is ready for your decision again."
        : `Meta currently shows ${actual || "no value"}, which differs from both the saved old and proposed values. The proposal was refreshed against the current value and returned to review; nothing was changed by this check.`;
      await env.DB.prepare("UPDATE meta_ads_change_proposals SET status = 'pending', old_value = ?1, actor = ?2, decided_at = NULL, result_detail = ?3, verified = 0 WHERE id = ?4 AND owner_id = ?5 AND status = 'applying'").bind(actual || expectedOld, user.displayName || user.email, detail, id, context.ownerId).run();
      return reply({ ok: true, applied: false, verified: true, checkedAt: now, detail });
    } catch (error) { return reply({ error: error instanceof Error ? error.message : "Meta Ads could not verify this interrupted approval." }, 502); }
  }
  return reply({ error: "Choose stage, approve or reject." }, 400);
}
