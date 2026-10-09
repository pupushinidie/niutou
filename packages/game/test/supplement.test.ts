/**
 * 补充文件（~/Desktop/游戏规则/谁是牛头王-补充.md）里的局面例子和勘误，逐条写成单测：
 * 二、教学要点 1–11 的演示局面；2.2 教程剧本前 5 手；1.8 例 A–D 里的结算事实；三、勘误（并列获胜、超时代打、战术模式牛头合计）。
 */
import { describe, expect, it } from "vitest";
import {
  applyCommand,
  baselineCard,
  baselineCommand,
  baselineRow,
  buildGame,
  bullheads,
  cardsInPlay,
  playHand,
  redactGameForViewer,
  resolvePlays,
  rowsBulls,
  sumBulls,
  targetRow,
  timeoutTurn,
} from "../src/index.js";
import { bullsOf, playOnRows, 乙, 甲 } from "./helpers.js";

/** 只有一张牌的演示：直接用规则的纯函数结算（引擎和它共用同一份代码）。 */
function solo(rows: number[][], card: number, choose?: number) {
  return resolvePlays(rows, [{ player: "你", card }], choose === undefined ? undefined : () => choose);
}

describe("补充#教学要点（二）", () => {
  it("补充#教学1 罚分：[52,53,55,57,59] 满排，出 60 → 收 1+1+7+1+1 = 11 分，第 3 排变 [60]", () => {
    const result = solo([[3], [20], [52, 53, 55, 57, 59], [80]], 60);
    expect(result.steps[0]).toMatchObject({ kind: "sixth", row: 2, taken: [52, 53, 55, 57, 59], bulls: 11 });
    expect(result.rows[2]).toEqual([60]);
    // 走引擎：两人局，另一人出的牌放在后面不影响
    const state = playOnRows([[3], [20], [52, 53, 55, 57, 59], [80]], [60, 81]);
    expect(state.players[0]!.roundBulls).toBe(11);
  });

  it("补充#教学2 牛头看牌面：55 一张 7 个；[41,42,43] 共 3 个、[44] 一张就 5 个", () => {
    expect(bullheads(55)).toBe(7);
    expect(sumBulls([41, 42, 43])).toBe(3);
    expect(sumBulls([44])).toBe(5);
  });

  it("补充#教学3 同时选牌、从小到大放：甲 33、乙 31 → 第 2 排 [30,31,33]", () => {
    const state = playOnRows([[10], [30], [50], [70]], [33, 31]);
    expect(state.rows[1]).toEqual([30, 31, 33]);
    expect(state.reveal!.plays).toEqual([{ player: 乙, card: 31 }, { player: 甲, card: 33 }]);
  });

  it("补充#教学4 只看排尾：[10,25] [15] [50] [70]，出 20 → 只能接 15 → [15,20]", () => {
    expect(targetRow([[10, 25], [15], [50], [70]], 20)).toBe(1);
    expect(solo([[10, 25], [15], [50], [70]], 20).rows[1]).toEqual([15, 20]);
  });

  it("补充#教学5 差值最小、唯一确定：[12] [33] [38] [60]，出 40 → 接 38", () => {
    expect(solo([[12], [33], [38], [60]], 40).rows).toEqual([[12], [33], [38, 40], [60]]);
  });

  it("补充#教学6 第六张收牌：[41,42,43,44,46]，出 48 → 收 1+1+1+5+1 = 9 分，第 3 排变 [48]", () => {
    const result = solo([[3], [20], [41, 42, 43, 44, 46], [80]], 48);
    expect(result.steps[0]).toMatchObject({ kind: "sixth", bulls: 9, taken: [41, 42, 43, 44, 46] });
    expect(result.rows[2]).toEqual([48]);
  });

  it("补充#教学7 前面的牌改变后面的去向：[30,31,32,34]，甲 36、乙 37 → 36 成第 5 张，37 成第六张 → 乙收 7 分；乙单独出 37 本来安全", () => {
    const rows = [[10], [30, 31, 32, 34], [50], [70]];
    const state = playOnRows(rows, [36, 37]);
    expect(bullsOf(state)).toEqual([0, 7]);
    expect(state.players[1]!.taken).toEqual([30, 31, 32, 34, 36]);
    expect(state.rows[1]).toEqual([37]);
    expect(solo(rows, 37).steps[0]).toMatchObject({ kind: "place", position: 5, bulls: 0 });
  });

  it("补充#教学8 比所有排尾都小：自己选一排整排收走，你的牌成新排头（[23] 只罚 1 分）", () => {
    const rows = [[23], [35, 36], [50, 51, 53, 56, 59], [77, 80]];
    expect(rowsBulls(rows)).toEqual([1, 3, 7, 8]);
    const waiting = playOnRows(rows, [9, 81]);
    expect(waiting.phase).toBe("chooseRow");
    const state = applyCommand(waiting, 甲, { type: "chooseRow", row: 0 });
    expect(state.players[0]!.roundBulls).toBe(1);
    expect(state.rows[0]).toEqual([9]);
    // 不满 5 张也整排收走（规则书第 5 节）
    const other = applyCommand(waiting, 甲, { type: "chooseRow", row: 3 });
    expect(other.players[0]!.taken).toEqual([77, 80]);
    expect(other.players[0]!.roundBulls).toBe(8);
  });

  it("补充#教学9 收完一排后按新的 4 排继续：甲 9 收第 1 排，乙 12 接在 9 后面免费", () => {
    const waiting = playOnRows([[23], [35, 36], [50, 51, 53, 56, 59], [77, 80]], [9, 12]);
    const state = applyCommand(waiting, 甲, { type: "chooseRow", row: 0 });
    expect(state.rows[0]).toEqual([9, 12]);
    expect(bullsOf(state)).toEqual([1, 0]);
  });

  it("补充#教学9 反例：甲 25 收第 1 排 [58,61]，乙的 62 改去满排第 2 排 → 收 13 分", () => {
    const waiting = playOnRows([[58, 61], [30, 33, 36, 38, 40], [70], [90]], [25, 62]);
    const state = applyCommand(waiting, 甲, { type: "chooseRow", row: 0 });
    expect(bullsOf(state)).toEqual([2, 13]);
    expect(state.rows).toEqual([[25], [62], [70], [90]]);
  });

  it("补充#教学10 收来的牌不进手牌：手牌 10 张变 9 张，收来的 5 张进收牌堆", () => {
    const state = playOnRows([[3], [20], [41, 42, 43, 44, 46], [80]], [48, 81]);
    const me = state.players[0]!;
    expect(me.hand).toHaveLength(9);
    expect(me.handCount).toBe(9);
    expect(me.taken).toEqual([41, 42, 43, 44, 46]);
    expect(me.hand.some((card) => me.taken.includes(card) || card === 48)).toBe(false);
  });

  it("补充#教学11 只在局末检查：累计 60/40/50、本局 9/20/3 → 69/60/53 → 结束，丙赢", () => {
    const start = buildGame({
      players: [
        { hand: [3], total: 60, taken: [10, 20, 30] },
        { hand: [31], total: 40, taken: [11, 22, 33, 44] },
        { hand: [51], total: 50, taken: [4, 6, 7] },
      ],
      rows: [[1, 2], [28], [50], [80]],
    });
    expect(bullsOf(start)).toEqual([9, 20, 3]);
    const over = playHand(start, [3, 31, 51]);
    expect(over.players.map((player) => player.total)).toEqual([69, 60, 53]);
    expect(over.finalResult!.winners).toEqual(["p3"]);
  });

  it("补充#教学11 局中收到 66 以上也要打完这一局", () => {
    // 甲已经 60 分，第 5 手又收了满排（第六张），本局牛头 > 6，但这一局还没完
    const start = buildGame({
      players: [{ include: [30], total: 60 }, { include: [64] }],
      rows: [[10], [20, 21, 23, 24, 25], [40], [63]],
      turn: 5,
    });
    const state = playHand(start, [30, 64]);
    expect(state.players[0]!.total + state.players[0]!.roundBulls).toBeGreaterThanOrEqual(66);
    expect(state.phase).toBe("select");
    expect(state.turn).toBe(6);
    expect(state.finalResult).toBeUndefined();
  });
});

