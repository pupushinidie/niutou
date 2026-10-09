import { baselineCommand } from "./baseline.js";
import {
  cardsInPlay,
  DEFAULT_TARGET,
  HAND_SIZE,
  placeCard,
  ROW_COUNT,
  sortPlays,
  takeLowRow,
  type ResolveStep,
} from "./cards.js";
import { createRng, type Rng } from "./rng.js";
import { OPTION_LIMITS } from "./roomTypes.js";
import type {
  Config,
  GameCommand,
  GameEvent,
  GameOptions,
  GameState,
  LogEntry,
  Phase,
  Player,
} from "./types.js";

export const DEFAULT_OPTIONS: GameOptions = { target: DEFAULT_TARGET, fixedRounds: null, tactics: false };

/**
 * 检查并补全开房选项：不给的项用默认值；给了但不合法就抛错（服务器把错误原样回给房主）。
 * fixedRounds 传 null 表示不固定局数。
 */
export function normalizeOptions(input: unknown = {}): GameOptions {
  if (input === null || typeof input !== "object") throw new Error("开房选项格式不对。");
  const raw = input as Record<string, unknown>;
  const target = raw.target ?? DEFAULT_OPTIONS.target;
  if (typeof target !== "number" || !Number.isInteger(target) || target < OPTION_LIMITS.target.min || target > OPTION_LIMITS.target.max) {
    throw new Error(`目标分要是 ${OPTION_LIMITS.target.min}–${OPTION_LIMITS.target.max} 的整数。`);
  }
  const fixedRounds = raw.fixedRounds ?? null;
  if (
    fixedRounds !== null
    && (typeof fixedRounds !== "number" || !Number.isInteger(fixedRounds) || fixedRounds < OPTION_LIMITS.fixedRounds.min || fixedRounds > OPTION_LIMITS.fixedRounds.max)
  ) {
    throw new Error(`固定局数要是 ${OPTION_LIMITS.fixedRounds.min}–${OPTION_LIMITS.fixedRounds.max} 的整数，或者不固定。`);
  }
  const tactics = raw.tactics ?? DEFAULT_OPTIONS.tactics;
  if (typeof tactics !== "boolean") throw new Error("战术模式只能开或关。");
  return { target, fixedRounds, tactics };
}

export function defaultConfig(options: Partial<GameOptions> = {}, overrides: Partial<Config> = {}): Config {
  return {
    ...normalizeOptions(options),
    minPlayers: 2,
    maxPlayers: 10,
    handSize: HAND_SIZE,
    selectTimeoutSec: 30,
    chooseRowTimeoutSec: 20,
    roundEndSec: 5,
    ...overrides,
  };
}

export interface NewPlayer {
  readonly id: string;
  readonly name: string;
}

/**
 * 结算动画的节奏（毫秒），界面照这个放，服务器按它给下一步的倒计时和人机的停顿留出动画时间：
 * 亮牌翻面 flipMs；每张接上去 placeMs；每次收牌（第六张 / 规则 C）takeMs（飞向玩家 + 罚分飘字）。
 */
export const ANIMATION = { flipMs: 1200, placeMs: 700, takeMs: 2000 } as const;

/** 这一批事件要放多久动画（毫秒）。服务器在换步骤时用最近一步的事件算。 */
export function animationMs(events: readonly GameEvent[]): number {
  let ms = 0;
  for (const event of events) {
    if (event.type === "Revealed") ms += ANIMATION.flipMs;
    else if (event.type === "CardPlaced") ms += ANIMATION.placeMs;
    else if (event.type === "RowTaken") ms += ANIMATION.takeMs;
  }
  return ms;
}

function findPlayer(state: GameState, playerId: string): Player {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("你不在这局里。");
  return player;
}

