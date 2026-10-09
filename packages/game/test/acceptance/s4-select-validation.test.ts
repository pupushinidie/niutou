/**
 * 规则核对：规则书 4.1 同时选牌和撤回改选（开工拍板：最后一人确认前可撤回）、9.2 命令校验、TC13；
 * apply 是纯函数（不改输入、version 每步加一）；迟到的点击（step 对不上）被拒。
 */
import { describe, expect, it } from "vitest";
import {
	apply,
	buildGame,
	createGame,
	legalActions,
	stepKey,
	waitingFor,
	type GameState,
} from "../../src/index.js";
import { act, deepFreeze, expectRejected, ofType, player, rng } from "./ref.js";

function fourPlayers(): GameState {
	return buildGame({
		players: [
			{ id: "p1", include: [27, 28] },
			{ id: "p2", include: [41] },
			{ id: "p3", include: [70] },
			{ id: "p4", include: [12] },
		],
		rows: [[10], [25], [40], [63]],
		seed: 5,
	});
}

describe("[规则核对] §4.1 同时选牌、撤回改选", () => {
	it("选好后别人只知道「已选好」，亮牌要等最后一人；可以撤回，也可以直接改选", () => {
		const r = rng();
		let s = fourPlayers();
		expect(waitingFor(s).sort()).toEqual(["p1", "p2", "p3", "p4"]);
		const out = apply(s, "p1", { type: "select", card: 27 }, r);
		s = out.state;
		expect(out.events).toEqual([{ type: "Selected", player: "p1" }]);
		expect(player(s, "p1").selected).toBe(true);
		expect(player(s, "p1").selection).toBe(27);
		expect(player(s, "p1").handCount).toBe(10); // 亮牌前还算在手里
		expect(s.phase).toBe("select");
		expect(s.reveal).toBeNull();
		expect(waitingFor(s).sort()).toEqual(["p2", "p3", "p4"]);

		// 撤回
		const un = apply(s, "p1", { type: "unselect" }, r);
		s = un.state;
		expect(un.events).toEqual([{ type: "Unselected", player: "p1" }]);
		expect(player(s, "p1").selected).toBe(false);
		expect(player(s, "p1").selection).toBeNull();
		expect(player(s, "p1").hand).toContain(27);
		expectRejected(s, "p1", { type: "unselect" }); // 没选就不能撤回

		// 重新选，再直接改选另一张
		s = act(s, "p1", { type: "select", card: 27 }, r);
		s = act(s, "p1", { type: "select", card: 28 }, r);
		expect(player(s, "p1").selection).toBe(28);
		expect(player(s, "p1").selected).toBe(true);

		s = act(s, "p2", { type: "select", card: 41 }, r);
		s = act(s, "p3", { type: "select", card: 70 }, r);
		// 还差一人时，已选的人都还能撤回
		expect(legalActions(s, "p2")).toContainEqual({ type: "unselect" });
		s = act(s, "p2", { type: "unselect" }, r);
		s = act(s, "p2", { type: "select", card: 41 }, r);

		// 最后一人确认的瞬间亮牌并结算，用的是改选后的 28
		const last = apply(s, "p4", { type: "select", card: 12 }, r);
		s = last.state;
		expect(ofType(last.events, "Revealed")[0]!.plays.map((p) => [p.player, p.card])).toEqual([
			["p4", 12],
			["p1", 28],
			["p2", 41],
			["p3", 70],
		]);
		expect(s.rows).toEqual([[10, 12], [25, 28], [40, 41], [63, 70]]);
		expect(player(s, "p1").hand).toContain(27);
		expect(player(s, "p1").hand).not.toContain(28);
		// 亮牌之后（已经是下一手）不能再撤回上一手
		expect(s.turn).toBe(2);
		expectRejected(s, "p1", { type: "unselect" });
	});

	it("select 阶段每人的合法动作：没选时每张手牌一个 select；选了以后多一个 unselect", () => {
		const s = fourPlayers();
		const acts = legalActions(s, "p1");
		const cards = acts.filter((a) => a.type === "select").map((a) => (a as { card: number }).card).sort((a, b) => a - b);
		expect(cards).toEqual([...player(s, "p1").hand].sort((a, b) => a - b));
		expect(acts.some((a) => a.type === "unselect")).toBe(false);
		const s1 = act(s, "p1", { type: "select", card: 27 });
		expect(legalActions(s1, "p1")).toContainEqual({ type: "unselect" });
	});

	it("别人选牌、撤回不改变这一步的计时 key；亮牌后才变", () => {
		const r = rng();
		const s0 = fourPlayers();
		const k0 = stepKey(s0);
		let s = act(s0, "p1", { type: "select", card: 27 }, r);
		s = act(s, "p2", { type: "select", card: 41 }, r);
		s = act(s, "p1", { type: "unselect" }, r);
		expect(stepKey(s)).toBe(k0);
		s = act(s, "p1", { type: "select", card: 27 }, r);
		s = act(s, "p3", { type: "select", card: 70 }, r);
		s = act(s, "p4", { type: "select", card: 12 }, r);
		expect(stepKey(s)).not.toBe(k0);
	});

	it("动作带的 step 和当前对不上（迟到的点击）就拒绝；对得上就接受", () => {
		const s0 = fourPlayers();
		const ok = act(s0, "p1", { type: "select", card: 27, step: stepKey(s0) });
		expect(player(ok, "p1").selection).toBe(27);
		expectRejected(s0, "p1", { type: "select", card: 27, step: "1:9:select" });
	});
});

