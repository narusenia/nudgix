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
