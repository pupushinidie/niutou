/**
 * 规则核对：规则书 4.3（一局结束）、第 6 节计分和例 2、第 7 节终局和并列、第 8 节三个开房变体；
 * TC8、TC9、TC10，补充文件教学 11。
 */
import { describe, expect, it } from "vitest";
import {
	apply,
	buildGame,
	createGame,
	legalActions,
	normalizeOptions,
	type GameEvent,
	type GameOptions,
	type GameState,
	type PlayerSpec,
} from "../../src/index.js";
import { act, expectRejected, ofType, playAll, player, refCardsInPlay, refSum, refWinners, rng } from "./ref.js";

/** 一路打下去：选牌时每人出手里最小的牌，规则 C 选第 1 排，局末都点继续；直到 stop 返回 true。 */
function driveUntil(state: GameState, stop: (s: GameState) => boolean, maxSteps = 2000): GameState {
	let s = state;
	const r = rng();
	for (let i = 0; i < maxSteps && !stop(s); i++) {
		if (s.phase === "select") {
			const p = s.players.find((x) => !x.selected)!;
			s = act(s, p.id, { type: "select", card: p.hand[0]! }, r);
		} else if (s.phase === "chooseRow") {
			s = act(s, s.chooser!, { type: "chooseRow", row: 0 }, r);
		} else if (s.phase === "roundEnd") {
			const p = s.players.find((x) => !x.ready)!;
			s = act(s, p.id, { type: "nextRound" }, r);
		} else break;
	}
	return s;
}

/** 最后一手（每人 1 张）的局面：出完这一手就是局末。 */
function lastHand(specs: PlayerSpec[], rows: number[][], extra: { round?: number; options?: Partial<GameOptions> } = {}): GameState {
	return buildGame({ players: specs, rows, round: extra.round ?? 2, ...(extra.options ? { options: extra.options } : {}) });
}

/** 最后一手：每人出手里唯一的那张。 */
function playLast(s: GameState): { state: GameState; events: GameEvent[] } {
	return playAll(s, Object.fromEntries(s.players.map((p) => [p.id, p.hand[0]!])));
}

