/**
 * 新手教程剧本（packages/game/src/tutorial.ts）的单测，照欲罢不能的五项：
 * 从头走到尾、关键几幕一定发生、剧本自身、剧本发牌、走完接练习局能打完。
 */
import { describe, expect, it } from "vitest";
import {
  anchorCandidates,
  anchorVisible,
  apply,
  botCommand,
  createPracticeGame,
  createRng,
  createTutorialGame,
  legalActions,
  redactGameForViewer,
  rowsBulls,
  sameCommand,
  sameMove,
  selfCanAct,
  stateProblems,
  TUTORIAL_BOT_OPTIONS,
  TUTORIAL_DEAL,
  TUTORIAL_SELF,
  TUTORIAL_STEPS,
  tutorialActor,
  type GameState,
  type Rng,
  type TutorialMove,
} from "../src/index.js";

const ONE = "p2";
const TWO = "p3";

/** 网页的走法：轮到谁由 tutorialActor 决定，剧本里写的人必须和它一致（不一致说明剧本顺序写错了）。 */
function run(game: GameState, move: TutorialMove, rng: Rng): GameState {
  return apply(game, move.player, move.command, rng).state;
}

/** 按剧本走到第 upTo 步之前（不含），返回那时的局面。 */
function playScript(upTo = TUTORIAL_STEPS.length, rng: Rng = createRng(1)): GameState {
  let game = createTutorialGame("小蒲");
  for (const step of TUTORIAL_STEPS.slice(0, upTo)) {
    if (step.kind === "do") game = run(game, step.expect, rng);
    if (step.kind === "watch") for (const move of step.moves) game = run(game, move, rng);
  }
  return game;
}

const stepIndex = (id: string) => {
  const index = TUTORIAL_STEPS.findIndex((step) => step.id === id);
  if (index < 0) throw new Error(`没有 ${id} 这一步`);
  return index;
};
const after = (id: string) => playScript(stepIndex(id) + 1);
const bulls = (game: GameState) => game.players.map((player) => player.roundBulls);

