import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { Tooltip } from '@base-ui/react/tooltip';
import { ALargeSmall, Blend, ChevronDown, ChevronUp, CodeXml, Columns3, Copy, Command as CommandIcon, Maximize2, Moon, MousePointer2, Redo2, ScanSearch, SquareSplitHorizontal, Sun, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Canvas, type Width } from './components/Canvas';
import { CodeDrawer, InlinePeek } from './components/CodeView';
import { Handles } from './components/Handles';
import { CommandPalette, type Command } from './components/CommandPalette';
import { Specimen } from './components/Specimen';
import { IconButton, Tip } from './components/IconButton';
import { Breadcrumbs, ChangeList } from './components/LeftPane';
import { PromptPanel } from './components/PromptPanel';
import { PropertyPanel } from './components/PropertyPanel';
import s from './components/ui.module.css';
import { Waiting, type Status } from './components/Waiting';
import { type Captured, StoryGallery } from './components/StoryGallery';
import { type Drop, dropAt } from './lib/drop';
import { type Args, renderStory, type Story } from './lib/stories';
import { DICTS, LangContext, type Lang } from './i18n';
import { displayValue } from './lib/format';
import { clearResolvedCache, describeElement, detect, detectAll, preview, previewRaw, resolveToken, similarTo } from './lib/inspect';
import { PROP_BY_KEY, PROPS, tokenOf, type PropDef } from './lib/props';
import { findByLocator, loadSaved, locatorOf, save } from './lib/persist';
import { buildPrompt } from './lib/prompt';
import { adapter, emptyTokens, setAdapter } from './lib/adapters';
import { locate } from './lib/code';
import { setProjectDir } from './lib/project';
import { countOf, type Change, type Detection, type LayoutKey, type PropKey, type Selected, type Token, type Tokens } from './lib/types';

const WIDTHS: Width[] = ['fit', 390, 768, 1280];
type Layout = 'docked' | 'floating';
type Density = 'compact' | 'regular' | 'large';
const DENSITY_ZOOM: Record<Density, number> = { compact: 1, regular: 1.12, large: 1.25 };
const DENSITIES: Density[] = ['compact', 'regular', 'large'];
type Op = { el: Element; key: PropKey; prev?: string; next?: string };
type HistoryStep = { undo: () => void; redo: () => void };
const LAYOUT_CSS: Record<LayoutKey, string> = {
  display: 'display',
  flexDirection: 'flex-direction',
  justifyContent: 'justify-content',
  alignItems: 'align-items',
  flexWrap: 'flex-wrap',
};
const isEmpty = (c: Change) => countOf(c) === 0;

// 見た目の好みだけを覚える。使えない環境では毎回既定に戻るだけ
const stored = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

/**
 * 文字のキーは、日本語入力のままや CapsLock でも効くように、キーの位置（KeyS など）で決める。
 * JIS キーボードの ¥ キーも \ として扱う
 */
const keyOf = (e: KeyboardEvent) => {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
  if (e.code === 'Backslash' || e.code === 'IntlYen' || e.key === '¥') return '\\';
  return e.key;
};

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

