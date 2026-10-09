/**
 * 随机对局的公用部分（被 random-*.test.ts 用）：2–10 每种人数各 300 局，三个变体轮流组合（目标分 66 / 33、固定 2 局、战术模式），
 * 随机挑人、随机走合法动作（含撤回、改选），偶尔整步超时，直到终局。
 * 每一步用普通代码检查不变量，攒下第一个错误，最后统一 expect（每步 expect 太慢）。
 */
import {
  applyCommand,
  cardsInPlay,
  createGame,
  createRng,
  legalActions,
  redactGameForSpectator,
  redactGameForViewer,
  resolvePlays,
  ROW_LIMIT,
  stateProblems,
  sumBulls,
  targetRow,
  timeoutTurn,
  waitingFor,
  type GameOptions,
  type GameState,
  type Rng,
} from "../src/index.js";

export const GAMES_PER_COUNT = 300;
const MAX_STEPS = 20_000;

const VARIANTS: Partial<GameOptions>[] = [
  {},
  { tactics: true },
  { target: 33 },
  { fixedRounds: 2 },
  { target: 33, tactics: true },
  { fixedRounds: 2, tactics: true },
  { fixedRounds: 3, target: 20 },
  { fixedRounds: 1, tactics: true, target: 100 },
];

export interface Stats {
  games: number;
  steps: number;
  rounds: number;
  reveals: number;
  chooseRows: number;
  sixths: number;
  ties: number;
  timeouts: number;
  unselects: number;
  maxSteps: number;
}

