// F2B Agency OS · WhatsApp setup done entirely inside the OS.
// Buy (or pick) a Twilio number, link the client's Meta Business account (Meta's Embedded Signup pop-up, or paste the
// WhatsApp Business Account ID), then register the number as a WhatsApp sender through Twilio's Senders API.
// When Twilio reports the sender ONLINE it's added to Conversations for that client automatically.
import { env } from "cloudflare:workers";
import { e164, loadSettings, saveSettings, twilioCredentials } from "@/lib/conversations/core";

type Creds = { sid: string; token: string };
export type WaSender = { sid: string; clientId: string; number: string; displayName: string; wabaId: string; status: string; detail: string; createdAt: string; updatedAt: string };

let ready = false;
async function ensureTable() {
  if (ready) return;
  await env.DB!.prepare(`CREATE TABLE IF NOT EXISTS wa_senders (sid TEXT PRIMARY KEY, owner_id TEXT NOT NULL, client_id TEXT NOT NULL DEFAULT '', number TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '', waba_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`).run();
  await env.DB!.prepare(`CREATE INDEX IF NOT EXISTS wa_senders_owner ON wa_senders (owner_id, created_at)`).run();
  ready = true;
}

async function creds(ownerId: string): Promise<Creds> {
  const c = await twilioCredentials(ownerId);
  if (!c) throw new Error("Connect Twilio first: paste your Account SID and Auth Token in Conversation settings (one time only).");
  return { sid: c.sid, token: c.token };
}
const auth = (c: Creds) => "Basic " + btoa(`${c.sid}:${c.token}`);

async function twilioApi(c: Creds, path: string, form?: Record<string, string>) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${c.sid}${path}`, { method: form ? "POST" : "GET", headers: { Authorization: auth(c), ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) }, body: form ? new URLSearchParams(form) : undefined, signal: AbortSignal.timeout(15_000) });
  const json = await res.json().catch(() => ({})) as Record<string, any>;
  if (!res.ok) throw new Error(String(json.message || `Twilio returned HTTP ${res.status}.`));
  return json;
}
async function sendersApi(c: Creds, path: string, method: "GET" | "POST" | "DELETE" = "GET", body?: unknown) {
  const res = await fetch(`https://messaging.twilio.com/v2/Channels/Senders${path}`, { method, headers: { Authorization: auth(c), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
  if (method === "DELETE" && res.ok) return {};
  const json = await res.json().catch(() => ({})) as Record<string, any>;
  if (!res.ok) throw new Error(friendlyError(String(json.message || json.detail || `Twilio returned HTTP ${res.status}.`)));
  return json;
}
function friendlyError(message: string) {
  if (/waba/i.test(message) && /(not found|invalid|access)/i.test(message)) return `Meta didn't recognise that WhatsApp Business Account, or it isn't shared with your Twilio account yet. ${message}`;
  if (/display name|profile.*name/i.test(message)) return `Meta rejected the display name. Use the business's real trading name. ${message}`;
  return message;
}

export const webhookUrls = (base: string) => ({ inbound: `${base}/api/marketing-public/twilio`, status: `${base}/api/marketing-public/twilio/status` });

