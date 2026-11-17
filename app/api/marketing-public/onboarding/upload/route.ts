import * as E from "@/lib/onboarding/engine.mjs";
import { OnboardingError, agencyOwnerId, getSettings, linkSecret, consumeLimits, getSession, storeUpload, listFiles } from "@/lib/onboarding/server";

// Public onboarding uploads: website files (.zip/.html), brochures and PDFs, logos, brand guidelines and photos.
// Files are checked by their real bytes, stored privately in R2 under the session (never publicly served), and
// their text is extracted for the business profile. Rate limited per session.
export const dynamic = "force-dynamic";
const reply = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
const PURPOSES = new Set(["document", "site", "logo", "brand", "photo"]);
const MAX_REQUEST = 26_000_000;

export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return reply({ error: "Not allowed." }, 403);
    if (Number(request.headers.get("content-length") || 0) > MAX_REQUEST) return reply({ error: "That file is too large (max 25 MB)." }, 413);
    const form = await request.formData().catch(() => null);
    if (!form) return reply({ error: "Choose a file to upload." }, 400);
    const ownerId = await agencyOwnerId();
    const settings = await getSettings(ownerId);
    const payload = await E.readLinkToken(linkSecret(), String(form.get("t") || ""));
    if (!payload?.s || !["resume", "staff"].includes(payload.k)) return reply({ error: "This onboarding link has expired. Start again." }, 401);
    const session = await getSession(ownerId, payload.s);
    if (!session) return reply({ error: "We couldn't find that onboarding session." }, 404);
    const file = form.get("file");
    if (!file || typeof file === "string") return reply({ error: "Choose a file to upload." }, 400);
    const purpose = PURPOSES.has(String(form.get("purpose"))) ? String(form.get("purpose")) : "document";
    const allowed = await consumeLimits(E.limitBuckets("upload", { session: session.id, staff: Boolean(session.staff) }, settings.limits));
    if (!allowed.ok) return reply({ error: "You've reached the upload limit for today." }, 429);
    const blob = file as File;
    if (blob.size > MAX_REQUEST) return reply({ error: "That file is too large (max 25 MB)." }, 413);
    const stored = await storeUpload(session, { name: blob.name || "upload", type: blob.type || "", bytes: new Uint8Array(await blob.arrayBuffer()) }, purpose);
    return reply({ file: { id: stored.id, name: stored.name, kind: stored.kind, size: stored.size, purpose: stored.purpose, hasText: stored.text.trim().length > 40 }, files: await listFiles(session) });
  } catch (error) {
    if (error instanceof OnboardingError) return reply({ error: error.message }, error.status);
    console.error("onboarding:upload", error);
    return reply({ error: "The upload failed. Please try again." }, 500);
  }
}
