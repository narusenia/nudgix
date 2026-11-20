import { ArrowRight, RotateCcw, Trash2 } from 'lucide-react';
import { useT } from '../i18n';
import { deltaText } from '../lib/format';
import { componentChain, resolveToken } from '../lib/inspect';
import { PROP_BY_KEY, tokenOf } from '../lib/props';
import { adapter } from '../lib/adapters';
import { shortDetection } from '../lib/prompt';
import { countOf, type Change, type LayoutKey, type PropKey, type Tokens } from '../lib/types';
import { IconButton, Tip } from './IconButton';
import { Specimen } from './Specimen';
import s from './ui.module.css';

const MAX_CRUMBS = 5;

function ancestors(el: Element): Element[] {
  const list: Element[] = [];
  for (let cur: Element | null = el; cur && cur !== cur.ownerDocument.body && list.length < MAX_CRUMBS; cur = cur.parentElement) list.unshift(cur);
  return list;
}

export function Breadcrumbs({ el, onSelect, onPeek }: { el: Element; onSelect: (el: Element) => void; onPeek: (el: Element | null) => void }) {
  const t = useT();
  const chain = ancestors(el);
  return (
    <section className={s.panel}>
      <div className={s.panelHead}>
        <h2 className={s.panelTitle}>{t.selected}</h2>
      </div>
      <nav className={s.crumbs} aria-label={t.selected}>
        {chain.map((node, i) => (
          <button
            key={i}
            type="button"
            className={s.crumb}
            style={{ paddingLeft: 6 + i * 8 }}
            aria-current={node === el}
            onClick={() => onSelect(node)}
            onPointerEnter={() => onPeek(node)}
            onPointerLeave={() => onPeek(null)}
            onFocus={() => onPeek(node)}
            onBlur={() => onPeek(null)}
          >
            {/* Non-React pages have no component name, so identify by the first class */}
            {componentChain(node)[0] ?? (node.classList[0] ? `.${node.classList[0]}` : node.tagName.toLowerCase())}
            <span className={s.crumbTag}>{node.tagName.toLowerCase()}</span>
          </button>
        ))}
      </nav>
    </section>
  );
}

type ChangeListProps = {
  changes: [Element, Change][];
  tokens: Tokens;
  selectedEl: Element | null;
  onSelect: (el: Element) => void;
  onRevert: (el: Element) => void;
  onRevertAll: () => void;
};

