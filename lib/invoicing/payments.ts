// F2B Agency OS · Online invoice payments.
// Main: Revolut Business payment links (Hosted Checkout Page) — Apple Pay, Google Pay, Revolut Pay, card and pay by bank
// (clients pick their own bank: AIB, BOI, PTSB, Barclays, HSBC, Monzo…). Backup: Stripe Checkout using the keys
// already saved in Onboarding → Payments. Bank-transfer details on the invoice stay as they are.
// Webhooks mark invoices paid; every payment is re-checked with the provider before an invoice is marked paid.
import { env } from "cloudflare:workers";
import { decryptAiCredential, encryptAiCredential, aiCredentialStorageReady } from "@/lib/ai-credentials";
import { settleCreditInvoice } from "@/lib/usage-credits";

type Mode = "live" | "sandbox";
export type PaymentSettings = { revolut: { connected: boolean; mode: Mode; webhook: boolean; error: string }; stripe: { ready: boolean }; preferred: "revolut" | "stripe" | "none" };

const REVOLUT_API_VERSION = "2024-09-01";
const base = (mode: Mode) => (mode === "sandbox" ? "https://sandbox-merchant.revolut.com" : "https://merchant.revolut.com");
const db = () => env.DB!;
let ready = false;

export async function ensurePaymentTables() {
  if (ready) return;
  await db().prepare(`CREATE TABLE IF NOT EXISTS inv_pay_settings (owner_id TEXT PRIMARY KEY, revolut_key TEXT NOT NULL DEFAULT '', revolut_key_iv TEXT NOT NULL DEFAULT '', revolut_mode TEXT NOT NULL DEFAULT 'live', revolut_webhook_id TEXT NOT NULL DEFAULT '', revolut_webhook_secret TEXT NOT NULL DEFAULT '', revolut_webhook_secret_iv TEXT NOT NULL DEFAULT '', last_error TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')`).run();
  await db().prepare(`CREATE TABLE IF NOT EXISTS inv_pay_links (invoice_id TEXT NOT NULL, provider TEXT NOT NULL, owner_id TEXT NOT NULL, order_id TEXT NOT NULL, url TEXT NOT NULL, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (invoice_id, provider))`).run();
  await db().prepare(`CREATE INDEX IF NOT EXISTS inv_pay_links_order ON inv_pay_links (provider, order_id)`).run();
  ready = true;
}

async function settingsRow(ownerId: string) {
  await ensurePaymentTables();
  return db().prepare("SELECT * FROM inv_pay_settings WHERE owner_id=?1").bind(ownerId).first<Record<string, string>>();
}
async function decrypt(iv: string, value: string) { if (!value) return ""; try { return await decryptAiCredential(iv, value); } catch { return ""; } }
async function revolutKey(ownerId: string) { const r = await settingsRow(ownerId); return { key: await decrypt(r?.revolut_key_iv || "", r?.revolut_key || ""), mode: (r?.revolut_mode === "sandbox" ? "sandbox" : "live") as Mode, row: r }; }

async function stripeReady(ownerId: string) {
  try { const { proposalPaymentsReady } = await import("@/lib/onboarding/server"); return Boolean(await proposalPaymentsReady(ownerId)); } catch { return false; }
}

export async function loadPaymentSettings(ownerId: string): Promise<PaymentSettings> {
  const r = await settingsRow(ownerId);
  const connected = Boolean(r?.revolut_key);
  const stripe = await stripeReady(ownerId);
  return { revolut: { connected, mode: r?.revolut_mode === "sandbox" ? "sandbox" : "live", webhook: Boolean(r?.revolut_webhook_secret), error: r?.last_error || "" }, stripe: { ready: stripe }, preferred: connected ? "revolut" : stripe ? "stripe" : "none" };
}

async function revolut(key: string, mode: Mode, path: string, init: { method?: string; body?: unknown; legacy?: boolean } = {}) {
  const res = await fetch(`${base(mode)}${path}`, {
    method: init.method || "GET",
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.legacy ? {} : { "Revolut-Api-Version": REVOLUT_API_VERSION }) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => null) as any;
  if (!res.ok) throw new Error(res.status === 401 ? "Revolut didn't accept that API key. Copy the Merchant API secret key again from Revolut Business." : String(json?.message || json?.error || `Revolut returned HTTP ${res.status}.`));
  return json;
}

