// How values are displayed in the panel. Computed values can be long (lab() etc.), so make them readable
import type { Category } from './types';

const px = (v: string | undefined) => (v && /^-?[\d.]+px$/.test(v) ? Number.parseFloat(v) : null);

/** Difference between px values (+4 etc.). Skipped for "huge" values like radius full, where a difference means nothing */
export const deltaText = (from: string | undefined, to: string | undefined) => {
  const a = px(from);
  const b = px(to);
  if (a === null || b === null || a === b || Math.max(a, b) >= 999) return '';
  return `${b > a ? '+' : ''}${Math.round((b - a) * 10) / 10}`;
};

let ctx: CanvasRenderingContext2D | null = null;
const hex = (n: number) => n.toString(16).padStart(2, '0');

/** Convert a color to #rrggbb (#rrggbbaa with alpha). Even lab() becomes sRGB by painting 1px and reading it back */
export function hexOf(color: string) {
  ctx ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  if (!ctx) return color;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${hex(r)}${hex(g)}${hex(b)}${a < 255 ? hex(a) : ''}`;
}

/** Show huge px like radius full (1.67772e+07px etc.) as 9999px+, and fractions like 195.586px with one decimal */
const tidyPx = (value: string) => {
  if (!/^[\d.e+]+px$/.test(value)) return value;
  const n = Number.parseFloat(value);
  return n > 9999 ? '9999px+' : `${Math.round(n * 10) / 10}px`;
};

export const displayValue = (category: Category, value: string) => (category === 'colors' && value ? hexOf(value) : tidyPx(value));
