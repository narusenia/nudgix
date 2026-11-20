// 画面のスタイルシート（CSSOM）を読む処理。どのスタイルの仕組みでも、最後は CSS のルールになっているので土台に使う

/** スタイルシートの規則を全部たどる。読めない別オリジンのシートは飛ばす。@media は今の画面に合うものだけ */
function walkRules(doc: Document, visit: (rule: CSSStyleRule) => void) {
  const win = doc.defaultView!;
  const walk = (rules: CSSRuleList) => {
    for (const rule of rules) {
      // iframe の中の規則は別の window の CSSStyleRule なので、instanceof ではなく形で見分ける
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

/** 要素に当たっている規則。スタイルシートの順（後ろほど強い）。詳細度とカスケードレイヤーは見ない */
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
  'border-radius': 'border-radius',
};

/**
 * 要素の CSS に書かれたままの値（var(--space-4) など）。計算値ではなく、書いた値を返す。
 * 一括指定（padding: var(--a)）は、var() が1つだけのときに限り各辺の値とみなす
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

/** :root などに書かれたカスタムプロパティの名前 */
export function rootVariables(doc: Document): string[] {
  const names = new Set<string>();
  walkRules(doc, (rule) => {
    if (!/(^|,)\s*(:root|html|:host)\b/.test(rule.selectorText)) return;
    for (const prop of rule.style) if (prop.startsWith('--')) names.add(prop);
  });
  return [...names];
}

/** 規則を書いた CSS ファイル。Vite の開発サーバーは <style data-vite-dev-id="/絶対パス"> で入れるので、そこから分かる */
export function fileOf(rule: CSSStyleRule, projectDir: string): string | null {
  const owner = rule.parentStyleSheet?.ownerNode as Element | null;
  const abs = owner?.getAttribute?.('data-vite-dev-id');
  if (!abs || !projectDir || !abs.startsWith(`${projectDir}/`)) return null;
  return abs.slice(projectDir.length + 1).replace(/\?.*$/, '');
}