describe("补充#教程剧本（2.2）", () => {
  it("补充#教程剧本 3 人固定发牌前 5 手：结果和剧本表一致", () => {
    const me = [44, 45, 27, 5, 11, 33, 62, 78, 91, 100];
    const one = [10, 46, 47, 7, 56, 15, 38, 60, 83, 97];
    const two = [26, 70, 49, 28, 55, 19, 52, 73, 86, 103];
    // 34 张不重复（剧本说已校验）
    expect(new Set([...me, ...one, ...two, 8, 24, 41, 67]).size).toBe(34);
    let state = buildGame({ players: [{ hand: me }, { hand: one }, { hand: two }], rows: [[8], [24], [41], [67]] });

    // 第 1 手：44 / 10 / 26 → 无人收牌
    state = playHand(state, [44, 10, 26]);
    expect(state.rows).toEqual([[8, 10], [24, 26], [41, 44], [67]]);
    expect(bullsOf(state)).toEqual([0, 0, 0]);

    // 第 2 手：45 / 46 / 70 → 第 3 排 4 张；70 接第 4 排
    state = playHand(state, [45, 46, 70]);
    expect(state.rows).toEqual([[8, 10], [24, 26], [41, 44, 45, 46], [67, 70]]);

    // 第 3 手：27 / 47 / 49 → 47 第 5 张，49 第六张 → 二号收 41、44、45、46、47 = 10 分
    state = playHand(state, [27, 47, 49]);
    expect(state.rows).toEqual([[8, 10], [24, 26, 27], [49], [67, 70]]);
    expect(state.players[2]!.taken).toEqual([41, 44, 45, 46, 47]);
    expect(bullsOf(state)).toEqual([0, 0, 10]);
    expect(rowsBulls(state.rows)).toEqual([4, 3, 1, 4]);

    // 第 4 手：5 / 7 / 28 → 你的 5 比所有排尾都小，选第 3 排 [49] 罚 1；7 接在 5 后面；28 接第 2 排
    state = playHand(state, [5, 7, 28]);
    expect(state.phase).toBe("chooseRow");
    expect(state.chooser).toBe(甲);
    state = applyCommand(state, 甲, { type: "chooseRow", row: 2 });
    expect(state.rows).toEqual([[8, 10], [24, 26, 27, 28], [5, 7], [67, 70]]);
    expect(bullsOf(state)).toEqual([1, 0, 10]);

    // 第 5 手：11 / 56 / 55 → 55 第 5 张，56 第六张 → 一号收 24、26、27、28、55 = 11 分
    state = playHand(state, [11, 56, 55]);
    expect(state.rows).toEqual([[8, 10, 11], [56], [5, 7], [67, 70]]);
    expect(state.players[1]!.taken).toEqual([24, 26, 27, 28, 55]);
    expect(bullsOf(state)).toEqual([1, 11, 10]);
    expect(state.turn).toBe(6);
  });
});

