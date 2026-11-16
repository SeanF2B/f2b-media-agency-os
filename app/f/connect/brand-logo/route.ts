import { F2B_LOGIN_LOGO_PNG_BASE64 } from "@/lib/f2b-login-logo";

// Public F2B logo (no login): used by the Cloudflare Access sign-in screen and client connect pages.
export const dynamic = "force-static";
export function GET() {
  const bytes = Uint8Array.from(atob(F2B_LOGIN_LOGO_PNG_BASE64), (c) => c.charCodeAt(0));
  return new Response(bytes, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400", "Access-Control-Allow-Origin": "*" } });
}
