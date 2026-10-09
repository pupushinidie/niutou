import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  bullheads,
  legalActions,
  sumBulls,
  waitingFor,
  type GameCommand,
  type GameEvent,
  type GameState,
  type LobbyMember,
  type LobbyRoomSnapshot,
} from "@niutou/game";
import GameRules from "./GameRules.js";
import { GameRoomMenu, SpectateBar } from "./RoomExtras.js";
import { socket } from "./socket.js";

/**
 * 调试牌桌（引擎阶段放的）：把状态直接摆出来，每个合法动作一个按钮，方便联调。
 * 正式牌桌由界面阶段重做；props 和 App.tsx 的接法可以照用。
 */
interface GameBoardProps {
  readonly room: LobbyRoomSnapshot;
  readonly busy: boolean;
  readonly error: string;
  readonly notice: string;
  readonly brand: ReactNode;
  readonly connection: ReactNode;
  /** 顶栏的白天 / 夜间切换按钮。 */
  readonly themeToggle: ReactNode;
  readonly chat: ReactNode;
  readonly onCommand: (command: GameCommand) => void;
  readonly onRematch: (accept: boolean) => void;
  /** 打开 / 取消自己的托管。 */
  readonly onAuto: (enabled: boolean) => void;
  readonly onDissolve: () => void;
  /** 观战时从这位玩家的座位看。 */
  readonly watchId: string;
  readonly onWatch: (playerId: string) => void;
  /** 观战的人离开。 */
  readonly onLeave: () => void;
}

