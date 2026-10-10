import { describe, expect, it } from "vitest";
import {
  applyCommand,
  chachaBlock,
  createGame,
  createRng,
  createSecureRng,
  createTutorialGame,
  legalActions,
  redactGameForSpectator,
  redactGameForViewer,
  restoreRng,
  rngFromSeed,
  type GameState,
} from "../src/index.js";

// 首发验收 I7：以前服务器用 32 位种子 + mulberry32 发牌，玩家只看自己的 10 张牌和 4 个排头，
// 穷举 2^32 个种子几秒到几分钟就能锁定种子、算出所有人整场的手牌。现在服务器每场用 256 位密钥 + ChaCha20。

const players = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}`, name: `玩家${index + 1}` }));
const KEY = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

describe("随机数#ChaCha20", () => {
  it("RFC 8439 2.3.2 的块函数测试向量", () => {
    const key = [0x03020100, 0x07060504, 0x0b0a0908, 0x0f0e0d0c, 0x13121110, 0x17161514, 0x1b1a1918, 0x1f1e1d1c];
    const out = chachaBlock(key, 1, [0x09000000, 0x4a000000, 0x00000000]);
    expect(out.map((word) => word.toString(16).padStart(8, "0"))).toEqual([
      "e4e7f110", "15593bd1", "1fdd0f50", "c47120a3",
      "c7f4d1c7", "0368c033", "9aaa2204", "4e6cd4c3",
      "466482d2", "09aa9f07", "05d7c214", "a2028bd9",
      "d19c12b5", "b94e16de", "e883d0cb", "4e3c50a2",
    ]);
  });

  it("同一密钥同一串调用结果一样；从状态恢复能接着往下取（跨块边界也一样）", () => {
    const a = createSecureRng(KEY);
    const head = Array.from({ length: 13 }, () => a.next());
    const resumed = restoreRng(a.state);
    const b = createSecureRng(KEY);
    for (let index = 0; index < 13; index += 1) expect(b.next()).toBe(head[index]);
    for (let index = 0; index < 40; index += 1) expect(resumed.next()).toBe(b.next());
    expect(typeof a.state).toBe("string");
  });

  it("密钥太短（< 128 位）或不是十六进制直接报错，不会悄悄退回弱随机数", () => {
    expect(() => createSecureRng("abcd")).toThrow();
    expect(() => createSecureRng("z".repeat(64))).toThrow();
    expect(() => restoreRng("c20:abcd:x")).toThrow();
  });

  it("密钥的 256 位每一位都影响发牌（不会只用到其中 32 位）", () => {
    const deal = (key: string) => JSON.stringify(createGame(players(10), key).players.map((player) => player.hand));
    const base = deal(KEY);
    const seen = new Set([base]);
    for (let bit = 0; bit < 256; bit += 1) {
      const bytes = KEY.match(/../g)!.map((pair) => parseInt(pair, 16));
      bytes[bit >> 3] = bytes[bit >> 3]! ^ (1 << (bit & 7));
      const flipped = deal(bytes.map((byte) => byte.toString(16).padStart(2, "0")).join(""));
      expect(flipped, `第 ${bit} 位`).not.toBe(base);
      seen.add(flipped);
    }
    expect(seen.size).toBe(257);
  });

  it("洗牌大致均匀：第 1 张牌在 104 种里分布平坦（卡方检验，宽松阈值）", () => {
    const counts = new Array<number>(104).fill(0);
    const rng = createSecureRng(KEY);
    const runs = 20_800;
    const deck = Array.from({ length: 104 }, (_, index) => index);
    for (let run = 0; run < runs; run += 1) counts[rng.shuffle(deck)[0]!]! += 1;
    const expected = runs / 104;
    const chi = counts.reduce((sum, count) => sum + (count - expected) ** 2 / expected, 0);
    // 自由度 103，p=0.001 的临界值约 150
    expect(chi).toBeLessThan(150);
  });
});

describe("随机数#对局里的用法", () => {
  it("不给种子时 createGame 生成 256 位十六进制密钥（ChaCha20）", () => {
    const game = createGame(players(4));
    expect(typeof game.seed).toBe("string");
    expect(game.seed).toMatch(/^[0-9a-f]{64}$/);
    expect(String(game.rngState)).toMatch(/^c20:[0-9a-f]{64}:\d+$/);
  });

  it("十六进制种子：同一密钥、同一串动作得到同一局（每步从 rngState 恢复也一样）", () => {
    const play = (key: string) => {
      let state = createGame(players(3), key);
      for (let step = 0; step < 400 && state.phase !== "gameOver"; step += 1) {
        // 已经扣下的人不再动（否则会在「改选 / 撤回」里打转）
        const options = (id: string) => legalActions(state, id).filter((command) => command.type !== "unselect" && !(command.type === "select" && state.players.find((player) => player.id === id)!.selected));
        const mover = state.players.find((player) => options(player.id).length > 0);
        if (!mover) break;
        state = applyCommand(state, mover.id, options(mover.id)[0]!);
      }
      return state;
    };
    const a = play(KEY);
    const b = play(KEY);
    expect(a.players.map((player) => player.hand)).toEqual(b.players.map((player) => player.hand));
    expect(a.rows).toEqual(b.rows);
    expect(a.round).toBeGreaterThan(1); // 跨过局末重新发牌，用到了恢复出来的随机数
    expect(a.rngState).toBe(b.rngState);
  });

  it("任何人拿到的视角里都没有密钥和随机数状态（字符串里也搜不到）", () => {
    const game = createGame(players(5), KEY);
    const views: GameState[] = [
      ...game.players.map((player) => redactGameForViewer(game, player.id)),
      redactGameForSpectator(game, false),
      redactGameForSpectator(game, true),
    ];
    for (const view of views) {
      const text = JSON.stringify(view);
      expect(text).not.toContain(KEY);
      expect(text).not.toContain("c20:");
      expect(view.seed).toBeUndefined();
      expect(view.rngState).toBeUndefined();
      expect(view.deck).toBeUndefined();
    }
  });

  it("看自己的牌推不出别人的牌（攻击演示）：数字种子能从自己的视角反推，所以服务器只能用 256 位密钥", () => {
    // I7 的攻击方法：拿自己能看到的东西（自己的手牌 + 4 个排头）去试每个种子，对上了就知道别人的牌。
    // 32 位种子空间 2^32，几秒到几分钟就试完；这里在 2 万个种子的小范围里演示同一个方法确实能唯一锁定。
    const view = (game: GameState) => JSON.stringify([game.players[0]!.hand, game.rows]);
    const secret = 12_345;
    const target = createGame(players(4), secret);
    const matches: number[] = [];
    for (let seed = 0; seed < 20_000; seed += 1) if (view(createGame(players(4), seed)) === view(target)) matches.push(seed);
    expect(matches).toEqual([secret]);
    expect(createGame(players(4), matches[0]!).players[1]!.hand).toEqual(target.players[1]!.hand);
    // 同样的方法换成密钥：要试 2^256 个，做不到；而且自己视角一样、别人手牌不一样的密钥大量存在——
    // 下面固定 p1 的视角不变，只是演示不同密钥下其他人的牌各不相同、和 p1 的视角没有可利用的关联。
    const others = new Set<string>();
    for (let index = 0; index < 50; index += 1) {
      const game = createGame(players(4), index.toString(16).padStart(2, "0").repeat(32));
      others.add(JSON.stringify(game.players.slice(1).map((player) => player.hand)));
    }
    expect(others.size).toBe(50);
  });

  it("数字种子仍走 mulberry32（测试、教程、预览、模拟用），结果和以前完全一样", () => {
    expect(rngFromSeed(7).state).toBe(createRng(7).state);
    const a = createTutorialGame("小明");
    const b = createTutorialGame("小明");
    expect(a.seed).toBe(20261009);
    expect(typeof a.rngState).toBe("number");
    expect(a.players.map((player) => player.hand)).toEqual(b.players.map((player) => player.hand));
  });
});
