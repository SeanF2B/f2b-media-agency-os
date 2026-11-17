import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getGoogleAdsAccountWebsite } from "@/lib/google-ads-direct";
import { ExtractError, extractFromWebsite } from "@/lib/onboarding/extract";
import { cacheExtractedProfile } from "@/lib/onboarding/server";
import { friendlyAiError } from "@/lib/onboarding/engine.mjs";
const E = { friendlyAiError };

// Operations → Onboarding → "Fill from website": reads the client's public website (home + a few key pages)
// and has the AI pre-fill the questionnaire. Returns suggestions only; the person reviews before saving.
// Uses the same extractor as the public /f/start funnel, and caches the result in the shared business profile.
export const dynamic = "force-dynamic";
const respond = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function adminOwner() {
  const user = await getChatGPTUser();
  if (!user) return { response: respond({ error: "Sign in first." }, 401) };
  if (!env.DB) return { response: respond({ error: "The workspace database is unavailable." }, 503) };
  const row = await env.DB.prepare("SELECT owner_id, json_extract(data, '$.ownerId') AS owner, json_extract(data, '$.staff') AS staff FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ owner_id: string; owner: string; staff: string }>();
  const staff = JSON.parse(row?.staff || "[]") as Array<{ id?: string; email?: string; role?: string; isBot?: boolean }>;
  const profile = staff.find((item) => !item.isBot && (item.id === user.userId || item.email?.toLowerCase() === user.email.toLowerCase()));
  if (!(row?.owner === user.userId || row?.owner_id === user.userId || ["Owner", "Admin"].includes(profile?.role || ""))) return { response: respond({ error: "Only an owner or admin can run onboarding." }, 403) };
  return { ownerId: String(row?.owner_id || "") };
}

// GET ?googleAdsAccountId=… → the website the client's ads send people to (used to prefill onboarding).
export async function GET(request: Request) {
  const auth = await adminOwner();
  if ("response" in auth) return auth.response;
  const accountId = (new URL(request.url).searchParams.get("googleAdsAccountId") || "").replace(/\D/g, "");
  if (!accountId || !auth.ownerId) return respond({ website: "", name: "" });
  try { return respond(await getGoogleAdsAccountWebsite(auth.ownerId, accountId)); }
  catch (reason) { return respond({ website: "", name: "", error: reason instanceof Error ? reason.message.slice(0, 200) : "Google Ads unavailable." }); }
}

export async function POST(request: Request) {
  const auth = await adminOwner();
  if ("response" in auth) return auth.response;
  let body: { url?: string; name?: string };
  try { body = await request.json() as typeof body; } catch { return respond({ error: "Send the website address." }, 400); }
  try {
    const found = await extractFromWebsite(auth.ownerId, String(body.url || ""), String(body.name || ""));
    // Cache for reuse by audits, website generation, ads and SEO. Never blocks the reply.
    await cacheExtractedProfile(auth.ownerId, found.url, found).catch(() => undefined);
    const { sourceText: _sourceText, html: _html, url: _url, aiError, aiUsed, ...fields } = found;
    return respond({ ...fields, ...(aiUsed ? {} : { note: `AI was unavailable, so only the basics the site states were read. ${E.friendlyAiError(aiError, "agency")}` }) });
  } catch (error) {
    if (error instanceof ExtractError) return respond({ error: error.message }, error.status);
    return respond({ error: "Couldn’t fill from the website. Try again." }, 502);
  }
}
