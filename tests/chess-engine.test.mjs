import test from "node:test";
import assert from "node:assert/strict";
import { chessClockMs, withoutChessActivity } from "../lib/chess-engine.ts";
import { sanHistoryToUci } from "../lib/stockfish-client.ts";

test("legacy chess time controls and infinite games have the expected clocks", () => {
  assert.equal(chessClockMs("5m"), 5 * 60_000);
  assert.equal(chessClockMs("10m"), 10 * 60_000);
  assert.equal(chessClockMs("3d"), 3 * 24 * 60 * 60_000);
  assert.equal(chessClockMs("inf"), 0);
});

test("workspace activity excludes old chess events but keeps other agency activity", () => {
  const activity = [{ title: "Chess move played" }, { title: "Chess invitation email sent" }, { title: "Task updated" }];
  assert.deepEqual(withoutChessActivity(activity), [{ title: "Task updated" }]);
});

test("Stockfish receives a complete UCI history to account for repetition", () => {
  const history = ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8"];
  assert.deepEqual(sanHistoryToUci(history), ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"]);
});
