// AI calls for Outreach through the existing OpenRouter configuration, recording real usage.
import { env } from "cloudflare:workers";
import { aiEndpoint, aiHeaders, aiModel, resolveAiProvider } from "@/lib/ai-provider";
import { recordAiUsage } from "./store";

type Message = { role: "system" | "user" | "assistant"; content: string };

function outputText(payload: any): string {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();
  const fromOutput = (payload?.output || []).flatMap((item: any) => item?.content || []).filter((part: any) => part?.type === "output_text" && typeof part.text === "string").map((part: any) => part.text).join("\n").trim();
  if (fromOutput) return fromOutput;
  return String(payload?.choices?.[0]?.message?.content || "").trim();
}

/** Returns the model's text, or throws a plain-English error. Usage (and cost, when OpenRouter reports it) is recorded per feature. */
export async function aiText(ownerId: string, feature: "copy" | "classify" | "responder" | "opener" | "analyse", messages: Message[], { timeoutMs = 25_000, maxOutputTokens = 1200 } = {}): Promise<string> {
  const provider = await resolveAiProvider(env as never, ownerId);
  const endpoint = provider ? aiEndpoint(env as never, "responses", provider) : null;
  const headers = provider ? aiHeaders(env as never, provider) : null;
  if (!provider || !endpoint || !headers) throw new Error("AI isn't connected. Add the OpenRouter key in Settings → API keys.");
  const instructions = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
  const input = messages.filter((message) => message.role !== "system").map((message) => ({ role: message.role, content: message.content }));
  const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ model: aiModel(env as never, undefined, provider), instructions, input, max_output_tokens: maxOutputTokens, usage: { include: true } }), signal: AbortSignal.timeout(timeoutMs) });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(`The AI provider returned an error (${response.status}). ${String(payload?.error?.message || "").slice(0, 160)}`.trim());
  const usage = payload?.usage || {};
  await recordAiUsage(ownerId, feature, {
    tokensIn: Number(usage.input_tokens ?? usage.prompt_tokens ?? 0),
    tokensOut: Number(usage.output_tokens ?? usage.completion_tokens ?? 0),
    costUsd: Number(usage.cost ?? usage.total_cost ?? 0) || 0,
  }).catch(() => undefined);
  const text = outputText(payload);
  if (!text) throw new Error("The AI returned an empty answer.");
  return text;
}

/** OpenRouter account spend this month (account-wide, not just Outreach), when the key reports it. */
export async function openRouterMonthUsd(ownerId: string): Promise<number | null> {
  try {
    const provider = await resolveAiProvider(env as never, ownerId);
    if (!provider || provider.name !== "OpenRouter") return null;
    const response = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${provider.apiKey}` }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const payload = await response.json() as any;
    const value = payload?.data?.usage_monthly;
    return typeof value === "number" ? value : null;
  } catch { return null; }
}
