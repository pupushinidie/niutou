/**
 * 预览局面工厂（对外接口）：界面的预览页、教程、验收（含背靠背的规则核对）都用它造局面，不用真打一局去等。
 *
 * - createScene(name, opts)：按名字造常见局面（完整的服务端状态，给界面用之前要过 redactGameForViewer）；
 * - buildGame(spec)：按参数造任意精确局面（指定每人手牌、4 排、累计罚分、收牌堆、第几局第几手、开房选项）；
 * - playHand(state, plays, choose?)：让所有人按指定的牌出这一手（最后一人确认时亮牌结算），规则 C 时可以顺手选排；
 * - revealFrames(state) / revealAt(state, k)：把一次亮牌拆成逐张的画面，给动画和截图用；
 * - createSceneRoom(game, opts)：包成网页收到的房间快照（某个座位或观战视角），可以标离线、人机、托管、倒计时。
 *
 * 签名和用法见 README「对外接口」一节。
 */
import { baselineCommand } from "./baseline.js";
import { cardsInPlay, HAND_SIZE, ROW_COUNT, ROW_LIMIT, sumBulls, type ResolveStep } from "./cards.js";
import { applyCommand, createGame, defaultConfig, redactGameForSpectator, redactGameForViewer, timeoutTurn } from "./engine.js";
import { createRng } from "./rng.js";
import { DEFAULT_ROOM_ACCESS, type Capacity, type LobbyMember, type LobbyRoomSnapshot } from "./roomTypes.js";
import type { GameOptions, GameState, Player, RoundResult } from "./types.js";

/** 预览里的玩家名（座位 0 是「我」）。玩家 id 是 p1–p10。 */
export const SCENE_NAMES_OF_PLAYERS = ["我", "阿牛", "小花", "老黄", "大壮", "二丫", "三毛", "四喜", "五福", "六顺"] as const;

export interface PlayerSpec {
  /** 默认 p1、p2…（按顺序）。 */
  readonly id?: string;
  readonly name?: string;
  /** 手牌（完整指定）；不给就从没用到的牌里随机发（张数和别人一样，或按 turn 推算）。 */
  readonly hand?: number[];
  /** 不想写全手牌时：这几张一定在手里，其余随机补齐。和 hand 二选一。 */
  readonly include?: number[];
  /** 已打完的局的累计罚分（默认 0）。 */
  readonly total?: number;
  /** 本局已收的牌（默认空）；本局牛头按它算。 */
  readonly taken?: number[];
  /** 这一手已选好的牌（要在手牌里）。不能所有人都给：要亮牌请用 playHand。 */
  readonly selection?: number | null;
}

export interface ExactSpec {
  /** 人数（2–10，名字和 id 用默认的），或者逐个指定。 */
  readonly players: number | readonly PlayerSpec[];
  /** 4 排（每排 1–5 张、从左到右递增）；不给就随机翻 4 张。 */
  readonly rows?: number[][];
  readonly options?: Partial<GameOptions>;
  /** 第几局，默认 1。 */
  readonly round?: number;
  /** 本局第几手（1–10）；默认按手牌张数推算：11 − 张数。 */
  readonly turn?: number;
  /** 打完的局；不给就按 total 编一条（round > 1 时）。 */
  readonly history?: RoundResult[];
  /** 随机发牌用的种子（默认 7）。 */
  readonly seed?: number;
}

function defaultPlayer(index: number): { id: string; name: string } {
  return { id: `p${index + 1}`, name: SCENE_NAMES_OF_PLAYERS[index] ?? `玩家${index + 1}` };
}

/**
 * 按参数造一个精确的选牌阶段局面（phase = select）。会检查：牌不重复、都在这一局用的牌里、
 * 每排 1–5 张且递增、每人手牌张数一样。没指定的手牌从剩下的牌里随机发，剩下的进 deck（服务端字段）。
 */
