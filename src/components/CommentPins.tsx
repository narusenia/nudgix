import { useEffect, useRef, useState } from 'react';
import s from './ui.module.css';

export type Pin = { el: Element; note: string; label: string };

/**
 * Numbered pins on the page for elements with a comment, like Figma's comment pins. Placed in the canvas overlay,
 * at each element's top-right corner, and repositioned every frame so they follow scrolling and layout changes.
 * Hovering a pin opens a card with the comment and outlines the element it belongs to
 */
export function CommentPins({ pins, onSelect }: { pins: Pin[]; onSelect: (el: Element) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const cardRef = useRef<HTMLDivElement>(null);
  const outlineRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      pins.forEach((pin, i) => {
        const node = refs.current[i];
        if (!node) return;
        const r = pin.el.getBoundingClientRect();
        const shown = pin.el.isConnected && (r.width > 0 || r.height > 0);
        node.style.display = shown ? '' : 'none';
        if (!shown) return;
        // Keep the pin the same size when the canvas is zoomed, like the inline peek
        const frame = pin.el.ownerDocument.defaultView?.frameElement as HTMLElement | null;
        const k = frame ? frame.getBoundingClientRect().width / frame.offsetWidth || 1 : 1;
        const left = Math.max(2, r.right - 12 / k);
        const top = Math.max(2, r.top - 12 / k);
        node.style.left = `${left}px`;
        node.style.top = `${top}px`;
        node.style.scale = String(1 / k);
        if (i !== open) return;
        const card = cardRef.current;
        const outline = outlineRef.current;
        if (outline) Object.assign(outline.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        if (card) {
          // Open to the right of the pin, or to the left when there is no room
          const view = pin.el.ownerDocument.defaultView?.innerWidth ?? 0;
          const right = left + (30 + card.offsetWidth) / k < view;
          card.style.left = `${right ? left + 30 / k : left - (card.offsetWidth + 6) / k}px`;
          card.style.top = `${top}px`;
          card.style.scale = String(1 / k);
        }
      });
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [pins, open]);

  const current = open !== null ? pins[open] : null;
  return (
    <div className={s.pinLayer}>
      {current ? <div ref={outlineRef} className={s.pinOutline} /> : null}
      {pins.map((pin, i) => (
        <button
          // biome-ignore lint/suspicious/noArrayIndexKey: pins follow the change list order
          key={i}
          ref={(node) => {
            refs.current[i] = node;
          }}
          type="button"
          className={s.pin}
          data-open={open === i ? '' : undefined}
          aria-label={`${pin.label}: ${pin.note}`}
          onPointerEnter={() => setOpen(i)}
          onPointerLeave={() => setOpen(null)}
          onFocus={() => setOpen(i)}
          onBlur={() => setOpen(null)}
          onClick={() => onSelect(pin.el)}
        >
          {i + 1}
        </button>
      ))}
      {current ? (
        <div ref={cardRef} className={s.pinCard} role="tooltip">
          <div className={s.pinCardHead}>
            <span className={s.pinCardNum}>{open! + 1}</span>
            <span className={s.ellipsis}>{current.label}</span>
          </div>
          <p className={s.pinCardBody}>{current.note}</p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Comment box opened next to the element by the comment tool (or by clicking a pin), like Figma's comment composer.
 * Enter or clicking away saves, Shift+Enter adds a line, Escape closes without saving
 */
export function CommentComposer({
  anchor,
  initial,
  placeholder,
  onSubmit,
  onClose,
}: { anchor: Element; initial: string; placeholder: string; onSubmit: (text: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(initial);
  // Set once saved or cancelled, so the blur that follows does nothing
  const done = useRef(false);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const box = ref.current;
      if (box && anchor.isConnected) {
        const r = anchor.getBoundingClientRect();
        const frame = anchor.ownerDocument.defaultView?.frameElement as HTMLElement | null;
        const k = frame ? frame.getBoundingClientRect().width / frame.offsetWidth || 1 : 1;
        const view = anchor.ownerDocument.defaultView;
        const w = box.offsetWidth / k;
        // Beside the element's top-right corner, kept inside the page
        const left = Math.min(Math.max(4, r.right + 8 / k), (view?.innerWidth ?? 0) - w - 4);
        box.style.left = `${Math.max(4, left)}px`;
        box.style.top = `${Math.min(Math.max(4, r.top), (view?.innerHeight ?? 0) - box.offsetHeight / k - 4)}px`;
        box.style.scale = String(1 / k);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [anchor]);
  return (
    <div ref={ref} className={s.composer}>
      <textarea
        // biome-ignore lint/a11y/noAutofocus: opened on purpose by the comment tool
        autoFocus
        className={s.composerInput}
        rows={2}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        // Clicking away keeps what was typed
        onBlur={() => {
          if (done.current) return;
          done.current = true;
          if (text !== initial) onSubmit(text);
          else onClose();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            done.current = true;
            onClose();
          }
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            done.current = true;
            onSubmit(text);
          }
        }}
      />
    </div>
  );
}
