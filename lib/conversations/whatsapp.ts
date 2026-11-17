// F2B Agency OS · WhatsApp rules that don't need the database (so they can be unit tested).
// Meta only allows free-form WhatsApp messages for 24 hours after the customer's last message.
// Outside that window the business must send an approved template (Twilio Content API).

export const WINDOW_MS = 24 * 60 * 60 * 1000;

export type WindowState = { open: boolean; msLeft: number; label: string };

/** Is the 24-hour customer service window open, given the customer's last inbound message time? */
export function windowState(lastInAt: string | null | undefined, now = Date.now()): WindowState {
  const t = lastInAt ? Date.parse(lastInAt) : NaN;
  if (!Number.isFinite(t)) return { open: false, msLeft: 0, label: "Window closed" };
  const msLeft = Math.max(0, t + WINDOW_MS - now);
  if (msLeft <= 0) return { open: false, msLeft: 0, label: "Window closed" };
  const h = Math.floor(msLeft / 3_600_000), m = Math.floor((msLeft % 3_600_000) / 60_000);
  return { open: true, msLeft, label: h >= 1 ? `${h}h left` : `${Math.max(1, m)}m left` };
}

/** Delivery states Twilio reports. A later callback never downgrades a better one (read beats delivered), but a failure always shows. */
const RANK: Record<string, number> = { accepted: 1, queued: 1, sending: 2, sent: 3, delivered: 4, read: 5 };
export function nextStatus(current: string, incoming: string): string {
  const inc = String(incoming || "").toLowerCase();
  if (inc === "failed" || inc === "undelivered") return inc;
  if (!(inc in RANK)) return current;
  if (current === "failed" || current === "undelivered") return current;
  return (RANK[inc] || 0) >= (RANK[current] || 0) ? inc : current;
}

export type WaTemplate = { sid: string; name: string; language: string; category: string; body: string; variables: string[]; defaults: Record<string, string> };

/** The {{1}}, {{2}}… placeholders in a template body, in order. */
export function templateVariables(body: string): string[] {
  const seen: string[] = [];
  for (const m of String(body || "").matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) if (!seen.includes(m[1])) seen.push(m[1]);
  return seen;
}

/** Fill a template body for the chat preview / message log. */
export function renderTemplate(body: string, values: Record<string, string>): string {
  return String(body || "").replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, k: string) => (values[k] ?? "").trim() || `{{${k}}}`);
}

/** Pull the approved WhatsApp templates out of Twilio's /v1/ContentAndApprovals response. */
export function parseApprovedTemplates(json: unknown): WaTemplate[] {
  const contents = (json && typeof json === "object" && Array.isArray((json as { contents?: unknown }).contents) ? (json as { contents: unknown[] }).contents : []) as Array<Record<string, any>>;
  const out: WaTemplate[] = [];
  for (const c of contents) {
    const ar = c?.approval_requests?.whatsapp || c?.approval_requests || {};
    if (String(ar.status || "").toLowerCase() !== "approved") continue;
    const types = (c?.types || {}) as Record<string, any>;
    const first = types["twilio/text"] || types["twilio/media"] || types["twilio/quick-reply"] || types["twilio/call-to-action"] || types["twilio/card"] || Object.values(types)[0] || {};
    const body = String(first.body || first.title || "");
    const defaults: Record<string, string> = {};
    if (c?.variables && typeof c.variables === "object") for (const [k, v] of Object.entries(c.variables)) defaults[k] = String(v ?? "");
    const vars = templateVariables(body);
    for (const k of Object.keys(defaults)) if (!vars.includes(k)) vars.push(k);
    if (!/^HX[0-9a-f]{32}$/i.test(String(c?.sid || ""))) continue;
    out.push({ sid: String(c.sid), name: String(ar.name || c.friendly_name || c.sid).slice(0, 120), language: String(c.language || ""), category: String(ar.category || "").toLowerCase(), body, variables: vars, defaults });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