export function buildGame(spec: ExactSpec): GameState {
  const specs: PlayerSpec[] = typeof spec.players === "number"
    ? Array.from({ length: spec.players }, () => ({}))
    : [...spec.players];
  const count = specs.length;
  const config = defaultConfig(spec.options ?? {});
  if (count < config.minPlayers || count > config.maxPlayers) throw new Error(`需要 ${config.minPlayers}–${config.maxPlayers} 位玩家。`);
  const rng = createRng(spec.seed ?? 7);
  const pool = cardsInPlay(count, config.tactics);
  const used = new Set<number>();
  const use = (card: number, where: string) => {
    if (!Number.isInteger(card) || !pool.includes(card)) throw new Error(`${where}：${card} 不在这一局用的牌里。`);
    if (used.has(card)) throw new Error(`${where}：${card} 用了两次。`);
    used.add(card);
  };
  specs.forEach((player, index) => {
    if (player.hand && player.include) throw new Error(`第 ${index + 1} 位：hand 和 include 只能给一个。`);
    for (const card of player.hand ?? player.include ?? []) use(card, `第 ${index + 1} 位的手牌`);
    for (const card of player.taken ?? []) use(card, `第 ${index + 1} 位的收牌堆`);
  });
  let rows: number[][];
  if (spec.rows) {
    if (spec.rows.length !== ROW_COUNT) throw new Error("要正好 4 排。");
    rows = spec.rows.map((row, index) => {
      if (row.length < 1 || row.length > ROW_LIMIT) throw new Error(`第 ${index + 1} 排要有 1–5 张。`);
      row.forEach((card, position) => {
        use(card, `第 ${index + 1} 排`);
        if (position > 0 && card <= row[position - 1]!) throw new Error(`第 ${index + 1} 排要从左到右递增。`);
      });
      return [...row];
    });
  } else {
    rows = [];
  }
  const given = specs.filter((player) => player.hand).map((player) => player.hand!.length);
  const handSize = spec.turn !== undefined ? HAND_SIZE + 1 - spec.turn : given[0] ?? HAND_SIZE;
  if (handSize < 1 || handSize > HAND_SIZE) throw new Error("手牌要有 1–10 张（turn 1–10）。");
  if (given.some((size) => size !== handSize)) throw new Error(`每人手牌要一样多（${handSize} 张）。`);
  let free = rng.shuffle(pool.filter((card) => !used.has(card)));
  if (!spec.rows) {
    rows = free.slice(0, ROW_COUNT).map((card) => [card]);
    free = free.slice(ROW_COUNT);
  }
  const players: Player[] = specs.map((player, index) => {
    const base = defaultPlayer(index);
    let hand = player.hand ? [...player.hand] : null;
    if (!hand) {
      const fixed = [...(player.include ?? [])];
      if (fixed.length > handSize) throw new Error(`第 ${index + 1} 位 include 的牌比手牌张数还多。`);
      const need = handSize - fixed.length;
      if (free.length < need) throw new Error("剩下的牌不够发手牌。");
      hand = [...fixed, ...free.slice(0, need)];
      free = free.slice(need);
    }
    hand.sort((a, b) => a - b);
    const selection = player.selection ?? null;
    if (selection !== null && !hand.includes(selection)) throw new Error(`第 ${index + 1} 位选的 ${selection} 不在手牌里。`);
    const taken = [...(player.taken ?? [])];
    return {
      id: player.id ?? base.id,
      name: player.name ?? base.name,
      seat: index,
      hand,
      handCount: hand.length,
      selected: selection !== null,
      selection,
      taken,
      roundBulls: sumBulls(taken),
      total: player.total ?? 0,
      ready: false,
    };
  });
  if (new Set(players.map((player) => player.id)).size !== players.length) throw new Error("玩家 id 重复。");
  if (players.every((player) => player.selected)) throw new Error("所有人都选好了就该亮牌：先少给一个人的 selection，再用 playHand。");
  const round = spec.round ?? 1;
  // 没给 history 时编 round − 1 条：累计都算在第 1 局，之后各局 0 分（这样「累计 = 各局之和」照样成立）
  const history = spec.history
    ?? Array.from({ length: round - 1 }, (_, index) => ({
      round: index + 1,
      bulls: Object.fromEntries(players.map((player) => [player.id, index === 0 ? player.total : 0])),
      totals: Object.fromEntries(players.map((player) => [player.id, player.total])),
    }));
  const seenCards = [...rows.flat(), ...players.flatMap((player) => player.taken)].sort((a, b) => a - b);
  return {
    config,
    phase: "select",
    players,
    round,
    turn: HAND_SIZE + 1 - handSize,
    rows,
    reveal: null,
    chooser: null,
    seenCards,
    history,
    revealCount: 0,
    events: [],
    version: 1,
    deck: free,
    seed: spec.seed ?? 7,
    rngState: rng.state,
    log: [],
  };
}

