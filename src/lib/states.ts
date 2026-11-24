// Force interaction states and dark mode on the page, so they can be inspected and changed like the normal look.
// Pseudo-classes cannot be set from script, so every rule using one gets a copy that matches an attribute instead
// (.btn:hover → .btn[data-nudgix-state~="hover"]). Dark mode flips prefers-color-scheme media rules and the
// usual class and attribute switches
export type ElementState = 'hover' | 'focus' | 'active';
export const ELEMENT_STATES: ElementState[] = ['hover', 'focus', 'active'];

const ATTR = 'data-nudgix-state';
const PSEUDO: [RegExp, ElementState][] = [
  [/:hover\b/g, 'hover'],
  [/:focus(?:-visible)?(?![-\w])/g, 'focus'],
  [/:active\b/g, 'active'],
];
const seen = new WeakSet<CSSRule>();

type Parent = { cssRules: CSSRuleList; insertRule: (rule: string, index?: number) => number };

/** Copy every rule that uses :hover, :focus or :active once. Runs again on each toggle to pick up sheets added by HMR */
function installCopies(doc: Document) {
  const walk = (parent: Parent) => {
    for (let i = parent.cssRules.length - 1; i >= 0; i--) {
      const rule = parent.cssRules[i];
      if ('cssRules' in rule && (rule as unknown as Parent).cssRules) walk(rule as unknown as Parent);
      if (seen.has(rule) || !('selectorText' in rule)) continue;
      seen.add(rule);
      const style = rule as CSSStyleRule;
      // match, not test: these regexes are global, and test would keep lastIndex between rules
      if (!PSEUDO.some(([re]) => style.selectorText.match(re))) continue;
      let selector = style.selectorText;
      for (const [re, state] of PSEUDO) selector = selector.replace(re, `[${ATTR}~="${state}"]`);
      try {
        parent.insertRule(selector + style.cssText.slice(style.selectorText.length), i + 1);
        seen.add(parent.cssRules[i + 1]);
      } catch {}
    }
  };
  for (const sheet of doc.styleSheets) {
    try {
      walk(sheet);
    } catch {}
  }
}

/** Selector as written in the source: the copies made for forced states go back to :hover and the like */
export const authoredSelector = (selector: string) => selector.replace(/\[data-nudgix-state~="(\w+)"\]/g, ':$1');

export function statesOf(el: Element): ElementState[] {
  return (el.getAttribute(ATTR) ?? '').split(' ').filter(Boolean) as ElementState[];
}

export function setStates(el: Element, states: ElementState[]) {
  installCopies(el.ownerDocument);
  if (states.length) el.setAttribute(ATTR, states.join(' '));
  else el.removeAttribute(ATTR);
}

const mediaBefore = new WeakMap<MediaList, string>();
const rootBefore = new WeakMap<Document, { cls: boolean; theme: string | null; scheme: string }>();

export const isDark = (doc: Document) => rootBefore.has(doc);

/** Show the page in dark mode, or back as it was */
export function setDark(doc: Document, on: boolean) {
  const root = doc.documentElement;
  const visit = (rules: CSSRuleList) => {
    for (const rule of rules) {
      if ('media' in rule && (rule as CSSMediaRule).media && 'mediaText' in (rule as CSSMediaRule).media) {
        const media = (rule as CSSMediaRule).media;
        const original = mediaBefore.get(media) ?? media.mediaText;
        if (/prefers-color-scheme/.test(original)) {
          if (on) {
            mediaBefore.set(media, original);
            media.mediaText = /prefers-color-scheme:\s*dark/.test(original) ? 'all' : 'not all';
          } else if (mediaBefore.has(media)) {
            media.mediaText = original;
            mediaBefore.delete(media);
          }
        }
      }
      if ('cssRules' in rule && (rule as CSSGroupingRule).cssRules) visit((rule as CSSGroupingRule).cssRules);
    }
  };
  for (const sheet of doc.styleSheets) {
    try {
      visit(sheet.cssRules);
    } catch {}
  }
  if (on && !rootBefore.has(doc)) {
    rootBefore.set(doc, { cls: root.classList.contains('dark'), theme: root.getAttribute('data-theme'), scheme: root.style.colorScheme });
    root.classList.add('dark');
    root.setAttribute('data-theme', 'dark');
    root.style.colorScheme = 'dark';
  } else if (!on && rootBefore.has(doc)) {
    const before = rootBefore.get(doc)!;
    root.classList.toggle('dark', before.cls);
    if (before.theme === null) root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', before.theme);
    root.style.colorScheme = before.scheme;
    rootBefore.delete(doc);
  }
}
