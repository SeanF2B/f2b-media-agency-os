// Best known website for a client: saved WordPress/site URL, then website, then the domain of a
// business email address (free mailbox providers ignored). Returns "" when nothing is known.
const FREE_MAIL = /^(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|gmx|mail|eircom|zoho|yandex)\./i;

export function clientWebsite(client?: { wordpressSiteUrl?: string | null; website?: string | null; email?: string | null } | null): string {
  if (!client) return "";
  const saved = String(client.wordpressSiteUrl || client.website || "").trim();
  if (saved) return saved;
  const email = String(client.email || "").trim().toLowerCase();
  const domain = email.includes("@") ? email.split("@").pop() || "" : /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(email) ? email : "";
  return domain && !FREE_MAIL.test(domain) ? `https://${domain}` : "";
}

export function clientWebsiteHost(client?: Parameters<typeof clientWebsite>[0]): string {
  const url = clientWebsite(client);
  try { return url ? new URL(url).hostname.replace(/^www\./, "") : ""; } catch { return ""; }
}
