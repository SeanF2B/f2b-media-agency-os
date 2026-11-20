import { getChatGPTUser } from "../../chatgpt-auth";
import { SERVICE_NAMES, SERVICE_SCOPES, STANDARD, GOVERNING_LAWS } from "@/lib/contracts/core";
import {
  ContractError, contractContext, contractCounts, contractHtml, createContract, deleteContract, draftFor, getContract, listContracts, shareLink, updateContract, voidContract,
} from "@/lib/contracts/server";

// Client contracts (Client workroom → Contracts). Agency admins only; the public signing page is /f/contract/<token>.
// GET  ?clientId=          → contracts for the client + a fresh draft from their services
// GET  ?id=                → one contract       · ?html=<id> → printable preview / signed copy · ?counts=1
// POST { action: create | update | share | void | delete }   (emailing goes through /api/document-email, kind "contract")
export const dynamic = "force-dynamic";
const reply = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fail = (error: unknown) => error instanceof ContractError ? reply({ error: error.message }, error.status) : (console.error("contracts", error), reply({ error: "Something went wrong. Try again." }, 500));

async function ctx() {
  const user = await getChatGPTUser();
  if (!user) throw new ContractError("Sign in first.", 401);
  return contractContext(user);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const context = await ctx();
    const html = url.searchParams.get("html");
    if (html) {
      const page = await contractHtml(context, html, url.origin);
      const print = url.searchParams.get("print") === "1" ? `<script>addEventListener("load",function(){setTimeout(function(){print()},300)})</script>` : "";
      return new Response(page.replace("</body>", `${print}</body>`), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex", "Content-Security-Policy": "default-src 'none'; img-src 'self' https: data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'" } });
    }
    if (url.searchParams.get("counts") === "1") return reply({ counts: await contractCounts(context) });
    const id = url.searchParams.get("id");
    if (id) return reply({ contract: await getContract(context, id) });
    const clientId = url.searchParams.get("clientId") || "";
    return reply({
      contracts: await listContracts(context, clientId),
      draft: await draftFor(context, clientId),
      catalogue: SERVICE_NAMES.map((name) => ({ name, summary: SERVICE_SCOPES[name].summary })),
      standard: STANDARD, laws: GOVERNING_LAWS,
    });
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  try {
    const context = await ctx();
    const origin = new URL(request.url).origin;
    const body = await request.json().catch(() => ({})) as Record<string, any>;
    const id = String(body.id || "");
    switch (body.action) {
      case "create": return reply({ contract: await createContract(context, String(body.clientId || ""), body.data) });
      case "update": return reply({ contract: await updateContract(context, id, body.data || {}) });
      case "share": return reply(await shareLink(context, id, origin));
      case "void": return reply({ contract: await voidContract(context, id) });
      case "delete": await deleteContract(context, id); return reply({ ok: true });
      default: throw new ContractError("Unknown action.");
    }
  } catch (error) { return fail(error); }
}
