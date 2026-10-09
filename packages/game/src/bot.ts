import { cardsInPlay, ROW_LIMIT, bullheads, sumBulls } from "./cards.js";
import type { GameCommand, GameState } from "./types.js";

/**
 * 谁是牛头王的人机（「普通」难度，补充文件第一节）。
 *
 * 输入只能是这个座位视角（redactGameForViewer 之后）的状态：别人的手牌和没亮的选牌它看不到。
 * 记牌只用公开信息：本局亮过的牌 seenCards（4 排 + 收牌堆里的牌都在里面）、自己的手牌。
 *
 * 思路（大白话）：
 * - 选牌：把「没见过的牌」随机分给对手，凑够他们的手牌张数（战术模式 / 10 人局正好分完，等于精确记牌），
 *   对手按「简单基线，四分之一概率乱出」出牌；对手里的每张候选牌，把这一手结算完，再让所有人按基线把这一局剩下的几手打完，
 *   看自己这一局一共收多少牛头。抽几十个「可能的世界」取平均，挑平均罚分最少的那张。
 *   同一个世界给每张候选牌共用（公平比较）；分差不到 0.3 分的几张里随机挑一张，不让人摸透。
 * - 规则 C 选排：这一手所有牌都亮出来了，剩下没结算的牌是公开的，所以对 4 排各算一次「我收多少、结算后局面怎样」，
 *   后面几手同样用抽样把局打完来比，收得少、后面好打的那排优先；再一样就让领先的对手多收、收排尾最大的、排号小的。
 * - 2 人局是零和：目标是「我收的 − 对手收的」最小。
 * - 局末「继续」直接点。
 *
 * 每一步都给一句理由（botDecision / botHint），教程的「提示」按钮用。
 */

export interface BotOptions {
  /** 每步的模拟预算（「玩家 × 手」的次数），决定抽几个世界；越大越准越慢。 */
  readonly budget: number;
  /** 抽样世界数的上下限。 */
  readonly minWorlds: number;
  readonly maxWorlds: number;
  /** 对手模型：这个概率乱出一张，其余按简单基线。 */
  readonly oppRandom: number;
  /** 多人局：让累计最少的对手多收几分算多少好处（0 = 只管自己）。 */
  readonly leaderWeight: number;
  /** 平均罚分差不到这么多的候选里随机挑一张。 */
  readonly tie: number;
  /** 往后模拟几手（含这一手）；Infinity = 打完这一局。 */
  readonly depth: number;
  /** 推演里自己以后几手怎么出：baseline = 简单基线；quick = 快速打法（见 quickPick）。 */
  readonly selfPolicy: "baseline" | "quick";
  /** 推演里对手以后几手怎么出（不乱出的时候）。 */
  readonly oppPolicy: "baseline" | "quick";
  /** 这一手对手怎么出（不乱出的时候）。 */
  readonly oppFirst: "baseline" | "quick";
  /** 快速打法里「先出大牌」的分量。 */
  readonly urgency: number;
}

export const DEFAULT_BOT_OPTIONS: BotOptions = {
  budget: 60_000,
  minWorlds: 24,
  maxWorlds: 160,
  oppRandom: 0.25,
  leaderWeight: 0,
  tie: 0.3,
  depth: Infinity,
  selfPolicy: "baseline",
  oppPolicy: "baseline",
  oppFirst: "baseline",
  urgency: 0.3,
};

/** 人机的一个决定：动作 + 一句玩家听得懂的理由；detail 给测试和调试看。 */
export interface BotDecision {
  readonly command: GameCommand;
  readonly reason: string;
  readonly detail?: {
    /** 每个候选（选牌：牌；选排：排号 0–3）的评分（越小越好，大约是「这一局我预计还要收的牛头」）。 */
    readonly scores: Record<number, number>;
    /** 抽了几个世界。 */
    readonly worlds: number;
  };
}

// ---------- 小工具 ----------

