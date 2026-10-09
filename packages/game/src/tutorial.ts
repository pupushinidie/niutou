/**
 * 新手教程的剧本（谁是牛头王）。
 *
 * 教程在浏览器里直接跑规则引擎，不连服务器：发牌按补充文件 2.2 的 34 张固定牌摆好（不洗牌），
 * 前 5 手大家出什么都由剧本定，所以「二号收第六张」「你用 5 挑一排」「55 把一号挤成第六张」这几幕一定会发生。
 * 剧本走完接着把这一局打完（练习局）：两个咕噜交给人机，之后的发牌是普通随机数。
 *
 * 每一步写三件事：咕噜嘎说什么（say / note）、高亮哪个元素（anchor，对应网页里的 data-tutorial="…"）、
 * 等玩家做什么（do 步骤的 expect）。改了规则或界面，test/tutorial.test.ts 会检查剧本还能不能从头走到尾。
 */
import { createGame } from "./engine.js";
import { buildGame } from "./scenes.js";
import type { BotOptions } from "./bot.js";
import type { GameCommand, GameState } from "./types.js";

/** 咕噜嘎的表情。 */
export type TutorialFace = "base" | "happy" | "surprised" | "think";

/** 剧本里的一步棋：谁、做什么（同时出牌的游戏，要写明是谁）。 */
export interface TutorialMove {
  readonly player: string;
  readonly command: GameCommand;
}

interface StepBase {
  readonly id: string;
  /** 侧栏「新手教程」进度里这一课叫什么；同一课的后几步不写。 */
  readonly lesson?: string;
  /** 主句（24px），一句话说清这一步。 */
  readonly say: string;
  /** 补充说明（12px），最多两句。 */
  readonly note?: string;
  /** 触屏设备上换成这句说明。 */
  readonly noteTouch?: string;
  /**
   * 高亮哪个元素：网页里 data-tutorial 的值；写成数组时按顺序用页面上看得见的第一个（手机上「第几局」收在菜单里）。
   * 固定的有 rows、row-1…row-4、hand、round、prompt、undo；一张手牌是 card:<牌号>，别人的座位是 seat:<玩家 id>。
   */
  readonly anchor?: string | readonly string[];
  /**
   * 两步操作的第二步（do 步骤用）：选中 anchor 那张牌 / 那一排以后，高亮挪到这里（confirm / confirm-row）。
   */
  readonly then?: string;
  readonly face?: TutorialFace;
}

export type TutorialStep =
  /** 讲解：玩家点「下一步」继续。finale 是最后一步（接练习局或结束）。 */
  | (StepBase & { readonly kind: "info"; readonly finale?: boolean })
  /** 等玩家做这一步；做别的会被拦下。 */
  | (StepBase & { readonly kind: "do"; readonly expect: TutorialMove })
  /** 两个咕噜按剧本自动走这几步，牌桌不压暗。 */
  | (StepBase & { readonly kind: "watch"; readonly moves: readonly TutorialMove[] });

export const TUTORIAL_SELF = "p1";
export const TUTORIAL_BOTS = [
  { id: "p2", name: "咕噜一号" },
  { id: "p3", name: "咕噜二号" },
] as const;
const ONE = "p2";
const TWO = "p3";

/** 练习局的目标分（开工建议：3 人、目标 33，打得快一点）。 */
export const TUTORIAL_TARGET = 33;

/** 练习局里人机松一点（人机交接：预计罚分差 1.5 分以内随便挑，对基线 4 人胜率 60% → 42%）。 */
export const TUTORIAL_BOT_OPTIONS: Partial<BotOptions> = { tie: 1.5 };

/** 补充文件 2.2 的固定发牌（34 张，不重复）。 */
export const TUTORIAL_DEAL = {
  rows: [[8], [24], [41], [67]],
  hands: {
    [TUTORIAL_SELF]: [44, 45, 27, 5, 11, 33, 62, 78, 91, 100],
    [ONE]: [10, 46, 47, 7, 56, 15, 38, 60, 83, 97],
    [TWO]: [26, 70, 49, 28, 55, 19, 52, 73, 86, 103],
  },
} as const;

