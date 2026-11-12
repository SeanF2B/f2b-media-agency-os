import handler from "vinext/server/fetch-handler";
import { processDueAiTasks, processDueFinanceRecurring } from "./scheduled-ai";
import { processDueMarketingAutomations } from "./marketing-automations";
import { processExpiredMarketingSubmissions } from "../lib/marketing-submission-retention";
import { getGoogleAdsCampaignMetrics, googleAdsConnectionReady, keepGoogleAdsTokensFresh } from "../lib/google-ads-direct";
import { ghlLocationRequest } from "../lib/gohighlevel-oauth";
import { deliverGhlMarketingMessage } from "../lib/marketing-automation-message.js";
import { processDailyMarketingSnapshots } from "../lib/marketing-daily-sync";
import { metaAdsConnectionExists, readDirectMetaAdsInsights } from "../lib/meta-ads-direct";
import { hasGoogleSearchConsoleConnection, readGoogleSearchConsoleRows } from "../lib/google-search-console-direct";
import { hasGoogleAnalyticsDirectConnection, readGoogleAnalyticsReport } from "../lib/google-analytics-direct";
import { runWithConnectorBinding } from "../lib/connector-context";
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

const worker = {
  async scheduled(controller: ScheduledController, env: Cloudflare.Env, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.allSettled([
      processDueAiTasks({ ...env, hasDirectSearchConsole: hasGoogleSearchConsoleConnection, readDirectSearchConsole: readGoogleSearchConsoleRows }, new Date(controller.scheduledTime)),
      processDueFinanceRecurring(env, new Date(controller.scheduledTime)),
      processExpiredMarketingSubmissions(env.DB!, env.BUCKET, new Date(controller.scheduledTime)),
      keepGoogleAdsTokensFresh(env.DB!),
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
      }, async (_ownerId, recipient, subject, text, idempotencyKey) => {
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
      }, async (ownerId, clientId, contactId, payload) => {
        await ghlLocationRequest(ownerId, clientId, `/contacts/${encodeURIComponent(contactId)}`, "PUT", payload, "v3");
      }, async (ownerId, clientId, contactId, nodeType, subject, message) => {
        return deliverGhlMarketingMessage({ request: ghlLocationRequest, ownerId, clientId, contactId, nodeType, subject, message });
      }),
    ]));
  },
  async fetch(request: Request, env: Cloudflare.Env, ctx: AccessContext) {
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

    let appRequest = authenticatedRequest;
    const incomingUrl = new URL(authenticatedRequest.url);
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

    return runWithConnectorBinding(binding, () =>
      handler.fetch(appRequest, env, ctx),
    );
  },
};

export default worker;