/* -------- numbers -------- */
export async function searchWaNumbers(ownerId: string, p: { country: string; contains?: string; type?: "Local" | "Mobile" }) {
  const c = await creds(ownerId);
  const country = /^[A-Z]{2}$/.test(p.country) ? p.country : "IE";
  const q = new URLSearchParams({ SmsEnabled: "true", PageSize: "20" });
  if (p.contains && /^\d{2,10}$/.test(p.contains)) q.set("Contains", p.contains);
  const kind = p.type === "Local" ? "Local" : "Mobile";
  const j = await twilioApi(c, `/AvailablePhoneNumbers/${country}/${kind}.json?${q}`).catch((e: Error) => {
    if (/not found/i.test(e.message)) throw new Error(`Twilio doesn't sell ${kind === "Mobile" ? "mobile" : "landline"} numbers in ${country === "IE" ? "Ireland" : country}.${country === "IE" ? " Use the client's own number instead, or a UK mobile." : " Try the other type or another country."}`);
    throw e;
  });
  const list = ((j.available_phone_numbers || []) as any[]).map((n) => ({ number: String(n.phone_number), friendly: String(n.friendly_name || n.phone_number), locality: String(n.locality || n.region || ""), addressRequired: String(n.address_requirements || "none") }));
  if (!list.length && country === "IE") throw new Error("Twilio has no Irish numbers available right now. Use the client's own number instead, or a UK mobile.");
  return list;
}
export async function buyWaNumber(ownerId: string, number: string, base: string, extra: { addressSid?: string; bundleSid?: string; label?: string }) {
  const c = await creds(ownerId);
  const urls = webhookUrls(base);
  const form: Record<string, string> = { PhoneNumber: e164(number), SmsUrl: urls.inbound, SmsMethod: "POST", FriendlyName: (extra.label || "F2B WhatsApp").slice(0, 60) };
  if (extra.addressSid && /^AD[a-f0-9]{32}$/i.test(extra.addressSid)) form.AddressSid = extra.addressSid;
  if (extra.bundleSid && /^BU[a-f0-9]{32}$/i.test(extra.bundleSid)) form.BundleSid = extra.bundleSid;
  const j = await twilioApi(c, "/IncomingPhoneNumbers.json", form);
  return String(j.phone_number || e164(number));
}
export async function ownedNumbers(ownerId: string) {
  const c = await creds(ownerId);
  const j = await twilioApi(c, "/IncomingPhoneNumbers.json?PageSize=100");
  return ((j.incoming_phone_numbers || []) as any[]).map((n) => ({ number: String(n.phone_number), friendly: String(n.friendly_name || "") }));
}
export async function listRegulatory(ownerId: string) {
  const c = await creds(ownerId);
  const addresses = await twilioApi(c, "/Addresses.json?PageSize=50").catch(() => ({ addresses: [] }));
  const bundles = await fetch("https://numbers.twilio.com/v2/RegulatoryCompliance/Bundles?Status=twilio-approved&PageSize=50", { headers: { Authorization: auth(c) }, signal: AbortSignal.timeout(15_000) }).then((r) => r.ok ? r.json() as Promise<Record<string, any>> : { results: [] }).catch(() => ({ results: [] }));
  return {
    addresses: ((addresses.addresses || []) as any[]).map((a) => ({ sid: String(a.sid), label: [a.friendly_name, a.street, a.city, a.iso_country].filter(Boolean).join(", ") })),
    bundles: ((bundles.results || []) as any[]).map((b) => ({ sid: String(b.sid), label: String(b.friendly_name || b.sid) })),
  };
}

/* -------- WhatsApp senders -------- */
function rowToSender(r: any): WaSender {
  return { sid: r.sid, clientId: r.client_id, number: r.number, displayName: r.display_name, wabaId: r.waba_id, status: r.status, detail: r.detail, createdAt: r.created_at, updatedAt: r.updated_at };
}
function senderDetail(j: Record<string, any>) {
  const offline = j.offline_reasons || j.properties?.offline_reasons;
  if (Array.isArray(offline) && offline.length) return offline.map((o: any) => o?.message || o?.code || String(o)).join("; ").slice(0, 400);
  return String(j.properties?.quality_rating ? `Quality: ${j.properties.quality_rating}` : "").slice(0, 400);
}

export async function registerSender(ownerId: string, p: { clientId: string; number: string; wabaId: string; displayName: string; base: string }) {
  await ensureTable();
  const c = await creds(ownerId);
  const number = e164(p.number);
  if (!/^\+\d{7,15}$/.test(number)) throw new Error("Choose a valid phone number first.");
  if (!/^\d{6,25}$/.test(p.wabaId)) throw new Error("The WhatsApp Business Account ID is a long number. Connect with Facebook, or paste it from Meta Business Suite.");
  const name = p.displayName.trim().slice(0, 60);
  if (name.length < 3) throw new Error("Add the business name customers should see on WhatsApp.");
  const urls = webhookUrls(p.base);
  const ownsNumber = (await ownedNumbers(ownerId).catch(() => [])).some((n) => n.number === number);
  const j = await sendersApi(c, "", "POST", {
    sender_id: `whatsapp:${number}`,
    configuration: { waba_id: p.wabaId, ...(ownsNumber ? {} : { verification_method: "sms" }) },
    webhook: { callback_url: urls.inbound, callback_method: "POST", status_callback_url: urls.status, status_callback_method: "POST" },
    profile: { name },
  });
  const now = new Date().toISOString();
  const sid = String(j.sid || "");
  if (!sid) throw new Error("Twilio didn't return a sender. Try again in a minute.");
  await env.DB!.prepare(`INSERT OR REPLACE INTO wa_senders (sid, owner_id, client_id, number, display_name, waba_id, status, detail, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)`)
    .bind(sid, ownerId, p.clientId, number, name, p.wabaId, String(j.status || "CREATING"), senderDetail(j), now).run();
  await maybeGoLive(ownerId, { sid, clientId: p.clientId, number, displayName: name, status: String(j.status || "") });
  return { sid, status: String(j.status || "CREATING"), ownsNumber };
}

