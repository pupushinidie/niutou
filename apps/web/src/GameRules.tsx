import { useState } from "react";

/** 规则说明：用自己的话写，不照搬原版规则书。界面阶段可以重新排版，内容和 README 的规则说明一致。 */
function GameRules() {
  const [open, setOpen] = useState(false);

  return (
    <section className={open ? "game-rules open" : "game-rules"}>
      <button
        className="game-rules-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="game-rules-panel"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">✦</span> 游戏规则
        <i aria-hidden="true">{open ? "收起 ▴" : "展开 ▾"}</i>
      </button>

      {open && (
        <div className="game-rules-panel" id="game-rules-panel">
          <div className="game-rules-block">
            <h3>目标</h3>
            <p>
              104 张数字牌，每张印着 1–7 个牛头。收到的每个牛头都是 <b>1 分罚分</b>。打若干局，
              某一局打完时有人累计罚分到 <b>66</b>（房主可以改），游戏结束，<b>罚分最少</b>的人赢，一样少就一起赢。
            </p>
            <p>牛头：55 是 7 个；11 的倍数 5 个；整十 3 个；个位是 5 的 2 个；其余 1 个。</p>
          </div>

          <div className="game-rules-block">
            <h3>每一手</h3>
            <ul>
              <li>每局每人 10 张手牌，桌上 4 排各一张。每一手<b>所有人同时</b>选一张牌；选好以后、最后一个人确认之前都能撤回改选。</li>
              <li>最后一个人一确认就亮牌，按数字<b>从小到大</b>一张张放进 4 排。</li>
              <li>每张牌只看各排的<b>最后一张</b>：接在比它小、而且最接近它的那一排后面，不能自己挑。</li>
              <li>那一排已经有 5 张，你的牌就是第六张：<b>收走那 5 张</b>，你的牌成为这一排新的第一张。</li>
              <li>你的牌比 4 排的最后一张都小：<b>自己挑一排整排收走</b>（不管几张），你的牌成为这一排的第一张。</li>
              <li>收来的牌不进手牌，只算罚分。10 手打完一局，罚分记进累计，再重新发牌。</li>
            </ul>
          </div>

          <div className="game-rules-block">
            <h3>开房选项</h3>
            <ul>
              <li>目标分：默认 66，可以改成别的。</li>
              <li>固定局数：打满几局就结束，不看目标分。</li>
              <li>战术模式：只用 1 到「人数 × 10 + 4」号牌，每张都会出，可以算牌。</li>
            </ul>
          </div>

          <div className="game-rules-block">
            <h3>其他</h3>
            <ul>
              <li>选牌限时 30 秒、挑排限时 20 秒（都从上一手的动画放完算起）。超时由系统替你出：优先出能安全接上、离排尾最近的牌；挑排挑牛头最少的。连续超时 2 次转为托管。</li>
              <li>一局结束后停 5 秒看结算，大家都点「继续」就马上发下一局。</li>
              <li>洗牌在服务器上，谁也做不了手脚。掉线后用原昵称和房间码可以回到自己的座位。</li>
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

export default GameRules;
