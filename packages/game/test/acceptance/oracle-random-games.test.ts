/**
 * 规则核对：独立参考实现对拍。
 *
 * 2–10 人每种人数打若干整场（开房选项随机：目标分、固定局数、战术），每一手：
 * - 玩家随机选牌，并且随机地撤回、改选（开工拍板：最后一人确认前可撤回）；
 * - 规则 C 时随机选排；
 * 然后用 ref.ts 里只按规则书写的结算（refResolve）算出这一手应有的 4 排、收牌、罚分，
 * 和引擎逐项对照；局末按规则书第 7 节 / 第 8 节自己判断该不该结束、谁赢，也和引擎对照。
 * 顺带检查：牌守恒、收来的牌不回手、每个视角看不到别人的手牌和牌堆、apply 不改输入。
 * 不一致的地方攒起来，最后统一断言（逐步 expect 太慢）。
 */
import { describe, expect, it } from "vitest";
import {
	apply,
	createGame,
	createRng,
	redactGameForViewer,
	type GameEvent,
	type GameOptions,
	type GameState,
	type Rng,
} from "../../src/index.js";
import { refCardsInPlay, refResolve, refSum, refWinners, type RefPlay } from "./ref.js";

interface Stats {
	games: number;
	rounds: number;
	hands: number;
	lows: number;
	sixths: number;
	unselects: number;
	reselects: number;
	ties: number;
	byReason: Record<string, number>;
}

const sorted = (xs: readonly number[]) => [...xs].sort((a, b) => a - b);