function useCountdown(room: LobbyRoomSnapshot): number | null {
  const [now, setNow] = useState(Date.now());
  const [anchor, setAnchor] = useState({ at: Date.now(), ms: room.turnRemainingMs });
  useEffect(() => setAnchor({ at: Date.now(), ms: room.turnRemainingMs }), [room]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  if (anchor.ms === undefined) return null;
  return Math.max(0, Math.ceil((anchor.ms - (now - anchor.at)) / 1000));
}

const ROW_NAMES = ["第 1 排", "第 2 排", "第 3 排", "第 4 排"];

function describeEvent(event: GameEvent, name: (id: string) => string): string | null {
  switch (event.type) {
    case "Revealed":
      return `亮牌：${event.plays.map((play) => `${name(play.player)} ${play.card}`).join("，")}`;
    case "CardPlaced":
      return `${name(event.player)} 的 ${event.card} 接到${ROW_NAMES[event.row]}（第 ${event.position} 张）`;
    case "RowTaken":
      return event.reason === "sixth"
        ? `${name(event.player)} 的 ${event.card} 是${ROW_NAMES[event.row]}的第六张，收走 ${event.cards.join("、")}，罚 ${event.bulls} 分`
        : `${name(event.player)} 的 ${event.card} 比所有排尾都小，${event.auto ? "代选" : "选"}收${ROW_NAMES[event.row]} ${event.cards.join("、")}，罚 ${event.bulls} 分`;
    case "ChooseRow":
      return `${name(event.player)} 的 ${event.card} 比所有排尾都小，等他选一排收走`;
    case "RoundEnded":
      return `第 ${event.round} 局结束`;
    case "RoundStarted":
      return `第 ${event.round} 局发牌`;
    case "GameEnded":
      return `游戏结束，${event.winners.map(name).join("、")} 罚分最少`;
    case "TimedOut":
      return `${event.players.map(name).join("、")} 超时，系统代做`;
    default:
      return null;
  }
}

function Card({ card, dim = false }: { card: number; dim?: boolean }) {
  const bulls = bullheads(card);
  return (
    <span className={`nt-card b${bulls}${dim ? " dim" : ""}`} title={`${card}：${bulls} 个牛头`}>
      <b>{card}</b>
      <i>{"♉".repeat(bulls)}</i>
    </span>
  );
}

function GameBoard({ room, busy, error, notice, brand, connection, themeToggle, chat, onCommand, onRematch, onAuto, onDissolve, watchId, onWatch, onLeave }: GameBoardProps) {
  const game = room.game!;
  const member = room.members.find((candidate) => candidate.id === socket.id);
  const spectating = !member;
  const myId = member?.playerId ?? watchId;
  const selfId = spectating ? "" : myId;
  const isHost = member?.isHost ?? false;
  const me = game.players.find((player) => player.id === myId)!;
  const secondsLeft = useCountdown(room);
  const waiting = waitingFor(game);
  const actions = spectating ? [] : legalActions(game, myId);
  const autoPlaying = member?.auto === true;
  const nameOf = (playerId: string) => (playerId === selfId ? "你" : game.players.find((player) => player.id === playerId)?.name ?? "?");
  const memberOf = (playerId: string) => room.members.find((candidate) => candidate.playerId === playerId);
  const firstVersion = useRef(game.version);
  const shownNotice = game.version === firstVersion.current ? notice : "";

  const [log, setLog] = useState<{ key: string; text: string }[]>([]);
  const seenVersion = useRef(game.version);
  useEffect(() => {
    if (game.version === seenVersion.current) return;
    const restarted = game.version < seenVersion.current;
    seenVersion.current = game.version;
    const lines = game.events
      .map((event, index) => ({ key: `${game.version}-${index}`, text: describeEvent(event, nameOf) }))
      .filter((line): line is { key: string; text: string } => line.text !== null);
    setLog((previous) => [...[...lines].reverse(), ...(restarted ? [] : previous)].slice(0, 80));
  }, [game.version]);

  let prompt: string;
  if (game.phase === "gameOver") prompt = "游戏结束";
  else if (autoPlaying) prompt = "托管中：人机替你出牌";
  else if (game.phase === "select") prompt = spectating ? "大家在选牌" : me.selected ? "已选好，可以撤回改选；等其他人" : "选一张牌（点一下就确认）";
  else if (game.phase === "chooseRow") prompt = game.chooser === myId && !spectating ? "你的牌比所有排尾都小：选一排收走" : `${nameOf(game.chooser!)} 正在选排`;
  else prompt = `第 ${game.round} 局结束，点「继续」或等几秒自动开下一局`;

  const reveal = game.reveal;
  return (
    <div className="nt-screen">
      <header className="nt-topbar">
        {brand}
        <div className="nt-status">
          <span>第 {game.round} 局 · 第 {game.turn} 手 · {game.phase}</span>
          <span>{game.config.fixedRounds !== null ? `固定 ${game.config.fixedRounds} 局` : `${game.config.target} 分结束`}{game.config.tactics ? " · 战术" : ""}</span>
          {game.phase !== "gameOver" && secondsLeft !== null && <b className={secondsLeft <= 5 ? "nt-timer low" : "nt-timer"}>{secondsLeft}s</b>}
        </div>
        <div className="nt-topbar-right">
          {themeToggle}
          <GameRules />
          <GameRoomMenu room={room} />
          {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve}>解散</button>}
          {connection}
        </div>
      </header>
      {spectating && <SpectateBar room={room} watchId={watchId} onWatch={onWatch} onLeave={onLeave} />}

      <div className="nt-layout">
        <main className="nt-main">
          <div className="nt-prompt" role="status">
            {prompt}
            {autoPlaying && game.phase !== "gameOver" && <button className="quiet-button" type="button" onClick={() => onAuto(false)}>取消托管</button>}
            {!spectating && !autoPlaying && game.phase !== "gameOver" && <button className="quiet-button" type="button" onClick={() => onAuto(true)}>托管</button>}
          </div>
          {(error || shownNotice) && <p className={error ? "nt-feedback error" : "nt-feedback"} role={error ? "alert" : "status"}>{error || shownNotice}</p>}

          <section className="nt-rows" data-tutorial="rows">
            {game.rows.map((row, index) => {
              const chooseThis = actions.find((action) => action.type === "chooseRow" && action.row === index);
              return (
                <div className={row.length === 5 ? "nt-row full" : "nt-row"} key={index}>
                  <span className="nt-row-name">{ROW_NAMES[index]}<small>{sumBulls(row)} 牛头</small></span>
                  <span className="nt-row-cards">
                    {row.map((card) => <Card key={card} card={card} />)}
                    {Array.from({ length: 5 - row.length }, (_, slot) => <span key={`e${slot}`} className="nt-slot" />)}
                    <span className="nt-slot danger" title="第六张收牌">6</span>
                  </span>
                  {chooseThis && (
                    <button className="primary-button" type="button" disabled={busy} onClick={() => onCommand(chooseThis)}>收这一排</button>
                  )}
                </div>
              );
            })}
          </section>

          {reveal && (
            <section className="nt-reveal">
              <h3>第 {reveal.round} 局第 {reveal.turn} 手亮牌（#{reveal.id}）{reveal.done ? "" : " · 结算中"}</h3>
              <div className="nt-plays">
                {reveal.plays.map((play, index) => (
                  <span key={play.card} className={index < reveal.steps.length ? "nt-play done" : "nt-play"}>
                    <Card card={play.card} />
                    <small>{nameOf(play.player)}</small>
                  </span>
                ))}
              </div>
              <ol>
                {reveal.steps.map((step) => (
                  <li key={step.card}>
                    {nameOf(step.player)} {step.card} → {ROW_NAMES[step.row]}
                    {step.kind === "place" ? `（第 ${step.position} 张）` : step.kind === "sixth" ? `：第六张，收 ${step.taken.join("、")}，罚 ${step.bulls}` : `：${step.auto ? "代选" : "自选"}收整排 ${step.taken.join("、")}，罚 ${step.bulls}`}
                  </li>
                ))}
              </ol>
            </section>
          )}

          <section className="nt-hand" data-tutorial="hand">
            <h3>{spectating ? `${me.name} 的手牌` : "你的手牌"} <small>{me.handCount} 张</small></h3>
            <div className="nt-hand-cards">
              {me.hand.length === 0 && me.handCount > 0 && <span className="nt-muted">（看不到）</span>}
              {me.hand.map((card) => {
                const action = actions.find((candidate) => candidate.type === "select" && candidate.card === card);
                const chosen = me.selection === card;
                return (
                  <button
                    key={card}
                    type="button"
                    className={chosen ? "nt-hand-card chosen" : "nt-hand-card"}
                    disabled={busy || (!action && !chosen)}
                    onClick={() => (chosen ? onCommand({ type: "unselect" }) : action && onCommand(action))}
                    title={chosen ? "点一下撤回" : "选这张"}
                  >
                    <Card card={card} />
                  </button>
                );
              })}
            </div>
            <div className="nt-actions">
              {actions.some((action) => action.type === "unselect") && (
                <button className="quiet-button" type="button" disabled={busy} onClick={() => onCommand({ type: "unselect" })}>撤回</button>
              )}
              {actions.some((action) => action.type === "nextRound") && (
                <button className="primary-button" type="button" disabled={busy} onClick={() => onCommand({ type: "nextRound" })}>继续</button>
              )}
            </div>
          </section>
        </main>

        <aside className="nt-side">
          <Players game={game} myId={selfId} waiting={waiting} memberOf={memberOf} />
          <section className="nt-panel nt-log">
            <h3>记录</h3>
            {log.length === 0 ? <p className="nt-muted">还没有动作。</p> : <ul>{log.map((line) => <li key={line.key}>{line.text}</li>)}</ul>}
          </section>
          <div className="nt-chat">{chat}</div>
        </aside>
      </div>
      {game.phase === "gameOver" && <FinalDialog game={game} room={room} myId={selfId} spectating={spectating} onRematch={onRematch} onLeave={onLeave} />}
    </div>
  );
}