/** 可复现的随机数（mulberry32），种子由局面决定：同一局面同一决定，测试可复现；不同局面各不一样。 */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashState(view: GameState, playerId: string, hand: readonly number[]): number {
  let h = 2166136261;
  const mix = (n: number) => {
    h ^= n & 0xffff;
    h = Math.imul(h, 16777619);
    h ^= n >>> 16;
    h = Math.imul(h, 16777619);
  };
  mix(view.round);
  mix(view.turn);
  mix(view.revealCount);
  for (let i = 0; i < playerId.length; i += 1) mix(playerId.charCodeAt(i));
  for (const card of hand) mix(card);
  for (const row of view.rows) for (const card of row) mix(card + 200);
  return h >>> 0;
}

const rowNo = (row: number) => `第 ${row + 1} 排`;
const tailOf = (row: readonly number[]) => row[row.length - 1]!;

/** 规则 A：返回排号，没有返回 -1。 */
function target(rows: readonly (readonly number[])[], card: number): number {
  let best = -1;
  let bestTail = -1;
  for (let i = 0; i < rows.length; i += 1) {
    const tail = rows[i]![rows[i]!.length - 1]!;
    if (tail < card && tail > bestTail) {
      bestTail = tail;
      best = i;
    }
  }
  return best;
}

/** 简单基线选牌（补充文件 1.7），和 baseline.ts 同一个规则，这里为了快不分配数组。 */
function baselinePick(hand: readonly number[], rows: readonly (readonly number[])[]): number {
  let best = -1;
  let bestGap = Infinity;
  let min = Infinity;
  for (const card of hand) {
    if (card < min) min = card;
    const row = target(rows, card);
    if (row < 0 || rows[row]!.length >= ROW_LIMIT) continue;
    const gap = card - tailOf(rows[row]!);
    if (gap < bestGap || (gap === bestGap && card < best)) {
      bestGap = gap;
      best = card;
    }
  }
  return best >= 0 ? best : min;
}

/**
 * 推演里用的「快速打法」（比基线聪明一点，算得很快）：每张牌估一个这一手的风险——
 * 规则 C 就是最便宜那排的牛头 + 1；满排就是那排的牛头；否则按「别人的牌落进缺口的张数 ≈ 泊松分布」估正好凑满第六张的概率 × 那排牛头；
 * 风险差不多时先出大的（大牌越晚越难出）。m = 一起出牌的对手数，q ≈ 每张没见过的牌被某个对手这一手打出来的概率。
 */
function quickPick(hand: readonly number[], rows: readonly (readonly number[])[], bulls: readonly number[], m: number, q: number, urgency: number): number {
  let minBulls = Infinity;
  for (const b of bulls) if (b < minBulls) minBulls = b;
  let best = hand[0]!;
  let bestCost = Infinity;
  for (const card of hand) {
    const row = target(rows, card);
    let cost: number;
    if (row < 0) cost = minBulls + 1;
    else {
      const length = rows[row]!.length;
      const space = ROW_LIMIT - length;
      if (space === 0) cost = bulls[row]!;
      else {
        const tail = rows[row]![length - 1]!;
        let gap = card - tail - 1;
        for (const other of hand) if (other > tail && other < card) gap -= 1;
        const mu = m * Math.min(1, gap * q);
        // 泊松：P(N = space)
        let pk = Math.exp(-mu);
        for (let k = 1; k <= space; k += 1) pk *= mu / k;
        cost = pk * (bulls[row]! + 1);
      }
    }
    cost -= (urgency * card) / 104;
    if (cost < bestCost) {
      bestCost = cost;
      best = card;
    }
  }
  return best;
}

/** 基线选排：牛头最少 → 排尾最大 → 排号最小。 */
function baselineRowFast(rows: readonly (readonly number[])[], bulls: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < rows.length; i += 1) {
    if (bulls[i]! < bulls[best]! || (bulls[i] === bulls[best] && tailOf(rows[i]!) > tailOf(rows[best]!))) best = i;
  }
  return best;
}

/**
 * 把一手牌（已按数字从小到大排好）结算到 rows 上（原地改），收的牛头加进 pen。
 * 规则 C 一律按基线选排（模拟里的对手和自己都这样）。
 */
