type CompletedTask = {
  id: string;
  clientId: string;
  title?: string;
  service?: string;
  status: string;
  completedAt?: string;
  aiReviewedAt?: string;
  reviewDecidedAt?: string;
  aiFeedback?: string;
  notes?: string;
  note?: string;
};

type TaskActivity = { taskId?: string; clientId?: string; kind?: string; title?: string; at?: string };

export function previousReportWindow(start: string, end: string) {
  const from = new Date(`${start}T00:00:00.000Z`);
  const to = new Date(`${end}T00:00:00.000Z`);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from.toISOString().slice(0, 10) !== start || to.toISOString().slice(0, 10) !== end || start > end) throw new Error("Choose valid report dates before comparing periods.");
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const previousEnd = new Date(from); previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  const previousStart = new Date(previousEnd); previousStart.setUTCDate(previousStart.getUTCDate() - days + 1);
  return { start: previousStart.toISOString().slice(0, 10), end: previousEnd.toISOString().slice(0, 10) };
}

function dateInTimeZone(value: string, timeZone: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(timestamp);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function completedTasksForReport<T extends CompletedTask>(tasks: T[], activity: TaskActivity[], clientId: string, start: string, end: string, timeZone = "Europe/Dublin") {
  const completionByTask = new Map<string, string>();
  for (const item of activity) {
    if (item.kind !== "task" || item.title !== "Task completed" || !item.taskId || !item.at) continue;
    if (item.clientId && item.clientId !== clientId) continue;
    const old = completionByTask.get(item.taskId);
    if (!old || Date.parse(item.at) > Date.parse(old)) completionByTask.set(item.taskId, item.at);
  }
  let missingCompletionDate = 0;
  const selected = tasks.flatMap((task) => {
    if (task.clientId !== clientId || task.status !== "Done") return [];
    const completedAt = task.completedAt || task.aiReviewedAt || task.reviewDecidedAt || completionByTask.get(task.id);
    if (!completedAt) { missingCompletionDate += 1; return []; }
    const date = dateInTimeZone(completedAt, timeZone);
    if (!date || date < start || date > end) return [];
    return [{ id: task.id, title: String(task.title || "Completed task").slice(0, 180), service: String(task.service || "General").slice(0, 80), outcome: String(task.aiFeedback || task.notes || task.note || "").slice(0, 600), completedAt }];
  }).sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt)).slice(0, 40);
  return { tasks: selected, missingCompletionDate };
}
