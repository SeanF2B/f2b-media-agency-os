import handler from "vinext/server/fetch-handler";
import { logSystemEmail } from "../lib/email-log";
import { handleSiteLeadRoutes, isInternalCall } from "./site-lead";
import { processDueAiTasks, processDueFinanceRecurring } from "./scheduled-ai";
import { processDueMarketingAutomations } from "./marketing-automations";
import { processCrmAutomations } from "../lib/crm-automations/engine.ts";
import { processExpiredMarketingSubmissions } from "../lib/marketing-submission-retention";
import { processMonthlyClientReports } from "../lib/client-report-archive";
import { processOutreach } from "../lib/outreach/server/engine";
import { processEmailCampaigns } from "../lib/email-marketing/server";
import { getGoogleAdsCampaignMetrics, googleAdsConnectionReady, keepGoogleAdsTokensFresh } from "../lib/google-ads-direct";
import { ghlLocationRequest } from "../lib/gohighlevel-oauth";
import { deliverGhlMarketingMessage } from "../lib/marketing-automation-message.js";
import { processDailyMarketingSnapshots } from "../lib/marketing-daily-sync";
import { metaAdsConnectionExists, readDirectMetaAdsInsights } from "../lib/meta-ads-direct";
import { hasGoogleSearchConsoleConnection, readGoogleSearchConsoleRows } from "../lib/google-search-console-direct";
import { hasGoogleAnalyticsDirectConnection, readGoogleAnalyticsReport } from "../lib/google-analytics-direct";
import { autoLinkGoogleProperties } from "../lib/google-auto-link";
import { runWithConnectorBinding } from "../lib/connector-context";
import { actionFromRequest, clientIdFromRequest, featureFor, installUsageMeter, runWithUsage } from "../lib/usage-meter";
import type { ConnectorBinding } from "../lib/connector-contract.mjs";
import { isMarketingDomainVerified, marketingCustomDomainPageUrl, normalizeMarketingHostname } from "../lib/marketing-custom-domain.js";

type AccessIdentity = { email?: string; name?: string };
type AccessContext = ExecutionContext<{ CONNECTORS?: ConnectorBinding }> & {
  access?: { getIdentity(): Promise<AccessIdentity | null> };
};

type AccessTokenPayload = {
  email?: string;
  name?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
};

const accessKeys = new Map<
  string,
  { expiresAt: number; promise: Promise<CryptoKey | null> }
>();
// Access JWTs are sent with every same-session API request. Cache only a
// successfully verified token briefly per isolate so bursts of workspace
// requests do not repeat an expensive RSA signature check each time.
const verifiedAccessTokens = new Map<
  string,
  { expiresAt: number; identity: AccessIdentity }
>();

async function verifyAccessToken(
  token: string | null,
  teamDomain: string | undefined,
  audience: string | undefined,
): Promise<AccessIdentity | null> {
  if (!token || !teamDomain || !audience) return null;
  try {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
    if (!encodedHeader || !encodedPayload || !encodedSignature) return null;
    const header = decodeJwtPart<{ alg?: string; kid?: string }>(encodedHeader);
    const payload = decodeJwtPart<AccessTokenPayload>(encodedPayload);
    if (header.alg !== "RS256" || !header.kid) return null;

    const issuer = new URL(teamDomain);
    if (issuer.protocol !== "https:" || issuer.pathname !== "/") return null;
    if (payload.iss !== issuer.origin) return null;
    const tokenAudiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!tokenAudiences.includes(audience)) return null;
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== "number" || payload.exp <= now) return null;
    if (typeof payload.nbf === "number" && payload.nbf > now) return null;
    if (!payload.email || typeof payload.email !== "string") return null;

    const cacheKey = `${audience}\u0000${token}`;
    const cachedIdentity = verifiedAccessTokens.get(cacheKey);
    if (cachedIdentity && cachedIdentity.expiresAt > now) {
      verifiedAccessTokens.delete(cacheKey);
      verifiedAccessTokens.set(cacheKey, cachedIdentity);
      return cachedIdentity.identity;
    }

    let cachedKey = accessKeys.get(header.kid);
    if (!cachedKey || cachedKey.expiresAt <= now) {
      const promise = fetch(`${issuer.origin}/cdn-cgi/access/certs`, {
        cf: { cacheTtl: 300, cacheEverything: true },
      } as RequestInit & { cf: { cacheTtl: number; cacheEverything: boolean } })
        .then(async (response) => {
          if (!response.ok) return null;
          const jwks = (await response.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
          const jwk = jwks.keys?.find((key) => key.kid === header.kid);
          if (!jwk) return null;
          return crypto.subtle.importKey(
            "jwk",
            jwk,
            { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
            false,
            ["verify"],
          );
        })
        .catch(() => null);
      cachedKey = { expiresAt: now + 300, promise };
      accessKeys.set(header.kid, cachedKey);
    }
    const publicKey = await cachedKey.promise;
    if (!publicKey) {
      accessKeys.delete(header.kid);
      return null;
    }
    const signature = decodeJwtBytes(encodedSignature);
    const signedContent = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      new Uint8Array(signature).buffer as ArrayBuffer,
      signedContent,
    );
    if (!valid) return null;
    const identity = { email: payload.email, name: payload.name };
    verifiedAccessTokens.set(cacheKey, { expiresAt: Math.min(payload.exp, now + 120), identity });
    if (verifiedAccessTokens.size > 256) {
      for (const [key, entry] of verifiedAccessTokens) {
        if (entry.expiresAt <= now || verifiedAccessTokens.size > 192) verifiedAccessTokens.delete(key);
        if (verifiedAccessTokens.size <= 192) break;
      }
    }
    return identity;
  } catch {
    return null;
  }
}

