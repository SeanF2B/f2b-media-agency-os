export const MARKETING_SUBMISSION_TRIGGERS = [
  { id: "form_submitted", label: "Form or funnel submitted", kinds: ["form", "funnel"] },
  { id: "survey_completed", label: "Survey completed", kinds: ["survey"] },
  { id: "calculator_submitted", label: "Calculator submitted", kinds: ["calculator"] },
  { id: "quote_requested", label: "Quote requested", kinds: ["calculator"] },
  { id: "contact_created", label: "Contact created in GoHighLevel", kinds: ["form", "survey", "calculator", "funnel"], external: true },
  { id: "contact_updated", label: "Contact updated in GoHighLevel", kinds: ["form", "survey", "calculator", "funnel"], external: true },
  { id: "contact_status_changed", label: "GoHighLevel contact status changed", kinds: [], external: true },
  { id: "tag_added", label: "Tag added in GoHighLevel", kinds: ["form", "survey", "calculator", "funnel"], external: true },
  { id: "tag_removed", label: "Tag removed in GoHighLevel", kinds: ["form", "survey", "calculator", "funnel"], external: true },
  { id: "appointment_created", label: "Appointment created in GoHighLevel", kinds: ["form", "survey", "calculator", "funnel"], external: true },
  { id: "appointment_approaching", label: "Before a GoHighLevel appointment", kinds: [], external: true },
  { id: "opportunity_status_changed", label: "GoHighLevel opportunity status changed", kinds: [], external: true },
  { id: "opportunity_stage_changed", label: "GoHighLevel opportunity stage changed", kinds: [], external: true },
  { id: "birthday", label: "GoHighLevel contact birthday", kinds: [], external: true },
  { id: "date_field", label: "GoHighLevel contact date field", kinds: [], external: true },
  { id: "customer_replied", label: "Customer replies in GoHighLevel", kinds: [], external: true },
  { id: "specific_date_time", label: "Specific date and time", kinds: [] },
];

export function parseMarketingTrigger(config) {
  if (typeof config !== "string" || !config.trim()) return { event: "form_submitted", assetSlug: "" };
  try {
    const parsed = JSON.parse(config);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { event: String(parsed.event || "form_submitted"), assetSlug: String(parsed.assetSlug || ""), ...(typeof parsed.runAt === "string" && parsed.runAt ? { runAt: parsed.runAt } : {}), ...(typeof parsed.timeZone === "string" && parsed.timeZone ? { timeZone: parsed.timeZone } : {}), ...(typeof parsed.birthdayTime === "string" && parsed.birthdayTime ? { birthdayTime: parsed.birthdayTime } : {}), ...(parsed.leapDayPolicy === "mar1" ? { leapDayPolicy: "mar1" } : parsed.leapDayPolicy === "feb28" ? { leapDayPolicy: "feb28" } : {}), ...(typeof parsed.customFieldId === "string" && parsed.customFieldId ? { customFieldId: parsed.customFieldId.slice(0, 120) } : {}), ...(typeof parsed.customFieldName === "string" && parsed.customFieldName ? { customFieldName: parsed.customFieldName.slice(0, 160) } : {}), ...(parsed.customFieldType === "DATE_TIME" ? { customFieldType: "DATE_TIME" } : parsed.customFieldType === "DATE" ? { customFieldType: "DATE" } : {}), ...(typeof parsed.dateFieldTime === "string" && parsed.dateFieldTime ? { dateFieldTime: parsed.dateFieldTime } : {}), ...(typeof parsed.statusFieldId === "string" && parsed.statusFieldId ? { statusFieldId: parsed.statusFieldId.slice(0, 120) } : {}), ...(typeof parsed.statusFieldName === "string" && parsed.statusFieldName ? { statusFieldName: parsed.statusFieldName.slice(0, 160) } : {}), ...(typeof parsed.tagName === "string" && parsed.tagName ? { tagName: parsed.tagName.trim().slice(0, 100) } : {}), ...(parsed.event === "appointment_approaching" ? { advanceAmount: Number(parsed.advanceAmount) || 1, advanceUnit: ["minutes", "hours", "days"].includes(String(parsed.advanceUnit)) ? String(parsed.advanceUnit) : "days" } : {}) };
    }
  } catch { /* Existing workflows stored only the published asset slug. */ }
  return { event: "form_submitted", assetSlug: config.trim() };
}

