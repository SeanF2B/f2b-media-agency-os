import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import * as E from "@/lib/onboarding/engine.mjs";
import { OnboardingError, agencyOwner, ensureOnboardingSchema, getSettings, saveSettings, saveStripeSecrets, linkSecret, createSession, getSession, updateSession, getProfile, saveProfile, aiAssist, sourceTextOf, publicProfile } from "@/lib/onboarding/server";

// Agency OS (admin) side of the onboarding engine: settings (limits, pricing, Stripe test/live, embed sites),
// personalised links for CRM contacts / cold email / referrals / staff, onboarding sessions and conversion stats,
// and the shared AI helper used by the internal wizard. Owner/admin only.
export const dynamic = "force-dynamic";
type Row = Record<string, any>;
const reply = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function admin() {
  const user = await getChatGPTUser();
  if (!user) throw new OnboardingError("Sign in first.", 401);
  const { ownerId, workspace } = await agencyOwner();
  const staff = (workspace.staff || []).find((item: Row) => !item.isBot && (item.id === user.userId || String(item.email || "").toLowerCase() === user.email.toLowerCase()));
  const isAdmin = ownerId === user.userId || workspace.ownerId === user.userId || ["Owner", "Admin"].includes(String(staff?.role || ""));
  const member = isAdmin || Boolean(staff);
  return { user, ownerId, workspace, isAdmin, member, name: String(staff?.name || user.email) };
}

export async function GET(request: Request) {
  try {
    const auth = await admin();
    if (!auth.isAdmin) throw new OnboardingError("Only an owner or admin can view onboarding.", 403);
    await ensureOnboardingSchema();
    const url = new URL(request.url);
    // Contact picker for personalised links: one small bounded query, not the full CRM load.
    const contactQuery = (url.searchParams.get("contacts") || "").trim().toLowerCase().slice(0, 80);
    if (contactQuery.length >= 2) {
      const like = `%${contactQuery.replace(/[%_]/g, "")}%`;
      const found = await env.DB!.prepare("SELECT id, first_name, last_name, email, company FROM crm_contacts WHERE owner_id = ?1 AND (lower(email) LIKE ?2 OR lower(company) LIKE ?2 OR lower(first_name || ' ' || last_name) LIKE ?2) ORDER BY updated_at DESC LIMIT 8").bind(auth.ownerId, like).all<Row>();
      return reply({ contacts: (found.results || []).map((row) => ({ id: row.id, name: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email, email: row.email || "", company: row.company || "" })) });
    }
    const settings = await getSettings(auth.ownerId);
    const since = new Date(Date.now() - Math.min(365, Math.max(1, Number(url.searchParams.get("days")) || 30)) * 86_400_000).toISOString();
    const rows = (await env.DB!.prepare("SELECT id, entry_route, status, step, domain, acquisition, contact_id, client_id, opportunity_id, audit_id, unlocked, consent_contact, booking_status, payment_status, subscription_status, json_extract(answers, '$.businessName') AS business, json_extract(answers, '$.email') AS email, staff, created_at, updated_at FROM onboarding_sessions WHERE owner_id = ?1 AND created_at >= ?2 AND entry_route != 'internal' ORDER BY updated_at DESC LIMIT 200").bind(auth.ownerId, since).all<Row>()).results || [];
    const sessions = rows.map((row) => ({ ...row, acquisition: (() => { try { return JSON.parse(row.acquisition || "{}"); } catch { return {}; } })() }));
    const by = (key: (row: Row) => string) => sessions.reduce((acc: Record<string, { started: number; leads: number; audits: number; booked: number; paid: number }>, row) => {
      const k = key(row) || "Unknown"; acc[k] ||= { started: 0, leads: 0, audits: 0, booked: 0, paid: 0 };
      acc[k].started++; if (row.consent_contact) acc[k].leads++; if (row.audit_id) acc[k].audits++; if (row.booking_status) acc[k].booked++; if (row.payment_status === "paid") acc[k].paid++;
      return acc;
    }, {});
    return reply({ settings, sessions: sessions.slice(0, 100), stats: { byRoute: by((row) => row.entry_route), byChannel: by((row) => row.acquisition?.channel), total: by(() => "All").All || { started: 0, leads: 0, audits: 0, booked: 0, paid: 0 } }, webhookUrl: `${url.origin}/api/marketing-public/stripe`, startUrl: `${url.origin}/f/start` });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const auth = await admin();
    const body = await request.json().catch(() => null) as Row | null;
    if (!body) return reply({ error: "Invalid request." }, 400);
    const action = String(body.action || "");
    // The shared AI helper is open to workspace members (the internal wizard uses it); everything else is admin-only.
    if (action === "ai") {
      if (!auth.member) throw new OnboardingError("Only workspace members can use AI suggestions.", 403);
      return reply(await internalAi(auth.ownerId, auth.workspace, body));
    }
    if (!auth.isAdmin) throw new OnboardingError("Only an owner or admin can manage onboarding.", 403);
    switch (action) {
      case "settings": return reply({ settings: await saveSettings(auth.ownerId, body.settings || {}) });
      case "stripe": return reply({ settings: await saveStripeSecrets(auth.ownerId, { testKey: body.testKey, testWebhook: body.testWebhook, liveKey: body.liveKey, liveWebhook: body.liveWebhook, mode: body.mode }) });
      case "link": return reply(await makeLink(request, auth.ownerId, body));
      case "record_internal": return reply(await recordInternal(auth.ownerId, auth.name, body));
      default: return reply({ error: "Unknown action." }, 400);
    }
  } catch (error) { return failure(error); }
}
function failure(error: unknown) {
  if (error instanceof OnboardingError) return reply({ error: error.message }, error.status);
  console.error("onboarding:admin", error);
  return reply({ error: error instanceof Error ? error.message : "Something went wrong." }, 500);
}

