/** 预览局面工厂（对外接口）：每个场景都能造出来、符合说明；精确局面的参数校验；房间快照的视角。 */
import { describe, expect, it } from "vitest";
import {
  applyCommand,
  buildGame,
  createScene,
  createSceneRoom,
  legalActions,
  playHand,
  revealAt,
  revealFrames,
  SCENE_DESCRIPTIONS,
  SCENE_NAMES,
  stateProblems,
  sumBulls,
  waitingFor,
} from "../src/index.js";

describe("预览局面#按名字造", () => {
  it("每个场景都有说明，造出来的状态还能接着打（除了 gameOver）", () => {
    for (const name of SCENE_NAMES) {
      expect(SCENE_DESCRIPTIONS[name], name).toBeTruthy();
      const state = createScene(name);
      if (state.phase === "gameOver") continue;
      const waiting = waitingFor(state);
      expect(waiting.length, name).toBeGreaterThan(0);
      const actor = waiting[0]!;
      const action = legalActions(state, actor).find((candidate) => candidate.type !== "unselect")!;
      expect(() => applyCommand(state, actor, action), name).not.toThrow();
    }
  });

  it("各场景的关键特征", () => {
    expect(createScene("opening").players.every((player) => !player.selected)).toBe(true);
    const some = createScene("selectSome");
    expect(some.players[0]!.selected).toBe(false);
    expect(some.players.filter((player) => player.selected).length).toBeGreaterThan(0);
    expect(createScene("selectedMine").players[0]!.selected).toBe(true);
    expect(waitingFor(createScene("waitingOne"))).toHaveLength(1);
    const mid = createScene("midRound");
    expect(mid.turn).toBe(5);
    expect(mid.players.some((player) => player.taken.length > 0) || mid.rows.some((row) => row.length > 2)).toBe(true);
    const reveal = createScene("reveal");
    expect(reveal.reveal!.steps.some((step) => step.kind === "sixth")).toBe(true);
    expect(reveal.reveal!.steps.some((step) => step.kind === "place")).toBe(true);
    expect(createScene("chooseRow")).toMatchObject({ phase: "chooseRow", chooser: "p1" });
    expect(createScene("chooseRowOther")).toMatchObject({ phase: "chooseRow", chooser: "p2" });
    expect(createScene("afterChooseRow").rows).toEqual([[10, 13], [30], [40, 44, 48, 50], [4, 7]]);
    const double = createScene("doubleSixth");
    expect(double.reveal!.steps.map((step) => step.kind)).toEqual(["sixth", "place", "place"]);
    expect(double.rows[1]).toEqual([26, 27]);
    expect(createScene("lastHand").players.every((player) => player.hand.length === 1)).toBe(true);
    expect(createScene("roundEnd").phase).toBe("roundEnd");
    expect(createScene("gameOver").finalResult!.winners).toHaveLength(1);
    expect(createScene("gameOverTie").finalResult!.winners).toHaveLength(2);
    expect(createScene("tenPlayers").players).toHaveLength(10);
    expect(createScene("tenPlayersReveal").reveal!.plays).toHaveLength(10);
    const tactics = createScene("tactics");
    expect(tactics.config.tactics).toBe(true);
    expect(tactics.deck).toEqual([]);
    expect(createScene("timeout").events[0]).toMatchObject({ type: "TimedOut", phase: "select" });
    expect(createScene("fixedRounds")).toMatchObject({ round: 3, config: { fixedRounds: 3 } });
    expect(createScene("opening", { players: 7 }).players).toHaveLength(7);
  });
});

