import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { crmScopeFrom } from "@/lib/client-accounts/client-accounts-api";
import { loadSchedulingWorkspace, schedulingDeps, SCHED_MANAGER_ROLES, SCHED_ROLES } from "@/lib/scheduling/context";
import { googleSchedulingAvailable, startGoogleConnect, disconnectGoogle } from "@/lib/scheduling/google";
import {
  SchedulingError, availableSlots, createBooking, deleteCalendar, getBooking, getCalendar, getStaffSettings, listBookings, listCalendars,
  saveCalendar, saveStaffSettings, staffFeedToken, updateBooking,
} from "@/lib/scheduling/server";

export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const fail = (error: string, status = 400) => json({ error }, status);
const str = (v: unknown, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");

async function context(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return { response: fail("Sign in to use Scheduling.", 401) };
  if (!env.DB) return { response: fail("The workspace database is unavailable.", 503) };
  const ws = await loadSchedulingWorkspace();
  if (!ws) return { response: fail("The agency workspace could not be found.", 503) };
  const me = ws.staffRaw.find((s) => String(s.email || "").toLowerCase() === user.email.toLowerCase());
  const admin = ws.ownerId === user.userId || Boolean(me && ["Owner", "Admin"].includes(me.role || ""));
  const requested = (crmScopeFrom(request) as { clientId: string | null } | null)?.clientId ?? null;
  if (admin) {
    const scope = requested && ws.clients.some((c) => c.id === requested) ? requested : null; // null = agency view (everything)
    return { user, ws, me, admin, canManage: true, scope, staff: ws.staff };
  }
  const allowed = me && SCHED_ROLES.includes(me.role || "") && (!Array.isArray(me.pageAccess) || me.pageAccess.includes("Scheduling")) ? (me.clientAccessIds || []).filter((id) => ws.clients.some((c) => c.id === id)) : [];
  if (!allowed.length || !me) return { response: fail("You don't have access to Scheduling.", 403) };
  const scope = requested && allowed.includes(requested) ? requested : allowed[0];
  const staff = ws.staffRaw.filter((s) => s.id === me.id || (s.clientAccessIds || []).includes(scope)).map(({ id, name, email, role, avatar }) => ({ id, name, email, role, avatar }));
  return { user, ws, me, admin: false, canManage: SCHED_MANAGER_ROLES.includes(me.role || ""), scope, staff };
}
type Ctx = Exclude<Awaited<ReturnType<typeof context>>, { response: Response }>;

const inScope = (ctx: Ctx, clientId: string) => ctx.scope === null || clientId === ctx.scope;
const workspaceFor = (ctx: Ctx) => ({ ownerId: ctx.ws.ownerId, agencyName: ctx.ws.agencyName, clients: ctx.ws.clients, staff: ctx.ws.staff });

export async function GET(request: Request) {
  const ctx = await context(request);
  if ("response" in ctx) return ctx.response;
  const url = new URL(request.url);
  const db = env.DB as never;
  try {
    const connect = url.searchParams.get("connect");
    if (connect) {
      if (!googleSchedulingAvailable()) return Response.redirect(new URL("/?page=Scheduling&schedulingGoogle=not-configured", request.url));
      if (!(ctx.admin || ctx.me?.id === connect) || !ctx.ws.staff.some((s) => s.id === connect)) return Response.redirect(new URL("/?page=Scheduling&schedulingGoogle=not-allowed", request.url));
      return startGoogleConnect(request, connect);
    }
    const view = url.searchParams.get("view") || "";
    if (view === "calendars") return json({ calendars: (await listCalendars(db, ctx.ws.ownerId, ctx.scope)).map((c) => ({ id: c.id, name: c.name, clientId: c.clientId })) });
    if (view === "slots") {
      const cal = await getCalendar(db, ctx.ws.ownerId, str(url.searchParams.get("calendarId"), 80));
      if (!cal || !inScope(ctx, cal.clientId)) return fail("Booking calendar not found.", 404);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("date") || "") ? url.searchParams.get("date")! : new Date().toISOString().slice(0, 10);
      const staffId = str(url.searchParams.get("staffId"), 120) || undefined;
      const slots = await availableSlots(schedulingDeps(request), { ...cal, minNoticeMin: 0 }, { fromDate: date, days: Math.min(14, Number(url.searchParams.get("days")) || 1), staffId, excludeBookingId: str(url.searchParams.get("exclude"), 80) || undefined });
      return json({ slots });
    }
    const from = Date.parse(url.searchParams.get("from") || "") || Date.now() - 7 * 86_400_000;
    const to = Math.min(Date.parse(url.searchParams.get("to") || "") || Date.now() + 35 * 86_400_000, from + 120 * 86_400_000);
    const [calendars, bookings] = await Promise.all([listCalendars(db, ctx.ws.ownerId, ctx.scope), listBookings(db, ctx.ws.ownerId, ctx.scope, new Date(from).toISOString(), new Date(to).toISOString())]);
    const deps = schedulingDeps(request);
    const staffIds = ctx.staff.map((s) => s.id);
    const [settings, google] = await Promise.all([getStaffSettings(db, ctx.ws.ownerId, staffIds), deps.google ? deps.google.connected(ctx.ws.ownerId, staffIds) : Promise.resolve({} as Record<string, string>)]);
    const mine = (id: string) => ctx.admin || ctx.me?.id === id;
    const staff = ctx.staff.map((s) => {
      const av = settings.find((x) => x.staffId === s.id);
      return { ...s, timezone: av?.timezone, weekly: av?.weekly, blocked: av?.blocked, dailyLimit: av?.dailyLimit || 0, google: google[s.id] || "", feedUrl: mine(s.id) && av?.icsToken ? `${deps.baseUrl}/api/marketing-public/scheduling?ics=${av.icsToken}` : "", canEdit: mine(s.id) };
    });
    const clients = (ctx.scope === null ? ctx.ws.clients : ctx.ws.clients.filter((c) => c.id === ctx.scope)).map((c) => ({ id: c.id, name: c.name, logo: c.logo || "" }));
    return json({ calendars, bookings, staff, clients, scope: ctx.scope, canManage: ctx.canManage, isAdmin: ctx.admin, meId: ctx.me?.id || "", googleAvailable: googleSchedulingAvailable(), emailReady: Boolean(deps.sendEmail), publicBase: `${deps.baseUrl}/f/book/` });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Scheduling could not load.", error instanceof SchedulingError ? error.status : 500);
  }
}

