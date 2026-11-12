// F2B Agency OS · Conversations: Twilio SMS + WhatsApp inbox with an AI bot.
// Credentials live encrypted in D1 (same AES-GCM key as the other saved API keys). Tables are CREATE TABLE IF NOT EXISTS only.
import { env } from "cloudflare:workers";
import { decryptAiCredential, encryptAiCredential } from "@/lib/ai-credentials";
import { aiEndpoint, aiHeaders, aiModel, resolveAiProvider } from "@/lib/ai-provider";

export type Channel = "sms" | "whatsapp";
export type NumberConfig = { number: string; channel: Channel; clientId: string; label: string; info: string };
export type ConvSettings = { accountSid: string; tokenLast4: string; hasToken: boolean; numbers: NumberConfig[]; botEnabled: boolean; botName: string; businessInfo: string; botRules: string; handoffMessage: string; updatedAt: string };

const DEFAULT_HANDOFF = "Thanks, I'm passing this to the team. Someone will get back to you shortly.";

export async function ensureTables() {
  const db = env.DB!;
  await db.prepare(`CREATE TABLE IF NOT EXISTS conv_settings (owner_id TEXT PRIMARY KEY, account_sid TEXT NOT NULL DEFAULT '', enc_token TEXT NOT NULL DEFAULT '', token_iv TEXT NOT NULL DEFAULT '', token_last4 TEXT NOT NULL DEFAULT '', numbers TEXT NOT NULL DEFAULT '[]', bot_enabled INTEGER NOT NULL DEFAULT 1, bot_name TEXT NOT NULL DEFAULT '', business_info TEXT NOT NULL DEFAULT '', bot_rules TEXT NOT NULL DEFAULT '', handoff_message TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS conv_threads (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, client_id TEXT NOT NULL DEFAULT '', channel TEXT NOT NULL, our_number TEXT NOT NULL, contact TEXT NOT NULL, contact_name TEXT NOT NULL DEFAULT '', bot_on INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'open', unread INTEGER NOT NULL DEFAULT 0, last_at TEXT NOT NULL, last_preview TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, UNIQUE(owner_id, our_number, contact, channel))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS conv_messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, owner_id TEXT NOT NULL, direction TEXT NOT NULL, sender TEXT NOT NULL, body TEXT NOT NULL, twilio_sid TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS conv_messages_thread ON conv_messages (thread_id, created_at)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS conv_threads_owner ON conv_threads (owner_id, last_at)`).run();
}

export const e164 = (value: string) => { const d = String(value || "").replace(/^whatsapp:/i, "").replace(/[^\d+]/g, ""); return d ? (d.startsWith("+") ? d : "+" + d.replace(/^00/, "")) : ""; };
const parseNumbers = (raw: string): NumberConfig[] => { try { const list = JSON.parse(raw); return Array.isArray(list) ? list.map((n: any) => ({ number: e164(n.number), channel: n.channel === "whatsapp" ? "whatsapp" : "sms", clientId: String(n.clientId || ""), label: String(n.label || "").slice(0, 60), info: String(n.info || "").slice(0, 2000) })).filter((n: NumberConfig) => n.number) : []; } catch { return []; } };

