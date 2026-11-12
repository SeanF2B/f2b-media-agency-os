import test from "node:test";
import assert from "node:assert/strict";
import stockfish from "stockfish";
import { Chess } from "chess.js";
import { sanHistoryToUci } from "../lib/stockfish-client.ts";

test("Stockfish 19 returns a legal move after receiving full opening history", async () => {
  const history = ["e4", "c5", "Nf3"];
  const moves = sanHistoryToUci(history);
  const chess = new Chess();
  for (const san of history) chess.move(san);

  const bestMove = await new Promise((resolve, reject) => {
    let initialized = false;
    let searching = false;
    const engine = stockfish("lite-single", (line) => {
      if (line.includes("uciok") && !initialized) {
        initialized = true;
        setTimeout(() => { engine.processCommand("setoption name Skill Level value 18"); engine.processCommand("isready"); }, 0);
      } else if (line.includes("readyok") && !searching) {
        searching = true;
        setTimeout(() => { engine.processCommand(`position startpos moves ${moves.join(" ")}`); engine.processCommand("go movetime 300"); }, 0);
      } else if (/\bbestmove\s+/.test(line)) {
        clearTimeout(timeout);
        engine.terminate();
        resolve(line.match(/\bbestmove\s+(\S+)/)?.[1]);
      }
    });
    const timeout = setTimeout(() => { engine.terminate(); reject(new Error("Stockfish timed out")); }, 10_000);
    engine.processCommand("uci");
  });

  assert.match(bestMove, /^[a-h][1-8][a-h][1-8][qrbn]?$/);
  const move = chess.move({ from: bestMove.slice(0, 2), to: bestMove.slice(2, 4), ...(bestMove[4] ? { promotion: bestMove[4] } : {}) });
  assert.ok(move, `Stockfish move ${bestMove} must be legal in the current position`);
});
