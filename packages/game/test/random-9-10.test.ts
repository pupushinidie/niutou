/** 随机对局 9–10 人，每种人数 300 局（不变量见 random-harness.ts）。分成三个文件让 vitest 并行跑。 */
import { describe, expect, it } from "vitest";
import { GAMES_PER_COUNT, runGames } from "./random-harness.js";

describe("随机对局：每种人数 300 局（9–10 人）", () => {
  for (let count = 9; count <= 10; count += 1) {
    it(`随机对局#${count} 人 ${GAMES_PER_COUNT} 局（含三种变体组合）不变量全部成立`, async () => {
      const { failure, stats } = await runGames(count);
      expect(failure).toBeNull();
      expect(stats.games).toBe(GAMES_PER_COUNT);
      // 这些情况在 300 局里都应该出现过，说明随机走法覆盖到了
      expect(stats.chooseRows).toBeGreaterThan(0);
      expect(stats.sixths).toBeGreaterThan(0);
      expect(stats.timeouts).toBeGreaterThan(0);
      expect(stats.unselects).toBeGreaterThan(0);
      console.log(`${count} 人：${stats.games} 局，平均 ${(stats.rounds / stats.games).toFixed(1)} 局 · ${(stats.steps / stats.games).toFixed(0)} 步，最多 ${stats.maxSteps} 步；亮牌 ${stats.reveals}、规则 C ${stats.chooseRows}、第六张 ${stats.sixths}、整步超时 ${stats.timeouts}、撤回 ${stats.unselects}、并列获胜 ${stats.ties}`);
    }, 120_000);
  }
});
