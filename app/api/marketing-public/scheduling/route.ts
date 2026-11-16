// Public Scheduling endpoints (no sign-in; sits under the approved /api/marketing-public* Access bypass).
// GET  ?cal=<slug>                         booking calendar + who can be picked
// GET  ?cal=<slug>&date=YYYY-MM-DD&days=7  free slots (optionally &staffId=)
// GET  ?manage=<token>                     the customer's own appointment
// GET  ?ics=<token>                        private iCal feed for one staff member (Apple / Outlook / Google subscribe)
// POST {action:"book"|"cancel"|"reschedule"}
import { env } from "cloudflare:workers";
import { loadSchedulingWorkspace, schedulingDeps } from "@/lib/scheduling/context";
import { SchedulingError, getStaffProfiles, publicProfile, availableSlots, cancelBooking, createBooking, getBookingByToken, getCalendar, getCalendarBySlug, icsFeed, updateBooking, bookingView } from "@/lib/scheduling/server";
import { chooseStaff, locationLabel, utcToLocal } from "@/lib/scheduling/core";

export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
const fail = (error: string, status = 400) => json({ error }, status);
const str = (v: unknown, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");

// Best-effort abuse brake per isolate: 8 booking actions per IP per 10 minutes.
const hits = new Map<string, number[]>();
function limited(request: Request) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 600_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > 8;
}

async function publicInfo(slug: string) {
  const cal = /^[a-z0-9-]{1,64}$/.test(slug) ? await getCalendarBySlug(env.DB as never, slug) : null;
  if (!cal || !cal.active) return null;
  const ws = await loadSchedulingWorkspace();
  if (!ws) return null;
  const client = ws.clients.find((c) => c.id === cal.clientId) as (typeof ws.clients[number] & { status?: string }) | undefined;
  if (client && /inactive/i.test(String(client.status || ""))) return null;
  return { cal, ws, client };
}

async function publicCalendar(info: NonNullable<Awaited<ReturnType<typeof publicInfo>>>) {
  const { cal, ws, client } = info;
  const profiles = await getStaffProfiles(env.DB as never, cal.ownerId, cal.staffIds).catch(() => ({} as Record<string, never>));
  const img = (u?: string) => /^(https:|data:image\/|\/media\/)/.test(u || "") ? u : "";
  const settingsStaff = ws.staff.filter((s) => cal.staffIds.includes(s.id));
  return {
    calendar: { slug: cal.slug, name: cal.name, kind: cal.kind, description: cal.description, durationMin: cal.durationMin, location: locationLabel(cal.locationType, cal.locationType === "onsite" ? "" : cal.locationDetail), price: cal.price, currency: cal.currency, color: cal.color, assignMode: cal.assignMode, questions: cal.questions, timezone: cal.timezone, maxDaysAhead: cal.maxDaysAhead, redirectUrl: cal.redirectUrl, confirmationMessage: cal.confirmationMessage },
    staff: settingsStaff.map((s) => { const p = publicProfile(profiles[s.id]); return { id: s.id, name: s.name.split("|")[0].trim(), avatar: img(s.avatar), title: p?.title || (s.name.includes("|") ? s.name.split("|")[1].trim() : ""), profile: p }; }),
    business: { name: client?.name || ws.agencyName || "F2B Media", logo: client?.logo && /^(https:|data:image\/)/.test(client.logo) ? client.logo : "", color: client?.branding?.primary && /^#[0-9a-f]{6}$/i.test(client.branding.primary) ? client.branding.primary : cal.color, phone: client?.phone || "" },
  };
}

export async function GET(request: Request) {
  if (!env.DB) return fail("Bookings are unavailable right now.", 503);
  const url = new URL(request.url);
  try {
    const ics = url.searchParams.get("ics");
    if (ics) {
      const feed = await icsFeed(env.DB as never, ics, await loadSchedulingWorkspace());
      if (!feed) return new Response("Not found", { status: 404 });
      return new Response(feed, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=300", "Content-Disposition": "inline; filename=\"f2b-bookings.ics\"" } });
    }
    const manage = url.searchParams.get("manage");
    if (manage) {
      const row = await getBookingByToken(env.DB as never, manage);
      if (!row) return fail("We couldn't find that appointment.", 404);
      const cal = await getCalendar(env.DB as never, row.owner_id, row.calendar_id);
      const info = cal ? await publicInfo(cal.slug) : null;
      const ws = info?.ws || await loadSchedulingWorkspace();
      const b = bookingView(row);
      return json({ booking: { status: b.status, start: b.start, end: b.end, name: b.name, staff: b.staffIds.map((id) => ws?.staff.find((s) => s.id === id)?.name).filter(Boolean), meetLink: b.meetLink, canChange: b.status === "booked" && Date.parse(b.start) > Date.now() + 60 * 60_000 }, ...(info ? await publicCalendar(info) : { calendar: cal ? { slug: cal.slug, name: cal.name, timezone: cal.timezone } : null }) });
    }
    const info = await publicInfo(str(url.searchParams.get("cal"), 64));
    if (!info) return fail("This booking page isn't available.", 404);
    const date = url.searchParams.get("date");
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("Invalid date.");
      const staffId = str(url.searchParams.get("staffId"), 120);
      const slots = await availableSlots(schedulingDeps(request), info.cal, { fromDate: date, days: Math.min(14, Math.max(1, Number(url.searchParams.get("days")) || 7)), staffId: staffId && info.cal.staffIds.includes(staffId) ? staffId : undefined, excludeBookingId: undefined });
      return json({ slots: slots.map((s) => ({ start: s.start, staffIds: s.staffIds })) });
    }
    return json(await publicCalendar(info));
  } catch (error) {
    console.error("Public scheduling GET", error);
    return fail(error instanceof SchedulingError ? error.message : "Bookings are unavailable right now. Please try again shortly.", error instanceof SchedulingError ? error.status : 500);
  }
}

