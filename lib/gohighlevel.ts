import { env } from "cloudflare:workers";
import { getGhlLocationAccessToken } from "@/lib/gohighlevel-oauth";
import { ghlFunnelPagesV4Path, ghlFunnelsV4Path, ghlProviderError, normalizeGhlFunnels, normalizeGhlPages } from "@/lib/gohighlevel-api.mjs";

function fromB64(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function toB64(value: Uint8Array) {
  return btoa(Array.from(value, (byte) => String.fromCharCode(byte)).join(""));
}

async function encryptionKey() {
  const encoded = env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY;
  if (!encoded) throw new Error("Secure token encryption is not configured on the server.");
  const bytes = fromB64(encoded);
  if (bytes.byteLength !== 32) throw new Error("The server token encryption key must be 32 bytes.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptGhlToken(token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), new TextEncoder().encode(token));
  return { iv: toB64(iv), ciphertext: toB64(new Uint8Array(ciphertext)) };
}

async function decryptGhlToken(iv: string, ciphertext: string) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await encryptionKey(), fromB64(ciphertext));
  return new TextDecoder().decode(plain);
}

type GhlConnection = { location_id: string; location_name: string; encrypted_token: string; token_iv: string };
type GhlFunnel = { _id?: string; id?: string; name?: string; url?: string; domainId?: string; steps?: Array<{ id?: string; name?: string; url?: string; pages?: string[] }> };
type GhlPage = { _id?: string; id?: string; name?: string; funnelId?: string; stepId?: string; updatedAt?: string; deleted?: boolean };

export async function getGhlConnection(ownerId: string, clientId: string) {
  if (!env.DB) return null;
  return env.DB.prepare("SELECT location_id, location_name, encrypted_token, token_iv FROM gohighlevel_connections WHERE owner_id = ?1 AND client_id = ?2")
    .bind(ownerId, clientId).first<GhlConnection>();
}

