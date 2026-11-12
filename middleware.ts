// F2B Agency OS · client login fence. Runs before every page and API route.
// Team members pass through untouched. An Access email listed in client_users (and not on the team) only gets
// /client-portal, /f2b-site-editor.js, /api/client-portal/me and /api/client-site for their own client; everything else is 403.
import { env } from 'cloudflare:workers';
import { NextResponse, type NextRequest } from 'next/server';
import { clientGate } from '@/lib/client-portal/client-portal-gate';

export async function middleware(request: NextRequest) {
  const email = (request.headers.get('cf-access-authenticated-user-email') ?? request.headers.get('oai-authenticated-user-email'))?.trim().toLowerCase();
  if (!email) return NextResponse.next();
  const user = { userId: request.headers.get('oai-authenticated-user-id') ?? `cloudflare-access:${email}`, email };
  const e = env as unknown as { DB?: D1Database; BUCKET?: R2Bucket };
  if (!e.DB) return NextResponse.next();
  try {
    const res = await clientGate(request, { DB: e.DB, BUCKET: e.BUCKET }, user);
    return res ?? NextResponse.next();
  } catch (error) {
    // Never lock the team out if the gate hits a database hiccup.
    console.error('client gate failed', error);
    return NextResponse.next();
  }
}
// Every path except Next's build chunks (static code only, no data).
export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
