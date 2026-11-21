import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { makeConnectToken } from "@/lib/client-connect";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  const secret = String((env as unknown as Record<string, string>).GOOGLE_ADS_TOKEN_ENCRYPTION_KEY || "");
  if (!secret || !env.DB) return Response.json({ error: "Client links aren’t available on this deployment." }, { status: 503 });
  const clientId = (new URL(request.url).searchParams.get("clientId") || "").slice(0, 100);
  const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string }>();
  const data = row ? JSON.parse(row.data) as { ownerId?: string; staff?: Array<{ id?: string; email?: string; role?: string; isBot?: boolean }>; clients?: Array<{ id: string }> } : null;
  const admin = data && (data.ownerId === user.userId || (data.staff || []).some((item) => !item.isBot && (item.id === user.userId || item.email?.toLowerCase() === user.email.toLowerCase()) && ["Owner", "Admin"].includes(item.role || "")));
  // A client's own Admin can get the link for their own business (to connect its Google / Meta accounts).
  const subAdmin = !admin && data && (data.staff || []).some((item: any) => !item.isBot && item.email?.toLowerCase() === user.email.toLowerCase() && /^Sub-account /.test(String(item.role || "")) && /admin/i.test(String(item.role || "")) && Array.isArray(item.clientAccessIds) && item.clientAccessIds.includes(clientId));
  if (!admin && !subAdmin) return Response.json({ error: "Only an owner or admin can share client links." }, { status: 403 });
  if (!(data!.clients || []).some((client) => client.id === clientId)) return Response.json({ error: "Choose a client." }, { status: 404 });
  return Response.json({ url: `${new URL(request.url).origin}/f/connect/${await makeConnectToken(secret, clientId)}` }, { headers: { "Cache-Control": "no-store" } });
}
