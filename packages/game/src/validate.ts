import { cardsInPlay, DECK_SIZE, ROW_COUNT, ROW_LIMIT, sumBulls, targetRow } from "./cards.js";
import { legalActions, waitingFor } from "./engine.js";
import type { GameState } from "./types.js";

/**
 * 检查一个**服务端**状态（没 redact 过）像不像真实对局里能出现的局面，返回问题列表（空 = 没问题）。
 * 预览局面、教程剧本、验收用 buildGame 造的局面都可以拿它查：buildGame 本身不强制「桌上的牌数和第几手对得上」。
 *
 * 查的是：4 排每排 1–5 张递增；牌不重不漏（手牌 + 4 排 + 收牌堆 + 待结算 + 没发的牌 = 这一局用的牌）；
 * 没发的牌张数（基础模式 104 − 10×人数 − 4，战术模式 0）；本局亮过的牌 = 排上 + 收牌堆 + 待结算；
 * 本局牛头 = 收牌堆牛头；累计 = 各局之和；手牌张数一样且和第几手对得上；局数和历史对得上；
 * 各阶段的约束（选排时 chooser 的牌确实比所有排尾都小、终局胜者对）；没结束时等着的人都有合法动作。
 */
export function stateProblems(state: GameState): string[] {
  const problems: string[] = [];
  const n = state.players.length;
  const pool = cardsInPlay(n, state.config.tactics);
  const reveal = state.reveal;
  const pending = state.phase === "chooseRow" && reveal ? reveal.plays.slice(reveal.steps.length).map((play) => play.card) : [];
  const deck = state.deck ?? [];

  if (state.rows.length !== ROW_COUNT) problems.push(`不是 ${ROW_COUNT} 排`);
  state.rows.forEach((row, index) => {
    if (row.length < 1 || row.length > ROW_LIMIT) problems.push(`第 ${index + 1} 排有 ${row.length} 张`);
    for (let position = 1; position < row.length; position += 1) {
      if (row[position]! <= row[position - 1]!) problems.push(`第 ${index + 1} 排没有递增`);
    }
  });

  const everywhere = [
    ...state.players.flatMap((player) => player.hand),
    ...state.rows.flat(),
    ...state.players.flatMap((player) => player.taken),
    ...pending,
    ...deck,
  ];
  const seen = new Set(everywhere);
  if (seen.size !== everywhere.length) problems.push("有牌重复出现");
  if (seen.size !== pool.length || pool.some((card) => !seen.has(card))) problems.push(`牌不守恒：${seen.size} 张，这一局应有 ${pool.length} 张`);
  const expectedDeck = state.config.tactics ? 0 : DECK_SIZE - n * state.config.handSize - ROW_COUNT;
  if (deck.length !== expectedDeck) problems.push(`没发的牌 ${deck.length} 张，应为 ${expectedDeck}（桌上的牌数和第几手对不上）`);

  const shown = new Set([...state.rows.flat(), ...state.players.flatMap((player) => player.taken), ...pending]);
  if (state.seenCards.length !== shown.size || state.seenCards.some((card) => !shown.has(card))) problems.push("seenCards 和排上 + 收牌堆 + 待结算的牌不一致");

  for (const player of state.players) {
    if (player.roundBulls !== sumBulls(player.taken)) problems.push(`${player.id} 本局牛头和收牌堆不一致`);
    if (player.handCount !== player.hand.length) problems.push(`${player.id} handCount 不对`);
    const settled = state.history.reduce((sum, result) => sum + (result.bulls[player.id] ?? 0), 0);
    if (player.total !== settled) problems.push(`${player.id} 累计 ${player.total} ≠ 各局之和 ${settled}`);
    if (player.selected !== (player.selection !== null)) problems.push(`${player.id} selected 和 selection 不一致`);
    if (player.selection !== null && !player.hand.includes(player.selection)) problems.push(`${player.id} 选的牌不在手里`);
  }

  const sizes = new Set(state.players.map((player) => player.hand.length));
  if (sizes.size !== 1) problems.push("每人手牌张数不一样");
  const size = state.players[0]?.hand.length ?? 0;
  const expectedHand = state.phase === "select" ? state.config.handSize + 1 - state.turn
    : state.phase === "chooseRow" ? state.config.handSize - state.turn
    : 0;
  if (size !== expectedHand) problems.push(`第 ${state.turn} 手（${state.phase}）手牌 ${size} 张，应为 ${expectedHand}`);
  const finishedRound = state.phase === "roundEnd" || state.phase === "gameOver";
  if (state.round !== state.history.length + (finishedRound ? 0 : 1)) problems.push("局数和历史条数对不上");

  switch (state.phase) {
    case "select":
      if (state.chooser !== null) problems.push("选牌阶段 chooser 不为空");
      if (state.players.every((player) => player.selected)) problems.push("所有人都选好了却没亮牌");
      break;
    case "chooseRow": {
      const play = reveal?.plays[reveal.steps.length];
      if (!reveal || !play || play.player !== state.chooser) problems.push("chooseRow 的 chooser 不是待结算那张牌的主人");
      else if (targetRow(state.rows, play.card) !== null) problems.push("待结算的牌能接上，不该停在 chooseRow");
      break;
    }
    case "roundEnd":
      if (state.config.fixedRounds !== null ? state.round >= state.config.fixedRounds : state.players.some((player) => player.total >= state.config.target)) {
        problems.push("已经该结束了却停在局末");
      }
      break;
    case "gameOver": {
      const best = Math.min(...state.players.map((player) => player.total));
      const winners = state.players.filter((player) => player.total === best).map((player) => player.id);
      if (JSON.stringify(state.finalResult?.winners) !== JSON.stringify(winners)) problems.push("胜者不对");
      break;
    }
  }

  if (state.phase !== "gameOver") {
    const waiting = waitingFor(state);
    if (waiting.length === 0) problems.push("没结束却没有人要做决定");
    for (const id of waiting) if (legalActions(state, id).length === 0) problems.push(`${id} 要做决定却没有合法动作`);
  }
  return problems;
}
