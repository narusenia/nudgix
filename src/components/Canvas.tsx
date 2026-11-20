import { useEffect, useRef, useState, type RefObject } from 'react';
import { componentChain } from '../lib/inspect';
import { pointer } from '../lib/pointer';
import s from './ui.module.css';

export type Width = 'fit' | 390 | 768 | 1280;

type Props = {
  frameRef: RefObject<HTMLIFrameElement | null>;
  initialPath: string;
  width: Width;
  /** Fullscreen mode. Removes the rounded corners and padding to fill the screen */
  floating?: boolean;
  picking: boolean;
  /** The last element is the primary one being edited. Spacing bands are shown on it */
  selectedEls: Element[];
  /** Zoom in on the selected element, centered on screen */
  zoom: boolean;
  onPick: (el: Element, additive: boolean) => void;
  /** Elements picked by marquee selection (outermost of those fully inside the box) */
  onPickMany: (els: Element[], additive: boolean) => void;
  onDoubleClick?: (el: Element) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onKeyUp: (e: KeyboardEvent) => void;
  onRoute: (route: string) => void;
  onLoad: () => void;
  /** Element hovered in the panel. Also gets a frame on the page */
  peek?: Element | null;
  /** Content layered on top of the frame (handles etc.) */
  children?: React.ReactNode;
};

type Rect = { left: number; top: number; width: number; height: number };
type Band = Rect & { kind: 'margin' | 'padding' | 'gap' };

const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

/** Like DevTools, draw margin, padding and the gaps between children as bands */
function spacingBands(el: Element): Band[] {
  const cs = el.ownerDocument.defaultView!.getComputedStyle(el);
  const n = (v: string) => Number.parseFloat(v) || 0;
  const r = rectOf(el);
  const [mt, mr, mb, ml] = [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft].map(n);
  const [pt, pr, pb, pl] = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(n);
  const [bt, br, bb, bl] = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(n);
  const inL = r.left + bl;
  const inT = r.top + bt;
  const inW = r.width - bl - br;
  const inH = r.height - bt - bb;
  const bands: Band[] = [
    { kind: 'margin', left: r.left, top: r.top - mt, width: r.width, height: mt },
    { kind: 'margin', left: r.left, top: r.top + r.height, width: r.width, height: mb },
    { kind: 'margin', left: r.left - ml, top: r.top, width: ml, height: r.height },
    { kind: 'margin', left: r.left + r.width, top: r.top, width: mr, height: r.height },
    { kind: 'padding', left: inL, top: inT, width: inW, height: pt },
    { kind: 'padding', left: inL, top: inT + inH - pb, width: inW, height: pb },
    { kind: 'padding', left: inL, top: inT + pt, width: pl, height: inH - pt - pb },
    { kind: 'padding', left: inL + inW - pr, top: inT + pt, width: pr, height: inH - pt - pb },
  ];
  // Gaps between children. Each gap between adjacent children becomes a vertical band in a row, a horizontal band in a column
  if (/flex|grid/.test(cs.display) && (n(cs.columnGap) || n(cs.rowGap))) {
    const kids = [...el.children].map(rectOf).filter((k) => k.width && k.height);
    for (let i = 0; i < kids.length - 1; i++) {
      const [a, b] = [kids[i], kids[i + 1]];
      if (b.left >= a.left + a.width - 0.5) {
        bands.push({ kind: 'gap', left: a.left + a.width, top: Math.min(a.top, b.top), width: b.left - a.left - a.width, height: Math.max(a.height, b.height) });
      } else if (b.top >= a.top + a.height - 0.5) {
        bands.push({ kind: 'gap', left: inL + pl, top: a.top + a.height, width: inW - pl - pr, height: b.top - a.top - a.height });
      }
    }
  }
  return bands.filter((b) => b.width > 0.5 && b.height > 0.5);
}

/** Return elements fully inside the box whose parent is not (the outermost ones) */
function elementsInside(doc: Document, r: Rect): Element[] {
  const inside = (el: Element) => {
    const b = el.getBoundingClientRect();
    return b.width > 0 && b.left >= r.left && b.top >= r.top && b.right <= r.left + r.width && b.bottom <= r.top + r.height;
  };
  return [...doc.body.querySelectorAll('*')].filter((el) => inside(el) && !(el.parentElement && el.parentElement !== doc.body && inside(el.parentElement)));
}

