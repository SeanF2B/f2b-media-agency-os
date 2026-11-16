import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { filingScope as scopeOf } from "@/lib/filing/model";
import { acknowledge, getReturn, listReturns, markOpened, saveDraft, scanReceipts } from "@/lib/filing/service";

export const dynamic = "force-dynamic";

// Books → Get ready for filing. Owners and admins only (same rule as the bookkeeping inbox).
async function context() {
  const user = await getChatGPTUser();
  if (!user || !env.DB) return null;
  const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!row) return null;
  const data = JSON.parse(row.data);
  const admin = data.ownerId === user.userId || data.staff?.some((person: { email?: string; role?: string }) => person.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(person.role || ""));
  return admin ? { ownerId: String(data.ownerId || user.userId), actor: user.email } : null;
}
const denied = () => Response.json({ error: "Only an owner or admin can prepare tax returns." }, { status: 403 });

export async function GET(request: Request) {
  const ctx = await context(); if (!ctx) return denied();
  const url = new URL(request.url); const scope = scopeOf(url.searchParams.get("scope"));
  const id = url.searchParams.get("id");
  if (id) { const ret = await getReturn(ctx, id); return ret && ret.scopeId === scope ? Response.json({ return: ret }) : Response.json({ error: "Not found." }, { status: 404 }); }
  return Response.json({ returns: await listReturns(ctx, scope) });
}

export async function POST(request: Request) {
  const ctx = await context(); if (!ctx) return denied();
  const body = await request.json().catch(() => ({})) as { action?: string; scope?: string; return?: unknown; id?: string; period?: { start: string; end: string }; records?: unknown; reference?: string; receivedAt?: string; note?: string };
  const scope = scopeOf(body.scope);
  try {
    const owned = async (id?: string) => { const ret = id ? await getReturn(ctx, id) : null; if (!ret || ret.scopeId !== scope) throw new Error("That return wasn't found for this business."); return ret.id; };
    if (body.action === "save") return Response.json({ return: await saveDraft(ctx, scope, body.return as never) });
    if (body.action === "scan") return Response.json(await scanReceipts(ctx, scope, body.period as never, body.records));
    if (body.action === "opened") return Response.json({ return: await markOpened(ctx, await owned(body.id)) });
    if (body.action === "acknowledge") return Response.json({ return: await acknowledge(ctx, await owned(body.id), { reference: String(body.reference || ""), receivedAt: body.receivedAt, note: body.note }) });
    return Response.json({ error: "Unknown action." }, { status: 400 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Something went wrong." }, { status: 400 }); }
}
