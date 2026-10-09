// 本地测试用的陪玩机器人（先 npm run dev；规则包要先构建：npm run build:game）。
//   node scripts/test-bot.mjs host [人数] [机器人数]  → 机器人建房、拉够机器人，等真人加入凑满后自动开局
//                                                    （人数 = 机器人数时不等人，直接开局）
//   node scripts/test-bot.mjs join <房间码> [昵称]   → 以一个机器人身份加入别人的房间（对局中用原昵称加入就是回到座位）
// 机器人每一手按「简单基线」出牌（能安全接上就出离排尾最近的，否则出最小的），有三成概率随便出一张；
// 规则 C 选牛头最少的一排；局末点「继续」。打完一整局打印每人罚分和胜者后退出。
// 环境变量：
//   SERVER_URL（默认 http://localhost:3015）、SOCKET_PATH（默认 /socket.io）
//   BOT_DELAY_MS   每一步的思考时间（默认 1500）
//   BOT_IDLE=1     只挂着不动（等超时由系统代打，或者测托管）
//   BOT_FICKLE=1   选好以后偶尔撤回改选（测撤回）
//   BOT_REMATCH=1  打完同意再来一局，接着打（不退出）
//   ADD_BOTS=n     建房后再让服务器加 n 个人机（咕噜一号…）
//   TARGET=33 ROUNDS=3 TACTICS=1   建房时的开房选项（目标分、固定局数、战术模式）
import { io } from "socket.io-client";
import { baselineCommand, legalActions, redactGameForViewer, stepKey, waitingFor } from "../packages/game/dist/index.js";

const URL = process.env.SERVER_URL ?? "http://localhost:3015";
const PATH = process.env.SOCKET_PATH ?? "/socket.io";
const DELAY = Number(process.env.BOT_DELAY_MS ?? 1500);
const IDLE = process.env.BOT_IDLE === "1";
const FICKLE = process.env.BOT_FICKLE === "1";
const REMATCH = process.env.BOT_REMATCH === "1";
const ADD_BOTS = Number(process.env.ADD_BOTS ?? 0);
const NAMES = ["牛仔", "阿花", "老黄", "大壮", "二丫", "三毛", "四喜", "五福", "六顺", "七巧"];

function options() {
  const result = {};
  if (process.env.TARGET) result.target = Number(process.env.TARGET);
  if (process.env.ROUNDS) result.fixedRounds = Number(process.env.ROUNDS);
  if (process.env.TACTICS === "1") result.tactics = true;
  return result;
}

/** 这一步出什么：基线为主，三成随机；选好的牌偶尔撤回（BOT_FICKLE）。 */
function choose(game, seat) {
  const me = game.players.find((player) => player.id === seat);
  if (game.phase === "select" && me.selected) return FICKLE && Math.random() < 0.3 ? { type: "unselect" } : null;
  if (!waitingFor(game).includes(seat)) return null;
  const actions = legalActions(game, seat).filter((action) => action.type !== "unselect");
  if (actions.length === 0) return null;
  if (game.phase === "select" && Math.random() < 0.3) return actions[Math.floor(Math.random() * actions.length)];
  return baselineCommand(redactGameForViewer(game, seat), seat) ?? actions[0];
}

function bot(name, onRoom) {
  const socket = io(URL, { path: PATH, transports: ["websocket"] });
  let acting = false;
  let latest = null;
  let unselects = 0;
  const emit = (event, ...args) => new Promise((resolve) => socket.emit(event, ...args, resolve));
  // 回执和新状态的广播可能在同一批消息里到达：每做完一步都回头看最新状态，免得漏掉要自己做的事。
  async function tick() {
    const room = latest;
    const game = room?.game;
    if (!game || game.phase === "gameOver" || IDLE || acting) return;
    const seat = room.members.find((member) => member.id === socket.id)?.playerId;
    if (!seat) return;
    const command = choose(game, seat);
    if (!command || (command.type === "unselect" && unselects >= 3)) return;
    acting = true;
    await new Promise((resolve) => setTimeout(resolve, DELAY * (0.6 + Math.random() * 0.8)));
    try {
      // 等的这段时间里状态可能变了（比如已经亮牌）：按最新状态重新决定
      const fresh = latest?.game;
      const again = fresh && fresh.version !== game.version ? choose(fresh, seat) : command;
      if (again) {
        if (again.type === "unselect") unselects += 1;
        // 带上自己看到的这一步：这一手已经结算了的话服务器会拒绝，不会落到下一手
        const result = await emit("game:command", { ...again, step: stepKey(fresh ?? game) });
        if (!result.ok && !result.error.includes("已经结算")) console.log(name, "行动失败", result.error);
      }
    } finally {
      acting = false;
    }
    if (latest !== room) void tick();
  }
  let reported = -1;
  let handKey = "";
  socket.on("room:updated", (room) => {
    latest = room;
    onRoom?.(room, socket);
    const game = room.game;
    if (game?.phase === "gameOver") {
      if (reported !== game.version) {
        reported = game.version;
        const totals = game.players.map((player) => `${player.name}:${player.total}`).join(" ");
        const winners = game.finalResult.winners.map((id) => game.players.find((player) => player.id === id).name).join("、");
        console.log(name, `游戏结束（${game.round} 局），罚分`, totals, "胜者", winners);
      }
      if (REMATCH) {
        if (room.rematch && !room.rematch.acceptedIds.includes(socket.id)) void emit("room:rematch", true);
      } else {
        setTimeout(() => process.exit(0), 200);
      }
      return;
    }
    // 每一手最多撤回 3 次
    const hand = game ? `${game.round}:${game.turn}` : "";
    if (hand !== handKey) {
      handKey = hand;
      unselects = 0;
    }
    void tick();
  });
  socket.on("room:closed", ({ reason }) => {
    console.log(name, "房间关闭：", reason);
    process.exit(0);
  });
  socket.on("connect_error", (error) => {
    console.log(name, "连不上服务器", URL, error.message);
    process.exit(1);
  });
  return { socket, emit };
}

const [mode, arg1, arg2] = process.argv.slice(2);
if (mode === "join") {
  const name = arg2 ?? NAMES[1];
  const { socket, emit } = bot(name);
  socket.on("connect", async () => {
    const result = await emit("room:join", { name, code: arg1 });
    console.log("加入", result.ok || result.error);
    if (!result.ok) process.exit(1);
  });
} else {
  const capacity = Number(arg1 ?? 2);
  const bots = Number(arg2 ?? capacity);
  let started = false;
  const host = bot(NAMES[0], async (room) => {
    if (!started && room.status === "waiting" && room.members.length === capacity) {
      started = true;
      const result = await host.emit("room:start");
      console.log("开局", result.ok || result.error);
    }
  });
  host.socket.on("connect", async () => {
    const created = await host.emit("room:create", { name: NAMES[0], capacity, options: options() });
    if (!created.ok) {
      console.log(created.error);
      process.exit(1);
    }
    console.log("房间码", created.data.code, "开房选项", JSON.stringify(created.data.options));
    for (let index = 0; index < ADD_BOTS; index += 1) console.log("加人机", (await host.emit("room:add-bot")).ok);
    for (let index = 1; index < bots; index += 1) {
      const name = NAMES[index];
      const other = bot(name);
      other.socket.on("connect", async () => console.log("加入", name, (await other.emit("room:join", { name, code: created.data.code })).ok));
    }
  });
}
