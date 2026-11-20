// コードピーク用。選んだ要素の React の部品の連なり、ソースの抜粋、部品の使用箇所、変更の行き先を集める
import type { HighlighterCore } from 'shiki/core';
import type { Dict } from '../i18n';
import { IGNORED_COMPONENTS } from './inspect';
import { adapter } from './adapters';
import { fileOf, matchedRules } from './css';
import { getProjectDir } from './project';
import { fiberOf, resolveStack, serverOwners, sourceOf, stackOf } from './sourcemap';
import type { Change, PropKey } from './types';

export type ReactPart = {
  name: string;
  /** Props の短い表示（children は除く） */
  props: [string, string][];
  /** この部品を JSX で書いた場所のスタック */
  stack: string | undefined;
};

// biome-ignore lint: React の内部構造を読む
const nameOf = (type: any): string | undefined =>
  typeof type === 'string' ? undefined : (type?.displayName ?? type?.name ?? type?.render?.displayName ?? type?.render?.name ?? type?.type?.displayName ?? type?.type?.name);

/** 値を1行の短い文字列にする。関数は ƒ、要素は <Name…>、配列とオブジェクトは中身を縮める */
export function preview(v: unknown, depth = 0): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'string') return JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}…` : v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'function') return `ƒ ${v.name || ''}`.trim();
  if (typeof v === 'object' && '$$typeof' in v) {
    // biome-ignore lint: React 要素
    const type = (v as any).type;
    return `<${typeof type === 'string' ? type : (nameOf(type) ?? '…')} />`;
  }
  if (Array.isArray(v)) return depth > 0 ? `[${v.length}]` : `[${v.slice(0, 3).map((x) => preview(x, depth + 1)).join(', ')}${v.length > 3 ? ', …' : ''}]`;
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (depth > 0) return `{…${keys.length}}`;
    return `{ ${keys
      .slice(0, 3)
      .map((k) => `${k}: ${preview((v as Record<string, unknown>)[k], depth + 1)}`)
      .join(', ')}${keys.length > 3 ? ', …' : ''} }`;
  }
  return String(v);
}

/** 要素から上へたどった部品の連なり（近い順） */
export function reactChain(el: Element, max = 8): ReactPart[] {
  const host = fiberOf(el);
  const out: ReactPart[] = serverOwners(host)
    .filter((o) => o.name && !IGNORED_COMPONENTS.test(o.name))
    .map((o) => ({
      name: o.name,
      props: Object.entries((o.props ?? {}) as Record<string, unknown>)
        .filter(([k]) => k !== 'children')
        .map(([k, v]) => [k, preview(v)] as [string, string]),
      stack: stackOf(o),
    }));
  let fiber = host?.return;
  while (fiber && out.length < max) {
    const name = nameOf(fiber.type);
    if (name && !IGNORED_COMPONENTS.test(name) && !name.endsWith('Provider')) {
      const props = Object.entries((fiber.memoizedProps ?? {}) as Record<string, unknown>)
        .filter(([k]) => k !== 'children')
        .map(([k, v]) => [k, preview(v)] as [string, string]);
      out.push({ name, props, stack: stackOf(fiber) });
    }
    fiber = fiber.return;
  }
  return out;
}

/**
 * ライブラリ（node_modules）の中で作られた要素は書いた場所が取れないので、上の部品へさかのぼり、
 * src の中で最初に JSX を書いた部品とその場所を返す
 */
export async function nearestSrc(el: Element): Promise<{ name: string; loc: string } | null> {
  for (const part of reactChain(el, 12)) {
    const loc = await resolveStack(part.stack).catch(() => null);
    if (loc?.startsWith('src/')) return { name: part.name, loc };
  }
  return null;
}

/** 'src/a.tsx:42' → ファイルと行 */
export const splitLoc = (loc: string) => {
  const m = loc.match(/^(.+):(\d+)$/);
  return m ? { file: m[1], line: Number(m[2]) } : null;
};

export type Snippet = { start: number; lines: string[] };
const snippetCache = new Map<string, Promise<Snippet | null>>();

export function fetchSource(loc: string, around = 12): Promise<Snippet | null> {
  const key = `${loc}|${around}`;
  let p = snippetCache.get(key);
  if (!p) {
    const at = splitLoc(loc);
    p = at
      ? fetch(`api/source?file=${encodeURIComponent(at.file)}&line=${at.line}&around=${around}`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      : Promise.resolve(null);
    snippetCache.set(key, p);
  }
  return p;
}

export type Usages = { count: number; hits: string[] };
const usageCache = new Map<string, Promise<Usages | null>>();

export function fetchUsages(name: string): Promise<Usages | null> {
  let p = usageCache.get(name);
  if (!p) {
    p = fetch(`api/usages?name=${encodeURIComponent(name)}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    usageCache.set(name, p);
  }
  return p;
}

