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
  /** How a token is written in the prompt. key is a PropKey or a merged name (padding, paddingBlock, paddingInline) */
  format: (key: string, name: string) => string;
  /** Ways the token can appear in source, used to annotate the code peek (p-4, px-4 and pl-4 for paddingLeft 4) */
  written: (key: PropKey, name: string) => string[];
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
  written: (_key, name) => [name],
  hints: (el) => [...new Set(matchedRules(el).map((r) => r.selectorText))].slice(-4),
};

// Tailwind utilities per property, most specific first (pt-4 beats py-4 beats p-4)
const UTILITIES: Record<string, string[]> = {
  color: ['text'],
  backgroundColor: ['bg'],
  borderColor: ['border'],
  textStyle: ['text'],
  fontSize: ['text'],
  fontWeight: ['font'],
  paddingTop: ['pt', 'py', 'p'],
  paddingRight: ['pr', 'px', 'p'],
  paddingBottom: ['pb', 'py', 'p'],
  paddingLeft: ['pl', 'px', 'p'],
  gap: ['gap-x', 'gap'],
  marginTop: ['mt', 'my', 'm'],
  marginBottom: ['mb', 'my', 'm'],
  marginLeft: ['ml', 'mx', 'm'],
  marginRight: ['mr', 'mx', 'm'],
  width: ['w', 'size'],
  height: ['h', 'size'],
  borderRadius: ['rounded'],
  boxShadow: ['shadow'],
  padding: ['p'],
  paddingBlock: ['py'],
  paddingInline: ['px'],
};

const tailwindV4: Adapter = {
  id: 'tailwind-v4',
  // The server reads the theme (node_modules/tailwindcss/theme.css and the project's @theme blocks)
  // Tailwind may emit a theme color in another color space than the theme source (lab() for oklch()), so when the page
  // defines the variable, use it; unused tokens keep the resolved value
  tokens(doc, fromServer) {
    if (!fromServer) return emptyTokens();
    const root = doc.defaultView!.getComputedStyle(doc.documentElement);
    const onPage = (t: Token) => (t.variable && root.getPropertyValue(t.variable).trim() ? { ...t, css: `var(${t.variable})` } : t);
    return Object.fromEntries(Object.entries(fromServer).map(([k, list]) => [k, list.map(onPage)])) as Tokens;
  },
  bySource(el, prop, list) {
    // Only utilities without a variant (md:, hover:) describe the element as it is now
    const classes = new Set([...el.classList].filter((c) => !c.includes(':')));
    for (const prefix of UTILITIES[prop.key] ?? []) {
      const hit = list.find((t) => classes.has(`${prefix}-${t.name}`));
      if (hit) return hit;
    }
    return undefined;
  },
  format: (key, name) => `${UTILITIES[key]?.[0] ?? key}-${name}`,
  written: (key, name) => (UTILITIES[key] ?? []).map((prefix) => `${prefix}-${name}`),
  hints: (el) => [...el.classList].slice(0, 8),
};

const ADAPTERS: Record<AdapterId, Adapter> = { 'css-vars': cssVars, 'tailwind-v4': tailwindV4 };

let current: Adapter = cssVars;
export const adapter = () => current;
export const setAdapter = (id: AdapterId) => {
  current = ADAPTERS[id] ?? cssVars;
};
