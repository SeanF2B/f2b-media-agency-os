import assert from "node:assert/strict";
import test from "node:test";
import { upsertClientReport } from "../lib/report-history.ts";

const report = (id, clientId, generatedAt) => ({ id, clientId, generatedAt });

test("report history keeps the newest 20 reports independently for each client", () => {
  const existing = [
    ...Array.from({ length: 20 }, (_, index) => report(`a-${index}`, "a", `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00Z`)),
    ...Array.from({ length: 20 }, (_, index) => report(`b-${index}`, "b", `2026-02-${String(index + 1).padStart(2, "0")}T00:00:00Z`)),
  ];
  const result = upsertClientReport(existing, report("a-new", "a", "2026-03-01T00:00:00Z"));
  assert.equal(result.filter((item) => item.clientId === "a").length, 20);
  assert.equal(result.filter((item) => item.clientId === "b").length, 20);
  assert.equal(result.some((item) => item.id === "a-0"), false);
  assert.equal(result.some((item) => item.id === "b-0"), true);
});

test("saving an edited report replaces its prior copy without duplicating the history row", () => {
  const previous = report("same", "a", "2026-03-01T00:00:00Z");
  const result = upsertClientReport([previous, report("other", "b", "2026-02-01T00:00:00Z")], { ...previous, generatedAt: "2026-03-02T00:00:00Z" });
  assert.equal(result.filter((item) => item.id === "same").length, 1);
  assert.equal(result.find((item) => item.id === "same").generatedAt, "2026-03-02T00:00:00Z");
  assert.equal(result.some((item) => item.id === "other"), true);
});
