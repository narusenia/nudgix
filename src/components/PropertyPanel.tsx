import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { AlignHorizontalSpaceBetween, AlignVerticalSpaceBetween, ArrowDown, ArrowRight, ArrowUp, Check, Group, StretchHorizontal, StretchVertical, WrapText } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useT, type Dict } from '../i18n';
import { resolveToken } from '../lib/inspect';
import { deltaText, displayValue } from '../lib/format';
import { PROP_BY_KEY, PROPS, rawValue, tokenOf, type PropDef } from '../lib/props';
import type { Category, Change, Detection, LayoutKey, PropKey, Selected, Token, Tokens } from '../lib/types';
import { CodeTab } from './CodeView';
import { IconButton, Tip } from './IconButton';
import { Specimen } from './Specimen';
import s from './ui.module.css';

type Props = {
  selected: Selected;
  change: Change | undefined;
  tokens: Tokens;
  openKey: PropKey | null;
  count: number;
  onLayout: (patch: Partial<Record<LayoutKey, string>>) => void;
  onStoryArg: (key: string, value: string | number | boolean) => void;
  onMove: (dir: -1 | 1) => void;
  onSimilar: () => void;
  position: { index: number; total: number };
  onToggle: (key: PropKey) => void;
  onPreview: (prop: PropDef, token: Token | undefined) => void;
  onRestore: (prop: PropDef) => void;
  onCommit: (prop: PropDef, name: string | null) => void;
  /** Comment for the selection. With several elements selected it belongs to their common parent */
  note: string;
  /** Bumped by the comment tool to put the cursor in the comment field */
  noteFocus: number;
  onNote: (note: string) => void;
};

function describe(d: Detection, t: Dict, category: Category): { text: string; hint?: string } {
  if (d.how === 'class') return { text: d.name };
  if (d.how === 'value') {
    const names = d.candidates;
    if (names.length === 1) return { text: names[0], hint: t.guessed };
    return { text: t.oneOf(names.slice(0, 2).join(' / '), names.length - 2), hint: `${t.guessed}（${displayValue(category, d.value)}）` };
  }
  if (d.how === 'zero') return { text: t.none };
  return { text: t.outside(displayValue(category, d.value)) };
}

const px = (v: string | undefined) => (v && /^-?[\d.]+px$/.test(v) ? Number.parseFloat(v) : null);

/** Comment for the agent. Kept local while typing and committed once, so undo restores the whole comment */
export function NoteField({
  el,
  value,
  placeholder,
  focusKey = 0,
  onCommit,
}: { el: Element; value: string; placeholder?: string; focusKey?: number; onCommit: (note: string) => void }) {
  const t = useT();
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusKey) ref.current?.focus();
  }, [focusKey]);
  useEffect(() => setDraft(value), [value, el]);
  return (
    <textarea
      ref={ref}
      className={s.noteInput}
      rows={draft.includes('\n') ? 3 : 1}
      value={draft}
      placeholder={placeholder ?? t.notePlaceholder}
      title={t.noteHint}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        // Keep editor shortcuts (delete, undo and so on) from firing while typing
        e.stopPropagation();
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.blur();
        if (e.key === 'Escape') {
          setDraft(value);
          requestAnimationFrame(() => (e.target as HTMLTextAreaElement).blur());
        }
      }}
    />
  );
}

