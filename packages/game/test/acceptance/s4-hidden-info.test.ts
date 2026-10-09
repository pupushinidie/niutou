/**
 * 规则核对：规则书 4.4 公开 / 隐藏信息、9.3 redactGameForViewer；开工拍板「每人本局收到的牛头数一直公开」。
 * 每个玩家视角、旁人视角（""）、观战（看 / 不看手牌）逐个检查。
 */
import { describe, expect, it } from "vitest";
import {
	buildGame,
	createGame,
	redactGameForSpectator,
	redactGameForViewer,
	type GameState,
} from "../../src/index.js";
import { act, deepFreeze, player, rng } from "./ref.js";

const SERVER_ONLY = ["deck", "seed", "rngState", "log"] as const;

/** 在任意深度找某个键（防止服务端字段换个地方藏着下发）。 */
function findKeys(obj: unknown, keys: readonly string[], path = "$"): string[] {
	const hits: string[] = [];
	if (obj && typeof obj === "object") {
		for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
			if (keys.includes(k) && v !== undefined) hits.push(`${path}.${k}`);
			hits.push(...findKeys(v, keys, `${path}.${k}`));
		}
	}
	return hits;
}

/** 一个打到一半的 4 人局：p1、p3 已选好，p2、p4 还在想；有人收过牌。 */
function midGame(): GameState {
	const r = rng();
	let s = createGame(
		[
			{ id: "p1", name: "甲" },
			{ id: "p2", name: "乙" },
			{ id: "p3", name: "丙" },
			{ id: "p4", name: "丁" },
		],
		2024,
	);
	// 先按各自最大的牌打 3 手，制造一些收牌
	for (let i = 0; i < 200 && s.turn < 4; i++) {
		if (s.phase === "select") {
			const p = s.players.find((x) => !x.selected)!;
			s = act(s, p.id, { type: "select", card: p.hand[p.hand.length - 1]! }, r);
		} else if (s.phase === "chooseRow") s = act(s, s.chooser!, { type: "chooseRow", row: 0 }, r);
	}
	expect(s.phase).toBe("select");
	s = act(s, "p1", { type: "select", card: player(s, "p1").hand[0]! }, r);
	s = act(s, "p3", { type: "select", card: player(s, "p3").hand[1]! }, r);
	return s;
}

describe("[规则核对] §4.4 / 9.3 每个玩家的视角", () => {
	const s = deepFreeze(midGame());
	const before = JSON.stringify(s);

	for (const viewer of ["p1", "p2", "p3", "p4"]) {
		it(`${viewer} 只看到自己的手牌和自己选的牌；别人只有张数和「已选好」；牌堆、种子、动作序列都没有`, () => {
			const v = redactGameForViewer(s, viewer);
			for (const p of v.players) {
				const real = player(s, p.id);
				expect(p.handCount).toBe(real.hand.length);
				expect(p.selected).toBe(real.selected);
				if (p.id === viewer) {
					expect(p.hand).toEqual(real.hand);
					expect(p.selection).toBe(real.selection);
				} else {
					expect(p.hand).toEqual([]);
					expect(p.selection).toBeNull();
				}
				// 公开：本局收的牌、本局牛头、累计
				expect(p.taken).toEqual(real.taken);
				expect(p.roundBulls).toBe(real.roundBulls);
				expect(p.total).toBe(real.total);
			}
			expect(findKeys(v, SERVER_ONLY)).toEqual([]);
			// 公开的桌面信息照常给
			expect(v.rows).toEqual(s.rows);
			expect(v.seenCards).toEqual(s.seenCards);
			expect(v.history).toEqual(s.history);
			expect(v.reveal).toEqual(s.reveal);
			// 别人手里的牌、别人选了还没亮的牌，在整个视角里都找不到
			const json = JSON.stringify(v);
			for (const other of s.players.filter((p) => p.id !== viewer)) {
				expect(json).not.toContain(JSON.stringify(other.hand));
			}
			expect(JSON.stringify(s)).toBe(before); // 不改输入
		});
	}

	it("已选还没亮的牌不进「本局亮过的牌」，也不出现在事件里", () => {
		const sel1 = player(s, "p1").selection!;
		const sel3 = player(s, "p3").selection!;
		expect(s.seenCards).not.toContain(sel1);
		expect(s.seenCards).not.toContain(sel3);
		for (const viewer of ["p2", "p4"]) {
			const v = redactGameForViewer(s, viewer);
			for (const e of v.events) expect(e.type === "Selected" ? Object.keys(e).sort() : ["player", "type"]).toEqual(["player", "type"]);
			// 别人选的牌不在视角里任何「牌的位置」：手牌、selection、排、收牌堆、亮过的牌
			const exposed = [
				...v.players.flatMap((p) => [...p.hand, ...(p.selection === null ? [] : [p.selection]), ...p.taken]),
				...v.rows.flat(),
				...v.seenCards,
				...(v.reveal ? v.reveal.plays.map((p) => p.card) : []),
			];
			expect(exposed).not.toContain(sel1);
			expect(exposed).not.toContain(sel3);
		}
	});

	it("不是玩家的视角（\"\"）谁的手牌、选牌都看不到", () => {
		const v = redactGameForViewer(s, "");
		for (const p of v.players) {
			expect(p.hand).toEqual([]);
			expect(p.selection).toBeNull();
		}
		expect(findKeys(v, SERVER_ONLY)).toEqual([]);
	});
});