export function Canvas(props: Props) {
  const { frameRef, initialPath, width, floating, picking, selectedEls, zoom, onLoad } = props;
  const [hover, setHover] = useState<{ rect: Rect; label: string } | null>(null);
  const [boxes, setBoxes] = useState<{ rects: (Rect & { borderRadius?: string })[]; bands: Band[] }>({ rects: [], bands: [] });
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [transform, setTransform] = useState<string | undefined>();
  const wrapRef = useRef<HTMLDivElement>(null);
  // iframe listeners are reattached on every load, so read the latest values from refs
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    if (!picking) setHover(null);
  }, [picking]);

  const [peekBox, setPeekBox] = useState<{ rect: Rect; label: string } | null>(null);
  useEffect(() => {
    const el = props.peek;
    if (!el?.isConnected) return setPeekBox(null);
    const r = rectOf(el);
    const name = componentChain(el)[0];
    setPeekBox({ rect: r, label: `${name ? `${name} · ` : ''}${el.tagName.toLowerCase()} ${Math.round(r.width)}×${Math.round(r.height)}` });
  }, [props.peek]);
  const shown = hover ?? peekBox;

  // The selected element's frame, spacing bands and current URL change with scroll, preview and navigation, so track them every frame
  useEffect(() => {
    let raf = 0;
    let lastRoute = '';
    let lastKey = '';
    const tick = () => {
      const win = frameRef.current?.contentWindow;
      if (win) {
        const route = win.location.pathname + win.location.search;
        if (route !== lastRoute) latest.current.onRoute((lastRoute = route));
      }
      const live = selectedEls.filter((el) => el.isConnected);
      const primary = live.at(-1);
      // Match the selection frame to the element's border radius (so the shape difference shows when radius changes)
      const next = {
        rects: live.map((el) => ({ ...rectOf(el), borderRadius: el.ownerDocument.defaultView!.getComputedStyle(el).borderRadius })),
        bands: primary ? spacingBands(primary) : [],
      };
      const key = JSON.stringify(next);
      if (key !== lastKey) {
        lastKey = key;
        setBoxes(next);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [frameRef, selectedEls]);

  // Zoom: bring the element's center to the screen center and scale up, leaving some room around it
  useEffect(() => {
    const el = selectedEls.at(-1);
    const wrap = wrapRef.current;
    if (!zoom || !el?.isConnected || !wrap) return setTransform(undefined);
    const r = rectOf(el);
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    const k = Math.max(1, Math.min(4, (W * 0.6) / Math.max(r.width, 1), (H * 0.6) / Math.max(r.height, 1)));
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    setTransform(`translate(${W / 2 - cx}px, ${H / 2 - cy}px) scale(${k})|${cx}px ${cy}px`);
  }, [zoom, selectedEls]);

  const attach = () => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    // Mac scroll bounce makes frames and handles drift from the page, so disable it
    // Writing attributes on <html> conflicts with Next.js hydration, so apply it via a sheet that does not appear in the DOM
    const win = doc.defaultView as (Window & typeof globalThis) | null;
    if (win && !doc.adoptedStyleSheets.some((x) => (x as CSSStyleSheet & { te?: boolean }).te)) {
      const sheet = new win.CSSStyleSheet() as CSSStyleSheet & { te?: boolean };
      sheet.replaceSync('html { overscroll-behavior: none; }');
      sheet.te = true;
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
    }
    // iframe elements are not the parent window's Element, so instanceof cannot be used
    const target = (e: Event) => {
      const node = e.composedPath()[0] as Node | undefined;
      return node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : null;
    };
    doc.addEventListener(
      'pointermove',
      (e) => {
        // Store the position inside the iframe converted to editor screen coordinates by undoing the zoom
        const frame = frameRef.current;
        if (frame) {
          const fr = frame.getBoundingClientRect();
          const k = fr.width / frame.offsetWidth || 1;
          pointer.x = fr.left + e.clientX * k;
          pointer.y = fr.top + e.clientY * k;
        }
        const el = latest.current.picking ? target(e) : null;
        if (!el) return setHover(null);
        const r = rectOf(el);
        const name = componentChain(el)[0];
        setHover({ rect: r, label: `${name ? `${name} · ` : ''}${el.tagName.toLowerCase()} ${Math.round(r.width)}×${Math.round(r.height)}` });
      },
      true,
    );
    // While selecting, block clicks and presses on the page (so buttons do not fire and menus do not open).
    // Dragging starts a marquee selection; releasing without moving selects one element as a click
    let start: { x: number; y: number } | null = null;
    let dragged = false;
    const box = (e: MouseEvent): Rect => ({
      left: Math.min(start!.x, e.clientX),
      top: Math.min(start!.y, e.clientY),
      width: Math.abs(e.clientX - start!.x),
      height: Math.abs(e.clientY - start!.y),
    });
    for (const type of ['pointerdown', 'mousedown', 'pointermove', 'pointerup', 'mouseup', 'click']) {
      doc.addEventListener(
        type,
        (e) => {
          if (!latest.current.picking) return;
          const me = e as MouseEvent;
          if (type === 'pointermove') {
            if (!start) return;
            const r = box(me);
            if (r.width + r.height > 6) dragged = true;
            if (dragged) setMarquee(r);
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          if (type === 'pointerdown') {
            start = { x: me.clientX, y: me.clientY };
            dragged = false;
          } else if (type === 'pointerup' && start) {
            if (dragged) latest.current.onPickMany(elementsInside(doc, box(me)), me.shiftKey);
            setMarquee(null);
            start = null;
          } else if (type === 'click' && !dragged) {
            const el = target(e);
            if (el) latest.current.onPick(el, me.shiftKey);
          }
        },
        true,
      );
    }
    doc.addEventListener('dblclick', (e) => {
      const el = target(e);
      if (el) latest.current.onDoubleClick?.(el);
    });
    doc.addEventListener('keydown', (e) => latest.current.onKeyDown(e), true);
    doc.addEventListener('keyup', (e) => latest.current.onKeyUp(e), true);
    onLoad();
  };

  const [tf, origin] = transform?.split('|') ?? [];
  const bandClass = { margin: s.bandMargin, padding: s.bandPadding, gap: s.bandGap };
  return (
    <div className={floating ? s.stageFloating : s.stage}>
      <div
        ref={wrapRef}
        className={s.frameWrap}
        style={{ width: width === 'fit' ? '100%' : width, cursor: picking ? 'crosshair' : undefined, transform: tf, transformOrigin: origin }}
      >
        <iframe ref={frameRef} className={s.frame} src={initialPath} title="app" onLoad={attach} />
        <div className={s.overlay}>
          {boxes.bands.map((b, i) => (
            <div key={`b${i}`} className={bandClass[b.kind]} style={b} />
          ))}
          {boxes.rects.map((r, i) => (
            <div key={`r${i}`} className={s.box} style={r} />
          ))}
          {props.children}
          {marquee ? <div className={s.marquee} style={marquee} /> : null}
          {shown && !marquee ? (
            <div className={s.hoverBox} style={shown.rect}>
              <span className={s.boxLabel}>{shown.label}</span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
