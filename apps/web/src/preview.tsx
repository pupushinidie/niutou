/**
 * 预览页（提交进仓库，界面维护；教程、验收可以往里加场景，不要删别人的场景，也不要整个删掉）。
 * 不连服务器：用规则包的预览局面工厂造局面，渲染真正的 GameBoard / 首页 / 等候房间。在牌桌上点的动作直接在浏览器里跑引擎。
 * 生产构建只打包 index.html，不会带上它。打开：http://localhost:5188/preview.html?s=<场景>
 *
 * 参数（都可以不写）：
 *   ?s=<场景>     牌桌场景用规则包 SCENE_NAMES（opening、selectSome、selectedMine、waitingOne、midRound、reveal、chooseRow、
 *                 chooseRowOther、afterChooseRow、doubleSixth、lastHand、roundEnd、gameOver、gameOverTie、tenPlayers、
 *                 tenPlayersReveal、tactics、timeout、fixedRounds），另外有：
 *                 home（首页）、home-rooms（首页带在线牌桌）、waiting-1 / waiting-full / waiting-bots / waiting-guest / waiting-spec（等候房间）、
 *                 picked（选中一张还没确认）、pickedSixth（选中的牌会是第六张）、tenPlayersRound（10 人局局末）、tenFull（10 人、每排都快满、手牌 10 张）
 *   &n=<人数>      2–10（opening / selectSome / selectedMine / waitingOne / midRound / timeout 有效）
 *   &v=<座位>      从哪个座位看，默认 p1
 *   &bots=p2,p3   人机座位    &auto=p1  托管中    &offline=p3  离线
 *   &spec=1       观战（&all=1 观战能看手牌）
 *   &t=<毫秒>      倒计时剩余；t=none 不显示
 *   &chat=1       带几条聊天
 *   &play=1       进来就放最近一次亮牌的动画；&at=<毫秒> 把动画停在开始后这一刻（截动画中间帧）
 *   &live=1       别人由人机自动选牌、选排、点继续，可以一直玩下去
 *   &pick=<牌>    进来就选中这张手牌（只抬起，不提交）
 *   &seed=<数>     发牌种子
 *   &err=<文字>    模拟服务器拒绝了动作（看非法操作提示）
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import ReactDOM from "react-dom/client";
import {
  applyCommand,
  baselineCommand,
  botCommand,
  buildGame,
  createScene,
  createSceneRoom,
  DEFAULT_OPTIONS,
  DEFAULT_ROOM_ACCESS,
  playHand,
  redactGameForViewer,
  SCENE_NAMES,
  type Capacity,
  type GameCommand,
  type GameOptions,
  type GameState,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type PublicRoomSummary,
  type RoomChatMessage,
  type SceneName,
} from "@niutou/game";
import { Brand, ConnectionStatus, HomeScreen, RoomScreen } from "./App.js";
import { installArtVars } from "./art.js";
import { useConfirm } from "./confirm.js";
import GameBoard from "./GameBoard.js";
import RoomChat from "./RoomChat.js";
import { socket } from "./socket.js";
import { applyTheme, readTheme, ThemeToggle, useTheme } from "./theme.js";
import { useVoice } from "./voice.js";
import "./styles.css";
import "./app-pixel.css";
import "./nt-pages.css";
import "./niutou.css";
import "./theme-day.css";

applyTheme(readTheme());
installArtVars();

const params = new URLSearchParams(location.search);
const sceneName = params.get("s") ?? "opening";
const players = Math.min(10, Math.max(2, Number(params.get("n") ?? 4)));
const viewer = params.get("v") ?? (sceneName === "waiting-guest" ? "p2" : "p1");
const list = (key: string) => (params.get(key) ?? "").split(",").filter(Boolean);
const spectator = params.get("spec") === "1";
const seeAll = params.get("all") === "1";
const seed = Number(params.get("seed") ?? 20261009);
const live = params.get("live") === "1";
const play = params.get("play") === "1";
const atParam = params.get("at");
const frozenAt = atParam !== null ? Number(atParam) : undefined;
const timeParam = params.get("t");
const turnRemainingMs = timeParam === "none" ? undefined : timeParam ? Number(timeParam) : undefined;
const pickParam = params.get("pick");

Object.defineProperty(socket, "id", { get: () => (spectator ? "sock-watcher" : `sock-${viewer}`), configurable: true });
// 预览页不连服务器：发出去的房间操作直接回一个失败，界面上看得到提示。
socket.emit = ((event: string, ...args: unknown[]) => {
  const ack = args[args.length - 1];
  if (typeof ack === "function") (ack as (response: unknown) => void)({ ok: false, error: `预览页不连服务器（${event}）` });
  return socket;
}) as typeof socket.emit;
socket.connect = (() => socket) as typeof socket.connect;

const CHAT: RoomChatMessage[] = [
  { id: "c1", senderId: "sock-p2", name: "阿牛", message: "这把谁拿第六张谁请客", createdAt: "2026-10-09T20:01:00.000Z" },
  { id: "c2", senderId: "sock-p1", name: "我", message: "别再往第 2 排塞了", createdAt: "2026-10-09T20:01:30.000Z" },
  { id: "c3", senderId: "sock-watcher", name: "看客", message: "55 还没出呢", createdAt: "2026-10-09T20:02:00.000Z", spectator: true },
];

/* ---------- 额外场景（规则包的命名场景之外） ---------- */

