// ドラッグして落とす先（親と、子の間のどこか）を決める。並べ替え・別の親への移動・ストーリーの差し込みで使う
export type Box = { left: number; top: number; width: number; height: number };

export type Drop = {
  parent: Element;
  /** 見えている子（つかんだ要素は除く）。親の並べ替え済みの順 */
  kids: Element[];
  /** kids の何番目の前に入れるか（kids.length なら末尾） */
  index: number;
  line: Box | null;
  target: Box;
};

/** 兄弟がどちらの向きに並んでいるか。flex は向きから、それ以外は位置から決める */
export function axisOf(parent: Element, rects: DOMRect[]): 'x' | 'y' {
  const cs = parent.ownerDocument.defaultView!.getComputedStyle(parent);
  if (cs.display.includes('flex')) return cs.flexDirection.startsWith('row') ? 'x' : 'y';
  const [a, b] = rects;
  return a && b && b.left >= a.right - 1 && Math.abs(a.top - b.top) < a.height / 2 ? 'x' : 'y';
}

function lineAt(rects: DOMRect[], axis: 'x' | 'y', i: number): Box | null {
  if (!rects.length) return null;
  const prev = rects[i - 1];
  const next = rects[i];
  const pair = [prev, next].filter(Boolean) as DOMRect[];
  const pos =
    axis === 'x'
      ? prev && next ? (prev.right + next.left) / 2 : prev ? prev.right + 2 : next.left - 2
      : prev && next ? (prev.bottom + next.top) / 2 : prev ? prev.bottom + 2 : next.top - 2;
  if (axis === 'x') {
    const top = Math.min(...pair.map((p) => p.top));
    return { left: pos - 1, top, width: 2, height: Math.max(...pair.map((p) => p.bottom)) - top };
  }
  const left = Math.min(...pair.map((p) => p.left));
  return { left, top: pos - 1, width: Math.max(...pair.map((p) => p.right)) - left, height: 2 };
}

/**
 * (x, y) は iframe の中の座標。カーソルの下から外へたどり、落とす物の半分以上の大きさの要素を見つけたら、その親に入れる。
 * 文字の上に落としても、隣に並ぶカードなど同じくらいの要素の間に入るようにするため。
 * el（動かしている要素）の中と、el を含む要素はたどらない。見つからなければ fallback に入れる
 */
export function dropAt(
  doc: Document,
  x: number,
  y: number,
  opts: { area: number; el?: Element; fallback: Element | null; orderOf: (parent: Element) => Element[] },
): Drop | null {
  const { area, el, fallback, orderOf } = opts;
  let parent: Element | null = fallback;
  for (let cur = doc.elementFromPoint(x, y); cur && cur !== doc.body; cur = cur.parentElement) {
    if (el && (cur === el || el.contains(cur))) continue;
    if (el && cur.contains(el)) break;
    const q = cur.getBoundingClientRect();
    if (q.width * q.height >= area * 0.5 && cur.parentElement && cur.parentElement !== doc.documentElement) {
      parent = cur.parentElement;
      break;
    }
  }
  if (!parent) return null;
  const kids = orderOf(parent).filter((c) => c !== el && c.getBoundingClientRect().width > 0);
  const rects = kids.map((c) => c.getBoundingClientRect());
  const axis = axisOf(parent, rects);
  const at = axis === 'x' ? x : y;
  // 線は見た目の順（左・上から）で引き、*-reverse の親では並びの位置を逆から数える
  const order = rects.map((_, i) => i).sort((a, b) => (axis === 'x' ? rects[a].left - rects[b].left : rects[a].top - rects[b].top));
  const visual = order.map((i) => rects[i]);
  const seen = visual.filter((q) => (axis === 'x' ? q.left + q.width / 2 : q.top + q.height / 2) < at).length;
  // 子が1つだと並びから向きが分からないので、親の flex-direction から決める
  const pcs = doc.defaultView!.getComputedStyle(parent);
  const reversed = order.length > 1 ? order[0] > order[order.length - 1] : pcs.display.includes('flex') && pcs.flexDirection.endsWith('reverse');
  const pr = parent.getBoundingClientRect();
  return {
    parent,
    kids,
    index: reversed ? kids.length - seen : seen,
    line: lineAt(visual, axis, seen),
    target: { left: pr.left, top: pr.top, width: pr.width, height: pr.height },
  };
}