export function ChangeList({ changes, tokens, selectedEl, onSelect, onRevert, onRevertAll }: ChangeListProps) {
  const t = useT();
  const count = changes.reduce((n, [, c]) => n + countOf(c), 0);
  return (
    <section className={s.scrollPanel}>
      <div className={s.panelHead}>
        <h2 className={s.panelTitle} style={{ color: 'var(--text)', fontSize: 12, fontWeight: 600 }}>
          {t.changes}
        </h2>
        <span className={s.count}>{count}</span>
        <span className={s.spacer} />
        {changes.length ? (
          <IconButton label={t.revertAll} onClick={onRevertAll}>
            <Trash2 size={14} />
          </IconButton>
        ) : null}
      </div>
      {changes.length === 0 ? <p className={s.empty}>{t.noChanges}</p> : null}
      <ul className={s.changeList}>
        {changes.map(([el, change], i) => {
          const gone = !el.isConnected;
          const cls = gone ? s.changeCardGone : el === selectedEl ? s.changeCardActive : s.changeCard;
          const { info } = change;
          return (
            <li key={i} className={cls}>
              <div className={s.changeHead}>
                <button type="button" className={s.changeTitleButton} disabled={gone} onClick={() => onSelect(el)}>
                  <div className={s.changeTitle}>
                    {change.insert ? `${change.insert.title.split('/').at(-1)} › ${change.insert.name}` : (info.components[0] ?? info.tag)}
                    {!change.insert && info.text ? t.quote(info.text.slice(0, 20)) : ''}
                  </div>
                  <div className={s.changeWhere}>
                    {change.insert?.importPath.replace(/^\.\//, '') ?? info.source?.self ?? `${info.route} · ${info.components.slice(1, 3).join(' < ') || info.tag}`}
                  </div>
                </button>
                {gone ? (
                  <Tip label={t.notOnPageHint}>
                    <span className={s.badge} tabIndex={0}>
                      {t.notOnPage}
                    </span>
                  </Tip>
                ) : null}
                <IconButton label={t.revertElement} onClick={() => onRevert(el)}>
                  <RotateCcw size={13} />
                </IconButton>
              </div>
              <div className={s.changeRows}>
                {Object.entries(change.props).map(([key, name]) => (
                  <ChangeRow key={key} propKey={key as PropKey} to={name!} change={change} tokens={tokens} el={el} />
                ))}
                {Object.entries(change.layout ?? {}).map(([key, value]) => {
                  const from = change.layoutBase?.[key as LayoutKey];
                  return (
                    <div key={key} className={s.changeRow}>
                      <span className={s.rowLabel}>{t.layoutKeys[key as LayoutKey]}</span>
                      <span className={s.from}>
                        <span className={s.ellipsis}>{from ? (t.layoutValues[from] ?? from) : '–'}</span>
                      </span>
                      <span className={s.arrow}>
                        <ArrowRight />
                      </span>
                      <span className={s.to}>
                        <span className={s.ellipsis}>{t.layoutValues[value!] ?? value}</span>
                      </span>
                    </div>
                  );
                })}
                {change.move !== undefined ? (
                  <div className={s.changeRow}>
                    <span className={s.rowLabel}>{change.insert ? t.inserted : t.order}</span>
                    <span className={s.to}>
                      <span className={s.ellipsis}>
                        {change.into ? t.moveInto(change.into) : ''}
                        {change.move ? t.moveAfter(change.move) : t.moveFirst}
                      </span>
                    </span>
                  </div>
                ) : null}
                {change.removed ? (
                  <div className={s.changeRow}>
                    <span className={s.rowLabel}>{t.remove}</span>
                  </div>
                ) : null}
                {change.text ? (
                  <div className={s.changeRow}>
                    <span className={s.rowLabel}>{t.text}</span>
                    <span className={s.from}>
                      <span className={s.ellipsis}>{change.text.from}</span>
                    </span>
                    <span className={s.arrow}>
                      <ArrowRight />
                    </span>
                    <span className={s.to}>
                      <span className={s.ellipsis}>{change.text.to}</span>
                    </span>
                  </div>
                ) : null}
                {change.nudge ? (
                  <div className={s.changeRow}>
                    <span className={s.rowLabel}>{t.nudge}</span>
                    <span className={s.to}>
                      <span className={s.ellipsis}>{`x ${change.nudge.x >= 0 ? '+' : ''}${Math.round(change.nudge.x)}  y ${change.nudge.y >= 0 ? '+' : ''}${Math.round(change.nudge.y)}`}</span>
                    </span>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ChangeRow({ propKey, to, change, tokens, el }: { propKey: PropKey; to: string; change: Change; tokens: Tokens; el: Element }) {
  const t = useT();
  const prop = PROP_BY_KEY[propKey];
  const d = change.baseline[propKey];
  const token = tokenOf(tokens, prop.category, to);
  const toValue = token && el.isConnected ? resolveToken(el.ownerDocument, prop.category, token) : undefined;
  const fromValue = d.value;
  const delta = deltaText(fromValue, toValue);
  return (
    <div className={s.changeRow}>
      <span className={s.rowLabel}>{t.props[propKey]}</span>
      <span className={s.from}>
        <Specimen category={prop.category} value={fromValue} />
        <span className={s.ellipsis}>{shortDetection(d, propKey)}</span>
      </span>
      <span className={s.arrow}>
        <ArrowRight />
      </span>
      <span className={s.to}>
        <Specimen category={prop.category} value={toValue} />
        <span className={s.ellipsis}>{token?.raw ? to : adapter().format(propKey, to)}</span>
        {delta ? <span className={s.delta}>{delta}</span> : null}
      </span>
    </div>
  );
}
