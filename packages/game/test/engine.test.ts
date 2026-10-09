/**
 * 引擎行为：开工拍板（撤回改选、最后一人确认就亮牌、收牛头公开、三个变体、超时代打）、纯函数、计时 key、局末继续。
 */
import { describe, expect, it } from "vitest";
import {
  animationMs,
  ANIMATION,
  apply,
  applyCommand,
  autoPlayHands,
  buildGame,
  createGame,
  createRng,
  legalActions,
  normalizeCommand,
  normalizeOptions,
  playHand,
  stepKey,
  timeoutTurn,
  waitingFor,
  type GameState,
} from "../src/index.js";
import { playOnRows, 丙, 乙, 甲 } from "./helpers.js";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/** 每个人都按基线出完这一局剩下的手（规则 C 也按基线），停在 roundEnd / gameOver。 */
function finishRound(state: GameState): GameState {
  return autoPlayHands(state, 10);
}

const three = [{ id: 甲, name: "甲" }, { id: 乙, name: "乙" }, { id: 丙, name: "丙" }];

describe("拍板#撤回改选：最后一人确认前都能撤回，最后一人确认的瞬间亮牌", () => {
  const start = () => buildGame({ players: [{ include: [12] }, { include: [27] }, { include: [41] }], rows: [[10], [25], [40], [63]] });

  it("已确认的人可以 unselect，再选别的；Selected / Unselected 事件里没有牌面", () => {
    let state = applyCommand(start(), 甲, { type: "select", card: 12 });
    expect(state.events).toEqual([{ type: "Selected", player: 甲 }]);
    expect(state.players[0]).toMatchObject({ selected: true, selection: 12, handCount: 10 });
    state = applyCommand(state, 乙, { type: "select", card: 27 });
    state = applyCommand(state, 甲, { type: "unselect" });
    expect(state.events).toEqual([{ type: "Unselected", player: 甲 }]);
    expect(state.players[0]).toMatchObject({ selected: false, selection: null });
    const other = state.players[0]!.hand.find((card) => card !== 12)!;
    state = applyCommand(state, 甲, { type: "select", card: other });
    expect(state.players[0]!.selection).toBe(other);
    expect(state.phase).toBe("select");
  });

  it("已选好的人直接选另一张就是改选；选同一张拒绝；没选就撤回拒绝", () => {
    let state = applyCommand(start(), 甲, { type: "select", card: 12 });
    const other = state.players[0]!.hand.find((card) => card !== 12)!;
    state = applyCommand(state, 甲, { type: "select", card: other });
    expect(state.players[0]!.selection).toBe(other);
    expect(() => applyCommand(state, 甲, { type: "select", card: other })).toThrow("已经选好这张了");
    expect(() => applyCommand(state, 乙, { type: "unselect" })).toThrow("你还没有选牌");
  });

  it("最后一个人确认的那一步就亮牌并结算完，不需要别的命令；之后谁都不能撤回", () => {
    let state = applyCommand(start(), 甲, { type: "select", card: 12 });
    state = applyCommand(state, 乙, { type: "select", card: 27 });
    expect(state.reveal).toBeNull();
    state = applyCommand(state, 丙, { type: "select", card: 41 });
    expect(state.events.map((event) => event.type)).toEqual(["Selected", "Revealed", "CardPlaced", "CardPlaced", "CardPlaced", "HandEnded"]);
    expect(state.reveal).toMatchObject({ id: 1, round: 1, turn: 1, done: true });
    expect(state.turn).toBe(2);
    expect(state.players.every((player) => !player.selected && player.selection === null && player.hand.length === 9)).toBe(true);
    expect(() => applyCommand(state, 甲, { type: "unselect" })).toThrow();
  });

  it("legalActions：没选的人每张手牌一个 select；选了的人有 unselect 和改选", () => {
    const state = applyCommand(start(), 甲, { type: "select", card: 12 });
    const mine = legalActions(state, 甲);
    expect(mine[0]).toEqual({ type: "unselect" });
    expect(mine.filter((action) => action.type === "select")).toHaveLength(9);
    expect(legalActions(state, 乙)).toHaveLength(10);
    expect(legalActions(state, "nobody")).toEqual([]);
    expect(waitingFor(state)).toEqual([乙, 丙]);
  });
});

