import { env } from "cloudflare:workers";
import { buildMarketingSitemap } from "../../lib/marketing-sitemap.js";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!env.DB) return new Response("Sitemap temporarily unavailable.\n", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  const rows = await env.DB.prepare("SELECT slug, published_data AS data FROM marketing_assets WHERE published_data IS NOT NULL AND kind IN ('funnel','form','survey','calculator') ORDER BY slug LIMIT 5000").all<{ slug: string; data: string }>();
  const body = buildMarketingSitemap(rows.results || [], new URL(request.url).origin);
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