function Players({ game, myId, waiting, memberOf }: { game: GameState; myId: string; waiting: string[]; memberOf: (id: string) => LobbyMember | undefined }) {
  const live = game.phase === "select" || game.phase === "chooseRow";
  return (
    <section className="nt-panel nt-players">
      <h3>玩家 <small>罚分越少越好</small></h3>
      {game.players.map((player) => {
        const seated = memberOf(player.id);
        const offline = !seated?.connected;
        return (
          <div className={waiting.includes(player.id) ? "nt-player waiting" : "nt-player"} key={player.id}>
            <strong>
              {player.name}
              {player.id === myId && <small className="nt-tag">你</small>}
              {seated?.bot && <small className="nt-tag">人机</small>}
              {!seated?.bot && (seated?.auto || offline) && <small className="nt-tag">托管</small>}
              {offline && <small className="nt-tag">离线</small>}
            </strong>
            <span>
              {game.phase === "select" ? (player.selected ? "已选好" : "思考中") : game.phase === "roundEnd" ? (player.ready ? "已继续" : "看结算") : game.chooser === player.id ? "选排中" : ""}
            </span>
            <span>本局 {player.roundBulls} · 累计 {player.total + (live ? player.roundBulls : 0)}</span>
            <span className="nt-muted">收了 {player.taken.length} 张 · 手牌 {player.handCount}</span>
          </div>
        );
      })}
    </section>
  );
}