describe("拍板#收牛头公开：本局收到的牌、牛头数、本局亮过的牌都在状态里", () => {
  it("收牌后 taken / roundBulls 更新，seenCards = 开局排头 + 每手亮出的牌", () => {
    const start = buildGame({ players: [{ include: [30] }, { include: [64] }], rows: [[10], [20, 21, 23, 24, 25], [40], [63]] });
    expect(start.seenCards).toEqual([10, 20, 21, 23, 24, 25, 40, 63]);
    const state = playHand(start, [30, 64]);
    expect(state.players[0]).toMatchObject({ taken: [20, 21, 23, 24, 25], roundBulls: 8, total: 0 });
    expect([...state.seenCards].sort((a, b) => a - b)).toEqual([10, 20, 21, 23, 24, 25, 30, 40, 63, 64]);
  });

  it("新开的一局 seenCards 只有 4 张排头", () => {
    const state = createGame(three, 3);
    expect([...state.seenCards].sort((a, b) => a - b)).toEqual(state.rows.flat().sort((a, b) => a - b));
  });
});

describe("纯函数和可复现", () => {
  it("apply 不改输入（深冻结后照样能用），version 每步 +1", () => {
    const state = deepFreeze(createGame(three, 42));
    const card = state.players[0]!.hand[0]!;
    const { state: next, events } = apply(state, 甲, { type: "select", card }, createRng(1));
    expect(next.version).toBe(state.version + 1);
    expect(events).toEqual(next.events);
    expect(state.players[0]!.selected).toBe(false);
  });

  it("同一种子、同一串动作 → 完全一样；按 log 重放能复现整局", () => {
    const play = (seed: number) => {
      let state = createGame(three, seed, { target: 20 });
      let guard = 0;
      while (state.phase !== "gameOver" && guard++ < 2000) state = timeoutTurn(state);
      return state;
    };
    const a = play(2024);
    const b = play(2024);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.phase).toBe("gameOver");
    let replay = createGame(three, 2024, { target: 20 });
    for (const entry of a.log!) replay = applyCommand(replay, entry.player, entry.command);
    expect(replay.finalResult).toEqual(a.finalResult);
    expect(replay.history).toEqual(a.history);
    expect(replay.rows).toEqual(a.rows);
  });

  it("随机数只来自参数里的 rng：发下一局的牌用传进来的 rng", () => {
    const ended = finishRound(createGame(three, 8));
    expect(ended.phase).toBe("roundEnd");
    let state = applyCommand(ended, 甲, { type: "nextRound" });
    state = applyCommand(state, 乙, { type: "nextRound" });
    const first = apply(state, 丙, { type: "nextRound" }, createRng(1)).state;
    const second = apply(state, 丙, { type: "nextRound" }, createRng(1)).state;
    const third = apply(state, 丙, { type: "nextRound" }, createRng(2)).state;
    expect(first.rows).toEqual(second.rows);
    expect(first.players.map((player) => player.hand)).toEqual(second.players.map((player) => player.hand));
    expect(third.players.map((player) => player.hand)).not.toEqual(first.players.map((player) => player.hand));
  });
});

