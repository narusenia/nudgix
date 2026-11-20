import { Check, ChevronDown, ChevronRight, Copy, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { annotate, fetchSource, findUsages, highlight, nearestSrc, reactChain, type ReactPart, type Snippet, storyJsx } from '../lib/code';
import { locate } from '../lib/code';
import { fiberOf, resolveStack } from '../lib/sourcemap';
import type { Change, Selected } from '../lib/types';
import { IconButton } from './IconButton';
import s from './ui.module.css';

/** Await a Promise as a value. Refetches when deps change and discards stale results */
function useAsync<T>(make: () => Promise<T> | null, deps: unknown[]): T | undefined {
  const [value, setValue] = useState<T>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the caller decides deps
  useEffect(() => {
    setValue(undefined);
    const p = make();
    if (!p) return;
    let alive = true;
    p.then((v) => alive && setValue(v));
    return () => {
      alive = false;
    };
  }, deps);
  return value;
}

const load = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const save = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

/** Only React dev builds know where the JSX was written */
const hasDebug = (el: Element) => !!fiberOf(el)?._debugStack;

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <IconButton
      label={label}
      onClick={() => {
        navigator.clipboard.writeText(text).catch(() => {});
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
    </IconButton>
  );
}

/** file:line heading and source excerpt. Highlights the target line and shows where changes land beside each line */
export function SourceView({ loc, around, change, title }: { loc: string; around: number; change?: Change; title?: string }) {
  const t = useT();
  const snippet = useAsync<Snippet | null>(() => fetchSource(loc, around), [loc, around]);
  const target = Number(loc.match(/:(\d+)$/)?.[1]);
  const notes = snippet ? annotate(snippet, change, t) : new Map<number, string[]>();
  // Syntax colors arrive later. Show plain text until then
  const colored = useAsync(() => (snippet ? highlight(snippet.lines).catch(() => null) : null), [snippet]);
  const lineRef = useRef<HTMLDivElement>(null);
  // scrollIntoView would scroll the editor too, so scroll only inside the excerpt box
  useEffect(() => {
    const line = lineRef.current;
    const box = line?.parentElement;
    if (line && box) box.scrollTop = line.offsetTop - box.clientHeight / 2 + line.offsetHeight / 2;
  }, [snippet]);
  return (
    <div className={s.codeBlock}>
      <div className={s.codeHead}>
        {title ? <span className={s.codeTitle}>{title}</span> : null}
        <span className={`${s.codeLoc} ${s.ellipsis}`}>{loc}</span>
        <CopyButton text={loc} label={t.copyLoc} />
      </div>
      {snippet === undefined ? (
        <p className={s.codeNote}>{t.galleryLoading}</p>
      ) : snippet === null ? (
        <p className={s.codeNote}>{t.noSource}</p>
      ) : (
        <pre className={s.codeLines}>
          {snippet.lines.map((line, i) => {
            const n = snippet.start + i;
            const note = notes.get(n);
            return (
              <div key={n} ref={n === target ? lineRef : undefined} className={n === target ? s.codeLineOn : note ? s.codeLineNote : s.codeLine}>
                <span className={s.codeNum}>{n}</span>
                <span className={s.codeText}>
                  {colored?.[i]?.length
                    ? colored[i].map((tk, j) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: tokens within a line
                        <span key={j} style={tk.style as React.CSSProperties}>
                          {tk.content}
                        </span>
                      ))
                    : line || ' '}
                </span>
                {note ? <span className={s.codeAnno}>{note.join(' · ')}</span> : null}
              </div>
            );
          })}
        </pre>
      )}
    </div>
  );
}

