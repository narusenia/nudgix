// Saves committed changes in the browser, and after the iframe reloads, finds the elements and reapplies them
import type { Change } from './types';

// One editor origin (localhost:4747) serves whichever project nudgix was started in, so changes are kept per project folder
let KEY = 'nudgix.changes.v1';
export const setSaveScope = (dir: string) => {
  KEY = `nudgix.changes.v1:${dir}`;
};

export type Saved = Change & { locator: string };

// Inserted stories are not counted, so other elements' indexes do not shift if a story is inserted first during reapplying
const kidsOf = (el: Element) => [...el.children].filter((c) => !c.hasAttribute('data-nudgix-story'));

/** Path of child indexes from body to the element. Often points at the same element after HMR or reload */
export function locatorOf(el: Element): string {
  // The page comment sits on body. An empty locator means "not looked up", so body gets a name of its own
  if (el === el.ownerDocument.body) return 'body';
  const path: number[] = [];
  for (let cur: Element | null = el; cur && cur !== cur.ownerDocument.body; cur = cur.parentElement) {
    // Elements inside inserted stories are recreated after reload, so they are not looked up by position
    if (!cur.parentElement || cur.hasAttribute('data-nudgix-story')) return '';
    path.unshift(kidsOf(cur.parentElement).indexOf(cur));
  }
  return path.join('/');
}

export function findByLocator(doc: Document, locator: string): Element | null {
  if (locator === 'body') return doc.body;
  let cur: Element | null = doc.body;
  for (const i of locator.split('/').filter(Boolean).map(Number)) {
    cur = cur ? (kidsOf(cur)[i] ?? null) : null;
  }
  return cur === doc.body ? null : cur;
}

export function loadSaved(): Saved[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function save(entries: Saved[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {}
}
