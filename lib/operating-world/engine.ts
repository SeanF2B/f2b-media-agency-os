// Operating World · deterministic game engine.
// Everything here is pure: no database, no network, no AI. Rewards, levels, health and the
// employee briefing are all computed from a snapshot of REAL CRM records, so the same data
// always gives the same result and nothing is ever invented.

// ───────────────────────────── Snapshot (built server-side from real records) ─────────────────────────────
export type OwLead = { id: string; title: string; name: string; value: number; currency: string; stage: string; stagePosition: number; firstPosition: number; category: "open" | "won" | "lost"; createdAt: string; updatedAt: string };
export type OwThread = { id: string; name: string; channel: string; unread: number; lastAt: string; preview: string };
export type OwReply = { id: string; threadId: string; createdAt: string };
export type OwInvoice = { id: string; number: string; clientName: string; status: string; dueDate: string; sentAt: string; paidAt: string; total: number; currency: string; createdAt: string };
export type OwBooking = { id: string; name: string; startAt: string; status: string; createdAt: string };
export type OwTask = { id: string; title: string; status: string; priority: string; due: string; completedAt: string; createdAt: string };
export type OwExpense = { id: string; description: string; amount: number; date: string; hasReceipt: boolean; category?: string };
export type OwContact = { id: string; name: string; createdAt: string };
export type OwActivity = { id: string; type: string; createdAt: string };
export type OwSnapshot = {
  now: string;
  leads: OwLead[];
  threads: OwThread[];
  replies: OwReply[];
  invoices: OwInvoice[];
  bookings: OwBooking[];
  tasks: OwTask[];
  expenses: OwExpense[];
  contacts?: OwContact[];
  activities?: OwActivity[];
  hasCalendars: boolean;
  /** Which data sources could actually be read. A missing source is shown as "not connected", never as zero activity. */
  sources: Record<"crm" | "conversations" | "invoicing" | "scheduling" | "tasks" | "books", boolean>;
};

// ───────────────────────────── Rewards (virtual only — never real money) ─────────────────────────────
export type RewardKind = "lead_responded" | "follow_up" | "appointment_booked" | "receipt_recorded" | "invoice_sent" | "invoice_paid" | "job_won" | "contact_added" | "note_logged" | "invoice_created" | "expense_recorded" | "ad_spend_logged" | "appointment_completed";
/** Bookkeeping category the ads sync uses for ad spend. */
export const AD_SPEND_CATEGORY = "Advertising & marketing";
export const REWARDS: Record<RewardKind, { coins: number; xp: number; label: string }> = {
  lead_responded: { coins: 20, xp: 20, label: "Lead responded to" },
  follow_up: { coins: 20, xp: 20, label: "Follow-up completed" },
  appointment_booked: { coins: 30, xp: 30, label: "Appointment booked" },
  receipt_recorded: { coins: 50, xp: 50, label: "Receipt recorded" },
  invoice_sent: { coins: 50, xp: 50, label: "Invoice sent" },
  invoice_paid: { coins: 40, xp: 60, label: "Payment confirmed" },
  job_won: { coins: 100, xp: 100, label: "Job won" },
  // Little things add up too.
  contact_added: { coins: 5, xp: 5, label: "New contact added" },
  note_logged: { coins: 5, xp: 5, label: "Note logged" },
  invoice_created: { coins: 10, xp: 10, label: "Invoice drafted" },
  expense_recorded: { coins: 10, xp: 10, label: "Expense recorded" },
  ad_spend_logged: { coins: 10, xp: 10, label: "Ad spend logged in Books" },
  appointment_completed: { coins: 20, xp: 20, label: "Appointment completed" },
};
/** Anti-farming: at most this many rewards of one kind per calendar day. */
export const DAILY_REWARD_CAP = 25;

export type Achievement = { key: string; kind: RewardKind; coins: number; xp: number; label: string; at: string };

const after = (iso: string, since: string) => Boolean(iso) && Date.parse(iso) >= Date.parse(since);
const dayOf = (iso: string) => iso.slice(0, 10);

/**
 * Every genuinely completed piece of work since the game was switched on, each with a stable key.
 * Keys are unique per record, so the server can INSERT OR IGNORE them: replays, refreshes and
 * double-clicks can never pay out twice. Work done in the normal CRM screens counts too.
 */
