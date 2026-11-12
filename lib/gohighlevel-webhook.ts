const GHL_WEBHOOK_ED25519_PUBLIC_KEY = "MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=";

export const GHL_AUTOMATION_CONTACT_FIELDS = [
  ["id", "Contact ID"], ["name", "Full name"], ["firstName", "First name"], ["lastName", "Last name"],
  ["email", "Email"], ["phone", "Phone"], ["companyName", "Company name"], ["address1", "Street address"],
  ["city", "City"], ["state", "County / region"], ["postalCode", "Eircode / postal code"], ["country", "Country"],
  ["website", "Website"], ["dateOfBirth", "Date of birth"], ["tags", "Tags"],
  ["appointmentId", "Appointment ID"], ["appointmentTitle", "Appointment title"],
  ["appointmentStatus", "Appointment status"], ["appointmentStartTime", "Appointment start time"],
  ["appointmentEndTime", "Appointment end time"], ["appointmentCalendarId", "Appointment calendar ID"],
  ["opportunityId", "Opportunity ID"], ["opportunityName", "Opportunity name"],
  ["opportunityStatus", "Opportunity status"], ["pipelineId", "Pipeline ID"],
  ["pipelineStageId", "Pipeline stage ID"], ["opportunityValue", "Opportunity value", "number"],
  ["opportunityAssignedTo", "Opportunity assigned user ID"],
  ["messageId", "Inbound message ID"], ["conversationId", "Conversation ID"],
  ["messageType", "Inbound message channel"], ["messageStatus", "Inbound message status"],
  ["messageDirection", "Inbound message direction"],
].map(([id, label, type]) => ({ id, label, type: type || "text", required: false }));

export type GhlAutomationWebhook = {
  type: "ContactCreate" | "ContactUpdate" | "ContactTagUpdate" | "ContactDelete" | "ContactDndUpdate" | "AppointmentCreate" | "OpportunityStatusUpdate" | "OpportunityStageUpdate" | "InboundMessage" | "OutboundMessage";
  locationId: string;
  contactId: string;
  webhookId: string;
  values: Record<string, string | string[]>;
};
export type GhlContactWebhook = GhlAutomationWebhook;

function decodeBase64(value: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length > 2048) return null;
  try {
    const binary = atob(value);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch { return null; }
}

export async function verifyGhlWebhookSignature(rawBody: string, signature: string, publicKey = GHL_WEBHOOK_ED25519_PUBLIC_KEY) {
  const signatureBytes = decodeBase64(signature);
  const keyBytes = decodeBase64(publicKey);
  if (!signatureBytes || signatureBytes.length !== 64 || !keyBytes) return false;
  try {
    const key = await crypto.subtle.importKey("spki", keyBytes, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, signatureBytes, new TextEncoder().encode(rawBody));
  } catch { return false; }
}

function boundedString(value: unknown, limit = 500) {
  return typeof value === "string" || typeof value === "number" ? String(value).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, limit) : "";
}

