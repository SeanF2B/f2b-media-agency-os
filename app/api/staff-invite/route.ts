import { env } from "cloudflare:workers";
import { logSystemEmail } from "@/lib/email-log";
import { getChatGPTUser } from "../../chatgpt-auth";
import { F2B_MEDIA_MARK_EMAIL_BASE64 } from "@/lib/f2b-media-mark-email";
import { ensureStaffHasWorkspaceAccess } from "@/lib/cloudflare-access-staff";

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
    const access = await ensureStaffHasWorkspaceAccess(recipient.email);
    if (!access.ok) return Response.json({ error: `The invitation was not sent because workspace access could not be confirmed. ${access.error}`, accessConfigured: access.configured }, { status: access.configured ? 502 : 503 });
    if (!env.RESEND_API_KEY || !env.TASK_NOTIFICATION_FROM) return Response.json({ error: "Email sending is not configured. RESEND_API_KEY and TASK_NOTIFICATION_FROM are required." }, { status: 503 });

    const appUrl = env.TASK_APP_URL || new URL(request.url).origin;
    const joinUrl = new URL(appUrl);
    if (joinUrl.protocol !== "https:" && joinUrl.protocol !== "http:") return Response.json({ error: "The workspace join link is not a valid web address." }, { status: 503 });
    const safeJoinUrl = joinUrl.toString();
    const senderName = senderProfile?.name || user.displayName || "F2B Media";
    const resolved = message
      .replaceAll("{{name}}", String(recipient.name || "there"))
      .replaceAll("{{email}}", recipient.email)
      .replaceAll("{{appUrl}}", safeJoinUrl)
      .replaceAll("{{sender}}", senderName);
    const text = `${resolved}\n\nJoin now: ${safeJoinUrl}`;
    const html = `<div style="margin:0;background:#eef2f6;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;color:#222124"><div style="display:none;max-height:0;overflow:hidden;opacity:0">You’ve been invited to join the F2B Media workspace. Open your invitation to sign in.</div><table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #d9dfe5;border-radius:14px;overflow:hidden"><tr><td style="padding:18px 24px;background:#222124"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="vertical-align:middle;padding-right:13px"><img src="cid:f2b-media-mark" width="54" height="50" alt="F2B Media logo" style="display:block;width:54px;height:50px;object-fit:contain;border:0;background:#fff;border-radius:9px" /></td><td style="vertical-align:middle"><div style="font-size:20px;line-height:1.2;font-weight:700;color:#fff">F2B Media</div><div style="margin-top:4px;font-size:11px;letter-spacing:1.4px;font-weight:700;color:#b7dafa">TEAM WORKSPACE</div></td></tr></table></td></tr><tr><td height="5" style="height:5px;background:#287cac;font-size:1px;line-height:1px">&nbsp;</td></tr><tr><td align="center" style="padding:32px 28px 10px"><div style="display:inline-block;padding:9px 15px;border-radius:30px;background:#e8f2fc;color:#24628b;font-size:12px;line-height:1.2;font-weight:700;letter-spacing:1px">✦ &nbsp; YOUR TEAM INVITATION</div><h1 style="margin:18px 0 8px;color:#222124;font-size:27px;line-height:1.2">You’re invited to join</h1><div style="font-size:21px;line-height:1.25;font-weight:700;color:#287cac">F2B Media</div></td></tr><tr><td style="padding:16px 32px 4px;color:#303942;font-size:15px;line-height:1.7">${escapeHtml(resolved).replace(/\n/g, "<br>")}</td></tr><tr><td align="center" style="padding:24px 24px 14px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" bgcolor="#287cac" style="border-radius:8px"><a href="${escapeHtml(safeJoinUrl)}" target="_blank" style="display:inline-block;padding:15px 34px;border:1px solid #287cac;border-radius:8px;background:#287cac;color:#fff;text-decoration:none;font-size:16px;line-height:1.2;font-weight:700">Join now&nbsp; →</a></td></tr></table></td></tr><tr><td align="center" style="padding:0 28px 26px;color:#68737d;font-size:12px;line-height:1.6">Use your own verified email to sign in. If the button doesn’t work, copy this link into your browser:<br /><a href="${escapeHtml(safeJoinUrl)}" style="color:#24628b;word-break:break-all">${escapeHtml(safeJoinUrl)}</a></td></tr><tr><td align="center" style="padding:15px 20px;border-top:1px solid #e5e9ed;background:#f8fafc;color:#77818a;font-size:11px;line-height:1.5">F2B Media · Private team workspace</td></tr></table></div>`;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `staff-invite/${staffId}/${crypto.randomUUID()}` },
      body: JSON.stringify({ from: env.TASK_NOTIFICATION_FROM, to: [recipient.email], subject, text, html, attachments: [{ filename: "f2b-media-mark.png", content: F2B_MEDIA_MARK_EMAIL_BASE64, content_id: "f2b-media-mark", content_type: "image/png" }] }),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json().catch(() => null) as { id?: string; message?: string } | null;
    if (!response.ok || !result?.id) return Response.json({ error: `Email service returned HTTP ${response.status}: ${result?.message || "the email was not accepted"}` }, { status: 502 });
    await logSystemEmail(env.DB as never, { to: recipient.email, name: String(recipient.name || ""), subject, text });
    return Response.json({ ok: true, accepted: true, email: recipient.email, providerId: result.id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not send the team login email." }, { status: 500 });
  }
}
