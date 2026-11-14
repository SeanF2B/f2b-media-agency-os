// Client website forms managed from Operations → Forms.
// One row per form (client + form key). `definition` holds steps, questions and logic; `settings` holds
// who is notified, where the lead lands, the thank-you page and which pages show the form.
// Forms that only exist in the submission log (not yet registered) are listed too, so nothing is hidden.

export type FormOption = { label: string; value: string; hint?: string };
export type FormField = { id: string; label: string; type: "choice" | "text" | "email" | "tel" | "textarea" | "photos" | "select"; required?: boolean; options?: FormOption[]; step: string; showWhen?: { field: string; equals: string[] } };
export type FormRule = { id: string; when: { field: string; equals: string }; then: Array<{ action: "tag" | "urgent" | "stage" | "notify"; value: string }> };
export type FormDefinition = { steps: Array<{ id: string; title: string }>; fields: FormField[]; rules: FormRule[] };
export type FormSettings = { status: "live" | "paused"; notify: string[]; stageId?: string; thankYouUrl?: string; pages: { mode: "all" | "include" | "exclude"; paths: string[] } };
export type SiteForm = { id: string; clientId: string; formKey: string; name: string; site: string; definition: FormDefinition; settings: FormSettings; updatedAt: string; updatedBy: string };

export const SITE_FORMS_SQL = [
  "CREATE TABLE IF NOT EXISTS site_forms (id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, client_id TEXT NOT NULL, form_key TEXT NOT NULL, name TEXT NOT NULL, site TEXT NOT NULL DEFAULT '', definition TEXT NOT NULL DEFAULT '{}', settings TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT '')",
  "CREATE UNIQUE INDEX IF NOT EXISTS site_forms_key_idx ON site_forms(owner_id, form_key)",
  "CREATE TABLE IF NOT EXISTS site_form_history (id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, form_id TEXT NOT NULL, summary TEXT NOT NULL, snapshot TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT '')",
  "CREATE INDEX IF NOT EXISTS site_form_history_idx ON site_form_history(owner_id, form_id, created_at DESC)",
];

const PRO_ROOFERS = "a93e6dbd-0d34-46ec-ba5a-6be474d15882";
const opt = (label: string, value = label, hint?: string): FormOption => ({ label, value, ...(hint ? { hint } : {}) });
const jobs: Array<[string, string, string, Array<[string, string, string[]]>]> = [
  ["leak", "Roof leak", "Water coming in", [["leaking", "Is it leaking now?", ["Yes, leaking now", "Only in heavy rain", "Not at the moment"]]]],
  ["roof-repair", "Roof repair", "Slates, tiles, flashing, chimney", [["problem", "What’s the problem?", ["Slipped or missing slates/tiles", "Flashing or chimney", "Storm damage", "Not sure"]]]],
  ["flat-roof", "Flat roof", "Repair or replace", [["size", "Roughly how big?", ["Small (porch / garage)", "Medium (extension)", "Large"]], ["covering", "What’s it covered with?", ["Felt", "EPDM rubber", "Fibreglass (GRP)", "Not sure"]]]],
  ["new-roof", "New roof / replacement", "Full re-roof", [["project", "What’s the project?", ["Replace an existing roof", "New build", "Extension / dormer", "Commercial building"]]]],
  ["gutters", "Gutters", "Repair, replace or new", [["need", "What do you need?", ["Repair", "Replace", "New gutters"]]]],
  ["fascia-soffit", "Fascia & soffit", "uPVC roofline", [["need-fs", "What needs doing?", ["Repair a section", "Replace fascia & soffit", "Fascia, soffit & gutters"]]]],
  ["cleaning", "Roof cleaning", "Moss & algae", [["roof", "What’s the roof covered with?", ["Concrete tiles", "Slates", "Not sure"]]]],
  ["verge-ridge", "Dry verge / ridge", "Roof edges & ridge tiles", [["part", "Which part?", ["Verge (gable edges)", "Ridge tiles", "Both", "Not sure"]]]],
  ["other", "Something else", "Tell us more", []],
];