export async function POST(request: Request) {
  if (!env.DB) return fail("Bookings are unavailable right now.", 503);
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return fail("Invalid request."); }
  if (limited(request)) return fail("Too many attempts. Please wait a few minutes and try again.", 429);
  const deps = schedulingDeps(request);
  try {
    if (body.action === "book") {
      if (str(body.website)) return json({ ok: true }); // honeypot: bots fill hidden fields
      const info = await publicInfo(str(body.cal, 64));
      if (!info) return fail("This booking page isn't available.", 404);
      const staffId = str(body.staffId, 120);
      const result = await createBooking(deps, {
        cal: info.cal, start: str(body.start, 40), staffId: staffId && info.cal.staffIds.includes(staffId) ? staffId : undefined,
        name: str(body.name, 120), email: str(body.email, 160), phone: str(body.phone, 40), notes: str(body.notes, 2000),
        answers: (body.answers && typeof body.answers === "object" ? body.answers : {}) as Record<string, unknown>,
        attribution: (body.attribution && typeof body.attribution === "object" ? body.attribution : {}) as Record<string, string>, pageUrl: str(body.page, 500),
        source: "public", workspace: { ownerId: info.ws.ownerId, agencyName: info.ws.agencyName, clients: info.ws.clients, staff: info.ws.staff },
      });
      return json({ ok: true, manageUrl: `${deps.baseUrl}/f/book/manage?t=${result.manageToken}`, start: result.booking.start, staff: result.booking.staffIds.map((id) => info.ws.staff.find((s) => s.id === id)?.name).filter(Boolean), meetLink: result.booking.meetLink, redirectUrl: info.cal.redirectUrl });
    }
    if (body.action === "cancel" || body.action === "reschedule") {
      const row = await getBookingByToken(env.DB as never, str(body.token, 80));
      if (!row) return fail("We couldn't find that appointment.", 404);
      if (row.status !== "booked") return fail("This appointment can no longer be changed.", 409);
      if (Date.parse(row.start_at) < Date.now() + 60 * 60_000) return fail("It's too close to the appointment to change it online — please call us instead.", 409);
      const cal = await getCalendar(env.DB as never, row.owner_id, row.calendar_id);
      const ws = await loadSchedulingWorkspace();
      if (!cal || !ws) return fail("This appointment can't be changed online.", 409);
      const workspace = { ownerId: ws.ownerId, agencyName: ws.agencyName, clients: ws.clients, staff: ws.staff };
      if (body.action === "cancel") { await cancelBooking(deps, row, cal, "Cancelled by customer", workspace); return json({ ok: true }); }
      const start = str(body.start, 40);
      const startMs = Date.parse(start);
      if (!Number.isFinite(startMs)) return fail("Choose a new time.");
      const current = JSON.parse(row.staff_ids || "[]") as string[];
      const slots = await availableSlots(deps, cal, { fromDate: utcToLocal(startMs, cal.timezone).date, days: 1, excludeBookingId: row.id });
      const slot = slots.find((s) => Date.parse(s.start) === startMs);
      if (!slot) return fail("Sorry, that time has just been taken. Please pick another.", 409);
      const keep = current.every((id) => slot.staffIds.includes(id));
      const staffIds = keep ? current : cal.assignMode === "customer_pick" && current.length === 1 ? [] : chooseStaff(cal, slot, "", []);
      if (!staffIds.length) return fail(`${ws.staff.find((s) => s.id === current[0])?.name || "Your appointment's team member"} isn't free then. Please pick another time.`, 409);
      const booking = await updateBooking(deps, row.owner_id, row.id, { start: slot.start, staffIds, by: "Customer (online)" }, workspace);
      return json({ ok: true, start: booking.start });
    }
    return fail("Unknown action.");
  } catch (error) {
    if (!(error instanceof SchedulingError)) console.error("Public scheduling POST", error);
    return fail(error instanceof SchedulingError ? error.message : "Something went wrong. Please try again.", error instanceof SchedulingError ? error.status : 500);
  }
}