const me = (command: GameCommand): TutorialMove => ({ player: TUTORIAL_SELF, command });
const one = (card: number): TutorialMove => ({ player: ONE, command: { type: "select", card } });
const two = (card: number): TutorialMove => ({ player: TWO, command: { type: "select", card } });
const pick = (card: number) => me({ type: "select", card });

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  // ---------- 开场 ----------
  {
    kind: "info", id: "welcome", lesson: "目标：少收牛头", face: "happy",
    say: "我是咕噜嘎，带你打几手牌。",
    note: "这个游戏收到的牛头都是罚分：罚分越少越好，最少的人赢。",
  },
  {
    kind: "info", id: "rows", anchor: "rows",
    say: "桌上有 4 排牌，大家出的牌都接到这 4 排里。",
    note: "一排最多 5 张。谁的牌放成某一排的第 6 张，就要把前 5 张收走。",
  },
  {
    kind: "info", id: "bulls", anchor: "hand",
    say: "每张牌上画着几个牛头，收到几个就罚几分。",
    note: "大多数牌 1 个；个位是 5 的 2 个，整十的 3 个，两位数字一样的（11、22…）5 个，55 最多，有 7 个。",
  },

  // ---------- 第 1 手：同时出牌、从小到大、只看排尾 ----------
  {
    kind: "info", id: "together", lesson: "同时出牌", anchor: "hand",
    say: "每一手，三个人同时各扣一张牌。",
    note: "都扣好了才一起亮牌，谁也看不到别人扣了什么。",
  },
  {
    kind: "do", id: "pick44", anchor: "card:44", then: "confirm", expect: pick(44),
    say: "先出 44：点一下 44，再点「确认」。",
    note: "点一下只是选中，桌上会预演它落在哪；点「确认」才算扣下。",
  },
  {
    kind: "watch", id: "h1", anchor: ["seat:p2", "seats"], moves: [one(10), two(26)],
    say: "咕噜一号和咕噜二号也在扣牌……",
  },
  {
    kind: "info", id: "h1-order", lesson: "从小到大放", anchor: "rows",
    say: "亮牌后，按数字从小到大一张张放。",
    note: "这一手先放 10，再放 26，最后放你的 44。谁先扣的、坐在哪都不影响顺序。",
  },
  {
    kind: "info", id: "h1-tail", lesson: "只看排尾", anchor: "row-3",
    say: "你的 44 接到了第 3 排的 41 后面。",
    note: "每张牌只看各排的最后一张，接在比它小、又最接近的那一排。10、26 也比 44 小，但 41 最近。",
  },
  {
    kind: "info", id: "h1-rule", anchor: "rows", face: "think",
    say: "放哪一排是规则算出来的，不能自己挑。",
    note: "排里前面的牌不用看，只看每排最后一张。",
  },

  // ---------- 第 2 手：撤回、第 5 张还安全 ----------
  {
    kind: "do", id: "pick45", lesson: "撤回", anchor: "card:45", then: "confirm", expect: pick(45),
    say: "第二手出 45。",
    note: "选中 45，再点「确认」。",
  },
  {
    kind: "do", id: "undo", anchor: "undo", expect: me({ type: "unselect" }),
    say: "想改主意，就点「撤回」。",
    note: "最后一个人确认之前，扣下的牌都能撤回；亮牌前谁也看不到你出了什么。",
  },
  {
    kind: "do", id: "repick45", anchor: "card:45", then: "confirm", expect: pick(45),
    say: "好，再把 45 扣下。",
    note: "也可以直接点另一张牌再点「改选」，一样能换。",
  },
  {
    kind: "watch", id: "h2", anchor: ["seat:p3", "seats"], moves: [one(46), two(70)],
    say: "看看 45 和咕噜一号的 46 放到哪……",
  },
  {
    kind: "info", id: "h2-four", lesson: "第 6 张要收", anchor: "row-3", face: "think",
    say: "第 3 排现在有 4 张了。",
    note: "再放 1 张是第 5 张，还安全；谁放成第 6 张，谁就把前 5 张收走。",
  },

  // ---------- 第 3 手：二号收第六张；同一手前面的牌会改变后面的去向 ----------
  {
    kind: "do", id: "pick27", anchor: "card:27", then: "confirm", expect: pick(27),
    say: "这手出 27。",
    note: "它会接在第 2 排的 26 后面，很安全。",
  },
  {
    kind: "watch", id: "h3", anchor: ["seat:p3", "seats"], moves: [one(47), two(49)],
    say: "盯住第 3 排……",
  },
  {
    kind: "info", id: "h3-sixth", anchor: ["seat:p3", "seats"], face: "surprised",
    say: "咕噜二号的 49 是第 6 张，收走了 5 张！",
    note: "41、44、45、46、47 一共 10 个牛头（44 一张就 5 个）。第 3 排只剩下 49。",
  },
  {
    kind: "info", id: "h3-order", lesson: "小牌先放会抢位", anchor: "row-3", face: "think",
    say: "49 单独出本来安全，是更小的 47 先放了进去。",
    note: "同一手里小的牌先放，会改变后面牌的去向。离排尾近，也不一定安全。",
  },
  {
    kind: "info", id: "h3-taken", anchor: ["seat:p3", "seats"],
    say: "收来的牌不进手牌，只算罚分。",
    note: "头像旁的牛头数就是这一局收了多少，大家一直看得见。手牌还是开局那 10 张，每手少一张。",
  },

  // ---------- 第 4 手：比所有排尾都小，自己挑一排整排收 ----------
  {
    kind: "watch", id: "h4", anchor: ["seat:p2", "seats"], moves: [one(7), two(28)],
    say: "这次它们先扣好了，头像角上会打勾。",
  },
  {
    kind: "do", id: "pick5", lesson: "比排尾都小：挑一排", anchor: "card:5", then: "confirm", expect: pick(5), face: "think",
    say: "出 5，它比所有排尾都小。",
    note: "这种牌哪一排都接不上：亮牌后你要自己挑一排，整排收走。",
  },
  {
    kind: "info", id: "h4-heads", anchor: "rows",
    say: "每排左边的数字，是这一排一共几个牛头。",
    note: "第 1 排 4 个，第 2 排 3 个，第 3 排只有 1 个，第 4 排 4 个。",
  },
  {
    kind: "do", id: "choose", anchor: "row-3", then: "confirm-row", expect: me({ type: "chooseRow", row: 2 }),
    say: "挑第 3 排：点它，再点「确认」。",
    note: "一定要收一排，收哪排自己定，通常挑牛头最少的。你的 5 会成为这一排的第一张。",
  },
  {
    kind: "info", id: "h4-after", lesson: "收完接着放", anchor: "row-3", face: "happy",
    say: "你只罚了 1 分，一号的 7 还接在了你的 5 后面。",
    note: "收走一排后，这一手剩下的牌按新的 4 排接着放。",
  },

  // ---------- 第 5 手：55 是 7 个牛头 ----------
  {
    kind: "do", id: "pick11", anchor: "card:11", then: "confirm", expect: pick(11),
    say: "出 11，它会接在第 1 排的 10 后面。",
    note: "11 有 5 个牛头，但打出去不罚分，只有收到的才算。",
  },
  {
    kind: "watch", id: "h5", anchor: ["seat:p2", "seats"], moves: [one(56), two(55)],
    say: "再看一手……",
  },
  {
    kind: "info", id: "h5-55", anchor: ["seat:p2", "seats"], face: "surprised",
    say: "咕噜一号的 56 是第 6 张，收走 11 个牛头！",
    note: "二号的 55 先放成第 5 张，把 56 挤成了第 6 张。55 一张就是 7 个牛头。",
  },

  // ---------- 结束条件、本站设定 ----------
  {
    kind: "info", id: "round", lesson: "一局和终局", anchor: ["round", "prompt"],
    say: "10 手打完算一局，各人收的牛头加进累计罚分。",
    note: "有人累计到 66 分，要打完那一局才结束，局中超过也不停。罚分最少的赢，一样少就一起赢。",
  },
  {
    kind: "info", id: "options", anchor: ["round", "prompt"],
    say: "开房时可以改目标分、打固定几局，或开战术模式。",
    note: "都默认关。这局练习把目标分设成了 33，打得快一点。",
  },
  {
    kind: "info", id: "auto", lesson: "超时和托管",
    say: "超时或掉线也不怕，人机会替你出牌。",
    note: "每手 30 秒，连续 2 次超时会进托管：人机替你打，点「取消托管」就拿回来。掉线 3 秒也由人机接手，用原昵称回来就能回座。",
  },
  {
    kind: "info", id: "finale", finale: true, face: "happy",
    say: "你已经会玩了，接下来和两个咕噜把这局打完！",
    note: "拿不准就点「提示」（键盘 H），我告诉你我会出哪张。",
  },
];