describe("[规则核对] §4.3 一局结束和继续", () => {
	it("TC8：累计 20/30/40，本局各收 10 → 30/40/50，进入局末；都点继续后发新的一局", () => {
		const s0 = lastHand(
			[
				{ id: "p1", hand: [36], total: 20, taken: [10, 20, 30, 1] },
				{ id: "p2", hand: [37], total: 30, taken: [40, 50, 60, 2] },
				{ id: "p3", hand: [38], total: 40, taken: [70, 80, 90, 3] },
			],
			[[5], [15], [25], [35]],
		);
		expect(s0.turn).toBe(10);
		expect(s0.players.map((p) => p.roundBulls)).toEqual([10, 10, 10]);
		const { state: s1, events } = playLast(s0);
		expect(s1.phase).toBe("roundEnd");
		expect(s1.players.map((p) => p.total)).toEqual([30, 40, 50]);
		expect(s1.players.map((p) => p.roundBulls)).toEqual([10, 10, 10]); // 给结算界面看
		const re = ofType(events, "RoundEnded");
		expect(re).toHaveLength(1);
		expect(re[0]).toMatchObject({ round: 2, bulls: { p1: 10, p2: 10, p3: 10 }, totals: { p1: 30, p2: 40, p3: 50 } });
		expect(s1.history[s1.history.length - 1]).toEqual({ round: 2, bulls: { p1: 10, p2: 10, p3: 10 }, totals: { p1: 30, p2: 40, p3: 50 } });
		expect(s1.finalResult).toBeUndefined();
		// 局末只能点继续
		for (const p of s1.players) expect(legalActions(s1, p.id)).toEqual([{ type: "nextRound" }]);
		expectRejected(s1, "p1", { type: "select", card: 36 });
		expectRejected(s1, "p1", { type: "chooseRow", row: 0 });

		const r = rng();
		let s = act(s1, "p2", { type: "nextRound" }, r);
		expect(s.phase).toBe("roundEnd");
		expect(player(s, "p2").ready).toBe(true);
		expectRejected(s, "p2", { type: "nextRound" }); // 不能点两次
		s = act(s, "p1", { type: "nextRound" }, r);
		const out = apply(s, "p3", { type: "nextRound" }, r);
		const s2 = out.state;
		// 新的一局：重新洗、每人 10 张、4 张排头，round + 1，收牌堆清空，累计保留
		expect(s2.phase).toBe("select");
		expect(s2.round).toBe(3);
		expect(s2.turn).toBe(1);
		expect(s2.reveal).toBeNull();
		expect(s2.players.map((p) => p.total)).toEqual([30, 40, 50]);
		for (const p of s2.players) {
			expect(p.hand).toHaveLength(10);
			expect(p.taken).toEqual([]);
			expect(p.roundBulls).toBe(0);
			expect(p.ready).toBe(false);
			expect(p.selected).toBe(false);
		}
		expect(s2.rows.map((row) => row.length)).toEqual([1, 1, 1, 1]);
		const all = [...s2.players.flatMap((p) => p.hand), ...s2.rows.flat(), ...(s2.deck ?? [])];
		expect([...all].sort((a, b) => a - b)).toEqual(refCardsInPlay(3, false));
		expect([...s2.seenCards].sort((a, b) => a - b)).toEqual(s2.rows.flat().sort((a, b) => a - b));
		const started = ofType(out.events, "RoundStarted");
		expect(started).toHaveLength(1);
		expect(started[0]!.round).toBe(3);
		expect(started[0]!.rows).toEqual(s2.rows);
	});

	it("差 1 分不结束：累计 60 + 本局 5 = 65 → 局末，继续下一局", () => {
		const s0 = lastHand(
			[
				{ id: "p1", hand: [16], total: 60, taken: [5, 1, 2, 3] },
				{ id: "p2", hand: [26], total: 10 },
			],
			[[15], [25], [35], [45]],
		);
		const s1 = playLast(s0).state;
		expect(player(s1, "p1").total).toBe(65);
		expect(s1.phase).toBe("roundEnd");
	});

	it("局中超过 66 也要打完这一局（只在局末检查）", () => {
		// 第 5 手开始：甲的累计 60 + 本局已收 12 = 72，但局还没完
		const s0 = buildGame({
			players: [
				{ id: "p1", include: [], total: 60, taken: [55, 11] },
				{ id: "p2", total: 10 },
				{ id: "p3", total: 20 },
			],
			rows: [[17], [27], [37], [47]],
			turn: 5,
			round: 2,
			seed: 9,
		});
		expect(player(s0, "p1").roundBulls).toBe(12);
		const afterOneHand = driveUntil(s0, (s) => s.turn === 6 || s.phase !== "select" && s.phase !== "chooseRow");
		expect(afterOneHand.phase).toBe("select");
		expect(afterOneHand.finalResult).toBeUndefined();
		const end = driveUntil(s0, (s) => s.phase === "roundEnd" || s.phase === "gameOver");
		expect(end.phase).toBe("gameOver");
		expect(end.turn).toBe(10);
		expect(end.players.every((p) => p.hand.length === 0)).toBe(true);
		expect(end.finalResult!.reason).toBe("target");
	});
});

