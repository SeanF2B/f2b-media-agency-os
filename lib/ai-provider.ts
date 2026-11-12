import { getStoredOpenRouterCredential } from "./ai-credentials";

export type AiProviderEnv = {
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_IMAGE_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  DB?: D1Database;
};

export type AiProvider = {
  name: "OpenRouter" | "OpenAI";
  apiKey: string;
  baseUrl: string;
  model: string;
  imageModel: string;
};

export function getAiProvider(env: AiProviderEnv): AiProvider | null {
  const routerKey = String(env.OPENROUTER_API_KEY || "").trim();
  if (routerKey) {
    return {
      name: "OpenRouter",
      apiKey: routerKey,
      baseUrl: "https://openrouter.ai/api/v1",
      model: String(env.OPENROUTER_MODEL || "x-ai/grok-4.7").trim(),
      imageModel: String(env.OPENROUTER_IMAGE_MODEL || "openai/gpt-5-image").trim(),
    };
  }

  const openAiKey = String(env.OPENAI_API_KEY || "").trim();
  if (!openAiKey) return null;
  return {
    name: "OpenAI",
    apiKey: openAiKey,
    baseUrl: "https://api.openai.com/v1",
    model: String(env.OPENAI_MODEL || "gpt-6-luna").trim(),
    imageModel: "gpt-image-1.5",
  };
}

export async function resolveAiProvider(env: AiProviderEnv, ownerId?: string): Promise<AiProvider | null> {
  const saved = await getStoredOpenRouterCredential(ownerId);
  if (saved?.key) {
    return {
      name: "OpenRouter",
      apiKey: saved.key,
      baseUrl: "https://openrouter.ai/api/v1",
      model: String(env.OPENROUTER_MODEL || "x-ai/grok-4.7").trim(),
      imageModel: String(env.OPENROUTER_IMAGE_MODEL || "openai/gpt-5-image").trim(),
    };
  }
  return getAiProvider(env);
}

export function aiConfigured(env: AiProviderEnv, provider?: AiProvider | null): boolean {
  return Boolean(provider === undefined ? getAiProvider(env) : provider);
}

export function aiEndpoint(env: AiProviderEnv, path: "responses" | "images", provider?: AiProvider | null): string | null {
  const selected = provider === undefined ? getAiProvider(env) : provider;
  if (!selected) return null;
  const normalizedPath = path === "images" && selected.name === "OpenAI" ? "images/generations" : path;
  return `${selected.baseUrl}/${normalizedPath}`;
}

export function aiHeaders(env: AiProviderEnv, provider?: AiProvider | null): Record<string, string> | null {
  const selected = provider === undefined ? getAiProvider(env) : provider;
  if (!selected) return null;
  return {
    Authorization: `Bearer ${selected.apiKey}`,
    "Content-Type": "application/json",
    ...(selected.name === "OpenRouter" ? {
      "HTTP-Referer": "https://f2bmedia.com",
      "X-Title": "F2B Media Agency OS",
    } : {}),
  };
}

export function aiModel(env: AiProviderEnv, preferredModel?: unknown, provider?: AiProvider | null): string | null {
  const selected = provider === undefined ? getAiProvider(env) : provider;
  if (!selected) return null;
  const value = String(preferredModel || "").trim();
  if (selected.name === "OpenRouter" && value && /^(x-ai|anthropic)\/[a-z0-9._/-]{1,120}$/i.test(value)) return value;
  return selected.model;
}

export function aiImageModel(env: AiProviderEnv, provider?: AiProvider | null): string | null {
  const selected = provider === undefined ? getAiProvider(env) : provider;
  return selected?.imageModel || null;
}

export function aiProviderName(env: AiProviderEnv, provider?: AiProvider | null): string | null {
  const selected = provider === undefined ? getAiProvider(env) : provider;
  return selected?.name || null;
}
