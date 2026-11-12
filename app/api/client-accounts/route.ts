// F2B Agency OS · client sub-accounts API for the in-app client switcher (public/f2b-client-switcher.js).
// GET  /api/client-accounts[?include=archived]  → { accounts, agencyPipelines, pipelineClient, me }
// POST /api/client-accounts { action: 'archive' | 'restore' | 'settings', clientId, settings? }   (owner / Owner+Admin staff only)
// Auth is the same as /api/crm: Cloudflare Access / oai headers. Staff only ever see their clientAccessIds.
import { env } from 'cloudflare:workers';
import { headers } from 'next/headers';
import { handleClientAccounts } from '@/lib/client-accounts/client-accounts-api';

export const dynamic = 'force-dynamic';

// Same logic as the app's session helper used by /api/crm (lib/chatgpt-auth). Swap for that import if you prefer:
//   import { <helper> } from '@/lib/chatgpt-auth';  const user = await <helper>();
async function currentUser(): Promise<{ userId: string; email: string } | null> {
  const h = await headers();
  const email = (h.get('cf-access-authenticated-user-email') ?? h.get('oai-authenticated-user-email'))?.trim().toLowerCase();
  if (!email) return null;
  return { userId: h.get('oai-authenticated-user-id') ?? `cloudflare-access:${email}`, email };
}

function db() {
  const d = (env as unknown as { DB?: D1Database }).DB;
  if (!d) throw new Error('The private workspace database is unavailable.');
  return d;
}

export async function GET(request: Request) {
  return handleClientAccounts(request, db(), await currentUser());
}
export async function POST(request: Request) {
  return handleClientAccounts(request, db(), await currentUser());
}