describe("预览局面#按参数造精确局面", () => {
  it("buildGame：指定手牌、4 排、累计、收牌堆、第几局第几手；没给的随机补齐", () => {
    const state = buildGame({
      players: [{ name: "阿甲", hand: [3, 99], total: 12, taken: [55] }, { include: [50] }, {}],
      rows: [[10, 13], [25], [40, 44, 48], [63]],
      round: 2,
    });
    expect(state.turn).toBe(9);
    expect(state.round).toBe(2);
    expect(state.players[0]).toMatchObject({ name: "阿甲", hand: [3, 99], total: 12, taken: [55], roundBulls: 7 });
    expect(state.players[1]!.hand).toContain(50);
    expect(state.players.every((player) => player.hand.length === 2)).toBe(true);
    const all = [...state.players.flatMap((player) => [...player.hand, ...player.taken]), ...state.rows.flat(), ...state.deck!];
    expect(new Set(all).size).toBe(104);
  });

  it("buildGame 校验：重复的牌、排不递增、超过 5 张、手牌张数不一样、所有人都选好", () => {
    expect(() => buildGame({ players: [{ hand: [5] }, { hand: [5] }] })).toThrow("用了两次");
    expect(() => buildGame({ players: 2, rows: [[13, 10], [25], [40], [63]] })).toThrow("递增");
    expect(() => buildGame({ players: 2, rows: [[1, 2, 3, 4, 5, 6], [25], [40], [63]] })).toThrow("1–5");
    expect(() => buildGame({ players: 2, rows: [[1], [25], [40]] })).toThrow("4 排");
    expect(() => buildGame({ players: [{ hand: [5] }, { hand: [6, 7] }] })).toThrow("一样多");
    expect(() => buildGame({ players: [{ hand: [5], selection: 5 }, { hand: [6], selection: 6 }] })).toThrow("playHand");
    expect(() => buildGame({ players: [{ hand: [40] }, {}], options: { tactics: true } })).toThrow("不在这一局用的牌里");
    expect(() => buildGame({ players: 1 })).toThrow();
  });

  it("playHand：数组按座位、对象按 id；没给的人按基线出；规则 C 可以顺手选排", () => {
    const base = buildGame({ players: [{ include: [4] }, { include: [7] }, {}], rows: [[10, 13], [25], [40, 44, 48], [63]] });
    const waiting = playHand(base, { p1: 4, p2: 7 });
    expect(waiting.phase).toBe("chooseRow");
    const done = playHand(base, [4, 7], 3);
    expect(done.phase).toBe("select");
    expect(done.rows[3]).toEqual([4, 7]);
    const chosen = playHand(base, [4, 7], () => 1);
    expect(chosen.rows[1]).toEqual([4, 7]);
  });

  it("revealFrames / revealAt：亮牌逐张的画面", () => {
    const state = createScene("afterChooseRow");
    const frames = revealFrames(state);
    expect(frames).toHaveLength(5);
    expect(frames[0]!.rows).toEqual([[10, 13], [20, 21, 23, 24, 25], [40, 44, 48], [63]]);
    expect(frames[1]!.step).toMatchObject({ kind: "low", card: 4, row: 3 });
    expect(frames[4]!.rows).toEqual(state.rows);
    const mid = revealAt(state, 2);
    expect(mid.rows).toEqual([[10, 13], [20, 21, 23, 24, 25], [40, 44, 48], [4, 7]]);
    expect(mid.reveal!.steps).toHaveLength(2);
    expect(mid.reveal!.done).toBe(false);
    expect(revealFrames(createScene("opening"))).toEqual([]);
  });
});

