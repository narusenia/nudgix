// Keeps the differences between styling systems in one place. The base is css-vars (reads only the page's CSS variables and CSS rules),
// which works with any setup. Adapters for Tailwind and others improve how tokens are read and how prompts are written
import { declaredValue, matchedRules, rootRules, rootVariables } from './css';
import type { PropDef } from './props';
import type { Category, PropKey, Token, Tokens } from './types';

export type AdapterId = 'css-vars' | 'tailwind-v4' | 'panda' | 'stylex';

export type Adapter = {
  id: AdapterId;
  /** Token list. Either read by the server (Tailwind) or collected from the page's stylesheets (CSS variables) */
  // biome-ignore lint: each adapter knows the shape its server part sends
  tokens: (doc: Document, fromServer: any) => Tokens;
  /** Determine the applied token from how the element is styled (class or CSS rule). list holds tokens with the same computed value */
  bySource: (el: Element, prop: PropDef, list: Token[]) => Token | undefined;
  /** How a token is written in the prompt. key is a PropKey or a merged name (padding, paddingBlock, paddingInline) */
  format: (key: string, name: string) => string;
  /** Ways the token can appear in source, used to annotate the code peek (p-4, px-4 and pl-4 for paddingLeft 4) */
  written: (key: PropKey, name: string) => string[];
  /** Style hints for the element (classes or selectors). Shown in the prompt and the Code tab */
  hints: (el: Element) => string[];
};

export const emptyTokens = (): Tokens => ({ colors: [], spacing: [], fontSizes: [], fontWeights: [], radii: [], shadows: [], sizes: [], textStyles: [] });

const isLength = (v: string) => /\d/.test(v) && CSS.supports('width', v);

/** Decide the token kind from the variable's name and value. Variables that cannot be classified are skipped */
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
      // Hide internal variables of frameworks and of nudgix itself
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
  tokens(doc, fromServer: Tokens | null) {
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

// Panda turns every token into a variable named after its path (colors.brand.500 → --colors-brand-500) and every
// utility class uses it (.p_6 { padding: var(--spacing-6) }), so tokens and detection both go through variables.
// The server sends the token paths from styled-system/tokens, which tell camelCase and nested keys apart
const PANDA: Record<string, Category> = {
  colors: 'colors',
  spacing: 'spacing',
  sizes: 'sizes',
  radii: 'radii',
  'font-sizes': 'fontSizes',
  'font-weights': 'fontWeights',
  shadows: 'shadows',
};
const pandaKey = (s: string) =>
  s
    .replace(/\\/g, '')
    .replace(/([a-z\d])([A-Z])/g, '$1-$2')
    .replace(/\./g, '-')
    .toLowerCase();

const panda: Adapter = {
  id: 'panda',
  tokens(doc, fromServer: { paths: string[] } | null) {
    const paths = new Map((fromServer?.paths ?? []).map((p) => [`--${pandaKey(p)}`, p]));
    const root = doc.defaultView!.getComputedStyle(doc.documentElement);
    const out = emptyTokens();
    for (const name of rootVariables(doc)) {
      const m = name.match(/^--(colors|spacing|sizes|radii|font-sizes|font-weights|shadows)-(.+)$/);
      const value = m && !/color-?palette/i.test(name) ? root.getPropertyValue(name).trim() : '';
      if (!m || !value) continue;
      const path = paths.get(pandaKey(name));
      // shortcut: without the paths (codegen not run) every dash reads as a dot, which is wrong for camelCase keys
      const tokenName = path ? path.slice(path.indexOf('.') + 1) : m[2].replace(/\\?[.-]/g, '.');
      out[PANDA[m[1]]].push({ name: tokenName, css: `var(${CSS.escape(name)})`, description: value });
    }
    return out;
  },
  bySource(el, prop, list) {
    const name = declaredValue(el, prop.css[0]).match(/var\(\s*(--[\w\\.-]+)/)?.[1];
    return name ? list.find((t) => t.css && pandaKey(t.css.slice(4, -1)) === pandaKey(name)) : undefined;
  },
  format: (_key, name) => `'${name}'`,
  written: (_key, name) => [`'${name}'`, `"${name}"`],
  hints: (el) => [...el.classList].slice(0, 8),
};

// StyleX hashes variable names (--x17ej7d8) and class names, so only the source knows colors.brand.
// Each defineVars becomes one `:root, .xhash { … }` rule listing its keys in source order. The server sends the
// groups parsed from *.stylex.* files; here each group is matched to the rule whose values agree best
type StylexGroup = { name: string; vars: { key: string; value: string | null }[] };
const norm = (v: string) =>
  v
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^#([\da-f])\1([\da-f])\2([\da-f])\3$/, '#$1$2$3')
    .replace(/^(white)$/, '#fff')
    .replace(/^(black)$/, '#000');

const stylex: Adapter = {
  id: 'stylex',
  tokens(doc, fromServer: { groups: StylexGroup[] } | null) {
    const out = emptyTokens();
    const root = doc.defaultView!.getComputedStyle(doc.documentElement);
    const rules = rootRules(doc).map((rule) => [...rule.style].filter((p) => p.startsWith('--')).map((p) => [p, rule.style.getPropertyValue(p)] as const));
    const used = new Set<number>();
    for (const group of fromServer?.groups ?? []) {
      let best = -1;
      let bestScore = 0;
      rules.forEach((vars, i) => {
        if (used.has(i) || vars.length !== group.vars.length) return;
        const score = group.vars.filter((v, j) => v.value !== null && norm(v.value) === norm(vars[j][1])).length;
        if (score > bestScore) [best, bestScore] = [i, score];
      });
      if (best < 0) continue;
      used.add(best);
      group.vars.forEach((v, j) => {
        const variable = rules[best][j][0];
        const name = `${group.name}.${v.key}`;
        const value = root.getPropertyValue(variable).trim();
        // categoryOf reads words like radius or font-size from the name, so give it a kebab-case one
        const category = value ? categoryOf(`--${name.replace(/([a-z\d])([A-Z])/g, '$1-$2').replace(/\./g, '-')}`, value) : null;
        if (category) out[category].push({ name, css: `var(${variable})`, description: value });
      });
    }
    return out;
  },
  bySource(el, prop, list) {
    const name = declaredValue(el, prop.css[0]).match(/var\(\s*(--[\w-]+)/)?.[1];
    return name ? list.find((t) => t.css === `var(${name})`) : undefined;
  },
  format: (_key, name) => name,
  written: (_key, name) => [name],
  // Class names are hashes, so they say nothing to a reader
  hints: () => [],
};

const ADAPTERS: Record<AdapterId, Adapter> = { 'css-vars': cssVars, 'tailwind-v4': tailwindV4, panda, stylex };

let current: Adapter = cssVars;
export const adapter = () => current;
export const setAdapter = (id: AdapterId) => {
  current = ADAPTERS[id] ?? cssVars;
};