export function serializeMarketingTrigger(event, assetSlug, runAt = "", timeZone = "Europe/Dublin", tagName = "", appointmentOffset = undefined, birthdayOptions = undefined, dateFieldOptions = undefined, statusFieldOptions = undefined) {
  return JSON.stringify({ event: String(event || "form_submitted"), assetSlug: String(assetSlug || ""), ...(runAt ? { runAt: String(runAt) } : {}), ...(["specific_date_time", "birthday", "date_field"].includes(event) ? { timeZone: String(timeZone || "Europe/Dublin") } : {}), ...(event === "birthday" ? { birthdayTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(birthdayOptions?.time || "")) ? String(birthdayOptions.time) : "09:00", leapDayPolicy: birthdayOptions?.leapDayPolicy === "mar1" ? "mar1" : "feb28" } : {}), ...(event === "date_field" ? { customFieldId: String(dateFieldOptions?.fieldId || "").slice(0, 120), customFieldName: String(dateFieldOptions?.fieldName || "").slice(0, 160), customFieldType: dateFieldOptions?.fieldType === "DATE_TIME" ? "DATE_TIME" : "DATE", dateFieldTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(dateFieldOptions?.time || "")) ? String(dateFieldOptions.time) : "09:00" } : {}), ...(event === "contact_status_changed" ? { statusFieldId: String(statusFieldOptions?.fieldId || "").slice(0, 120), statusFieldName: String(statusFieldOptions?.fieldName || "").slice(0, 160) } : {}), ...(["tag_added", "tag_removed"].includes(event) && tagName.trim() ? { tagName: tagName.trim().slice(0, 100) } : {}), ...(event === "appointment_approaching" ? { advanceAmount: Number(appointmentOffset?.amount) || 1, advanceUnit: ["minutes", "hours", "days"].includes(String(appointmentOffset?.unit)) ? String(appointmentOffset.unit) : "days" } : {}) });
}

export function isValidMarketingTriggerDateTime(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
}

export function marketingTriggerMatches(config, asset, submission) {
  const trigger = parseMarketingTrigger(config);
  if (trigger.event === "specific_date_time") return false;
  if (!trigger.assetSlug || trigger.assetSlug !== asset.slug) return false;
  const definition = MARKETING_SUBMISSION_TRIGGERS.find((item) => item.id === trigger.event);
  if (!definition || !definition.kinds.includes(asset.kind)) return false;
  const sync = submission.data?.contactSync;
  switch (trigger.event) {
    case "form_submitted": return asset.kind === "form" || asset.kind === "funnel";
    case "survey_completed": return asset.kind === "survey";
    case "calculator_submitted": return asset.kind === "calculator";
    case "quote_requested": return asset.kind === "calculator" && Boolean(submission.data?.quoteSummary);
    case "contact_created": return sync?.status === "synced" && sync.created === true;
    case "contact_updated": return sync?.status === "synced" && sync.created === false;
    default: return false;
  }
}

export function isMarketingGhlContactTrigger(event) {
  return ["contact_created", "contact_updated", "contact_status_changed", "tag_added", "tag_removed", "appointment_created", "appointment_approaching", "opportunity_status_changed", "opportunity_stage_changed", "birthday", "date_field", "customer_replied"].includes(event);
}

export function marketingGhlContactTriggerMatches(config, webhookType) {
  const trigger = parseMarketingTrigger(config);
  return !trigger.assetSlug && ((webhookType === "ContactCreate" && trigger.event === "contact_created")
    || (webhookType === "ContactUpdate" && trigger.event === "contact_updated")
    || (["ContactCreate", "ContactUpdate"].includes(webhookType) && trigger.event === "contact_status_changed" && Boolean(trigger.statusFieldId))
    || (["ContactCreate", "ContactUpdate"].includes(webhookType) && trigger.event === "date_field" && Boolean(trigger.customFieldId))
    || (webhookType === "InboundMessage" && trigger.event === "customer_replied")
    || (webhookType === "ContactTagUpdate" && ["tag_added", "tag_removed"].includes(trigger.event) && Boolean(trigger.tagName))
    || (webhookType === "AppointmentCreate" && ["appointment_created", "appointment_approaching"].includes(trigger.event))
    || (webhookType === "OpportunityStatusUpdate" && trigger.event === "opportunity_status_changed")
    || (webhookType === "OpportunityStageUpdate" && trigger.event === "opportunity_stage_changed"));
}