describe("预览局面#房间快照", () => {
  it("座位视角：只看到自己的手牌；成员 id 是 sock-<座位>；离线、人机、托管标记", () => {
    const room = createSceneRoom(createScene("selectSome"), { offline: ["p3"], bots: ["p4"], auto: ["p2"] });
    expect(room.status).toBe("playing");
    expect(room.members.map((member) => member.id)).toEqual(["sock-p1", "sock-p2", "sock-p3", "sock-p4"]);
    expect(room.members[2]!.connected).toBe(false);
    expect(room.members[3]).toMatchObject({ bot: true, name: "咕噜一号" });
    expect(room.members[1]!.auto).toBe(true);
    expect(room.game!.players[0]!.hand).toHaveLength(10);
    expect(room.game!.players.slice(1).every((player) => player.hand.length === 0)).toBe(true);
    expect(room.turnRemainingMs).toBe(30_000);
    expect(room.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect((room.game as unknown as Record<string, unknown>).deck).toBeUndefined();
  });

  it("观战视角：默认看不到手牌，seeAll 看得到；没有房间码", () => {
    const blind = createSceneRoom(createScene("opening"), { spectator: true });
    expect(blind.code).toBe("");
    expect(blind.game!.players.every((player) => player.hand.length === 0)).toBe(true);
    const god = createSceneRoom(createScene("opening"), { spectator: true, seeAll: true });
    expect(god.access.spectatorsSeeAll).toBe(true);
    expect(god.game!.players.every((player) => player.hand.length === 10)).toBe(true);
  });

  it("终局带「再来一局」投票，没有倒计时；选排阶段倒计时 20 秒", () => {
    const over = createSceneRoom(createScene("gameOver"), { bots: ["p2"] });
    expect(over.turnRemainingMs).toBeUndefined();
    expect(over.rematch!.acceptedIds).toEqual(["sock-p2"]);
    expect(createSceneRoom(createScene("chooseRow")).turnRemainingMs).toBe(20_000);
    expect(createSceneRoom(createScene("roundEnd"), { turnRemainingMs: 1234 }).turnRemainingMs).toBe(1234);
  });
});

describe("预览局面#和引擎的不变量一致", () => {
  it("buildGame 编的 history 有 round − 1 条，累计 = 各局之和", () => {
    const state = buildGame({ players: [{ total: 20 }, { total: 7 }], round: 3 });
    expect(state.history).toHaveLength(2);
    for (const player of state.players) {
      expect(state.history.reduce((sum, result) => sum + (result.bulls[player.id] ?? 0), 0)).toBe(player.total);
    }
  });

  it("2 人局的 selectSome：对手已选、我没选", () => {
    const state = createScene("selectSome", { players: 2 });
    expect(state.players.map((player) => player.selected)).toEqual([false, true]);
  });
});

describe("预览局面#张数和真实对局对得上、动画帧", () => {
  it("每个场景都过 stateProblems（桌上的牌数和第几手对得上、牌守恒、累计 = 各局之和……）", () => {
    for (const name of SCENE_NAMES) expect(stateProblems(createScene(name)), name).toEqual([]);
    for (const players of [2, 3, 5, 10]) {
      for (const name of ["opening", "selectSome", "selectedMine", "waitingOne", "midRound", "timeout"] as const) {
        expect(stateProblems(createScene(name, { players })), `${name} ${players} 人`).toEqual([]);
      }
    }
  });

  it("stateProblems 能查出不一致：buildGame 随手摆的局面桌上牌数和第几手对不上", () => {
    const loose = buildGame({ players: 4, rows: [[10, 13], [20, 21, 23, 24, 25], [40, 44, 48], [63]] });
    expect(stateProblems(loose).some((problem) => problem.includes("没发的牌"))).toBe(true);
    const tactics = buildGame({ players: 3, options: { tactics: true }, turn: 3 });
    expect(stateProblems(tactics).some((problem) => problem.includes("没发的牌"))).toBe(true);
  });

  it("revealFrames 的每一帧都带收牌堆和本局牛头：收牌那一步之前没算进来", () => {
    const state = createScene("reveal");
    const frames = revealFrames(state);
    const takeAt = frames.findIndex((frame) => frame.step?.kind === "sixth");
    const taker = frames[takeAt]!.step!.player;
    expect(frames[takeAt - 1]!.taken[taker]).toEqual(state.players.find((player) => player.id === taker)!.taken.slice(0, -5));
    expect(frames[takeAt]!.taken[taker]).toEqual(state.players.find((player) => player.id === taker)!.taken);
    expect(frames.at(-1)!.roundBulls[taker]).toBe(state.players.find((player) => player.id === taker)!.roundBulls);
  });

  it("revealAt 不会让同一张牌同时在排上和收牌堆里", () => {
    for (const name of ["reveal", "afterChooseRow", "doubleSixth", "roundEnd", "gameOver", "tenPlayersReveal"] as const) {
      const state = createScene(name);
      for (let k = 0; k < revealFrames(state).length; k += 1) {
        const frame = revealAt(state, k);
        const all = [...frame.rows.flat(), ...frame.players.flatMap((player) => player.taken)];
        expect(new Set(all).size, `${name} 第 ${k} 帧`).toBe(all.length);
        for (const player of frame.players) expect(player.roundBulls).toBe(sumBulls(player.taken));
      }
    }
  });
});