/** Saves the Revolut Merchant API secret key (encrypted), checks it, and registers the payment webhook with Revolut. */
export async function saveRevolutConnection(ownerId: string, input: { key?: string; mode?: string; disconnect?: boolean }, origin: string) {
  await ensurePaymentTables();
  const now = new Date().toISOString();
  if (input.disconnect) {
    const { key, mode, row } = await revolutKey(ownerId);
    if (key && row?.revolut_webhook_id) await revolut(key, mode, `/api/1.0/webhooks/${encodeURIComponent(row.revolut_webhook_id)}`, { method: "DELETE", legacy: true }).catch(() => null);
    await db().prepare("DELETE FROM inv_pay_settings WHERE owner_id=?1").bind(ownerId).run();
    return loadPaymentSettings(ownerId);
  }
  if (!aiCredentialStorageReady()) throw new Error("Secure key storage isn't set up on the server (AGENCY_CREDENTIALS_ENCRYPTION_KEY).");
  const key = String(input.key || "").trim();
  const mode: Mode = input.mode === "sandbox" ? "sandbox" : "live";
  if (!/^sk_[A-Za-z0-9_\-]{10,}$/.test(key)) throw new Error("That doesn't look like a Revolut Merchant API secret key (it starts with sk_).");
  // Check the key, then replace any old webhook pointing at this OS with a fresh one.
  const hooks = await revolut(key, mode, "/api/1.0/webhooks", { legacy: true });
  const url = `${origin}/api/marketing-public/revolut`;
  for (const h of Array.isArray(hooks) ? hooks : []) if (h?.url === url && h?.id) await revolut(key, mode, `/api/1.0/webhooks/${encodeURIComponent(h.id)}`, { method: "DELETE", legacy: true }).catch(() => null);
  const hook = await revolut(key, mode, "/api/1.0/webhooks", { method: "POST", legacy: true, body: { url, events: ["ORDER_COMPLETED", "ORDER_AUTHORISED"] } });
  const secret = String(hook?.signing_secret || "");
  const k = await encryptAiCredential(key), s = secret ? await encryptAiCredential(secret) : { iv: "", ciphertext: "" };
  await db().prepare(`INSERT INTO inv_pay_settings (owner_id, revolut_key, revolut_key_iv, revolut_mode, revolut_webhook_id, revolut_webhook_secret, revolut_webhook_secret_iv, last_error, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,'',?8)
    ON CONFLICT(owner_id) DO UPDATE SET revolut_key=excluded.revolut_key, revolut_key_iv=excluded.revolut_key_iv, revolut_mode=excluded.revolut_mode, revolut_webhook_id=excluded.revolut_webhook_id, revolut_webhook_secret=excluded.revolut_webhook_secret, revolut_webhook_secret_iv=excluded.revolut_webhook_secret_iv, last_error='', updated_at=excluded.updated_at`)
    .bind(ownerId, k.ciphertext, k.iv, mode, String(hook?.id || ""), s.ciphertext, s.iv, now).run();
  // Old links were made with the previous key/mode: drop them so new ones are created.
  await db().prepare("DELETE FROM inv_pay_links WHERE owner_id=?1 AND provider='revolut'").bind(ownerId).run();
  return loadPaymentSettings(ownerId);
}

const minor = (total: number) => Math.round((Number(total) || 0) * 100);
export const payable = (inv: any) => inv && (inv.status === "sent" || inv.status === "draft") && minor(inv.total) >= 50;
export const publicLink = (origin: string, inv: any) => `${origin}/api/marketing-public/invoice?token=${inv.public_token}`;

/** Returns a checkout URL for the invoice. Reuses the existing link while the amount is unchanged. */
export async function invoicePaymentUrl(inv: any, origin: string, provider?: "revolut" | "stripe") {
  if (!payable(inv)) throw new Error(inv?.status === "paid" ? "This invoice is already paid." : "This invoice can't be paid online.");
  const settings = await loadPaymentSettings(inv.owner_id);
  const use = provider || (settings.preferred === "none" ? null : settings.preferred);
  if (!use || (use === "revolut" && !settings.revolut.connected) || (use === "stripe" && !settings.stripe.ready)) throw new Error("Online payment isn't set up yet. Please pay by bank transfer using the details on the invoice.");
  const amount = minor(inv.total), currency = String(inv.currency || "EUR").toUpperCase();
  const existing = await db().prepare("SELECT * FROM inv_pay_links WHERE invoice_id=?1 AND provider=?2").bind(inv.id, use).first<any>();
  const fresh = existing && existing.amount_minor === amount && existing.currency === currency && (use === "revolut" || Date.now() - Date.parse(existing.created_at) < 20 * 3_600_000);
  if (fresh) return existing.url as string;
  const back = publicLink(origin, inv);
  let orderId = "", url = "";
  if (use === "revolut") {
    const { key, mode } = await revolutKey(inv.owner_id);
    const order = await revolut(key, mode, "/api/orders", { method: "POST", body: {
      amount, currency, description: `Invoice ${inv.number}`.slice(0, 1024), redirect_url: `${back}&paid=1`,
      merchant_order_data: { reference: String(inv.number).slice(0, 100) },
      ...(inv.client_email && String(inv.client_email).includes("@") ? { customer: { email: String(inv.client_email) } } : {}),
      metadata: { os_invoice_id: inv.id },
    } });
    orderId = String(order?.id || ""); url = String(order?.checkout_url || "");
  } else {
    const { createInvoiceCheckout } = await import("@/lib/onboarding/server");
    const c = await createInvoiceCheckout(inv, back);
    orderId = c.id; url = c.url;
  }
  if (!url || !orderId) throw new Error("The payment page couldn't be created. Please try again or pay by bank transfer.");
  await db().prepare(`INSERT INTO inv_pay_links (invoice_id, provider, owner_id, order_id, url, amount_minor, currency, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
    ON CONFLICT(invoice_id, provider) DO UPDATE SET order_id=excluded.order_id, url=excluded.url, amount_minor=excluded.amount_minor, currency=excluded.currency, created_at=excluded.created_at`).bind(inv.id, use, inv.owner_id, orderId, url, amount, currency, new Date().toISOString()).run();
  return url;
}

