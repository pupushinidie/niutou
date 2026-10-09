import { useCallback, useEffect, useRef, useState } from "react";
import { ANIMATION, revealFrames, type GameState, type RevealFrame, type ResolveStep } from "@niutou/game";

/**
 * 亮牌动画：以 game.reveal 为准（不靠 events，events 会被人机下一手的 Selected 覆盖）。
 * reveal.id 变了 = 新的一次亮牌，从翻牌放起；id 没变但 steps 变长了（规则 C 选完排接着结算）= 只放新增的几步。
 * 节奏照引擎的 ANIMATION（翻牌 1200、每张接上去 700、每次收牌 2000），服务器按同样的时长给下一步留时间。
 *
 * 时间线拆成一个个「拍子」（beat），GameBoard 只在拍子切换时重画（定 4 排、每人牛头显示到哪一帧）；
 * 飞牌、尘土、飘字由 FlyLayer 按时钟逐帧画。计时器只在新动画开始或卸载时清，version 变化不清（React 计时器的坑）。
 */

export type BeatKind =
  | "flip" // 亮牌：所有人的牌翻开
  | "place" // 一张牌飞进排里
  | "fly6" // 第六张飞到第 6 格
  | "hold" // 停一下，危险格闪
  | "take" // 这排的牌飞向收牌人头像
  | "land" // 收完：新排头落位、飘「+N」
  | "flyLow" // 规则 C：牌飞到排头
  | "takeLow"
  | "landLow";

export interface Beat {
  readonly kind: BeatKind;
  /** 第几步（reveal.steps 下标）；翻牌是 -1。 */
  readonly step: number;
  readonly t0: number;
  readonly dur: number;
}

export interface RevealAnim {
  readonly revealId: number;
  readonly frames: RevealFrame[];
  readonly steps: ResolveStep[];
  readonly beats: Beat[];
  /** 时间线起点（performance.now() 的时刻）。 */
  readonly start: number;
  readonly total: number;
  /** 从第几步开始放（之前的步骤画面直接是结果）。 */
  readonly from: number;
}

function buildBeats(steps: ResolveStep[], from: number, flip: boolean): { beats: Beat[]; total: number } {
  const beats: Beat[] = [];
  let t = 0;
  const push = (kind: BeatKind, step: number, dur: number) => {
    beats.push({ kind, step, t0: t, dur });
    t += dur;
  };
  if (flip) push("flip", -1, ANIMATION.flipMs);
  for (let index = from; index < steps.length; index += 1) {
    const step = steps[index]!;
    if (step.kind === "place") push("place", index, ANIMATION.placeMs);
    else if (step.kind === "sixth") {
      // 合计 takeMs（2000）：飞到第 6 格 600、停 400、整排飞走 700、落位 300
      const total = ANIMATION.takeMs;
      push("fly6", index, Math.round(total * 0.3));
      push("hold", index, Math.round(total * 0.2));
      push("take", index, Math.round(total * 0.35));
      push("land", index, total - Math.round(total * 0.3) - Math.round(total * 0.2) - Math.round(total * 0.35));
    } else {
      const total = ANIMATION.takeMs;
      push("flyLow", index, Math.round(total * 0.25));
      push("takeLow", index, Math.round(total * 0.4));
      push("landLow", index, total - Math.round(total * 0.25) - Math.round(total * 0.4));
    }
  }
  return { beats, total: t };
}

export interface RevealPlayback {
  readonly anim: RevealAnim | null;
  /** 当前拍子下标；anim 放完时等于 beats.length。 */
  readonly beat: number;
  readonly playing: boolean;
  readonly skip: () => void;
  /** 当前时间（动画时钟，毫秒，相对 anim.start）。冻结时是固定值。 */
  readonly now: () => number;
}

export interface PlaybackOptions {
  /** 预览页：第一次渲染也放（默认第一次渲染时的亮牌算看过了，重连的人不重放）。 */
  readonly playOnMount?: boolean;
  /** 预览页截图：把时钟停在动画开始后的这一毫秒。 */
  readonly frozenAt?: number;
  /** 不放动画（prefers-reduced-motion 或玩家点了跳过）。 */
  readonly disabled?: boolean;
}

