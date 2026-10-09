/**
 * 人机自对弈：npx tsx scripts/selfplay-niutou.ts <人数> [局数=300]
 * 所有座位都是人机（只吃 redact 后的视角），打到终局；每一步都检查：动作合法、不撤回、有理由、局面不卡；
 * 一局超过 MAX_STEPS 步就报错（防死循环）。开房选项轮流用：默认 / 战术 / 目标 33 / 固定 2 局。
 * 报：每步决策耗时（平均、99 分位、最慢）、每局步数、超时次数。
 */
import {
  applyCommand,
  createGame,
  legalActions,
  redactGameForViewer,
  sameCommand,
  waitingFor,
  type GameOptions,
} from "../packages/game/src/index.js";
import { botDecision } from "../packages/game/src/bot.js";

const n = Number(process.argv[2] ?? 4);
const games = Number(process.argv[3] ?? 300);
const MAX_STEPS = 3000;
const variants: Partial<GameOptions>[] = [{}, { tactics: true }, { target: 33 }, { fixedRounds: 2 }];
const times: number[] = [];
const phaseMax: Record<string, number> = {};
let maxSteps = 0;
let totalSteps = 0;
let rounds = 0;
const t0 = Date.now();
for (let g = 0; g < games; g += 1) {
  const players = Array.from({ length: n }, (_, index) => ({ id: `p${index + 1}`, name: `咕噜${index + 1}` }));
  let state = createGame(players, 90_000 + n * 1000 + g, variants[g % variants.length]!);
  let steps = 0;
  while (state.phase !== "gameOver") {
    steps += 1;
    if (steps > MAX_STEPS) throw new Error(`${n} 人第 ${g} 局超过 ${MAX_STEPS} 步，可能死循环`);
    const waiting = waitingFor(state);
    if (waiting.length === 0) throw new Error("没人要做决定却没结束：卡住了");
    const id = waiting[Math.floor((steps * 7919) % waiting.length)]!;
    const view = redactGameForViewer(state, id);
    const start = performance.now();
    const decision = botDecision(view, id);
    const ms = performance.now() - start;
    times.push(ms);
    phaseMax[state.phase] = Math.max(phaseMax[state.phase] ?? 0, ms);
    if (!decision) throw new Error(`${id} 该做决定却返回 null（${state.phase}）`);
    if (!decision.reason) throw new Error("没有理由");
    const command = decision.command;
    if (command.type === "unselect" || !legalActions(state, id).some((action) => sameCommand(action, command))) {
      throw new Error(`不合法：${id} ${JSON.stringify(command)} @ ${state.phase}`);
    }
    state = applyCommand(state, id, command);
  }
  maxSteps = Math.max(maxSteps, steps);
  totalSteps += steps;
  rounds += state.round;
}
times.sort((a, b) => a - b);
const avg = times.reduce((sum, ms) => sum + ms, 0) / times.length;
const p99 = times[Math.floor(times.length * 0.99)]!;
const max = times[times.length - 1]!;
console.log(
  `${n} 人 ${games} 局全合法：共 ${times.length} 步决策，平均每局 ${(rounds / games).toFixed(1)} 局牌、${Math.round(totalSteps / games)} 步，最多 ${maxSteps} 步（上限 ${MAX_STEPS}）；` +
    `耗时 平均 ${avg.toFixed(2)}ms、99 分位 ${p99.toFixed(1)}ms、最慢 ${max.toFixed(1)}ms、超过 50ms ${times.filter((ms) => ms > 50).length} 次、超过 300ms ${times.filter((ms) => ms > 300).length} 次；` +
    `各阶段最慢 ${Object.entries(phaseMax).map(([phase, ms]) => `${phase} ${ms.toFixed(1)}`).join(" / ")}；用时 ${((Date.now() - t0) / 1000).toFixed(0)}s`,
);
