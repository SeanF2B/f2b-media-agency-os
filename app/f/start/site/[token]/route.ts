import * as E from "@/lib/onboarding/engine.mjs";
import { agencyOwnerId, getSession, getSettings, linkSecret } from "@/lib/onboarding/server";
import { renderPage } from "@/lib/site-content/site-render";

// The customer's new-website preview from "Launch" (/f/start). Rendered by the same renderer as the website
// builder, with their logo, colours and photos. Preview only: links and forms are inert and it's never indexed.
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ token: string }> };
const notFound = () => new Response("This preview has expired.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex" } });

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  const payload = await E.readLinkToken(linkSecret(), String(token || "")).catch(() => null);
  if (!payload?.s) return notFound();
  const ownerId = await agencyOwnerId();
  const session = await getSession(ownerId, payload.s);
  const site = (session?.recommended || {}).site as { page?: unknown; theme?: { primary: string; secondary: string; font: string; radius: number; name: string; logo?: string; phone?: string } } | undefined;
  if (!session || !site?.page || !site.theme) return notFound();
  const html = renderPage(site.page, { clientId: "preview", base: "#", theme: site.theme, pages: [], phone: site.theme.phone || "", current: "home" })
    // Preview only: the lead tracker and form posts are stripped; every link stays on the page.
    .replace(/<script>[\s\S]*?<\/script>/g, "")
    .replace(/href="#\?c=preview[^"]*"/g, 'href="#contact"');
  const embedHosts = (await getSettings(ownerId)).embedOrigins;
  const ancestors = ["'self'", ...embedHosts.flatMap((host) => [`https://${host}`, `https://*.${host}`])].join(" ");
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow",
    "Content-Security-Policy": `default-src 'none'; img-src https: data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors ${ancestors}; base-uri 'none'; form-action 'none'`,
  } });
}