export function useRevealPlayback(game: GameState, options: PlaybackOptions = {}): RevealPlayback {
  const reveal = game.reveal;
  const seen = useRef<{ id: number; steps: number }>(
    options.playOnMount ? { id: -1, steps: 0 } : { id: reveal?.id ?? -1, steps: reveal?.steps.length ?? 0 },
  );
  const [anim, setAnim] = useState<RevealAnim | null>(null);
  const [beat, setBeat] = useState(0);
  const timer = useRef<number | null>(null);
  const animRef = useRef<RevealAnim | null>(null);
  const frozen = options.frozenAt;

  const clock = useCallback(() => {
    const current = animRef.current;
    if (!current) return 0;
    if (frozen !== undefined) return frozen;
    return performance.now() - current.start;
  }, [frozen]);

  const schedule = useCallback(() => {
    const current = animRef.current;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (!current) return;
    const t = frozen !== undefined ? frozen : performance.now() - current.start;
    let index = current.beats.findIndex((item) => t < item.t0 + item.dur);
    if (index < 0) index = current.beats.length;
    setBeat(index);
    if (frozen !== undefined || index >= current.beats.length) return;
    const next = current.beats[index]!;
    timer.current = window.setTimeout(schedule, Math.max(16, next.t0 + next.dur - t + 2));
  }, [frozen]);

  // 只看 version：聊天等别的推送不会打断动画
  useEffect(() => {
    if (!reveal) {
      seen.current = { id: -1, steps: 0 };
      return;
    }
    const isNew = reveal.id !== seen.current.id;
    const grew = !isNew && reveal.steps.length > seen.current.steps;
    if (!isNew && !grew) return;
    const from = isNew ? 0 : seen.current.steps;
    seen.current = { id: reveal.id, steps: reveal.steps.length };
    if (options.disabled) {
      animRef.current = null;
      setAnim(null);
      return;
    }
    const { beats, total } = buildBeats(reveal.steps, from, isNew);
    if (beats.length === 0) return;
    const next: RevealAnim = { revealId: reveal.id, frames: revealFrames(game), steps: reveal.steps, beats, start: performance.now(), total, from };
    animRef.current = next;
    setAnim(next);
    schedule();
  }, [game.version]);

  // 卸载时清计时器
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const skip = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const current = animRef.current;
    if (current) setBeat(current.beats.length);
  }, []);

  const playing = anim !== null && beat < anim.beats.length;
  return { anim, beat, playing, skip, now: clock };
}

/** 动画放到某一拍时，桌上该画的 4 排、每人本局牛头，以及停在半空 / 格子上的那张牌。 */
export interface BoardFrame {
  readonly rows: number[][];
  readonly roundBulls: Record<string, number>;
  /** 已经从亮牌条里放出去的牌（亮牌条上这几张空着）。 */
  readonly played: Set<number>;
  /** 正在处理的这一步。 */
  readonly step: ResolveStep | null;
  readonly kind: BeatKind | null;
  /** 第六张收牌时停在第 6 格上的牌 / 规则 C 停在排头上的牌。 */
  readonly pending: { row: number; card: number; at: "sixth" | "head" } | null;
  /** 这一排的牌正在飞走（格子里不画）。 */
  readonly emptiedRow: number | null;
}

export function boardFrame(anim: RevealAnim, beatIndex: number, plays: readonly { card: number }[]): BoardFrame {
  const beat = anim.beats[beatIndex];
  const done = (stepCount: number) => new Set(anim.steps.slice(0, stepCount).map((step) => step.card));
  if (!beat) {
    const last = anim.frames[anim.frames.length - 1]!;
    return { rows: last.rows, roundBulls: last.roundBulls, played: done(anim.steps.length), step: null, kind: null, pending: null, emptiedRow: null };
  }
  if (beat.step < 0) {
    const first = anim.frames[anim.from]!;
    return { rows: first.rows, roundBulls: first.roundBulls, played: done(anim.from), step: null, kind: beat.kind, pending: null, emptiedRow: null };
  }
  const step = anim.steps[beat.step]!;
  const before = anim.frames[beat.step]!;
  const after = anim.frames[beat.step + 1]!;
  const playedBefore = done(beat.step);
  const playedNow = done(beat.step + 1);
  switch (beat.kind) {
    case "place":
    case "fly6":
    case "flyLow":
      return { rows: before.rows, roundBulls: before.roundBulls, played: playedNow, step, kind: beat.kind, pending: null, emptiedRow: null };
    case "hold":
      return { rows: before.rows, roundBulls: before.roundBulls, played: playedNow, step, kind: beat.kind, pending: { row: step.row, card: step.card, at: "sixth" }, emptiedRow: null };
    case "take":
      return { rows: before.rows, roundBulls: before.roundBulls, played: playedNow, step, kind: beat.kind, pending: { row: step.row, card: step.card, at: "sixth" }, emptiedRow: step.row };
    case "takeLow":
      return { rows: before.rows, roundBulls: before.roundBulls, played: playedNow, step, kind: beat.kind, pending: { row: step.row, card: step.card, at: "head" }, emptiedRow: step.row };
    case "land":
    case "landLow":
      return { rows: after.rows, roundBulls: after.roundBulls, played: playedNow, step, kind: beat.kind, pending: null, emptiedRow: null };
    default:
      void plays;
      return { rows: after.rows, roundBulls: after.roundBulls, played: playedNow, step, kind: beat.kind, pending: null, emptiedRow: null };
  }
}
