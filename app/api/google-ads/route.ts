import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { fullTeamPermissions, getTeamPermissions, type TeamPermissions } from "@/lib/access-permissions";
import { canViewAiAssignedTask, getAiTaskStage, isAiAssignedTask } from "@/lib/ai-task-access";
import { createGoogleAdsCampaignAsset, generateGoogleAdsKeywordIdeas, getGoogleAdsKeywordCriterion, getGoogleAdsSearchTerms, listGoogleAdsAccessibleCustomers, listGoogleAdsAdGroups, listGoogleAdsCampaignLevelAssets, listGoogleAdsCampaigns, listGoogleAdsResponsiveSearchAds, mutateGoogleAdsKeyword, readGoogleAdsCampaign, removeGoogleAdsCampaignAsset, updateGoogleAdsCampaign, updateGoogleAdsCampaignBudget, updateGoogleAdsResponsiveSearchAd } from "@/lib/google-ads-direct";
import { executeWindsorAdsAction, getWindsorAdsActions, omitNullOptionalParams, validateWindsorParams } from "@/lib/windsor-google-ads-actions";
import { canDecideGoogleAdsApproval } from "@/lib/google-ads-approval-retention";
import { GOOGLE_ADS_APPROVAL_NEVER_EXPIRES_AT } from "@/lib/google-ads-approval-retention";

export const dynamic = "force-dynamic";

function displayParams(params: Record<string, unknown>) {
  return Object.entries(params).map(([key, value]) => `${key.replaceAll("_", " ")}: ${Array.isArray(value) ? value.map((item) => typeof item === "object" && item !== null ? JSON.stringify(item) : String(item)).join(", ") : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)}`).join(" · ").slice(0, 1800);
}

function keywordActivityMetadata(value: string) {
  const match = value.match(/(?:^| · )(?:Added|Removed) (?:(negative) )?keyword “(.+?)” \((EXACT|PHRASE|BROAD)\) in (?:ad group )?(.+)$/i);
  if (!match) return null;
  return { negative: Boolean(match[1]), keyword: match[2], matchType: match[3].toUpperCase() as "EXACT" | "PHRASE" | "BROAD", adGroup: match[4].trim() };
}

function isKeywordChange(type: string) {
  return ["ADD_KEYWORD", "REMOVE_KEYWORD", "ADD_NEGATIVE_KEYWORD", "REMOVE_NEGATIVE_KEYWORD"].includes(type);
}

function validAdContent(value: string) {
  try {
    const parsed = JSON.parse(value) as { headlines?: Array<{ text: string; pinnedField?: string }>; descriptions?: Array<{ text: string; pinnedField?: string }> };
    return Array.isArray(parsed.headlines) && parsed.headlines.length >= 3 && Array.isArray(parsed.descriptions) && parsed.descriptions.length >= 2 ? parsed : null;
  } catch { return null; }
}

function validCampaignAssetChange(value: string) {
  try {
    const parsed = JSON.parse(value) as { asset?: unknown; associationResourceName?: unknown; assetResourceName?: unknown };
    return parsed.asset && typeof parsed.asset === "object" && typeof parsed.associationResourceName === "string" && parsed.associationResourceName.startsWith("customers/") ? parsed as { asset: Record<string, unknown>; associationResourceName: string; assetResourceName?: string } : null;
  } catch { return null; }
}

async function adminContext(user: { userId: string; email: string }) {
  const row = await env.DB?.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!row) return null;
  const data = JSON.parse(row.data);
  const profile = data.staff?.find((person: { id?: string; email?: string }) => person.id === user.userId || person.email?.toLowerCase() === user.email.toLowerCase());
  const owner = data.ownerId === user.userId;
  const admin = owner || ["Owner", "Admin"].includes(profile?.role || "");
  const permissions: TeamPermissions = owner ? fullTeamPermissions : getTeamPermissions(profile?.role || "Viewer", profile?.permissions);
  const allowedAiModes = Array.isArray(profile?.aiModeAccess) ? profile.aiModeAccess : ["Google Ads", "SEO", "Audit", "Research", "Setup", "Sites"];
  const allowedClientIds = Array.isArray(profile?.clientAccessIds) ? profile.clientAccessIds : null;
  return admin || permissions.aiApprovals || permissions.aiCompletedTasks
    ? { data, ownerId: data.ownerId, admin, permissions, allowedAiModes, allowedClientIds }
    : null;
}

function canStaffSeeCompletedAiHistory(access: NonNullable<Awaited<ReturnType<typeof adminContext>>>, clientId: string) {
  if (access.admin) return true;
  if (!access.permissions.aiCompletedTasks || access.allowedClientIds && !access.allowedClientIds.includes(clientId)) return false;
  return (access.data.tasks || []).some((task: any) => isAiAssignedTask(task)
    && task.clientId === clientId
    && canViewAiAssignedTask(task, access.permissions, access.allowedAiModes)
    && getAiTaskStage(task) === "completed");
}

