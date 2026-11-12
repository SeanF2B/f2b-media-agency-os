export const PUBLIC_MARKETING_ACCESS_PATHS = Object.freeze([
  { path: "/f/*", name: "F2B published marketing pages" },
  { path: "/api/marketing-public*", name: "F2B public marketing API" },
  { path: "/sitemap.xml", name: "F2B public marketing sitemap" },
  { path: "/robots.txt", name: "F2B public marketing robots file" },
  { path: "/api/gohighlevel/webhook", name: "F2B signed GoHighLevel webhook" },
]);

const API = "https://api.cloudflare.com/client/v4";

function isEveryone(rule) {
  return Boolean(rule && typeof rule === "object" && rule.everyone && typeof rule.everyone === "object");
}

function isPublicBypassPolicy(policy) {
  return policy?.decision === "bypass"
    && Array.isArray(policy.include)
    && policy.include.length === 1
    && isEveryone(policy.include[0])
    && (!Array.isArray(policy.exclude) || policy.exclude.length === 0)
    && (!Array.isArray(policy.require) || policy.require.length === 0);
}

function apiMessage(envelope, fallback) {
  const messages = Array.isArray(envelope?.errors)
    ? envelope.errors.map((error) => String(error?.message || "")).filter(Boolean)
    : [];
  return messages.length ? messages.join("; ") : fallback;
}

function responseError(response, envelope) {
  return `Cloudflare Access API returned HTTP ${response.status}. ${apiMessage(envelope, "Check the account-scoped Access Apps and Policies Read and Edit token permissions.")}`;
}

/**
 * Create path-specific Access applications with a public Bypass policy while
 * leaving the workspace's root Access application and policy untouched.
 * Existing exact-path apps are accepted only if they already match the narrow
 * public rule; conflicting rules stop the whole operation before any writes.
 */
