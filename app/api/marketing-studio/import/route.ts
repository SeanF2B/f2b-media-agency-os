import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";

export const dynamic = "force-dynamic";
function safeHost(value: string) { return value.toLowerCase().replace(/^www\./, ""); }
function validPublicUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.hostname.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname)) return null;
    if (!url.hostname.includes(".") || /(^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname) || /^(metadata\.google\.internal|169\.254\.169\.254)$/i.test(url.hostname)) return null;
    return url;
  } catch { return null; }
}
async function readBounded(response: Response, max: number) {
  const reader = response.body?.getReader(); if (!reader) throw new Error("The page had no readable content.");
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) { const { value, done } = await reader.read(); if (done) break; length += value.byteLength; if (length > max) { await reader.cancel(); throw new Error("This page is too large to import. Keep it under 1 MB."); } chunks.push(value); }
  const bytes = new Uint8Array(length); let offset = 0; for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
  return new TextDecoder().decode(bytes);
}
function plainText(html: string) {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  const description = html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i)?.[1] || "";
  const text = html.replace(/<(script|style|svg|noscript|iframe|form|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<!--([\s\S]*?)-->/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim();
  return { title: title.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180), description: description.replace(/\s+/g, " ").trim().slice(0, 500), text: text.slice(0, 14_000) };
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in before importing a website." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "The private workspace database is unavailable." }, { status: 503 });
  const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  let workspace: { ownerId?: string; staff?: Array<{ email?: string; role?: string }>; clients?: Array<{ id: string; wordpressSiteUrl?: string; services?: Array<{ landingPageUrl?: string }> }> };
  try { workspace = JSON.parse(row?.data || "null"); } catch { return Response.json({ error: "Could not read the workspace." }, { status: 503 }); }
  const ownerId = String(workspace?.ownerId || "");
  const allowed = ownerId === user.userId || workspace?.staff?.some((person) => person.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(person.role || ""));
  if (!allowed) return Response.json({ error: "Only an agency owner or admin can import a client website." }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 8_000) return Response.json({ error: "That request is too large." }, { status: 413 });
  let body: { clientId?: string; url?: string };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "Send a valid website URL." }, { status: 400 }); }
  const client = workspace.clients?.find((item) => item.id === String(body.clientId || ""));
  if (!client) return Response.json({ error: "Choose a client before importing its website." }, { status: 404 });
  const requested = validPublicUrl(String(body.url || "").trim());
  if (!requested) return Response.json({ error: "Enter a public HTTPS page URL." }, { status: 400 });
  const savedUrls = [client.wordpressSiteUrl, ...(client.services || []).map((service) => service.landingPageUrl)].filter((value): value is string => Boolean(value));
  const allowedHosts = new Set(savedUrls.map((value) => { const url = validPublicUrl(value.startsWith("http") ? value : `https://${value}`); return url ? safeHost(url.hostname) : "" }).filter(Boolean));
  if (!allowedHosts.has(safeHost(requested.hostname))) return Response.json({ error: "This page must use the website or campaign domain already saved on the selected client." }, { status: 403 });
  try {
    let current = requested;
    let response: Response | null = null;
    for (let redirects = 0; redirects <= 3; redirects++) {
      response = await fetch(current, { headers: { Accept: "text/html", "User-Agent": "F2B-CRM-Page-Importer/1.0" }, redirect: "manual", signal: AbortSignal.timeout(12_000) });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location || redirects === 3) throw new Error("This page redirected too many times.");
      const next = validPublicUrl(new URL(location, current).toString());
      if (!next || safeHost(next.hostname) !== safeHost(requested.hostname)) throw new Error("The page redirected to a different domain; import was stopped for safety.");
      current = next;
    }
    if (!response?.ok) throw new Error(`The page returned HTTP ${response?.status || "error"}.`);
    if (!/text\/html/i.test(response.headers.get("content-type") || "")) throw new Error("That URL did not return a web page.");
    const text = plainText(await readBounded(response, 1_000_000));
    if (!text.text) throw new Error("No readable page text was found.");
    return Response.json({ source: { title: text.title, description: text.description, text: text.text }, sourceUrl: requested.toString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not import this page." }, { status: 502 });
  }
}
