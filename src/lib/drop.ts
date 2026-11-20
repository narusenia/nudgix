// Decides the drop target (a parent and a slot between its children). Used for reordering, moving to another parent and inserting stories
export type Box = { left: number; top: number; width: number; height: number };

export type Drop = {
  parent: Element;
  /** Visible children (excluding the grabbed element), in the parent's reordered order */
  kids: Element[];
  /** Insert before this index in kids (kids.length means at the end) */
  index: number;
  line: Box | null;
  target: Box;
};

/** Which direction the siblings run. From the direction for flex, otherwise from their positions */
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
 * (x, y) are iframe coordinates. Walk outward from the element under the cursor; on finding one at least half the size of the dragged item, insert into its parent.
 * This way, dropping over text still lands between similarly sized siblings such as adjacent cards.
 * Skips el (the element being moved), its descendants and its ancestors. Falls back to fallback if nothing is found
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
  // Draw the line in visual order (from left/top), and count positions from the end in *-reverse parents
  const order = rects.map((_, i) => i).sort((a, b) => (axis === 'x' ? rects[a].left - rects[b].left : rects[a].top - rects[b].top));
  const visual = order.map((i) => rects[i]);
  const seen = visual.filter((q) => (axis === 'x' ? q.left + q.width / 2 : q.top + q.height / 2) < at).length;
  // With a single child the order says nothing about direction, so use the parent's flex-direction
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
