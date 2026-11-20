import { env } from "cloudflare:workers";
import { cloudflareToken } from "@/lib/outreach/server/store";

type AccessRule = Record<string, unknown>;
type AccessPolicy = {
  id?: string;
  name?: string;
  decision?: string;
  include?: AccessRule[];
  exclude?: AccessRule[];
  require?: AccessRule[];
  session_duration?: string;
  purpose_justification_required?: boolean;
  purpose_justification_prompt?: string;
  approval_required?: boolean;
  approval_groups?: unknown[];
  reusable?: boolean;
  precedence?: number;
  [key: string]: unknown;
};

type ApiEnvelope<T> = { success?: boolean; result?: T; errors?: Array<{ message?: string }> };

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

function hasExactEmail(rules: AccessRule[], email: string) {
  return rules.some((rule) => {
    const selector = rule.email;
    return Boolean(selector && typeof selector === "object" && normalizedEmail(String((selector as { email?: unknown }).email || "")) === email);
  });
}

function apiError(envelope: ApiEnvelope<unknown>, fallback: string) {
  return envelope.errors?.map((error) => error.message).filter(Boolean).join("; ") || fallback;
}

export const STAFF_POLICY_NAME = "F2B staff (synced from Team)";
const CF_API = "https://api.cloudflare.com/client/v4";

