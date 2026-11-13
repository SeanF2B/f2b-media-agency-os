import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { aiCredentialStorageReady, decryptAiCredential, encryptAiCredential } from "@/lib/ai-credentials";
import { getTeamPermissions } from "@/lib/access-permissions";

export const dynamic = "force-dynamic";

const respond = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const CF_API = "https://api.cloudflare.com/client/v4";
const ID_PATTERN = /^[a-f0-9]{32}$/i;
const DOMAIN_PATTERN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const RECORD_TYPES = ["A", "AAAA", "CNAME", "TXT", "MX", "NS"] as const;
type RecordType = (typeof RECORD_TYPES)[number];

async function ensureTable() {
  if (!env.DB) throw new Error("The private workspace database is not available.");
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS agency_cloudflare_dns_token (
    owner_id TEXT PRIMARY KEY,
    encrypted_key TEXT NOT NULL,
    key_iv TEXT NOT NULL,
    key_fingerprint TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).run();
}

async function authorizeAdmin(): Promise<{ ownerId: string; error?: never } | { error: Response; ownerId?: never }> {
  const user = await getChatGPTUser();
  if (!user) return { error: respond({ error: "Sign in before managing domains." }, 401) };
  if (!env.DB) return { error: respond({ error: "The private workspace database is not available." }, 503) };
  const row = await env.DB.prepare("SELECT owner_id, data FROM workspace_documents WHERE id = ?1")
    .bind("f2b-agency").first<{ owner_id: string; data: string }>();
  if (!row?.data) return { error: respond({ error: "The agency workspace could not be loaded." }, 503) };
  let workspace: any;
  try { workspace = JSON.parse(row.data); } catch { return { error: respond({ error: "The agency workspace data could not be read." }, 503) }; }
  const profile = (workspace.staff || []).find((member: any) => !member?.isBot && (member?.id === user.userId || String(member?.email || "").toLowerCase() === user.email.toLowerCase()));
  const isOwner = row.owner_id === user.userId || workspace.ownerId === user.userId || String(workspace.settings?.adminEmail || "").toLowerCase() === user.email.toLowerCase();
  const isAdmin = isOwner || (profile?.role === "Admin" && getTeamPermissions(profile.role, profile.permissions).team);
  if (!isAdmin) return { error: respond({ error: "Only the workspace owner or an admin can manage domains." }, 403) };
  return { ownerId: row.owner_id || workspace.ownerId || user.userId };
}

type Token = { value: string; source: "secret" | "stored"; fingerprint: string };

async function getToken(ownerId: string): Promise<Token | null> {
  const secret = String(env.CLOUDFLARE_DNS_API_TOKEN || "").trim();
  if (secret) return { value: secret, source: "secret", fingerprint: secret.slice(-4) };
  if (!env.DB) return null;
  try {
    await ensureTable();
    const row = await env.DB.prepare("SELECT encrypted_key, key_iv, key_fingerprint FROM agency_cloudflare_dns_token WHERE owner_id = ?1")
      .bind(ownerId).first<{ encrypted_key: string; key_iv: string; key_fingerprint: string }>();
    if (!row) return null;
    return { value: await decryptAiCredential(row.key_iv, row.encrypted_key), source: "stored", fingerprint: row.key_fingerprint };
  } catch { return null; }
}

type CfResult = { ok: boolean; status: number; result: any; resultInfo?: any; error?: string };