export function achievementsFromSnapshot(snap: OwSnapshot, since: string): Achievement[] {
  const out: Achievement[] = [];
  const add = (key: string, kind: RewardKind, at: string, detail: string) => {
    const r = REWARDS[kind];
    out.push({ key, kind, coins: r.coins, xp: r.xp, label: detail ? `${r.label} · ${detail}` : r.label, at });
  };
  for (const lead of snap.leads) {
    if (!after(lead.updatedAt, since)) continue;
    // A lead counts as responded to once someone moved it on from the first stage. Only leads that
    // arrived after the game was switched on count, because we can't tell when older ones were moved.
    if (lead.stagePosition > lead.firstPosition && lead.category !== "lost" && after(lead.createdAt, since)) add(`lead:${lead.id}`, "lead_responded", lead.updatedAt, lead.name || lead.title);
    if (lead.category === "won") add(`won:${lead.id}`, "job_won", lead.updatedAt, lead.name || lead.title);
  }
  const repliedThreads = new Set<string>();
  for (const reply of snap.replies) {
    if (!after(reply.createdAt, since) || repliedThreads.has(reply.threadId)) continue;
    repliedThreads.add(reply.threadId); // one reward per conversation per day, not per message
    const name = snap.threads.find((t) => t.id === reply.threadId)?.name || "";
    add(`reply:${reply.threadId}:${dayOf(reply.createdAt)}`, "lead_responded", reply.createdAt, name);
  }
  for (const inv of snap.invoices) {
    if (inv.sentAt && after(inv.sentAt, since)) add(`inv-sent:${inv.id}`, "invoice_sent", inv.sentAt, inv.number);
    if (inv.status === "paid" && inv.paidAt && after(inv.paidAt.length === 10 ? `${inv.paidAt}T23:59:59Z` : inv.paidAt, since)) add(`inv-paid:${inv.id}`, "invoice_paid", inv.paidAt, inv.number);
  }
  for (const b of snap.bookings) if (b.status !== "cancelled" && after(b.createdAt, since)) add(`booking:${b.id}`, "appointment_booked", b.createdAt, b.name);
  for (const t of snap.tasks) if (/^done$/i.test(t.status) && t.completedAt && after(t.completedAt, since)) add(`task:${t.id}`, "follow_up", t.completedAt, t.title);
  // Expenses have no timestamp, only a date: count those dated on/after the start day.
  for (const e of snap.expenses) {
    if (e.date < dayOf(since)) continue;
    const at = `${e.date}T12:00:00Z`;
    if (e.category === AD_SPEND_CATEGORY) add(`adspend:${e.id}`, "ad_spend_logged", at, e.description);
    else if (e.hasReceipt) add(`receipt:${e.id}`, "receipt_recorded", at, e.description);
    else add(`expense:${e.id}`, "expense_recorded", at, e.description);
  }
  for (const inv of snap.invoices) if (inv.createdAt && after(inv.createdAt, since)) add(`inv-new:${inv.id}`, "invoice_created", inv.createdAt, inv.number);
  for (const b of snap.bookings) if (b.status === "completed" && after(b.createdAt, since)) add(`booking-done:${b.id}`, "appointment_completed", b.startAt, b.name);
  for (const c of snap.contacts || []) if (after(c.createdAt, since)) add(`contact:${c.id}`, "contact_added", c.createdAt, c.name);
  for (const a of snap.activities || []) if (after(a.createdAt, since)) add(`note:${a.id}`, "note_logged", a.createdAt, "");
  // Daily cap per kind.
  const perDay = new Map<string, number>();
  return out.sort((a, b) => a.at.localeCompare(b.at)).filter((a) => {
    const k = `${a.kind}:${dayOf(a.at)}`; const n = (perDay.get(k) || 0) + 1; perDay.set(k, n); return n <= DAILY_REWARD_CAP;
  });
}

// ───────────────────────────── Progression ─────────────────────────────
/** XP needed to reach a level: L1 = 0, L2 = 100, L5 = 1,000, L10 = 4,500, L20 = 19,000. */
export const xpForLevel = (level: number) => 50 * (level - 1) * level;
export function levelFromXp(xp: number) {
  let level = 1;
  while (level < 99 && xp >= xpForLevel(level + 1)) level++;
  const floor = xpForLevel(level), next = xpForLevel(level + 1);
  return { level, xpIntoLevel: xp - floor, xpForNext: next - floor, progress: Math.min(1, (xp - floor) / (next - floor)) };
}
export const STAGES = [
  { level: 1, name: "Startup", floors: 1 },
  { level: 5, name: "Established business", floors: 2 },
  { level: 10, name: "Expanding business", floors: 3 },
  { level: 15, name: "Growing company", floors: 4 },
  { level: 20, name: "Market leader", floors: 5 },
  { level: 30, name: "Business empire", floors: 6 },
  { level: 50, name: "Industry legend", floors: 7 },
] as const;
export function stageForLevel(level: number) {
  let stage: (typeof STAGES)[number] = STAGES[0];
  for (const s of STAGES) if (level >= s.level) stage = s;
  const next = STAGES.find((s) => s.level > level) || null;
  return { ...stage, next };
}

