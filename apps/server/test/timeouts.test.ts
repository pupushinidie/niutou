/**
 * 真实计时（TURN_MS 调小）：选牌倒计时大家共用，别人选牌不会把它往后推；规则 C 选排、局末都会自己超时往下走。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { botCommand, buildGame, type LobbyRoomSnapshot } from "@niutou/game";
import { call, command, delay, join, ok, startServer, updateWhere, type Harness } from "./harness.js";

process.env.TURN_MS = "600";
process.env.BOT_DELAY_SCALE = "0";

let h: Harness;
let seq = 0;
beforeAll(async () => {
  h = await startServer();
});
afterAll(async () => {
  await h.close();
});

async function twoSeats() {
  const host = await h.connect();
  const guest = await h.connect();
  const names = [`甲方${++seq}`, `乙方${seq}`];
  const room = await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: names[0]!, capacity: 2 } as never, ack)));
  await ok(join(guest, { name: names[1]!, code: room.code }));
  return { code: room.code, host, guest, names };
}

describe("超时（TURN_MS=600）", () => {
  it("选牌：乙中途选好不会重置甲的倒计时；到点甲由系统按基线代出", async () => {
    const { host, guest } = await twoSeats();
    const started = Date.now();
    await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack)));
    const game = await updateWhere(h, guest, (snapshot) => snapshot.game !== undefined);
    await delay(300);
    const mine = game.game!.players.find((player) => player.id === "p2")!;
    await ok(command(guest, { type: "select", card: mine.hand[0]! }, h));
    const revealed = await updateWhere(h, guest, (snapshot) => snapshot.game?.reveal != null, 5_000);
    const elapsed = Date.now() - started;
    expect(revealed.game!.events[0]).toEqual({ type: "TimedOut", phase: "select", players: ["p1"] });
    // 600 ms 到点；要是乙选牌把倒计时重置了，会拖到 900 ms 以后
    expect(elapsed).toBeGreaterThanOrEqual(550);
    expect(elapsed).toBeLessThan(850);
    await ok(call<void>((ack) => host.emit("room:dissolve", ack)));
  });

  it("规则 C 选排没人选：到点按人机算法代选（开工拍板，人机阶段换上），继续结算", async () => {
    const { code, host, guest, names } = await twoSeats();
    await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack)));
    await updateWhere(h, guest, (snapshot) => snapshot.game !== undefined);
    h.server.testHooks.setGame(code, buildGame({
      players: [{ id: "p1", name: names[0]!, include: [4] }, { id: "p2", name: names[1]!, include: [7] }],
      rows: [[10, 13], [25], [40, 44, 48], [63]],
    }));
    await ok(command(host, { type: "select", card: 4 }, h));
    await ok(command(guest, { type: "select", card: 7 }, h));
    await updateWhere(h, guest, (snapshot) => snapshot.game?.phase === "chooseRow");
    // 甲自己看到的局面（服务器发给他的就是 redact 后的视角），人机在这上面会选哪排
    const mine = await updateWhere(h, host, (snapshot) => snapshot.game?.phase === "chooseRow");
    const expected = botCommand(mine.game!, "p1");
    expect(expected?.type).toBe("chooseRow");
    const row = (expected as { row: number }).row;
    const done = await updateWhere(h, guest, (snapshot) => snapshot.game?.phase === "select" && snapshot.game.turn === 2, 5_000);
    expect(done.game!.events[0]).toEqual({ type: "TimedOut", phase: "chooseRow", players: ["p1"] });
    expect(done.game!.reveal!.steps[0]).toMatchObject({ kind: "low", row, player: "p1" });
    expect(done.game!.rows[row]).toEqual([4, 7]);
    await ok(call<void>((ack) => host.emit("room:dissolve", ack)));
  });

  it("局末没人点继续：到点自动发下一局；超时次数不因局末增加", async () => {
    const { code, host, guest, names } = await twoSeats();
    await ok(call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack)));
    await updateWhere(h, guest, (snapshot) => snapshot.game !== undefined);
    h.server.testHooks.setGame(code, buildGame({
      players: [{ id: "p1", name: names[0]!, hand: [3] }, { id: "p2", name: names[1]!, hand: [31] }],
      rows: [[1, 2], [28], [50], [80]],
    }));
    await ok(command(host, { type: "select", card: 3 }, h));
    await ok(command(guest, { type: "select", card: 31 }, h));
    await updateWhere(h, guest, (snapshot) => snapshot.game?.phase === "roundEnd");
    const next = await updateWhere(h, guest, (snapshot) => snapshot.game?.round === 2, 5_000);
    expect(next.game!.events[0]).toEqual({ type: "TimedOut", phase: "roundEnd", players: ["p1", "p2"] });
    expect(next.game!.phase).toBe("select");
    // 两人都在局末「超时」过一次，又在新的一局里各超时一次：局末那次不算，所以还没进托管
    const after = await updateWhere(h, guest, (snapshot) => snapshot.game?.round === 2 && snapshot.game.turn === 2, 5_000);
    expect(after.members.some((member) => member.auto)).toBe(false);
    await ok(call<void>((ack) => host.emit("room:dissolve", ack)));
  });
});