/** 发一局牌：洗这一局要用的牌，每人 10 张，再翻 4 张做排头，其余不用（藏在 deck 里）。 */
function deal(state: GameState, rng: Rng, events: GameEvent[]): void {
  const cards = rng.shuffle(cardsInPlay(state.players.length, state.config.tactics));
  let cursor = 0;
  for (const player of state.players) {
    player.hand = cards.slice(cursor, cursor + state.config.handSize).sort((a, b) => a - b);
    cursor += state.config.handSize;
    player.handCount = player.hand.length;
    player.selected = false;
    player.selection = null;
    player.taken = [];
    player.roundBulls = 0;
    player.ready = false;
  }
  state.rows = cards.slice(cursor, cursor + ROW_COUNT).map((card) => [card]);
  cursor += ROW_COUNT;
  state.deck = cards.slice(cursor);
  state.seenCards = state.rows.map((row) => row[0]!);
  state.reveal = null;
  state.chooser = null;
  state.turn = 1;
  state.phase = "select";
  events.push({ type: "RoundStarted", round: state.round, rows: state.rows.map((row) => [...row]) });
}

/** 记一步结算：更新 4 排；收牌的进收牌堆、加本局牛头。 */
function recordStep(state: GameState, step: ResolveStep, events: GameEvent[]): void {
  state.reveal!.steps.push(step);
  state.rows = step.rows.map((row) => [...row]);
  if (step.kind === "place") {
    events.push({ type: "CardPlaced", player: step.player, card: step.card, row: step.row, position: step.position });
    return;
  }
  const player = findPlayer(state, step.player);
  player.taken.push(...step.taken);
  player.roundBulls += step.bulls;
  events.push({
    type: "RowTaken",
    player: step.player,
    card: step.card,
    row: step.row,
    cards: [...step.taken],
    bulls: step.bulls,
    reason: step.kind,
    ...(step.auto ? { auto: true as const } : {}),
  });
}

/** 所有人都选好：同时亮牌，从小到大逐张结算。 */
function reveal(state: GameState, events: GameEvent[]): void {
  const plays = sortPlays(state.players.map((player) => ({ player: player.id, card: player.selection! })));
  for (const player of state.players) {
    player.hand = player.hand.filter((card) => card !== player.selection);
    player.handCount = player.hand.length;
    player.selection = null;
    player.selected = false;
  }
  state.revealCount += 1;
  state.reveal = {
    id: state.revealCount,
    round: state.round,
    turn: state.turn,
    plays,
    rowsBefore: state.rows.map((row) => [...row]),
    steps: [],
    done: false,
  };
  state.seenCards.push(...plays.map((play) => play.card));
  events.push({ type: "Revealed", revealId: state.revealCount, round: state.round, turn: state.turn, plays: plays.map((play) => ({ ...play })) });
  continueResolve(state, events);
}

/** 从下一张没结算的牌继续；遇到规则 C 停在 chooseRow，全部放完就结束这一手。 */
function continueResolve(state: GameState, events: GameEvent[]): void {
  const current = state.reveal!;
  for (let index = current.steps.length; index < current.plays.length; index += 1) {
    const play = current.plays[index]!;
    const step = placeCard(state.rows, play);
    if (!step) {
      state.phase = "chooseRow";
      state.chooser = play.player;
      events.push({ type: "ChooseRow", player: play.player, card: play.card });
      return;
    }
    recordStep(state, step, events);
  }
  finishHand(state, events);
}

function finishHand(state: GameState, events: GameEvent[]): void {
  const current = state.reveal!;
  current.done = true;
  state.chooser = null;
  const bulls: Record<string, number> = Object.fromEntries(state.players.map((player) => [player.id, 0]));
  for (const step of current.steps) bulls[step.player] = (bulls[step.player] ?? 0) + step.bulls;
  events.push({ type: "HandEnded", round: state.round, turn: state.turn, bulls });
  if (state.players.every((player) => player.hand.length === 0)) {
    endRound(state, events);
    return;
  }
  state.turn += 1;
  state.phase = "select";
}

/** 一局打完：本局牛头加进累计；到目标分（或打满固定局数）就结束，否则等下一局。 */
function endRound(state: GameState, events: GameEvent[]): void {
  for (const player of state.players) player.total += player.roundBulls;
  const bulls = Object.fromEntries(state.players.map((player) => [player.id, player.roundBulls]));
  const totals = Object.fromEntries(state.players.map((player) => [player.id, player.total]));
  state.history.push({ round: state.round, bulls, totals });
  events.push({ type: "RoundEnded", round: state.round, bulls: { ...bulls }, totals: { ...totals } });

  const { fixedRounds, target } = state.config;
  const over = fixedRounds !== null ? state.round >= fixedRounds : state.players.some((player) => player.total >= target);
  if (over) {
    finishGame(state, fixedRounds !== null ? "rounds" : "target", events);
    return;
  }
  state.phase = "roundEnd";
  for (const player of state.players) player.ready = false;
}

