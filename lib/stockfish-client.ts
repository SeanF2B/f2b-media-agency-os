import { Chess } from "chess.js";

export type ChessDifficulty = "easy" | "medium" | "hard";
const levels: Record<ChessDifficulty, { skill: number; moveTimeMs: number }> = {
  easy: { skill: 3, moveTimeMs: 1_200 },
  medium: { skill: 10, moveTimeMs: 1_600 },
  hard: { skill: 20, moveTimeMs: 1_800 },
};

export function sanHistoryToUci(history: string[]) {
  const replay = new Chess();
  return history.map((san) => {
    const move = replay.move(san);
    return `${move.from}${move.to}${move.promotion || ""}`;
  });
}

export async function chooseStockfishMove(history: string[], difficulty: ChessDifficulty): Promise<string> {
  if (typeof Worker === "undefined") throw new Error("This browser cannot run the chess engine.");
  const worker = new Worker("/stockfish/stockfish-19-lite-single.js");
  const { skill, moveTimeMs } = levels[difficulty] || levels.medium;
  const uciMoves = sanHistoryToUci(history);

  return new Promise((resolve, reject) => {
    let initialized = false;
    let searching = false;
    let finished = false;
    const timeout = window.setTimeout(() => fail(new Error("Stockfish took too long to respond.")), 15_000);
    const cleanup = () => { window.clearTimeout(timeout); worker.terminate(); };
    const fail = (error: Error) => { if (finished) return; finished = true; cleanup(); reject(error); };
    worker.onerror = () => fail(new Error("Stockfish could not start. Reload the chess page and try again."));
    worker.onmessage = (event: MessageEvent<unknown>) => {
      const line = String(event.data || "").trim();
      if (line.includes("uciok") && !initialized) {
        initialized = true;
        worker.postMessage(`setoption name Skill Level value ${skill}`);
        worker.postMessage("isready");
      } else if (line.includes("readyok") && !searching) {
        searching = true;
        worker.postMessage(`position startpos${uciMoves.length ? ` moves ${uciMoves.join(" ")}` : ""}`);
        worker.postMessage(`go movetime ${moveTimeMs}`);
      } else if (/\bbestmove\s+/.test(line)) {
        const move = line.match(/\bbestmove\s+(\S+)/)?.[1];
        if (!move || move === "(none)" || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) {
          fail(new Error("Stockfish did not return a legal move."));
          return;
        }
        finished = true;
        cleanup();
        resolve(move);
      }
    };
    worker.postMessage("uci");
  });
}
