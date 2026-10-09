import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ART, cardPx, cardStyle, type CardSize } from "./art.js";
import type { RevealAnim } from "./reveal.js";

/**
 * 亮牌动画的飞行层：飞牌、整排飞向收牌人、尘土、牛头冒出、「+N」飘字、没人收牌时滚过的风滚草。
 * 位置每帧按 DOM 实测（亮牌条 data-strip、格子 data-cell、排头 data-rowhead、头像 data-avatar），只用 transform 位移和缩放。
 * 精灵图的帧号也按时钟算，预览页把时钟冻住就能截到动画中间的任意一帧。
 */
interface FlyLayerProps {
  readonly anim: RevealAnim | null;
  readonly now: () => number;
  readonly rows: CardSize;
  /** 玩家 id → 名字（飘字不需要，留给读屏）。 */
  readonly frozen: boolean;
  readonly reduced: boolean;
}

const FLOAT_MS = 1400;

function rectOf(selector: string): DOMRect | null {
  const element = document.querySelector(selector);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return rect.width === 0 && rect.height === 0 ? null : rect;
}

const ease = (p: number) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
const clamp01 = (p: number) => Math.max(0, Math.min(1, p));

interface Sprite {
  key: string;
  style: CSSProperties;
  className?: string;
  text?: string;
}

function spriteFrame(src: string, frames: number, frame: number, w: number, h: number, scale: number): CSSProperties {
  return {
    width: w * scale,
    height: h * scale,
    backgroundImage: `url(${src})`,
    backgroundSize: `${w * frames * scale}px ${h * scale}px`,
    backgroundPosition: `-${Math.min(frames - 1, Math.max(0, frame)) * w * scale}px 0`,
  };
}

