// パネルに出す値の書き方。計算値はそのままだと長い（lab() など）ので、読みやすい形にする
import type { Category } from './types';

const px = (v: string | undefined) => (v && /^-?[\d.]+px$/.test(v) ? Number.parseFloat(v) : null);

/** px の値どうしの差（+4 など）。角丸の full のような「とても大きい値」は差に意味が無いので出さない */
export const deltaText = (from: string | undefined, to: string | undefined) => {
  const a = px(from);
  const b = px(to);
  if (a === null || b === null || a === b || Math.max(a, b) >= 999) return '';
  return `${b > a ? '+' : ''}${Math.round((b - a) * 10) / 10}`;
};

let ctx: CanvasRenderingContext2D | null = null;
const hex = (n: number) => n.toString(16).padStart(2, '0');

/** 色を #rrggbb（透明度があれば #rrggbbaa）にする。lab() なども、1px 塗って読み戻せば sRGB になる */
export function hexOf(color: string) {
  ctx ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  if (!ctx) return color;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${hex(r)}${hex(g)}${hex(b)}${a < 255 ? hex(a) : ''}`;
}

/** 角丸の full のような、とても大きい px（1.67772e+07px など）は 9999px+ に、195.586px のような端数は小数1桁にする */
const tidyPx = (value: string) => {
  if (!/^[\d.e+]+px$/.test(value)) return value;
  const n = Number.parseFloat(value);
  return n > 9999 ? '9999px+' : `${Math.round(n * 10) / 10}px`;
};

export const displayValue = (category: Category, value: string) => (category === 'colors' && value ? hexOf(value) : tidyPx(value));
