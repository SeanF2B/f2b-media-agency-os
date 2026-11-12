const CHANNELS = Object.freeze({
  customerEmail: "Email",
  customerSms: "SMS",
  customerWhatsapp: "WhatsApp",
});

const FORBIDDEN_TEMPLATE_TYPES = new Set(["consent", "file", "hidden", "heading", "description", "divider", "progress"]);

export function marketingMessageChannel(nodeType) {
  return CHANNELS[nodeType] || "";
}

export function parseMarketingCustomerMessage(config, nodeType) {
  const channel = marketingMessageChannel(nodeType);
  if (!channel) return null;
  try {
    const value = JSON.parse(config);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const consentFieldId = String(value.consentFieldId || "").trim();
    const message = typeof value.message === "string" ? value.message.trim() : "";
    const subject = typeof value.subject === "string" ? value.subject.trim() : "";
    if (!/^[\w-]{1,64}$/.test(consentFieldId) || !message || message.length > 5000) return null;
    if (channel === "Email" && (!subject || subject.length > 200 || /[\r\n]/.test(subject))) return null;
    return { channel, consentFieldId, message, ...(channel === "Email" ? { subject } : {}) };
  } catch {
    return null;
  }
}

export function marketingMessageTemplateFieldIds(template) {
  return [...String(template || "").matchAll(/\{\{\s*([\w-]{1,64})\s*\}\}/g)].map((match) => match[1]);
}

export function validateMarketingCustomerMessage(config, nodeType, fields = []) {
  const parsed = parseMarketingCustomerMessage(config, nodeType);
  if (!parsed) return "Customer message needs a consent field and message; email also needs a subject.";
  const byId = new Map((Array.isArray(fields) ? fields : []).map((field) => [String(field.id || ""), field]));
  const consent = byId.get(parsed.consentFieldId);
  if (!consent || consent.type !== "consent" || consent.required !== true) return "Choose a required consent checkbox from the selected published form.";
  const used = [...marketingMessageTemplateFieldIds(parsed.message), ...marketingMessageTemplateFieldIds(parsed.subject || "")];
  for (const fieldId of used) {
    const field = byId.get(fieldId);
    if (!field || FORBIDDEN_TEMPLATE_TYPES.has(String(field.type || ""))) return `Message template uses “{{${fieldId}}}”, which is not an available answer on the published form.`;
  }
  return null;
}

export function marketingConsentGranted(consentFieldId, fields, values) {
  const field = (Array.isArray(fields) ? fields : []).find((item) => String(item.id || "") === consentFieldId);
  if (!field || field.type !== "consent" || field.required !== true) return false;
  const value = values?.[consentFieldId];
  return value === true || value === 1 || ["yes", "true", "1", "on", "accepted", "agree", "agreed"].includes(String(value ?? "").trim().toLowerCase());
}

export function renderMarketingMessageTemplate(template, values = {}) {
  return String(template || "").replace(/\{\{\s*([\w-]{1,64})\s*\}\}/g, (_match, key) => {
    const value = values[key];
    return (Array.isArray(value) ? value.join(", ") : String(value ?? "")).slice(0, 1000);
  }).slice(0, 10_000);
}

export function isGhlContactSuppressed(contact, channel) {
  if (!contact || typeof contact !== "object") return true;
  if (contact.dnd === true) return true;
  const channelKey = channel === "Email" ? "email" : channel === "SMS" ? "sms" : "whatsapp";
  const active = (value) => value && typeof value === "object" && String(value.status || "").toLowerCase() === "active";
  const channelSettings = contact.dndSettings && typeof contact.dndSettings === "object" ? contact.dndSettings : {};
  const dnd = Object.entries(channelSettings).find(([key]) => key.toLowerCase() === channelKey)?.[1];
  if (active(dnd)) return true;
  const inbound = contact.inboundDndSettings && typeof contact.inboundDndSettings === "object" ? contact.inboundDndSettings : {};
  if (active(inbound.all)) return true;
  const channelInbound = Object.entries(inbound).find(([key]) => key.toLowerCase() === channelKey)?.[1];
  return Boolean(active(channelInbound));
}

export function parseGhlMarketingMessageStatus(payload, expected) {
  const message = payload?.message && typeof payload.message === "object" ? payload.message : payload;
  if (!message || typeof message !== "object") return null;
  const messageId = String(message.id || message.messageId || message._id || "");
  const contactId = String(message.contactId || message.contact_id || "");
  const locationId = String(message.locationId || message.location_id || "");
  const status = String(message.status || "").trim().toLowerCase();
  const allowed = new Set(["connected", "delivered", "failed", "opened", "pending", "read", "scheduled", "sent", "undelivered", "clicked", "opt_out"]);
  if (messageId !== expected?.messageId || contactId !== expected?.contactId || locationId !== expected?.locationId || !allowed.has(status)) return null;
  return { messageId, status };
}

/** @returns {Promise<{status: "sent", channel: string, providerMessageId: string} | {status: "blocked", detail: string}>} */
export async function deliverGhlMarketingMessage({ request, ownerId, clientId, contactId, nodeType, subject, message }) {
  const channel = marketingMessageChannel(nodeType);
  if (!channel || !contactId || !clientId || typeof request !== "function") return { status: "blocked", detail: "A linked client, synced contact and supported channel are required." };
  let contactResult;
  try {
    contactResult = await request(ownerId, clientId, `/contacts/${encodeURIComponent(contactId)}`, "GET", undefined, "2021-07-28");
  } catch (error) {
    return { status: "blocked", detail: error instanceof Error ? error.message.slice(0, 300) : "Could not check contact delivery preferences." };
  }
  const payload = contactResult?.payload;
  const contact = payload?.contact && typeof payload.contact === "object" ? payload.contact : payload;
  if (String(contact?.id || contact?._id || "") !== contactId) return { status: "blocked", detail: "Could not verify the synced GoHighLevel contact before sending." };
  if (isGhlContactSuppressed(contact, channel)) return { status: "blocked", detail: `GoHighLevel marks this contact as do-not-contact for ${channel}.` };

  const body = { type: channel, contactId, message: String(message || "").slice(0, 5000), status: "pending" };
  if (channel === "Email") body.subject = String(subject || "").replace(/[\r\n]/g, " ").slice(0, 200);
  // Once this POST begins, failures can have an ambiguous delivery outcome. The
  // caller must record that state and must never retry automatically.
  const sent = await request(ownerId, clientId, "/conversations/messages", "POST", body, "2021-04-15");
  const response = sent?.payload && typeof sent.payload === "object" ? sent.payload : {};
  const messageId = String(response.messageId || "").slice(0, 160);
  if (!messageId) throw new Error("GoHighLevel accepted no verifiable message ID; delivery outcome is uncertain.");
  return { status: "sent", channel, providerMessageId: messageId };
}
