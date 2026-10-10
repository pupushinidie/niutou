/**
 * 「提示」的说法和「第一次遇到」小贴士的触发条件（tutorialGame.ts）。
 */
import { describe, expect, it } from "vitest";
import { buildGame, playHand, redactGameForViewer, timeoutTurn, type GameState } from "@niutou/game";
import { detectTips, hintFor, TIPS } from "./tutorialGame.js";

const view = (game: GameState, id = "p1") => redactGameForViewer(game, id);

describe("「提示」", () => {
  it("选牌时：说出牌号、指着那张手牌、顺手选中，理由是人机给的", () => {
    const game = buildGame({ players: [{ hand: [12, 60, 95] }, { hand: [30, 70, 80] }], rows: [[10], [40], [50], [90]] });
    const hint = hintFor(view(game), "p1");
    expect(hint.card).toBeDefined();
    expect(hint.say).toBe(`我会出 ${hint.card}。`);
    expect(hint.anchor).toBe(`card:${hint.card}`);
    expect(hint.note?.length ?? 0).toBeGreaterThan(4);
  });

  it("比所有排尾都小、轮到我选排：说收第几排，指着那一排", () => {
    let game = buildGame({ players: [{ hand: [2, 60] }, { hand: [30, 70] }], rows: [[10, 11, 12], [40], [50], [90]] });
    game = playHand(game, [2, 70]);
    expect(game.phase).toBe("chooseRow");
    const hint = hintFor(view(game), "p1");
    expect(hint.row).toBeDefined();
    expect(hint.anchor).toBe(`row-${hint.row! + 1}`);
    expect(hint.say).toMatch(/^我会收第 [1-4] 排。$/);
  });

  it("已经扣好牌、别人在选排、终局：不乱指", () => {
    const game = buildGame({ players: [{ hand: [12, 60], selection: 12 }, { hand: [30, 70] }], rows: [[10], [40], [50], [90]] });
    expect(hintFor(view(game), "p1").anchor).toBeNull();
  });
});

describe("「第一次遇到」小贴士", () => {
  it("自己的牌比所有排尾都小：先出「你的牌比所有排尾都小」", () => {
    let game = buildGame({ players: [{ hand: [2, 60] }, { hand: [30, 70] }], rows: [[10], [40], [50], [90]] });
    game = playHand(game, [2, 70]);
    expect(detectTips(game, "p1", false)[0]).toBe("low-self");
    expect(detectTips(game, "p2", false)).toContain("low-other");
  });

  it("自己收第六张 / 别人收第六张", () => {
    let game = buildGame({ players: [{ hand: [16, 60] }, { hand: [30, 70] }], rows: [[10, 11, 12, 13, 14], [40], [50], [90]] });
    game = playHand(game, [16, 70]);
    expect(detectTips(game, "p1", false)[0]).toBe("sixth-self");
    expect(detectTips(game, "p2", false)).toContain("sixth-other");
  });

  it("超时：第一次提示「你超时了」；被托管时先出「你进入了托管」", () => {
    const game = buildGame({ players: [{ hand: [16, 60] }, { hand: [30, 70], selection: 30 }], rows: [[10], [40], [50], [90]] });
    const timedOut = timeoutTurn(game);
    expect(detectTips(timedOut, "p1", false)).toContain("timeout");
    expect(detectTips(timedOut, "p1", true)[0]).toBe("auto-self");
  });

  it("有一排已经 5 张、我还没选：提醒第六张；一局打完：提醒累计和目标分", () => {
    const game = buildGame({ players: [{ hand: [16, 60] }, { hand: [30, 70] }], rows: [[10, 11, 12, 13, 14], [40], [50], [90]] });
    expect(detectTips(game, "p1", false)).toContain("row-full");
    let last = buildGame({ players: [{ hand: [60] }, { hand: [70] }], rows: [[10], [40], [50], [90]] });
    last = playHand(last, [60, 70]);
    expect(last.phase).toBe("roundEnd");
    expect(detectTips(last, "p1", false)).toContain("round-end");
  });

  it("每条小贴士都有标题和内容，最多两句", () => {
    for (const [id, tip] of Object.entries(TIPS)) {
      expect(tip.title.length, id).toBeGreaterThan(0);
      expect(tip.text.split(/[。！？]/).filter((part) => part.trim()).length, id).toBeLessThanOrEqual(2);
    }
  });
});
