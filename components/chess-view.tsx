"use client";
import { AiIcon } from "./ai-eyes-icon";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Square } from "chess.js";
import { chooseStockfishMove } from "@/lib/stockfish-client";
import { loadChessSnapshot, saveChessSnapshot, type PendingChessMove } from "@/lib/chess-offline-store";

type Game = { id: string; mode: "staff" | "ai"; status: string; whiteId: string; blackId: string; winnerId?: string; challengerId: string; challengedId?: string; whiteName: string; blackName: string; humanColor?: "w" | "b"; aiDifficulty?: "easy" | "medium" | "hard"; timeControl: "5m" | "10m" | "3d" | "inf"; clocks: { w: number; b: number }; turnStartedAt?: string; fen: string; moves: Array<{ san: string; color: "w" | "b"; by: string; at: string }>; createdAt: string; endedAt?: string; result?: string; drawOfferBy?: string };
type Person = { id: string; name: string; avatar?: string };
type Leader = { id: string; name: string; avatar?: string; wins: number; games: number };
const files = "abcdefgh";
type PieceFlight = { from: string; to: string; piece: string; key: number };
type MoveEffect = { gameId: string; flights: PieceFlight[]; sound: "move" | "capture" | "check" | "castle"; key: number };
function ChessPiece({ piece, flight, flipped }: { piece: string; flight?: PieceFlight; flipped?: boolean }) {
  const type = piece.toLowerCase();
  const color = piece === piece.toUpperCase() ? "white-piece" : "black-piece";
  const base = <path d="M8 39h29l-2 3H10zM11 35h23l2 4H9z" />;
  const fromFile = flight ? files.indexOf(flight.from[0]) : 0;
  const toFile = flight ? files.indexOf(flight.to[0]) : 0;
  const fromRank = flight ? Number(flight.from[1]) : 1;
  const toRank = flight ? Number(flight.to[1]) : 1;
  const displayFile = (file: number) => flipped ? 7 - file : file;
  const displayRow = (rank: number) => flipped ? rank - 1 : 8 - rank;
  const dx = flight ? (displayFile(fromFile) - displayFile(toFile)) / .78 * 100 : 0;
  const dy = flight ? (displayRow(fromRank) - displayRow(toRank)) / .78 * 100 : 0;
  return <svg key={flight?.key} style={flight ? { "--move-x": `${dx}%`, "--move-y": `${dy}%` } as React.CSSProperties : undefined} className={`chess-piece-svg cp-toon ${color} ${flight ? "chess-piece-flight" : ""}`} viewBox="0 0 45 45" aria-hidden="true" focusable="false">
    <ToonPiece type={type} />
  </svg>;
}

/* Chunky 2D cartoon pieces (thick outline, flat fill, white shine, darker base) */
function ToonPiece({ type }: { type: string }) {
  const base = <><rect className="cp-shade" x="9" y="35" width="27" height="6" rx="3" /><path className="cp-shine" d="M12.5 37.2h6" /></>;
  if (type === "p") return <>
    <path className="cp-body" d="M17.5 23.5c0 4.5-2.6 7.6-5.5 11.5h21c-2.9-3.9-5.5-7-5.5-11.5z" />
    <rect className="cp-shade" x="15.5" y="19.5" width="14" height="4.5" rx="2.25" />
    <circle className="cp-body" cx="22.5" cy="13" r="6.2" />
    <circle className="cp-dot" cx="20.2" cy="10.8" r="1.7" /><path className="cp-shine" d="M18.6 26.5c-.4 2.2-1.5 4-2.9 5.8" />{base}</>;
  if (type === "r") return <>
    <path className="cp-body" d="M11.5 7.5h5.5v4h3v-4h5v4h3v-4h5.5v9.5l-3 3v12h-16v-12l-3-3z" />
    <path className="cp-line" d="M14.5 20h16" />
    <rect className="cp-shade" x="10.5" y="31.5" width="24" height="4" rx="2" />
    <path className="cp-shine" d="M17.8 22.5v7M14.2 9.5v4.5" />{base}</>;
  if (type === "n") return <>
    <path className="cp-body" d="M13.5 35.5c0-6.5 3.2-9.6 6.8-12.4-3 1.4-6.3 1.7-8.2-.6-1.6-1.9-.6-4.7 1.8-6.6 2.7-2.1 4.4-4.8 5.6-8.4l1.6-3.5 2 3.4c7.2 1.3 11.6 7.5 10.9 16.8-.4 4.6-1.8 7.6-1.8 11.3z" />
    <path className="cp-shade" d="M24.4 8.6c4.5 2.7 6.6 7.4 6.5 12.6" />
    <circle className="cp-eye" cx="21.3" cy="13.3" r="1.6" /><circle className="cp-eye" cx="14.2" cy="19.6" r=".9" />
    <path className="cp-shine" d="M17.5 31.5c.3-2.8 1.5-4.6 3.4-6.2M18.6 10.8c-1 2-2.2 3.4-3.6 4.6" />{base}</>;
  if (type === "b") return <>
    <path className="cp-body" d="M17.5 28c0 3-1.9 5-4.3 7h18.6c-2.4-2-4.3-4-4.3-7z" />
    <path className="cp-body" d="M22.5 9.2c-6.2 3.6-8.7 8.6-6.6 12.8 1 2 3.4 3.3 6.6 3.3s5.6-1.3 6.6-3.3c2.1-4.2-.4-9.2-6.6-12.8z" />
    <path className="cp-line" d="M25 13.4l-3.6 5.4" />
    <rect className="cp-shade" x="15.5" y="24.5" width="14" height="4" rx="2" />
    <circle className="cp-body" cx="22.5" cy="6.6" r="2.7" />
    <path className="cp-shine" d="M18.4 15.2c-.8 1.6-1 3.2-.5 4.6M18.6 30.2c-.4 1.3-1.1 2.3-2 3.2" />{base}</>;
  if (type === "q") return <>
    <path className="cp-body" d="M15.5 30.5c0 1.8-1.4 3.2-3.3 4.5h20.6c-1.9-1.3-3.3-2.7-3.3-4.5z" />
    <path className="cp-body" d="M10.5 14.5l4.5 13h15l4.5-13-6 5.5-6-9.5-6 9.5z" />
    <rect className="cp-shade" x="14" y="27" width="17" height="4" rx="2" />
    <circle className="cp-body" cx="10.5" cy="12.5" r="2.4" /><circle className="cp-body" cx="22.5" cy="8" r="2.6" /><circle className="cp-body" cx="34.5" cy="12.5" r="2.4" />
    <circle className="cp-dot" cx="21.6" cy="7.2" r=".9" /><path className="cp-shine" d="M15.2 18.5l1.6 5.4" />{base}</>;
  return <>
    <path className="cp-body" d="M16.5 30.5c0 1.8-1.7 3.2-4.3 4.5h20.6c-2.6-1.3-4.3-2.7-4.3-4.5z" />
    <path className="cp-body" d="M12.5 18c0-4.8 5.4-6.4 10-3 4.6-3.4 10-1.8 10 3 0 4-3.4 6.4-3.4 9.5H15.9c0-3.1-3.4-5.5-3.4-9.5z" />
    <rect className="cp-shade" x="14.5" y="27" width="16" height="4" rx="2" />
    <path className="cp-body" d="M21 2.8h3v3h3v3h-3v4.7h-3V8.8h-3v-3h3z" />
    <path className="cp-shine" d="M15.6 17.4c.2-1.6 1.4-2.6 3-2.7" />{base}</>;
}

