// 抓包：连上真实的服务器，检查服务器发给每个人的数据里有没有不该看到的东西。
//   node scripts/spy.mjs [人数=4]            （先 npm run dev；或者 SERVER_URL=http://localhost:<端口> 指向别的服务；
//                                             开房选项 TARGET=33 ROUNDS=3 TACTICS=1 和陪玩脚本一样）
// 房主 A、间谍 B 和其余座位都是这个脚本里的 socket，按简单基线打完整一场（默认 66 分）；另有一个观战的人。
// 每收到一条 room:updated 就检查：
//   1. 任何深度都没有 deck / seed / rngState / log 字段（没发的牌和顺序、种子、随机数状态、动作序列）；
//   2. 别人的 hand 是空数组、selection 是 null（只知道「已选好」）；
//   3. 拿 A 在同一版本里自己看到的手牌（含已选未亮的那张）对照：这些牌一张都不出现在 B 能看到的任何牌里
//      （4 排、亮牌、逐张结算、收牌堆、本局亮过的牌、事件）；
//   4. 观战的人默认谁的手牌都看不到；第 2 局起房主打开「观战看手牌」，之后能看到手牌，但 1 照样成立。
// 有泄露就打印并以退出码 1 结束。
import { io } from "socket.io-client";
import { baselineCommand, redactGameForViewer, stepKey, waitingFor } from "../packages/game/dist/index.js";

const COUNT = Number(process.argv[2] ?? 4);
const URL = process.env.SERVER_URL ?? "http://localhost:3015";
const PATH = process.env.SOCKET_PATH ?? "/socket.io";
const BANNED = new Set(["deck", "seed", "rngState", "log"]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function connect(name) {
  const socket = io(URL, { path: PATH, transports: ["websocket"], reconnection: false });
  const client = { name, socket, latest: null, updates: [] };
  client.emit = (event, ...args) => new Promise((resolve) => socket.emit(event, ...args, resolve));
  socket.on("room:updated", (room) => {
    client.latest = room;
    client.updates.push({ selfId: socket.id, room });
  });
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve(client));
    socket.once("connect_error", (error) => reject(new Error(`连不上 ${URL}：${error.message}`)));
  });
}

/** 深度找禁用字段。 */
function bannedKeys(value, path = "", found = []) {
  if (Array.isArray(value)) value.forEach((item, index) => bannedKeys(item, `${path}[${index}]`, found));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (BANNED.has(key)) found.push(`${path}.${key}`);
      bannedKeys(child, `${path}.${key}`, found);
    }
  }
  return found;
}

/** 这份状态里所有「放牌的位置」上的牌。 */
function visibleCards(game) {
  const cards = new Set();
  const add = (list) => list?.forEach((card) => cards.add(card));
  game.rows.forEach(add);
  add(game.seenCards);
  game.players.forEach((player) => add(player.taken));
  if (game.reveal) {
    game.reveal.plays.forEach((play) => cards.add(play.card));
    game.reveal.rowsBefore.forEach(add);
    for (const step of game.reveal.steps) {
      cards.add(step.card);
      add(step.taken);
      step.rows.forEach(add);
    }
  }
  for (const event of game.events) {
    if (typeof event.card === "number") cards.add(event.card);
    add(event.cards);
    event.plays?.forEach((play) => cards.add(play.card));
    event.rows?.forEach(add);
  }
  return cards;
}

const leaks = [];
const leak = (text) => {
  if (leaks.length < 30) console.log("泄露：", text);
  leaks.push(text);
};

const host = await connect("房主A");
const spy = await connect("间谍B");
const others = [];
for (let index = 2; index < COUNT; index += 1) others.push(await connect(`玩家${index + 1}`));
const viewer = await connect("观战");
const players = [host, spy, ...others];

// 开房选项和陪玩脚本一样：TARGET=33 ROUNDS=3 TACTICS=1
const options = {};
if (process.env.TARGET) options.target = Number(process.env.TARGET);
if (process.env.ROUNDS) options.fixedRounds = Number(process.env.ROUNDS);
if (process.env.TACTICS === "1") options.tactics = true;
const created = await host.emit("room:create", { name: host.name, capacity: COUNT, options });
if (!created.ok) throw new Error(created.error);
const code = created.data.code;
for (const client of [spy, ...others]) {
  const joined = await client.emit("room:join", { name: client.name, code });
  if (!joined.ok) throw new Error(joined.error);
}
const watching = await viewer.emit("room:join", { name: viewer.name, code, spectate: true });
if (!watching.ok) throw new Error(watching.error);
const started = await host.emit("room:start");
if (!started.ok) throw new Error(started.error);
console.log(`房间 ${code}，${COUNT} 人开局（${JSON.stringify(created.data.options)}）；间谍是 B，另有一个观战的人`);

