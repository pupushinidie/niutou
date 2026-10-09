/**
 * 规则核对：规则书 4.1–4.2（同时选牌、从小到大结算、规则 A / B / C）、第 5 节特殊情况、
 * 第 6 节例 1，TC2–TC7。局面用 buildGame 造，动作全部走 apply。
 */
import { describe, expect, it } from "vitest";
import {
	buildGame,
	legalActions,
	placeCard,
	resolvePlays,
	rowsBulls,
	sortPlays,
	takeLowRow,
	targetRow,
	waitingFor,
	type GameState,
} from "../../src/index.js";
import { choose, expectRejected, ofType, playAll, player, refResolve, refTarget } from "./ref.js";

/** 造一个第 1 手的局面：rows 是 4 排，plays 里每人的牌一定在手里（其余手牌随机）。 */
function table(rows: number[][], plays: Record<string, number>, seed = 3): GameState {
	return buildGame({
		players: Object.entries(plays).map(([id, card]) => ({ id, include: [card] })),
		rows,
		seed,
	});
}

describe("[规则核对] §4.2 规则 A：只看排尾、差值最小", () => {
	it("TC2：[10]·[25]·[40]·[63]，出 27、41、70、12 → [10,12]·[25,27]·[40,41]·[63,70]，无人收牌", () => {
		const s0 = table([[10], [25], [40], [63]], { p1: 27, p2: 41, p3: 70, p4: 12 });
		const { state, events } = playAll(s0, { p1: 27, p2: 41, p3: 70, p4: 12 });
		expect(state.rows).toEqual([[10, 12], [25, 27], [40, 41], [63, 70]]);
		for (const p of state.players) {
			expect(p.taken).toEqual([]);
			expect(p.roundBulls).toBe(0);
		}
		expect(ofType(events, "RowTaken")).toHaveLength(0);
		const hand = ofType(events, "HandEnded");
		expect(hand).toHaveLength(1);
		expect(hand[0]!.bulls).toEqual({ p1: 0, p2: 0, p3: 0, p4: 0 });
		expect(state.phase).toBe("select");
		expect(state.turn).toBe(2);
	});

	it("教学 4：[10,25]·[15]·[50]·[70] 出 20 → 不看第一张，只能接排尾 15 → [15,20]", () => {
		const { state } = playAll(table([[10, 25], [15], [50], [70]], { p1: 20, p2: 51 }), { p1: 20, p2: 51 });
		expect(state.rows[1]).toEqual([15, 20]);
		expect(state.rows[0]).toEqual([10, 25]);
	});

	it("教学 5：[12]·[33]·[38]·[60] 出 40 → 最接近的 38，不能放到第 2 排", () => {
		const { state } = playAll(table([[12], [33], [38], [60]], { p1: 40, p2: 61 }), { p1: 40, p2: 61 });
		expect(state.rows).toEqual([[12], [33], [38, 40], [60, 61]]);
	});

	it("targetRow 辅助函数和规则书一致（含规则 C 返回 null）", () => {
		const rows = [[10, 13], [20, 21, 23, 24, 25], [40, 44, 48], [63]];
		expect(targetRow(rows, 4)).toBeNull();
		expect(targetRow(rows, 12)).toBeNull();
		expect(targetRow(rows, 14)).toBe(0);
		expect(targetRow(rows, 30)).toBe(1);
		expect(targetRow(rows, 50)).toBe(2);
		expect(targetRow(rows, 104)).toBe(3);
		for (let c = 1; c <= 104; c++) {
			if (rows.flat().includes(c)) continue;
			expect(targetRow(rows, c), `牌 ${c}`).toBe(refTarget(rows, c));
		}
	});
});