/** Forms we built ourselves, registered with their real structure the first time Forms is opened. */
export function builtInForms(): Array<Omit<SiteForm, "id" | "updatedAt" | "updatedBy">> {
  const quoteFields: FormField[] = [
    { id: "jobType", label: "What do you need?", type: "choice", required: true, step: "job", options: jobs.map(([value, label, hint]) => opt(label, value, hint)) },
    ...jobs.flatMap(([value, , , questions]) => questions.map(([id, label, options]): FormField => ({ id, label, type: "choice", step: "job", options: options.map((item) => opt(item)), showWhen: { field: "jobType", equals: [value] } }))),
    { id: "urgency", label: "How soon?", type: "choice", step: "job", options: [opt("Leaking now", "emergency"), opt("Urgent", "urgent"), opt("In the next few weeks", "soon"), opt("Planning / getting quotes", "planning")] },
    { id: "name", label: "Your name", type: "text", required: true, step: "contact" },
    { id: "phone", label: "Phone", type: "tel", required: true, step: "contact" },
    { id: "email", label: "Email", type: "email", step: "contact" },
    { id: "town", label: "Town / area", type: "text", step: "contact" },
    { id: "propertyType", label: "Property type", type: "select", step: "contact", options: [opt("Detached house", "detached"), opt("Semi-detached / terraced", "semi-terraced"), opt("Bungalow", "bungalow"), opt("Apartment / multi-unit", "apartment"), opt("Commercial / agricultural", "commercial")] },
    { id: "details", label: "Anything else?", type: "textarea", step: "contact" },
    { id: "photos", label: "Photos (up to 4)", type: "photos", step: "contact" },
  ];
  const base: FormSettings = { status: "live", notify: ["proroofersgalway@gmail.com"], thankYouUrl: "", pages: { mode: "all", paths: [] } };
  return [
    { clientId: PRO_ROOFERS, formKey: `site:${PRO_ROOFERS}:quote`, name: "Free quote form", site: "proroofersgalway.ie", settings: base,
      definition: { steps: [{ id: "job", title: "What needs doing?" }, { id: "contact", title: "Where should we call you back?" }], fields: quoteFields,
        rules: [
          { id: "r-emergency", when: { field: "urgency", equals: "emergency" }, then: [{ action: "tag", value: "Emergency" }, { action: "urgent", value: "" }] },
          { id: "r-leaking", when: { field: "leaking", equals: "Yes, leaking now" }, then: [{ action: "tag", value: "Emergency" }, { action: "urgent", value: "" }] },
        ] } },
    { clientId: PRO_ROOFERS, formKey: `site:${PRO_ROOFERS}:contact`, name: "Contact form", site: "proroofersgalway.ie", settings: { ...base, pages: { mode: "include", paths: ["/contact/"] } },
      definition: { steps: [{ id: "main", title: "Contact" }], fields: [
        { id: "name", label: "Name", type: "text", required: true, step: "main" }, { id: "phone", label: "Phone", type: "tel", required: true, step: "main" },
        { id: "email", label: "Email", type: "email", step: "main" }, { id: "message", label: "Message", type: "textarea", required: true, step: "main" }], rules: [] } },
  ];
}

export const emptyDefinition = (): FormDefinition => ({ steps: [{ id: "main", title: "Form" }], fields: [], rules: [] });
export const defaultSettings = (): FormSettings => ({ status: "live", notify: [], thankYouUrl: "", pages: { mode: "all", paths: [] } });

export function parseJson<T>(raw: string | null | undefined, fallback: T): T { try { const value = JSON.parse(raw || ""); return value && typeof value === "object" ? value as T : fallback; } catch { return fallback; } }

/** Settings for a form key, used by the live lead relay (one indexed read). */
export async function formSettingsFor(db: D1Database, ownerId: string, formKey: string): Promise<FormSettings | null> {
  try {
    const row = await db.prepare("SELECT settings FROM site_forms WHERE owner_id=?1 AND form_key=?2").bind(ownerId, formKey).first<{ settings: string }>();
    return row ? parseJson<FormSettings>(row.settings, defaultSettings()) : null;
  } catch { return null; }
}
