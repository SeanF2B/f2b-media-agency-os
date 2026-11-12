import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";

type OutscraperPayload = { id?: string; status?: string; data?: unknown; error?: boolean; errorMessage?: string; results_location?: string; results?: Array<{ product_name?: string; file_url?: string; quantity?: number }> };
const apiKey = () => (env as unknown as { OUTSCRAPER_API_KEY?: string }).OUTSCRAPER_API_KEY || "";

async function isAdmin(user: { userId: string; email: string }) {
  if (!env.DB) return false;
  const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!row?.data) return false;
  const workspace = JSON.parse(row.data) as { ownerId?: string; staff?: Array<{ email?: string; role?: string }> };
  return workspace.ownerId === user.userId || Boolean(workspace.staff?.some((member) => member.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(member.role || "")));
}

async function outscraperFetch(url: URL): Promise<{ response: Response; payload: OutscraperPayload }> {
  const response = await fetch(url, { headers: { "X-API-KEY": apiKey(), Accept: "application/json" }, signal: AbortSignal.timeout(25000) });
  const payload = await response.json().catch(() => ({})) as OutscraperPayload;
  return { response, payload };
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in to connect Outscraper." }, { status: 401 });
  if (!await isAdmin(user)) return Response.json({ error: "Only an agency owner or admin can use Outscraper enrichment." }, { status: 403 });
  if (!apiKey()) return Response.json({ configured: false });

  const requestId = new URL(request.url).searchParams.get("requestId");
  const taskId = new URL(request.url).searchParams.get("taskId");
  if (taskId) {
    if (!/^[a-zA-Z0-9-]{8,100}$/.test(taskId)) return Response.json({ error: "Invalid Outscraper task ID." }, { status: 400 });
    try {
      const { response, payload } = await outscraperFetch(new URL(`https://api.outscraper.cloud/tasks/${encodeURIComponent(taskId)}`));
      if (!response.ok) return Response.json({ error: payload.errorMessage || "Outscraper could not return this search task." }, { status: response.status === 401 ? 502 : response.status });
      const status = String(payload.status || "PENDING").toUpperCase();
      if (!["SUCCESS", "COMPLETED", "FINISHED"].includes(status)) {
        if (["FAILURE", "FAILED", "ERROR"].includes(status)) return Response.json({ status: "Failure", error: payload.errorMessage || "Outscraper could not complete the full-region search." });
        return Response.json({ status, quantity: 0 }, { headers: { "Cache-Control": "no-store" } });
      }
      const result = payload.results?.find((item) => /google maps data/i.test(item.product_name || "") && item.file_url) || payload.results?.find((item) => item.file_url);
      if (!result?.file_url) return Response.json({ status: "Success", data: payload.data || [], quantity: result?.quantity || 0 }, { headers: { "Cache-Control": "no-store" } });
      const fileUrl = new URL(result.file_url);
      const allowedHost = ["outscraper.cloud", "outscraper.com", "storage.googleapis.com"].some((host) => fileUrl.hostname === host || fileUrl.hostname.endsWith(`.${host}`)) || fileUrl.hostname.endsWith(".amazonaws.com");
      if (fileUrl.protocol !== "https:" || !allowedHost) return Response.json({ error: "Outscraper returned an unsupported results download location." }, { status: 502 });
      const fileResponse = await fetch(fileUrl, { headers: { Accept: "text/csv, application/octet-stream, */*" }, signal: AbortSignal.timeout(25_000) });
      if (!fileResponse.ok) return Response.json({ error: "Outscraper completed the search, but its results file could not be downloaded." }, { status: 502 });
      return new Response(fileResponse.body, { headers: { "Content-Type": fileResponse.headers.get("Content-Type") || "text/csv; charset=utf-8", "Cache-Control": "no-store", "X-Outscraper-Quantity": String(result.quantity || 0) } });
    } catch {
      return Response.json({ error: "Could not retrieve the full-region Outscraper task." }, { status: 502 });
    }
  }
  if (!requestId) return Response.json({ configured: true });
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(requestId)) return Response.json({ error: "Invalid Outscraper request ID." }, { status: 400 });
  try {
    const { response, payload } = await outscraperFetch(new URL(`https://api.outscraper.cloud/requests/${encodeURIComponent(requestId)}`));
    if (response.status === 204) return Response.json({ status: "Failure", data: [] });
    if (!response.ok) return Response.json({ error: payload.errorMessage || "Outscraper could not return this enrichment request." }, { status: response.status === 401 ? 502 : response.status });
    return Response.json({ status: payload.status || "Success", data: payload.data || [] }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Could not reach Outscraper to check the enrichment request." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in to run Outscraper enrichment." }, { status: 401 });
  if (!await isAdmin(user)) return Response.json({ error: "Only an agency owner or admin can run Outscraper enrichment." }, { status: 403 });
  if (!apiKey()) return Response.json({ error: "Outscraper is not connected yet. Add OUTSCRAPER_API_KEY as a Cloudflare Worker secret, then redeploy." }, { status: 503 });

  try {
    const body = await request.json() as { action?: string; domains?: unknown; contactsPerCompany?: number; queries?: unknown; locations?: unknown; limit?: number; skipPlaces?: number; onlyWithWebsite?: boolean };
    if (body.action === "maps-reviews") {
      const queries = Array.isArray(body.queries) ? [...new Set(body.queries.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))] : [];
      if (!queries.length) return Response.json({ error: "No Google Maps places were available for review lookup." }, { status: 400 });
      if (queries.length > 1000) return Response.json({ error: "Send up to 1,000 places per review lookup." }, { status: 400 });
      const params = new URLSearchParams({ async: "true", reviewsLimit: "10", sort: "newest", ignoreEmpty: "true" });
      for (const query of queries) params.append("query", query);
      const { response, payload } = await outscraperFetch(new URL(`https://api.outscraper.cloud/google-maps-reviews?${params.toString()}`));
      if (!response.ok) {
        const message = response.status === 402 ? "Outscraper rejected the review lookup because billing or a payment method needs attention." : payload.errorMessage || "Outscraper rejected the Google Maps review lookup.";
        return Response.json({ error: message }, { status: response.status === 401 ? 502 : response.status });
      }
      return Response.json({ requestId: payload.id || "", status: payload.status || "Pending", data: payload.data || [] }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "maps-all-search") {
      const categories = Array.isArray(body.queries) ? [...new Set(body.queries.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))] : [];
      const locations = Array.isArray(body.locations) ? [...new Set(body.locations.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))] : [];
      if (!categories.length) return Response.json({ error: "Add at least one exact search term from the saved ICP." }, { status: 400 });
      if (!locations.length) return Response.json({ error: "Add at least one target location to the saved ICP." }, { status: 400 });
      if (categories.length > 20 || locations.length > 30) return Response.json({ error: "Use up to 20 exact search terms and 30 locations per full-region task." }, { status: 400 });
      const taskBody = {
        service_name: "google_maps_service_v2",
        queries: [],
        settings: { output_extension: "csv", output_columns: [] },
        categories,
        locations,
        language: "en",
        limit: 0,
        organizationsPerQueryLimit: 500,
        filters: body.onlyWithWebsite ? ["only_with_website"] : [],
        useZipCodes: true,
        dropDuplicates: true,
        UISettings: { isCustomQueries: false, isCustomCategories: true, isCustomLocations: true },
        enrichLocations: true,
      };
      const response = await fetch("https://api.outscraper.cloud/tasks", { method: "POST", headers: { "X-API-KEY": apiKey(), Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(taskBody), signal: AbortSignal.timeout(25_000) });
      const payload = await response.json().catch(() => ({})) as OutscraperPayload;
      if (!response.ok) {
        const message = response.status === 402 ? "Outscraper rejected the search because billing or a payment method needs attention." : payload.errorMessage || "Outscraper rejected the full-region search task.";
        return Response.json({ error: message }, { status: response.status === 401 ? 502 : response.status });
      }
      if (!payload.id) return Response.json({ error: "Outscraper accepted the request without returning a task ID." }, { status: 502 });
      return Response.json({ taskId: payload.id, status: payload.status || "PENDING" }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "maps-search") {
      const queries = Array.isArray(body.queries) ? [...new Set(body.queries.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))] : [];
      if (!queries.length) return Response.json({ error: "Add at least one Google Maps search query." }, { status: 400 });
      if (queries.length > 20) return Response.json({ error: "Run at most 20 search queries at a time to keep each job reviewable." }, { status: 400 });
      const limit = Math.floor(Number(body.limit));
      if (!Number.isFinite(limit) || limit < 1 || limit > 500) return Response.json({ error: "Choose a result cap from 1 to 500 places per query." }, { status: 400 });
      const skipPlaces = Math.floor(Number(body.skipPlaces ?? 0));
      if (!Number.isFinite(skipPlaces) || skipPlaces < 0 || skipPlaces > 500 || skipPlaces % 20 !== 0) return Response.json({ error: "Pagination must skip 0 to 500 places in steps of 20." }, { status: 400 });
      const query = new URLSearchParams({ async: "true", limit: String(limit), dropDuplicates: "true", skipPlaces: String(skipPlaces) });
      if (body.onlyWithWebsite) query.set("filters", "only_with_website");
      const endpoint = new URL(`https://api.outscraper.cloud/google-maps-search?${query.toString()}`);
      const response = await fetch(endpoint, { method: "POST", headers: { "X-API-KEY": apiKey(), Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ query: queries, limit, skipPlaces, async: true, dropDuplicates: true, ...(body.onlyWithWebsite ? { filters: ["only_with_website"] } : {}) }), signal: AbortSignal.timeout(25000) });
      const payload = await response.json().catch(() => ({})) as OutscraperPayload;
      if (!response.ok) {
        const message = response.status === 402 ? "Outscraper rejected the search because billing or a payment method needs attention." : payload.errorMessage || "Outscraper rejected the Google Maps search.";
        return Response.json({ error: message }, { status: response.status === 401 ? 502 : response.status });
      }
      return Response.json({ requestId: payload.id || "", status: payload.status || "Pending", data: payload.data || [] });
    }
    const domains = Array.isArray(body.domains) ? [...new Set(body.domains.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))] : [];
    if (!domains.length) return Response.json({ error: "This saved list has no website domains to enrich." }, { status: 400 });
    if (domains.length > 1000) return Response.json({ error: "Send at most 1,000 website domains per Outscraper request. The Enrichment tab splits larger lists into multiple requests." }, { status: 400 });

    const query = new URLSearchParams({ async: "true", contactsPerCompany: String(Math.max(1, Math.min(10, Math.floor(body.contactsPerCompany || 3)))) });
    for (const domain of domains) query.append("query", domain);
    const { response, payload } = await outscraperFetch(new URL(`https://api.outscraper.cloud/leads-and-contacts?${query.toString()}`));
    if (!response.ok) {
      const message = response.status === 402 ? "Outscraper rejected the request because billing or a payment method needs attention." : payload.errorMessage || "Outscraper rejected the enrichment request.";
      return Response.json({ error: message }, { status: response.status === 401 ? 502 : response.status });
    }
    return Response.json({ requestId: payload.id || "", status: payload.status || "Pending", data: payload.data || [] });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: "Invalid request body." }, { status: 400 });
    return Response.json({ error: "Could not submit this list to Outscraper." }, { status: 502 });
  }
}
