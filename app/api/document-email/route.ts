import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { fullTeamPermissions, getTeamPermissions, type TeamPermissions } from "@/lib/access-permissions";
import { ensureReportArchive } from "@/lib/client-report-archive";
import { getProposal, shareProposal, proposalContext, ProposalError } from "@/lib/proposals/server";
import { agencyBrand, emailList, rememberCompanyEmail, renderDocumentEmail, reportShareToken, savedCompanyEmail, sendDocumentEmail } from "@/lib/document-email";

// Send a generated report / audit / keyword report / proposal by email.
// GET  ?kind=report&clientId=&archiveId=  |  ?kind=proposal&id=   → draft (to, cc, subject, message)
// POST { kind, ..., to, cc, subject, message, theme, mode: "preview" | "send", rememberCc } → { html } or { ok }
export const dynamic = "force-dynamic";
const reply = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
type Staff = { id: string; name?: string; email: string; role: string; isBot?: boolean; permissions?: Partial<TeamPermissions>; clientAccessIds?: string[]; limitClientAccess?: boolean };
type Client = { id: string; name: string; contact?: string; email?: string; logo?: string };
type Ws = { ownerId?: string; settings?: Record<string, any>; staff?: Staff[]; clients?: Client[] };

const REPORT_NAMES: Record<string, string> = { ads: "Google Ads report", seo: "SEO report", audit: "Full marketing audit", "audit-ads": "Google Ads audit", "audit-website": "Website audit", keywords: "Keyword research report" };
const fmt = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const firstName = (name: string) => name.trim().split(/\s+/)[0] || "";

