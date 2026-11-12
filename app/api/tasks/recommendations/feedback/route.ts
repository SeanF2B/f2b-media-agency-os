import { getChatGPTUser } from "../../../../chatgpt-auth";
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

type Recommendation = {
  id: string;
  followUpTaskId?: string;
  rejectedAt?: string;
  supersededAt?: string;
  [key: string]: unknown;
};

type WorkspaceData = {
  settings?: { adminEmail?: string };
  staff?: Array<{ email?: string; role?: string; isBot?: boolean }>;
  tasks?: Array<{
    id?: string;
    aiRecommendations?: Recommendation[];
    aiLandingPageRecommendations?: Recommendation[];
  }>;
};

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Please sign in again, then save your feedback." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "Feedback could not be saved right now. Try again shortly." }, { status: 503 });

  let body: { taskId?: string; recommendationId?: string; feedback?: string; choices?: unknown };
  try { body = await request.json() as typeof body; }
  catch { return Response.json({ error: "Your feedback could not be read. Please try again." }, { status: 400 }); }
  const taskId = String(body.taskId || "").slice(0, 120);
  const recommendationId = String(body.recommendationId || "").slice(0, 120);
  const feedback = String(body.feedback || "").trim().slice(0, 500);
  const choices = Array.isArray(body.choices) ? body.choices.filter((choice): choice is string => typeof choice === "string").slice(0, 8) : [];
  if (!taskId || !recommendationId || (!feedback && !choices.length)) return Response.json({ error: "Add a note or choose an option first." }, { status: 400 });

  try {
    // Read only the single workspace row. A conditional write protects this
    // focused update from racing with full workspace saves.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const row = await env.DB.prepare(`SELECT owner_id, data, updated_at FROM workspace_documents WHERE id = 'f2b-agency' LIMIT 1`)
        .first<{ owner_id: string; data: string; updated_at: string }>();
      if (!row) return Response.json({ error: "The workspace could not be found. Refresh and try again." }, { status: 404 });

      const workspace = JSON.parse(row.data) as WorkspaceData;
      const isAdmin = row.owner_id === user.userId
        || String(workspace.settings?.adminEmail || "").trim().toLowerCase() === user.email.toLowerCase()
        || (workspace.staff || []).some((member) => !member.isBot
          && ["Owner", "Admin"].includes(String(member.role || ""))
          && String(member.email || "").trim().toLowerCase() === user.email.toLowerCase());
      if (!isAdmin) return Response.json({ error: "Only an owner or admin can save recommendation feedback." }, { status: 403 });

      const taskIndex = (workspace.tasks || []).findIndex((task) => task.id === taskId);
      const task = workspace.tasks?.[taskIndex];
      if (!task) return Response.json({ error: "That suggestion is no longer available. Refresh and try again." }, { status: 404 });
      const lists = ["aiRecommendations", "aiLandingPageRecommendations"] as const;
      let listName: typeof lists[number] | undefined;
      let recommendationIndex = -1;
      let recommendation: Recommendation | undefined;
      for (const name of lists) {
        const index = (task[name] || []).findIndex((item) => item.id === recommendationId);
        if (index >= 0) { listName = name; recommendationIndex = index; recommendation = task[name]![index]; break; }
      }
      if (!listName || !recommendation) return Response.json({ error: "That suggestion is no longer available. Refresh and try again." }, { status: 404 });
      if (recommendation.followUpTaskId || recommendation.rejectedAt || recommendation.supersededAt) return Response.json({ error: "This suggestion has already been actioned. Refresh the list to continue." }, { status: 409 });

      const now = new Date().toISOString();
      const updatedRecommendation = { ...recommendation, ownerFeedback: feedback, ownerFeedbackChoices: choices, ownerFeedbackUpdatedAt: now };
      const path = `$.tasks[${taskIndex}].${listName}[${recommendationIndex}]`;
      const saved = await env.DB.prepare(`UPDATE workspace_documents
        SET data = json_set(data, ?1, json(?2)), updated_at = ?3
        WHERE id = 'f2b-agency' AND updated_at = ?4
          AND json_extract(data, ?1 || '.id') = ?5
          AND json_extract(data, ?1 || '.followUpTaskId') IS NULL
          AND json_extract(data, ?1 || '.rejectedAt') IS NULL
          AND json_extract(data, ?1 || '.supersededAt') IS NULL`)
        .bind(path, JSON.stringify(updatedRecommendation), `recommendation-feedback-${crypto.randomUUID()}`, row.updated_at, recommendationId).run();
      if (saved.meta.changes === 1) return Response.json({ ok: true, savedAt: now }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "The workspace changed while saving. Please try again." }, { status: 409 });
  } catch (error) {
    console.error("Recommendation feedback save failed", error);
    return Response.json({ error: "Your feedback is still on screen, but did not save. Please try again." }, { status: 503 });
  }
}
