/**
 * 规则核对：补充文件「二、教学要点」1–11 的每个演示局面、2.2 教程剧本前 5 手（固定发牌），
 * 以及「一、人机策略提示」里只涉及规则结算的局面（例 B、例 C 的三种选法、例 D 在 s4-resolve 里）。
 */
import { describe, expect, it } from "vitest";
import { buildGame, sumBulls, targetRow, type GameState } from "../../src/index.js";
import { choose, ofType, playAll, player, refResolve } from "./ref.js";

function table(rows: number[][], plays: Record<string, number>): GameState {
	return buildGame({ players: Object.entries(plays).map(([id, card]) => ({ id, include: [card] })), rows, seed: 11 });
}

describe("[规则核对] 补充 · 教学要点", () => {
	it("教学 1：[3]·[20]·[52,53,55,57,59]·[80]，出 60 → 收 52/53/55/57/59 罚 11 分，第 3 排变 [60]", () => {
		const { state } = playAll(table([[3], [20], [52, 53, 55, 57, 59], [80]], { me: 60, x: 81 }), { me: 60, x: 81 });
		expect(player(state, "me").roundBulls).toBe(11);
		expect(player(state, "me").taken.sort((a, b) => a - b)).toEqual([52, 53, 55, 57, 59]);
		expect(state.rows[2]).toEqual([60]);
	});

	it("教学 2：一张 55 占 7 分；[41,42,43] 3 个牛头，[44] 一张就 5 个", () => {
		expect(sumBulls([52, 53, 55, 57, 59])).toBe(11);
		expect(sumBulls([41, 42, 43])).toBe(3);
		expect(sumBulls([44])).toBe(5);
	});

	it("教学 6：[3]·[20]·[41,42,43,44,46]·[80]，出 48 → 收 1+1+1+5+1 = 9 分，第 3 排变 [48]", () => {
		const { state } = playAll(table([[3], [20], [41, 42, 43, 44, 46], [80]], { me: 48, x: 81 }), { me: 48, x: 81 });
		expect(player(state, "me").roundBulls).toBe(9);
		expect(state.rows[2]).toEqual([48]);
	});

	it("教学 7 的对照：乙单独出 37（没人出 36）本来是安全的第 5 张", () => {
		const { state } = playAll(table([[10], [30, 31, 32, 34], [50], [70]], { 甲: 51, 乙: 37 }), { 甲: 51, 乙: 37 });
		expect(state.rows[1]).toEqual([30, 31, 32, 34, 37]);
		expect(player(state, "乙").roundBulls).toBe(0);
	});

	it("教学 10：收来的牌进收牌堆、不进手牌；手牌每手少一张", () => {
		const s0 = table([[3], [20], [41, 42, 43, 44, 46], [80]], { me: 48, x: 81 });
		expect(player(s0, "me").hand).toHaveLength(10);
		const { state } = playAll(s0, { me: 48, x: 81 });
		const me = player(state, "me");
		expect(me.hand).toHaveLength(9);
		expect(me.handCount).toBe(9);
		expect(me.taken).toHaveLength(5);
		for (const c of me.taken) expect(me.hand).not.toContain(c);
	});
});