function finishGame(state: GameState, reason: "target" | "rounds", events: GameEvent[]): void {
  state.phase = "gameOver";
  state.chooser = null;
  const best = Math.min(...state.players.map((player) => player.total));
  const winners = state.players.filter((player) => player.total === best).map((player) => player.id);
  const totals = Object.fromEntries(state.players.map((player) => [player.id, player.total]));
  state.finalResult = { winners, totals, rounds: state.round, reason };
  events.push({ type: "GameEnded", winners: [...winners], totals: { ...totals }, reason });
}

function applySelect(state: GameState, player: Player, card: unknown, events: GameEvent[]): void {
  if (state.phase !== "select") throw new Error("现在不是选牌的时候。");
  if (typeof card !== "number" || !player.hand.includes(card)) throw new Error("这张牌不在你手里。");
  if (player.selected && player.selection === card) throw new Error("已经选好这张了。");
  player.selection = card;
  player.selected = true;
  events.push({ type: "Selected", player: player.id });
  if (state.players.every((candidate) => candidate.selected)) reveal(state, events);
}

function applyUnselect(state: GameState, player: Player, events: GameEvent[]): void {
  if (state.phase !== "select") throw new Error("已经亮牌了，不能撤回。");
  if (!player.selected) throw new Error("你还没有选牌。");
  player.selection = null;
  player.selected = false;
  events.push({ type: "Unselected", player: player.id });
}

function applyChooseRow(state: GameState, player: Player, row: unknown, auto: boolean, events: GameEvent[]): void {
  if (state.phase !== "chooseRow") throw new Error("现在不需要选排。");
  if (state.chooser !== player.id) throw new Error("不是你选排。");
  if (typeof row !== "number" || !Number.isInteger(row) || row < 0 || row >= state.rows.length) {
    throw new Error("排号不对，只能选 0–3。");
  }
  const current = state.reveal!;
  const play = current.plays[current.steps.length]!;
  recordStep(state, takeLowRow(state.rows, play, row, auto), events);
  state.chooser = null;
  state.phase = "select";
  continueResolve(state, events);
}

function applyNextRound(state: GameState, player: Player, rng: Rng, events: GameEvent[]): void {
  if (state.phase !== "roundEnd") throw new Error("现在不能开下一局。");
  if (player.ready) throw new Error("已经点过继续了。");
  player.ready = true;
  events.push({ type: "Ready", player: player.id });
  if (state.players.every((candidate) => candidate.ready)) {
    state.round += 1;
    deal(state, rng, events);
  }
}

/**
 * 复制状态，给 apply 改。引擎只会改：players 里的字段和数组、rows、reveal.steps、seenCards、history、deck，这些都复制；
 * 引擎从不原地改的（config、亮出的牌 plays、rowsBefore、每一步 ResolveStep、历史里的每一局、finalResult、动作序列）共享引用。
 */
function cloneState(state: GameState): GameState {
  const next: GameState = {
    ...state,
    players: state.players.map((player) => ({ ...player, hand: [...player.hand], taken: [...player.taken] })),
    rows: state.rows.map((row) => [...row]),
    reveal: state.reveal ? { ...state.reveal, steps: [...state.reveal.steps] } : null,
    seenCards: [...state.seenCards],
    history: [...state.history],
    events: [],
  };
  if (state.deck) next.deck = [...state.deck];
  return next;
}

