/**
 * 谁是牛头王的新手教程：在浏览器里按剧本（packages/game/src/tutorial.ts）走前 5 手，
 * 牌桌就是真正对局的 GameBoard，咕噜嘎的对话框叠在上面；剧本走完接着把这局打完（练习局），两个咕噜交给人机。
 * 不连服务器，不占房间；首页、等候房间都能进来（从等候房间进来时，房主开局会自动回到牌桌，见 App.tsx）。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ANIMATION,
  animationMs,
  anchorCandidates,
  apply,
  botCommand,
  createPracticeGame,
  createRng,
  createTutorialGame,
  DEFAULT_ROOM_ACCESS,
  redactGameForViewer,
  sameMove,
  selfCanAct,
  TUTORIAL_BOT_OPTIONS,
  TUTORIAL_BOTS,
  TUTORIAL_SELF,
  TUTORIAL_STEPS,
  tutorialActor,
  type GameCommand,
  type GameState,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type Rng,
  type TutorialMove,
  type TutorialStep,
} from "@niutou/game";
import { sfx } from "../gm-sound.js";
import GameBoard from "../GameBoard.js";
import { Coach, isTouchDevice, StepPips, type CoachView } from "./Coach.js";
import { writeTutorial } from "./storage.js";
import { GAME_ID } from "./tutorialGame.js";
import { useTutorial } from "./useTutorial.js";
import "./tutorial-niutou.css";

const SELF_MEMBER = "tutorial-self";
/** 房间码只用来按哈希挑背景图。 */
const TUTORIAL_CODE = "GULU01";

const randomSeed = () => Math.floor(Math.random() * 2 ** 32);

/** 每一课（带 lesson 的步骤）从第几步开始。 */
const LESSONS = TUTORIAL_STEPS.map((step, at) => ({ step, at })).filter(({ step }) => step.lesson);

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function visible(anchor: string): boolean {
  const element = document.querySelector(`[data-tutorial="${anchor}"]`);
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * 亮牌动画放着的时候不说话（对话框会挡住飞牌，压暗也会把动画盖住）：
 * 按引擎的动画节奏（翻牌 + 每张接上去 + 每次收牌）算出这次动画多长，放完再让咕噜嘎开口。
 */
function useRevealHold(game: GameState): boolean {
  const reveal = game.reveal;
  const key = reveal ? `${reveal.id}:${reveal.steps.length}` : "";
  const seen = useRef({ id: reveal?.id ?? -1, steps: reveal?.steps.length ?? 0 });
  const [until, setUntil] = useState(0);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!reveal) {
      seen.current = { id: -1, steps: 0 };
      return;
    }
    const isNew = reveal.id !== seen.current.id;
    const from = isNew ? 0 : seen.current.steps;
    if (!isNew && reveal.steps.length <= from) return;
    seen.current = { id: reveal.id, steps: reveal.steps.length };
    if (reducedMotion()) return;
    let ms = isNew ? ANIMATION.flipMs : 0;
    for (const item of reveal.steps.slice(from)) ms += item.kind === "place" ? ANIMATION.placeMs : ANIMATION.takeMs;
    setUntil(performance.now() + ms + 400);
  }, [key]);
  useEffect(() => {
    const left = until - performance.now();
    if (left <= 0) return;
    const timer = window.setTimeout(() => setTick((value) => value + 1), left + 20);
    return () => window.clearTimeout(timer);
  }, [until]);
  return performance.now() < until;
}

/**
 * 这一步实际高亮哪个锚点（看页面上有什么）：
 * - 两步操作（then）：选中那张牌 / 那一排以后，高亮挪到「确认」；
 * - 锚点写成数组：按顺序挑页面上看得见的第一个（手机上「第几局」收在菜单里）。
 * 换了一步、还没找到之前返回 undefined（这时不画对话框，免得在旧位置闪一下）。
 */
