/**
 * 规则核对：规则书第 2 节（牛头数）、第 3 节（开局）、第 5 节的 2 人局 / 10 人局、TC1、TC11、TC12。
 */
import { describe, expect, it } from "vitest";
import {
	bullheads,
	cardsInPlay,
	createGame,
	DEFAULT_OPTIONS,
	sumBulls,
	type GameState,
} from "../../src/index.js";
import { refBulls, refCardsInPlay, refSum } from "./ref.js";

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `玩家${i + 1}` }));

/** 这一局所有牌的去处：手牌 + 4 排 + 没发的牌。 */
function allCards(s: GameState): number[] {
	return [...s.players.flatMap((p) => p.hand), ...s.rows.flat(), ...(s.deck ?? [])];
}

describe("[规则核对] §2.1 牛头数", () => {
	it("TC1 单点：1→1、5→2、10→3、11→5、50→3、52→1、55→7、65→2、99→5、100→3、104→1", () => {
		const cases: [number, number][] = [
			[1, 1], [5, 2], [10, 3], [11, 5], [50, 3], [52, 1], [55, 7], [65, 2], [99, 5], [100, 3], [104, 1],
		];
		for (const [card, bulls] of cases) expect(bullheads(card), `牌 ${card}`).toBe(bulls);
	});

	it("1–104 逐张和规则书的判定顺序一致（55 → 11 的倍数 → 整十 → 个位 5 → 其余）", () => {
		for (let c = 1; c <= 104; c++) expect(bullheads(c), `牌 ${c}`).toBe(refBulls(c));
	});

	it("TC1 合计 171，分组张数 {1:76, 2:9, 3:10, 5:8, 7:1}", () => {
		const all = Array.from({ length: 104 }, (_, i) => i + 1);
		expect(sumBulls(all)).toBe(171);
		const groups: Record<number, number> = {};
		for (const c of all) groups[bullheads(c)] = (groups[bullheads(c)] ?? 0) + 1;
		expect(groups).toEqual({ 1: 76, 2: 9, 3: 10, 5: 8, 7: 1 });
	});

	it("只看个位：50–54、56–59 里只有 50 是 3 个牛头，其余 1 个；55 是 7 个", () => {
		expect([50, 51, 52, 53, 54, 55, 56, 57, 58, 59].map(bullheads)).toEqual([3, 1, 1, 1, 1, 7, 1, 1, 1, 1]);
	});
});

describe("[规则核对] §3 开局", () => {
	for (let n = 2; n <= 10; n++) {
		it(`${n} 人局：每人 10 张、4 排各 1 张、没发的 ${104 - 10 * n - 4} 张，牌不重不漏`, () => {
			const s = createGame(players(n), 1000 + n);
			expect(s.phase).toBe("select");
			expect(s.round).toBe(1);
			expect(s.turn).toBe(1);
			expect(s.players).toHaveLength(n);
			for (const p of s.players) {
				expect(p.hand).toHaveLength(10);
				expect(p.handCount).toBe(10);
				expect(p.selected).toBe(false);
				expect(p.selection).toBeNull();
				expect(p.taken).toEqual([]);
				expect(p.roundBulls).toBe(0);
				expect(p.total).toBe(0);
			}
			expect(s.rows).toHaveLength(4);
			for (const row of s.rows) expect(row).toHaveLength(1);
			expect(s.deck).toHaveLength(104 - 10 * n - 4);
			const cards = allCards(s);
			expect(new Set(cards).size).toBe(104);
			expect([...cards].sort((a, b) => a - b)).toEqual(refCardsInPlay(n, false));
			// 本局亮过的牌：开局只有 4 张排头
			expect([...s.seenCards].sort((a, b) => a - b)).toEqual(s.rows.flat().sort((a, b) => a - b));
			expect(s.finalResult).toBeUndefined();
		});
	}

	it("TC12：10 人局 100 张手牌 + 4 张排头，没发的牌为空", () => {
		const s = createGame(players(10), 77);
		expect(s.players.reduce((k, p) => k + p.hand.length, 0)).toBe(100);
		expect(s.deck ?? []).toHaveLength(0);
	});

	it("§5 2 人局：每人 10 张 + 4 张排头共 24 张，其余 80 张不用", () => {
		const s = createGame(players(2), 5);
		expect(s.players.reduce((k, p) => k + p.hand.length, 0) + s.rows.flat().length).toBe(24);
		expect(s.deck).toHaveLength(80);
	});

	it("人数超出 2–10 不能开局", () => {
		expect(() => createGame(players(1), 1)).toThrow();
		expect(() => createGame(players(11), 1)).toThrow();
	});

	it("洗牌由种子决定：同种子同结果，不同种子通常不同", () => {
		const a = createGame(players(4), 42);
		const b = createGame(players(4), 42);
		const c = createGame(players(4), 43);
		expect(allCards(a)).toEqual(allCards(b));
		expect(allCards(a)).not.toEqual(allCards(c));
	});

	it("开房选项默认全关：目标分 66、不固定局数、不开战术", () => {
		expect(DEFAULT_OPTIONS).toEqual({ target: 66, fixedRounds: null, tactics: false });
		const s = createGame(players(3), 1);
		expect(s.config.target).toBe(66);
		expect(s.config.fixedRounds).toBeNull();
		expect(s.config.tactics).toBe(false);
	});
});

describe("[规则核对] §8 战术变体：只用 1 到「人数 × 10 + 4」", () => {
	// 补充文件 TC11 附表：各人数战术模式的牛头合计
	const expectedBulls: Record<number, number> = { 2: 38, 3: 55, 4: 72, 5: 85, 6: 103, 7: 120, 8: 137, 9: 154, 10: 171 };
	for (let n = 2; n <= 10; n++) {
		it(`${n} 人：用 1–${n * 10 + 4}，牛头合计 ${expectedBulls[n]}，发完没有剩牌`, () => {
			expect(cardsInPlay(n, true)).toEqual(refCardsInPlay(n, true));
			expect(cardsInPlay(n, false)).toEqual(refCardsInPlay(n, false));
			expect(refSum(refCardsInPlay(n, true))).toBe(expectedBulls[n]);
			expect(sumBulls(cardsInPlay(n, true))).toBe(expectedBulls[n]);
			const s = createGame(players(n), 900 + n, { tactics: true });
			expect(s.config.tactics).toBe(true);
			expect(s.deck ?? []).toHaveLength(0);
			expect([...allCards(s)].sort((a, b) => a - b)).toEqual(refCardsInPlay(n, true));
		});
	}

	it("TC11：3 人战术，用 1–34，30 张手牌 + 4 张排头后没发的牌为空，34 张合计 55 个牛头", () => {
		const s = createGame(players(3), 11, { tactics: true });
		const cards = allCards(s);
		expect(cards).toHaveLength(34);
		expect(Math.max(...cards)).toBe(34);
		expect(s.deck ?? []).toHaveLength(0);
		expect(sumBulls(cards)).toBe(55);
	});
});
