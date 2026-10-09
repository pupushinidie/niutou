# 谁是牛头王

2–10 人同时出牌的数字牌桌游，网页联机版。每人 10 张牌，大家同时扣一张，亮牌后从小到大接进桌上 4 排；谁的牌成了一排的第六张，就把前 5 张收走。收到的牛头都是罚分，有人到 66 分时结束，罚分最少的人赢。名字、美术和规则说明文字都是自己的。

线上地址（上线后）：<https://gulugagame.com/niutou/>

> 流水线状态：引擎和服务器已完成；网页现在是**调试牌桌**（把状态摆出来、每个合法动作一个按钮），正式牌桌由界面阶段做；人机现在是占位（随机合法动作），由人机阶段换成正式策略。

## 本地运行

```bash
npm install
npm run dev          # 服务端 :3015，网页 :5188（WEB_PORT / SERVER_PORT 可改，见下）
npm test             # 133 个测试：规则书 TC1–TC13、例 1/2、补充文件的局面、2–10 人各 300 局随机对局、隐藏信息、服务器全流程
npm run typecheck
BASE_PATH=/niutou/ npm run build
```

- 改了 `packages/game` 要先 `npm run build:game`（服务器和网页读的是 `packages/game/dist`）；`tsc -b` 会重写 dist，`tsx watch` 随即重启服务器，房间全部消失。
- 另起一套服务（比如人机、界面要用特殊环境变量）：`WEB_PORT=5288 SERVER_PORT=3115 npm run dev`（服务器端口 `PORT` 优先、其次 `SERVER_PORT`；网页代理和服务器的开发来源都跟着这两个变量走）。
- 测试用的环境变量（服务器 import 时读）：`TURN_MS=300`（每一步都改成这么多毫秒，不再加动画时间）、`BOT_DELAY_SCALE=0`（人机立刻行动）。

## 一个人怎么测

- `node scripts/test-bot.mjs host 4 1`：机器人建 4 人房、打印房间码，你在网页里用房间码加入；凑满自动开局。`host 4 4` 是 4 个机器人自己打完一整场。
- `node scripts/test-bot.mjs join <房间码> [昵称]`：一个机器人加入别人的房间；对局中用原昵称加入就是回到那个座位（掉线重连、抢座位测试用）。
- 机器人按简单基线出牌（三成随机），规则 C 选牛头最少的一排，局末点「继续」，打完打印每人罚分和胜者。环境变量：`BOT_DELAY_MS`（思考时间，默认 1500）、`BOT_IDLE=1`（挂着不动，测超时和托管）、`BOT_FICKLE=1`（选好后偶尔撤回）、`BOT_REMATCH=1`（打完同意再来一局接着打）、`ADD_BOTS=n`（建房后让服务器加 n 个人机）、`TARGET=33` / `ROUNDS=3` / `TACTICS=1`（开房选项）、`SERVER_URL`。
- 抓包：`node scripts/spy.mjs [人数]` 连真实服务器打完一整场，逐条检查发给每个人（和观战）的数据里有没有别人的手牌、已选未亮的牌、没发的牌和种子。

## 规则说明

- **牌**：104 张，编号 1–104，各一张。每张的牛头：55 是 7 个；其余 11 的倍数 5 个；整十 3 个；个位是 5 的 2 个；剩下的 1 个。全副合计 171 个牛头。
- **发牌**：每局每人 10 张，再翻 4 张各自做一排的第一张；剩下的牌这局不用（10 人局正好用完）。
- **每一手**：所有人同时选一张扣下。选好后、最后一个人确认之前，都可以撤回改选；最后一个人确认的瞬间亮牌。
- **从小到大放牌**：亮出的牌按数字从小到大一张张放：
  - 只看每排的最后一张，接在「比它小、而且最接近它」的那一排后面，没有选择余地；
  - 那一排已经 5 张，这张就是第六张：出牌的人收走那 5 张，他的牌成为这一排新的第一张；
  - 这张比 4 排的最后一张都小：出牌的人自己挑一排，整排收走（不管几张），他的牌成为这一排的第一张。这时结算停下来等他挑，挑完接着放后面的牌。每一手最多出现一次（只可能是这一手最小的那张）。
- **一局**：10 手打完，每人这局收的牛头加进累计罚分。某局打完时有人累计 ≥ 66，游戏结束；只在局末检查，局中超过也要打完这一局。否则重新洗牌开下一局。
- **胜负**：累计罚分最少的人赢；一样少就一起赢。
- **开房选项**（房主开房时或等候时改，默认都关）：目标分（默认 66）；固定局数（打满 N 局就结束，不看目标分）；战术模式（只用 1 到「人数 × 10 + 4」号牌，每张都会出，可以算牌）。