/** How many places in src use the component. Fixing a shared component affects every place listed here */
function UsageCount({ name }: { name: string }) {
  const t = useT();
  const found = useAsync(() => findUsages(name), [name]);
  const [open, setOpen] = useState(false);
  if (!found) return null;
  const { usages } = found;
  return (
    <div className={s.codeSection}>
      <button type="button" className={s.codeToggle} aria-expanded={open} onClick={() => setOpen((o) => !o)} disabled={!usages.count}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{t.usages(found.name, usages.count)}</span>
      </button>
      {open ? (
        <ul className={s.codeHits}>
          {usages.hits.map((h) => (
            <li key={h} className={s.codeHit}>
              <span className={s.ellipsis}>{h}</span>
              <CopyButton text={h} label={t.copyLoc} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The right panel's Code tab. For one selected element, shows where it is written, where it is used and what a change would affect */
export function CodeTab({ selected, change }: { selected: Selected; change: Change | undefined }) {
  const t = useT();
  const { el, info } = selected;
  const source = useAsync(() => locate(el), [el]);
  // When the source location is unknown (elements inside a library), and for counting impact, use the nearest component written in src
  const near = useAsync(() => nearestSrc(el), [el]);
  const component = near?.name;
  return (
    <div className={s.codeTab}>
      {change?.insert ? (
        <div className={s.codeSection}>
          <div className={s.codeTitle}>{t.storyJsx}</div>
          <pre className={s.codeJsx}>{storyJsx(change.insert)}</pre>
        </div>
      ) : source === undefined ? (
        <p className={s.codeNote}>{t.galleryLoading}</p>
      ) : (
        <>
          {source.self ? <SourceView title={t.createdAt} loc={source.self} around={4} change={change} /> : null}
          {source.usage ? <SourceView title={t.usedAt} loc={source.usage} around={4} change={change} /> : null}
          {!source.self && !source.usage ? (
            near ? <SourceView title={t.usedAt} loc={near.loc} around={4} change={change} /> : near === null ? <p className={s.codeNote}>{t.noSource}</p> : null
          ) : null}
        </>
      )}
      {component && !change?.insert ? <UsageCount name={component} /> : null}
      {info.tokenClasses.length ? (
        <div className={s.codeSection}>
          <div className={s.codeTitle}>{t.tokenClasses}</div>
          <div className={s.codeChips}>
            {info.tokenClasses.map((c) => (
              <code key={c} className={s.codeChip}>
                {c}
              </code>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- bottom drawer

const EDITOR_ATTR = /^data-nudgix/;
const hl = (cls: string) =>
  cls.split(/\s+/).map((c, i) => (
    <span key={i} className={/(^|_)(ds|bx)\./.test(c) ? s.codeTokenClass : undefined}>
      {i ? ' ' : ''}
      {c}
    </span>
  ));

type TreeProps = {
  el: Element;
  depth: number;
  selectedEl: Element;
  isChanged: (el: Element) => boolean;
  onSelect: (el: Element) => void;
  onPeek: (el: Element | null) => void;
  whole?: boolean;
};

/** Render outerHTML as a collapsible tree. Hover highlights the element on the page; click selects it */
function HtmlNode({ el, depth, selectedEl, isChanged, onSelect, onPeek, whole }: TreeProps) {
  // When showing the whole page, expand only the path to the selected element
  const onPath = el !== selectedEl && el.contains(selectedEl);
  const [open, setOpen] = useState(whole ? onPath : depth < 2);
  useEffect(() => {
    if (whole && onPath) setOpen(true);
  }, [whole, onPath]);
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (whole && el === selectedEl) rowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [whole, el, selectedEl]);
  const tag = el.tagName.toLowerCase();
  const kids = [...el.childNodes].filter(
    (n) => (n.nodeType === 1 && !['SCRIPT', 'STYLE', 'LINK', 'NOSCRIPT'].includes((n as Element).tagName)) || (n.nodeType === 3 && n.textContent?.trim()),
  );
  const onlyText = kids.length === 1 && kids[0].nodeType === 3;
  const attrs = [...el.attributes].filter((a) => !EDITOR_ATTR.test(a.name));
  const open_ = (
    <>
      <span className={s.codeTag}>&lt;{tag}</span>
      {attrs.map((a) => (
        <span key={a.name}>
          {' '}
          <span className={s.codeAttr}>{a.name}</span>=&quot;{a.name === 'class' ? hl(a.value) : a.value.length > 60 ? `${a.value.slice(0, 60)}…` : a.value}&quot;
        </span>
      ))}
      <span className={s.codeTag}>&gt;</span>
    </>
  );
  const text = (n: ChildNode) => {
    const v = (n.textContent ?? '').trim().replace(/\s+/g, ' ');
    return v.length > 80 ? `${v.slice(0, 80)}…` : v;
  };
  return (
    <div className={s.htmlNode} style={{ paddingLeft: depth ? 12 : 0 }}>
      <div
        ref={rowRef}
        className={el === selectedEl ? s.htmlRowOn : s.htmlRow}
        onPointerEnter={() => onPeek(el)}
        onPointerLeave={() => onPeek(null)}
        onClick={() => onSelect(el)}
      >
        {kids.length && !onlyText ? (
          <button
            type="button"
            className={s.htmlTwisty}
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
          >
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
        ) : (
          <span className={s.htmlTwisty} />
        )}
        {isChanged(el) ? <span className={s.htmlChanged} aria-hidden="true" /> : null}
        <span className={s.ellipsis}>
          {open_}
          {onlyText ? <span className={s.codeText}>{text(kids[0])}</span> : null}
          {onlyText || !kids.length || !open ? <span className={s.codeTag}>{!kids.length || onlyText ? '' : '…'}&lt;/{tag}&gt;</span> : null}
        </span>
      </div>
      {open && !onlyText
        ? kids.map((n, i) =>
            n.nodeType === 1 ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: DOM child order
              <HtmlNode key={i} el={n as Element} depth={depth + 1} selectedEl={selectedEl} isChanged={isChanged} onSelect={onSelect} onPeek={onPeek} whole={whole} />
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: DOM child order
              <div key={i} className={`${s.htmlText} ${s.ellipsis}`} style={{ paddingLeft: 12 + 16 }}>
                {text(n)}
              </div>
            ),
          )
        : null}
      {open && kids.length && !onlyText ? (
        <div className={s.htmlRow} style={{ paddingLeft: 16 }}>
          <span className={s.codeTag}>&lt;/{tag}&gt;</span>
        </div>
      ) : null}
    </div>
  );
}

/** One level of the component chain. Expanding shows the source where its JSX was written */
function ReactRow({ part, change, defaultOpen }: { part: ReactPart; change?: Change; defaultOpen: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  const loc = useAsync(() => resolveStack(part.stack), [part.stack]);
  return (
    <div className={s.reactRow}>
      <button type="button" className={s.codeToggle} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className={s.codeTag}>&lt;{part.name}</span>
        <span className={`${s.reactProps} ${s.ellipsis}`}>
          {part.props.slice(0, 4).map(([k, v]) => (
            <span key={k}>
              {' '}
              <span className={s.codeAttr}>{k}</span>={v}
            </span>
          ))}
          {part.props.length > 4 ? ' …' : ''}
        </span>
        <span className={s.codeTag}>&gt;</span>
        <span className={s.spacer} />
        {loc ? <span className={s.codeLocSmall}>{loc.replace(/^.*\//, '')}</span> : null}
      </button>
      {open ? (
        <div className={s.reactBody}>
          {part.props.length ? (
            <dl className={s.reactPropList}>
              {part.props.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {loc ? <SourceView loc={loc} around={6} change={change} /> : loc === null ? <p className={s.codeNote}>{t.noSource}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

type DrawerProps = {
  selected: Selected | null;
  /** The page's document when showing the whole page */
  doc: Document | null;
  change: Change | undefined;
  isChanged: (el: Element) => boolean;
  onSelect: (el: Element) => void;
  onPeek: (el: Element | null) => void;
  onClose: () => void;
  inlinePeek: boolean;
  onInlinePeek: () => void;
  floating: boolean;
};

/** Bottom drawer. HTML and React tabs show the contents of the selected element */
export function CodeDrawer({ selected, doc, change, isChanged, onSelect, onPeek, onClose, inlinePeek, onInlinePeek, floating }: DrawerProps) {
  const t = useT();
  const [tab, setTab] = useState<'html' | 'react'>(() => (load('nudgix.codeTab') === 'react' ? 'react' : 'html'));
  const [whole, setWhole] = useState(() => load('nudgix.codeWhole') === 'true');
  const [height, setHeight] = useState(() => Number(load('nudgix.codeHeight')) || 260);
  const chain = selected ? reactChain(selected.el) : [];

  // Use pointer capture on the grip. Listening on window loses events to the iframe when the pointer passes over it
  const drag = useRef<{ y: number; h: number; last: number } | null>(null);
  const resize = {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { y: e.clientY, h: height, last: height };
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!drag.current) return;
      drag.current.last = Math.min(Math.max(120, drag.current.h + drag.current.y - e.clientY), window.innerHeight - 160);
      setHeight(drag.current.last);
    },
    onPointerUp: () => {
      if (drag.current) save('nudgix.codeHeight', String(Math.round(drag.current.last)));
      drag.current = null;
    },
  };

  const pick = (next: 'html' | 'react') => {
    setTab(next);
    save('nudgix.codeTab', next);
  };

  return (
    <section className={floating ? s.drawerFloating : s.drawer} style={{ height }}>
      <div className={s.drawerGrip} {...resize} onLostPointerCapture={resize.onPointerUp} />
      <div className={s.drawerHead}>
        <div className={s.seg}>
          {(['html', 'react'] as const).map((k) => (
            <button key={k} type="button" className={s.segItem} data-pressed={tab === k ? '' : undefined} onClick={() => pick(k)}>
              {k === 'html' ? 'HTML' : 'React'}
            </button>
          ))}
        </div>
        {tab === 'html' ? (
          <div className={s.seg}>
            {[false, true].map((w) => (
              <button
                key={String(w)}
                type="button"
                className={s.segItem}
                data-pressed={whole === w ? '' : undefined}
                onClick={() => {
                  setWhole(w);
                  save('nudgix.codeWhole', String(w));
                }}
              >
                {w ? t.codeWhole : t.codeSelection}
              </button>
            ))}
          </div>
        ) : null}
        <span className={s.spacer} />
        <label className={s.drawerCheck}>
          <input type="checkbox" checked={inlinePeek} onChange={onInlinePeek} />
          {t.inlinePeek}
        </label>
        {selected && tab === 'html' ? <CopyButton text={selected.el.outerHTML} label={t.copyHtml} /> : null}
        <IconButton label={t.codeClose} shortcut="C" onClick={onClose}>
          <X size={13} />
        </IconButton>
      </div>
      <div className={s.drawerBody}>
        {tab === 'html' && whole && doc ? (
          <div className={s.htmlTree}>
            <HtmlNode el={doc.body} depth={0} selectedEl={selected?.el ?? doc.body} isChanged={isChanged} onSelect={onSelect} onPeek={onPeek} whole />
          </div>
        ) : !selected ? (
          <p className={s.codeNote}>{t.noSelection}</p>
        ) : tab === 'html' ? (
          <div className={s.htmlTree}>
            <HtmlNode el={selected.el} depth={0} selectedEl={selected.el} isChanged={isChanged} onSelect={onSelect} onPeek={onPeek} />
          </div>
        ) : change?.insert ? (
          <pre className={s.codeJsx}>{storyJsx(change.insert)}</pre>
        ) : !hasDebug(selected.el) ? (
          <p className={s.codeNote}>{t.noDebug}</p>
        ) : (
          <div>
            {chain.map((part, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: levels of the chain
              <ReactRow key={`${selected.el.tagName}${i}${part.name}`} part={part} change={change} defaultOpen={i === 0} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- small peek next to the selected element

/** Placed in the canvas overlay. Shows 3 lines around the source location just below the element */
export function InlinePeek({ el, change }: { el: Element; change: Change | undefined }) {
  const source = useAsync(() => locate(el), [el]);
  const near = useAsync(() => nearestSrc(el), [el]);
  const ref = useRef<HTMLDivElement>(null);
  // Follow page scroll and zoom. Like the handles, reposition every frame
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const box = ref.current;
      if (box && el.isConnected) {
        const r = el.getBoundingClientRect();
        const wrap = box.parentElement?.parentElement;
        const k = wrap ? wrap.getBoundingClientRect().width / wrap.offsetWidth || 1 : 1;
        const below = r.bottom + 8 + box.offsetHeight / k < (el.ownerDocument.defaultView?.innerHeight ?? 0);
        box.style.left = `${Math.max(4, r.left)}px`;
        box.style.top = below ? `${r.bottom + 8}px` : `${Math.max(4, r.top - 8 - box.offsetHeight / k)}px`;
        box.style.scale = String(1 / k);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [el]);
  const loc = source?.self ?? source?.usage ?? near?.loc;
  if (!loc && !change?.insert) return null;
  return (
    <div ref={ref} className={s.inlinePeek}>
      {change?.insert ? <pre className={s.codeJsx}>{storyJsx(change.insert)}</pre> : loc ? <SourceView loc={loc} around={3} change={change} /> : null}
    </div>
  );
}