/** 教程开局：3 人（你、咕噜一号、咕噜二号），补充文件 2.2 的固定发牌，目标 33。 */
export function createTutorialGame(selfName: string, seed = 20261009): GameState {
  return buildGame({
    players: [
      { id: TUTORIAL_SELF, name: selfName, hand: [...TUTORIAL_DEAL.hands[TUTORIAL_SELF]] },
      ...TUTORIAL_BOTS.map((bot) => ({ id: bot.id, name: bot.name, hand: [...TUTORIAL_DEAL.hands[bot.id]] })),
    ],
    rows: TUTORIAL_DEAL.rows.map((row) => [...row]),
    options: { target: TUTORIAL_TARGET },
    seed,
  });
}

/** 练习局「再练一局」：同样 3 人、目标 33，随机发牌。 */
export function createPracticeGame(selfName: string, seed: number): GameState {
  return createGame([{ id: TUTORIAL_SELF, name: selfName }, ...TUTORIAL_BOTS], seed, { target: TUTORIAL_TARGET });
}

/**
 * 现在该谁动（教程和练习局用）：选牌时先让还没选的人机选，人机都选好了才轮到你（你也可以先选）；
 * 规则 C 等出牌的人选排；局末先让人机点「继续」。对局结束返回 null。
 */
export function tutorialActor(state: GameState, self: string = TUTORIAL_SELF): string | null {
  const bots = state.players.filter((player) => player.id !== self);
  const mine = state.players.find((player) => player.id === self);
  switch (state.phase) {
    case "select":
      return bots.find((player) => !player.selected)?.id ?? (mine && !mine.selected ? self : null);
    case "chooseRow":
      return state.chooser;
    case "roundEnd":
      return bots.find((player) => !player.ready)?.id ?? (mine && !mine.ready ? self : null);
    case "gameOver":
      return null;
  }
}

