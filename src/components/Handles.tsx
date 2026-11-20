// Handles shown over the selected element. Dragging or scrolling changes the value, snapping to the nearest token
import { GripVertical, Group, Move, SquareRoundCorner, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Dict } from '../i18n';
import { type Box, type Drop, dropAt } from '../lib/drop';
import { useT } from '../i18n';
import { resolveToken } from '../lib/inspect';
import { PROP_BY_KEY } from '../lib/props';
import type { PropKey, Token, Tokens } from '../lib/types';
import s from './ui.module.css';

type Axis = 'x' | 'y' | 'xy';
type Spec = { id: string; keys: PropKey[]; pair?: PropKey[]; all?: PropKey[]; axis: Axis; sign: 1 | -1; left: number; top: number; shape: 'h' | 'v' | 'dot' | 'chip' | 'sq';
  /** Padding and gap are dragged by the band itself, not a handle */
  zone?: { left: number; top: number; width: number; height: number };
  /** When the value is 0 and the band is invisible. Shown dashed only while hovering the element */
  zero?: boolean;
};

type Props = {
  el: Element;
  tokens: Tokens;
  onPreview: (keys: PropKey[], token: Token | undefined) => void;
  onCommit: (keys: PropKey[], name: string) => void;
  /** Current order of the parent's children (the reordered order if already reordered) */
  orderOf: (parent: Element) => Element[];
  /** Move to index in the siblings' order, excluding itself */
  onMoveTo: (index: number) => void;
  /** Move into another parent, right before ref (end if null) */
  onMoveInto: (parent: Element, ref: Element | null) => void;
  /** Visual-only offset */
  onNudge: (dx: number, dy: number) => void;
  onRemove: () => void;
  onSimilar: () => void;
};

type Step = { token: Token; px: number };

/** Sorted by px ascending. Tokens with the same value collapse into one, keeping the first */
function steps(doc: Document, tokens: Tokens, key: PropKey): Step[] {
  const prop = PROP_BY_KEY[key];
  const byPx = new Map<number, Step>();
  for (const token of tokens[prop.category]) {
    const px = Number.parseFloat(resolveToken(doc, prop.category, token));
    if (!Number.isFinite(px) || px > 400) continue;
    const prev = byPx.get(px);
    if (!prev) byPx.set(px, { token, px });
  }
  return [...byPx.values()].sort((a, b) => a.px - b.px);
}

const PADS: PropKey[] = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'];
const MARGINS: PropKey[] = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft'];

/** ⇧ moves all sides, ⌥ moves opposite sides, neither moves just that side */
const keysOf = (spec: Spec, e: { shiftKey: boolean; altKey: boolean }) =>
  e.shiftKey && spec.all ? spec.all : e.altKey && spec.pair ? spec.pair : spec.keys;

const kindOf = (spec: Spec) =>
  spec.keys[0].startsWith('padding') ? 'pad' : spec.keys[0].startsWith('margin') ? 'margin' : spec.id === 'w' || spec.id === 'h' ? 'size' : null;

/** Icon in the middle of a radius handle. Width/height use a plain white square like Figma, so no icon */
function iconOf(spec: Spec) {
  return spec.id === 'rad' ? <SquareRoundCorner size={9} strokeWidth={2.75} aria-hidden /> : null;
}

/** Names of the sides that move together with ⇧ or ⌥ */
function withLabel(keys: PropKey[] | undefined, t: Dict) {
  if (!keys) return null;
  if (keys.length > 2) return t.handleWith.all;
  return keys.some((k) => k.endsWith('Top')) ? t.handleWith.vertical : t.handleWith.horizontal;
}

const nearest = (list: Step[], px: number) =>
  list.reduce((best, st, i) => (Math.abs(st.px - px) < Math.abs(list[best].px - px) ? i : best), 0);