// Upgrade tracks. Coins buy visible upgrades only (never real-world assets); levels gate each tier.
// Each tier changes the scene. Purchases are stored as "<track>:<tier>".
export type UpgradeTier = { tier: number; name: string; price: number; minLevel: number; perk: string };
export type UpgradeTrack = { id: string; name: string; group: "business" | "lifestyle"; tiers: UpgradeTier[] };
export const UPGRADES: UpgradeTrack[] = [
  { id: "hq", group: "business", name: "Headquarters", tiers: [
    { tier: 1, name: "Established office", price: 500, minLevel: 5, perk: "Second floor and a bigger footprint" },
    { tier: 2, name: "Expanding business", price: 1500, minLevel: 10, perk: "Third floor" },
    { tier: 3, name: "Growing company", price: 3000, minLevel: 15, perk: "Fourth floor" },
    { tier: 4, name: "Market leader tower", price: 6000, minLevel: 20, perk: "Fifth floor" },
    { tier: 5, name: "Business empire", price: 12000, minLevel: 30, perk: "Sixth floor" },
    { tier: 6, name: "Industry legend", price: 25000, minLevel: 50, perk: "Seventh floor — the skyline is yours" } ] },
  { id: "reception", group: "business", name: "Reception", tiers: [
    { tier: 1, name: "Polished desk", price: 80, minLevel: 1, perk: "A proper front desk for Rosie" },
    { tier: 2, name: "Waiting lounge", price: 250, minLevel: 3, perk: "Sofas and plants for waiting customers" },
    { tier: 3, name: "Concierge counter", price: 600, minLevel: 6, perk: "Marble counter and a welcome mat" } ] },
  { id: "garden", group: "lifestyle", name: "Grounds", tiers: [
    { tier: 1, name: "Flower beds", price: 60, minLevel: 1, perk: "Colour along the path" },
    { tier: 2, name: "Oak trees", price: 150, minLevel: 2, perk: "Shade either side of HQ" },
    { tier: 3, name: "Fountain", price: 450, minLevel: 5, perk: "A fountain out front" } ] },
  { id: "workshop", group: "business", name: "Workshop", tiers: [
    { tier: 1, name: "Tool shed", price: 150, minLevel: 2, perk: "Somewhere for the kit" },
    { tier: 2, name: "Workshop", price: 400, minLevel: 5, perk: "A branded workshop beside HQ" },
    { tier: 3, name: "Warehouse", price: 1000, minLevel: 12, perk: "Full warehouse with roller door" } ] },
  { id: "fleet", group: "business", name: "Fleet", tiers: [
    { tier: 1, name: "Branded van", price: 300, minLevel: 4, perk: "Your logo on the road" },
    { tier: 2, name: "Branded truck", price: 800, minLevel: 10, perk: "A bigger truck for bigger jobs" },
    { tier: 3, name: "Second van", price: 1500, minLevel: 15, perk: "A two-vehicle fleet" } ] },
  { id: "signage", group: "business", name: "Signage", tiers: [
    { tier: 1, name: "Premium sign", price: 200, minLevel: 3, perk: "Dark sign with a brand outline" },
    { tier: 2, name: "Rooftop neon", price: 500, minLevel: 7, perk: "Glowing name on the roof" } ] },
  { id: "cafe", group: "business", name: "Staff café", tiers: [
    { tier: 1, name: "Coffee bench", price: 80, minLevel: 1, perk: "A bench and a coffee cart" },
    { tier: 2, name: "Café corner", price: 300, minLevel: 4, perk: "Parasol tables for the team" } ] },
  { id: "renovation", group: "business", name: "Renovation", tiers: [
    { tier: 1, name: "Fresh paint", price: 300, minLevel: 3, perk: "HQ walls in your brand colours" },
    { tier: 2, name: "Glass frontage", price: 1200, minLevel: 9, perk: "Floor-to-ceiling glass" },
    { tier: 3, name: "Luxury facade", price: 4000, minLevel: 17, perk: "Dark stone with gold trim" } ] },
  { id: "interior", group: "business", name: "Interior", tiers: [
    { tier: 1, name: "Warm lighting", price: 150, minLevel: 2, perk: "Windows glow at all hours" },
    { tier: 2, name: "Plants & art", price: 500, minLevel: 5, perk: "Greenery in every window" },
    { tier: 3, name: "Designer interior", price: 1500, minLevel: 11, perk: "Chandeliers that sparkle" } ] },
  { id: "home", group: "lifestyle", name: "Your home", tiers: [
    { tier: 1, name: "Cottage", price: 400, minLevel: 3, perk: "A cosy place to come home to" },
    { tier: 2, name: "Villa", price: 2500, minLevel: 12, perk: "Two storeys and a balcony" },
    { tier: 3, name: "Mansion", price: 10000, minLevel: 25, perk: "Columns, gates and a grand entrance" } ] },
  { id: "pool", group: "lifestyle", name: "Swimming pool", tiers: [
    { tier: 1, name: "Garden pool", price: 600, minLevel: 6, perk: "A splash of blue" },
    { tier: 2, name: "Infinity pool", price: 2000, minLevel: 12, perk: "Bigger, with sun loungers" },
    { tier: 3, name: "Pool party deck", price: 4500, minLevel: 18, perk: "Deck, parasols and an inflatable" } ] },
  { id: "car", group: "lifestyle", name: "Your car", tiers: [
    { tier: 1, name: "Hatchback", price: 250, minLevel: 2, perk: "Reliable and branded" },
    { tier: 2, name: "SUV", price: 700, minLevel: 5, perk: "Room for the whole crew" },
    { tier: 3, name: "Sports car", price: 1800, minLevel: 9, perk: "Low, fast and shiny" },
    { tier: 4, name: "Supercar", price: 5000, minLevel: 16, perk: "Gold wheels. Obviously." } ] },
  { id: "air", group: "lifestyle", name: "Air travel", tiers: [
    { tier: 1, name: "Helipad", price: 900, minLevel: 8, perk: "Somewhere to land" },
    { tier: 2, name: "Helicopter", price: 3000, minLevel: 14, perk: "Rotors spinning on the pad" },
    { tier: 3, name: "Private jet", price: 9000, minLevel: 22, perk: "Flyovers in your colours" } ] },
  { id: "wardrobe", group: "lifestyle", name: "Wardrobe", tiers: [
    { tier: 1, name: "Branded kit", price: 100, minLevel: 2, perk: "Fresh workwear" },
    { tier: 2, name: "Smart suit", price: 400, minLevel: 5, perk: "Sharp tie for meetings" },
    { tier: 3, name: "Designer shades", price: 1000, minLevel: 10, perk: "Too cool for school" },
    { tier: 4, name: "Golden crown", price: 5000, minLevel: 20, perk: "Business royalty" } ] },
];
/** Highest tier owned on a track (0 = none). */
export function upgradeTier(owned: string[], trackId: string) {
  let tier = 0;
  for (const id of owned) { const [t, n] = id.split(":"); if (t === trackId && Number(n) > tier) tier = Number(n); }
  return tier;
}
export function nextUpgrade(trackId: string, owned: string[]) {
  const track = UPGRADES.find((t) => t.id === trackId);
  return track ? track.tiers.find((t) => t.tier === upgradeTier(owned, trackId) + 1) || null : null;
}
export function canBuy(trackId: string, owned: string[], balance: number, level: number): string | null {
  if (!UPGRADES.some((t) => t.id === trackId)) return "That upgrade doesn't exist.";
  const next = nextUpgrade(trackId, owned);
  if (!next) return "Fully upgraded.";
  if (level < next.minLevel) return `Unlocks at level ${next.minLevel}.`;
  if (balance < next.price) return `You need ${next.price - balance} more coins.`;
  return null;
}

