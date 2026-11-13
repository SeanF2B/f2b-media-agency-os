// Copies every email the system sends into Conversations (channel "email") so the team can see what went out.
// Never throws: logging must not break sending.
type LogDb = { prepare(sql: string): { bind(...values: unknown[]): { run(): Promise<unknown>; first<T = Record<string, unknown>>(): Promise<T | null> }; run(): Promise<unknown> }; batch(statements: unknown[]): Promise<unknown> };

export async function logSystemEmail(db: LogDb | undefined, m: { ownerId?: string; clientId?: string | null; to: string; name?: string; subject: string; text: string }) {
  if (!db || !m.to) return;
  try {
    let ownerId = m.ownerId || "";
    if (!ownerId) ownerId = (await db.prepare("SELECT owner_id FROM workspace_documents WHERE id='f2b-agency'").bind().first<{ owner_id: string }>())?.owner_id || "";
    if (!ownerId) return;
    const to = m.to.trim().toLowerCase(), clientId = m.clientId || "", now = new Date().toISOString();
    const preview = `${m.subject} — ${m.text}`.replace(/\s+/g, " ").slice(0, 120);
    await db.prepare("CREATE TABLE IF NOT EXISTS conv_threads (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, client_id TEXT NOT NULL DEFAULT '', channel TEXT NOT NULL, our_number TEXT NOT NULL, contact TEXT NOT NULL, contact_name TEXT NOT NULL DEFAULT '', bot_on INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'open', unread INTEGER NOT NULL DEFAULT 0, last_at TEXT NOT NULL, last_preview TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS conv_messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, owner_id TEXT NOT NULL, direction TEXT NOT NULL, sender TEXT NOT NULL, body TEXT NOT NULL, twilio_sid TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)").run();
    let thread = await db.prepare("SELECT id FROM conv_threads WHERE owner_id=?1 AND channel='email' AND our_number='email' AND contact=?2").bind(ownerId, to).first<{ id: string }>();
    if (!thread) {
      thread = { id: crypto.randomUUID() };
      await db.prepare("INSERT INTO conv_threads (id, owner_id, client_id, channel, our_number, contact, contact_name, bot_on, status, unread, last_at, last_preview, created_at) VALUES (?1,?2,?3,'email','email',?4,?5,0,'open',0,?6,?7,?6)").bind(thread.id, ownerId, clientId, to, String(m.name || "").slice(0, 80), now, preview).run();
    }
    await db.batch([
      db.prepare("INSERT INTO conv_messages (id, thread_id, owner_id, direction, sender, body, twilio_sid, error, created_at) VALUES (?1,?2,?3,'out','bot',?4,'','',?5)").bind(crypto.randomUUID(), thread.id, ownerId, `Subject: ${m.subject}\n\n${m.text}`.slice(0, 4000), now),
      db.prepare("UPDATE conv_threads SET last_at=?2, last_preview=?3 WHERE id=?1").bind(thread.id, now, preview),
    ]);
  } catch (error) { console.error("logSystemEmail", error); }
}
