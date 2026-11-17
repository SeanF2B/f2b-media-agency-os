import { renderStartPage } from "@/lib/onboarding/page";

// Public onboarding funnel: "I'm ready to grow" · "Audit my business" · "I need some guidance".
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return renderStartPage(request);
}