export async function POST(request: Request) {
  const ctx = await context(request);
  if ("response" in ctx) return ctx.response;
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return fail("Invalid request."); }
  const db = env.DB as never;
  const ownerId = ctx.ws.ownerId;
  const by = ctx.me?.name || ctx.user.email;
  const deps = schedulingDeps(request);
  try {
    switch (body.action) {
      case "saveCalendar": {
        if (!ctx.canManage) return fail("Only an admin or sub-account manager can change booking calendars.", 403);
        const input = (body.calendar || {}) as Record<string, unknown>;
        if (ctx.scope !== null) input.clientId = ctx.scope;
        else if (input.clientId && !ctx.ws.clients.some((c) => c.id === input.clientId)) input.clientId = "";
        if (input.id) { const existing = await getCalendar(db, ownerId, str(input.id, 80)); if (!existing || !inScope(ctx, existing.clientId)) return fail("Booking calendar not found.", 404); }
        const allowedStaff = new Set(ctx.staff.map((s) => s.id));
        input.staffIds = Array.isArray(input.staffIds) ? (input.staffIds as unknown[]).map(String).filter((id) => allowedStaff.has(id)) : [];
        return json({ calendar: await saveCalendar(db, ownerId, input) });
      }
      case "deleteCalendar": {
        if (!ctx.canManage) return fail("Only an admin or sub-account manager can delete booking calendars.", 403);
        const cal = await getCalendar(db, ownerId, str(body.id, 80));
        if (!cal || !inScope(ctx, cal.clientId)) return fail("Booking calendar not found.", 404);
        await deleteCalendar(db, ownerId, cal.id);
        return json({ ok: true });
      }
      case "saveAvailability": {
        const staffId = str(body.staffId, 120);
        if (!ctx.staff.some((s) => s.id === staffId) || !(ctx.admin || ctx.canManage || ctx.me?.id === staffId)) return fail("You can only change your own availability.", 403);
        return json({ availability: await saveStaffSettings(db, ownerId, staffId, body) });
      }
      case "rotateFeed": case "createFeed": {
        const staffId = str(body.staffId, 120);
        if (!(ctx.admin || ctx.me?.id === staffId) || !ctx.staff.some((s) => s.id === staffId)) return fail("You can only manage your own calendar feed.", 403);
        const t = await staffFeedToken(db, ownerId, staffId, body.action === "rotateFeed");
        return json({ feedUrl: `${deps.baseUrl}/api/marketing-public/scheduling?ics=${t}` });
      }
      case "disconnectGoogle": {
        const staffId = str(body.staffId, 120);
        if (!(ctx.admin || ctx.me?.id === staffId)) return fail("You can only disconnect your own calendar.", 403);
        await disconnectGoogle(ownerId, staffId);
        return json({ ok: true });
      }
      case "book": {
        const cal = await getCalendar(db, ownerId, str(body.calendarId, 80));
        if (!cal || !inScope(ctx, cal.clientId)) return fail("Booking calendar not found.", 404);
        const staffIds = Array.isArray(body.staffIds) ? (body.staffIds as unknown[]).map(String).filter((id) => ctx.staff.some((s) => s.id === id)) : [];
        const force = Boolean(body.force) && staffIds.length > 0;
        // Several people picked by hand = book them together (only when all are free).
        const together = !force && staffIds.length > 1;
        const result = await createBooking(deps, {
          cal: { ...cal, minNoticeMin: 0, maxDaysAhead: 730, dailyLimit: force ? 0 : cal.dailyLimit, ...(together ? { assignMode: "collective" as const, staffIds } : { staffIds: [...new Set([...cal.staffIds, ...staffIds])] }) },
          start: str(body.start, 40), staffId: !force && staffIds.length === 1 ? staffIds[0] : undefined, staffIds, skipAvailability: force,
          name: str(body.name, 120), email: str(body.email, 160), phone: str(body.phone, 40), notes: str(body.notes, 2000),
          answers: (body.answers && typeof body.answers === "object" ? body.answers : {}) as Record<string, unknown>,
          source: "internal", createdBy: by, workspace: workspaceFor(ctx), notifyCustomer: body.notify !== false,
        });
        return json({ booking: result.booking });
      }
      case "updateBooking": {
        const row = await getBooking(db, ownerId, str(body.id, 80));
        if (!row || !inScope(ctx, row.client_id)) return fail("Appointment not found.", 404);
        const staffIds = Array.isArray(body.staffIds) ? (body.staffIds as unknown[]).map(String).filter((id) => ctx.staff.some((s) => s.id === id)) : undefined;
        const booking = await updateBooking(deps, ownerId, row.id, { status: str(body.status, 20) || undefined, start: str(body.start, 40) || undefined, staffIds, notes: typeof body.notes === "string" ? body.notes : undefined, by, notify: body.notify !== false }, workspaceFor(ctx));
        return json({ booking });
      }
      default: return fail("Unknown action.");
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Something went wrong.", error instanceof SchedulingError ? error.status : 500);
  }
}