describe("[规则核对] 观战视角", () => {
	const s = midGame();
	it("默认（不看手牌）：和旁人一样，只有公开信息", () => {
		const v = redactGameForSpectator(s, false);
		for (const p of v.players) {
			expect(p.hand).toEqual([]);
			expect(p.selection).toBeNull();
			expect(p.handCount).toBe(player(s, p.id).hand.length);
		}
		expect(findKeys(v, SERVER_ONLY)).toEqual([]);
	});
	it("房主开「观战看手牌」：看得到所有人的手牌和已选的牌，但牌堆顺序、种子仍然没有", () => {
		const v = redactGameForSpectator(s, true);
		for (const p of v.players) {
			expect(p.hand).toEqual(player(s, p.id).hand);
			expect(p.selection).toBe(player(s, p.id).selection);
		}
		expect(findKeys(v, SERVER_ONLY)).toEqual([]);
	});
});

describe("[规则核对] 亮牌后 / 规则 C 时公开的东西", () => {
	it("规则 C 停下时：亮出的全部牌（含还没结算的）对所有人公开，谁出的也公开", () => {
		let s = buildGame({
			players: [
				{ id: "p1", include: [4] },
				{ id: "p2", include: [7] },
				{ id: "p3", include: [30] },
			],
			rows: [[10, 13], [20, 21, 23, 24, 25], [40, 44, 48], [63]],
		});
		const r = rng();
		s = act(s, "p1", { type: "select", card: 4 }, r);
		s = act(s, "p2", { type: "select", card: 7 }, r);
		s = act(s, "p3", { type: "select", card: 30 }, r);
		expect(s.phase).toBe("chooseRow");
		for (const viewer of ["p1", "p2", "p3", ""]) {
			const v = redactGameForViewer(s, viewer);
			expect(v.chooser).toBe("p1");
			expect(v.reveal!.plays.map((p) => [p.player, p.card])).toEqual([["p1", 4], ["p2", 7], ["p3", 30]]);
			expect(v.seenCards).toEqual(expect.arrayContaining([4, 7, 30]));
		}
	});

	it("战术模式的视角里也没有牌堆", () => {
		const s = createGame([{ id: "a", name: "A" }, { id: "b", name: "B" }], 3, { tactics: true });
		expect(findKeys(redactGameForViewer(s, "a"), SERVER_ONLY)).toEqual([]);
	});
});