// 所有座位按基线打：每次醒来看一眼最新状态，要自己做决定就做
let seeAllOn = false;
const deadline = Date.now() + 10 * 60_000;
while (Date.now() < deadline) {
  await sleep(25);
  const game = host.latest?.game;
  if (!game) continue;
  if (game.phase === "gameOver") break;
  if (!seeAllOn && game.round >= 2) {
    seeAllOn = (await host.emit("room:access", { spectatorsSeeAll: true })).ok;
  }
  for (const client of players) {
    const room = client.latest;
    const view = room?.game;
    if (!view || view.phase === "gameOver") continue;
    const seat = room.members.find((member) => member.id === client.socket.id)?.playerId;
    if (!seat || !waitingFor(view).includes(seat)) continue;
    const command = baselineCommand(redactGameForViewer(view, seat), seat);
    if (command) await client.emit("game:command", { ...command, step: stepKey(view) });
  }
}
await sleep(300);

// ---- 检查 ----
const hostSeat = host.latest.members.find((member) => member.id === host.socket.id).playerId;
/** A 在每个版本里自己的手牌（含已选未亮的牌）。 */
const hostHands = new Map();
for (const { room } of host.updates) if (room.game) hostHands.set(room.game.version, room.game.players.find((player) => player.id === hostSeat).hand);

let checked = 0;
let compared = 0;
let reveals = new Set();
let chooseRows = 0;
for (const client of [spy, ...others, viewer]) {
  for (const { selfId, room } of client.updates) {
    const banned = bannedKeys(room);
    if (banned.length) leak(`${client.name} 收到了 ${banned.join("、")}`);
    const game = room.game;
    if (!game) continue;
    checked += 1;
    if (game.reveal) reveals.add(game.reveal.id);
    if (game.phase === "chooseRow") chooseRows += 1;
    const seat = room.members.find((member) => member.id === selfId)?.playerId;
    const godView = !seat && room.access.spectatorsSeeAll;
    for (const player of game.players) {
      if (player.id === seat || godView) continue;
      if (player.hand.length > 0) leak(`${client.name} 看到了 ${player.name} 的手牌（v${game.version}）`);
      if (player.selection !== null) leak(`${client.name} 看到了 ${player.name} 选的牌（v${game.version}）`);
    }
    for (const event of game.events) {
      if ((event.type === "Selected" || event.type === "Unselected") && Object.keys(event).length !== 2) leak(`${client.name} 的选牌事件带了多余字段`);
    }
    if (client !== viewer || !godView) {
      const secret = hostHands.get(game.version);
      if (secret) {
        compared += 1;
        const visible = visibleCards(game);
        for (const card of secret) if (visible.has(card)) leak(`${client.name} 在 v${game.version} 看到了 A 手里的 ${card}`);
      }
    }
  }
}
const final = host.latest.game;
console.log(`检查了 ${checked} 条房间更新（其中 ${compared} 条和 A 同版本的手牌逐张对照），亮牌 ${reveals.size} 次，规则 C 选排 ${chooseRows} 条更新，打了 ${final.round} 局，结束：${final.phase}`);
if (seeAllOn) {
  // 「观战看手牌」打开后，选牌阶段的观战画面应该看得到手牌（这是功能，不是泄露）
  const god = viewer.updates.filter(({ room }) => room.access.spectatorsSeeAll && room.game?.phase === "select");
  if (god.length > 0 && !god.some(({ room }) => room.game.players.every((player) => player.hand.length === player.handCount))) {
    console.log("提醒：观战打开看手牌后没看到手牌");
  }
  console.log(`观战打开看手牌后收到 ${god.length} 条选牌阶段的更新，都能看到全部手牌：${god.every(({ room }) => room.game.players.every((player) => player.hand.length === player.handCount))}`);
}
for (const client of [...players, viewer]) client.socket.disconnect();
if (final.phase !== "gameOver") leak("10 分钟内没打完");
console.log(leaks.length === 0 ? "没有发现泄露" : `发现 ${leaks.length} 处泄露`);
process.exit(leaks.length === 0 ? 0 : 1);