async function cf(token: string, path: string, init?: { method?: string; body?: unknown }): Promise<CfResult> {
  try {
    const response = await fetch(`${CF_API}${path}`, {
      method: init?.method || "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => null) as { success?: boolean; result?: unknown; result_info?: unknown; errors?: Array<{ message?: string }> } | null;
    if (!response.ok || !payload?.success) {
      const message = payload?.errors?.[0]?.message || `Cloudflare returned ${response.status}.`;
      return { ok: false, status: response.status, result: null, error: String(message).slice(0, 300) };
    }
    return { ok: true, status: response.status, result: payload.result, resultInfo: payload.result_info };
  } catch {
    return { ok: false, status: 502, result: null, error: "Could not reach Cloudflare. Try again in a moment." };
  }
}

const failure = (result: CfResult) => respond({ error: result.error || "Cloudflare request failed." }, result.status === 401 || result.status === 403 ? 403 : result.status >= 500 ? 502 : 400);

function mapZone(zone: any) {
  return { id: zone.id, name: zone.name, status: zone.status, paused: Boolean(zone.paused), nameServers: Array.isArray(zone.name_servers) ? zone.name_servers : [] };
}
function mapRecord(record: any) {
  return { id: record.id, type: record.type, name: record.name, content: record.content, ttl: record.ttl, proxied: Boolean(record.proxied), proxiable: Boolean(record.proxiable), priority: record.priority ?? null, comment: record.comment || "" };
}

function parseRecord(input: any): { value?: Record<string, unknown>; error?: string } {
  const type = String(input?.type || "").toUpperCase() as RecordType;
  if (!RECORD_TYPES.includes(type)) return { error: `Record type must be one of ${RECORD_TYPES.join(", ")}.` };
  const name = String(input?.name || "").trim();
  const content = String(input?.content || "").trim();
  if (!name || name.length > 255 || /\s/.test(name)) return { error: "Enter a valid record name (use @ for the root domain)." };
  if (!content || content.length > 2048) return { error: "Enter the record value." };
  const ttl = Number(input?.ttl ?? 1);
  if (!(ttl === 1 || (Number.isInteger(ttl) && ttl >= 60 && ttl <= 86400))) return { error: "TTL must be Auto or between 60 and 86400 seconds." };
  const value: Record<string, unknown> = { type, name, content, ttl };
  if (type === "A" && !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(content)) return { error: "An A record needs an IPv4 address." };
  if (type === "AAAA" && !/^[0-9a-f:]+$/i.test(content)) return { error: "An AAAA record needs an IPv6 address." };
  if (type === "A" || type === "AAAA" || type === "CNAME") value.proxied = Boolean(input?.proxied);
  if (type === "MX") {
    const priority = Number(input?.priority ?? 10);
    if (!Number.isInteger(priority) || priority < 0 || priority > 65535) return { error: "MX priority must be a whole number from 0 to 65535." };
    value.priority = priority;
  }
  const comment = String(input?.comment || "").trim().slice(0, 100);
  if (comment) value.comment = comment;
  return { value };
}

export async function GET(request: Request) {
  const auth = await authorizeAdmin();
  if (auth.error) return auth.error;
  const token = await getToken(auth.ownerId);
  const url = new URL(request.url);
  const zoneId = url.searchParams.get("zone");
  if (!zoneId && !url.searchParams.get("zones")) {
    return respond({ connected: Boolean(token), source: token?.source || null, fingerprint: token?.fingerprint || "", secureStorageReady: aiCredentialStorageReady(), canStoreToken: aiCredentialStorageReady() });
  }
  if (!token) return respond({ error: "Connect a Cloudflare token first." }, 400);
  if (zoneId) {
    if (!ID_PATTERN.test(zoneId)) return respond({ error: "Invalid domain." }, 400);
    const records: any[] = [];
    for (let page = 1; page <= 10; page += 1) {
      const result = await cf(token.value, `/zones/${zoneId}/dns_records?per_page=100&page=${page}&order=type`);
      if (!result.ok) return failure(result);
      records.push(...(result.result as any[]));
      if (page >= Number(result.resultInfo?.total_pages || 1)) break;
    }
    return respond({ records: records.map(mapRecord) });
  }
  const zones: any[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const result = await cf(token.value, `/zones?per_page=50&page=${page}&order=name`);
    if (!result.ok) return failure(result);
    zones.push(...(result.result as any[]));
    if (page >= Number(result.resultInfo?.total_pages || 1)) break;
  }
  return respond({ zones: zones.map(mapZone) });
}

export async function POST(request: Request) {
  const auth = await authorizeAdmin();
  if (auth.error) return auth.error;
  let body: any;
  try { body = await request.json(); } catch { return respond({ error: "Send a valid request." }, 400); }
  const action = String(body?.action || "");

  if (action === "save-token") {
    if (env.CLOUDFLARE_DNS_API_TOKEN) return respond({ error: "A Cloudflare token is already set on the server. Remove it in Cloudflare to replace it here." }, 400);
    if (!aiCredentialStorageReady()) return respond({ error: "Secure storage needs a one-time server setup before a token can be saved here." }, 503);
    const value = String(body?.token || "").trim();
    if (!/^[A-Za-z0-9_-]{30,80}$/.test(value)) return respond({ error: "That does not look like a Cloudflare API token." }, 400);
    const check = await cf(value, "/zones?per_page=1");
    if (!check.ok) return respond({ error: check.status === 401 || check.status === 403 ? "Cloudflare rejected that token. Check its permissions (Zone Read, Zone Edit, DNS Edit)." : check.error || "Could not verify the token." }, 422);
    try {
      await ensureTable();
      const encrypted = await encryptAiCredential(value);
      await env.DB!.prepare(`INSERT INTO agency_cloudflare_dns_token (owner_id, encrypted_key, key_iv, key_fingerprint, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
        ON CONFLICT(owner_id) DO UPDATE SET encrypted_key = excluded.encrypted_key, key_iv = excluded.key_iv, key_fingerprint = excluded.key_fingerprint, updated_at = excluded.updated_at`)
        .bind(auth.ownerId, encrypted.ciphertext, encrypted.iv, value.slice(-4), new Date().toISOString()).run();
    } catch { return respond({ error: "Could not securely save the token." }, 503); }
    return respond({ connected: true, source: "stored", fingerprint: value.slice(-4), secureStorageReady: true });
  }

  if (action === "remove-token") {
    try { await ensureTable(); await env.DB!.prepare("DELETE FROM agency_cloudflare_dns_token WHERE owner_id = ?1").bind(auth.ownerId).run(); } catch { /* ignore */ }
    const remaining = await getToken(auth.ownerId);
    return respond({ connected: Boolean(remaining), source: remaining?.source || null, fingerprint: remaining?.fingerprint || "", secureStorageReady: aiCredentialStorageReady() });
  }

  const token = await getToken(auth.ownerId);
  if (!token) return respond({ error: "Connect a Cloudflare token first." }, 400);

  if (action === "add-zone") {
    const name = String(body?.name || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!DOMAIN_PATTERN.test(name)) return respond({ error: "Enter a domain like example.com." }, 400);
    const accountId = String(env.F2B_CF_ACCOUNT_ID || "");
    if (!ID_PATTERN.test(accountId)) return respond({ error: "The Cloudflare account ID is not configured for this app." }, 503);
    const result = await cf(token.value, "/zones", { method: "POST", body: { name, account: { id: accountId }, type: "full" } });
    if (!result.ok) return failure(result);
    return respond({ zone: mapZone(result.result) });
  }

  if (action === "attach-worker-domain" || action === "detach-worker-domain") {
    const accountId = String(env.F2B_CF_ACCOUNT_ID || "");
    if (!ID_PATTERN.test(accountId)) return respond({ error: "The Cloudflare account ID is not configured for this app." }, 503);
    const hostname = String(body?.hostname || "").trim().toLowerCase();
    if (!DOMAIN_PATTERN.test(hostname)) return respond({ error: "Enter a hostname like www.example.com." }, 400);
    const service = String(body?.service || "").trim();
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(service)) return respond({ error: "Invalid worker name." }, 400);
    if (action === "attach-worker-domain") {
      const zones = await cf(token.value, `/zones?name=${encodeURIComponent(String(body?.zoneName || hostname.split(".").slice(-2).join(".")))}`);
      const zone = zones.ok ? (zones.result as any[])?.[0] : null;
      if (!zone?.id) return respond({ error: "That domain is not on this Cloudflare account yet." }, 404);
      const result = await cf(token.value, `/accounts/${accountId}/workers/domains`, { method: "PUT", body: { hostname, service, zone_id: zone.id, environment: "production" } });
      if (!result.ok) return failure(result);
      return respond({ attached: true, hostname, service });
    }
    const list = await cf(token.value, `/accounts/${accountId}/workers/domains?hostname=${encodeURIComponent(hostname)}`);
    const found = list.ok ? (list.result as any[])?.[0] : null;
    if (!found?.id) return respond({ error: "That hostname is not attached to a worker." }, 404);
    const result = await cf(token.value, `/accounts/${accountId}/workers/domains/${found.id}`, { method: "DELETE" });
    if (!result.ok) return failure(result);
    return respond({ detached: true, hostname });
  }

  if (action === "set-redirect-rules") {
    const zone = String(body?.zone || "");
    if (!ID_PATTERN.test(zone)) return respond({ error: "Choose a domain first." }, 400);
    const input = Array.isArray(body?.rules) ? body.rules.slice(0, 50) : [];
    const mine: any[] = [];
    for (const rule of input) {
      const expression = String(rule?.expression || "").slice(0, 1000);
      const target = String(rule?.target || "").slice(0, 500);
      const dynamic = Boolean(rule?.dynamic);
      const status = [301, 302, 307, 308].includes(Number(rule?.status)) ? Number(rule.status) : 301;
      if (!expression || !target) return respond({ error: "Each rule needs a match and a target." }, 400);
      mine.push({ action: "redirect", expression, description: `f2b: ${String(rule?.description || target).slice(0, 80)}`, enabled: true,
        action_parameters: { from_value: { status_code: status, target_url: dynamic ? { expression: target } : { value: target }, preserve_query_string: true } } });
    }
    const current = await cf(token.value, `/zones/${zone}/rulesets/phases/http_request_dynamic_redirect/entrypoint`);
    const existing: any[] = current.ok ? ((current.result as any)?.rules || []) : [];
    const kept = existing.filter((rule) => !String(rule?.description || "").startsWith("f2b:")).map((rule) => { const { id: _id, version: _v, last_updated: _l, ref: _r, categories: _c, ...rest } = rule; return rest; });
    const result = await cf(token.value, `/zones/${zone}/rulesets/phases/http_request_dynamic_redirect/entrypoint`, { method: "PUT", body: { rules: [...kept, ...mine] } });
    if (!result.ok) return failure(result);
    return respond({ saved: mine.length, kept: kept.length });
  }

  const zoneId = String(body?.zone || "");
  if (!ID_PATTERN.test(zoneId)) return respond({ error: "Choose a domain first." }, 400);

  if (action === "create-record" || action === "update-record") {
    const parsed = parseRecord(body?.record);
    if (parsed.error || !parsed.value) return respond({ error: parsed.error || "Invalid record." }, 400);
    if (action === "create-record") {
      const result = await cf(token.value, `/zones/${zoneId}/dns_records`, { method: "POST", body: parsed.value });
      if (!result.ok) return failure(result);
      return respond({ record: mapRecord(result.result) });
    }
    const recordId = String(body?.recordId || "");
    if (!ID_PATTERN.test(recordId)) return respond({ error: "Invalid record." }, 400);
    const result = await cf(token.value, `/zones/${zoneId}/dns_records/${recordId}`, { method: "PUT", body: parsed.value });
    if (!result.ok) return failure(result);
    return respond({ record: mapRecord(result.result) });
  }

  if (action === "delete-record") {
    const recordId = String(body?.recordId || "");
    if (!ID_PATTERN.test(recordId)) return respond({ error: "Invalid record." }, 400);
    const result = await cf(token.value, `/zones/${zoneId}/dns_records/${recordId}`, { method: "DELETE" });
    if (!result.ok) return failure(result);
    return respond({ deleted: true });
  }

  return respond({ error: "Unknown action." }, 400);
}
