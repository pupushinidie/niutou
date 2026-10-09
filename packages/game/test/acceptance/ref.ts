/**
 * 规则核对（背靠背）用的参考实现和工具。
 *
 * 这里的规则代码只按规则书（~/Desktop/游戏规则/谁是牛头王.md）和补充文件独立写成，
 * 没有参考引擎的实现。验收测试拿它和引擎的结果对照：两边对不上，就说明有一边把规则读错了。
 * 本目录只归规则核对（验收 agent），引擎不改；觉得哪条写错了，记 issue 由制作人裁决。
 */
import { expect } from "vitest";
import {
	apply,
	createRng,
	type GameCommand,
	type GameEvent,
	type GameState,
	type Rng,
} from "../../src/index.js";

// ---------- 规则书 2.1：牛头数（命中第一条就停） ----------
export function refBulls(n: number): number {
	if (n === 55) return 7;
	if (n % 11 === 0) return 5;
	if (n % 10 === 0) return 3;
	if (n % 10 === 5) return 2;
	return 1;
}
export const refSum = (cards: readonly number[]): number => cards.reduce((s, c) => s + refBulls(c), 0);

/** 第 8 节战术变体：只用 1 到「人数 × 10 + 4」。基础模式 1–104。 */
export function refCardsInPlay(players: number, tactics: boolean): number[] {
	const max = tactics ? players * 10 + 4 : 104;
	return Array.from({ length: max }, (_, i) => i + 1);
}

// ---------- 规则书 4.2：规则 A / B / C ----------
/** 规则 A：只看排尾，只能接在比它小的排尾后面，选差值最小的；没有就返回 null（规则 C）。 */
export function refTarget(rows: readonly (readonly number[])[], card: number): number | null {
	let best: number | null = null;
	let bestGap = Infinity;
	rows.forEach((row, i) => {
		const tail = row[row.length - 1]!;
		if (tail < card && card - tail < bestGap) {
			bestGap = card - tail;
			best = i;
		}
	});
	return best;
}

export interface RefPlay {
	player: string;
	card: number;
}
export interface RefStep {
	kind: "place" | "sixth" | "low";
	player: string;
	card: number;
	row: number;
	taken: number[];
}
export interface RefHand {
	rows: number[][];
	steps: RefStep[];
	/** 每人这一手被罚的牛头（只列出牌的人）。 */
	bulls: Record<string, number>;
	/** 这一手触发了几次规则 C（规则书说最多 1 次）。 */
	lowCount: number;
}

/**
 * 一手的完整结算：亮出的牌按从小到大逐张放（规则书 4.2）。
 * chooseLow：规则 C 时出牌人选哪一排（0–3）。
 */
export function refResolve(
	rowsIn: readonly (readonly number[])[],
	plays: readonly RefPlay[],
	chooseLow: (rows: number[][], play: RefPlay) => number,
): RefHand {
	const rows = rowsIn.map((r) => [...r]);
	const steps: RefStep[] = [];
	const bulls: Record<string, number> = {};
	for (const p of plays) bulls[p.player] = 0;
	let lowCount = 0;
	for (const play of [...plays].sort((a, b) => a.card - b.card)) {
		const t = refTarget(rows, play.card);
		if (t === null) {
			lowCount++;
			const r = chooseLow(rows, play);
			const taken = rows[r]!;
			rows[r] = [play.card];
			bulls[play.player]! += refSum(taken);
			steps.push({ kind: "low", player: play.player, card: play.card, row: r, taken });
		} else if (rows[t]!.length === 5) {
			const taken = rows[t]!;
			rows[t] = [play.card];
			bulls[play.player]! += refSum(taken);
			steps.push({ kind: "sixth", player: play.player, card: play.card, row: t, taken });
		} else {
			rows[t]!.push(play.card);
			steps.push({ kind: "place", player: play.player, card: play.card, row: t, taken: [] });
		}
	}
	return { rows, steps, bulls, lowCount };
}

/** 规则书第 7 节：并列最少都算赢。 */
export function refWinners(totals: Record<string, number>): string[] {
	const min = Math.min(...Object.values(totals));
	return Object.keys(totals).filter((id) => totals[id] === min);
}

// ---------- 驱动引擎的小工具（只用公开接口） ----------
export const rng = (): Rng => createRng(12345);

/** 做一个动作；非法时引擎会抛错（带中文提示）。 */
export function act(state: GameState, player: string, command: GameCommand, r: Rng = rng()): GameState {
	return apply(state, player, command, r).state;
}

/** 断言这个动作被拒绝（抛错，而且错误信息是给人看的非空文字），并且输入状态没被改动。 */
export function expectRejected(state: GameState, player: string, command: GameCommand): void {
	const before = JSON.stringify(state);
	let message: string | null = null;
	try {
		apply(state, player, command, rng());
	} catch (e) {
		message = e instanceof Error ? e.message : String(e);
	}
	expect(message, `${player} ${JSON.stringify(command)} 应该被拒绝`).not.toBeNull();
	expect(message!.trim().length).toBeGreaterThan(0);
	expect(JSON.stringify(state)).toBe(before);
}

/**
 * 这一手所有人按给定的牌确认（按给定顺序依次 select）。最后一人确认时亮牌。
 * 收集这一路所有事件，方便断言。
 */
export function playAll(
	state: GameState,
	plays: Readonly<Record<string, number>>,
	r: Rng = rng(),
): { state: GameState; events: GameEvent[] } {
	let s = state;
	const events: GameEvent[] = [];
	for (const [player, card] of Object.entries(plays)) {
		const out = apply(s, player, { type: "select", card }, r);
		s = out.state;
		events.push(...out.events);
	}
	return { state: s, events };
}

export function choose(state: GameState, player: string, row: number, r: Rng = rng()): { state: GameState; events: GameEvent[] } {
	return apply(state, player, { type: "chooseRow", row }, r);
}

export const player = (state: GameState, id: string) => {
	const p = state.players.find((x) => x.id === id);
	if (!p) throw new Error(`没有玩家 ${id}`);
	return p;
};

export const ofType = <T extends GameEvent["type"]>(events: readonly GameEvent[], type: T) =>
	events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

/** 递归冻结，用来确认 apply 不改输入。 */
export function deepFreeze<T>(obj: T): T {
	if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
		Object.freeze(obj);
		for (const v of Object.values(obj as Record<string, unknown>)) deepFreeze(v);
	}
	return obj;
}
