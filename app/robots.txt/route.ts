import { buildMarketingRobots } from "../../lib/marketing-sitemap.js";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return new Response(buildMarketingRobots(new URL(request.url).origin), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
