import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getTeamPermissions } from "@/lib/access-permissions";
import { ensurePublicMarketingAccessRoutes } from "@/lib/cloudflare-public-marketing-access.js";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in before configuring public marketing routes." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "The workspace database is unavailable." }, { status: 503 });

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(request.url).origin) return Response.json({ error: "This request must come from the Agency OS workspace." }, { status: 403 });
    } catch {
      return Response.json({ error: "This request has an invalid origin." }, { status: 403 });
    }
  }

  let body: { confirm?: unknown };
  try { body = await request.json() as { confirm?: unknown }; }
  catch { return Response.json({ error: "Confirm the approved public routes before continuing." }, { status: 400 }); }
  if (body.confirm !== "APPROVE_PUBLIC_MARKETING_ROUTES") {
    return Response.json({ error: "Confirm the five approved public paths before continuing." }, { status: 400 });
  }

  try {
    const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string }>();
    if (!row?.data) return Response.json({ error: "The workspace could not be loaded." }, { status: 503 });
    const workspace = JSON.parse(row.data) as { ownerId?: string; staff?: Array<{ id?: string; email?: string; role?: string; isBot?: boolean; permissions?: Record<string, boolean> }> };
    const profile = (workspace.staff || []).find((member) => !member.isBot && (member.id === user.userId || member.email?.toLowerCase() === user.email?.toLowerCase()));
    const isOwner = workspace.ownerId === user.userId;
    const isAdmin = isOwner || ["Owner", "Admin"].includes(profile?.role || "");
    const permissions = getTeamPermissions(profile?.role || "Viewer", profile?.permissions);
    if (!isOwner && (!isAdmin || !permissions.team)) return Response.json({ error: "Only the workspace owner or an admin can configure public route access." }, { status: 403 });

    const host = new URL(env.TASK_APP_URL || "https://f2b-media-agency-os.f2b-media.workers.dev/").hostname;
    const result = await ensurePublicMarketingAccessRoutes({
      accountId: env.F2B_CF_ACCOUNT_ID || "",
      appId: env.F2B_CF_ACCESS_APP_ID || "",
      allowPolicyId: env.F2B_CF_ACCESS_POLICY_ID || "",
      token: env.CLOUDFLARE_ACCESS_API_TOKEN || "",
      hostname: host,
    });
    if (!result.ok) return Response.json({ error: result.error, configured: result.configured, createdPaths: result.createdPaths }, { status: result.configured ? 502 : 503 });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not configure the approved public routes." }, { status: 500 });
  }
}