/**
 * 这一手所有人出指定的牌：plays 是「玩家 id → 牌」，或者按座位顺序的数组；没给的人按简单基线出。
 * 已经选好的人如果 plays 里给了别的牌就改选。最后一人确认时亮牌、逐张结算；
 * 遇到规则 C：给了 choose（排号 0–3，或按局面算排号的函数）就替 chooser 选掉，没给就停在 chooseRow。
 */
export function playHand(
  state: GameState,
  plays: Readonly<Record<string, number>> | readonly number[],
  choose?: number | ((state: GameState) => number),
): GameState {
  if (state.phase !== "select") throw new Error("playHand 要在选牌阶段用。");
  const cardOf = (player: Player, index: number): number | undefined =>
    Array.isArray(plays) ? (plays as readonly number[])[index] : (plays as Record<string, number>)[player.id];
  let current = state;
  // 先处理已经选好、要改选的人，再按座位让没选的人选；最后一个选的人触发亮牌。
  const order = [...state.players].sort((left, right) => Number(right.selected) - Number(left.selected));
  for (const player of order) {
    const index = state.players.indexOf(player);
    const live = current.players[index]!;
    const wanted = cardOf(player, index);
    if (live.selected && (wanted === undefined || wanted === live.selection)) continue;
    const card = wanted ?? (baselineCommand(redactGameForViewer(current, live.id), live.id) as { card: number }).card;
    current = applyCommand(current, live.id, { type: "select", card });
  }
  if (current.phase === "chooseRow" && choose !== undefined) {
    const row = typeof choose === "number" ? choose : choose(current);
    current = applyCommand(current, current.chooser!, { type: "chooseRow", row });
  }
  return current;
}

/** 规则 C 等着的时候，替 chooser 选第 row 排（0–3）。 */
export function chooseRowFor(state: GameState, row: number): GameState {
  if (state.phase !== "chooseRow" || !state.chooser) throw new Error("现在不是选排的时候。");
  return applyCommand(state, state.chooser, { type: "chooseRow", row });
}

/** 亮牌动画的一帧：这时的 4 排、这一步（第 0 帧没有）、这时每人本局收的牌和牛头。 */
export interface RevealFrame {
  readonly rows: number[][];
  readonly step: ResolveStep | null;
  /** 座位 → 放到这一帧时本局收的牌（后面几步才收的还没算进来）。 */
  readonly taken: Record<string, number[]>;
  /** 座位 → 放到这一帧时本局的牛头。 */
  readonly roundBulls: Record<string, number>;
}

/**
 * 最近一次亮牌的逐张画面：第 0 帧是亮牌时的 4 排，之后每结算一张一帧。
 * 真实客户端放动画时手里拿的是结算完的状态，按帧画 4 排和收牌堆就行（累计罚分、阶段在动画放完前先别换）。
 */
export function revealFrames(state: GameState): RevealFrame[] {
  const reveal = state.reveal;
  if (!reveal) return [];
  const taken = Object.fromEntries(state.players.map((player) => [player.id, [...player.taken]]));
  // 从结算完的收牌堆往回倒：先去掉这次亮牌里收的牌，得到第 0 帧
  for (const step of reveal.steps) {
    if (step.taken.length === 0) continue;
    const pile = taken[step.player]!;
    taken[step.player] = pile.slice(0, pile.length - step.taken.length);
  }
  const frames: RevealFrame[] = [];
  const snapshot = (rows: number[][], step: ResolveStep | null) => {
    frames.push({
      rows: rows.map((row) => [...row]),
      step,
      taken: Object.fromEntries(Object.entries(taken).map(([id, pile]) => [id, [...pile]])),
      roundBulls: Object.fromEntries(Object.entries(taken).map(([id, pile]) => [id, sumBulls(pile)])),
    });
  };
  snapshot(reveal.rowsBefore, null);
  for (const step of reveal.steps) {
    if (step.taken.length > 0) taken[step.player] = [...taken[step.player]!, ...step.taken];
    snapshot(step.rows, step);
  }
  return frames;
}

/**
 * 给截图用的「动画放到第 k 张」的画面：4 排、每人收牌堆和本局牛头倒回第 k 帧，reveal.steps 只留前 k 步、done = false。
 * 阶段、第几手、累计罚分、局末结算保持结算完的值（真实客户端放动画时手里也是这些）。只用来画图，不要再拿去 apply。
 */
