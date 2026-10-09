/**
 * 隐藏信息：每个玩家视角、观战视角都检查。
 * 藏起来的：别人的手牌、别人还没亮的已选牌（只能看到「已选好」）、本局没发出去的牌（顺序）、种子、随机数状态、动作序列。
 */
import { describe, expect, it } from "vitest";
import {
  applyCommand,
  createScene,
  redactGameForSpectator,
  redactGameForViewer,
  SCENE_NAMES,
  timeoutTurn,
  type GameState,
} from "../src/index.js";

const SERVER_ONLY = ["deck", "seed", "rngState", "log"] as const;

/** 视角里所有能看到的牌（公开的 + 自己的）。 */
function visibleCards(view: GameState, viewerId: string | null): Set<number> {
  const cards = new Set<number>([...view.rows.flat(), ...view.seenCards, ...view.players.flatMap((player) => player.taken)]);
  for (const play of view.reveal?.plays ?? []) cards.add(play.card);
  for (const player of view.players) {
    if (viewerId === null || player.id === viewerId) {
      for (const card of player.hand) cards.add(card);
      if (player.selection !== null) cards.add(player.selection);
    }
  }
  return cards;
}

/** 状态里还藏着、只有 owner 能看到的牌：他的手牌（含已选未亮的那张）。 */
function secretCardsOf(state: GameState, ownerId: string): number[] {
  return state.players.find((player) => player.id === ownerId)!.hand;
}

function checkViewer(state: GameState, viewerId: string): void {
  const view = redactGameForViewer(state, viewerId);
  for (const key of SERVER_ONLY) expect((view as unknown as Record<string, unknown>)[key], key).toBeUndefined();
  for (const player of view.players) {
    const real = state.players.find((candidate) => candidate.id === player.id)!;
    expect(player.handCount).toBe(real.hand.length);
    expect(player.selected).toBe(real.selected);
    expect(player.taken).toEqual(real.taken);
    expect(player.roundBulls).toBe(real.roundBulls);
    expect(player.total).toBe(real.total);
    if (player.id === viewerId) {
      expect(player.hand).toEqual(real.hand);
      expect(player.selection).toBe(real.selection);
    } else {
      expect(player.hand).toEqual([]);
      expect(player.selection).toBeNull();
    }
  }
  // 别人手里的牌一张都不出现在这个视角能看到的牌里（包括事件）
  const visible = visibleCards(view, viewerId);
  const serialized = JSON.stringify(view.events);
  for (const other of state.players) {
    if (other.id === viewerId) continue;
    for (const card of secretCardsOf(state, other.id)) {
      expect(visible.has(card), `${viewerId} 看到了 ${other.id} 的 ${card}`).toBe(false);
    }
  }
  // 选牌事件不带牌面
  for (const event of view.events) {
    if (event.type === "Selected" || event.type === "Unselected" || event.type === "Ready") expect(Object.keys(event).sort()).toEqual(["player", "type"]);
  }
  expect(serialized).not.toContain("selection");
  // 没发出去的牌也看不到
  for (const card of state.deck ?? []) expect(visible.has(card)).toBe(false);
}

function checkSpectator(state: GameState): void {
  const blind = redactGameForSpectator(state, false);
  const god = redactGameForSpectator(state, true);
  for (const view of [blind, god]) {
    for (const key of SERVER_ONLY) expect((view as unknown as Record<string, unknown>)[key], key).toBeUndefined();
  }
  expect(blind.players.every((player) => player.hand.length === 0 && player.selection === null)).toBe(true);
  const blindVisible = visibleCards(blind, null);
  for (const player of state.players) for (const card of player.hand) expect(blindVisible.has(card)).toBe(false);
  // 上帝视角：所有人的手牌和已选的牌都看得到，牌堆照样看不到
  expect(god.players.map((player) => player.hand)).toEqual(state.players.map((player) => player.hand));
  expect(god.players.map((player) => player.selection)).toEqual(state.players.map((player) => player.selection));
  const godVisible = visibleCards(god, null);
  for (const card of state.deck ?? []) expect(godVisible.has(card)).toBe(false);
}

describe("隐藏信息#每个视角", () => {
  for (const name of SCENE_NAMES) {
    it(`隐藏信息#场景 ${name}：每个玩家、观战（两种）都拿不到不该看的`, () => {
      const state = createScene(name);
      for (const player of state.players) checkViewer(state, player.id);
      checkSpectator(state);
    });
  }

  it("隐藏信息#已选未亮：别人只看到「已选好」，选的牌在自己视角里看得到", () => {
    let state = createScene("opening");
    const mine = state.players[0]!.hand[3]!;
    state = applyCommand(state, "p1", { type: "select", card: mine });
    expect(redactGameForViewer(state, "p1").players[0]).toMatchObject({ selected: true, selection: mine });
    for (const viewer of ["p2", "p3", "p4"]) {
      expect(redactGameForViewer(state, viewer).players[0]).toMatchObject({ selected: true, selection: null, hand: [], handCount: 10 });
    }
    expect(redactGameForSpectator(state, false).players[0]).toMatchObject({ selected: true, selection: null });
    expect(JSON.stringify(redactGameForViewer(state, "p2"))).not.toContain(`"selection":${mine}`);
  });

  it("隐藏信息#redact 返回的是副本：改它不影响服务端状态", () => {
    const state = createScene("selectSome");
    const view = redactGameForViewer(state, "p1");
    view.players[0]!.hand.push(999);
    view.rows[0]!.push(999);
    expect(state.players[0]!.hand).not.toContain(999);
    expect(state.rows[0]).not.toContain(999);
  });

  it("隐藏信息#超时代打的事件里也没有牌面（亮牌前）", () => {
    // 两人都没选：超时代选后直接亮牌（亮牌之后牌面公开是对的）；只代选一部分时，事件只说谁被代选了
    const base = createScene("opening", { players: 3 });
    const partial = timeoutTurn(applyCommand(base, "p1", { type: "select", card: base.players[0]!.hand[0]! }));
    expect(partial.events[0]).toEqual({ type: "TimedOut", phase: "select", players: ["p2", "p3"] });
    expect(partial.reveal).not.toBeNull();
  });
});