describe("计时 key（服务器用）", () => {
  it("别人选牌 / 撤回不改变 key；亮牌换手、进入和离开 chooseRow、局末才变", () => {
    let state = buildGame({ players: [{ include: [4] }, { include: [7] }, { include: [30] }], rows: [[10, 13], [20, 21, 23, 24, 25], [40, 44, 48], [63]] });
    const first = stepKey(state);
    expect(first).toBe("1:1:select");
    state = applyCommand(state, 乙, { type: "select", card: 7 });
    expect(stepKey(state)).toBe(first);
    state = applyCommand(state, 乙, { type: "unselect" });
    expect(stepKey(state)).toBe(first);
    state = applyCommand(state, 乙, { type: "select", card: 7 });
    state = applyCommand(state, 丙, { type: "select", card: 30 });
    expect(stepKey(state)).toBe(first);
    state = applyCommand(state, 甲, { type: "select", card: 4 });
    expect(stepKey(state)).toBe("1:1:chooseRow");
    state = applyCommand(state, 甲, { type: "chooseRow", row: 3 });
    expect(stepKey(state)).toBe("1:2:select");
  });

  it("animationMs 按亮牌、接牌、收牌累加", () => {
    const state = playOnRows([[10], [20, 21, 23, 24, 25], [40], [63]], [30, 64]);
    expect(animationMs(state.events)).toBe(ANIMATION.flipMs + ANIMATION.takeMs + ANIMATION.placeMs);
    expect(animationMs([{ type: "Selected", player: 甲 }])).toBe(0);
  });
});

describe("局末：点继续或超时发下一局", () => {
  it("一局结束进入 roundEnd；有人点了继续还不发，所有人都点了才发；Ready 事件", () => {
    const ended = finishRound(createGame(three, 77));
    expect(ended.phase).toBe("roundEnd");
    expect(ended.turn).toBe(10);
    expect(ended.players.every((player) => player.hand.length === 0)).toBe(true);
    expect(waitingFor(ended)).toEqual([甲, 乙, 丙]);
    let state = applyCommand(ended, 甲, { type: "nextRound" });
    expect(state.events).toEqual([{ type: "Ready", player: 甲 }]);
    expect(state.phase).toBe("roundEnd");
    expect(() => applyCommand(state, 甲, { type: "nextRound" })).toThrow("已经点过继续了");
    expect(legalActions(state, 甲)).toEqual([]);
    state = applyCommand(state, 乙, { type: "nextRound" });
    state = applyCommand(state, 丙, { type: "nextRound" });
    expect(state.phase).toBe("select");
    expect(state.round).toBe(2);
    expect(state.events.map((event) => event.type)).toEqual(["Ready", "RoundStarted"]);
    expect(state.reveal).toBeNull();
  });

  it("局末超时：替没点的人点继续，直接发下一局（TimedOut 只列没点的人）", () => {
    const ended = finishRound(createGame(three, 77));
    const state = timeoutTurn(applyCommand(ended, 乙, { type: "nextRound" }));
    expect(state.events[0]).toEqual({ type: "TimedOut", phase: "roundEnd", players: [甲, 丙] });
    expect(state.phase).toBe("select");
    expect(state.round).toBe(2);
  });

  it("选牌阶段之外发 nextRound 拒绝", () => {
    expect(() => applyCommand(createGame(three, 1), 甲, { type: "nextRound" })).toThrow("现在不能开下一局");
  });
});

describe("超时代打", () => {
  it("选牌超时：只替还没选的人选（已选的人不动），全部选完就亮牌", () => {
    let state = buildGame({ players: [{ include: [12] }, { include: [27] }, { include: [41] }], rows: [[10], [25], [40], [63]] });
    state = applyCommand(state, 乙, { type: "select", card: 27 });
    const after = timeoutTurn(state);
    expect(after.events[0]).toEqual({ type: "TimedOut", phase: "select", players: [甲, 丙] });
    expect(after.reveal!.plays.find((play) => play.player === 乙)!.card).toBe(27);
    expect(after.log!.filter((entry) => entry.auto).map((entry) => entry.player)).toEqual([甲, 丙]);
  });

  it("policy 可以替换（人机阶段换成 botCommand）；给出不合法的动作时退回基线", () => {
    const state = buildGame({ players: [{ include: [12] }, { include: [27] }], rows: [[10], [25], [40], [63]] });
    const highest = timeoutTurn(state, (view, id) => ({ type: "select", card: Math.max(...view.players.find((player) => player.id === id)!.hand) }));
    expect(highest.reveal!.plays.map((play) => play.card)).toEqual(
      state.players.map((player) => Math.max(...player.hand)).sort((a, b) => a - b),
    );
    const broken = timeoutTurn(state, () => ({ type: "select", card: 999 }));
    expect(broken.reveal!.plays).toHaveLength(2);
    const throwing = timeoutTurn(state, () => {
      throw new Error("boom");
    });
    expect(throwing.reveal!.plays).toHaveLength(2);
    const unselect = timeoutTurn(state, () => ({ type: "unselect" }));
    expect(unselect.reveal!.plays).toHaveLength(2);
  });

  it("终局状态超时什么也不做", () => {
    const over = playHand(
      buildGame({ players: [{ hand: [3], total: 70 }, { hand: [31] }], rows: [[1, 2], [28], [50], [80]] }),
      [3, 31],
    );
    expect(over.phase).toBe("gameOver");
    expect(timeoutTurn(over)).toBe(over);
    expect(waitingFor(over)).toEqual([]);
  });
});

