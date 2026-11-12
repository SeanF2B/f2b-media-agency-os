import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { ensureStaffHasWorkspaceAccess } from "@/lib/cloudflare-access-staff";

export const dynamic = "force-dynamic";
type StaffRecord = { id: string; name?: string; email: string; role: string; isBot?: boolean };

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in to sync staff workspace access." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "Workspace database is unavailable." }, { status: 503 });

  try {
    const body = await request.json() as { staffId?: unknown };
    const staffId = typeof body.staffId === "string" ? body.staffId.trim() : "";
    if (!staffId) return Response.json({ error: "Choose a saved staff profile." }, { status: 400 });

    const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string }>();
    if (!row?.data) return Response.json({ error: "Workspace could not be loaded." }, { status: 503 });
    const data = JSON.parse(row.data);
    const staff: StaffRecord[] = Array.isArray(data.staff) ? data.staff : [];
    const senderProfile = staff.find((member) => !member.isBot && (member.id === user.userId || member.email?.toLowerCase() === user.email?.toLowerCase()));
    const canManage = data.ownerId === user.userId || (senderProfile && ["Owner", "Admin"].includes(senderProfile.role));
    if (!canManage) return Response.json({ error: "Only the workspace owner or an admin can sync staff access." }, { status: 403 });

    const recipient = staff.find((member) => member.id === staffId && !member.isBot);
    if (!recipient) return Response.json({ error: "That saved staff profile was not found." }, { status: 404 });
    if (typeof recipient.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email)) {
      return Response.json({ error: "Add a valid email address to this saved staff profile first." }, { status: 400 });
    }

    const result = await ensureStaffHasWorkspaceAccess(recipient.email);
    if (!result.ok) return Response.json({ error: result.error, configured: result.configured }, { status: result.configured ? 502 : 503 });
    return Response.json({ ok: true, email: result.email, changed: result.changed });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not sync staff workspace access." }, { status: 500 });
  }
}
