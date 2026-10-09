/**
 * 规则核对：超时代做。依据开工拍板：
 * - 选牌超时按补充文件 1.7 的简单基线（不是规则书 9.4 的「出最小的牌」）：
 *   能安全接上（规则 A 有目标排、目标排不到 5 张）的牌里出差值最小的；没有就出最小的。
 * - 规则 C 选排超时：牛头最少 → 排尾最大 → 排号最小（补充文件 1.11 + 勘误第 5 条，第二比较项不是「张数最少」）。
 * - 局末没点继续的，超时替他点，发下一局。
 */
import { describe, expect, it } from "vitest";
import {
	baselineCard,
	baselineRow,
	buildGame,
	defaultConfig,
	rowsBulls,
	timeoutTurn,
} from "../../src/index.js";
import { act, ofType, player, rng } from "./ref.js";

describe("[规则核对] 选牌超时：简单基线", () => {
	it("手里最小的牌是规则 C 的牌、但有安全牌 → 出安全牌里差值最小的，不主动收排", () => {
		const rows = [[10], [20], [30], [40]];
		expect(baselineCard([5, 33, 47], rows)).toBe(33);
	});
	it("差值最小的那张指向满排（不安全）→ 换差值大但安全的那张", () => {
		const rows = [[10], [20, 21, 22, 23, 24], [30], [40]];
		expect(baselineCard([5, 25, 36], rows)).toBe(36);
	});
	it("指向 4 张的排算安全（放上去是第 5 张）", () => {
		const rows = [[10], [20, 21, 22, 23], [30], [40]];
		expect(baselineCard([5, 25, 36], rows)).toBe(25);
	});
	it("两张安全牌差值一样（33 接 30、43 接 40 都差 3）→ 出小的（README 默认规则表）", () => {
		// 补充文件 1.7 写「差值一样不可能，排尾都不同」——不同的牌接不同的排时差值可以一样，这里按 README 的「一样近出小的」。
		expect(baselineCard([43, 33], [[10], [20], [30], [40]])).toBe(33);
	});
	it("没有安全牌 → 出手里最小的", () => {
		const rows = [[10, 11, 12, 13, 14], [20, 21, 22, 23, 24], [30], [40]];
		expect(baselineCard([15, 25, 5], rows)).toBe(5);
		expect(baselineCard([15, 25], rows)).toBe(15);
	});

	it("timeoutTurn：已选的人保持原选择，没选的人按基线代出，亮牌结算；TimedOut 只列被代做的人", () => {
		let s = buildGame({
			players: [
				{ id: "p1", hand: [5, 33, 47, 60, 61, 62, 64, 65, 66, 67] },
				{ id: "p2", hand: [6, 34, 48, 70, 71, 72, 73, 74, 75, 76] },
				{ id: "p3", hand: [7, 35, 49, 80, 81, 82, 83, 84, 85, 86] },
			],
			rows: [[10], [20], [30], [40]],
		});
		s = act(s, "p2", { type: "select", card: 34 });
		const out = timeoutTurn(s);
		expect(out.events[0]).toEqual({ type: "TimedOut", phase: "select", players: ["p1", "p3"] });
		const plays = ofType(out.events, "Revealed")[0]!.plays.map((p) => [p.player, p.card]);
		// p1 基线：33（接 [30] 差 3，比出最小的 5 去收排好）；p3 基线：35；p2 保持自己选的 34
		expect(plays).toEqual([["p1", 33], ["p2", 34], ["p3", 35]]);
		expect(out.rows[2]).toEqual([30, 33, 34, 35]);
		expect(out.phase).toBe("select");
	});
});

describe("[规则核对] 规则 C 选排超时：牛头最少 → 排尾最大 → 排号最小", () => {
	it("TC6：4 排牛头 4/2/9/1 → 选第 4 排（下标 3）", () => {
		expect(baselineRow([[10, 13], [25], [40, 44, 48], [63]])).toBe(3);
	});

	it("牛头一样时比排尾（不是比张数）：[70]（3 牛头 1 张）和 [81,82,83]（3 牛头 3 张）→ 选排尾 83 那排", () => {
		const rows = [[70], [81, 82, 83], [90, 91, 92, 93, 94], [100, 101]];
		expect(rowsBulls(rows).slice(0, 2)).toEqual([3, 3]);
		expect(baselineRow(rows)).toBe(1);
	});

	it("补充例 C：第 1、2、4 排都是 3 个牛头，排尾 43 / 63 / 90 → 排尾最大的是第 4 排（下标 3）", () => {
		// 补充文件例 C 写「收第 2 排同时也符合『收排尾最大的』这条官方先例」——这句不对：排尾最大的是第 4 排 [90]。
		// 例 C 推荐收第 2 排是人机按后果算出来的（1.5 节第 2 步），超时代选只按基线，所以是第 4 排。
		const rows = [[41, 42, 43], [61, 62, 63], [44, 46, 47, 48, 49], [90]];
		expect(rowsBulls(rows)).toEqual([3, 3, 9, 3]);
		expect(baselineRow(rows)).toBe(3);
	});

	it("timeoutTurn 在 chooseRow：替 chooser 按基线选，RowTaken 标 auto，接着结算完", () => {
		let s = buildGame({
			players: [
				{ id: "p1", include: [4] },
				{ id: "p2", include: [7] },
			],
			rows: [[10, 13], [25], [40, 44, 48], [63]],
		});
		s = act(s, "p1", { type: "select", card: 4 });
		s = act(s, "p2", { type: "select", card: 7 });
		expect(s.phase).toBe("chooseRow");
		const out = timeoutTurn(s);
		expect(out.events[0]).toEqual({ type: "TimedOut", phase: "chooseRow", players: ["p1"] });
		const rt = ofType(out.events, "RowTaken");
		expect(rt).toHaveLength(1);
		expect(rt[0]).toMatchObject({ player: "p1", row: 3, bulls: 1, reason: "low", auto: true });
		expect(out.rows).toEqual([[10, 13], [25], [40, 44, 48], [4, 7]]);
		expect(out.phase).toBe("select");
		expect(out.reveal!.steps[0]!.auto).toBe(true);
	});
});

describe("[规则核对] 限时默认值（规则书 9.4 / README 超时规则）", () => {
	it("选牌 30 秒、选排 20 秒、局末 5 秒", () => {
		const c = defaultConfig();
		expect([c.selectTimeoutSec, c.chooseRowTimeoutSec, c.roundEndSec]).toEqual([30, 20, 5]);
		expect(c.handSize).toBe(10);
		expect([c.minPlayers, c.maxPlayers]).toEqual([2, 10]);
	});
});

describe("[规则核对] 局末超时", () => {
	it("没点继续的人由系统代点，发下一局", () => {
		let s = buildGame({
			players: [
				{ id: "p1", hand: [16] },
				{ id: "p2", hand: [26] },
			],
			rows: [[15], [25], [35], [45]],
			round: 2,
		});
		const r = rng();
		s = act(s, "p1", { type: "select", card: 16 }, r);
		s = act(s, "p2", { type: "select", card: 26 }, r);
		expect(s.phase).toBe("roundEnd");
		s = act(s, "p1", { type: "nextRound" }, r);
		const out = timeoutTurn(s);
		expect(out.events[0]).toEqual({ type: "TimedOut", phase: "roundEnd", players: ["p2"] });
		expect(out.phase).toBe("select");
		expect(out.round).toBe(3);
		expect(player(out, "p1").hand).toHaveLength(10);
	});
});