## 规则书没写死、这里这样处理的地方

| 情况 | 现在的做法 | 依据 |
|---|---|---|
| 每人本局收到的牛头 | 一直公开：状态里每人的 `taken`（收到的牌）和 `roundBulls`（本局牛头）都公开；另有 `seenCards`（本局亮过的牌：4 张排头 + 每手亮出的牌） | 开工拍板 |
| 扣下的牌能不能改 | 能：最后一个人确认前，已选的人可以 `unselect`，也可以直接 `select` 另一张改选；最后一人确认的那一步就亮牌并结算完（不需要别的命令） | 开工拍板 |
| 罚分并列最少 | 共同获胜（`finalResult.winners` 是数组） | 开工拍板，官方 30 周年版规则 |
| 目标分 | 默认 66，房主可改成 10–200 的整数；到了就在局末结束 | 开工拍板 |
| 固定局数 | 1–20 局或不固定（默认）；固定时打满就结束，不看目标分，哪怕有人早就过了 66 | 开工拍板 |
| 战术模式 | 开局时按实际人数取 1 到人数 × 10 + 4，每局都一样；没发的牌为空 | 开工拍板 |
| 自选手牌、专家（两端都能接）变体 | 不做 | 开工拍板 |
| 局末怎么开下一局 | 进入 `roundEnd`：大家都点「继续」（`nextRound`）就马上发下一局；没点齐的话，最后一手的动画放完后再停 5 秒自动发。人机自动点继续 | 规则书 9.2 建议「5 秒后自动」，这里加了「都点了就不等」 |
| 选牌超时（30 秒） | 系统按「简单基线」替没选的人出牌：有能安全接上的牌（规则 A 有目标排、目标排不到 5 张）就出其中离排尾最近的（一样近出小的），没有就出最小的。不是规则书 9.4 的「出最小的牌」 | 开工拍板，补充文件 1.7 / 1.11 |
| 规则 C 选排超时（20 秒） | 牛头最少 → 排尾最大 → 排号最小（规则书 9.4 的第二比较项是「张数最少」，这里按勘误第 5 条换成「排尾最大」） | 开工拍板，补充文件勘误 3.2-5 |
| 计时从什么时候算 | 每一步的限时加上刚才那一步的结算动画（亮牌 1.2 秒、每张接上去 0.7 秒、每次收牌 2 秒），所以玩家看完动画后还有完整的 30 / 20 / 5 秒 | 自定 |
| 托管 | 全站约定覆盖规则书：真人在选牌或选排上连续超时 2 次转托管，由人机代打（不是默认动作），自己动一下或点「取消托管」交还；局末没点「继续」不算超时。离线的人先等 3 秒再由人机代打（不算超时），用原昵称回来就交还 | 全站约定 |
| 人机 | 房主在空座位点「加人机」（咕噜一号…九号）；一个人加满人机也能开局；人机总是同意再来一局 | 全站约定 |
| 观战 | 默认可观战、不公开；房主打开「观战看手牌」后观战的人能看到所有人的手牌和已选的牌；没发的牌、种子永远看不到 | 全站约定 |
| 规则 C 时谁先看到 | 亮牌后所有牌都公开，停在选排时还没结算的牌也公开（大家都看得到） | 规则书 4.4 |

## 超时规则（服务器）

| 步骤 | 限时 | 超时怎么办 | 记超时吗 |
|---|---|---|---|
| 选牌（所有人同时） | 30 秒 + 上一手结算动画 | 替所有还没选的人按基线出牌，选齐就亮牌 | 记（真人） |
| 规则 C 选排 | 20 秒 + 亮牌动画 | 替 chooser 按基线选排，接着结算 | 记（真人） |
| 局末 | 5 秒 + 最后一手动画 | 替没点的人点「继续」，发下一局 | 不记 |

- 计时 key 是 `stepKey(game)` = `局:手:阶段`，只在换手、进入 / 离开 chooseRow、局末时变。选牌是大家同时做的「轮外操作」：别人选牌、撤回、改选都不会重置倒计时（有测试）。
- 人机座位、托管、离线的人各有一个计时器，等这一步的动画放完再「想」1–3.5 秒（离线至少等 3 秒）后由人机替他做。人机给出不合法的动作时退回基线，不会卡住。
- 超时代打用哪个策略在 `apps/server/src/index.ts` 的 `timeoutPolicy`（现在是 `baselineCommand`）；人机阶段要换成正式策略只改这一行。

