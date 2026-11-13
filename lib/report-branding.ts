export function resolveAgencyLogoUrl(pageUrl: string) {
  try {
    const page = new URL(pageUrl);
    if (page.protocol !== "https:" && page.protocol !== "http:") return "";
    return new URL("/f2b-favicon-transparent.png", page.origin).toString(); // agency icon only — no agency name in client reports
  } catch {
    return "";
  }
}
