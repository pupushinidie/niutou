/**
 * 人机强度模拟：npx tsx scripts/sim-niutou.ts [局数=300] [人数列表=2,3,4,5,6,8,10] [对手=baseline,random] [tactics]
 * 每种人数：1 个人机 vs (人数−1) 个对手，人机轮流坐各个座位；同时跑「1 个基线 vs 基线」做对照（公平值）。
 * 报：人机胜率（并列按人数平分）、公平值、人机/对手平均每局（10 手）罚分、平均名次、决策耗时。
 * 只用 redact 之后的视角做决定。
 */
import {
  applyCommand,
  baselineCommand,
  createGame,
  legalActions,
  redactGameForViewer,
  sameCommand,
  timeoutTurn,
  waitingFor,
  type GameCommand,
  type GameState,
} from "../packages/game/src/index.js";
import { botCommand, type BotOptions } from "../packages/game/src/bot.js";

type Policy = (view: GameState, id: string) => GameCommand | null;

const timing = { count: 0, total: 0, max: 0, over50: 0 };
function timed(policy: Policy): Policy {
  return (view, id) => {
    const t0 = performance.now();
    const command = policy(view, id);
    const ms = performance.now() - t0;
    timing.count += 1;
    timing.total += ms;
    if (ms > timing.max) timing.max = ms;
    if (ms > 50) timing.over50 += 1;
    return command;
  };
}

let randSeed = 12345;
function rand(): number {
  randSeed = (randSeed * 1103515245 + 12345) >>> 0;
  return randSeed / 4294967296;
}
const random: Policy = (view, id) => {
  const actions = legalActions(view, id).filter((action) => action.type !== "unselect");
  return actions.length ? actions[Math.floor(rand() * actions.length)]! : null;
};
const baseline: Policy = baselineCommand;
const bot = (opts: Partial<BotOptions> = {}): Policy => timed((view, id) => botCommand(view, id, opts));

const MAX_STEPS = 5000;
function play(policies: Policy[], seed: number, tactics: boolean) {
  const players = policies.map((_, index) => ({ id: `p${index}`, name: `p${index}` }));
  let state = createGame(players, seed, { tactics });
  let steps = 0;
  const roundPen = new Array(policies.length).fill(0);
  while (state.phase !== "gameOver") {
    if (++steps > MAX_STEPS) throw new Error(`超过 ${MAX_STEPS} 步，可能死循环`);
    if (state.phase === "roundEnd") {
      state = timeoutTurn(state);
      continue;
    }
    const id = waitingFor(state)[0]!;
    const index = Number(id.slice(1));
    const command = policies[index]!(redactGameForViewer(state, id), id);
    if (!command || !legalActions(state, id).some((action) => sameCommand(action, command))) {
      throw new Error(`不合法：${id} ${JSON.stringify(command)}`);
    }
    state = applyCommand(state, id, command);
  }
  for (const round of state.history) for (const [id, bulls] of Object.entries(round.bulls)) roundPen[Number(id.slice(1))] += bulls;
  const totals = state.players.map((player) => player.total);
  const winners = state.finalResult!.winners.map((id) => Number(id.slice(1)));
  return { totals, winners, rounds: state.round, roundPen };
}

function match(label: string, hero: Policy, villain: Policy, n: number, games: number, tactics: boolean) {
  let win = 0;
  let heroPen = 0;
  let villPen = 0;
  let rounds = 0;
  let rank = 0;
  for (let g = 0; g < games; g += 1) {
    const seat = g % n;
    const policies = Array.from({ length: n }, (_, index) => (index === seat ? hero : villain));
    const result = play(policies, 7000 + g * 31 + n, tactics);
    if (result.winners.includes(seat)) win += 1 / result.winners.length;
    rounds += result.rounds;
    heroPen += result.roundPen[seat]!;
    for (let p = 0; p < n; p += 1) if (p !== seat) villPen += result.roundPen[p]! / (n - 1);
    const mine = result.totals[seat]!;
    rank += 1 + result.totals.filter((total) => total < mine).length + (result.totals.filter((total) => total === mine).length - 1) / 2;
  }
  const r = (x: number) => x.toFixed(1);
  console.log(
    `${label.padEnd(26)} ${n}人 ${games}局: 胜率 ${r((100 * win) / games)}%（公平 ${r(100 / n)}%） 每局罚分 ${r(heroPen / rounds)} vs ${r(villPen / rounds)}  平均名次 ${(rank / games).toFixed(2)}（公平 ${((n + 1) / 2).toFixed(1)}）  平均 ${r(rounds / games)} 局`,
  );
}

const games = Number(process.argv[2] ?? 300);
const counts = (process.argv[3] ?? "2,3,4,5,6,8,10").split(",").map(Number);
const villains = (process.argv[4] ?? "baseline,random").split(",");
const tactics = process.argv[5] === "tactics";
const optsJson = process.env.BOT_OPTS ? (JSON.parse(process.env.BOT_OPTS) as Partial<BotOptions>) : {};
const hero = bot(optsJson);
const villainBot: Policy = (view, id) => botCommand(view, id, process.env.VILLAIN_OPTS ? JSON.parse(process.env.VILLAIN_OPTS) : {});
for (const n of counts) {
  for (const villainName of villains) {
    const villain = villainName === "random" ? random : villainName === "bot" ? villainBot : baseline;
    match(`人机 vs ${villainName}${tactics ? "（战术）" : ""}`, hero, villain, n, games, tactics);
  }
  if (process.env.CONTROL) match(`基线 vs baseline（对照）`, baseline, baseline, n, games, tactics);
}
console.log(`决策耗时：${timing.count} 次，平均 ${(timing.total / timing.count).toFixed(2)}ms，最慢 ${timing.max.toFixed(1)}ms，超过 50ms 的 ${timing.over50} 次`);