/** 10 人局、每排 4–5 张（桌上最满的样子），第 3 手（10 人局牌刚好够）。 */
function tenFull(): GameState {
  return buildGame({
    players: Array.from({ length: 10 }, (_, index) => (index === 0 ? { include: [9, 38, 55, 66, 77, 88, 99, 103] } : index === 3 ? { taken: [1, 2, 3, 4, 5] } : {})),
    rows: [[11, 13, 15, 16], [20, 21, 22, 24, 25], [40, 41, 43, 44, 45], [60, 62, 63, 65]],
    turn: 3,
    seed,
  });
}

function buildScene(): GameState {
  if (sceneName === "tenFull") {
    // 张数和真实对局对不上（排是摆出来的），只用来看排版
    return tenFull();
  }
  if (sceneName === "tenPlayersRound") {
    let state = createScene("tenPlayersReveal", { seed });
    while (state.phase === "select") state = playHand(state, {}, 0);
    while (state.phase === "chooseRow") state = applyCommand(state, state.chooser!, { type: "chooseRow", row: 0 });
    while (state.phase === "select") state = playHand(state, {}, 0);
    return state;
  }
  if (sceneName === "picked" || sceneName === "pickedSixth") return createScene("selectSome", { players, seed });
  if ((SCENE_NAMES as readonly string[]).includes(sceneName)) return createScene(sceneName as SceneName, { players, seed });
  return createScene("opening", { players, seed });
}

/* ---------- 牌桌 ---------- */