describe("[规则核对] §4.2 从小到大结算、同一手相互影响", () => {
	it("TC3：[10]·[25]·[40]·[63]，两人出 27、26（顺序反着选）→ 第 2 排 [25,26,27]", () => {
		const s0 = table([[10], [25], [40], [63]], { p1: 27, p2: 26 });
		const { state, events } = playAll(s0, { p1: 27, p2: 26 });
		expect(state.rows[1]).toEqual([25, 26, 27]);
		// 亮牌事件里的牌按从小到大，结算也按这个顺序
		const rev = ofType(events, "Revealed");
		expect(rev).toHaveLength(1);
		expect(rev[0]!.plays.map((p) => p.card)).toEqual([26, 27]);
		const placed = ofType(events, "CardPlaced");
		expect(placed.map((e) => [e.player, e.card, e.row, e.position])).toEqual([
			["p2", 26, 1, 2],
			["p1", 27, 1, 3],
		]);
	});

	it("教学 3：[10]·[30]·[50]·[70]，甲 33、乙 31 → 31 先放，第 2 排 [30,31,33]", () => {
		const { state } = playAll(table([[10], [30], [50], [70]], { p1: 33, p2: 31 }), { p1: 33, p2: 31 });
		expect(state.rows[1]).toEqual([30, 31, 33]);
	});

	it("reveal 记下亮牌时的 4 排、按从小到大的 plays 和逐张结算的 steps", () => {
		const s0 = table([[10], [25], [40], [63]], { p1: 27, p2: 41, p3: 70, p4: 12 });
		const { state } = playAll(s0, { p1: 27, p2: 41, p3: 70, p4: 12 });
		const rv = state.reveal!;
		expect(rv.round).toBe(1);
		expect(rv.turn).toBe(1);
		expect(rv.done).toBe(true);
		expect(rv.rowsBefore).toEqual([[10], [25], [40], [63]]);
		expect(rv.plays.map((p) => [p.player, p.card])).toEqual([["p4", 12], ["p1", 27], ["p2", 41], ["p3", 70]]);
		expect(rv.steps.map((st) => [st.kind, st.card, st.row, st.position])).toEqual([
			["place", 12, 0, 2],
			["place", 27, 1, 2],
			["place", 41, 2, 2],
			["place", 70, 3, 2],
		]);
		expect(rv.steps[3]!.rows).toEqual(state.rows);
		// 亮出的牌离开手牌，手牌少一张；本局亮过的牌加上这 4 张
		for (const p of state.players) {
			expect(p.hand).toHaveLength(9);
			expect(p.handCount).toBe(9);
			expect(p.selected).toBe(false);
			expect(p.selection).toBeNull();
		}
		expect([...state.seenCards].sort((a, b) => a - b)).toEqual([10, 12, 25, 27, 40, 41, 63, 70]);
	});
});

