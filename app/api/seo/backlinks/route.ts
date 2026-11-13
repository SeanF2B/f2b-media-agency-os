import { env } from "cloudflare:workers";
import { dataForSeoCredentials, DATAFORSEO_SETUP_MESSAGE } from "@/lib/dataforseo-credentials";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getTeamPermissions } from "@/lib/access-permissions";
import { compareBacklinkCounts, normalizeBacklinkTarget, parseDataForSeoBacklinkChanges, parseDataForSeoBacklinkItems, parseDataForSeoBacklinkSummary, type DataForSeoBacklinkSummary } from "@/lib/dataforseo-backlinks";

export const dynamic = "force-dynamic";
const respond = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function accessFor(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return { response: respond({ status: "unauthorized", message: "Sign in to view backlink data." }, 401) };
  if (!env.DB) return { response: respond({ status: "unavailable", message: "The workspace database is unavailable." }, 503) };
  const db = env.DB;
  const clientId = new URL(request.url).searchParams.get("clientId") || "";
  const row = await db.prepare("SELECT data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string }>();
  if (!row?.data) return { response: respond({ status: "unavailable", message: "The workspace is unavailable." }, 503) };
  const workspace = JSON.parse(row.data);
  const owner = workspace.ownerId === user.userId;
  const profile = (workspace.staff || []).find((item: any) => !item.isBot && (item.id === user.userId || item.email?.toLowerCase() === user.email.toLowerCase()));
  const admin = owner || ["Owner", "Admin"].includes(profile?.role || "");
  const permissions = owner ? { clients: true } : getTeamPermissions(profile?.role || "Viewer", profile?.permissions);
  const client = (workspace.clients || []).find((item: any) => item.id === clientId);
  if (!client) return { response: respond({ status: "not_found", message: "Choose a client in this workspace." }, 404) };
  if (!admin && (!permissions.clients || (Array.isArray(profile?.clientAccessIds) && !profile.clientAccessIds.includes(clientId)))) return { response: respond({ status: "forbidden", message: "You do not have access to this client’s SEO data." }, 403) };
  return { user, client, admin, ownerId: String(workspace.ownerId || user.userId), db };
}

export async function GET(request: Request) {
  const context = await accessFor(request);
  if ("response" in context) return context.response;
  const { client, admin, ownerId, db } = context;
  if (!admin) return respond({ status: "forbidden", message: "Only an owner or admin can run backlink research." }, 403);
  let defaultTarget = "";
  try { defaultTarget = client.wordpressSiteUrl ? new URL(client.wordpressSiteUrl).hostname.replace(/^www\./, "") : ""; } catch { /* an invalid saved URL is shown as an empty target */ }
  const configured = Boolean((await dataForSeoCredentials(db, ownerId)));
  const historyRows = await db.prepare("SELECT target, created_at, result_json, provider_cost_usd FROM seo_backlink_snapshots WHERE owner_id = ?1 AND client_id = ?2 ORDER BY created_at DESC LIMIT 20").bind(ownerId, client.id).all<{ target: string; created_at: string; result_json: string; provider_cost_usd: number | null }>();
  const history = (historyRows.results || []).flatMap((row) => {
    try {
      const saved = JSON.parse(row.result_json) as DataForSeoBacklinkSummary | { summary: DataForSeoBacklinkSummary; changes?: unknown; items?: unknown };
      const summary = "summary" in saved ? saved.summary : saved;
      const changes = "summary" in saved ? saved.changes : undefined;
      return [{ target: row.target, checkedAt: row.created_at, summary, changes, providerCostUsd: row.provider_cost_usd }];
    }
    catch { return []; }
  });
  return respond({
    status: configured ? "ready" : "missing_connection",
    message: configured ? undefined : DATAFORSEO_SETUP_MESSAGE,
    defaultTarget,
    history,
    dataNote: "Backlink data comes from DataForSEO’s index and may differ from Google Search Console. A check can make up to three billable requests; the response shows the total reported cost when available.",
  });
}

export async function POST(request: Request) {
  const context = await accessFor(request);
  if ("response" in context) return context.response;
  const { admin, ownerId, client, db } = context;
  if (!admin) return respond({ status: "forbidden", message: "Only an owner or admin can run backlink research." }, 403);
  let body: { target?: string; acknowledgeProviderCharge?: boolean };
  try { body = await request.json() as typeof body; } catch { return respond({ status: "invalid_request", message: "The backlink request is not valid." }, 400); }
  if (body.acknowledgeProviderCharge !== true) return respond({ status: "confirmation_required", message: "Confirm that this backlink check may use up to three DataForSEO requests and account credits before running it." }, 400);
  const target = normalizeBacklinkTarget(String(body.target || ""));
  if (!target) return respond({ status: "invalid_target", message: "Enter a public domain or web page to check." }, 400);
  const { login, password } = (await dataForSeoCredentials(db, ownerId)) || { login: "", password: "" };
  if (!login || !password) return respond({ status: "missing_connection", message: DATAFORSEO_SETUP_MESSAGE }, 503);
  try {
    const auth = `Basic ${btoa(`${login}:${password}`)}`;
    const requestDataForSeo = async (path: string, payload: unknown) => {
      const response = await fetch(`https://api.dataforseo.com/v3/backlinks/${path}`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<unknown>;
    };
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const common = { target, include_subdomains: true, exclude_internal_backlinks: true, backlinks_status_type: "all" };
    const [summaryResult, changesResult, itemsResult] = await Promise.allSettled([
      requestDataForSeo("summary/live", [{ ...common, internal_list_limit: 10 }]),
      requestDataForSeo("timeseries_new_lost_summary/live", [{ target, date_from: startDate, date_to: endDate, group_range: "day" }]),
      requestDataForSeo("backlinks/live", [{ ...common, limit: 100, order_by: ["rank,desc"] }]),
    ]);
    if (summaryResult.status === "rejected") return respond({ status: "unavailable", message: `DataForSEO could not return backlink data (${summaryResult.reason instanceof Error ? summaryResult.reason.message : "request failed"}). Check the connection and account balance.` }, 502);
    const parsed = parseDataForSeoBacklinkSummary(summaryResult.value);
    if (!parsed) {
      const taskMessage = ((summaryResult.value as { tasks?: Array<{ status_message?: unknown }> } | null)?.tasks?.[0])?.status_message;
      return respond({ status: "unavailable", message: typeof taskMessage === "string" ? `DataForSEO: ${taskMessage.slice(0, 240)}` : "DataForSEO returned no backlink summary for this target." }, 502);
    }
    const changes = changesResult.status === "fulfilled" ? parseDataForSeoBacklinkChanges(changesResult.value, startDate, endDate) : null;
    const linkResults = itemsResult.status === "fulfilled" ? parseDataForSeoBacklinkItems(itemsResult.value) : null;
    const costs = [parsed.cost, changes?.cost, linkResults?.cost];
    const providerCostUsd = costs.every((cost): cost is number => typeof cost === "number") ? costs.reduce((sum, cost) => sum + cost, 0) : null;
    const detailErrors = [changesResult.status === "rejected" || !changes ? "New/lost totals were unavailable." : "", itemsResult.status === "rejected" || !linkResults ? "The backlink list was unavailable." : ""].filter(Boolean);
    const updatedAt = new Date().toISOString();
    const prior = await db.prepare("SELECT created_at, result_json FROM seo_backlink_snapshots WHERE owner_id = ?1 AND client_id = ?2 AND target = ?3 ORDER BY created_at DESC LIMIT 1").bind(ownerId, client.id, target).first<{ created_at: string; result_json: string }>();
    let comparison;
    if (prior) {
      try {
        const savedPrior = JSON.parse(prior.result_json) as DataForSeoBacklinkSummary | { summary: DataForSeoBacklinkSummary };
        comparison = compareBacklinkCounts(parsed.summary, "summary" in savedPrior ? savedPrior.summary : savedPrior, prior.created_at);
      }
      catch { /* Keep the new snapshot if an older saved row cannot be parsed. */ }
    }
    const resultData = { summary: parsed.summary, changes: changes?.changes || null, items: linkResults?.items || [] };
    await db.prepare("INSERT INTO seo_backlink_snapshots (snapshot_id, owner_id, client_id, target, created_at, provider_cost_usd, result_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)").bind(crypto.randomUUID(), ownerId, client.id, target, updatedAt, providerCostUsd, JSON.stringify(resultData)).run();
    const historyRows = await db.prepare("SELECT target, created_at, result_json, provider_cost_usd FROM seo_backlink_snapshots WHERE owner_id = ?1 AND client_id = ?2 ORDER BY created_at DESC LIMIT 20").bind(ownerId, client.id).all<{ target: string; created_at: string; result_json: string; provider_cost_usd: number | null }>();
    const history = (historyRows.results || []).flatMap((row) => {
      try {
        const saved = JSON.parse(row.result_json) as DataForSeoBacklinkSummary | { summary: DataForSeoBacklinkSummary; changes?: unknown; items?: unknown };
        const summary = "summary" in saved ? saved.summary : saved;
        const savedChanges = "summary" in saved ? saved.changes : undefined;
        return [{ target: row.target, checkedAt: row.created_at, summary, changes: savedChanges, providerCostUsd: row.provider_cost_usd }];
      }
      catch { return []; }
    });
    return respond({ status: "connected", summary: parsed.summary, changes: changes?.changes || null, items: linkResults?.items || [], detailErrors, providerCostUsd, updatedAt, comparison, history, dataNote: "Backlink counts, new/lost totals, ranks and spam scores come from DataForSEO’s link index. They are estimates, not Google Search Console measurements or a guarantee of search performance. The link list is limited to the 100 highest-ranked results returned by this check." });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError" ? "DataForSEO took too long to respond. No result was confirmed; retry the check." : "Could not reach DataForSEO. Check the connection and try again.";
    console.error("DataForSEO backlink summary failed", error instanceof Error ? error.message : "unknown error");
    return respond({ status: "unavailable", message }, 502);
  }
}
