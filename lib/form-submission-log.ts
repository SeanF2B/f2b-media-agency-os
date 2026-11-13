// One indexed log of every website/OS form submission, so submissions can be tracked
// per form, per page and per client with cheap range queries (no full-table scans).
// Writers must never let logging break a lead: every write here swallows its own errors.

export type FormSubmissionLogEntry = {
  id: string;
  ownerId: string;
  clientId?: string | null;
  source: "os-form" | "site-form" | "site-lead";
  formKey: string;
  formName: string;
  pageUrl?: string;
  name?: string;
  email?: string;
  phone?: string;
  message?: string;
  contactId?: string;
  createdAt: string;
};

export const FORM_SUBMISSION_LOG_SQL = [
  "CREATE TABLE IF NOT EXISTS form_submission_log (id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, client_id TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, form_key TEXT NOT NULL, form_name TEXT NOT NULL, page_url TEXT NOT NULL DEFAULT '', page_path TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT '', contact_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS form_submission_log_owner_created_idx ON form_submission_log(owner_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS form_submission_log_client_created_idx ON form_submission_log(owner_id, client_id, created_at DESC)",
];

let ensured: Promise<void> | null = null;
export function ensureFormSubmissionLog(db: D1Database) {
  if (!ensured) ensured = db.batch(FORM_SUBMISSION_LOG_SQL.map((sql) => db.prepare(sql))).then(() => undefined).catch((error) => { ensured = null; throw error; });
  return ensured;
}

/** "https://www.site.ie/kitchens/?utm=x#a" → "site.ie/kitchens" (grouping key for "per page"). */
export function pagePathFromUrl(raw: string) {
  const value = String(raw || "").trim();
  if (!value) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.hostname.toLowerCase().replace(/^www\./, "")}${path === "/" ? "" : path}`.slice(0, 300);
  } catch { return value.split(/[?#]/)[0].slice(0, 300); }
}

export async function logFormSubmission(db: D1Database | undefined, entry: FormSubmissionLogEntry) {
  if (!db) return;
  try {
    await ensureFormSubmissionLog(db);
    const cut = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);
    await db.prepare("INSERT OR IGNORE INTO form_submission_log (id, owner_id, client_id, source, form_key, form_name, page_url, page_path, name, email, phone, message, contact_id, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)")
      .bind(entry.id, entry.ownerId, entry.clientId || "", entry.source, cut(entry.formKey, 160), cut(entry.formName, 200), cut(entry.pageUrl, 500), pagePathFromUrl(entry.pageUrl || ""), cut(entry.name, 160), cut(entry.email, 200).toLowerCase(), cut(entry.phone, 60), cut(entry.message, 1000), cut(entry.contactId, 80), entry.createdAt)
      .run();
  } catch (error) {
    console.error("Form submission log write failed", error instanceof Error ? error.message : "unknown error");
  }
}

type LooseField = { id?: string; label?: string; type?: string };
/** Picks name / email / phone / message out of an OS form's answers for the submissions table. */
export function summarizeFormAnswers(fields: LooseField[], values: Record<string, unknown>) {
  const answers = fields.map((field, index) => {
    const id = String(field.id || `field-${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
    const raw = values[id];
    return { label: String(field.label || "").toLowerCase(), type: String(field.type || ""), value: Array.isArray(raw) ? raw.join(", ") : typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : "" };
  }).filter((item) => item.value);
  const find = (test: (item: (typeof answers)[number]) => boolean) => answers.find(test)?.value || "";
  const email = find((item) => item.type === "email" || /@.+\./.test(item.value));
  const phone = find((item) => item.type === "tel" || /phone|mobile|tel\b/.test(item.label));
  const first = find((item) => /first.?name/.test(item.label));
  const last = find((item) => /(last|sur).?name/.test(item.label));
  const name = [first, last].filter(Boolean).join(" ") || find((item) => /name/.test(item.label) && item.type !== "email");
  const message = find((item) => item.type === "textarea") || find((item) => /message|details|notes|enquiry|inquiry|comment/.test(item.label));
  return { name, email, phone, message };
}
