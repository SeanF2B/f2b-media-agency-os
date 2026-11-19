// Settings → Audit log → Activity: every change made in the OS by agency staff, sub-account staff and client
// logins, time-stamped. Captured centrally (each saving API request) plus a field-level diff of workspace saves
// (tasks, clients, team, money records) so "what changed" is readable. Secrets are never stored.
type Db = D1Database;

let ready: Promise<unknown> | null = null;
export function ensureActionLog(db: Db) {
  ready ||= db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS action_log (id TEXT PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL DEFAULT '', actor_name TEXT NOT NULL DEFAULT '', actor_type TEXT NOT NULL DEFAULT '', client_id TEXT NOT NULL DEFAULT '', area TEXT NOT NULL DEFAULT '', action TEXT NOT NULL DEFAULT '', target TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '{}', method TEXT NOT NULL DEFAULT '', path TEXT NOT NULL DEFAULT '', status INTEGER NOT NULL DEFAULT 0, is_delete INTEGER NOT NULL DEFAULT 0, ip TEXT NOT NULL DEFAULT '')"),
    db.prepare("CREATE INDEX IF NOT EXISTS action_log_at ON action_log (at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS action_log_actor ON action_log (actor, at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS action_log_client ON action_log (client_id, at)"),
  ]).catch((e) => { ready = null; throw e; });
  return ready;
}

