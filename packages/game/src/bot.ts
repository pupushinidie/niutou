import { legalActions } from "./engine.js";
import type { GameCommand, GameState } from "./types.js";

/**
 * 人机占位（引擎阶段放的）：从合法动作里随机挑一个，保证服务器的人机接线能编译、能把整局打完。
 * 人机阶段会换成正式策略（补充文件第一节）。
 *
 * 输入是这个座位视角（redactGameForViewer 之后）的状态。已经选好牌就不再动（不撤回、不改选），免得来回改。
 * 没有要它做的事返回 null。
 */
export function botCommand(state: GameState, playerId: string): GameCommand | null {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player || (state.phase === "select" && player.selected)) return null;
  const actions = legalActions(state, playerId).filter((action) => action.type !== "unselect");
  if (actions.length === 0) return null;
  return actions[Math.floor(Math.random() * actions.length)]!;
}