describe("开房变体", () => {
  it("normalizeOptions：默认 66 / 不固定 / 不开战术；不合法的值拒绝", () => {
    expect(normalizeOptions({})).toEqual({ target: 66, fixedRounds: null, tactics: false });
    expect(normalizeOptions({ target: 33, fixedRounds: 3, tactics: true })).toEqual({ target: 33, fixedRounds: 3, tactics: true });
    expect(normalizeOptions({ fixedRounds: null })).toEqual({ target: 66, fixedRounds: null, tactics: false });
    for (const bad of [{ target: 5 }, { target: 201 }, { target: 33.5 }, { target: "66" }, { fixedRounds: 0 }, { fixedRounds: 21 }, { fixedRounds: 2.5 }, { tactics: "yes" }]) {
      expect(() => normalizeOptions(bad), JSON.stringify(bad)).toThrow();
    }
    expect(() => normalizeOptions(null)).toThrow();
  });

  it("改目标分：到 33 就在局末结束", () => {
    const over = playHand(
      buildGame({ players: [{ hand: [3], total: 30, taken: [5, 15] }, { hand: [31], total: 10 }], rows: [[1, 2], [28], [50], [80]], options: { target: 33 } }),
      [3, 31],
    );
    expect(over.players[0]!.total).toBe(34);
    expect(over.phase).toBe("gameOver");
    expect(over.finalResult).toMatchObject({ winners: [乙], reason: "target" });
    // 同样的分数在默认 66 下继续
    const goOn = playHand(
      buildGame({ players: [{ hand: [3], total: 30, taken: [5, 15] }, { hand: [31], total: 10 }], rows: [[1, 2], [28], [50], [80]] }),
      [3, 31],
    );
    expect(goOn.phase).toBe("roundEnd");
  });

  it("固定局数：打满 N 局才结束、不看目标分；第 N 局打完就结束（没人到 66 也结束）", () => {
    const spec = { players: [{ hand: [3], total: 80, taken: [5, 15] }, { hand: [31], total: 10 }], rows: [[1, 2], [28], [50], [80]] };
    const notYet = playHand(buildGame({ ...spec, options: { fixedRounds: 3 }, round: 2 }), [3, 31]);
    expect(notYet.phase).toBe("roundEnd");
    const done = playHand(buildGame({ ...spec, options: { fixedRounds: 3 }, round: 3 }), [3, 31]);
    expect(done.phase).toBe("gameOver");
    expect(done.finalResult).toMatchObject({ winners: [乙], rounds: 3, reason: "rounds" });
    const quiet = playHand(
      buildGame({ players: [{ hand: [3], total: 1 }, { hand: [31], total: 2 }], rows: [[1, 2], [28], [50], [80]], options: { fixedRounds: 1 } }),
      [3, 31],
    );
    expect(quiet.finalResult).toMatchObject({ winners: [甲], rounds: 1, reason: "rounds" });
  });

  it("战术模式：每一局都只用 1 到人数×10+4（下一局重新发也一样）", () => {
    const ended = finishRound(createGame(three, 31, { tactics: true }));
    expect(ended.deck).toEqual([]);
    const all = [...ended.rows.flat(), ...ended.players.flatMap((player) => player.taken)].sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: 34 }, (_, index) => index + 1));
    let next = ended;
    for (const player of ended.players) next = applyCommand(next, player.id, { type: "nextRound" });
    const dealt = [...next.rows.flat(), ...next.players.flatMap((player) => player.hand)].sort((a, b) => a - b);
    expect(dealt).toEqual(Array.from({ length: 34 }, (_, index) => index + 1));
  });

  it("人数不对、id 重复拒绝开局", () => {
    expect(() => createGame([{ id: "a", name: "甲" }])).toThrow("2–10");
    expect(() => createGame(Array.from({ length: 11 }, (_, index) => ({ id: `p${index}`, name: `x${index}` })))).toThrow("2–10");
    expect(() => createGame([{ id: "a", name: "甲" }, { id: "a", name: "乙" }])).toThrow("重复");
  });
});

