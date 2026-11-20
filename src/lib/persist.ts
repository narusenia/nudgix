// 確定した変更をブラウザに保存し、iframe が読み直されたら要素を探して当て直す
import type { Change } from './types';

const KEY = 'nudgix.changes.v1';

export type Saved = Change & { locator: string };

// 差し込んだストーリーは数えない。当て直しの途中で先に差し込まれても、ほかの要素の番号がずれないように
const kidsOf = (el: Element) => [...el.children].filter((c) => !c.hasAttribute('data-nudgix-story'));

/** body から要素までの「何番目の子か」の列。HMR や再読み込みのあとも同じ要素を指すことが多い */
export function locatorOf(el: Element): string {
  const path: number[] = [];
  for (let cur: Element | null = el; cur && cur !== cur.ownerDocument.body; cur = cur.parentElement) {
    // 差し込んだストーリーの中の要素は、再読み込みのあとは作り直すので位置では探さない
    if (!cur.parentElement || cur.hasAttribute('data-nudgix-story')) return '';
    path.unshift(kidsOf(cur.parentElement).indexOf(cur));
  }
  return path.join('/');
}

export function findByLocator(doc: Document, locator: string): Element | null {
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
