// スタイルの仕組みごとの違いをここに閉じ込める。土台は css-vars（画面の CSS 変数と CSS の規則だけで読む）で、
// どの構成でも動く。Tailwind などはアダプターを足して、トークンの読み方とプロンプトの書き方の精度を上げる
import { declaredValue, matchedRules, rootVariables } from './css';
import type { PropDef } from './props';
import type { Category, PropKey, Token, Tokens } from './types';

export type AdapterId = 'css-vars' | 'tailwind-v4';

export type Adapter = {
  id: AdapterId;
  /** トークン一覧。サーバーが読んだもの（Tailwind）か、画面のスタイルシートから集めたもの（CSS 変数） */
  tokens: (doc: Document, fromServer: Tokens | null) => Tokens;
  /** 要素の書き方（class や CSS の規則）から、当たっているトークンを確かめる。list は計算値が同じトークン */
  bySource: (el: Element, prop: PropDef, list: Token[]) => Token | undefined;
  /** プロンプトでのトークンの書き方 */
  format: (key: PropKey, name: string) => string;
  /** 要素のスタイルの手がかり（class やセレクタ）。プロンプトとコードタブに出す */
  hints: (el: Element) => string[];
};

export const emptyTokens = (): Tokens => ({ colors: [], spacing: [], fontSizes: [], fontWeights: [], radii: [], shadows: [], sizes: [], textStyles: [] });

const isLength = (v: string) => /\d/.test(v) && CSS.supports('width', v);

/** 変数の名前と値から、どの種類のトークンかを決める。決められないものは使わない */
export function categoryOf(name: string, value: string): Category | null {
  const n = name.toLowerCase();
  if (/shadow|elevation/.test(n)) return 'shadows';
  if (/radius|radii|rounded|corner/.test(n)) return 'radii';
  if (/weight/.test(n) && /^\d{3}$/.test(value)) return 'fontWeights';
  if (/font-size|text-size|fs-|type-scale|^--text-[\w-]+$/.test(n) && isLength(value)) return 'fontSizes';
  if (!/^-?[\d.]/.test(value) && CSS.supports('color', value)) return 'colors';
  if (isLength(value)) return /size|width|height|container|breakpoint|screen/.test(n) ? 'sizes' : 'spacing';
  return null;
}

const cssVars: Adapter = {
  id: 'css-vars',
  tokens(doc) {
    const out = emptyTokens();
    const root = doc.defaultView!.getComputedStyle(doc.documentElement);
    for (const name of rootVariables(doc)) {
      // フレームワークや nudgix 自身の内部用の変数は出さない
      if (/^--(tw-|nudgix|next-|vite-)/.test(name)) continue;
      const value = root.getPropertyValue(name).trim();
      const category = value ? categoryOf(name, value) : null;
      if (category) out[category].push({ name, css: `var(${name})`, description: value });
    }
    return out;
  },
  bySource(el, prop, list) {
    const name = declaredValue(el, prop.css[0]).match(/var\(\s*(--[\w-]+)/)?.[1];
    return name ? list.find((t) => t.name === name) : undefined;
  },
  format: (_key, name) => name,
  hints: (el) => [...new Set(matchedRules(el).map((r) => r.selectorText))].slice(-4),
};

const ADAPTERS: Record<AdapterId, Adapter> = { 'css-vars': cssVars, 'tailwind-v4': cssVars };

let current: Adapter = cssVars;
export const adapter = () => current;
export const setAdapter = (id: AdapterId) => {
  current = ADAPTERS[id] ?? cssVars;
};