const AREAS: Array<[RegExp, string]> = [
  [/^\/api\/scheduling/, "Calendar & scheduling"], [/^\/api\/crm-automations/, "Automations"], [/^\/api\/crm/, "Leads & CRM"], [/^\/api\/conversations|^\/api\/whatsapp/, "Conversations"],
  [/^\/api\/tasks|^\/api\/task-suggestions/, "Tasks"], [/^\/api\/invoicing/, "Invoicing"], [/^\/api\/bookkeeping|^\/api\/filing/, "Books"], [/^\/api\/client-site|^\/api\/sites/, "Websites"],
  [/^\/api\/site-forms|^\/api\/form-submissions/, "Forms"], [/^\/api\/seo/, "SEO"], [/^\/api\/google-ads/, "Google Ads"], [/^\/api\/meta-ads/, "Meta Ads"], [/^\/api\/settings/, "Settings"],
  [/^\/api\/usage-billing/, "AI billing"], [/^\/api\/staff-access|^\/api\/staff-invite|^\/api\/client-accounts/, "Team & access"], [/^\/api\/outreach/, "Outreach"], [/^\/api\/email-marketing/, "Email marketing"],
  [/^\/api\/proposals/, "Proposals"], [/^\/api\/client-reports/, "Reports"], [/^\/api\/client-files|^\/api\/media-library/, "Files & media"], [/^\/api\/voice-agent|^\/api\/marketing-public\/voice/, "Phone agent"],
  [/^\/api\/integrations|^\/api\/oauth/, "Integrations"], [/^\/api\/onboarding/, "Onboarding"], [/^\/api\/social-posts/, "Social posts"], [/^\/api\/assistant|^\/api\/ai-/, "AI assistant"],
  [/^\/api\/setup-drafts|^\/api\/setup-workflows/, "Setup wizards"], [/^\/api\/clock/, "Clock in"], [/^\/api\/chess/, "Chess"], [/^\/api\/operating-world/, "Operating World"], [/^\/api\/workspace/, "Workspace"],
];
export const areaFor = (path: string) => { for (const [re, a] of AREAS) if (re.test(path)) return a; return path.replace(/^\/api\//, "").split("/")[0] || "Other"; };

// Requests that are reads, heartbeats or very chatty background calls (not "actions").
const SKIP = [/^\/api\/activity-log$/, /^\/api\/dashboard-/, /^\/api\/marketing-public\/(track|pixel|beacon)/, /^\/api\/chess\/(poll|state)/, /^\/api\/operating-world\/(tick|state)/, /^\/api\/assistant\/stream/, /^\/api\/seo-suggest$/];
const SECRET = /pass(word)?|secret|token|api[_-]?key|authorization|card|iban|pps|sort[_-]?code|account[_-]?number|otp|code$/i;
const KEEP = ["action", "op", "kind", "mode", "type", "id", "slug", "taskId", "bookingId", "appointmentId", "contactId", "opportunityId", "threadId", "invoiceId", "formId", "campaignId", "fileId", "staffId", "calendarId", "stage", "status", "start", "end", "startAt", "endAt", "date", "title", "name", "subject", "to", "email", "phone", "service", "month", "amount", "reason"];

/** A short, secret-free summary of a JSON request body. */
export function summariseBody(body: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!body || typeof body !== "object") return out;
  const src = body as Record<string, unknown>;
  const pick = (o: Record<string, unknown>, prefix = "") => {
    for (const k of KEEP) {
      const v = o[k];
      if (v == null || SECRET.test(k) || Object.keys(out).length >= 14) continue;
      if (typeof v === "string") out[prefix + k] = v.slice(0, 160);
      else if (typeof v === "number" || typeof v === "boolean") out[prefix + k] = v;
    }
  };
  pick(src);
  for (const nest of ["booking", "appointment", "task", "contact", "opportunity", "invoice", "page", "form", "client", "data"]) { const v = src[nest]; if (v && typeof v === "object" && !Array.isArray(v)) pick(v as Record<string, unknown>, `${nest}.`); }
  if (Array.isArray(src.ids)) out.ids = (src.ids as unknown[]).slice(0, 20).map(String).join(", ");
  return out;
}

const verb = (method: string, body: Record<string, unknown>) => {
  const a = String(body.action || body.op || "").replace(/[-_]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  if (a) return a.charAt(0).toUpperCase() + a.slice(1).toLowerCase();
  return method === "DELETE" ? "Deleted" : method === "PUT" || method === "PATCH" ? "Updated" : "Saved";
};
const targetOf = (s: Record<string, unknown>) => String(s.title || s.name || s.subject || s["booking.title"] || s["task.title"] || s["contact.name"] || s.email || s.to || s.slug || s.id || s.taskId || s.bookingId || s.contactId || "").slice(0, 160);

let people: { at: number; list: Array<{ email: string; name: string; type: string }> } | null = null;
async function whoIs(db: Db, email: string) {
  if (!people || Date.now() - people.at > 300_000) {
    const row = await db.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
    let list: Array<{ email: string; name: string; type: string }> = [];
    try { const w = JSON.parse(row?.data || "{}"); list = (w.staff || []).filter((s: any) => !s.isBot && s.email).map((s: any) => ({ email: String(s.email).toLowerCase(), name: String(s.name || s.email), type: s.staffType === "subaccount" || /^Sub-account/i.test(String(s.role || "")) ? "Sub-account staff" : "Agency staff" })); } catch { /* empty */ }
    people = { at: Date.now(), list };
  }
  const p = people.list.find((x) => x.email === email.toLowerCase());
  return p || { email, name: email || "Unknown", type: email ? "Client login" : "System" };
}

export async function logAction(db: Db, e: { actor: string; method: string; path: string; status: number; clientId?: string; body?: unknown; ip?: string; area?: string; action?: string; target?: string; detail?: Record<string, unknown> }) {
  await ensureActionLog(db);
  const summary = e.detail || summariseBody(e.body);
  const p = await whoIs(db, e.actor);
  const action = e.action || verb(e.method, summary);
  const isDelete = e.method === "DELETE" || /delete|remove|cancel|void|archive|trash/i.test(action);
  await db.prepare("INSERT INTO action_log (id, at, actor, actor_name, actor_type, client_id, area, action, target, detail, method, path, status, is_delete, ip) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)")
    .bind(crypto.randomUUID(), new Date().toISOString(), e.actor.toLowerCase(), p.name, p.type, e.clientId || "", e.area || areaFor(e.path), action.slice(0, 80), (e.target ?? targetOf(summary)).slice(0, 160), JSON.stringify(summary).slice(0, 3000), e.method, e.path.slice(0, 160), e.status, isDelete ? 1 : 0, e.ip || "").run();
}

export function shouldLogRequest(method: string, path: string) {
  if (method === "PUT" && path === "/api/workspace") return false; // logged as a field-level diff instead
  return /^(POST|PUT|PATCH|DELETE)$/.test(method) && path.startsWith("/api/") && !SKIP.some((re) => re.test(path));
}

// ---- Workspace saves: field-level diff of the records people edit through the main app ----
const LISTS: Array<{ key: string; area: string; label: (x: any) => string; fields: string[] }> = [
  { key: "tasks", area: "Tasks", label: (t) => t.title, fields: ["title", "status", "assigneeId", "priority", "dueDate", "clientId", "frequency", "aiRunState", "pendingReason"] },
  { key: "clients", area: "Clients", label: (c) => c.name, fields: ["name", "company", "status", "email", "phone", "website", "services"] },
  { key: "staff", area: "Team & access", label: (s) => s.name || s.email, fields: ["name", "email", "role", "staffType", "permissions", "clientAccessIds", "costRate"] },
  { key: "financeRecords", area: "Books", label: (f) => `${f.kind || ""} ${f.description || f.title || ""} ${f.amount ?? ""}`.trim(), fields: ["kind", "amount", "date", "description", "category", "clientId"] },
  { key: "financeRecurring", area: "Books", label: (f) => `${f.description || f.title || "Recurring"} ${f.amount ?? ""}`.trim(), fields: ["amount", "interval", "description", "active"] },
  { key: "projects", area: "Projects", label: (p) => p.name, fields: ["name", "status", "clientId"] },
  { key: "notes", area: "Notes", label: (n) => String(n.title || n.text || n.body || "Note").slice(0, 60), fields: ["title", "text", "body"] },
  { key: "files", area: "Files & media", label: (f) => f.name || f.title, fields: ["name", "clientId", "folder"] },
  { key: "vaultEntries", area: "Password vault", label: (v) => v.label || v.name || v.title || "Vault entry", fields: ["label", "name", "url", "username"] },
];
export function diffWorkspace(prev: any, next: any) {
  const out: Array<{ area: string; action: string; target: string; clientId: string; detail: Record<string, unknown> }> = [];
  for (const L of LISTS) {
    const a = new Map<string, any>((prev?.[L.key] || []).map((x: any) => [String(x?.id), x]));
    const b = new Map<string, any>((next?.[L.key] || []).map((x: any) => [String(x?.id), x]));
    for (const [id, x] of b) {
      const old = a.get(id);
      if (!old) { out.push({ area: L.area, action: "Created", target: String(L.label(x) || id).slice(0, 160), clientId: String(x?.clientId || (L.key === "clients" ? id : "")), detail: { id } }); continue; }
      const changed: Record<string, unknown> = {};
      for (const f of L.fields) { const o = JSON.stringify(old?.[f] ?? null), n = JSON.stringify(x?.[f] ?? null); if (o !== n) changed[f] = SECRET.test(f) ? "changed" : { from: String(old?.[f] ?? "").slice(0, 80), to: String(x?.[f] ?? "").slice(0, 80) }; }
      if (Object.keys(changed).length) out.push({ area: L.area, action: changed.status ? `Status → ${String(x.status)}` : "Updated", target: String(L.label(x) || id).slice(0, 160), clientId: String(x?.clientId || (L.key === "clients" ? id : "")), detail: { id, ...changed } });
    }
    for (const [id, x] of a) if (!b.has(id)) out.push({ area: L.area, action: "Deleted", target: String(L.label(x) || id).slice(0, 160), clientId: String(x?.clientId || (L.key === "clients" ? id : "")), detail: { id } });
  }
  return out.slice(0, 60);
}
