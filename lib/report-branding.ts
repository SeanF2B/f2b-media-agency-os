export function resolveAgencyLogoUrl(pageUrl: string) {
  try {
    const page = new URL(pageUrl);
    if (page.protocol !== "https:" && page.protocol !== "http:") return "";
    return new URL("/f2b-media-logo.png", page.origin).toString();
  } catch {
    return "";
  }
}