describe("[规则核对] §7 终局和胜负", () => {
	it("TC9 / 例 2：累计 58/22/40，本局 8/8/3 → 66/30/43，正好 66 就结束，乙获胜", () => {
		const s0 = lastHand(
			[
				{ id: "甲", hand: [61], total: 58, taken: [55, 1] },
				{ id: "乙", hand: [21], total: 22, taken: [11, 2, 3, 4] },
				{ id: "丙", hand: [31], total: 40, taken: [50] },
			],
			[[10], [20], [30], [60]],
		);
		expect(s0.players.map((p) => p.roundBulls)).toEqual([8, 8, 3]);
		const { state, events } = playLast(s0);
		expect(state.phase).toBe("gameOver");
		expect(state.players.map((p) => p.total)).toEqual([66, 30, 43]);
		expect(state.finalResult).toEqual({ winners: ["乙"], totals: { 甲: 66, 乙: 30, 丙: 43 }, rounds: 2, reason: "target" });
		const ge = ofType(events, "GameEnded");
		expect(ge).toHaveLength(1);
		expect(ge[0]).toMatchObject({ winners: ["乙"], reason: "target" });
		// 终局后什么都不能做
		for (const p of state.players) expect(legalActions(state, p.id)).toEqual([]);
		expectRejected(state, "乙", { type: "nextRound" });
		expectRejected(state, "乙", { type: "select", card: 21 });
		// 最后一局也记进历史
		expect(state.history[state.history.length - 1]).toMatchObject({ round: 2, totals: { 甲: 66, 乙: 30, 丙: 43 } });
	});

	it("TC10：终局累计 70/25/25 → 乙、丙并列获胜（官方 30 周年版：共同获胜）", () => {
		const s0 = lastHand(
			[
				{ id: "甲", hand: [14], total: 60, taken: [55, 1, 2, 3] },
				{ id: "乙", hand: [24], total: 20, taken: [5, 6, 7, 8] },
				{ id: "丙", hand: [34], total: 25 },
			],
			[[13], [23], [33], [43]],
		);
		const state = playLast(s0).state;
		expect(state.players.map((p) => p.total)).toEqual([70, 25, 25]);
		expect(state.phase).toBe("gameOver");
		expect([...state.finalResult!.winners].sort()).toEqual(["丙", "乙"].sort());
		expect([...state.finalResult!.winners].sort()).toEqual(refWinners({ 甲: 70, 乙: 25, 丙: 25 }).sort());
	});

	it("教学 11：上局累计 60/40/50，本局 9/20/3 → 69/60/53 → 结束，丙赢（不是本局收得最少的人赢）", () => {
		const s0 = lastHand(
			[
				{ id: "甲", hand: [16], total: 60, taken: [55, 1, 2] },
				{ id: "乙", hand: [26], total: 40, taken: [11, 22, 33, 44] },
				{ id: "丙", hand: [36], total: 50, taken: [10] },
			],
			[[15], [25], [35], [45]],
		);
		expect(s0.players.map((p) => p.roundBulls)).toEqual([9, 20, 3]);
		const state = playLast(s0).state;
		expect(state.phase).toBe("gameOver");
		expect(state.finalResult!.winners).toEqual(["丙"]);
		expect(state.finalResult!.totals).toEqual({ 甲: 69, 乙: 60, 丙: 53 });
	});

	it("所有人并列：都算赢", () => {
		const s0 = lastHand(
			[
				{ id: "p1", hand: [16], total: 60, taken: [10, 20] },
				{ id: "p2", hand: [26], total: 60, taken: [30, 40] },
			],
			[[15], [25], [35], [45]],
		);
		const state = playLast(s0).state;
		expect(state.phase).toBe("gameOver");
		expect([...state.finalResult!.winners].sort()).toEqual(["p1", "p2"]);
	});
});

