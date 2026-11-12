export const chessClockMs = (control: "5m" | "10m" | "3d" | "inf") => control === "5m" ? 5 * 60_000 : control === "10m" ? 10 * 60_000 : control === "3d" ? 3 * 24 * 60 * 60_000 : 0;

export function withoutChessActivity<T extends { title?: unknown }>(items: T[]) {
  return items.filter((item) => !String(item.title || "").startsWith("Chess "));
}
