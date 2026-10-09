import { cardPx, type CardSize } from "./art.js";

/**
 * 牌桌的尺寸按实际可视区域（innerWidth × innerHeight）算：4 排和手牌在几种整数倍里挑最大、又能一屏放下的。
 * 参考多米诺王国的 layout.ts。所有数字都是 CSS 像素，GameBoard 用 CSS 变量把它们交给 niutou.css。
 *
 * 桌面（宽 ≥ 700）：
 *   顶栏 │ 左列玩家卡 │ 牌桌（木边 + 绿呢 + 4 排）│ 右列玩家卡 │ 侧栏（记录 + 聊天；放不下就收进抽屉）
 *   手牌栏（全宽）：提示和按钮 │ 10 张手牌（亮牌时换成亮牌条）│ 我的卡
 * 手机（宽 < 700）：顶栏 │ 对手小卡 │ 提示 │ 4 排（sm 2×，第 6 格窄条）│ 手牌两行 × 5 + 按钮
 */
export type Mode = "wide" | "mid" | "phone";
export type SeatSize = "xl" | "big" | "medium" | "small";

export interface Layout {
  readonly mode: Mode;
  readonly rows: CardSize;
  readonly hand: CardSize;
  readonly cell: { w: number; h: number };
  readonly handCard: { w: number; h: number };
  /** 手牌一行几张（桌面 10，手机 5）。 */
  readonly perRow: number;
  readonly topH: number;
  /** 大块之间的间距。 */
  readonly gap: number;
  /** 牌桌内边距、木边宽。 */
  readonly pad: number;
  readonly rim: number;
  readonly rowGap: number;
  readonly cellGap: number;
  /** 排头（排号 + 这排牛头数）宽。 */
  readonly headW: number;
  readonly tableW: number;
  readonly tableH: number;
  /** 玩家卡（桌面两列，各最多 5 张）。 */
  readonly seatW: number;
  readonly seatH: number;
  /** xl：大屏，名字 24px；big：头像 64、图标 32；medium：头像 64、图标 16、两行数字；small：头像 32。 */
  readonly seatSize: SeatSize;
  /** 侧栏宽；0 表示收进抽屉。 */
  readonly sideW: number;
  readonly handBarH: number;
  readonly actionW: number;
  readonly meW: number;
}

const ROW_CHOICES: CardSize[] = [
  { set: "lg", scale: 3 },
  { set: "sm", scale: 4 },
  { set: "lg", scale: 2 },
  { set: "sm", scale: 3 },
  { set: "sm", scale: 2 },
];
const HAND_CHOICES = ROW_CHOICES;

const MARGIN = 12;
const SIDE_MIN = 260;
const SIDE_MAX = 420;
const ACTION_MIN = 200;

