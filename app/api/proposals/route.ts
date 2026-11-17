import { getChatGPTUser } from "../../chatgpt-auth";
import {
  ProposalError, createProposal, deleteProposal, duplicateProposal, extractForProposal, generateDeck, getCatalogue, getProposal, importSource,
  listProposals, listSources, proposalContext, readAsset, rewriteSlide, saveCatalogue, searchProspects, shareProposal, suggestField, updateProposal, uploadFile,
} from "@/lib/proposals/server";

// Operations → Reports → Proposals (Proposal Studio). Team-only; the public view lives at /f/proposal/<token>.
export const dynamic = "force-dynamic";
const reply = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fail = (error: unknown) => error instanceof ProposalError ? reply({ error: error.message }, error.status) : (console.error("proposals", error), reply({ error: "Something went wrong. Try again." }, 500));

async function ctx() {
  const user = await getChatGPTUser();
  if (!user) throw new ProposalError("Sign in first.", 401);
  return proposalContext(user);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const context = await ctx();
    const asset = url.searchParams.get("asset");
    if (asset) {
      const [proposalId, name] = asset.split("/");
      const object = await readAsset(context.ownerId, proposalId || "", name || "");
      if (!object) return new Response("Not found", { status: 404 });
      return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || "application/octet-stream", "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" } });
    }
    if (url.searchParams.get("catalogue") === "1") return reply({ catalogue: await getCatalogue(context.ownerId) });
    if (url.searchParams.has("prospects")) return reply({ prospects: await searchProspects(context, url.searchParams.get("prospects") || "") });
    const id = url.searchParams.get("id");
    if (id) {
      const proposal = await getProposal(context.ownerId, id);
      if (proposal.clientId && !context.allowedClient(proposal.clientId)) throw new ProposalError("You don't have access to this client.", 403);
      return reply({ proposal, sources: await listSources(context, proposal).catch(() => []) });
    }
    return reply({ proposals: (await listProposals(context.ownerId)).filter((item) => !item.clientId || context.allowedClient(item.clientId)), catalogue: await getCatalogue(context.ownerId) });
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  try {
    const context = await ctx();
    if ((request.headers.get("content-type") || "").includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new ProposalError("Choose a file to upload.");
      if (file.size > 10_000_000) throw new ProposalError("That file is too large (max 10 MB).", 413);
      return reply({ proposal: await uploadFile(context, String(form.get("id") || ""), { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }) });
    }
    const body = await request.json().catch(() => ({})) as Record<string, any>;
    const id = String(body.id || "");
    switch (body.action) {
      case "create": return reply({ proposal: await createProposal(context, body) });
      case "update": return reply({ proposal: await updateProposal(context, id, body.patch || {}) });
      case "delete": await deleteProposal(context, id); return reply({ ok: true });
      case "duplicate": return reply({ proposal: await duplicateProposal(context, id) });
      case "share": return reply({ proposal: await shareProposal(context, id, body.enable !== false) });
      case "extract": return reply(await extractForProposal(context, id, body.website));
      case "import": return reply({ proposal: await importSource(context, id, String(body.ref || "")) });
      case "generate": return reply(await generateDeck(context, id));
      case "suggest": return reply(await suggestField(context, id, { field: String(body.field || ""), label: body.label, current: body.current, slideKind: body.slideKind, mode: body.mode }));
      case "rewrite": return reply({ proposal: await rewriteSlide(context, id, String(body.slideId || ""), String(body.instruction || "")) });
      case "catalogue": if (!context.admin) throw new ProposalError("Only admins can edit the service catalogue.", 403); return reply({ catalogue: await saveCatalogue(context.ownerId, Array.isArray(body.catalogue) ? body.catalogue : []) });
      default: throw new ProposalError("Unknown action.");
    }
  } catch (error) { return fail(error); }
}
