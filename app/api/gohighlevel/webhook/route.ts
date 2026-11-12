import { env } from "cloudflare:workers";
import { parseGhlContactWebhook, verifyGhlWebhookSignature } from "../../../../lib/gohighlevel-webhook";
import { enqueueGhlContactAutomations } from "../../../../worker/marketing-automations";

export const dynamic = "force-dynamic";
const MAX_WEBHOOK_BYTES = 64_000;

async function readBoundedBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_WEBHOOK_BYTES) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    byteLength += part.value.byteLength;
    if (byteLength > MAX_WEBHOOK_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(part.value);
  }
  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

export async function POST(request: Request) {
  let rawBody: string;
  try {
    const body = await readBoundedBody(request);
    if (body === null) return Response.json({ error: "Webhook body is missing or too large." }, { status: 413, headers: { "Cache-Control": "no-store" } });
    rawBody = body;
  } catch { return Response.json({ error: "Webhook body must be valid UTF-8." }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
  const signature = request.headers.get("x-ghl-signature") || "";
  if (!await verifyGhlWebhookSignature(rawBody, signature)) return Response.json({ error: "GoHighLevel webhook signature is missing or invalid." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  let payload: unknown;
  try { payload = JSON.parse(rawBody); }
  catch { return Response.json({ error: "Webhook body must contain valid JSON." }, { status: 400, headers: { "Cache-Control": "no-store" } }); }
  const event = parseGhlContactWebhook(payload);
  if (!event) return Response.json({ ok: true, ignored: true }, { headers: { "Cache-Control": "no-store" } });
  if (!env.DB) return Response.json({ error: "Automation storage is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  try {
    const queued = await enqueueGhlContactAutomations(env.DB, event);
    return Response.json({ ok: true, queued }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("GoHighLevel contact webhook could not be queued", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "The contact event could not be queued. GoHighLevel may retry this delivery." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