/** 你现在能不能动（选牌是同时的：人机还没选完时你也能选、能撤回）。 */
export function selfCanAct(state: GameState, self: string = TUTORIAL_SELF): boolean {
  const mine = state.players.find((player) => player.id === self);
  if (!mine) return false;
  if (state.phase === "select") return mine.handCount > 0;
  if (state.phase === "chooseRow") return state.chooser === self;
  if (state.phase === "roundEnd") return !mine.ready;
  return false;
}

/** 两步是不是同一步（同一个人、同一个动作；不看 step 字段）。 */
export function sameMove(a: TutorialMove, b: TutorialMove): boolean {
  if (a.player !== b.player || a.command.type !== b.command.type) return false;
  if (a.command.type === "select" && b.command.type === "select") return a.command.card === b.command.card;
  if (a.command.type === "chooseRow" && b.command.type === "chooseRow") return a.command.row === b.command.row;
  return true;
}

/** 这一步的锚点候选（按顺序）。 */
export function anchorCandidates(step: TutorialStep): readonly string[] {
  if (!step.anchor) return [];
  return typeof step.anchor === "string" ? [step.anchor] : step.anchor;
}

/**
 * 这个锚点在这个局面里，界面上应该看得见吗（给剧本单测用，对应 GameBoard 的显示条件；不考虑动画中途）。
 * viewer 是看界面的人（教程里就是你）。
 */
export function anchorVisible(state: GameState, anchor: string, viewer: string = TUTORIAL_SELF): boolean {
  const mine = state.players.find((player) => player.id === viewer);
  if (!mine) return false;
  const selecting = state.phase === "select" && mine.handCount > 0;
  if (["rows", "row-1", "row-2", "row-3", "row-4", "row-bulls", "round", "prompt", "seats", "my-seat", "hand"].includes(anchor)) return true;
  if (anchor.startsWith("card:")) {
    const card = Number(anchor.slice("card:".length));
    // 选牌时才露出手牌（亮牌条盖住手牌的时候不算）；已扣下的那张换成 committed-card
    return selecting && mine.hand.includes(card) && mine.selection !== card;
  }
  if (anchor.startsWith("seat:")) {
    const id = anchor.slice("seat:".length);
    return id !== viewer && state.players.some((player) => player.id === id);
  }
  if (anchor === "confirm") return selecting;
  if (anchor === "undo") return selecting && mine.selected;
  if (anchor === "confirm-row") return state.phase === "chooseRow" && state.chooser === viewer;
  if (anchor === "continue") return state.phase === "roundEnd" && !mine.ready;
  return false;
}