/** k is the zoom factor. Band grab thickness and handle offsets are set in on-screen px */
function specsOf(el: Element, k: number): Spec[] {
  const cs = el.ownerDocument.defaultView!.getComputedStyle(el);
  const n = (v: string) => Number.parseFloat(v) || 0;
  const r = el.getBoundingClientRect();
  const [bt, br, bb, bl] = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(n);
  const [pt, pr, pb, pl] = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(n);
  const [mt, mr, mb, ml] = [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft].map(n);
  const inL = r.left + bl;
  const inT = r.top + bt;
  const inR = r.right - br;
  const inB = r.bottom - bb;
  const cx = (inL + inR) / 2;
  const cy = (inT + inB) / 2;
  const radius = Math.max(n(cs.borderTopLeftRadius), 8) * 0.6;
  // Give bands at least 6px (on-screen) of thickness so they can be grabbed even at 0
  const min = 6 / k;
  const z = (v: number) => Math.max(v, min);
  const zero = (v: number) => v * k < 1;
  const side = Math.max(0, inB - inT - z(pt) - z(pb));
  const PAIR_Y: PropKey[] = ['paddingTop', 'paddingBottom'];
  const PAIR_X: PropKey[] = ['paddingLeft', 'paddingRight'];
  const MPAIR_Y: PropKey[] = ['marginTop', 'marginBottom'];
  const MPAIR_X: PropKey[] = ['marginLeft', 'marginRight'];
  return [
    ...gapSpecs(el, cs, min, k),
    // Padding is dragged by the band inside the frame
    { id: 'pt', keys: ['paddingTop'], pair: PAIR_Y, all: PADS, axis: 'y', sign: 1, left: cx, top: inT + pt, shape: 'h', zero: zero(pt), zone: { left: inL, top: inT, width: inR - inL, height: z(pt) } },
    { id: 'pb', keys: ['paddingBottom'], pair: PAIR_Y, all: PADS, axis: 'y', sign: -1, left: cx, top: inB - pb, shape: 'h', zero: zero(pb), zone: { left: inL, top: inB - z(pb), width: inR - inL, height: z(pb) } },
    { id: 'pl', keys: ['paddingLeft'], pair: PAIR_X, all: PADS, axis: 'x', sign: 1, left: inL + pl, top: cy, shape: 'v', zero: zero(pl), zone: { left: inL, top: inT + z(pt), width: z(pl), height: side } },
    { id: 'pr', keys: ['paddingRight'], pair: PAIR_X, all: PADS, axis: 'x', sign: -1, left: inR - pr, top: cy, shape: 'v', zero: zero(pr), zone: { left: inR - z(pr), top: inT + z(pt), width: z(pr), height: side } },
    // Margin is dragged by the band outside the frame
    { id: 'mt', keys: ['marginTop'], pair: MPAIR_Y, all: MARGINS, axis: 'y', sign: -1, left: cx, top: r.top - mt, shape: 'h', zero: zero(mt), zone: { left: r.left, top: r.top - z(mt), width: r.width, height: z(mt) } },
    { id: 'mb', keys: ['marginBottom'], pair: MPAIR_Y, all: MARGINS, axis: 'y', sign: 1, left: cx, top: r.bottom + mb, shape: 'h', zero: zero(mb), zone: { left: r.left, top: r.bottom, width: r.width, height: z(mb) } },
    { id: 'ml', keys: ['marginLeft'], pair: MPAIR_X, all: MARGINS, axis: 'x', sign: -1, left: r.left - ml, top: cy, shape: 'v', zero: zero(ml), zone: { left: r.left - z(ml), top: r.top, width: z(ml), height: r.height } },
    { id: 'mr', keys: ['marginRight'], pair: MPAIR_X, all: MARGINS, axis: 'x', sign: 1, left: r.right + mr, top: cy, shape: 'v', zero: zero(mr), zone: { left: r.right, top: r.top, width: z(mr), height: r.height } },
    { id: 'rad', keys: ['borderRadius'], axis: 'xy', sign: 1, left: r.left + radius, top: r.top + radius, shape: 'dot' },
    // Width and height are white squares at the middle of the right and bottom edges, like Figma
    { id: 'w', keys: ['width'], axis: 'x', sign: 1, left: r.right, top: cy, shape: 'sq' },
    { id: 'h', keys: ['height'], axis: 'y', sign: 1, left: cx, top: r.bottom, shape: 'sq' },
    { id: 'fs', keys: ['fontSize'], axis: 'y', sign: -1, left: r.right + 14 / k, top: r.top - 2 / k, shape: 'chip' },
  ];
}