export function revealAt(state: GameState, k: number): GameState {
  const frames = revealFrames(state);
  if (frames.length === 0) throw new Error("这个局面没有亮牌。");
  const index = Math.max(0, Math.min(k, frames.length - 1));
  const frame = frames[index]!;
  const next = structuredClone(state);
  next.rows = frame.rows.map((row) => [...row]);
  for (const player of next.players) {
    player.taken = [...frame.taken[player.id]!];
    player.roundBulls = frame.roundBulls[player.id]!;
  }
  next.reveal!.steps = next.reveal!.steps.slice(0, index);
  next.reveal!.done = false;
  return next;
}

/** 让所有人按简单基线连续出 hands 手（规则 C 也按基线选），用来造「打到一半」的局面。 */
export function autoPlayHands(state: GameState, hands: number): GameState {
  let current = state;
  for (let played = 0; played < hands && current.phase === "select"; played += 1) {
    current = playHand(current, {}, (live) => (baselineCommand(redactGameForViewer(live, live.chooser!), live.chooser!) as { row: number }).row);
  }
  return current;
}

export const SCENE_NAMES = [
  "opening",
  "selectSome",
  "selectedMine",
  "waitingOne",
  "midRound",
  "reveal",
  "chooseRow",
  "chooseRowOther",
  "afterChooseRow",
  "doubleSixth",
  "lastHand",
  "roundEnd",
  "gameOver",
  "gameOverTie",
  "tenPlayers",
  "tenPlayersReveal",
  "tactics",
  "timeout",
  "fixedRounds",
] as const;
export type SceneName = (typeof SCENE_NAMES)[number];

/** 每个场景一句话说明（预览页的下拉菜单可以直接用）。 */
export const SCENE_DESCRIPTIONS: Record<SceneName, string> = {
  opening: "开局：第 1 局第 1 手，谁都还没选",
  selectSome: "选牌中：有人已选好，我还没选",
  selectedMine: "选牌中：我已选好（可撤回），还有人在想",
  waitingOne: "选牌中：只差一个人没选",
  midRound: "一局打到一半（第 5 手前后）：排有长有短，有人收过牌",
  reveal: "刚亮牌：有接上去的、有人放第六张收走 5 张（用 revealFrames 逐张放）",
  chooseRow: "规则 C：我的 4 比所有排尾都小，等我选排（规则书例 1）",
  chooseRowOther: "规则 C：等别人（阿牛）选排",
  afterChooseRow: "规则 C 选完（收第 4 排）后继续结算完（规则书例 1 的结果）",
  doubleSixth: "同一手里两张牌先后接到满排：小的收牌，大的接在它后面",
  lastHand: "第 10 手：每人只剩 1 张",
  roundEnd: "一局结束：本局牛头已计入累计，等大家点继续",
  gameOver: "终局：有人到 66，罚分最少的一人获胜",
  gameOverTie: "终局：两人并列最少，共同获胜",
  tenPlayers: "10 人局选牌中（一半人已选）",
  tenPlayersReveal: "10 人局刚亮牌（10 张逐张结算，可能有人收牌）",
  tactics: "战术模式 3 人局（只用 1–34，deck 为空）",
  timeout: "选牌超时：系统按基线替没选的人出牌（事件里有 TimedOut）",
  fixedRounds: "固定 3 局：正在打最后一局",
};

export interface SceneOptions {
  /** 人数（只对 opening / selectSome / selectedMine / waitingOne / midRound / timeout 有效），默认 4。 */
  readonly players?: number;
  readonly seed?: number;
}

function names(count: number): PlayerSpec[] {
  return Array.from({ length: count }, (_, index) => defaultPlayer(index));
}

/**
 * 规则书例 1 的局面：4 排 [10,13] [20,21,23,24,25] [40,44,48] [63]，摆在 4 人局第 3 手
 * （桌上 11 张 + 丁收过的 [6] = 4 + 4×2 张，和真实对局的张数对得上）。
 */
const EXAMPLE_ROWS = [[10, 13], [20, 21, 23, 24, 25], [40, 44, 48], [63]];
function exampleOne(firstCards: [number, number, number, number]): GameState {
  return buildGame({
    players: firstCards.map((card, index) => (index === 3 ? { include: [card], taken: [6] } : { include: [card] })),
    rows: EXAMPLE_ROWS,
    turn: 3,
  });
}

