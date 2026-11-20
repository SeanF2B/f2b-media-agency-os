// Public Scheduling endpoints (no sign-in; sits under the approved /api/marketing-public* Access bypass).
// GET  ?cal=<slug>                         booking calendar + who can be picked
// GET  ?cal=<slug>&date=YYYY-MM-DD&days=7  free slots (optionally &staffId=)
// GET  ?manage=<token>                     the customer's own appointment
// GET  ?ics=<token>                        private iCal feed for one staff member (Apple / Outlook / Google subscribe)
// POST {action:"book"|"cancel"|"reschedule"}
import { env } from "cloudflare:workers";
import { loadSchedulingWorkspace, schedulingDeps } from "@/lib/scheduling/context";
import { SchedulingError, getStaffProfiles, publicProfile, reviewLinkOwner, addCollectedReview, availableSlots, cancelBooking, createBooking, getBookingByToken, getCalendar, getCalendarBySlug, icsFeed, updateBooking, bookingView } from "@/lib/scheduling/server";
import { getGroupBySlug } from "@/lib/scheduling/groups";
import { listGoogleReviews, reviewsMentioning } from "@/lib/content-publish";
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

// Sample reviews for demos (Sample data in the OS → booking page Preview adds ?sample=1). Never shown on real links.
const SAMPLE_REVIEWS = ["Honestly the best experience — so friendly and really took the time to get it right.", "Brilliant from start to finish. Would recommend to anyone.", "Super professional, on time and the result was even better than I hoped."];
async function publicCalendar(info: NonNullable<Awaited<ReturnType<typeof publicInfo>>>, sample = false) {
  const { cal, ws, client } = info;
  const profiles = await getStaffProfiles(env.DB as never, cal.ownerId, cal.staffIds).catch(() => ({} as Record<string, never>));
  // Google Business Profile reviews that mention each team member by name (cached; best effort).
  const google = cal.clientId ? await listGoogleReviews(cal.ownerId, cal.clientId).catch(() => []) : [];
  const img = (u?: string) => /^(https:|data:image\/|\/media\/)/.test(u || "") ? u : "";
  const settingsStaff = ws.staff.filter((s) => cal.staffIds.includes(s.id));
  return {
    calendar: { slug: cal.slug, name: cal.name, kind: cal.kind, description: cal.description, durationMin: cal.durationMin, location: locationLabel(cal.locationType, cal.locationType === "onsite" ? "" : cal.locationDetail), price: cal.price, currency: cal.currency, color: cal.color, assignMode: cal.assignMode, questions: cal.questions, timezone: cal.timezone, maxDaysAhead: cal.maxDaysAhead, redirectUrl: cal.redirectUrl, confirmationMessage: cal.confirmationMessage },
    staff: settingsStaff.map((s) => {
      const name = s.name.split("|")[0].trim();
      const base = publicProfile(profiles[s.id]);
      const fromGoogle = reviewsMentioning(google, name).slice(0, 10).map((r) => ({ author: r.author, rating: r.rating, text: r.text, source: "Google", date: r.at.slice(0, 10) }));
      const demo = sample && !fromGoogle.length && !(base?.reviews || []).length ? SAMPLE_REVIEWS.map((text, i) => ({ author: ["Aoife B.", "Ciarán D.", "Megan W."][i], rating: 5, text, source: "Google", date: "" })) : [];
      const reviews = [...fromGoogle, ...(base?.reviews || []), ...demo].slice(0, 30);
      const p = base || reviews.length ? { title: base?.title || "", bio: base?.bio || "", photos: base?.photos || [], reviews, reviewCount: reviews.length, rating: reviews.length ? Math.round((reviews.reduce((n, r) => n + r.rating, 0) / reviews.length) * 10) / 10 : 0 } : null;
      return { id: s.id, name, avatar: img(s.avatar), title: p?.title || (s.name.includes("|") ? s.name.split("|")[1].trim() : ""), profile: p };
    }),
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
    const review = url.searchParams.get("review");
    if (review) {
      const link = await reviewLinkOwner(env.DB as never, review);
      const ws = link ? await loadSchedulingWorkspace() : null;
      const person = ws?.staff.find((s) => s.id === link?.staff_id);
      if (!link || !ws || !person) return fail("This review link isn't active any more.", 404);
      const profile = (await getStaffProfiles(env.DB as never, link.owner_id, [person.id]))[person.id];
      const reviews = profile?.reviews || [];
      return json({ staff: { name: person.name.split("|")[0].trim(), title: profile?.title || (person.name.includes("|") ? person.name.split("|")[1].trim() : ""), bio: profile?.bio || "", avatar: /^(https:|data:image\/|\/media\/)/.test(person.avatar || "") ? person.avatar : "", rating: reviews.length ? Math.round((reviews.reduce((n, r) => n + r.rating, 0) / reviews.length) * 10) / 10 : 0, reviewCount: reviews.length, photos: profile?.showPhotos ? profile.photos.slice(0, 8) : [], recent: profile?.showReviews ? reviews.slice(0, 2).map((r) => ({ author: r.author, rating: r.rating, text: r.text })) : [] }, business: { name: ws.agencyName || "F2B Media" } });
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
    const groupSlug = str(url.searchParams.get("group"), 64);
    if (groupSlug) {
      // Booking page: the services on it (active calendars only), each with picture, length, price and team.
      const g = /^[a-z0-9-]{1,64}$/.test(groupSlug) ? await getGroupBySlug(env.DB as never, groupSlug) : null;
      if (!g || !g.active) return fail("This booking page isn't available.", 404);
      const ws = await loadSchedulingWorkspace();
      const client = ws?.clients.find((c) => c.id === g.clientId) as (NonNullable<typeof ws>["clients"][number] & { status?: string }) | undefined;
      if (!ws || (client && /inactive/i.test(String(client.status || "")))) return fail("This booking page isn't available.", 404);
      const cals = (await Promise.all(g.calendarIds.map((id) => getCalendar(env.DB as never, g.ownerId, id)))).filter((c): c is NonNullable<typeof c> => Boolean(c && c.active));
      const avatar = (u?: string) => /^(https:|data:image\/|\/media\/)/.test(u || "") ? u : "";
      return json({
        group: { slug: g.slug, name: g.name, intro: g.intro },
        business: { name: client?.name || ws.agencyName || "F2B Media", logo: client?.logo && /^(https:|data:image\/)/.test(client.logo) ? client.logo : "", color: client?.branding?.primary && /^#[0-9a-f]{6}$/i.test(client.branding.primary) ? client.branding.primary : (cals[0]?.color || "#2563eb") },
        services: cals.map((c) => ({ slug: c.slug, name: c.name, description: c.description, durationMin: c.durationMin, price: c.price, currency: c.currency, color: c.color, location: locationLabel(c.locationType, c.locationType === "onsite" ? "" : c.locationDetail), image: g.images[c.id] || c.image || "", staff: ws.staff.filter((s) => c.staffIds.includes(s.id)).slice(0, 6).map((s) => ({ name: s.name.split("|")[0].trim(), avatar: avatar(s.avatar) })) })),
      });
    }
    const info = await publicInfo(str(url.searchParams.get("cal"), 64));
    if (!info) return fail("This booking page isn't available.", 404);
    const date = url.searchParams.get("date");
    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail("Invalid date.");
      const staffId = str(url.searchParams.get("staffId"), 120);
      if (url.searchParams.get("sample") === "1") {
        // Demo: plenty of free times every day so the flow can be shown (nothing is booked).
        const days = Math.min(14, Math.max(1, Number(url.searchParams.get("days")) || 7)); const out: Array<{ start: string; staffIds: string[] }> = [];
        for (let d = 0; d < days; d++) { const day = new Date(`${date}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + d); if (day.getTime() < Date.now() - 86_400_000) continue; for (const h of [9, 10, 11, 13, 14, 15, 16]) { const t = new Date(day); t.setUTCHours(h, (d + h) % 2 ? 30 : 0); if (t.getTime() > Date.now() + 3_600_000) out.push({ start: t.toISOString(), staffIds: info.cal.staffIds.slice(0, 1) }); } }
        return json({ slots: out });
      }
      const slots = await availableSlots(schedulingDeps(request), info.cal, { fromDate: date, days: Math.min(14, Math.max(1, Number(url.searchParams.get("days")) || 7)), staffId: staffId && info.cal.staffIds.includes(staffId) ? staffId : undefined, excludeBookingId: undefined });
      return json({ slots: slots.map((s) => ({ start: s.start, staffIds: s.staffIds })) });
    }
    return json({ ...(await publicCalendar(info, url.searchParams.get("sample") === "1")), sample: url.searchParams.get("sample") === "1" });
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
    if (body.action === "review") {
      if (str(body.website)) return json({ ok: true }); // honeypot
      const link = await reviewLinkOwner(env.DB as never, str(body.token, 80));
      if (!link) return fail("This review link isn't active any more.", 404);
      const rating = Math.round(Number(body.rating));
      if (!(rating >= 1 && rating <= 5)) return fail("Tap the stars to give a rating.");
      const author = str(body.author, 80);
      if (author.length < 2) return fail("Please add your name.");
      await addCollectedReview(env.DB as never, link.owner_id, link.staff_id, { author, rating, text: str(body.text, 800) });
      // Let the staff member know (best effort).
      const ws = await loadSchedulingWorkspace();
      const person = ws?.staff.find((s) => s.id === link.staff_id);
      if (deps.sendEmail && person?.email) await deps.sendEmail({ to: [person.email], subject: `New ${rating}★ review from ${author}`, html: `<p><b>${author.replace(/[<>&]/g, "")}</b> left you a ${"★".repeat(rating)} review:</p><blockquote>${str(body.text, 800).replace(/[<>&]/g, "") || "(no comment)"}</blockquote><p>It's been added to your booking profile.</p>`, text: `${author} left you a ${rating}-star review: ${str(body.text, 800) || "(no comment)"}`, fromName: ws?.agencyName || "F2B Media", idempotencyKey: `review/${link.staff_id}/${Date.now()}` }).catch(() => undefined);
      return json({ ok: true });
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