describe("[规则核对] §4.2 规则 B：第六张收牌", () => {
	it("TC4：第 2 排 [20,21,23,24,25]，出 30 → 收走 5 张罚 8 分，第 2 排变 [30]", () => {
		const s0 = table([[10], [20, 21, 23, 24, 25], [40], [63]], { p1: 30, p2: 41 });
		const { state, events } = playAll(s0, { p1: 30, p2: 41 });
		expect(state.rows).toEqual([[10], [30], [40, 41], [63]]);
		expect(player(state, "p1").taken.sort((a, b) => a - b)).toEqual([20, 21, 23, 24, 25]);
		expect(player(state, "p1").roundBulls).toBe(8);
		expect(player(state, "p2").roundBulls).toBe(0);
		const taken = ofType(events, "RowTaken");
		expect(taken).toHaveLength(1);
		expect(taken[0]).toMatchObject({ player: "p1", card: 30, row: 1, bulls: 8, reason: "sixth" });
		expect(taken[0]!.cards.sort((a, b) => a - b)).toEqual([20, 21, 23, 24, 25]);
		// 收来的牌不进手牌（教学 10）
		expect(player(state, "p1").hand).toHaveLength(9);
		for (const c of [20, 21, 23, 24, 25]) expect(player(state, "p1").hand).not.toContain(c);
		// 累计罚分要到局末才加（局中 total 只含打完的局）
		expect(player(state, "p1").total).toBe(0);
	});

	it("TC5：第 3 排 [32,35,37,39,40]，出 45 → 看起来接 40，实际是第六张，罚 1+2+1+1+3 = 8 分", () => {
		const s0 = table([[10], [25], [32, 35, 37, 39, 40], [63]], { p1: 45, p2: 64 });
		const { state } = playAll(s0, { p1: 45, p2: 64 });
		expect(state.rows[2]).toEqual([45]);
		expect(player(state, "p1").roundBulls).toBe(8);
	});

	it("第五张安全：一排 4 张时放上去成第 5 张不收牌（新手常错 3）", () => {
		const { state } = playAll(table([[10], [30, 31, 32, 34], [50], [70]], { p1: 37, p2: 51 }), { p1: 37, p2: 51 });
		expect(state.rows[1]).toEqual([30, 31, 32, 34, 37]);
		expect(player(state, "p1").roundBulls).toBe(0);
	});

	it("教学 7：[10]·[30,31,32,34]·[50]·[70]，甲 36、乙 37 → 36 成第 5 张，37 成第六张，乙收 7 分", () => {
		const { state, events } = playAll(table([[10], [30, 31, 32, 34], [50], [70]], { p1: 36, p2: 37 }), { p1: 36, p2: 37 });
		expect(state.rows[1]).toEqual([37]);
		expect(player(state, "p1").roundBulls).toBe(0);
		expect(player(state, "p2").roundBulls).toBe(7);
		expect(player(state, "p2").taken.sort((a, b) => a - b)).toEqual([30, 31, 32, 34, 36]);
		expect(ofType(events, "HandEnded")[0]!.bulls).toEqual({ p1: 0, p2: 7 });
	});

	it("§5：一排已满，同一手两张都要接这一排 → 小的收 5 张成新排头，大的接在它后面", () => {
		const s0 = table([[10], [20, 21, 23, 24, 25], [40], [63]], { p1: 31, p2: 30, p3: 41 });
		const { state, events } = playAll(s0, { p1: 31, p2: 30, p3: 41 });
		expect(state.rows[1]).toEqual([30, 31]);
		expect(player(state, "p2").roundBulls).toBe(8);
		expect(player(state, "p1").roundBulls).toBe(0);
		expect(ofType(events, "RowTaken")).toHaveLength(1);
	});

	it("一手里两次不同排的第六张，各收各的", () => {
		const rows = [[1, 2, 3, 4, 6], [20, 21, 23, 24, 25], [40], [63]];
		const s0 = table(rows, { p1: 7, p2: 30, p3: 64 });
		const { state } = playAll(s0, { p1: 7, p2: 30, p3: 64 });
		expect(state.rows).toEqual([[7], [30], [40], [63, 64]]);
		expect(player(state, "p1").roundBulls).toBe(1 + 1 + 1 + 1 + 1);
		expect(player(state, "p2").roundBulls).toBe(8);
	});
});