function useStepAnchor(step: TutorialStep | undefined, version: number): string | null | undefined {
  const [found, setFound] = useState<{ id: string; anchor: string | null } | null>(null);
  useEffect(() => {
    if (!step) return;
    const candidates = anchorCandidates(step);
    if (candidates.length === 0) {
      setFound({ id: step.id, anchor: null });
      return;
    }
    const resolve = () => {
      let next = candidates.find(visible) ?? candidates[0]!;
      if (step.then) {
        const element = document.querySelector(`[data-tutorial="${candidates[0]}"]`);
        if (element?.classList.contains("picked") && visible(step.then)) next = step.then;
      }
      setFound((old) => (old && old.id === step.id && old.anchor === next ? old : { id: step.id, anchor: next }));
    };
    resolve();
    const timer = window.setInterval(resolve, 150);
    return () => window.clearInterval(timer);
  }, [step?.id, version]);
  if (!step) return null;
  return found && found.id === step.id ? found.anchor : undefined;
}

export default function TutorialMode({ name, brand, themeToggle, theme, waitingRoom, onExit }: {
  /** 首页填过的昵称；没填叫「新玩家」。 */
  name: string;
  brand: ReactNode;
  themeToggle: ReactNode;
  theme: "day" | "night";
  /** 从等候房间点进来的：那个房间的房间码。 */
  waitingRoom?: string | undefined;
  onExit: () => void;
}) {
  const selfName = name.trim().length >= 2 ? name.trim() : "新玩家";
  // 剧本前 5 手不用随机数；剧本走完接着打，第 2 局起发牌用它
  const rng = useRef<Rng | null>(null);
  if (!rng.current) rng.current = createRng(randomSeed());

  const tutorial = useTutorial<GameState, TutorialMove, TutorialStep>({
    steps: TUTORIAL_STEPS,
    self: TUTORIAL_SELF,
    start: () => createTutorialGame(selfName),
    restart: () => {
      const seed = randomSeed();
      rng.current = createRng(seed);
      return createPracticeGame(selfName, seed);
    },
    apply: (state, _playerId, move) => apply(state, move.player, move.command, rng.current!).state,
    same: sameMove,
    actor: (state) => tutorialActor(state),
    canAct: (state) => selfCanAct(state),
    bot: (state, playerId) => {
      const command = botCommand(redactGameForViewer(state, playerId), playerId, TUTORIAL_BOT_OPTIONS);
      return command ? { player: playerId, command } : null;
    },
    // 等亮牌动画放完再动；人机一个接一个扣牌，留点时间让人看见头像上打勾
    botDelay: (state) => animationMs(state.events) + (state.phase === "roundEnd" ? 1500 : 700),
    watchDelay: () => 1000,
  });
  const { game, step, index, practice, flash } = tutorial;
  // 剧本里点了别的（不是咕噜嘎说的那一步）：响一下「不行」
  useEffect(() => {
    if (flash) sfx.deny();
  }, [flash]);
  const holding = useRevealHold(game);
  const anchor = useStepAnchor(step, game.version);

  // 走到最后一步就算学完（之后首页不再邀请）
  useEffect(() => {
    if (practice || (step?.kind === "info" && step.finale)) writeTutorial(GAME_ID, "done");
  }, [practice, step?.id]);

  function leave() {
    writeTutorial(GAME_ID, "skipped");
    onExit();
  }

  const members = useMemo<LobbyMember[]>(() => [
    { id: SELF_MEMBER, playerId: TUTORIAL_SELF, name: selfName, isHost: false, connected: true },
    ...TUTORIAL_BOTS.map((bot) => ({ id: `tutorial-${bot.id}`, playerId: bot.id, name: bot.name, isHost: false, connected: true, bot: true })),
  ], [selfName]);
  const room = useMemo<LobbyRoomSnapshot>(() => ({
    code: TUTORIAL_CODE,
    spectators: [],
    access: DEFAULT_ROOM_ACCESS,
    options: { target: game.config.target, fixedRounds: game.config.fixedRounds, tactics: game.config.tactics },
    capacity: 3,
    status: "playing",
    members,
    chat: [],
    voice: [],
    game: redactGameForViewer(game, TUTORIAL_SELF),
  }), [game, members]);

  let view: CoachView | null = null;
  if (step && anchor !== undefined && !holding) {
    const note = isTouchDevice() && step.noteTouch ? step.noteTouch : step.note;
    const finale = step.kind === "info" && step.finale === true;
    const lessonNow = Math.max(0, LESSONS.filter(({ at }) => at <= index).length - 1);
    view = {
      key: step.id,
      say: step.say,
      ...(note ? { note } : {}),
      ...(flash ? { flash } : {}),
      anchor,
      focus: step.kind !== "watch",
      face: flash ? "surprised" : step.face ?? "base",
      footer: (
        <>
          <StepPips index={lessonNow} total={LESSONS.length} />
          {!finale && <button className="tut-link" type="button" data-tutorial="skip" onClick={leave}>跳过教程</button>}
        </>
      ),
      actions: step.kind !== "info" ? null : finale ? (
        <>
          <button className="quiet-button" type="button" data-tutorial="end" onClick={onExit}>结束教程</button>
          <button className="primary-button tut-main" type="button" data-tutorial="practice" onClick={tutorial.startPractice}>和人机打完这局</button>
        </>
      ) : (
        <button className="primary-button tut-main" type="button" data-tutorial="next" onClick={tutorial.next}>下一步 ▶</button>
      ),
    };
  }

  const onCommand = (command: GameCommand) => tutorial.onCommand({ player: TUTORIAL_SELF, command });

  // 剧本进行中和练习局的侧栏挤法不一样（见 tutorial-niutou.css 的 .tut-script / .tut-practice）
  return (
    <div className={practice ? "tut-practice" : "tut-script"} style={{ display: "contents" }}>
      <GameBoard
        room={room}
        busy={false}
        error=""
        notice=""
        brand={brand}
        connection={
          <>
            <span className="connection-status online nt-tut-tag"><span className="connection-dot" />{practice ? "练习局" : "新手教程"}</span>
            <button className="quiet-button" type="button" data-tutorial="exit" onClick={practice ? onExit : leave}>退出教程</button>
          </>
        }
        themeToggle={themeToggle}
        theme={theme}
        chat={<Checklist index={index} practice={practice} waitingRoom={waitingRoom} />}
        onCommand={onCommand}
        onRematch={() => undefined}
        onAuto={() => undefined}
        onDissolve={() => undefined}
        watchId={TUTORIAL_SELF}
        onWatch={() => undefined}
        onLeave={onExit}
        selfMemberId={SELF_MEMBER}
        mode={practice ? "practice" : "tutorial"}
        finalActions={
          <>
            <button className="quiet-button" type="button" data-tutorial="end" onClick={onExit}>结束教程</button>
            <button className="primary-button nt-big" type="button" data-tutorial="again" onClick={tutorial.newPractice}>再练一局</button>
          </>
        }
      />
      {view && <Coach view={view} />}
    </div>
  );
}