function playOneGame(n: number, seed: number, stats: Stats, problems: string[]): void {
	const pick = createRng(seed * 7919 + n); // 测试自己的随机（选牌、撤回、选排、选项）
	const dealRng: Rng = createRng(seed + 1); // 传给 apply（发下一局）
	const options: { -readonly [K in keyof GameOptions]?: GameOptions[K] } = {};
	const roll = pick.int(6);
	if (roll === 1) options.target = 20 + pick.int(30);
	if (roll === 2) options.fixedRounds = 1 + pick.int(3);
	if (pick.int(3) === 0) options.tactics = true;
	const target = options.target ?? 66;
	const fixed = options.fixedRounds ?? null;
	const tactics = options.tactics ?? false;

	const ids = Array.from({ length: n }, (_, i) => `p${i + 1}`);
	let s: GameState = createGame(ids.map((id) => ({ id, name: id })), seed, options);
	const tag = `[${n} 人 seed=${seed} ${JSON.stringify(options)}]`;
	const fail = (msg: string) => problems.length < 60 && problems.push(`${tag} 第 ${s.round} 局第 ${s.turn} 手：${msg}`);

	const totals: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
	let round = 1;
	let historyLen = 0;

	const step = (who: string, cmd: Parameters<typeof apply>[2]): GameEvent[] => {
		const checkPure = pick.int(20) === 0;
		const before = checkPure ? JSON.stringify(s) : "";
		const out = apply(s, who, cmd, dealRng);
		if (checkPure && JSON.stringify(s) !== before) fail("apply 改了输入状态");
		if (out.state.version !== s.version + 1) fail(`version 没有加一（${s.version} → ${out.state.version}）`);
		s = out.state;
		return out.events;
	};

	for (let guard = 0; guard < 40; guard++) {
		// ---- 一局开始：核对发牌 ----
		stats.rounds++;
		if (s.phase !== "select" || s.round !== round || s.turn !== 1) fail(`新一局状态不对：${s.phase} round=${s.round} turn=${s.turn}`);
		if (s.rows.length !== 4 || s.rows.some((r) => r.length !== 1)) fail(`开局不是 4 排各 1 张：${JSON.stringify(s.rows)}`);
		const inPlay = refCardsInPlay(n, tactics);
		const dealt = [...s.players.flatMap((p) => p.hand), ...s.rows.flat(), ...(s.deck ?? [])];
		if (JSON.stringify(sorted(dealt)) !== JSON.stringify(inPlay)) fail("发牌不是这一局该用的那些牌（有重有漏）");
		if (s.players.some((p) => p.hand.length !== 10 || p.taken.length !== 0 || p.roundBulls !== 0)) fail("新一局手牌 / 收牌堆 / 本局牛头没重置");
		for (const p of s.players) if (p.total !== totals[p.id]) fail(`${p.id} 累计罚分没保留：引擎 ${p.total}，应为 ${totals[p.id]}`);

		let rows = s.rows.map((r) => [...r]);
		const hands: Record<string, number[]> = Object.fromEntries(s.players.map((p) => [p.id, [...p.hand]]));
		const taken: Record<string, number[]> = Object.fromEntries(ids.map((id) => [id, []]));
		const bulls: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));

		for (let turn = 1; turn <= 10; turn++) {
			stats.hands++;
			// ---- 选牌：随机顺序，随机撤回 / 改选，最后一人确认时亮牌 ----
			const order = pick.shuffle(ids);
			const final: Record<string, number> = {};
			let lastEvents: GameEvent[] = [];
			for (let i = 0; i < order.length; i++) {
				const id = order[i]!;
				const h = hands[id]!;
				const isLast = i === order.length - 1;
				let current: number | null = null;
				if (!isLast && h.length > 1 && pick.int(4) === 0) {
					// 先选一张、再撤回或直接改选
					current = pick.pick(h);
					step(id, { type: "select", card: current });
					if (pick.int(2) === 0) {
						step(id, { type: "unselect" });
						current = null;
						stats.unselects++;
					} else stats.reselects++;
				}
				// 改选时换一张不同的牌（同一张重复确认是空操作，引擎会提示「已经选好这张了」）
				const card = pick.pick(current === null ? h : h.filter((c) => c !== current));
				final[id] = card;
				lastEvents = step(id, { type: "select", card });
				if (!isLast && s.phase !== "select") fail(`还有人没选就亮牌了（${i + 1}/${n}）`);
				if (!isLast && s.turn !== turn) fail("还有人没选就换手了");
			}
			// 偶尔查一个视角
			const viewer = pick.pick(ids);
			const v = redactGameForViewer(s, viewer);
			for (const p of v.players) {
				if (p.id !== viewer && (p.hand.length !== 0 || p.selection !== null)) fail(`${viewer} 的视角里看得到 ${p.id} 的手牌或选牌`);
			}
			if ("deck" in v && v.deck !== undefined) fail(`${viewer} 的视角里有牌堆`);

			// ---- 参考结算 ----
			const plays: RefPlay[] = ids.map((id) => ({ player: id, card: final[id]! }));
			let chosen = -1;
			const ref = refResolve(rows, plays, () => {
				chosen = pick.int(4);
				return chosen;
			});
			if (ref.lowCount > 1) fail(`参考实现一手里出现 ${ref.lowCount} 次规则 C（不应该）`);
			if (ref.lowCount === 1) {
				stats.lows++;
				const lowest = [...plays].sort((a, b) => a.card - b.card)[0]!;
				if (s.phase !== "chooseRow") {
					fail(`${lowest.player} 的 ${lowest.card} 比所有排尾 ${JSON.stringify(rows.map((r) => r[r.length - 1]))} 都小，引擎没有停下来选排（phase=${s.phase}）`);
					return;
				}
				if (s.chooser !== lowest.player) fail(`chooser 应为 ${lowest.player}，引擎是 ${s.chooser}`);
				if (JSON.stringify(s.rows) !== JSON.stringify(rows)) fail("停下来选排时 4 排已经变了（规则 C 的牌是最小的，前面不该有结算）");
				lastEvents = step(lowest.player, { type: "chooseRow", row: chosen });
			} else if (s.phase === "chooseRow") {
				fail(`引擎停在选排，但按规则书没有规则 C：排尾 ${JSON.stringify(rows.map((r) => r[r.length - 1]))}，出牌 ${JSON.stringify(final)}`);
				return;
			}
			stats.sixths += ref.steps.filter((st) => st.kind === "sixth").length;

			// ---- 对照这一手的结果 ----
			if (JSON.stringify(s.rows) !== JSON.stringify(ref.rows)) fail(`4 排不一致：引擎 ${JSON.stringify(s.rows)}，规则书 ${JSON.stringify(ref.rows)}（亮牌前 ${JSON.stringify(rows)}，出牌 ${JSON.stringify(final)}）`);
			const rv = s.reveal;
			if (!rv || !rv.done) fail("这一手结算完 reveal 没有 done");
			else {
				const engSteps = rv.steps.map((st) => [st.kind, st.player, st.card, st.row, sorted(st.taken).join(",")].join("|"));
				const refSteps = ref.steps.map((st) => [st.kind, st.player, st.card, st.row, sorted(st.taken).join(",")].join("|"));
				if (JSON.stringify(engSteps) !== JSON.stringify(refSteps)) fail(`逐张结算不一致：引擎 ${JSON.stringify(engSteps)}，规则书 ${JSON.stringify(refSteps)}`);
				if (JSON.stringify(rv.plays.map((p) => p.card)) !== JSON.stringify(sorted(Object.values(final)))) fail("reveal.plays 不是按从小到大");
			}
			const handEnded = lastEvents.filter((e) => e.type === "HandEnded");
			if (handEnded.length !== 1) fail(`HandEnded 事件 ${handEnded.length} 个`);
			else if (JSON.stringify((handEnded[0] as Extract<GameEvent, { type: "HandEnded" }>).bulls) !== JSON.stringify(Object.fromEntries(ids.map((id) => [id, ref.bulls[id]])))) {
				fail(`HandEnded 罚分不一致：引擎 ${JSON.stringify((handEnded[0] as Extract<GameEvent, { type: "HandEnded" }>).bulls)}，规则书 ${JSON.stringify(ref.bulls)}`);
			}
			for (const st of ref.steps) taken[st.player]!.push(...st.taken);
			for (const id of ids) {
				bulls[id]! += ref.bulls[id]!;
				hands[id] = hands[id]!.filter((c) => c !== final[id]);
				const p = s.players.find((x) => x.id === id)!;
				if (JSON.stringify(sorted(p.hand)) !== JSON.stringify(sorted(hands[id]!))) fail(`${id} 手牌不对`);
				if (JSON.stringify(sorted(p.taken)) !== JSON.stringify(sorted(taken[id]!))) fail(`${id} 收牌堆不对：引擎 ${JSON.stringify(sorted(p.taken))}，规则书 ${JSON.stringify(sorted(taken[id]!))}`);
				if (p.roundBulls !== bulls[id]) fail(`${id} 本局牛头不对：引擎 ${p.roundBulls}，规则书 ${bulls[id]}`);
				if (refSum(p.taken) !== p.roundBulls) fail(`${id} 本局牛头和收牌堆对不上`);
			}
			// 牌守恒：排上 + 收牌堆 + 手牌 + 没发的 = 这一局用的牌
			const now = [...s.rows.flat(), ...s.players.flatMap((p) => [...p.taken, ...p.hand]), ...(s.deck ?? [])];
			if (JSON.stringify(sorted(now)) !== JSON.stringify(inPlay)) fail("牌不守恒");
			rows = ref.rows.map((r) => [...r]);

			if (turn < 10) {
				if (s.phase !== "select" || s.turn !== turn + 1) fail(`第 ${turn} 手后应进入第 ${turn + 1} 手选牌，引擎是 ${s.phase} turn=${s.turn}`);
			}
		}

		// ---- 局末：按规则书自己判断 ----
		for (const id of ids) totals[id]! += bulls[id]!;
		historyLen++;
		const shouldEnd = fixed !== null ? round >= fixed : Object.values(totals).some((t) => t >= target);
		for (const p of s.players) if (p.total !== totals[p.id]) fail(`${p.id} 局末累计不对：引擎 ${p.total}，规则书 ${totals[p.id]}`);
		if (s.history.length !== historyLen) fail(`history 应有 ${historyLen} 条，引擎 ${s.history.length}`);
		const last = s.history[s.history.length - 1];
		if (last && (JSON.stringify(last.bulls) !== JSON.stringify(bulls) || JSON.stringify(last.totals) !== JSON.stringify(totals))) fail("history 这一局的记录不对");

		if (shouldEnd) {
			if (s.phase !== "gameOver") {
				fail(`应该结束（累计 ${JSON.stringify(totals)}，目标 ${target}，固定局数 ${fixed}），引擎是 ${s.phase}`);
				return;
			}
			const fr = s.finalResult!;
			const want = refWinners(totals);
			if (JSON.stringify(sorted(fr.winners.map((w) => ids.indexOf(w)))) !== JSON.stringify(sorted(want.map((w) => ids.indexOf(w))))) fail(`胜者不对：引擎 ${fr.winners}，规则书 ${want}`);
			if (want.length > 1) stats.ties++;
			const reason = fixed !== null ? "rounds" : "target";
			if (fr.reason !== reason) fail(`结束原因应为 ${reason}，引擎 ${fr.reason}`);
			if (fr.rounds !== round) fail(`局数应为 ${round}，引擎 ${fr.rounds}`);
			stats.byReason[reason] = (stats.byReason[reason] ?? 0) + 1;
			stats.games++;
			return;
		}
		if (s.phase !== "roundEnd") {
			fail(`不该结束（累计 ${JSON.stringify(totals)}，目标 ${target}，固定局数 ${fixed}），引擎是 ${s.phase}`);
			return;
		}
		// 都点继续（随机顺序），最后一人点了就发下一局
		const order = pick.shuffle(ids);
		order.forEach((id, i) => {
			step(id, { type: "nextRound" });
			if (i < order.length - 1 && s.phase !== "roundEnd") fail("还有人没点继续就发了下一局");
		});
		round++;
	}
	fail("40 局还没结束");
}