export async function verifySender(ownerId: string, sid: string, code: string) {
  await ensureTable();
  const row = await env.DB!.prepare("SELECT * FROM wa_senders WHERE owner_id=?1 AND sid=?2").bind(ownerId, sid).first<any>();
  if (!row) throw new Error("That WhatsApp setup couldn't be found.");
  if (!/^\d{4,8}$/.test(code)) throw new Error("Enter the code from the text or call (numbers only).");
  const c = await creds(ownerId);
  await sendersApi(c, `/${encodeURIComponent(sid)}`, "POST", { configuration: { verification_code: code } });
  return refreshSender(ownerId, sid);
}

export async function refreshSender(ownerId: string, sid: string) {
  await ensureTable();
  const row = await env.DB!.prepare("SELECT * FROM wa_senders WHERE owner_id=?1 AND sid=?2").bind(ownerId, sid).first<any>();
  if (!row) throw new Error("That WhatsApp setup couldn't be found.");
  const c = await creds(ownerId);
  const j = await sendersApi(c, `/${encodeURIComponent(sid)}`);
  const status = String(j.status || row.status), detail = senderDetail(j), now = new Date().toISOString();
  await env.DB!.prepare("UPDATE wa_senders SET status=?3, detail=?4, updated_at=?5 WHERE owner_id=?1 AND sid=?2").bind(ownerId, sid, status, detail, now).run();
  await maybeGoLive(ownerId, { sid, clientId: row.client_id, number: row.number, displayName: row.display_name, status });
  return rowToSender({ ...row, status, detail, updated_at: now });
}

/** Lists setups (optionally for one client). Ones still in progress are refreshed from Twilio, at most 5 per call. */
export async function listSenders(ownerId: string, clientId?: string) {
  await ensureTable();
  const rows = ((clientId === undefined
    ? await env.DB!.prepare("SELECT * FROM wa_senders WHERE owner_id=?1 ORDER BY created_at DESC LIMIT 50").bind(ownerId).all<any>()
    : await env.DB!.prepare("SELECT * FROM wa_senders WHERE owner_id=?1 AND client_id=?2 ORDER BY created_at DESC LIMIT 50").bind(ownerId, clientId).all<any>()).results || []).map(rowToSender);
  const pending = rows.filter((r) => !/^ONLINE$/.test(r.status) && Date.now() - Date.parse(r.updatedAt) > 20_000).slice(0, 5);
  for (const r of pending) { try { Object.assign(r, await refreshSender(ownerId, r.sid)); } catch { /* keep last known state */ } }
  return rows;
}

export async function removeSender(ownerId: string, sid: string) {
  await ensureTable();
  const row = await env.DB!.prepare("SELECT * FROM wa_senders WHERE owner_id=?1 AND sid=?2").bind(ownerId, sid).first<any>();
  if (!row) return;
  const c = await creds(ownerId);
  await sendersApi(c, `/${encodeURIComponent(sid)}`, "DELETE").catch(() => undefined);
  await env.DB!.prepare("DELETE FROM wa_senders WHERE owner_id=?1 AND sid=?2").bind(ownerId, sid).run();
  const { settings } = await loadSettings(ownerId);
  await saveSettings(ownerId, { numbers: settings.numbers.filter((n) => !(n.channel === "whatsapp" && n.number === row.number)) });
}

/** Once Meta/Twilio say ONLINE, the number is added to Conversations as a WhatsApp number for that client. */
async function maybeGoLive(ownerId: string, s: { sid: string; clientId: string; number: string; displayName: string; status: string }) {
  if (!/^ONLINE/.test(s.status)) return;
  const { settings } = await loadSettings(ownerId);
  if (settings.numbers.some((n) => n.channel === "whatsapp" && n.number === s.number)) return;
  await saveSettings(ownerId, { numbers: [...settings.numbers, { number: s.number, channel: "whatsapp", clientId: s.clientId, label: s.displayName.slice(0, 60), info: "" }] });
}

/** What the browser needs for Meta's Embedded Signup pop-up (public IDs only). */
export function embeddedSignupConfig() {
  const appId = String(env.META_APP_ID || "").trim();
  const configId = String(env.WHATSAPP_ES_CONFIG_ID || "").trim();
  const solutionId = String(env.WHATSAPP_ES_SOLUTION_ID || "").trim();
  const version = /^v\d+\.\d+$/.test(String(env.META_MARKETING_API_VERSION || "")) ? String(env.META_MARKETING_API_VERSION) : "v21.0";
  return { ready: Boolean(appId && configId), appId, configId, solutionId, version };
}
