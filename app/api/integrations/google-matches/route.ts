import { env } from "cloudflare:workers";
import { authorizeAdmin, respond } from "@/lib/settings-auth";
import { hasGoogleSearchConsoleConnection, listGoogleSearchConsoleProperties } from "@/lib/google-search-console-direct";
import { hasGoogleAnalyticsDirectConnection, listGoogleAnalyticsProperties } from "@/lib/google-analytics-direct";
import { matchGoogleProperties } from "@/lib/google-property-match.mjs";

export const dynamic = "force-dynamic";

/**
 * Read-only: suggests Search Console / GA4 property links (and a website when missing) for clients whose
 * fields are empty. The browser applies them through the normal workspace save, so nothing here can be
 * overwritten by an open tab.
 */
export async function GET() {
  const auth = await authorizeAdmin("link Google properties");
  if (auth.error) return auth.error;
  const row = await env.DB!.prepare("SELECT json_extract(data, '$.clients') AS clients FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ clients: string }>();
  let clients: any[] = [];
  try { clients = JSON.parse(row?.clients || "[]"); } catch { /* empty list */ }
  const notes: string[] = [];
  let gsc: Array<{ id: string }> = [];
  let ga4: Array<{ id: string; name: string; accountName: string }> = [];
  if (await hasGoogleSearchConsoleConnection(auth.ownerId)) {
    try { gsc = await listGoogleSearchConsoleProperties(auth.ownerId); } catch (error) { notes.push(error instanceof Error ? error.message : "Search Console properties could not be listed."); }
  } else notes.push("Search Console isn’t connected, so no properties could be listed.");
  if (await hasGoogleAnalyticsDirectConnection(auth.ownerId)) {
    try { ga4 = await listGoogleAnalyticsProperties(auth.ownerId); } catch (error) { notes.push(error instanceof Error ? error.message : "GA4 properties could not be listed."); }
  } else notes.push("Google Analytics isn’t connected, so no GA4 properties could be listed.");
  const matches = matchGoogleProperties(clients.filter((client) => client?.status !== "Inactive"), gsc, ga4);
  return respond({ matches, searchConsoleProperties: gsc.length, analyticsProperties: ga4.length, notes });
}
