import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  bullheads,
  legalActions,
  stepKey,
  sumBulls,
  targetRow,
  waitingFor,
  type GameCommand,
  type GameState,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type Player,
} from "@niutou/game";
import {
  ART,
  avatarArt,
  cardStyle,
  dangerArt,
  dangerStripArt,
  sceneFor,
  seatColor,
  seatInk,
  slotArt,
  type CardSize,
} from "./art.js";
import FlyLayer from "./FlyLayer.js";
import GameRules from "./GameRules.js";
import { pickLayout, seatColumns, type Layout, type SeatSize } from "./layout.js";
import { boardFrame, useRevealPlayback, type PlaybackOptions } from "./reveal.js";
import { GameRoomMenu } from "./RoomExtras.js";
import { socket } from "./socket.js";
import { Coach, TipToast } from "./tutorial/Coach.js";
import { useFirstTimeTips } from "./tutorial/tips.js";
import { detectTips, GAME_ID, hintFor, TIPS, type Hint } from "./tutorial/tutorialGame.js";

/**
 * 正式牌桌。布局见 layout.ts；亮牌动画见 reveal.ts / FlyLayer.tsx。
 * 教程锚点 data-tutorial 的清单写在交接报告里，改名前先告诉教程。
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
  readonly theme: "day" | "night";
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
  /** 预览页用：第一次渲染也放亮牌动画、把动画时钟停在某一刻。 */
  readonly playback?: PlaybackOptions;
  /**
   * 预览页用：强制显示「提示」按钮。正常情况下「提示」只在练习局（mode="practice"）和「只有自己和人机」的房间里出现：
   * 人机给一句理由，并替你选中那张牌 / 那一排（还要你自己点确认）。
   */
  readonly showHint?: boolean;
  /** 自己在 room.members 里的 id；默认 socket.id。新手教程在本地拼房间，传固定值。 */
  readonly selfMemberId?: string;
  /**
   * online：真实对局（默认）；
   * tutorial：新手教程的剧本进行中（咕噜嘎在讲，不出提示和小贴士）；
   * practice：教程后的练习局（随时能用「提示」）。
   */
  readonly mode?: "online" | "tutorial" | "practice";
  /** 终局弹窗里替代「再来一局」的按钮（练习局：结束教程 / 再练一局）。 */
  readonly finalActions?: ReactNode;
}

const ROW_LABEL = ["第 1 排", "第 2 排", "第 3 排", "第 4 排"];

