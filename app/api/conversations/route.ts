import { env } from "cloudflare:workers";
import { authorizeAdminOrSubAccount, respond } from "@/lib/settings-auth";
import { aiCredentialStorageReady } from "@/lib/ai-credentials";
import { addMessage, suggestReplies, botReply, e164, ensureTables, getClientBot, listTwilioTemplates, sanitizeBot, saveClientBot, BLANK_BOT, loadSettings, saveSettings, sendTwilio, twilioCredentials, upsertThread, type NumberConfig } from "@/lib/conversations/core";
import { renderTemplate, windowState } from "@/lib/conversations/whatsapp";
import { ensureMetaTables, getStaffMessaging, sendMeta, sendMetaAttachment } from "@/lib/conversations/meta";

// Attachments: only files already in this workspace's Media Library (uploaded from the chat box).
type Media = { url: string; mime: string; name: string };
const mediaFrom = (raw: unknown, origin: string): Media[] => (Array.isArray(raw) ? raw : []).slice(0, 5).map((m: any) => ({ url: String(m?.url || ""), mime: String(m?.mime || "").slice(0, 80), name: String(m?.name || "File").replace(/[\r\n]/g, " ").slice(0, 80) })).filter((m) => /^\/api\/marketing-public\/media\?f=[A-Za-z0-9._%\/-]+$/.test(m.url)).map((m) => ({ ...m, url: origin + m.url }));
const mediaLines = (media: Media[]) => media.map((m) => (m.mime.startsWith("image/") ? `📷 ${m.url}` : `📎 ${m.name} ${m.url}`));
import { metaSendMode } from "@/lib/conversations/meta-rules";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeAdminOrSubAccount("open Conversations", "Conversations");
  if (auth.error) return auth.error;
  const allowed = auth.scope; // null = admin (everything); otherwise this person's own sub-account ids
  try {
    await ensureTables(); await ensureMetaTables();
    const url = new URL(request.url), view = url.searchParams.get("view") || "threads";
    const requested = url.searchParams.get("clientId") || "agency";
    const scope = allowed ? (allowed.includes(requested) ? requested : allowed[0]) : requested;
    if (allowed && view === "settings") return respond({ error: "Only an admin can change Conversation settings." }, 403);
    const { settings } = await loadSettings(auth.ownerId);
    if (view === "settings") return respond({ settings, secureStorageReady: aiCredentialStorageReady(), webhookUrl: `${url.origin}/api/marketing-public/twilio` });
    if (view === "held") {
      // AI approvals: bot replies held back (e.g. they contained a booking link), for the Dashboard and the inbox.
      const rows = (await env.DB!.prepare("SELECT m.id, m.thread_id, m.body, m.error, m.created_at, t.client_id, t.contact_name, t.contact, t.channel FROM conv_messages m JOIN conv_threads t ON t.id = m.thread_id WHERE m.owner_id=?1 AND m.status='held' ORDER BY m.created_at DESC LIMIT 100").bind(auth.ownerId).all<any>().catch(() => ({ results: [] }))).results || [];
      const inView = rows.filter((r: any) => (!allowed || allowed.includes(String(r.client_id || ""))) && (scope === "agency" || r.client_id === scope));
      return respond({ held: inView.map((r: any) => ({ id: r.id, threadId: r.thread_id, body: r.body, reason: r.error, at: r.created_at, clientId: r.client_id, name: r.contact_name || r.contact, channel: r.channel })) });
    }
    if (view === "thread") {
      const id = url.searchParams.get("id") || "";
      const thread = await env.DB!.prepare("SELECT * FROM conv_threads WHERE id=?1 AND owner_id=?2").bind(id, auth.ownerId).first();
      if (!thread || (allowed && !allowed.includes(String((thread as any).client_id || "")))) return respond({ error: "That conversation could not be found." }, 404);
      const messages = (await env.DB!.prepare("SELECT id, direction, sender, body, error, status, created_at FROM conv_messages WHERE thread_id=?1 ORDER BY created_at ASC LIMIT 300").bind(id).all()).results || [];
      await env.DB!.prepare("UPDATE conv_threads SET unread=0 WHERE id=?1").bind(id).run();
      return respond({ thread: { ...thread, unread: 0 }, messages });
    }
    const where = scope === "agency" ? "owner_id=?1" : "owner_id=?1 AND client_id=?2";
    const stmt = env.DB!.prepare(`SELECT * FROM conv_threads WHERE ${where} ORDER BY last_at DESC LIMIT 200`);
    let threads = (await (scope === "agency" ? stmt.bind(auth.ownerId) : stmt.bind(auth.ownerId, scope)).all()).results || [];
    // Sub-account staff only see the channels switched on for them (Team → Messaging). Admins see everything.
    if (allowed && auth.staffId) { const mine = (await getStaffMessaging(auth.ownerId, [auth.staffId]))[auth.staffId]; if (mine) threads = threads.filter((t: any) => t.channel === "email" || (mine.channels as Record<string, boolean>)[String(t.channel)] !== false); }
    // WhatsApp numbers this person may start chats from (for the "New chat" button), limited to their own sub-accounts.
    const waNumbers = settings.numbers.filter((n) => n.channel === "whatsapp" && (!allowed || allowed.includes(n.clientId)) && (scope === "agency" || n.clientId === scope)).map((n) => ({ number: n.number, clientId: n.clientId, label: n.label }));
    return respond({ threads, waNumbers, configured: settings.hasToken && Boolean(settings.accountSid) && settings.numbers.length > 0, botEnabled: settings.botEnabled, emailFrom: String(env.TASK_NOTIFICATION_FROM || ""), me: auth.staffId || "" });
  } catch (e) { console.error("conversations GET", e); return respond({ error: "Could not load conversations." }, 503); }
}

