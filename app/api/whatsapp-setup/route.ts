// WhatsApp setup inside the OS: numbers, Meta account link, sender registration and live status.
// Agency admins: every account. Sub-account Admins: only their own account (link their number or buy one).
import { authorizeAccountAdmin, respond } from "@/lib/settings-auth";
import { twilioCredentials } from "@/lib/conversations/core";
import { buyWaNumber, embeddedSignupConfig, listRegulatory, listSenders, ownedNumbers, refreshSender, registerSender, removeSender, searchWaNumbers, verifySender } from "@/lib/whatsapp-setup/server";

export const dynamic = "force-dynamic";
const str = (v: unknown, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const clientKey = (v: unknown) => { const s = str(v, 100); return s === "agency" ? "" : s; };
const fail = (e: unknown, fallback: string) => respond({ error: e instanceof Error ? e.message : fallback }, 400);

export async function GET(request: Request) {
  const auth = await authorizeAccountAdmin("set up WhatsApp");
  if (auth.error) return auth.error;
  const url = new URL(request.url), view = url.searchParams.get("view") || "status";
  try {
    if (view === "owned-numbers") { if (auth.scope) return respond({ numbers: [] }); return respond({ numbers: await ownedNumbers(auth.ownerId) }); }
    if (view === "regulatory") return respond(await listRegulatory(auth.ownerId));
    const twilio = await twilioCredentials(auth.ownerId);
    const clientParam = auth.scope ? (auth.scope.includes(clientKey(url.searchParams.get("clientId"))) ? clientKey(url.searchParams.get("clientId")) : auth.scope[0]) : url.searchParams.get("clientId");
    return respond({ twilioConnected: Boolean(twilio), embeddedSignup: embeddedSignupConfig(), senders: twilio ? await listSenders(auth.ownerId, clientParam === null ? undefined : clientKey(clientParam)) : [] });
  } catch (e) { return fail(e, "Could not load WhatsApp setup."); }
}

export async function POST(request: Request) {
  const auth = await authorizeAccountAdmin("set up WhatsApp");
  if (auth.error) return auth.error;
  let b: Record<string, unknown>; try { b = await request.json(); } catch { return respond({ error: "Send a valid request." }, 400); }
  const base = new URL(request.url).origin;
  const action = str(b.action, 40);
  // Sub-account Admins: only their own account, and only senders that belong to it.
  if (auth.scope) {
    if (action === "register" && !auth.scope.includes(clientKey(b.clientId))) return respond({ error: "You can only set up WhatsApp for your own business." }, 403);
    if (["verify", "refresh", "remove"].includes(action)) {
      const mine = (await Promise.all(auth.scope.map((id) => listSenders(auth.ownerId, id)))).flat().some((x) => x.sid === str(b.sid, 60));
      if (!mine) return respond({ error: "That number isn’t on your account." }, 403);
    }
  }
  try {
    if (action === "search-numbers") return respond({ numbers: await searchWaNumbers(auth.ownerId, { country: str(b.country, 2).toUpperCase() || "IE", contains: str(b.contains, 10), type: b.type === "Local" ? "Local" : "Mobile" }) });
    if (action === "buy-number") return respond({ number: await buyWaNumber(auth.ownerId, str(b.number, 20), base, { addressSid: str(b.addressSid, 40), bundleSid: str(b.bundleSid, 40), label: str(b.label, 60) }) });
    if (action === "register") return respond({ sender: await registerSender(auth.ownerId, { clientId: clientKey(b.clientId), number: str(b.number, 20), wabaId: str(b.wabaId, 30).replace(/\D/g, ""), displayName: str(b.displayName, 60), coexist: b.coexist === true, base }) });
    if (action === "verify") return respond({ sender: await verifySender(auth.ownerId, str(b.sid, 60), str(b.code, 10)) });
    if (action === "refresh") return respond({ sender: await refreshSender(auth.ownerId, str(b.sid, 60)) });
    if (action === "remove") { await removeSender(auth.ownerId, str(b.sid, 60)); return respond({ ok: true }); }
    return respond({ error: "Unknown action." }, 400);
  } catch (e) { return fail(e, "That didn't work. Try again."); }
}