describe("[规则核对] §8 开房变体", () => {
	it("开房选项校验：默认值、合法值保留、不合法的拒绝（目标分 10–200、固定局数 1–20）", () => {
		expect(normalizeOptions({})).toEqual({ target: 66, fixedRounds: null, tactics: false });
		expect(normalizeOptions({ target: 33, fixedRounds: 3, tactics: true })).toEqual({ target: 33, fixedRounds: 3, tactics: true });
		expect(normalizeOptions({ fixedRounds: null })).toMatchObject({ fixedRounds: null });
		expect(() => normalizeOptions({ target: 0 })).toThrow();
		expect(() => normalizeOptions({ target: -5 })).toThrow();
		expect(() => normalizeOptions({ target: 33.5 })).toThrow();
		expect(() => normalizeOptions({ fixedRounds: 0 })).toThrow();
		expect(() => normalizeOptions({ fixedRounds: 21 })).toThrow();
	});

	it("目标分改成 33：本局后累计 32 不结束，33 结束", () => {
		const mk = (taken: number[]) =>
			lastHand(
				[
					{ id: "p1", hand: [16], total: 30, taken },
					{ id: "p2", hand: [26], total: 5 },
				],
				[[15], [25], [35], [45]],
				{ options: { target: 33 } },
			);
		const a = playLast(mk([1, 2])).state; // 30 + 2 = 32
		expect(a.config.target).toBe(33);
		expect(player(a, "p1").total).toBe(32);
		expect(a.phase).toBe("roundEnd");
		const b = playLast(mk([10])).state; // 30 + 3 = 33
		expect(b.phase).toBe("gameOver");
		expect(b.finalResult).toMatchObject({ winners: ["p2"], reason: "target" });
	});

	it("固定 3 局：第 3 局打完就结束，罚分最少者胜，reason = rounds", () => {
		const s0 = lastHand(
			[
				{ id: "p1", hand: [16], total: 10 },
				{ id: "p2", hand: [26], total: 20 },
			],
			[[15], [25], [35], [45]],
			{ round: 3, options: { fixedRounds: 3 } },
		);
		const state = playLast(s0).state;
		expect(state.phase).toBe("gameOver");
		expect(state.finalResult).toEqual({ winners: ["p1"], totals: { p1: 10, p2: 20 }, rounds: 3, reason: "rounds" });
	});

	it("固定 3 局：第 1 局就有人过 66 也不结束（不看 66）", () => {
		const big = [55, 11, 22, 33, 44, 66, 77, 88, 99, 10, 20, 30, 40, 50, 60, 70];
		expect(refSum(big)).toBe(68);
		const s0 = lastHand(
			[
				{ id: "p1", hand: [16], taken: big },
				{ id: "p2", hand: [26] },
			],
			[[15], [25], [35], [45]],
			{ round: 1, options: { fixedRounds: 3 } },
		);
		const state = playLast(s0).state;
		expect(player(state, "p1").total).toBe(68);
		expect(state.phase).toBe("roundEnd");
		expect(state.finalResult).toBeUndefined();
	});

	it("固定局数从开局一路打：2 局后结束，history 两条", () => {
		const s0 = createGame([{ id: "a", name: "A" }, { id: "b", name: "B" }], 31, { fixedRounds: 2 });
		const end = driveUntil(s0, (s) => s.phase === "gameOver");
		expect(end.phase).toBe("gameOver");
		expect(end.history).toHaveLength(2);
		expect(end.finalResult!.rounds).toBe(2);
		expect(end.finalResult!.reason).toBe("rounds");
		const totals = Object.fromEntries(end.players.map((p) => [p.id, p.total]));
		expect(end.finalResult!.totals).toEqual(totals);
		expect([...end.finalResult!.winners].sort()).toEqual(refWinners(totals).sort());
	});

	it("战术模式 3 人：一局 10 手打完，1–34 每张都亮出来过；下一局还是 1–34", () => {
		const s0 = createGame([{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }], 8, { tactics: true });
		const end = driveUntil(s0, (s) => s.phase === "roundEnd" || s.phase === "gameOver");
		expect([...end.seenCards].sort((a, b) => a - b)).toEqual(refCardsInPlay(3, true));
		// 排上 + 收牌堆 = 34 张
		const onTable = [...end.rows.flat(), ...end.players.flatMap((p) => p.taken)];
		expect(onTable.sort((a, b) => a - b)).toEqual(refCardsInPlay(3, true));
		if (end.phase === "roundEnd") {
			const next = driveUntil(end, (s) => s.phase === "select");
			const all = [...next.players.flatMap((p) => p.hand), ...next.rows.flat(), ...(next.deck ?? [])];
			expect(all.sort((a, b) => a - b)).toEqual(refCardsInPlay(3, true));
		}
	});
});