// ───────────────────────────── Operating hours ─────────────────────────────
/** Working hours elapsed between two instants, counting Mon–Fri only (weekends don't make customers "wait"). */
export function workingHoursBetween(fromIso: string, toIso: string) {
  let t = Date.parse(fromIso); const end = Date.parse(toIso);
  if (!(end > t)) return 0;
  let ms = 0;
  while (t < end) {
    const d = new Date(t); const nextDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
    const stop = Math.min(end, nextDay); const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) ms += stop - t;
    t = stop;
  }
  return ms / 3_600_000;
}

// ───────────────────────────── Business health (operational, NOT financial) ─────────────────────────────
export type Health = { score: number; mood: "thriving" | "steady" | "busy" | "struggling"; issues: string[] };
export function operationalHealth(snap: OwSnapshot): Health {
  const s = derived(snap); let score = 100; const issues: string[] = [];
  const hit = (n: number, each: number, max: number, text: string) => { if (n > 0) { score -= Math.min(max, n * each); issues.push(text); } };
  hit(s.waitingLeads.length, 12, 36, `${s.waitingLeads.length} lead${s.waitingLeads.length === 1 ? "" : "s"} waiting over a working day`);
  hit(s.freshLeads.length - s.waitingLeads.length, 4, 12, "new leads not yet contacted");
  hit(s.unreadThreads.length, 5, 20, `${s.unreadThreads.length} unread conversation${s.unreadThreads.length === 1 ? "" : "s"}`);
  hit(s.overdueInvoices.length, 6, 18, `${s.overdueInvoices.length} overdue invoice${s.overdueInvoices.length === 1 ? "" : "s"}`);
  hit(s.overdueTasks.length, 4, 16, `${s.overdueTasks.length} overdue task${s.overdueTasks.length === 1 ? "" : "s"}`);
  hit(s.expensesNoReceipt.length, 2, 8, "expenses missing receipts");
  score = Math.max(0, Math.round(score));
  return { score, mood: score >= 85 ? "thriving" : score >= 65 ? "steady" : score >= 40 ? "busy" : "struggling", issues };
}

/** Real money only: confirmed paid invoices and outstanding (unpaid) invoices. Kept apart from coins. */
export function financialSummary(snap: OwSnapshot) {
  const month = snap.now.slice(0, 7);
  const sum = (list: OwInvoice[]) => { const by: Record<string, number> = {}; for (const i of list) by[i.currency || "EUR"] = Math.round(((by[i.currency || "EUR"] || 0) + i.total) * 100) / 100; return by; };
  return {
    paidThisMonth: sum(snap.invoices.filter((i) => i.status === "paid" && (i.paidAt || "").slice(0, 7) === month)),
    outstanding: sum(snap.invoices.filter((i) => i.status === "sent" || i.status === "overdue")),
    overdueCount: snap.invoices.filter((i) => i.status === "overdue").length,
  };
}

