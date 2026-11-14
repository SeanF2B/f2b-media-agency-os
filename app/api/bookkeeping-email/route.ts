import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { gmailConnection, gmailOAuthReady, recentReceipts, removeGmail } from "@/lib/bookkeeping-email";

export const dynamic = "force-dynamic";

async function context() {
  const user = await getChatGPTUser();
  if (!user || !env.DB) return null;
  const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!row) return null;
  const data = JSON.parse(row.data);
  const admin = data.ownerId === user.userId || data.staff?.some((person: { email?: string; role?: string }) => person.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(person.role || ""));
  return admin ? { ownerId: String(data.ownerId || user.userId) } : null;
}
const scopeOf = (value: unknown) => String(value || "agency").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "agency";

export async function GET(request: Request) {
  const ctx = await context();
  if (!ctx) return Response.json({ error: "Only an owner or admin can manage the bookkeeping inbox." }, { status: 403 });
  if (!gmailOAuthReady()) return Response.json({ connected: false, ready: false });
  const url = new URL(request.url);
  const saved = await gmailConnection(ctx.ownerId, scopeOf(url.searchParams.get("scope")));
  if (!saved) return Response.json({ connected: false, ready: true });
  if (url.searchParams.get("receipts") !== "1") return Response.json({ connected: true, ready: true, email: saved.account_email, connectedAt: saved.connected_at });
  try { return Response.json({ connected: true, ready: true, email: saved.account_email, connectedAt: saved.connected_at, receipts: await recentReceipts(saved) }); }
  catch (error) { return Response.json({ connected: true, ready: true, email: saved.account_email, connectedAt: saved.connected_at, receipts: [], error: error instanceof Error ? error.message : "Gmail couldn't be read." }); }
}

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return Response.json({ error: "Only an owner or admin can manage the bookkeeping inbox." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { action?: string; scope?: string };
  if (body.action !== "disconnect") return Response.json({ error: "Unknown action." }, { status: 400 });
  await removeGmail(ctx.ownerId, scopeOf(body.scope));
  return Response.json({ ok: true, connected: false });
}
