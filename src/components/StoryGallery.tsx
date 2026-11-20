// Storybook gallery that slides in from the right. Dragging a card onto the page inserts that story's markup
import { ChevronLeft, ChevronRight, Copy, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';
import { type ArgControl, type Args, captureStory, loadStories, type Story, storyMeta, storyUrl } from '../lib/stories';
import { IconButton } from './IconButton';
import s from './ui.module.css';

export type Captured = { html: string; width: number; height: number; args?: Args; argTypes?: Record<string, ArgControl> };

type Props = {
  open: boolean;
  onToggle: () => void;
  storybookUp: boolean;
  /** Cursor while dragging (editor screen coordinates). null ends the drag (drop is true if it was dropped) */
  onDrag: (story: Story, captured: Captured, at: { x: number; y: number } | null, drop: boolean) => void;
};

// Component stories first
const ORDER = ['Design System', 'Common', 'UI', 'ui', 'Domain', 'domain', 'Case', 'case'];
const rank = (title: string) => {
  const i = ORDER.indexOf(title.split('/')[0]);
  return i < 0 ? ORDER.length : i;
};

export function StoryGallery({ open, onToggle, storybookUp, onDrag }: Props) {
  const t = useT();
  const [stories, setStories] = useState<Story[] | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open || !storybookUp || stories) return;
    loadStories()
      .then(setStories)
      .catch(() => setError(true));
  }, [open, storybookUp, stories]);

  const groups = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (st: Story) => terms.every((q) => `${st.title} ${st.name}`.toLowerCase().includes(q));
    const map = new Map<string, Story[]>();
    for (const st of (stories ?? []).filter(hit)) map.set(st.title, [...(map.get(st.title) ?? []), st]);
    return [...map.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b)).slice(0, 60);
  }, [stories, query]);

  return (
    <>
      <button type="button" className={open ? s.galleryTabOpen : s.galleryTab} aria-label={t.gallery} title={t.gallery} onClick={onToggle}>
        {open ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
      {open ? (
        <aside className={s.gallery} aria-label={t.gallery}>
          <div className={s.galleryHead}>
            <Search size={14} />
            <input
              className={s.paletteInput}
              placeholder={t.gallerySearch}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && onToggle()}
              autoFocus
            />
          </div>
          {!storybookUp || error ? (
            <div className={s.galleryEmpty}>
              <p>{t.storybookDown}</p>
              <code className={s.galleryCmd}>pnpm storybook</code>
              <IconButton label={t.copy} onClick={() => navigator.clipboard.writeText('pnpm storybook').catch(() => {})}>
                <Copy size={13} />
              </IconButton>
            </div>
          ) : !stories ? (
            <p className={s.empty}>{t.galleryLoading}</p>
          ) : (
            <div className={s.galleryList}>
              {groups.map(([title, list]) => (
                <section key={title}>
                  <h3 className={s.galleryGroup}>{title}</h3>
                  <div className={s.galleryGrid}>
                    {list.map((st) => (
                      <StoryCard key={st.id} story={st} onDrag={onDrag} hint={t.dragToPlace} />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </aside>
      ) : null}
    </>
  );
}

const THUMB = { width: 800, height: 500, boxW: 152, boxH: 95, pad: 8 };

/** Scale and offset that fit the content inside the card frame, from its position and size (never scales up) */
const fitOf = (c: { left: number; top: number; width: number; height: number } | null) => {
  if (!c) return `scale(${THUMB.boxW / THUMB.width})`;
  const k = Math.min(1, (THUMB.boxW - THUMB.pad * 2) / Math.max(c.width, 1), (THUMB.boxH - THUMB.pad * 2) / Math.max(c.height, 1));
  return `translate(${THUMB.pad}px, ${THUMB.pad}px) scale(${k}) translate(${-c.left}px, ${-c.top}px)`;
};

function StoryCard({ story, onDrag, hint }: { story: Story; onDrag: Props['onDrag']; hint: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const [fit, setFit] = useState<ReturnType<typeof captureStory>>(null);

  // Load only once visible (there can be hundreds of stories, so do not render them all at once)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // After loading, wait until the story has finished rendering
  const onLoad = () => {
    let tries = 0;
    const id = setInterval(() => {
      const doc = frame.current?.contentDocument;
      const c = doc && captureStory(doc);
      if (c || ++tries > 40) {
        clearInterval(id);
        setReady(!!c);
        setFit(c ?? null);
      }
    }, 250);
  };

  const begin = (e: React.PointerEvent) => {
    const doc = frame.current?.contentDocument;
    const shot = doc && captureStory(doc);
    if (!shot) return;
    const meta = storyMeta(frame.current?.contentWindow ?? null);
    const captured: Captured = { ...shot, ...meta };
    e.preventDefault();
    // While dragging, cover the whole screen so the iframe does not steal the cursor
    const shield = document.createElement('div');
    shield.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:grabbing';
    document.body.appendChild(shield);
    const move = (ev: PointerEvent) => onDrag(story, captured, { x: ev.clientX, y: ev.clientY }, false);
    const end = (ev: PointerEvent | KeyboardEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('keydown', esc);
      shield.remove();
      onDrag(story, captured, null, ev.type === 'pointerup');
    };
    const esc = (ev: KeyboardEvent) => ev.key === 'Escape' && end(ev);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('keydown', esc);
    move(e.nativeEvent);
  };

  return (
    <div ref={ref} className={ready ? s.storyCard : s.storyCardLoading} title={ready ? hint : undefined} onPointerDown={begin}>
      <div className={s.storyThumb}>
        {visible ? (
          <iframe
            ref={frame}
            src={storyUrl(story.id)}
            title={story.name}
            tabIndex={-1}
            onLoad={onLoad}
            style={{ width: THUMB.width, height: THUMB.height, transform: fitOf(fit) }}
          />
        ) : null}
      </div>
      <span className={s.storyName}>{story.name}</span>
    </div>
  );
}
