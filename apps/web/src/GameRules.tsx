import { useEffect, useState } from "react";
import { ART, cardStyle, type CardSize } from "./art.js";

/**
 * 规则说明：一个按钮 + 像素弹窗。用自己的话写，配游戏里的牌图。内容和 README 的规则说明一致。
 */
const SM2: CardSize = { set: "sm", scale: 2 };

function Card({ n }: { n: number }) {
  return <span className="nt-card" style={cardStyle(n, SM2)} role="img" aria-label={`${n}`} />;
}

export function RulesBody() {
  return (
    <div className="nt-rules-body">
      <section>
        <h3><img src={ART.head16} alt="" width={16} height={16} /> 牛头是罚分</h3>
        <p>104 张牌，每张印着 1–7 个牛头。收到的每个牛头罚 1 分。有人累计到 <b>66</b> 分的那一局打完就结束，<b>罚分最少</b>的人赢，一样少就一起赢。</p>
        <div className="nt-rules-cards">
          <figure><Card n={7} /><figcaption>大多数 1 个</figcaption></figure>
          <figure><Card n={25} /><figcaption>个位 5：2 个</figcaption></figure>
          <figure><Card n={30} /><figcaption>整十：3 个</figcaption></figure>
          <figure><Card n={44} /><figcaption>11 的倍数：5 个</figcaption></figure>
          <figure><Card n={55} /><figcaption>55：7 个</figcaption></figure>
        </div>
      </section>
      <section>
        <h3>每一手</h3>
        <ol>
          <li>大家<b>同时</b>选一张手牌扣下（点一张，再点「确认」）。最后一个人确认前都能撤回。</li>
          <li>一起亮牌，按数字<b>从小到大</b>一张张放进桌上 4 排。</li>
          <li>只看每排<b>最后一张</b>：接在比你小、又最接近你的那一排后面，不能自己挑。</li>
        </ol>
        <div className="nt-rules-example">
          <span className="nt-rules-row"><Card n={20} /><Card n={23} /></span>
          <span className="nt-rules-arrow">← 25 接这里（23 最接近）</span>
        </div>
      </section>
      <section>
        <h3>什么时候收牌</h3>
        <ul>
          <li>一排最多 5 张。你的牌是<b>第六张</b>：收走前面 5 张，你的牌变成这一排的第一张。</li>
          <li>你的牌<b>比 4 排的最后一张都小</b>：自己挑一排整排收走（挑牛头少的），你的牌变成这一排的第一张。</li>
          <li>收来的牌只算罚分，不进手牌。10 手打完一局，再重新发牌。</li>
        </ul>
      </section>
      <section>
        <h3>其他</h3>
        <ul>
          <li>开房可以改目标分、打固定几局、开战术模式（只用 1 到「人数×10+4」号牌，每张都会出）。</li>
          <li>选牌 30 秒、挑排 20 秒。超时系统替你出，连续 2 次转托管（人机代打），点「取消托管」拿回来。</li>
          <li>掉线后用原昵称和房间码进来，回到自己的座位。</li>
        </ul>
      </section>
    </div>
  );
}

function GameRules({ className = "quiet-button" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button className={`${className} nt-rules-button`} type="button" aria-expanded={open} onClick={() => setOpen(true)} data-tutorial="rules-button">规则</button>
      {open && (
        <div className="gm-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section className="gm-panel nt-rules" role="dialog" aria-modal="true" aria-labelledby="nt-rules-title">
            <div className="nt-rules-head">
              <h2 id="nt-rules-title">谁是牛头王 · 规则</h2>
              <button className="quiet-button" type="button" onClick={() => setOpen(false)}>关闭</button>
            </div>
            <RulesBody />
          </section>
        </div>
      )}
    </>
  );
}

export default GameRules;
