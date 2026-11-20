// Inspecting and previewing elements inside the iframe. Uses the element's own document / window
import { adapter } from './adapters';
import { serverOwners } from './sourcemap';
import { PROPS, visibleShadow, type PropDef } from './props';
import type { Category, Detection, ElementInfo, PropKey, Token, Tokens } from './types';

// Next.js internal components are not useful hints, so drop them from the component chain
export const IGNORED_COMPONENTS =
  /^(InnerLayoutRouter|OuterLayoutRouter|RenderFromTemplateContext|ScrollAndFocusHandler|InnerScrollAndFocusHandler|LoadingBoundary|ErrorBoundary.*|HTTPAccessFallback.*|RedirectBoundary|RedirectErrorBoundary|Router|AppRouter|HotReload|ServerRoot|ClientPageRoot|ClientSegmentRoot|SegmentViewNode|SegmentStateProvider|DevRootHTTPAccessFallbackBoundary|AppDevOverlay.*|ReactDevOverlay|Head|MetadataOutlet|OutletBoundary|ViewportBoundary|MetadataBoundary|Suspense|Fragment|_c\d*|Anonymous|\w*Context)$/;

const PROBE_BASE = 'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0;overflow:hidden;';
const probes = new WeakMap<Document, HTMLElement>();
const resolvedCache = new WeakMap<Document, Map<string, string>>();

export function clearResolvedCache(doc: Document) {
  resolvedCache.delete(doc);
}

// Read the computed value of an invisible element with the variable applied, so it compares in the same format as the element's computed value
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

// Infer the tokens an element currently uses. If the authored styles (class or CSS rule) tell, trust that;
// otherwise list tokens with the same computed value as candidates (ambiguous when several tokens share a value)
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
  // Border color on an element without a border is just the inherited text color, so treat it as "none"
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
  // biome-ignore lint: reads React internals
  let fiber = key ? (el as any)[key] : null;
  // Server Components that rendered the element come first, then the client components above it
  const names: string[] = serverOwners(fiber).map((o) => o.name).filter((n) => n && !IGNORED_COMPONENTS.test(n));
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
 * Collect elements that look the same. Classes usually define the style, so elements with the same tag and classes count as "similar".
 * Elements without classes are ambiguous on their own, so also require the same parent tag and classes. Elements not rendered are excluded
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
    // Style hints (classes using tokens for Tailwind, matching selectors for plain CSS)
    tokenClasses: adapter().hints(el),
    marks,
  };
}

// ---------------------------------------------------------------- preview
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

// Animate toward the swapped value. Only targets properties being swapped, and restores the original transition once everything is reverted
function updateTransition(el: Element) {
  const keys = [...(originals.get(el)?.keys() ?? [])].filter((k) => k !== 'transition');
  const reduce = el.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!keys.length || reduce) restoreInline(el, ['transition']);
  else setInline(el, 'transition', keys.map((k) => `${k} 120ms ease-out`).join(', '));
}

/** Apply values that bypass tokens (layout settings, order) directly. undefined restores the original */
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