describe("补充#1.8 局面例子里的结算事实", () => {
  it("补充#例A 22 指向已满的第 1 排，必收 5 分；95 指向只有 1 张的第 4 排", () => {
    const rows = [[3, 8, 14, 17, 21], [33, 36], [47, 49, 52, 56], [70]];
    expect(rowsBulls(rows)).toEqual([5, 6, 4, 3]);
    expect(solo(rows, 22).steps[0]).toMatchObject({ kind: "sixth", bulls: 5 });
    expect(targetRow(rows, 95)).toBe(3);
  });

  it("补充#例B 20 必收 8、68 必收 7、出 2 收第 2 排 [45] 确定 2 分", () => {
    const rows = [[10, 13, 15, 18, 19], [45], [60, 61, 63, 64, 67], [80, 84, 88, 90]];
    expect(rowsBulls(rows)).toEqual([8, 2, 7, 12]);
    expect(solo(rows, 20).steps[0]!.bulls).toBe(8);
    expect(solo(rows, 68).steps[0]!.bulls).toBe(7);
    expect(solo(rows, 2, 1).steps[0]).toMatchObject({ kind: "low", row: 1, bulls: 2 });
  });

  it("补充#例C 规则 C 选排的三种结果和表格一致（甲都收 9）", () => {
    const rows = [[41, 42, 43], [61, 62, 63], [44, 46, 47, 48, 49], [90]];
    expect(rowsBulls(rows)).toEqual([3, 3, 9, 3]);
    const after = (row: number) => {
      const waiting = playOnRows(rows, [4, 50, 64, 97]);
      return applyCommand(waiting, 甲, { type: "chooseRow", row });
    };
    expect(after(0).rows).toEqual([[4], [61, 62, 63, 64], [50], [90, 97]]);
    expect(after(1).rows).toEqual([[41, 42, 43], [4], [50, 64], [90, 97]]);
    expect(after(3).rows).toEqual([[41, 42, 43], [61, 62, 63, 64, 97], [50], [4]]);
    for (const row of [0, 1, 3]) expect(after(row).players[1]!.roundBulls).toBe(9);
    // 基线选排（超时代打用）：三排都是 3 个牛头，取排尾最大的第 4 排。
    // 注意：补充文件说「收第 2 排也符合收排尾最大」，其实第 4 排 [90] 的排尾更大；正式人机按 1.5 节算后果会选第 2 排。
    expect(baselineRow(rows)).toBe(3);
  });

  it("补充#例D 别人的规则 C 改变我的去向：甲 25 收第 1 排后，我的 62 成了满排的第六张 → 13 分；72 不受影响", () => {
    const rows = [[58, 61], [30, 33, 36, 38, 40], [70], [90]];
    expect(rowsBulls(rows)).toEqual([2, 13, 3, 3]);
    // 甲按基线（牛头最少）选第 1 排
    expect(baselineRow(rows)).toBe(0);
    const bad = timeoutTurn(playOnRows(rows, [25, 62]));
    expect(bullsOf(bad)).toEqual([2, 13]);
    const good = timeoutTurn(playOnRows(rows, [25, 72]));
    expect(bullsOf(good)).toEqual([2, 0]);
    expect(good.rows[2]).toEqual([70, 72]);
  });
});

