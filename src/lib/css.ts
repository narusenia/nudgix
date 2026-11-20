// Reads the page's stylesheets (CSSOM). Every styling system ends up as CSS rules, so this is the common base

/** Walk every stylesheet rule. Skips unreadable cross-origin sheets. For @media, only those matching the current viewport */
function walkRules(doc: Document, visit: (rule: CSSStyleRule) => void) {
  const win = doc.defaultView!;
  const walk = (rules: CSSRuleList) => {
    for (const rule of rules) {
      // Rules inside the iframe are another window's CSSStyleRule, so check by shape instead of instanceof
      if ('media' in rule && rule.media && 'mediaText' in (rule.media as MediaList) && !win.matchMedia((rule.media as MediaList).mediaText).matches) continue;
      if ('selectorText' in rule) visit(rule as CSSStyleRule);
      if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules) walk((rule as CSSGroupingRule).cssRules);
    }
  };
  for (const sheet of doc.styleSheets) {
    try {
      walk(sheet.cssRules);
    } catch {}
  }
}

/** Rules matching the element, in stylesheet order (later wins). Ignores specificity and cascade layers */
export function matchedRules(el: Element): CSSStyleRule[] {
  const out: CSSStyleRule[] = [];
  walkRules(el.ownerDocument, (rule) => {
    try {
      if (el.matches(rule.selectorText)) out.push(rule);
    } catch {}
  });
  return out;
}

const SHORTHAND: Record<string, string> = {
  'padding-top': 'padding',
  'padding-right': 'padding',
  'padding-bottom': 'padding',
  'padding-left': 'padding',
  'margin-top': 'margin',
  'margin-right': 'margin',
  'margin-bottom': 'margin',
  'margin-left': 'margin',
  'border-color': 'border',
  'background-color': 'background',
  'border-radius': 'border-radius',
};

/**
 * The value as written in the element's CSS (e.g. var(--space-4)). Returns the authored value, not the computed one.
 * A shorthand (padding: var(--a)) counts as each side's value only when it has exactly one var()
 */
export function declaredValue(el: Element, css: string): string {
  const rules = [(el as HTMLElement).style, ...matchedRules(el).reverse().map((r) => r.style)];
  for (const style of rules) {
    const value = style.getPropertyValue(css);
    if (value) return value;
    const short = SHORTHAND[css] && style.getPropertyValue(SHORTHAND[css]);
    if (short && (short.match(/var\(/g) ?? []).length === 1) return short;
  }
  return '';
}

/** Rules on :root and the like, where custom properties are usually declared */
export function rootRules(doc: Document): CSSStyleRule[] {
  const out: CSSStyleRule[] = [];
  walkRules(doc, (rule) => {
    if (/(^|,)\s*(:root|html|:host)\b/.test(rule.selectorText)) out.push(rule);
  });
  return out;
}

/** Names of custom properties declared on :root and the like */
export function rootVariables(doc: Document): string[] {
  return [...new Set(rootRules(doc).flatMap((rule) => [...rule.style].filter((prop) => prop.startsWith('--'))))];
}

/** CSS file that declared the rule. Vite's dev server injects <style data-vite-dev-id="/absolute/path">, which tells us */
export function fileOf(rule: CSSStyleRule, projectDir: string): string | null {
  const owner = rule.parentStyleSheet?.ownerNode as Element | null;
  const abs = owner?.getAttribute?.('data-vite-dev-id');
  if (!abs || !projectDir || !abs.startsWith(`${projectDir}/`)) return null;
  return abs.slice(projectDir.length + 1).replace(/\?.*$/, '');
}
