// Public Twilio voice webhook for the AI phone agent (signature-checked in lib/voice-agent/webhooks).
import { incoming } from "@/lib/voice-agent/webhooks";

export const dynamic = "force-dynamic";
export async function POST(request: Request) { return incoming(request); }
export async function GET() { return new Response("F2B AI phone agent webhook is active.", { status: 200 }); }
