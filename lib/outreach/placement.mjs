// Free inbox placement testing with seed inboxes you own (free Gmail and Outlook.com accounts).
// A real campaign-style email is sent from the mailbox to every seed with a unique token;
// the OS then looks the token up in each seed (via OAuth, read-only) and records where it
// landed: inbox, promotions/other tab, spam, or missing.

import { providerRequest } from "./http.mjs";

export const newPlacementToken = () => `F2B-${crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`;

export const SEED_OAUTH = Object.freeze({
  gmail: { authorize: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", scope: "https://www.googleapis.com/auth/gmail.readonly openid email", extra: { access_type: "offline", prompt: "consent" } },
  outlook: { authorize: "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize", token: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token", scope: "offline_access Mail.Read User.Read", extra: { prompt: "select_account" } },
});

export function seedAuthorizeUrl(provider, { clientId, redirectUri, state }) {
  const cfg = SEED_OAUTH[provider];
  if (!cfg) throw new Error("Unknown seed provider.");
  const url = new URL(cfg.authorize);
  for (const [key, value] of Object.entries({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: cfg.scope, state, ...cfg.extra })) url.searchParams.set(key, value);
  return url.toString();
}

export async function exchangeSeedToken(provider, { clientId, clientSecret, redirectUri, code, refreshToken }, { fetchImpl = fetch } = {}) {
  const cfg = SEED_OAUTH[provider];
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...(refreshToken ? { grant_type: "refresh_token", refresh_token: refreshToken } : { grant_type: "authorization_code", code, redirect_uri: redirectUri }), ...(provider === "outlook" ? { scope: cfg.scope } : {}) });
  const response = await fetchImpl(cfg.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error(`The ${provider === "gmail" ? "Google" : "Microsoft"} sign-in didn't complete (${payload.error_description || payload.error || response.status}).`);
  return { accessToken: payload.access_token, refreshToken: payload.refresh_token || refreshToken || "", expiresIn: Number(payload.expires_in || 3600) };
}

/** Where did the token land in this seed? */
export async function findPlacement(provider, accessToken, token, { fetchImpl, sleepImpl } = {}) {
  const auth = { Authorization: `Bearer ${accessToken}` };
  if (provider === "gmail") {
    const list = await providerRequest({ provider: "Gmail", url: `https://gmail.googleapis.com/gmail/v1/users/me/messages?includeSpamTrash=true&maxResults=5&q=${encodeURIComponent(`"${token}" newer_than:2d`)}`, headers: auth, fetchImpl, sleepImpl });
    const id = list?.messages?.[0]?.id;
    if (!id) return "missing";
    const message = await providerRequest({ provider: "Gmail", url: `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=minimal`, headers: auth, fetchImpl, sleepImpl });
    return gmailPlacement(message?.labelIds || []);
  }
  const search = await providerRequest({ provider: "Outlook", url: `https://graph.microsoft.com/v1.0/me/messages?$search=${encodeURIComponent(`"${token}"`)}&$select=id,parentFolderId,inferenceClassification&$top=5`, headers: auth, fetchImpl, sleepImpl });
  const message = search?.value?.[0];
  if (!message) return "missing";
  const junk = await providerRequest({ provider: "Outlook", url: "https://graph.microsoft.com/v1.0/me/mailFolders/junkemail?$select=id", headers: auth, fetchImpl, sleepImpl });
  if (message.parentFolderId === junk?.id) return "spam";
  return message.inferenceClassification === "other" ? "other-tab" : "inbox";
}

export function gmailPlacement(labels) {
  if (labels.includes("SPAM")) return "spam";
  if (labels.includes("CATEGORY_PROMOTIONS")) return "promotions";
  if (labels.includes("CATEGORY_UPDATES") || labels.includes("CATEGORY_SOCIAL") || labels.includes("CATEGORY_FORUMS")) return "other-tab";
  if (labels.includes("INBOX")) return "inbox";
  return "other-tab";
}

/** Inbox rate counts primary inbox only; tabs are reported separately, missing counts against. */
export function summarisePlacement(results) {
  const total = results.length;
  const count = (placement) => results.filter((result) => result.placement === placement).length;
  const inbox = count("inbox");
  return { total, inbox, tabs: count("promotions") + count("other-tab"), spam: count("spam"), missing: count("missing"), inboxRate: total ? inbox / total : null, reachedRate: total ? (inbox + count("promotions") + count("other-tab")) / total : null };
}
