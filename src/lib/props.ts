import type { Category, PropKey, Token, Tokens } from './types';

export type Group = 'color' | 'text' | 'space' | 'size' | 'radius' | 'effect';

export type PropDef = {
  key: PropKey;
  group: Group;
  category: Category;
  /** プレビューで上書きする CSS プロパティ */
  css: string[];
  /** 要素の現在値の読み方 */
  read?: (cs: CSSStyleDeclaration) => string;
};

/** 影の計算値から、色が透明か大きさが0の見えないレイヤー（Tailwind の ring の下地など）を落とす */
export const visibleShadow = (value: string) =>
  value
    .split(/,(?![^(]*\))/)
    .map((layer) => layer.trim())
    .filter((layer) => layer !== 'none' && !/^rgba\([^)]*,\s*0\)/.test(layer) && !/\)\s+0px 0px 0px 0px$/.test(layer))
    .join(', ') || 'none';

export const PROPS: PropDef[] = [
  { key: 'color', group: 'color', category: 'colors', css: ['color'], read: (cs) => cs.color },
  { key: 'backgroundColor', group: 'color', category: 'colors', css: ['background-color'], read: (cs) => cs.backgroundColor },
  { key: 'borderColor', group: 'color', category: 'colors', css: ['border-color'], read: (cs) => cs.borderTopColor },
  { key: 'textStyle', group: 'text', category: 'textStyles', css: ['font-size', 'line-height', 'font-weight', 'letter-spacing'] },
  { key: 'fontSize', group: 'text', category: 'fontSizes', css: ['font-size'], read: (cs) => cs.fontSize },
  { key: 'fontWeight', group: 'text', category: 'fontWeights', css: ['font-weight'], read: (cs) => cs.fontWeight },
  { key: 'paddingTop', group: 'space', category: 'spacing', css: ['padding-top'], read: (cs) => cs.paddingTop },
  { key: 'paddingRight', group: 'space', category: 'spacing', css: ['padding-right'], read: (cs) => cs.paddingRight },
  { key: 'paddingBottom', group: 'space', category: 'spacing', css: ['padding-bottom'], read: (cs) => cs.paddingBottom },
  { key: 'paddingLeft', group: 'space', category: 'spacing', css: ['padding-left'], read: (cs) => cs.paddingLeft },
  { key: 'gap', group: 'space', category: 'spacing', css: ['gap'], read: (cs) => cs.columnGap },
  { key: 'marginTop', group: 'space', category: 'spacing', css: ['margin-top'], read: (cs) => cs.marginTop },
  { key: 'marginBottom', group: 'space', category: 'spacing', css: ['margin-bottom'], read: (cs) => cs.marginBottom },
  { key: 'marginLeft', group: 'space', category: 'spacing', css: ['margin-left'], read: (cs) => cs.marginLeft },
  { key: 'marginRight', group: 'space', category: 'spacing', css: ['margin-right'], read: (cs) => cs.marginRight },
  { key: 'width', group: 'size', category: 'sizes', css: ['width'], read: (cs) => cs.width },
  { key: 'height', group: 'size', category: 'sizes', css: ['height'], read: (cs) => cs.height },
  { key: 'borderRadius', group: 'radius', category: 'radii', css: ['border-radius'], read: (cs) => cs.borderTopLeftRadius },
  { key: 'boxShadow', group: 'effect', category: 'shadows', css: ['box-shadow'], read: (cs) => visibleShadow(cs.boxShadow) },
];

/** 保存した名前からトークンを引く。一覧に無い名前は、パネルで直接入れた値（13px、#ff0000 など）として扱う */
export const tokenOf = (tokens: Tokens | null | undefined, category: Category, name: string | undefined): Token | undefined => {
  if (!name) return undefined;
  return tokens?.[category].find((x) => x.name === name) ?? { name, description: '', raw: true };
};

/** 直接入れた値を CSS の値に直す。単位の無い数は px にする（太さは数のまま）。当てられない値は null */
export function rawValue(prop: PropDef, input: string): string | null {
  const v = input.trim();
  if (!v || prop.key === 'textStyle') return null;
  const value = /^-?\d+(\.\d+)?$/.test(v) && prop.key !== 'fontWeight' ? `${v}px` : v;
  return CSS.supports(prop.css[0], value) ? value : null;
}

export const PROP_BY_KEY = Object.fromEntries(PROPS.map((p) => [p.key, p])) as Record<PropKey, PropDef>;

export const GROUPS: Group[] = ['color', 'text', 'space', 'size', 'radius', 'effect'];

// プロンプトでは上下・左右がそろった余白を1行にまとめる
export const MERGES: { name: string; keys: PropKey[] }[] = [
  { name: 'padding', keys: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] },
  { name: 'paddingBlock', keys: ['paddingTop', 'paddingBottom'] },
  { name: 'paddingInline', keys: ['paddingLeft', 'paddingRight'] },
];

