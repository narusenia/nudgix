import { useEffect, useRef, useState, type RefObject } from 'react';
import { componentChain } from '../lib/inspect';
import { pointer } from '../lib/pointer';
import s from './ui.module.css';

export type Width = 'fit' | 390 | 768 | 1280;

type Props = {
  frameRef: RefObject<HTMLIFrameElement | null>;
  initialPath: string;
  width: Width;
  /** 全画面モード。角丸と余白を外して画面いっぱいに出す */
  floating?: boolean;
  picking: boolean;
  /** 最後の要素が主に操作している要素。余白の帯はこの要素に出す */
  selectedEls: Element[];
  /** 選んだ要素を画面の中央に大きく寄せる */
  zoom: boolean;
  onPick: (el: Element, additive: boolean) => void;
  /** 矩形選択で選んだ要素（枠に完全に入った要素のうち一番外側のもの） */
  onPickMany: (els: Element[], additive: boolean) => void;
  onDoubleClick?: (el: Element) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  onKeyUp: (e: KeyboardEvent) => void;
  onRoute: (route: string) => void;
  onLoad: () => void;
  /** パネルでカーソルを乗せている要素。画面にも枠を出す */
  peek?: Element | null;
  /** 枠の上に重ねるもの（ハンドルなど） */
  children?: React.ReactNode;
};

type Rect = { left: number; top: number; width: number; height: number };
type Band = Rect & { kind: 'margin' | 'padding' | 'gap' };

const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

/** DevTools のように、外側の余白・内側の余白・子要素の間を帯にする */
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
  // 子要素の間（gap）。隣り合う子の間の隙間を、横並びなら縦の帯、縦並びなら横の帯にする
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

/** 枠に完全に入った要素のうち、親は入っていないもの（一番外側）を返す */
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
  // iframe 側のリスナーは load のたびに付け直すので、最新の値は ref から読む
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

  // 選んだ要素の枠・余白の帯・表示中の URL は、スクロール・プレビュー・画面遷移で変わるので毎フレーム追う
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
      // 選択枠は要素の角丸に合わせる（角丸を変えたときに形の違いが見えるように）
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

  // 寄せる：要素の中心を画面の中心に持ってきて、周りに余裕を残して拡大する
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
    // Mac のスクロールの跳ね返りで、枠やハンドルが画面とずれて見えるので止める
    // <html> の属性を書くと Next.js のハイドレーションと食い違うので、DOM に出ないシートで当てる
    const win = doc.defaultView as (Window & typeof globalThis) | null;
    if (win && !doc.adoptedStyleSheets.some((x) => (x as CSSStyleSheet & { te?: boolean }).te)) {
      const sheet = new win.CSSStyleSheet() as CSSStyleSheet & { te?: boolean };
      sheet.replaceSync('html { overscroll-behavior: none; }');
      sheet.te = true;
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
    }
    // iframe の要素は親ウィンドウの Element とは別物なので instanceof では判定できない
    const target = (e: Event) => {
      const node = e.composedPath()[0] as Node | undefined;
      return node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : null;
    };
    doc.addEventListener(
      'pointermove',
      (e) => {
        // iframe の中の座標を、拡大率を戻してエディタの画面の座標に直して覚える
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
    // 選択中は画面側のクリック・押下を止める（ボタンが動いたりメニューが開いたりしないように）。
    // ドラッグしたら矩形選択、動かさずに離したらクリックとして1つ選ぶ
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
