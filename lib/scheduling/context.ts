// Shared server context for Scheduling routes: workspace snapshot, signed-in user's access, email + Google helpers.
import { env } from "cloudflare:workers";
import type { Deps, Mail, WorkspaceLite, StaffLite, ClientLite } from "./server";
import { createGoogleOps, googleSchedulingAvailable } from "./google";

type RawStaff = StaffLite & { clientAccessIds?: string[]; pageAccess?: string[]; staffType?: string; permissions?: Record<string, boolean> | null };

/** One indexed read of the workspace row, trimmed to what Scheduling needs. */
export async function loadSchedulingWorkspace(): Promise<(WorkspaceLite & { staffRaw: RawStaff[] }) | null> {
  if (!env.DB) return null;
  const row = await env.DB.prepare(`
    SELECT json_object(
      'ownerId', owner_id,
      'agencyName', json_extract(data, '$.settings.branding.name'),
      'clients', json(COALESCE((SELECT json_group_array(json_object('id', json_extract(value, '$.id'), 'name', json_extract(value, '$.name'), 'status', json_extract(value, '$.status'), 'phone', json_extract(value, '$.phone'), 'email', json_extract(value, '$.email'),
        'logo', CASE WHEN length(COALESCE(json_extract(value, '$.logo'), '')) > 150000 THEN '' ELSE json_extract(value, '$.logo') END,
        'branding', json_object('primary', json_extract(value, '$.branding.primary'), 'secondary', json_extract(value, '$.branding.secondary')))) FROM json_each(data, '$.clients')), '[]')),
      'staff', json(COALESCE((SELECT json_group_array(json_object('id', json_extract(value, '$.id'), 'name', json_extract(value, '$.name'), 'email', json_extract(value, '$.email'), 'role', json_extract(value, '$.role'), 'isBot', json_extract(value, '$.isBot'), 'staffType', json_extract(value, '$.staffType'),
        'avatar', CASE WHEN length(COALESCE(json_extract(value, '$.avatar'), '')) > 120000 THEN '' ELSE json_extract(value, '$.avatar') END,
        'clientAccessIds', json(COALESCE(json_extract(value, '$.clientAccessIds'), '[]')), 'pageAccess', json(json_extract(value, '$.pageAccess')), 'permissions', json(json_extract(value, '$.permissions')))) FROM json_each(data, '$.staff')), '[]'))
    ) AS data FROM workspace_documents WHERE id = 'f2b-agency'
  `).first<{ data: string }>();
  if (!row?.data) return null;
  const parsed = JSON.parse(row.data) as { ownerId: string; agencyName?: string; clients: ClientLite[]; staff: RawStaff[] };
  // AI teammates (no email, e.g. "Claude | Content Writer") can't take appointments.
  const staffRaw = (parsed.staff || []).filter((s) => s && s.id && !s.isBot && /@/.test(String(s.email || "")) && !/^(claude-|f2b-ai)/.test(String(s.id)));
  return { ownerId: String(parsed.ownerId || ""), agencyName: parsed.agencyName || "F2B Media", clients: (parsed.clients || []).filter((c) => c && c.id), staff: staffRaw.map(({ id, name, email, role, avatar }) => ({ id, name, email, role, avatar })), staffRaw };
}

export function schedulingDeps(request: Request): Deps {
  const from = env.TASK_NOTIFICATION_FROM;
  const sendEmail = env.RESEND_API_KEY && from ? async (mail: Mail) => {
    const address = (from.match(/<([^>]+)>/)?.[1] || from).trim();
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": mail.idempotencyKey.slice(0, 250) },
      body: JSON.stringify({ from: mail.fromName ? `${mail.fromName.replace(/[<>"]/g, "").slice(0, 60)} <${address}>` : from, to: mail.to, subject: mail.subject, html: mail.html, text: mail.text, ...(mail.replyTo ? { reply_to: mail.replyTo } : {}) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) { const d = await res.json().catch(() => null) as { message?: string } | null; throw new Error(`Email provider returned HTTP ${res.status}: ${d?.message || "not accepted"}`); }
  } : undefined;
  return { db: env.DB as never, sendEmail, google: googleSchedulingAvailable() ? createGoogleOps() : undefined, baseUrl: new URL(request.url).origin };
}

export const SCHED_MANAGER_ROLES = ["Sub-account Manager"];
export const SCHED_ROLES = ["Sub-account Manager", "Sub-account User"];