/**
 * NavigationMenuTrigger のような名前は、コードでは <NavigationMenu.Trigger> と書かれることが多い。
 * そのままで見つからなければ、大文字の切れ目にドットを入れた書き方も試し、見つかった書き方の名前を返す
 */
export async function findUsages(name: string): Promise<{ name: string; usages: Usages } | null> {
  const splits = [...name.matchAll(/(?<=[a-z])(?=[A-Z])/g)].map((m) => `${name.slice(0, m.index)}.${name.slice(m.index)}`);
  let first: { name: string; usages: Usages } | null = null;
  for (const n of [name, ...splits]) {
    const usages = await fetchUsages(n);
    if (!usages) continue;
    first ??= { name: n, usages };
    if (usages.count) return { name: n, usages };
  }
  return first;
}

/**
 * ソースの各行に、変更の行き先を注記する。変更前のトークン名（--space-4 など）や元の文字が書かれた行に
 * 「内側 上 → --space-6」のように付ける。行番号 → 注記
 */
export function annotate(snippet: Snippet, change: Change | undefined, t: Dict): Map<number, string[]> {
  const notes = new Map<number, string[]>();
  if (!change) return notes;
  const add = (i: number, note: string) => {
    const n = snippet.start + i;
    notes.set(n, [...(notes.get(n) ?? []), note]);
  };
  for (const [key, next] of Object.entries(change.props) as [PropKey, string][]) {
    const d = change.baseline[key];
    if (d?.how !== 'class') continue;
    const names = adapter().written(key, d.name).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp(`(^|[^\\w.-])(${names.join('|')})(?![\\w.-])`);
    snippet.lines.forEach((line, i) => {
      if (re.test(line)) add(i, `${t.props[key]} → ${adapter().format(key, next)}`);
    });
  }
  if (change.text?.from) {
    snippet.lines.forEach((line, i) => {
      if (line.includes(change.text!.from)) add(i, `${t.text} → 「${change.text!.to}」`);
    });
  }
  return notes;
}

/** 差し込んだストーリーを JSX で書いたときの形 */
export function storyJsx(insert: NonNullable<Change['insert']>): string {
  const name = insert.title.split('/').at(-1) ?? insert.name;
  const attrs = Object.entries(insert.args ?? {})
    .filter(([k]) => k !== 'children')
    .map(([k, v]) => (typeof v === 'string' ? `${k}="${v}"` : v === true ? k : `${k}={${JSON.stringify(v)}}`));
  const children = insert.args?.children;
  const open = `<${name}${attrs.length ? ` ${attrs.join(' ')}` : ''}`;
  return children !== undefined ? `${open}>${children}</${name}>` : `${open} />`;
}

let highlighter: Promise<HighlighterCore> | null = null;

/** ソースの抜粋を色分けする。ライト・ダークの両方の色を CSS 変数（--shiki-light / --shiki-dark）で持たせる */
export async function highlight(lines: string[]): Promise<{ content: string; style: Record<string, string> }[][]> {
  highlighter ??= Promise.all([import('shiki/core'), import('shiki/engine/javascript')]).then(([{ createHighlighterCore }, { createJavaScriptRegexEngine }]) =>
    createHighlighterCore({
      themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
      langs: [import('shiki/langs/tsx.mjs')],
      engine: createJavaScriptRegexEngine(),
    }),
  );
  const { tokens } = (await highlighter).codeToTokens(lines.join('\n'), {
    lang: 'tsx',
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
  });
  return tokens.map((line) => line.map((tk) => ({ content: tk.content, style: (tk.htmlStyle ?? {}) as Record<string, string> })));
}

/**
 * 要素を書いた場所。React なら JSX を書いた場所とその部品を使っている場所、
 * React で無いとき（素の HTML など）は、要素に当たっている一番後ろの CSS の規則の場所を self にする
 */
export async function locate(el: Element): Promise<{ self: string | null; usage: string | null }> {
  const react = await sourceOf(el);
  if (react.self || react.usage) return react;
  for (const rule of matchedRules(el).reverse()) {
    const file = fileOf(rule, getProjectDir());
    if (!file) continue;
    const res = await fetch(`api/find?file=${encodeURIComponent(file)}&text=${encodeURIComponent(rule.selectorText.split(',')[0].trim())}`).catch(() => null);
    const line = res?.ok ? ((await res.json()) as { line: number | null }).line : null;
    return { self: `${file}:${line ?? 1}`, usage: null };
  }
  return react;
}
