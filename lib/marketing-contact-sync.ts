export type MarketingContactField = { id?: string; label?: string; type?: string; contactField?: string };
const contactFields = new Set(["name", "firstName", "lastName", "email", "phone", "companyName", "address1", "city", "state", "postalCode"]);

function clean(value: unknown, limit = 180) {
  if (Array.isArray(value)) return "";
  return String(value ?? "").trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, limit);
}

export function buildMarketingContactPayload(
  fields: MarketingContactField[],
  values: Record<string, unknown>,
  locationId: string,
  source: string,
) {
  const contact: Record<string, string> = { locationId, source: clean(source, 120) };
  const patterns: Array<[keyof typeof contact, RegExp]> = [
    ["email", /^(e-?mail|email address)$/i],
    ["phone", /^(phone|phone number|mobile|mobile number|telephone)$/i],
    ["firstName", /^(first name|given name)$/i],
    ["lastName", /^(last name|surname|family name)$/i],
    ["name", /^(name|full name|your name)$/i],
    ["companyName", /^(company|company name|business|business name)$/i],
    ["address1", /^(address|street address|address line 1)$/i],
    ["city", /^(city|town)$/i],
    ["state", /^(state|county|region)$/i],
    ["postalCode", /^(postal code|postcode|zip code|eircode)$/i],
  ];
  for (const field of fields) {
    if (field.type === "file" || field.type === "consent" || field.type === "calculated") continue;
    const id = clean(field.id, 64);
    const label = clean(field.label, 160);
    const value = clean(values[id], field.type === "textarea" ? 1000 : 500);
    if (!id || !label || !value) continue;
    if (field.contactField === "none") continue;
    const mapping = patterns.find(([, pattern]) => pattern.test(label));
    const requested = field.contactField && contactFields.has(field.contactField) ? field.contactField : "";
    const inferred = requested || mapping?.[0] || (field.type === "email" ? "email" : field.type === "tel" ? "phone" : field.type === "address" ? "address1" : "");
    if (inferred === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) continue;
    if (inferred && !contact[inferred]) contact[inferred] = value;
  }
  if (!contact.email && !contact.phone) return null;
  if (!contact.name && (contact.firstName || contact.lastName)) contact.name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  if (!contact.firstName && contact.name) contact.firstName = contact.name.split(/\s+/)[0];
  if (!contact.lastName && contact.name) contact.lastName = contact.name.split(/\s+/).slice(1).join(" ");
  return contact;
}

export async function upsertMarketingContact(
  accessToken: string,
  payload: Record<string, string>,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher("https://services.leadconnectorhq.com/contacts/upsert", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "Content-Type": "application/json", Version: "v3" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body && typeof body === "object" && "message" in body ? String((body as { message: unknown }).message).slice(0, 300) : `HTTP ${response.status}`;
    throw new Error(`HighLevel contact sync failed: ${detail}`);
  }
  const result = body && typeof body === "object" ? body as { contact?: { id?: unknown }; new?: unknown } : {};
  return { contactId: String(result.contact?.id || "").slice(0, 120), created: result.new === true };
}
