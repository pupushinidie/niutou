/**
 * 服务器全流程：建房（开房选项）→ 改选项 → 加入 → 开局 → 选牌 / 撤回 / 改选 → 亮牌 → 规则 C 选排 → 局末继续 → 终局 → 再来一局；
 * 计时 key（别人选牌不重置倒计时）、原昵称重连、管理员解散、首页列表、每个连接收到的数据里没有别人的牌。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildGame, legalActions, stepKey, type GameState, type LobbyRoomSnapshot } from "@niutou/game";
import { call, command, delay, join, ok, seatOf, startServer, updateWhere, type Harness, type TestSocket } from "./harness.js";

// 管理员口令、人机立刻行动要在服务器 import 之前设好。不设 TURN_MS：用真实的 30 秒限时，超时用 testHooks 触发。
process.env.ADMIN_TOKEN = "flow-test-token";
process.env.BOT_DELAY_SCALE = "0";
delete process.env.TURN_MS;

let h: Harness;
let nameSeq = 0;
const nick = (prefix: string) => `${prefix}${++nameSeq}`;

beforeAll(async () => {
  h = await startServer();
});
afterAll(async () => {
  await h.close();
});

async function threeSeats(options: Record<string, unknown> = {}): Promise<{ code: string; host: TestSocket; a: TestSocket; b: TestSocket; names: string[] }> {
  const host = await h.connect();
  const names = [nick("房主"), nick("阿牛"), nick("小花")];
  const created = await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: names[0]!, capacity: 3, options } as never, ack)));
  const a = await h.connect();
  const b = await h.connect();
  await ok(join(a, { name: names[1]!, code: created.code }));
  await ok(join(b, { name: names[2]!, code: created.code }));
  return { code: created.code, host, a, b, names };
}

const gameOf = (client: TestSocket): GameState => h.latest.get(client)!.game!;
const meIn = (client: TestSocket) => gameOf(client).players.find((player) => player.id === seatOf(h, client))!;

/** 把房间换成精确局面（玩家 id 用座位 p1–p3、名字用房间里的）。 */
function inject(code: string, names: string[], spec: Omit<Parameters<typeof buildGame>[0], "players"> & { players: Record<string, unknown>[] }): void {
  const game = buildGame({ ...spec, players: spec.players.map((player, index) => ({ ...player, id: `p${index + 1}`, name: names[index]! })) } as Parameters<typeof buildGame>[0]);
  h.server.testHooks.setGame(code, game);
}