describe("[规则核对] §4.2 规则 C：比所有排尾都小", () => {
	const tc6Rows = [[10, 13], [25], [40, 44, 48], [63]];

	it("TC6：4 排牛头 4/2/9/1；甲 4 → 停在 chooseRow 等甲；甲选第 4 排罚 1，乙的 7 接成 [4,7]", () => {
		expect(rowsBulls(tc6Rows)).toEqual([4, 2, 9, 1]);
		const s0 = table(tc6Rows, { p1: 4, p2: 7 });
		const { state: s1, events: e1 } = playAll(s0, { p1: 4, p2: 7 });
		expect(s1.phase).toBe("chooseRow");
		expect(s1.chooser).toBe("p1");
		expect(waitingFor(s1)).toEqual(["p1"]);
		expect(s1.rows).toEqual(tc6Rows); // 还没动
		expect(s1.reveal!.steps).toHaveLength(0);
		expect(s1.reveal!.done).toBe(false);
		expect(s1.reveal!.plays.map((p) => p.card)).toEqual([4, 7]); // 后面没结算的牌大家都看得到
		const cr = ofType(e1, "ChooseRow");
		expect(cr).toHaveLength(1);
		expect(cr[0]).toMatchObject({ player: "p1", card: 4 });
		// 只有 chooser 能选，4 个选项
		expect(legalActions(s1, "p1")).toHaveLength(4);
		expect(legalActions(s1, "p2")).toHaveLength(0);

		const { state: s2, events: e2 } = choose(s1, "p1", 3);
		expect(s2.rows).toEqual([[10, 13], [25], [40, 44, 48], [4, 7]]);
		expect(player(s2, "p1").taken).toEqual([63]);
		expect(player(s2, "p1").roundBulls).toBe(1);
		expect(player(s2, "p2").roundBulls).toBe(0);
		expect(s2.phase).toBe("select");
		expect(s2.chooser).toBeNull();
		expect(s2.turn).toBe(2);
		const rt = ofType(e2, "RowTaken");
		expect(rt).toHaveLength(1);
		expect(rt[0]).toMatchObject({ player: "p1", card: 4, row: 3, cards: [63], bulls: 1, reason: "low" });
		expect(rt[0]!.auto).toBeUndefined();
		expect(s2.reveal!.done).toBe(true);
		expect(s2.reveal!.steps.map((st) => st.kind)).toEqual(["low", "place"]);
	});

	it("规则 C 由玩家自己选，牛头多的排也可以选（只是罚得多）", () => {
		const s1 = playAll(table(tc6Rows, { p1: 4, p2: 7 }), { p1: 4, p2: 7 }).state;
		const s2 = choose(s1, "p1", 2).state;
		expect(player(s2, "p1").roundBulls).toBe(9);
		// 7 现在的排尾是 13、25、4、63 → 接 4
		expect(s2.rows).toEqual([[10, 13], [25], [4, 7], [63]]);
	});

	it("§5：规则 C 收的那一排不满 5 张也整排收走（教学 8：收 [23] 只罚 1 分）", () => {
		const rows = [[23], [35, 36], [50, 51, 53, 56, 59], [77, 80]];
		expect(rowsBulls(rows)).toEqual([1, 3, 7, 8]);
		const s1 = playAll(table(rows, { p1: 9, p2: 81 }), { p1: 9, p2: 81 }).state;
		const s2 = choose(s1, "p1", 0).state;
		expect(s2.rows[0]).toEqual([9]);
		expect(player(s2, "p1").taken).toEqual([23]);
		expect(player(s2, "p1").roundBulls).toBe(1);
	});

	it("教学 9：收完一排后，同一手后面的牌按新的 4 排放：乙的 12 免费接在甲的 9 后面", () => {
		const rows = [[23], [35, 36], [50, 51, 53, 56, 59], [77, 80]];
		const s1 = playAll(table(rows, { p1: 9, p2: 12 }), { p1: 9, p2: 12 }).state;
		expect(s1.phase).toBe("chooseRow");
		const s2 = choose(s1, "p1", 0).state;
		expect(s2.rows[0]).toEqual([9, 12]);
		expect(player(s2, "p2").roundBulls).toBe(0);
	});

	it("教学 9 反例 / 补充例 D：甲 25 收第 1 排后，乙的 62 去了满排成第六张，收 13 分", () => {
		const rows = [[58, 61], [30, 33, 36, 38, 40], [70], [90]];
		const s1 = playAll(table(rows, { p1: 25, p2: 62 }), { p1: 25, p2: 62 }).state;
		const s2 = choose(s1, "p1", 0).state;
		expect(player(s2, "p1").roundBulls).toBe(2);
		expect(player(s2, "p2").roundBulls).toBe(13);
		expect(s2.rows).toEqual([[25], [62], [70], [90]]);
	});

	it("补充例 D：72 接第 3 排 [70]，甲收第 1 排也影响不到它", () => {
		const rows = [[58, 61], [30, 33, 36, 38, 40], [70], [90]];
		const s1 = playAll(table(rows, { p1: 25, p2: 72 }), { p1: 25, p2: 72 }).state;
		const s2 = choose(s1, "p1", 0).state;
		expect(player(s2, "p2").roundBulls).toBe(0);
		expect(s2.rows[2]).toEqual([70, 72]);
	});

	it("一手里只有最小的牌会触发规则 C：两张都比所有排尾小时，第二张接在第一张后面", () => {
		const rows = [[30], [40], [50], [60]];
		const s1 = playAll(table(rows, { p1: 5, p2: 3, p3: 8 }), { p1: 5, p2: 3, p3: 8 }).state;
		expect(s1.chooser).toBe("p2");
		const s2 = choose(s1, "p2", 1).state;
		expect(s2.phase).toBe("select");
		expect(s2.rows).toEqual([[30], [3, 5, 8], [50], [60]]);
	});

	it("规则 C 选排时不能选别的：选牌、撤回、继续都不行；row 必须是 0–3 的整数", () => {
		const s1 = playAll(table(tc6Rows, { p1: 4, p2: 7 }), { p1: 4, p2: 7 }).state;
		expectRejected(s1, "p2", { type: "chooseRow", row: 0 });
		expectRejected(s1, "p1", { type: "chooseRow", row: 4 });
		expectRejected(s1, "p1", { type: "chooseRow", row: -1 });
		expectRejected(s1, "p1", { type: "chooseRow", row: 1.5 });
		const someCard = player(s1, "p2").hand[0]!;
		expectRejected(s1, "p2", { type: "select", card: someCard });
		expectRejected(s1, "p1", { type: "unselect" });
		expectRejected(s1, "p2", { type: "unselect" });
		expectRejected(s1, "p1", { type: "nextRound" });
	});
});

