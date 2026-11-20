// 右端から出す Storybook のギャラリー。カードを画面へドラッグすると、そのストーリーの見た目を差し込む
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
  /** ドラッグ中のカーソル（エディタの画面の座標）。null で終わり（drop が true なら落とした） */
  onDrag: (story: Story, captured: Captured, at: { x: number; y: number } | null, drop: boolean) => void;
};

// 部品のストーリーを先に出す
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

/** カードの枠に中身が収まるよう、中身の位置と大きさから縮小率とずらしを決める（拡大はしない） */
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

  // 見えてから読み込む（ストーリーは数百あるので、全部を一度に描かない）
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setVisible(true), { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // 読み込んだあと、ストーリーが描き終わるまで待つ
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
    // ドラッグ中は画面全体を覆い、iframe にカーソルを取られないようにする
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