function useViewport(): { w: number; h: number } {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const update = () => setSize(read());
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return size;
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

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** 一张牌（图集里取格子）。n = 0 是牌背。 */
export function CardFace({ card, size, className = "", style }: { card: number; size: CardSize; className?: string; style?: CSSProperties }) {
  return (
    <span
      className={`nt-card ${className}`}
      style={{ ...cardStyle(card, size), ...style }}
      role="img"
      aria-label={card === 0 ? "扣着的牌" : `${card}（${bullheads(card)} 个牛头）`}
    />
  );
}

/** 单元格里放的东西：牌、空格或危险格。 */
function Cell({ row, index, card, layout, danger, ghost, pendingCard }: {
  row: number;
  index: number;
  card: number | null;
  layout: Layout;
  danger: boolean;
  ghost: { card: number; bad: boolean } | null;
  pendingCard: number | null;
}) {
  const strip = layout.mode === "phone" && index === 5;
  const set = layout.rows.set;
  const background = index === 5 ? (strip ? dangerStripArt : dangerArt(set)) : slotArt(set);
  const style: CSSProperties = strip
    ? { width: 28, height: layout.cell.h, backgroundImage: `url(${background})` }
    : { width: layout.cell.w, height: layout.cell.h, backgroundImage: `url(${background})` };
  return (
    <div
      className={`nt-cell${index === 5 ? " sixth" : ""}${danger ? " live" : ""}`}
      data-cell={`${row}-${index}`}
      style={style}
      {...(index === 5 ? { "data-tutorial": "sixth-slot" } : {})}
    >
      {card !== null && <CardFace card={card} size={layout.rows} />}
      {pendingCard !== null && <CardFace card={pendingCard} size={layout.rows} className={strip ? "nt-pending strip" : "nt-pending"} />}
      {ghost && <CardFace card={ghost.card} size={layout.rows} className={ghost.bad ? "nt-ghost bad" : "nt-ghost"} />}
    </div>
  );
}

/** 玩家卡：头像（座位色）+ 名字 + 标签 + 本局牛头 + 累计罚分 + 状态。 */
function Seat({ player, member, bulls, total, status, isMe, active, size, compact = false, target }: {
  player: Player;
  member: LobbyMember | undefined;
  bulls: number;
  total: number;
  status: "thinking" | "ready" | "choosing" | "continued" | "idle";
  isMe: boolean;
  active: boolean;
  size: SeatSize;
  compact?: boolean;
  target: number;
}) {
  const offline = member ? !member.connected : false;
  const tags: string[] = [];
  if (isMe) tags.push("你");
  if (member?.bot) tags.push("人机");
  else if (member?.auto) tags.push("托管");
  if (offline && !member?.bot) tags.push("离线");
  const avatarPx = size === "small" ? 32 : 64;
  const iconScale = size === "big" || size === "xl" ? 2 : 1;
  const statusLabel = status === "thinking" ? "思考中" : status === "ready" ? "已选好" : status === "choosing" ? "选排中" : status === "continued" ? "已继续" : "";
  const near = total >= target - 10 && target > 0;
  return (
    <div
      className={`nt-seat ${size}${compact ? " compact" : ""}${active ? " active" : ""}${offline ? " offline" : ""}${isMe ? " me" : ""}`}
      style={{ "--seat": seatColor(player.seat), "--seat-ink": seatInk(player.seat) } as CSSProperties}
      data-tutorial={isMe ? "my-seat" : `seat:${player.id}`}
      data-player={player.id}
    >
      <div className="nt-avatar" data-avatar={player.id} style={{ width: avatarPx, height: avatarPx }}>
        <img src={avatarArt(player.seat)} alt="" width={avatarPx} height={avatarPx} />
        {status !== "idle" && (
          <span className={`nt-status ${status}`} title={statusLabel} data-tutorial="seat-status" style={{ width: 16 * iconScale, height: 16 * iconScale }}>
            {status === "thinking" && <i className="nt-thinking" style={{ backgroundSize: `${64 * iconScale}px ${16 * iconScale}px` }} />}
            {status === "ready" && <img src={ART.ready} alt="" width={16 * iconScale} height={16 * iconScale} />}
            {status === "choosing" && <img src={ART.lasso} alt="" width={16 * iconScale} height={16 * iconScale} />}
            {status === "continued" && <img src={ART.ready} alt="" width={16 * iconScale} height={16 * iconScale} />}
          </span>
        )}
      </div>
      <div className="nt-seat-info">
        <div className="nt-seat-name">
          <span className="nt-name">{player.name}</span>
          {tags.map((tag) => <em key={tag} className={`nt-tag ${tag === "人机" ? "bot" : tag === "你" ? "you" : "warn"}`}>{tag}</em>)}
        </div>
        <div className="nt-seat-stats">
          <span className="nt-bulls" title="本局收到的牛头" data-tutorial="seat-bulls">
            <img src={ART.head16} alt="本局牛头" width={16 * iconScale} height={16 * iconScale} />
            <b>{bulls}</b>
          </span>
          <span className={near ? "nt-total near" : "nt-total"} title="累计罚分" data-tutorial="seat-total">
            <small>累计</small>
            <b>{total}</b>
          </span>
        </div>
      </div>
    </div>
  );
}

interface LogLine {
  key: string;
  text: string;
}

function GameBoard(props: GameBoardProps) {
  const { room, busy, error, notice, brand, connection, themeToggle, theme, chat, onCommand: sendCommand, onRematch, onAuto, onDissolve, watchId, onWatch, onLeave } = props;
  const { selfMemberId, mode = "online", finalActions } = props;
  const game = room.game!;
  const viewport = useViewport();
  const layout = useMemo(() => pickLayout(viewport.w, viewport.h), [viewport.w, viewport.h]);
  const reduced = useReducedMotion();
  const [skipAnims, setSkipAnims] = useState(false);
  const playback = useRevealPlayback(game, { ...props.playback, disabled: reduced || skipAnims || (props.playback?.disabled ?? false) });
  const anim = playback.playing ? playback.anim : null;
  const frame = anim ? boardFrame(anim, playback.beat, game.reveal?.plays ?? []) : null;

  // 每个动作都带上自己看到的这一步（stepKey）：这一手已经结算了、点击才到的话，服务器会拒绝，不会落到下一手
  const onCommand = (command: GameCommand) => sendCommand({ ...command, step: stepKey(game) });
  const member = room.members.find((candidate) => candidate.id === (selfMemberId ?? socket.id));
  const spectating = !member;
  const myId = member?.playerId ?? watchId;
  const selfId = spectating ? "" : myId;
  const isHost = member?.isHost ?? false;
  const me = game.players.find((player) => player.id === myId) ?? game.players[0]!;
  const secondsLeft = useCountdown(room);
  const waiting = waitingFor(game);
  const actions = spectating ? [] : legalActions(game, myId);
  const autoPlaying = member?.auto === true;
  const nameOf = (playerId: string) => (playerId === selfId ? "你" : game.players.find((player) => player.id === playerId)?.name ?? "?");
  const memberOf = (playerId: string) => room.members.find((candidate) => candidate.playerId === playerId);
  const live = game.phase === "select" || game.phase === "chooseRow";
  const step = stepKey(game);

  // ---------- 选牌：点一下选中，再点同一张 / 确认 / 空格才提交 ----------
  const [picked, setPicked] = useState<number | null>(null);
  const [pickedRow, setPickedRow] = useState<number | null>(null);
  useEffect(() => {
    setPicked(null);
    setPickedRow(null);
  }, [step]);
  const canSelect = !spectating && !autoPlaying && game.phase === "select" && !anim && actions.some((action) => action.type === "select");
  const canUndo = !spectating && !autoPlaying && !anim && actions.some((action) => action.type === "unselect");
  const iChoose = !spectating && !autoPlaying && game.phase === "chooseRow" && game.chooser === myId && !anim;
  const committed = me.selected && me.selection !== null ? me.selection : null;

  function pickCard(card: number) {
    if (!canSelect) return;
    if (card === committed && picked === null) return;
    if (picked === card) {
      confirmPick(card);
      return;
    }
    setPicked(card);
  }
  function confirmPick(card = picked) {
    if (card === null || !canSelect) return;
    if (card === committed) {
      setPicked(null);
      return;
    }
    onCommand({ type: "select", card });
    setPicked(null);
  }
  function undo() {
    if (!canUndo) return;
    onCommand({ type: "unselect" });
    setPicked(null);
  }
  function pickRow(row: number) {
    if (!iChoose) return;
    if (pickedRow === row) {
      onCommand({ type: "chooseRow", row });
      setPickedRow(null);
      return;
    }
    setPickedRow(row);
  }
  function confirmRow() {
    if (pickedRow === null || !iChoose) return;
    onCommand({ type: "chooseRow", row: pickedRow });
    setPickedRow(null);
  }
  const canContinue = !spectating && actions.some((action) => action.type === "nextRound");

  // 「提示」：人机替我算一手，选中那张牌 / 那一排（还要自己点确认），咕噜嘎贴在旁边说理由。
  // 练习局随时能用；真实对局里只有自己和人机时能用（有别的真人就不显示，免得不公平）。
  const botsOnly = !spectating && room.members.length > 1 && room.members.every((candidate) => candidate.id === member?.id || candidate.bot === true);
  const hintAllowed = props.showHint === true || mode === "practice" || (mode === "online" && botsOnly);
  const canHint = hintAllowed && !anim && (canSelect || iChoose);
  const [hint, setHint] = useState<{ version: number; hint: Hint } | null>(null);
  const shownHint = hint && hint.version === game.version && canHint ? hint.hint : null;
  function askHint() {
    if (hint && hint.version === game.version) {
      setHint(null);
      return;
    }
    const next = hintFor(game, myId);
    if (next.card !== undefined) setPicked(next.card);
    if (next.row !== undefined) setPickedRow(next.row);
    setHint({ version: game.version, hint: next });
  }
  const askHintRef = useRef(askHint);
  askHintRef.current = askHint;
  useEffect(() => {
    if (!canHint) return;
    const handle = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey || target?.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key.toLowerCase() === "h") askHintRef.current();
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [canHint]);

  // 真实对局里第一次遇到某条规则（第一次收第六张、第一次比所有排尾都小、第一次被托管……）时弹一句小贴士
  const tips = useFirstTimeTips(GAME_ID, game.version, () => detectTips(game, selfId, autoPlaying), TIPS, mode === "online" && !spectating);

  // 键盘：←→ 挑手牌，空格 / 回车确认，Esc 取消；规则 C 时 1–4 选排
  const keyState = useRef({ canSelect, picked, iChoose, pickedRow, hand: me.hand, canUndo });
  keyState.current = { canSelect, picked, iChoose, pickedRow, hand: me.hand, canUndo };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const state = keyState.current;
      if (state.iChoose && ["1", "2", "3", "4"].includes(event.key)) {
        setPickedRow(Number(event.key) - 1);
        event.preventDefault();
        return;
      }
      if (state.iChoose && (event.key === "Enter" || event.key === " ") && state.pickedRow !== null) {
        confirmRowRef.current();
        event.preventDefault();
        return;
      }
      if (!state.canSelect) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const hand = state.hand;
        if (hand.length === 0) return;
        const index = state.picked === null ? -1 : hand.indexOf(state.picked);
        const next = event.key === "ArrowRight" ? Math.min(hand.length - 1, index + 1) : index <= 0 ? 0 : index - 1;
        setPicked(hand[next]!);
        event.preventDefault();
      } else if ((event.key === "Enter" || event.key === " ") && state.picked !== null) {
        confirmPickRef.current();
        event.preventDefault();
      } else if (event.key === "Escape") {
        setPicked(null);
        setPickedRow(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const confirmPickRef = useRef(() => confirmPick());
  confirmPickRef.current = () => confirmPick();
  const confirmRowRef = useRef(confirmRow);
  confirmRowRef.current = confirmRow;

  // ---------- 页面在后台时，标题提示「【该你选牌】」 ----------
  const needMe = !spectating && !autoPlaying && ((game.phase === "select" && !me.selected) || (game.phase === "chooseRow" && game.chooser === myId));
  useEffect(() => {
    const base = "谁是牛头王 · 在线对战";
    const update = () => {
      document.title = document.hidden && needMe ? (game.phase === "chooseRow" ? "【该你选排】谁是牛头王" : "【该你选牌】谁是牛头王") : base;
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      document.title = base;
    };
  }, [needMe, game.phase]);

  // ---------- 记录：按亮牌（reveal）记，events 只补局末、终局、超时 ----------
  const [log, setLog] = useState<LogLine[]>([]);
  const logged = useRef({ version: game.version, reveal: game.reveal?.id ?? -1, steps: game.reveal?.steps.length ?? 0 });
  useEffect(() => {
    const seen = logged.current;
    if (game.version === seen.version) return;
    // 再来一局：版本从头算；只差几步的旧快照（回执比广播晚到）直接忽略
    const restarted = game.version + 10 < seen.version;
    if (game.version < seen.version && !restarted) return;
    const lines: LogLine[] = [];
    const reveal = game.reveal;
    if (reveal && (reveal.id !== seen.reveal || reveal.steps.length > seen.steps)) {
      const from = reveal.id !== seen.reveal ? 0 : seen.steps;
      if (from === 0) lines.push({ key: `r${reveal.id}`, text: `第 ${reveal.round} 局第 ${reveal.turn} 手亮牌：${reveal.plays.map((play) => `${nameOf(play.player)} ${play.card}`).join("、")}` });
      reveal.steps.slice(from).forEach((item) => {
        if (item.kind === "sixth") lines.push({ key: `s${reveal.id}-${item.card}`, text: `${nameOf(item.player)} 的 ${item.card} 是${ROW_LABEL[item.row]}第六张，收走 ${item.taken.length} 张，+${item.bulls} 牛头` });
        if (item.kind === "low") lines.push({ key: `s${reveal.id}-${item.card}`, text: `${nameOf(item.player)} 的 ${item.card} 比所有排尾都小，${item.auto ? "代选" : ""}收${ROW_LABEL[item.row]}，+${item.bulls} 牛头` });
      });
      seen.reveal = reveal.id;
      seen.steps = reveal.steps.length;
    }
    for (const event of game.events) {
      if (event.type === "RoundEnded") lines.push({ key: `e${game.version}-re`, text: `第 ${event.round} 局结束` });
      if (event.type === "GameEnded") lines.push({ key: `e${game.version}-ge`, text: `游戏结束：${event.winners.map(nameOf).join("、")} 罚分最少` });
      if (event.type === "TimedOut") lines.push({ key: `e${game.version}-to`, text: `${event.players.map(nameOf).join("、")} 超时，系统代${event.phase === "chooseRow" ? "选排" : event.phase === "roundEnd" ? "点继续" : "出牌"}` });
    }
    seen.version = game.version;
    const fresh = [...lines].reverse();
    if (lines.length || restarted) {
      setLog((previous) => {
        const kept = restarted ? [] : previous;
        const known = new Set(kept.map((line) => line.key));
        return [...fresh.filter((line) => !known.has(line.key)), ...kept].slice(0, 80);
      });
    }
  }, [game.version]);

  // ---------- 提示条（错误、通知、超时）按时消失 ----------
  const [flash, setFlash] = useState<{ text: string; bad: boolean } | null>(null);
  const flashTimer = useRef<number | null>(null);
  const showFlash = (text: string, bad: boolean) => {
    setFlash({ text, bad });
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 4000);
  };
  useEffect(() => {
    if (error) showFlash(error.includes("已经结算") ? "这一手刚结算完，看看新的局面再选。" : error, !error.includes("已经结算"));
  }, [error]);
  useEffect(() => {
    if (notice) showFlash(notice, false);
  }, [notice]);
  useEffect(() => {
    const timedOut = game.events.find((event) => event.type === "TimedOut");
    if (timedOut && timedOut.type === "TimedOut" && selfId && timedOut.players.includes(selfId)) {
      const mine = game.reveal?.plays.find((play) => play.player === selfId)?.card;
      showFlash(timedOut.phase === "chooseRow" ? "你超时了，系统替你选了一排。" : timedOut.phase === "roundEnd" ? "已自动开始下一局。" : `你超时了，系统替你出了${mine !== undefined ? ` ${mine}` : "牌"}。`, true);
    }
  }, [game.version]);
  useEffect(() => () => {
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
  }, []);

  const [drawer, setDrawer] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // ---------- 画面：动画期间按帧画 ----------
  const rows = frame ? frame.rows : game.rows;
  const bullsOf = (player: Player) => (frame ? frame.roundBulls[player.id] ?? 0 : player.roundBulls);
  const totalOf = (player: Player) => {
    const base = game.phase === "roundEnd" || game.phase === "gameOver" ? player.total - player.roundBulls : player.total;
    return base + bullsOf(player);
  };
  const statusOf = (player: Player): "thinking" | "ready" | "choosing" | "continued" | "idle" => {
    if (anim) return "idle";
    if (game.phase === "select") return player.selected ? "ready" : "thinking";
    if (game.phase === "chooseRow") return game.chooser === player.id ? "choosing" : "idle";
    if (game.phase === "roundEnd") return player.ready ? "continued" : "idle";
    return "idle";
  };
  const reveal = game.reveal;
  const showStrip = !!reveal && (!!anim || (game.phase === "chooseRow" && !reveal.done));
  const lowPlay = reveal && game.phase === "chooseRow" ? reveal.plays[reveal.steps.length] : undefined;

  // 选中的牌落在哪（假设前面没人抢先）
  const preview = useMemo(() => {
    if (picked === null || game.phase !== "select") return null;
    const row = targetRow(game.rows, picked);
    if (row === null) return { row: null, text: `${picked} 比所有排尾都小：亮牌后要自己挑一排收走`, bad: true } as const;
    const length = game.rows[row]!.length;
    if (length >= 5) return { row, index: 5, text: `${picked} 会是${ROW_LABEL[row]}的第六张：要收走 ${sumBulls(game.rows[row]!)} 个牛头`, bad: true } as const;
    return { row, index: length, text: `如果前面没人抢先：${picked} 接到${ROW_LABEL[row]}第 ${length + 1} 张`, bad: false } as const;
  }, [picked, game.rows, game.phase]);

  // ---------- 提示文字（最显眼的那一行） ----------
  let prompt: string;
  let sub = "";
  if (anim) {
    prompt = "亮牌！从小到大放";
    const current = frame?.step;
    if (current) sub = `${nameOf(current.player)}：${current.card} ${current.kind === "place" ? `接到${ROW_LABEL[current.row]}第 ${current.position} 张` : current.kind === "sixth" ? `是${ROW_LABEL[current.row]}第六张，收走 ${current.taken.length} 张，+${current.bulls} 牛头` : `比排尾都小，${current.auto ? "代选" : ""}收${ROW_LABEL[current.row]}，+${current.bulls} 牛头`}`;
    else sub = `这一手：${(reveal?.plays ?? []).map((play) => play.card).join("、")}`;
  } else if (game.phase === "gameOver") {
    prompt = "游戏结束";
  } else if (spectating) {
    prompt = game.phase === "select" ? `选牌中 ${game.players.length - waiting.length}/${game.players.length}` : game.phase === "chooseRow" ? `${nameOf(game.chooser!)}正在选排` : `第 ${game.round} 局结束`;
  } else if (autoPlaying) {
    prompt = "托管中";
    sub = "人机正在替你出牌，点「取消托管」拿回来";
  } else if (game.phase === "select") {
    const others = waiting.filter((id) => id !== myId);
    if (committed !== null && picked === null) {
      prompt = `已扣下 ${committed}`;
      sub = others.length ? `等 ${others.length} 人：${others.slice(0, 3).map(nameOf).join("、")}${others.length > 3 ? "…" : ""}；亮牌前可以撤回` : "马上亮牌";
    } else if (picked !== null) {
      prompt = committed !== null ? `改成 ${picked}？` : `出 ${picked}？`;
      sub = preview?.text ?? "";
    } else {
      prompt = "选一张牌";
      sub = layout.mode === "phone" ? "点一张，再点「确认」" : "点一张手牌，再点「确认」";
    }
  } else if (game.phase === "chooseRow") {
    if (game.chooser === myId) {
      prompt = pickedRow === null ? "挑一排收走" : `收${ROW_LABEL[pickedRow]}？`;
      sub = pickedRow === null ? `你的 ${lowPlay?.card ?? ""} 比所有排尾都小，点一排（数字是牛头）` : `罚 ${sumBulls(game.rows[pickedRow]!)} 个牛头，你的牌成为这一排的第一张`;
    } else {
      prompt = `${nameOf(game.chooser!)}正在选排`;
      sub = `${nameOf(game.chooser!)} 的 ${lowPlay?.card ?? ""} 比所有排尾都小，要挑一排收走`;
    }
  } else {
    prompt = `第 ${game.round} 局结束`;
    sub = "看看这局谁收了多少";
  }
  const urgent = secondsLeft !== null && secondsLeft <= 5 && waiting.includes(myId) && !spectating && !anim;
  const showTimer = !anim && game.phase !== "gameOver" && secondsLeft !== null;

  // ---------- 座位排成一圈 ----------
  const meIndex = game.players.findIndex((player) => player.id === me.id);
  const others = [...game.players.slice(meIndex + 1), ...game.players.slice(0, meIndex)];
  const columns = seatColumns(others);
  const seatProps = (player: Player) => ({
    player,
    member: memberOf(player.id),
    bulls: bullsOf(player),
    total: totalOf(player),
    status: statusOf(player),
    isMe: player.id === selfId,
    active: !anim && waiting.includes(player.id) && live,
    target: game.config.fixedRounds === null ? game.config.target : 0,
  });

  const vars = {
    "--cw": `${layout.cell.w}px`,
    "--ch": `${layout.cell.h}px`,
    "--hw": `${layout.handCard.w}px`,
    "--hh": `${layout.handCard.h}px`,
    "--top-h": `${layout.topH}px`,
    "--gap": `${layout.gap}px`,
    "--pad": `${layout.pad}px`,
    "--rim": `${layout.rim}px`,
    "--row-gap": `${layout.rowGap}px`,
    "--cell-gap": `${layout.cellGap}px`,
    "--head-w": `${layout.headW}px`,
    "--table-w": `${layout.tableW}px`,
    "--table-h": `${layout.tableH}px`,
    "--seat-w": `${layout.seatW}px`,
    "--seat-h": `${layout.seatH}px`,
    "--side-w": `${layout.sideW}px`,
    "--hand-bar-h": `${layout.handBarH}px`,
    "--action-w": `${layout.actionW}px`,
    "--me-w": `${layout.meW}px`,
    "--scene": `url(${sceneFor(room.code || "watch", theme)})`,
  } as CSSProperties;

  // ---------- 4 排 ----------
  const table = (
    <section className={`nt-table${iChoose ? " choosing" : ""}`} data-tutorial="rows" data-tutorial-state={iChoose ? "choosing" : game.phase === "chooseRow" && !anim ? "others-choosing" : undefined} aria-label="桌上的 4 排">
      {rows.map((row, r) => {
        const emptied = frame?.emptiedRow === r;
        const pendingSixth = frame?.pending?.row === r && frame.pending.at === "sixth" ? frame.pending.card : null;
        const pendingHead = frame?.pending?.row === r && frame.pending.at === "head" ? frame.pending.card : null;
        const bulls = sumBulls(row);
        const choosable = iChoose;
        const isPicked = pickedRow === r;
        const ghostHere = preview && preview.row === r ? preview : null;
        const ruleC = preview && preview.row === null;
        return (
          <div
            key={r}
            className={`nt-row${row.length >= 5 ? " full" : ""}${choosable ? " choosable" : ""}${isPicked ? " picked" : ""}${ruleC ? " warn" : ""}${game.phase === "chooseRow" && !iChoose && !anim ? " others-choosing" : ""}`}
            data-tutorial={`row-${r + 1}`}
            onClick={choosable ? () => pickRow(r) : undefined}
            role={choosable ? "button" : undefined}
            aria-label={choosable ? `收${ROW_LABEL[r]}，罚 ${bulls} 个牛头` : undefined}
          >
            <div className="nt-rowhead" data-rowhead={r} data-tutorial="row-bulls" title={`${ROW_LABEL[r]}：${bulls} 个牛头`}>
              {choosable ? <img src={ART.lasso} alt="" width={layout.mode === "phone" ? 16 : 32} height={layout.mode === "phone" ? 16 : 32} /> : <img src={ART.head16} alt="" width={layout.mode === "phone" ? 16 : 32} height={layout.mode === "phone" ? 16 : 32} />}
              <b>{emptied ? 0 : bulls}</b>
              <small>{r + 1} 排</small>
              {pendingHead !== null && <CardFace card={pendingHead} size={layout.rows} className="nt-pending head" />}
            </div>
            <div className="nt-cells">
              {Array.from({ length: 6 }, (_, index) => (
                <Cell
                  key={index}
                  row={r}
                  index={index}
                  card={emptied ? null : row[index] ?? null}
                  layout={layout}
                  danger={row.length >= 5 && !emptied && index === 5}
                  ghost={ghostHere && "index" in ghostHere && ghostHere.index === index ? { card: picked!, bad: ghostHere.bad } : null}
                  pendingCard={index === 5 ? pendingSixth : null}
                />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );

  // ---------- 手牌 / 亮牌条 ----------
  const strip = reveal && showStrip && (
    <div className="nt-strip" data-tutorial="reveal-strip" aria-label="亮出的牌，从小到大">
      {reveal.plays.map((play, index) => {
        const owner = game.players.find((player) => player.id === play.player);
        const gone = frame ? frame.played.has(play.card) : index < reveal.steps.length;
        const flipping = frame?.kind === "flip";
        const isLow = lowPlay?.card === play.card;
        return (
          <div className={`nt-strip-item${gone ? " gone" : ""}${isLow ? " low" : ""}`} key={play.card}>
            <span className={flipping ? "nt-flip" : undefined} data-strip={play.card}>
              <CardFace card={play.card} size={layout.hand} />
            </span>
            <span className="nt-owner" style={{ "--seat": seatColor(owner?.seat ?? 0), "--seat-ink": seatInk(owner?.seat ?? 0) } as CSSProperties}>
              {play.player === selfId ? "你" : owner?.name ?? "?"}
            </span>
          </div>
        );
      })}
    </div>
  );

  const hiddenHand = me.hand.length === 0 && me.handCount > 0;
  const hand = (
    <div className={`nt-hand${canSelect ? " can" : ""}`} data-tutorial="hand" aria-label={spectating ? `${me.name} 的手牌` : "你的手牌"}>
      {hiddenHand
        ? Array.from({ length: me.handCount }, (_, index) => <span className="nt-hcard back" key={`b${index}`}><CardFace card={0} size={layout.hand} /></span>)
        : me.hand.map((card) => {
          const isPicked = picked === card;
          const isCommitted = committed === card;
          return (
            <button
              key={card}
              type="button"
              className={`nt-hcard${isPicked ? " picked" : ""}${isCommitted ? " committed" : ""}`}
              disabled={!canSelect}
              onClick={() => pickCard(card)}
              title={isCommitted ? "已扣下（点「撤回」可以收回）" : isPicked ? "再点一下确认" : `选 ${card}`}
              data-tutorial={isCommitted ? "committed-card" : `card:${card}`}
              data-card={card}
            >
              <CardFace card={card} size={layout.hand} />
              {isCommitted && <em className="nt-stamp">已扣下</em>}
            </button>
          );
        })}
      {me.handCount === 0 && <span className="nt-empty-hand">这一局的牌出完了</span>}
    </div>
  );

  // ---------- 主按钮 ----------
  const mainButtons = (
    <div className="nt-buttons">
      {canSelect && (picked !== null || committed === null) && (
        <button className="primary-button nt-big" type="button" disabled={picked === null || busy} onClick={() => confirmPick()} data-tutorial="confirm">
          {committed !== null ? "改选" : "确认"}
        </button>
      )}
      {canUndo && picked === null && (
        <button className="quiet-button nt-big" type="button" disabled={busy} onClick={undo} data-tutorial="undo">撤回</button>
      )}
      {picked !== null && (
        <button className="quiet-button nt-small" type="button" onClick={() => setPicked(null)}>取消</button>
      )}
      {iChoose && (
        <button className="primary-button nt-big" type="button" disabled={pickedRow === null || busy} onClick={confirmRow} data-tutorial="confirm-row">确认</button>
      )}
      {canContinue && !anim && (
        <button className="primary-button nt-big" type="button" disabled={busy} onClick={() => onCommand({ type: "nextRound" })} data-tutorial="continue">继续</button>
      )}
      {autoPlaying && game.phase !== "gameOver" && layout.mode !== "phone" && (
        <button className="primary-button nt-big" type="button" onClick={() => onAuto(false)} data-tutorial="cancel-auto">取消托管</button>
      )}
      {anim && (
        <button className="quiet-button nt-small" type="button" onClick={() => playback.skip()}>跳过动画</button>
      )}
      {canHint ? (
        <button className={shownHint ? "quiet-button nt-small nt-hint on" : "quiet-button nt-small nt-hint"} type="button" onClick={askHint} title="人机替你算一步（键盘 H）" data-tutorial="hint-button">提示</button>
      ) : (
        <span data-tutorial="hint-button" className="nt-hint-anchor" />
      )}
    </div>
  );

  const spectatePanel = spectating && (
    <div className="nt-spectate">
      <label>
        <span>从谁的座位看</span>
        <select value={watchId} onChange={(event) => onWatch(event.target.value)}>
          {game.players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
        </select>
      </label>
      <span className="nt-muted">{room.access.spectatorsSeeAll ? "能看到手牌" : "只看公开信息"}</span>
      <button className="quiet-button" type="button" onClick={onLeave}>离开观战</button>
    </div>
  );

  const timer = showTimer && (
    <b className={urgent ? "nt-timer urgent" : "nt-timer"} data-tutorial="timer" title="这一步还剩的时间">{secondsLeft}<small>秒</small></b>
  );

  const flashLine = flash && <p className={flash.bad ? "nt-flash bad" : "nt-flash"} role={flash.bad ? "alert" : "status"}>{flash.text}</p>;

  const actionPanel = (
    <div className={`nt-action${urgent ? " urgent" : ""}${autoPlaying ? " auto" : ""}`} data-tutorial="prompt">
      <div className="nt-prompt-line">
        <strong className="nt-prompt" role="status">{prompt}</strong>
        {timer}
      </div>
      {sub && <p className={preview?.bad && picked !== null ? "nt-sub bad" : "nt-sub"}>{sub}</p>}
      {flashLine}
      {spectatePanel || mainButtons}
    </div>
  );

  const menuItems = (
    <>
      {!spectating && !autoPlaying && game.phase !== "gameOver" && (
        <button className="quiet-button" type="button" onClick={() => onAuto(true)} title="让人机替你出牌，随时可以取消">托管</button>
      )}
      <GameRules />
      {themeToggle}
      <GameRoomMenu room={room} />
      {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve}>解散</button>}
    </>
  );

  const roundInfo = (
    <span className="nt-round" data-tutorial="round">
      <b>第 {game.round} 局</b>
      <b>第 {Math.min(game.turn, 10)} 手</b>
      <small>{game.config.fixedRounds !== null ? `共 ${game.config.fixedRounds} 局` : `${game.config.target} 分结束`}{game.config.tactics ? " · 战术" : ""}</small>
    </span>
  );

  const sidePanel = (
    <div className="nt-side-inner">
      <section className="nt-log" data-tutorial="log">
        <h3>记录</h3>
        {log.length === 0 ? <p className="nt-muted">亮牌后这里会记下每一手。</p> : <ul>{log.filter((line) => !(anim && line.key.startsWith(`s${anim.revealId}-`))).map((line) => <li key={line.key}>{line.text}</li>)}</ul>}
      </section>
      <div className="nt-chat">{chat}</div>
    </div>
  );

  const dialogs = !anim && (
    <>
      {game.phase === "roundEnd" && <RoundEndPanel game={game} myId={selfId} seconds={secondsLeft} canContinue={canContinue} busy={busy} onContinue={() => onCommand({ type: "nextRound" })} />}
      {game.phase === "gameOver" && <FinalDialog game={game} room={room} myId={selfId} memberId={member?.id ?? ""} spectating={spectating} onRematch={onRematch} onLeave={onLeave} actions={finalActions} />}
    </>
  );

  // 「提示」的咕噜嘎贴在那张牌 / 那一排旁边；小贴士等动画放完再出（不然收牌还没飞，提示先说了）
  const coachLayer = (
    <>
      {shownHint && (
        <Coach
          view={{
            key: `hint-${game.version}`,
            say: shownHint.say,
            ...(shownHint.note ? { note: shownHint.note } : {}),
            anchor: shownHint.anchor,
            focus: false,
            face: "think",
            actions: <button className="quiet-button" type="button" onClick={() => setHint(null)}>知道了</button>,
          }}
        />
      )}
      {tips.tip && !anim && <TipToast tip={tips.tip} onClose={tips.dismiss} onNever={tips.never} />}
    </>
  );

  const fly = <FlyLayer anim={playback.anim} now={playback.now} rows={layout.rows} frozen={props.playback?.frozenAt !== undefined} reduced={reduced || skipAnims} />;

  if (layout.mode === "phone") {
    const phoneOthers = others;
    const many = phoneOthers.length > 5;
    return (
      <div className="nt-screen phone" style={vars}>
        <header className="nt-top">
          <div className={`nt-ptop${urgent ? " urgent" : ""}`} data-tutorial="prompt">
            <strong className="nt-prompt" role="status">{anim ? "亮牌中" : prompt}</strong>
            {timer}
          </div>
          <button className="quiet-button nt-menu-button" type="button" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>菜单</button>
          {menuOpen && (
            <div className="nt-menu" role="dialog" aria-label="菜单">
              {brand}
              {roundInfo}
              <div className="nt-menu-items">{menuItems}</div>
              {connection}
              <button className="quiet-button" type="button" onClick={() => setMenuOpen(false)}>关闭</button>
            </div>
          )}
        </header>
        <div className={many ? "nt-chips two" : "nt-chips"} data-tutorial="seats">
          {phoneOthers.map((player) => {
            const props2 = seatProps(player);
            return (
              <div
                key={player.id}
                className={`nt-chip${props2.active ? " active" : ""}${props2.member && !props2.member.connected ? " offline" : ""}`}
                style={{ "--seat": seatColor(player.seat), "--seat-ink": seatInk(player.seat) } as CSSProperties}
                data-player={player.id}
                data-tutorial={`seat:${player.id}`}
                title={`${player.name}：本局 ${props2.bulls}，累计 ${props2.total}`}
              >
                <div className="nt-avatar" data-avatar={player.id}>
                  <img src={avatarArt(player.seat)} alt="" width={32} height={32} />
                  {props2.status !== "idle" && (
                    <span className={`nt-status ${props2.status}`}>
                      {props2.status === "thinking" ? <i className="nt-thinking" /> : <img src={props2.status === "choosing" ? ART.lasso : ART.ready} alt="" width={16} height={16} />}
                    </span>
                  )}
                </div>
                <b className="nt-chip-bulls" data-tutorial="seat-bulls">{props2.bulls}</b>
                {props2.member?.bot ? <em className="nt-chip-badge bot" title="人机">机</em>
                  : props2.member && !props2.member.connected ? <em className="nt-chip-badge off" title="离线（人机代打）">离</em>
                  : props2.member?.auto ? <em className="nt-chip-badge auto" title="托管中">托</em> : null}
                {!many && <span className="nt-chip-name">{player.name}</span>}
              </div>
            );
          })}
        </div>
        {flashLine}
        {table}
        {autoPlaying && game.phase !== "gameOver" && (
          <div className="nt-autobar" role="status">
            <span>托管中：人机正在替你出牌</span>
            <button className="primary-button nt-big" type="button" onClick={() => onAuto(false)} data-tutorial="cancel-auto">取消托管</button>
          </div>
        )}
        <div className="nt-handbar">
          {showStrip ? strip : hand}
          <div className="nt-pbuttons">
            {!spectating && <Seat {...seatProps(me)} size="small" compact />}
            {mainButtons}
          </div>
        </div>
        {sub && !anim && <p className={preview?.bad && picked !== null ? "nt-sub phone bad" : "nt-sub phone"}>{sub}</p>}
        {spectatePanel}
        <section className="nt-below">
          <h3>玩家 <small>牛头 = 本局收到的；累计越少越好</small></h3>
          <div className="nt-player-list">
            {game.players.map((player) => <Seat key={player.id} {...seatProps(player)} size="small" />)}
          </div>
          {sidePanel}
        </section>
        {dialogs}
        {fly}
        {coachLayer}
      </div>
    );
  }

  return (
    <div className={`nt-screen ${layout.mode}`} style={vars}>
      <header className="nt-top">
        {theme === "night" && <span className="nt-lamp" aria-hidden="true" />}
        {brand}
        {roundInfo}
        <div className="nt-top-right">
          {layout.mode === "mid" && (
            <button className="quiet-button nt-drawer-button" type="button" aria-expanded={drawer} onClick={() => setDrawer(!drawer)}>记录·聊天</button>
          )}
          {menuItems}
          {connection}
        </div>
      </header>
      <div className="nt-mid">
        <div className="nt-col left" data-tutorial="seats">
          {columns.left.map((player) => <Seat key={player.id} {...seatProps(player)} size={layout.seatSize} />)}
        </div>
        {table}
        <div className="nt-col right">
          {columns.right.map((player) => <Seat key={player.id} {...seatProps(player)} size={layout.seatSize} />)}
        </div>
        {layout.sideW > 0 && <aside className="nt-side">{sidePanel}</aside>}
      </div>
      <div className="nt-handbar">
        {actionPanel}
        {showStrip ? strip : hand}
        <div className="nt-me">
          <Seat {...seatProps(me)} size={layout.meW >= 220 ? (layout.seatSize === "xl" ? "xl" : "big") : layout.handBarH >= 100 ? "medium" : "small"} />
        </div>
      </div>
      {layout.mode === "mid" && drawer && (
        <aside className="nt-drawer" aria-label="记录和聊天">
          <button className="quiet-button" type="button" onClick={() => setDrawer(false)}>收起</button>
          {sidePanel}
        </aside>
      )}
      {dialogs}
      {fly}
      {coachLayer}
    </div>
  );
}

/** 局末：每人本局牛头、累计，「继续」。 */
function RoundEndPanel({ game, myId, seconds, canContinue, busy, onContinue }: {
  game: GameState;
  myId: string;
  seconds: number | null;
  canContinue: boolean;
  busy: boolean;
  onContinue: () => void;
}) {
  const rows = [...game.players].sort((a, b) => a.total - b.total);
  const fixed = game.config.fixedRounds;
  return (
    <div className="gm-modal-backdrop nt-backdrop-light" role="presentation">
      <section className="gm-panel nt-round-end" role="dialog" aria-modal="true" aria-labelledby="nt-round-title" data-tutorial="round-end">
        <h2 id="nt-round-title">第 {game.round} 局结束</h2>
        <p className="nt-muted">{fixed !== null ? `一共 ${fixed} 局，还剩 ${Math.max(0, fixed - game.round)} 局` : `有人累计到 ${game.config.target} 分时结束；罚分越少越好`}</p>
        <table className="nt-score-table">
          <thead>
            <tr><th>玩家</th><th>本局</th><th>累计</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((player) => (
              <tr key={player.id} className={player.id === myId ? "me" : ""}>
                <td>
                  <div className="nt-who">
                    <span className="nt-mini-avatar" style={{ "--seat": seatColor(player.seat) } as CSSProperties}><img src={avatarArt(player.seat)} alt="" width={32} height={32} /></span>
                    <span className="nt-name">{player.id === myId ? `${player.name}（你）` : player.name}</span>
                  </div>
                </td>
                <td className="nt-num"><img src={ART.head16} alt="" width={16} height={16} />+{player.roundBulls}</td>
                <td className="nt-num big">{player.total}</td>
                <td>{player.ready ? <em className="nt-tag bot">已继续</em> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="gm-panel-actions">
          <span className="nt-muted">{seconds !== null ? `${seconds} 秒后自动开始下一局` : ""}</span>
          {canContinue ? (
            <button className="primary-button nt-big" type="button" disabled={busy} onClick={onContinue} data-tutorial="continue">继续</button>
          ) : (
            <span className="nt-muted">等其他人…</span>
          )}
        </div>
      </section>
    </div>
  );
}

function FinalDialog({ game, room, myId, memberId, spectating, onRematch, onLeave, actions }: {
  game: GameState;
  room: LobbyRoomSnapshot;
  myId: string;
  /** 自己在 room.members 里的 id（判断自己点没点过「再来一局」）。 */
  memberId: string;
  spectating: boolean;
  /** 练习局：替代「再来一局」的按钮。 */
  actions?: ReactNode;
  onRematch: (accept: boolean) => void;
  onLeave: () => void;
}) {
  const result = game.finalResult!;
  const accepted = room.rematch?.acceptedIds.includes(memberId) ?? false;
  const rows = [...game.players].sort((a, b) => a.total - b.total);
  const winners = result.winners.map((id) => game.players.find((player) => player.id === id)!);
  const maxTotal = Math.max(...game.players.map((player) => player.total));
  const kings = game.players.filter((player) => player.total === maxTotal && !result.winners.includes(player.id));
  const iWon = result.winners.includes(myId);
  const title = spectating
    ? `${winners.map((player) => player.name).join("、")} ${winners.length > 1 ? "并列获胜" : "获胜"}`
    : iWon ? (winners.length > 1 ? `你和${winners.filter((player) => player.id !== myId).map((player) => player.name).join("、")}并列获胜！` : "你赢了！") : `${winners.map((player) => player.name).join("、")} ${winners.length > 1 ? "并列获胜" : "获胜"}`;
  return (
    <div className="gm-modal-backdrop" role="presentation">
      <section className={`gm-panel nt-final${game.players.length > 6 ? " many" : ""}`} role="dialog" aria-modal="true" aria-labelledby="nt-final-title" data-tutorial="final">
        <div className="nt-final-head">
          <span className="nt-star"><img src={ART.star} alt="" width={64} height={64} /><i className="nt-sparkle" /></span>
          <div>
            <h2 id="nt-final-title">{title}</h2>
            <p className="nt-muted">{result.reason === "rounds" ? `打满 ${result.rounds} 局` : `有人到了 ${game.config.target} 分，共 ${result.rounds} 局`}，罚分最少的赢</p>
          </div>
          {kings.length > 0 && (
            <div className="nt-poster" title="罚分最多的人">
              <img className="nt-poster-bg" src={ART.poster} alt="" width={128} height={160} />
              <img className="nt-poster-face" src={avatarArt(kings[0]!.seat)} alt="" width={64} height={64} />
              <b>牛头王</b>
              <img className="nt-poster-king" src={ART.kingBull} alt="" width={48} height={48} />
              <span>{kings.map((player) => (player.id === myId ? "你" : player.name)).join("、")}</span>
            </div>
          )}
        </div>
        <table className="nt-score-table">
          <thead>
            <tr><th>玩家</th><th>每局牛头</th><th>累计</th></tr>
          </thead>
          <tbody>
            {rows.map((player) => (
              <tr key={player.id} className={`${player.id === myId ? "me" : ""}${result.winners.includes(player.id) ? " winner" : ""}`}>
                <td>
                  <div className="nt-who">
                    <span className="nt-mini-avatar" style={{ "--seat": seatColor(player.seat) } as CSSProperties}><img src={avatarArt(player.seat)} alt="" width={32} height={32} /></span>
                    <span className="nt-name">{player.id === myId ? `${player.name}（你）` : player.name}</span>
                    {result.winners.includes(player.id) && <img src={ART.star} alt="获胜" width={32} height={32} />}
                  </div>
                </td>
                <td className="nt-rounds">{game.history.map((round) => round.bulls[player.id] ?? 0).join(" + ")}</td>
                <td className="nt-num big">{player.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {actions ? (
          <div className="nt-rematch" data-tutorial="final-actions">
            <span>练习局打完了</span>
            <div className="gm-panel-actions">{actions}</div>
          </div>
        ) : spectating ? (
          <div className="nt-rematch">
            <span>{room.rematch ? `等玩家决定要不要再来一局（${room.rematch.acceptedIds.length}/${room.members.length} 人同意）` : "对局结束"}</span>
            <div className="gm-panel-actions"><button className="quiet-button" type="button" onClick={onLeave}>离开观战</button></div>
          </div>
        ) : room.rematch && (
          <div className="nt-rematch" data-tutorial="rematch">
            <span>再来一局？还剩 {Math.ceil(room.rematch.remainingMs / 1000)} 秒（{room.rematch.acceptedIds.length}/{room.members.length} 人同意）</span>
            <div className="gm-panel-actions">
              <button className="quiet-button" type="button" onClick={() => onRematch(false)}>离开</button>
              <button className="primary-button nt-big" type="button" disabled={accepted} onClick={() => onRematch(true)}>{accepted ? "等待其他人" : "再来一局"}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default GameBoard;
