const CONTACT_FIELDS = new Set(["name", "firstName", "lastName", "email", "phone", "companyName", "address1", "city", "state", "postalCode"]);

export function parseMarketingContactUpdate(config, sourceFields = []) {
  let parsed;
  try { parsed = JSON.parse(String(config || "")); } catch { return { error: "Map at least one submitted answer to a GoHighLevel contact field." }; }
  const mappings = parsed && typeof parsed === "object" && Array.isArray(parsed.mappings) ? parsed.mappings : [];
  if (!mappings.length || mappings.length > 10) return { error: "Choose between one and ten contact field mappings." };
  const fields = new Map(sourceFields.filter((field) => field && !["consent", "file", "heading", "description", "divider", "progress"].includes(field.type)).map((field) => [String(field.id || ""), field]));
  const seen = new Set();
  for (const mapping of mappings) {
    const fieldId = String(mapping?.fieldId || "").trim();
    const contactField = String(mapping?.contactField || "").trim();
    if (!fields.has(fieldId)) return { error: "Choose a submitted answer from the selected published tool." };
    if (!CONTACT_FIELDS.has(contactField)) return { error: "Choose a supported GoHighLevel contact field." };
    if (seen.has(contactField)) return { error: "Each GoHighLevel contact field can be mapped only once." };
    seen.add(contactField);
  }
  return { mappings: mappings.map(({ fieldId, contactField }) => ({ fieldId: String(fieldId), contactField: String(contactField) })) };
}

export function buildMarketingContactUpdate(config, sourceFields, values) {
  const parsed = parseMarketingContactUpdate(config, sourceFields);
  if (parsed.error) return parsed;
  const fieldsById = new Map(sourceFields.map((field) => [String(field.id || ""), field]));
  const payload = {};
  for (const mapping of parsed.mappings) {
    const field = fieldsById.get(mapping.fieldId);
    const raw = values?.[mapping.fieldId];
    if (!field || ["consent", "file", "heading", "description", "divider", "progress"].includes(field.type) || Array.isArray(raw) || raw === undefined || raw === null) continue;
    const value = String(raw).trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 500);
    if (!value) continue;
    if (mapping.contactField === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { error: "The submitted email answer is not valid." };
    payload[mapping.contactField] = value;
  }
  if (!Object.keys(payload).length) return { error: "No mapped contact values were submitted." };
  return { payload };
}