type EndKind = "mate" | "resign" | "time" | "draw";
function EndBadge({ kind, win }: { kind: EndKind | "win"; win?: boolean }) {
  return <svg className={`chess-end-badge ${kind} ${win ? "is-winner" : ""}`} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10.5" />
    {kind === "win" && <path className="eb-icon" d="M5.5 16.5 4.8 8.5l3.9 3.3L12 6.2l3.3 5.6 3.9-3.3-.7 8z" />}
    {kind === "mate" && <path className="eb-stroke" d="M9.6 6.5 8.4 17.5M15.6 6.5l-1.2 11M6.5 10h11.5M6 14h11.5" />}
    {kind === "resign" && <><path className="eb-stroke" d="M8 18.5V5.5" /><path className="eb-icon" d="M8.4 6h8.6l-2.2 3.2L17 12.4H8.4z" /></>}
    {kind === "time" && <><circle className="eb-ring" cx="12" cy="12" r="6" /><path className="eb-stroke" d="M12 8.5V12l2.6 1.8" /></>}
    {kind === "draw" && <path className="eb-stroke" d="M7 10h10M7 14h10" />}
  </svg>;
}

/* Final position shown after a game ends: loser king square goes red with a badge, winner king gets a crown */
function ChessFinalBoard({ game, currentUserId, animate, busy, onRematch, onClose }: { game: Game; currentUserId: string; animate: boolean; busy?: boolean; onRematch: () => void; onClose: () => void }) {
  const flipped = game.blackId === currentUserId;
  const lower = (game.result || "").toLowerCase();
  const wId = winnerId(game);
  const winnerColor = wId ? (wId === game.whiteId ? "w" : "b") : null;
  let kind: EndKind = lower.includes("resign") ? "resign" : lower.includes("time") ? "time" : winnerColor ? "mate" : "draw";
  try { if (new Chess(game.fen).isCheckmate()) kind = "mate"; } catch { /* legacy FEN */ }
  const board = boardFromFen(game.fen);
  const last = latestMoveSquares(game.moves);
  const outcome = wId === currentUserId ? "win" : wId ? "loss" : "draw";
  return <div className={`chess-final ${outcome} ${animate ? "is-animating" : ""}`} role="img" aria-label={`Final position: ${game.result || "game over"}`}>
    <div className={`chess-final-board ${flipped ? "flipped" : ""}`}>
      {Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => {
        const fenRow = flipped ? 7 - r : r; const fenCol = flipped ? 7 - c : c;
        const square = `${files[fenCol]}${8 - fenRow}`;
        const piece = board[fenRow]?.[fenCol];
        const isLight = (fenRow + fenCol) % 2 === 0;
        const pieceColor = piece ? (piece === piece.toUpperCase() ? "w" : "b") : null;
        const isKing = piece?.toLowerCase() === "k";
        const loserKing = isKing && winnerColor && pieceColor !== winnerColor;
        const winnerKing = isKing && winnerColor && pieceColor === winnerColor;
        const drawKing = isKing && !winnerColor;
        const lastMove = last && (last.from === square || last.to === square);
        return <span key={square} className={`chess-final-square ${isLight ? "light" : "dark"} ${lastMove ? "last-move" : ""} ${loserKing ? "loser-king" : ""}`}>
          {piece && <ChessPiece piece={piece} flipped={flipped} />}
          {loserKing && <EndBadge kind={kind} />}
          {winnerKing && <EndBadge kind="win" win />}
          {drawKing && <EndBadge kind="draw" />}
          {c === 0 && <small>{8 - fenRow}</small>}{r === 7 && <em>{files[fenCol]}</em>}
        </span>;
      }))}
    </div>
    <div className="chess-final-actions">
      <button type="button" className="chess-final-rematch" disabled={busy} onClick={onRematch}>Rematch</button>
      <button type="button" className="chess-final-close" onClick={onClose}>Close</button>
    </div>
    {animate && outcome === "win" && <div className="chess-final-confetti" aria-hidden="true">{Array.from({ length: 40 }, (_, i) => <i key={i} style={{ "--x": `${(i * 37) % 100}%`, "--d": `${(i % 9) * 0.1}s`, "--r": `${(i * 53) % 360}deg` } as React.CSSProperties} />)}</div>}
  </div>;
}

