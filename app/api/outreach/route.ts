import { getChatGPTUser } from "../../chatgpt-auth";
import { authorizeAdmin, respond } from "@/lib/settings-auth";
import { ActionError, loadState, runAction } from "@/lib/outreach/server/actions";

export const dynamic = "force-dynamic";

/** Outreach state for the Leads → Outreach screens (agency admins only). */
export async function GET(request: Request) {
  const auth = await authorizeAdmin("use Outreach");
  if (auth.error) return auth.error;
  try {
    const user = await getChatGPTUser();
    const url = new URL(request.url);
    return respond(await loadState({ ownerId: auth.ownerId, actor: user?.email || "admin", origin: url.origin }, url.searchParams));
  } catch (error) {
    console.error("outreach:state", error);
    return respond({ error: error instanceof Error ? error.message : "Could not load Outreach." }, 500);
  }
}

export async function POST(request: Request) {
  const auth = await authorizeAdmin("use Outreach");
  if (auth.error) return auth.error;
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return respond({ error: "Send a valid request." }, 400); }
  try {
    const user = await getChatGPTUser();
    return respond(await runAction({ ownerId: auth.ownerId, actor: user?.email || "admin", origin: new URL(request.url).origin }, body));
  } catch (error) {
    if (error instanceof ActionError) return respond({ error: error.message }, error.status);
    console.error("outreach:action", body?.action, error);
    return respond({ error: error instanceof Error ? error.message : "That didn't work. Try again." }, 500);
  }
}