export async function loadSettings(ownerId: string) {
  await ensureTables();
  const row = await env.DB!.prepare("SELECT * FROM conv_settings WHERE owner_id = ?1").bind(ownerId).first<any>();
  const settings: ConvSettings = { accountSid: row?.account_sid || "", tokenLast4: row?.token_last4 || "", hasToken: Boolean(row?.enc_token), numbers: parseNumbers(row?.numbers || "[]"), botEnabled: row ? row.bot_enabled === 1 : true, botName: row?.bot_name || "", businessInfo: row?.business_info || "", botRules: row?.bot_rules || "", handoffMessage: row?.handoff_message || "", updatedAt: row?.updated_at || "" };
  return { settings, row };
}
export async function twilioCredentials(ownerId: string) {
  const { settings, row } = await loadSettings(ownerId);
  if (!row?.enc_token || !settings.accountSid) return null;
  return { sid: settings.accountSid, token: await decryptAiCredential(row.token_iv, row.enc_token), settings };
}
export async function findOwnerByNumber(number: string, channel: Channel) {
  await ensureTables();
  const rows = (await env.DB!.prepare("SELECT owner_id, numbers FROM conv_settings").all<{ owner_id: string; numbers: string }>()).results || [];
  for (const r of rows) { const hit = parseNumbers(r.numbers).find((n) => n.number === number && n.channel === channel); if (hit) return { ownerId: r.owner_id, config: hit }; }
  return null;
}
export async function saveSettings(ownerId: string, input: { accountSid?: string; authToken?: string; numbers?: NumberConfig[]; botEnabled?: boolean; botName?: string; businessInfo?: string; botRules?: string; handoffMessage?: string }) {
  const { settings, row } = await loadSettings(ownerId);
  let enc = row?.enc_token || "", iv = row?.token_iv || "", last4 = row?.token_last4 || "";
  const token = String(input.authToken || "").trim();
  if (token) { if (!/^[A-Za-z0-9]{16,64}$/.test(token)) throw new Error("That doesn't look like a Twilio Auth Token (letters and numbers only)."); const e = await encryptAiCredential(token); enc = e.ciphertext; iv = e.iv; last4 = token.slice(-4); }
  const sid = input.accountSid !== undefined ? String(input.accountSid).trim() : settings.accountSid;
  if (sid && !/^AC[a-zA-Z0-9]{30,40}$/.test(sid)) throw new Error("The Account SID should start with AC.");
  const numbers = (input.numbers ?? settings.numbers).map((n) => ({ number: e164(n.number), channel: n.channel === "whatsapp" ? "whatsapp" : "sms", clientId: String(n.clientId || ""), label: String(n.label || "").slice(0, 60), info: String(n.info || "").slice(0, 2000) })).filter((n) => n.number);
  for (const n of numbers) if (!/^\+\d{7,15}$/.test(n.number)) throw new Error(`${n.number} is not a valid phone number. Use the international format, like +353851234567.`);
  const now = new Date().toISOString();
  await env.DB!.prepare(`INSERT INTO conv_settings (owner_id, account_sid, enc_token, token_iv, token_last4, numbers, bot_enabled, bot_name, business_info, bot_rules, handoff_message, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
    ON CONFLICT(owner_id) DO UPDATE SET account_sid=?2, enc_token=?3, token_iv=?4, token_last4=?5, numbers=?6, bot_enabled=?7, bot_name=?8, business_info=?9, bot_rules=?10, handoff_message=?11, updated_at=?12`)
    .bind(ownerId, sid, enc, iv, last4, JSON.stringify(numbers), (input.botEnabled ?? settings.botEnabled) ? 1 : 0, String(input.botName ?? settings.botName).slice(0, 60), String(input.businessInfo ?? settings.businessInfo).slice(0, 6000), String(input.botRules ?? settings.botRules).slice(0, 3000), String(input.handoffMessage ?? settings.handoffMessage).slice(0, 400), now).run();
}

