export function parseStaffEmailConfig(config) {
  try {
    const value = JSON.parse(config);
    if (typeof value.recipientStaffId !== "string" || !/^[\w-]{1,120}$/.test(value.recipientStaffId)) return null;
    if (typeof value.subject !== "string" || !value.subject.trim() || value.subject.length > 200 || /[\r\n]/.test(value.subject)) return null;
    if (typeof value.body !== "string" || !value.body.trim() || value.body.length > 5000) return null;
    return { recipientStaffId: value.recipientStaffId, subject: value.subject.trim(), body: value.body.trim() };
  } catch {
    return null;
  }
}

export function emailTemplateFieldIds(template) {
  return [...template.matchAll(/\{\{\s*([\w-]{1,64})\s*\}\}/g)].map((match) => match[1]);
}

export function renderStaffEmailTemplate(template, values, context = {}) {
  return template.replace(/\{\{\s*([\w-]{1,64})\s*\}\}/g, (_match, key) => {
    if (key === "clientName") return String(context.clientName || "").slice(0, 200);
    if (key === "formName") return String(context.formName || "").slice(0, 200);
    const value = values[key];
    return (Array.isArray(value) ? value.join(", ") : String(value ?? "")).slice(0, 1000);
  }).slice(0, 10_000);
}