export default function FlyLayer({ anim, now, rows, frozen, reduced }: FlyLayerProps) {
  const [, setTick] = useState(0);
  const raf = useRef<number | null>(null);

  // 逐帧重画：动画期间和飘字还没散的时候
  useEffect(() => {
    if (!anim || reduced) return;
    if (frozen) {
      // 冻住的时钟：等版面排好、图片载入后再画两次
      const a = window.setTimeout(() => setTick((value) => value + 1), 60);
      const b = window.setTimeout(() => setTick((value) => value + 1), 400);
      return () => {
        window.clearTimeout(a);
        window.clearTimeout(b);
      };
    }
    const loop = () => {
      setTick((value) => value + 1);
      if (now() < anim.total + FLOAT_MS + 200) raf.current = window.requestAnimationFrame(loop);
      else raf.current = null;
    };
    raf.current = window.requestAnimationFrame(loop);
    return () => {
      if (raf.current !== null) window.cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [anim, frozen, reduced]);

  if (!anim || reduced) return null;
  const t = now();
  if (t > anim.total + FLOAT_MS + 200) return null;
  const size = cardPx(rows);
  const sprites: Sprite[] = [];

  const flyCard = (key: string, card: number, from: DOMRect | null, to: DOMRect | null, p: number, endScale = 1) => {
    if (!from || !to) return;
    const q = ease(clamp01(p));
    const startScale = from.width / size.w;
    const scale = startScale + (endScale - startScale) * q;
    const fromX = from.left + from.width / 2;
    const fromY = from.top + from.height / 2;
    const toX = to.left + to.width / 2;
    const toY = to.top + to.height / 2;
    const x = fromX + (toX - fromX) * q - size.w / 2;
    // 飞的时候稍微往上拱一点
    const y = fromY + (toY - fromY) * q - size.h / 2 - Math.sin(Math.PI * q) * 24;
    sprites.push({
      key,
      className: "nt-fly-card",
      style: { ...cardStyle(card, rows), transform: `translate(${Math.round(x)}px, ${Math.round(y)}px) scale(${scale.toFixed(3)})` },
    });
  };

  for (const beat of anim.beats) {
    const step = beat.step >= 0 ? anim.steps[beat.step]! : null;
    const local = t - beat.t0;
    if (!step) continue;
    const avatar = rectOf(`[data-avatar="${step.player}"]`);
    // 正在飞的那一拍
    if (local >= 0 && local < beat.dur) {
      const p = local / beat.dur;
      const strip = rectOf(`[data-strip="${step.card}"]`);
      if (beat.kind === "place") flyCard(`f${step.card}`, step.card, strip, rectOf(`[data-cell="${step.row}-${step.position - 1}"]`), p);
      if (beat.kind === "fly6") flyCard(`f${step.card}`, step.card, strip, rectOf(`[data-cell="${step.row}-5"]`), p);
      if (beat.kind === "flyLow") flyCard(`f${step.card}`, step.card, strip, rectOf(`[data-rowhead="${step.row}"]`), p);
      if (beat.kind === "take" || beat.kind === "takeLow") {
        step.taken.forEach((card, index) => {
          const delayed = clamp01((p - index * 0.06) / (1 - 0.3));
          flyCard(`t${card}`, card, rectOf(`[data-cell="${step.row}-${index}"]`), avatar, delayed, 0.35);
        });
        // 奔跑小牛领着牌往头像跑
        const rowRect = rectOf(`[data-rowhead="${step.row}"]`);
        if (rowRect && avatar) {
          const q = ease(clamp01(p));
          const fromX = rowRect.right;
          const toX = avatar.left + avatar.width / 2;
          const fromY = rowRect.top + rowRect.height / 2;
          const toY = avatar.top + avatar.height / 2;
          const x = fromX + (toX - fromX) * q - 32;
          const y = fromY + (toY - fromY) * q - 32;
          const frame = Math.floor(local / 80) % 6;
          sprites.push({
            key: `calf${step.card}`,
            className: "nt-fly-sprite",
            style: { ...spriteFrame(ART.calf, 6, frame, 32, 32, 2), transform: `translate(${Math.round(x)}px, ${Math.round(y)}px) scaleX(${toX < fromX ? -1 : 1})` },
          });
        }
      }
    }
    // 尘土：整排被收走的那一下（6 帧 × 60ms）
    if ((beat.kind === "take" || beat.kind === "takeLow") && local >= 0 && local < 360) {
      const rowRect = rectOf(`[data-cell="${step.row}-2"]`);
      if (rowRect) {
        const frame = Math.floor(local / 60);
        const style = spriteFrame(ART.dust, 6, frame, 32, 32, 2);
        sprites.push({
          key: `dust${step.card}`,
          className: "nt-fly-sprite",
          style: { ...style, transform: `translate(${Math.round(rowRect.left + rowRect.width / 2 - 32)}px, ${Math.round(rowRect.top + rowRect.height / 2 - 32)}px)` },
        });
      }
    }
    // 收完：头像上冒牛头、飘「+N」
    if ((beat.kind === "land" || beat.kind === "landLow") && step.bulls > 0 && avatar) {
      const since = t - beat.t0;
      if (since >= 0 && since < FLOAT_MS) {
        const lift = Math.round((since / FLOAT_MS) * 48);
        sprites.push({
          key: `pop${step.card}`,
          className: "nt-fly-sprite",
          style: { ...spriteFrame(ART.headsPop, 6, Math.floor(since / 90), 32, 32, 2), transform: `translate(${Math.round(avatar.left + avatar.width / 2 - 32)}px, ${Math.round(avatar.top - 40)}px)` },
        });
        sprites.push({
          key: `plus${step.card}`,
          className: "nt-fly-plus",
          text: `+${step.bulls}`,
          style: { transform: `translate(${Math.round(avatar.right - 8)}px, ${Math.round(avatar.top - 12 - lift)}px)` },
        });
      }
    }
  }

  // 一整手没人收牌：风滚草从牌桌底下滚过去（西部片的「冷场」）
  const anyTake = anim.steps.slice(anim.from).some((step) => step.taken.length > 0);
  if (!anyTake && anim.from === 0 && t >= anim.total - 200 && t < anim.total + 1200) {
    const table = rectOf(".nt-table");
    if (table) {
      const p = clamp01((t - anim.total + 200) / 1400);
      const x = table.left + (table.width + 48) * p - 48;
      sprites.push({
        key: "weed",
        className: "nt-fly-sprite",
        style: { ...spriteFrame(ART.tumbleweed, 8, Math.floor(t / 80) % 8, 24, 24, 2), transform: `translate(${Math.round(x)}px, ${Math.round(table.bottom - 56)}px)` },
      });
    }
  }

  return (
    <div className="nt-fly-layer" aria-hidden="true">
      {sprites.map((sprite) => (
        <div key={sprite.key} className={sprite.className} style={sprite.style}>
          {sprite.text && <><img src={ART.head16} alt="" /><b>{sprite.text}</b></>}
        </div>
      ))}
    </div>
  );
}