describe("[规则核对] §6 例 1 / TC7 完整复现", () => {
	const rows = [[10, 13], [20, 21, 23, 24, 25], [40, 44, 48], [63]];
	it("甲 4、乙 7、丙 30、丁 50，甲选第 4 排 → [10,13]·[30]·[40,44,48,50]·[4,7]；本手罚分 1/0/8/0", () => {
		const s0 = table(rows, { p1: 4, p2: 7, p3: 30, p4: 50 });
		const s1 = playAll(s0, { p3: 30, p1: 4, p4: 50, p2: 7 }).state;
		expect(s1.phase).toBe("chooseRow");
		expect(s1.chooser).toBe("p1");
		const { state: s2, events } = choose(s1, "p1", 3);
		expect(s2.rows).toEqual([[10, 13], [30], [40, 44, 48, 50], [4, 7]]);
		expect(s2.players.map((p) => p.roundBulls)).toEqual([1, 0, 8, 0]);
		expect(ofType(events, "HandEnded")[0]!.bulls).toEqual({ p1: 1, p2: 0, p3: 8, p4: 0 });
		expect(s2.reveal!.steps.map((st) => [st.kind, st.player, st.card, st.row, st.position, st.bulls])).toEqual([
			["low", "p1", 4, 3, 1, 1],
			["place", "p2", 7, 3, 2, 0],
			["sixth", "p3", 30, 1, 1, 8],
			["place", "p4", 50, 2, 4, 0],
		]);
		// 和独立的参考实现一致
		const ref = refResolve(rows, [{ player: "p1", card: 4 }, { player: "p2", card: 7 }, { player: "p3", card: 30 }, { player: "p4", card: 50 }], () => 3);
		expect(s2.rows).toEqual(ref.rows);
	});
});

describe("[规则核对] 规则纯函数（引擎导出的 placeCard / takeLowRow / resolvePlays）和参考实现一致", () => {
	it("例 1 用 resolvePlays + chooser 一次算完", () => {
		const rows = [[10, 13], [20, 21, 23, 24, 25], [40, 44, 48], [63]];
		const plays = sortPlays([{ player: "丙", card: 30 }, { player: "甲", card: 4 }, { player: "丁", card: 50 }, { player: "乙", card: 7 }]);
		expect(plays.map((p) => p.card)).toEqual([4, 7, 30, 50]);
		const out = resolvePlays(rows, plays, () => 3);
		expect(out.stoppedAt).toBeNull();
		expect(out.rows).toEqual([[10, 13], [30], [40, 44, 48, 50], [4, 7]]);
		const stopped = resolvePlays(rows, plays);
		expect(stopped.stoppedAt).toBe(0);
		expect(stopped.steps).toHaveLength(0);
		expect(rows).toEqual([[10, 13], [20, 21, 23, 24, 25], [40, 44, 48], [63]]); // 不改输入
	});

	it("placeCard：规则 C 的牌返回 null；第六张收 5 张", () => {
		const rows = [[10, 13], [20, 21, 23, 24, 25], [40, 44, 48], [63]];
		expect(placeCard(rows, { player: "x", card: 4 })).toBeNull();
		const st = placeCard(rows, { player: "x", card: 30 })!;
		expect(st).toMatchObject({ kind: "sixth", row: 1, position: 1, bulls: 8 });
		expect(st.rows[1]).toEqual([30]);
		const tl = takeLowRow(rows, { player: "x", card: 4 }, 0);
		expect(tl).toMatchObject({ kind: "low", row: 0, position: 1, taken: [10, 13], bulls: 4 });
		expect(tl.rows[0]).toEqual([4]);
	});
});