## 对外接口

规则包 `@niutou/game`（`packages/game/src/index.ts` 导出全部）。测试和预览页可以直接 `import … from "../src/index.js"`（不用先构建）。

### 状态（`GameState`，见 `types.ts`）

| 字段 | 含义 | 谁能看 |
|---|---|---|
| `phase` | `select`（大家选牌）/ `chooseRow`（规则 C 等 chooser 选排）/ `roundEnd`（局末等继续）/ `gameOver` | 公开 |
| `round` / `turn` | 第几局、本局第几手（1–10） | 公开 |
| `rows` | 4 排，每排从左到右递增，最后一张是排尾 | 公开 |
| `players[]` | `id`、`name`、`seat`；`hand`（**只有自己**，别人是 `[]`）、`handCount`；`selected`（公开：已选好）、`selection`（**只有自己**，别人 `null`）；`taken`、`roundBulls`（本局收的牌和牛头，公开）；`total`（累计罚分：选牌 / 选排时只含打完的局，局末和终局时已经加上本局）；`ready`（局末已点继续） | 见左 |
| `reveal` | 最近一次亮牌：`id`（整场递增，界面按它只播一遍动画）、`plays`（从小到大，谁出了几）、`rowsBefore`（亮牌时的 4 排）、`steps`（逐张结算，见下）、`done`。下一次亮牌前一直留着，重连的人也能补看；新的一局发牌时清空 | 公开 |
| `chooser` | 规则 C 等谁选排 | 公开 |
| `seenCards` | 本局亮过的牌：4 张排头 + 每手亮出的牌（人机记牌用） | 公开 |
| `history[]` | 每局结束时：`{ round, bulls: {座位: 本局牛头}, totals: {座位: 累计} }` | 公开 |
| `finalResult` | `{ winners[], totals, rounds, reason: "target" | "rounds" }` | 公开 |
| `config` | 开房选项（`target`、`fixedRounds`、`tactics`）+ 限时（`selectTimeoutSec` 30、`chooseRowTimeoutSec` 20、`roundEndSec` 5） | 公开 |
| `events` | 最近一步的事件（见下） | 公开，不含牌面的私密信息 |
| `version` | 每个动作 +1，界面看它变没变 | 公开 |
| `deck`、`seed`、`rngState`、`log` | 本局没发的牌（洗过的顺序）、种子、随机数状态、动作序列 | **只在服务器**，`redactGameForViewer` 去掉 |

**结算的一步**（`ResolveStep`，`reveal.steps[i]` 对应 `reveal.plays[i]`）：`kind`（`place` 接上去 / `sixth` 第六张收牌 / `low` 规则 C 收整排）、`player`、`card`、`row`（0–3）、`position`（在这一排第几张，收牌时是 1）、`taken`（收走的牌）、`bulls`（罚分）、`rows`（这一步之后的 4 排，放动画直接用）、`auto`（规则 C 是代选的）。

### 动作（`GameCommand`，`socket.emit("game:command", 动作, ack)`）

| 动作 | 什么时候 | 说明 |
|---|---|---|
| `{ type: "select", card }` | `select` 阶段，牌在自己手里 | 选好（确认）。已选好时再发另一张就是改选；最后一人选好就亮牌 |
| `{ type: "unselect" }` | `select` 阶段，自己已选 | 撤回 |
| `{ type: "chooseRow", row }` | `chooseRow` 阶段，自己是 `chooser`，`row` 0–3 | 收走这一排 |
| `{ type: "nextRound" }` | `roundEnd` 阶段，自己还没点 | 点「继续」；所有人都点了就发下一局 |

`legalActions(state, 座位)` 列出某人现在能做的全部动作；`waitingFor(state)` 是现在还要等谁做决定。

### 事件（`GameEvent`）

`Selected` / `Unselected`（谁选好了 / 撤回了，**不带牌面**）、`Revealed`（亮牌：`revealId`、`plays`）、`CardPlaced`（接到第几排第几张）、`RowTaken`（`reason: "sixth" | "low"`，收走的 `cards`、`bulls`，`auto` 是代选）、`ChooseRow`（停下来等谁选排）、`HandEnded`（这一手每人罚分）、`RoundEnded`（本局牛头和新累计）、`Ready`（局末有人点了继续）、`RoundStarted`（新一局的 4 排）、`GameEnded`（`winners`、`totals`、`reason`）、`TimedOut`（`phase`、被代做的 `players`）。

### 动画节奏