/** Personalised links: from a CRM contact (prefilled), for cold email, for referrals, or a staff link (higher limits). */
async function makeLink(request: Request, ownerId: string, body: Row) {
  const kind = ["crm", "cold_email", "referral", "staff"].includes(String(body.kind)) ? String(body.kind) as "crm" | "cold_email" | "referral" | "staff" : "crm";
  const route = ["grow", "audit", "guidance"].includes(String(body.route)) ? String(body.route) : "";
  const days = Math.max(1, Math.min(180, Math.floor(Number(body.days) || (kind === "staff" ? 7 : 60))));
  const payload: Row = { k: kind, e: Math.floor(Date.now() / 1000) + days * 86_400 };
  if (kind === "crm") {
    const contactId = String(body.contactId || "").slice(0, 80);
    const contact = contactId ? await env.DB!.prepare("SELECT id FROM crm_contacts WHERE owner_id = ?1 AND id = ?2").bind(ownerId, contactId).first<Row>() : null;
    if (!contact) throw new OnboardingError("Choose a CRM contact.", 404);
    payload.c = contactId;
  }
  if (kind === "referral" && body.ref) payload.r = String(body.ref).replace(/[^\w.-]/g, "").slice(0, 60);
  if (kind === "staff") {
    // A staff session is created up front so the higher limits travel with it.
    const session = await createSession(ownerId, { route: route || "audit", acquisition: { channel: "Staff" }, visitor: "staff", staff: true, createdBy: "staff-link" });
    payload.s = session.id;
  }
  const token = await E.makeLinkToken(linkSecret(), payload as E.LinkPayload);
  const origin = new URL(request.url).origin;
  const query = new URLSearchParams();
  if (route) query.set("route", route);
  if (kind === "cold_email") { query.set("utm_source", "outreach"); query.set("utm_medium", "email"); if (body.campaign) query.set("utm_campaign", String(body.campaign).slice(0, 80)); }
  return { url: `${origin}/f/start/${token}${query.size ? `?${query}` : ""}`, expiresInDays: days };
}

/** The internal wizard records its run in the same engine (sessions + shared business profile). */
async function recordInternal(ownerId: string, by: string, body: Row) {
  const answers = E.cleanAnswers({ ...(body.answers || {}), businessName: body.client?.name, contactName: body.client?.contact, email: body.client?.email, phone: body.client?.phone, website: body.client?.website, servicesWanted: body.answers?.services });
  const clientId = String(body.clientId || "").slice(0, 120) || null;
  await ensureOnboardingSchema();
  const existing = clientId ? await env.DB!.prepare("SELECT id FROM onboarding_sessions WHERE owner_id = ?1 AND client_id = ?2 AND entry_route = 'internal' ORDER BY updated_at DESC LIMIT 1").bind(ownerId, clientId).first<Row>() : null;
  let session = existing ? await getSession(ownerId, String(existing.id)) : null;
  if (!session) session = await createSession(ownerId, { route: "internal", acquisition: { channel: "Agency OS" }, visitor: "internal", staff: true, createdBy: by, answers, clientId });
  else session = await updateSession(session, { answers: { ...session.answers, ...answers }, domain: E.normaliseDomain(answers.website) || session.domain });
  session = await updateSession(session, { status: "client", step: "done", domain: E.normaliseDomain(answers.website) || session.domain });
  const domain = session.domain;
  if (domain) {
    const { profile } = await getProfile(ownerId, domain);
    await saveProfile(ownerId, domain, E.mergeProfile(profile, E.profileFromAnswers(answers), "manual"));
  }
  return { ok: true, sessionId: session.id };
}

/** AI field help for the internal wizard and Operations fields: same actions and claim guard as the public funnel. */
async function internalAi(ownerId: string, workspace: Row, body: Row) {
  const client = (workspace.clients || []).find((item: Row) => item.id === body.clientId) || null;
  const website = String(client?.website || client?.wordpressSiteUrl || body.website || "");
  const { profile } = await getProfile(ownerId, E.normaliseDomain(website));
  const business = client ? { name: client.name, services: (client.services || []).map((service: Row) => service.name), serviceAreas: client.seoLocations || [], website, industry: client.industry || "", ...Object.fromEntries(Object.entries(publicProfile(profile)).map(([key, value]) => [key, (value as Row).value])) } : null;
  return aiAssist(ownerId, { action: String(body.mode || body.action_name || "suggest"), field: String(body.field || "").slice(0, 120), label: String(body.field || ""), kind: String(body.kind || ""), current: String(body.current || ""), previous: String(body.previous || ""), list: Boolean(body.list), business, sourceText: sourceTextOf(profile), audience: "agency", page: String(body.page || ""), placeholder: String(body.placeholder || ""), context: Array.isArray(body.context) ? body.context.slice(0, 12).map((item: Row) => ({ label: String(item.label || "").slice(0, 80), value: String(item.value || "").slice(0, 300) })) : [] });
}