describe("服务器全流程", () => {
  it("建房带开房选项；只有房主能在等候时改；不合法的拒绝", async () => {
    const host = await h.connect();
    const bad = await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("房主"), capacity: 4, options: { target: 3 } } as never, ack));
    expect(bad.ok).toBe(false);
    const tooMany = await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("房主"), capacity: 11 } as never, ack));
    expect(tooMany.ok).toBe(false);
    const room = await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("房主"), capacity: 10, options: { target: 40 } } as never, ack)));
    expect(room.options).toEqual({ target: 40, fixedRounds: null, tactics: false });
    expect(room.capacity).toBe(10);
    const guest = await h.connect();
    await ok(join(guest, { name: nick("客人"), code: room.code }));
    expect((await call<void>((ack) => guest.emit("room:options", { tactics: true }, ack))).ok).toBe(false);
    expect((await call<void>((ack) => host.emit("room:options", { target: 5 }, ack))).ok).toBe(false);
    await ok(call<void>((ack) => host.emit("room:options", { tactics: true, fixedRounds: 2 }, ack)));
    const updated = await updateWhere(h, guest, (snapshot) => snapshot.options.tactics);
    expect(updated.options).toEqual({ target: 40, fixedRounds: 2, tactics: true });
    await ok(call<void>((ack) => host.emit("room:options", { fixedRounds: null }, ack)));
    await updateWhere(h, guest, (snapshot) => snapshot.options.fixedRounds === null);
    // 开局后按选项发牌：战术 2 人只用 1–24
    await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack)));
    const started = await updateWhere(h, guest, (snapshot) => snapshot.game !== undefined);
    expect(started.game!.config).toMatchObject({ target: 40, fixedRounds: null, tactics: true });
    expect(Math.max(...started.game!.players.find((player) => player.hand.length > 0)!.hand)).toBeLessThanOrEqual(24);
    expect((await call<void>((ack) => host.emit("room:options", { tactics: false }, ack))).ok).toBe(false);
    await ok(call<void>((ack) => host.emit("room:dissolve", ack)));
  });

  it("开局 → 选牌 / 撤回 / 改选 → 最后一人确认就亮牌 → 规则 C 选排 → 局末继续 → 终局 → 再来一局", async () => {
    const { code, host, a, b, names } = await threeSeats({ fixedRounds: 2 });
    await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack)));
    for (const client of [host, a, b]) await updateWhere(h, client, (snapshot) => snapshot.game !== undefined);
    expect(gameOf(host)).toMatchObject({ phase: "select", round: 1, turn: 1 });

    // 选牌：别人只看到「已选好」
    const card = meIn(host).hand[0]!;
    await ok(command(host, { type: "select", card }, h));
    let seen = await updateWhere(h, a, (snapshot) => snapshot.game?.players[0]!.selected === true);
    expect(seen.game!.players[0]!.selection).toBeNull();
    // 撤回
    await ok(command(host, { type: "unselect" }, h));
    seen = await updateWhere(h, a, (snapshot) => !snapshot.game?.players[0]!.selected);
    // 再选、改选
    await ok(command(host, { type: "select", card }, h));
    await ok(command(host, { type: "select", card: meIn(host).hand[1]! }, h));
    expect(meIn(host).selection).toBe(meIn(host).hand[1]);
    await ok(command(a, { type: "select", card: meIn(a).hand[0]! }, h));
    expect(gameOf(host).reveal).toBeNull();
    // 最后一人确认 → 亮牌结算完，进入第 2 手
    const version = gameOf(b).version;
    await ok(command(b, { type: "select", card: meIn(b).hand[0]! }, h));
    const revealed = await updateWhere(h, host, (snapshot) => (snapshot.game?.version ?? 0) > version && snapshot.game?.reveal != null);
    expect(revealed.game!.reveal!.plays).toHaveLength(3);
    expect(revealed.game!.events.map((event) => event.type)).toContain("Revealed");
    // 随机发的牌可能碰上规则 C：那就让出牌的人选第 1 排，把这一手结算完
    if (revealed.game!.phase === "chooseRow") {
      const chooser = [host, a, b].find((client) => seatOf(h, client) === revealed.game!.chooser)!;
      await ok(command(chooser, { type: "chooseRow", row: 0 }, h));
    }
    await updateWhere(h, host, (snapshot) => snapshot.game?.phase === "select" && snapshot.game?.turn === 2);
    // 亮牌后不能撤回上一手（这一手还没选）
    expect((await command(host, { type: "unselect" }, h)).ok).toBe(false);

    // 规则 C：换成例 1 的局面（我出 4）
    inject(code, names, {
      players: [{ include: [4] }, { include: [30] }, { include: [50] }],
      rows: [[10, 13], [20, 21, 23, 24, 25], [40, 44, 48], [63]],
      options: { fixedRounds: 2 },
    });
    await updateWhere(h, host, (snapshot) => snapshot.game?.turn === 1 && snapshot.game?.rows[0]!.length === 2);
    await ok(command(a, { type: "select", card: 30 }, h));
    await ok(command(b, { type: "select", card: 50 }, h));
    await ok(command(host, { type: "select", card: 4 }, h));
    const choosing = await updateWhere(h, a, (snapshot) => snapshot.game?.phase === "chooseRow");
    expect(choosing.game!.chooser).toBe("p1");
    expect(legalActions(choosing.game!, "p2")).toEqual([]);
    expect((await command(a, { type: "chooseRow", row: 3 }, h)).ok).toBe(false);
    await ok(command(host, { type: "chooseRow", row: 3 }, h));
    const resolved = await updateWhere(h, a, (snapshot) => snapshot.game?.phase === "select" && snapshot.game?.turn === 2);
    expect(resolved.game!.rows).toEqual([[10, 13], [30], [40, 44, 48, 50], [4]]);
    expect(resolved.game!.players.map((player) => player.roundBulls)).toEqual([1, 8, 0]);

    // 局末：最后一手打完 → roundEnd → 大家点继续 → 第 2 局
    inject(code, names, {
      players: [{ hand: [3], taken: [5] }, { hand: [31] }, { hand: [51] }],
      rows: [[1, 2], [28], [50], [80]],
      options: { fixedRounds: 2 },
    });
    await updateWhere(h, b, (snapshot) => snapshot.game?.turn === 10);
    await ok(command(host, { type: "select", card: 3 }, h));
    await ok(command(a, { type: "select", card: 31 }, h));
    await ok(command(b, { type: "select", card: 51 }, h));
    const roundEnd = await updateWhere(h, host, (snapshot) => snapshot.game?.phase === "roundEnd");
    expect(roundEnd.game!.players.map((player) => player.total)).toEqual([2, 0, 0]);
    expect(roundEnd.turnRemainingMs).toBeGreaterThan(0);
    for (const client of [host, a]) await ok(command(client, { type: "nextRound" }, h));
    expect(gameOf(host).phase).toBe("roundEnd");
    await ok(command(b, { type: "nextRound" }, h));
    const second = await updateWhere(h, host, (snapshot) => snapshot.game?.round === 2 && snapshot.game?.phase === "select");
    expect(second.game!.players[0]!.hand).toHaveLength(10);

    // 终局：固定 2 局，第 2 局打完就结束 → 继续投票 → 都同意 → 新的一场
    inject(code, names, {
      players: [{ hand: [3], total: 9 }, { hand: [31], total: 5, taken: [11] }, { hand: [51], total: 9 }],
      rows: [[1, 2], [28], [50], [80]],
      options: { fixedRounds: 2 },
      round: 2,
    });
    await updateWhere(h, a, (snapshot) => snapshot.game?.round === 2 && snapshot.game?.turn === 10);
    await ok(command(host, { type: "select", card: 3 }, h));
    await ok(command(a, { type: "select", card: 31 }, h));
    await ok(command(b, { type: "select", card: 51 }, h));
    const over = await updateWhere(h, host, (snapshot) => snapshot.game?.phase === "gameOver");
    expect(over.game!.finalResult).toMatchObject({ winners: ["p1", "p3"], reason: "rounds" });
    expect(over.rematch).toBeDefined();
    expect(over.turnRemainingMs).toBeUndefined();
    const summary = await ok(call<import("@niutou/game").PublicRoomSummary[]>((ack) => h.connect().then((spy) => spy.emit("lobby:get", ack))));
    const listed = summary.find((room) => room.players[0]?.name === names[0])!;
    expect(listed.status).toBe("finished");
    expect(listed.players.filter((player) => player.isWinner).map((player) => player.name)).toEqual([names[0], names[2]]);
    for (const client of [host, a, b]) await ok(call<void>((ack) => client.emit("room:rematch", true, ack)));
    const again = await updateWhere(h, host, (snapshot) => !snapshot.rematch && snapshot.game?.phase === "select" && snapshot.game?.round === 1);
    expect(again.game!.players.every((player) => player.total === 0)).toBe(true);
    expect(again.game!.config.fixedRounds).toBe(2);
    await ok(call<void>((ack) => host.emit("room:dissolve", ack)));
  }, 30_000);

  it("计时 key：别人选牌、撤回、改选都不重置倒计时；亮牌换手、进入 chooseRow 才重新计时", async () => {
    const { code, host, a, b, names } = await threeSeats();
    await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack)));
    await updateWhere(h, b, (snapshot) => snapshot.game !== undefined);
    const first = h.server.testHooks.deadline(code)!;
    expect(first.key).toBe("1:1:select");
    // 30 秒 + 动画（开局没有动画）
    expect(first.deadline - Date.now()).toBeGreaterThan(29_000);
    await delay(30);
    await ok(command(a, { type: "select", card: meIn(a).hand[0]! }, h));
    await ok(command(a, { type: "unselect" }, h));
    await ok(command(a, { type: "select", card: meIn(a).hand[2]! }, h));
    await ok(command(host, { type: "select", card: meIn(host).hand[0]! }, h));
    await ok(command(host, { type: "select", card: meIn(host).hand[1]! }, h));
    expect(h.server.testHooks.deadline(code)).toEqual(first);
    // 快照里的剩余时间在走
    const snap = await updateWhere(h, b, (snapshot) => snapshot.game?.players[0]!.selected === true);
    expect(snap.turnRemainingMs!).toBeLessThan(30_000);
    // 换成都能安全接上的局面，最后一人确认 → 亮牌 → 第 2 手，重新计时（30 秒 + 结算动画）
    inject(code, names, { players: [{ hand: [12, 90] }, { hand: [27, 91] }, { hand: [41, 92] }], rows: [[10], [25], [40], [63]] });
    await updateWhere(h, b, (snapshot) => snapshot.game?.rows[0]!.length === 1 && snapshot.game?.turn === 9);
    const injected = h.server.testHooks.deadline(code)!;
    expect(injected.key).toBe("1:9:select");
    await ok(command(host, { type: "select", card: 12 }, h));
    await ok(command(a, { type: "select", card: 27 }, h));
    expect(h.server.testHooks.deadline(code)).toEqual(injected);
    await ok(command(b, { type: "select", card: 41 }, h));
    const second = h.server.testHooks.deadline(code)!;
    expect(second.key).toBe("1:10:select");
    expect(second.deadline - Date.now()).toBeGreaterThan(30_000 + 1_200 + 3 * 700 - 500);

    inject(code, names, { players: [{ include: [4] }, { include: [7] }, { include: [30] }], rows: [[10, 13], [25], [40, 44, 48], [63]] });
    await updateWhere(h, host, (snapshot) => snapshot.game?.turn === 1);
    await ok(command(a, { type: "select", card: 7 }, h));
    await ok(command(b, { type: "select", card: 30 }, h));
    await ok(command(host, { type: "select", card: 4 }, h));
    const choose = h.server.testHooks.deadline(code)!;
    expect(choose.key).toBe("1:1:chooseRow");
    // 选排 20 秒 + 亮牌翻面动画
    expect(choose.deadline - Date.now()).toBeGreaterThan(20_000);
    expect(choose.deadline - Date.now()).toBeLessThan(22_000);
    await ok(call<void>((ack) => host.emit("room:dissolve", ack)));
  });

  it("超时（testHooks 触发）：选牌按基线代出，规则 C 按基线代选；真人连续 2 次转托管", async () => {
    const { code, host, a, b, names } = await threeSeats();
    await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack)));
    await updateWhere(h, b, (snapshot) => snapshot.game !== undefined);
    inject(code, names, { players: [{ hand: [4, 49] }, { hand: [7, 90] }, { hand: [30, 91] }], rows: [[10, 13], [25], [40, 44, 48], [63]] });
    await updateWhere(h, host, (snapshot) => snapshot.game?.rows[0]!.length === 2);
    await ok(command(a, { type: "select", card: 7 }, h));
    await ok(command(b, { type: "select", card: 30 }, h));
    // 房主超时：基线出能安全接上、差值最小的 49（不是最小的 4）
    h.server.testHooks.expireTurn(code);
    const timed = await updateWhere(h, a, (snapshot) => snapshot.game?.reveal !== null);
    expect(timed.game!.events[0]).toEqual({ type: "TimedOut", phase: "select", players: ["p1"] });
    expect(timed.game!.reveal!.plays.find((play) => play.player === "p1")!.card).toBe(49);
    expect(timed.members.find((member) => member.playerId === "p1")!.auto).toBeUndefined();

    // 规则 C 超时：乙出 4，比所有排尾都小，按人机算法代选（这个局面里就是牛头最少的第 4 排）
    inject(code, names, { players: [{ include: [60] }, { include: [4] }, { include: [70] }], rows: [[10, 13], [25], [40, 44, 48], [63]] });
    await updateWhere(h, host, (snapshot) => snapshot.game?.turn === 1);
    await ok(command(host, { type: "select", card: 60 }, h));
    await ok(command(b, { type: "select", card: 70 }, h));
    await ok(command(a, { type: "select", card: 4 }, h));
    await updateWhere(h, a, (snapshot) => snapshot.game?.phase === "chooseRow");
    h.server.testHooks.expireTurn(code);
    const chosen = await updateWhere(h, a, (snapshot) => snapshot.game?.phase === "select" && snapshot.game?.turn === 2);
    expect(chosen.game!.reveal!.steps[0]).toMatchObject({ kind: "low", row: 3, auto: true, player: "p2" });
    // 乙这是第一次超时；再超时一次（选牌）就转托管
    h.server.testHooks.expireTurn(code);
    const auto = await updateWhere(h, a, (snapshot) => snapshot.members.find((member) => member.playerId === "p2")!.auto === true);
    // 甲、丙之前自己动过（超时次数清零），这次各记 1 次；乙是连续第 2 次
    expect(auto.members.filter((member) => member.auto).map((member) => member.playerId)).toEqual(["p2"]);
    // 自己动一下就取消托管
    await updateWhere(h, a, (snapshot) => snapshot.game?.phase === "select");
    const mine = meIn(a);
    if (!mine.selected) await ok(command(a, { type: "select", card: mine.hand[0]! }, h));
    else await ok(command(a, { type: "unselect" }, h));
    await updateWhere(h, a, (snapshot) => snapshot.members.find((member) => member.playerId === "p2")!.auto === undefined);
    await ok(call<void>((ack) => host.emit("room:dissolve", ack)));
  });

  it("掉线后用原昵称回到原座位，还是自己的手牌", async () => {
    const { code, host, a, names } = await threeSeats();
    await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack)));
    await updateWhere(h, a, (snapshot) => snapshot.game !== undefined);
    const hand = [...meIn(a).hand];
    a.disconnect();
    await updateWhere(h, host, (snapshot) => snapshot.members.find((member) => member.playerId === "p2")!.connected === false);
    const other = await h.connect();
    expect((await join(other, { name: nick("陌生"), code })).ok).toBe(false);
    const back = await h.connect();
    const rejoined = await ok(join(back, { name: names[1]!, code }));
    expect(rejoined.members.find((member) => member.id === back.id)).toMatchObject({ playerId: "p2", connected: true });
    const me = rejoined.game!.players.find((player) => player.id === "p2")!;
    // 离线时人机可能已经替他选好了一张（不算超时）；手牌没变
    expect(me.hand).toEqual(hand);
    expect(rejoined.game!.players.find((player) => player.id === "p1")!.hand).toEqual([]);
    await ok(call<void>((ack) => host.emit("room:dissolve", ack)));
  });

  it("管理员解散：口令不对拒绝；对了房间关闭，所有人和观战的人都收到通知", async () => {
    const { host, a, b, names } = await threeSeats();
    const viewer = await h.connect();
    await ok(join(viewer, { name: nick("看客"), code: h.latest.get(host)!.code, spectate: true }));
    await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack)));
    const admin = await h.connect();
    const rooms = await ok(call<import("@niutou/game").PublicRoomSummary[]>((ack) => admin.emit("lobby:get", ack)));
    const target = rooms.find((room) => room.players[0]?.name === names[0])!;
    expect(target.status).toBe("playing");
    expect(target.options).toEqual({ target: 66, fixedRounds: null, tactics: false });
    expect(target.players.every((player) => player.isActive)).toBe(true);
    expect((await call<void>((ack) => admin.emit("admin:dissolve", { roomId: target.id, token: "wrong" }, ack))).ok).toBe(false);
    const closed = Promise.all([host, a, b, viewer].map((client) => new Promise<string>((resolve) => client.once("room:closed", ({ reason }) => resolve(reason)))));
    await delay(2_100); // 口令错一次后要等 2 秒
    await ok(call<void>((ack) => admin.emit("admin:dissolve", { roomId: target.id, token: "flow-test-token" }, ack)));
    expect((await closed).every((reason) => reason.includes("管理员"))).toBe(true);
    const after = await ok(call<import("@niutou/game").PublicRoomSummary[]>((ack) => admin.emit("lobby:get", ack)));
    expect(after.some((room) => room.id === target.id)).toBe(false);
  });

  it("迟到的点击：带着上一手的 step 发来的选牌被拒绝，不会落到下一手，也不清超时次数", async () => {
    const { code, host, a, b, names } = await threeSeats();
    await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack)));
    await updateWhere(h, b, (snapshot) => snapshot.game !== undefined);
    inject(code, names, { players: [{ hand: [12, 90] }, { hand: [27, 91] }, { hand: [41, 92] }], rows: [[10], [25], [40], [63]] });
    const before = await updateWhere(h, host, (snapshot) => snapshot.game?.turn === 9);
    const seen = stepKey(before.game!);
    await ok(command(a, { type: "select", card: 27 }, h));
    await ok(command(b, { type: "select", card: 41 }, h));
    h.server.testHooks.expireTurn(code);
    await updateWhere(h, host, (snapshot) => snapshot.game?.turn === 10);
    const late = await command(host, { type: "select", card: 90, step: seen }, h);
    expect(late.ok).toBe(false);
    expect(late.ok ? "" : late.error).toContain("已经结算");
    const now = gameOf(a);
    expect(now.players[0]!.selected).toBe(false);
    // 带当前的 step 就照常
    await ok(command(host, { type: "select", card: meIn(host).hand[0]!, step: stepKey(gameOf(host)) }, h));
    await ok(call<void>((ack) => host.emit("room:dissolve", ack)));
  });

  it("托管、离线由人机代选的规则 C 标成代选（auto）", async () => {
    const { code, host, a, b, names } = await threeSeats();
    await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack)));
    await updateWhere(h, b, (snapshot) => snapshot.game !== undefined);
    // 第 10 手，乙只剩一张 4（比所有排尾都小）
    inject(code, names, { players: [{ hand: [60] }, { hand: [4] }, { hand: [70] }], rows: [[10, 13], [25], [40, 44, 48], [63]] });
    await updateWhere(h, host, (snapshot) => snapshot.game?.turn === 10 && snapshot.game.rows[0]?.length === 2);
    await ok(command(host, { type: "select", card: 60 }, h));
    await ok(command(b, { type: "select", card: 70 }, h));
    // 乙托管：人机替他出 4 → 停在选排 → 人机替他选排
    await ok(call<void>((ack) => a.emit("room:auto", true, ack)));
    const done = await updateWhere(h, host, (snapshot) => snapshot.game?.reveal?.done === true && snapshot.game.turn === 10);
    const low = done.game!.reveal!.steps.find((step) => step.kind === "low")!;
    expect(low).toMatchObject({ player: "p2", card: 4, auto: true });
    await ok(call<void>((ack) => host.emit("room:dissolve", ack)));
  });

  it("刷动作限速：同一个连接一秒内超过 20 个动作就拒绝", async () => {
    const { host } = await threeSeats();
    await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack)));
    const results = await Promise.all(Array.from({ length: 30 }, () => command(host, { type: "unselect" })));
    expect(results.filter((result) => !result.ok && result.error.includes("太快")).length).toBeGreaterThan(0);
    await delay(1_100);
    await ok(call<void>((ack) => host.emit("room:dissolve", ack)));
  });

  it("客户端漏发回执、参数个数不对，服务器不会崩", async () => {
    const rude = await h.connect();
    const raw = rude as unknown as { emit: (...args: unknown[]) => void };
    raw.emit("lobby:get");
    raw.emit("game:command", { type: "select", card: 1 });
    raw.emit("room:create", { name: "无礼的人", capacity: 2 });
    raw.emit("room:start", "多余", "参数");
    raw.emit("room:kick");
    raw.emit("voice:signal");
    await delay(200);
    const still = await h.connect();
    const rooms = await ok(call<import("@niutou/game").PublicRoomSummary[]>((ack) => still.emit("lobby:get", ack)));
    expect(Array.isArray(rooms)).toBe(true);
    expect(h.server.httpServer.listening).toBe(true);
  });

  it("抓包：整个流程里每个连接收到的数据都没有别人的手牌、已选未亮的牌、没发的牌和种子", () => {
    let checked = 0;
    for (const updates of h.received.values()) {
      for (const { selfId, room } of updates) {
        const game = room.game;
        if (!game) continue;
        const raw = game as unknown as Record<string, unknown>;
        for (const key of ["deck", "seed", "rngState", "log"]) expect(raw[key], key).toBeUndefined();
        const seat = room.members.find((member) => member.id === selfId)?.playerId;
        for (const player of game.players) {
          if (player.id === seat) continue;
          if (room.access.spectatorsSeeAll && !seat) continue;
          expect(player.hand).toEqual([]);
          expect(player.selection).toBeNull();
        }
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});