/** Bands between flex/grid children. Places a grab area in each gap between adjacent children */
function gapSpecs(el: Element, cs: CSSStyleDeclaration, min: number, k: number): Spec[] {
  if (!/flex|grid/.test(cs.display)) return [];
  const kids = [...el.children]
    .map((c) => c.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0);
  const out: Spec[] = [];
  for (let i = 0; i < kids.length - 1; i++) {
    const [a, b] = [kids[i], kids[i + 1]];
    const id = `gap${i}`;
    if (b.left >= a.right - 1) {
      const x = (a.right + b.left) / 2;
      const w = Math.max(b.left - a.right, min);
      const top = Math.max(a.top, b.top);
      const h = Math.max(Math.min(a.bottom, b.bottom) - top, min);
      out.push({ id, keys: ['gap'], axis: 'x', sign: 1, left: x, top: top + h / 2, shape: 'v', zero: (b.left - a.right) * k < 1, zone: { left: x - w / 2, top, width: w, height: h } });
    } else if (b.top >= a.bottom - 1) {
      const y = (a.bottom + b.top) / 2;
      const h = Math.max(b.top - a.bottom, min);
      const left = Math.max(a.left, b.left);
      const w = Math.max(Math.min(a.right, b.right) - left, min);
      out.push({ id, keys: ['gap'], axis: 'y', sign: 1, left: left + w / 2, top: y, shape: 'h', zero: (b.top - a.bottom) * k < 1, zone: { left, top: y - h / 2, width: w, height: h } });
    }
  }
  return out;
}

