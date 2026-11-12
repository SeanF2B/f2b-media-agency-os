import { Chess, type Color } from "chess.js";
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { chessClockMs } from "@/lib/chess-engine";
import { F2B_MEDIA_MARK_EMAIL_BASE64 } from "@/lib/f2b-media-mark-email";

export const dynamic = "force-dynamic";

type Game = {
  id: string; mode: "staff" | "ai"; status: "pending" | "active" | "completed" | "declined";
  whiteId: string; blackId: string; challengerId: string; challengedId?: string;
  whiteName: string; blackName: string; humanColor?: Color; aiDifficulty?: "easy" | "medium" | "hard";
  timeControl: "5m" | "10m" | "3d" | "inf"; clocks: Record<string, number>; turnStartedAt?: string;
  fen: string; moves: Array<{ san: string; color: Color; by: string; at: string }>;
  createdAt: string; endedAt?: string; result?: string; winnerId?: string; drawOfferBy?: string;
};
async function readWorkspace() {
  if (!env.DB) return null;
  return env.DB.prepare("SELECT data, updated_at FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string; updated_at: string }>();
}
function getIdentity(data: any, user: any) {
  const profile = (data.staff || []).find((s: any) => !s.isBot && (s.id === user.userId || s.email?.toLowerCase() === user.email?.toLowerCase()));
  return { id: profile?.id || user.userId, name: profile?.name || user.displayName || user.email || "Team member", avatar: profile?.avatar || "♟", profile };
}
function memberName(data: any, id: string) { return data.staff?.find((s: any) => s.id === id)?.name || (id === "chess-ai" ? "AI" : "Team member"); }
function finished(chess: Chess, game: Game) {
  if (!chess.isGameOver()) return false;
  game.status = "completed"; game.endedAt = new Date().toISOString();
  if (chess.isCheckmate()) game.winnerId = chess.turn() === "w" ? game.blackId : game.whiteId;
  game.result = chess.isCheckmate() ? `${chess.turn() === "w" ? game.blackName : game.whiteName} wins by checkmate` : chess.isStalemate() ? "Draw by stalemate" : chess.isThreefoldRepetition() ? "Draw by repetition" : chess.isInsufficientMaterial() ? "Draw by insufficient material" : "Draw";
  return true;
}
function addActivity(data: any, game: Game, actor: { id: string; name: string; avatar: string }, title: string, detail: string) {
  // Chess matches have their own saved history and are intentionally excluded from workspace Activity.
}
function escapeEmailHtml(value: string) { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] || character); }
function chessInviteEmail(senderName: string, recipientName: string, timeControl: Game["timeControl"], appUrl: string, sample = false) {
  const sender = escapeEmailHtml(senderName); const recipient = escapeEmailHtml(recipientName || "there"); const url = escapeEmailHtml(appUrl);
  const label = timeControl === "inf" ? "No clock (infinite time)" : timeControl === "3d" ? "3 days per player" : timeControl;
  const rows = ["♜♞♝♛♚♝♞♜", "♟♟♟♟♟♟♟♟", "········", "········", "········", "········", "♙♙♙♙♙♙♙♙", "♖♘♗♕♔♗♘♖"];
  const board = `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="border:4px solid #34465d;border-radius:4px;border-collapse:collapse;margin:18px auto 22px">${rows.map((row, r) => `<tr>${Array.from(row).map((piece, c) => { const light = (r + c) % 2 === 0; const empty = piece === "·"; const black = r < 2; return `<td width="30" height="30" style="width:30px;height:30px;text-align:center;vertical-align:middle;background:${light ? "#f0f3f5" : "#5793eb"};font:20px/1 Arial,sans-serif;color:${empty ? (light ? "#f0f3f5" : "#5793eb") : black ? "#194660" : "#f7f7f2"};text-shadow:${black ? "0 1px 1px #dbe5eb" : "0 1px 1px #34465d"}">${empty ? "&nbsp;" : piece}</td>`; }).join("")}</tr>`).join("")}</table>`;
  const subject = sample ? "F2B Media · Chess invitation email sample" : `Chess challenge from ${senderName}`;
  const intro = sample ? `<strong>${sender}</strong> has challenged you to a chess game. This is a sample invitation preview.` : `<strong>${sender}</strong> challenged you to a chess game.`;
  const text = `Hi ${recipientName || "there"},\n\n${senderName} challenged you to a chess game in F2B Media Agency OS.\nTime control: ${label}\n\nOpen the chess board to accept or decline: ${appUrl}`;
  const html = `<div style="margin:0;background:#f0f3f5;padding:28px 12px;font-family:Arial,Helvetica,sans-serif;color:#222124"><table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:auto;background:#fff;border:1px solid #d7dfe5;border-radius:12px;overflow:hidden"><tr><td style="padding:20px 24px;background:#222124;color:#fff"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="vertical-align:middle;padding-right:12px"><img src="cid:f2b-media-mark" width="48" alt="F2B Media" style="display:block;width:48px;height:auto;max-height:48px;object-fit:contain;border:0;border-radius:50%;background:#fff" /></td><td style="vertical-align:middle"><div style="font-size:20px;font-weight:700;letter-spacing:.2px">F2B Media</div><div style="margin-top:4px;color:#b7dafa;font-size:12px">TEAM CHESS</div></td></tr></table></td></tr><tr><td style="padding:24px"><div style="display:inline-block;padding:6px 10px;border-radius:20px;background:#e9f2ff;color:#245b98;font-size:12px;font-weight:700">♟ &nbsp; CHESS CHALLENGE</div><h1 style="margin:14px 0 8px;color:#222124;font-size:24px;line-height:1.25">You’re invited to play</h1><p style="margin:0;color:#45515b;font-size:15px;line-height:1.6">Hi ${recipient},</p><p style="margin:8px 0;color:#45515b;font-size:15px;line-height:1.6">${intro}</p>${board}<div style="padding:12px 14px;border-left:4px solid #5793eb;background:#f3f7fc;color:#263747;font-size:14px"><strong>Time control</strong><br />${escapeEmailHtml(label)}</div><p style="margin:20px 0 0;text-align:center"><a href="${url}" style="display:inline-block;padding:12px 20px;border-radius:7px;background:#287cac;color:#fff;text-decoration:none;font-weight:700">Open chess board</a></p><p style="margin:20px 0 0;color:#75818b;font-size:12px;line-height:1.5">Sign in to F2B Media Agency OS to accept or decline this challenge.</p></td></tr><tr><td style="padding:14px 24px;border-top:1px solid #e1e6ea;background:#fafbfc;color:#7b838a;font-size:11px">F2B Media · Team chess · Blue and ivory board theme</td></tr></table></div>`;
  return { subject, text, html, attachments: [{ filename: "f2b-media-mark.png", content: F2B_MEDIA_MARK_EMAIL_BASE64, content_id: "f2b-media-mark", content_type: "image/png" }] };
}
async function recordChessEmailActivity(actor: { id: string; name: string; avatar: string }, title: string, detail: string, note: string) {
  // Chess email status is returned to the Chess screen; it is not workspace Activity.
}
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in to open chess." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "Workspace database is unavailable." }, { status: 503 });
  // Chess refreshes frequently. Read only its small state and team directory
  // from the workspace JSON instead of parsing the full multi-megabyte record
  // (which also contains client files, task history, and images) on each poll.
  const row = await env.DB.prepare(`
    SELECT owner_id,
      json_extract(data, '$.staff') AS staff_json,
      json_extract(data, '$.chessGames') AS games_json
    FROM workspace_documents WHERE id = ?1
  `).bind("f2b-agency").first<{ owner_id: string | null; staff_json: string | null; games_json: string | null }>();
  if (!row) return Response.json({ error: "Workspace database is unavailable." }, { status: 503 });
  const chessStaff = row.staff_json ? JSON.parse(row.staff_json) as Array<{ id: string; name: string; avatar?: string; email?: string; isBot?: boolean }> : [];
  const data = { staff: chessStaff };
  const identity = getIdentity(data, user);
  if (!row.owner_id || !(row.owner_id === user.userId || identity.profile)) return Response.json({ error: "Chess is available to F2B team members only." }, { status: 403 });
  const games: Game[] = row.games_json ? JSON.parse(row.games_json) as Game[] : [];
  const visible = games.filter((g) => g.status === "active" || g.status === "pending" || g.whiteId === identity.id || g.blackId === identity.id || g.challengerId === identity.id || g.challengedId === identity.id).map((g) => ({ ...g, ...(g.status === "active" || g.status === "pending" ? { timeControl: "inf" as const, clocks: { w: 0, b: 0 } } : {}), whiteName: memberName(data, g.whiteId), blackName: memberName(data, g.blackId) }));
  const aiAvatar = data.staff?.find((s: any) => s.id === "f2b-ai-agent")?.avatar || "🤖";
  const staff = chessStaff.filter((s: any) => !s.isBot).map((s: any) => ({ id: s.id, name: s.name, avatar: s.avatar }));
  const leaderboardPeople = [...staff, { id: "chess-ai", name: "AI", avatar: aiAvatar }];
  const standings = new Map<string, { id: string; name: string; avatar?: string; wins: number; games: number }>(leaderboardPeople.map((person: any) => [person.id, { id: person.id, name: person.name, avatar: person.avatar, wins: 0, games: 0 }] as const));
  for (const game of games) {
    if (game.status !== "completed") continue;
    const white = standings.get(game.whiteId); const black = standings.get(game.blackId);
    if (!white || !black) continue;
    white.games++; black.games++;
    let winnerId = game.winnerId;
    if (!winnerId && game.result) {
      const namedWinner = [game.whiteName, game.blackName].filter((name) => game.result!.startsWith(`${name} wins by`) || game.result!.startsWith(`${name} wins on time`)).sort((a, b) => b.length - a.length)[0];
      if (namedWinner) winnerId = namedWinner === game.whiteName ? game.whiteId : game.blackId;
    }
    if (winnerId === game.whiteId) white.wins++;
    else if (winnerId === game.blackId) black.wins++;
  }
  const leaderboard = Array.from(standings.values()).sort((a, b) => b.wins - a.wins || b.games - a.games || a.name.localeCompare(b.name));
  return Response.json({ games: visible, staff, leaderboard, aiAvatar, currentUserId: identity.id });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in to play chess." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "Workspace database is unavailable." }, { status: 503 });
  try {
    const body = await request.json() as any;
    const row = await readWorkspace();
    if (!row) return Response.json({ error: "Workspace could not be loaded." }, { status: 503 });
    const data = JSON.parse(row.data); const actor = getIdentity(data, user);
    if (!data.ownerId || !(data.ownerId === user.userId || actor.profile)) return Response.json({ error: "Chess is available to F2B team members only." }, { status: 403 });
    const games: Game[] = data.chessGames || [];
    for (const openGame of games) if ((openGame.status === "active" || openGame.status === "pending") && openGame.timeControl !== "inf") { openGame.timeControl = "inf"; openGame.clocks = { w: 0, b: 0 }; }
    const now = new Date(); const at = now.toISOString(); const tc: Game["timeControl"] = "inf"; const aiThinkTimeMs = 2_000;
    if (body.action === "sample-email") {
      const recipient = actor.profile?.email;
      if (!recipient || !String(recipient).includes("@")) return Response.json({ error: "Add your email address to your owner profile before requesting a sample." }, { status: 400 });
      if (!env.RESEND_API_KEY || !env.TASK_NOTIFICATION_FROM) return Response.json({ error: "Email sender is not configured." }, { status: 503 });
      const appUrl = env.TASK_APP_URL || new URL(request.url).origin;
      const sample = chessInviteEmail(actor.name, actor.name, "inf", appUrl, true);
      const emailResponse = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `chess-sample/${actor.id}/${crypto.randomUUID()}` }, body: JSON.stringify({ from: env.TASK_NOTIFICATION_FROM, to: [recipient], ...sample }), signal: AbortSignal.timeout(15_000) });
      const responseBody = await emailResponse.json().catch(() => null) as { id?: string; message?: string } | null;
      if (!emailResponse.ok || !responseBody?.id) return Response.json({ error: `Resend returned HTTP ${emailResponse.status}: ${responseBody?.message || "sample email was not accepted"}` }, { status: 502 });
      await recordChessEmailActivity(actor, "Chess sample email sent", "F2B branded chess invite sample", `Resend accepted sample ${responseBody.id} for ${recipient}.`);
      return Response.json({ ok: true, sampleEmail: { status: "sent", email: recipient, id: responseBody.id } });
    }
    let game: Game | undefined;
    let originalGame: Game | undefined;
    if (body.action === "challenge" || body.action === "play-ai") {
      const vsAi = body.action === "play-ai";
      const target = String(body.opponentId || "");
      if (!vsAi && (!target || target === actor.id || !data.staff?.some((s: any) => s.id === target && !s.isBot))) return Response.json({ error: "Choose another active staff member." }, { status: 400 });
      const color: "white" | "black" | "random" = ["white", "black", "random"].includes(body.color) ? body.color as "white" | "black" | "random" : "random";
      const humanColor: Color = color === "random" ? (Math.random() < .5 ? "w" : "b") : color === "white" ? "w" : "b";
      const whiteId = vsAi ? (humanColor === "w" ? actor.id : "chess-ai") : color === "white" ? actor.id : color === "black" ? target : "pending";
      const blackId = vsAi ? (humanColor === "b" ? actor.id : "chess-ai") : color === "white" ? target : color === "black" ? actor.id : "pending";
      game = { id: crypto.randomUUID(), mode: vsAi ? "ai" : "staff", status: vsAi ? "active" : "pending", whiteId, blackId, challengerId: actor.id, ...(vsAi ? {} : { challengedId: target }), whiteName: !vsAi && whiteId === "pending" ? actor.name : !vsAi && blackId === "pending" ? memberName(data, target) : memberName(data, whiteId), blackName: !vsAi && blackId === "pending" ? actor.name : !vsAi && whiteId === "pending" ? memberName(data, target) : memberName(data, blackId), ...(vsAi ? { humanColor, aiDifficulty: ["easy", "medium", "hard"].includes(body.difficulty) ? body.difficulty : "medium" } : {}), timeControl: tc, clocks: { w: chessClockMs(tc), b: chessClockMs(tc) }, ...(vsAi ? { turnStartedAt: at } : {}), fen: new Chess().fen(), moves: [], createdAt: at };
      games.unshift(game); addActivity(data, game, actor, vsAi ? "Chess game started vs AI" : "Chess challenge sent", vsAi ? `${actor.name} started a ${tc} game · ${game.aiDifficulty} AI · ${humanColor === "w" ? "White" : "Black"}` : `${actor.name} challenged ${memberName(data, target)} · ${tc}`);
    } else {
      game = games.find((item) => item.id === body.gameId);
      if (!game) return Response.json({ error: "That game is no longer available." }, { status: 404 });
      originalGame = structuredClone(game);
      const participant = game.whiteId === actor.id || game.blackId === actor.id || game.challengedId === actor.id;
      if (!participant) return Response.json({ error: "You are not a player in this game." }, { status: 403 });
      if (body.action === "accept" || body.action === "decline") {
        if (game.status !== "pending" || game.challengedId !== actor.id) return Response.json({ error: "Only the invited player can respond to this challenge." }, { status: 403 });
        if (body.action === "decline") { game.status = "declined"; addActivity(data, game, actor, "Chess challenge declined", `${actor.name} declined a challenge from ${memberName(data, game.challengerId)}`); }
        else {
          const requested: Color | "random" = body.color === "white" ? "w" : body.color === "black" ? "b" : "random";
          const challengerColor: Color = requested === "random" ? (Math.random() < .5 ? "w" : "b") : requested === "w" ? "b" : "w";
          game.whiteId = challengerColor === "w" ? game.challengerId : actor.id; game.blackId = challengerColor === "b" ? game.challengerId : actor.id;
          game.whiteName = memberName(data, game.whiteId); game.blackName = memberName(data, game.blackId); game.status = "active"; game.turnStartedAt = at;
          addActivity(data, game, actor, "Chess challenge accepted", `${actor.name} accepted a challenge from ${memberName(data, game.challengerId)} · ${game.timeControl}`);
        }
      } else if (body.action === "offer-draw") {
        if (game.status !== "active") return Response.json({ error: "This game is no longer active." }, { status: 409 });
        if (game.drawOfferBy) return Response.json({ error: "A draw offer is already waiting for a response." }, { status: 409 });
        game.drawOfferBy = actor.id;
        addActivity(data, game, actor, "Chess draw offered", `${actor.name} offered a draw to ${actor.id === game.whiteId ? game.blackName : game.whiteName}`);
      } else if (body.action === "accept-draw" || body.action === "decline-draw") {
        if (game.status !== "active" || !game.drawOfferBy || game.drawOfferBy === actor.id) return Response.json({ error: "There is no draw offer from your opponent to respond to." }, { status: 409 });
        if (body.action === "accept-draw") { game.status = "completed"; game.endedAt = at; game.result = "Draw by agreement"; delete game.drawOfferBy; addActivity(data, game, actor, "Chess draw accepted", `${actor.name} accepted the draw offer in ${game.whiteName} vs ${game.blackName}`); }
        else { const offeredBy = memberName(data, game.drawOfferBy); delete game.drawOfferBy; addActivity(data, game, actor, "Chess draw declined", `${actor.name} declined ${offeredBy}’s draw offer`); }
      } else if (body.action === "resign") {
        if (game.status !== "active") return Response.json({ error: "This game has already ended." }, { status: 409 });
        game.status = "completed"; game.endedAt = at; game.winnerId = game.whiteId === actor.id ? game.blackId : game.whiteId; game.result = `${game.whiteId === actor.id ? game.blackName : game.whiteName} wins by resignation`;
        addActivity(data, game, actor, "Chess game ended", `${actor.name} resigned · ${game.result}`);
      } else if (body.action === "move") {
        if (game.status !== "active") return Response.json({ error: "This game is not active." }, { status: 409 });
        const chess = new Chess(game.fen); const turn = chess.turn(); const assigned = turn === "w" ? game.whiteId : game.blackId;
        if (assigned !== actor.id) return Response.json({ error: "It is not your turn." }, { status: 403 });
        const elapsed = game.timeControl === "inf" ? 0 : Math.max(0, now.getTime() - Date.parse(game.turnStartedAt || at));
        if (game.timeControl !== "inf") game.clocks[turn] = Math.max(0, Number(game.clocks[turn]) - elapsed);
        if (game.timeControl !== "inf" && !game.clocks[turn]) { game.status = "completed"; game.endedAt = at; game.winnerId = turn === "w" ? game.blackId : game.whiteId; game.result = `${turn === "w" ? game.blackName : game.whiteName} wins on time`; addActivity(data, game, actor, "Chess game ended on time", game.result); }
        else {
          const played = chess.move({ from: String(body.from), to: String(body.to), ...(body.promotion ? { promotion: String(body.promotion) } : {}) });
          if (!played) return Response.json({ error: "That move is not legal." }, { status: 400 });
          if (game.drawOfferBy && game.drawOfferBy !== actor.id) { const offeredBy = memberName(data, game.drawOfferBy); delete game.drawOfferBy; addActivity(data, game, actor, "Chess draw declined", `${actor.name} declined ${offeredBy}’s draw offer by continuing the game`); }
          game.fen = chess.fen(); game.moves.push({ san: played.san, color: turn, by: actor.id, at });
          const isGameOver = finished(chess, game);
          if (!isGameOver) game.turnStartedAt = new Date().toISOString();
          addActivity(data, game, actor, isGameOver ? "Chess game completed" : "Chess move played", `${game.whiteName} vs ${game.blackName} · ${actor.name} played ${played.san}${isGameOver ? ` · ${game.result}` : game.mode === "ai" ? " · AI is thinking" : ""}`);
        }
      } else if (body.action === "ai-move") {
        if (game.status !== "active" || game.mode !== "ai" || game.challengerId !== actor.id) return Response.json({ error: "This is not an active AI turn for your game." }, { status: 409 });
        const chess = new Chess(game.fen); const turn = chess.turn();
        if (turn === game.humanColor) return Response.json({ error: "It is not AI’s turn." }, { status: 409 });
        const aiTurnStartedAt = Date.parse(game.turnStartedAt || at);
        const waitMs = Math.max(0, aiThinkTimeMs - (Date.now() - aiTurnStartedAt));
        if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
        const moveAt = new Date(); const elapsed = Math.max(0, moveAt.getTime() - aiTurnStartedAt);
        if (game.timeControl !== "inf") game.clocks[turn] = Math.max(0, Number(game.clocks[turn]) - elapsed);
        if (game.timeControl !== "inf" && !game.clocks[turn]) {
          game.status = "completed"; game.endedAt = moveAt.toISOString(); game.winnerId = turn === "w" ? game.blackId : game.whiteId; game.result = `${turn === "w" ? game.blackName : game.whiteName} wins on time`;
          addActivity(data, game, actor, "Chess game ended on time", game.result);
        } else {
          const uci = String(body.uci || "");
          if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) return Response.json({ error: "Stockfish returned an invalid move." }, { status: 400 });
          const played = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), ...(uci[4] ? { promotion: uci[4] } : {}) });
          if (!played) return Response.json({ error: "Stockfish returned a move that is not legal in this position." }, { status: 400 });
          game.fen = chess.fen(); game.moves.push({ san: played.san, color: turn, by: "chess-ai", at: moveAt.toISOString() });
          const isGameOver = finished(chess, game);
          if (!isGameOver) game.turnStartedAt = moveAt.toISOString();
          addActivity(data, game, actor, isGameOver ? "Chess game completed" : "Chess AI move played", `${game.whiteName} vs ${game.blackName} · AI · Stockfish (${game.aiDifficulty || "medium"}) played ${played.san}${isGameOver ? ` · ${game.result}` : ""}`);
        }
      } else return Response.json({ error: "Unknown chess action." }, { status: 400 });
    }
    data.chessGames = games;
    let writeData = data;
    let writeVersion = row.updated_at;
    let saved = await env.DB.prepare("UPDATE workspace_documents SET data = ?1, updated_at = ?2 WHERE id = ?3 AND updated_at = ?4").bind(JSON.stringify(writeData), `chess-${crypto.randomUUID()}`, "f2b-agency", writeVersion).run();
    let persisted = saved.meta.changes === 1;
    for (let retry = 0; !persisted && retry < 3; retry++) {
      const latestRow = await readWorkspace();
      if (!latestRow) return Response.json({ error: "The workspace could not be reloaded. Your game remains saved if it was already created; refresh and check the board." }, { status: 503 });
      const latestData = JSON.parse(latestRow.data);
      const latestGames: Game[] = Array.isArray(latestData.chessGames) ? latestData.chessGames : [];
      const changedGameIndex = latestGames.findIndex((item) => item.id === game?.id);
      if (!originalGame) {
        if (changedGameIndex === -1 && game) latestGames.unshift(game);
      } else {
        if (changedGameIndex === -1) return Response.json({ error: "This match is no longer in the saved game list. Refresh before making another move." }, { status: 409 });
        const latestGame = latestGames[changedGameIndex];
        const alreadySaved = Boolean(game && latestGame.fen === game.fen && latestGame.moves.length === game.moves.length && latestGame.status === game.status && latestGame.result === game.result);
        if (alreadySaved) { game = latestGame; writeData = latestData; persisted = true; break; }
        const stillAtStartingVersion = latestGame.fen === originalGame.fen && latestGame.moves.length === originalGame.moves.length && latestGame.status === originalGame.status && latestGame.drawOfferBy === originalGame.drawOfferBy;
        if (!stillAtStartingVersion) return Response.json({ error: "This match changed on another screen. The saved board is safe; refresh to load the latest position." }, { status: 409 });
        if (game) latestGames[changedGameIndex] = game;
      }
      latestData.chessGames = latestGames;
      writeData = latestData;
      writeVersion = latestRow.updated_at;
      saved = await env.DB.prepare("UPDATE workspace_documents SET data = ?1, updated_at = ?2 WHERE id = ?3 AND updated_at = ?4").bind(JSON.stringify(writeData), `chess-${crypto.randomUUID()}`, "f2b-agency", writeVersion).run();
      persisted = saved.meta.changes === 1;
    }
    if (!persisted) return Response.json({ error: "The workspace is busy saving other changes. Your current board is safe; wait a moment and refresh to continue." }, { status: 409 });
    if (body.action === "challenge" && game) {
      const invitee = data.staff?.find((member: any) => member.id === game!.challengedId && !member.isBot);
      let inviteStatus: "sent" | "failed" = "failed";
      let inviteDetail = !invitee?.email || !String(invitee.email).includes("@") ? "No email address is saved on the invited staff profile." : !env.RESEND_API_KEY || !env.TASK_NOTIFICATION_FROM ? "Email sender is not configured (RESEND_API_KEY and TASK_NOTIFICATION_FROM are required)." : "Email provider did not accept the invitation.";
      if (invitee?.email && String(invitee.email).includes("@") && env.RESEND_API_KEY && env.TASK_NOTIFICATION_FROM) {
        const appUrl = env.TASK_APP_URL || new URL(request.url).origin;
        const email = chessInviteEmail(actor.name, String(invitee.name || "there"), game.timeControl, appUrl);
        try {
          const emailResponse = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `chess-challenge/${game.id}` },
            body: JSON.stringify({ from: env.TASK_NOTIFICATION_FROM, to: [invitee.email], ...email }),
            signal: AbortSignal.timeout(15_000),
          });
          const responseBody = await emailResponse.json().catch(() => null) as { id?: string; message?: string } | null;
          inviteStatus = emailResponse.ok && responseBody?.id ? "sent" : "failed";
          inviteDetail = inviteStatus === "sent" ? `Resend accepted invitation ${responseBody!.id} for ${invitee.email}.` : `Resend returned HTTP ${emailResponse.status}: ${responseBody?.message || "email was not accepted"}.`;
        } catch (emailError) { inviteDetail = emailError instanceof Error ? emailError.message : "Email provider request failed."; }
      }
      await recordChessEmailActivity(actor, inviteStatus === "sent" ? "Chess invitation email sent" : "Chess invitation email failed", `${game.whiteName} vs ${game.blackName}`, inviteDetail);
      return Response.json({ ok: true, game, inviteEmail: { status: inviteStatus, email: invitee?.email || "", detail: inviteDetail } });
    }
    return Response.json({ ok: true, game });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not update the chess game." }, { status: 400 });
  }
}