/* ---------------- Twilio ---------------- */
const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
export async function twilioSignature(token: string, url: string, params: Record<string, string>) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(token), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  return b64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}
export async function verifyTwilio(token: string, urls: string[], params: Record<string, string>, signature: string) {
  if (!signature) return false;
  for (const u of urls) { const expect = await twilioSignature(token, u, params); if (expect.length === signature.length && expect === signature) return true; }
  return false;
}
export async function sendTwilio(creds: { sid: string; token: string }, p: { from: string; to: string; body: string; channel: Channel }) {
  const prefix = p.channel === "whatsapp" ? "whatsapp:" : "";
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${creds.sid}/Messages.json`, { method: "POST", headers: { Authorization: "Basic " + btoa(`${creds.sid}:${creds.token}`), "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ From: prefix + p.from, To: prefix + p.to, Body: p.body.slice(0, 1500) }) });
  const j = await res.json().catch(() => ({})) as { sid?: string; message?: string };
  if (!res.ok) throw new Error(j.message || `Twilio refused the message (HTTP ${res.status}).`);
  return String(j.sid || "");
}

/* ---------------- threads / messages ---------------- */
export async function upsertThread(ownerId: string, p: { channel: Channel; ourNumber: string; contact: string; contactName?: string; clientId: string }) {
  await ensureTables();
  const db = env.DB!, now = new Date().toISOString();
  const existing = await db.prepare("SELECT * FROM conv_threads WHERE owner_id=?1 AND our_number=?2 AND contact=?3 AND channel=?4").bind(ownerId, p.ourNumber, p.contact, p.channel).first<any>();
  if (existing) { if (p.contactName && !existing.contact_name) await db.prepare("UPDATE conv_threads SET contact_name=?2 WHERE id=?1").bind(existing.id, p.contactName.slice(0, 80)).run(); return existing; }
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO conv_threads (id, owner_id, client_id, channel, our_number, contact, contact_name, bot_on, status, unread, last_at, last_preview, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,1,'open',0,?8,'',?8)").bind(id, ownerId, p.clientId, p.channel, p.ourNumber, p.contact, (p.contactName || "").slice(0, 80), now).run();
  return db.prepare("SELECT * FROM conv_threads WHERE id=?1").bind(id).first<any>();
}
export async function addMessage(ownerId: string, threadId: string, m: { direction: "in" | "out"; sender: "customer" | "bot" | "staff"; body: string; sid?: string; error?: string }) {
  const db = env.DB!, now = new Date().toISOString(), id = crypto.randomUUID();
  await db.prepare("INSERT INTO conv_messages (id, thread_id, owner_id, direction, sender, body, twilio_sid, error, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)").bind(id, threadId, ownerId, m.direction, m.sender, m.body.slice(0, 4000), m.sid || "", (m.error || "").slice(0, 300), now).run();
  await db.prepare(`UPDATE conv_threads SET last_at=?2, last_preview=?3, unread = unread + ?4 WHERE id=?1`).bind(threadId, now, m.body.slice(0, 120), m.direction === "in" ? 1 : 0).run();
  return { id, created_at: now };
}

/* ---------------- AI bot ---------------- */
const outputText = (r: any) => { if (typeof r?.output_text === "string") return r.output_text.trim(); return (r?.output || []).flatMap((i: any) => i.content || []).filter((p: any) => p.type === "output_text" && typeof p.text === "string").map((p: any) => p.text).join("\n").trim(); };
const HUMAN_RE = /\b(human|real person|speak to (?:someone|a person|somebody)|call me|ring me|agent|manager|complain|complaint|solicitor|lawyer|refund)\b/i;
export async function botReply(ownerId: string, p: { settings: ConvSettings; config: NumberConfig; clientName: string; channel: Channel; history: Array<{ sender: string; body: string }>; }): Promise<{ text: string; handoff: boolean } | null> {
  const lastCustomer = [...p.history].reverse().find((m) => m.sender === "customer")?.body || "";
  if (HUMAN_RE.test(lastCustomer)) return { text: p.settings.handoffMessage || DEFAULT_HANDOFF, handoff: true };
  const provider = await resolveAiProvider(env as any, ownerId);
  const endpoint = provider ? aiEndpoint(env as any, "responses", provider) : null;
  if (!provider || !endpoint) return null;
  const name = p.settings.botName || `${p.clientName || "the team"}'s assistant`;
  const instructions = [
    `You are ${name}, replying to customers of ${p.clientName || "the business"} by ${p.channel === "whatsapp" ? "WhatsApp" : "SMS"}.`,
    "Be warm, brief (1-3 short sentences, under 300 characters), plain text only, no markdown, at most one emoji.",
    "Goal: answer simply, find out what the customer needs, and collect their name, what they need and the best time for a call back. Offer to book a call or quote.",
    "Only state facts from the business information below. Never invent prices, availability, guarantees or opening times; if you don't know, say the team will confirm.",
    "If the customer is upset, asks for a person, mentions legal/medical/emergency matters, or you cannot help, reply with a short polite message and end with the exact token [HANDOFF].",
    p.config.info ? `Business information for ${p.clientName || "this business"}:\n${p.config.info}` : "",
    p.settings.businessInfo ? `General agency information:\n${p.settings.businessInfo}` : "",
    p.settings.botRules ? `Extra rules from the owner:\n${p.settings.botRules}` : "",
  ].filter(Boolean).join("\n\n");
  const input = p.history.slice(-14).map((m) => ({ role: m.sender === "customer" ? "user" : "assistant", content: m.body }));
  try {
    const res = await fetch(endpoint, { method: "POST", headers: aiHeaders(env as any, provider)!, body: JSON.stringify({ model: aiModel(env as any, undefined, provider), instructions, input }), signal: AbortSignal.timeout(11000) });
    if (!res.ok) return null;
    let text = outputText(await res.json());
    if (!text) return null;
    const handoff = /\[HANDOFF\]/i.test(text);
    text = text.replace(/\[HANDOFF\]/gi, "").trim().slice(0, 600);
    return text ? { text, handoff } : null;
  } catch { return null; }
}

