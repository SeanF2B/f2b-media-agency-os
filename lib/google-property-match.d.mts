export type GooglePropertyMatch = { clientId: string; clientName: string; searchConsole?: string; analytics?: string; website?: string };
export function propertyHost(id: string): string;
export function hostOf(url: string): string;
export function matchGoogleProperties(
  clients: Array<{ id: string; name?: string; company?: string; website?: string | null; wordpressSiteUrl?: string | null; email?: string | null; googleSearchConsoleAccountId?: string | null; googleAnalyticsAccountId?: string | null }>,
  gscProperties: Array<{ id: string }>,
  ga4Properties: Array<{ id: string; name: string; accountName?: string }>,
): GooglePropertyMatch[];