export async function ensurePublicMarketingAccessRoutes({
  accountId,
  appId,
  allowPolicyId,
  token,
  hostname,
  fetcher = fetch,
}) {
  if (![accountId, appId, allowPolicyId, token, hostname].every((value) => typeof value === "string" && value.trim())) {
    return { ok: false, configured: false, createdPaths: [], error: "Add the Cloudflare Access API token and workspace Access application settings first." };
  }
  const host = hostname.trim().toLowerCase();
  if (host.includes("/") || host.includes(":") || host.includes("@") || host.includes("?")) {
    return { ok: false, configured: true, createdPaths: [], error: "The configured public host is invalid. No Access rules were changed." };
  }

  const root = `${API}/accounts/${encodeURIComponent(accountId)}/access`;
  const headers = { Authorization: `Bearer ${token.trim()}`, "Content-Type": "application/json" };
  const request = async (url, init = {}) => {
    let response;
    try {
      response = await fetcher(url, { ...init, headers, signal: AbortSignal.timeout(12_000) });
    } catch {
      return { ok: false, error: "Cloudflare Access could not be reached. No further rules were changed." };
    }
    const envelope = await response.json().catch(() => null);
    if (!response.ok || !envelope?.success) return { ok: false, error: responseError(response, envelope) };
    return { ok: true, result: envelope.result };
  };

  const baseAppResult = await request(`${root}/apps/${encodeURIComponent(appId)}`);
  if (!baseAppResult.ok) return { ok: false, configured: true, createdPaths: [], error: baseAppResult.error };
  const baseApp = baseAppResult.result;
  if (baseApp?.type !== "self_hosted" || String(baseApp?.domain || "").toLowerCase() !== host) {
    return { ok: false, configured: true, createdPaths: [], error: "The configured root Access app does not match the expected protected CRM hostname. No Access rules were changed." };
  }

  const basePoliciesResult = await request(`${root}/apps/${encodeURIComponent(appId)}/policies?per_page=100`);
  if (!basePoliciesResult.ok) return { ok: false, configured: true, createdPaths: [], error: basePoliciesResult.error };
  const basePolicies = Array.isArray(basePoliciesResult.result) ? basePoliciesResult.result : [];
  const ownerAllowPolicy = basePolicies.find((policy) => policy?.id === allowPolicyId);
  if (!ownerAllowPolicy || ownerAllowPolicy.decision !== "allow" || !Array.isArray(ownerAllowPolicy.include) || ownerAllowPolicy.include.length === 0 || ownerAllowPolicy.include.some(isEveryone)) {
    return { ok: false, configured: true, createdPaths: [], error: "The CRM's existing owner allow policy could not be confirmed as private. No Access rules were changed." };
  }
  if (basePolicies.some((policy) => policy?.decision === "bypass" && Array.isArray(policy.include) && policy.include.some(isEveryone))) {
    return { ok: false, configured: true, createdPaths: [], error: "The root CRM app already contains a public Bypass policy. No additional Access rules were changed." };
  }

  const plans = [];
  for (const target of PUBLIC_MARKETING_ACCESS_PATHS) {
    const query = new URLSearchParams({ domain: `${host}${target.path}`, exact: "true", per_page: "100" });
    const matchesResult = await request(`${root}/apps?${query}`);
    if (!matchesResult.ok) return { ok: false, configured: true, createdPaths: [], error: matchesResult.error };
    const matches = Array.isArray(matchesResult.result) ? matchesResult.result : [];
    if (matches.length > 1) return { ok: false, configured: true, createdPaths: [], error: `Multiple Access apps already match ${target.path}. Resolve the duplicate manually; no rules were changed.` };
    if (!matches.length) {
      plans.push({ target, existingId: null });
      continue;
    }
    const existing = matches[0];
    if (existing?.domain !== `${host}${target.path}` || existing?.type !== "self_hosted") {
      return { ok: false, configured: true, createdPaths: [], error: `An existing Access app conflicts with ${target.path}. No Access rules were changed.` };
    }
    const existingPoliciesResult = await request(`${root}/apps/${encodeURIComponent(existing.id)}/policies?per_page=100`);
    if (!existingPoliciesResult.ok) return { ok: false, configured: true, createdPaths: [], error: existingPoliciesResult.error };
    const existingPolicies = Array.isArray(existingPoliciesResult.result) ? existingPoliciesResult.result : [];
    if (existingPolicies.length !== 1 || !isPublicBypassPolicy(existingPolicies[0])) {
      return { ok: false, configured: true, createdPaths: [], error: `The existing ${target.path} Access app is not the approved Everyone-only public rule. No Access rules were changed.` };
    }
    plans.push({ target, existingId: existing.id });
  }

  const createdPaths = [];
  const results = [];
  for (const { target, existingId } of plans) {
    if (existingId) {
      results.push({ path: target.path, status: "already_configured" });
      continue;
    }
    const createdResult = await request(`${root}/apps`, {
      method: "POST",
      body: JSON.stringify({
        name: target.name,
        type: "self_hosted",
        domain: `${host}${target.path}`,
        policies: [{
          name: `Public route: ${target.path}`,
          decision: "bypass",
          include: [{ everyone: {} }],
          exclude: [],
          require: [],
        }],
      }),
    });
    if (!createdResult.ok || typeof createdResult.result?.id !== "string") {
      return { ok: false, configured: true, createdPaths, results, error: createdResult.error || `Cloudflare did not return an Access app ID for ${target.path}.` };
    }
    const createdId = createdResult.result.id;
    const verifyResult = await request(`${root}/apps/${encodeURIComponent(createdId)}/policies?per_page=100`);
    const policies = verifyResult.ok && Array.isArray(verifyResult.result) ? verifyResult.result : [];
    if (!verifyResult.ok || policies.length !== 1 || !isPublicBypassPolicy(policies[0])) {
      return { ok: false, configured: true, createdPaths, results, error: `Cloudflare accepted ${target.path}, but its public path policy could not be verified. Review that path before retrying.` };
    }
    createdPaths.push(target.path);
    results.push({ path: target.path, status: "created" });
  }

  return { ok: true, configured: true, createdPaths, results, protectedRootHost: host };
}
