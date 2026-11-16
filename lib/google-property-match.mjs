// Suggest Search Console / GA4 property links (and a website, when missing) for each client.
// Pure functions: no network, no writes. Only fills fields that are empty, and only on a unique, confident match.

const alnum = (value) => String(value || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
const STOP = /(ltd|limited|services|service|the|ireland|ie|com|co|uk|galway|dublin)/g;
const key = (value) => alnum(value).replace(STOP, "");

export function propertyHost(id) {
  const raw = String(id || "").trim();
  if (raw.startsWith("sc-domain:")) return raw.slice(10).toLowerCase().replace(/^www\./, "");
  try { return new URL(raw).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

export function hostOf(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try { return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

function nameMatches(clientKeys, text) {
  const t = key(text);
  if (t.length < 4) return false;
  return clientKeys.some((k) => k.length >= 4 && (t === k || (k.length >= 5 && t.includes(k)) || (t.length >= 5 && k.includes(t))));
}

const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|gmx|mail|eircom|zoho|yandex)\./i;
function emailHost(email) {
  const domain = String(email || "").trim().toLowerCase().split("@")[1] || "";
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) && !FREE_MAIL.test(domain) ? domain : "";
}

function unique(list) { return list.length === 1 ? list[0] : null; }

/**
 * @param {Array<{id:string,name?:string,company?:string,website?:string|null,wordpressSiteUrl?:string|null,email?:string|null,googleSearchConsoleAccountId?:string|null,googleAnalyticsAccountId?:string|null}>} clients
 * @param {Array<{id:string}>} gscProperties
 * @param {Array<{id:string,name:string,accountName?:string}>} ga4Properties
 */
export function matchGoogleProperties(clients, gscProperties, ga4Properties) {
  const gsc = (gscProperties || []).map((p) => ({ id: p.id, host: propertyHost(p.id) })).filter((p) => p.host);
  const ga4 = ga4Properties || [];
  const matches = [];
  for (const client of clients || []) {
    if (!client?.id) continue;
    const site = String(client.wordpressSiteUrl || client.website || "").trim();
    let host = hostOf(site);
    const mailHost = host ? "" : emailHost(client.email);
    const keys = [key(client.name), key(client.company)].filter(Boolean);
    const result = { clientId: client.id, clientName: client.name || "Client" };
    // Search Console: exact host first (domain property preferred), then a unique name match.
    if (!String(client.googleSearchConsoleAccountId || "").trim()) {
      let pick = null;
      if (host) {
        const same = gsc.filter((p) => p.host === host);
        pick = same.find((p) => p.id.startsWith("sc-domain:")) || same[0] || null;
      } else if (mailHost && gsc.some((p) => p.host === mailHost)) {
        const same = gsc.filter((p) => p.host === mailHost);
        pick = same.find((p) => p.id.startsWith("sc-domain:")) || same[0];
      } else {
        const byName = gsc.filter((p) => nameMatches(keys, p.host.split(".")[0]));
        const hosts = [...new Set(byName.map((p) => p.host))];
        if (hosts.length === 1) pick = byName.find((p) => p.id.startsWith("sc-domain:")) || byName[0];
      }
      if (pick) {
        result.searchConsole = pick.id;
        if (!host) { result.website = `https://${pick.host}`; host = pick.host; }
      }
    }
    if (!host && mailHost) { result.website = `https://${mailHost}`; host = mailHost; }
    // GA4: property name mentions the site's domain, else a unique name match.
    if (!String(client.googleAnalyticsAccountId || "").trim()) {
      let pick = null;
      if (host) pick = unique(ga4.filter((p) => String(p.name || "").toLowerCase().includes(host) || String(p.name || "").toLowerCase().includes(host.split(".")[0])));
      if (!pick) pick = unique(ga4.filter((p) => nameMatches(keys, p.name) || nameMatches(keys, p.accountName)));
      if (pick) result.analytics = pick.id;
    }
    if (result.searchConsole || result.analytics || result.website) matches.push(result);
  }
  return matches;
}
