/**
 * 谁是牛头王和教程有关的部分（共用的 Coach / useTutorial / tips / storage 之外，本游戏自己写的）：
 * 游戏 id、「提示」怎么说、「第一次遇到」小贴士什么时候出。
 */
import { botHint, type GameState } from "@niutou/game";

/** 本机记录（gm-tutorial-<id>、gm-tips-<id>）用的游戏 id。 */
export const GAME_ID = "niutou";

const ROW_LABEL = ["第 1 排", "第 2 排", "第 3 排", "第 4 排"];

export interface Hint {
  readonly say: string;
  readonly note?: string;
  /** 高亮哪个元素（data-tutorial）；null 不指。 */
  readonly anchor: string | null;
  /** 顺手替你选中的牌（还要你自己点确认）。 */
  readonly card?: number;
  /** 顺手替你选中的排（0–3）。 */
  readonly row?: number;
}

/**
 * 「提示」：让人机从你的位置算一步（game 就是网页收到的你的视角，人机本来也只看这些），配一句理由。
 * 理由是人机自己写的（botHint 的 reason）。
 */
export function hintFor(game: GameState, playerId: string): Hint {
  if (game.phase === "gameOver") return { say: "这局已经结束了。", anchor: null };
  const decision = botHint(game, playerId);
  if (!decision) {
    if (game.phase === "chooseRow") return { say: "等出牌的人挑完排再问我。", anchor: null };
    return { say: "你这一手已经扣好牌了，等别人。", note: "想换的话，先点「撤回」再问我。", anchor: null };
  }
  const { command, reason } = decision;
  if (command.type === "select") return { say: `我会出 ${command.card}。`, note: reason, anchor: `card:${command.card}`, card: command.card };
  if (command.type === "chooseRow") {
    return { say: `我会收${ROW_LABEL[command.row]}。`, note: reason, anchor: `row-${command.row + 1}`, row: command.row };
  }
  return { say: "点「继续」开下一局。", anchor: "continue" };
}

/** 「第一次遇到」小贴士的内容。 */
export const TIPS = {
  "low-self": {
    title: "你的牌比所有排尾都小",
    text: "它接不上任何一排：点一排整排收走（排头的数字是这排的牛头），你的牌成为新排头。通常挑牛头最少的那排。",
  },
  "sixth-self": {
    title: "你收了第六张",
    text: "你的牌是那一排的第 6 张，前 5 张归你，牛头算罚分。出牌前看看那排是不是已经 5 张，也留意同一手里更小的牌会先放。",
  },
  "auto-self": {
    title: "你进入了托管",
    text: "连续 2 次超时，现在由人机替你出牌。点「取消托管」，或者直接出一张牌，就能拿回来。",
  },
  timeout: {
    title: "你超时了",
    text: "系统替你做了这一步。再连续超时一次就会进入托管，由人机替你打。",
  },
  "sixth-other": {
    title: "有人收了第六张",
    text: "一排最多 5 张，放成第 6 张的人把前 5 张收走。每排左边的数字是这一排一共几个牛头。",
  },
  "low-other": {
    title: "有人在挑排",
    text: "他的牌比所有排尾都小，要自己挑一排整排收走。等他挑完，这一手剩下的牌按新的 4 排接着放。",
  },
  "row-full": {
    title: "有一排已经 5 张了",
    text: "会接到这一排的牌就是第 6 张，要把 5 张全收走。除非同一手里有更小的牌先把它收掉。",
  },
  "round-end": {
    title: "一局打完了",
    text: "每人这局收的牛头加进累计罚分。有人累计到目标分，这一局打完就结束，罚分最少的赢。",
  },
} as const;

/** 这一步该出哪些小贴士（按优先顺序；只出第一条没看过的）。auto：自己正被托管。 */
export function detectTips(game: GameState, selfId: string, auto: boolean): string[] {
  const ids: string[] = [];
  if (!selfId) return ids;
  for (const event of game.events) {
    if (event.type === "ChooseRow" && event.player === selfId) ids.push("low-self");
    if (event.type === "RowTaken" && event.reason === "sixth" && event.player === selfId) ids.push("sixth-self");
  }
  if (auto) ids.push("auto-self");
  for (const event of game.events) {
    if (event.type === "TimedOut" && event.players.includes(selfId)) ids.push("timeout");
  }
  for (const event of game.events) {
    if (event.type === "RowTaken" && event.reason === "sixth" && event.player !== selfId) ids.push("sixth-other");
    if (event.type === "ChooseRow" && event.player !== selfId) ids.push("low-other");
    if (event.type === "RoundEnded") ids.push("round-end");
  }
  const me = game.players.find((player) => player.id === selfId);
  if (game.phase === "select" && me && !me.selected && game.rows.some((row) => row.length >= 5)) ids.push("row-full");
  return ids;
}
