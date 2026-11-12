import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { createMarketingDomainVerificationToken, marketingDomainDnsRecordContainsToken, marketingDomainVerificationRecord, normalizeMarketingHostname } from "../../../../lib/marketing-custom-domain.js";

export const dynamic = "force-dynamic";
type WorkspaceData = { ownerId?: string; staff?: Array<{ id?: string; email?: string; role?: string }>; clients?: Array<{ id: string }> };

async function ownerContext(user: { userId: string; email: string }) {
  if (!env.DB) return null;
  const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!row?.data) return null;
  let data: WorkspaceData;
  try { data = JSON.parse(row.data); } catch { return null; }
  const ownerId = String(data.ownerId || "");
  const allowed = ownerId === user.userId || data.staff?.some((member) => member.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(member.role || ""));
  return allowed && ownerId ? { ownerId, data } : null;
}

async function authorize() {
  const user = await getChatGPTUser();
  if (!user) return { response: Response.json({ error: "Sign in before managing custom domains." }, { status: 401 }) };
  if (!env.DB) return { response: Response.json({ error: "The private workspace database is unavailable." }, { status: 503 }) };
  const context = await ownerContext(user);
  if (!context) return { response: Response.json({ error: "Only an agency owner or admin can manage custom domains." }, { status: 403 }) };
  return { context };
}

export async function GET() {
  const auth = await authorize();
  if (!auth.context) return auth.response!;
  const result = await env.DB!.prepare("SELECT d.id, d.client_id AS clientId, d.asset_id AS assetId, d.hostname, d.verification_token AS verificationToken, d.status, d.verified_at AS verifiedAt, d.created_at AS createdAt, a.slug AS assetSlug, a.name AS assetName FROM marketing_custom_domains d JOIN marketing_assets a ON a.owner_id = d.owner_id AND a.id = d.asset_id WHERE d.owner_id = ?1 ORDER BY d.created_at DESC LIMIT 100").bind(auth.context.ownerId).all<Record<string, unknown>>();
  const domains = (result.results || []).map((row) => ({ ...row, dnsRecord: marketingDomainVerificationRecord(String(row.hostname), String(row.verificationToken)) }));
  return Response.json({ domains });
}

export async function POST(request: Request) {
  const auth = await authorize();
  if (!auth.context) return auth.response!;
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return Response.json({ error: "Send a valid custom-domain request." }, { status: 400 }); }
  const action = String(body.action || "");
  const id = String(body.id || "").slice(0, 80);
  if (action === "create") {
    const hostname = normalizeMarketingHostname(String(body.hostname || ""));
    const assetId = String(body.assetId || "").slice(0, 120);
    if (!hostname) return Response.json({ error: "Enter a valid public hostname, such as go.example.ie." }, { status: 400 });
    if (!assetId) return Response.json({ error: "Choose a published funnel, form, survey or calculator." }, { status: 400 });
    const asset = await env.DB!.prepare("SELECT id, client_id AS clientId, kind FROM marketing_assets WHERE owner_id = ?1 AND id = ?2 AND kind IN ('funnel','form','survey','calculator') AND published_data IS NOT NULL").bind(auth.context.ownerId, assetId).first<{ id: string; clientId: string | null; kind: string }>();
    if (!asset) return Response.json({ error: "Choose a published project in this workspace." }, { status: 404 });
    if (asset.clientId && !auth.context.data.clients?.some((client) => client.id === asset.clientId)) return Response.json({ error: "This project is not mapped to a client in this workspace." }, { status: 403 });
    const now = new Date().toISOString();
    const domainId = crypto.randomUUID();
    const verificationToken = createMarketingDomainVerificationToken();
    try {
      await env.DB!.prepare("INSERT INTO marketing_custom_domains (id, owner_id, client_id, asset_id, hostname, verification_token, status, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, ?7)").bind(domainId, auth.context.ownerId, asset.clientId, asset.id, hostname, verificationToken, now).run();
    } catch {
      return Response.json({ error: "This hostname is already connected or could not be saved." }, { status: 409 });
    }
    return Response.json({ domain: { id: domainId, clientId: asset.clientId, assetId: asset.id, hostname, verificationToken, status: "pending", createdAt: now, dnsRecord: marketingDomainVerificationRecord(hostname, verificationToken) } }, { status: 201 });
  }
  if (action === "verify") {
    if (!id) return Response.json({ error: "Choose a saved hostname to verify." }, { status: 400 });
    const domain = await env.DB!.prepare("SELECT hostname, verification_token AS verificationToken, status FROM marketing_custom_domains WHERE owner_id = ?1 AND id = ?2").bind(auth.context.ownerId, id).first<{ hostname: string; verificationToken: string; status: string }>();
    if (!domain) return Response.json({ error: "This hostname is not in your workspace." }, { status: 404 });
    if (domain.status === "verified") return Response.json({ verified: true, message: "Domain ownership is already verified." });
    const record = marketingDomainVerificationRecord(domain.hostname, domain.verificationToken);
    if (!record) return Response.json({ error: "The saved verification record is invalid." }, { status: 409 });
    try {
      const lookup = new URL("https://cloudflare-dns.com/dns-query");
      lookup.searchParams.set("name", record.name);
      lookup.searchParams.set("type", "TXT");
      const response = await fetch(lookup, { headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(5_000) });
      if (!response.ok || !marketingDomainDnsRecordContainsToken(await response.json(), domain.verificationToken)) return Response.json({ verified: false, error: "The TXT record was not found yet. DNS changes may take time to appear." }, { status: 409 });
    } catch {
      return Response.json({ error: "DNS verification could not be reached. Try again shortly." }, { status: 503 });
    }
    const now = new Date().toISOString();
    await env.DB!.prepare("UPDATE marketing_custom_domains SET status = 'verified', verified_at = ?1, updated_at = ?1 WHERE owner_id = ?2 AND id = ?3 AND status = 'pending'").bind(now, auth.context.ownerId, id).run();
    return Response.json({ verified: true, verifiedAt: now, message: "Domain ownership verified. Hosting still needs Cloudflare for SaaS and DNS configuration before this hostname can receive traffic." });
  }
  if (action === "remove") {
    if (!id) return Response.json({ error: "Choose a saved hostname to remove." }, { status: 400 });
    const deleted = await env.DB!.prepare("DELETE FROM marketing_custom_domains WHERE owner_id = ?1 AND id = ?2").bind(auth.context.ownerId, id).run();
    if (deleted.meta.changes !== 1) return Response.json({ error: "This hostname is not in your workspace." }, { status: 404 });
    return Response.json({ removed: true });
  }
  return Response.json({ error: "Choose create, verify or remove." }, { status: 400 });
}
