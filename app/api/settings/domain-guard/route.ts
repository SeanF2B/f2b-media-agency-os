import { getChatGPTUser } from "../../../chatgpt-auth";
import { authorizeAdmin, respond } from "@/lib/settings-auth";
import { acknowledgeGuardEvent, domainGuardOverview, processDomainGuard } from "@/lib/domain-guard-server";

export const dynamic = "force-dynamic";

// Domain Guard panel (Domains & DNS, agency admins only).
export async function GET() {
  const auth = await authorizeAdmin("view Domain Guard");
  if (auth.error) return auth.error;
  try { return respond(await domainGuardOverview()); }
  catch (error) { console.error("domain guard overview", error); return respond({ error: "Domain Guard could not load." }, 500); }
}

export async function POST(request: Request) {
  const auth = await authorizeAdmin("run Domain Guard");
  if (auth.error) return auth.error;
  let body: { action?: string; id?: string; domain?: string } = {};
  try { body = await request.json(); } catch { return respond({ error: "Send a valid request." }, 400); }
  if (body.action === "check") {
    const domain = typeof body.domain === "string" && /^[a-z0-9.-]{3,253}$/i.test(body.domain) ? body.domain : undefined;
    // A manual check covers up to 5 domains (Worker subrequest limit); the schedule keeps rotating through the rest.
    const result = await processDomainGuard(new Date(), { limit: 5, domain });
    return respond({ ...result, overview: await domainGuardOverview() });
  }
  if (body.action === "acknowledge" && typeof body.id === "string" && body.id.length <= 64) {
    const user = await getChatGPTUser();
    await acknowledgeGuardEvent(body.id, user?.email || "admin");
    return respond({ ok: true, overview: await domainGuardOverview() });
  }
  return respond({ error: "Unknown action." }, 400);
}