export async function POST(request: Request) {
  const auth = await authorizeAdminOrSubAccount("use Conversations", "Conversations");
  if (auth.error) return auth.error;
  const allowed = auth.scope;
  let b: any; try { b = await request.json(); } catch { return respond({ error: "Send a valid request." }, 400); }
  try {
    await ensureTables(); await ensureMetaTables();
    const action = String(b.action || "");
    if (action === "save-settings") {
      if (allowed) return respond({ error: "Only an admin can change Conversation settings." }, 403);
      if (b.authToken && !aiCredentialStorageReady()) return respond({ error: "Secure storage needs a one-time server setup before the Auth Token can be saved." }, 503);
      await saveSettings(auth.ownerId, { accountSid: b.accountSid, authToken: b.authToken, numbers: Array.isArray(b.numbers) ? b.numbers as NumberConfig[] : undefined, botEnabled: b.botEnabled, botName: b.botName, businessInfo: b.businessInfo, botRules: b.botRules, handoffMessage: b.handoffMessage });
      return respond({ settings: (await loadSettings(auth.ownerId)).settings });
    }
    if (action === "bot-get" || action === "bot-save" || action === "bot-test") {
      const clientId = String(b.clientId || "").slice(0, 100);
      if (!clientId || (allowed && !allowed.includes(clientId))) return respond({ error: "You can't train the bot for that client." }, 403);
      if (action === "bot-get") return respond({ bot: (await getClientBot(auth.ownerId, clientId)) || BLANK_BOT, saved: Boolean(await getClientBot(auth.ownerId, clientId)) });
      if (action === "bot-save") { const bot = sanitizeBot(b.bot); await saveClientBot(auth.ownerId, clientId, bot); return respond({ bot }); }
      // Test chat: same brain as the live bot, using the draft being edited (saved first so the test matches).
      if (b.bot) await saveClientBot(auth.ownerId, clientId, sanitizeBot(b.bot));
      const { settings } = await loadSettings(auth.ownerId);
      const history = (Array.isArray(b.history) ? b.history : []).slice(-14).map((m: any) => ({ sender: m?.from === "customer" ? "customer" : "bot", body: String(m?.text || "").slice(0, 1000) }));
      const r = await botReply(auth.ownerId, { settings, config: { number: "", channel: "whatsapp", clientId, label: String(b.clientName || ""), info: "" } as NumberConfig, clientName: String(b.clientName || ""), channel: "whatsapp", history, forceTest: true });
      return r ? respond({ reply: r.text, handoff: r.handoff }) : respond({ error: "The AI couldn't reply. Check the AI key in Settings → APIs." }, 502);
    }
    const statusCallback = `${new URL(request.url).origin}/api/marketing-public/twilio/status`;
    if (action === "start") {
      // New WhatsApp chat with someone who hasn't written in yet: one thread per customer per WhatsApp number.
      const clientId = String(b.clientId ?? "").slice(0, 100);
      if (allowed && !allowed.includes(clientId)) return respond({ error: "You can't start chats for that client." }, 403);
      const phone = e164(String(b.phone || ""));
      if (!/^\+\d{7,15}$/.test(phone)) return respond({ error: "Enter the customer's number in international format, like +353871234567." }, 400);
      const { settings } = await loadSettings(auth.ownerId);
      const from = settings.numbers.find((n) => n.channel === "whatsapp" && n.clientId === clientId && (!b.from || n.number === e164(String(b.from))));
      if (!from) return respond({ error: "This account has no WhatsApp number yet. Add one in Conversation settings." }, 400);
      const thread = await upsertThread(auth.ownerId, { channel: "whatsapp", ourNumber: from.number, contact: phone, contactName: String(b.name || "").trim(), clientId });
      return respond({ id: thread.id });
    }
    if (action === "templates") {
      const creds = await twilioCredentials(auth.ownerId);
      if (!creds) return respond({ error: "Add your Twilio details in Conversation settings first." }, 400);
      return respond({ templates: await listTwilioTemplates(creds) });
    }
    const id = String(b.id || "");
    const thread = id ? await env.DB!.prepare("SELECT * FROM conv_threads WHERE id=?1 AND owner_id=?2").bind(id, auth.ownerId).first<any>() : null;
    if (!thread || (allowed && !allowed.includes(String(thread.client_id || "")))) return respond({ error: "That conversation could not be found." }, 404);
    if (action === "send" && thread.channel === "email") {
      // Email reply from the inbox: sent from the system sender, replies come back to the person who wrote it.
      const text = String(b.body || "").trim().slice(0, 10000);
      const subject = String(b.subject || "").trim().slice(0, 200) || "Re: your enquiry";
      const media = mediaFrom(b.media, new URL(request.url).origin);
      if (!text && !media.length) return respond({ error: "Write your email first." }, 400);
      if (!env.RESEND_API_KEY || !env.TASK_NOTIFICATION_FROM) return respond({ error: "Email sending isn't set up on the server yet." }, 503);
      // The person replying: their own name, reply-to address and signature (Team → Messaging), sent from the verified system address.
      const senderId = auth.staffId || String(b.staffId || "").slice(0, 100);
      const who = senderId ? (await getStaffMessaging(auth.ownerId, [senderId]))[senderId] : undefined;
      const replyTo = who?.emailReplyTo || String(b.replyTo || "").trim();
      const fromAddr = (String(env.TASK_NOTIFICATION_FROM).match(/<([^>]+)>/) || [])[1] || String(env.TASK_NOTIFICATION_FROM);
      const from = who?.emailName ? `${who.emailName.replace(/["<>]/g, "")} <${fromAddr}>` : env.TASK_NOTIFICATION_FROM;
      const signed = who?.signature ? `${text}\n\n${who.signature}` : text;
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#22272b">${signed.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${p.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c]).replace(/\n/g, "<br>")}</p>`).join("")}</div>`;
      let error = "";
      try {
        const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `conv-email/${id}/${crypto.randomUUID()}` }, body: JSON.stringify({ from, to: [thread.contact], subject, text: signed, html, ...(media.length ? { attachments: media.map((m) => ({ path: m.url, filename: m.name })) } : {}), ...(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(replyTo) ? { reply_to: replyTo } : {}) }), signal: AbortSignal.timeout(15_000) });
        if (!r.ok) error = `The email service returned HTTP ${r.status}.`;
      } catch (e) { error = e instanceof Error ? e.message : "Could not send."; }
      const m = await addMessage(auth.ownerId, id, { direction: "out", sender: "staff", body: [`Subject: ${subject}\n\n${signed}`, ...mediaLines(media)].join("\n"), error });
      if (error) return respond({ error, messageId: m.id }, 502);
      return respond({ ok: true, messageId: m.id });
    }
    if (action === "send" && (thread.channel === "messenger" || thread.channel === "instagram")) {
      const text = String(b.body || "").trim().slice(0, 1900);
      const media = mediaFrom(b.media, new URL(request.url).origin);
      if (!text && !media.length) return respond({ error: "Type a message first." }, 400);
      const mode = metaSendMode(thread.last_in_at, true);
      if (!mode.ok) return respond({ error: mode.reason, code: "window_closed" }, 409);
      let sid = "", error = "";
      try {
        if (text) sid = await sendMeta(auth.ownerId, { accountId: thread.our_number, contactId: thread.contact, text, tag: mode.tag });
        for (const f of media) { const s2 = await sendMetaAttachment(auth.ownerId, { accountId: thread.our_number, contactId: thread.contact, url: f.url, mime: f.mime, tag: mode.tag }); sid ||= s2; }
      } catch (e) { error = e instanceof Error ? e.message : "Could not send."; }
      const m = await addMessage(auth.ownerId, id, { direction: "out", sender: "staff", body: [text, ...mediaLines(media)].filter(Boolean).join("\n"), sid, error });
      await env.DB!.prepare("UPDATE conv_threads SET bot_on=0, status=CASE WHEN status='closed' THEN 'open' ELSE status END WHERE id=?1").bind(id).run();
      if (error) return respond({ error, messageId: m.id }, 502);
      return respond({ ok: true, messageId: m.id });
    }
    if (action === "held-approve" || action === "held-discard") {
      const msgId = String(b.messageId || "");
      const held = await env.DB!.prepare("SELECT * FROM conv_messages WHERE id=?1 AND thread_id=?2 AND status='held'").bind(msgId, id).first<any>();
      if (!held) return respond({ error: "That reply was already handled." }, 404);
      if (action === "held-discard") { await env.DB!.prepare("DELETE FROM conv_messages WHERE id=?1").bind(msgId).run(); return respond({ ok: true }); }
      const text = String(b.body ?? held.body).trim().slice(0, 1900);
      if (!text) return respond({ error: "The reply is empty." }, 400);
      let sid = "", error = "";
      try {
        if (thread.channel === "messenger" || thread.channel === "instagram") { const mode = metaSendMode(thread.last_in_at, true); if (!mode.ok) throw new Error(mode.reason); sid = await sendMeta(auth.ownerId, { accountId: thread.our_number, contactId: thread.contact, text, tag: mode.tag }); }
        else if (thread.channel === "whatsapp" || thread.channel === "sms") { if (thread.channel === "whatsapp" && !windowState(thread.last_in_at).open) throw new Error("The 24-hour WhatsApp window has closed. Send an approved template instead."); const creds = await twilioCredentials(auth.ownerId); if (!creds) throw new Error("Add your Twilio details in Conversation settings first."); sid = await sendTwilio(creds, { from: thread.our_number, to: thread.contact, body: text, channel: thread.channel, statusCallback }); }
        else throw new Error("This chat can't send that reply.");
      } catch (e) { error = e instanceof Error ? e.message : "Could not send."; }
      if (error) return respond({ error }, 502);
      await env.DB!.prepare("UPDATE conv_messages SET body=?2, status='sent', twilio_sid=?3, error='', sender='staff' WHERE id=?1").bind(msgId, text, sid).run();
      await env.DB!.prepare("UPDATE conv_threads SET status='open', last_preview=?2 WHERE id=?1").bind(id, text.slice(0, 120)).run();
      return respond({ ok: true });
    }
    if (action === "suggest") {
      const { settings } = await loadSettings(auth.ownerId);
      const history = ((await env.DB!.prepare("SELECT sender, body FROM conv_messages WHERE thread_id=?1 AND status<>'held' ORDER BY created_at DESC LIMIT 12").bind(id).all<{ sender: string; body: string }>()).results || []).reverse();
      const client = await env.DB!.prepare("SELECT json_extract(value,'$.name') AS name FROM workspace_documents, json_each(data,'$.clients') WHERE id='f2b-agency' AND json_extract(value,'$.id')=?1").bind(thread.client_id || "").first<{ name: string }>().catch(() => null);
      return respond({ replies: await suggestReplies(auth.ownerId, { settings, clientId: thread.client_id || "", clientName: client?.name || "", channel: thread.channel, history }) });
    }
    if (action === "assign") {
      const to = String(b.staffId || "").slice(0, 100);
      await env.DB!.prepare("UPDATE conv_threads SET assigned_to=?2 WHERE id=?1").bind(id, to).run();
      return respond({ ok: true });
    }
    if (action === "send") {
      const text = String(b.body || "").trim().slice(0, 1500);
      const media = mediaFrom(b.media, new URL(request.url).origin);
      if (!text && !media.length) return respond({ error: "Type a message first." }, 400);
      if (thread.channel === "whatsapp" && !windowState(thread.last_in_at).open) return respond({ error: "The 24-hour WhatsApp window is closed. Send an approved template to restart the chat.", code: "window_closed" }, 409);
      const creds = await twilioCredentials(auth.ownerId);
      if (!creds) return respond({ error: "Add your Twilio details in Conversation settings first." }, 400);
      let sid = "", error = "";
      try {
        // WhatsApp takes one file per message: the first carries the text as its caption, the rest follow on their own.
        if (!media.length) sid = await sendTwilio(creds, { from: thread.our_number, to: thread.contact, body: text, channel: thread.channel, statusCallback });
        for (const [i, f] of media.entries()) { const s2 = await sendTwilio(creds, { from: thread.our_number, to: thread.contact, body: i === 0 ? text : "", mediaUrl: f.url, channel: thread.channel, statusCallback }); sid ||= s2; }
      } catch (e) { error = e instanceof Error ? e.message : "Could not send."; }
      const m = await addMessage(auth.ownerId, id, { direction: "out", sender: "staff", body: [text, ...mediaLines(media)].filter(Boolean).join("\n"), sid, error });
      await env.DB!.prepare("UPDATE conv_threads SET bot_on=0, status=CASE WHEN status='closed' THEN 'open' ELSE status END WHERE id=?1").bind(id).run();
      if (error) return respond({ error, messageId: m.id }, 502);
      return respond({ ok: true, messageId: m.id });
    }
    if (action === "send-template") {
      if (thread.channel !== "whatsapp") return respond({ error: "Templates are only for WhatsApp chats." }, 400);
      const contentSid = String(b.contentSid || "");
      if (!/^HX[0-9a-f]{32}$/i.test(contentSid)) return respond({ error: "Pick a template first." }, 400);
      const creds = await twilioCredentials(auth.ownerId);
      if (!creds) return respond({ error: "Add your Twilio details in Conversation settings first." }, 400);
      const vars: Record<string, string> = {};
      if (b.variables && typeof b.variables === "object") for (const [k, v] of Object.entries(b.variables as Record<string, unknown>)) if (/^[A-Za-z0-9_]{1,20}$/.test(k)) vars[k] = String(v ?? "").trim().slice(0, 500);
      for (const [k, v] of Object.entries(vars)) if (!v) return respond({ error: `Fill in {{${k}}} before sending.` }, 400);
      const preview = `📋 ${String(b.name || "Template").slice(0, 80)}\n${renderTemplate(String(b.body || ""), vars)}`.trim();
      let sid = "", error = "";
      try { sid = await sendTwilio(creds, { from: thread.our_number, to: thread.contact, channel: "whatsapp", contentSid, contentVariables: vars, statusCallback }); } catch (e) { error = e instanceof Error ? e.message : "Could not send."; }
      const m = await addMessage(auth.ownerId, id, { direction: "out", sender: "staff", body: preview, sid, error });
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