function BoardPreview() {
  const [theme, toggleTheme] = useTheme();
  const [full, setFull] = useState<GameState>(buildScene);
  // &err=… 模拟服务器拒绝（非法操作提示）
  const [error, setError] = useState(params.get("err") ?? "");
  const [autoIds, setAutoIds] = useState(list("auto"));
  const [confirm, confirmDialog] = useConfirm();
  const room = useMemo(() => {
    const base = createSceneRoom(full, {
      viewer,
      spectator,
      seeAll,
      offline: list("offline"),
      bots: list("bots"),
      auto: autoIds,
      ...(turnRemainingMs !== undefined ? { turnRemainingMs } : {}),
    });
    const withChat = params.get("chat") === "1" ? { ...base, chat: CHAT } : base;
    return timeParam === "none" ? (({ turnRemainingMs: _drop, ...rest }) => rest)(withChat) as LobbyRoomSnapshot : withChat;
  }, [full, autoIds]);
  const voice = useVoice(room);
  const [watchId, setWatchId] = useState(full.players[0]!.id);

  function command(cmd: GameCommand, as = viewer) {
    try {
      const { step: _step, ...clean } = cmd as GameCommand & { step?: string };
      setFull((state) => applyCommand(state, as, clean as GameCommand));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  // 选中某张牌（pick=）：模拟点一下
  useEffect(() => {
    const card = pickParam ? Number(pickParam) : sceneName === "picked" || sceneName === "pickedSixth" ? pickFor(full) : null;
    if (card === null) return;
    const timer = window.setTimeout(() => {
      (document.querySelector(`[data-card="${card}"]`) as HTMLButtonElement | null)?.click();
    }, 150);
    return () => window.clearTimeout(timer);
  }, []);

  // 别人（live=1）：人机按自己能看到的信息走
  const fullRef = useRef(full);
  fullRef.current = full;
  useEffect(() => {
    if (!live || full.phase === "gameOver") return;
    const actor = full.phase === "select"
      ? full.players.find((player) => !player.selected && (player.id !== viewer || autoIds.includes(viewer)))?.id
      : full.phase === "chooseRow" ? (full.chooser !== viewer || autoIds.includes(viewer) ? full.chooser! : undefined)
      : full.players.find((player) => !player.ready && player.id !== viewer)?.id;
    if (!actor) return;
    const delay = full.reveal && !full.reveal.done ? 900 : full.events.some((event) => event.type === "Revealed" || event.type === "RowTaken") ? 6000 : 900;
    const timer = window.setTimeout(() => {
      const view = redactGameForViewer(fullRef.current, actor);
      const cmd = fullRef.current.phase === "roundEnd" ? ({ type: "nextRound" } as const) : botCommand(view, actor) ?? baselineCommand(view, actor);
      if (cmd) command(cmd, actor);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [full, autoIds]);

  return (
    <main className="app-shell nt-game">
      <GameBoard
        room={room}
        busy={false}
        error={error}
        notice=""
        brand={<Brand />}
        connection={<ConnectionStatus connected />}
        themeToggle={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
        theme={theme}
        chat={<RoomChat room={room} voice={voice} />}
        onCommand={(cmd) => command(cmd)}
        onRematch={() => setFull(buildScene())}
        onAuto={(enabled) => setAutoIds((ids) => (enabled ? [...ids, viewer] : ids.filter((id) => id !== viewer)))}
        onDissolve={() => void confirm({ title: "解散房间？", detail: "所有玩家都会被移出，当前对局也会结束。", confirmLabel: "解散" })}
        watchId={watchId}
        onWatch={setWatchId}
        onLeave={() => setError("预览页：离开观战只在真房间里有效")}
        playback={{ playOnMount: play, ...(frozenAt !== undefined ? { frozenAt } : {}) }}
      />
      {confirmDialog}
    </main>
  );
}

/** picked：挑一张安全的；pickedSixth：挑一张会成为第六张或比所有排尾都小的。 */
function pickFor(state: GameState): number | null {
  const me = state.players.find((player) => player.id === viewer)!;
  const tails = state.rows.map((row) => row[row.length - 1]!);
  for (const card of me.hand) {
    const candidates = tails.map((tail, index) => ({ tail, index })).filter((item) => item.tail < card).sort((a, b) => b.tail - a.tail);
    const row = candidates[0]?.index;
    const bad = row === undefined || state.rows[row]!.length >= 5;
    if (sceneName === "pickedSixth" ? bad : !bad) return card;
  }
  return me.hand[0] ?? null;
}

/* ---------- 首页 ---------- */

const LOBBY: PublicRoomSummary[] = [
  {
    id: "r1", status: "playing", capacity: 5, options: DEFAULT_OPTIONS, open: false, allowSpectators: true, spectators: 1,
    players: [
      { name: "阿牛", isHost: true, connected: true, score: 23, isActive: true },
      { name: "老黄", isHost: false, connected: true, score: 41 },
      { name: "咕噜一号", isHost: false, connected: true, bot: true, score: 12 },
      { name: "小花", isHost: false, connected: false, score: 30 },
      { name: "大壮", isHost: false, connected: true, score: 8 },
    ],
  },
  {
    id: "r2", status: "waiting", capacity: 8, options: { ...DEFAULT_OPTIONS, target: 33 }, open: true, allowSpectators: true, spectators: 0,
    players: [{ name: "二丫", isHost: true, connected: true }, { name: "三毛", isHost: false, connected: true }],
  },
  {
    id: "r3", status: "finished", capacity: 3, options: DEFAULT_OPTIONS, open: false, allowSpectators: true, spectators: 0,
    players: [{ name: "四喜", isHost: true, connected: true, score: 31, isWinner: true }, { name: "五福", isHost: false, connected: true, score: 70 }, { name: "咕噜二号", isHost: false, connected: true, bot: true, score: 45 }],
  },
];

function HomePreview() {
  const [theme, toggleTheme] = useTheme();
  const [name, setName] = useState("小明");
  const [mode, setMode] = useState<"create" | "join">("create");
  const [capacity, setCapacity] = useState<Capacity>(4);
  const [options, setOptions] = useState<GameOptions>(DEFAULT_OPTIONS);
  const [code, setCode] = useState("");
  const [confirm, confirmDialog] = useConfirm();
  return (
    <>
      <HomeScreen
        theme={theme}
        themeToggle={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
        connected
        mode={mode}
        onMode={setMode}
        name={name}
        onName={setName}
        capacity={capacity}
        onCapacity={setCapacity}
        options={options}
        onOptions={(patch) => setOptions({ ...options, ...patch })}
        roomCode={code}
        onRoomCode={(value) => setCode(value.toUpperCase().slice(0, 6))}
        canSubmit={name.trim().length >= 2}
        busy={false}
        error=""
        notice=""
        onSubmit={(event: FormEvent<HTMLFormElement>) => event.preventDefault()}
        lobbyRooms={sceneName === "home-rooms" ? LOBBY : []}
        onJoinListed={() => undefined}
        confirm={confirm}
      />
      {confirmDialog}
    </>
  );
}

/* ---------- 等候房间 ---------- */

const NAMES = ["我", "阿牛", "小花", "老黄", "大壮", "二丫", "三毛", "四喜", "五福", "六顺"];

function waitingRoom(): LobbyRoomSnapshot {
  const kind = sceneName.slice("waiting-".length);
  const capacity = (kind === "full" ? 10 : kind === "1" ? 4 : kind === "bots" ? 6 : players) as Capacity;
  const seats = kind === "1" ? 1 : kind === "full" ? 10 : kind === "bots" ? 4 : kind === "spec" ? 3 : 2;
  let botNo = 0;
  const members: LobbyMember[] = Array.from({ length: seats }, (_, index) => {
    const bot = (kind === "bots" && index > 0) || (kind === "full" && index >= 7);
    return {
      id: `sock-p${index + 1}`,
      playerId: `p${index + 1}`,
      name: bot ? `咕噜${["一", "二", "三", "四", "五", "六", "七", "八", "九"][botNo++]}号` : NAMES[index]!,
      isHost: index === 0,
      connected: !(kind === "full" && index === 4),
      ...(bot ? { bot: true } : {}),
    };
  });
  return {
    code: kind === "spec" ? "" : "NTW688",
    spectators: kind === "full" || kind === "spec" ? [{ id: "sock-watcher", name: "看客" }] : [],
    access: { ...DEFAULT_ROOM_ACCESS, ...(kind === "full" ? { open: true } : {}) },
    options: kind === "full" ? { target: 66, fixedRounds: 3, tactics: true } : DEFAULT_OPTIONS,
    capacity,
    status: "waiting",
    members,
    chat: params.get("chat") === "1" ? CHAT : [],
    voice: [],
  };
}

function RoomPreview() {
  const [theme, toggleTheme] = useTheme();
  const [room, setRoom] = useState(waitingRoom);
  const voice = useVoice(room);
  const [confirm, confirmDialog] = useConfirm();
  return (
    <>
      <RoomScreen
        room={room}
        busy={false}
        error=""
        notice=""
        connected
        themeToggle={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
        chat={<RoomChat room={room} voice={voice} />}
        onCopyCode={() => undefined}
        onLeave={() => undefined}
        onStart={() => undefined}
        onKick={() => undefined}
        onAddBot={() => undefined}
        onDissolve={() => void confirm({ title: "解散房间？", detail: "所有玩家都会被移出，当前对局也会结束。", confirmLabel: "解散" })}
        onOptions={(patch) => setRoom((current) => ({ ...current, options: { ...current.options, ...patch } }))}
      />
      {confirmDialog}
    </>
  );
}

function Preview() {
  if (sceneName.startsWith("home")) return <HomePreview />;
  if (sceneName.startsWith("waiting")) {
    if (sceneName === "waiting-spec") Object.defineProperty(socket, "id", { get: () => "sock-watcher", configurable: true });
    return <RoomPreview />;
  }
  return <BoardPreview />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Preview />);
