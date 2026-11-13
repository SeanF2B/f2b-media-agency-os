// Lead channel attribution for client reports. Every lead gets exactly ONE channel so SEO and
// Google Ads never double-count. Precedence: a Google Ads click ID or paid-search UTM wins, then
// organic Google signals, then the CRM "source" text a person picked, else "other"/"unknown".

export type LeadChannel = "google_ads" | "seo" | "other" | "unknown";
export type LeadTouch = { gclid?: string; gbraid?: string; wbraid?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string; referrer?: string; crmSource?: string };

const PAID_MEDIUM = /^(cpc|ppc|paid|paidsearch|paid[-_ ]search|sem|search[-_ ]ads|google[-_ ]?ads)$/i;
const SEARCH_ENGINE = /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|search\.brave|yandex)\./i;

export function classifyLeadChannel(touch: LeadTouch): LeadChannel {
  const source = String(touch.utm_source || "").trim().toLowerCase();
  const medium = String(touch.utm_medium || "").trim().toLowerCase();
  if (touch.gclid || touch.gbraid || touch.wbraid) return "google_ads";
  if (PAID_MEDIUM.test(medium) && (!source || /google|adwords/.test(source))) return "google_ads";
  if (/google[-_ ]?ads|adwords/.test(source)) return "google_ads";
  if (medium === "organic" && (!source || SEARCH_ENGINE.test(`${source}.`) || /google|bing/.test(source))) return "seo";
  const referrerHost = (() => { try { return touch.referrer ? new URL(/^https?:\/\//i.test(touch.referrer) ? touch.referrer : `https://${touch.referrer}`).hostname : ""; } catch { return ""; } })();
  if (!source && !medium && referrerHost && SEARCH_ENGINE.test(referrerHost) && !/googleads|doubleclick|googlesyndication/.test(referrerHost)) return "seo";
  const crm = String(touch.crmSource || "").toLowerCase();
  if (/google ads|ppc|paid search|adwords/.test(crm)) return "google_ads";
  if (/google search|organic|seo|google business|google maps/.test(crm)) return "seo";
  if (source || medium || referrerHost || crm && !/^(manual|client|website form|website estimate|form submission)/.test(crm)) return "other";
  return "unknown";
}

export const CHANNEL_LABEL: Record<LeadChannel, string> = { google_ads: "Google Ads", seo: "SEO (organic search)", other: "Other source", unknown: "Source not recorded" };

/** Parse the attribution JSON a site form sends (first-touch tracker) or individual fields. */
export function readSubmittedTouch(get: (key: string) => string): LeadTouch {
  let parsed: Record<string, unknown> = {};
  try { const raw = get("attribution"); if (raw) parsed = JSON.parse(raw) as Record<string, unknown>; } catch { parsed = {}; }
  const pick = (key: string, alt = "") => String(parsed[key] ?? get(key) ?? (alt ? get(alt) : "") ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 300);
  return { gclid: pick("gclid"), gbraid: pick("gbraid"), wbraid: pick("wbraid"), utm_source: pick("utm_source"), utm_medium: pick("utm_medium"), utm_campaign: pick("utm_campaign"), referrer: pick("referrer", "f2b_ref") };
}