function resolveInPlace(rows: number[][], bulls: number[], cards: readonly number[], owners: readonly number[], pen: number[]): void {
  for (let k = 0; k < cards.length; k += 1) {
    const card = cards[k]!;
    const owner = owners[k]!;
    let row = target(rows, card);
    if (row < 0) {
      row = baselineRowFast(rows, bulls);
      pen[owner]! += bulls[row]!;
      rows[row] = [card];
      bulls[row] = bullheads(card);
    } else if (rows[row]!.length >= ROW_LIMIT) {
      pen[owner]! += bulls[row]!;
      rows[row] = [card];
      bulls[row] = bullheads(card);
    } else {
      rows[row]!.push(card);
      bulls[row]! += bullheads(card);
    }
  }
}

/** 一手牌：每人一张，按数字排序后的 cards / owners。 */
function sortHand(cards: number[], owners: number[]): void {
  // 插入排序（最多 10 张）
  for (let i = 1; i < cards.length; i += 1) {
    const c = cards[i]!;
    const o = owners[i]!;
    let j = i - 1;
    while (j >= 0 && cards[j]! > c) {
      cards[j + 1] = cards[j]!;
      owners[j + 1] = owners[j]!;
      j -= 1;
    }
    cards[j + 1] = c;
    owners[j + 1] = o;
  }
}

// ---------- 局面整理 ----------

interface Context {
  readonly view: GameState;
  readonly n: number;
  /** 我在 players 里的下标。 */
  readonly me: number;
  readonly hand: number[];
  /** 每个对手（按 players 下标）还剩几张手牌；我的位置是 0。 */
  readonly oppCounts: number[];
  /** 我看不到的、这一局用到的牌（对手手里的 + 没发的）。 */
  readonly unknown: number[];
  /** 这一局还剩几手（含这一手）。 */
  readonly handsLeft: number;
  /** 2 人局对手下标；多人局累计罚分最少的对手下标（领先者）。 */
  readonly rival: number;
  readonly zeroSum: boolean;
  /** 快速打法用：某张没见过的牌这一手被某个对手打出的概率（≈ 1 / 没见过的牌数）。 */
  readonly q: number;
  readonly rng: () => number;
  readonly opts: BotOptions;
}

function makeContext(view: GameState, playerId: string, opts: BotOptions): Context | null {
  const me = view.players.findIndex((player) => player.id === playerId);
  if (me < 0) return null;
  const player = view.players[me]!;
  const hand = [...player.hand].sort((a, b) => a - b);
  const known = new Set<number>([...view.seenCards, ...hand]);
  for (const row of view.rows) for (const card of row) known.add(card);
  for (const other of view.players) for (const card of other.taken) known.add(card);
  const unknown = cardsInPlay(view.players.length, view.config.tactics).filter((card) => !known.has(card));
  const oppCounts = view.players.map((other, index) => (index === me ? 0 : other.handCount));
  // 选牌 / 选排时 total 只含打完的局，加上本局已收的才是现在的累计
  const standing = (index: number) => view.players[index]!.total + view.players[index]!.roundBulls;
  let rival = -1;
  view.players.forEach((_, index) => {
    if (index !== me && (rival < 0 || standing(index) < standing(rival))) rival = index;
  });
  return {
    view,
    n: view.players.length,
    me,
    hand,
    oppCounts,
    unknown,
    handsLeft: hand.length,
    rival,
    zeroSum: view.players.length === 2,
    q: 1 / Math.max(1, unknown.length),
    rng: makeRng(hashState(view, playerId, hand)),
    opts,
  };
}

/** 一个「可能的世界」：每个对手的手牌（从没见过的牌里随机分），外加以后每手每人用的随机数（共用给所有候选，比较才公平）。 */
interface World {
  readonly hands: number[][];
  /** noise[t][p]：第 t 手第 p 个人「乱出」用的随机数。 */
  readonly noise: number[][];
}

