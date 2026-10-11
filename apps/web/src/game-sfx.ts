import { useEffect, useRef } from "react";
import { animationMs, stepKey, type GameState } from "@niutou/game";
import { sfx, synth } from "./gm-sound.js";
import type { RevealAnim } from "./reveal.js";

/**
 * 谁是牛头王的动作音效。gm-sound.tsx 是全站共用的音效库，这里只管「什么时候响哪个」。
 *
 * 两路来源：
 * 1. 亮牌后的结算跟着牌桌上的动画拍子（reveal.ts 的 beat）响：翻牌、每张接上去、第六张落进危险格、整排飞走、牛叫……
 *    声音和画面对得上；点了「跳过动画」后面的就不响。动画关着（系统减少动态效果）时亮牌只响翻牌 + 收牌的牛叫。
 * 2. 其余的看引擎的 events（选好 / 撤回 / 局末继续 / 新一局发牌 / 局末 / 终局 / 超时）。
 *    局末、终局这些和最后一手的亮牌在同一个快照里，排队等动画放完再响。
 *
 * 第一次拿到对局（进房间、重连、观战刚进来）不响；版本一下跳了很多步（重连）也不响；再来一局 / 教程重开（版本变小）重新算起。
 * 自己的动作 mine=true，别人的减半；观战时都算别人的。
 */

declare global {
  interface Window {
    /** 开发时自测脚本用：记下响过的音效名字。 */
    __sfxLog?: string[];
  }
}

function log(name: string) {
  if (import.meta.env.DEV) window.__sfxLog?.push(name);
}

const { tone, noise, level } = synth;

/** 招牌声音：牛叫「哞——」（收走一排时）。bulls 越多越长越响。 */
function moo(mine: boolean, bulls = 3) {
  const v = level(mine) * Math.min(1.3, 0.75 + bulls / 20);
  const length = Math.min(1.1, 0.55 + bulls * 0.04);
  const pitch = synth.jitter(0.05);
  // 鼻音的「m」起头，再滑下去的「oo」
  tone(150 * pitch, { duration: length, volume: 0.22 * v, type: "sawtooth", glideTo: 98 * pitch });
  tone(300 * pitch, { at: 0.02, duration: length * 0.9, volume: 0.1 * v, type: "triangle", glideTo: 190 * pitch });
  tone(75 * pitch, { duration: length, volume: 0.18 * v, glideTo: 55 * pitch });
  noise({ duration: length * 0.8, volume: 0.06 * v, filter: "lowpass", freq: 600, freqTo: 250 });
  log("moo");
}

/** 招牌声音：第六张落进危险格——两声短促的牛铃警报。 */
function dangerBell(mine: boolean) {
  const v = level(mine);
  [0, 0.16].forEach((at, i) => {
    tone(i === 0 ? 1175 : 932, { at, duration: 0.14, volume: 0.12 * v, type: "square" });
    tone(i === 0 ? 2350 : 1864, { at, duration: 0.1, volume: 0.04 * v, type: "triangle" });
  });
  log("dangerBell");
}

/** 局末点「继续」：一声轻轻的「叮」。 */
function readyDing(mine: boolean) {
  const v = level(mine);
  tone(1319, { duration: 0.12, volume: 0.1 * v, type: "triangle" });
  tone(1760, { at: 0.06, duration: 0.16, volume: 0.08 * v, type: "triangle" });
  log("ready");
}

/** 选牌时挑中的这张会落进危险格 / 比排尾都小：选中声后面跟一下低沉的提醒。 */
export function pickSound(on: boolean, risky = false) {
  sfx.select(on);
  log(on ? "select" : "unselect");
  if (on && risky) {
    tone(196, { at: 0.08, duration: 0.14, volume: 0.1, type: "triangle", glideTo: 165 });
    log("risky");
  }
}

/** 确认（再点一下同一张、点「确认」）：轻点，结果音（扣牌）等服务器回来再响。 */
export function confirmSound() {
  sfx.tap();
  log("tap");
}

