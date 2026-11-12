export type LandingDomainProbe = {
  hostname: string;
  checkedAt: string;
  dnsStatus: "found" | "missing" | "unavailable";
  dnsAnswers: string[];
  httpsStatus: "ready" | "redirects" | "error" | "unavailable";
  httpStatus?: number;
  redirectHost?: string;
};

export async function checkLandingDomain(hostname: string, fetcher: typeof fetch = fetch, checkedAt = new Date().toISOString()): Promise<LandingDomainProbe> {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) throw new Error("The landing subdomain is not a valid public hostname.");

  const lookups = await Promise.all(["CNAME", "A", "AAAA"].map(async (type) => {
    try {
      const dnsUrl = new URL("https://cloudflare-dns.com/dns-query");
      dnsUrl.searchParams.set("name", host);
      dnsUrl.searchParams.set("type", type);
      const response = await fetcher(dnsUrl, { headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) return null;
      const result = await response.json() as { Status?: number; Answer?: Array<{ data?: string }> };
      return { status: Number(result.Status ?? 0), answers: (result.Answer || []).map((answer) => String(answer.data || "").trim()).filter(Boolean) };
    } catch { return null; }
  }));
  const dnsAnswers = [...new Set(lookups.flatMap((items) => items?.answers || []))].slice(0, 12);
  const dnsStatus = dnsAnswers.length ? "found" : lookups.some((items) => items === null || (items.status !== 0 && items.status !== 3)) ? "unavailable" : "missing";
  let httpsStatus: LandingDomainProbe["httpsStatus"] = "unavailable";
  let httpStatus: number | undefined;
  let redirectHost: string | undefined;
  if (dnsStatus === "found") {
    try {
      let response = await fetcher(`https://${host}/`, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(10_000) });
      if (response.status === 405 || response.status === 501) {
        response = await fetcher(`https://${host}/`, { method: "GET", redirect: "manual", headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(10_000) });
      }
      httpStatus = response.status;
      if (response.status >= 300 && response.status < 400) {
        httpsStatus = "redirects";
        const location = response.headers.get("location");
        if (location) { try { redirectHost = new URL(location, `https://${host}/`).hostname; } catch {} }
      } else if (response.status >= 200 && response.status < 300) httpsStatus = "ready";
      else if (response.status > 0) httpsStatus = "error";
    } catch { httpsStatus = "unavailable"; }
  }
  return { hostname: host, checkedAt, dnsStatus, dnsAnswers, httpsStatus, ...(httpStatus ? { httpStatus } : {}), ...(redirectHost ? { redirectHost } : {}) };
}
