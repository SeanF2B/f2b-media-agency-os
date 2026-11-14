import { env } from "cloudflare:workers";
import { exchangeSeedToken } from "@/lib/outreach/placement.mjs";
import { saveSeed, verifyState } from "@/lib/outreach/server/actions";
import { ensureOutreachSchema } from "@/lib/outreach/server/store";

export const dynamic = "force-dynamic";

/** OAuth return for seed inboxes (read-only access to a free Gmail / Outlook.com account you own). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (message: string) => Response.redirect(`${url.origin}/?page=CRM&leads=outreach&outreachTab=infrastructure&seed=${encodeURIComponent(message)}`, 302);
  const state = await verifyState(url.searchParams.get("state") || "");
  if (!state) return back("The sign-in link expired. Try again.");
  if (url.searchParams.get("error")) return back("Sign-in was cancelled.");
  const vars = env as unknown as Record<string, string | undefined>;
  const credentials = state.provider === "gmail" ? { clientId: vars.OUTREACH_SEED_GOOGLE_CLIENT_ID || "", clientSecret: vars.OUTREACH_SEED_GOOGLE_CLIENT_SECRET || "" } : { clientId: vars.OUTREACH_SEED_MS_CLIENT_ID || "", clientSecret: vars.OUTREACH_SEED_MS_CLIENT_SECRET || "" };
  try {
    const tokens = await exchangeSeedToken(state.provider, { ...credentials, redirectUri: `${url.origin}/api/outreach/seed-callback`, code: url.searchParams.get("code") || "" });
    if (!tokens.refreshToken) return back("No long-term access was granted. Remove the app from the account's permissions and try again.");
    const profileUrl = state.provider === "gmail" ? "https://gmail.googleapis.com/gmail/v1/users/me/profile" : "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName";
    const profile = await fetch(profileUrl, { headers: { Authorization: `Bearer ${tokens.accessToken}` } }).then((response) => response.json() as Promise<Record<string, string>>);
    const email = String(profile.emailAddress || profile.mail || profile.userPrincipalName || "").toLowerCase();
    if (!email) return back("Couldn't read the seed inbox address.");
    await ensureOutreachSchema();
    await saveSeed(state.ownerId, state.provider, email, tokens.refreshToken);
    return back(`Seed inbox ${email} connected.`);
  } catch (error) {
    return back(error instanceof Error ? error.message : "Couldn't connect the seed inbox.");
  }
}