function play(name: string, fn: () => void, delay = 0) {
  if (delay <= 0) {
    fn();
    log(name);
  } else
    window.setTimeout(() => {
      fn();
      log(name);
    }, delay);
}

interface Options {
  readonly game: GameState;
  /** 自己的玩家 id；观战时传空字符串（全都算别人的）。 */
  readonly selfId: string;
  /** 正在放的亮牌动画（没在放时 null）和当前拍子。 */
  readonly anim: RevealAnim | null;
  readonly beat: number;
  /** 亮牌动画被关掉了（减少动态效果 / 预览）。 */
  readonly animDisabled: boolean;
  /** 现在该我动手（选牌或选排），而且动画已经放完。 */
  readonly needMe: boolean;
}

export function useGameSfx({ game, selfId, anim, beat, animDisabled, needMe }: Options) {
  const prev = useRef<GameState | null>(null);
  /** 等亮牌动画放完再响的（局末、终局）。 */
  const after = useRef<Array<() => void>>([]);
  const lastBeat = useRef<{ start: number; beat: number } | null>(null);
  /** 已经提示过「该你了」的那一步（stepKey）。第一次拿到对局时记下当前这一步，不响。 */
  const announced = useRef<string | null>(null);
  const animating = anim !== null;
  const flushAfter = () => {
    const pending = after.current;
    after.current = [];
    pending.forEach((fn) => fn());
  };

  // ---- 引擎事件 ----
  useEffect(() => {
    const before = prev.current;
    prev.current = game;
    if (!before) {
      announced.current = stepKey(game);
      return;
    }
    if (game.version === before.version) return;
    // 再来一局 / 教程重开：版本变小，从头算，不响。
    if (game.version < before.version) {
      after.current = [];
      announced.current = stepKey(game);
      // 再来一局：上一盘打完、新的一盘刚发好牌
      if (before.phase === "gameOver" && game.phase === "select" && game.round === 1) {
        play("gameStart", () => sfx.gameStart(), 100);
        play("deal", () => sfx.deal(10), 700);
      }
      return;
    }
    // 一下跳了很多步（重连、切回标签页）：不补放。
    if (game.version - before.version > 4) {
      announced.current = needMe ? stepKey(game) : announced.current;
      return;
    }
    const mineOf = (id: string) => selfId !== "" && id === selfId;
    const revealed = game.events.some((event) => event.type === "Revealed" || event.type === "RowTaken" || event.type === "CardPlaced");
    let gap = 0;
    const queue: Array<() => void> = [];
    for (const event of game.events) {
      switch (event.type) {
        case "Selected":
          // 最后一个人扣牌的瞬间就亮牌了：翻牌声代替扣牌声
          if (!revealed) {
            const mine = mineOf(event.player);
            play("card", () => sfx.card(mine), gap);
            gap += 90;
          }
          break;
        case "Unselected": {
          const mine = mineOf(event.player);
          play("draw", () => sfx.draw(mine), gap);
          gap += 90;
          break;
        }
        case "Ready": {
          const mine = mineOf(event.player);
          window.setTimeout(() => readyDing(mine), gap);
          gap += 90;
          break;
        }
        case "RoundStarted":
          play("shuffle", () => sfx.shuffle(), 150);
          play("deal", () => sfx.deal(10), 550);
          play("roundStart", () => sfx.roundStart(), 1300);
          break;
        case "RoundEnded": {
          const bulls = selfId ? event.bulls[selfId] ?? 0 : 0;
          queue.push(() => play("score", () => sfx.score(true, bulls === 0)));
          break;
        }
        case "GameEnded": {
          const won = selfId === "" || event.winners.includes(selfId);
          queue.push(() => {
            play("gameOver", () => sfx.gameOver(won), 300);
            // 牛头王（罚分最多的）出场：一声长长的牛叫
            const max = Math.max(...Object.values(event.totals));
            const king = selfId !== "" && event.totals[selfId] === max && !event.winners.includes(selfId);
            window.setTimeout(() => moo(king, 20), 1400);
          });
          break;
        }
        case "TimedOut":
          if (selfId && event.players.includes(selfId) && event.phase !== "roundEnd") play("timeout", () => sfx.timeout(), 0);
          break;
        case "Revealed":
          // 动画关着：亮牌、收牌一次响完（开着时跟着拍子响，见下面）
          if (animDisabled) {
            play("reveal", () => sfx.reveal(true), 0);
            const takes = game.reveal?.steps.filter((step) => step.kind !== "place") ?? [];
            takes.slice(-1).forEach((step) => window.setTimeout(() => moo(mineOf(step.player), step.bulls), 500));
          }
          break;
        case "RowTaken":
          // 规则 C 选完排（没有新的 Revealed）：动画关着时直接牛叫
          if (animDisabled && !game.events.some((item) => item.type === "Revealed")) {
            const mine = mineOf(event.player);
            window.setTimeout(() => moo(mine, event.bulls), 0);
          }
          break;
        default:
          // CardPlaced / ChooseRow / HandEnded：跟着动画拍子响，或者没有声音
          break;
      }
    }
    if (queue.length) {
      if (animating || (revealed && !animDisabled)) {
        after.current.push(...queue);
        // 保险：动画没放起来（比如这次亮牌被当成旧的）也别把局末 / 终局的声音吞掉
        window.setTimeout(flushAfter, animationMs(game.events) + 800);
      } else queue.forEach((fn) => window.setTimeout(fn, 400));
    }
  }, [game.version]);

  // ---- 亮牌动画的拍子 ----
  useEffect(() => {
    if (!anim) {
      lastBeat.current = null;
      // 动画放完（或被跳过）：响排队的局末 / 终局
      if (after.current.length) window.setTimeout(flushAfter, 150);
      return;
    }
    const b = anim.beats[beat];
    if (!b) return;
    const seen = lastBeat.current;
    if (seen && seen.start === anim.start && seen.beat >= beat) return;
    lastBeat.current = { start: anim.start, beat };
    const step = b.step >= 0 ? anim.steps[b.step] : undefined;
    const mine = !!step && selfId !== "" && step.player === selfId;
    switch (b.kind) {
      case "flip": {
        // 所有人的牌一起翻开：一声揭晓，加几下错开的翻牌
        play("reveal", () => sfx.reveal(true));
        const count = Math.min(game.reveal?.plays.length ?? 3, 5);
        for (let i = 0; i < count; i += 1) play("flip", () => sfx.flip(i === 0), 180 + i * 70);
        break;
      }
      case "place":
        play("card", () => sfx.card(mine), 120);
        break;
      case "fly6":
        play("card", () => sfx.card(mine), 160);
        break;
      case "flyLow":
        play("card", () => sfx.card(mine), 120);
        break;
      case "hold":
        dangerBell(mine);
        break;
      case "take":
      case "takeLow":
        play("hit", () => sfx.hit(mine));
        play("draw", () => sfx.draw(mine, Math.min(5, step?.taken.length ?? 3)), 120);
        break;
      case "land":
      case "landLow":
        moo(mine, step?.bulls ?? 3);
        if (mine) play("bust", () => sfx.bust(true), 260);
        break;
    }
  }, [anim?.start, beat]);

  // ---- 该我了：新的一手 / 要我选排，而且动画放完了 ----
  // 亮牌的快照到了以后，动画要下一次渲染才开始：等一小会儿再看，免得在翻牌前就响「该你了」。
  const live = useRef({ needMe, animating, key: stepKey(game) });
  live.current = { needMe, animating, key: stepKey(game) };
  useEffect(() => {
    if (!needMe || animating) return;
    const key = stepKey(game);
    if (announced.current === key) return;
    const dealt = game.events.some((event) => event.type === "RoundStarted");
    const timer = window.setTimeout(() => {
      const now = live.current;
      if (!now.needMe || now.animating || now.key !== key || announced.current === key) return;
      announced.current = key;
      // 刚发完牌就等发牌声响完
      play("yourTurn", () => sfx.yourTurn(), dealt ? 1400 : 0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [needMe, animating, game.version]);
}