function applyInternal(state: GameState, playerId: string, command: GameCommand, rng: Rng, auto: boolean): { state: GameState; events: GameEvent[] } {
  if (state.phase === "gameOver") throw new Error("对局已经结束。");
  findPlayer(state, playerId);
  const next = cloneState(state);
  const player = findPlayer(next, playerId);
  const events: GameEvent[] = [];
  switch (command?.type) {
    case "select":
      applySelect(next, player, command.card, events);
      break;
    case "unselect":
      applyUnselect(next, player, events);
      break;
    case "chooseRow":
      applyChooseRow(next, player, command.row, auto, events);
      break;
    case "nextRound":
      applyNextRound(next, player, rng, events);
      break;
    default:
      throw new Error("未知的行动。");
  }
  next.version += 1;
  next.events = events;
  return { state: next, events };
}

/**
 * 纯函数：playerId 做 command，返回新状态和这一步的事件，不改输入。
 * 随机数（发下一局的牌）从 rng 取；服务端用 applyCommand，它从 state.rngState 恢复 rng 并存回去。
 */
export function apply(state: GameState, playerId: string, command: GameCommand, rng: Rng): { state: GameState; events: GameEvent[] } {
  return applyInternal(state, playerId, command, rng, false);
}

function runCommand(state: GameState, playerId: string, command: GameCommand, auto = false): { state: GameState; events: GameEvent[] } {
  const rng = createRng(state.rngState ?? state.seed ?? 0);
  const { state: next, events } = applyInternal(state, playerId, command, rng, auto);
  next.rngState = rng.state;
  const entry: LogEntry = auto ? { player: playerId, command, auto: true } : { player: playerId, command };
  next.log = [...(state.log ?? []), entry];
  return { state: next, events };
}

/** 服务端用：随机数状态存在 state.rngState 里，动作记进 state.log。 */
export function applyCommand(state: GameState, playerId: string, command: GameCommand): GameState {
  return runCommand(state, playerId, command).state;
}

/** 现在还要等谁做决定：选牌时没选好的人；选排时 chooser；局末没点继续的人。 */
export function waitingFor(state: GameState): string[] {
  switch (state.phase) {
    case "select":
      return state.players.filter((player) => !player.selected).map((player) => player.id);
    case "chooseRow":
      return state.chooser ? [state.chooser] : [];
    case "roundEnd":
      return state.players.filter((player) => !player.ready).map((player) => player.id);
    case "gameOver":
      return [];
  }
}

/**
 * playerId 现在能做的所有动作（调试牌桌每个一个按钮）。
 * 选牌时：没选的人每张手牌一个 select；已选的人能 unselect，也能直接 select 别的牌改选。
 */
export function legalActions(state: GameState, playerId: string): GameCommand[] {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (!player) return [];
  switch (state.phase) {
    case "select": {
      const selects: GameCommand[] = player.hand
        .filter((card) => card !== player.selection)
        .map((card) => ({ type: "select", card }));
      return player.selected ? [{ type: "unselect" }, ...selects] : selects;
    }
    case "chooseRow":
      return state.chooser === playerId ? state.rows.map((_, row) => ({ type: "chooseRow", row })) : [];
    case "roundEnd":
      return player.ready ? [] : [{ type: "nextRound" }];
    case "gameOver":
      return [];
  }
}

/**
 * 服务器的计时 key：只在换手（round/turn）或换步骤（进入 / 离开 chooseRow、局末）时变。
 * 选牌是大家同时做的「轮外操作」，别人选牌 / 撤回不改变 key，倒计时不会被重置。
 */
export function stepKey(state: GameState): string {
  return `${state.round}:${state.turn}:${state.phase}`;
}

/** 超时代做时怎么选：拿到的是这个座位视角（redact 之后）的状态。默认用简单基线；人机阶段可以换成 botCommand。 */
export type TimeoutPolicy = (view: GameState, playerId: string) => GameCommand | null;

/** policy 给的动作不合法时退回基线（基线一定合法）。 */
function autoCommand(state: GameState, playerId: string, policy: TimeoutPolicy): GameCommand {
  const view = redactGameForViewer(state, playerId);
  let command: GameCommand | null = null;
  try {
    command = policy(view, playerId);
  } catch {
    command = null;
  }
  const legal = legalActions(state, playerId);
  const ok = command !== null && command.type !== "unselect" && legal.some((action) => sameCommand(action, command!));
  return ok ? command! : baselineCommand(view, playerId)!;
}

