import { Dialog } from '@base-ui/react/dialog';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useT } from '../i18n';
import { pointer } from '../lib/pointer';
import s from './ui.module.css';

export type Command = {
  id: string;
  group: string;
  label: string;
  /** 右端に出す値やショートカット */
  hint?: string;
  icon?: ReactNode;
  /** 絞り込みに使う追加の語 */
  keywords?: string;
  /** 選んでいる間の見た目の試し（トークンの差し替えなど） */
  onPreview?: () => void;
  onRun: () => void;
};

const MAX = 80;

type Rect = { left: number; top: number; bottom: number };

/** anchor は選んでいる要素の位置（エディタの画面の座標）を返す。無ければカーソルの下に出す */
export function CommandPalette({ open, commands, onClose, anchor }: { open: boolean; commands: Command[]; onClose: () => void; anchor: () => Rect | null }) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
    }
  }, [open]);

  // 空白で区切った語がすべて含まれるものだけ残す（「角丸 md」など）
  const filtered = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((c) => terms.every((term) => `${c.group} ${c.label} ${c.hint ?? ''} ${c.keywords ?? ''}`.toLowerCase().includes(term))).slice(0, MAX);
  }, [commands, query]);

  const active = filtered[Math.min(index, filtered.length - 1)];

  useEffect(() => {
    if (open) active?.onPreview?.();
    listRef.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' });
    // biome-ignore lint: 選んでいる候補が変わったときだけ試す
  }, [active?.id, open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(0, Math.min(filtered.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))));
    } else if (e.key === 'Enter' && active) {
      e.preventDefault();
      active.onRun();
    }
  };

  // 開いた瞬間に、選んでいる要素の下（入らなければ上）か、無ければカーソルの下に出す。
  // 画面からはみ出す分は内側に寄せる。UI の拡大率は left/top にも掛かるので割り戻す
  const at = useMemo(() => {
    if (!open) return undefined;
    const z = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1;
    const w = Math.min(560 * z, innerWidth - 32);
    const h = Math.min(460 * z, innerHeight - 32);
    const r = anchor();
    let x = pointer.x - 24;
    let y = pointer.y + 12;
    if (r) {
      x = r.left;
      y = r.bottom + 8 + h <= innerHeight - 16 ? r.bottom + 8 : r.top - 8 - h;
    }
    const left = Math.max(16, Math.min(innerWidth - w - 16, x));
    const top = Math.max(16, Math.min(innerHeight - h - 16, y));
    return { left: left / z, top: top / z };
    // biome-ignore lint: 開いた瞬間の位置だけを使う
  }, [open]);

  let lastGroup = '';
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className={s.paletteBackdrop} />
        <Dialog.Popup className={s.palette} style={at} aria-label={t.command}>
          <div className={s.paletteHead}>
            <Search size={15} aria-hidden="true" />
            <input
              className={s.paletteInput}
              aria-label={t.command}
              placeholder={t.paletteHint}
              value={query}
              autoFocus
              onChange={(e) => {
                setQuery(e.target.value);
                setIndex(0);
              }}
              onKeyDown={onKeyDown}
            />
            <kbd className={s.tipKey}>Esc</kbd>
          </div>
          <div ref={listRef} className={s.paletteList} role="listbox">
            {filtered.length === 0 ? <p className={s.empty}>{t.noMatch}</p> : null}
            {filtered.map((c, i) => {
              const head = c.group !== lastGroup ? (lastGroup = c.group) : null;
              return (
                <div key={c.id}>
                  {head ? <div className={s.tokenGroupTitle}>{head}</div> : null}
                  <button
                    type="button"
                    role="option"
                    aria-selected={c === active}
                    data-active={c === active || undefined}
                    className={s.paletteItem}
                    onMouseMove={() => setIndex(i)}
                    onClick={() => c.onRun()}
                  >
                    {c.icon ? <span className={s.specSlot}>{c.icon}</span> : null}
                    <span className={s.tokenName} style={{ fontFamily: c.icon ? 'var(--mono)' : 'var(--sans)' }}>
                      {c.label}
                    </span>
                    {c.hint ? <span className={s.tokenValue}>{c.hint}</span> : null}
                  </button>
                </div>
              );
            })}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