function desktop(vw: number, vh: number, rows: CardSize, hand: CardSize, tight: boolean): Layout | null {
  const cell = cardPx(rows);
  const handCard = cardPx(hand);
  const topH = tight ? 44 : 48;
  const gap = tight ? 6 : 8;
  const pad = tight ? 6 : 8;
  const rim = tight ? 8 : 16;
  const rowGap = tight ? 6 : 8;
  const cellGap = 6;
  const headW = cell.w > 84 ? 72 : 56;
  const tableH = 4 * cell.h + 3 * rowGap + 2 * pad + 2 * rim;
  const tableW = headW + 6 + 6 * cell.w + 5 * cellGap + 2 * pad + 2 * rim;
  const handBarH = handCard.h + 32;
  if (topH + gap + tableH + gap + handBarH + gap > vh) return null;

  // 横向：两列玩家卡 + 牌桌 + 侧栏（侧栏放不下就进抽屉）
  const usable = vw - 2 * MARGIN;
  const forSeats = usable - tableW - 2 * gap;
  let seatW: number;
  let sideW = 0;
  const bigSeat = 220;
  const smallSeat = 150;
  if (forSeats - gap - SIDE_MIN >= 2 * bigSeat) {
    sideW = Math.min(SIDE_MAX, forSeats - gap - 2 * bigSeat);
    seatW = Math.min(300, Math.floor((forSeats - gap - sideW) / 2));
    sideW = forSeats - gap - 2 * seatW;
  } else if (forSeats >= 2 * smallSeat) {
    seatW = Math.min(300, Math.floor(forSeats / 2));
  } else {
    return null;
  }
  const seatH = Math.min(140, Math.floor((tableH - 4 * gap) / 5));
  if (seatH < 76) return null;
  const seatSize: SeatSize = seatW >= 280 && seatH >= 112 ? "xl" : seatW >= bigSeat && seatH >= 92 ? "big" : seatW >= 160 && seatH >= 88 ? "medium" : "small";

  // 手牌栏：提示和按钮 + 10 张 + 我的卡
  const handW = 10 * handCard.w + 9 * cellGap;
  const rest = usable - 12 - handW - 2 * gap;
  const meW = Math.min(seatW, Math.max(smallSeat, rest - ACTION_MIN));
  const actionW = rest - meW;
  if (actionW < ACTION_MIN || meW < smallSeat) return null;

  return {
    mode: sideW > 0 ? "wide" : "mid",
    rows,
    hand,
    cell,
    handCard,
    perRow: 10,
    topH,
    gap,
    pad,
    rim,
    rowGap,
    cellGap,
    headW,
    tableW,
    tableH,
    seatW,
    seatH,
    seatSize,
    sideW,
    handBarH,
    actionW,
    meW,
  };
}

function phone(vw: number): Layout {
  const rows: CardSize = { set: "sm", scale: 2 };
  const cell = cardPx(rows);
  const cellGap = 3;
  const headW = 36;
  const pad = 4;
  const rim = 4;
  const rowGap = 4;
  // 5 格 + 第 6 格窄条（14×38 → 28×76）
  const tableW = headW + 3 + 5 * cell.w + 4 * cellGap + cellGap + 28 + 2 * pad + 2 * rim;
  const tableH = 4 * cell.h + 3 * rowGap + 2 * pad + 2 * rim;
  return {
    mode: "phone",
    rows,
    hand: rows,
    cell,
    handCard: cell,
    perRow: 5,
    topH: 36,
    gap: 4,
    pad,
    rim,
    rowGap,
    cellGap,
    headW,
    tableW,
    tableH,
    seatW: 0,
    seatH: 0,
    seatSize: "small",
    sideW: 0,
    handBarH: 2 * cell.h + 4 + 12,
    actionW: Math.max(72, vw - 12 - (5 * cell.w + 4 * cellGap) - 4),
    meW: 0,
  };
}

/** 按可视区域挑尺寸：4 排越大越好，其次手牌，最后才是宽松的间距。 */
export function pickLayout(vw: number, vh: number): Layout {
  if (vw < 700) return phone(vw);
  let best: { layout: Layout; score: number } | null = null;
  for (const rows of ROW_CHOICES) {
    for (const hand of HAND_CHOICES) {
      for (const tight of [false, true]) {
        const layout = desktop(vw, vh, rows, hand, tight);
        if (!layout) continue;
        const score = 4 * layout.cell.h + 3 * layout.handCard.h + (tight ? 0 : 6) + (layout.rows.set === "lg" ? 1 : 0) + (layout.hand.set === "lg" ? 1 : 0);
        if (!best || score > best.score) best = { layout, score };
      }
    }
  }
  // 实在放不下（很矮的窗口）：最小的桌面尺寸，允许滚动
  return best?.layout ?? desktop(Math.max(vw, 1000), 2000, { set: "sm", scale: 2 }, { set: "sm", scale: 2 }, true)!;
}

/** 别人（不含我）怎么排成一圈：从我左手边开始顺时针，左列从下往上、右列从上往下。 */
export function seatColumns<T>(others: readonly T[]): { left: T[]; right: T[] } {
  const leftCount = Math.ceil(others.length / 2);
  const left = others.slice(0, leftCount).reverse();
  const right = others.slice(leftCount);
  return { left, right };
}