function sameSet(left: number[], right: number[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort((x, y) => x - y);
  const b = [...right].sort((x, y) => x - y);
  return a.every((value, index) => value === b[index]);
}

/** 检查一个状态；有问题返回说明。先过对外的 stateProblems（顺便验证它在真实对局里不误报），再查下面这些。 */
function check(state: GameState, previous: GameState | null): string | null {
  const problems = stateProblems(state);
  if (problems.length > 0) return `stateProblems：${problems.join("；")}`;
  const n = state.players.length;
  const pool = cardsInPlay(n, state.config.tactics);
  const reveal = state.reveal;
  const pending = state.phase === "chooseRow" && reveal ? reveal.plays.slice(reveal.steps.length).map((play) => play.card) : [];

  // 4 排：每排 1–5 张、从左到右递增
  if (state.rows.length !== 4) return "不是 4 排";
  for (const row of state.rows) {
    if (row.length < 1 || row.length > ROW_LIMIT) return `排的张数不对：${JSON.stringify(row)}`;
    for (let index = 1; index < row.length; index += 1) if (row[index]! <= row[index - 1]!) return `排没有递增：${JSON.stringify(row)}`;
  }

  // 牌守恒：手牌 + 4 排 + 收牌堆 + 待结算 + 没发的牌 = 这一局用的牌（不重不漏）
  const everywhere = [
    ...state.players.flatMap((player) => player.hand),
    ...state.rows.flat(),
    ...state.players.flatMap((player) => player.taken),
    ...pending,
    ...(state.deck ?? []),
  ];
  if (new Set(everywhere).size !== everywhere.length) return "有牌重复";
  if (!sameSet(everywhere, pool)) return `牌不守恒：${everywhere.length} / ${pool.length}`;
  if (state.config.tactics && (state.deck ?? []).length !== 0) return "战术模式 deck 不为空";
  if (!state.config.tactics && (state.deck ?? []).length !== 104 - 10 * n - 4) return "基础模式没发的牌数量不对";

  // 本局亮过的牌 = 排上的 + 收牌堆 + 待结算的
  if (!sameSet(state.seenCards, [...state.rows.flat(), ...state.players.flatMap((player) => player.taken), ...pending])) return "seenCards 不对";

  // 罚分：本局牛头 = 收牌堆牛头；累计 = 打完的各局之和
  for (const player of state.players) {
    if (player.roundBulls !== sumBulls(player.taken)) return `${player.id} 本局牛头和收牌堆不一致`;
    if (player.handCount !== player.hand.length) return `${player.id} handCount 不对`;
    const settled = state.history.reduce((sum, result) => sum + (result.bulls[player.id] ?? 0), 0);
    if (player.total !== settled) return `${player.id} 累计罚分 ${player.total} ≠ 各局之和 ${settled}`;
    if (player.selected !== (player.selection !== null)) return "selected 和 selection 不一致";
    if (player.selection !== null && !player.hand.includes(player.selection)) return "选的牌不在手里";
  }
  // 牛头总数守恒
  const bullsTotal = sumBulls(everywhere);
  if (bullsTotal !== sumBulls(pool)) return "牛头总数不守恒";

  // 每人手牌一样多，并且和第几手对得上
  const sizes = new Set(state.players.map((player) => player.hand.length));
  if (sizes.size !== 1) return "手牌张数不一样";
  const size = state.players[0]!.hand.length;
  const expected = state.phase === "select" ? 11 - state.turn : state.phase === "chooseRow" ? 10 - state.turn : 0;
  if (size !== expected) return `第 ${state.turn} 手（${state.phase}）手牌 ${size} 张，应为 ${expected}`;
  if (state.round !== state.history.length + (state.phase === "roundEnd" || state.phase === "gameOver" ? 0 : 1)) return "round 和 history 对不上";

  // 各阶段
  switch (state.phase) {
    case "select":
      if (state.chooser !== null) return "选牌阶段 chooser 不为空";
      if (state.players.every((player) => player.selected)) return "所有人都选好了却没亮牌";
      break;
    case "chooseRow": {
      if (!reveal || state.chooser === null) return "chooseRow 没有 chooser";
      const play = reveal.plays[reveal.steps.length]!;
      if (play.player !== state.chooser) return "chooser 不是这张牌的主人";
      if (targetRow(state.rows, play.card) !== null) return "这张牌能接上却停在 chooseRow";
      if (reveal.steps.length !== 0) return "规则 C 不是这一手第一张";
      if (state.players.some((player) => player.selected)) return "chooseRow 时还有人是已选状态";
      break;
    }
    case "roundEnd":
      if (state.config.fixedRounds !== null && state.round >= state.config.fixedRounds) return "打满固定局数却没结束";
      if (state.config.fixedRounds === null && state.players.some((player) => player.total >= state.config.target)) return "到目标分却没结束";
      break;
    case "gameOver": {
      const result = state.finalResult;
      if (!result) return "终局没有结果";
      const best = Math.min(...state.players.map((player) => player.total));
      const winners = state.players.filter((player) => player.total === best).map((player) => player.id);
      if (JSON.stringify(result.winners) !== JSON.stringify(winners)) return "胜者不对";
      if (state.config.fixedRounds !== null) {
        if (state.round !== state.config.fixedRounds) return "固定局数没打满就结束";
      } else {
        if (!state.players.some((player) => player.total >= state.config.target)) return "没人到目标分就结束";
        const before = state.history.at(-2);
        if (before && Object.values(before.totals).some((total) => total >= state.config.target)) return "上一局就该结束";
      }
      break;
    }
  }

  // 不会卡死：没结束就一定有人要做决定，而且他有合法动作
  if (state.phase !== "gameOver") {
    const waiting = waitingFor(state);
    if (waiting.length === 0) return `${state.phase} 没有人要做决定`;
    for (const id of waiting) if (legalActions(state, id).length === 0) return `${id} 要做决定却没有合法动作`;
  }

  // 亮牌：一人一张、从小到大；已结算的步骤和纯函数重算一致；规则 C 最多一次且是最小的牌
  if (reveal && (!previous || previous.reveal?.id !== reveal.id || previous.reveal.steps.length !== reveal.steps.length)) {
    if (reveal.plays.length !== n || new Set(reveal.plays.map((play) => play.player)).size !== n) return "亮牌不是一人一张";
    for (let index = 1; index < reveal.plays.length; index += 1) if (reveal.plays[index]!.card <= reveal.plays[index - 1]!.card) return "亮牌没有从小到大";
    const lows = reveal.steps.filter((step) => step.kind === "low");
    if (lows.length > 1) return "一手里出现两次规则 C";
    if (lows.length === 1 && lows[0] !== reveal.steps[0]) return "规则 C 不是第一张";
    const chosen = lows[0]?.row;
    const redo = resolvePlays(reveal.rowsBefore, reveal.plays.slice(0, reveal.steps.length), chosen === undefined ? undefined : () => chosen);
    if (JSON.stringify(redo.steps.map(({ auto: _auto, ...rest }) => rest)) !== JSON.stringify(reveal.steps.map(({ auto: _auto, ...rest }) => rest))) {
      return "逐张结算和纯函数重算不一致";
    }
    if (reveal.done && JSON.stringify(reveal.steps.at(-1)!.rows) !== JSON.stringify(state.rows)) {
      return "结算完的 4 排和状态不一致";
    }
  }

  if (previous && state.version <= previous.version) return "version 没有前进";
  return null;
}

/** 隐藏信息：随机挑一个玩家视角和观战视角查。 */
function checkRedaction(state: GameState, rng: Rng): string | null {
  const viewer = state.players[rng.int(state.players.length)]!;
  const view = redactGameForViewer(state, viewer.id);
  const blind = redactGameForSpectator(state, false);
  for (const shown of [view, blind]) {
    const record = shown as unknown as Record<string, unknown>;
    if (record.deck !== undefined || record.seed !== undefined || record.rngState !== undefined || record.log !== undefined) return "服务端字段下发了";
    for (const player of shown.players) {
      if (shown === view && player.id === viewer.id) continue;
      if (player.hand.length !== 0 || player.selection !== null) return `${player.id} 的手牌或选牌下发了`;
    }
  }
  return null;
}

/** 随机走一步：大多数时候随机挑一个要做决定的人走随机合法动作；偶尔已选的人撤回 / 改选；偶尔整步超时。 */
function randomStep(state: GameState, rng: Rng, stats: Stats): GameState {
  if (rng.next() < 0.03) {
    stats.timeouts += 1;
    return timeoutTurn(state);
  }
  let actorPool = waitingFor(state);
  if (state.phase === "select" && rng.next() < 0.08) {
    const selected = state.players.filter((player) => player.selected).map((player) => player.id);
    if (selected.length > 0) actorPool = selected;
  }
  const actor = actorPool[rng.int(actorPool.length)]!;
  const actions = legalActions(state, actor);
  const action = actions[rng.int(actions.length)]!;
  if (action.type === "unselect") stats.unselects += 1;
  return applyCommand(state, actor, action);
}

export async function runGames(count: number): Promise<{ failure: string | null; stats: Stats }> {
  const stats: Stats = { games: 0, steps: 0, rounds: 0, reveals: 0, chooseRows: 0, sixths: 0, ties: 0, timeouts: 0, unselects: 0, maxSteps: 0 };
  const players = Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}`, name: `玩家${index + 1}` }));
  for (let game = 0; game < GAMES_PER_COUNT; game += 1) {
    // 让出事件循环，免得 vitest 的进程间通信超时
    if (game % 20 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    const seed = count * 100_000 + game;
    const rng = createRng(seed ^ 0x5eed);
    const options = VARIANTS[game % VARIANTS.length]!;
    let state = createGame(players, seed, options);
    let previous: GameState | null = null;
    let steps = 0;
    const where = () => `${count} 人第 ${game} 局（种子 ${seed}，${JSON.stringify(options)}）第 ${steps} 步`;
    let failure = check(state, null);
    if (failure) return { failure: `${where()}：${failure}`, stats };
    while (state.phase !== "gameOver") {
      if (steps >= MAX_STEPS) return { failure: `${where()}：超过 ${MAX_STEPS} 步还没结束`, stats };
      // 每 97 步抽查一次 apply 有没有改输入
      const before = steps % 97 === 0 ? JSON.stringify(state) : null;
      previous = state;
      state = randomStep(state, rng, stats);
      steps += 1;
      if (before !== null && JSON.stringify(previous) !== before) return { failure: `${where()}：apply 改了输入`, stats };
      failure = check(state, previous) ?? checkRedaction(state, rng);
      if (failure) return { failure: `${where()}：${failure}`, stats };
      if (state.reveal && state.reveal.id !== previous.reveal?.id) stats.reveals += 1;
      if (state.phase === "chooseRow" && previous.phase !== "chooseRow") stats.chooseRows += 1;
      if (state.events.some((event) => event.type === "RowTaken" && event.reason === "sixth")) stats.sixths += 1;
    }
    stats.games += 1;
    stats.steps += steps;
    stats.rounds += state.round;
    stats.maxSteps = Math.max(stats.maxSteps, steps);
    if (state.finalResult!.winners.length > 1) stats.ties += 1;
  }
  return { failure: null, stats };
}