describe("迟到的点击和动作整理", () => {
  it("动作带 step：和当前这一步对不上就拒绝（这一手已经亮牌了，点击才到），对得上照常", () => {
    const start = buildGame({ players: [{ include: [12, 16] }, { include: [27] }], rows: [[10], [25], [40], [63]] });
    const seen = stepKey(start);
    // 乙选好，甲超时被代出 → 进入第 2 手
    const next = timeoutTurn(applyCommand(start, 乙, { type: "select", card: 27 }));
    expect(next.turn).toBe(2);
    // 甲按第 1 手看到的局面点了 16：拒绝，不会变成第 2 手的选择
    const late = next.players[0]!.hand.includes(16) ? 16 : next.players[0]!.hand[0]!;
    expect(() => applyCommand(next, 甲, { type: "select", card: late, step: seen })).toThrow("已经结算");
    expect(() => applyCommand(next, 甲, { type: "unselect", step: seen })).toThrow("已经结算");
    // 带上当前的 step 照常
    const ok = applyCommand(next, 甲, { type: "select", card: late, step: stepKey(next) });
    expect(ok.players[0]!.selection).toBe(late);
  });

  it("客户端多塞的字段一概丢掉：不影响校验，也不进动作序列；step 不记进序列", () => {
    const start = createGame(three, 4);
    const card = start.players[0]!.hand[0]!;
    const junk = { type: "select", card, step: stepKey(start), padding: "x".repeat(10_000), nested: { a: 1 } } as unknown as Parameters<typeof applyCommand>[2];
    const state = applyCommand(start, 甲, junk);
    expect(state.log!.at(-1)).toEqual({ player: 甲, command: { type: "select", card } });
    expect(JSON.stringify(state.log).length).toBeLessThan(200);
    expect(normalizeCommand({ type: "chooseRow", row: 2, extra: [1, 2, 3] })).toEqual({ type: "chooseRow", row: 2 });
    expect(normalizeCommand({ type: "nextRound", step: "x".repeat(100) })).toEqual({ type: "nextRound" });
    expect(() => normalizeCommand(null)).toThrow();
    expect(() => normalizeCommand({ type: "fly" })).toThrow("未知的行动");
    expect(() => applyCommand(start, 甲, { type: "select", card: "12" } as unknown as Parameters<typeof applyCommand>[2])).toThrow("不在你手里");
  });

  it("applyCommand 的 auto：托管 / 离线代选的规则 C 标成 auto", () => {
    const waiting = playOnRows([[10, 13], [25], [40, 44, 48], [63]], [4, 7]);
    const state = applyCommand(waiting, 甲, { type: "chooseRow", row: 3 }, { auto: true });
    expect(state.reveal!.steps[0]!.auto).toBe(true);
    expect(state.events[0]).toMatchObject({ type: "RowTaken", auto: true });
    expect(state.log!.at(-1)!.auto).toBe(true);
    expect(applyCommand(waiting, 甲, { type: "chooseRow", row: 3 }).reveal!.steps[0]!.auto).toBeUndefined();
  });
});
