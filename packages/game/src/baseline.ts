import { ROW_LIMIT, sumBulls, targetRow } from "./cards.js";
import type { GameCommand, GameState } from "./types.js";

/**
 * 简单基线（补充文件 1.7）：超时代打用它（开工拍板：选牌超时不出最小牌，免得替掉线的人主动收排），
 * 人机强度测试也拿它当对照。只用这个座位能看到的信息（rows 和自己的手牌）。
 */

/**
 * 选牌：「能安全接上」= 规则 A 有目标排，而且目标排现在不到 5 张；
 * 有能安全接上的牌就出其中和排尾差值最小的那张（差值一样出小的）；没有就出手里最小的牌。
 */
export function baselineCard(hand: readonly number[], rows: readonly (readonly number[])[]): number {
  let best: { card: number; gap: number } | null = null;
  for (const card of hand) {
    const row = targetRow(rows, card);
    if (row === null) continue;
    const target = rows[row]!;
    if (target.length >= ROW_LIMIT) continue;
    const gap = card - target[target.length - 1]!;
    if (!best || gap < best.gap || (gap === best.gap && card < best.card)) best = { card, gap };
  }
  if (best) return best.card;
  return Math.min(...hand);
}

/**
 * 规则 C 选排：牛头最少 → 排尾最大 → 排号最小。
 * （第二比较项用「排尾最大」，依据补充文件勘误第 5 条：官方 30 周年版合作变体里自动选排的规则；开工拍板采用。）
 */
export function baselineRow(rows: readonly (readonly number[])[]): number {
  let best = 0;
  rows.forEach((row, index) => {
    const current = rows[best]!;
    const bulls = sumBulls(row);
    const bestBulls = sumBulls(current);
    if (bulls < bestBulls || (bulls === bestBulls && row[row.length - 1]! > current[current.length - 1]!)) best = index;
  });
  return best;
}

/** 这个座位现在按基线该做什么；没有要它做的事返回 null。view 可以是 redact 之后的状态。 */
export function baselineCommand(view: GameState, playerId: string): GameCommand | null {
  const player = view.players.find((candidate) => candidate.id === playerId);
  if (!player) return null;
  switch (view.phase) {
    case "select":
      if (player.selected || player.hand.length === 0) return null;
      return { type: "select", card: baselineCard(player.hand, view.rows) };
    case "chooseRow":
      return view.chooser === playerId ? { type: "chooseRow", row: baselineRow(view.rows) } : null;
    case "roundEnd":
      return player.ready ? null : { type: "nextRound" };
    case "gameOver":
      return null;
  }
}