async function ghlFetch(token: string, path: string) {
  const response = await fetch(`https://services.leadconnectorhq.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", Version: path.startsWith("/funnels/") ? "v4" : "2021-07-28" },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("GHL rejected this token or it is missing one of the required read permissions. Check the token and its selected scopes.");
    throw new Error(ghlProviderError(payload, response.status));
  }
  return payload;
}

export async function verifyGhlConnection(token: string, locationId: string) {
  // Read the location first so a wrong location ID or non-location token fails
  // before credentials are stored. Funnel list access confirms the key scope.
  const location = await ghlFetch(token, `/locations/${encodeURIComponent(locationId)}`) as { location?: { name?: string; businessName?: string }; name?: string };
  const funnelResult = await ghlFetch(token, ghlFunnelsV4Path(locationId)) as { funnels?: GhlFunnel[] | GhlFunnel; count?: number };
  const funnels = normalizeGhlFunnels(funnelResult) as GhlFunnel[];
  const name = String(location.location?.name || location.name || location.location?.businessName || "").slice(0, 180);
  return { name, funnelCount: Number.isFinite(funnelResult.count) ? Number(funnelResult.count) : funnels.length };
}

export async function readGhlLandingPageMap(ownerId: string, clientId: string, services: Array<{ name?: string; campaignName?: string; landingPageUrl?: string }> = []) {
  let token = "";
  let locationId = "";
  let locationName = "";
  try {
    const location = await getGhlLocationAccessToken(ownerId, clientId);
    token = location.accessToken; locationId = location.locationId; locationName = location.locationName;
  } catch {
    const saved = await getGhlConnection(ownerId, clientId);
    if (!saved) return { status: "not_connected" as const, locationId: "", funnels: [], pages: [] };
    token = await decryptGhlToken(saved.token_iv, saved.encrypted_token);
    locationId = saved.location_id;
    locationName = saved.location_name;
  }
  const funnelResult = await ghlFetch(token, ghlFunnelsV4Path(locationId)) as { funnels?: GhlFunnel[] | GhlFunnel; count?: number };
  const rawFunnels = normalizeGhlFunnels(funnelResult) as GhlFunnel[];
  const funnels = rawFunnels.slice(0, 100).map((funnel) => ({
    id: String(funnel._id || funnel.id || ""),
    name: String(funnel.name || "Unnamed funnel"),
    path: String(funnel.url || ""),
    domainId: String(funnel.domainId || ""),
    steps: (funnel.steps || []).slice(0, 30).map((step) => ({ id: String(step.id || ""), name: String(step.name || ""), path: String(step.url || ""), pageIds: (step.pages || []).slice(0, 10) })),
  }));
  const campaignPaths = services.flatMap((service) => {
    try { return [new URL(service.landingPageUrl || "").pathname.replace(/\/$/, "").toLowerCase()].filter(Boolean); }
    catch { return []; }
  });
  const campaignNames = services.flatMap((service) => [service.campaignName, service.name]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter((value) => value.length >= 4));
  const matchingFunnels = funnels.map((funnel) => {
    const paths = [funnel.path, ...funnel.steps.map((step) => step.path)].map((value) => value.replace(/\/$/, "").toLowerCase()).filter(Boolean);
    const name = funnel.name.trim().toLowerCase();
    const pathMatch = paths.some((funnelPath) => campaignPaths.some((campaignPath) => campaignPath === funnelPath || campaignPath.endsWith(funnelPath)));
    const nameMatch = campaignNames.some((campaignName) => campaignName.includes(name) || name.includes(campaignName));
    return { funnel, score: pathMatch ? 2 : nameMatch ? 1 : 0 };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).map((item) => item.funnel);
  // A location can contain hundreds of funnels. Read only the best URL/name
  // matches. When there is no match, inspect just one funnel as a fallback;
  // scanning unrelated funnels made a single audit consume too many Worker
  // subrequests and could fail the entire task.
  const pageFunnels = (matchingFunnels.length ? matchingFunnels : funnels).slice(0, 2);
  const pageGroups: GhlPage[][] = [];
  for (let start = 0; start < pageFunnels.length; start += 10) {
    const group = await Promise.all(pageFunnels.slice(start, start + 10).map(async (funnel) => {
    if (!funnel.id) return [] as GhlPage[];
      const pages: GhlPage[] = [];
      // One page per likely funnel is enough to establish the relevant page
      // mapping. The saved campaign URL remains the source of truth.
      for (let skip = 0; skip < 20; skip += 20) {
        const result = await ghlFetch(token, ghlFunnelPagesV4Path(funnel.id, locationId, skip)) as GhlPage[] | { pages?: GhlPage[] };
        const batch = normalizeGhlPages(result) as GhlPage[];
        pages.push(...batch);
        if (batch.length < 20) break;
      }
      return pages;
    }));
    pageGroups.push(...group);
  }
  const pages = pageGroups.flat().map((page) => ({ id: String(page._id || page.id || ""), name: String(page.name || "Unnamed page"), funnelId: String(page.funnelId || ""), stepId: String(page.stepId || ""), updatedAt: String(page.updatedAt || ""), deleted: Boolean(page.deleted) })).filter((page) => !page.deleted).slice(0, 300);
  const pageInventoryNote = pageFunnels.length < funnels.length
    ? `Checked ${pageFunnels.length} likely funnels and up to 20 pages per funnel. The full location inventory was not scanned.`
    : `Checked up to 20 pages per funnel for the ${pageFunnels.length} returned funnels.`;
  return { status: "connected" as const, locationId, locationName, funnels, pages, pageInventoryNote };
}

export function mapGhlPagesToCampaignUrls(map: Awaited<ReturnType<typeof readGhlLandingPageMap>>, services: Array<{ name?: string; campaignName?: string; landingPageUrl?: string }> = []) {
  if (map.status !== "connected") return map;
  const targets = services.filter((service) => service.landingPageUrl).map((service) => {
    let host = ""; let path = "";
    try { const url = new URL(service.landingPageUrl!); host = url.hostname.toLowerCase().replace(/^www\./, ""); path = url.pathname.replace(/\/$/, "").toLowerCase(); } catch { /* Invalid saved URLs remain unmatched. */ }
    const scored = map.funnels.map((funnel) => {
      const funnelPaths = [funnel.path, ...funnel.steps.map((step) => step.path)].map((value) => value.replace(/\/$/, "").toLowerCase()).filter(Boolean);
      const matchedPages = map.pages.filter((page) => page.funnelId === funnel.id);
      const pageNames = matchedPages.map((page) => page.name);
      const exactPath = Boolean(path && funnelPaths.some((funnelPath) => path === funnelPath));
      const suffixPath = Boolean(path && funnelPaths.some((funnelPath) => path.endsWith(funnelPath)));
      return { funnel, matchedPages, pageNames, score: exactPath ? 3 : suffixPath ? 2 : 0, host };
    }).sort((a, b) => b.score - a.score);
    const best = scored[0];
    const pathMatches = best?.score ? best.funnel.steps.filter((step) => {
      const stepPath = step.path.replace(/\/$/, "").toLowerCase();
      return path && stepPath && (path === stepPath || path.endsWith(stepPath));
    }) : [];
    const matchedPageIds = new Set(pathMatches.flatMap((step) => step.pageIds));
    const matchedStepIds = new Set(pathMatches.map((step) => step.id));
    const exactPages = best?.score ? best.matchedPages.filter((page) => matchedPageIds.has(page.id) || matchedStepIds.has(page.stepId)) : [];
    const pages = exactPages.length || !best?.score ? exactPages : best.matchedPages;
    return { campaign: service.campaignName || service.name || "Landing page", url: service.landingPageUrl, matchedBy: best?.score ? "url_path" : "client_location", funnel: best?.score ? best.funnel : null, pages, note: best?.score ? "URL path matched a GHL funnel or funnel-step path." : "No exact URL path match was returned by GHL; use the client location's funnel/page list and public URL together to identify the correct page." };
  });
  return { ...map, campaignMappings: targets };
}