function canStaffDecideAiApproval(access: NonNullable<Awaited<ReturnType<typeof adminContext>>>, pendingChangeId: string, status: "pending" | "applying") {
  if (access.admin) return true;
  if (!access.permissions.aiApprovals) return false;
  return (access.data.tasks || []).some((task: any) => isAiAssignedTask(task)
    && canViewAiAssignedTask(task, access.permissions, access.allowedAiModes)
    && (!access.allowedClientIds || access.allowedClientIds.includes(task.clientId))
    && (task.aiApprovals || []).some((approval: any) => approval.pendingChangeId === pendingChangeId && approval.status === status));
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in to check Google Ads." }, { status: 401 });
  const access = await adminContext(user);
  if (!access || !env.DB) return Response.json({ error: "You do not have access to this Google Ads connection." }, { status: 403 });
  const url = new URL(request.url);
  const activityClientId = url.searchParams.get("activityClientId");
  if (!access.admin && (!activityClientId || !canStaffSeeCompletedAiHistory(access, activityClientId))) return Response.json({ error: "AI task history access is required to view these results." }, { status: 403 });
  const [saved, usable] = await Promise.all([
    env.DB.prepare("SELECT account_email, connected_at FROM google_ads_connections WHERE owner_id = ?1").bind(access.ownerId).first<{ account_email: string; connected_at: string }>(),
    Promise.resolve(Boolean(env.GOOGLE_ADS_CLIENT_ID && env.GOOGLE_ADS_CLIENT_SECRET && env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY)),
  ]);
  const status = { configured: usable, connected: Boolean(saved), accountEmail: saved?.account_email || "", connectedAt: saved?.connected_at || "", apiReady: usable && Boolean(saved) };
  if (url.searchParams.get("connectionStatus") === "1") return Response.json(status, { headers: { "Cache-Control": "no-store" } });
  if (url.searchParams.get("accessibleCustomers") === "1") {
    if (!access.admin) return Response.json({ error: "Only an owner or admin can list and map connected Google Ads accounts." }, { status: 403 });
    if (!usable) return Response.json({ error: "Google Ads OAuth settings are missing from the app server." }, { status: 503 });
    if (!saved) return Response.json({ error: "Connect the Google account that has access to your Ads accounts first." }, { status: 409 });
    try {
      const customers = await listGoogleAdsAccessibleCustomers(access.ownerId);
      return Response.json({ accounts: customers.map((id) => ({ id, name: `Google Ads account ${id}` })) }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Could not list directly accessible Google Ads accounts." }, { status: 502 });
    }
  }
  const campaignsForClient = url.searchParams.get("campaignsForClient");
  if (!access.admin && campaignsForClient) return Response.json({ error: "Only an owner or admin can load Ads campaigns." }, { status: 403 });
  if (campaignsForClient) {
    const client = access.data.clients?.find((item: { id: string; googleAdsAccountId?: string }) => item.id === campaignsForClient && item.googleAdsAccountId);
    if (!client) return Response.json({ error: "This client has no Google Ads account mapped." }, { status: 404 });
    try {
      const campaigns = await listGoogleAdsCampaigns(access.ownerId, String(client.googleAdsAccountId));
      return Response.json({ campaigns: campaigns.map(({ id, name, status, budgetMicros }) => ({ id, name, status, dailyBudget: (budgetMicros / 1_000_000).toFixed(2) })) }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Could not load campaigns." }, { status: 502 });
    }
  }
  const adGroupsForClient = url.searchParams.get("adGroupsForClient");
  if (adGroupsForClient) {
    if (!access.admin) return Response.json({ error: "Only an owner or admin can load ad groups for keyword changes." }, { status: 403 });
    const campaignId = url.searchParams.get("campaignId") || "";
    const client = access.data.clients?.find((item: { id: string; googleAdsAccountId?: string }) => item.id === adGroupsForClient && item.googleAdsAccountId);
    if (!client) return Response.json({ error: "This client has no Google Ads account mapped." }, { status: 404 });
    try { return Response.json({ adGroups: await listGoogleAdsAdGroups(access.ownerId, String(client.googleAdsAccountId), campaignId) }, { headers: { "Cache-Control": "no-store" } }); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not load ad groups." }, { status: 502 }); }
  }
  const pendingClientId = url.searchParams.get("pendingClientId");
  if (pendingClientId) {
    if (!access.admin) return Response.json({ error: "Only an owner or admin can review Google Ads proposals here." }, { status: 403 });
    const rows = await env.DB.prepare("SELECT id, campaign_id, campaign_name, change_type, old_value, new_value, payload_json, created_at, created_by FROM google_ads_pending_changes WHERE owner_id = ?1 AND client_id = ?2 AND status = 'pending' ORDER BY created_at DESC LIMIT 100").bind(access.ownerId, pendingClientId).all<Record<string, unknown>>();
    return Response.json({ proposals: rows.results || [] }, { headers: { "Cache-Control": "no-store" } });
  }
  if (activityClientId) {
    const client = access.data.clients?.find((item: { id: string; googleAdsAccountId?: string }) => item.id === activityClientId && item.googleAdsAccountId);
    if (!client) return Response.json({ error: "This client has no Google Ads account mapped." }, { status: 404 });
    const result = await env.DB.prepare("SELECT id, campaign_id, campaign_name, change_type, old_value, new_value, actor, created_at FROM google_ads_change_log WHERE owner_id = ?1 AND client_id = ?2 ORDER BY created_at DESC LIMIT 500").bind(access.ownerId, activityClientId).all<{ id: string; campaign_id: string; campaign_name: string; change_type: string; old_value: string; new_value: string; actor: string; created_at: string }>();
    const activity = result.results || [];
    const reverted = new Set(activity.flatMap((item) => item.change_type.startsWith("REVERT:") ? [item.change_type.slice("REVERT:".length)] : []));
    return Response.json({ activity: activity.map((item) => ({ ...item, reverted: reverted.has(item.id), reversible: !reverted.has(item.id) && (["PAUSED", "ENABLED", "SET_DAILY_BUDGET"].includes(item.change_type) || (isKeywordChange(item.change_type) && Boolean(keywordActivityMetadata(item.campaign_name))) || (item.change_type === "UPDATE_RESPONSIVE_SEARCH_AD" && Boolean(validAdContent(item.old_value) && validAdContent(item.new_value))) || (item.change_type === "ADD_CAMPAIGN_ASSET" && Boolean(validCampaignAssetChange(item.new_value)))) })) , scope: "Changes applied through Agency OS" }, { headers: { "Cache-Control": "no-store" } });
  }
  const testCustomerId = url.searchParams.get("testCustomerId");
  const keywordTest = url.searchParams.get("keywordTest");
  const searchTermsTest = url.searchParams.get("searchTermsTest");
  if (!testCustomerId) return Response.json(status);
  if (!saved) return Response.json({ ...status, readTest: { ok: false, error: "Connect Google Ads first." } }, { status: 409 });
  try {
    if (keywordTest === "1") {
      const keywords = (url.searchParams.get("keywords") || "").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 10);
      const keywordIdeas = await generateGoogleAdsKeywordIdeas(access.ownerId, testCustomerId, { keywords, url: url.searchParams.get("url") || "", geoTargetConstant: url.searchParams.get("geo") || "2372" });
      return Response.json({ ...status, keywordTest: { ok: true, count: keywordIdeas.count, examples: keywordIdeas.results.slice(0, 5) } });
    }
    if (searchTermsTest === "1") {
      const report = await getGoogleAdsSearchTerms(access.ownerId, testCustomerId);
      return Response.json({ ...status, searchTermsTest: { ok: true, count: report.terms.length, examples: report.terms.slice(0, 5), note: report.note } });
    }
    const campaigns = await listGoogleAdsCampaigns(access.ownerId, testCustomerId);
    return Response.json({ ...status, readTest: { ok: true, customerId: testCustomerId.replace(/\D/g, ""), campaignsFound: campaigns.length } });
  } catch (error) {
    return Response.json({ ...status, readTest: { ok: false, error: error instanceof Error ? error.message : "Google Ads read failed." } }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in before changing Google Ads." }, { status: 401 });
  const access = await adminContext(user);
  if (!access || !env.DB) return Response.json({ error: "You do not have permission to approve Google Ads changes." }, { status: 403 });
  try {
    const body = await request.json() as { confirmed?: boolean; pendingChangeId?: string; decision?: "reject"; revertActivityId?: string; reconcilePendingChangeId?: string; proposeKeyword?: { clientId: string; campaignId: string; adGroupId: string; keyword: string; matchType: "EXACT" | "PHRASE" | "BROAD"; negative: boolean; remove: boolean } };
    if (body.proposeKeyword) {
      if (!access.admin) return Response.json({ error: "Only an owner or admin can prepare a Google Ads keyword change." }, { status: 403 });
      const input = body.proposeKeyword;
      const client = access.data.clients?.find((item: { id: string; googleAdsAccountId?: string }) => item.id === input.clientId && item.googleAdsAccountId);
      if (!client) return Response.json({ error: "Map this client to its Google Ads account first." }, { status: 404 });
      const campaignId = String(input.campaignId || "").replace(/\D/g, "");
      const adGroupId = String(input.adGroupId || "").replace(/\D/g, "");
      const keyword = String(input.keyword || "").trim();
      if (!/^\d{3,20}$/.test(campaignId) || !/^\d{3,20}$/.test(adGroupId) || !keyword || keyword.length > 80 || !["EXACT", "PHRASE", "BROAD"].includes(input.matchType) || typeof input.negative !== "boolean" || typeof input.remove !== "boolean") return Response.json({ error: "Choose a campaign, ad group, keyword, match type and action." }, { status: 400 });
      const customerId = String(client.googleAdsAccountId).replace(/\D/g, "");
      const [campaign, groups] = await Promise.all([readGoogleAdsCampaign(access.ownerId, customerId, campaignId), listGoogleAdsAdGroups(access.ownerId, customerId, campaignId)]);
      if (!groups.some((group) => group.id === adGroupId && group.campaignId === campaignId)) return Response.json({ error: "That ad group does not belong to the selected campaign." }, { status: 409 });
      const criterion = { adGroupId, keyword, matchType: input.matchType, negative: input.negative };
      const existing = await getGoogleAdsKeywordCriterion(access.ownerId, customerId, criterion);
      if (input.remove && !existing) return Response.json({ error: "That exact keyword is not in the selected ad group. Nothing was changed." }, { status: 409 });
      if (!input.remove && existing) return Response.json({ error: "That exact keyword already exists in the selected ad group. Nothing was changed." }, { status: 409 });
      const changeType = `${input.remove ? "REMOVE" : "ADD"}_${input.negative ? "NEGATIVE_" : ""}KEYWORD`;
      const summary = `${input.remove ? "Remove" : "Add"} ${input.negative ? "negative " : ""}keyword “${keyword}” (${input.matchType}) in ${groups.find((group) => group.id === adGroupId)?.name || "selected ad group"}`;
      const id = crypto.randomUUID(); const createdAt = new Date().toISOString();
      await env.DB.prepare("INSERT INTO google_ads_pending_changes (id, owner_id, client_id, customer_id, campaign_id, campaign_name, campaign_budget_resource, change_type, old_value, new_value, status, created_by, created_at, expires_at, payload_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'pending', ?11, ?12, ?13, ?14)")
        .bind(id, access.ownerId, input.clientId, customerId, campaignId, campaign.name, campaign.budgetResourceName || "", changeType, input.remove ? `${keyword} (${input.matchType}${input.negative ? ", negative" : ""})` : "Not present", input.remove ? "Removed" : `${keyword} (${input.matchType}${input.negative ? ", negative" : ""})`, user.displayName, createdAt, GOOGLE_ADS_APPROVAL_NEVER_EXPIRES_AT, JSON.stringify({ ...criterion, remove: input.remove, criterionResourceName: existing?.resourceName || "" })).run();
      return Response.json({ ok: true, pendingChangeId: id, summary, campaign: campaign.name, createdAt, expiresAt: GOOGLE_ADS_APPROVAL_NEVER_EXPIRES_AT }, { headers: { "Cache-Control": "no-store" } });
    }
    if (!access.admin) {
      const decisionId = body.pendingChangeId;
      const reconcileId = body.reconcilePendingChangeId;
      if (body.revertActivityId || decisionId && !canStaffDecideAiApproval(access, decisionId, "pending") || reconcileId && !canStaffDecideAiApproval(access, reconcileId, "applying") || !decisionId && !reconcileId) {
        return Response.json({ error: "Staff can only approve or reject evidence-backed Ads changes linked to AI tasks they can access." }, { status: 403 });
      }
    }
    if (body.reconcilePendingChangeId) {
      const pending = await env.DB.prepare("SELECT id, client_id, customer_id, campaign_id, campaign_name, change_type, old_value, new_value, payload_json, status FROM google_ads_pending_changes WHERE id = ?1 AND owner_id = ?2").bind(body.reconcilePendingChangeId, access.ownerId).first<{ id: string; client_id: string; customer_id: string; campaign_id: string; campaign_name: string; change_type: string; old_value: string; new_value: string; payload_json: string; status: string }>();
      if (!pending) return Response.json({ error: "This Ads change could not be found." }, { status: 404 });
      if (pending.status !== "applying") return Response.json({ error: `This Ads change is already ${pending.status}. Refresh the task to see its latest status.` }, { status: 409 });
      const client = access.data.clients?.find((item: { id: string; googleAdsAccountId?: string }) => item.id === pending.client_id);
      if (!client?.googleAdsAccountId || String(client.googleAdsAccountId).replace(/\D/g, "") !== pending.customer_id) return Response.json({ error: "The client’s connected Ads account changed; the approval was left untouched." }, { status: 409 });
      if (pending.change_type === "ADD_CAMPAIGN_ASSET") {
        const payload = JSON.parse(pending.payload_json || "{}") as { campaignId?: string; assetName?: string; assetDraft?: { type?: string; linkText?: string; description1?: string; description2?: string; finalUrl?: string; calloutText?: string; header?: string; values?: string[] }; applyStartedAt?: string };
        if (payload.campaignId !== pending.campaign_id || !payload.assetName || !payload.assetDraft || !payload.applyStartedAt) return Response.json({ error: "The saved asset approval is missing recovery details. It was left untouched." }, { status: 409 });
        const startedAt = Date.parse(payload.applyStartedAt);
        if (!Number.isFinite(startedAt) || Date.now() - startedAt < 90_000) return Response.json({ error: "This change is still being checked. Wait a minute, then refresh before retrying." }, { status: 409 });
        const campaigns = await listGoogleAdsCampaigns(access.ownerId, pending.customer_id);
        const campaign = campaigns.find((item) => item.id === pending.campaign_id && item.name === pending.campaign_name);
        if (!campaign) return Response.json({ error: "This campaign changed or is no longer available. The approval was left untouched." }, { status: 409 });
        const linked = await listGoogleAdsCampaignLevelAssets(access.ownerId, pending.customer_id, pending.campaign_id);
        const recovered = linked.find((item) => item.campaignId === pending.campaign_id && item.assetName === payload.assetName && item.status !== "REMOVED");
        const now = new Date().toISOString();
        if (recovered) {
          const draft = payload.assetDraft;
          const display = draft.type === "SITELINK" ? `${draft.linkText} → ${draft.finalUrl}` : draft.type === "CALLOUT" ? String(draft.calloutText || "") : `${draft.header}: ${(draft.values || []).join(" · ")}`;
          const newValue = JSON.stringify({ asset: draft, assetResourceName: `customers/${pending.customer_id}/assets/${recovered.assetId}`, associationResourceName: recovered.associationResourceName });
          const detail = `${client.name}: Google Ads confirms the ${String(draft.type || "").toLowerCase().replaceAll("_", " ")} is linked to ${campaign.name}: ${display}. The original response was interrupted; this is the recovery check time.`;
          const saved = await env.DB.batch([
            env.DB.prepare("UPDATE google_ads_pending_changes SET status = 'applied', payload_json = ?3 WHERE id = ?1 AND owner_id = ?2 AND status = 'applying'").bind(pending.id, access.ownerId, JSON.stringify({ ...payload, assetResourceName: `customers/${pending.customer_id}/assets/${recovered.assetId}`, associationResourceName: recovered.associationResourceName, recoveredAt: now })),
            env.DB.prepare("INSERT INTO google_ads_change_log (id, owner_id, client_id, service, campaign_id, campaign_name, change_type, old_value, new_value, actor, created_at) VALUES (?1, ?2, ?3, 'Google Ads', ?4, ?5, 'ADD_CAMPAIGN_ASSET', 'absent', ?6, ?7, ?8, ?9)").bind(crypto.randomUUID(), access.ownerId, client.id, campaign.id, campaign.name, newValue, user.displayName, now),
            env.DB.prepare("INSERT INTO client_ai_messages (id, client_id, service, role, content, created_by, created_at) VALUES (?1, ?2, ?3, 'assistant', ?4, ?5, ?6)").bind(crypto.randomUUID(), client.id, `Google Ads::campaign:${campaign.id}`, `✅ Google Ads asset verified\n${detail}`, user.displayName, now),
          ]);
          if (!saved[0]?.meta.changes) return Response.json({ error: "This approval changed while recovery was running. Refresh the task to see its latest status." }, { status: 409 });
          return Response.json({ ok: true, applied: true, verified: true, checkedAt: now, detail });
        }
        const reset = await env.DB.prepare("UPDATE google_ads_pending_changes SET status = 'pending', payload_json = ?3 WHERE id = ?1 AND owner_id = ?2 AND status = 'applying'").bind(pending.id, access.ownerId, JSON.stringify({ ...payload, applyStartedAt: "" })).run();
        if (!reset.meta.changes) return Response.json({ error: "This approval changed while recovery was running. Refresh the task before acting." }, { status: 409 });
        return Response.json({ ok: true, applied: false, verified: true, checkedAt: now, detail: "Google Ads confirms the asset was not added. The approval is ready to retry." });
      }
      if (!isKeywordChange(pending.change_type)) return Response.json({ error: "Automatic recovery is not available for this change type yet. The approval was left untouched." }, { status: 409 });
      const keyword = JSON.parse(pending.payload_json || "{}") as { adGroupId?: string; keyword?: string; matchType?: "EXACT" | "PHRASE" | "BROAD"; negative?: boolean; remove?: boolean };
      if (!keyword.adGroupId || !keyword.keyword || !keyword.matchType || typeof keyword.negative !== "boolean") return Response.json({ error: "The saved keyword proposal is incomplete; the approval was left untouched." }, { status: 409 });
      const groups = await listGoogleAdsAdGroups(access.ownerId, pending.customer_id, pending.campaign_id);
      if (!groups.some((group) => group.id === keyword.adGroupId && group.campaignId === pending.campaign_id)) return Response.json({ error: "The saved ad group no longer belongs to this campaign; the approval was left untouched." }, { status: 409 });
      const criterion = await getGoogleAdsKeywordCriterion(access.ownerId, pending.customer_id, { adGroupId: keyword.adGroupId, keyword: keyword.keyword, matchType: keyword.matchType, negative: keyword.negative });
      const isAddition = pending.change_type === "ADD_KEYWORD" || pending.change_type === "ADD_NEGATIVE_KEYWORD";
      const applied = isAddition ? criterion?.status === "ENABLED" : !criterion;
      const now = new Date().toISOString();
      const nextStatus = applied ? "applied" : "pending";
      if (applied) {
        const detail = `Recovery check confirmed the requested keyword is ${criterion?.status} in Google Ads. The approval request was interrupted, so its original write time is unknown; this entry records the recovery check.`;
        const label = `${pending.campaign_name} · Reconciled keyword “${keyword.keyword}” (${keyword.matchType}) in ad group ${keyword.adGroupId}; current status ${criterion?.status}; original write time unknown`;
        const [saved] = await env.DB.batch([
          env.DB.prepare("UPDATE google_ads_pending_changes SET status = 'applied' WHERE id = ?1 AND owner_id = ?2 AND status = 'applying'").bind(pending.id, access.ownerId),
          env.DB.prepare("INSERT INTO google_ads_change_log (id, owner_id, client_id, service, campaign_id, campaign_name, change_type, old_value, new_value, actor, created_at) VALUES (?1, ?2, ?3, 'Google Ads', ?4, ?5, 'RECONCILED_KEYWORD_STATE', ?6, ?7, ?8, ?9)").bind(crypto.randomUUID(), access.ownerId, pending.client_id, pending.campaign_id, label, "Approval left in applying after interrupted request", `Verified present and ${criterion?.status} by Google Ads API at ${now}; original write time unknown`, user.displayName, now),
        ]);
        if (!saved.meta.changes) return Response.json({ error: "This approval changed while it was being checked. Refresh the task before acting." }, { status: 409 });
        return Response.json({ ok: true, applied: true, verified: true, keywordStatus: criterion?.status, checkedAt: now, detail });
      }
      const saved = await env.DB.prepare("UPDATE google_ads_pending_changes SET status = 'pending' WHERE id = ?1 AND owner_id = ?2 AND status = 'applying'").bind(pending.id, access.ownerId).run();
      if (!saved.meta.changes) return Response.json({ error: "This approval changed while it was being checked. Refresh the task before acting." }, { status: 409 });
      return Response.json({ ok: true, applied: false, verified: true, keywordStatus: criterion?.status || "ABSENT", checkedAt: now, detail: "Google Ads read-back confirms the requested keyword is absent. The approval is safely reset to waiting, so you can review and retry it once." });
    }
    if (body.revertActivityId) {
      if (body.confirmed !== true) return Response.json({ error: "Confirm the exact reversal in the app before changing Google Ads." }, { status: 400 });
      const original = await env.DB.prepare("SELECT id, client_id, campaign_id, campaign_name, change_type, old_value, new_value FROM google_ads_change_log WHERE id = ?1 AND owner_id = ?2").bind(body.revertActivityId, access.ownerId).first<{ id: string; client_id: string; campaign_id: string; campaign_name: string; change_type: string; old_value: string; new_value: string }>();
      const keywordMetadata = original ? keywordActivityMetadata(original.campaign_name) : null;
      const oldAdContent = original?.change_type === "UPDATE_RESPONSIVE_SEARCH_AD" ? validAdContent(original.old_value) : null;
      const newAdContent = original?.change_type === "UPDATE_RESPONSIVE_SEARCH_AD" ? validAdContent(original.new_value) : null;
      const campaignAssetChange = original?.change_type === "ADD_CAMPAIGN_ASSET" ? validCampaignAssetChange(original.new_value) : null;
      if (!campaignAssetChange && (!original || (!["PAUSED", "ENABLED", "SET_DAILY_BUDGET"].includes(original.change_type) && !(isKeywordChange(original.change_type) && keywordMetadata) && !(original.change_type === "UPDATE_RESPONSIVE_SEARCH_AD" && oldAdContent && newAdContent)))) return Response.json({ error: "This activity item does not include enough detail to safely reverse it from this workspace." }, { status: 409 });
      const priorRevert = await env.DB.prepare("SELECT id FROM google_ads_change_log WHERE owner_id = ?1 AND change_type = ?2 LIMIT 1").bind(access.ownerId, `REVERT:${original.id}`).first<{ id: string }>();
      if (priorRevert) return Response.json({ error: "This change has already been reversed." }, { status: 409 });
      const client = access.data.clients?.find((item: { id: string; googleAdsAccountId?: string }) => item.id === original.client_id);
      const customerId = String(client?.googleAdsAccountId || "").replace(/\D/g, "");
      if (!client || !/^\d{6,20}$/.test(customerId)) return Response.json({ error: "The client’s connected Ads account is no longer available." }, { status: 409 });
      if (original.change_type === "ADD_CAMPAIGN_ASSET" && campaignAssetChange) {
        const linked = await listGoogleAdsCampaignLevelAssets(access.ownerId, customerId, original.campaign_id);
        if (!linked.some((item) => item.associationResourceName === campaignAssetChange.associationResourceName)) return Response.json({ error: "That asset link is no longer active in Google Ads, so it was not changed." }, { status: 409 });
        await removeGoogleAdsCampaignAsset(access.ownerId, customerId, campaignAssetChange.associationResourceName);
        const restored = await listGoogleAdsCampaignLevelAssets(access.ownerId, customerId, original.campaign_id);
        if (restored.some((item) => item.associationResourceName === campaignAssetChange.associationResourceName)) return Response.json({ error: "Google Ads accepted the removal, but the live asset link is still visible. Check the campaign before retrying." }, { status: 502 });
      } else if (original.change_type === "UPDATE_RESPONSIVE_SEARCH_AD" && oldAdContent && newAdContent) {
        const ads = await listGoogleAdsResponsiveSearchAds(access.ownerId, customerId);
        const currentAd = ads.find((item) => item.adId === original.campaign_id);
        if (!currentAd) return Response.json({ error: "The original responsive ad is no longer available in this account. The change was not reversed." }, { status: 409 });
        const liveContent = JSON.stringify({ headlines: currentAd.headlines, descriptions: currentAd.descriptions });
        if (liveContent !== original.new_value) return Response.json({ error: "The live ad copy no longer matches this activity item, so it was not reversed. Review the current ad first." }, { status: 409 });
        await updateGoogleAdsResponsiveSearchAd(access.ownerId, customerId, { adId: currentAd.adId, headlines: oldAdContent.headlines!, descriptions: oldAdContent.descriptions! });
        const restoredAd = (await listGoogleAdsResponsiveSearchAds(access.ownerId, customerId)).find((item) => item.adId === currentAd.adId);
        const restoredContent = restoredAd ? JSON.stringify({ headlines: restoredAd.headlines, descriptions: restoredAd.descriptions }) : "";
        if (restoredContent !== original.old_value) return Response.json({ error: "Google Ads accepted the reversal, but live ad copy read-back could not verify it. Review the ad before trying again." }, { status: 502 });
      } else if (isKeywordChange(original.change_type) && keywordMetadata) {
        const groups = await listGoogleAdsAdGroups(access.ownerId, customerId, original.campaign_id);
        const group = groups.find((item) => item.id === keywordMetadata.adGroup || item.name === keywordMetadata.adGroup);
        if (!group) return Response.json({ error: "The original ad group is no longer available in this campaign. The change was not reversed." }, { status: 409 });
        const criterion = { adGroupId: group.id, keyword: keywordMetadata.keyword, matchType: keywordMetadata.matchType, negative: keywordMetadata.negative };
        const currentlyPresent = Boolean(await getGoogleAdsKeywordCriterion(access.ownerId, customerId, criterion));
        const expectedAfter = original.new_value === "present";
        const expectedBefore = original.old_value === "present";
        if (!(["present", "absent"].includes(original.old_value) && ["present", "absent"].includes(original.new_value)) || currentlyPresent !== expectedAfter || expectedAfter === expectedBefore) return Response.json({ error: "The live keyword no longer matches this activity item, so it was not reversed. Review the current ad group first." }, { status: 409 });
        await mutateGoogleAdsKeyword(access.ownerId, customerId, { ...criterion, remove: expectedAfter });
        const restored = Boolean(await getGoogleAdsKeywordCriterion(access.ownerId, customerId, criterion));
        if (restored !== expectedBefore) return Response.json({ error: "Google Ads accepted the reversal, but a live keyword read-back could not verify it. Check the ad group before trying again." }, { status: 502 });
      } else {
      const current = await readGoogleAdsCampaign(access.ownerId, customerId, original.campaign_id);
      if (original.change_type === "SET_DAILY_BUDGET") {
        if ((current.budgetMicros / 1_000_000).toFixed(2) !== Number(original.new_value).toFixed(2) || !current.budgetResourceName) return Response.json({ error: "The live budget no longer matches this activity item, so it was not reversed. Review the current campaign first." }, { status: 409 });
        const restore = Number(original.old_value);
        if (!Number.isFinite(restore) || restore < 0.01) return Response.json({ error: "The previous budget is not valid, so this change cannot be reversed." }, { status: 409 });
        await updateGoogleAdsCampaignBudget(access.ownerId, customerId, current.budgetResourceName, Math.round(restore * 1_000_000));
      } else {
        if (current.status !== original.new_value || !["PAUSED", "ENABLED"].includes(original.old_value)) return Response.json({ error: "The live campaign status no longer matches this activity item, so it was not reversed. Review the current campaign first." }, { status: 409 });
        await updateGoogleAdsCampaign(access.ownerId, customerId, current.campaignId, original.old_value as "PAUSED" | "ENABLED");
      }
      const checked = await readGoogleAdsCampaign(access.ownerId, customerId, original.campaign_id);
      const verified = original.change_type === "SET_DAILY_BUDGET"
        ? (checked.budgetMicros / 1_000_000).toFixed(2) === Number(original.old_value).toFixed(2)
        : checked.status === original.old_value;
      if (!verified) return Response.json({ error: "Google Ads accepted the reversal, but a live read-back could not verify it. Check the campaign in Google Ads before trying again." }, { status: 502 });
      }
    const now = new Date().toISOString();
      await env.DB.prepare("INSERT INTO google_ads_change_log (id, owner_id, client_id, service, campaign_id, campaign_name, change_type, old_value, new_value, actor, created_at) VALUES (?1, ?2, ?3, 'Google Ads', ?4, ?5, ?6, ?7, ?8, ?9, ?10)")
        .bind(crypto.randomUUID(), access.ownerId, original.client_id, original.campaign_id, original.campaign_name, `REVERT:${original.id}`, original.new_value, original.old_value, user.displayName, now).run();
      return Response.json({ ok: true, verified: true, client: client.name, campaign: original.campaign_name, action: "REVERT", oldValue: original.new_value, newValue: original.old_value, actor: user.displayName, changedAt: now, detail: `Reversed ${original.change_type} and verified the restored live state.` });
    }
    if (body.confirmed !== true || !body.pendingChangeId) return Response.json({ error: "Confirm the exact proposed change in the app before applying it." }, { status: 400 });
    const pending = await env.DB.prepare("SELECT * FROM google_ads_pending_changes WHERE id = ?1 AND owner_id = ?2").bind(body.pendingChangeId, access.ownerId).first<{ id: string; client_id: string; customer_id: string; campaign_id: string; campaign_name: string; campaign_budget_resource: string; change_type: string; old_value: string; new_value: string; payload_json: string; status: string }>();
    if (!pending) return Response.json({ error: "This approval could not be found. Ask the AI to prepare it again." }, { status: 404 });
    if (!canDecideGoogleAdsApproval(pending.status)) return Response.json({ error: "This approval has already been applied or decided." }, { status: 409 });
    const client = access.data.clients?.find((item: { id: string }) => item.id === pending.client_id);
    if (!client?.googleAdsAccountId || String(client.googleAdsAccountId).replace(/\D/g, "") !== pending.customer_id) return Response.json({ error: "This client’s connected Ads account changed. Prepare a fresh proposal." }, { status: 409 });
    if (body.decision === "reject") {
      const now = new Date().toISOString();
      const rejected = await env.DB.prepare("UPDATE google_ads_pending_changes SET status = 'rejected' WHERE id = ?1 AND owner_id = ?2 AND status = 'pending'").bind(pending.id, access.ownerId).run();
      if (!rejected.meta.changes) return Response.json({ error: "This proposal is already being applied or has already been decided." }, { status: 409 });
      return Response.json({ ok: true, decision: "rejected", client: client.name, campaign: pending.campaign_name, detail: "Rejected; no Google Ads change was made.", actor: user.displayName, changedAt: now, verified: false });
    }
    if (pending.change_type === "ADD_CAMPAIGN_ASSET") {
      const payload = JSON.parse(pending.payload_json || "{}") as { accountId?: string; campaignId?: string; assetName?: string; assetDraft?: { type?: string; linkText?: string; description1?: string; description2?: string; finalUrl?: string; calloutText?: string; header?: string; values?: string[] } };
      const accountId = String(payload.accountId || "").replace(/\D/g, "");
      if (accountId !== pending.customer_id || payload.campaignId !== pending.campaign_id || !payload.assetName || !payload.assetDraft) return Response.json({ error: "The saved asset proposal is incomplete or no longer matches this campaign. Ask the AI to prepare it again." }, { status: 409 });
      const [campaigns, assets] = await Promise.all([
        listGoogleAdsCampaigns(access.ownerId, pending.customer_id),
        listGoogleAdsCampaignLevelAssets(access.ownerId, pending.customer_id, pending.campaign_id),
      ]);
      const campaign = campaigns.find((item) => item.id === pending.campaign_id && item.name === pending.campaign_name);
      if (!campaign) return Response.json({ error: "This campaign changed or is no longer available. Prepare a fresh proposal." }, { status: 409 });
      const draft = payload.assetDraft;
      const type = String(draft.type || "");
      const duplicateText = type === "SITELINK" ? String(draft.linkText || "") : type === "CALLOUT" ? String(draft.calloutText || "") : type === "STRUCTURED_SNIPPET" ? String(draft.header || "") : "";
      if (!duplicateText) return Response.json({ error: "The proposed asset text is missing." }, { status: 409 });
      const alreadyLinked = assets.some((item) => item.campaignId === pending.campaign_id && item.type === type && item.text?.some((text) => text === duplicateText) && (type !== "SITELINK" || item.finalUrls?.includes(String(draft.finalUrl || ""))));
      if (alreadyLinked) return Response.json({ error: "This asset is already linked to the selected campaign, so no duplicate was added." }, { status: 409 });
      const applyStartedAt = new Date().toISOString();
      const claim = await env.DB.prepare("UPDATE google_ads_pending_changes SET status = 'applying', payload_json = ?3 WHERE id = ?1 AND owner_id = ?2 AND status = 'pending'").bind(pending.id, access.ownerId, JSON.stringify({ ...payload, applyStartedAt })).run();
      if (!claim.meta.changes) return Response.json({ error: "This proposal is already being applied or has already been used." }, { status: 409 });
      let created: Awaited<ReturnType<typeof createGoogleAdsCampaignAsset>>;
      try {
        if (type === "SITELINK") created = await createGoogleAdsCampaignAsset(access.ownerId, pending.customer_id, pending.campaign_id, { type: "SITELINK", linkText: String(draft.linkText || ""), description1: String(draft.description1 || ""), description2: String(draft.description2 || ""), finalUrl: String(draft.finalUrl || "") }, payload.assetName);
        else if (type === "CALLOUT") created = await createGoogleAdsCampaignAsset(access.ownerId, pending.customer_id, pending.campaign_id, { type: "CALLOUT", calloutText: String(draft.calloutText || "") }, payload.assetName);
        else if (type === "STRUCTURED_SNIPPET") created = await createGoogleAdsCampaignAsset(access.ownerId, pending.customer_id, pending.campaign_id, { type: "STRUCTURED_SNIPPET", header: String(draft.header || ""), values: Array.isArray(draft.values) ? draft.values.map(String) : [] }, payload.assetName);
        else {
          await env.DB.prepare("UPDATE google_ads_pending_changes SET status = 'pending' WHERE id = ?1 AND owner_id = ?2 AND status = 'applying'").bind(pending.id, access.ownerId).run();
          return Response.json({ error: "This asset type is not supported for automatic approval yet." }, { status: 400 });
        }
      } catch (error) {
        console.error("Google Ads campaign asset approval needs recovery", error instanceof Error ? error.message : "unknown");
        return Response.json({ error: "Google Ads did not confirm the result. The approval is saved safely; refresh after a minute and use Retry to check before applying again." }, { status: 502 });
      }
      let verified = false;
      try {
        const after = await listGoogleAdsCampaignLevelAssets(access.ownerId, pending.customer_id, pending.campaign_id);
        verified = after.some((item) => item.associationResourceName === created.associationResourceName && item.status !== "REMOVED");
      } catch (error) { console.error("Google Ads asset read-back failed", error instanceof Error ? error.message : "unknown"); }
      const now = new Date().toISOString();
      const newValue = JSON.stringify({ asset: draft, assetResourceName: created.assetResourceName, associationResourceName: created.associationResourceName });
      const display = type === "SITELINK" ? String(draft.linkText) + " → " + String(draft.finalUrl) : type === "CALLOUT" ? String(draft.calloutText) : String(draft.header) + ": " + (draft.values || []).join(" · ");
      const detail = client.name + ": added campaign " + type.toLowerCase().replaceAll("_", " ") + " to " + campaign.name + ": " + display + ". " + (verified ? "Google Ads read-back confirmed it is linked." : "Google Ads accepted the change, but live read-back did not confirm the link.") + " Approved and applied by " + user.displayName + ".";
      const chatScope = "Google Ads::campaign:" + campaign.id;
      await env.DB.batch([
        env.DB.prepare("UPDATE google_ads_pending_changes SET status = 'applied', payload_json = ?3 WHERE id = ?1 AND owner_id = ?2 AND status = 'applying'").bind(pending.id, access.ownerId, JSON.stringify({ ...payload, assetResourceName: created.assetResourceName, associationResourceName: created.associationResourceName })),
        env.DB.prepare("INSERT INTO google_ads_change_log (id, owner_id, client_id, service, campaign_id, campaign_name, change_type, old_value, new_value, actor, created_at) VALUES (?1, ?2, ?3, 'Google Ads', ?4, ?5, 'ADD_CAMPAIGN_ASSET', 'absent', ?6, ?7, ?8, ?9)").bind(crypto.randomUUID(), access.ownerId, client.id, campaign.id, campaign.name, newValue, user.displayName, now),
        env.DB.prepare("INSERT INTO client_ai_messages (id, client_id, service, role, content, created_by, created_at) VALUES (?1, ?2, ?3, 'assistant', ?4, ?5, ?6)").bind(crypto.randomUUID(), client.id, chatScope, "✅ Google Ads asset added\n" + detail, user.displayName, now),
      ]);
      return Response.json({ ok: true, client: client.name, campaign: campaign.name, campaignId: campaign.id, action: "ADD_CAMPAIGN_ASSET", detail, oldValue: "absent", newValue, actor: user.displayName, changedAt: now, verified });
    }
    if (pending.change_type === "UPDATE_RESPONSIVE_SEARCH_AD") {
      const payload = JSON.parse(pending.payload_json || "{}") as { adId?: string; campaignId?: string; adGroupId?: string; newContent?: { headlines?: Array<{ text: string; pinnedField?: string }>; descriptions?: Array<{ text: string; pinnedField?: string }> } };
      if (!payload.adId || !payload.campaignId || !payload.adGroupId || !payload.newContent?.headlines || !payload.newContent.descriptions) return Response.json({ error: "The ad edit proposal is incomplete. Prepare it again." }, { status: 409 });
      const ads = await listGoogleAdsResponsiveSearchAds(access.ownerId, pending.customer_id);
      const ad = ads.find((item) => item.adId === payload.adId && item.campaignId === payload.campaignId && item.adGroupId === payload.adGroupId);
      if (!ad) return Response.json({ error: "That Responsive Search Ad changed or is no longer in this account. Prepare a fresh edit." }, { status: 409 });
      const before = { headlines: ad.headlines, descriptions: ad.descriptions };
      if (JSON.stringify(before) !== pending.old_value) return Response.json({ error: "The ad's headlines or descriptions changed since this proposal was prepared. Review the current ad and prepare the edit again." }, { status: 409 });
      const claim = await env.DB.prepare("UPDATE google_ads_pending_changes SET status = 'applying' WHERE id = ?1 AND owner_id = ?2 AND status = 'pending'").bind(pending.id, access.ownerId).run();
      if (!claim.meta.changes) return Response.json({ error: "This proposal is already being applied or has already been used." }, { status: 409 });
      try {
        await updateGoogleAdsResponsiveSearchAd(access.ownerId, pending.customer_id, { adId: payload.adId, headlines: payload.newContent.headlines, descriptions: payload.newContent.descriptions });
      } catch (error) {
        await env.DB.prepare("UPDATE google_ads_pending_changes SET status = 'pending' WHERE id = ?1 AND owner_id = ?2 AND status = 'applying'").bind(pending.id, access.ownerId).run();
        throw error;
      }
      let verified = false;
      let after: typeof ad | undefined;
      try {
        after = (await listGoogleAdsResponsiveSearchAds(access.ownerId, pending.customer_id)).find((item) => item.adId === payload.adId);
        verified = Boolean(after && JSON.stringify(after.headlines) === JSON.stringify(payload.newContent.headlines) && JSON.stringify(after.descriptions) === JSON.stringify(payload.newContent.descriptions));
      } catch (error) { console.error("Google Ads ad edit read-back failed", error instanceof Error ? error.message : "unknown"); }
      const now = new Date().toISOString();
      const newValue = JSON.stringify(payload.newContent);
      const activityNote = `${client.name}: updated headlines and descriptions on Google Ads responsive search ad ${payload.adId} in ${ad.campaignName} · ${ad.adGroupName}. ${verified ? "Google Ads API read-back confirmed the new copy." : "Google Ads accepted the update, but read-back could not confirm the final copy."} Applied by ${user.displayName}.`;
      const chatScope = `Google Ads::campaign:${payload.campaignId}`;
      await env.DB.batch([
        env.DB.prepare("UPDATE google_ads_pending_changes SET status = 'applied' WHERE id = ?1 AND owner_id = ?2 AND status = 'applying'").bind(pending.id, access.ownerId),
        env.DB.prepare("INSERT INTO google_ads_change_log (id, owner_id, client_id, service, campaign_id, campaign_name, change_type, old_value, new_value, actor, created_at) VALUES (?1, ?2, ?3, 'Google Ads', ?4, ?5, 'UPDATE_RESPONSIVE_SEARCH_AD', ?6, ?7, ?8, ?9)").bind(crypto.randomUUID(), access.ownerId, client.id, payload.adId, `${ad.campaignName} · ${ad.adGroupName}`, pending.old_value, newValue, user.displayName, now),
        env.DB.prepare("INSERT INTO client_ai_messages (id, client_id, service, role, content, created_by, created_at) VALUES (?1, ?2, ?3, 'assistant', ?4, ?5, ?6)").bind(crypto.randomUUID(), client.id, chatScope, `✅ Google Ads ad copy updated\n${activityNote}`, user.displayName, now),
      ]);
      return Response.json({ ok: true, client: client.name, campaign: ad.campaignName, campaignId: payload.adId, adId: payload.adId, action: "UPDATE_RESPONSIVE_SEARCH_AD", detail: activityNote, oldValue: pending.old_value, newValue, actor: user.displayName, changedAt: now, verified });
    }
    if (pending.change_type.startsWith("WINDSOR:")) {
      if (!env.WINDSOR_API_KEY) return Response.json({ error: "The Windsor API key is not configured on the app server." }, { status: 503 });
      const payload = JSON.parse(pending.payload_json || "{}") as { accountId?: string; actionId?: string; params?: Record<string, unknown> };
      const accountId = String(payload.accountId || "").replace(/\D/g, "");
      const actionId = String(payload.actionId || "");
      if (accountId !== pending.customer_id || accountId !== String(client.googleAdsAccountId).replace(/\D/g, "") || !payload.params || !actionId) return Response.json({ error: "The account or action details changed. Ask the assistant to prepare a fresh proposal." }, { status: 409 });
      const actions = await getWindsorAdsActions(env.WINDSOR_API_KEY);
      const action = actions.find((item) => item.id === actionId);
      if (!action || pending.change_type !== `WINDSOR:${actionId}`) return Response.json({ error: "This action is no longer available in Windsor's live Google Ads action catalog." }, { status: 409 });
      const validationError = validateWindsorParams(payload.params, action.schema);
      if (validationError) return Response.json({ error: `The proposal no longer matches Windsor's action schema: ${validationError}. Prepare a fresh proposal.` }, { status: 409 });
      const params = omitNullOptionalParams(payload.params, action.schema);
      const campaignChatId = String(params.campaign_id || (/^\d{3,20}$/.test(pending.campaign_id) ? pending.campaign_id : ""));
      const chatScope = campaignChatId ? `Google Ads::campaign:${campaignChatId}` : "Google Ads";
      const claim = await env.DB.prepare("UPDATE google_ads_pending_changes SET status = 'applying' WHERE id = ?1 AND owner_id = ?2 AND status = 'pending'").bind(pending.id, access.ownerId).run();
      if (!claim.meta.changes) return Response.json({ error: "This proposal is already being applied or has already been used." }, { status: 409 });
      try {
        const applied = await executeWindsorAdsAction(env.WINDSOR_API_KEY, accountId, actionId, params);
        const now = new Date().toISOString();
        const providerResult = `${action.name} accepted by Windsor.`;
        const activityNote = `${client.name}: Windsor accepted ${action.name} for Google Ads account ${accountId}. ${displayParams(params)}. Google Ads state was not independently read back. Applied by ${user.displayName}.`;
        await env.DB.batch([
          env.DB.prepare("UPDATE google_ads_pending_changes SET status = 'applied' WHERE id = ?1 AND owner_id = ?2 AND status = 'applying'").bind(pending.id, access.ownerId),
          env.DB.prepare("INSERT INTO google_ads_change_log (id, owner_id, client_id, service, campaign_id, campaign_name, change_type, old_value, new_value, actor, created_at) VALUES (?1, ?2, ?3, 'Google Ads', ?4, ?5, ?6, ?7, ?8, ?9, ?10)").bind(crypto.randomUUID(), access.ownerId, client.id, pending.campaign_id, pending.campaign_name, actionId, pending.old_value, pending.new_value, user.displayName, now),
          env.DB.prepare("INSERT INTO client_ai_messages (id, client_id, service, role, content, created_by, created_at) VALUES (?1, ?2, ?3, 'assistant', ?4, ?5, ?6)").bind(crypto.randomUUID(), client.id, chatScope, `✅ Google Ads action accepted by Windsor\n${activityNote}`, user.displayName, now),
        ]);
        return Response.json({ ok: true, provider: "windsor", client: client.name, campaign: action.name, campaignId: pending.campaign_id, action: actionId, oldValue: pending.old_value, newValue: pending.new_value, detail: providerResult, actor: user.displayName, changedAt: now, verified: false });
      } catch (error) {
        await env.DB.prepare("UPDATE google_ads_pending_changes SET status = 'pending' WHERE id = ?1 AND owner_id = ?2 AND status = 'applying'").bind(pending.id, access.ownerId).run();
        throw error;
      }
    }
    const campaign = await readGoogleAdsCampaign(access.ownerId, pending.customer_id, pending.campaign_id);
    if (campaign.name !== pending.campaign_name) return Response.json({ error: "The campaign changed since this proposal was prepared. Ask the assistant to prepare a fresh proposal." }, { status: 409 });
    const keywordChanges = ["ADD_KEYWORD", "REMOVE_KEYWORD", "ADD_NEGATIVE_KEYWORD", "REMOVE_NEGATIVE_KEYWORD"];
    const keywordChange = keywordChanges.includes(pending.change_type);
    const keywordPayload = keywordChange ? JSON.parse(pending.payload_json || "{}") as { adGroupId: string; keyword: string; matchType: "EXACT" | "PHRASE" | "BROAD"; negative: boolean; remove: boolean } : null;
    if ((pending.change_type === "PAUSED" || pending.change_type === "ENABLED") && campaign.status !== pending.old_value) return Response.json({ error: "The campaign status changed since this proposal was prepared. Ask the assistant to check it again." }, { status: 409 });
    if (pending.change_type === "SET_DAILY_BUDGET" && (campaign.budgetResourceName !== pending.campaign_budget_resource || (campaign.budgetMicros / 1_000_000).toFixed(2) !== pending.old_value)) return Response.json({ error: "The campaign budget changed since this proposal was prepared. Ask the assistant to check it again." }, { status: 409 });
    if (keywordChange && keywordPayload) {
      const adGroups = await listGoogleAdsAdGroups(access.ownerId, pending.customer_id, pending.campaign_id);
      if (!adGroups.some((group) => group.id === keywordPayload.adGroupId && group.campaignId === pending.campaign_id)) return Response.json({ error: "The selected ad group changed or no longer belongs to this campaign. Prepare the proposal again." }, { status: 409 });
      const existing = await getGoogleAdsKeywordCriterion(access.ownerId, pending.customer_id, keywordPayload);
      if (keywordPayload.remove ? existing?.resourceName !== JSON.parse(pending.payload_json).criterionResourceName : Boolean(existing)) return Response.json({ error: "The keyword list changed since this proposal was prepared. Ask the assistant to check it again." }, { status: 409 });
    }
    if (!["PAUSED", "ENABLED", "SET_DAILY_BUDGET", ...keywordChanges].includes(pending.change_type)) return Response.json({ error: "That Google Ads change type is not supported." }, { status: 400 });
    const claim = await env.DB.prepare("UPDATE google_ads_pending_changes SET status = 'applying' WHERE id = ?1 AND owner_id = ?2 AND status = 'pending'").bind(pending.id, access.ownerId).run();
    if (!claim.meta.changes) return Response.json({ error: "This proposal is already being applied or has already been used." }, { status: 409 });
    try {
      if (pending.change_type === "PAUSED" || pending.change_type === "ENABLED") await updateGoogleAdsCampaign(access.ownerId, campaign.customerId, campaign.campaignId, pending.change_type);
      else if (pending.change_type === "SET_DAILY_BUDGET") await updateGoogleAdsCampaignBudget(access.ownerId, campaign.customerId, campaign.budgetResourceName, Math.round(Number(pending.new_value) * 1_000_000));
      else if (keywordPayload) await mutateGoogleAdsKeyword(access.ownerId, pending.customer_id, keywordPayload);
      await env.DB.prepare("UPDATE google_ads_pending_changes SET status = 'applied' WHERE id = ?1 AND owner_id = ?2 AND status = 'applying'").bind(pending.id, access.ownerId).run();
    } catch (error) {
      await env.DB.prepare("UPDATE google_ads_pending_changes SET status = 'pending' WHERE id = ?1 AND owner_id = ?2 AND status = 'applying'").bind(pending.id, access.ownerId).run();
      throw error;
    }
    let verified = false;
    try {
      if (pending.change_type === "PAUSED" || pending.change_type === "ENABLED") {
        verified = (await readGoogleAdsCampaign(access.ownerId, pending.customer_id, pending.campaign_id)).status === pending.change_type;
      } else if (pending.change_type === "SET_DAILY_BUDGET") {
        const after = await readGoogleAdsCampaign(access.ownerId, pending.customer_id, pending.campaign_id);
        verified = after.budgetResourceName === pending.campaign_budget_resource && (after.budgetMicros / 1_000_000).toFixed(2) === Number(pending.new_value).toFixed(2);
      } else if (keywordPayload) {
        const after = await getGoogleAdsKeywordCriterion(access.ownerId, pending.customer_id, keywordPayload);
        verified = keywordPayload.remove ? !after : Boolean(after);
      }
    } catch (verificationError) {
      console.error("Google Ads write read-back failed", verificationError instanceof Error ? verificationError.message : "unknown");
    }
    const keywordDescription = keywordPayload ? `${keywordPayload.remove ? "Removed" : "Added"} ${keywordPayload.negative ? "negative " : ""}keyword “${keywordPayload.keyword}” (${keywordPayload.matchType}) in ad group ${keywordPayload.adGroupId}` : "";
      const now = new Date().toISOString();
      const activityCampaignName = keywordDescription ? `${campaign.name} · ${keywordDescription}` : campaign.name;
      await env.DB.prepare("INSERT INTO google_ads_change_log (id, owner_id, client_id, service, campaign_id, campaign_name, change_type, old_value, new_value, actor, created_at) VALUES (?1, ?2, ?3, 'Google Ads', ?4, ?5, ?6, ?7, ?8, ?9, ?10)")
        .bind(crypto.randomUUID(), access.ownerId, client.id, campaign.campaignId, activityCampaignName, pending.change_type, pending.old_value, pending.new_value, user.displayName, now).run();
    const changeLabel = keywordDescription || (pending.change_type === "PAUSED" ? "paused" : pending.change_type === "ENABLED" ? "enabled" : "daily budget changed");
    const activityNote = `${client.name}: ${campaign.name} (${campaign.campaignId}) ${changeLabel}. ${pending.old_value} → ${pending.new_value}${pending.change_type === "SET_DAILY_BUDGET" ? ` ${campaign.currencyCode}/day` : ""}. Applied by ${user.displayName} via Google Ads API. ${verified ? "Google Ads API read-back confirmed the change." : "Google Ads accepted the request, but read-back could not verify the final state."}`;
    const chatScope = `Google Ads::campaign:${campaign.campaignId}`;
    await env.DB.prepare("INSERT INTO client_ai_messages (id, client_id, service, role, content, created_by, created_at) VALUES (?1, ?2, ?3, 'assistant', ?4, ?5, ?6)")
      .bind(crypto.randomUUID(), client.id, chatScope, `✅ Google Ads change completed\n${activityNote}`, user.displayName, now).run();
    return Response.json({ ok: true, client: client.name, campaign: campaign.name, campaignId: pending.campaign_id, action: pending.change_type, oldValue: pending.old_value, newValue: pending.new_value, detail: keywordDescription, actor: user.displayName, changedAt: now, verified });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not apply that Google Ads change." }, { status: 502 });
  }
}
