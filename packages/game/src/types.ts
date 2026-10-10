import type { Play, ResolveStep } from "./cards.js";

/** 开房时房主能改的选项（开工拍板：三个都做，默认关）。 */
export interface GameOptions {
  /** 目标分：某局结束时有人累计罚分 ≥ 它，游戏结束。默认 66。 */
  readonly target: number;
  /** 固定局数：打满这么多局就结束，罚分最少者胜，不看目标分。null = 不固定（默认）。 */
  readonly fixedRounds: number | null;
  /** 战术模式：只用 1 到「人数 × 10 + 4」号牌，每张都会被打出来。默认关。 */
  readonly tactics: boolean;
}

export interface Config extends GameOptions {
  readonly minPlayers: number;
  readonly maxPlayers: number;
  /** 每人每局手牌数（10）。 */
  readonly handSize: number;
  /** 选牌限时（秒），从上一手结算动画放完算起；超时按简单基线代出。 */
  readonly selectTimeoutSec: number;
  /** 规则 C 选排限时（秒）；超时按基线规则代选。 */
  readonly chooseRowTimeoutSec: number;
  /** 一局结束后停留多久（秒，从最后一手动画放完算起）自动开下一局；所有人点「继续」就立刻开。 */
  readonly roundEndSec: number;
}

/**
 * select：所有人同时选牌（可以撤回改选，最后一人确认的瞬间亮牌并结算）；
 * chooseRow：结算到一张比所有排尾都小的牌（规则 C），等出牌的人 chooser 选排；
 * roundEnd：一局 10 手打完，已计入累计罚分，等大家点「继续」或超时后发下一局；
 * gameOver：游戏结束，finalResult 有胜者。
 */
export type Phase = "select" | "chooseRow" | "roundEnd" | "gameOver";

export interface Player {
  readonly id: string;
  readonly name: string;
  /** 座位序号 0–9（入座顺序）。 */
  readonly seat: number;
  /** 手牌，从小到大。**隐藏**：别人看到的是空数组，张数看 handCount。 */
  hand: number[];
  /** 手牌张数（公开）。选好的牌亮出之前还算在手里。 */
  handCount: number;
  /** 这一手是否已选好（公开）。 */
  selected: boolean;
  /** 这一手选的牌。**隐藏**：只有自己看得到，别人看到 null（亮牌后清空，牌面在 reveal 里）。 */
  selection: number | null;
  /** 本局收到的牌（公开，收牌的过程大家都看得见）。 */
  taken: number[];
  /** 本局收到的牛头数（公开，开工拍板：一直显示）。 */
  roundBulls: number;
  /**
   * 累计罚分。select / chooseRow 时只含**已打完**的局，本局的在 roundBulls；
   * 一局打完（roundEnd / gameOver）时已经把本局加进来了，roundBulls 留着给结算界面显示。
   */
  total: number;
  /** roundEnd 阶段：已点「继续」。 */
  ready: boolean;
}

/** 一次亮牌：这一手所有人的牌、亮牌时的 4 排、逐张结算的每一步。下一次亮牌前一直留着，给界面放动画、给重连的人补看。 */
export interface Reveal {
  /** 本局对局里第几次亮牌（从 1 起，整场递增）；界面按它判断是不是新的亮牌，每次只播一遍。 */
  readonly id: number;
  readonly round: number;
  /** 本局第几手（1–10）。 */
  readonly turn: number;
  /** 亮出的牌，按数字从小到大（也就是结算顺序）。 */
  readonly plays: Play[];
  /** 亮牌那一刻的 4 排。 */
  readonly rowsBefore: number[][];
  /** 已结算的每一步，下标对应 plays。停在 chooseRow 时只到规则 C 那张之前。 */
  steps: ResolveStep[];
  /** 全部结算完。 */
  done: boolean;
}

/** 一局的结算。 */
export interface RoundResult {
  readonly round: number;
  /** 每人这一局收到的牛头。 */
  readonly bulls: Record<string, number>;
  /** 这一局打完后的累计罚分。 */
  readonly totals: Record<string, number>;
}

export interface FinalResult {
  /** 累计罚分最少的人；并列就都算赢（官方 30 周年版规则）。 */
  readonly winners: string[];
  readonly totals: Record<string, number>;
  /** 一共打了几局。 */
  readonly rounds: number;
  /** 为什么结束：有人到目标分 / 打满固定局数。 */
  readonly reason: "target" | "rounds";
}

/**
 * 玩家的动作。每个动作都可以带 step：发出时自己看到的 stepKey(game)（「局:手:阶段」）。
 * 带了而且和服务器当前的对不上（比如这一手已经超时亮牌了、点击才到），就拒绝，免得迟到的点击落到下一手。
 * 网页发动作时一定要带；测试、脚本可以不带。
 */