function derived(snap: OwSnapshot) {
  const today = snap.now.slice(0, 10);
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const freshLeads = snap.leads.filter((l) => l.category === "open" && l.stagePosition <= l.firstPosition).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const waitingLeads = freshLeads.filter((l) => workingHoursBetween(l.createdAt, snap.now) >= 24);
  return {
    today, tomorrow, freshLeads, waitingLeads,
    unreadThreads: snap.threads.filter((t) => t.unread > 0),
    staleDeals: snap.leads.filter((l) => l.category === "open" && l.stagePosition > l.firstPosition && workingHoursBetween(l.updatedAt, snap.now) >= 5 * 24),
    recentWins: snap.leads.filter((l) => l.category === "won" && Date.parse(snap.now) - Date.parse(l.updatedAt) < 2 * 86_400_000),
    draftInvoices: snap.invoices.filter((i) => i.status === "draft"),
    overdueInvoices: snap.invoices.filter((i) => i.status === "overdue"),
    recentPaid: snap.invoices.filter((i) => i.status === "paid" && i.paidAt && Date.parse(snap.now) - Date.parse(i.paidAt.length === 10 ? `${i.paidAt}T12:00:00Z` : i.paidAt) < 2 * 86_400_000),
    bookingsToday: snap.bookings.filter((b) => b.status === "booked" && b.startAt.slice(0, 10) === today),
    bookingsTomorrow: snap.bookings.filter((b) => b.status === "booked" && b.startAt.slice(0, 10) === tomorrow),
    pastUnmarked: snap.bookings.filter((b) => b.status === "booked" && Date.parse(b.startAt) < Date.parse(snap.now) - 3_600_000),
    overdueTasks: snap.tasks.filter((t) => !/^done$/i.test(t.status) && t.due && t.due < today),
    dueTodayTasks: snap.tasks.filter((t) => !/^done$/i.test(t.status) && t.due === today),
    expensesNoReceipt: snap.expenses.filter((e) => !e.hasReceipt && e.date.slice(0, 7) === today.slice(0, 7)),
  };
}

// ───────────────────────────── Employees & briefing ─────────────────────────────
export type EmployeeId = "receptionist" | "sales" | "accountant" | "projects" | "marketing" | "calendar";
export const EMPLOYEES: Record<EmployeeId, { name: string; title: string; colour: string }> = {
  receptionist: { name: "Rosie", title: "Receptionist", colour: "#f472b6" },
  sales: { name: "Sam", title: "Salesperson", colour: "#f59e0b" },
  accountant: { name: "Ada", title: "Accountant", colour: "#10b981" },
  projects: { name: "Pete", title: "Project manager", colour: "#6366f1" },
  marketing: { name: "Mia", title: "Marketing assistant", colour: "#ec4899" },
  calendar: { name: "Cal", title: "Calendar assistant", colour: "#0ea5e9" },
};
/** Where an option takes the owner. Every panel opens an EXISTING CRM screen inside the game. */
export type PanelKind = "leads" | "contacts" | "conversations" | "scheduling" | "invoicing" | "books" | "expense" | "tasks" | "task" | "lead-replies" | "lead-detail";
export type BriefingOption = { label: string; panel?: PanelKind; focusId?: string; snooze?: boolean };
export type Approach = { id: string; employee: EmployeeId; urgency: number; mood: "panicked" | "concerned" | "cheerful" | "calm"; line: string; detail: string; count: number; options: BriefingOption[] };

