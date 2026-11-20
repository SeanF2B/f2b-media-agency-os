// Copies every email the system sends into Conversations (channel "email") so the team can see what went out.
// Never throws: logging must not break sending.
type LogDb = { prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown>; first<T = Record<string, unknown>>(): Promise<T | null> }; run(): Promise<unknown> }; batch(statements: unknown[]): Promise<unknown> };

/** Rough category for the System emails list, from the subject when the caller doesn't say. */
export function systemEmailKind(subject: string) {
  const s = subject.toLowerCase();
  if (/chess/.test(s)) return "Chess";
  if (/invoice|receipt|payment/.test(s)) return "Invoices";
  if (/invit|join|sign in|login|workspace access/.test(s)) return "Team invites";
  if (/appointment|booking|booked|reminder|resched|cancel/.test(s)) return "Scheduling";
  if (/^\[test\]/.test(s)) return "Tests";
  if (/lead|enquiry|form|submission/.test(s)) return "Leads & forms";
  if (/task|approval|review|done|overdue|assigned/.test(s)) return "Tasks";
  if (/report/.test(s)) return "Reports";
  return "Notifications";
}
const SYSTEM_EMAILS_SQL = "CREATE TABLE IF NOT EXISTS system_emails (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, client_id TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, to_email TEXT NOT NULL, to_name TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)";
const SYSTEM_EMAILS_IDX = "CREATE INDEX IF NOT EXISTS system_emails_owner_created_idx ON system_emails(owner_id, created_at DESC)";
let systemEmailsReady: Promise<unknown> | null = null;
// `html` keeps the exact designed email that went out, so System emails and Conversations can show it as sent.
const addColumn = (db: LogDb, sql: string) => db.prepare(sql).run().catch(() => undefined);
export function ensureSystemEmailsTable(db: LogDb) {
  systemEmailsReady ||= db.prepare(SYSTEM_EMAILS_SQL).run().then(() => db.prepare(SYSTEM_EMAILS_IDX).run()).then(() => addColumn(db, "ALTER TABLE system_emails ADD COLUMN html TEXT NOT NULL DEFAULT ''")).catch((error) => { systemEmailsReady = null; throw error; });
  return systemEmailsReady;
}
let convHtmlReady: Promise<unknown> | null = null;
export function ensureConvMessageHtml(db: LogDb) {
  convHtmlReady ||= addColumn(db, "ALTER TABLE conv_messages ADD COLUMN html TEXT NOT NULL DEFAULT ''");
  return convHtmlReady;
}
/** Email HTML is capped so one row stays small (D1 rows max out around 1 MB). */
const capHtml = (html?: string) => (html && html.length <= 200_000 ? html : "");

export async function logSystemEmail(db: LogDb | undefined, m: { ownerId?: string; clientId?: string | null; to: string; name?: string; subject: string; text: string; html?: string; kind?: string; conversation?: boolean }) {
  if (!db || !m.to) return;
  // Every system email also lands in Operations → Email → System emails (one indexed insert).
  try {
    let owner = m.ownerId || "";
    if (!owner) owner = (await db.prepare("SELECT owner_id FROM workspace_documents WHERE id='f2b-agency'").bind().first<{ owner_id: string }>())?.owner_id || "";
    if (owner) {
      m = { ...m, ownerId: owner };
      await ensureSystemEmailsTable(db);
      await db.prepare("INSERT INTO system_emails (id, owner_id, client_id, kind, to_email, to_name, subject, body, created_at, html) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)").bind(crypto.randomUUID(), owner, m.clientId || "", (m.kind || systemEmailKind(m.subject)).slice(0, 40), m.to.trim().toLowerCase().slice(0, 200), String(m.name || "").slice(0, 120), m.subject.slice(0, 300), m.text.slice(0, 4000), new Date().toISOString(), capHtml(m.html)).run();
    }
  } catch (error) { console.error("logSystemEmail:system_emails", error); }
  if (m.conversation === false) return;
  try {
    let ownerId = m.ownerId || "";
    if (!ownerId) ownerId = (await db.prepare("SELECT owner_id FROM workspace_documents WHERE id='f2b-agency'").bind().first<{ owner_id: string }>())?.owner_id || "";
    if (!ownerId) return;
    const to = m.to.trim().toLowerCase(), clientId = m.clientId || "", now = new Date().toISOString();
    const preview = `${m.subject} — ${m.text}`.replace(/\s+/g, " ").slice(0, 120);
    await db.prepare("CREATE TABLE IF NOT EXISTS conv_threads (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, client_id TEXT NOT NULL DEFAULT '', channel TEXT NOT NULL, our_number TEXT NOT NULL, contact TEXT NOT NULL, contact_name TEXT NOT NULL DEFAULT '', bot_on INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'open', unread INTEGER NOT NULL DEFAULT 0, last_at TEXT NOT NULL, last_preview TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS conv_messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, owner_id TEXT NOT NULL, direction TEXT NOT NULL, sender TEXT NOT NULL, body TEXT NOT NULL, twilio_sid TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)").run();
    await ensureConvMessageHtml(db);
    let thread = await db.prepare("SELECT id FROM conv_threads WHERE owner_id=?1 AND channel='email' AND our_number='email' AND contact=?2").bind(ownerId, to).first<{ id: string }>();
    if (!thread) {
      thread = { id: crypto.randomUUID() };
      await db.prepare("INSERT INTO conv_threads (id, owner_id, client_id, channel, our_number, contact, contact_name, bot_on, status, unread, last_at, last_preview, created_at) VALUES (?1,?2,?3,'email','email',?4,?5,0,'open',0,?6,?7,?6)").bind(thread.id, ownerId, clientId, to, String(m.name || "").slice(0, 80), now, preview).run();
    }
    await db.batch([
      db.prepare("INSERT INTO conv_messages (id, thread_id, owner_id, direction, sender, body, twilio_sid, error, created_at, html) VALUES (?1,?2,?3,'out','bot',?4,'','',?5,?6)").bind(crypto.randomUUID(), thread.id, ownerId, `Subject: ${m.subject}\n\n${m.text}`.slice(0, 4000), now, capHtml(m.html)),
      db.prepare("UPDATE conv_threads SET last_at=?2, last_preview=?3 WHERE id=?1").bind(thread.id, now, preview),
    ]);
  } catch (error) { console.error("logSystemEmail", error); }
}

/** Serves a stored email as a locked-down page for an <iframe sandbox>: no scripts, no forms, links open in a new tab. */
export function emailHtmlResponse(html: string) {
  const page = /<head[\s>]/i.test(html) ? html.replace(/<head([^>]*)>/i, '<head$1><base target="_blank">') : `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"></head><body style="margin:0">${html}</body></html>`;
  return new Response(page, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "x-frame-options": "SAMEORIGIN", "content-security-policy": "sandbox allow-popups allow-popups-to-escape-sandbox; script-src 'none'; form-action 'none'; frame-ancestors 'self'" } });
}
