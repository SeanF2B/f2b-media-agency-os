import { OnboardingError, handleStripeWebhook } from "@/lib/onboarding/server";

// Stripe webhook for online onboarding checkout. Public path (Stripe calls it), but every request must carry a
// valid Stripe-Signature for the configured test or live webhook secret; each event id is applied only once.
// Point Stripe at: https://<agency-os-host>/api/marketing-public/stripe
// Events: checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed,
// checkout.session.expired, invoice.paid, invoice.payment_failed, customer.subscription.updated, customer.subscription.deleted
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const payload = await request.text();
  if (payload.length > 512_000) return new Response("Too large", { status: 413 });
  try {
    const result = await handleStripeWebhook(payload, request.headers.get("stripe-signature"), new URL(request.url).origin);
    return Response.json({ received: true, ...result });
  } catch (error) {
    if (error instanceof OnboardingError && error.status === 400) return new Response(error.message, { status: 400 });
    console.error("onboarding:stripe-webhook", error);
    return new Response("Webhook processing failed", { status: 500 });
  }
}
