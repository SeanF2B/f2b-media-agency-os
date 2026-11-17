import { env } from "cloudflare:workers";
import { readClientReportHtml } from "@/lib/client-report-archive";
import { readShare } from "@/lib/document-email";

// Public, read-only link to a saved client report / audit / keyword report: /f/report/<token>
// (under the existing /f/* public bypass). Created only when a report is emailed from the OS.
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ token: string }> };
const HEADERS = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer", "X-Frame-Options": "SAMEORIGIN" };
const notFound = () => new Response("<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\"><title>Report unavailable</title><body style=\"font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#0d0f14;color:#e5e7eb;text-align:center;padding:20px\"><p>This report link is no longer available. Please contact your account manager for a fresh copy.</p></body>", { status: 404, headers: HEADERS });

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  if (!env.DB) return notFound();
  const share = await readShare(env.DB as never, token).catch(() => null);
  if (!share || share.kind !== "report") return notFound();
  const html = await readClientReportHtml(env.DB as never, env.BUCKET as never, share.owner_id, share.ref_id).catch(() => null);
  if (!html) return notFound();
  const theme = share.theme === "light" ? "light" : "dark";
  const head = html.indexOf("</head>");
  const themed = html.replace(/<body(?: class="[^"]*")?>/g, (tag: string, offset: number) => offset > head ? `<body class="${theme}">` : tag)
    .replace("</body>", `<button onclick="print()" class="no-print" style="position:fixed;top:14px;right:14px;padding:10px 16px;border:0;border-radius:10px;background:#1f6feb;color:#fff;font:600 14px system-ui;cursor:pointer;z-index:9">Download PDF</button><style>@media print{.no-print{display:none}}</style></body>`);
  return new Response(themed, { headers: HEADERS });
}