/** Small deterministic hash so dialogue varies by day but never randomly between refreshes. */
function pick<T>(list: readonly T[], seed: string): T {
  let h = 2166136261; for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return list[Math.abs(h) % list.length];
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const say = (n: number) => (n <= 10 ? words[n] : String(n));
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function briefing(snap: OwSnapshot): Approach[] {
  const s = derived(snap); const seed = s.today; const out: Approach[] = [];
  if (snap.sources.crm && s.freshLeads.length) {
    const n = s.freshLeads.length, w = s.waitingLeads.length;
    const panic = w > 0;
    const line = panic
      ? pick([`BOSS!! We've got ${say(n)} new lead${n === 1 ? "" : "s"} and nobody has responded!`, `Boss! ${cap(say(n))} lead${n === 1 ? " is" : "s are"} sitting at reception and ${w === 1 ? "one has" : `${say(w)} have`} been waiting over a working day!`, `Help! The waiting area's filling up — ${plural(n, "new lead")} need a reply!`], seed + n)
      : pick([`Boss, ${say(n)} fresh lead${n === 1 ? " just" : "s just"} came in.`, `New enquiry alert! ${cap(plural(n, "lead"))} waiting for a hello.`], seed + n);
    out.push({ id: "leads", employee: "receptionist", urgency: panic ? 100 : 70, mood: panic ? "panicked" : "concerned", count: n, line,
      detail: w ? `${plural(w, "lead")} waiting over 24 working hours. Oldest: ${s.waitingLeads[0].name || s.waitingLeads[0].title}.` : `Oldest: ${s.freshLeads[0].name || s.freshLeads[0].title}.`,
      options: [{ label: "Sort them out", panel: "leads" }, { label: "Show the most urgent lead", panel: "lead-detail", focusId: s.freshLeads[0].id }, { label: "Let AI prepare all responses", panel: "lead-replies" }, { label: "Remind me later", snooze: true }] });
  }
  if (snap.sources.conversations && s.unreadThreads.length) {
    const n = s.unreadThreads.length;
    out.push({ id: "unread", employee: "receptionist", urgency: 75, mood: "concerned", count: n,
      line: pick([`Boss, ${plural(n, "customer")} messaged and we haven't read ${n === 1 ? "it" : "them"} yet.`, `Our inbox is pinging — ${plural(n, "unread conversation")}.`], seed + "u" + n),
      detail: `Latest: ${s.unreadThreads[0].name || "a customer"} — “${s.unreadThreads[0].preview.slice(0, 70)}”`,
      options: [{ label: "Open conversations", panel: "conversations" }, { label: "Remind me later", snooze: true }] });
  }
  if (snap.sources.crm && s.recentWins.length) {
    const n = s.recentWins.length;
    out.push({ id: "wins", employee: "sales", urgency: 30, mood: "cheerful", count: n,
      line: pick([`We've just won ${n === 1 ? "another job" : `${say(n)} jobs`}!`, `We got it! The team's going to be busy!`, `Ka-ching on the pipeline — ${plural(n, "job")} won!`], seed + "w" + n),
      detail: s.recentWins.map((l) => l.name || l.title).slice(0, 3).join(", "), options: [{ label: "See the pipeline", panel: "leads" }, { label: "Nice one!", snooze: true }] });
  }
  if (snap.sources.crm && s.staleDeals.length) {
    const n = s.staleDeals.length;
    out.push({ id: "stale", employee: "sales", urgency: 55, mood: "concerned", count: n,
      line: pick([`Boss, ${plural(n, "deal")} ${n === 1 ? "has" : "have"} gone quiet for a week. Shall we chase?`, `${cap(plural(n, "opportunity", "opportunities"))} need${n === 1 ? "s" : ""} a nudge before ${n === 1 ? "it goes" : "they go"} cold.`], seed + "s" + n),
      detail: s.staleDeals.slice(0, 3).map((l) => `${l.name || l.title} (${l.stage})`).join(", "), options: [{ label: "Review deals", panel: "leads" }, { label: "Remind me later", snooze: true }] });
  }
  if (snap.sources.invoicing && (s.draftInvoices.length || s.overdueInvoices.length)) {
    const d = s.draftInvoices.length, o = s.overdueInvoices.length;
    out.push({ id: "invoices", employee: "accountant", urgency: o ? 80 : 60, mood: o ? "concerned" : "calm", count: d + o,
      line: o && d ? `Boss, ${plural(d, "invoice")} ready to send and ${plural(o, "invoice")} overdue.` : o ? pick([`${cap(plural(o, "invoice"))} ${o === 1 ? "is" : "are"} overdue, boss. Time for a polite chase?`, `Someone owes us money! ${cap(plural(o, "overdue invoice"))}.`], seed + "o" + o) : pick([`Boss, we've got ${plural(d, "invoice")} ready to send!`, `${cap(plural(d, "draft invoice"))} sitting on my desk.`], seed + "d" + d),
      detail: [...s.overdueInvoices, ...s.draftInvoices].slice(0, 3).map((i) => `${i.number} · ${i.clientName}`).join(", "), options: [{ label: "Review invoices", panel: "invoicing" }, { label: "Remind me later", snooze: true }] });
  }
  if (snap.sources.invoicing && s.recentPaid.length) {
    out.push({ id: "paid", employee: "accountant", urgency: 25, mood: "cheerful", count: s.recentPaid.length,
      line: pick(["CHA-CHING! We've just been paid, boss!", "Payment landed! Love to see it.", "Money in the bank — invoice paid!"], seed + "p"),
      detail: s.recentPaid.map((i) => `${i.number} · ${i.clientName}`).slice(0, 3).join(", "), options: [{ label: "See invoices", panel: "invoicing" }, { label: "Brilliant", snooze: true }] });
  }
  if (snap.sources.books && s.expensesNoReceipt.length) {
    const n = s.expensesNoReceipt.length;
    out.push({ id: "receipts", employee: "accountant", urgency: 40, mood: "calm", count: n,
      line: `We've got ${plural(n, "expense")} this month with no receipt attached.`, detail: s.expensesNoReceipt.slice(0, 3).map((e) => e.description).join(", "),
      options: [{ label: "Record a receipt", panel: "expense" }, { label: "Open Books", panel: "books" }, { label: "Remind me later", snooze: true }] });
  }
  if (snap.sources.tasks && (s.overdueTasks.length || s.dueTodayTasks.length)) {
    const o = s.overdueTasks.length, d = s.dueTodayTasks.length;
    out.push({ id: "tasks", employee: "projects", urgency: o ? 65 : 45, mood: o ? "concerned" : "calm", count: o + d,
      line: o ? `Boss, ${plural(o, "job task")} ${o === 1 ? "is" : "are"} overdue${d ? ` and ${say(d)} more due today` : ""}.` : `${cap(plural(d, "task"))} due today. Want the list?`,
      detail: [...s.overdueTasks, ...s.dueTodayTasks].slice(0, 3).map((t) => t.title).join(", "), options: [{ label: "Open the task list", panel: "tasks" }, { label: "Add a task", panel: "task" }, { label: "Remind me later", snooze: true }] });
  }
  if (snap.sources.scheduling && s.pastUnmarked.length) {
    const n = s.pastUnmarked.length;
    out.push({ id: "unmarked", employee: "calendar", urgency: 50, mood: "calm", count: n, line: `How did ${n === 1 ? `${s.pastUnmarked[0].name || "that appointment"} go` : `the last ${say(n)} appointments go`}? I still need to mark ${n === 1 ? "it" : "them"}.`,
      detail: s.pastUnmarked.slice(0, 3).map((b) => b.name).join(", "), options: [{ label: "Update appointments", panel: "scheduling" }, { label: "Remind me later", snooze: true }] });
  }
  if (snap.sources.scheduling && snap.hasCalendars) {
    const t = s.bookingsTomorrow.length;
    if (t === 0) out.push({ id: "quiet", employee: "calendar", urgency: 20, mood: "calm", count: 0, line: pick(["Tomorrow's looking quiet. Shall we fill the diary?", "Nothing booked for tomorrow yet, boss."], seed + "q"), detail: `${plural(s.bookingsToday.length, "appointment")} today.`, options: [{ label: "Open the calendar", panel: "scheduling" }, { label: "All good", snooze: true }] });
    else out.push({ id: "tomorrow", employee: "calendar", urgency: 15, mood: "cheerful", count: t, line: `${cap(plural(t, "appointment"))} in the diary for tomorrow!`, detail: s.bookingsTomorrow.slice(0, 3).map((b) => `${b.name} at ${b.startAt.slice(11, 16)}`).join(", "), options: [{ label: "View calendar", panel: "scheduling" }, { label: "Great", snooze: true }] });
  }
  return out.sort((a, b) => b.urgency - a.urgency);
}

/** Line for when there's nothing waiting. */
export function allClearLine(seed: string) {
  return pick(["Boss, everything's sorted. Go enjoy your coffee!", "All quiet on the business front. Nice work!", "Inbox zero, desk clear. We're flying!"], seed);
}

/** Celebration line for a freshly credited reward. */
export function reactionLine(kind: RewardKind, seed: string) {
  const lines: Record<RewardKind, string[]> = {
    lead_responded: ["Another customer looked after!", "Reply sent — they'll be chuffed.", "That's one happy customer."],
    follow_up: ["Follow-up done. Tidy!", "Ticked off the list!", "Nothing slips through the cracks here."],
    appointment_booked: ["Another booking in the diary!", "Diary's filling up nicely.", "Booked and confirmed!"],
    receipt_recorded: ["Phew! Another business expense documented. That could help reduce our taxable profit if it's eligible!", "Nice one! Our accounts are looking better already.", "Receipt filed. The accountant in me is purring."],
    invoice_sent: ["Invoice is out the door!", "Sent! Now we wait for the cha-ching.", "That invoice is on its way."],
    invoice_paid: ["CHA-CHING! We've just been paid, boss!", "Payment confirmed — real money in!", "Paid in full. Lovely stuff."],
    job_won: ["We got it! The team's going to be busy!", "Another job won!", "Get the van ready — we won the job!"],
    contact_added: ["New face in the address book!", "Another contact saved.", "The little black book grows."],
    note_logged: ["Notes keep us sharp!", "Good shout writing that down.", "Logged. Future you says thanks."],
    invoice_created: ["Invoice drafted — ready when you are.", "Fresh invoice on my desk!", "Drafted and waiting for a send."],
    expense_recorded: ["Expense noted. Pop a receipt on it for bonus coins!", "Books updated.", "Another one for the accounts."],
    ad_spend_logged: ["Ad spend synced into the books — no typing needed!", "Ads costs logged automatically.", "Marketing spend tracked. Tidy."],
    appointment_completed: ["Appointment done and dusted!", "Another visit completed.", "Job well done out there."],
  };
  return pick(lines[kind], seed);
}
export const EMPLOYEE_FOR_REWARD: Record<RewardKind, EmployeeId> = { lead_responded: "receptionist", follow_up: "projects", appointment_booked: "calendar", receipt_recorded: "accountant", invoice_sent: "accountant", invoice_paid: "accountant", job_won: "sales", contact_added: "receptionist", note_logged: "sales", invoice_created: "accountant", expense_recorded: "accountant", ad_spend_logged: "marketing", appointment_completed: "calendar" };

/** "Welcome back" walkthrough: one step per employee explaining exactly which real work earned the coins. */
export type WalkStep = { employee: EmployeeId; line: string; items: string[]; coins: number; xp: number; keys: string[] };
export function rewardWalkthrough(pending: Array<{ key: string; kind: string; coins: number; xp: number; label: string }>, seed: string): WalkStep[] {
  const by = new Map<EmployeeId, WalkStep>();
  for (const p of pending) {
    const kind = (p.kind in REWARDS ? p.kind : "follow_up") as RewardKind;
    const emp = EMPLOYEE_FOR_REWARD[kind];
    const step = by.get(emp) || { employee: emp, line: "", items: [], coins: 0, xp: 0, keys: [] };
    step.items.push(`${p.label} (+${p.coins})`); step.coins += p.coins; step.xp += p.xp; step.keys.push(p.key);
    if (!step.line) step.line = reactionLine(kind, seed + p.key);
    by.set(emp, step);
  }
  return [...by.values()].sort((a, b) => b.coins - a.coins);
}

// ───────────────────────────── Character (industry → outfit) ─────────────────────────────
export type Industry = "construction" | "roofing" | "electrician" | "plumber" | "tattoo" | "dentist" | "hairdresser" | "mechanic" | "interiors" | "agency" | "general";
export const INDUSTRIES: Record<Industry, { label: string; hat: "hardhat" | "cap" | "none" | "beanie"; tool: "hammer" | "drill" | "wrench" | "tattoo" | "mirror" | "scissors" | "swatch" | "laptop" | "clipboard"; outfit: "hivis" | "overalls" | "scrubs" | "apron" | "smart" | "casual" }> = {
  construction: { label: "Construction", hat: "hardhat", tool: "hammer", outfit: "hivis" },
  roofing: { label: "Roofing", hat: "hardhat", tool: "hammer", outfit: "hivis" },
  electrician: { label: "Electrician", hat: "cap", tool: "drill", outfit: "overalls" },
  plumber: { label: "Plumber", hat: "cap", tool: "wrench", outfit: "overalls" },
  tattoo: { label: "Tattoo studio", hat: "beanie", tool: "tattoo", outfit: "apron" },
  dentist: { label: "Dentist", hat: "none", tool: "mirror", outfit: "scrubs" },
  hairdresser: { label: "Hairdresser", hat: "none", tool: "scissors", outfit: "apron" },
  mechanic: { label: "Mechanic", hat: "cap", tool: "wrench", outfit: "overalls" },
  interiors: { label: "Interior design", hat: "none", tool: "swatch", outfit: "smart" },
  agency: { label: "Agency / office", hat: "none", tool: "laptop", outfit: "smart" },
  general: { label: "Other business", hat: "none", tool: "clipboard", outfit: "casual" },
};
/** Best guess from the business name/website text. The owner can always correct it. */
export function guessIndustry(text: string): Industry {
  const t = text.toLowerCase();
  const rules: Array<[Industry, RegExp]> = [
    ["roofing", /roof|slat|gutter/], ["electrician", /electric|sparky|solar|ev charg/], ["plumber", /plumb|heating|boiler/],
    ["tattoo", /tattoo|ink|pierc/], ["dentist", /dent|orthodon|smile clinic/], ["hairdresser", /hair|barber|salon|beauty/],
    ["mechanic", /mechanic|garage|motor|auto|tyre/], ["interiors", /interior|kitchen|bathroom|furnish|design studio/],
    ["construction", /build|construct|driveway|paving|landscap|carpent|joiner|plaster/], ["agency", /media|agency|marketing|digital|software|consult/],
  ];
  for (const [industry, re] of rules) if (re.test(t)) return industry;
  return "general";
}

// ───────────────────────────── Natural-language commands (deterministic first) ─────────────────────────────
export type CommandIntent = { panel?: PanelKind; answer?: string; needsAi?: boolean; label: string };
/** Recognises the common commands without AI. Unknown phrasing returns needsAi so the server can ask the AI to map it. */
export function parseCommand(text: string, snap: OwSnapshot): CommandIntent {
  const t = text.toLowerCase().trim();
  const s = derived(snap); const fin = financialSummary(snap);
  const money = (by: Record<string, number>) => Object.keys(by).length ? Object.entries(by).map(([c, v]) => `${c} ${v.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(" + ") : "nothing yet";
  if (/earn|made|income|revenue|paid.*month/.test(t)) {
    if (!snap.sources.invoicing) return { label: "Earnings", answer: "Invoicing isn't connected for this account, so I can't see confirmed payments yet." };
    return { label: "Earnings this month", answer: `Confirmed paid invoices this month: ${money(fin.paidThisMonth)}. Still outstanding: ${money(fin.outstanding)}. (Only invoices marked paid count as money received.)`, panel: "invoicing" };
  }
  if (/what should i|today|to.?do|priorit/.test(t)) {
    const top = briefing(snap).slice(0, 3);
    return { label: "Today's priorities", answer: top.length ? top.map((a, i) => `${i + 1}. ${EMPLOYEES[a.employee].title}: ${a.line}`).join("\n") : allClearLine(s.today) };
  }
  if (/haven.?t replied|not replied|unanswered|no reply|replied to/.test(t)) return { label: "Waiting for a reply", panel: "leads", answer: `${plural(s.freshLeads.length, "lead")} not contacted yet and ${plural(s.unreadThreads.length, "unread conversation")}.` };
  if (/prepare repl|draft repl|reply to (all|every)/.test(t)) return { label: "AI-prepared replies", panel: "lead-replies" };
  if (/overdue invoice|chase/.test(t)) return { label: "Overdue invoices", panel: "invoicing", answer: `${plural(s.overdueInvoices.length, "overdue invoice")}. Open each one to send a reminder — nothing is sent without your approval.` };
  if (/invoice/.test(t)) return { label: "Invoices", panel: "invoicing" };
  if (/receipt|expense/.test(t)) return { label: "Record a receipt", panel: "expense" };
  if (/quot|proposal|accepted/.test(t)) return { label: "Quotes & proposals", panel: "leads" };
  if (/book|appointment|meeting|schedul|diary|calendar|consult|site visit/.test(t)) return { label: "Scheduling", panel: "scheduling" };
  if (/photo|upload|project|job/.test(t)) return { label: "Project tasks", panel: "tasks" };
  if (/message|conversation|sms|whatsapp|email/.test(t)) return { label: "Conversations", panel: "conversations" };
  if (/contact|customer|lead/.test(t)) return { label: "Contacts", panel: "contacts" };
  if (/task/.test(t)) return { label: "Tasks", panel: "tasks" };
  return { label: "Ask AI", needsAi: true };
}
export const PANELS: PanelKind[] = ["leads", "contacts", "conversations", "scheduling", "invoicing", "books", "expense", "tasks", "task", "lead-replies", "lead-detail"];