describe("[规则核对] TC13 等非法操作被拒绝（有提示、不改状态）", () => {
	it("选一张不在自己手里的牌 → 拒绝（别人的牌、排上的牌、不存在的牌）", () => {
		const s = fourPlayers();
		expectRejected(s, "p1", { type: "select", card: 41 }); // 在 p2 手里
		expectRejected(s, "p1", { type: "select", card: 25 }); // 在排上
		expectRejected(s, "p1", { type: "select", card: 0 });
		expectRejected(s, "p1", { type: "select", card: 105 });
		expectRejected(s, "p1", { type: "select", card: 27.5 });
	});

	it("已经亮牌之后（停在规则 C 选排）再 select → 拒绝", () => {
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
		expectRejected(s, "p2", { type: "select", card: player(s, "p2").hand[0]! });
		expectRejected(s, "p1", { type: "select", card: player(s, "p1").hand[0]! });
	});

	it("不是 chooser 的人发 chooseRow → 拒绝；select 阶段发 chooseRow → 拒绝", () => {
		const s = fourPlayers();
		expectRejected(s, "p1", { type: "chooseRow", row: 0 });
		expectRejected(s, "p1", { type: "nextRound" });
	});

	it("不在局里的人、未知动作 → 拒绝", () => {
		const s = fourPlayers();
		expectRejected(s, "p9", { type: "select", card: 27 });
		expectRejected(s, "p1", { type: "fly" } as never);
	});
});

describe("[规则核对] apply 是纯函数", () => {
	it("不改输入（冻结后照样能 apply），每个动作 version + 1", () => {
		const r = rng();
		const s0 = deepFreeze(fourPlayers());
		const s1 = act(s0, "p1", { type: "select", card: 27 }, r);
		expect(s1.version).toBe(s0.version + 1);
		const s2 = act(deepFreeze(s1), "p2", { type: "select", card: 41 }, r);
		expect(s2.version).toBe(s1.version + 1);
		const s3 = act(deepFreeze(s2), "p1", { type: "unselect" }, r);
		expect(s3.version).toBe(s2.version + 1);
		expect(player(s0, "p1").selected).toBe(false);
	});

	it("同一种子、同一串动作，结果一样（可复现）", () => {
		const run = () => {
			let s = createGame([{ id: "a", name: "A" }, { id: "b", name: "B" }], 99);
			const r = rng();
			for (let i = 0; i < 40 && s.phase !== "gameOver"; i++) {
				if (s.phase === "select") {
					const p = s.players.find((x) => !x.selected)!;
					s = act(s, p.id, { type: "select", card: p.hand[p.hand.length - 1]! }, r);
				} else if (s.phase === "chooseRow") s = act(s, s.chooser!, { type: "chooseRow", row: 2 }, r);
				else if (s.phase === "roundEnd") s = act(s, s.players.find((x) => !x.ready)!.id, { type: "nextRound" }, r);
			}
			return JSON.stringify(s);
		};
		expect(run()).toBe(run());
	});
});