`ANIMATION = { flipMs: 1200, placeMs: 700, takeMs: 2000 }`，`animationMs(events)` 按亮牌、每张接上去、每次收牌累加。服务器按它给下一步的倒计时和人机的停顿留出动画时间，界面最好照这个节奏放（要改节奏就改这里，两边一起变）。

### 函数

- 规则：`bullheads(card)`、`sumBulls(cards)`、`rowsBulls(rows)`、`targetRow(rows, card)`（规则 A，规则 C 返回 `null`）、`placeCard(rows, play)`、`takeLowRow(rows, play, row)`、`resolvePlays(rows, plays, chooser?)`（从小到大逐张结算，没给 chooser 遇到规则 C 就停下）、`cardsInPlay(人数, tactics)`。
- 引擎：`createGame(players, seed?, options?, overrides?)`、`apply(state, 座位, 动作, rng)`（纯函数，不改输入）、`applyCommand(state, 座位, 动作)`（服务器用，rng 存在 state 里）、`timeoutTurn(state, policy?)`、`legalActions`、`waitingFor`、`stepKey`、`normalizeOptions`、`redactGameForViewer(state, 座位)`、`redactGameForSpectator(state, seeAll)`。
- 基线：`baselineCommand(视角, 座位)`、`baselineCard(hand, rows)`、`baselineRow(rows)`（超时代打和人机对照用）。
- 人机：`botCommand(视角, 座位)`（现在是占位，人机阶段换掉）。

### 预览局面工厂（`scenes.ts`）

界面的预览页、教程、验收（包括背靠背的规则核对）都用它造局面，不用真打一局去等。

```ts
// 按名字造（完整的服务端状态；给界面前过 redactGameForViewer，或者用 createSceneRoom）
createScene(name: SceneName, opts?: { players?: number; seed?: number }): GameState
SCENE_NAMES        // 下面这些名字
SCENE_DESCRIPTIONS // 每个名字一句话说明（预览页下拉菜单可以直接用）

// 按参数造任意精确局面（phase = select）
buildGame(spec: {
  players: number | { id?; name?; hand?: number[]; include?: number[]; total?; taken?: number[]; selection?: number | null }[];
  rows?: number[][];                 // 正好 4 排，每排 1–5 张、递增；不给就随机翻 4 张
  options?: Partial<GameOptions>;    // 目标分、固定局数、战术
  round?: number;                    // 默认 1
  turn?: number;                     // 默认按手牌张数：11 − 张数
  history?: RoundResult[];
  seed?: number;                     // 没指定的手牌用它随机补
}): GameState
// hand 写全手牌；include 只指定几张一定在手里、其余随机补。会检查牌不重复、在这局用的牌里、手牌一样多。

playHand(state, plays: Record<座位, 牌> | 牌[]（按座位）, choose?: 排号 | (state) => 排号): GameState
  // 所有人出指定的牌（没给的人按基线），最后一人确认时亮牌；规则 C 给了 choose 就顺手选掉，没给就停在 chooseRow
chooseRowFor(state, row): GameState        // 规则 C 时替 chooser 选排
autoPlayHands(state, n): GameState         // 所有人按基线连打 n 手
revealFrames(state): { rows; step }[]      // 最近一次亮牌拆成逐张的画面（第 0 帧是亮牌时的 4 排）
revealAt(state, k): GameState              // 「动画放到第 k 张」的画面（拼出来的，只用来截图）

// 包成网页收到的房间快照（status = playing）；成员连接 id 是 sock-<座位>，预览页冒充 p1：
// Object.defineProperty(socket, "id", { get: () => "sock-p1" })
createSceneRoom(game, opts?: {
  viewer?: string;          // 从哪个座位看，默认 p1
  spectator?: boolean; seeAll?: boolean;
  offline?: string[]; bots?: string[]; auto?: string[];   // 标离线、人机、托管的座位
  turnRemainingMs?: number;
}): LobbyRoomSnapshot      // gameOver 时带「再来一局」投票
```

