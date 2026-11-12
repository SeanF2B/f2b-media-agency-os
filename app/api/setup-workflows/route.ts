import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getTeamPermissions } from "@/lib/access-permissions";

export const dynamic = "force-dynamic";
type SetupKind = "google_ads" | "seo";
type SetupStep = { id: string; status: "not_started" | "in_progress" | "needs_approval" | "complete" | "blocked"; notes: string; evidence: string; taskId?: string };
type SetupWorkflow = { id: string; kind: SetupKind; clientId: string; updatedAt: string; updatedBy: string; steps: SetupStep[] };
const validKinds = new Set<SetupKind>(["google_ads", "seo"]);
const respond = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function context(clientId: string, write: boolean) {
  const user = await getChatGPTUser();
  if (!user) return { error: respond({ error: "Sign in to open setup workspaces." }, 401) };
  if (!env.DB) return { error: respond({ error: "The workspace database is unavailable." }, 503) };
  const row = await env.DB.prepare("SELECT data, updated_at FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string; updated_at: string }>();
  if (!row) return { error: respond({ error: "The agency workspace is unavailable." }, 503) };
  const data = JSON.parse(row.data) as any;
  const profile = (data.staff || []).find((item: any) => !item.isBot && (item.id === user.userId || item.email?.toLowerCase() === user.email.toLowerCase()));
  const admin = data.ownerId === user.userId || ["Owner", "Admin"].includes(profile?.role || "");
  const permissions = data.ownerId === user.userId ? { clients: true } : getTeamPermissions(profile?.role || "Viewer", profile?.permissions);
  const client = (data.clients || []).find((item: any) => item.id === clientId);
  if (!client) return { error: respond({ error: "Choose a client in this workspace." }, 404) };
  const scoped = Array.isArray(profile?.clientAccessIds);
  if (!admin && (!permissions.clients || scoped && !profile.clientAccessIds.includes(clientId))) return { error: respond({ error: "You do not have access to this client." }, 403) };
  if (write && !admin) return { error: respond({ error: "Only an owner or admin can change setup plans." }, 403) };
  return { user, data, row, admin };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId") || "";
  const kind = url.searchParams.get("kind") as SetupKind;
  if (!validKinds.has(kind)) return respond({ error: "Choose Google Ads or SEO setup." }, 400);
  const ctx = await context(clientId, false);
  if ("error" in ctx) return ctx.error;
  const workflows = (ctx.data.marketingSetupWorkflows || []) as SetupWorkflow[];
  return respond({ workflow: workflows.find((item) => item.kind === kind && item.clientId === clientId) || null });
}

export async function PUT(request: Request) {
  let body: { clientId?: string; kind?: SetupKind; step?: SetupStep };
  try { body = await request.json() as typeof body; } catch { return respond({ error: "The setup update was not valid." }, 400); }
  const clientId = String(body.clientId || "").slice(0, 120);
  const kind = body.kind as SetupKind;
  if (!validKinds.has(kind) || !body.step || !/^[a-z0-9_-]{1,64}$/.test(body.step.id)) return respond({ error: "Choose a valid setup step." }, 400);
  const step: SetupStep = {
    id: body.step.id,
    status: ["not_started", "in_progress", "needs_approval", "complete", "blocked"].includes(body.step.status) ? body.step.status : "not_started",
    notes: String(body.step.notes || "").slice(0, 6000),
    evidence: String(body.step.evidence || "").slice(0, 6000),
    ...(body.step.taskId ? { taskId: String(body.step.taskId).slice(0, 120) } : {}),
  };
  if (step.status === "complete" && !step.evidence.trim()) return respond({ error: "Add the actual result or verification evidence before marking this step complete." }, 400);
  const ctx = await context(clientId, true);
  if ("error" in ctx) return ctx.error;
  const now = new Date().toISOString();
  const workflows = [...(ctx.data.marketingSetupWorkflows || [])] as SetupWorkflow[];
  const index = workflows.findIndex((item) => item.kind === kind && item.clientId === clientId);
  const current = index >= 0 ? workflows[index] : { id: crypto.randomUUID(), kind, clientId, updatedAt: now, updatedBy: "", steps: [] };
  const steps = current.steps.filter((item) => item.id !== step.id).concat(step);
  const nextWorkflow: SetupWorkflow = { ...current, updatedAt: now, updatedBy: ctx.user.displayName, steps };
  if (index >= 0) workflows[index] = nextWorkflow; else workflows.unshift(nextWorkflow);
  const next = { ...ctx.data, marketingSetupWorkflows: workflows.slice(0, 500) };
  const saved = await env.DB!.prepare("UPDATE workspace_documents SET data = ?1, updated_at = ?2 WHERE id = ?3 AND updated_at = ?4")
    .bind(JSON.stringify(next), `setup-${crypto.randomUUID()}`, "f2b-agency", ctx.row.updated_at).run();
  if (saved.meta.changes !== 1) return respond({ error: "The workspace changed at the same time. Refresh and save your update again." }, 409);
  return respond({ ok: true, workflow: nextWorkflow });
}
