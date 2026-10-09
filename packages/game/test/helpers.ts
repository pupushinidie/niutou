import { buildGame, playHand, type GameState } from "../src/index.js";

/** 玩家代号：甲乙丙丁… 对应 p1、p2、p3、p4…（规则书的例子用甲乙丙丁）。 */
export const 甲 = "p1";
export const 乙 = "p2";
export const 丙 = "p3";
export const 丁 = "p4";

/**
 * 用指定的 4 排打一手：第 i 位玩家出 plays[i]（每人手牌里一定有这张，其余随机补齐）。
 * 规则 C 时给了 choose 就替出牌的人选排，没给就停在 chooseRow。
 */
export function playOnRows(rows: number[][], plays: number[], choose?: number, extra: { totals?: number[]; turn?: number } = {}): GameState {
  const state = buildGame({
    players: plays.map((card, index) => ({ include: [card], ...(extra.totals ? { total: extra.totals[index]! } : {}) })),
    rows,
    ...(extra.turn !== undefined ? { turn: extra.turn } : {}),
  });
  return playHand(state, plays, choose);
}

export function bullsOf(state: GameState): number[] {
  return state.players.map((player) => player.roundBulls);
}