| 场景名 | 是什么 |
|---|---|
| `opening` | 开局：第 1 局第 1 手，谁都还没选（`players` 可改人数） |
| `selectSome` | 选牌中：有人已选好，我还没选 |
| `selectedMine` | 选牌中：我已选好（可撤回），还有人在想 |
| `waitingOne` | 选牌中：只差一个人 |
| `midRound` | 一局打到第 5 手：排有长有短，有人收过牌 |
| `reveal` | 刚亮牌：有接上去的，有人放第六张收走 5 张 |
| `chooseRow` | 规则 C：我的 4 比所有排尾都小，等我选排（规则书例 1） |
| `chooseRowOther` | 规则 C：等阿牛选排 |
| `afterChooseRow` | 例 1 选完第 4 排后结算完 |
| `doubleSixth` | 同一手两张牌先后接满排：小的收牌，大的接在它后面 |
| `lastHand` | 第 10 手，每人只剩 1 张 |
| `roundEnd` | 一局结束，等大家点继续 |
| `gameOver` | 终局：有人过 66，罚分最少的一人获胜 |
| `gameOverTie` | 终局：两人并列获胜 |
| `tenPlayers` | 10 人局选牌中（一半人已选） |
| `tenPlayersReveal` | 10 人局刚亮牌（第 3 手结算完，有人收牌） |
| `tactics` | 战术模式 3 人局（只用 1–34） |
| `timeout` | 选牌超时，系统替没选的人出了牌 |
| `fixedRounds` | 固定 3 局，正在打最后一局 |

「对手离线」「托管中」「人机」「观战」「超时倒计时」用 `createSceneRoom` 的参数造。

### 房间（Socket.IO，`roomTypes.ts`）

和别的游戏一样（建房、加入、重连、踢人、解散、再来一局、聊天、语音、观战、管理员解散、挤登录、加人机、托管），谁是牛头王多了：

- `room:create` 的 payload 可以带 `options: Partial<GameOptions>`（不合法就拒绝，错误原样返回）；人数 2–10。
- `room:options`（房主、等候时）：改开房选项，`fixedRounds: null` 表示不固定。
- 快照 `LobbyRoomSnapshot.options`、首页列表 `PublicRoomSummary.options`；列表里 `score` 是累计罚分（局中含本局已收的牛头），`isActive` 是「还在等他做决定」，`isWinner` 是共同获胜者之一。
- `turnRemainingMs`：当前这一步的剩余毫秒（选牌时大家共用一个倒计时）；终局时没有。
- 网页 `OPTION_LIMITS`（目标分 10–200、固定局数 1–20）给选项控件用。

## 目录

| 路径 | 内容 |
|---|---|
| `packages/game/src/cards.ts` | 牛头数、规则 A（`targetRow`）、逐张结算（`resolvePlays`） |
| `packages/game/src/engine.ts` | 规则引擎：发牌、选牌 / 撤回、亮牌结算、规则 C 停下选排、局末、终局、超时代做、隐藏信息 |
| `packages/game/src/baseline.ts` | 简单基线（超时代打） |
| `packages/game/src/scenes.ts` | 预览局面工厂 |
| `packages/game/src/bot.ts` | 人机（现在是占位，人机阶段负责） |
| `packages/game/test/` | 规则书用例（`rulebook.test.ts`）、补充文件局面和勘误（`supplement.test.ts`）、引擎行为、隐藏信息、预览局面、随机对局（`random-*.test.ts`）；`acceptance/` 归规则核对，引擎不改 |
| `apps/server` | Socket.IO 房间服务器；测试在 `apps/server/test`（全流程 `flow.test.ts`、真实计时 `timeouts.test.ts`、观战、挤登录、人机） |
| `apps/web` | 网页（现在是调试牌桌 `GameBoard.tsx` + `niutou.css`，界面阶段重做） |
| `scripts/test-bot.mjs`、`scripts/spy.mjs` | 陪玩机器人、抓包 |
| `art/` | PixelLab 美术（美术阶段负责） |

## 画面：白天版和夜间版

只有像素风一种画面，配色分夜间（深色，默认）和白天（白底）两种，顶栏随时切换，记在浏览器的 `gm-pixel-theme` 里（全站共用）。夜间配色就是 `app-pixel.css` 和牌桌样式本身；白天版由 `apps/web/day-theme.ts` 在构建时按 `apps/web/day-palette.ts` 的调色表换色生成，机械换色不合适的地方写在 `apps/web/src/theme-day.css`。

## 部署

服务器上 `~/niutou`，pm2 进程 `niutou`（端口 3015），网页在 `/var/www/niutou`，Caddy `handle_path /niutou/*`（在付费网关 `@games` 里）。pm2 按仓库根目录的 `ecosystem.config.cjs` 直接启动 `node --import tsx` 进程跑服务端。端口和密钥（PORT、ADMIN_TOKEN、TURN_*、WEB_ORIGINS）存在 pm2 里，不进仓库。每局的种子、开房选项和动作序列写进 `logs/games.jsonl`，同一种子按顺序重放 `log` 就能复现整场。