export function App() {
  const [lang, setLang] = useState<Lang>(() => (stored('nudgix.lang') as Lang) ?? (navigator.language.startsWith('ja') ? 'ja' : 'en'));
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (stored('nudgix.theme') as 'light' | 'dark') ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'),
  );
  const [layout, setLayout] = useState<Layout>(() => (stored('nudgix.layout') as Layout) ?? 'docked');
  const [density, setDensity] = useState<Density>(() => (stored('nudgix.density') as Density) ?? 'compact');
  const [translucent, setTranslucent] = useState(() => stored('nudgix.translucent') !== 'false');
  const toggleTranslucent = () =>
    setTranslucent((v) => {
      store('nudgix.translucent', String(!v));
      return !v;
    });
  const [codeOpen, setCodeOpen] = useState(() => stored('nudgix.code') === 'open');
  const toggleCode = () =>
    setCodeOpen((v) => {
      store('nudgix.code', v ? 'closed' : 'open');
      return !v;
    });
  const [inlinePeek, setInlinePeek] = useState(() => stored('nudgix.inlinePeek') === 'true');
  const toggleInlinePeek = () =>
    setInlinePeek((v) => {
      store('nudgix.inlinePeek', String(!v));
      return !v;
    });
  const t = DICTS[lang];

  // パネルなどの UI だけを拡大縮小する。iframe の画面は等倍のまま
  useEffect(() => {
    document.documentElement.style.setProperty('--ui-zoom', String(DENSITY_ZOOM[density]));
  }, [density]);
  const cycleDensity = () =>
    setDensity((d) => {
      const next = DENSITIES[(DENSITIES.indexOf(d) + 1) % DENSITIES.length];
      store('nudgix.density', next);
      return next;
    });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = lang;
  }, [theme, lang]);

  const toggleLayout = () =>
    setLayout((prev) => {
      const next = prev === 'docked' ? 'floating' : 'docked';
      store('nudgix.layout', next);
      return next;
    });

  // ---------------------------------------------------------------- 起動の状態
  const [status, setStatus] = useState<Status | null>(null);
  const [ready, setReady] = useState(false);
  const refreshStatus = useCallback(async () => {
    try {
      const next: Status = await (await fetch('api/status', { cache: 'no-store' })).json();
      setStatus(next);
      setAdapter(next.adapter);
      setProjectDir(next.dir);
      if (next.targetUp) setReady(true);
    } catch {}
  }, []);
  useEffect(() => {
    refreshStatus();
    const id = setInterval(refreshStatus, ready ? 4000 : 1500);
    return () => clearInterval(id);
  }, [ready, refreshStatus]);

  // ---------------------------------------------------------------- トークンと選択
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [tokens, setTokens] = useState<Tokens | null>(null);
  const [tokensError, setTokensError] = useState<string | null>(null);
  const [route, setRoute] = useState('/');
  const [width, setWidth] = useState<Width>('fit');
  const [picking, setPicking] = useState(false);
  const [selection, setSelection] = useState<Selected[]>([]);
  const selected = selection.at(-1) ?? null;
  const [zoom, setZoom] = useState(false);
  const [before, setBefore] = useState(false);
  const [peek, setPeek] = useState<Element | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  // ギャラリーから運んでいる間の、落とす先の枠と線（iframe の座標）と、カーソルについてくる影（エディタの座標）
  const [dropHint, setDropHint] = useState<Drop | null>(null);
  const [storyGhost, setStoryGhost] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const lastDrop = useRef<Drop | null>(null);
  // 全画面のツールバーの位置。下の要素を選べるよう、ロゴをつかんで動かせる
  const [barPos, setBarPos] = useState<{ x: number; y: number } | null>(() => {
    try {
      return JSON.parse(stored('nudgix.barPos') ?? 'null');
    } catch {
      return null;
    }
  });
  const dragBar = (e: React.PointerEvent<HTMLElement>) => {
    const barEl = e.currentTarget.parentElement!;
    const bar = barEl.getBoundingClientRect();
    // left/top は親（キャンバス）基準で、UI の拡大率も掛かるので、画面の座標から直す
    const base = (barEl.offsetParent ?? document.body).getBoundingClientRect();
    const z = bar.width / barEl.offsetWidth || 1;
    const dx = e.clientX - bar.left;
    const dy = e.clientY - bar.top;
    let last: { x: number; y: number } | null = null;
    // iframe の上に入ると移動を取り逃がすので、ドラッグ中だけ全体を覆う
    const shield = document.createElement('div');
    shield.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:grabbing';
    document.body.appendChild(shield);
    const move = (ev: PointerEvent) => {
      const x = Math.max(base.left, Math.min(base.right - bar.width, ev.clientX - dx)) - base.left;
      const y = Math.max(base.top, Math.min(base.bottom - bar.height, ev.clientY - dy)) - base.top;
      last = { x: x / z, y: y / z };
      setBarPos(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      shield.remove();
      if (last) store('nudgix.barPos', JSON.stringify(last));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  // 全画面の左下（変更一覧とプロンプト）を畳んでおくか
  const [summaryOpen, setSummaryOpen] = useState(() => stored('nudgix.summary') !== 'closed');
  const history = useRef<{ undo: HistoryStep[]; redo: HistoryStep[] }>({ undo: [], redo: [] });
  // 並べ替えた親 → 子の並び。親が flex でも grid でもなかったときは縦の flex にして並べる
  const arrangements = useRef(new WeakMap<Element, Element[]>());
  const forcedParents = useRef(new WeakSet<Element>());
  const snapshots = useRef(new WeakMap<Element, Selected>());
  const [openKey, setOpenKey] = useState<PropKey | null>(null);
  // 要素 → 変更。要素は iframe の DOM なので state に入れず、変えたら再描画だけ起こす
  // 保存してあった変更は、要素が見つかるまで画面に無い仮の要素に結び付けておく
  const changes = useRef<Map<Element, Change>>(null as unknown as Map<Element, Change>);
  changes.current ??= new Map(loadSaved().map((c) => [document.createElement('i'), c]));
  const [version, bump] = useReducer((x: number) => x + 1, 0);

  const loadTokens = useCallback(async () => {
    try {
      const res = await fetch('api/tokens', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      // CSS 変数のトークンは画面のスタイルシートから集めるので、iframe が読み込まれてから
      const doc = frameRef.current?.contentDocument;
      if (!doc) return;
      clearResolvedCache(doc);
      setTokens(adapter().tokens(doc, body.tokens));
      setTokensError(null);
    } catch (error) {
      setTokensError(String((error as Error).message));
    }
  }, []);

  const findToken = (prop: PropDef, name: string | undefined) => tokenOf(tokens, prop.category, name);

  const restoreCommitted = (prop: PropDef) => {
    for (const { el } of selection) preview(el, prop, findToken(prop, changes.current.get(el)?.props[prop.key]));
  };

  const closeList = () => {
    if (openKey) restoreCommitted(PROP_BY_KEY[openKey]);
    setOpenKey(null);
  };

  // 選んだ時点の「現在」を覚えておく。プレビュー中の見た目で推定し直さないため
  const snapshot = (el: Element): Selected => {
    const existing = changes.current.get(el);
    if (existing) return { el, info: existing.info, baseline: existing.baseline };
    let snap = snapshots.current.get(el);
    if (!snap) {
      const created: Selected = { el, info: describeElement(el), baseline: detectAll(el, tokens!) };
      snapshots.current.set(el, (snap = created));
      // ファイル:行はソースマップを取ってくるので後から埋める
      locate(el).then((source) => {
        if (!source.self && !source.usage) return;
        created.info.source = source;
        persist();
        bump();
      });
    }
    return snap;
  };

  // 幅・高さは画面の幅や文字の書き換えで変わるので、幅や表示の切り替え・変更・選び直しのたびに測り直す。
  // 確定した幅・高さはプロンプトの変更前なので残す
  useEffect(() => {
    if (!tokens) return;
    const id = setTimeout(() => {
      let changed = false;
      for (const { el } of selection) {
        const snap = changes.current.get(el) ?? snapshots.current.get(el);
        if (!snap) continue;
        for (const key of ['width', 'height'] as const) {
          if (changes.current.get(el)?.props[key]) continue;
          const next = detect(el, PROP_BY_KEY[key], tokens);
          if (JSON.stringify(next) === JSON.stringify(snap.baseline[key])) continue;
          snap.baseline[key] = next;
          changed = true;
        }
      }
      if (changed) bump();
    }, 300);
    return () => clearTimeout(id);
  }, [width, layout, version, selection]);

  const select = (el: Element, additive = false) => {
    if (!tokens) return;
    closeList();
    const snap = snapshot(el);
    setSelection((prev) => {
      if (!additive) return [snap];
      return prev.some((x) => x.el === el) ? prev.filter((x) => x.el !== el) : [...prev, snap];
    });
  };

  const selectMany = (els: Element[], additive: boolean) => {
    if (!tokens || !els.length) return;
    closeList();
    const snaps = els.map(snapshot);
    setSelection((prev) => (additive ? [...prev.filter((x) => !els.includes(x.el)), ...snaps] : snaps));
  };

  // 今の要素は最後に置き、主な選択（selection の末尾）のままにする
  const selectSimilar = () => {
    if (!selected) return;
    selectMany([...similarTo(selected.el).filter((x) => x !== selected.el), selected.el], false);
  };

  const persist = () =>
    save([...changes.current.entries()].map(([el, c]) => ({ ...c, locator: c.locator ?? (c.insert ? '' : locatorOf(el)) })));

  /** 変更前と同じ値に戻したか。class のトークン名が同じか、トークン外の値が今の計算値と同じなら変更なしとして扱う */
  const sameAsBefore = (d: Detection | undefined, prop: PropDef, name: string) => {
    if (!d) return false;
    if (d.how === 'class') return d.name === name;
    if (!findToken(prop, name)?.raw || !d.value) return false;
    const n = (v: string) => (/^-?[\d.]+px$/.test(v) ? `${Math.round(Number.parseFloat(v) * 10) / 10}px` : v.trim());
    return n(d.value) === n(name);
  };

  // 変更はすべてここを通す。Undo/Redo と保存のため
  const apply = (ops: Op[], dir: 'prev' | 'next') => {
    for (const op of ops) {
      const prop = PROP_BY_KEY[op.key];
      const name = op[dir];
      let entry = changes.current.get(op.el);
      if (!entry && name) {
        const snap = snapshot(op.el);
        changes.current.set(op.el, (entry = { info: snap.info, baseline: snap.baseline, props: {}, locator: locatorOf(op.el) }));
      }
      if (!entry) continue;
      if (name && !sameAsBefore(entry.baseline[op.key], prop, name)) entry.props[op.key] = name;
      else delete entry.props[op.key];
      if (isEmpty(entry)) changes.current.delete(op.el);
      if (op.el.isConnected) preview(op.el, prop, findToken(prop, name));
    }
    persist();
    bump();
  };

  const push = (step: HistoryStep) => {
    history.current.undo.push(step);
    history.current.redo = [];
  };

  const run = (ops: Op[]) => {
    if (!ops.length) return;
    apply(ops, 'next');
    push({ undo: () => apply(ops, 'prev'), redo: () => apply(ops, 'next') });
  };

  const undo = () => {
    const step = history.current.undo.pop();
    if (!step) return;
    step.undo();
    history.current.redo.push(step);
  };

  const redo = () => {
    const step = history.current.redo.pop();
    if (!step) return;
    step.redo();
    history.current.undo.push(step);
  };

  const ensureEntry = (el: Element) => {
    let entry = changes.current.get(el);
    if (!entry) {
      const snap = snapshot(el);
      changes.current.set(el, (entry = { info: snap.info, baseline: snap.baseline, props: {}, locator: locatorOf(el) }));
    }
    return entry;
  };

  const settle = (el: Element) => {
    const entry = changes.current.get(el);
    if (entry && isEmpty(entry)) changes.current.delete(el);
    persist();
    bump();
  };

  // ---------------------------------------------------------------- 並び（向き・揃え・並べ替え）
  // flex の中では normal は flex-start（詰め方）や stretch（揃え）と同じ見た目になる
  const sameLayout = (key: LayoutKey, a: string, b: string | undefined) => {
    const norm = (v: string | undefined) => {
      if (key === 'justifyContent' && (v === 'normal' || v === 'start')) return 'flex-start';
      if (key === 'alignItems' && v === 'normal') return 'stretch';
      return v;
    };
    return norm(a) === norm(b);
  };
  const writeLayout = (el: Element, key: LayoutKey, value: string | undefined) => {
    const entry = ensureEntry(el);
    entry.layout ??= {};
    entry.layoutBase ??= {};
    if (!(key in entry.layoutBase)) entry.layoutBase[key] = el.ownerDocument.defaultView!.getComputedStyle(el).getPropertyValue(LAYOUT_CSS[key]);
    if (value === undefined || sameLayout(key, value, entry.layoutBase[key])) delete entry.layout[key];
    else entry.layout[key] = value;
    previewRaw(el, LAYOUT_CSS[key], value);
    settle(el);
  };

  // flex でも grid でもない要素で詰め方や揃えを変えるときは、先に flex にする。揃えのパッドは2つを一度に変えるので、まとめて1つの履歴にする
  const setLayoutProp = (patch: Partial<Record<LayoutKey, string>>) => {
    const items = selection.flatMap(({ el }) => {
      const keys = Object.entries(patch) as [LayoutKey, string][];
      const display = el.ownerDocument.defaultView!.getComputedStyle(el).display;
      if (!patch.display && !/flex|grid/.test(display)) keys.unshift(['display', 'flex']);
      return keys.map(([k, v]) => ({ el, k, next: v, prev: changes.current.get(el)?.layout?.[k] }));
    });
    const redoFn = () => items.forEach(({ el, k, next }) => writeLayout(el, k, next));
    redoFn();
    push({ undo: () => [...items].reverse().forEach(({ el, k, prev }) => writeLayout(el, k, prev)), redo: redoFn });
  };

  const arrange = (parent: Element, order: Element[] | undefined) => {
    if (!order) {
      arrangements.current.delete(parent);
      for (const child of parent.children) previewRaw(child, 'order', undefined);
      if (forcedParents.current.has(parent)) {
        previewRaw(parent, 'display', undefined);
        previewRaw(parent, 'flex-direction', undefined);
        forcedParents.current.delete(parent);
      }
      return;
    }
    const display = parent.ownerDocument.defaultView!.getComputedStyle(parent).display;
    if (!forcedParents.current.has(parent) && !/flex|grid/.test(display)) forcedParents.current.add(parent);
    if (forcedParents.current.has(parent)) {
      previewRaw(parent, 'display', 'flex');
      previewRaw(parent, 'flex-direction', 'column');
    }
    arrangements.current.set(parent, order);
    order.forEach((child, i) => previewRaw(child, 'order', String(i)));
  };

  /** 並べ替えた要素の変更に、親の今の並びを書いておく（再読み込みのあとに当て直すため） */
  const syncOrder = (parent: Element) => {
    const order = arrangements.current.get(parent);
    const kids = [...parent.children];
    for (const child of kids) {
      const entry = changes.current.get(child);
      // 別の親へ移した要素の move は移し先での位置なので、元の親の並びは書かない
      if (entry?.move === undefined || entry.into) continue;
      if (order) entry.order = order.map((c) => kids.indexOf(c));
      else delete entry.order;
    }
  };

  const shortName = (el: Element) => {
    const info = describeElement(el);
    return `${info.components[0] ?? info.tag}${info.text ? ` "${info.text.slice(0, 20)}"` : ''}`;
  };

  /** 兄弟の今の並び（並べ替え済みならその順） */
  const siblingsOf = (el: Element) => {
    const parent = el.parentElement;
    return parent ? (arrangements.current.get(parent) ?? [...parent.children]) : [el];
  };

  /** 選んだ要素を、自分を除いた兄弟の並びの index 番目に入れる */
  const moveTo = (index: number) => {
    const el = selected?.el;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const had = arrangements.current.get(parent);
    const before = siblingsOf(el);
    const rest = before.filter((c) => c !== el);
    const j = Math.max(0, Math.min(rest.length, index));
    if (before.indexOf(el) === j) return;
    const after = [...rest.slice(0, j), el, ...rest.slice(j)];
    const prevMove = changes.current.get(el)?.move;
    const nextMove = j === 0 ? '' : shortName(after[j - 1]);
    const prevNudge = changes.current.get(el)?.nudge;
    // 自由にずらしていた要素を並べ替えたら、ずらしは0に戻す
    const writeNudge = (v: { x: number; y: number } | undefined) => {
      const entry = ensureEntry(el);
      if (v && (v.x || v.y)) entry.nudge = v;
      else delete entry.nudge;
      previewRaw(el, 'translate', v ? `${v.x}px ${v.y}px` : undefined);
    };
    const moved = changes.current.get(el);
    if (moved?.into && moved.intoLoc) {
      // 別の親へ移した要素は、移し先の中でも要素を実際に動かし、当て直し用の挿入位置を書き直す
      const prevLoc = moved.intoLoc;
      const prevNext = el.nextSibling;
      const ref = after[j + 1] ?? null;
      // 挿入位置は、自分がいない状態の位置で覚える（当て直しは移す前の画面で探すため）
      el.remove();
      const nextLoc = { parent: prevLoc.parent, before: ref ? locatorOf(ref) : null };
      const write = (node: Node | null, value: string | undefined, loc: typeof prevLoc) => {
        place(el, parent, node);
        const entry = ensureEntry(el);
        if (value === undefined) delete entry.move;
        else entry.move = value;
        entry.intoLoc = loc;
        settle(el);
      };
      writeNudge(undefined);
      write(ref, nextMove, nextLoc);
      push({
        undo: () => {
          writeNudge(prevNudge);
          write(prevNext, prevMove, prevLoc);
        },
        redo: () => {
          writeNudge(undefined);
          write(ref, nextMove, nextLoc);
        },
      });
      return;
    }
    const set = (order: Element[] | undefined, value: string | undefined) => {
      arrange(parent, order);
      const entry = ensureEntry(el);
      if (value === undefined) delete entry.move;
      else entry.move = value;
      syncOrder(parent);
      settle(el);
    };
    // 元の並び（DOM の順）に戻ったら、並べ替えは無かったことにする
    const natural = [...parent.children];
    const back = after.length === natural.length && after.every((c, i) => c === natural[i]);
    const order = back ? undefined : after;
    const value = back ? undefined : nextMove;
    writeNudge(undefined);
    set(order, value);
    push({
      undo: () => {
        writeNudge(prevNudge);
        set(had, prevMove);
      },
      redo: () => {
        writeNudge(undefined);
        set(order, value);
      },
    });
  };

  const move = (dir: -1 | 1) => {
    if (selected) moveTo(siblingsOf(selected.el).indexOf(selected.el) + dir);
  };

  // 別の親へ移した要素の元の場所。戻すときに使う
  const origins = useRef(new WeakMap<Element, { parent: Element; next: Node | null }>());

  /** 親の中で ref の直前に el を入れる。並べ替え済みの親なら、その並びにも入れる */
  const place = (el: Element, parent: Element, ref: Node | null) => {
    const from = el.parentElement;
    previewRaw(el, 'order', undefined);
    parent.insertBefore(el, ref);
    if (from && arrangements.current.has(from)) arrange(from, arrangements.current.get(from)!.filter((c) => c !== el));
    const arr = arrangements.current.get(parent);
    if (arr) {
      const rest = arr.filter((c) => c !== el);
      const i = ref ? rest.indexOf(ref as Element) : rest.length;
      rest.splice(i < 0 ? rest.length : i, 0, el);
      arrange(parent, rest);
    }
  };

  // shortcut: 画面では要素を実際に別の親へ移すので、React がその辺りを描き直すと崩れることがある。崩れたら再読み込みで当て直す
  const moveInto = (container: Element, ref: Element | null) => {
    const el = selected?.el;
    const from = el?.parentElement;
    if (!el || !from || container === from || el.contains(container)) return;
    const entry = ensureEntry(el);
    if (!origins.current.has(el)) origins.current.set(el, { parent: from, next: el.nextSibling });
    const back = { parent: from, next: el.nextSibling };
    // 元の親と移し先の並べ替えも、戻すときに元どおりにする
    const fromOrder = arrangements.current.get(from)?.slice();
    const toOrder = arrangements.current.get(container)?.slice();
    // 自由にずらしていた要素をどこかへ入れたら、ずらしは0に戻す
    const prev = { move: entry.move, into: entry.into, intoLoc: entry.intoLoc, nudge: entry.nudge };
    const kids = (arrangements.current.get(container) ?? [...container.children]).filter((c) => c !== el);
    const i = ref ? kids.indexOf(ref) : kids.length;
    const next = {
      move: i <= 0 ? '' : shortName(kids[i - 1]),
      into: shortName(container),
      intoLoc: { parent: locatorOf(container), before: ref ? locatorOf(ref) : null },
      nudge: undefined,
    };
    const write = (v: typeof prev) => {
      const e = ensureEntry(el);
      for (const k of ['move', 'into', 'intoLoc', 'nudge'] as const) {
        if (v[k] === undefined) delete e[k];
        else (e as Record<string, unknown>)[k] = v[k];
      }
      previewRaw(el, 'translate', v.nudge ? `${v.nudge.x}px ${v.nudge.y}px` : undefined);
      settle(el);
    };
    const redoFn = () => {
      place(el, container, ref);
      syncOrder(from);
      write(next);
    };
    redoFn();
    push({
      undo: () => {
        place(el, back.parent, back.next);
        arrange(from, fromOrder);
        arrange(container, toOrder);
        syncOrder(from);
        write(prev);
      },
      redo: redoFn,
    });
  };

  // 削除は display:none で隠して試す。並びの display を変えていたら、戻すときはそれに戻す
  const showRemoved = (el: Element, removed: boolean) =>
    previewRaw(el, 'display', removed ? 'none' : changes.current.get(el)?.layout?.display);

  // ---------------------------------------------------------------- ストーリーの差し込み
  /** html から要素を作って parent の ref の前に入れ、変更として記録する */
  const insertStory = (story: Story, captured: Captured, parent: Element, ref: Element | null) => {
    const { html } = captured;
    const doc = parent.ownerDocument;
    const tpl = doc.createElement('template');
    tpl.innerHTML = html.trim();
    const node = tpl.content.firstElementChild;
    if (!node) return;
    node.setAttribute('data-nudgix-story', story.id);
    const kids = (arrangements.current.get(parent) ?? [...parent.children]).filter((c) => c !== node);
    const i = ref ? kids.indexOf(ref) : kids.length;
    // 置き場所は、差し込む前の画面の位置で覚える（当て直しは差し込む前の画面で探すため）
    const intoLoc = { parent: locatorOf(parent), before: ref ? locatorOf(ref) : null };
    const into = shortName(parent);
    place(node, parent, ref);
    const snap = snapshot(node);
    const entry: Change = {
      info: snap.info,
      baseline: snap.baseline,
      props: {},
      insert: { ...story, html, args: captured.args, argTypes: captured.argTypes },
      into,
      move: i <= 0 ? '' : shortName(kids[i - 1]),
      intoLoc,
    };
    const write = (on: boolean) => {
      if (on) {
        if (!node.isConnected) place(node, parent, ref?.parentElement === parent ? ref : null);
        changes.current.set(node, entry);
      } else {
        node.remove();
        changes.current.delete(node);
      }
      persist();
      bump();
    };
    write(true);
    push({ undo: () => write(false), redo: () => write(true) });
    select(node);
  };

  /** 差し込んだストーリーの args を変え、描き直した要素に差し替える */
  // Props は描き直しに時間がかかるので、続けて変えても前の結果の上に重ねるよう順番に処理する。
  // 描き直すと要素が入れ替わるので、入れ替わった先をたどれるようにしておく
  const storyQueue = useRef(Promise.resolve());
  const replacedBy = useRef(new WeakMap<Element, Element>());
  const setStoryArg = (el: Element, key: string, value: Args[string]) => {
    storyQueue.current = storyQueue.current.then(() => applyStoryArg(el, key, value)).catch(() => {});
  };
  const applyStoryArg = async (first: Element, key: string, value: Args[string]) => {
    let el = first;
    for (let next = replacedBy.current.get(el); next; next = replacedBy.current.get(el)) el = next;
    const entry = changes.current.get(el);
    if (!entry?.insert) return;
    const args = { ...entry.insert.args, [key]: value };
    const shot = await renderStory(entry.insert.id, args);
    const parent = el.parentElement;
    if (!shot || !parent || !el.isConnected) return;
    const tpl = el.ownerDocument.createElement('template');
    tpl.innerHTML = shot.html.trim();
    const node = tpl.content.firstElementChild;
    if (!node) return;
    node.setAttribute('data-nudgix-story', entry.insert.id);
    // children などで文字が変わるので、パネルや変更一覧に出す文字の頭も描き直した部品から取り直す
    const next: Change = { ...entry, info: { ...entry.info, text: (node.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40) }, insert: { ...entry.insert, html: shot.html, args } };
    // 差し替えても、当てていたトークンや並びの変更はそのまま当てる
    const swap = (from: Element, to: Element, e: Change) => {
      const p = from.parentElement;
      if (!p) return;
      p.replaceChild(to, from);
      replacedBy.current.delete(to);
      replacedBy.current.set(from, to);
      const arr = arrangements.current.get(p);
      if (arr) arrange(p, arr.map((c) => (c === from ? to : c)));
      for (const [k, name] of Object.entries(e.props)) preview(to, PROP_BY_KEY[k as PropKey], findToken(PROP_BY_KEY[k as PropKey], name));
      for (const [k, v] of Object.entries(e.layout ?? {})) previewRaw(to, LAYOUT_CSS[k as LayoutKey], v);
      if (e.nudge) previewRaw(to, 'translate', `${e.nudge.x}px ${e.nudge.y}px`);
      changes.current.delete(from);
      changes.current.set(to, e);
      persist();
      select(to);
    };
    swap(el, node, next);
    push({ undo: () => swap(node, el, entry), redo: () => swap(el, node, next) });
  };

  /** ギャラリーのカードを運んでいる間と、落としたとき */
  const onGalleryDrag = (story: Story, captured: Captured, at: { x: number; y: number } | null, drop: boolean) => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (!at) {
      const target = lastDrop.current;
      lastDrop.current = null;
      setDropHint(null);
      setStoryGhost(null);
      if (drop && target) insertStory(story, captured, target.parent, target.kids[target.index] ?? null);
      return;
    }
    if (!frame || !doc) return;
    const fr = frame.getBoundingClientRect();
    const k = fr.width / frame.offsetWidth || 1;
    setStoryGhost({ left: at.x - 12, top: at.y - 12, width: captured.width * k, height: captured.height * k });
    const inside = at.x >= fr.left && at.x <= fr.right && at.y >= fr.top && at.y <= fr.bottom;
    const next = inside
      ? dropAt(doc, (at.x - fr.left) / k, (at.y - fr.top) / k, {
          area: captured.width * captured.height,
          fallback: doc.body,
          orderOf: (p) => arrangements.current.get(p) ?? [...p.children],
        })
      : null;
    lastDrop.current = next;
    setDropHint(next);
  };

  const removeSelected = () => {
    const all = selection.map((x) => x.el).filter((el) => !changes.current.get(el)?.removed);
    if (!all.length) return;
    const parent = all.at(-1)!.parentElement;
    // 差し込んだ要素は、隠すのではなく取り出す（差し込みを取り消すのと同じ）
    const inserted = all.filter((el) => changes.current.get(el)?.insert).map((el) => ({ el, entry: changes.current.get(el)!, parent: el.parentElement!, next: el.nextSibling }));
    const els = all.filter((el) => !changes.current.get(el)?.insert);
    const write = (on: boolean) => {
      for (const x of inserted) {
        if (on) {
          x.el.remove();
          changes.current.delete(x.el);
        } else {
          place(x.el, x.parent, x.next?.parentNode === x.parent ? x.next : null);
          changes.current.set(x.el, x.entry);
        }
      }
      if (inserted.length) {
        persist();
        bump();
      }
      for (const el of els) {
        const e = ensureEntry(el);
        if (on) e.removed = true;
        else delete e.removed;
        showRemoved(el, on);
        settle(el);
      }
    };
    write(true);
    push({ undo: () => write(false), redo: () => write(true) });
    // 消した要素は枠が出せないので、親を選び直す
    if (parent && parent !== parent.ownerDocument.body) select(parent);
    else setSelection([]);
  };

  // ---------------------------------------------------------------- 文字の書き換え
  /** 文字だけの要素なら、文字のノードをそのまま書き換える（React が持っているノードを差し替えないため） */
  const setText = (el: Element, value: string) => {
    const only = el.childNodes.length === 1 && el.firstChild?.nodeType === Node.TEXT_NODE ? (el.firstChild as Text) : null;
    if (only) only.data = value;
    else el.textContent = value;
  };

  const editing = useRef<{ el: HTMLElement; start: string } | null>(null);

  const finishEdit = (keep: boolean) => {
    const cur = editing.current;
    if (!cur) return;
    editing.current = null;
    const { el, start } = cur;
    el.removeAttribute('contenteditable');
    const next = el.textContent ?? '';
    if (!keep || next === start) {
      setText(el, start);
      return;
    }
    const prev = changes.current.get(el)?.text;
    const from = prev?.from ?? start;
    const write = (to: string | undefined) => {
      const e = ensureEntry(el);
      if (to === undefined || to === from) delete e.text;
      else e.text = { from, to };
      setText(el, to ?? from);
      settle(el);
    };
    write(next);
    push({ undo: () => write(prev?.to), redo: () => write(next) });
  };

  // 選んだ要素（かその中）の、子要素を持たない文字の要素だけ編集できる
  const startEdit = (el: Element) => {
    const root = selected?.el;
    // 編集中のダブルクリック（単語の選択）で編集をやり直すと、元の文字を失う
    if (editing.current) return;
    if (!root || !(root === el || root.contains(el)) || el.children.length || !el.textContent?.trim()) return;
    // 書き換える前の文字で要素の説明を作っておく（当て直しのときに本人か確かめるのに使う）
    snapshot(el);
    const h = el as HTMLElement;
    editing.current = { el: h, start: h.textContent ?? '' };
    h.setAttribute('contenteditable', 'plaintext-only');
    h.focus();
    const range = h.ownerDocument.createRange();
    range.selectNodeContents(h);
    const sel = h.ownerDocument.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    h.addEventListener('blur', () => finishEdit(true), { once: true });
  };

  /** 見た目だけずらす。CSS の translate で、ほかの変形とは重ならない */
  const nudge = (dx: number, dy: number) => {
    const el = selected?.el;
    if (!el || (!dx && !dy)) return;
    const prev = changes.current.get(el)?.nudge;
    const next = { x: (prev?.x ?? 0) + dx, y: (prev?.y ?? 0) + dy };
    const write = (v: { x: number; y: number } | undefined) => {
      const e = ensureEntry(el);
      if (v && (v.x || v.y)) e.nudge = v;
      else delete e.nudge;
      previewRaw(el, 'translate', v ? `${v.x}px ${v.y}px` : undefined);
      settle(el);
    };
    write(next);
    push({ undo: () => write(prev), redo: () => write(next) });
  };

  const commit = (prop: PropDef, name: string | null) => {
    setOpenKey(null);
    run(selection.map(({ el }) => ({ el, key: prop.key, prev: changes.current.get(el)?.props[prop.key], next: name ?? undefined })));
  };

  // 要素の変更をまとめて外す・戻す（トークン・並び・並べ替え）
  const revertStep = (el: Element): HistoryStep | null => {
    const entry = changes.current.get(el);
    if (!entry) return null;
    const saved = structuredClone(entry);
    const parent = el.parentElement;
    const order = parent ? arrangements.current.get(parent) : undefined;
    const destination = { next: el.nextSibling };
    const show = (on: boolean) => {
      for (const [k, name] of Object.entries(saved.props)) {
        const prop = PROP_BY_KEY[k as PropKey];
        if (el.isConnected) preview(el, prop, on ? findToken(prop, name) : undefined);
      }
      for (const [k, v] of Object.entries(saved.layout ?? {})) previewRaw(el, LAYOUT_CSS[k as LayoutKey], on ? v : undefined);
      // shortcut: 1つを戻すと同じ親のほかの並べ替えも外れる。兄弟を個別に戻したくなったら並びを要素ごとに持つ
      if (saved.move !== undefined && parent && !saved.into) arrange(parent, on ? order : undefined);
      if (saved.removed) previewRaw(el, 'display', on ? 'none' : undefined);
      if (saved.text) setText(el, on ? saved.text.to : saved.text.from);
      if (saved.nudge) previewRaw(el, 'translate', on ? `${saved.nudge.x}px ${saved.nudge.y}px` : undefined);
      if (saved.insert) {
        if (on) place(el, parent!, destination.next?.parentNode === parent ? destination.next : null);
        else el.remove();
      }
      const origin = origins.current.get(el);
      if (saved.into && origin && !saved.insert) {
        if (on) place(el, parent!, destination.next?.parentNode === parent ? destination.next : null);
        else place(el, origin.parent, origin.next);
      }
      if (on) changes.current.set(el, structuredClone(saved));
      else changes.current.delete(el);
      persist();
      bump();
    };
    return { undo: () => show(true), redo: () => show(false) };
  };

  const revertMany = (els: Element[]) => {
    const steps = els.map(revertStep).filter((x): x is HistoryStep => !!x);
    if (!steps.length) return;
    for (const st of steps) st.redo();
    push({ undo: () => steps.forEach((st) => st.undo()), redo: () => steps.forEach((st) => st.redo()) });
  };
  const revert = (el: Element) => revertMany([el]);
  const revertAll = () => revertMany([...changes.current.keys()]);

  const reorderFromSaved = (el: Element, order: number[]) => {
    const parent = el.parentElement;
    if (!parent || order.length !== parent.children.length) return;
    const apply = () => arrange(parent, order.map((i) => parent.children[i]));
    apply();
    // 読み込み直後は React が子を差し替えることがあり、そうなると order が外れるので掛け直す
    const watch = new MutationObserver(() => {
      const now = arrangements.current.get(parent);
      if (!now) return watch.disconnect();
      if (now.some((c) => c.parentElement !== parent) && order.length === parent.children.length) apply();
    });
    watch.observe(parent, { childList: true });
  };

  // iframe が読み直されると、履歴と選択が指す要素は古い DOM のものになるので捨てる
  const loadedDoc = useRef<Document | null>(null);
  const onFrameLoad = () => {
    const doc = frameRef.current?.contentDocument ?? null;
    if (doc !== loadedDoc.current) {
      if (loadedDoc.current) {
        history.current = { undo: [], redo: [] };
        editing.current = null;
        setSelection([]);
      }
      loadedDoc.current = doc;
    }
    loadTokens();
  };

  // iframe の読み直しや画面遷移のあと、保存した変更の要素を探して当て直す
  useEffect(() => {
    const doc = frameRef.current?.contentDocument;
    if (!tokens || !doc) return;
    // 要素がまだ見つからない変更と、別の親への移動がまだ済んでいない変更があれば、探し直しを続ける
    const pending = () =>
      [...changes.current.entries()].some(
        ([el, e]) => e.info.route === route && ((!el.isConnected && (e.locator || e.insert)) || (el.isConnected && e.intoLoc && !origins.current.has(el))),
      );
    const rehydrate = () => {
      let moved = false;
      const relink = () => {
        for (const [key, entry] of [...changes.current.entries()]) {
          if (key.isConnected || entry.info.route !== route || !entry.locator) continue;
          const el = findByLocator(doc, entry.locator);
          if (!el || el.tagName.toLowerCase() !== entry.info.tag || changes.current.has(el)) continue;
        // 位置だけだと、要素を移したあとなどに別の要素を指すことがあるので、文字の頭でも本人か確かめる
        const head = ((el as HTMLElement).innerText ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 10);
        if (entry.info.text && head !== entry.info.text.slice(0, 10)) continue;
          changes.current.delete(key);
          changes.current.set(el, entry);
          for (const [k, name] of Object.entries(entry.props)) preview(el, PROP_BY_KEY[k as PropKey], findToken(PROP_BY_KEY[k as PropKey], name));
          for (const [k, v] of Object.entries(entry.layout ?? {})) previewRaw(el, LAYOUT_CSS[k as LayoutKey], v);
          if (entry.order) reorderFromSaved(el, entry.order);
          if (entry.nudge) previewRaw(el, 'translate', `${entry.nudge.x}px ${entry.nudge.y}px`);
          if (entry.removed) previewRaw(el, 'display', 'none');
          if (entry.text && el.textContent === entry.text.from) setText(el, entry.text.to);
          moved = true;
        }
      };
      relink();
      // 別の親へ移す当て直しは、ほかの要素を位置で探し終えてから行う（先に動かすと位置がずれる）。
      // 移し先と挿入位置も、1つ目を動かす前に全部探しておく
      const moves = [...changes.current].flatMap(([el, entry]) => {
        if (!entry.intoLoc || !el.isConnected || entry.info.route !== route) return [];
        const parent = findByLocator(doc, entry.intoLoc.parent);
        const ref = entry.intoLoc.before ? findByLocator(doc, entry.intoLoc.before) : null;
        return parent && parent !== el.parentElement && !el.contains(parent) ? [{ el, parent, ref }] : [];
      });
      // 差し込んだストーリーも、置き場所を先に探してから作り直す
      const inserts = [...changes.current].flatMap(([key, entry]) => {
        if (!entry.insert || key.isConnected || !entry.intoLoc || entry.info.route !== route) return [];
        const parent = findByLocator(doc, entry.intoLoc.parent);
        const ref = entry.intoLoc.before ? findByLocator(doc, entry.intoLoc.before) : null;
        return parent ? [{ key, entry, parent, ref }] : [];
      });
      for (const { el, parent, ref } of moves) {
        origins.current.set(el, { parent: el.parentElement!, next: el.nextSibling });
        place(el, parent, ref?.parentElement === parent ? ref : null);
        moved = true;
      }
      for (const { key, entry, parent, ref } of inserts) {
        const tpl = doc.createElement('template');
        tpl.innerHTML = entry.insert!.html.trim();
        const node = tpl.content.firstElementChild;
        if (!node) continue;
        node.setAttribute('data-nudgix-story', entry.insert!.id);
        place(node, parent, ref?.parentElement === parent ? ref : null);
        changes.current.delete(key);
        changes.current.set(node, entry);
        for (const [k, name] of Object.entries(entry.props)) preview(node, PROP_BY_KEY[k as PropKey], findToken(PROP_BY_KEY[k as PropKey], name));
        for (const [k, v] of Object.entries(entry.layout ?? {})) previewRaw(node, LAYOUT_CSS[k as LayoutKey], v);
        moved = true;
      }
      // 移したあとに記録した変更は、移したあとの位置で覚えているので、もう一度探す
      relink();
      if (moved) bump();
    };
    rehydrate();
    if (!pending()) return;
    // データを取ってから描く部分は読み込みの時点ではまだ無いので、画面が変わるたびに探し直す
    let raf = 0;
    const watch = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        rehydrate();
        if (!pending()) watch.disconnect();
      });
    });
    watch.observe(doc.body, { childList: true, subtree: true });
    const stop = setTimeout(() => watch.disconnect(), 10_000);
    return () => {
      watch.disconnect();
      clearTimeout(stop);
      cancelAnimationFrame(raf);
    };
    // biome-ignore lint: tokens は iframe の読み込みごとに取り直すので、それを合図にする
  }, [tokens, route]);

  // 押している間だけ変更前：確定した差し替えを一時的に外す
  useEffect(() => {
    for (const [el, entry] of changes.current) {
      if (!el.isConnected) continue;
      for (const [k, name] of Object.entries(entry.props)) {
        const prop = PROP_BY_KEY[k as PropKey];
        preview(el, prop, before ? undefined : findToken(prop, name));
      }
      for (const [k, v] of Object.entries(entry.layout ?? {})) previewRaw(el, LAYOUT_CSS[k as LayoutKey], before ? undefined : v);
      if (entry.removed) showRemoved(el, !before);
      if (entry.insert) previewRaw(el, 'display', before ? 'none' : entry.layout?.display);
      if (entry.text) setText(el, before ? entry.text.from : entry.text.to);
      if (entry.nudge) previewRaw(el, 'translate', before ? undefined : `${entry.nudge.x}px ${entry.nudge.y}px`);
      if (entry.order && el.parentElement) {
        if (before) arrange(el.parentElement, undefined);
        else reorderFromSaved(el, entry.order);
      }
    }
    // biome-ignore lint: 切り替えたときだけ当て直す
  }, [before]);

  const changeList = [...changes.current.entries()];
  const positionOf = (el: Element) => {
    const kids = siblingsOf(el);
    return { index: kids.indexOf(el), total: kids.length };
  };
  const prompt = buildPrompt(changeList.map(([, c]) => c), tokens ?? emptyTokens(), t, !!status?.hasSkill);

  // ---------------------------------------------------------------- キーボード（エディタと iframe の両方から呼ぶ）
  const onKeyDown = (e: KeyboardEvent) => {
    // 編集中の要素が描き直しで消えると blur が来ないので、ここで編集の状態を捨てる
    if (editing.current && !editing.current.el.isConnected) editing.current = null;
    const key = keyOf(e);
    if (editing.current) {
      if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        e.stopPropagation();
        const el = editing.current.el;
        finishEdit(e.key === 'Enter');
        el.blur();
      }
      return;
    }
    if (e.key === 'Escape') {
      if (openKey) closeList();
      else if (picking) setPicking(false);
      else if (zoom) setZoom(false);
      else if (selection.length) setSelection([]);
      else return;
      e.preventDefault();
      return;
    }
    if (key === 'k' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setPaletteOpen((o) => !o);
      return;
    }
    if (isTyping(e.target)) return;
    if (key === 'z' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (key === 'c' && e.metaKey && e.shiftKey && changeList.length) {
      e.preventDefault();
      navigator.clipboard.writeText(prompt).catch(() => {});
      return;
    }
    if (e.altKey && selected && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      move(e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) {
      e.preventDefault();
      removeSelected();
      return;
    }
    if (key === 's') {
      e.preventDefault();
      setPicking((p) => !p);
    } else if (key === 'z') {
      e.preventDefault();
      setZoom((z) => !z);
    } else if (key === '\\') {
      e.preventDefault();
      if (!e.repeat) setBefore(true);
    } else if (key === 'f') {
      e.preventDefault();
      toggleLayout();
    } else if (key === 'c') {
      e.preventDefault();
      toggleCode();
    } else if (key === 'a' && selected) {
      e.preventDefault();
      selectSimilar();
    } else if (selected && !openKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const next = e.key === 'ArrowUp' ? selected.el.parentElement : selected.el.firstElementChild;
      if (next && next !== next.ownerDocument.body && next !== next.ownerDocument.documentElement) {
        e.preventDefault();
        select(next);
      }
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (keyOf(e) === '\\') setBefore(false);
  };
  const keyRef = useRef({ onKeyDown, onKeyUp });
  keyRef.current = { onKeyDown, onKeyUp };
  useEffect(() => {
    const down = (e: KeyboardEvent) => keyRef.current.onKeyDown(e);
    const up = (e: KeyboardEvent) => keyRef.current.onKeyUp(e);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const initialPath = useMemo(() => new URLSearchParams(location.search).get('path') ?? '/', []);

  if (!ready || !status) {
    return (
      <LangContext.Provider value={lang}>
        <Tooltip.Provider delay={300}>{status ? <Waiting status={status} /> : null}</Tooltip.Provider>
      </LangContext.Provider>
    );
  }

  // ---------------------------------------------------------------- 部品（両方のレイアウトで使い回す）
  const floating = layout === 'floating';

  const langToggle = (
    <ToggleGroup
      className={s.seg}
      aria-label={t.language}
      value={[lang]}
      onValueChange={(v) => {
        if (!v[0]) return;
        setLang(v[0] as Lang);
        store('nudgix.lang', v[0]);
      }}
    >
      <Toggle className={s.segItem} value="ja">
        JA
      </Toggle>
      <Toggle className={s.segItem} value="en">
        EN
      </Toggle>
    </ToggleGroup>
  );

  const themeButton = (
    <IconButton
      label={t.themeToggle}
      onClick={() => {
        const next = theme === 'dark' ? 'light' : 'dark';
        setTheme(next);
        store('nudgix.theme', next);
      }}
    >
      {theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />}
    </IconButton>
  );

  const pickButton = (
    <IconButton label={t.pick} shortcut="S" pressed={picking} variant={picking ? 'primary' : 'ghost'} onClick={() => setPicking((p) => !p)}>
      <MousePointer2 size={14} />
    </IconButton>
  );

  const copyPrompt = () => navigator.clipboard.writeText(prompt).catch(() => {});
  const closePalette = () => {
    for (const prop of PROPS) restoreCommitted(prop);
    setPaletteOpen(false);
  };
  const runAndClose = (fn: () => void) => () => {
    closePalette();
    fn();
  };
  const commands: Command[] = [
    ...(selected && tokens
      ? PROPS.flatMap((prop) =>
          tokens[prop.category].map((token) => {
            const value = resolveToken(selected.el.ownerDocument, prop.category, token);
            return {
              id: `${prop.key}:${token.name}`,
              group: t.props[prop.key],
              label: token.name,
              hint: displayValue(prop.category, value),
              icon: <Specimen category={prop.category} value={value} />,
              keywords: `${DICTS.ja.props[prop.key]} ${DICTS.en.props[prop.key]} ${DICTS.ja.groups[prop.group]} ${DICTS.en.groups[prop.group]} ${prop.key} ${token.description}`,
              onPreview: () => {
                for (const p of PROPS) restoreCommitted(p);
                for (const { el } of selection) preview(el, prop, token);
              },
              onRun: () => {
                setPaletteOpen(false);
                commit(prop, token.name);
              },
            };
          }),
        )
      : []),
    { id: 'pick', group: t.paletteActions, label: t.pick, hint: 'S', onRun: runAndClose(() => setPicking(true)) },
    ...(selected ? [{ id: 'similar', group: t.paletteActions, label: t.selectSimilar, hint: 'A', onRun: runAndClose(selectSimilar) }] : []),
    { id: 'code', group: t.paletteActions, label: codeOpen ? t.codeClose : t.codeOpen, hint: 'C', keywords: 'code html react source コード ソース', onRun: runAndClose(toggleCode) },
    { id: 'inlinePeek', group: t.paletteActions, label: inlinePeek ? t.inlinePeekOff : t.inlinePeekOn, keywords: 'code peek コード', onRun: runAndClose(toggleInlinePeek) },
    { id: 'zoom', group: t.paletteActions, label: t.zoomTo, hint: 'Z', onRun: runAndClose(() => setZoom((z) => !z)) },
    { id: 'copy', group: t.paletteActions, label: t.copy, hint: '⌘⇧C', onRun: runAndClose(copyPrompt) },
    { id: 'undo', group: t.paletteActions, label: t.undo, hint: '⌘Z', onRun: runAndClose(undo) },
    { id: 'redo', group: t.paletteActions, label: t.redo, hint: '⇧⌘Z', onRun: runAndClose(redo) },
    { id: 'layout', group: t.paletteActions, label: floating ? t.layoutDocked : t.layoutFloating, hint: 'F', onRun: runAndClose(toggleLayout) },
    { id: 'density', group: t.paletteActions, label: t.densityNow(t.densities[density]), keywords: 'density size zoom 密度 大きさ', onRun: runAndClose(cycleDensity) },
    { id: 'translucent', group: t.paletteActions, label: translucent ? t.translucentOff : t.translucentOn, keywords: 'opacity translucent 透明', onRun: runAndClose(toggleTranslucent) },
    { id: 'theme', group: t.paletteActions, label: t.themeToggle, onRun: runAndClose(() => setTheme((x) => (x === 'dark' ? 'light' : 'dark'))) },
  ];

  const densityButton = (
    <IconButton label={t.densityNow(t.densities[density])} onClick={cycleDensity}>
      <ALargeSmall size={14} />
    </IconButton>
  );

  const paletteButton = (
    <IconButton label={t.command} shortcut="⌘K" onClick={() => setPaletteOpen(true)}>
      <CommandIcon size={14} />
    </IconButton>
  );

  const historyButtons = (
    <>
      <IconButton label={t.undo} shortcut="⌘Z" disabled={!history.current.undo.length} onClick={undo}>
        <Undo2 size={14} />
      </IconButton>
      <IconButton label={t.redo} shortcut="⇧⌘Z" disabled={!history.current.redo.length} onClick={redo}>
        <Redo2 size={14} />
      </IconButton>
    </>
  );

  const viewButtons = (
    <>
      <IconButton label={t.zoomTo} shortcut="Z" pressed={zoom} disabled={!selected} onClick={() => setZoom((z) => !z)}>
        <ScanSearch size={14} />
      </IconButton>
      <IconButton
        label={t.holdBefore}
        shortcut={"\\"}
        pressed={before}
        disabled={!changeList.length}
        onPointerDown={() => setBefore(true)}
        onPointerUp={() => setBefore(false)}
        onPointerLeave={() => setBefore(false)}
      >
        <SquareSplitHorizontal size={14} />
      </IconButton>
    </>
  );

  const layoutButton = (
    <IconButton label={floating ? t.layoutDocked : t.layoutFloating} shortcut="F" onClick={toggleLayout}>
      {floating ? <Columns3 size={14} /> : <Maximize2 size={14} />}
    </IconButton>
  );

  const codeButton = (
    <IconButton label={codeOpen ? t.codeClose : t.codeOpen} shortcut="C" pressed={codeOpen} onClick={toggleCode}>
      <CodeXml size={14} />
    </IconButton>
  );

  const translucentButton = (
    <IconButton label={translucent ? t.translucentOff : t.translucentOn} onClick={toggleTranslucent} pressed={translucent}>
      <Blend size={14} />
    </IconButton>
  );

  const widthToggle = (
    <ToggleGroup className={s.seg} value={[String(width)]} onValueChange={(v) => v[0] && setWidth(v[0] === 'fit' ? 'fit' : (Number(v[0]) as Width))}>
      {WIDTHS.map((w) => (
        <Tip key={w} label={t.width[w]}>
          <Toggle className={s.segItem} value={String(w)}>
            {w === 'fit' ? '↔' : w}
          </Toggle>
        </Tip>
      ))}
    </ToggleGroup>
  );

  const canvas = (
    <Canvas
      frameRef={frameRef}
      initialPath={initialPath}
      width={width}
      floating={floating}
      picking={picking}
      selectedEls={selection.map((x) => x.el)}
      zoom={zoom}
      onPick={(el, additive) => {
        // Shift を押していれば選択モードのまま足していく
        if (!additive) setPicking(false);
        select(el, additive);
      }}
      onPickMany={(els, additive) => {
        setPicking(false);
        selectMany(els, additive);
      }}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onRoute={setRoute}
      onLoad={onFrameLoad}
      onDoubleClick={startEdit}
      peek={peek}
    >
      {selected?.el.isConnected && tokens && !picking ? (
        <Handles
          el={selected.el}
          tokens={tokens}
          onPreview={(keys, token) => {
            for (const key of keys) {
              const prop = PROP_BY_KEY[key];
              if (token) for (const { el } of selection) preview(el, prop, token);
              else restoreCommitted(prop);
            }
          }}
          onCommit={(keys, name) =>
            run(selection.flatMap(({ el }) => keys.map((key) => ({ el, key, prev: changes.current.get(el)?.props[key], next: name }))))
          }
          orderOf={(parent: Element) => arrangements.current.get(parent) ?? [...parent.children]}
          onMoveTo={moveTo}
          onMoveInto={moveInto}
          onNudge={nudge}
          onRemove={removeSelected}
          onSimilar={selectSimilar}
        />
      ) : null}
      {inlinePeek && selected?.el.isConnected && !picking ? <InlinePeek el={selected.el} change={changes.current.get(selected.el)} /> : null}
      {dropHint ? (
        <div className={s.handles}>
          <div className={s.moveTarget} style={dropHint.target} />
          {dropHint.line ? <div className={s.moveLine} style={dropHint.line} /> : null}
        </div>
      ) : null}
    </Canvas>
  );

  const tokensErrorPanel = tokensError ? (
    <section className={s.panel}>
      <p className={s.warnText}>
        {t.tokensError}: {tokensError}
      </p>
    </section>
  ) : null;

  const propertyPanel =
    selected && tokens ? (
      <PropertyPanel
        selected={selected}
        change={changes.current.get(selected.el)}
        tokens={tokens}
        openKey={openKey}
        onToggle={(key) => {
          closeList();
          setOpenKey(openKey === key ? null : key);
        }}
        count={selection.length}
        onLayout={setLayoutProp}
        onStoryArg={(key, value) => setStoryArg(selected.el, key, value)}
        onMove={move}
        onSimilar={selectSimilar}
        position={positionOf(selected.el)}
        onPreview={(prop, token?: Token) => {
          for (const { el } of selection) preview(el, prop, token);
        }}
        onRestore={restoreCommitted}
        onCommit={commit}
      />
    ) : null;

  const changePanel = tokens ? (
    <ChangeList changes={changeList} tokens={tokens} selectedEl={selected?.el ?? null} onSelect={select} onRevert={revert} onRevertAll={revertAll} />
  ) : null;

  const codeDrawer = codeOpen ? (
    <CodeDrawer
      selected={selected?.el.isConnected ? selected : null}
      doc={ready ? (frameRef.current?.contentDocument ?? null) : null}
      change={selected ? changes.current.get(selected.el) : undefined}
      isChanged={(el) => changes.current.has(el)}
      onSelect={select}
      onPeek={setPeek}
      onClose={toggleCode}
      inlinePeek={inlinePeek}
      onInlinePeek={toggleInlinePeek}
      floating={floating}
    />
  ) : null;

  const promptPanel = <PromptPanel prompt={prompt} empty={changeList.length === 0} hasSkill={!!status?.hasSkill} onInstalled={refreshStatus} />;

  // 選んだ要素と重ならないよう、要素が右半分にあれば全画面のパネルを左に出す
  const selRect = selected?.el.isConnected ? selected.el.getBoundingClientRect() : null;
  const frameW = frameRef.current?.clientWidth ?? 0;
  const [near, far] = selRect && selRect.left + selRect.width / 2 > frameW / 2 ? [s.floatLeft, s.floatRight] : [s.floatRight, s.floatLeft];

  // 2つのレイアウトで iframe（canvas）の位置を変えない。作り直されると画面が読み直され、変更が消える
  return (
    <LangContext.Provider value={lang}>
      <Tooltip.Provider delay={300}>
        <div className={floating ? `${s.floatRoot} ${translucent ? '' : s.opaque}` : s.app} style={galleryOpen ? ({ '--drawer': '352px' } as React.CSSProperties) : undefined}>
          {floating ? null : (
            <header className={s.header}>
              <div className={s.brand}>
                <span className={s.logo} aria-hidden="true" />
                nudgix
              </div>
              <div className={s.route}>
                <span className={s.dot} aria-hidden="true" style={status.targetUp ? undefined : { background: 'var(--warn)' }} />
                {(status.target ?? '').replace(/^https?:\/\//, '')}
                {route}
              </div>
              <span className={s.spacer} />
              {paletteButton}
              {densityButton}
              {langToggle}
              {themeButton}
            </header>
          )}

          <div className={floating ? s.floatBody : s.body}>
            {floating ? null : (
              <aside className={s.left}>
                {selected ? <Breadcrumbs el={selected.el} onSelect={select} onPeek={setPeek} /> : null}
                {changePanel}
              </aside>
            )}

            <main className={floating ? s.floatBody : s.center}>
              {floating ? null : (
                <div className={s.toolbar}>
                  <div className={s.toolGroup}>
                    {pickButton}
                    {viewButtons}
                  </div>
                  <div className={s.toolGroup}>{historyButtons}</div>
                  <span className={s.spacer} />
                  {widthToggle}
                  <div className={s.toolGroup}>
                    {codeButton}
                    {layoutButton}
                  </div>
                </div>
              )}
              {canvas}
              {floating ? null : codeDrawer}
            </main>

            {floating ? null : (
              <aside className={s.right}>
                {tokensErrorPanel}
                {propertyPanel ?? (
                  <section className={s.scrollPanel}>
                    <p className={s.empty}>{t.noSelection}</p>
                  </section>
                )}
                {promptPanel}
              </aside>
            )}
          </div>

          {floating ? (
            <>
              <div className={s.floatBar} style={barPos ? { left: `clamp(0px, ${barPos.x}px, calc(100% - 160px))`, top: `clamp(0px, ${barPos.y}px, calc(100% - 44px))`, transform: 'none' } : undefined}>
                <Tip label={t.moveBar}>
                  <span
                    className={`${s.logo} ${s.barGrip}`}
                    onPointerDown={dragBar}
                    onDoubleClick={() => {
                      setBarPos(null);
                      store('nudgix.barPos', 'null');
                    }}
                  />
                </Tip>
                {pickButton}
                {viewButtons}
                <span className={s.floatSep} />
                {historyButtons}
                <span className={s.floatSep} />
                {widthToggle}
                <span className={s.floatSep} />
                {codeButton}
                {layoutButton}
                {translucentButton}
                {paletteButton}
                {densityButton}
                {themeButton}
                {langToggle}
              </div>
              {selected ? (
                <div className={`${s.floatCol} ${near}`}>
                  {tokensErrorPanel}
                  <Breadcrumbs el={selected.el} onSelect={select} onPeek={setPeek} />
                  {propertyPanel}
                </div>
              ) : null}
              {codeDrawer}
              {changeList.length ? (
                <div className={`${s.floatCol} ${s.floatBottom} ${far}`}>
                  {summaryOpen ? (
                    <>
                      {changePanel}
                      {promptPanel}
                    </>
                  ) : null}
                  <div className={s.floatPill}>
                    <button
                      type="button"
                      className={s.pillToggle}
                      aria-expanded={summaryOpen}
                      onClick={() =>
                        setSummaryOpen((o) => {
                          store('nudgix.summary', o ? 'closed' : 'open');
                          return !o;
                        })
                      }
                    >
                      {summaryOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                      {t.changes}
                      <span className={s.count}>{changeList.reduce((n, [, c]) => n + countOf(c), 0)}</span>
                    </button>
                    <IconButton label={t.copy} shortcut="⌘⇧C" variant="primary" onClick={copyPrompt}>
                      <Copy size={14} />
                    </IconButton>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
        {ready ? <StoryGallery open={galleryOpen} onToggle={() => setGalleryOpen((o) => !o)} storybookUp={!!status?.storybookUp} onDrag={onGalleryDrag} /> : null}
        {storyGhost ? <div className={s.storyGhost} style={storyGhost} /> : null}
        <CommandPalette
          open={paletteOpen}
          commands={commands}
          onClose={closePalette}
          anchor={() => {
            // iframe の中の位置を、拡大率を戻してエディタの画面の座標に直す
            const frame = frameRef.current;
            if (!selected?.el.isConnected || !frame) return null;
            const fr = frame.getBoundingClientRect();
            const k = fr.width / frame.offsetWidth || 1;
            const r = selected.el.getBoundingClientRect();
            return { left: fr.left + r.left * k, top: fr.top + r.top * k, bottom: fr.top + r.bottom * k };
          }}
        />
      </Tooltip.Provider>
    </LangContext.Provider>
  );
}