function FinalDialog({ game, room, myId, spectating, onRematch, onLeave }: {
  game: GameState;
  room: LobbyRoomSnapshot;
  myId: string;
  spectating: boolean;
  onRematch: (accept: boolean) => void;
  onLeave: () => void;
}) {
  const result = game.finalResult!;
  const accepted = room.rematch?.acceptedIds.includes(socket.id ?? "") ?? false;
  const rows = [...game.players].sort((a, b) => a.total - b.total);
  const winners = result.winners.map((id) => (id === myId ? "你" : game.players.find((player) => player.id === id)!.name));
  return (
    <div className="gm-modal-backdrop" role="presentation">
      <section className="gm-panel nt-final" role="dialog" aria-modal="true" aria-labelledby="nt-final-title">
        <h2 id="nt-final-title">{winners.join("、")} {result.winners.length > 1 ? "并列获胜" : "获胜"}</h2>
        <p className="nt-muted">{result.reason === "rounds" ? `打满 ${result.rounds} 局` : `有人到了 ${game.config.target} 分`}，罚分最少的赢</p>
        <ol className="nt-standings">
          {rows.map((player) => (
            <li key={player.id} className={result.winners.includes(player.id) ? "winner" : ""}>
              <strong>{player.name}{player.id === myId ? "（你）" : ""}</strong>
              <span>{game.history.map((round) => round.bulls[player.id] ?? 0).join(" + ")} = {player.total}</span>
            </li>
          ))}
        </ol>
        {spectating ? (
          <div className="nt-rematch">
            <span>{room.rematch ? `等玩家决定要不要再来一局（${room.rematch.acceptedIds.length}/${room.members.length} 人同意）` : "对局结束"}</span>
            <div className="gm-panel-actions"><button className="quiet-button" type="button" onClick={onLeave}>离开观战</button></div>
          </div>
        ) : room.rematch && (
          <div className="nt-rematch">
            <span>再来一局？还剩 {Math.ceil(room.rematch.remainingMs / 1000)} 秒（{room.rematch.acceptedIds.length}/{room.members.length} 人同意）</span>
            <div className="gm-panel-actions">
              <button className="quiet-button" type="button" onClick={() => onRematch(false)}>离开</button>
              <button className="primary-button" type="button" disabled={accepted} onClick={() => onRematch(true)}>{accepted ? "等待其他人" : "再来一局"}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default GameBoard;