/**
 * 4 人局第 3 局（或指定局）第 10 手：每人剩 1 张（77 / 36 / 92 / 3），收牌堆各有若干张，桌上一共 40 张。
 * 丁的 3 比所有排尾都小（规则 C）。totals 是之前各局的累计。
 */
function lateRound(totals: [number, number, number, number], round: number): GameState {
  return buildGame({
    players: [
      { hand: [77], total: totals[0], taken: [5, 15, 1, 2, 4, 6, 7] },
      { hand: [36], total: totals[1], taken: [8, 9, 12, 13] },
      { hand: [92], total: totals[2], taken: [44, 45, 46, 47, 49, 16, 17, 19, 21, 23] },
      { hand: [3], total: totals[3], taken: [60, 24, 27, 28, 31] },
    ],
    rows: [[18, 22, 26, 29], [33, 34], [51, 52, 53, 56, 58], [70, 72, 74]],
    round,
  });
}

/** 按名字造局面（完整的服务端状态；给界面前用 redactGameForViewer(state, "p1")，或者用 createSceneRoom）。 */
export function createScene(name: SceneName, opts: SceneOptions = {}): GameState {
  const count = opts.players ?? 4;
  const seed = opts.seed ?? 20261009;
  const opening = () => createGame(names(count).map((player) => ({ id: player.id!, name: player.name! })), seed);
  const select = (state: GameState, ids: string[]) => {
    let current = state;
    for (const id of ids) current = applyCommand(current, id, baselineCommand(redactGameForViewer(current, id), id)!);
    return current;
  };
  switch (name) {
    case "opening":
      return opening();
    case "selectSome":
      // 我（p1）没选；p2 起选好一部分（2 人局就是对手已选）
      return select(opening(), names(count).slice(1, Math.max(2, count - 1)).map((player) => player.id!));
    case "selectedMine":
      return select(opening(), ["p1", "p3"].filter((id) => Number(id.slice(1)) <= Math.max(1, count - 1)));
    case "waitingOne":
      return select(opening(), names(count).slice(0, -1).map((player) => player.id!));
    case "midRound": {
      // 打到第 5 手；还没人收过牌就再多打几手
      let state = autoPlayHands(opening(), 4);
      while (state.phase === "select" && state.turn < 8 && state.players.every((player) => player.taken.length === 0)) state = autoPlayHands(state, 1);
      return state;
    }
    case "reveal":
      // 14 接第 1 排；30 放进已满的第 2 排 → 阿牛收 8 分；50 接第 3 排；64 接第 4 排
      return playHand(exampleOne([50, 30, 14, 64]), { p1: 50, p2: 30, p3: 14, p4: 64 });
    case "chooseRow":
      return playHand(exampleOne([4, 7, 30, 50]), { p1: 4, p2: 7, p3: 30, p4: 50 });
    case "chooseRowOther":
      return playHand(exampleOne([7, 4, 30, 50]), { p1: 7, p2: 4, p3: 30, p4: 50 });
    case "afterChooseRow":
      return chooseRowFor(createScene("chooseRow"), 3);
    case "doubleSixth":
      // 第 2 排已满：26 先放成第六张（我收 8 分），27 再接到 26 后面
      return playHand(
        // 3 人局第 3 手：桌上 8 张 + 丙收过的 [2, 3] = 4 + 3×2 张
        buildGame({ players: [{ include: [26] }, { include: [27] }, { include: [41], taken: [2, 3] }], rows: [[10], [20, 21, 23, 24, 25], [40], [63]], turn: 3 }),
        { p1: 26, p2: 27, p3: 41 },
      );
    case "lastHand":
      return lateRound([21, 9, 30, 14], 3);
    case "roundEnd":
      // 丁出 3 收第 2 排 [33,34]；本局 9 / 4 / 15 / 13 → 累计 30 / 13 / 45 / 27，没人到 66
      return playHand(lateRound([21, 9, 30, 14], 3), { p1: 77, p2: 36, p3: 92, p4: 3 }, 1);
    case "gameOver":
      // 累计 40 / 52 / 58 / 33 → 49 / 56 / 73 / 46：丙过 66，丁一人获胜
      return playHand(lateRound([40, 52, 58, 33], 6), { p1: 77, p2: 36, p3: 92, p4: 3 }, 1);
    case "gameOverTie":
      // 累计 30 / 35 / 58 / 61 → 39 / 39 / 73 / 74：我和阿牛并列获胜
      return playHand(lateRound([30, 35, 58, 61], 6), { p1: 77, p2: 36, p3: 92, p4: 3 }, 1);
    case "tenPlayers":
      return select(createGame(names(10).map((player) => ({ id: player.id!, name: player.name! })), seed), ["p2", "p4", "p5", "p7", "p9"]);
    case "tenPlayersReveal":
      return autoPlayHands(createGame(names(10).map((player) => ({ id: player.id!, name: player.name! })), seed), 3);
    case "tactics":
      return createGame(names(3).map((player) => ({ id: player.id!, name: player.name! })), seed, { tactics: true });
    case "timeout":
      return timeoutTurn(select(opening(), ["p2"]));
    case "fixedRounds": {
      const base = buildGame({
        players: [{ total: 12 }, { total: 25 }, { total: 9 }, { total: 17 }],
        options: { fixedRounds: 3 },
        round: 3,
        seed,
      });
      return autoPlayHands(base, 3);
    }
  }
}


