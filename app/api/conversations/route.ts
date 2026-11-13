import { env } from "cloudflare:workers";
import { authorizeAdmin, respond } from "@/lib/settings-auth";
import { aiCredentialStorageReady } from "@/lib/ai-credentials";
import { addMessage, botReply, ensureTables, loadSettings, saveSettings, sendTwilio, twilioCredentials, type NumberConfig } from "@/lib/conversations/core";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeAdmin("open Conversations");
  if (auth.error) return auth.error;
  try {
    await ensureTables();
    const url = new URL(request.url), view = url.searchParams.get("view") || "threads";
    const scope = url.searchParams.get("clientId") || "agency";
    const { settings } = await loadSettings(auth.ownerId);
    if (view === "settings") return respond({ settings, secureStorageReady: aiCredentialStorageReady(), webhookUrl: `${url.origin}/api/marketing-public/twilio` });
    if (view === "thread") {
      const id = url.searchParams.get("id") || "";
      const thread = await env.DB!.prepare("SELECT * FROM conv_threads WHERE id=?1 AND owner_id=?2").bind(id, auth.ownerId).first();
      if (!thread) return respond({ error: "That conversation could not be found." }, 404);
      const messages = (await env.DB!.prepare("SELECT id, direction, sender, body, error, created_at FROM conv_messages WHERE thread_id=?1 ORDER BY created_at ASC LIMIT 300").bind(id).all()).results || [];
      await env.DB!.prepare("UPDATE conv_threads SET unread=0 WHERE id=?1").bind(id).run();
      return respond({ thread: { ...thread, unread: 0 }, messages });
    }
    const where = scope === "agency" ? "owner_id=?1" : "owner_id=?1 AND client_id=?2";
    const stmt = env.DB!.prepare(`SELECT * FROM conv_threads WHERE ${where} ORDER BY last_at DESC LIMIT 200`);
    const threads = (await (scope === "agency" ? stmt.bind(auth.ownerId) : stmt.bind(auth.ownerId, scope)).all()).results || [];
    return respond({ threads, configured: settings.hasToken && Boolean(settings.accountSid) && settings.numbers.length > 0, botEnabled: settings.botEnabled, emailFrom: String(env.TASK_NOTIFICATION_FROM || "") });
  } catch (e) { console.error("conversations GET", e); return respond({ error: "Could not load conversations." }, 503); }
}

export async function POST(request: Request) {
  const auth = await authorizeAdmin("use Conversations");
  if (auth.error) return auth.error;
  let b: any; try { b = await request.json(); } catch { return respond({ error: "Send a valid request." }, 400); }
  try {
    await ensureTables();
    const action = String(b.action || "");
    if (action === "save-settings") {
      if (b.authToken && !aiCredentialStorageReady()) return respond({ error: "Secure storage needs a one-time server setup before the Auth Token can be saved." }, 503);
      await saveSettings(auth.ownerId, { accountSid: b.accountSid, authToken: b.authToken, numbers: Array.isArray(b.numbers) ? b.numbers as NumberConfig[] : undefined, botEnabled: b.botEnabled, botName: b.botName, businessInfo: b.businessInfo, botRules: b.botRules, handoffMessage: b.handoffMessage });
      return respond({ settings: (await loadSettings(auth.ownerId)).settings });
    }
    const id = String(b.id || "");
    const thread = id ? await env.DB!.prepare("SELECT * FROM conv_threads WHERE id=?1 AND owner_id=?2").bind(id, auth.ownerId).first<any>() : null;
    if (!thread) return respond({ error: "That conversation could not be found." }, 404);
    if (action === "send") {
      const text = String(b.body || "").trim().slice(0, 1500);
      if (!text) return respond({ error: "Type a message first." }, 400);
      const creds = await twilioCredentials(auth.ownerId);
      if (!creds) return respond({ error: "Add your Twilio details in Conversation settings first." }, 400);
      let sid = "", error = "";
      try { sid = await sendTwilio(creds, { from: thread.our_number, to: thread.contact, body: text, channel: thread.channel }); } catch (e) { error = e instanceof Error ? e.message : "Could not send."; }
      const m = await addMessage(auth.ownerId, id, { direction: "out", sender: "staff", body: text, sid, error });
      await env.DB!.prepare("UPDATE conv_threads SET bot_on=0, status=CASE WHEN status='closed' THEN 'open' ELSE status END WHERE id=?1").bind(id).run();
      if (error) return respond({ error, messageId: m.id }, 502);
      return respond({ ok: true, messageId: m.id });
    }
    if (action === "toggle-bot") { await env.DB!.prepare("UPDATE conv_threads SET bot_on=?2, status=CASE WHEN ?2=1 AND status='handoff' THEN 'open' ELSE status END WHERE id=?1").bind(id, b.on ? 1 : 0).run(); return respond({ ok: true }); }
    if (action === "status") { const s = ["open", "handoff", "closed"].includes(b.status) ? b.status : "open"; await env.DB!.prepare("UPDATE conv_threads SET status=?2 WHERE id=?1").bind(id, s).run(); return respond({ ok: true }); }
    if (action === "rename") { await env.DB!.prepare("UPDATE conv_threads SET contact_name=?2 WHERE id=?1").bind(id, String(b.name || "").slice(0, 80)).run(); return respond({ ok: true }); }
    if (action === "draft") {
      const { settings } = await loadSettings(auth.ownerId);
      const cfg = settings.numbers.find((n) => n.number === thread.our_number && n.channel === thread.channel) || { number: thread.our_number, channel: thread.channel, clientId: thread.client_id, label: "", info: "" };
      const history = ((await env.DB!.prepare("SELECT sender, body FROM conv_messages WHERE thread_id=?1 ORDER BY created_at DESC LIMIT 14").bind(id).all<{ sender: string; body: string }>()).results || []).reverse();
      const r = await botReply(auth.ownerId, { settings, config: cfg as NumberConfig, clientName: cfg.label, channel: thread.channel, history });
      return r ? respond({ draft: r.text }) : respond({ error: "The AI could not write a reply. Check the AI key in Settings." }, 502);
    }
    return respond({ error: "Unknown action." }, 400);
  } catch (e) { console.error("conversations POST", e); return respond({ error: e instanceof Error ? e.message : "Something went wrong." }, 400); }
}