describe("[规则核对] 补充 2.2 教程剧本（3 人固定发牌）前 5 手", () => {
	const you = [44, 45, 27, 5, 11, 33, 62, 78, 91, 100];
	const one = [10, 46, 47, 7, 56, 15, 38, 60, 83, 97];
	const two = [26, 70, 49, 28, 55, 19, 52, 73, 86, 103];
	const start = () =>
		buildGame({
			players: [
				{ id: "you", name: "你", hand: you },
				{ id: "g1", name: "咕噜一号", hand: one },
				{ id: "g2", name: "咕噜二号", hand: two },
			],
			rows: [[8], [24], [41], [67]],
		});

	it("固定发牌 34 张不重复", () => {
		const all = [...you, ...one, ...two, 8, 24, 41, 67];
		expect(new Set(all).size).toBe(34);
	});

	it("逐手结算和剧本表一致：第 3 手二号收 10 分，第 4 手你选第 3 排罚 1 分，第 5 手一号收 11 分", () => {
		let s = start();
		const hand = (y: number, a: number, b: number) => playAll(s, { you: y, g1: a, g2: b });

		// 第 1 手：44 / 10 / 26
		let out = hand(44, 10, 26);
		s = out.state;
		expect(s.rows).toEqual([[8, 10], [24, 26], [41, 44], [67]]);
		expect(ofType(out.events, "RowTaken")).toHaveLength(0);

		// 第 2 手：45 / 46 / 70
		out = hand(45, 46, 70);
		s = out.state;
		expect(s.rows).toEqual([[8, 10], [24, 26], [41, 44, 45, 46], [67, 70]]);

		// 第 3 手：27 / 47 / 49 → 47 成第 5 张，49 成第六张，二号收 41/44/45/46/47 = 10 分
		out = hand(27, 47, 49);
		s = out.state;
		expect(s.rows).toEqual([[8, 10], [24, 26, 27], [49], [67, 70]]);
		expect(player(s, "g2").roundBulls).toBe(10);
		expect(player(s, "g2").taken.sort((a, b) => a - b)).toEqual([41, 44, 45, 46, 47]);

		// 第 4 手：5 / 7 / 28 → 你的 5 触发规则 C，4 排牛头 4/3/1/4，选第 3 排（下标 2）罚 1
		out = hand(5, 7, 28);
		s = out.state;
		expect(s.phase).toBe("chooseRow");
		expect(s.chooser).toBe("you");
		s = choose(s, "you", 2).state;
		expect(s.rows).toEqual([[8, 10], [24, 26, 27, 28], [5, 7], [67, 70]]);
		expect(player(s, "you").roundBulls).toBe(1);

		// 第 5 手：11 / 56 / 55 → 55 成第 2 排第 5 张，56 成第六张，一号收 24/26/27/28/55 = 11 分
		out = hand(11, 56, 55);
		s = out.state;
		expect(s.rows).toEqual([[8, 10, 11], [56], [5, 7], [67, 70]]);
		expect(player(s, "g1").roundBulls).toBe(11);
		expect(s.players.map((p) => p.roundBulls)).toEqual([1, 11, 10]);
		expect(s.turn).toBe(6);
		expect(s.phase).toBe("select");
	});

	it("第 4 手玩家不按引导、选了别的排：照样合法（比如选第 1 排罚 4 分）", () => {
		let s = start();
		for (const [y, a, b] of [[44, 10, 26], [45, 46, 70], [27, 47, 49], [5, 7, 28]] as const) s = playAll(s, { you: y, g1: a, g2: b }).state;
		s = choose(s, "you", 0).state;
		expect(player(s, "you").roundBulls).toBe(4);
		expect(s.rows[0]).toEqual([5, 7]);
	});
});

describe("[规则核对] 补充例 B、例 C 里的规则结算", () => {
	it("例 B：[10,13,15,18,19]·[45]·[60,61,63,64,67]·[80,84,88,90] 牛头 8/2/7/12；20、68 指向满排，2 比所有排尾都小", () => {
		const rows = [[10, 13, 15, 18, 19], [45], [60, 61, 63, 64, 67], [80, 84, 88, 90]];
		expect(rows.map(sumBulls)).toEqual([8, 2, 7, 12]);
		expect(targetRow(rows, 20)).toBe(0);
		expect(targetRow(rows, 68)).toBe(2);
		expect(targetRow(rows, 99)).toBe(3);
		expect(targetRow(rows, 2)).toBeNull();
		const s1 = playAll(table(rows, { me: 2, x: 46 }), { me: 2, x: 46 }).state;
		const s2 = choose(s1, "me", 1).state;
		expect(player(s2, "me").roundBulls).toBe(2);
		// 收完第 2 排后 x 的 46 → 排尾 19、2、67、90 → 接在 19 后面成第六张
		expect(player(s2, "x").roundBulls).toBe(8);
	});

	// 例 C：我 4、甲 50、乙 64、丙 97；第 1、2、4 排都是 3 个牛头
	const rowsC = [[41, 42, 43], [61, 62, 63], [44, 46, 47, 48, 49], [90]];
	const playsC = { me: 4, 甲: 50, 乙: 64, 丙: 97 };
	const cases: [number, number[][], [number | null, number | null, number | null]][] = [
		[0, [[4], [61, 62, 63, 64], [50], [90, 97]], [1, 1, 3]],
		[1, [[41, 42, 43], [4], [50, 64], [90, 97]], [2, 2, 3]],
		[3, [[41, 42, 43], [61, 62, 63, 64, 97], [50], [4]], [2, 2, 1]],
	];
	for (const [row, expectRows, next] of cases) {
		it(`例 C：我收第 ${row + 1} 排 → 结算后 4 排和表里一致，甲收 9 分；下一手 65/93/98 去第 ${next.map((n) => (n === null ? "C" : n + 1)).join("/")} 排`, () => {
			const s1 = playAll(table(rowsC, playsC), playsC).state;
			expect(s1.chooser).toBe("me");
			const s2 = choose(s1, "me", row).state;
			expect(s2.rows).toEqual(expectRows);
			expect(player(s2, "me").roundBulls).toBe(3);
			expect(player(s2, "甲").roundBulls).toBe(9);
			expect([65, 93, 98].map((c) => targetRow(s2.rows, c))).toEqual(next);
			// 收第 4 排时第 2 排被 97 填满，98 下一手必收
			if (row === 3) expect(s2.rows[1]).toHaveLength(5);
			const ref = refResolve(rowsC, Object.entries(playsC).map(([p, c]) => ({ player: p, card: c })), () => row);
			expect(s2.rows).toEqual(ref.rows);
		});
	}
});