export interface SceneRoomOptions {
  /** 从哪个座位看（默认 p1）；spectator 为 true 时忽略。 */
  readonly viewer?: string;
  /** 观战视角。 */
  readonly spectator?: boolean;
  /** 观战看手牌（上帝视角）。 */
  readonly seeAll?: boolean;
  /** 这些座位离线。 */
  readonly offline?: readonly string[];
  /** 这些座位是人机（咕噜一号…）。 */
  readonly bots?: readonly string[];
  /** 这些座位在托管中。 */
  readonly auto?: readonly string[];
  /** 倒计时剩余毫秒（默认 phase 的满时限；gameOver 时没有）。 */
  readonly turnRemainingMs?: number;
}

const BOT_NAMES = ["咕噜一号", "咕噜二号", "咕噜三号", "咕噜四号", "咕噜五号", "咕噜六号", "咕噜七号", "咕噜八号", "咕噜九号"];

/**
 * 包成网页收到的房间快照（status = playing）。成员的连接 id 是 `sock-<座位 id>`，
 * 预览页用 Object.defineProperty(socket, "id", { get: () => "sock-p1" }) 冒充 p1。
 * 对局结束（gameOver）时带上「再来一局」投票。
 */
export function createSceneRoom(game: GameState, opts: SceneRoomOptions = {}): LobbyRoomSnapshot {
  const viewer = opts.viewer ?? "p1";
  let botIndex = 0;
  const members: LobbyMember[] = game.players.map((player, index) => {
    const bot = opts.bots?.includes(player.id) === true;
    return {
      id: `sock-${player.id}`,
      playerId: player.id,
      name: bot ? BOT_NAMES[botIndex++] ?? player.name : player.name,
      isHost: index === 0,
      connected: !(opts.offline?.includes(player.id) ?? false),
      ...(bot ? { bot: true } : {}),
      ...(opts.auto?.includes(player.id) ? { auto: true } : {}),
    };
  });
  const config = game.config;
  const fullMs = game.phase === "select" ? config.selectTimeoutSec * 1000
    : game.phase === "chooseRow" ? config.chooseRowTimeoutSec * 1000
    : config.roundEndSec * 1000;
  const view = opts.spectator ? redactGameForSpectator(game, opts.seeAll === true) : redactGameForViewer(game, viewer);
  return {
    code: opts.spectator ? "" : "NTW688",
    spectators: opts.spectator ? [{ id: "sock-watcher", name: "看客" }] : [],
    access: { ...DEFAULT_ROOM_ACCESS, ...(opts.seeAll ? { spectatorsSeeAll: true } : {}) },
    options: { target: config.target, fixedRounds: config.fixedRounds, tactics: config.tactics },
    capacity: Math.max(2, game.players.length) as Capacity,
    status: "playing",
    members,
    chat: [],
    voice: [],
    game: view,
    ...(game.phase !== "gameOver" ? { turnRemainingMs: opts.turnRemainingMs ?? fullMs } : {}),
    ...(game.phase === "gameOver"
      ? { rematch: { remainingMs: 60_000, acceptedIds: members.filter((member) => member.bot).map((member) => member.id) } }
      : {}),
  };
}