export function PropertyPanel(props: Props) {
  const { selected, change, tokens, openKey, count, onToggle } = props;
  const t = useT();
  const { info } = selected;
  const doc = selected.el.ownerDocument;
  // When another element is selected, scroll back to the top. Keeping the previous scroll position makes it hard to tell which field is which
  const scrollRef = useRef<HTMLElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [selected.el]);
  const [tab, setTab] = useState<'props' | 'code'>(() => {
    try {
      return localStorage.getItem('nudgix.panelTab') === 'code' ? 'code' : 'props';
    } catch {
      return 'props';
    }
  });
  const pickTab = (next: 'props' | 'code') => {
    setTab(next);
    try {
      localStorage.setItem('nudgix.panelTab', next);
    } catch {}
  };

  /** Current value (the token's value if committed, otherwise the value at selection time) */
  const currentOf = (prop: PropDef) => {
    const committed = change?.props[prop.key];
    const token = tokenOf(tokens, prop.category, committed);
    return { committed, value: (token ? resolveToken(doc, prop.category, token) : selected.baseline[prop.key].value) ?? '' };
  };

  const list = (prop: PropDef) =>
    openKey === prop.key ? (
      <TokenList
        prop={prop}
        doc={doc}
        list={tokens[prop.category]}
        current={currentOf(prop)}
        onPreview={(token) => props.onPreview(prop, token)}
        onRestore={() => props.onRestore(prop)}
        onCommit={(name) => props.onCommit(prop, name)}
      />
    ) : null;

  const row = (prop: PropDef, compact = false) => {
    const { committed, value } = currentOf(prop);
    const d = describe(selected.baseline[prop.key], t, prop.category);
    const valueNode = (
      <span className={committed ? s.propValueChanged : s.propValue}>
        <Specimen category={prop.category} value={value} />
        {/* In narrow two-column rows, drop the "off-token" label and show only the value */}
        <span className={s.ellipsis}>{committed ?? (compact && selected.baseline[prop.key].how === 'none' ? displayValue(prop.category, value) : d.text)}</span>
      </span>
    );
    return (
      <button key={prop.key} type="button" className={compact ? `${s.propRow} ${s.propRowCompact}` : s.propRow} aria-expanded={openKey === prop.key} onClick={() => onToggle(prop.key)}>
        <span className={compact ? s.propLabelCompact : s.propLabel}>{t.propsShort[prop.key] ?? t.props[prop.key]}</span>
        {d.hint && !committed ? <Tip label={d.hint}>{valueNode}</Tip> : valueNode}
      </button>
    );
  };

  const rowWithList = (prop: PropDef) => (
    <div key={prop.key}>
      {row(prop)}
      {list(prop)}
    </div>
  );

  return (
    <section ref={scrollRef} className={s.scrollPanel}>
      <div className={s.target}>
        <div className={s.targetName}>
          {count > 1 ? t.manySelected(count) : info.components[0] ?? info.tag}{' '}
          {count > 1 ? null : <span style={{ color: 'var(--sub)', fontWeight: 400 }}>· {info.tag}</span>}
          <span className={s.spacer} />
          <IconButton label={t.selectSimilar} shortcut="A" onClick={props.onSimilar}>
            <Group size={13} />
          </IconButton>
        </div>
        {info.text && count === 1 ? <div className={s.targetText}>{t.quote(info.text)}</div> : null}
        <NoteField el={selected.el} focusKey={props.noteFocus} value={props.note} placeholder={count > 1 ? t.noteMany(count) : undefined} onCommit={props.onNote} />
        <div className={`${s.seg} ${s.panelTabs}`}>
          {(['props', 'code'] as const).map((k) => (
            <button key={k} type="button" className={s.segItem} data-pressed={tab === k ? '' : undefined} onClick={() => pickTab(k)}>
              {k === 'props' ? t.properties : t.code}
            </button>
          ))}
        </div>
      </div>
      {tab === 'code' ? (
        <CodeTab selected={selected} change={change} />
      ) : (
        <>
      {change?.insert?.argTypes && Object.keys(change.insert.argTypes).length ? (
        <StoryProps args={change.insert.args ?? {}} argTypes={change.insert.argTypes} onChange={props.onStoryArg} />
      ) : null}
      {/* Like Figma's right panel, list layout → spacing → size → appearance → text, separated by lines */}
      <PanelSection title={t.layout}>
        <LayoutSection el={selected.el} position={props.position} onLayout={props.onLayout} onMove={props.onMove} />
      </PanelSection>
      <PanelSection title={t.groups.space}>
        <BoxModel selected={selected} change={change} openKey={openKey} onToggle={onToggle} />
        {PROPS.filter((p) => p.group === 'space').map((p) => (
          <div key={p.key}>{list(p)}</div>
        ))}
      </PanelSection>
      <PanelSection title={t.groups.size}>
        <div className={s.sizeGrid}>{SIZE_KEYS.map((key) => row(PROP_BY_KEY[key], true))}</div>
        {SIZE_KEYS.map((key) => (
          <div key={key}>{list(PROP_BY_KEY[key])}</div>
        ))}
      </PanelSection>
      <PanelSection title={t.appearance}>{APPEARANCE_KEYS.map((key) => rowWithList(PROP_BY_KEY[key]))}</PanelSection>
      <PanelSection title={t.groups.text}>{TEXT_KEYS.filter((key) => key !== 'textStyle' || tokens.textStyles.length).map((key) => rowWithList(PROP_BY_KEY[key]))}</PanelSection>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- props of inserted stories (Storybook args)
type ArgTypes = NonNullable<NonNullable<Change['insert']>['argTypes']>;

function StoryProps({ args, argTypes, onChange }: { args: Record<string, string | number | boolean>; argTypes: ArgTypes; onChange: Props['onStoryArg'] }) {
  const t = useT();
  return (
    <section className={s.pSection}>
      <h3 className={s.pSectionTitle}>{t.storyProps}</h3>
      {Object.entries(argTypes).map(([key, c]) => {
        const v = args[key];
        return (
          <div key={key} className={s.layoutRow}>
            <span className={s.propLabel} title={key}>
              {key}
            </span>
            {c.kind === 'select' && c.options!.length <= 4 ? (
              <ToggleGroup className={s.seg} value={v === undefined ? [] : [String(v)]} onValueChange={(next) => next[0] && onChange(key, next[0])}>
                {c.options!.map((o) => (
                  <Toggle key={o} className={s.segItem} value={o}>
                    {o}
                  </Toggle>
                ))}
              </ToggleGroup>
            ) : c.kind === 'select' ? (
              <select className={s.argInput} value={v === undefined ? '' : String(v)} onChange={(e) => onChange(key, e.target.value)}>
                {v === undefined ? <option value="">–</option> : null}
                {c.options!.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : c.kind === 'boolean' ? (
              <input type="checkbox" checked={!!v} onChange={(e) => onChange(key, e.target.checked)} />
            ) : (
              <ArgText value={v === undefined ? '' : String(v)} number={c.kind === 'number'} onCommit={(next) => onChange(key, c.kind === 'number' ? Number(next) : next)} />
            )}
          </div>
        );
      })}
    </section>
  );
}

/** Text and numbers rerender on Enter or blur (rerendering per keystroke is heavy) */
function ArgText({ value, number, onCommit }: { value: string; number: boolean; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onCommit(draft);
  return (
    <input
      className={s.argInput}
      type={number ? 'number' : 'text'}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}

// ---------------------------------------------------------------- layout: like Figma auto layout, with direction, alignment pad, space-between and stretch
const POS = ['flex-start', 'center', 'flex-end'] as const;

/** Normalize computed values to flex terms */
function norm(v: string, fallback: string) {
  if (v === 'normal' || v === '') return fallback;
  if (v === 'start' || v === 'left') return 'flex-start';
  if (v === 'end' || v === 'right') return 'flex-end';
  return v;
}

function LayoutSection({ el, position, onLayout, onMove }: { el: Element; position: Props['position']; onLayout: Props['onLayout']; onMove: Props['onMove'] }) {
  const t = useT();
  const cs = el.ownerDocument.defaultView!.getComputedStyle(el);
  const flex = cs.display.includes('flex');
  const row = flex && !cs.flexDirection.startsWith('column');
  const wrap = flex && cs.flexWrap !== 'nowrap';
  const dir = !flex ? null : wrap ? 'wrap' : row ? 'row' : 'column';
  const justify = flex ? norm(cs.justifyContent, 'flex-start') : null;
  const align = flex ? norm(cs.alignItems, 'stretch') : null;
  const between = justify === 'space-between';
  const stretch = align === 'stretch';

  const setDir = (v: string) => {
    if (v === 'wrap') onLayout({ flexDirection: 'row', flexWrap: 'wrap' });
    else onLayout({ flexDirection: v, ...(wrap ? { flexWrap: 'nowrap' } : {}) });
  };

  // The pad's horizontal axis is x and vertical is y. In a row, x is justify; in a column, x is align
  const cell = (x: number, y: number) => {
    const main = POS[row ? x : y];
    const cross = POS[row ? y : x];
    const onMain = between || justify === main;
    const onCross = stretch || align === cross;
    const on = flex && onMain && onCross;
    const patch = between ? { alignItems: cross } : { justifyContent: main, alignItems: cross };
    const label = `${t.layoutKeys.justifyContent}: ${between ? t.layoutValues['space-between'] : t.layoutValues[main]} · ${t.layoutKeys.alignItems}: ${t.layoutValues[cross]}`;
    return (
      <Tip key={`${x}${y}`} label={label}>
        <button type="button" className={on ? s.padCellOn : s.padCell} aria-pressed={on} onClick={() => onLayout(patch)}>
          <span className={s.padBars} style={{ flexDirection: row ? 'row' : 'column', justifyContent: POS[row ? x : y], alignItems: POS[row ? y : x] }}>
            <i style={row ? { height: 8 } : { width: 8 }} />
            <i style={row ? { height: 12 } : { width: 12 }} />
            <i style={row ? { height: 6 } : { width: 6 }} />
          </span>
        </button>
      </Tip>
    );
  };

  return (
    <>
      <div className={s.layoutRow}>
        <span className={s.propLabel}>{t.order}</span>
        <span className={s.layoutPos}>{position.total > 1 ? `${position.index + 1} / ${position.total}` : '–'}</span>
        <IconButton label={t.moveUp} shortcut="⌥↑" disabled={position.index <= 0} onClick={() => onMove(-1)}>
          <ArrowUp size={13} />
        </IconButton>
        <IconButton label={t.moveDown} shortcut="⌥↓" disabled={position.index < 0 || position.index >= position.total - 1} onClick={() => onMove(1)}>
          <ArrowDown size={13} />
        </IconButton>
      </div>
      <div className={s.layoutRow}>
        <span className={s.propLabel}>{t.layoutKeys.flexDirection}</span>
        <ToggleGroup className={s.seg} value={dir ? [dir] : []} onValueChange={(v) => v[0] && setDir(v[0])}>
          <Tip label={t.layoutValues.column}>
            <Toggle className={s.segIcon} value="column" aria-label={t.layoutValues.column}>
              <ArrowDown size={13} />
            </Toggle>
          </Tip>
          <Tip label={t.layoutValues.row}>
            <Toggle className={s.segIcon} value="row" aria-label={t.layoutValues.row}>
              <ArrowRight size={13} />
            </Toggle>
          </Tip>
          <Tip label={t.layoutKeys.flexWrap}>
            <Toggle className={s.segIcon} value="wrap" aria-label={t.layoutKeys.flexWrap}>
              <WrapText size={13} />
            </Toggle>
          </Tip>
        </ToggleGroup>
      </div>
      <div className={s.layoutRow}>
        <span className={s.propLabel}>{t.layoutKeys.alignItems}</span>
        <div className={s.pad}>{[0, 1, 2].map((y) => [0, 1, 2].map((x) => cell(x, y)))}</div>
        <div className={s.padSide}>
          <IconButton
            label={t.layoutValues['space-between']}
            pressed={between}
            onClick={() => onLayout({ justifyContent: between ? 'flex-start' : 'space-between' })}
          >
            {row || !flex ? <AlignHorizontalSpaceBetween size={13} /> : <AlignVerticalSpaceBetween size={13} />}
          </IconButton>
          <IconButton label={t.layoutValues.stretch} pressed={stretch && flex} onClick={() => onLayout({ alignItems: stretch ? 'flex-start' : 'stretch' })}>
            {row || !flex ? <StretchVertical size={13} /> : <StretchHorizontal size={13} />}
          </IconButton>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- spacing: box model diagram like DevTools / Figma
function BoxModel({ selected, change, openKey, onToggle }: { selected: Selected; change: Change | undefined; openKey: PropKey | null; onToggle: (key: PropKey) => void }) {
  const t = useT();
  const cell = (key: PropKey) => {
    const committed = change?.props[key];
    const d = selected.baseline[key];
    const full = committed ?? describe(d, t, 'spacing').text;
    // The diagram is cramped, so show only the last segment of the token name (4 for --space-4)
    const tail = (name: string) => name.replace(/^--/, '').split(/[-.]/).at(-1) || name;
    const short = committed ? tail(committed) : d.how === 'zero' ? '–' : d.how === 'class' ? tail(d.name) : (px(d.value) ?? '?').toString();
    return (
      <Tip label={`${t.props[key]}: ${full}`}>
        <button type="button" className={committed ? s.bmCellChanged : s.bmCell} aria-expanded={openKey === key} onClick={() => onToggle(key)}>
          {short}
        </button>
      </Tip>
    );
  };
  return (
    <div className={s.boxModel}>
      <span className={s.bmTag}>margin</span>
      <div className={s.bmEdge}>{cell('marginTop')}</div>
      <div className={s.bmMiddle}>
      {cell('marginLeft')}
      <div className={s.bmPadding}>
        <span className={s.bmTag}>padding</span>
        <div className={s.bmEdge}>{cell('paddingTop')}</div>
        <div className={s.bmMiddle}>
          {cell('paddingLeft')}
          <div className={s.bmContent}>
            <span className={s.bmTag}>gap</span>
            {cell('gap')}
          </div>
          {cell('paddingRight')}
        </div>
        <div className={s.bmEdge}>{cell('paddingBottom')}</div>
      </div>
      {cell('marginRight')}
      </div>
      <div className={s.bmEdge}>{cell('marginBottom')}</div>
    </div>
  );
}

// ---------------------------------------------------------------- token list (with a large sample and a comparison under the cursor)
type ListProps = {
  prop: PropDef;
  doc: Document;
  list: Token[];
  current: { committed: string | undefined; value: string };
  onPreview: (token: Token | undefined) => void;
  onRestore: () => void;
  onCommit: (name: string | null) => void;
};

function TokenList({ prop, doc, list, current, onPreview, onRestore, onCommit }: ListProps) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<Token | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const root = ref.current;
    const active = root?.querySelector<HTMLButtonElement>('[data-active]') ?? root?.querySelector<HTMLButtonElement>('button');
    active?.focus({ preventScroll: true });
    active?.scrollIntoView({ block: 'nearest' });
  }, []);

  const show = (token: Token | undefined, at?: HTMLElement) => {
    setHovered(token ?? null);
    onPreview(token);
    // When stepping with the keyboard, show it below the row instead of at the cursor
    if (at) {
      const r = at.getBoundingClientRect();
      setCursor({ x: r.left + 24, y: r.bottom - 6 });
    }
  };

  // Stepping through options with ↑↓ applies the focused option to the page immediately
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[Math.max(0, Math.min(buttons.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    next?.focus();
    next?.scrollIntoView({ block: 'nearest' });
  };

  // Tokens the adapter gave a group heading are listed under each heading
  const groups = new Map<string, Token[]>();
  for (const x of list) groups.set(x.group ?? '', [...(groups.get(x.group ?? '') ?? []), x]);
  const hoveredValue = hovered ? resolveToken(doc, prop.category, hovered) : undefined;
  const fromName = current.committed ?? '';
  const delta = deltaText(current.value, hoveredValue);

  return (
    <div className={s.tokenListWrap}>
      <BigSpecimen category={prop.category} current={current.value} candidate={hoveredValue ?? current.value} name={hovered?.name ?? current.committed ?? ''} delta={delta} />
      {prop.key === 'textStyle' ? null : <RawInput prop={prop} committed={current.committed} onPreview={(v) => show(v ? { name: v, description: '', raw: true } : undefined)} onRestore={onRestore} onCommit={onCommit} />}
      <div
        ref={ref}
        className={s.tokenList}
        onMouseMove={(e) => setCursor({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => {
          setHovered(null);
          setCursor(null);
          onRestore();
        }}
        onKeyDown={onKeyDown}
      >
        <button type="button" className={s.token} onMouseEnter={() => show(undefined)} onFocus={(e) => show(undefined, e.currentTarget)} onClick={() => onCommit(null)}>
          <span className={s.tokenName} style={{ fontFamily: 'var(--sans)' }}>
            {t.keep}
          </span>
        </button>
        {[...groups]
          .map(([title, items]) => (
            <div key={title}>
              {title ? <div className={s.tokenGroupTitle}>{title}</div> : null}
              {items.map((token) => {
                const value = resolveToken(doc, prop.category, token);
                const active = token.name === current.committed;
                return (
                  <button
                    key={token.name}
                    type="button"
                    className={s.token}
                    data-active={active || undefined}
                    onMouseEnter={() => show(token)}
                    onFocus={(e) => show(token, e.currentTarget)}
                    onClick={() => onCommit(token.name)}
                  >
                    <span className={s.specSlot}>
                      <Specimen category={prop.category} value={value} />
                    </span>
                    <span className={s.tokenName}>{token.name}</span>
                    {/* Shadow values are long and crowd out the name, so leave them off the row (they appear in the large sample and next to the cursor) */}
                    {prop.category === 'shadows' ? null : <span className={s.tokenValue}>{displayValue(prop.category, value)}</span>}
                    <span className={s.tokenCheck}>{active ? <Check /> : null}</span>
                  </button>
                );
              })}
            </div>
          ))}
      </div>
      {hovered && cursor ? (
        <div
          className={s.cursorTip}
          // Near the right edge, show it left of the cursor so it does not overflow
          style={cursor.x > innerWidth - 380 ? { right: innerWidth - cursor.x + 14, top: cursor.y + 18 } : { left: cursor.x + 14, top: cursor.y + 18 }}
        >
          <span className={s.cursorTipLabel}>{t.props[prop.key]}</span>
          <span className={s.cursorTipFrom}>{fromName || displayValue(prop.category, current.value)}</span>
          <span aria-hidden="true">→</span>
          <span className={s.cursorTipTo}>{hovered.name}</span>
          <span className={s.cursorTipValue}>{hoveredValue && displayValue(prop.category, hoveredValue)}</span>
          {delta ? <span className={s.delta}>{delta}</span> : null}
          {hovered.description ? <span className={s.cursorTipDesc}>{hovered.description}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Field for entering an off-token value directly. Applies to the page on each keystroke when valid, commits on Enter */
function RawInput({ prop, committed, onPreview, onRestore, onCommit }: { prop: PropDef; committed: string | undefined; onPreview: (value: string | null) => void; onRestore: () => void; onCommit: (name: string) => void }) {
  const t = useT();
  const [text, setText] = useState(committed && tokenOf(null, prop.category, committed)?.raw ? committed : '');
  const value = rawValue(prop, text);
  return (
    <input
      className={s.rawInput}
      data-invalid={(text.trim() && !value) || undefined}
      placeholder={t.rawPlaceholder}
      title={t.rawHint(RAW_EXAMPLE[prop.category] ?? '13px')}
      aria-label={t.rawLabel}
      value={text}
      spellCheck={false}
      onChange={(e) => {
        setText(e.target.value);
        const v = rawValue(prop, e.target.value);
        if (v) onPreview(v);
        else onRestore();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && value) onCommit(value);
        if (e.key === 'Escape') {
          setText('');
          onRestore();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

const SIZE_KEYS: PropKey[] = ['width', 'height'];
const APPEARANCE_KEYS: PropKey[] = ['backgroundColor', 'borderColor', 'borderRadius', 'boxShadow'];
const TEXT_KEYS: PropKey[] = ['textStyle', 'fontSize', 'fontWeight', 'color'];

/** Panel section separated by a line. The heading uses the body text weight and sits at the top of the section */
function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={s.pSection}>
      <h3 className={s.pSectionTitle}>{title}</h3>
      {children}
    </section>
  );
}

const RAW_EXAMPLE: Partial<Record<Category, string>> = { colors: '#1e40af', fontWeights: '600', shadows: '0 2px 8px rgb(0 0 0 / 0.2)', sizes: '240px' };

// ---------------------------------------------------------------- large sample, with the current value dashed on top to show the difference
function BigSpecimen({ category, current, candidate, name, delta }: { category: Category; current: string; candidate: string; name: string; delta: string }) {
  const labels = useT();
  const cur = px(current) ?? 0;
  const cand = px(candidate) ?? 0;
  let shape: React.ReactNode = null;
  if (category === 'radii') {
    const big = (v: number) => Math.min(v * 4, 72);
    shape = (
      <>
        <span className={s.bigCornerCurrent} style={{ borderTopLeftRadius: big(cur) }} />
        <span className={s.bigCorner} style={{ borderTopLeftRadius: big(cand) }} />
      </>
    );
  } else if (category === 'spacing' || category === 'sizes') {
    // Small values are shown at 3x for readability; large values are scaled so the longer of the two fits in 220px, keeping their ratio visible
    const k = Math.min(3, 220 / Math.max(cur, cand, 1));
    const w = (v: number) => v * k;
    shape = (
      <div className={s.bigBars}>
        <span className={s.bigBarCurrent} style={{ width: w(cur) }} />
        <span className={s.bigBar} style={{ width: w(cand) }} />
      </div>
    );
  } else if (category === 'shadows') {
    // Shadow values assume a light surface, so place them on a light base regardless of theme
    shape = (
      <div className={s.bigShadowStage}>
        <span className={s.bigShadowCard} style={{ boxShadow: current === 'none' ? undefined : current }}>
          {labels.now}
        </span>
        <span className={s.bigShadowCard} style={{ boxShadow: candidate === 'none' ? undefined : candidate }}>
          {labels.after}
        </span>
      </div>
    );
  } else if (category === 'colors') {
    shape = (
      <div className={s.bigSwatches}>
        <span style={{ background: current }} />
        <span style={{ background: candidate }} />
      </div>
    );
  } else {
    const size = category === 'fontWeights' ? 28 : Math.min(px(candidate.split(' / ')[0]) ?? 16, 44);
    shape = (
      <span className={s.bigText} style={{ fontSize: size, fontWeight: category === 'fontWeights' ? candidate : undefined }}>
        Aa あ
      </span>
    );
  }
  return (
    <div className={s.bigSpecimen} data-cat={category}>
      <div className={s.bigMeta}>
        <div className={s.bigName}>{name || '—'}</div>
        <div className={s.bigValue}>
          {displayValue(category, candidate)} {delta ? <span className={s.delta}>{delta}</span> : null}
        </div>
      </div>
      {shape}
    </div>
  );
}

