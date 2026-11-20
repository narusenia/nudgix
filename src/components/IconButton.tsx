import { Tooltip } from '@base-ui/react/tooltip';
import type { ComponentProps, ReactNode } from 'react';
import s from './ui.module.css';

type Props = Omit<ComponentProps<'button'>, 'children'> & {
  /** ツールチップと aria-label に使う名前 */
  label: string;
  shortcut?: string;
  variant?: 'raised' | 'ghost' | 'primary';
  pressed?: boolean;
  children: ReactNode;
};

export function IconButton({ label, shortcut, variant = 'ghost', pressed, className, children, ...rest }: Props) {
  return (
    <Tip label={label} shortcut={shortcut}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        className={`${s.iconButton} ${s[variant]} ${className ?? ''}`}
        {...rest}
      >
        {children}
      </button>
    </Tip>
  );
}

/** 子要素にツールチップを付ける。子は ref とイベントを受け取れる要素であること */
export function Tip({ label, shortcut, children }: { label: string; shortcut?: string; children: React.ReactElement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger render={children} />
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={6}>
          <Tooltip.Popup className={s.tip}>
            {label}
            {shortcut ? <kbd className={s.tipKey}>{shortcut}</kbd> : null}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
