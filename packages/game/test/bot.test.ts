/**
 * 人机（packages/game/src/bot.ts）的单测：
 * - 只吃 redactGameForViewer 之后的视角（看不到的东西改了也不影响决定；服务器 runBot 确实先 redact）；
 * - 补充文件 1.10「人机最容易犯的蠢错」逐条写成局面；1.8 例 A–D；
 * - 每一步都有理由；小规模自对弈全合法、有最大步数、耗时达标（300 局 × 每种人数的大跑在 scripts/selfplay-niutou.ts）。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyCommand,
  baselineCard,
  baselineCommand,
  baselineRow,
  buildGame,
  cardsInPlay,
  createGame,
  legalActions,
  playHand,
  redactGameForViewer,
  sameCommand,
  waitingFor,
  type GameState,
} from "../src/index.js";
import { botCommand, botDecision, botHint, botUnknownCards } from "../src/bot.js";

const ME = "p1";
const decide = (state: GameState, id = ME) => botDecision(redactGameForViewer(state, id), id)!;
const pickCard = (state: GameState, id = ME) => {
  const command = decide(state, id).command;
  expect(command.type).toBe("select");
  return (command as { card: number }).card;
};

describe("人机只看自己座位能看到的信息（补充#1.10-7）", () => {
  it("给完整状态和给 redact 后的视角，决定一样（它不用看不到的东西）", () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const count = 2 + (seed % 9);
      const state = createGame(Array.from({ length: count }, (_, i) => ({ id: `p${i + 1}`, name: `${i}` })), seed);
      for (const player of state.players) {
        const full = botCommand(state, player.id);
        const view = botCommand(redactGameForViewer(state, player.id), player.id);
        expect(view).toEqual(full);
      }
    }
  });

  it("把对手的手牌、已选的牌、没发的牌、种子全换掉，决定不变", () => {
    for (let seed = 1; seed <= 10; seed += 1) {
      const state = createGame(Array.from({ length: 5 }, (_, i) => ({ id: `p${i + 1}`, name: `${i}` })), 500 + seed);
      // 对手 p2 先选好一张（没亮）
      const chosen = applyCommand(state, "p2", { type: "select", card: state.players[1]!.hand[3]! });
      const before = botCommand(redactGameForViewer(chosen, ME), ME);
      // 打乱看不到的东西：对手之间互换手牌、改已选的牌、改 deck / seed
      const scrambled = structuredClone(chosen);
      const others = scrambled.players.slice(1);
      const pool = [...others.flatMap((player) => player.hand), ...(scrambled.deck ?? [])].reverse();
      let cursor = 0;
      for (const player of others) {
        player.hand = pool.slice(cursor, cursor + player.hand.length).sort((a, b) => a - b);
        cursor += player.hand.length;
        if (player.selected) player.selection = player.hand[0]!;
      }
      scrambled.deck = pool.slice(cursor);
      scrambled.seed = 12345;
      scrambled.rngState = 999;
      expect(botCommand(redactGameForViewer(scrambled, ME), ME)).toEqual(before);
    }
  });

  it("服务器的人机代打（runBot）和超时代打都先 redact 再交给人机", () => {
    const server = readFileSync(new URL("../../../apps/server/src/index.ts", import.meta.url), "utf8");
    const runBot = server.slice(server.indexOf("function runBot("), server.indexOf("function expireTurn("));
    expect(runBot).toMatch(/const view = redactGameForViewer\(game, playerId\);[\s\S]*botCommand\(view, playerId\)/);
    // 超时代打走 timeoutTurn(game, timeoutPolicy)：引擎的 autoCommand 先 redact 再调 policy
    const engine = readFileSync(new URL("../src/engine.ts", import.meta.url), "utf8");
    expect(engine).toMatch(/const view = redactGameForViewer\(state, playerId\);\s*let command[\s\S]*policy\(view, playerId\)/);
  });
});

describe("补充#1.10 人机最容易犯的蠢错", () => {
  it("#1 有别的选择时不出指向满排的牌（例 A：22 指向满 5 张的第 1 排）", () => {
    for (const extra of [[], [5, 30, 64, 85], [44, 59, 68, 77]]) {
      const state = buildGame({
        players: [{ hand: [22, 37, 57, 71, 95, ...extra] }, {}, {}, {}],
        rows: [[3, 8, 14, 17, 21], [33, 36], [47, 49, 52, 56], [70]],
      });
      expect(pickCard(state)).not.toBe(22);
    }
  });

  it("#2 不只看差值：32 离排尾 30 只差 2，但那排已有 4 张、31 可能在别人手里；66 接在只有 1 张的排后面才安全", () => {
    const state = buildGame({
      players: [{ hand: [10, 12, 14, 32, 66] }, {}, {}],
      rows: [[24, 26, 28, 30], [60], [80], [90]],
    });
    const rows = state.rows;
    expect(baselineCard([10, 12, 14, 32, 66], rows)).toBe(32); // 简单基线会出 32
    const decision = decide(state);
    expect(decision.command).toEqual({ type: "select", card: 66 });
    expect(decision.reason).toContain("66");
  });

  it("#3 规则 C 选排用已亮出的牌算后果（例 C）：不收第 4 排（收了 97 会填满第 2 排、98 下手必收）", () => {
    let state = buildGame({
      players: [{ hand: [4, 65, 93, 98] }, { include: [50] }, { include: [64] }, { include: [97] }],
      rows: [[41, 42, 43], [61, 62, 63], [44, 46, 47, 48, 49], [90]],
    });
    state = playHand(state, [4, 50, 64, 97]);
    expect(state.phase).toBe("chooseRow");
    expect(state.chooser).toBe(ME);
    // 基线（只看牛头、再看排尾最大）会选第 4 排
    expect(baselineRow(state.rows)).toBe(3);
    const decision = decide(state);
    expect(decision.command.type).toBe("chooseRow");
    const row = (decision.command as { row: number }).row;
    expect([0, 1]).toContain(row); // 两排都只罚 3 分、后面都好打；第 4 排会害 98，第 3 排要罚 9
    expect(decision.reason).toContain("98");
    expect(decision.reason).toContain("第 4 排");
  });

  it("#4 自己手里的牌不算「对手可能有的牌」；本局亮过的牌也不算", () => {
    const state = createGame([{ id: ME, name: "我" }, { id: "p2", name: "乙" }, { id: "p3", name: "丙" }], 77);
    const unknown = botUnknownCards(redactGameForViewer(state, ME), ME);
    const mine = state.players[0]!.hand;
    for (const card of mine) expect(unknown).not.toContain(card);
    for (const row of state.rows) for (const card of row) expect(unknown).not.toContain(card);
    expect(unknown.length).toBe(104 - 10 - 4);
    // 战术模式 / 10 人局：看不到的牌正好就是对手手里的牌（精确记牌）
    const tactics = createGame([{ id: ME, name: "我" }, { id: "p2", name: "乙" }, { id: "p3", name: "丙" }], 78, { tactics: true });
    const exact = botUnknownCards(redactGameForViewer(tactics, ME), ME).sort((a, b) => a - b);
    expect(exact).toEqual(tactics.players.slice(1).flatMap((player) => player.hand).sort((a, b) => a - b));
    expect(cardsInPlay(3, true).length).toBe(34);
    // 打完一手后，亮过的牌（在排上或收牌堆里）也从未知里去掉
    const after = playHand(tactics, [tactics.players[0]!.hand[5]!, tactics.players[1]!.hand[5]!, tactics.players[2]!.hand[5]!], 0);
    const unknownAfter = botUnknownCards(redactGameForViewer(after, ME), ME).sort((a, b) => a - b);
    expect(unknownAfter).toEqual(after.players.slice(1).flatMap((player) => player.hand).sort((a, b) => a - b));
  });

  it("#5 低牌：没有安全牌时用低牌主动收便宜排（例 B）；有安全牌、最便宜的排也不便宜时不急着把唯一的低牌打掉", () => {
    const b = buildGame({
      players: [{ hand: [2, 20, 68, 99] }, {}, {}, {}, {}],
      rows: [[10, 13, 15, 18, 19], [45], [60, 61, 63, 64, 67], [80, 84, 88, 90]],
    });
    const decision = decide(b);
    expect(decision.command).toEqual({ type: "select", card: 2 });
    expect(decision.reason).toContain("第 2 排");

    const keep = buildGame({
      players: [{ hand: [5, 32, 51, 72, 91, 33, 52, 73, 92] }, {}, {}],
      rows: [[30, 31], [50], [70, 71], [90]],
    });
    expect(pickCard(keep)).not.toBe(5);
  });

  it("#6 大牌不一直留到最后：4 人局 40 局里，95 以上的牌拖到第 9、10 手才出的比例明显低于简单基线（平均摊开是 20%）", () => {
    const lateShare = (policy: (view: GameState, id: string) => ReturnType<typeof botCommand>) => {
      let late = 0;
      let total = 0;
      for (let game = 0; game < 40; game += 1) {
        let state = createGame([1, 2, 3, 4].map((i) => ({ id: `p${i}`, name: `${i}` })), 300 + game, { fixedRounds: 1 });
        while (state.phase !== "gameOver") {
          const id = waitingFor(state)[0]!;
          const command = policy(redactGameForViewer(state, id), id)!;
          if (command.type === "select" && command.card >= 95) {
            total += 1;
            if (state.turn >= 9) late += 1;
          }
          state = applyCommand(state, id, command);
        }
      }
      return late / total;
    };
    const bot = lateShare(botCommand);
    const baseline = lateShare(baselineCommand);
    expect(bot).toBeLessThan(0.2);
    expect(bot).toBeLessThan(baseline - 0.1);
  }, 60_000);

  it("#8 分差很小的几张里随机挑：同一局面结果固定（可复现），不同局面会变；放宽 tie 时会挑不同的牌", () => {
    const state = buildGame({ players: [{ hand: [23, 41, 61, 81] }, {}, {}], rows: [[20], [40], [60], [80]] });
    const view = redactGameForViewer(state, ME);
    expect(botCommand(view, ME)).toEqual(botCommand(view, ME));
    const picks = new Set<number>();
    for (let round = 1; round <= 30; round += 1) {
      const variant = { ...structuredClone(state), round };
      picks.add((botCommand(redactGameForViewer(variant, ME), ME, { tie: 100 }) as { card: number }).card);
    }
    expect(picks.size).toBeGreaterThan(1);
  });

  it("#9 第 9 手考虑第 10 手：先出 14 会让第 1 排满 5 张、最后一手的 15 必收；先出 15 两手都安全", () => {
    const state = buildGame({ players: [{ hand: [14, 15] }, {}, {}], rows: [[10, 11, 12, 13], [50], [70], [2]] });
    expect(state.turn).toBe(9);
    expect(baselineCard([14, 15], state.rows)).toBe(14); // 基线只看差值，出 14
    expect(pickCard(state)).toBe(15);
  });
});

describe("补充#1.8 局面例子", () => {
  it("例 B：出 2 收只有 2 个牛头的第 2 排", () => {
    const state = buildGame({
      players: [{ hand: [2, 20, 68, 99] }, {}, {}, {}, {}],
      rows: [[10, 13, 15, 18, 19], [45], [60, 61, 63, 64, 67], [80, 84, 88, 90]],
    });
    expect(pickCard(state)).toBe(2);
  });

  it("例 D：别人的规则 C 可能改掉 62 的去向（收走第 1 排后 62 成了满排的第六张），出 72", () => {
    for (const hand of [[62, 72], [45, 46, 47, 62, 72]]) {
      const state = buildGame({ players: [{ hand }, {}, {}, {}, {}], rows: [[58, 61], [30, 33, 36, 38, 40], [70], [90]] });
      expect(pickCard(state)).toBe(72);
    }
  });
});

describe("理由（教程「提示」按钮用）", () => {
  it("botHint 和 botDecision 是同一个；选牌的理由带牌号，选排的理由带排号", () => {
    expect(botHint).toBe(botDecision);
    const state = buildGame({ players: [{ hand: [23, 41, 61, 81] }, {}, {}], rows: [[20], [40], [60], [80]] });
    const decision = botHint(redactGameForViewer(state, ME), ME)!;
    const card = (decision.command as { card: number }).card;
    expect(decision.reason).toContain(String(card));
  });

  it("局末点继续；没有要它做的事返回 null（已选好、不是它选排、终局、不在局里）", () => {
    let state = buildGame({ players: [{ hand: [3] }, { hand: [31] }], rows: [[1, 2], [28], [50], [80]] });
    state = playHand(state, [3, 31]);
    expect(state.phase).toBe("roundEnd");
    expect(decide(state).command).toEqual({ type: "nextRound" });
    expect(decide(state).reason).toContain("继续");
    const ready = applyCommand(state, ME, { type: "nextRound" });
    expect(botDecision(redactGameForViewer(ready, ME), ME)).toBeNull();

    const fresh = createGame([{ id: ME, name: "甲" }, { id: "p2", name: "乙" }], 1);
    const selected = applyCommand(fresh, ME, { type: "select", card: fresh.players[0]!.hand[0]! });
    expect(botCommand(redactGameForViewer(selected, ME), ME)).toBeNull();
    expect(botCommand(redactGameForViewer(selected, "p2"), "p2")).not.toBeNull();
    expect(botCommand(redactGameForViewer(selected, "x"), "x")).toBeNull();
  });

  it("一整局里每一步都有一句理由；选牌的理由提到出的那张牌，选排的理由提到收的那一排", () => {
    let state = createGame(Array.from({ length: 4 }, (_, i) => ({ id: `p${i + 1}`, name: `${i}` })), 4242, { target: 33 });
    let steps = 0;
    let chooseRows = 0;
    while (state.phase !== "gameOver") {
      expect(steps++).toBeLessThan(3000);
      const id = waitingFor(state)[0]!;
      const decision = decide(state, id);
      expect(decision.reason.length).toBeGreaterThan(5);
      if (decision.command.type === "select") expect(decision.reason).toContain(String(decision.command.card));
      if (decision.command.type === "chooseRow") {
        chooseRows += 1;
        expect(decision.reason).toContain(`第 ${decision.command.row + 1} 排`);
      }
      state = applyCommand(state, id, decision.command);
    }
    expect(chooseRows).toBeGreaterThan(0);
  });
});

describe("自对弈（小规模；每种人数 300 局的大跑见 scripts/selfplay-niutou.ts）", () => {
  it("2–10 人各 4 局（默认 / 战术 / 目标 33 / 固定 2 局）：每一步都合法、不撤回、不超过最大步数；平均 < 50ms、最慢 < 300ms", () => {
    const MAX_STEPS = 3000;
    const variants = [{}, { tactics: true }, { target: 33 }, { fixedRounds: 2 }];
    const times: number[] = [];
    const problems: string[] = [];
    for (let count = 2; count <= 10; count += 1) {
      const players = Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}`, name: `咕噜${index + 1}` }));
      variants.forEach((options, index) => {
        let state = createGame(players, count * 100 + index, options);
        let steps = 0;
        while (state.phase !== "gameOver") {
          if (++steps > MAX_STEPS) {
            problems.push(`${count} 人 ${index} 超过最大步数`);
            return;
          }
          const id = waitingFor(state)[steps % waitingFor(state).length]!;
          const start = performance.now();
          const command = botCommand(redactGameForViewer(state, id), id);
          times.push(performance.now() - start);
          if (!command || command.type === "unselect" || !legalActions(state, id).some((action) => sameCommand(action, command))) {
            problems.push(`${count} 人：${id} 出了 ${JSON.stringify(command)}`);
            return;
          }
          state = applyCommand(state, id, command);
        }
      });
    }
    expect(problems).toEqual([]);
    const avg = times.reduce((sum, ms) => sum + ms, 0) / times.length;
    expect(avg).toBeLessThan(50);
    // 最慢一步：第一次调用有 JIT 预热，去掉最慢的 3 次再看
    const sorted = [...times].sort((a, b) => b - a);
    expect(sorted[3]!).toBeLessThan(300);
  }, 300_000);
});
