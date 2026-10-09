/**
 * 规则书第 10 节 TC1–TC13、第 6 节例 1 / 例 2，逐条写成单测（测试名带编号）。
 * 规则书：~/Desktop/游戏规则/谁是牛头王.md
 */
import { describe, expect, it } from "vitest";
import {
  applyCommand,
  buildGame,
  bullheads,
  cardsInPlay,
  createGame,
  legalActions,
  playHand,
  rowsBulls,
  sumBulls,
  targetRow,
  timeoutTurn,
  type GameState,
} from "../src/index.js";
import { bullsOf, playOnRows, 丙, 丁, 乙, 甲 } from "./helpers.js";

/** 所有人点「继续」，发下一局。 */
function allReady(state: GameState): GameState {
  let current = state;
  for (const player of state.players) current = applyCommand(current, player.id, { type: "nextRound" });
  return current;
}

describe("规则书#TC1 牛头数", () => {
  it("规则书#TC1 单点：1→1、5→2、10→3、11→5、50→3、52→1、55→7、65→2、99→5、100→3、104→1", () => {
    const expected: Record<number, number> = { 1: 1, 5: 2, 10: 3, 11: 5, 50: 3, 52: 1, 55: 7, 65: 2, 99: 5, 100: 3, 104: 1 };
    for (const [card, bulls] of Object.entries(expected)) expect(bullheads(Number(card)), `牌 ${card}`).toBe(bulls);
  });

  it("规则书#TC1 1–104 合计 171；按牛头分组 {1:76, 2:9, 3:10, 5:8, 7:1}", () => {
    const all = cardsInPlay(4, false);
    expect(all).toHaveLength(104);
    expect(sumBulls(all)).toBe(171);
    const groups: Record<number, number> = {};
    for (const card of all) groups[bullheads(card)] = (groups[bullheads(card)] ?? 0) + 1;
    expect(groups).toEqual({ 1: 76, 2: 9, 3: 10, 5: 8, 7: 1 });
  });

  it("规则书#2.1 只看个位：50 是 3 个，51–54、56–59 是 1 个，55 是 7 个", () => {
    expect([50, 51, 52, 53, 54, 55, 56, 57, 58, 59].map(bullheads)).toEqual([3, 1, 1, 1, 1, 7, 1, 1, 1, 1]);
    // 判定顺序：55 → 11 的倍数 → 整十 → 个位 5 → 其余
    expect([11, 22, 33, 44, 66, 77, 88, 99].map(bullheads)).toEqual([5, 5, 5, 5, 5, 5, 5, 5]);
    expect([5, 15, 25, 35, 45, 65, 75, 85, 95].map(bullheads)).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2]);
    expect([10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(bullheads)).toEqual([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
  });
});

describe("规则书#TC2–TC5 放牌", () => {
  it("规则书#TC2 差值最小：[10][25][40][63] 出 27、41、70、12 → [10,12][25,27][40,41][63,70]，无人收牌", () => {
    const rows = [[10], [25], [40], [63]];
    expect(targetRow(rows, 27)).toBe(1);
    expect(targetRow(rows, 41)).toBe(2);
    expect(targetRow(rows, 70)).toBe(3);
    expect(targetRow(rows, 12)).toBe(0);
    const state = playOnRows(rows, [27, 41, 70, 12]);
    expect(state.rows).toEqual([[10, 12], [25, 27], [40, 41], [63, 70]]);
    expect(bullsOf(state)).toEqual([0, 0, 0, 0]);
    expect(state.players.every((player) => player.taken.length === 0)).toBe(true);
  });

  it("规则书#TC3 同一手里先后影响：出 26、27 → 第 2 排 [25,26,27]", () => {
    const state = playOnRows([[10], [25], [40], [63]], [27, 26]);
    expect(state.rows[1]).toEqual([25, 26, 27]);
    // 结算顺序是从小到大，和座位无关
    expect(state.reveal!.plays.map((play) => play.card)).toEqual([26, 27]);
    expect(state.reveal!.steps.map((step) => [step.card, step.row, step.position])).toEqual([[26, 1, 2], [27, 1, 3]]);
  });

  it("规则书#TC4 第六张：第 2 排 [20,21,23,24,25]，出 30 的人收走、罚 8 分，第 2 排变 [30]", () => {
    const state = playOnRows([[10], [20, 21, 23, 24, 25], [40], [63]], [30, 64]);
    expect(state.players[0]!.roundBulls).toBe(8);
    expect(state.players[0]!.taken).toEqual([20, 21, 23, 24, 25]);
    expect(state.rows).toEqual([[10], [30], [40], [63, 64]]);
    expect(state.events).toContainEqual({ type: "RowTaken", player: 甲, card: 30, row: 1, cards: [20, 21, 23, 24, 25], bulls: 8, reason: "sixth" });
  });

  it("规则书#TC5 看起来能接、实际是第六张：出 45 → 收走 32、35、37、39、40 = 8 分", () => {
    const rows = [[10], [25], [32, 35, 37, 39, 40], [63]];
    expect(targetRow(rows, 45)).toBe(2);
    const state = playOnRows(rows, [45, 64]);
    expect(state.players[0]!.taken).toEqual([32, 35, 37, 39, 40]);
    expect(state.players[0]!.roundBulls).toBe(8);
    expect(state.rows[2]).toEqual([45]);
  });
});

describe("规则书#TC6 比所有排都小（规则 C）", () => {
  const rows = [[10, 13], [25], [40, 44, 48], [63]];

  it("规则书#TC6 4 排牛头 4/2/9/1；结算到 4 时进入 chooseRow，chooser = 甲", () => {
    expect(rowsBulls(rows)).toEqual([4, 2, 9, 1]);
    expect(targetRow(rows, 4)).toBeNull();
    const state = playOnRows(rows, [4, 7]);
    expect(state.phase).toBe("chooseRow");
    expect(state.chooser).toBe(甲);
    expect(state.events.at(-1)).toEqual({ type: "ChooseRow", player: 甲, card: 4 });
    // 停下时 4 排没动，7 还没结算
    expect(state.rows).toEqual(rows);
    expect(state.reveal!.steps).toHaveLength(0);
  });

  it("规则书#TC6 甲选第 4 排 → 罚 1 分，第 4 排 = [4]；继续结算 7 → [4,7]", () => {
    const waiting = playOnRows(rows, [4, 7]);
    const state = applyCommand(waiting, 甲, { type: "chooseRow", row: 3 });
    expect(state.players[0]!.roundBulls).toBe(1);
    expect(state.players[0]!.taken).toEqual([63]);
    expect(state.rows).toEqual([[10, 13], [25], [40, 44, 48], [4, 7]]);
    expect(state.phase).toBe("select");
    expect(state.reveal!.done).toBe(true);
  });

  it("规则书#TC6 甲超时：自动选第 4 排（牛头最少）", () => {
    const waiting = playOnRows(rows, [4, 7]);
    const state = timeoutTurn(waiting);
    expect(state.events[0]).toEqual({ type: "TimedOut", phase: "chooseRow", players: [甲] });
    expect(state.reveal!.steps[0]).toMatchObject({ kind: "low", player: 甲, row: 3, bulls: 1, auto: true });
    expect(state.rows[3]).toEqual([4, 7]);
  });
});

describe("规则书#TC7 / 例 1 一手里的完整结算", () => {
  const rows = [[10, 13], [20, 21, 23, 24, 25], [40, 44, 48], [63]];

  it("规则书#TC7 规则书#例1 甲 4、乙 7、丙 30、丁 50：最后 [10,13][30][40,44,48,50][4,7]，罚分 1/0/8/0", () => {
    const waiting = playOnRows(rows, [4, 7, 30, 50]);
    expect(waiting.phase).toBe("chooseRow");
    expect(waiting.chooser).toBe(甲);
    const state = applyCommand(waiting, 甲, { type: "chooseRow", row: 3 });
    expect(state.rows).toEqual([[10, 13], [30], [40, 44, 48, 50], [4, 7]]);
    expect(bullsOf(state)).toEqual([1, 0, 8, 0]);
    // 逐张的事件：甲收第 4 排 → 7 接到 4 后面 → 丙第六张收第 2 排 → 50 接第 3 排
    expect(state.events).toEqual([
      { type: "RowTaken", player: 甲, card: 4, row: 3, cards: [63], bulls: 1, reason: "low" },
      { type: "CardPlaced", player: 乙, card: 7, row: 3, position: 2 },
      { type: "RowTaken", player: 丙, card: 30, row: 1, cards: [20, 21, 23, 24, 25], bulls: 8, reason: "sixth" },
      { type: "CardPlaced", player: 丁, card: 50, row: 2, position: 4 },
      { type: "HandEnded", round: 1, turn: 1, bulls: { [甲]: 1, [乙]: 0, [丙]: 8, [丁]: 0 } },
    ]);
  });
});

describe("规则书#TC8–TC10 局末和终局", () => {
  /** 三人在第 10 手（各剩 1 张，出了都安全），本局已收的牌给定。 */
  function lastHand(totals: number[], taken: number[][]): GameState {
    return buildGame({
      players: [
        { hand: [3], total: totals[0]!, taken: taken[0]! },
        { hand: [31], total: totals[1]!, taken: taken[1]! },
        { hand: [51], total: totals[2]!, taken: taken[2]! },
      ],
      rows: [[1, 2], [28], [50], [80]],
    });
  }

  it("规则书#TC8 累计 20/30/40、本局各收 10 → 30/40/50，没到 66 → 新的一局：重新洗 104 张、每人 10 张、4 张排头、round+1、taken 清空", () => {
    const start = lastHand([20, 30, 40], [[11, 22], [33, 44], [66, 77]]);
    expect(bullsOf(start)).toEqual([10, 10, 10]);
    const ended = playHand(start, [3, 31, 51]);
    expect(ended.phase).toBe("roundEnd");
    expect(ended.players.map((player) => player.total)).toEqual([30, 40, 50]);
    expect(ended.history.at(-1)).toEqual({ round: 1, bulls: { p1: 10, p2: 10, p3: 10 }, totals: { p1: 30, p2: 40, p3: 50 } });
    expect(ended.finalResult).toBeUndefined();

    const next = allReady(ended);
    expect(next.phase).toBe("select");
    expect(next.round).toBe(2);
    expect(next.turn).toBe(1);
    expect(next.players.every((player) => player.hand.length === 10 && player.taken.length === 0 && player.roundBulls === 0)).toBe(true);
    expect(next.players.map((player) => player.total)).toEqual([30, 40, 50]);
    expect(next.rows).toHaveLength(4);
    expect(next.rows.every((row) => row.length === 1)).toBe(true);
    const everything = [...next.players.flatMap((player) => player.hand), ...next.rows.flat(), ...next.deck!].sort((a, b) => a - b);
    expect(everything).toEqual(cardsInPlay(3, false));
    expect(next.seenCards.sort((a, b) => a - b)).toEqual(next.rows.flat().sort((a, b) => a - b));
  });

  it("规则书#TC9 规则书#例2 累计 58/22/40、本局 8/8/3 → 66/30/43 → gameOver，winners = [乙]（正好 66 也结束）", () => {
    const start = lastHand([58, 22, 40], [[10, 20, 15], [30, 40, 25], [4, 6, 7]]);
    expect(bullsOf(start)).toEqual([8, 8, 3]);
    const over = playHand(start, [3, 31, 51]);
    expect(over.players.map((player) => player.total)).toEqual([66, 30, 43]);
    expect(over.phase).toBe("gameOver");
    expect(over.finalResult).toEqual({ winners: [乙], totals: { p1: 66, p2: 30, p3: 43 }, rounds: 1, reason: "target" });
    expect(over.events.at(-1)).toEqual({ type: "GameEnded", winners: [乙], totals: { p1: 66, p2: 30, p3: 43 }, reason: "target" });
    expect(legalActions(over, 甲)).toEqual([]);
    expect(() => applyCommand(over, 甲, { type: "nextRound" })).toThrow();
  });

  it("规则书#TC10 并列获胜：终局累计 70/25/25 → winners = [乙, 丙]", () => {
    const start = lastHand([60, 20, 20], [[11, 22], [33], [44]]);
    const over = playHand(start, [3, 31, 51]);
    expect(over.players.map((player) => player.total)).toEqual([70, 25, 25]);
    expect(over.finalResult!.winners).toEqual([乙, 丙]);
  });
});

describe("规则书#TC11–TC12 发牌", () => {
  it("规则书#TC11 3 人战术：只用 1–34；30 张手牌 + 4 张排头后 deck 为空；这 34 张牛头合计 55", () => {
    const state = createGame([{ id: "a", name: "甲" }, { id: "b", name: "乙" }, { id: "c", name: "丙" }], 123, { tactics: true });
    const dealt = [...state.players.flatMap((player) => player.hand), ...state.rows.flat()].sort((a, b) => a - b);
    expect(dealt).toEqual(Array.from({ length: 34 }, (_, index) => index + 1));
    expect(state.players.every((player) => player.hand.length === 10)).toBe(true);
    expect(state.deck).toEqual([]);
    expect(sumBulls(dealt)).toBe(55);
  });

  it("规则书#TC12 10 人：100 张手牌 + 4 张排头，deck 为空", () => {
    const players = Array.from({ length: 10 }, (_, index) => ({ id: `p${index + 1}`, name: `玩家${index + 1}` }));
    const state = createGame(players, 99);
    expect(state.players.flatMap((player) => player.hand)).toHaveLength(100);
    expect(state.rows.flat()).toHaveLength(4);
    expect(state.deck).toEqual([]);
    const all = [...state.players.flatMap((player) => player.hand), ...state.rows.flat()].sort((a, b) => a - b);
    expect(all).toEqual(cardsInPlay(10, false));
  });

  it("规则书#5 2 人局照常玩：每人 10 张 + 4 张排头，其余 80 张不用", () => {
    const state = createGame([{ id: "a", name: "甲" }, { id: "b", name: "乙" }], 5);
    expect(state.players.map((player) => player.hand.length)).toEqual([10, 10]);
    expect(state.deck).toHaveLength(80);
  });
});

describe("规则书#TC13 选牌校验", () => {
  it("规则书#TC13 选一张不在自己手里的牌 → 拒绝", () => {
    const state = buildGame({ players: [{ include: [5] }, { include: [6] }], rows: [[10], [20], [30], [40]] });
    expect(() => applyCommand(state, 甲, { type: "select", card: 6 })).toThrow("这张牌不在你手里");
    expect(() => applyCommand(state, 甲, { type: "select", card: 200 })).toThrow();
    expect(() => applyCommand(state, 甲, { type: "select", card: "5" as unknown as number })).toThrow();
    expect(() => applyCommand(state, "nobody", { type: "select", card: 5 })).toThrow("你不在这局里");
  });

  it("规则书#TC13 已经亮牌之后再 select → 拒绝（chooseRow 阶段、下一手开始前的局末阶段都不行）", () => {
    const waiting = playOnRows([[10, 13], [25], [40, 44, 48], [63]], [4, 7]);
    expect(waiting.phase).toBe("chooseRow");
    for (const player of waiting.players) {
      for (const card of player.hand) expect(() => applyCommand(waiting, player.id, { type: "select", card })).toThrow("现在不是选牌的时候");
      expect(() => applyCommand(waiting, player.id, { type: "unselect" })).toThrow();
    }
  });

  it("规则书#TC13 不是 chooser 的人发 chooseRow → 拒绝；row 不在 0–3 → 拒绝", () => {
    const waiting = playOnRows([[10, 13], [25], [40, 44, 48], [63]], [4, 7]);
    expect(() => applyCommand(waiting, 乙, { type: "chooseRow", row: 0 })).toThrow("不是你选排");
    for (const row of [-1, 4, 1.5, Number.NaN]) expect(() => applyCommand(waiting, 甲, { type: "chooseRow", row })).toThrow("排号不对");
    expect(() => applyCommand(waiting, 甲, { type: "chooseRow", row: "1" as unknown as number })).toThrow("排号不对");
    // 选牌阶段发 chooseRow 也拒绝
    const fresh = buildGame({ players: 2 });
    expect(() => applyCommand(fresh, 甲, { type: "chooseRow", row: 0 })).toThrow("现在不需要选排");
  });
});

describe("规则书#5 特殊情况和边界", () => {
  it("规则书#5 一排已有 5 张、同一手两张牌都要接到这一排：小的先收 5 张成为新排头，大的接在它后面", () => {
    const state = playOnRows([[10], [20, 21, 23, 24, 25], [40], [63]], [27, 26]);
    expect(state.players[1]!.taken).toEqual([20, 21, 23, 24, 25]);
    expect(state.players[0]!.taken).toEqual([]);
    expect(state.rows[1]).toEqual([26, 27]);
  });

  it("规则书#5 规则 C 时好几排牛头一样少：由玩家自己选，选哪排都行（不强制选最少的）", () => {
    const rows = [[41, 42], [61, 62], [15], [97, 98]];
    expect(rowsBulls(rows)).toEqual([2, 2, 2, 2]);
    for (const row of [0, 1, 2, 3]) {
      const state = applyCommand(playOnRows(rows, [4, 99]), 甲, { type: "chooseRow", row });
      expect(state.players[0]!.taken).toEqual(rows[row]);
    }
    // 牛头更多的排也可以选
    const pricey = applyCommand(playOnRows([[10, 13], [25], [40, 44, 48], [63]], [4, 99]), 甲, { type: "chooseRow", row: 2 });
    expect(pricey.players[0]!.roundBulls).toBe(9);
  });

  it("规则书#5 规则 C 收的那一排不满 5 张：有几张收几张", () => {
    const state = applyCommand(playOnRows([[10, 13], [25], [40, 44, 48], [63]], [4, 99]), 甲, { type: "chooseRow", row: 2 });
    expect(state.players[0]!.taken).toEqual([40, 44, 48]);
    expect(state.rows[2]).toEqual([4]);
  });

  it("规则书#5 规则 C 收走一排后，同一手后面的牌按新的 4 排结算（可能接到别处、甚至成第六张）", () => {
    // 甲 25 收第 1 排后，乙的 62 本想接 61，改去满排 → 第六张
    const state = applyCommand(playOnRows([[58, 61], [30, 33, 36, 38, 40], [70], [90]], [25, 62]), 甲, { type: "chooseRow", row: 0 });
    expect(state.reveal!.steps.map((step) => step.kind)).toEqual(["low", "sixth"]);
    expect(state.players[1]!.roundBulls).toBe(13);
  });

  it("规则书#4.3 局中超过目标分也要打完这一局，只在局末检查", () => {
    const start = buildGame({ players: [{ include: [30], total: 65 }, { include: [64] }], rows: [[10], [20, 21, 23, 24, 25], [40], [63]], turn: 3 });
    const state = playHand(start, [30, 64]);
    expect(state.players[0]!.roundBulls).toBe(8);
    expect(state.phase).toBe("select");
    expect(state.players[0]!.total).toBe(65);
  });
});
