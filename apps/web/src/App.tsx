import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import {
  CAPACITY_OPTIONS,
  DEFAULT_OPTIONS,
  OPTION_LIMITS,
  type Capacity,
  type GameCommand,
  type GameOptions,
  type LobbyRoomSnapshot,
  type PublicRoomSummary,
} from "@niutou/game";
import { ART, avatarArt, cardStyle, seatColor } from "./art.js";
import { useConfirm } from "./confirm.js";
import GameBoard from "./GameBoard.js";
import GameRules from "./GameRules.js";
import OnlineRooms from "./OnlineRooms.js";
import RoomChat from "./RoomChat.js";
import { roomRole, RoomSettingsPanel, SeatSwitch } from "./RoomExtras.js";
import { socket } from "./socket.js";
import { ThemeToggle, useTheme, type Theme } from "./theme.js";
import { TutorialInvite } from "./tutorial/Invite.js";
import { readTutorial } from "./tutorial/storage.js";
import { GAME_ID } from "./tutorial/tutorialGame.js";
import TutorialMode from "./tutorial/TutorialMode.js";
import { useVoice } from "./voice.js";

type EntryMode = "create" | "join";

const validRoomCode = /^[A-HJ-NP-Z2-9]{6}$/;

// 线上游戏中心在站点根路径；本地开发时跑在 5175 端口。
const CENTER_URL = import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:5175/` : "/";

function normalizeRoomCode(value: string): string {
  return value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 6);
}

/** 同一局里版本更低的快照是旧的（再来一局后 game 换了一局，版本从头算，不算旧）。 */
function isStale(next: LobbyRoomSnapshot, current: LobbyRoomSnapshot | null): boolean {
  const a = next.game;
  const b = current?.game;
  if (!a || !b || next.code !== current?.code) return false;
  if (a.version >= b.version) return false;
  // 新开的一局：版本一下子变得很小
  return a.version + 10 > b.version;
}

type Confirm = (request: { title: string; detail: string; confirmLabel: string }) => Promise<boolean>;

function App() {
  const [mode, setMode] = useState<EntryMode>("create");
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState<Capacity>(4);
  const [options, setOptions] = useState<GameOptions>(DEFAULT_OPTIONS);
  const [confirmAction, confirmDialog] = useConfirm();
  // 白天 / 夜间画面：首页、等候房间、牌桌共用，顶栏按钮随时切换；和游戏中心、其他游戏共用同一个选择。
  const [theme, toggleTheme] = useTheme();
  const themeToggle = <ThemeToggle theme={theme} onToggle={toggleTheme} />;
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState<LobbyRoomSnapshot | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lobbyRooms, setLobbyRooms] = useState<PublicRoomSummary[]>([]);
  // 观战时从谁的座位看（默认第一位玩家）。
  const [watchId, setWatchId] = useState("");
  const voice = useVoice(room);
  // 新手教程：首页或等候房间点进来（地址带 ?tutorial 时直接打开，游戏中心可以直接链过来）
  const [tutorialOpen, setTutorialOpen] = useState(() => new URLSearchParams(window.location.search).has("tutorial"));
  function closeTutorial() {
    setTutorialOpen(false);
    const params = new URLSearchParams(window.location.search);
    if (params.has("tutorial")) {
      params.delete("tutorial");
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    }
  }
  // 在等候房间里看教程时，房主一开局就回到牌桌（不然这一步会超时、转成托管）
  useEffect(() => {
    if (tutorialOpen && room?.status === "playing") {
      closeTutorial();
      setNotice("对局开始了，教程先停在这里。");
    }
  }, [tutorialOpen, room?.status]);

  // 在房间里时服务端不推送在线牌桌列表；回到首页时主动拉一次最新的。
  useEffect(() => {
    if (room || !socket.connected) return;
    socket.emit("lobby:get", (response) => {
      if (response.ok) setLobbyRooms(response.data);
    });
  }, [room === null]);

  // 断线重连：新连接服务器不认识，用原昵称和房间码重新加入，回到自己的座位（服务器重启、房间没了就回首页说明原因）
  const seatRef = useRef<{ name: string; code: string } | null>(null);
  const roomRef = useRef<LobbyRoomSnapshot | null>(null);
  roomRef.current = room;
  const wasDisconnected = useRef(false);
  useEffect(() => {
    const handleConnect = () => {
      setConnected(true);
      socket.emit("lobby:get", (response) => {
        if (response.ok) setLobbyRooms(response.data);
      });
      if (!wasDisconnected.current || !roomRef.current) return;
      wasDisconnected.current = false;
      const seat = seatRef.current;
      if (!seat || !seat.code) {
        setRoom(null);
        setNotice("连接断了一下，请重新进入房间。");
        return;
      }
      socket.emit("room:join", { name: seat.name, code: seat.code }, (response) => {
        if (response.ok) {
          setRoom(response.data);
          setNotice("连接断了一下，已经回到座位。");
        } else {
          setRoom(null);
          setNotice(`连接断开期间房间没了：${response.error}`);
        }
      });
    };
    const handleDisconnect = () => {
      setConnected(false);
      wasDisconnected.current = true;
    };
    const handleRoomUpdate = (snapshot: LobbyRoomSnapshot) => setRoom((current) => (isStale(snapshot, current) ? current : snapshot));
    const handleRoomError = (message: string) => setError(message);
    const handleLobbyUpdate = (rooms: PublicRoomSummary[]) => setLobbyRooms(rooms);
    const handleRoomClosed = ({ reason }: { reason: string }) => {
      setRoom(null);
      setBusy(false);
      setError("");
      setNotice(reason);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("room:updated", handleRoomUpdate);
    socket.on("room:error", handleRoomError);
    socket.on("lobby:updated", handleLobbyUpdate);
    socket.on("room:closed", handleRoomClosed);
    socket.connect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("room:updated", handleRoomUpdate);
      socket.off("room:error", handleRoomError);
      socket.off("lobby:updated", handleLobbyUpdate);
      socket.off("room:closed", handleRoomClosed);
      socket.disconnect();
    };
  }, []);

  const canSubmit = useMemo(() => {
    if (!connected || busy || name.trim().length < 2 || name.trim().length > 18) return false;
    return mode === "create" || validRoomCode.test(roomCode);
  }, [busy, connected, mode, name, roomCode]);

  /** 从首页列表加入空座位或进去观战（用上面填的昵称）。 */
  function joinListed(roomId: string, spectate: boolean) {
    const nickname = name.trim();
    if (nickname.length < 2 || nickname.length > 18) {
      setNotice("");
      setError("先在上面填好你的昵称（2–18 个字符）。");
      document.getElementById("player-name")?.focus();
      return;
    }
    setError("");
    setNotice("");
    setBusy(true);
    socket.emit("room:join", { name: nickname, roomId, spectate }, (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
      seatRef.current = { name: nickname, code: response.data.code };
      setNotice(spectate ? "正在观战。" : "已加入房间。");
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    const nickname = name.trim();

    const complete = (response: { ok: true; data: LobbyRoomSnapshot } | { ok: false; error: string }) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
      seatRef.current = { name: nickname, code: response.data.code };
      setNotice(mode === "create"
        ? "房间已创建，可以邀请朋友加入。"
        : response.data.status === "playing" ? "已回到对局，继续游戏吧。" : "已加入房间。");
    };

    if (mode === "create") {
      socket.emit("room:create", { name: nickname, capacity, options }, complete);
    } else {
      socket.emit("room:join", { name: nickname, code: roomCode }, complete);
    }
  }

  function startGame() {
    setError("");
    setBusy(true);
    socket.emit("room:start", (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
      setNotice("");
    });
  }

  function leaveRoom() {
    setBusy(true);
    socket.emit("room:leave", (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(null);
      setError("");
      setNotice("已离开房间。");
    });
  }

  function submitGameCommand(command: GameCommand) {
    setBusy(true);
    setError("");
    setNotice("");
    socket.emit("game:command", command, (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      // 回执里的房间可能比已经收到的广播旧（人机在这期间又动了一步）：旧的不要盖掉新的
      setRoom((current) => (isStale(response.data, current) ? current : response.data));
    });
  }

  /** 房间管理类操作：只关心成败，界面更新由服务端广播。 */
  function roomCommand(send: (ack: (response: { ok: true; data: void } | { ok: false; error: string }) => void) => void) {
    setError("");
    send((response) => {
      if (!response.ok) setError(response.error);
    });
  }

  const kickMember = (memberId: string) => roomCommand((ack) => socket.emit("room:kick", memberId, ack));
  const addBot = () => roomCommand((ack) => socket.emit("room:add-bot", ack));
  const setAuto = (enabled: boolean) => roomCommand((ack) => socket.emit("room:auto", enabled, ack));
  const voteRematch = (accept: boolean) => roomCommand((ack) => socket.emit("room:rematch", accept, ack));
  const changeOptions = (patch: Partial<GameOptions>) => roomCommand((ack) => socket.emit("room:options", patch, ack));
  async function dissolveRoom() {
    const ok = await confirmAction({
      title: "解散房间？",
      detail: "所有玩家都会被移出，当前对局也会结束。",
      confirmLabel: "解散",
    });
    if (ok) roomCommand((ack) => socket.emit("room:dissolve", ack));
  }

  async function copyRoomCode() {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.code);
      setNotice("房间码已复制。");
    } catch {
      setNotice("请手动复制房间码。");
    }
  }

  if (tutorialOpen && room?.status !== "playing") {
    return (
      <main className="app-shell nt-game tut-on">
        <TutorialMode name={name} brand={<Brand />} themeToggle={themeToggle} theme={theme} waitingRoom={room?.code} onExit={closeTutorial} />
        {confirmDialog}
      </main>
    );
  }

  if (room?.status === "playing" && room.game) {
    const players = room.game.players;
    const watched = players.some((player) => player.id === watchId) ? watchId : players[0]!.id;
    return (
      <main className="app-shell nt-game">
        <GameBoard
          room={room}
          busy={busy}
          error={error}
          notice={notice}
          brand={<Brand />}
          connection={<ConnectionStatus connected={connected} />}
          themeToggle={themeToggle}
          theme={theme}
          chat={<RoomChat room={room} voice={voice} />}
          onCommand={submitGameCommand}
          onRematch={voteRematch}
          onAuto={setAuto}
          onDissolve={dissolveRoom}
          watchId={watched}
          onWatch={setWatchId}
          onLeave={leaveRoom}
        />
        {confirmDialog}
      </main>
    );
  }

  if (room) {
    return (
      <>
        <RoomScreen
          room={room}
          busy={busy}
          error={error}
          notice={notice}
          connected={connected}
          themeToggle={themeToggle}
          chat={<RoomChat room={room} voice={voice} />}
          onCopyCode={copyRoomCode}
          onLeave={leaveRoom}
          onStart={startGame}
          onKick={kickMember}
          onAddBot={addBot}
          onDissolve={dissolveRoom}
          onOptions={changeOptions}
          tutorialEntry={
            <TutorialInvite
              record={readTutorial(GAME_ID)}
              title="等人的时候，先学一下？"
              text="咕噜嘎带你在真牌桌上打几手，不会离开房间，房主一开局就自动回来。"
              again="再看一遍新手教程"
              onOpen={() => setTutorialOpen(true)}
            />
          }
        />
        {confirmDialog}
      </>
    );
  }

  return (
    <>
      <HomeScreen
        theme={theme}
        themeToggle={themeToggle}
        connected={connected}
        mode={mode}
        onMode={(next) => { setMode(next); setError(""); }}
        name={name}
        onName={setName}
        capacity={capacity}
        onCapacity={setCapacity}
        options={options}
        onOptions={(patch) => setOptions({ ...options, ...patch })}
        roomCode={roomCode}
        onRoomCode={(value) => setRoomCode(normalizeRoomCode(value))}
        canSubmit={canSubmit}
        busy={busy}
        error={error}
        notice={notice}
        onSubmit={handleSubmit}
        lobbyRooms={lobbyRooms}
        onJoinListed={joinListed}
        confirm={confirmAction}
        tutorialEntry={
          <TutorialInvite
            record={readTutorial(GAME_ID)}
            title="第一次玩？3 分钟学会"
            text="咕噜嘎在真牌桌上带你打几手，学完和人机练一局。"
            again="再看一遍新手教程"
            onOpen={() => setTutorialOpen(true)}
          />
        }
      />
      {confirmDialog}
    </>
  );
}

export function Brand() {
  return (
    <a className="brand" href={import.meta.env.BASE_URL} aria-label="谁是牛头王首页">
      <img className="nt-brand-icon" src={ART.head32} alt="" width={32} height={32} />
      <span className="brand-name">谁是牛头王</span>
    </a>
  );
}

export function ConnectionStatus({ connected }: { connected: boolean }) {
  return (
    <div className={connected ? "connection-status online" : "connection-status"}>
      <span className="connection-dot" />
      {connected ? "已连接" : "连接中…"}
    </div>
  );
}

/** 五种牛头数的牌（首页、等候房间的「牌一览」）。 */
export function CardKinds() {
  const kinds: [number, string][] = [[7, "1"], [25, "2"], [30, "3"], [44, "5"], [55, "7"]];
  return (
    <div className="nt-kinds" aria-label="牌一览：牛头越多罚得越多">
      {kinds.map(([card, bulls]) => (
        <figure key={card}>
          <span className="nt-card" style={cardStyle(card, { set: "sm", scale: 2 })} role="img" aria-label={`${card}：${bulls} 个牛头`} />
          <figcaption><img src={ART.head16} alt="" width={16} height={16} />×{bulls}</figcaption>
        </figure>
      ))}
    </div>
  );
}

/* ---------- 首页 ---------- */

export function HomeScreen(props: {
  theme: Theme;
  themeToggle: ReactNode;
  connected: boolean;
  mode: EntryMode;
  onMode: (mode: EntryMode) => void;
  name: string;
  onName: (name: string) => void;
  capacity: Capacity;
  onCapacity: (capacity: Capacity) => void;
  options: GameOptions;
  onOptions: (patch: Partial<GameOptions>) => void;
  roomCode: string;
  onRoomCode: (code: string) => void;
  canSubmit: boolean;
  busy: boolean;
  error: string;
  notice: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  lobbyRooms: PublicRoomSummary[];
  onJoinListed: (roomId: string, spectate: boolean) => void;
  confirm: Confirm;
  /** 新手教程入口（邀请卡或「再看一遍」小按钮）。 */
  tutorialEntry?: ReactNode;
}) {
  const { mode, busy } = props;
  return (
    <main className="app-shell nt-page nt-home-page">
      <header className="topbar nt-pagebar">
        <Brand />
        <div className="topbar-right">
          <a className="center-link" href={CENTER_URL}>← 游戏中心</a>
          <GameRules />
          {props.themeToggle}
          <ConnectionStatus connected={props.connected} />
        </div>
      </header>

      <div className="nt-home">
        <section className="nt-home-hero">
          <div className="nt-hero-art" role="img" aria-label="西部酒馆的牌桌">
            <h1>谁是牛头王</h1>
          </div>
          <p className="nt-lead">
            每人 10 张数字牌，大家<b>同时</b>扣一张，亮牌后从小到大接进桌上 4 排。
            谁的牌成了一排的<b>第六张</b>，就得把前 5 张收走；收到的牛头都是罚分，<b>罚分最少</b>的人赢。
          </p>
          <div className="nt-home-facts">
            <span>2–10 人</span><span>一局约 20 分钟</span><span>人不够可以加人机</span>
          </div>
          <CardKinds />
          {props.tutorialEntry}
        </section>

        <section className="entry-card nt-entry" aria-labelledby="entry-title">
          <div className="entry-card-heading">
            <h2 id="entry-title">进入牌桌</h2>
          </div>

          <div className="mode-switch" role="tablist" aria-label="选择房间操作">
            <button className={mode === "create" ? "mode-tab active" : "mode-tab"} type="button" role="tab" aria-selected={mode === "create"} onClick={() => props.onMode("create")}>
              创建房间
            </button>
            <button className={mode === "join" ? "mode-tab active" : "mode-tab"} type="button" role="tab" aria-selected={mode === "join"} onClick={() => props.onMode("join")}>
              加入房间
            </button>
          </div>

          <form className="entry-form" onSubmit={props.onSubmit}>
            <label className="field-label" htmlFor="player-name">你的昵称</label>
            <input
              id="player-name"
              className="text-input"
              value={props.name}
              onChange={(event) => props.onName(event.target.value)}
              placeholder="输入 2–18 个字符"
              minLength={2}
              maxLength={18}
              autoComplete="nickname"
              required
            />

            {mode === "create" ? (
              <>
                <label className="field-label field-label-spaced" htmlFor="room-capacity">房间人数</label>
                <div className="nt-capacity" id="room-capacity" role="group" aria-label="选择房间人数">
                  {CAPACITY_OPTIONS.map((seats) => (
                    <button
                      key={seats}
                      type="button"
                      className={props.capacity === seats ? "capacity-option selected" : "capacity-option"}
                      aria-pressed={props.capacity === seats}
                      onClick={() => props.onCapacity(seats)}
                    >
                      <strong>{seats}</strong>
                    </button>
                  ))}
                </div>
                <label className="field-label field-label-spaced">开房选项 <small className="nt-muted">都可以不动</small></label>
                <OptionsEditor options={props.options} editable onChange={props.onOptions} />
              </>
            ) : (
              <>
                <label className="field-label field-label-spaced" htmlFor="room-code">房间码</label>
                <input
                  id="room-code"
                  className="text-input room-code-input"
                  value={props.roomCode}
                  onChange={(event) => props.onRoomCode(event.target.value)}
                  placeholder="例如：7KQ2TX"
                  autoComplete="off"
                  maxLength={6}
                  required
                />
                <p className="field-hint">6 位字母或数字。掉线了用原昵称和房间码进来，会回到自己的座位。</p>
              </>
            )}

            {props.error && <p className="feedback feedback-error" role="alert">{props.error}</p>}
            {props.notice && <p className="feedback feedback-success" role="status">{props.notice}</p>}

            <button className="primary-button nt-entry-submit" type="submit" disabled={!props.canSubmit}>
              {busy ? <><span className="spinner" /> 正在连接</> : mode === "create" ? "创建房间" : "加入牌桌"}
            </button>
          </form>
        </section>

        <div className="nt-home-rooms">
          <OnlineRooms rooms={props.lobbyRooms} connected={props.connected} busy={busy} onJoin={props.onJoinListed} confirm={props.confirm} />
        </div>
      </div>
    </main>
  );
}

/* ---------- 等候房间 ---------- */

export function RoomScreen({ room, busy, error, notice, connected, themeToggle, chat, onCopyCode, onLeave, onStart, onKick, onAddBot, onDissolve, onOptions, tutorialEntry }: {
  room: LobbyRoomSnapshot;
  busy: boolean;
  error: string;
  notice: string;
  connected: boolean;
  themeToggle: ReactNode;
  chat: ReactNode;
  onCopyCode: () => void;
  onLeave: () => void;
  onStart: () => void;
  onKick: (memberId: string) => void;
  onAddBot: () => void;
  onDissolve: () => void;
  onOptions: (patch: Partial<GameOptions>) => void;
  /** 新手教程入口（观战的人不显示）。 */
  tutorialEntry?: ReactNode;
}) {
  const { isHost, spectating } = roomRole(room);
  const openSeats = Math.max(0, room.capacity - room.members.length);
  const two = room.capacity > 5;

  return (
    <main className="app-shell nt-page nt-room-page">
      <header className="topbar nt-pagebar">
        <Brand />
        <div className="topbar-right">
          <GameRules />
          {themeToggle}
          <ConnectionStatus connected={connected} />
        </div>
      </header>

      <div className="nt-room">
        <section className="nt-room-info">
          <div className="room-panel nt-code-panel">
            <div className="panel-label">{spectating ? "你在观战" : room.status === "waiting" ? "牌桌准备中" : "马上开始"}</div>
            {room.code ? (
              <button className="room-code-display" type="button" onClick={onCopyCode} title="复制房间码" data-tutorial="room-code">
                {room.code}<span aria-hidden="true">⧉</span>
              </button>
            ) : (
              <div className="room-code-caption">从首页列表进来观战，看不到房间码</div>
            )}
            <div className="room-code-caption">{room.code ? "点一下复制，发给朋友" : ""}</div>
            <div className="nt-room-buttons">
              {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve} disabled={busy}>解散房间</button>}
              <button className="quiet-button" type="button" onClick={onLeave} disabled={busy || (room.status === "playing" && !spectating)}>
                {spectating ? "离开观战" : "离开房间"}
              </button>
            </div>
          </div>
          <div className="room-panel nt-options-panel">
            <div className="panel-label">开房选项 <span>{isHost ? "开局前房主可以改" : "只有房主能改"}</span></div>
            <OptionsEditor options={room.options} editable={isHost} onChange={onOptions} />
            <RoomSettingsPanel room={room} />
          </div>
        </section>

        <section className="room-panel nt-room-players" data-tutorial="room-players">
          <div className="panel-topline">
            <div className="panel-label">玩家 <span>{room.members.length} / {room.capacity}</span></div>
            <span className="waiting-pill"><i /> 等待中</span>
          </div>
          <div className={two ? "nt-seat-grid two" : "nt-seat-grid"}>
            {room.members.map((member, index) => (
              <div className="nt-room-seat" key={member.id} style={{ "--seat": seatColor(index) } as CSSProperties}>
                <span className="nt-mini-avatar"><img src={avatarArt(index)} alt="" width={32} height={32} /></span>
                <div className="nt-room-seat-name">
                  <strong>{member.name}</strong>
                  <span>
                    {member.id === socket.id && <em className="nt-tag you">你</em>}
                    {member.isHost && <em className="nt-tag">房主</em>}
                    {member.bot && <em className="nt-tag bot">人机</em>}
                    {!member.connected && !member.bot && <em className="nt-tag warn">离线</em>}
                  </span>
                </div>
                {isHost && !member.isHost && (
                  <button className="kick-button" type="button" onClick={() => onKick(member.id)} title={`把 ${member.name} 移出房间`}>移出</button>
                )}
              </div>
            ))}
            {Array.from({ length: openSeats }, (_, index) => (
              <div className="nt-room-seat open" key={`open-${index}`}>
                <span className="empty-avatar"><span>＋</span></span>
                <div className="nt-room-seat-name"><strong>空座位</strong><span>{room.access.open ? "公开房间" : "等朋友加入"}</span></div>
                {isHost && <button className="quiet-button add-bot-button" type="button" onClick={onAddBot} disabled={busy} data-tutorial="add-bot">加人机</button>}
              </div>
            ))}
          </div>
          <SeatSwitch room={room} />
          <div className="nt-start">
            {isHost ? (
              <button className="primary-button nt-start-button" type="button" onClick={onStart} disabled={busy || room.members.length < 2} data-tutorial="start">
                {busy ? <><span className="spinner" /> 正在开始</> : "开始对局"}
              </button>
            ) : (
              <div className="host-wait-note"><span className="pulse-dot" /> {spectating ? "等房主开始，开始后在这里观战" : "等房主开始对局"}</div>
            )}
            <p className="field-hint">
              {isHost && room.members.length < 2 ? `还差 ${2 - room.members.length} 位玩家，可以点空座位上的「加人机」。` : "选牌 30 秒、挑排 20 秒；超时系统替你出，连续 2 次转托管。"}
            </p>
          </div>
          {error && <p className="feedback feedback-error" role="alert">{error}</p>}
          {notice && !error && <p className="feedback feedback-success" role="status">{notice}</p>}
        </section>

        <section className="nt-room-side">
          {!spectating && tutorialEntry}
          <div className="room-panel nt-room-kinds">
            <div className="panel-label">牌一览 <span>牛头越多罚得越多</span></div>
            <CardKinds />
          </div>
          <div className="nt-room-chat">{chat}</div>
        </section>
      </div>
    </main>
  );
}

/** 开房选项：目标分、固定局数、战术模式（开工拍板：三个都做，默认关）。 */
export function OptionsEditor({ options, editable, onChange }: {
  options: GameOptions;
  editable: boolean;
  onChange: (patch: Partial<GameOptions>) => void;
}) {
  const clampTarget = (value: number) => Math.min(OPTION_LIMITS.target.max, Math.max(OPTION_LIMITS.target.min, Math.round(value)));
  const clampRounds = (value: number) => Math.min(OPTION_LIMITS.fixedRounds.max, Math.max(OPTION_LIMITS.fixedRounds.min, Math.round(value)));
  const fixed = options.fixedRounds !== null;
  return (
    <div className="nt-options" data-tutorial="room-options">
      <div className="nt-option">
        <span className="nt-option-name">结束条件</span>
        <div className="nt-option-choices">
          <button type="button" className={!fixed ? "room-setting on" : "room-setting"} aria-pressed={!fixed} disabled={!editable} onClick={() => onChange({ fixedRounds: null })}>
            <i aria-hidden="true" />到目标分
          </button>
          <button type="button" className={fixed ? "room-setting on" : "room-setting"} aria-pressed={fixed} disabled={!editable} onClick={() => onChange({ fixedRounds: options.fixedRounds ?? 3 })}>
            <i aria-hidden="true" />固定局数
          </button>
        </div>
      </div>
      <div className="nt-option">
        <span className="nt-option-name">{fixed ? "打几局" : "目标分"}</span>
        <div className="nt-stepper">
          <button type="button" className="quiet-button" disabled={!editable} aria-label="减少"
            onClick={() => (fixed ? onChange({ fixedRounds: clampRounds(options.fixedRounds! - 1) }) : onChange({ target: clampTarget(options.target - 11) }))}>−</button>
          <input
            type="number"
            className="text-input"
            aria-label={fixed ? "固定局数" : "目标分"}
            min={fixed ? OPTION_LIMITS.fixedRounds.min : OPTION_LIMITS.target.min}
            max={fixed ? OPTION_LIMITS.fixedRounds.max : OPTION_LIMITS.target.max}
            value={fixed ? options.fixedRounds! : options.target}
            disabled={!editable}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (!Number.isFinite(value) || value <= 0) return;
              if (fixed) onChange({ fixedRounds: clampRounds(value) });
              else onChange({ target: clampTarget(value) });
            }}
          />
          <button type="button" className="quiet-button" disabled={!editable} aria-label="增加"
            onClick={() => (fixed ? onChange({ fixedRounds: clampRounds(options.fixedRounds! + 1) }) : onChange({ target: clampTarget(options.target + 11) }))}>＋</button>
          <small className="nt-muted">{fixed ? "局，打满就结束" : "分，有人到了就结束"}</small>
        </div>
      </div>
      <div className="nt-option">
        <span className="nt-option-name">战术模式</span>
        <button type="button" className={options.tactics ? "room-setting on" : "room-setting"} aria-pressed={options.tactics} disabled={!editable} onClick={() => onChange({ tactics: !options.tactics })}
          title="只用 1 到「人数×10+4」号牌，每张都会出，可以算牌">
          <i aria-hidden="true" />{options.tactics ? "开：只用 1 到 人数×10+4" : "关"}
        </button>
      </div>
    </div>
  );
}

export default App;