function ChessBoardFx({ gameId, fen }: { gameId: string; fen: string }) {
  const [banner, setBanner] = useState<{ text: string; kind: "start" | "check"; key: number } | null>(null);
  const prevFen = useRef<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const wrap = ref.current?.parentElement;
    wrap?.classList.add("fx-start");
    setBanner({ text: "Game on!", kind: "start", key: Date.now() });
    const t = window.setTimeout(() => { wrap?.classList.remove("fx-start"); setBanner((b) => b?.kind === "start" ? null : b); }, 1900);
    return () => { window.clearTimeout(t); wrap?.classList.remove("fx-start"); };
  }, [gameId]);
  useEffect(() => {
    const before = prevFen.current; prevFen.current = fen;
    if (before === null || before === fen) return;
    try {
      const chess = new Chess(fen);
      if (chess.isCheckmate()) setBanner({ text: "Checkmate!", kind: "check", key: Date.now() });
      else if (chess.isCheck()) setBanner({ text: "Check!", kind: "check", key: Date.now() });
      else return;
      const t = window.setTimeout(() => setBanner((b) => b?.kind === "check" ? null : b), 1500);
      return () => window.clearTimeout(t);
    } catch { /* ignore malformed FEN */ }
  }, [fen]);
  return <div ref={ref} className="chess-fx-layer" aria-live="polite">{banner && <div key={banner.key} className={`chess-fx-banner ${banner.kind}`}>{banner.text}</div>}</div>;
}
function cleanAiNames<T extends { whiteName: string; blackName: string; result?: string }>(game: T): T { const fix = (v?: string) => v?.replace(/Connor · AI|Connor/g, "AI"); return { ...game, whiteName: fix(game.whiteName) as string, blackName: fix(game.blackName) as string, result: fix(game.result) }; }
function formatTime(ms: number) {
  const secs = Math.max(0, Math.ceil(ms / 1000));
  if (secs >= 86400) return `${Math.floor(secs / 86400)}d ${Math.floor(secs % 86400 / 3600)}h`;
  if (secs >= 3600) return `${Math.floor(secs / 3600)}:${String(Math.floor(secs % 3600 / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}
function boardFromFen(fen: string) { return fen.split(" ")[0].split("/").map((row) => { const squares: (string | null)[] = []; for (const char of row) { if (/\d/.test(char)) for (let i = 0; i < Number(char); i++) squares.push(null); else squares.push(char); } return squares; }); }
function latestMoveSquares(moves: Game["moves"]) { if (!moves.length) return null; const replay = new Chess(); let last: { from: Square; to: Square } | null = null; for (const record of moves) { try { const move = replay.move(record.san); last = { from: move.from, to: move.to }; } catch { /* Keep the latest valid move from legacy games. */ } } return last; }
function winnerId(game: Game) { return game.winnerId || (game.result?.startsWith(`${game.whiteName} wins`) ? game.whiteId : game.result?.startsWith(`${game.blackName} wins`) ? game.blackId : null); }
type ReplayPosition = { fen: string; lastMove: { from: string; to: string } | null; flights: PieceFlight[] };
function chessReplayPositions(moves: Game["moves"]): ReplayPosition[] {
  const replay = new Chess();
  const positions: ReplayPosition[] = [{ fen: replay.fen(), lastMove: null, flights: [] }];
  moves.forEach((record, index) => {
    try {
      const move = replay.move(record.san);
      const key = (index + 1) * 3;
      const flights: PieceFlight[] = [{ from: move.from, to: move.to, piece: move.promotion || move.piece, key }];
      if (move.flags.includes("k") || move.flags.includes("q")) {
        const rank = move.color === "w" ? "1" : "8";
        const kingSide = move.to[0] === "g";
        flights.push({ from: `${kingSide ? "h" : "a"}${rank}`, to: `${kingSide ? "f" : "d"}${rank}`, piece: "r", key: key + 1 });
      }
      positions.push({ fen: replay.fen(), lastMove: { from: move.from, to: move.to }, flights });
    } catch { /* Continue past malformed moves in older saved games. */ }
  });
  return positions;
}
function ChessMiniBoard({ fen, lastMove, flights = [], flipped, className = "", ariaLabel = "Chess board position" }: { fen: string; lastMove: { from: string; to: string } | null; flights?: PieceFlight[]; flipped: boolean; className?: string; ariaLabel?: string }) {
  const position = boardFromFen(fen);
  const last = lastMove;
  return <div className={`chess-thumbnail ${className}`} role="img" aria-label={ariaLabel}>
    {Array.from({ length: 8 }, (_, row) => Array.from({ length: 8 }, (_, column) => {
      const fenRow = flipped ? 7 - row : row;
      const fenColumn = flipped ? 7 - column : column;
      const piece = position[fenRow]?.[fenColumn];
      const square = `${files[fenColumn]}${8 - fenRow}`;
      const isLight = (fenRow + fenColumn) % 2 !== 0;
      const highlighted = Boolean(last && (last.from === square || last.to === square));
      const flight = piece ? flights.find((candidate) => candidate.to === square && candidate.piece.toLowerCase() === piece.toLowerCase()) : undefined;
      return <span key={`${row}-${column}`} className={`chess-thumbnail-square ${isLight ? "light" : "dark"} ${highlighted ? "last-move-highlight" : ""}`}>{piece && <ChessPiece piece={piece} flipped={flipped} flight={flight} />}</span>;
    }))}
  </div>;
}
function ChessThumbnail({ game, currentUserId, fen }: { game: Game; currentUserId: string; fen?: string }) {
  const last = latestMoveSquares(game.moves);
  const lastMove = game.moves.at(-1)?.san;
  return <ChessMiniBoard fen={fen || game.fen} lastMove={last} flipped={game.blackId === currentUserId} className="chess-game-thumbnail" ariaLabel={`${game.whiteName} vs ${game.blackName}, board after ${lastMove || "the starting position"}`} />;
}
function effectsSince(moves: Game["moves"], start: number, gameId: string, nextKey: () => number): MoveEffect[] {
  const replay = new Chess();
  const effects: MoveEffect[] = [];
  moves.forEach((record, index) => {
    try {
      const move = replay.move(record.san);
      if (index >= start) {
        const castle = move.flags.includes("k") || move.flags.includes("q");
        const sound = castle ? "castle" : replay.isCheck() ? "check" : move.captured ? "capture" : "move";
        const flights: PieceFlight[] = [{ from: move.from, to: move.to, piece: move.promotion || move.piece, key: nextKey() }];
        if (castle) {
          const rank = move.color === "w" ? "1" : "8";
          const kingSide = move.to[0] === "g";
          flights.push({ from: `${kingSide ? "h" : "a"}${rank}`, to: `${kingSide ? "f" : "d"}${rank}`, piece: "r", key: nextKey() });
        }
        effects.push({ gameId, flights, sound, key: nextKey() });
      }
    } catch { /* Skip malformed legacy history without breaking the board. */ }
  });
  return effects;
}
function playMoveSound(context: AudioContext, kind: MoveEffect["sound"]) {
  if (context.state !== "running") return;
  // A short, low wooden clack: filtered impact noise plus quickly decaying wood
  // resonances. Keeping the transient soft avoids the sharp, electronic beep.
  const tap = (offset: number, strength: number, pitch: number) => {
    const start = context.currentTime + offset;
    const frames = Math.ceil(context.sampleRate * .045);
    const buffer = context.createBuffer(1, frames, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      const envelope = (1 - i / frames) ** 2.8;
      samples[i] = (Math.random() * 2 - 1) * envelope;
    }
    const source = context.createBufferSource(); source.buffer = buffer;
    const filter = context.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.setValueAtTime(1450, start); filter.Q.setValueAtTime(.55, start);
    const noiseGain = context.createGain(); noiseGain.gain.setValueAtTime(.0001, start); noiseGain.gain.exponentialRampToValueAtTime(strength * .42, start + .002); noiseGain.gain.exponentialRampToValueAtTime(.0001, start + .05);
    source.connect(filter); filter.connect(noiseGain); noiseGain.connect(context.destination); source.start(start); source.stop(start + .05);
    for (const [ratio, volume, decay] of [[1, .19, .115], [2.13, .075, .075], [3.42, .035, .045]]) {
      const oscillator = context.createOscillator(); oscillator.type = "sine"; oscillator.frequency.setValueAtTime(pitch * ratio, start);
      const resonance = context.createGain(); resonance.gain.setValueAtTime(.0001, start); resonance.gain.exponentialRampToValueAtTime(strength * volume, start + .002); resonance.gain.exponentialRampToValueAtTime(.0001, start + decay);
      oscillator.connect(resonance); resonance.connect(context.destination); oscillator.start(start); oscillator.stop(start + decay);
    }
  };
  if (kind === "move") tap(0, .38, 185);
  if (kind === "capture") { tap(0, .31, 205); tap(.075, .48, 145); }
  if (kind === "check") { tap(0, .43, 155); tap(.105, .32, 235); }
  if (kind === "castle") {
    tap(0, .34, 180); tap(.12, .42, 150);
    // A quiet, wooden-resonance chime marks castling without turning it into a beep.
    for (const [offset, frequency, volume] of [[.23, 660, .055], [.27, 880, .035]]) {
      const start = context.currentTime + offset; const oscillator = context.createOscillator(); oscillator.type = "sine"; oscillator.frequency.setValueAtTime(frequency, start);
      const gain = context.createGain(); gain.gain.setValueAtTime(.0001, start); gain.gain.exponentialRampToValueAtTime(volume, start + .008); gain.gain.exponentialRampToValueAtTime(.0001, start + .42);
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(start); oscillator.stop(start + .42);
    }
  }
}

function ChessLeaderboard({ leaderboard, currentUserId }: { leaderboard: Leader[]; currentUserId: string }) {
  return <section className="chess-section chess-leaderboard"><h2>Staff leaderboard <small>Wins in saved staff games</small></h2><div className="chess-leaderboard-list">{leaderboard.map((leader, index) => { const hasImage = Boolean(leader.avatar && /^data:image\//.test(leader.avatar)); return <article key={leader.id} className="chess-leader-row"><span className="chess-leader-rank">{index + 1}</span><span className="chess-leader-avatar" style={hasImage ? { backgroundImage: `url(${leader.avatar})`, backgroundPosition: "center", backgroundSize: "cover" } : undefined}>{hasImage ? "" : leader.avatar || leader.name.slice(0, 1).toUpperCase()}</span><b>{leader.name}{leader.id === currentUserId ? " (you)" : ""}</b><span>{leader.games} {leader.games === 1 ? "game" : "games"}</span><strong>{leader.wins} {leader.wins === 1 ? "win" : "wins"}</strong></article>; })}</div></section>;
}

export function ChessView({ staff, currentUserId, canPlay = true, openInviteId = null, onInviteOpened }: { staff: Person[]; currentUserId: string; canPlay?: boolean; openInviteId?: string | null; onInviteOpened?: () => void }) {
  const [games, setGames] = useState<Game[]>([]); const [people, setPeople] = useState<Person[]>([]); const [leaderboard, setLeaderboard] = useState<Leader[]>([]); const [aiAvatar, setAiAvatar] = useState("🤖"); const [optimisticFens, setOptimisticFens] = useState<Record<string, string>>({}); const [opponentId, setOpponentId] = useState(""); const [focusedGameId, setFocusedGameId] = useState<string | null>(null);
  const [color, setColor] = useState("random"); const [difficulty, setDifficulty] = useState("medium"); const [aiRetryNonce, setAiRetryNonce] = useState(0); const [failedAiGameId, setFailedAiGameId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null); const [thinkingGameId, setThinkingGameId] = useState<string | null>(null); const [now, setNow] = useState(0); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [inviteNotice, setInviteNotice] = useState(""); const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine); const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [soundOn, setSoundOn] = useState(true); const [activeEffect, setActiveEffect] = useState<MoveEffect | null>(null); const [endgameCueId, setEndgameCueId] = useState<string | null>(null); const [finalGameId, setFinalGameId] = useState<string | null>(null); const [closedFinalIds, setClosedFinalIds] = useState<string[]>([]);
  const scrollToChessGame = useCallback((gameId: string) => {
    if (!gameId || typeof window === "undefined") return;
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const target = Array.from(document.querySelectorAll<HTMLElement>("[data-game-id]")).find((element) => element.dataset.gameId === gameId);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    }));
  }, []);
  const movesSeen = useRef(new Map<string, number>()); const statusesSeen = useRef(new Map<string, string>()); const endgameTimer = useRef<number | null>(null); const localMoveCounts = useRef(new Map<string, number>()); const pendingMoves = useRef(new Set<string>()); const queuedOfflineMoves = useRef<PendingChessMove[]>([]); const gamesRef = useRef<Game[]>([]); const cacheReady = useRef(false); const stockfishJobs = useRef(new Map<string, string>()); const aiRetryCounts = useRef(new Map<string, number>()); const aiRetryTimers = useRef(new Map<string, number>()); const dragMoveHandled = useRef(false); const hasLoadedGames = useRef(false); const effectQueue = useRef<MoveEffect[]>([]); const activeRef = useRef<MoveEffect | null>(null); const effectKey = useRef(0); const audioRef = useRef<AudioContext | null>(null);
  const announceEndgame = useCallback((gameId: string) => { setEndgameCueId(gameId); setFinalGameId(gameId); if (endgameTimer.current !== null) window.clearTimeout(endgameTimer.current); endgameTimer.current = window.setTimeout(() => { setEndgameCueId((current) => current === gameId ? null : current); endgameTimer.current = null; }, 6_000); }, []);
  const unlockSound = useCallback(() => { if (!soundOn || typeof window === "undefined") return; const AudioCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext; if (!AudioCtor) return; if (!audioRef.current) audioRef.current = new AudioCtor(); if (audioRef.current.state === "suspended") void audioRef.current.resume(); }, [soundOn]);
  const saveLocal = useCallback(async (nextGames = gamesRef.current) => {
    try { await saveChessSnapshot(currentUserId, { games: nextGames, pendingMoves: queuedOfflineMoves.current, savedAt: Date.now() }); setPendingSyncCount(queuedOfflineMoves.current.length); }
    catch { setError("Your browser could not save the local chess backup. Check that site storage is available."); }
  }, [currentUserId]);
  const refresh = useCallback(async () => {
    if (pendingMoves.current.size) return false;
    try {
      if (!cacheReady.current) {
        const cached = await loadChessSnapshot<Game>(currentUserId).catch(() => null);
        if (cached) { queuedOfflineMoves.current = cached.pendingMoves; gamesRef.current = cached.games; setGames(cached.games.map(cleanAiNames)); setPendingSyncCount(cached.pendingMoves.length); for (const game of cached.games) { movesSeen.current.set(game.id, game.moves.length); statusesSeen.current.set(game.id, game.status); } }
        cacheReady.current = true;
      }
      const response = await fetch("/api/chess", { cache: "no-store" });
      const contentType = response.headers.get("content-type") || "";
      const result = contentType.includes("application/json") ? await response.json().catch(() => null) as { error?: string; games?: Game[]; staff?: Person[]; leaderboard?: Leader[]; aiAvatar?: string } | null : null;
      if (!result) throw new Error(`Chess sync is temporarily unavailable (HTTP ${response.status}). Your local game copy is kept.`);
      if (!response.ok) throw new Error(result.error || "Could not load chess.");
      const incoming: Game[] = result.games || [];
      let confirmedLocalMove = false;
      for (const move of queuedOfflineMoves.current) {
        const remote = incoming.find((game) => game.id === move.gameId);
        if (!remote) continue;
        if (remote.fen === move.afterFen) {
          queuedOfflineMoves.current = queuedOfflineMoves.current.filter((candidate) => candidate !== move);
          continue;
        }
        if (remote.fen === move.beforeFen && navigator.onLine) {
          try {
            const syncResponse = await fetch("/api/chess", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "move", gameId: move.gameId, from: move.from, to: move.to, promotion: move.promotion }) });
            if (syncResponse.ok) setError("");
            else if (syncResponse.status >= 400 && syncResponse.status < 500) setError("A locally saved move was rejected by the online game. It remains on this device and needs review before continuing.");
          } catch { /* The durable local outbox will retry on the next poll or reconnect. */ }
        } else if (remote.fen !== move.beforeFen) {
          setError("This offline move is saved on this device, but the online game changed elsewhere. It needs review before it can sync.");
        }
      }
      const cachedGames = gamesRef.current;
      const merged = incoming.map((remote) => {
        const queued = queuedOfflineMoves.current.find((move) => move.gameId === remote.id);
        const local = cachedGames.find((game) => game.id === remote.id);
        return queued && local ? local : remote;
      });
      for (const local of cachedGames) if (!incoming.some((remote) => remote.id === local.id)) merged.push(local);
      let initialGameScrollChosen = false;
      for (const game of incoming) {
        const previousStatus = statusesSeen.current.get(game.id);
        if (hasLoadedGames.current && previousStatus === "active" && game.status === "completed") announceEndgame(game.id);
        const shouldScrollToGame = !hasLoadedGames.current ? !initialGameScrollChosen : previousStatus === "pending";
        if (game.status === "active" && shouldScrollToGame && (game.whiteId === currentUserId || game.blackId === currentUserId)) {
          setFocusedGameId(game.id);
          scrollToChessGame(game.id);
          initialGameScrollChosen = true;
        }
        statusesSeen.current.set(game.id, game.status);
        const previousCount = movesSeen.current.get(game.id) ?? (hasLoadedGames.current ? 0 : game.moves.length);
        const delta = Math.max(0, game.moves.length - previousCount);
        const localCount = localMoveCounts.current.get(game.id) || 0;
        const confirmed = Math.min(delta, localCount);
        if (confirmed) { confirmedLocalMove = true; localMoveCounts.current.set(game.id, localCount - confirmed); }
        if (delta > confirmed) effectQueue.current.push(...effectsSince(game.moves, previousCount + confirmed, game.id, () => ++effectKey.current));
        movesSeen.current.set(game.id, Math.max(previousCount, game.moves.length));
      }
      hasLoadedGames.current = true; gamesRef.current = merged; setGames(merged.map(cleanAiNames)); setPeople(result.staff || staff); setLeaderboard(result.leaderboard || []); setAiAvatar(result.aiAvatar || "🤖"); setPendingSyncCount(queuedOfflineMoves.current.length);
      setOptimisticFens((current) => { const next = { ...current }; for (const game of incoming) if (!queuedOfflineMoves.current.some((move) => move.gameId === game.id)) delete next[game.id]; return next; });
      await saveLocal(merged);
      if (confirmedLocalMove && effectQueue.current.length) { const next = effectQueue.current.shift()!; activeRef.current = next; setActiveEffect(next); if (soundOn && audioRef.current) playMoveSound(audioRef.current, next.sound); } else if (!activeRef.current && effectQueue.current.length) { const next = effectQueue.current.shift()!; activeRef.current = next; setActiveEffect(next); if (soundOn && audioRef.current) playMoveSound(audioRef.current, next.sound); }
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Chess sync is temporarily unavailable. Your local game copy is kept."); return false; }
    finally { setLoading(false); }
  }, [announceEndgame, currentUserId, saveLocal, scrollToChessGame, staff, soundOn]);
  useEffect(() => {
    const updateConnection = () => { setOnline(navigator.onLine); if (navigator.onLine) { setError(""); void refresh(); } };
    window.addEventListener("online", updateConnection); window.addEventListener("offline", updateConnection);
    const initial = window.setTimeout(() => { setNow(Date.now()); void refresh(); }, 0); const poll = window.setInterval(() => void refresh(), 8000); const clock = window.setInterval(() => setNow(Date.now()), 250);
    return () => { window.clearTimeout(initial); window.clearInterval(poll); window.clearInterval(clock); window.removeEventListener("online", updateConnection); window.removeEventListener("offline", updateConnection); };
  }, [refresh]);
  useEffect(() => () => { for (const timer of aiRetryTimers.current.values()) window.clearTimeout(timer); aiRetryTimers.current.clear(); if (endgameTimer.current !== null) window.clearTimeout(endgameTimer.current); }, []);
  useEffect(() => { if (!activeEffect) return; const timer = window.setTimeout(() => { activeRef.current = null; setActiveEffect(null); const next = effectQueue.current.shift(); if (next) { activeRef.current = next; setActiveEffect(next); if (soundOn && audioRef.current) playMoveSound(audioRef.current, next.sound); } }, 460); return () => window.clearTimeout(timer); }, [activeEffect, soundOn]);
  useEffect(() => () => { if (audioRef.current) void audioRef.current.close(); }, []);
  const act = async (action: string, payload: Record<string, unknown> = {}, optimisticGameId?: string) => { unlockSound(); setBusy(true); setError(""); if (action === "challenge" || action === "sample-email") setInviteNotice(""); const moveBaseline = optimisticGameId ? movesSeen.current.get(optimisticGameId) ?? 0 : 0; try { const response = await fetch("/api/chess", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) }); const result = await response.json().catch(() => null) as { error?: string; game?: Game; inviteEmail?: { status: string; email: string; detail: string }; sampleEmail?: { email: string } } | null; if (!result) throw new Error(`Chess returned an unreadable response (HTTP ${response.status}).`); if (!response.ok) throw new Error(result.error || `Chess action failed (HTTP ${response.status}).`); if (result.game) { const currentGames = gamesRef.current; const existingIndex = currentGames.findIndex((game) => game.id === result.game!.id); const nextGames = existingIndex < 0 ? [result.game, ...currentGames] : currentGames.map((game) => game.id === result.game!.id ? result.game! : game); gamesRef.current = nextGames; setGames(nextGames); await saveLocal(nextGames); } if (optimisticGameId) { pendingMoves.current.delete(optimisticGameId); setThinkingGameId(null); } if (action === "challenge" && result.inviteEmail) setInviteNotice(result.inviteEmail.status === "sent" ? `Invite email sent to ${result.inviteEmail.email}.` : `Challenge saved, but email was not sent: ${result.inviteEmail.detail}`); if (action === "sample-email" && result.sampleEmail) setInviteNotice(`Sample email sent to ${result.sampleEmail.email}.`); setSelected(null); await refresh(); if (["play-ai", "challenge", "accept"].includes(action)) { const targetId = result.game?.id || String(payload.gameId || ""); if (targetId) { if (action === "play-ai" || action === "accept") setFocusedGameId(targetId); scrollToChessGame(targetId); } } } catch (e) { let keepOptimisticMove = false; if (optimisticGameId) { pendingMoves.current.delete(optimisticGameId); setThinkingGameId(null); const synced = await refresh(); const confirmed = (movesSeen.current.get(optimisticGameId) || 0) > moveBaseline; keepOptimisticMove = !synced || confirmed; if (!keepOptimisticMove) { setOptimisticFens((current) => { const next = { ...current }; delete next[optimisticGameId]; return next; }); localMoveCounts.current.set(optimisticGameId, Math.max(0, (localMoveCounts.current.get(optimisticGameId) || 1) - 1)); if (activeRef.current?.gameId === optimisticGameId) { activeRef.current = null; setActiveEffect(null); } } } const message = e instanceof Error ? e.message : "Chess action failed."; setError(keepOptimisticMove ? `${message} The move is staying on the board while the game reconnects.` : message); } finally { setBusy(false); } };
  const moveImmediately = (game: Game, from: Square, to: Square) => {
    const chess = new Chess(game.fen); const played = chess.move({ from, to, promotion: "q" }); if (!played) return;
    const at = new Date().toISOString();
    const optimisticMove = { san: played.san, color: played.color, by: currentUserId, at };
    const locallySavedGame = { ...game, fen: chess.fen(), moves: [...game.moves, optimisticMove], turnStartedAt: at };
    queuedOfflineMoves.current.push({ gameId: game.id, from, to, promotion: "q", beforeFen: game.fen, afterFen: chess.fen(), san: played.san, color: played.color, by: currentUserId, at });
    gamesRef.current = gamesRef.current.map((candidate) => candidate.id === game.id ? locallySavedGame : candidate);
    setGames(gamesRef.current); setPendingSyncCount(queuedOfflineMoves.current.length); void saveLocal(gamesRef.current);
    localMoveCounts.current.set(game.id, (localMoveCounts.current.get(game.id) || 0) + 1); pendingMoves.current.add(game.id);
    if (game.mode === "ai") setThinkingGameId(game.id);
    setOptimisticFens((current) => ({ ...current, [game.id]: chess.fen() }));
    const effect = effectsSince(locallySavedGame.moves, game.moves.length, game.id, () => ++effectKey.current)[0];
    if (effect) {
      effectQueue.current = effectQueue.current.filter((queued) => queued.gameId !== game.id);
      if (activeRef.current?.gameId === game.id) { activeRef.current = null; setActiveEffect(null); }
      if (soundOn && audioRef.current) playMoveSound(audioRef.current, effect.sound);
    }
    void act("move", { gameId: game.id, from, to, promotion: "q" }, game.id);
  };
  const pending = games.filter((g) => g.status === "pending"); const active = games.filter((g) => g.status === "active"); const selectedActiveGameId = active.some((game) => game.id === focusedGameId) ? focusedGameId : active[0]?.id; const orderedActive = selectedActiveGameId ? [active.find((game) => game.id === selectedActiveGameId)!, ...active.filter((game) => game.id !== selectedActiveGameId)] : active; const recentGames = games.filter((g) => g.status === "completed").sort((a, b) => Date.parse(b.endedAt || b.createdAt) - Date.parse(a.endedAt || a.createdAt)).slice(0, 8); const endgameCandidate = recentGames.find((game) => game.id === finalGameId) || (!active.length ? recentGames[0] : undefined); const endgameGame = endgameCandidate && !closedFinalIds.includes(endgameCandidate.id) ? endgameCandidate : undefined; const endgameWinnerId = endgameGame ? winnerId(endgameGame) : null;
  useEffect(() => {
    if (!openInviteId || loading) return;
    if (pending.some((game) => game.id === openInviteId)) {
      scrollToChessGame(openInviteId);
      onInviteOpened?.();
    }
  }, [openInviteId, loading, pending, scrollToChessGame, onInviteOpened]);
  const remaining = (game: Game, side: "w" | "b") => game.timeControl === "inf" ? Infinity : Math.max(0, game.clocks[side] - (game.status === "active" && game.fen.split(" ")[1] === side && game.turnStartedAt ? now - Date.parse(game.turnStartedAt) : 0));
  const timeLabel = (game: Game) => game.timeControl === "inf" ? "Infinite time" : game.timeControl === "3d" ? "3 days per player" : game.timeControl;
  const isParticipant = (game: Game) => game.whiteId === currentUserId || game.blackId === currentUserId || game.challengedId === currentUserId;
  const ownTurn = (game: Game) => game.status === "active" && game.whiteId === currentUserId && game.fen.split(" ")[1] === "w" || game.status === "active" && game.blackId === currentUserId && game.fen.split(" ")[1] === "b";
  const playerAvatar = (id: string, name: string) => { const avatar = people.find((person) => person.id === id)?.avatar || (id === "chess-ai" ? aiAvatar : name.slice(0, 1).toUpperCase()); const image = /^(data:image\/|https:\/\/)/.test(avatar); return <span className="chess-player-avatar" aria-label={`${name} profile`} style={image ? { backgroundImage: `url(${avatar})` } : undefined}>{image ? "" : <AiIcon v={avatar} />}</span>; };
  const options = useMemo(() => people.filter((p) => p.id !== currentUserId), [people, currentUserId]);
  useEffect(() => {
    if (!online) return;
    const game = active.find((candidate) => candidate.mode === "ai" && candidate.status === "active" && candidate.fen.split(" ")[1] !== candidate.humanColor);
    if (!game) return;
    if (failedAiGameId === game.id) return;
    const jobKey = `${game.fen}:${game.moves.length}`;
    if (stockfishJobs.current.get(game.id) === jobKey) return;
    if (aiRetryTimers.current.has(game.id)) return;
    stockfishJobs.current.set(game.id, jobKey);
    setThinkingGameId(game.id);
    setError("");
    setFailedAiGameId(null);
    void chooseStockfishMove(game.moves.map((move) => move.san), game.aiDifficulty || "medium").then(async (uci) => {
      const response = await fetch("/api/chess", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ai-move", gameId: game.id, uci }) });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!result) throw new Error(`Chess returned an unreadable response (HTTP ${response.status}).`);
      if (!response.ok && response.status === 409 && result?.error?.includes("workspace changed at the same time")) throw new Error("The board changed while AI's move was saving.");
      if (!response.ok && response.status !== 409) throw new Error(result?.error || `Chess returned HTTP ${response.status} while saving AI's move.`);
      aiRetryCounts.current.delete(game.id);
      setFailedAiGameId(null);
      await refresh();
    }).catch((cause) => {
      const message = cause instanceof Error ? cause.message : "AI could not make a move. Please try again.";
      const attempts = (aiRetryCounts.current.get(game.id) || 0) + 1;
      aiRetryCounts.current.set(game.id, attempts);
      stockfishJobs.current.delete(game.id);
      if (attempts <= 3) {
        setError(`AI's move did not save. The game is safe; retrying automatically (${attempts}/3). ${message}`);
        const timer = window.setTimeout(() => { aiRetryTimers.current.delete(game.id); setAiRetryNonce((nonce) => nonce + 1); }, attempts * 1_000);
        aiRetryTimers.current.set(game.id, timer);
      } else {
        setFailedAiGameId(game.id);
        setError(`AI could not finish this move. Your game is saved. ${message}`);
      }
    }).finally(() => {
      setThinkingGameId((current) => current === game.id ? null : current);
    });
  }, [active, refresh, aiRetryNonce, failedAiGameId, online]);
  const retryAiMove = (gameId: string) => { aiRetryCounts.current.delete(gameId); stockfishJobs.current.delete(gameId); setFailedAiGameId(null); setError(""); setAiRetryNonce((nonce) => nonce + 1); };
  const closeFinal = (gameId: string) => { setClosedFinalIds((ids) => ids.includes(gameId) ? ids : [...ids, gameId]); setFinalGameId((current) => current === gameId ? null : current); };
  const rematch = (game: Game) => {
    closeFinal(game.id);
    const myColor = game.whiteId === currentUserId ? "white" : game.blackId === currentUserId ? "black" : "random";
    if (game.mode === "ai") { void act("play-ai", { color: myColor, difficulty: game.aiDifficulty || "medium" }); return; }
    const opponentId = game.whiteId === currentUserId ? game.blackId : game.whiteId;
    void act("challenge", { opponentId, color: myColor });
  };
  return <div className="chess-page" onPointerDownCapture={unlockSound}>
    <header className="chess-page-head"><div><p className="eyebrow">TEAM PLAY</p><h1><svg className="chess-piece-svg cp-toon black-piece chess-title-icon" viewBox="0 0 45 45" aria-hidden="true"><ToonPiece type="p" /></svg>Chess</h1><p>Challenge a teammate or play AI.</p></div><div className="chess-page-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => void act("sample-email")}>✉️ Email me a sample</button><button type="button" className="secondary-button chess-sound-toggle" aria-pressed={soundOn} onClick={() => setSoundOn((enabled) => !enabled)}>{soundOn ? "🔊 Sound on" : "🔇 Sound off"}</button></div></header>
    <div className="chess-status-toasts" aria-live="polite">
      {error && <div className="chess-error" role="alert">{error}</div>}
      {(!online || pendingSyncCount > 0) && <div className="chess-offline-status" role="status">{!online ? "Offline mode · your games and moves are saved on this device and will sync when you reconnect." : `${pendingSyncCount} move${pendingSyncCount === 1 ? "" : "s"} waiting to sync · your local board is preserved.`}</div>}
      {inviteNotice && <div className={`chess-invite-notice ${inviteNotice.startsWith("Invite email sent") || inviteNotice.startsWith("Sample email sent") ? "sent" : "failed"}`} role="status">{inviteNotice}</div>}
    </div>
    {canPlay && <section className="chess-new-game panel chess-new-game-primary"><div className="chess-new-game-heading"><div><h2>Start a game</h2><p>Choose a teammate or AI. Games have no clock and stay open until they finish.</p></div><span className="chess-infinite-badge">∞ Infinite time</span></div><div className="chess-controls chess-new-game-controls"><label>Opponent<select value={opponentId} onChange={(e) => setOpponentId(e.target.value)}><option value="">Choose AI or a teammate…</option><option value="chess-ai">AI</option>{options.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Play as<select value={color} onChange={(e) => setColor(e.target.value)}><option value="random">Random color</option><option value="white">White</option><option value="black">Black</option></select></label>{opponentId === "chess-ai" && <label className="chess-difficulty-inline">AI difficulty<select value={difficulty} onChange={(e) => setDifficulty(e.target.value)}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label>}<button disabled={busy || !opponentId} onClick={() => void (opponentId === "chess-ai" ? act("play-ai", { color, difficulty }) : act("challenge", { opponentId, color }))}>{opponentId === "chess-ai" ? "Play vs AI" : "Send teammate challenge"}</button></div></section>}
    {loading ? <div className="empty-state">Loading saved games…</div> : <>
      {pending.length > 0 && <section className="chess-section"><h2>Open challenges</h2>{pending.map((game) => { const challengerName = people.find((p) => p.id === game.challengerId)?.name || "A teammate"; const challengedName = people.find((p) => p.id === game.challengedId)?.name || "a teammate"; return <article className="chess-pending panel" key={game.id} data-game-id={game.id}><div><b>{game.challengerId === currentUserId ? `You challenged ${challengedName}` : game.challengedId === currentUserId ? `${challengerName} challenged you` : `${challengerName} challenged ${challengedName}`}</b><small>{timeLabel(game)} · sent {new Date(game.createdAt).toLocaleString()}</small></div>{game.challengedId === currentUserId ? <div className="chess-controls"><label>Choose color<select value={color} onChange={(e) => setColor(e.target.value)}><option value="random">Random</option><option value="white">White</option><option value="black">Black</option></select></label><button disabled={busy} onClick={() => void act("accept", { gameId: game.id, color })}>Accept</button><button className="secondary-button" disabled={busy} onClick={() => void act("decline", { gameId: game.id })}>Decline</button></div> : <span>{game.challengerId === currentUserId ? "Waiting for their response…" : "Open challenge · waiting for players"}</span>}</article>; })}</section>}
      {active.length > 0 && <section className="chess-section"><h2>Games in progress <small>Saved automatically · clocks keep running</small></h2><div className="chess-games-layout"><div className="chess-games">{orderedActive.map((game) => { const activeFen = optimisticFens[game.id] || game.fen; if (game.id !== selectedActiveGameId) return <button type="button" className="chess-game-switcher panel" key={game.id} onClick={() => { setFocusedGameId(game.id); scrollToChessGame(game.id); }} aria-label={`Open game ${game.whiteName} versus ${game.blackName}`}><span className="chess-game-switcher-info"><b>{game.whiteName} <i>vs</i> {game.blackName}</b><small>{game.mode === "ai" ? `AI · ${game.aiDifficulty} difficulty` : "Team challenge"} · {timeLabel(game)}</small><em>{ownTurn(game) ? "Your turn" : game.mode === "ai" ? "AI to move" : "Opponent to move"}</em></span><ChessThumbnail game={game} currentUserId={currentUserId} fen={activeFen} /></button>; const board = boardFromFen(activeFen); const latestMove = latestMoveSquares(game.moves); const currentSide = activeFen.split(" ")[1] as "w" | "b"; const isMyTurn = game.status === "active" && (game.whiteId === currentUserId && currentSide === "w" || game.blackId === currentUserId && currentSide === "b"); const selectedSquare = selected?.startsWith(`${game.id}:`) ? selected.split(":")[1] as Square : null; let legalTargets = new Set<string>(); if (selectedSquare && isMyTurn) { try { legalTargets = new Set(new Chess(activeFen).moves({ square: selectedSquare, verbose: true }).map((move) => move.to)); } catch { legalTargets = new Set(); } } const checkedKingSquare = (() => { try { if (!new Chess(activeFen).isCheck()) return null; const king = currentSide === "w" ? "K" : "k"; for (let row = 0; row < board.length; row++) { const col = board[row].indexOf(king); if (col >= 0) return `${files[col]}${8 - row}` as Square; } } catch { /* Ignore malformed legacy positions. */ } return null; })(); return <article className="chess-game panel" key={game.id} data-game-id={game.id}>
        <div className="chess-game-head"><div className="chess-game-info"><div><b>{game.whiteName} <span>vs</span> {game.blackName}</b><small>{game.mode === "ai" ? `AI · ${game.aiDifficulty} difficulty` : "Team challenge"} · {timeLabel(game)}</small></div>{isParticipant(game) && <div className="chess-game-actions">{game.drawOfferBy ? game.drawOfferBy === currentUserId ? <span className="chess-draw-status">Draw offer sent</span> : <><span className="chess-draw-status">{game.drawOfferBy === "chess-ai" ? "AI" : people.find((person) => person.id === game.drawOfferBy)?.name || "Opponent"} offered a draw</span><button className="secondary-button" disabled={busy} onClick={() => void act("accept-draw", { gameId: game.id })}>Accept draw</button><button className="secondary-button" disabled={busy} onClick={() => void act("decline-draw", { gameId: game.id })}>Decline</button></> : <button className="secondary-button" disabled={busy} onClick={() => void act("offer-draw", { gameId: game.id })}>Offer draw</button>}<button className="secondary-button" disabled={busy} onClick={() => void act("resign", { gameId: game.id })}>Resign</button></div>}</div><ChessThumbnail game={game} currentUserId={currentUserId} fen={activeFen} /></div>
        <div className="chess-clock-row"><div className={currentSide === "w" ? "on-turn" : ""}><span className="chess-player-name">{playerAvatar(game.whiteId, game.whiteName)}<span>{game.whiteName}</span></span><b>{game.timeControl === "inf" ? "∞" : formatTime(remaining(game, "w"))}</b></div><span>to move: {currentSide === "w" ? game.whiteName : game.blackName}</span><div className={currentSide === "b" ? "on-turn" : ""}><span className="chess-player-name">{playerAvatar(game.blackId, game.blackName)}<span>{game.blackName}</span></span><b>{game.timeControl === "inf" ? "∞" : formatTime(remaining(game, "b"))}</b></div></div>
        <div className="chess-play-area"><div className="chess-board-wrap" onMouseDownCapture={(event) => { if ((event.target as Element).closest(".chess-square.legal-target")) event.preventDefault(); }}><ChessBoardFx gameId={game.id} fen={activeFen} /><div className={`chess-board ${game.blackId === currentUserId ? "flipped" : ""}`} tabIndex={-1} role="grid" aria-label={`${game.whiteName} versus ${game.blackName} chess board`}>{Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => {
          const flipped = game.blackId === currentUserId;
          const fenRow = flipped ? 7 - r : r;
          const fenCol = flipped ? 7 - c : c;
          const piece = board[fenRow][fenCol];
          const rank = 8 - fenRow;
          const file = fenCol;
          const square = `${files[file]}${rank}`;
          const isLight = (fenRow + fenCol) % 2 !== 0;
          const activeSelection = selected === `${game.id}:${square}`;
          const isLegalTarget = legalTargets.has(square);
          const activeImpact = activeEffect?.gameId === game.id && activeEffect.flights.some((flight) => flight.to === square);
          const canSelect = Boolean(isMyTurn && piece && (currentSide === "w" ? piece === piece.toUpperCase() : piece === piece.toLowerCase()));
          const squareUnavailable = !isMyTurn || busy || (!canSelect && !isLegalTarget);
          return <button key={square} type="button" role="gridcell" aria-label={`${square}${piece ? ` ${piece === piece.toUpperCase() ? "white" : "black"} ${piece.toLowerCase()}` : " empty"}`} aria-selected={Boolean(activeSelection)} aria-disabled={squareUnavailable} tabIndex={squareUnavailable ? -1 : 0} draggable={Boolean(canSelect && !busy)} className={`chess-square ${isLight ? "light" : "dark"} ${activeSelection ? "selected" : ""} ${isLegalTarget ? "legal-target" : ""} ${latestMove && (latestMove.from === square || latestMove.to === square) ? "last-move-highlight" : ""} ${activeImpact && activeEffect?.sound === "capture" ? "capture-impact" : ""} ${activeImpact && activeEffect?.sound === "check" ? "check-impact" : ""} ${checkedKingSquare === square ? "king-in-check-pulse" : ""}`} onDragStart={(event) => { if (!canSelect) { event.preventDefault(); return; } const pieceImage = event.currentTarget.querySelector<SVGSVGElement>(".chess-piece-svg"); if (pieceImage) event.dataTransfer.setDragImage(pieceImage, pieceImage.clientWidth / 2, pieceImage.clientHeight / 2); event.dataTransfer.setData("text/plain", square); event.dataTransfer.effectAllowed = "move"; setSelected(`${game.id}:${square}`); }} onDragOver={(event) => { if (isLegalTarget) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }} onDrop={(event) => { event.preventDefault(); const from = event.dataTransfer.getData("text/plain") || selectedSquare; if (isLegalTarget && from) { dragMoveHandled.current = true; window.setTimeout(() => { dragMoveHandled.current = false; }, 0); moveImmediately(game, from as Square, square as Square); } }} onClick={() => {
            if (dragMoveHandled.current) { dragMoveHandled.current = false; return; }
            if (squareUnavailable) return;
            if (canSelect) setSelected(`${game.id}:${square}`);
            else if (isLegalTarget && selectedSquare) moveImmediately(game, selectedSquare, square as Square);
          }} onClickCapture={(event) => { if (event.detail > 0 && canSelect) event.currentTarget.blur(); }} >{piece && <ChessPiece piece={piece} flipped={flipped} flight={activeEffect?.gameId === game.id ? activeEffect.flights.find((flight) => flight.to === square && flight.piece === piece.toLowerCase()) : undefined} />}{c === 0 && <small>{rank}</small>}{r === 7 && <em>{files[file]}</em>}</button>;
        }))}</div></div></div><p className="chess-turn-note">{game.mode === "ai" && thinkingGameId === game.id ? "AI is thinking…" : isMyTurn ? "Your turn. Click or drag a piece to its destination." : game.mode === "ai" ? "AI is thinking…" : "Waiting for your opponent. The board refreshes automatically."}</p>{failedAiGameId === game.id && <button className="secondary-button" onClick={() => retryAiMove(game.id)}>Retry AI’s move</button>}
      </article>; })}</div>{people.length > 0 && <aside className="chess-board-sidebar"><ChessLeaderboard leaderboard={leaderboard} currentUserId={currentUserId} /></aside>}</div></section>}
      {!active.length && people.length > 0 && <ChessLeaderboard leaderboard={leaderboard} currentUserId={currentUserId} />}
      {endgameGame && <section className="chess-section chess-final-section"><ChessFinalBoard key={endgameGame.id} game={endgameGame} currentUserId={currentUserId} animate={endgameCueId === endgameGame.id} busy={busy} onClose={() => closeFinal(endgameGame.id)} onRematch={() => rematch(endgameGame)} /></section>}
      {!active.length && !pending.length && <div className="chess-empty panel"><span>♟</span><h2>No active games</h2><p>Start a game against AI or challenge a teammate.</p></div>}
    </>}
  </div>;
}