function decodeJwtBytes(part: string): Uint8Array {
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function decodeJwtPart<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(decodeJwtBytes(part))) as T;
}

// Baseline browser security headers. Framing is blocked only for the private app itself, because public forms,
// funnels and media under /f, /media and /api/marketing-public are embedded on client websites.
function withSecurityHeaders(response: Response, pathname: string): Response {
  if (response.status === 101 || response.webSocket) return response;
  let headers: Headers;
  try { headers = new Headers(response.headers); } catch { return response; }
  const setIfMissing = (name: string, value: string) => { if (!headers.has(name)) headers.set(name, value); };
  setIfMissing("X-Content-Type-Options", "nosniff");
  setIfMissing("Referrer-Policy", "strict-origin-when-cross-origin");
  setIfMissing("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  setIfMissing("X-Permitted-Cross-Domain-Policies", "none");
  // Public, embeddable pages (/f/* funnels, booking pages, public marketing API) may be framed on client sites.
  const publicPage = pathname.startsWith("/f/") || pathname.startsWith("/api/marketing-public");
  if (!publicPage) {
    // Stops the OS being loaded inside another site's frame (clickjacking) and blocks unused device APIs.
    setIfMissing("X-Frame-Options", "SAMEORIGIN");
    setIfMissing("Content-Security-Policy", "frame-ancestors 'self'; base-uri 'self'; object-src 'none'");
    setIfMissing("Permissions-Policy", "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)");
  }
  // Private API answers (contacts, conversations, money) must never sit in a shared or browser cache.
  if (pathname.startsWith("/api/") && !pathname.startsWith("/api/marketing-public") && /json/i.test(headers.get("content-type") || "")) setIfMissing("Cache-Control", "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

const worker = {
  async scheduled(controller: ScheduledController, env: Cloudflare.Env, ctx: ExecutionContext): Promise<unknown> {
    installUsageMeter(env.DB);
    return runWithUsage({ feature: "Scheduled jobs", actor: "system", waitUntil: (p) => ctx.waitUntil(p) }, () => worker.runScheduled(controller, env, ctx));
  },
  async runScheduled(controller: ScheduledController, env: Cloudflare.Env, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.allSettled([
      processCrmAutomations(env.DB! as unknown as Parameters<typeof processCrmAutomations>[0], new Date(controller.scheduledTime), {
        sendEmail: env.RESEND_API_KEY && env.TASK_NOTIFICATION_FROM ? async (message) => {
          const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": message.idempotencyKey },
            body: JSON.stringify({ from: env.TASK_NOTIFICATION_FROM, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
            signal: AbortSignal.timeout(15_000),
          });
          if (!response.ok) {
            const detail = await response.json().catch(() => null) as { message?: string } | null;
            throw new Error(`The email provider returned HTTP ${response.status}: ${detail?.message || "message was not accepted"}.`);
          }
          await logSystemEmail(env.DB as never, { to: message.to, subject: message.subject, text: message.text || "" });
        } : undefined,
        // "Make an AI call" step: queued on the account's AI phone agent (respects its switches, hours and DND).
        aiCall: async (call) => {
          const { queueOutboundCall } = await import("../lib/voice-agent/server");
          return queueOutboundCall({ ownerId: call.ownerId, clientId: call.scopeId, trigger: "automation", to: call.phone, contactId: call.contactId, contactName: call.name, purpose: call.purpose, channel: call.channel, dedupeKey: call.dedupeKey });
        },
      }),
      processDueAiTasks({ ...env, hasDirectSearchConsole: hasGoogleSearchConsoleConnection, readDirectSearchConsole: readGoogleSearchConsoleRows }, new Date(controller.scheduledTime)),
      processDueFinanceRecurring(env, new Date(controller.scheduledTime)),
      // Scheduling: 24-hour and 1-hour appointment reminders (indexed, at most 50 per run).
      import("../lib/scheduling/context").then(async ({ schedulingDeps, loadSchedulingWorkspace }) => {
        const { processSchedulingReminders } = await import("../lib/scheduling/server");
        return processSchedulingReminders(schedulingDeps(new Request(env.TASK_APP_URL || "https://f2b-media-agency-os.f2b-media.workers.dev")), loadSchedulingWorkspace);
      }),
      processExpiredMarketingSubmissions(env.DB!, env.BUCKET, new Date(controller.scheduledTime)),
      processMonthlyClientReports(env.DB, env.BUCKET as never, new Date(controller.scheduledTime)),
      // Content calendar: publish approved posts that are due to Facebook / Instagram / Google Business.
      import("../lib/content-publish").then(({ processContentPublishing }) => processContentPublishing(new Date(controller.scheduledTime))),
      // AI & SEO-data rebilling: last month's usage → a line on each client's draft invoice (1st–3rd, once).
      import("../lib/usage-billing").then(({ processUsageInvoices }) => processUsageInvoices(new Date(controller.scheduledTime))),
      processOutreach(new Date(controller.scheduledTime)),
      // Domain Guard: hijack / DNS-change / redirect / injected-script watch on every domain, high-priority alerts.
      import("../lib/domain-guard-server").then(({ processDomainGuard }) => processDomainGuard(new Date(controller.scheduledTime))),
      // AI phone agent: place queued outbound calls (new-lead call-backs, automation calls, confirm calls).
      import("../lib/voice-agent/server").then(({ processVoiceQueue }) => processVoiceQueue(new Date(controller.scheduledTime))),
      // Online onboarding: finish audits whose browser tab closed mid-way, time out stuck ones, prune usage counters.
      (async () => { const { processStalledOnboardingAudits } = await import("../lib/onboarding/server"); return processStalledOnboardingAudits(); })(),
      // Operations → Email campaigns: next email to up to 80 due contacts, one Resend batch call.
      processEmailCampaigns(env as never, new Date(controller.scheduledTime)),
      keepGoogleAdsTokensFresh(env.DB!),
      // Link every active client to its Search Console / GA4 property automatically (every 6 hours).
      autoLinkGoogleProperties(env.DB, 6 * 3_600_000, new Date(controller.scheduledTime)),
      processDailyMarketingSnapshots({ ...env, isGoogleAdsDirect: googleAdsConnectionReady, readDirectGoogleAds: async (ownerId, accountId, window) => (await getGoogleAdsCampaignMetrics(ownerId, accountId, window)).rows, isMetaAdsDirect: metaAdsConnectionExists, readDirectMetaAds: (ownerId, accountId, window) => readDirectMetaAdsInsights(ownerId, accountId, window, "campaigns"), isSearchConsoleDirect: hasGoogleSearchConsoleConnection, readDirectSearchConsole: (ownerId, accountId, window) => readGoogleSearchConsoleRows(ownerId, accountId, window.start, window.end), isGoogleAnalyticsDirect: hasGoogleAnalyticsDirectConnection, readDirectGoogleAnalytics: async (ownerId, accountId, window) => {
        const [totals, channels] = await Promise.all([
          readGoogleAnalyticsReport(ownerId, accountId, window.start, window.end, [], ["sessions", "activeUsers", "engagedSessions", "keyEvents", "totalRevenue"]),
          readGoogleAnalyticsReport(ownerId, accountId, window.start, window.end, ["sessionDefaultChannelGroup"], ["sessions", "keyEvents"]),
        ]);
        return {
          totals: totals.map((row) => ({ sessions: row.sessions, active_users: row.activeUsers, engaged_sessions: row.engagedSessions, conversions: row.keyEvents, totalrevenue: row.totalRevenue })),
          channels: channels.map((row) => ({ session_default_channel_group: row.sessionDefaultChannelGroup, sessions: row.sessions, conversions: row.keyEvents })),
        };
      } }, new Date(controller.scheduledTime)),
      processDueMarketingAutomations(env.DB!, new Date(controller.scheduledTime), async (ownerId, clientId, contactId, method, tag) => {
        await ghlLocationRequest(ownerId, clientId, `/contacts/${encodeURIComponent(contactId)}/tags`, method, { tags: [tag] }, "v3");
      }, async (emailOwnerId, recipient, subject, text, idempotencyKey) => {
        if (!env.RESEND_API_KEY || !env.TASK_NOTIFICATION_FROM) throw new Error("Internal email delivery is unavailable: configure RESEND_API_KEY and TASK_NOTIFICATION_FROM.");
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
          body: JSON.stringify({ from: env.TASK_NOTIFICATION_FROM, to: [recipient], subject, text }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
          const detail = await response.json().catch(() => null) as { message?: string } | null;
          throw new Error(`Internal email provider returned HTTP ${response.status}: ${detail?.message || "message was not accepted"}.`);
        }
        await logSystemEmail(env.DB as never, { ownerId: emailOwnerId, to: recipient, subject, text });
      }, async (ownerId, clientId, contactId, payload) => {
        await ghlLocationRequest(ownerId, clientId, `/contacts/${encodeURIComponent(contactId)}`, "PUT", payload, "v3");
      }, async (ownerId, clientId, contactId, nodeType, subject, message) => {
        return deliverGhlMarketingMessage({ request: ghlLocationRequest, ownerId, clientId, contactId, nodeType, subject, message });
      }),
    ]));
  },
  async fetch(request: Request, env: Cloudflare.Env, ctx: AccessContext) {
    // AI phone agent: Twilio ConversationRelay WebSocket (public path; protected by a signed per-call token).
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket" && new URL(request.url).pathname === "/api/marketing-public/voice/relay") {
      const { handleRelaySocket } = await import("../lib/voice-agent/relay");
      return handleRelaySocket(request, ctx);
    }
    let binding = ctx.props?.CONNECTORS;
    // Local preview emulates the same request-scoped capability. This branch and
    // the auxiliary service binding are absent from production builds.
    if (import.meta.env.DEV && !binding && env.CONNECTORS) {
      const preview = env.CONNECTORS;
      const expiresAt = Date.now() + 60_000;
      binding = {
        async getContext() {
          if (Date.now() >= expiresAt) return { status: "request_context_expired" };
          return preview.getContext?.() ?? { status: "binding_unavailable" };
        },
        async invoke(connectorId, actionName, args) {
          if (Date.now() >= expiresAt) {
            return { status: "request_context_expired", message: "This request has expired. Please try again." };
          }
          return preview.invoke(connectorId, actionName, args);
        },
      };
    }
    // Never trust a client-supplied Access identity header. The Workers static
    // asset router may omit ctx.access, so verify Access's signed assertion as
    // a fallback before passing the identity to the app.
    const authenticatedHeaders = new Headers(request.headers);
    authenticatedHeaders.delete("cf-access-authenticated-user-email");
    // Legacy hosting headers (user id / email / name) are never set by Cloudflare Access, so in production any
    // copy of them came from the caller and could be used to pose as another user (e.g. the owner's old user id).
    // Local dev sets them itself, so only strip outside dev.
    if (!import.meta.env.DEV) {
      for (const name of [...authenticatedHeaders.keys()]) {
        if (name.toLowerCase().startsWith("oai-authenticated-user-")) authenticatedHeaders.delete(name);
      }
    }
    const assertion = authenticatedHeaders.get("cf-access-jwt-assertion");
    const authorizationCookie = request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("CF_Authorization="))
      ?.slice("CF_Authorization=".length);
    const identity =
      (await ctx.access?.getIdentity()) ??
      (await verifyAccessToken(
        assertion ?? authorizationCookie ?? null,
        env.F2B_ACCESS_TEAM_DOMAIN,
        env.F2B_ACCESS_AUD,
      ));
    if (identity?.email) {
      authenticatedHeaders.set(
        "cf-access-authenticated-user-email",
        identity.email,
      );
    }
    const authenticatedRequest = new Request(request, {
      headers: authenticatedHeaders,
    });

    const incomingUrl = new URL(authenticatedRequest.url);
    if (incomingUrl.pathname.startsWith("/internal/site-lead") || incomingUrl.pathname === "/api/site-lead-photo") {
      const leadResponse = await handleSiteLeadRoutes(authenticatedRequest, env as never, incomingUrl, identity?.email, isInternalCall(request));
      if (leadResponse) return leadResponse;
    }
    let appRequest = authenticatedRequest;
    if ((authenticatedRequest.method === "GET" || authenticatedRequest.method === "HEAD") && incomingUrl.pathname === "/" && env.DB) {
      const hostname = normalizeMarketingHostname(incomingUrl.hostname);
      if (hostname) {
        const domain = await env.DB.prepare("SELECT d.status, d.verified_at AS verifiedAt, a.slug FROM marketing_custom_domains d JOIN marketing_assets a ON a.owner_id = d.owner_id AND a.id = d.asset_id AND a.published_data IS NOT NULL WHERE d.hostname = ?1 LIMIT 1").bind(hostname).first<{ status: string; verifiedAt: string | null; slug: string }>();
        if (domain && isMarketingDomainVerified(domain)) {
          const pageUrl = marketingCustomDomainPageUrl(incomingUrl, domain.slug);
          if (pageUrl) appRequest = new Request(pageUrl, authenticatedRequest);
        }
      }
    }

    // Settings → Audit log: record staff sign-ins when the app itself is opened.
    if (identity?.email && env.DB && appRequest.method === "GET" && new URL(appRequest.url).pathname === "/" && /text\/html/.test(appRequest.headers.get("accept") || "")) {
      ctx.waitUntil(import("../lib/activity-log").then(({ recordLogin }) => recordLogin(env.DB!, identity.email!, appRequest)).catch(() => undefined));
    }
    // AI & SEO-data usage metering (client rebilling): tag this request with its client and feature.
    installUsageMeter(env.DB);
    const usagePath = new URL(appRequest.url).pathname;
    const usageAction = usagePath.startsWith("/api/") ? await actionFromRequest(appRequest).catch(() => "") : "";
    const usage = usagePath.startsWith("/api/") ? { clientId: await clientIdFromRequest(appRequest).catch(() => ""), route: usagePath, feature: `${featureFor(usagePath)}${usageAction ? ` · ${usageAction}` : ""}`.slice(0, 80), actor: identity?.email || "", waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) } : { waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p) };
    // Settings → Audit log → Activity: every saving action (who, what, where, when, result). Secrets never stored.
    // The body is read from a copy taken before the app consumes the request.
    const { shouldLogRequest } = await import("../lib/action-log");
    const logThis = Boolean(env.DB) && shouldLogRequest(appRequest.method, usagePath) && !usagePath.startsWith("/api/marketing-public");
    const logBody: Promise<unknown> = logThis && /json/i.test(appRequest.headers.get("content-type") || "") && Number(appRequest.headers.get("content-length") || 0) < 512_000 ? appRequest.clone().json().catch(() => null) : Promise.resolve(null);
    const response = await runWithUsage(usage, () => runWithConnectorBinding(binding, () =>
      handler.fetch(appRequest, env, ctx),
    ));
    if (logThis) {
      const actor = identity?.email || "", ip = appRequest.headers.get("cf-connecting-ip") || "", clientId = (usage as { clientId?: string }).clientId || "";
      ctx.waitUntil(logBody.then(async (body) => { const { logAction } = await import("../lib/action-log"); await logAction(env.DB!, { actor, method: appRequest.method, path: usagePath, status: response.status, clientId, body, ip }); }).catch((e) => console.error("action log", e)));
    }
    return withSecurityHeaders(response, appRequest === authenticatedRequest ? incomingUrl.pathname : "/f/");
  },
};

export default worker;
