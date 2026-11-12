type JsonSchema = Record<string, any>;
export type WindsorAdsAction = { id: string; name: string; description: string; schema: JsonSchema };

// Actions intentionally exclude Customer Match and other customer-data list operations.
// The exact set is still intersected with Windsor's live action catalog at runtime.
export const ENABLED_WINDSOR_ADS_ACTIONS = new Set([
  "create_campaign", "create_ad_group", "create_responsive_search_ad", "create_ad_asset",
  "pause_campaign", "enable_campaign", "pause_ad_group", "enable_ad_group", "pause_ad", "enable_ad",
  "rename_campaign", "rename_ad_group", "update_ad_group", "set_campaign_budget",
  "set_campaign_bidding_strategy", "set_campaign_geo_targeting", "set_campaign_language_targeting",
  "set_ad_schedule", "set_cpc_bid_ceiling", "set_max_cpc", "set_target_cpa", "set_target_roas",
  "push_keywords", "push_negative_keywords", "update_keywords", "remove_keywords", "remove_negative_keywords",
]);

export async function getWindsorAdsActions(apiKey: string): Promise<WindsorAdsAction[]> {
  const response = await fetch(`https://connectors.windsor.ai/google_ads/actions?api_key=${encodeURIComponent(apiKey)}`, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(response.status === 403 ? "Windsor write actions are not enabled for this team. In Windsor.ai, enable write actions under Team management." : `Windsor action list returned HTTP ${response.status}.`);
  const value = await response.json() as unknown;
  if (!Array.isArray(value)) throw new Error("Windsor returned an invalid Google Ads action catalog.");
  return value.filter((item: any) => ENABLED_WINDSOR_ADS_ACTIONS.has(String(item?.id)) && item?.schema?.type === "object" && item?.schema?.properties && !/customer.match|user.list/i.test(`${item.id} ${item.name}`));
}

function resolveRefs(schema: JsonSchema, root: JsonSchema): JsonSchema {
  if (schema.$ref) {
    const path = String(schema.$ref).replace(/^#\//, "").split("/").map((part: string) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
    return path.reduce((value: any, key: string) => value?.[key], root) || {};
  }
  const result: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (["title", "default", "examples"].includes(key)) continue;
    if (key === "$defs" || key === "definitions") continue;
    if (key === "properties") result[key] = Object.fromEntries(Object.entries(value as JsonSchema).map(([name, child]) => [name, resolveRefs(child as JsonSchema, root)]));
    else if (key === "items") result[key] = resolveRefs(value as JsonSchema, root);
    else if (key === "anyOf" || key === "oneOf" || key === "allOf") result[key] = (value as JsonSchema[]).map((child) => resolveRefs(child, root));
    else result[key] = value;
  }
  return result;
}

function isNullable(schema: JsonSchema): boolean {
  return schema.type === "null" || (Array.isArray(schema.anyOf) && schema.anyOf.some((part: JsonSchema) => isNullable(part)));
}

export function toStrictOpenAISchema(schema: JsonSchema): JsonSchema {
  const resolved = resolveRefs(schema, schema);
  const convert = (node: JsonSchema, optional = false): JsonSchema => {
    const result: JsonSchema = {};
    for (const [key, value] of Object.entries(node)) {
      if (["title", "default", "examples", "$defs", "definitions"].includes(key)) continue;
      if (key === "properties") {
        const properties = value as JsonSchema;
        result.properties = Object.fromEntries(Object.entries(properties).map(([name, child]) => [name, convert(child as JsonSchema, true)]));
        result.required = Object.keys(properties);
      } else if (key === "required") continue;
      else if (key === "items") result.items = convert(value as JsonSchema);
      else if (key === "anyOf" || key === "oneOf") result[key] = (value as JsonSchema[]).map((child) => convert(child));
      else if (key === "allOf") result[key] = (value as JsonSchema[]).map((child) => convert(child));
      else if (key === "maxItems") result.maxItems = Math.min(Number(value), 50);
      else result[key] = value;
    }
    if (optional && !isNullable(result)) return { anyOf: [result, { type: "null" }] };
    if (result.type === "object") result.additionalProperties = false;
    return result;
  };
  return convert(resolved);
}

function typeMatches(value: unknown, type: unknown): boolean {
  if (Array.isArray(type)) return type.some((entry) => typeMatches(value, entry));
  switch (type) {
    case "object": return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    default: return true;
  }
}

export function validateWindsorParams(value: unknown, schema: JsonSchema): string | null {
  const root = schema;
  const validate = (input: unknown, node: JsonSchema, path: string): string | null => {
    if (node.$ref) return validate(input, resolveRefs(node, root), path);
    if (Array.isArray(node.anyOf)) return node.anyOf.some((part: JsonSchema) => validate(input, part, path) === null) ? null : `${path} does not match the allowed parameter format`;
    if (Array.isArray(node.oneOf)) return node.oneOf.filter((part: JsonSchema) => validate(input, part, path) === null).length === 1 ? null : `${path} does not match the allowed parameter format`;
    if (node.enum && !node.enum.includes(input)) return `${path} must be one of ${node.enum.join(", ")}`;
    if (node.type && !typeMatches(input, node.type)) return `${path} must be ${Array.isArray(node.type) ? node.type.join(" or ") : node.type}`;
    if (input === null) return null;
    if (typeof input === "string") {
      if (node.minLength !== undefined && input.length < node.minLength) return `${path} is too short`;
      if (node.maxLength !== undefined && input.length > node.maxLength) return `${path} is too long`;
      if (node.pattern && !(new RegExp(node.pattern).test(input))) return `${path} has an invalid format`;
    }
    if (typeof input === "number") {
      if (node.minimum !== undefined && input < node.minimum || node.exclusiveMinimum !== undefined && input <= node.exclusiveMinimum) return `${path} is below the allowed minimum`;
      if (node.maximum !== undefined && input > node.maximum || node.exclusiveMaximum !== undefined && input >= node.exclusiveMaximum) return `${path} is above the allowed maximum`;
    }
    if (Array.isArray(input)) {
      if (node.minItems !== undefined && input.length < node.minItems || node.maxItems !== undefined && input.length > Math.min(Number(node.maxItems), 50)) return `${path} has an invalid number of items (maximum 50 per confirmed action)`;
      for (let i = 0; i < input.length; i++) { const error = validate(input[i], node.items || {}, `${path}[${i}]`); if (error) return error; }
    }
    if (input && typeof input === "object" && !Array.isArray(input)) {
      const object = input as Record<string, unknown>;
      for (const required of node.required || []) if (!(required in object)) return `${path}.${required} is required`;
      if (node.additionalProperties === false) for (const key of Object.keys(object)) if (!(key in (node.properties || {}))) return `${path}.${key} is not an accepted parameter`;
      for (const [key, child] of Object.entries(node.properties || {})) {
        if (key in object) {
          // OpenAI strict mode represents upstream optional fields as nullable required fields.
          if (object[key] === null && !(node.required || []).includes(key)) continue;
          const error = validate(object[key], child as JsonSchema, `${path}.${key}`); if (error) return error;
        }
      }
    }
    return null;
  };
  return validate(value, schema, "params");
}

export function omitNullOptionalParams(value: Record<string, unknown>, schema: JsonSchema): Record<string, unknown> {
  const resolvedSchema = resolveRefs(schema, schema);
  const clean = (input: Record<string, unknown>, node: JsonSchema): Record<string, unknown> => {
    const result = { ...input };
    for (const [key, childValue] of Object.entries(node.properties || {})) {
      const child = childValue as JsonSchema;
      if (result[key] === null && !(node.required || []).includes(key)) delete result[key];
      else if (result[key] && typeof result[key] === "object" && !Array.isArray(result[key]) && child.type === "object") result[key] = clean(result[key] as Record<string, unknown>, child);
      else if (Array.isArray(result[key]) && child.items?.type === "object") result[key] = (result[key] as Record<string, unknown>[]).map((item) => clean(item, child.items));
    }
    return result;
  };
  return clean(value, resolvedSchema);
}

export async function executeWindsorAdsAction(apiKey: string, accountId: string, actionId: string, params: Record<string, unknown>) {
  const url = new URL("https://connectors.windsor.ai/google_ads/actions");
  url.searchParams.set("api_key", apiKey);
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account: accountId, action: actionId, params }), signal: AbortSignal.timeout(25000) });
  const raw = await response.text();
  let result: any;
  try { result = JSON.parse(raw); } catch { result = { result: raw.slice(0, 1200) }; }
  if (!response.ok) {
    const detail = String(result?.error || result?.message || result?.detail || `HTTP ${response.status}`).slice(0, 500);
    throw new Error(response.status === 403 ? "Windsor denied the write: enable write actions for your team under Windsor.ai Team management." : `Windsor could not apply the action: ${detail}`);
  }
  return result;
}