export function Handles({ el, tokens, onPreview, onCommit, orderOf, onMoveTo, onMoveInto, onNudge, onRemove, onSimilar }: Props) {
  const siblings = el.parentElement ? orderOf(el.parentElement) : [el];
  const t = useT();
  const [specs, setSpecs] = useState<Spec[]>([]);
  // Zoom factor. Handles etc. are scaled by 1/k so their on-screen size stays the same
  const [k, setK] = useState(1);
  const [drag, setDrag] = useState<{
    spec: Spec;
    keys: PropKey[];
    list: Step[];
    start: number;
    from: Step;
    idx: number;
    /** Unsnapped value while dragging width/height without ⇧ */
    free?: Step;
    x: number;
    y: number;
    rect: { left: number; top: number; width: number; height: number };
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  // Whether the cursor is over the selected element (and its margin). Used to show 0-value bands dashed
  const [near, setNear] = useState(false);
  useEffect(() => {
    const doc = el.ownerDocument;
    const on = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const m = 12;
      setNear(e.clientX > r.left - m && e.clientX < r.right + m && e.clientY > r.top - m && e.clientY < r.bottom + m);
    };
    const off = () => setNear(false);
    doc.addEventListener('pointermove', on);
    doc.documentElement.addEventListener('pointerleave', off);
    return () => {
      doc.removeEventListener('pointermove', on);
      doc.documentElement.removeEventListener('pointerleave', off);
    };
  }, [el]);
  const [moving, setMoving] = useState<{ ghost: Box; line: Box | null; target: Box | null; free: boolean } | null>(null);
  const [mods, setMods] = useState({ shiftKey: false, altKey: false, freeKey: false });

  // Highlight handles that move together while ⇧/⌥ is held. Also catches keys while the iframe has focus
  useEffect(() => {
    const docs = [document, el.ownerDocument];
    const on = (e: KeyboardEvent) => {
      const next = { shiftKey: e.shiftKey, altKey: e.altKey, freeKey: e.metaKey || e.ctrlKey };
      setMods((m) => (m.shiftKey === next.shiftKey && m.altKey === next.altKey && m.freeKey === next.freeKey ? m : next));
    };
    const off = () => setMods({ shiftKey: false, altKey: false, freeKey: false });
    for (const d of docs) {
      d.addEventListener('keydown', on);
      d.addEventListener('keyup', on);
    }
    window.addEventListener('blur', off);
    return () => {
      for (const d of docs) {
        d.removeEventListener('keydown', on);
        d.removeEventListener('keyup', on);
      }
      window.removeEventListener('blur', off);
    };
  }, [el]);

  // The element's position and spacing change with preview and scroll, so track them every frame
  useEffect(() => {
    let raf = 0;
    let last = '';
    const tick = () => {
      if (el.isConnected) {
        const nk = scale();
        const next = specsOf(el, nk);
        const key = JSON.stringify(next) + nk;
        if (key !== last) {
          last = key;
          setSpecs(next);
          setK(nk);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [el]);

  // When zoomed, divide mouse movement by the zoom factor to get iframe px
  const scale = () => {
    const wrap = rootRef.current?.parentElement?.parentElement;
    return wrap ? wrap.getBoundingClientRect().width / wrap.offsetWidth || 1 : 1;
  };

  const begin = (spec: Spec, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {}
    const keys = keysOf(spec, e);
    const list = steps(el.ownerDocument, tokens, keys[0]);
    // Width and height move freely in 1px steps and snap to tokens only while ⇧ is held.
    // Spacing, radius and the like snap to tokens and move freely only while ⌘ (Ctrl on Windows) is held
    const sizing = kindOf(spec) === 'size';
    const freeNow = (ev: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) =>
      !list.length || (sizing ? !ev.shiftKey : ev.metaKey || ev.ctrlKey);
    if (!list.length && !sizing) return;
    const cs = el.ownerDocument.defaultView!.getComputedStyle(el);
    const start = Number.parseFloat(cs.getPropertyValue(PROP_BY_KEY[keys[0]].css[0])) || 0;
    const startX = e.clientX;
    const startY = e.clientY;
    const k = scale();
    let idx = list.length ? nearest(list, start) : 0;
    const r = el.getBoundingClientRect();
    const rawStep = (px: number): Step => ({ token: { name: `${px}px`, description: '', raw: true }, px });
    let free: Step | undefined = freeNow(e) ? rawStep(Math.round(start)) : undefined;
    let shown = '';
    const show = (step: Step) => {
      if (step.token.name === shown) return;
      shown = step.token.name;
      onPreview(keys, step.token);
    };
    setDrag({ spec, keys, list, start, from: sizing ? rawStep(Math.round(start)) : list[idx], idx, free, x: e.clientX, y: e.clientY, rect: { left: r.left, top: r.top, width: r.width, height: r.height } });

    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / k;
      const dy = (ev.clientY - startY) / k;
      const delta = spec.axis === 'x' ? dx : spec.axis === 'y' ? dy : (dx + dy) / 2;
      const target = start + delta * spec.sign;
      if (freeNow(ev)) {
        free = rawStep(Math.max(0, Math.round(target)));
        show(free);
        setDrag((d) => (d ? { ...d, free, x: ev.clientX, y: ev.clientY } : d));
        return;
      }
      if (free) {
        // The moment free movement stops, jump to the token nearest the current position
        free = undefined;
        idx = nearest(list, target);
        show(list[idx]);
      }
      const cand = nearest(list, target);
      // To avoid flickering at the boundary, stick to the current value until 3px past the midpoint with the next one
      if (cand !== idx && Math.abs(target - list[idx].px) > Math.abs(list[cand].px - list[idx].px) / 2 + 3) {
        idx = cand;
        show(list[idx]);
      }
      setDrag((d) => (d ? { ...d, idx, free: undefined, x: ev.clientX, y: ev.clientY } : d));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const last = free ?? list[idx];
      if (last.px !== start) onCommit(keys, last.token.name);
      else onPreview(keys, undefined);
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Drag the grip and drop between children to move it there. While ⌘ is held, it just offsets visually
  const beginMove = (e: React.PointerEvent, freeOnly = false) => {
    e.preventDefault();
    e.stopPropagation();
    const home = el.parentElement;
    if (!home) return;
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {}
    const doc = el.ownerDocument;
    const origin = rootRef.current!.getBoundingClientRect();
    const k = scale();
    const local = (ev: { clientX: number; clientY: number }) => ({ x: (ev.clientX - origin.left) / k, y: (ev.clientY - origin.top) / k });
    const r = el.getBoundingClientRect();
    const start = local(e);
    const grab = { x: start.x - r.left, y: start.y - r.top };
    let drop: Drop | null = null;
    let free = false;
    let last = start;
    const area = r.width * r.height;

    const update = (p: { x: number; y: number }, meta: boolean) => {
      last = p;
      free = meta;
      const ghost = { left: p.x - grab.x, top: p.y - grab.y, width: r.width, height: r.height };
      if (free) {
        drop = null;
        return setMoving({ ghost, line: null, target: null, free });
      }
      drop = dropAt(doc, p.x, p.y, { area, el, fallback: home, orderOf });
      setMoving({ ghost, line: drop?.line ?? null, target: drop && drop.parent !== home ? drop.target : null, free });
    };

    const move = (ev: PointerEvent) => update(local(ev), freeOnly || ev.metaKey);
    const key = (ev: KeyboardEvent) => ev.key === 'Meta' && update(last, freeOnly || ev.type === 'keydown');
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', key);
      setMoving(null);
      if (free) return onNudge(Math.round(last.x - start.x), Math.round(last.y - start.y));
      if (!drop) return;
      const { parent, kids, index } = drop;
      if (parent === home) {
        // Convert the position among visible siblings to a position in the full order, including hidden siblings
        const rest = siblings.filter((c) => c !== el);
        onMoveTo(index >= kids.length ? rest.indexOf(kids[kids.length - 1]) + 1 : rest.indexOf(kids[index]));
      } else onMoveInto(parent, kids[index] ?? null);
    };
    setMoving({ ghost: { left: r.left, top: r.top, width: r.width, height: r.height }, line: null, target: null, free: freeOnly || e.metaKey });
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
  };

  const [grip, setGrip] = useState<{ left: number; top: number; bottom: number; width: number; height: number } | null>(null);
  useEffect(() => {
    let raf = 0;
    let last = '';
    const tick = () => {
      if (el.isConnected) {
        const r = el.getBoundingClientRect();
        const key = `${r.left},${r.top},${r.width},${r.height}`;
        if (key !== last) {
          last = key;
          setGrip({ left: r.left, top: r.top, bottom: r.bottom, width: r.width, height: r.height });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [el]);

  // Step one notch per wheel tick
  const wheel = (spec: Spec, e: React.WheelEvent) => {
    e.preventDefault();
    const keys = keysOf(spec, e);
    const list = steps(el.ownerDocument, tokens, keys[0]);
    const cs = el.ownerDocument.defaultView!.getComputedStyle(el);
    const now = nearest(list, Number.parseFloat(cs.getPropertyValue(PROP_BY_KEY[keys[0]].css[0])) || 0);
    const next = list[Math.max(0, Math.min(list.length - 1, now + (e.deltaY < 0 ? 1 : -1) * spec.sign * (spec.axis === 'xy' ? 1 : 1)))];
    if (next && next.px !== list[now].px) onCommit(keys, next.token.name);
  };

  const active = drag ? (drag.free ?? drag.list[drag.idx]) : null;
  const hovered = specs.find((sp) => sp.id === hover);
  const linked = new Set<PropKey>(drag ? drag.keys : hovered ? keysOf(hovered, mods) : []);
  const delta = active && drag ? Math.round((active.px - drag.start) * 10) / 10 : 0;

  return (
    <div ref={rootRef} className={s.handles} style={{ '--inv': 1 / k } as React.CSSProperties}>
      {specs.map((spec) =>
        spec.zone ? (
          <div
            key={`zone-${spec.id}`}
            className={[
              s.zone,
              kindOf(spec) === 'pad' ? s.zonePad : kindOf(spec) === 'margin' ? s.zoneMargin : s.zoneGap,
              drag?.spec.id === spec.id || hover === spec.id || linked.has(spec.keys[0]) ? s.zoneOn : '',
              spec.zero && (near || hover !== null) ? s.zoneZero : '',
            ].join(' ')}
            style={{ ...spec.zone, cursor: spec.axis === 'x' ? 'ew-resize' : 'ns-resize' }}
            onPointerEnter={() => setHover(spec.id)}
            onPointerLeave={() => setHover((h) => (h === spec.id ? null : h))}
            onPointerDown={(e) => begin(spec, e)}
          />
        ) : null,
      )}
      {specs.filter((spec) => !spec.zone).map((spec) => (
        <button
          key={drag?.spec.id === spec.id ? `${spec.id}-${drag.idx}` : spec.id}
          type="button"
          aria-label={t.props[spec.keys[0]]}
          className={[
            s.handle,
            s[`handle_${spec.shape}`],
            kindOf(spec) === 'size' ? s.handleSize : '',
            drag?.spec.id === spec.id ? s.handleActive : linked.size > 1 && linked.has(spec.keys[0]) ? s.handleLinked : '',
          ].join(' ')}
          style={{ left: spec.left, top: spec.top, cursor: spec.shape === 'sq' ? (spec.axis === 'x' ? 'ew-resize' : 'ns-resize') : undefined }}
          onPointerEnter={() => setHover(spec.id)}
          onPointerLeave={() => setHover((h) => (h === spec.id ? null : h))}
          onPointerDown={(e) => begin(spec, e)}
          onWheel={(e) => wheel(spec, e)}
        >
          {spec.shape === 'chip' ? 'Aa' : iconOf(spec)}
        </button>
      ))}
      {grip ? (
        <>
          <button
            type="button"
            aria-label={t.dragToMove}
            title={t.dragToMove}
            className={s.moveGrip}
            style={{ left: grip.left, top: grip.top - 10 / k, opacity: moving && !moving.free ? 1 : undefined }}
            onPointerDown={(e) => beginMove(e)}
          >
            <GripVertical size={11} />
          </button>
          <button
            type="button"
            aria-label={t.dragToNudge}
            title={t.dragToNudge}
            className={s.moveGrip}
            style={{ left: grip.left + 19 / k, top: grip.top - 10 / k, opacity: moving?.free ? 1 : undefined, cursor: 'move' }}
            onPointerDown={(e) => beginMove(e, true)}
          >
            <Move size={11} />
          </button>
          <button
            type="button"
            aria-label={`${t.selectSimilar} (A)`}
            title={`${t.selectSimilar} (A)`}
            className={s.moveGrip}
            style={{ left: grip.left + 38 / k, top: grip.top - 10 / k, cursor: 'pointer' }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onSimilar}
          >
            <Group size={11} />
          </button>
          <button
            type="button"
            aria-label={`${t.remove} (Delete)`}
            title={`${t.remove} (Delete)`}
            className={s.removeButton}
            style={{ left: grip.left + 57 / k, top: grip.top - 10 / k }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onRemove}
          >
            <Trash2 size={11} />
          </button>
        </>
      ) : null}
      {moving ? (
        <>
          <div className={s.dragShield} style={{ cursor: 'grabbing' }} />
          {moving.target ? <div className={s.moveTarget} style={moving.target} /> : null}
          <div className={moving.free ? s.moveGhostFree : s.moveGhost} style={moving.ghost} />
          {moving.line ? <div className={s.moveLine} style={moving.line} /> : null}
        </>
      ) : null}
      {/* Show the current width × height below the frame, like Figma */}
      {grip ? (
        <div className={s.sizeBadge} style={{ left: grip.left, top: grip.bottom + 6 / k }}>
          {Math.round(grip.width)} × {Math.round(grip.height)}
        </div>
      ) : null}
      {hovered && !drag ? <HandleHint spec={hovered} mods={mods} t={t} k={k} /> : null}
      {drag && active ? (
        <>
          {/* Over the iframe, it would receive the move and release events, so cover everything only while dragging */}
          <div className={s.dragShield} style={{ cursor: drag.spec.axis === 'x' ? 'ew-resize' : drag.spec.axis === 'y' ? 'ns-resize' : 'nwse-resize' }} />
          {(drag.free ? [] : drag.list)
            .filter((st) => Math.abs(st.px - drag.start) <= 160)
            .map((st) => {
              const off = (st.px - drag.start) * drag.spec.sign;
              const vertical = drag.spec.axis === 'y';
              const at = vertical ? { left: drag.spec.left + 14, top: drag.spec.top + off } : { left: drag.spec.left + off, top: drag.spec.top + 14 };
              return <span key={st.token.name} className={st === active ? s.tickActive : s.tick} style={{ ...at, transform: vertical ? 'translateY(-50%)' : 'translateX(-50%) rotate(90deg)' }} />;
            })}
          <Ghost drag={drag} />
          <div className={s.dragTip} style={{ position: 'fixed', left: drag.x + 14, top: drag.y + 16 }}>
            <span className={s.cursorTipLabel}>{drag.keys.length > 2 ? t.groups.space : drag.keys.map((k) => t.props[k]).join(' / ')}</span>
            <span className={s.cursorTipFrom}>
              {drag.from.token.raw ? null : `${drag.from.token.name} `}
              {drag.start}px
            </span>
            <span aria-hidden="true">→</span>
            {active.token.raw ? null : <span className={s.cursorTipTo}>{active.token.name}</span>}
            <span className={s.cursorTipValue}>{active.px}px</span>
            {delta ? <span className={s.delta}>{`${delta > 0 ? '+' : ''}${delta}`}</span> : null}
            <MiniCompare kind={drag.spec.id === 'rad' ? 'radius' : drag.spec.id === 'fs' ? 'text' : 'space'} from={drag.start} to={active.px} />
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Label shown when hovering a handle: outer or inner, and what moves together with ⇧/⌥ */
// ⌘ on Mac, Ctrl elsewhere. Either one enables free movement
const FREE_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

function HandleHint({ spec, mods, t, k }: { spec: Spec; mods: { shiftKey: boolean; altKey: boolean; freeKey: boolean }; t: Dict; k: number }) {
  const kind = kindOf(spec);
  const all = withLabel(spec.all, t);
  const pair = withLabel(spec.pair, t);
  return (
    <div className={s.handleHint} style={{ left: spec.left + 12 / k, top: spec.top + 12 / k }}>
      {kind === 'pad' || kind === 'margin' ? <span className={kind === 'pad' ? s.hintSwatchPad : s.hintSwatchMargin} /> : null}
      <span>{t.props[spec.keys[0]]}</span>
      {all ? <kbd className={mods.shiftKey ? s.hintKeyOn : s.hintKey}>⇧ {all}</kbd> : null}
      {kind === 'size' ? <kbd className={mods.shiftKey ? s.hintKeyOn : s.hintKey}>⇧ {t.snapToToken}</kbd> : null}
      {pair && pair !== all ? <kbd className={mods.altKey && !mods.shiftKey ? s.hintKeyOn : s.hintKey}>⌥ {pair}</kbd> : null}
      {kind === 'size' ? null : <kbd className={mods.freeKey ? s.hintKeyOn : s.hintKey}>{FREE_KEY} {t.freeMove}</kbd>}
    </div>
  );
}

type DragInfo = { spec: Spec; start: number; rect: { left: number; top: number; width: number; height: number } };

/** While dragging, leave the original shape dashed on the page. Original corner for radius, original edge line for spacing */
function Ghost({ drag }: { drag: DragInfo }) {
  const { spec, rect, start } = drag;
  if (spec.shape === 'dot') return <div className={s.ghostShape} style={{ ...rect, borderRadius: start }} />;
  if (spec.shape === 'h') return <div className={s.ghostLine} style={{ left: rect.left, top: spec.top, width: rect.width, height: 0 }} />;
  if (spec.shape === 'v') return <div className={s.ghostLine} style={{ left: spec.left, top: rect.top, width: 0, height: rect.height }} />;
  return null;
}

/** Small comparison inside the tooltip. The original is dashed, the new value solid, overlaid */
function MiniCompare({ kind, from, to }: { kind: 'radius' | 'space' | 'text'; from: number; to: number }) {
  if (kind === 'radius') {
    const r = (v: number) => Math.min(v * 2, 36);
    return (
      <span className={s.miniCompare}>
        <span className={s.miniCornerFrom} style={{ borderTopLeftRadius: r(from) }} />
        <span className={s.miniCorner} style={{ borderTopLeftRadius: r(to) }} />
      </span>
    );
  }
  if (kind === 'space') {
    const w = (v: number) => Math.min(Math.max(v * 2, 2), 150);
    return (
      <span className={s.miniBars}>
        <span className={s.bigBarCurrent} style={{ width: w(from), height: 8 }} />
        <span className={s.bigBar} style={{ width: w(to), height: 8 }} />
      </span>
    );
  }
  return (
    <span className={s.miniText}>
      <span style={{ fontSize: Math.min(from, 32), opacity: 0.45 }}>Aa</span>
      <span style={{ fontSize: Math.min(to, 32) }}>Aa</span>
    </span>
  );
}