function sampleWorld(ctx: Context): World {
  const pool = [...ctx.unknown];
  const need = ctx.oppCounts.reduce((sum, count) => sum + count, 0);
  // 部分洗牌：只洗出要用的前 need 张
  for (let i = 0; i < need && i < pool.length; i += 1) {
    const j = i + Math.floor(ctx.rng() * (pool.length - i));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  const hands: number[][] = [];
  let cursor = 0;
  for (let p = 0; p < ctx.n; p += 1) {
    const count = ctx.oppCounts[p]!;
    hands.push(pool.slice(cursor, cursor + count));
    cursor += count;
  }
  const noise: number[][] = [];
  for (let t = 0; t < ctx.handsLeft + 1; t += 1) {
    const row: number[] = [];
    for (let p = 0; p < ctx.n; p += 1) row.push(ctx.rng());
    noise.push(row);
  }
  return { hands, noise };
}

/** 对手模型：noise < oppRandom 时乱出一张，否则按基线。 */
function modelPick(hand: readonly number[], rows: readonly (readonly number[])[], noise: number, oppRandom: number): number {
  if (noise < oppRandom) return hand[Math.floor((noise / oppRandom) * hand.length)]!;
  return baselinePick(hand, rows);
}

/** 我要最小化的数：自己收的牛头；2 人局减去对手收的；多人局可以减去一点领先者收的。 */
function objective(ctx: Context, pen: readonly number[]): number {
  let value = pen[ctx.me]!;
  if (ctx.rival >= 0) value -= (ctx.zeroSum ? 1 : ctx.opts.leaderWeight) * pen[ctx.rival]!;
  return value;
}

/**
 * 从「这一手已经结算完」的局面（rows、各人剩下的手牌）起，所有人按模型把这一局剩下的手打完（我也按基线），pen 原地累加。
 * firstTurn：noise 表里从第几行开始用。
 */
function rollout(ctx: Context, world: World, rows: number[][], bulls: number[], hands: number[][], pen: number[], firstTurn: number, depthLeft: number): void {
  const cards: number[] = [];
  const owners: number[] = [];
  for (let t = firstTurn; depthLeft > 0 && hands[ctx.me]!.length > 0; t += 1, depthLeft -= 1) {
    cards.length = 0;
    owners.length = 0;
    const noise = world.noise[Math.min(t, world.noise.length - 1)]!;
    for (let p = 0; p < ctx.n; p += 1) {
      const hand = hands[p]!;
      if (hand.length === 0) continue;
      let card: number;
      if (p === ctx.me) card = ctx.opts.selfPolicy === "quick" ? quickPick(hand, rows, bulls, ctx.n - 1, ctx.q, ctx.opts.urgency) : baselinePick(hand, rows);
      else if (ctx.opts.oppPolicy === "quick" && noise[p]! >= ctx.opts.oppRandom) card = quickPick(hand, rows, bulls, ctx.n - 1, ctx.q, ctx.opts.urgency);
      else card = modelPick(hand, rows, noise[p]!, ctx.opts.oppRandom);
      hand.splice(hand.indexOf(card), 1);
      cards.push(card);
      owners.push(p);
    }
    if (cards.length === 0) break;
    sortHand(cards, owners);
    resolveInPlace(rows, bulls, cards, owners, pen);
  }
}

function worldCount(ctx: Context, candidates: number): number {
  const perWorld = Math.max(1, candidates * Math.min(ctx.handsLeft, ctx.opts.depth) * ctx.n);
  return Math.max(ctx.opts.minWorlds, Math.min(ctx.opts.maxWorlds, Math.round(ctx.opts.budget / perWorld)));
}

// ---------- 选牌 ----------

interface CardStats {
  card: number;
  score: number;
  /** 这一手我收牌的概率、平均收几个牛头。 */
  takeProb: number;
  takeBulls: number;
}

function evaluateCards(ctx: Context): { stats: CardStats[]; worlds: number } {
  const rows0 = ctx.view.rows;
  const bulls0 = rows0.map((row) => sumBulls(row));
  const worlds = worldCount(ctx, ctx.hand.length);
  const stats: CardStats[] = ctx.hand.map((card) => ({ card, score: 0, takeProb: 0, takeBulls: 0 }));
  const pen: number[] = new Array(ctx.n).fill(0);
  for (let w = 0; w < worlds; w += 1) {
    const world = sampleWorld(ctx);
    // 对手这一手出什么只取决于他们的手牌和现在的 4 排，和我出什么无关：每个世界算一次
    const oppCards: number[] = [];
    const oppOwners: number[] = [];
    for (let p = 0; p < ctx.n; p += 1) {
      if (p === ctx.me) continue;
      const noise = world.noise[0]![p]!;
      oppCards.push(
        ctx.opts.oppFirst === "quick" && noise >= ctx.opts.oppRandom
          ? quickPick(world.hands[p]!, rows0, bulls0, ctx.n - 1, ctx.q, ctx.opts.urgency)
          : modelPick(world.hands[p]!, rows0, noise, ctx.opts.oppRandom),
      );
      oppOwners.push(p);
    }
    const afterHands = world.hands.map((hand) => hand.filter((card) => !oppCards.includes(card)));
    for (const stat of stats) {
      const rows = rows0.map((row) => [...row]);
      const bulls = [...bulls0];
      const hands = afterHands.map((hand, p) => (p === ctx.me ? ctx.hand.filter((card) => card !== stat.card) : [...hand]));
      const cards = [...oppCards, stat.card];
      const owners = [...oppOwners, ctx.me];
      sortHand(cards, owners);
      pen.fill(0);
      resolveInPlace(rows, bulls, cards, owners, pen);
      if (pen[ctx.me]! > 0) {
        stat.takeProb += 1;
        stat.takeBulls += pen[ctx.me]!;
      }
      rollout(ctx, world, rows, bulls, hands, pen, 1, ctx.opts.depth - 1);
      stat.score += objective(ctx, pen);
    }
  }
  for (const stat of stats) {
    stat.score /= worlds;
    stat.takeProb /= worlds;
    stat.takeBulls /= worlds;
  }
  return { stats, worlds };
}

/** 缺口里还可能被别人出的牌有几张（补充文件 1.2 的 g）。 */
function gapUnknown(ctx: Context, row: number, card: number): number {
  const tail = tailOf(ctx.view.rows[row]!);
  let g = 0;
  for (const x of ctx.unknown) if (x > tail && x < card) g += 1;
  return g;
}

function selectReason(ctx: Context, chosen: CardStats, all: CardStats[]): string {
  const rows = ctx.view.rows;
  const card = chosen.card;
  const row = target(rows, card);
  const opponents = ctx.n - 1;
  if (row < 0) {
    const bulls = rows.map((r) => sumBulls(r));
    const cheapest = baselineRowFast(rows, bulls);
    const safeExists = all.some((stat) => stat.card !== card && stat.takeProb === 0);
    if (safeExists) return `${card} 比所有排尾都小，可以自己挑一排收：${rowNo(cheapest)}只有 ${bulls[cheapest]} 个牛头，趁便宜收掉，换个干净的排头。`;
    return `没有安全的牌，用 ${card} 主动收掉只有 ${bulls[cheapest]} 个牛头的${rowNo(cheapest)}，好过冒险去吃大排。`;
  }
  const target_ = rows[row]!;
  const tail = tailOf(target_);
  const space = ROW_LIMIT - target_.length;
  if (space === 0) {
    return `每张牌都不好出：${card} 要接的${rowNo(row)}已经 5 张，大概要收 ${sumBulls(target_)} 个牛头，但别的牌预计更糟。`;
  }
  const g = gapUnknown(ctx, row, card);
  const lowRisk = Math.min(...rows.map((r) => tailOf(r))) >= 30 && chosen.takeProb > 0;
  if (chosen.takeProb === 0 || g < space || opponents < space) {
    if (card >= 80) return `${card} 现在接在${rowNo(row)}（排尾 ${tail}）后面很安全，大牌越晚越难出，趁现在打掉。`;
    if (g === 0) return `${card} 紧接在${rowNo(row)}的 ${tail} 后面，中间没有别人能出的牌，安全。`;
    if (g < space || opponents < space) return `${card} 接在${rowNo(row)}后面，那排才 ${target_.length} 张，别人凑不满 6 张，安全。`;
    return `${card} 接在${rowNo(row)}（排尾 ${tail}）后面，这一手基本不会收牌。`;
  }
  const pct = Math.round(chosen.takeProb * 100);
  if (lowRisk && g === 0) {
    return `${card} 接在${rowNo(row)}后面，但排尾都偏高，有人可能用小牌先把那排收走，约 ${pct}% 会出事；手里别的牌更危险。`;
  }
  if (target_.length === 4) {
    return `${card} 接的${rowNo(row)}已经 4 张，再有人插进来就得收，约 ${pct}% 的机会；这已经是手里最稳的一张。`;
  }
  return `${card} 接在${rowNo(row)}（排尾 ${tail}）后面，约 ${pct}% 的机会收牌，是手里风险最小的一张。`;
}

function decideSelect(ctx: Context): BotDecision {
  if (ctx.hand.length === 1) {
    const card = ctx.hand[0]!;
    return { command: { type: "select", card }, reason: `只剩 ${card} 一张，只能出它。` };
  }
  const { stats, worlds } = evaluateCards(ctx);
  const best = Math.min(...stats.map((stat) => stat.score));
  const near = stats.filter((stat) => stat.score <= best + ctx.opts.tie);
  const chosen = near[Math.floor(ctx.rng() * near.length)]!;
  return {
    command: { type: "select", card: chosen.card },
    reason: selectReason(ctx, chosen, stats),
    detail: { scores: Object.fromEntries(stats.map((stat) => [stat.card, stat.score])), worlds },
  };
}

// ---------- 规则 C 选排 ----------

interface RowStats {
  row: number;
  /** 这次收的牛头。 */
  take: number;
  /** 收了这排、剩下的牌结算完后的 4 排。 */
  after: number[][];
  /** 这一手各人收的牛头（含我）。 */
  handPen: number[];
  score: number;
}

function decideChooseRow(ctx: Context): BotDecision {
  const view = ctx.view;
  const reveal = view.reveal!;
  const index = reveal.steps.length;
  const mine = reveal.plays[index]!;
  const rest = reveal.plays.slice(index + 1);
  const ownerIndex = new Map(view.players.map((player, i) => [player.id, i]));
  const rows0 = view.rows;
  const options: RowStats[] = rows0.map((_, row) => {
    const rows = rows0.map((cards) => [...cards]);
    const bulls = rows.map((cards) => sumBulls(cards));
    const handPen = new Array(ctx.n).fill(0);
    handPen[ctx.me] = bulls[row]!;
    rows[row] = [mine.card];
    bulls[row] = bullheads(mine.card);
    resolveInPlace(rows, bulls, rest.map((play) => play.card), rest.map((play) => ownerIndex.get(play.player)!), handPen);
    return { row, take: sumBulls(rows0[row]!), after: rows, handPen, score: 0 };
  });

  const worlds = ctx.hand.length > 0 ? worldCount(ctx, 4) : 0;
  const pen: number[] = new Array(ctx.n).fill(0);
  for (const option of options) option.score = 0;
  for (let w = 0; w < worlds; w += 1) {
    const world = sampleWorld(ctx);
    for (const option of options) {
      const rows = option.after.map((cards) => [...cards]);
      const bulls = rows.map((cards) => sumBulls(cards));
      const hands = world.hands.map((hand, p) => (p === ctx.me ? [...ctx.hand] : [...hand]));
      for (let p = 0; p < ctx.n; p += 1) pen[p] = option.handPen[p]!;
      rollout(ctx, world, rows, bulls, hands, pen, 0, ctx.opts.depth);
      option.score += objective(ctx, pen);
    }
  }
  for (const option of options) option.score = worlds > 0 ? option.score / worlds : objective(ctx, option.handPen);

  // 补充文件 1.5：收得少、后面好打优先；再一样（差不到 0.05）让领先者多收 → 排尾最大 → 排号最小
  const sorted = [...options].sort((a, b) => {
    if (Math.abs(a.score - b.score) > 0.05) return a.score - b.score;
    if (ctx.rival >= 0 && a.handPen[ctx.rival] !== b.handPen[ctx.rival]) return b.handPen[ctx.rival]! - a.handPen[ctx.rival]!;
    const tailA = tailOf(rows0[a.row]!);
    const tailB = tailOf(rows0[b.row]!);
    if (tailA !== tailB) return tailB - tailA;
    return a.row - b.row;
  });
  const chosen = sorted[0]!;
  return {
    command: { type: "chooseRow", row: chosen.row },
    reason: chooseRowReason(ctx, chosen, options),
    detail: { scores: Object.fromEntries(options.map((option) => [option.row, option.score])), worlds },
  };
}

/** 收 alt 这排以后，手里哪张牌会指向一排满 5 张的牌（而收 chosen 不会）。 */
function trappedCard(hand: readonly number[], chosenAfter: number[][], altAfter: number[][]): number | null {
  for (const card of [...hand].sort((a, b) => b - a)) {
    const altRow = target(altAfter, card);
    const chosenRow = target(chosenAfter, card);
    const altFull = altRow >= 0 && altAfter[altRow]!.length >= ROW_LIMIT;
    const chosenFull = chosenRow >= 0 && chosenAfter[chosenRow]!.length >= ROW_LIMIT;
    if (altFull && !chosenFull) return card;
  }
  return null;
}

function chooseRowReason(ctx: Context, chosen: RowStats, options: RowStats[]): string {
  const minTake = Math.min(...options.map((option) => option.take));
  const rivals = options.filter((option) => option.row !== chosen.row && option.take <= chosen.take);
  const head = `收${rowNo(chosen.row)}罚 ${chosen.take} 分`;
  if (rivals.length === 0) {
    return `${head}，是最少的。`;
  }
  // 有不比它贵的排却没选：说清楚为什么
  for (const alt of rivals) {
    const trapped = trappedCard(ctx.hand, chosen.after, alt.after);
    if (trapped !== null) {
      const same = alt.take === chosen.take ? "牛头一样" : `只要 ${alt.take} 分`;
      return `${rowNo(alt.row)}${same}，但收它以后手里的 ${trapped} 会指向一排已满 5 张的牌、下一手就得收，所以${head}。`;
    }
  }
  if (chosen.take > minTake) {
    return `${head}，比最便宜的多 ${chosen.take - minTake} 分，但结算完以后手里的牌好出得多。`;
  }
  const altNames = rivals.map((alt) => rowNo(alt.row)).join("、");
  const bigger = rivals.every((alt) => tailOf(ctx.view.rows[alt.row]!) < tailOf(ctx.view.rows[chosen.row]!));
  if (ctx.hand.length === 0 || (bigger && Math.abs(rivals[0]!.score - chosen.score) <= 0.05)) {
    return `${head}，和${altNames}一样少；收排尾最大的这排，留下的排尾更低，别人更难接。`;
  }
  return `${head}，和${altNames}一样少，但收这排以后剩下的手牌更好出。`;
}

// ---------- 入口 ----------

/** 这个座位眼里「看不到的牌」（对手手里的 + 没发的）：这一局用的牌去掉本局亮过的牌和自己的手牌。测试用。 */
export function botUnknownCards(view: GameState, playerId: string): number[] {
  return makeContext(view, playerId, DEFAULT_BOT_OPTIONS)?.unknown ?? [];
}

/**
 * 人机的决定和理由（教程「提示」按钮用）。view 必须是 redactGameForViewer(game, playerId) 之后的状态。
 * 没有要它做的事（已选好、不是它选排、已点继续、终局）返回 null。
 */
export function botDecision(view: GameState, playerId: string, options: Partial<BotOptions> = {}): BotDecision | null {
  const player = view.players.find((candidate) => candidate.id === playerId);
  if (!player) return null;
  const opts = { ...DEFAULT_BOT_OPTIONS, ...options };
  switch (view.phase) {
    case "select": {
      if (player.selected || player.hand.length === 0) return null;
      const ctx = makeContext(view, playerId, opts)!;
      return decideSelect(ctx);
    }
    case "chooseRow": {
      if (view.chooser !== playerId || !view.reveal) return null;
      const ctx = makeContext(view, playerId, opts)!;
      return decideChooseRow(ctx);
    }
    case "roundEnd":
      return player.ready ? null : { command: { type: "nextRound" }, reason: "这一局打完了，点继续开下一局。" };
    case "gameOver":
      return null;
  }
}

/** 教程「提示」按钮：和 botDecision 一样（给「我」这个座位的建议 + 理由）。 */
export const botHint = botDecision;

/** 服务器用：人机（含托管、离线代打）这一步做什么。view 是 redactGameForViewer(game, playerId) 之后的状态。 */
export function botCommand(view: GameState, playerId: string, options: Partial<BotOptions> = {}): GameCommand | null {
  return botDecision(view, playerId, options)?.command ?? null;
}
