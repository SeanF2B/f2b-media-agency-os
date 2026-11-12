export type TaskRepeat = "None" | "Daily" | "Weekly" | "Fortnightly" | "Monthly";

export function localTimeFromIso(value?: string, fallback = "09:00"): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function localTaskDueAt(date: string, time: string): string | undefined {
  if (!date) return undefined;
  const parsed = new Date(`${date}T${time || "09:00"}:00`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

export function nextRecurringTaskDate(task: { due?: string; repeat?: TaskRepeat }, from = new Date()): string {
  const today = new Date(from); today.setHours(0, 0, 0, 0);
  const next = task.due ? new Date(`${task.due}T00:00:00`) : new Date(today);
  const repeat = task.repeat || "None";
  const advance = () => {
    if (repeat === "Monthly") {
      const day = next.getDate();
      next.setDate(1);
      next.setMonth(next.getMonth() + 1);
      next.setDate(Math.min(day, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
    } else next.setDate(next.getDate() + (repeat === "Daily" ? 1 : repeat === "Fortnightly" ? 14 : 7));
  };
  advance();
  while (next <= today) advance();
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
}
