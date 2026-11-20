// Paid services that can be rebilled to clients. Shared by the meter, the API, invoicing and the UI (no server imports).
// "metered" = real cost comes from the provider's response; "unit" = cost = quantity x the unit cost set in AI billing.

export type ServiceKey = "ai" | "seo_data" | "whatsapp" | "sms" | "voice" | "phone_number" | "email";
export type ServiceDef = { key: ServiceKey; label: string; provider: string; pricing: "metered" | "unit"; unit?: string; defaultUnitUsd?: number; note: string };

export const SERVICES: ServiceDef[] = [
  { key: "ai", label: "AI (Grok, GPT & other models)", provider: "OpenRouter / OpenAI", pricing: "metered", note: "Every AI request: AI employees (Grok agents), assistant, polish, reports, Conversation AI. Real cost from the provider." },
  { key: "seo_data", label: "SEO data", provider: "DataForSEO", pricing: "metered", note: "Keyword research, rank checks, backlinks, map ranks, audits. Real cost from DataForSEO." },
  { key: "whatsapp", label: "WhatsApp messages", provider: "Twilio", pricing: "unit", unit: "message", defaultUnitUsd: 0.005, note: "Each WhatsApp message sent or received (Twilio fee; add Meta's conversation fee to the unit cost if you want it covered)." },
  { key: "sms", label: "SMS", provider: "Twilio", pricing: "unit", unit: "message part", defaultUnitUsd: 0.08, note: "Each SMS part sent or received." },
  { key: "voice", label: "Phone calls", provider: "Twilio", pricing: "unit", unit: "minute", defaultUnitUsd: 0.02, note: "AI phone agent and forwarded calls, per minute (rounded up)." },
  { key: "phone_number", label: "Phone numbers", provider: "Twilio", pricing: "unit", unit: "number", defaultUnitUsd: 1.15, note: "Each number bought in the OS." },
  { key: "email", label: "Emails", provider: "Resend", pricing: "unit", unit: "email", defaultUnitUsd: 0.0004, note: "Each email sent for a client (lead alerts, invoices, campaigns). System emails with no client are never billed." },
];
export const SERVICE_KEYS = SERVICES.map((s) => s.key);
export const serviceOf = (key: string) => SERVICES.find((s) => s.key === key);
export const isServiceKey = (v: unknown): v is ServiceKey => typeof v === "string" && (SERVICE_KEYS as string[]).includes(v);