/** 侧栏（真实对局里是聊天）：剧本进行中列出这次学哪几样；练习局只留一句话（省地方，1440×790 也一屏放下）。 */
function Checklist({ index, practice, waitingRoom }: { index: number; practice: boolean; waitingRoom: string | undefined }) {
  const done = LESSONS.filter((_, order) => (LESSONS[order + 1]?.at ?? TUTORIAL_STEPS.length) <= index).length;
  return (
    <section className="nt-panel tut-checklist" aria-label="新手教程进度">
      {practice ? (
        <>
          <h3>练习局 <small>目标 33 分</small></h3>
          <p>拿不准就点「提示」（键盘 H），咕噜嘎告诉你它会怎么出。</p>
        </>
      ) : (
        <>
          <h3>新手教程 <small>{done}/{LESSONS.length}</small></h3>
          <ul>
            {LESSONS.map(({ step, at }, order) => {
              const next = LESSONS[order + 1]?.at ?? TUTORIAL_STEPS.length;
              const state = next <= index ? "done" : at <= index ? "now" : "";
              return (
                <li key={step.id} className={state}>
                  <i aria-hidden="true">{state === "done" ? "✓" : state === "now" ? "▶" : "·"}</i>
                  {step.lesson}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {waitingRoom && <p>你还在房间 {waitingRoom} 里，房主一开局就自动回到牌桌。</p>}
    </section>
  );
}