describe("补充#勘误（三）", () => {
  it("补充#勘误3.2-1 罚分并列最少 → 共同获胜（官方 30 周年版）", () => {
    const over = playHand(
      buildGame({
        players: [{ hand: [3], total: 30 }, { hand: [31], total: 30 }, { hand: [51], total: 50 }, { hand: [81], total: 70 }],
        rows: [[1, 2], [28], [50], [80]],
      }),
      [3, 31, 51, 81],
    );
    expect(over.finalResult!.winners).toEqual(["p1", "p2"]);
  });

  it("补充#勘误3.2-5 规则 C 超时代选：牛头最少 → 排尾最大 → 排号最小", () => {
    // 牛头最少的唯一一排
    expect(baselineRow([[10, 13], [25], [40, 44, 48], [63]])).toBe(3);
    // 牛头一样（都是 2）：选排尾最大的（不是张数最少的）
    expect(baselineRow([[41, 42], [61, 62], [15], [97, 98]])).toBe(3);
    expect(baselineRow([[41, 42], [99, 100], [15], [61, 62]])).toBe(3);
    // 牛头、排尾都分不出来不可能（排尾都不同），所以第三比较项只在理论上用到
  });

  it("补充#勘误3.2-6 / 1.11 选牌超时按简单基线出牌，不是出最小的牌", () => {
    // 手里最小的 2 比所有排尾都小（出它就要收排）；能安全接上的牌里 41 差值最小
    expect(baselineCard([2, 41, 66, 99], [[10, 13], [25], [40], [63, 64, 65, 67]])).toBe(41);
    const start = buildGame({
      players: [{ hand: [2, 41, 66, 99, 100, 101, 102, 103, 104, 1] }, { include: [27] }],
      rows: [[10, 13], [25], [40], [63]],
    });
    const after = timeoutTurn(start);
    expect(after.events[0]).toEqual({ type: "TimedOut", phase: "select", players: [甲, 乙] });
    expect(after.reveal!.plays.find((play) => play.player === 甲)!.card).toBe(41);
    // 没有能安全接上的牌：出最小的
    expect(baselineCard([30, 70], [[10, 20, 22, 24, 26], [5], [60, 61, 62, 63, 64], [90]])).toBe(30);
    expect(baselineCard([31, 65], [[10, 20, 22, 24, 26], [100], [60, 61, 62, 63, 64], [90]])).toBe(31);
    // 差值一样时出小的
    expect(baselineCard([22, 12], [[10], [20], [40], [63]])).toBe(12);
  });

  it("补充#勘误3.2-6 代打只用这个座位看得到的信息（拿 redact 后的状态也能算出同样的牌）", () => {
    const start = buildGame({ players: 4, rows: [[10, 13], [25], [40], [63]], seed: 11 });
    for (const player of start.players) {
      const view = redactGameForViewer(start, player.id);
      expect(baselineCommand(view, player.id)).toEqual(baselineCommand(start, player.id));
    }
  });

  it("补充#勘误3.1 战术模式各人数牛头合计：2 人 38、3 人 55、4 人 72、5 人 85、6 人 103、7 人 120、8 人 137、9 人 154、10 人 171", () => {
    const expected = { 2: 38, 3: 55, 4: 72, 5: 85, 6: 103, 7: 120, 8: 137, 9: 154, 10: 171 } as Record<number, number>;
    for (let count = 2; count <= 10; count += 1) {
      const cards = cardsInPlay(count, true);
      expect(cards, `${count} 人`).toEqual(Array.from({ length: count * 10 + 4 }, (_, index) => index + 1));
      expect(sumBulls(cards), `${count} 人`).toBe(expected[count]);
    }
  });

  it("补充#勘误3.1 每一手最多一次规则 C，而且触发它的一定是这一手最小的牌", () => {
    // 两张都比所有排尾小：只有最小的那张触发规则 C，第二张接在它后面
    const waiting = playOnRows([[50], [60], [70], [80]], [5, 3, 90]);
    expect(waiting.chooser).toBe(乙);
    const state = applyCommand(waiting, 乙, { type: "chooseRow", row: 0 });
    expect(state.phase).toBe("select");
    expect(state.rows[0]).toEqual([3, 5]);
    expect(state.reveal!.steps.filter((step) => step.kind === "low")).toHaveLength(1);
  });
});
