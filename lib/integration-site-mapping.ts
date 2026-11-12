export type WordPressSiteMappingClient = { id?: string; wordpressSiteUrl?: string };
export type WordPressSiteMappingConnection = { client_id: string; site_url: string };
export type WordPressListedSite = { url: string };

function siteHost(value: string | undefined) {
  if (!value) return "";
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

/** Count only client sites whose configured URL matches an actual connected site. */
export function countMappedWordPressClients(
  clients: WordPressSiteMappingClient[],
  directConnections: WordPressSiteMappingConnection[],
  sharedSites: WordPressListedSite[],
) {
  const directByClient = new Map(directConnections.map((connection) => [connection.client_id, siteHost(connection.site_url)]));
  const sharedHosts = new Set(sharedSites.map((site) => siteHost(site.url)).filter(Boolean));
  return clients.filter((client) => {
    const host = siteHost(client.wordpressSiteUrl);
    if (!client.id || !host) return false;
    return directByClient.get(client.id) === host || sharedHosts.has(host);
  }).length;
}
