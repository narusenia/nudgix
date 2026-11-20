// iframe 内の要素を調べる・プレビューする処理。要素の持ち主の document / window を使う
import { adapter } from './adapters';
import { PROPS, visibleShadow, type PropDef } from './props';
import type { Category, Detection, ElementInfo, PropKey, Token, Tokens } from './types';

// Next.js の内部コンポーネントは手がかりにならないので、コンポーネントの連なりから外す
export const IGNORED_COMPONENTS =
  /^(InnerLayoutRouter|OuterLayoutRouter|RenderFromTemplateContext|ScrollAndFocusHandler|InnerScrollAndFocusHandler|LoadingBoundary|ErrorBoundary.*|HTTPAccessFallback.*|RedirectBoundary|RedirectErrorBoundary|Router|AppRouter|HotReload|ServerRoot|ClientPageRoot|ClientSegmentRoot|SegmentViewNode|SegmentStateProvider|DevRootHTTPAccessFallbackBoundary|AppDevOverlay.*|ReactDevOverlay|Head|MetadataOutlet|OutletBoundary|ViewportBoundary|MetadataBoundary|Suspense|Fragment|_c\d*|Anonymous)$/;

const PROBE_BASE = 'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden;';
const probes = new WeakMap<Document, HTMLElement>();
const resolvedCache = new WeakMap<Document, Map<string, string>>();

export function clearResolvedCache(doc: Document) {
  resolvedCache.delete(doc);
}

// 変数を当てた見えない要素の計算値を読み、要素の計算値と同じ書式で比べられるようにする
export function resolveToken(doc: Document, category: Category, token: Token): string {
  let cache = resolvedCache.get(doc);
  if (!cache) resolvedCache.set(doc, (cache = new Map()));
  const cacheKey = `${category}:${token.name}`;
  const hit = cache.get(cacheKey);
  if (hit !== undefined) return hit;

  let probe = probes.get(doc);
  if (!probe) {
    probe = doc.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probes.set(doc, probe);
  }
  if (!probe.isConnected) doc.documentElement.appendChild(probe);
  probe.style.cssText = PROBE_BASE;
  const cs = doc.defaultView!.getComputedStyle(probe);
  let result: string;
  if (category === 'textStyles') {
    for (const [prop, value] of Object.entries(token.style ?? {})) probe.style.setProperty(prop, value);
    result = `${cs.fontSize} / ${cs.lineHeight}`;
  } else {
    const css = { colors: 'color', spacing: 'padding-top', fontSizes: 'font-size', fontWeights: 'font-weight', radii: 'border-top-left-radius', shadows: 'box-shadow', sizes: 'width' }[category];
    probe.style.setProperty(css, token.raw ? token.name : (token.css ?? ''));
    result = cs.getPropertyValue(css);
    if (category === 'shadows') result = visibleShadow(result);
  }
  probe.style.cssText = PROBE_BASE;
  cache.set(cacheKey, result);
  return result;
}

const isZero = (value: string) => value === '0px' || value === 'rgba(0, 0, 0, 0)' || value === 'transparent' || value === 'none';

// 要素がいま使っているトークンを推定する。書き方（class や CSS の規則）から分かればそれを正とし、
// なければ計算値が同じトークンを候補として挙げる（同じ値のトークンが複数あると1つに決まらない）
export function detect(el: Element, prop: PropDef, tokens: Tokens): Detection {
  const doc = el.ownerDocument;
  const list = tokens[prop.category];
  const cs = doc.defaultView!.getComputedStyle(el);
  if (prop.key === 'textStyle') {
    const value = `${cs.fontSize} / ${cs.lineHeight}`;
    const candidates = list.filter((t) => resolveToken(doc, 'textStyles', t) === value);
    const bySource = adapter().bySource(el, prop, candidates);
    if (bySource) return { name: bySource.name, value, how: 'class' };
    return candidates.length ? { candidates: candidates.map((t) => t.name), value, how: 'value' } : { value, how: 'none' };
  }
  const value = prop.read!(cs);
  // 枠線が無い要素の枠線色は、継承した文字色が出ているだけなので「なし」とする
  if (prop.key === 'borderColor' && cs.borderTopWidth === '0px') return { value, how: 'zero' };
  const candidates = list.filter((t) => resolveToken(doc, prop.category, t) === value);
  const bySource = adapter().bySource(el, prop, candidates);
  if (bySource) return { name: bySource.name, value, how: 'class' };
  if (candidates.length) return { candidates: candidates.map((t) => t.name), value, how: 'value' };
  if (isZero(value) || (prop.key === 'gap' && value === 'normal')) return { value, how: 'zero' };
  return { value, how: 'none' };
}

