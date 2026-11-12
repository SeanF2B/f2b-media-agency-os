// F2B Agency OS · in-app website content editor API (Marketing → Websites → "Edit site content", and the client portal).
// Saves go ONLY to the client's preview working copy (D1 + R2). There is no publish/live path here.
// Needs bindings: DB (D1, already bound) and BUCKET (R2; bind the existing f2b-marketing-studio-assets bucket as BUCKET, see PATCHES.md §8).
import { env } from 'cloudflare:workers';
import { headers } from 'next/headers';
import { handleClientSite } from '@/lib/site-content/client-site-api';

export const dynamic = 'force-dynamic';

async function currentUser(): Promise<{ userId: string; email: string } | null> {
  const h = await headers();
  const email = (h.get('cf-access-authenticated-user-email') ?? h.get('oai-authenticated-user-email'))?.trim().toLowerCase();
  if (!email) return null;
  return { userId: h.get('oai-authenticated-user-id') ?? `cloudflare-access:${email}`, email };
}
function bindings() {
  const e = env as unknown as { DB?: D1Database; BUCKET?: R2Bucket };
  if (!e.DB) throw new Error('The private workspace database is unavailable.');
  return { DB: e.DB, BUCKET: e.BUCKET };
}
export async function GET(request: Request) { return handleClientSite(request, bindings(), await currentUser()); }
export async function POST(request: Request) { return handleClientSite(request, bindings(), await currentUser()); }
