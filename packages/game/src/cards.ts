/**
 * 牌和 4 排的纯函数：牛头数、规则 A（放哪一排）、按从小到大逐张结算。
 * 引擎、人机、预览局面、界面都用这里的函数，规则只写一份。
 */

/** 全副牌 1–104。 */
export const DECK_SIZE = 104;
/** 桌上固定 4 排。 */
export const ROW_COUNT = 4;
/** 一排最多 5 张，放第 6 张的人收走前 5 张（规则 B）。 */
export const ROW_LIMIT = 5;
/** 每人每局 10 张手牌，一局 10 手。 */
export const HAND_SIZE = 10;
/** 默认目标分：有人累计罚分到 66 就在局末结束。 */
export const DEFAULT_TARGET = 66;

/**
 * 一张牌的牛头数（规则书 2.1，命中第一条就停）：
 * 55 → 7；11 的倍数 → 5；10 的倍数 → 3；个位是 5 → 2；其余 → 1。
 */
export function bullheads(card: number): number {
  if (card === 55) return 7;
  if (card % 11 === 0) return 5;
  if (card % 10 === 0) return 3;
  if (card % 10 === 5) return 2;
  return 1;
}

/** 一组牌（一排、一个收牌堆）的牛头合计。 */
export function sumBulls(cards: readonly number[]): number {
  let total = 0;
  for (const card of cards) total += bullheads(card);
  return total;
}

/** 这一局用到的牌：基础模式 1–104；战术模式只用 1 到「人数 × 10 + 4」。 */
export function cardsInPlay(playerCount: number, tactics: boolean): number[] {
  const top = tactics ? Math.min(DECK_SIZE, playerCount * HAND_SIZE + ROW_COUNT) : DECK_SIZE;
  return Array.from({ length: top }, (_, index) => index + 1);
}

/**
 * 规则 A：这张牌接到哪一排（0–3）。只看每排最后一张，只能接在比它小的排尾后面，
 * 选差值最小的那一排；比所有排尾都小（规则 C）返回 null。
 */
export function targetRow(rows: readonly (readonly number[])[], card: number): number | null {
  let best: number | null = null;
  let bestTail = -Infinity;
  rows.forEach((row, index) => {
    const tail = row[row.length - 1];
    if (tail === undefined || tail >= card) return;
    if (tail > bestTail) {
      bestTail = tail;
      best = index;
    }
  });
  return best;
}

/** 亮出的一张牌：谁出的、出了几。 */
export interface Play {
  readonly player: string;
  readonly card: number;
}

/**
 * 结算的一步（一张牌）：
 * - place：规则 A，接在第 row 排后面，成为第 position 张（2–5）；
 * - sixth：规则 B，第 row 排已有 5 张，出牌的人收走这 5 张，他的牌成为新的第一张；
 * - low：规则 C，比所有排尾都小，出牌的人自己选第 row 排整排收走，他的牌成为新的第一张。
 */
export interface ResolveStep {
  readonly kind: "place" | "sixth" | "low";
  readonly player: string;
  readonly card: number;
  /** 0–3。 */
  readonly row: number;
  /** 这张牌在这一排里的位置（1 = 第一张）；收牌时是 1。 */
  readonly position: number;
  /** 收走的牌（place 时为空）。 */
  readonly taken: number[];
  /** 这一步罚了几个牛头（taken 的牛头合计）。 */
  readonly bulls: number;
  /** 这一步之后的 4 排（界面逐张放动画时直接用）。 */
  readonly rows: number[][];
  /** 规则 C 的这一排是超时 / 离线时代选的。 */
  readonly auto?: true;
}

/** 规则 C 时决定收哪一排；不给就停下来等人选（引擎停在 chooseRow）。 */
export type RowChooser = (rows: readonly (readonly number[])[], play: Play) => number;

export interface ResolveResult {
  /** 结算后的 4 排（停下来时是停下那一刻的 4 排）。 */
  readonly rows: number[][];
  /** 已经结算的每一步。 */
  readonly steps: ResolveStep[];
  /** 没给 chooser 而遇到规则 C 时：停在第几张（plays 的下标），这张还没结算。 */
  readonly stoppedAt: number | null;
}

/** 规则 C：出牌的人收走第 row 排（不管几张），他的牌成为这一排新的第一张。 */
export function takeLowRow(rows: readonly (readonly number[])[], play: Play, row: number, auto = false): ResolveStep {
  const next = rows.map((cards) => [...cards]);
  const taken = next[row]!;
  next[row] = [play.card];
  return {
    kind: "low",
    player: play.player,
    card: play.card,
    row,
    position: 1,
    taken,
    bulls: sumBulls(taken),
    rows: next,
    ...(auto ? { auto: true as const } : {}),
  };
}

/** 一张（规则 A 能找到排的）牌：接上去，或者作为第六张收走前 5 张。规则 C 的牌返回 null。 */
export function placeCard(rows: readonly (readonly number[])[], play: Play): ResolveStep | null {
  const row = targetRow(rows, play.card);
  if (row === null) return null;
  const next = rows.map((cards) => [...cards]);
  const target = next[row]!;
  if (target.length >= ROW_LIMIT) {
    next[row] = [play.card];
    return { kind: "sixth", player: play.player, card: play.card, row, position: 1, taken: target, bulls: sumBulls(target), rows: next };
  }
  target.push(play.card);
  return { kind: "place", player: play.player, card: play.card, row, position: target.length, taken: [], bulls: 0, rows: next };
}

/** 按数字从小到大排好亮出的牌。 */
export function sortPlays(plays: readonly Play[]): Play[] {
  return [...plays].sort((left, right) => left.card - right.card);
}

/**
 * 从 plays[from] 开始，按从小到大逐张结算（plays 要先排好序）。
 * 遇到规则 C：给了 chooser 就按它选的排收走继续；没给就停下，stoppedAt 指向这张。
 */
export function resolvePlays(
  rows: readonly (readonly number[])[],
  plays: readonly Play[],
  chooser?: RowChooser,
  from = 0,
): ResolveResult {
  let current = rows.map((cards) => [...cards]);
  const steps: ResolveStep[] = [];
  for (let index = from; index < plays.length; index += 1) {
    const play = plays[index]!;
    let step = placeCard(current, play);
    if (!step) {
      if (!chooser) return { rows: current, steps, stoppedAt: index };
      const row = chooser(current, play);
      if (!Number.isInteger(row) || row < 0 || row >= current.length) throw new Error("规则 C 选的排号不对。");
      step = takeLowRow(current, play, row);
    }
    steps.push(step);
    current = step.rows.map((cards) => [...cards]);
  }
  return { rows: current, steps, stoppedAt: null };
}

/** 4 排各自的牛头合计。 */
export function rowsBulls(rows: readonly (readonly number[])[]): number[] {
  return rows.map((row) => sumBulls(row));
}