describe("新手教程剧本", () => {
  it("从头走到尾：每一步要你做的都合法，人机的走法轮得到它，高亮的东西在界面上看得见", () => {
    let game = createTutorialGame("小蒲");
    const rng = createRng(1);
    for (const step of TUTORIAL_STEPS) {
      const candidates = anchorCandidates(step);
      if (candidates.length > 0) {
        // 数组锚点：第一个（桌面上的）必须看得见；后面的是窄屏备选
        expect(anchorVisible(game, candidates[0]!), `「${step.id}」高亮的 ${candidates[0]} 看不见`).toBe(true);
      }
      if (step.kind === "do") {
        expect(step.expect.player).toBe(TUTORIAL_SELF);
        expect(selfCanAct(game), `「${step.id}」这时你还不能动`).toBe(true);
        expect(legalActions(game, TUTORIAL_SELF).some((command) => sameCommand(command, step.expect.command)), `「${step.id}」这一步不合法`).toBe(true);
        if (step.then) expect(anchorVisible(game, step.then), `「${step.id}」第二步的 ${step.then} 看不见`).toBe(true);
        game = run(game, step.expect, rng);
      }
      if (step.kind === "watch") {
        for (const move of step.moves) {
          expect(tutorialActor(game), `「${step.id}」里 ${JSON.stringify(move)} 还没轮到它`).toBe(move.player);
          expect(legalActions(game, move.player).some((command) => sameCommand(command, move.command)), `「${step.id}」里 ${JSON.stringify(move)} 不合法`).toBe(true);
          game = run(game, move, rng);
        }
      }
      expect(stateProblems(game), `「${step.id}」之后局面不一致`).toEqual([]);
    }
    // 剧本走完：第 6 手选牌，三个人各剩 5 张，等着接练习局
    expect(game.phase).toBe("select");
    expect(game.turn).toBe(6);
    expect(game.players.map((player) => player.handCount)).toEqual([5, 5, 5]);
  });

  it("关键的几幕一定发生：第 1 手只看排尾、撤回后再扣、二号收第六张、你用 5 挑第 3 排、55 把一号挤成第六张", () => {
    // 第 1 手：44 接在 41 后面（10、26 也比它小，但 41 最近），没人收牌
    const h1 = after("h1");
    expect(h1.rows).toEqual([[8, 10], [24, 26], [41, 44], [67]]);
    expect(h1.reveal?.plays.map((play) => play.card)).toEqual([10, 26, 44]);
    expect(bulls(h1)).toEqual([0, 0, 0]);

    // 撤回：扣下 45 → 撤回 → 再扣 45，人机还没选，所以撤回合法
    const picked = after("pick45");
    expect(picked.players[0]).toMatchObject({ selected: true, selection: 45 });
    expect(picked.players.slice(1).every((player) => !player.selected)).toBe(true);
    const undone = after("undo");
    expect(undone.players[0]).toMatchObject({ selected: false, selection: null });
    expect(undone.events).toEqual([{ type: "Unselected", player: TUTORIAL_SELF }]);

    // 第 2 手：第 3 排 4 张（再来 1 张第 5 张还安全）
    const h2 = after("h2");
    expect(h2.rows).toEqual([[8, 10], [24, 26], [41, 44, 45, 46], [67, 70]]);

    // 第 3 手：47 先成为第 5 张，二号的 49 成了第六张，收 41、44、45、46、47 = 10 分
    const h3 = after("h3");
    expect(h3.rows).toEqual([[8, 10], [24, 26, 27], [49], [67, 70]]);
    expect(h3.players[2]!.taken).toEqual([41, 44, 45, 46, 47]);
    expect(bulls(h3)).toEqual([0, 0, 10]);
    expect(h3.reveal?.steps.find((step) => step.kind === "sixth")).toMatchObject({ player: TWO, card: 49, row: 2, bulls: 10 });
    // 收来的牌不进手牌：二号手里还是 7 张
    expect(h3.players[2]!.handCount).toBe(7);

    // 第 4 手：人机先扣好，你的 5 最后确认 → 亮牌，停在你选排；4 排牛头 4/3/1/4
    const h4 = after("h4");
    expect(h4.players.slice(1).every((player) => player.selected)).toBe(true);
    expect(h4.players[0]!.selected).toBe(false);
    const choosing = after("pick5");
    expect(choosing.phase).toBe("chooseRow");
    expect(choosing.chooser).toBe(TUTORIAL_SELF);
    expect(rowsBulls(choosing.rows)).toEqual([4, 3, 1, 4]);
    // 收第 3 排只罚 1 分；收完 7 接在 5 后面，28 接第 2 排
    const chosen = after("choose");
    expect(chosen.rows).toEqual([[8, 10], [24, 26, 27, 28], [5, 7], [67, 70]]);
    expect(bulls(chosen)).toEqual([1, 0, 10]);
    expect(chosen.reveal?.steps.find((step) => step.kind === "low")).toMatchObject({ player: TUTORIAL_SELF, card: 5, row: 2, bulls: 1 });

    // 第 5 手：二号的 55 先成为第 5 张，一号的 56 成了第六张，收 24、26、27、28、55 = 11 分
    const h5 = after("h5");
    expect(h5.rows).toEqual([[8, 10, 11], [56], [5, 7], [67, 70]]);
    expect(h5.players[1]!.taken).toEqual([24, 26, 27, 28, 55]);
    expect(bulls(h5)).toEqual([1, 11, 10]);
    expect(h5.reveal?.steps.find((step) => step.kind === "sixth")).toMatchObject({ player: ONE, card: 56, bulls: 11 });
  });

  it("剧本本身：步骤 id 不重复，最后一步是唯一的收尾，说明文字不空、每步最多两句", () => {
    const ids = TUTORIAL_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    const finales = TUTORIAL_STEPS.filter((step) => step.kind === "info" && step.finale);
    expect(finales).toHaveLength(1);
    expect(TUTORIAL_STEPS.at(-1)).toBe(finales[0]);
    expect(TUTORIAL_STEPS[0]!.lesson).toBeTruthy();
    for (const step of TUTORIAL_STEPS) {
      expect(step.say.trim().length, step.id).toBeGreaterThan(0);
      // 主句一句话（中间不再有句号）；补充最多两句
      expect(step.say.replace(/[。！？…]+$/, "").match(/[。！？]/g) ?? [], `「${step.id}」主句不止一句`).toEqual([]);
      const sentences = (step.note ?? "").split(/[。！？]/).filter((part) => part.trim().length > 0);
      expect(sentences.length, `「${step.id}」补充超过两句`).toBeLessThanOrEqual(2);
      // 不用内部术语
      expect(`${step.say}${step.note ?? ""}`).not.toMatch(/command|phase|chooseRow|select|规则 [ABC]/i);
    }
  });

  it("剧本发牌：34 张不重复，按 2.2 摆好；排尾和手牌不洗牌，剩下的牌留在牌堆里", () => {
    const cards = [...TUTORIAL_DEAL.rows.flat(), ...Object.values(TUTORIAL_DEAL.hands).flat()];
    expect(cards).toHaveLength(34);
    expect(new Set(cards).size).toBe(34);
    const game = createTutorialGame("小蒲");
    expect(game.rows).toEqual([[8], [24], [41], [67]]);
    expect(game.players.map((player) => player.name)).toEqual(["小蒲", "咕噜一号", "咕噜二号"]);
    expect(game.players[0]!.hand).toEqual([5, 11, 27, 33, 44, 45, 62, 78, 91, 100]);
    expect(game.config.target).toBe(33);
    expect(game.deck).toHaveLength(104 - 34);
    expect(stateProblems(game)).toEqual([]);
    // 同一个开局，走到哪一步都一样（剧本不用随机数，第 2 局起才用）
    expect(playScript(TUTORIAL_STEPS.length, createRng(1)).rows).toEqual(playScript(TUTORIAL_STEPS.length, createRng(999)).rows);
  });

  it("剧本走完接练习局：两个咕噜交给人机（松一点），你也交给人机，60 局都能打到终局；再练一局也一样", () => {
    const stuck: string[] = [];
    for (let seed = 1; seed <= 60; seed += 1) {
      const rng = createRng(seed);
      let game = seed % 2 === 0 ? playScript(TUTORIAL_STEPS.length, rng) : createPracticeGame("小蒲", seed);
      let moves = 0;
      // 每一步都 expect 会慢到超时，用普通判断，出错时记下来
      while (game.phase !== "gameOver" && moves < 3000) {
        const actor = tutorialActor(game);
        if (!actor) break;
        const options = actor === TUTORIAL_SELF ? { maxMs: 20 } : { ...TUTORIAL_BOT_OPTIONS, maxMs: 20 };
        const command = botCommand(redactGameForViewer(game, actor), actor, options);
        if (!command) break;
        game = apply(game, actor, command, rng).state;
        moves += 1;
      }
      if (game.phase !== "gameOver" || !game.finalResult) stuck.push(`第 ${seed} 局（${moves} 步，${game.phase}）`);
      else if (Math.max(...game.players.map((player) => player.total)) < 33) stuck.push(`第 ${seed} 局没到 33 就结束`);
    }
    expect(stuck).toEqual([]);
  }, 120_000);

  it("轮到谁：人机先选、再轮到你；选排等出牌的人；局末先让人机点继续", () => {
    const game = createTutorialGame("小蒲");
    expect(tutorialActor(game)).toBe(ONE);
    expect(selfCanAct(game)).toBe(true);
    const choosing = after("pick5");
    expect(tutorialActor(choosing)).toBe(TUTORIAL_SELF);
    expect(sameMove({ player: "p1", command: { type: "select", card: 5, step: "1:4:select" } }, { player: "p1", command: { type: "select", card: 5 } })).toBe(true);
    expect(sameMove({ player: "p1", command: { type: "select", card: 5 } }, { player: "p2", command: { type: "select", card: 5 } })).toBe(false);
  });
});