export type GameCommand =
  /** 选牌（确认）。已经选过时再发就是改选。 */
  | { readonly type: "select"; readonly card: number; readonly step?: string }
  /** 撤回已选的牌；最后一个人确认前都可以。 */
  | { readonly type: "unselect"; readonly step?: string }
  /** 规则 C：选一排收走（0–3），只有 chooser 能发。 */
  | { readonly type: "chooseRow"; readonly row: number; readonly step?: string }
  /** 局末点「继续」；所有人都点了就立刻发下一局，否则等超时。 */
  | { readonly type: "nextRound"; readonly step?: string };

export type GameEvent =
  /** 有人选好了（不含牌面）。改选也发这个。 */
  | { readonly type: "Selected"; readonly player: string }
  /** 有人撤回了。 */
  | { readonly type: "Unselected"; readonly player: string }
  /** 所有人都选好，同时亮牌；plays 按从小到大。 */
  | { readonly type: "Revealed"; readonly revealId: number; readonly round: number; readonly turn: number; readonly plays: Play[] }
  /** 规则 A：接到第 row 排，成为第 position 张。 */
  | { readonly type: "CardPlaced"; readonly player: string; readonly card: number; readonly row: number; readonly position: number }
  /** 规则 B（sixth）/ 规则 C（low）：player 收走第 row 排的 cards，罚 bulls，他的 card 成为这一排的第一张。auto：规则 C 是代选的。 */
  | {
      readonly type: "RowTaken";
      readonly player: string;
      readonly card: number;
      readonly row: number;
      readonly cards: number[];
      readonly bulls: number;
      readonly reason: "sixth" | "low";
      readonly auto?: true;
    }
  /** 结算到 card（比所有排尾都小），停下等 player 选排。 */
  | { readonly type: "ChooseRow"; readonly player: string; readonly card: number }
  /** 这一手结算完：每人这一手被罚的牛头（没收牌的是 0）。 */
  | { readonly type: "HandEnded"; readonly round: number; readonly turn: number; readonly bulls: Record<string, number> }
  /** 一局打完：每人本局牛头、新的累计。 */
  | { readonly type: "RoundEnded"; readonly round: number; readonly bulls: Record<string, number>; readonly totals: Record<string, number> }
  /** 局末有人点了「继续」。 */
  | { readonly type: "Ready"; readonly player: string }
  /** 新的一局发好牌了（不含手牌内容）。 */
  | { readonly type: "RoundStarted"; readonly round: number; readonly rows: number[][] }
  | { readonly type: "GameEnded"; readonly winners: string[]; readonly totals: Record<string, number>; readonly reason: "target" | "rounds" }
  /** 超时：这些人由系统代做了这一步（选牌 / 选排 / 局末继续）。 */
  | { readonly type: "TimedOut"; readonly phase: Phase; readonly players: string[] };

/** 服务端记的动作序列（整理过的动作，不含 step）：同一种子按顺序重放就能复现整局。auto = 超时 / 托管 / 离线时代做。 */
export interface LogEntry {
  readonly player: string;
  readonly command: GameCommand;
  readonly auto?: true;
}

export interface GameState {
  readonly config: Config;
  phase: Phase;
  players: Player[];
  /** 第几局（从 1 起）。 */
  round: number;
  /** 本局第几手（1–10）；roundEnd 时停在 10。 */
  turn: number;
  /** 4 排，左边是第一张，最后一张是排尾（公开）。 */
  rows: number[][];
  /** 最近一次亮牌（公开）；新一局发牌时清空。 */
  reveal: Reveal | null;
  /** 规则 C 等谁选排（只在 chooseRow 阶段）。 */
  chooser: string | null;
  /** 本局已经亮出过的牌：开局 4 张排头 + 每一手亮出的牌（公开，人机记牌用）。 */
  seenCards: number[];
  /** 已经打完的每一局。 */
  history: RoundResult[];
  /** 本场一共亮过几次牌（Reveal.id 的来源）。 */
  revealCount: number;
  /** 最近一步产生的事件。界面放动画以 reveal 为准，事件只用来提示。 */
  events: GameEvent[];
  finalResult?: FinalResult;
  /** 每个动作 +1；界面看它变没变触发动画。 */
  version: number;
  /** 以下只在服务端：本局没发出去的牌（顺序是洗过的）、种子、随机数状态、动作序列。 */
  deck?: number[];
  /** 服务器：256 位十六进制密钥（ChaCha20，见 rng.ts）；测试、教程、预览：32 位数字（mulberry32）。 */
  seed?: number | string;
  rngState?: number | string;
  log?: LogEntry[];
}
