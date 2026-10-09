/** 人机占位（引擎阶段放的，人机阶段会换掉）：只走合法动作、只吃 redact 后的状态、能把整局打完。 */
import { describe, expect, it } from "vitest";
import { applyCommand, botCommand, createGame, legalActions, redactGameForViewer, sameCommand, waitingFor } from "../src/index.js";

describe("人机占位", () => {
  it("每种人数打 20 局：每一步都是合法动作，不撤回，能打到终局", () => {
    for (let count = 2; count <= 10; count += 1) {
      const players = Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}`, name: `咕噜${index + 1}` }));
      for (let game = 0; game < 20; game += 1) {
        let state = createGame(players, count * 1000 + game, { target: 33 });
        let steps = 0;
        while (state.phase !== "gameOver") {
          expect(steps++).toBeLessThan(5000);
          const id = waitingFor(state)[0]!;
          const command = botCommand(redactGameForViewer(state, id), id);
          expect(command).not.toBeNull();
          expect(command!.type).not.toBe("unselect");
          expect(legalActions(state, id).some((action) => sameCommand(action, command!))).toBe(true);
          state = applyCommand(state, id, command!);
        }
      }
    }
  });

  it("已经选好就不动；没有要它做的事返回 null", () => {
    const state = createGame([{ id: "a", name: "甲" }, { id: "b", name: "乙" }], 1);
    const after = applyCommand(state, "a", { type: "select", card: state.players[0]!.hand[0]! });
    expect(botCommand(redactGameForViewer(after, "a"), "a")).toBeNull();
    expect(botCommand(redactGameForViewer(after, "b"), "b")).not.toBeNull();
    expect(botCommand(redactGameForViewer(after, "x"), "x")).toBeNull();
  });
});
