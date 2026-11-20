import { relativeToProject } from './project';

// React の開発ビルドが要素ごとに持つ「作成場所」（_debugStack）を、ソースマップで元のファイル:行に戻す。
// Turbopack のマップは sections を持つ形式（index map）なので、それも読む
type RawMap = { sources: string[]; mappings: string };
type IndexMap = { sections?: { offset: { line: number; column: number }; map: IndexMap }[] } & Partial<RawMap>;

const mapCache = new Map<string, Promise<IndexMap | null>>();

async function fetchMap(chunkUrl: string): Promise<IndexMap | null> {
  const js = await (await fetch(chunkUrl)).text();
  const name = js.match(/\/\/# sourceMappingURL=(\S+)\s*$/)?.[1];
  if (!name) return null;
  return (await fetch(new URL(name, chunkUrl))).json();
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeVlq(segment: string): number[] {
  const out: number[] = [];
  let value = 0;
  let shift = 0;
  for (const ch of segment) {
    const digit = B64.indexOf(ch);
    value += (digit & 31) << shift;
    if (digit & 32) shift += 5;
    else {
      out.push(value & 1 ? -(value >> 1) : value >> 1);
      value = 0;
      shift = 0;
    }
  }
  return out;
}

/** 0 始まりの生成側の行・列 → 元のファイルと 1 始まりの行 */
function lookup(map: RawMap, line: number, column: number): { source: string; line: number } | null {
  const lines = map.mappings.split(';');
  let src = 0;
  let srcLine = 0;
  let srcCol = 0;
  let best: { source: string; line: number } | null = null;
  for (let i = 0; i <= line && i < lines.length; i++) {
    let genCol = 0;
    for (const seg of lines[i].split(',')) {
      if (!seg) continue;
      const v = decodeVlq(seg);
      genCol += v[0];
      // 生成側の位置だけの区切りは「ここから先は対応なし」の印
      if (v.length < 4) {
        if (i === line && genCol <= column) best = null;
        continue;
      }
      src += v[1];
      srcLine += v[2];
      srcCol += v[3];
      if (i === line && genCol <= column) best = { source: map.sources[src], line: srcLine + 1 };
    }
  }
  return best;
}

function resolveIn(map: IndexMap, line: number, column: number): { source: string; line: number } | null {
  if (!map.sections) return map.mappings ? lookup(map as RawMap, line, column) : null;
  const section = [...map.sections].reverse().find((s) => s.offset.line < line || (s.offset.line === line && s.offset.column <= column));
  if (!section) return null;
  const l = line - section.offset.line;
  return resolveIn(section.map, l, l === 0 ? column - section.offset.column : column);
}

/** スタックのうち、jsxDEV の次の行（要素を作ったコンポーネントの中）を取り出す */
function firstFrame(stack: string): { url: string; line: number; column: number } | null {
  for (const raw of stack.split('\n').slice(1)) {
    // Server Components (Next.js App Router) show up as about://React/Server/file:///…/.next/….js?17
    const m =
      raw.match(/\((?:about:\/\/React\/Server\/)?((?:https?|webpack-internal|file):\/\/.+):(\d+):(\d+)\)$/) ??
      raw.match(/at (?:about:\/\/React\/Server\/)?((?:https?|webpack-internal|file):\/\/\S+):(\d+):(\d+)$/);
    if (!m || /jsxDEV|react-dom|react_stack|react-server-dom|fakeJSXCallSite/.test(raw)) continue;
    return { url: m[1].replace(/\?\d+$/, ''), line: Number(m[2]), column: Number(m[3]) };
  }
  return null;
}

/**
 * webpack の開発ビルド（eval-source-map）は、モジュールごとに eval した文字列の末尾にソースマップを埋めている。
 * 画面の iframe の webpackChunk からモジュールの関数を探し、その文字列から取り出す
 */
async function webpackMap(url: string): Promise<IndexMap | null> {
  const id = decodeURIComponent(url.replace(/^webpack-internal:\/\/\//, ''));
  // shortcut: エディタの iframe が1つだけである前提。iframe が増えたら呼び出し側から window を渡す
  const win = document.querySelector('iframe')?.contentWindow as (Window & Record<string, unknown>) | null;
  if (!win) return null;
  for (const key of Object.keys(win).filter((k) => k.startsWith('webpackChunk'))) {
    for (const chunk of win[key] as [unknown, Record<string, () => void>][]) {
      const fn = chunk?.[1]?.[id];
      if (!fn) continue;
      const b64 = String(fn).match(/sourceMappingURL=data:application\/json;(?:charset=utf-8;)?base64,([A-Za-z0-9+/=]+)/)?.[1];
      if (!b64) return null;
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
    }
  }
  return null;
}

export async function resolveStack(stack: string | undefined): Promise<string | null> {
  const frame = stack && firstFrame(stack);
  if (!frame) return null;
  let map = mapCache.get(frame.url);
  if (!map) {
    const load = frame.url.startsWith('webpack-internal:')
      ? webpackMap(frame.url)
      : frame.url.startsWith('file:')
        ? // A server chunk on disk: the nudgix server reads its .map file
          fetch(`api/server-map?file=${encodeURIComponent(decodeURI(frame.url.slice('file://'.length)))}`).then((r) => (r.ok ? r.json() : null))
        : fetchMap(frame.url);
    mapCache.set(frame.url, (map = load.catch(() => null)));
  }
  const resolved = await map;
  const hit = resolved && resolveIn(resolved, frame.line - 1, frame.column - 1);
  if (!hit) return null;
  const rel = relativeToProject(hit.source);
  return rel ? `${rel}:${hit.line}` : null;
}

/**
 * 要素を作った場所と、その部品を使っている場所を返す。
 * 例: { self: 'src/components/ui/card.tsx:42', usage: 'src/app/dashboard/page.tsx:88' }
 */
// biome-ignore lint: React の内部構造を読む
export const fiberOf = (el: Element): any => {
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  // biome-ignore lint: React の内部構造を読む
  return key ? (el as any)[key] : null;
};

/** その JSX を書いた場所のスタック。開発ビルドだけが持つ */
// biome-ignore lint: React の内部構造を読む
export const stackOf = (f: any): string | undefined => {
  // A client fiber has _debugStack; a Server Component's info object has debugStack
  const stack = f?._debugStack ?? f?.debugStack;
  return stack ? String(stack.stack ?? stack) : undefined;
};

/**
 * Server Components have no fibers in the browser. The element's owner chain still names them
 * ({ name: 'Card', env: 'Server', props, debugStack }), up to the first client component.
 */
// biome-ignore lint: React の内部構造を読む
export function serverOwners(fiber: any): any[] {
  const out = [];
  for (let owner = fiber?._debugOwner; owner && 'env' in owner && out.length < 8; owner = owner.owner) out.push(owner);
  return out;
}

export async function sourceOf(el: Element): Promise<{ self: string | null; usage: string | null }> {
  const fiber = fiberOf(el);
  try {
    const [self, usage] = await Promise.all([resolveStack(stackOf(fiber)), resolveStack(stackOf(fiber?._debugOwner))]);
    return { self, usage: usage !== self ? usage : null };
  } catch {
    return { self: null, usage: null };
  }
}