/** First message from a new customer: add them to the CRM pipeline as a new lead (best effort, never blocks the reply). */
export async function leadToCrm(ownerId: string, t: { clientId: string; channel: Channel; contact: string; name: string; firstMessage: string }) {
  try {
    const db = env.DB!, now = new Date().toISOString();
    const pipeline = (t.clientId ? await db.prepare("SELECT id FROM crm_pipelines WHERE owner_id=?1 AND archived=0 AND client_id=?2 ORDER BY created_at LIMIT 1").bind(ownerId, t.clientId).first<{ id: string }>().catch(() => null) : null)
      || await db.prepare("SELECT id FROM crm_pipelines WHERE owner_id=?1 AND archived=0 ORDER BY created_at LIMIT 1").bind(ownerId).first<{ id: string }>();
    if (!pipeline) return;
    const stage = await db.prepare("SELECT id FROM crm_pipeline_stages WHERE owner_id=?1 AND pipeline_id=?2 AND category='open' ORDER BY position LIMIT 1").bind(ownerId, pipeline.id).first<{ id: string }>();
    if (!stage) return;
    let contact = await db.prepare("SELECT id FROM crm_contacts WHERE owner_id=?1 AND phone=?2 AND COALESCE(client_id,'')=?3 LIMIT 1").bind(ownerId, t.contact, t.clientId).first<{ id: string }>();
    if (!contact) {
      const id = crypto.randomUUID(), parts = (t.name || t.contact).split(/\s+/);
      await db.prepare("INSERT INTO crm_contacts (id, owner_id, client_id, first_name, last_name, email, phone, company, source, notes, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,'',?6,'',?7,'',?8,?8)").bind(id, ownerId, t.clientId || null, parts[0] || t.contact, parts.slice(1).join(" "), t.contact, t.channel === "whatsapp" ? "WhatsApp" : "SMS", now).run();
      contact = { id };
    }
    await db.prepare("INSERT INTO crm_opportunities (id, owner_id, pipeline_id, stage_id, contact_id, client_id, title, value, currency, source, notes, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,0,'EUR',?8,?9,?10,?10)").bind(crypto.randomUUID(), ownerId, pipeline.id, stage.id, contact.id, t.clientId || null, `${t.channel === "whatsapp" ? "WhatsApp" : "Text"} enquiry · ${t.name || t.contact}`, t.channel === "whatsapp" ? "WhatsApp" : "SMS", t.firstMessage.slice(0, 500), now).run();
  } catch (e) { console.error("leadToCrm", e); }
}
