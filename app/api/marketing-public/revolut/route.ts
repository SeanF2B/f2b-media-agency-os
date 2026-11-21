import { handleRevolutWebhook } from "@/lib/invoicing/payments";

// Revolut Business Merchant webhook for invoice payment links. Public path (Revolut calls it); every request must carry a
// valid Revolut-Signature for the signing secret saved when Revolut was connected in Books → Invoicing → Settings, and the
// order is re-fetched from Revolut before an invoice is marked paid. Registered automatically on connect.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 256_000) return new Response("Too large", { status: 413 });
  try {
    const r = await handleRevolutWebhook(raw, request.headers);
    return new Response(r.body, { status: r.status });
  } catch (error) {
    console.error("invoicing:revolut-webhook", error);
    return new Response("Webhook processing failed", { status: 500 }); // Revolut retries
  }
}
