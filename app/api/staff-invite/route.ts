import { env } from "cloudflare:workers";
import { logSystemEmail } from "@/lib/email-log";
import { getChatGPTUser } from "../../chatgpt-auth";
import { createToken, ensureAuthSchema, authEmailHtml } from "@/lib/auth/password-auth.js";

export const dynamic = "force-dynamic";
type StaffRecord = { id: string; name?: string; email: string; role: string; isBot?: boolean };

function escapeHtml(value: string) {
  return value.replace(/[&<>\"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character] || character);
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in to send a team invitation." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "Workspace database is unavailable." }, { status: 503 });

  try {
    const body = await request.json() as { staffId?: unknown; subject?: unknown; message?: unknown };
    const staffId = typeof body.staffId === "string" ? body.staffId.trim() : "";
    const subject = typeof body.subject === "string" ? body.subject.replace(/[\r\n\t]+/g, " ").trim().slice(0, 180) : "";
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 6000) : "";
    if (!staffId || !subject || !message) return Response.json({ error: "Choose a staff profile and enter an email subject and message." }, { status: 400 });

    const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string }>();
    if (!row?.data) return Response.json({ error: "Workspace could not be loaded." }, { status: 503 });
    const data = JSON.parse(row.data);
    const staff: StaffRecord[] = Array.isArray(data.staff) ? data.staff : [];
    const senderProfile = staff.find((member) => !member.isBot && (member.id === user.userId || member.email?.toLowerCase() === user.email?.toLowerCase()));
    const canManage = data.ownerId === user.userId || (senderProfile && ["Owner", "Admin"].includes(senderProfile.role));
    if (!canManage) return Response.json({ error: "Only the workspace owner or an admin can send team login emails." }, { status: 403 });

    const recipient = staff.find((member) => member.id === staffId && !member.isBot);
    if (!recipient) return Response.json({ error: "That staff profile no longer exists. Refresh the team list and try again." }, { status: 404 });
    if (typeof recipient.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email)) {
      return Response.json({ error: "Add a valid email address to this saved staff profile first." }, { status: 400 });
    }
    if (!env.RESEND_API_KEY || !env.TASK_NOTIFICATION_FROM) return Response.json({ error: "Email sending is not configured. RESEND_API_KEY and TASK_NOTIFICATION_FROM are required." }, { status: 503 });

    const appUrl = env.TASK_APP_URL || new URL(request.url).origin;
    const joinUrl = new URL(appUrl);
    if (joinUrl.protocol !== "https:" && joinUrl.protocol !== "http:") return Response.json({ error: "The workspace join link is not a valid web address." }, { status: 503 });
    const siteUrl = new URL("/", joinUrl).toString();
    // Own login: a single-use "set your password" link (7 days). Someone who already has a password gets the sign-in page.
    await ensureAuthSchema(env.DB as never);
    const inviteeEmail = recipient.email.trim().toLowerCase();
    const hasPassword = await env.DB.prepare("SELECT 1 AS ok FROM auth_users WHERE email = ?1").bind(inviteeEmail).first();
    const safeJoinUrl = hasPassword ? new URL("/login", joinUrl).toString() : new URL(`/set-password?token=${await createToken(env.DB as never, inviteeEmail, "invite")}`, joinUrl).toString();
    const buttonLabel = hasPassword ? "Sign in" : "Set your password";
    const senderName = senderProfile?.name || user.displayName || "F2B Media";
    const resolved = message
      .replaceAll("{{name}}", String(recipient.name || "there"))
      .replaceAll("{{email}}", recipient.email)
      .replaceAll("{{appUrl}}", siteUrl)
      .replaceAll("{{sender}}", senderName);
    const text = `${resolved}\n\n${buttonLabel}: ${safeJoinUrl}\n\nWorkspace: ${siteUrl}\nOn your phone: open the workspace link, sign in, then Share → Add to Home Screen (iPhone) or ⋮ → Install app (Android).`;
    const esc = (v: string) => escapeHtml(String(v));
    const html = authEmailHtml({ heading: `You’re invited to join F2B Media`, intro: resolved, buttonLabel, link: safeJoinUrl, appUrl: siteUrl, esc });
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `staff-invite/${staffId}/${crypto.randomUUID()}` },
      body: JSON.stringify({ from: env.TASK_NOTIFICATION_FROM, to: [recipient.email], subject, text, html }),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json().catch(() => null) as { id?: string; message?: string } | null;
    if (!response.ok || !result?.id) return Response.json({ error: `Email service returned HTTP ${response.status}: ${result?.message || "the email was not accepted"}` }, { status: 502 });
    await logSystemEmail(env.DB as never, { to: recipient.email, name: String(recipient.name || ""), subject, text: text.replace(/token=[\w-]+/g, "token=•••"), html: html.replace(/token=[\w-]+/g, "token=•••") });
    return Response.json({ ok: true, accepted: true, email: recipient.email, providerId: result.id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not send the team login email." }, { status: 500 });
  }
}