async function workspaceOwnerId(): Promise<string> {
  try {
    const row = await (env.DB as D1Database).prepare("SELECT owner_id FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ owner_id: string }>();
    return row?.owner_id || "";
  } catch { return ""; }
}

/**
 * The policy staff emails live in: a dedicated, app-only allow policy. The shared, reusable
 * "Workers Preview URLs" policy (Cloudflare account members) is never edited. Created once if missing.
 */
async function staffPolicyId(accountId: string, appId: string, headers: Record<string, string>, configured: string, email: string): Promise<{ id: string; created: boolean } | { error: string; status: number }> {
  const base = `${CF_API}/accounts/${encodeURIComponent(accountId)}/access/apps/${encodeURIComponent(appId)}/policies`;
  const listResponse = await fetch(base, { headers, signal: AbortSignal.timeout(12_000) });
  const list = await listResponse.json().catch(() => null) as ApiEnvelope<AccessPolicy[]> | null;
  if (!listResponse.ok || !list?.success || !Array.isArray(list.result)) return { status: listResponse.status, error: list ? apiError(list, "Could not list the workspace Access policies.") : "Could not list the workspace Access policies." };
  const policies = list.result;
  const named = policies.find((policy) => policy.name === STAFF_POLICY_NAME && policy.decision === "allow");
  if (named?.id) return { id: named.id, created: false };
  const pinned = policies.find((policy) => policy.id === configured && policy.decision === "allow" && !policy.reusable && Array.isArray(policy.include) && policy.include.every((rule) => "email" in rule));
  if (pinned?.id) return { id: pinned.id, created: false };
  const precedence = Math.max(0, ...policies.map((policy) => Number(policy.precedence) || 0)) + 1;
  const createResponse = await fetch(base, { method: "POST", headers, body: JSON.stringify({ name: STAFF_POLICY_NAME, decision: "allow", precedence, include: [{ email: { email } }], exclude: [], require: [], session_duration: "24h" }), signal: AbortSignal.timeout(12_000) });
  const created = await createResponse.json().catch(() => null) as ApiEnvelope<AccessPolicy> | null;
  if (!createResponse.ok || !created?.success || !created.result?.id) return { status: createResponse.status, error: created ? apiError(created, "Could not create the staff Access policy.") : "Could not create the staff Access policy." };
  return { id: created.result.id, created: true };
}

const permissionHint = "The Cloudflare token needs the account permission Access: Apps and Policies Edit. Add it to the token saved in Settings → Domains & DNS (or set CLOUDFLARE_ACCESS_API_TOKEN); staff profiles are still saved.";

/** Add one saved staff email to the workspace's dedicated staff allow policy (created if missing). */
export async function ensureStaffHasWorkspaceAccess(emailValue: string, previousEmailValue?: string) {
  const accountId = env.F2B_CF_ACCOUNT_ID?.trim();
  const appId = env.F2B_CF_ACCESS_APP_ID?.trim();
  const token = env.CLOUDFLARE_ACCESS_API_TOKEN?.trim() || await cloudflareToken(await workspaceOwnerId()).catch(() => null) || "";
  if (!accountId || !appId || !token) {
    return { ok: false as const, configured: false as const, error: "Staff access isn't connected yet: no Cloudflare token is saved. Add one in Settings → Domains & DNS with Access: Apps and Policies Edit; staff profiles are still saved." };
  }

  const email = normalizedEmail(emailValue);
  const previousEmail = previousEmailValue ? normalizedEmail(previousEmailValue) : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false as const, configured: true as const, error: "Enter a valid email address on the saved staff profile before syncing workspace access." };
  }

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const target = await staffPolicyId(accountId, appId, headers, env.F2B_CF_ACCESS_POLICY_ID?.trim() || "", email);
  if ("error" in target) return { ok: false as const, configured: true as const, error: `${target.error} (HTTP ${target.status}). ${target.status === 401 || target.status === 403 ? permissionHint : ""}`.trim() };
  if (target.created) return { ok: true as const, configured: true as const, email, changed: true };
  const policyId = target.id;
  const endpoint = `${CF_API}/accounts/${encodeURIComponent(accountId)}/access/apps/${encodeURIComponent(appId)}/policies/${encodeURIComponent(policyId)}`;
  const readResponse = await fetch(endpoint, { headers, signal: AbortSignal.timeout(12_000) });
  const currentEnvelope = await readResponse.json().catch(() => null) as ApiEnvelope<AccessPolicy> | null;
  if (!readResponse.ok || !currentEnvelope?.success || !currentEnvelope.result) {
    return { ok: false as const, configured: true as const, error: `Could not read the configured Cloudflare Access policy (HTTP ${readResponse.status}). ${currentEnvelope ? apiError(currentEnvelope, "Check the API token permissions and policy IDs.") : "Check the API token and policy IDs."}` };
  }

  const policy = currentEnvelope.result;
  if (policy.decision !== "allow" || !Array.isArray(policy.include)) {
    return { ok: false as const, configured: true as const, error: "The configured Cloudflare policy is not an allow policy with an editable include list. No access rules were changed." };
  }

  const include = policy.include.filter((rule) => {
    if (!previousEmail || previousEmail === email) return true;
    const selector = rule.email;
    return !(selector && typeof selector === "object" && normalizedEmail(String((selector as { email?: unknown }).email || "")) === previousEmail);
  });
  const alreadyAllowed = hasExactEmail(include, email);
  const nextInclude = alreadyAllowed ? include : [...include, { email: { email } }];
  const removingOldEmail = previousEmail !== "" && previousEmail !== email && include.length !== policy.include.length;
  if (alreadyAllowed && !removingOldEmail) return { ok: true as const, configured: true as const, email, changed: false };

  // Send only documented mutable policy fields; preserve the existing access rules and policy settings.
  const update = {
    name: policy.name,
    decision: policy.decision,
    include: nextInclude,
    exclude: Array.isArray(policy.exclude) ? policy.exclude : [],
    require: Array.isArray(policy.require) ? policy.require : [],
    ...(typeof policy.session_duration === "string" ? { session_duration: policy.session_duration } : {}),
    ...(typeof policy.purpose_justification_required === "boolean" ? { purpose_justification_required: policy.purpose_justification_required } : {}),
    ...(typeof policy.purpose_justification_prompt === "string" ? { purpose_justification_prompt: policy.purpose_justification_prompt } : {}),
    ...(typeof policy.approval_required === "boolean" ? { approval_required: policy.approval_required } : {}),
    ...(Array.isArray(policy.approval_groups) ? { approval_groups: policy.approval_groups } : {}),
  };
  const writeResponse = await fetch(endpoint, { method: "PUT", headers, body: JSON.stringify(update), signal: AbortSignal.timeout(12_000) });
  const writeEnvelope = await writeResponse.json().catch(() => null) as ApiEnvelope<AccessPolicy> | null;
  if (!writeResponse.ok || !writeEnvelope?.success) {
    return { ok: false as const, configured: true as const, error: `Cloudflare did not update the staff access rule (HTTP ${writeResponse.status}). ${writeEnvelope ? apiError(writeEnvelope, permissionHint) : "Check the API token permissions."}` };
  }

  const verifyResponse = await fetch(endpoint, { headers, signal: AbortSignal.timeout(12_000) });
  const verifyEnvelope = await verifyResponse.json().catch(() => null) as ApiEnvelope<AccessPolicy> | null;
  if (!verifyResponse.ok || !verifyEnvelope?.success || !verifyEnvelope.result || !hasExactEmail(verifyEnvelope.result.include || [], email)) {
    return { ok: false as const, configured: true as const, error: "Cloudflare accepted the access update, but the saved policy could not be verified. Check Access before sending the invitation." };
  }
  return { ok: true as const, configured: true as const, email, changed: true };
}
