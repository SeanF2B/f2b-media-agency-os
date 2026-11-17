import { renderStartPage } from "@/lib/onboarding/page";

// Personalised onboarding links (CRM contact prefill, cold email, referral, staff) and resume links after checkout.
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ token: string }> };
export async function GET(request: Request, context: RouteContext) {
  const { token } = await context.params;
  return renderStartPage(request, token);
}