export function parseGhlContactWebhook(value: unknown): GhlAutomationWebhook | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  if (!["ContactCreate", "ContactUpdate", "ContactTagUpdate", "ContactDelete", "ContactDndUpdate", "AppointmentCreate", "OpportunityStatusUpdate", "OpportunityStageUpdate", "InboundMessage", "OutboundMessage"].includes(String(payload.type))) return null;
  const locationId = boundedString(payload.locationId, 120);
  const appointment = payload.appointment && typeof payload.appointment === "object" && !Array.isArray(payload.appointment) ? payload.appointment as Record<string, unknown> : null;
  const isOpportunity = String(payload.type).startsWith("Opportunity");
  const isInboundMessage = payload.type === "InboundMessage";
  const isOutboundMessage = payload.type === "OutboundMessage";
  const isMessage = isInboundMessage || isOutboundMessage;
  if (isInboundMessage && String(payload.direction || "").toLowerCase() !== "inbound") return null;
  if (isOutboundMessage && String(payload.direction || "").toLowerCase() !== "outbound") return null;
  const contactId = boundedString(isOpportunity || isMessage ? payload.contactId : payload.id || payload.contactId || appointment?.contactId, 120);
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(locationId) || !/^[A-Za-z0-9_-]{8,120}$/.test(contactId)) return null;
  if (isOutboundMessage && !/^[A-Za-z0-9_-]{8,160}$/.test(boundedString(payload.messageId, 160))) return null;
  const values: GhlAutomationWebhook["values"] = { id: contactId };
  if (isOpportunity) {
    const fields: Array<[string, string]> = [["id", "opportunityId"], ["name", "opportunityName"], ["status", "opportunityStatus"], ["pipelineId", "pipelineId"], ["pipelineStageId", "pipelineStageId"], ["monetaryValue", "opportunityValue"], ["assignedTo", "opportunityAssignedTo"]];
    for (const [source, target] of fields) { const item = boundedString(payload[source], 160); if (item) values[target] = item; }
  } else if (payload.type === "ContactDndUpdate") {
    if (typeof payload.dnd === "boolean") values.globalDnd = String(payload.dnd);
    const channelKeys = [["Email", "emailDnd"], ["SMS", "smsDnd"], ["WhatsApp", "whatsappDnd"]] as const;
    for (const [sourceKey, targetKey] of channelKeys) {
      const setting = payload.dndSettings && typeof payload.dndSettings === "object" && !Array.isArray(payload.dndSettings)
        ? (payload.dndSettings as Record<string, unknown>)[sourceKey] : undefined;
      const status = setting && typeof setting === "object" && !Array.isArray(setting) ? boundedString((setting as Record<string, unknown>).status, 40).toLowerCase() : "";
      if (status) values[targetKey] = status;
    }
    const inbound = payload.inboundDndSettings && typeof payload.inboundDndSettings === "object" && !Array.isArray(payload.inboundDndSettings)
      ? payload.inboundDndSettings as Record<string, unknown> : {};
    const allStatus = inbound.all && typeof inbound.all === "object" && !Array.isArray(inbound.all) ? boundedString((inbound.all as Record<string, unknown>).status, 40).toLowerCase() : "";
    if (allStatus) values.inboundAllDnd = allStatus;
    for (const [sourceKey, targetKey] of channelKeys) {
      const setting = inbound[sourceKey];
      const status = setting && typeof setting === "object" && !Array.isArray(setting) ? boundedString((setting as Record<string, unknown>).status, 40).toLowerCase() : "";
      if (status) values[`inbound_${targetKey}`] = status;
    }
  } else if (isMessage) {
    for (const [source, target] of [["messageId", "messageId"], ["conversationId", "conversationId"], ["messageType", "messageType"], ["status", "messageStatus"], ["direction", "messageDirection"]] as const) {
      const item = boundedString(payload[source], 120);
      if (item) values[target] = item;
    }
  } else {
    for (const key of ["name", "firstName", "lastName", "email", "phone", "companyName", "address1", "city", "state", "postalCode", "country", "website"] as const) {
      const item = boundedString(payload[key]);
      if (item) values[key] = item;
    }
    if (Object.hasOwn(payload, "dateOfBirth")) values.dateOfBirth = boundedString(payload.dateOfBirth, 100);
    if (Array.isArray(payload.customFields)) {
      for (const field of payload.customFields.slice(0, 100)) {
        if (!field || typeof field !== "object" || Array.isArray(field)) continue;
        const record = field as Record<string, unknown>;
        const id = boundedString(record.id, 120);
        if (!/^[A-Za-z0-9_-]{8,120}$/.test(id) || !Object.hasOwn(record, "value")) continue;
        const raw = record.value;
        const value = typeof raw === "string" || typeof raw === "number" ? boundedString(raw, 500) : "";
        values[`customField_${id}`] = value;
      }
    }
  }
  if (Array.isArray(payload.tags)) values.tags = [...new Set(payload.tags.slice(0, 50).map((tag) => boundedString(tag, 100)).filter(Boolean))];
  if (appointment) {
    const fields: Array<[string, string]> = [["id", "appointmentId"], ["title", "appointmentTitle"], ["appointmentStatus", "appointmentStatus"], ["startTime", "appointmentStartTime"], ["endTime", "appointmentEndTime"], ["calendarId", "appointmentCalendarId"]];
    for (const [source, target] of fields) { const item = boundedString(appointment[source]); if (item) values[target] = item; }
  }
  const webhookId = boundedString(payload.webhookId || payload.idempotencyKey, 160);
  return { type: payload.type as GhlAutomationWebhook["type"], locationId, contactId, webhookId, values };
}