describe("[规则核对] 独立参考实现对拍：2–10 人随机整场", () => {
	for (let n = 2; n <= 10; n++) {
		it(`${n} 人 × 40 场：每一手的 4 排、收牌、罚分、局末和终局都和规则书一致`, () => {
			const stats: Stats = { games: 0, rounds: 0, hands: 0, lows: 0, sixths: 0, unselects: 0, reselects: 0, ties: 0, byReason: {} };
			const problems: string[] = [];
			for (let g = 0; g < 40; g++) playOneGame(n, 1000 * n + g, stats, problems);
			expect(problems).toEqual([]);
			expect(stats.games).toBe(40);
			// 覆盖面：规则 C、第六张、撤回、改选都真的发生过
			expect(stats.lows).toBeGreaterThan(0);
			expect(stats.sixths).toBeGreaterThan(0);
			expect(stats.unselects).toBeGreaterThan(0);
			expect(stats.reselects).toBeGreaterThan(0);
			console.log(`[规则核对] ${n} 人：${stats.games} 场 ${stats.rounds} 局 ${stats.hands} 手，规则 C ${stats.lows} 次，第六张 ${stats.sixths} 次，撤回 ${stats.unselects}，改选 ${stats.reselects}，并列获胜 ${stats.ties} 场，结束原因 ${JSON.stringify(stats.byReason)}`);
		});
	}
});