export function detectAll(el: Element, tokens: Tokens) {
  return Object.fromEntries(PROPS.map((p) => [p.key, detect(el, p, tokens)])) as Record<PropKey, Detection>;
}

export function componentChain(el: Element): string[] {
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  // biome-ignore lint: React の内部構造を読む
  let fiber = key ? (el as any)[key] : null;
  const names: string[] = [];
  while (fiber && names.length < 6) {
    const type = fiber.type;
    if (type && typeof type !== 'string') {
      const name: string | undefined =
        type.displayName ?? type.name ?? type.render?.displayName ?? type.render?.name ?? type.type?.displayName ?? type.type?.name;
      if (name && !IGNORED_COMPONENTS.test(name) && !name.endsWith('Provider') && names.at(-1) !== name) names.push(name);
    }
    fiber = fiber.return;
  }
  return names;
}

/**
 * 見た目が同じ要素を集める。class がスタイルを決めていることが多いので、タグと class の組が同じものを「似た要素」とする。
 * class の無い要素はそれだけでは決まらないので、親のタグと class も同じものに絞る。画面に出ていない要素は除く
 */
export function similarTo(el: Element): Element[] {
  const sig = (x: Element | null) => (x ? `${x.tagName}|${[...x.classList].sort().join(' ')}` : '');
  const own = sig(el);
  const parent = el.classList.length ? null : sig(el.parentElement);
  return [...el.ownerDocument.body.querySelectorAll(el.tagName)].filter(
    (x) => sig(x) === own && (parent === null || sig(x.parentElement) === parent) && x.getClientRects().length > 0,
  );
}

export function describeElement(el: Element): ElementInfo {
  const loc = el.ownerDocument.defaultView!.location;
  const marks = ['data-testid', 'aria-label', 'role', 'name', 'placeholder', 'href', 'type']
    .map((attr) => (el.getAttribute(attr) ? `${attr}="${el.getAttribute(attr)!.slice(0, 60)}"` : null))
    .filter((m): m is string => Boolean(m));
  const text = ((el as HTMLElement).innerText ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
  return {
    route: loc.pathname + loc.search,
    tag: el.tagName.toLowerCase(),
    components: componentChain(el),
    text,
    // スタイルの手がかり（Tailwind ならトークンを使った class、素の CSS なら当たっているセレクタ）
    tokenClasses: adapter().hints(el),
    marks,
  };
}

// ---------------------------------------------------------------- プレビュー
const originals = new WeakMap<Element, Map<string, [string, string]>>();

function setInline(el: Element, css: string, value: string) {
  const style = (el as HTMLElement).style;
  if (!originals.has(el)) originals.set(el, new Map());
  const saved = originals.get(el)!;
  if (!saved.has(css)) saved.set(css, [style.getPropertyValue(css), style.getPropertyPriority(css)]);
  style.setProperty(css, value, 'important');
}

export function restoreInline(el: Element, cssList: string[]) {
  const style = (el as HTMLElement).style;
  const saved = originals.get(el);
  if (!saved) return;
  for (const css of cssList) {
    const entry = saved.get(css);
    if (!entry) continue;
    const [value, priority] = entry;
    if (value) style.setProperty(css, value, priority);
    else style.removeProperty(css);
    saved.delete(css);
  }
}

// 差し替えた値へ補間して動かす。差し替え中のプロパティだけを対象にし、全部戻したら元の transition に戻す
function updateTransition(el: Element) {
  const keys = [...(originals.get(el)?.keys() ?? [])].filter((k) => k !== 'transition');
  const reduce = el.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!keys.length || reduce) restoreInline(el, ['transition']);
  else setInline(el, 'transition', keys.map((k) => `${k} 120ms ease-out`).join(', '));
}

/** トークンを介さない値（並びの設定・order）をそのまま当てる。undefined なら元に戻す */
export function previewRaw(el: Element, css: string, value: string | undefined) {
  restoreInline(el, [css]);
  if (value !== undefined) setInline(el, css, value);
  updateTransition(el);
}

export function preview(el: Element, prop: PropDef, token: Token | undefined) {
  applyPreview(el, prop, token);
  updateTransition(el);
}

function applyPreview(el: Element, prop: PropDef, token: Token | undefined) {
  restoreInline(el, prop.css);
  if (!token) return;
  if (token.style) {
    for (const [css, value] of Object.entries(token.style)) setInline(el, css, value);
    return;
  }
  for (const css of prop.css) setInline(el, css, token.raw ? token.name : (token.css ?? ''));
}