async function load() {
  const user = await getChatGPTUser();
  if (!user) return { error: reply({ error: "Sign in first." }, 401) };
  if (!env.DB) return { error: reply({ error: "The workspace database is unavailable." }, 503) };
  const row = await env.DB.prepare("SELECT owner_id, data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ owner_id: string; data: string }>();
  if (!row?.data) return { error: reply({ error: "The workspace is unavailable." }, 503) };
  const ws = JSON.parse(row.data) as Ws;
  const ownerId = String(ws.ownerId || row.owner_id || "");
  const owner = ownerId === user.userId;
  const staff = (ws.staff || []).find((item) => !item.isBot && (item.id === user.userId || item.email?.toLowerCase() === user.email.toLowerCase()));
  const admin = owner || ["Owner", "Admin"].includes(staff?.role || "");
  const permissions = owner ? fullTeamPermissions : getTeamPermissions(staff?.role || "Viewer", staff?.permissions);
  if (!admin && !permissions.reports) return { error: reply({ error: "You don't have permission to send reports." }, 403) };
  const allowedClient = (id: string) => admin || !staff?.limitClientAccess || (staff.clientAccessIds || []).includes(id);
  return { user, ws, ownerId, admin, allowedClient, senderName: staff?.name || user.displayName || "" };
}
type Ctx = Exclude<Awaited<ReturnType<typeof load>>, { error: Response }>;

/** Everything about the document needed for the draft and the email card. */
async function describe(ctx: Ctx, input: Record<string, unknown>, origin: string, theme: "dark" | "light", createLink: boolean) {
  const kind = input.kind === "proposal" ? "proposal" : "report";
  if (kind === "report") {
    const clientId = String(input.clientId || "").slice(0, 80), archiveId = String(input.archiveId || "").slice(0, 80);
    const client = (ctx.ws.clients || []).find((item) => item.id === clientId);
    if (!client || !ctx.allowedClient(clientId)) throw new ProposalError("Choose a client you have access to.", 403);
    await ensureReportArchive(env.DB as never);
    const row = await env.DB!.prepare("SELECT type, period_start, period_end, summary_json FROM client_report_archive WHERE owner_id = ?1 AND client_id = ?2 AND id = ?3").bind(ctx.ownerId, clientId, archiveId).first<{ type: string; period_start: string; period_end: string; summary_json: string }>();
    if (!row) throw new ProposalError("Save the report first, then email it.", 404);
    const name = REPORT_NAMES[row.type] || "Report";
    const isAudit = row.type.startsWith("audit"), isKeywords = row.type === "keywords";
    let groups: string[] = []; try { groups = JSON.parse(row.summary_json || "{}").groups || []; } catch { /* no groups */ }
    const subtitle = isKeywords ? (groups.length ? groups.slice(0, 4).join(", ") : "Keyword groups") : `${fmt(row.period_start)} – ${fmt(row.period_end)}`;
    const link = createLink ? `${origin}/f/report/${await reportShareToken(env.DB as never, ctx.ownerId, clientId, archiveId, theme)}` : `${origin}/f/report/preview`;
    const noun = isAudit ? "audit" : isKeywords ? "keyword research" : "report";
    return { kind, clientId, client, to: client.email || "", toName: client.contact || client.name, docTitle: `${client.name} · ${name}`, docSubtitle: subtitle, link, buttonLabel: isAudit ? "View your audit" : isKeywords ? "View your keyword plan" : "View your report",
      subject: `Your ${name.toLowerCase()} – ${client.name}`, intro: isKeywords ? `Please find your keyword research for ${client.name} below. It shows the searches your customers are making, how competitive they are and where you rank today.` : isAudit ? `Please find your ${name.toLowerCase()} for ${client.name} below. It covers what's working, what's holding you back, and a clear plan of what we'd do next.` : `Please find your ${name} for ${client.name} for ${subtitle} below, including the leads it brought in and how it compares with the period before.`, noun };
  }
  const pctx = await proposalContext({ userId: ctx.user.userId, email: ctx.user.email });
  const proposal = await getProposal(pctx.ownerId, String(input.id || "").slice(0, 80));
  if (proposal.clientId && !pctx.allowedClient(proposal.clientId)) throw new ProposalError("You don't have access to this client.", 403);
  if (!proposal.deck) throw new ProposalError("Generate the proposal first, then email it.");
  let token = proposal.shareToken;
  if (createLink && !token) token = (await shareProposal(pctx, proposal.id, true)).shareToken;
  const client = proposal.clientId ? (ctx.ws.clients || []).find((item) => item.id === proposal.clientId) : undefined;
  let to = client?.email || "", toName = client?.contact || "";
  if (!to && proposal.contactId) {
    const contact = await env.DB!.prepare("SELECT first_name, last_name, email FROM crm_contacts WHERE owner_id = ?1 AND id = ?2").bind(ctx.ownerId, proposal.contactId).first<{ first_name: string; last_name: string; email: string }>();
    if (contact) { to = contact.email || ""; toName = `${contact.first_name || ""} ${contact.last_name || ""}`.trim(); }
  }
  const logo = /^https:\/\//.test(proposal.brand.logo) ? proposal.brand.logo : "";
  return { kind, clientId: proposal.clientId || "", client: client || { id: "", name: proposal.businessName, logo }, to, toName: toName || proposal.businessName, docTitle: proposal.title || `${proposal.businessName} — Proposal`, docSubtitle: "Your marketing proposal", link: token ? `${origin}/f/proposal/${token}` : `${origin}/f/proposal/preview`, buttonLabel: "View your proposal",
    subject: `Your marketing proposal – ${proposal.businessName}`, intro: `As promised, here's our proposal for ${proposal.businessName}. It sets out what we'd do, how it works and what it costs, and you can approve it straight from the link when you're ready.`, noun: "proposal" };
}

function draftMessage(doc: Awaited<ReturnType<typeof describe>>, senderName: string, brandName: string) {
  const hi = firstName(doc.toName) ? `Hi ${firstName(doc.toName)},` : "Hi,";
  return `${hi}\n\n${doc.intro}\n\nIf you have any questions, just reply to this email.\n\nKind regards,\n${senderName ? `${senderName}\n` : ""}${brandName}`;
}

export async function GET(request: Request) {
  const ctx = await load();
  if ("error" in ctx) return ctx.error;
  const url = new URL(request.url);
  try {
    const input = Object.fromEntries(url.searchParams);
    const doc = await describe(ctx, input, url.origin, "dark", false);
    const brand = agencyBrand(ctx.ws, url.origin, await savedCompanyEmail(env.DB as never, ctx.ownerId).catch(() => ""));
    return reply({ to: doc.to, toName: doc.toName, cc: brand.email, subject: doc.subject, message: draftMessage(doc, ctx.senderName, brand.name), docTitle: doc.docTitle, brandName: brand.name });
  } catch (error) { return reply({ error: error instanceof Error ? error.message : "Couldn't prepare the email." }, error instanceof ProposalError ? error.status : 500); }
}

export async function POST(request: Request) {
  const ctx = await load();
  if ("error" in ctx) return ctx.error;
  const origin = new URL(request.url).origin;
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return reply({ error: "Invalid request." }, 400); }
  const sending = body.mode === "send";
  const theme = body.theme === "light" ? "light" : "dark";
  try {
    const doc = await describe(ctx, body, origin, theme, sending);
    const brand = agencyBrand(ctx.ws, origin, await savedCompanyEmail(env.DB as never, ctx.ownerId).catch(() => ""));
    const message = String(body.message || "").slice(0, 6000) || draftMessage(doc, ctx.senderName, brand.name);
    const subject = String(body.subject || doc.subject).replace(/[\r\n]+/g, " ").trim().slice(0, 200) || doc.subject;
    const clientLogo = doc.client?.logo && /^https:\/\//.test(doc.client.logo) ? doc.client.logo : "";
    const html = renderDocumentEmail({ brand, message, link: doc.link, buttonLabel: doc.buttonLabel, docTitle: doc.docTitle, docSubtitle: doc.docSubtitle, clientLogo });
    if (!sending) return reply({ html });
    const to = emailList(body.to), cc = emailList(body.cc);
    if (!to.length) return reply({ error: "Add the recipient's email address." }, 400);
    await sendDocumentEmail(env.DB as never, { ownerId: ctx.ownerId, clientId: doc.clientId, brand, to, cc, subject, html, text: `${message}\n\n${doc.buttonLabel}: ${doc.link}`, toName: doc.toName, idempotencyKey: `document-email/${doc.kind}/${String(body.archiveId || body.id)}/${to.join(",")}/${Date.now()}` });
    // Remember the company CC address for next time.
    if (body.rememberCc && cc[0] && ctx.admin && cc[0] !== brand.email) await rememberCompanyEmail(env.DB as never, ctx.ownerId, cc[0]).catch(() => undefined);
    return reply({ ok: true, link: doc.link, sentTo: to, cc });
  } catch (error) { return reply({ error: error instanceof Error ? error.message : "Couldn't send the email." }, error instanceof ProposalError ? error.status : 500); }
}