/** Marks an invoice paid after an online payment (once; never touches void or already-paid invoices). */
export async function markInvoicePaidOnline(invoiceId: string, ownerId: string, amountMinor: number, how: string) {
  const inv = await db().prepare("SELECT * FROM inv_invoices WHERE id=?1 AND owner_id=?2").bind(invoiceId, ownerId).first<any>();
  if (!inv || inv.status === "paid" || inv.status === "void") return false;
  if (amountMinor < minor(inv.total)) { console.error("invoice-pay: amount lower than invoice total", invoiceId, amountMinor); return false; }
  const today = new Date().toISOString().slice(0, 10);
  const note = `${inv.notes ? inv.notes + "\n" : ""}Paid online (${how}) on ${today}.`.slice(0, 1000);
  const r = await db().prepare("UPDATE inv_invoices SET status='paid', paid_at=?2, notes=?3, sent_at=CASE WHEN sent_at='' THEN ?4 ELSE sent_at END WHERE id=?1 AND status<>'paid' AND status<>'void'").bind(inv.id, today, note, new Date().toISOString()).run();
  if (!r.meta.changes) return false;
  await settleCreditInvoice(db() as never, inv.id, true);
  return true;
}

function hex(buf: ArrayBuffer) { return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
function safeEqual(a: string, b: string) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

/** Revolut webhook: verify the signature, re-check the order with Revolut, then mark the invoice paid. */
export async function handleRevolutWebhook(raw: string, headers: Headers) {
  await ensurePaymentTables();
  let event: any; try { event = JSON.parse(raw); } catch { return { status: 400, body: "Bad payload" }; }
  const orderId = String(event?.order_id || "");
  if (!orderId) return { status: 200, body: "ignored" };
  const link = await db().prepare("SELECT * FROM inv_pay_links WHERE provider='revolut' AND order_id=?1").bind(orderId).first<any>();
  if (!link) return { status: 200, body: "unknown order" };
  const { key, mode, row } = await revolutKey(link.owner_id);
  const secret = await decrypt(row?.revolut_webhook_secret_iv || "", row?.revolut_webhook_secret || "");
  const ts = headers.get("revolut-request-timestamp") || "", sigs = (headers.get("revolut-signature") || "").split(",").map((s) => s.trim());
  if (!secret || !ts || Math.abs(Date.now() - Number(ts)) > 5 * 60_000) return { status: 400, body: "Invalid signature" };
  const mac = await crypto.subtle.sign("HMAC", await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), new TextEncoder().encode(`v1.${ts}.${raw}`));
  const expected = `v1=${hex(mac)}`;
  if (!sigs.some((s) => safeEqual(s, expected))) return { status: 400, body: "Invalid signature" };
  if (event.event !== "ORDER_COMPLETED" && event.event !== "ORDER_AUTHORISED") return { status: 200, body: "ok" };
  // Never trust the webhook body alone: fetch the order from Revolut.
  const order = await revolut(key, mode, `/api/orders/${encodeURIComponent(orderId)}`);
  if (order?.state !== "completed") return { status: 200, body: "not completed yet" };
  const paid = Number(order?.amount || 0) - Number(order?.refunded_amount || 0);
  const method = String(order?.payments?.[0]?.payment_method?.type || "").replace(/_/g, " ").toLowerCase();
  await markInvoicePaidOnline(link.invoice_id, link.owner_id, paid, `Revolut${method ? ` · ${method}` : ""}`);
  return { status: 200, body: "ok" };
}
