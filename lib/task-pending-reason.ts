export type PendingReasonTask = {
  status?: string;
  pendingReason?: string;
  pendingReasonBy?: string;
  pendingReasonAt?: string;
};

/** Enforce and attribute a reason whenever a task newly enters Pending. */
export function applyPendingReason<T extends PendingReasonTask>(task: T, previous: PendingReasonTask | undefined, actor: string, at: string) {
  const enteringPending = ["Blocked", "Pending"].includes(String(task.status || ""))
    && (!previous || !["Blocked", "Pending"].includes(String(previous.status || "")));
  if (!enteringPending) return { task, error: "" };

  const reason = String(task.pendingReason || "").trim().slice(0, 150);
  if (!reason) return { task, error: "Add a short reason before moving a task to Pending." };
  return {
    task: { ...task, pendingReason: reason, pendingReasonBy: actor, pendingReasonAt: at },
    error: "",
  };
}
