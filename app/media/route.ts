export const dynamic = "force-dynamic";

// Short, phone-friendly link to the Media Library: /media (agency) or /media?client=<id> (a client's library).
// Bookmark it or add it to the home screen; the app opens straight on Media Library with the camera upload ready.
export function GET(request: Request) {
  const incoming = new URL(request.url);
  const target = new URL("/", incoming.origin);
  target.searchParams.set("page", "Media Library");
  const client = (incoming.searchParams.get("client") || "").slice(0, 100);
  if (client) target.searchParams.set("client", client);
  if (incoming.searchParams.has("upload")) target.searchParams.set("upload", "1");
  return new Response(null, { status: 302, headers: { Location: `${target.pathname}${target.search}`, "Cache-Control": "no-store" } });
}
