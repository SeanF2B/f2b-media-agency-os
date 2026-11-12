import { env } from "cloudflare:workers";

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

/** Add one saved staff email to the configured app's existing exact-email allow policy. */
export async function ensureStaffHasWorkspaceAccess(emailValue: string, previousEmailValue?: string) {
  const accountId = env.F2B_CF_ACCOUNT_ID?.trim();
  const appId = env.F2B_CF_ACCESS_APP_ID?.trim();
  const policyId = env.F2B_CF_ACCESS_POLICY_ID?.trim();
  const token = env.CLOUDFLARE_ACCESS_API_TOKEN?.trim();
  if (!accountId || !appId || !policyId || !token) {
    return { ok: false as const, configured: false as const, error: "One-time setup is needed to connect staff access. Add the Cloudflare Access API token and the workspace app and allow-policy IDs; staff profiles are still saved." };
  }

  const email = normalizedEmail(emailValue);
  const previousEmail = previousEmailValue ? normalizedEmail(previousEmailValue) : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false as const, configured: true as const, error: "Enter a valid email address on the saved staff profile before syncing workspace access." };
  }

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/access/apps/${encodeURIComponent(appId)}/policies/${encodeURIComponent(policyId)}`;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
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
    return { ok: false as const, configured: true as const, error: `Cloudflare did not update the staff access rule (HTTP ${writeResponse.status}). ${writeEnvelope ? apiError(writeEnvelope, "Check that the token has account-scoped Access Apps and Policies Read and Edit permissions.") : "Check the API token permissions."}` };
  }

  const verifyResponse = await fetch(endpoint, { headers, signal: AbortSignal.timeout(12_000) });
  const verifyEnvelope = await verifyResponse.json().catch(() => null) as ApiEnvelope<AccessPolicy> | null;
  if (!verifyResponse.ok || !verifyEnvelope?.success || !verifyEnvelope.result || !hasExactEmail(verifyEnvelope.result.include || [], email)) {
    return { ok: false as const, configured: true as const, error: "Cloudflare accepted the access update, but the saved policy could not be verified. Check Access before sending the invitation." };
  }
  return { ok: true as const, configured: true as const, email, changed: true };
}