/** 两个动作是不是同一个（不看字段顺序）。 */
export function sameCommand(left: GameCommand, right: GameCommand): boolean {
  if (left.type !== right.type) return false;
  if (left.type === "select" && right.type === "select") return left.card === right.card;
  if (left.type === "chooseRow" && right.type === "chooseRow") return left.row === right.row;
  return true;
}

/**
 * 当前这一步超时：所有还没做决定的人由系统代做（policy，默认简单基线）。
 * - 选牌：没选的人代选一张，最后一张选完就亮牌结算（遇到规则 C 停在 chooseRow，那一步另外计时）；
 * - 规则 C 选排：代 chooser 选一排（基线：牛头最少 → 排尾最大 → 排号最小）；
 * - 局末：代所有没点的人点「继续」，发下一局。
 * 事件最前面是 TimedOut（被代做的人）。
 */
export function timeoutTurn(state: GameState, policy: TimeoutPolicy = baselineCommand): GameState {
  if (state.phase === "gameOver") return state;
  const phase: Phase = state.phase;
  const players = waitingFor(state);
  let current = state;
  const events: GameEvent[] = [];
  for (const playerId of players) {
    // 选牌时最后一个人代选完就亮牌，后面不会再有人等着
    if (current.phase !== phase || !waitingFor(current).includes(playerId)) continue;
    const step = runCommand(current, playerId, autoCommand(current, playerId, policy), true);
    events.push(...step.events);
    current = step.state;
  }
  if (current === state) return state;
  current.events = [{ type: "TimedOut", phase, players }, ...events];
  return current;
}

/** 只在服务端的字段：本局没发的牌（顺序）、种子、随机数状态、动作序列。 */
function stripServerOnly(state: GameState): GameState {
  const { deck: _deck, seed: _seed, rngState: _rngState, log: _log, ...rest } = state;
  return structuredClone(rest) as GameState;
}

/**
 * 玩家 viewerId 能看到的状态：别人的手牌换成空数组（张数看 handCount），别人选的牌换成 null（只留「已选好」），
 * 没发出去的牌、种子、随机数状态、动作序列都去掉。viewerId 不是玩家（比如 ""）时谁的手牌都看不到。
 */
export function redactGameForViewer(state: GameState, viewerId: string): GameState {
  const view = stripServerOnly(state);
  view.players = view.players.map((player) => (player.id === viewerId ? player : { ...player, hand: [], selection: null }));
  return view;
}

/** 观战的人：房主打开「观战看手牌」时看得到所有人的手牌和已选的牌；牌堆顺序和种子永远看不到。 */
export function redactGameForSpectator(state: GameState, seeAll: boolean): GameState {
  return seeAll ? stripServerOnly(state) : redactGameForViewer(state, "");
}

/**
 * 开一场新对局（第 1 局已发好牌，进入选牌）。seed 决定整场所有洗牌；options 是开房选项；
 * overrides 改计时之类的配置（测试用）。
 */
export function createGame(
  players: readonly NewPlayer[],
  seed = Math.floor(Math.random() * 2 ** 32),
  options: Partial<GameOptions> = {},
  overrides: Partial<Config> = {},
): GameState {
  const config = defaultConfig(options, overrides);
  if (players.length < config.minPlayers || players.length > config.maxPlayers) {
    throw new Error(`需要 ${config.minPlayers}–${config.maxPlayers} 位玩家才能开始。`);
  }
  if (new Set(players.map((player) => player.id)).size !== players.length) throw new Error("玩家 id 重复。");
  const state: GameState = {
    config,
    phase: "select",
    players: players.map((player, seat) => ({
      id: player.id,
      name: player.name,
      seat,
      hand: [],
      handCount: 0,
      selected: false,
      selection: null,
      taken: [],
      roundBulls: 0,
      total: 0,
      ready: false,
    })),
    round: 1,
    turn: 1,
    rows: [],
    reveal: null,
    chooser: null,
    seenCards: [],
    history: [],
    revealCount: 0,
    events: [],
    version: 0,
    deck: [],
    seed,
    log: [],
  };
  const rng = createRng(seed);
  const events: GameEvent[] = [];
  deal(state, rng, events);
  state.events = events;
  state.rngState = rng.state;
  return state;
}
