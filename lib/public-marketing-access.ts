export type PublicMarketingAccessStatus = "ready" | "partial" | "needs_setup";
export type PublicMarketingAccessCheck = {
  status: PublicMarketingAccessStatus;
  checkedAt: string;
  detail: string;
  pageRoute: "reachable" | "blocked" | "unverified";
  apiRoute: "reachable" | "blocked" | "unverified";
};

const probeSlugPrefix = "f2b-public-access-check-";
const expectedMissingPageMessage = "This published page could not be found.";

async function probeRoute(url: URL, fetcher: typeof fetch) {
  try {
    const response = await fetcher(url, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") || "";
      return /cloudflareaccess\.com|\/cdn-cgi\/access\/login/i.test(location) ? "blocked" as const : "unverified" as const;
    }
    if (response.status === 404) {
      const contentType = response.headers.get("content-type") || "";
      const body = await response.text();
      if (contentType.includes("application/json") && body.includes(expectedMissingPageMessage)) return "reachable" as const;
    }
    return "unverified" as const;
  } catch {
    return "unverified" as const;
  }
}

/**
 * Checks that both public page endpoints pass through Cloudflare Access and
 * reach the app. A unique nonexistent slug makes the expected response a
 * known 404 without recording a page view or creating a submission.
 */
export async function checkPublicMarketingAccess(
  appUrl: string,
  fetcher: typeof fetch = fetch,
  checkedAt = new Date().toISOString(),
  probeId = crypto.randomUUID(),
): Promise<PublicMarketingAccessCheck> {
  let origin: URL;
  try { origin = new URL(appUrl); }
  catch { throw new Error("The app URL is invalid."); }
  if (origin.protocol !== "https:") throw new Error("The app URL must use HTTPS.");
  const slug = `${probeSlugPrefix}${probeId}`;
  const pageUrl = new URL(`/f/${encodeURIComponent(slug)}`, origin.origin);
  const apiUrl = new URL("/api/marketing-public", origin.origin);
  apiUrl.searchParams.set("slug", slug);
  const [pageRoute, apiRoute] = await Promise.all([
    probeRoute(pageUrl, fetcher),
    probeRoute(apiUrl, fetcher),
  ]);
  const reachable = [pageRoute, apiRoute].filter((status) => status === "reachable").length;
  const blocked = [pageRoute, apiRoute].filter((status) => status === "blocked").length;
  const status: PublicMarketingAccessStatus = reachable === 2 ? "ready" : reachable > 0 ? "partial" : "needs_setup";
  const routeLabel = (name: string, value: string) => `${name}: ${value === "reachable" ? "public route is reachable" : value === "blocked" ? "Cloudflare Access login is blocking this route" : "could not be verified"}`;
  const detail = status === "ready"
    ? "Both public page routes reached the app without a login. The private CRM still requires its normal Access sign-in."
    : `${routeLabel("/f/*", pageRoute)}. ${routeLabel("/api/marketing-public*", apiRoute)}. Configure only these path-specific public routes; keep the rest of the app protected.`;
  return { status, checkedAt, detail, pageRoute, apiRoute };
}
