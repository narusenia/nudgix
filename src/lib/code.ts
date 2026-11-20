// For code peek. Collects the selected element's React component chain, source excerpts, component usages and where changes land
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
  /** Short display of props (excluding children) */
  props: [string, string][];
  /** Stack of where this component was written in JSX */
  stack: string | undefined;
};

// biome-ignore lint: reads React internals
const nameOf = (type: any): string | undefined =>
  typeof type === 'string' ? undefined : (type?.displayName ?? type?.name ?? type?.render?.displayName ?? type?.render?.name ?? type?.type?.displayName ?? type?.type?.name);

/** Turn a value into a short one-line string. Functions become ƒ, elements <Name…>, arrays and objects are abbreviated */
export function preview(v: unknown, depth = 0): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'string') return JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}…` : v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'function') return `ƒ ${v.name || ''}`.trim();
  if (typeof v === 'object' && '$$typeof' in v) {
    // biome-ignore lint: React element
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

/** Component chain walked up from the element (nearest first) */
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
 * Elements created inside a library (node_modules) have no source location, so walk up the components and
 * return the first component whose JSX is written in the project, with its location
 */
export async function nearestSrc(el: Element): Promise<{ name: string; loc: string } | null> {
  for (const part of reactChain(el, 12)) {
    const loc = await resolveStack(part.stack).catch(() => null);
    if (loc) return { name: part.name, loc };
  }
  return null;
}

/** 'src/a.tsx:42' → file and line */
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
 * Names like NavigationMenuTrigger are often written as <NavigationMenu.Trigger> in code.
 * If the name as is is not found, also try with dots at the capital-letter boundaries, and return the spelling that was found
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
 * Annotate source lines with where changes land. Lines containing the original token name (--space-4 etc.) or original text
 * get notes like "padding top → --space-6". Line number → note
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
      if (line.includes(change.text!.from)) add(i, `${t.text} → ${t.quote(change.text!.to)}`);
    });
  }
  return notes;
}

/** How an inserted story would look written as JSX */
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

/** Syntax-highlight a source excerpt. Both light and dark colors are carried as CSS variables (--shiki-light / --shiki-dark) */
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
 * Where the element is written. For React, where the JSX is written and where its component is used.
 * Without React (plain HTML etc.), self is the location of the last CSS rule matching the element
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
