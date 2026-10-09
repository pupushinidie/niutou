import type { CSSProperties } from "react";

/**
 * 美术素材的地址和取法（照 art/spec.md 第 7 节）。现在 public/art/ 里是占位图，出图定稿后同名覆盖，这里不用改。
 * 牌是两张图集：第 n 号（0–104，0 是牌背）在第 n % 10 列、第 ⌊n/10⌋ 行。
 */
const ROOT = `${import.meta.env.BASE_URL}art/`;

export const art = (path: string) => `${ROOT}${path}`;

export type CardSet = "sm" | "lg";

export const CARD = {
  sm: { w: 28, h: 38, src: `${ROOT}cards/cards-sm.png` },
  lg: { w: 42, h: 58, src: `${ROOT}cards/cards-lg.png` },
} as const;

/** 牌的显示尺寸：哪套图集 × 整数倍。sm 不许 1× 显示带数字的牌（数字只有 12px）。 */
export interface CardSize {
  readonly set: CardSet;
  readonly scale: number;
}

export function cardPx(size: CardSize): { w: number; h: number } {
  return { w: CARD[size.set].w * size.scale, h: CARD[size.set].h * size.scale };
}

/** n = 1–104 是牌，0 是牌背。 */
export function cardStyle(n: number, size: CardSize): CSSProperties {
  const { w, h, src } = CARD[size.set];
  const s = size.scale;
  return {
    width: w * s,
    height: h * s,
    backgroundImage: `url(${src})`,
    backgroundSize: `${w * 10 * s}px ${h * 11 * s}px`,
    backgroundPosition: `-${(n % 10) * w * s}px -${Math.floor(n / 10) * h * s}px`,
  };
}

/** 空格、危险格（和牌同尺寸同倍数）。 */
export const slotArt = (set: CardSet) => `${ROOT}cards/slot-${set}.png`;
export const dangerArt = (set: CardSet) => `${ROOT}cards/danger-${set}.png`;
export const dangerStripArt = `${ROOT}cards/danger-strip-sm.png`;

/** 10 个座位色（Player.seat 0–9）。 */
export const SEATS = ["#e5533f", "#3b82f0", "#44b860", "#f0c030", "#9b6ad6", "#f08a2e", "#36c2c9", "#f06aa8", "#eeeae0", "#4a4f5c"] as const;
export const seatColor = (seat: number) => SEATS[((seat % 10) + 10) % 10]!;
/** 座位色上的字用深色还是浅色。 */
export const seatInk = (seat: number) => ([3, 8].includes(seat % 10) ? "#2a1a10" : "#fff4dc");

export const avatarArt = (seat: number) => `${ROOT}avatars/avatar-${((seat % 10) + 10) % 10}.png`;

/** 牌桌背景：按房间码哈希在两张里固定一张。 */
export function sceneFor(room: string, theme: "night" | "day"): string {
  let hash = 0;
  for (const char of room) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `${ROOT}scene/${theme}-${hash % 2}.png`;
}

export const ART = {
  felt: `${ROOT}table/felt.png`,
  rim: `${ROOT}table/rim.png`,
  hero: `${ROOT}scene/hero.png`,
  head16: `${ROOT}ui/head-16.png`,
  head32: `${ROOT}ui/head-32.png`,
  ready: `${ROOT}ui/ready.png`,
  lasso: `${ROOT}ui/lasso.png`,
  star: `${ROOT}ui/sheriff-star.png`,
  kingBull: `${ROOT}ui/king-bull.png`,
  poster: `${ROOT}ui/poster.png`,
  thinking: `${ROOT}ui/thinking.png`,
  dust: `${ROOT}fx/dust.png`,
  headsPop: `${ROOT}fx/heads-pop.png`,
  sparkle: `${ROOT}fx/sparkle.png`,
  lamp: `${ROOT}fx/lamp.png`,
  calf: `${ROOT}sprites/calf-run.png`,
  tumbleweed: `${ROOT}sprites/tumbleweed.png`,
} as const;

/** 样式表里要用的几张图（地址带 BASE_URL，CSS 里写死路径在子路径下会坏）：挂到 :root 的 CSS 变量上。 */
export function installArtVars(): void {
  const style = document.documentElement.style;
  style.setProperty("--felt-img", `url(${ART.felt})`);
  style.setProperty("--rim-img", `url(${ART.rim})`);
  style.setProperty("--thinking-img", `url(${ART.thinking})`);
  style.setProperty("--sparkle-img", `url(${ART.sparkle})`);
  style.setProperty("--lamp-img", `url(${ART.lamp})`);
  style.setProperty("--hero-img", `url(${ART.hero})`);
}
