// The project's Storybook. The editor server proxies only Storybook paths, so it can be read from the same origin
export type Story = { id: string; title: string; name: string; importPath: string };

export async function loadStories(): Promise<Story[]> {
  const res = await fetch('/index.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(String(res.status));
  const { entries } = (await res.json()) as { entries: Record<string, Story & { type: string }> };
  return Object.values(entries)
    .filter((e) => e.type === 'story')
    .map(({ id, title, name, importPath }) => ({ id, title, name, importPath }));
}

export const storyUrl = (id: string) => `/iframe.html?id=${encodeURIComponent(id)}&viewMode=story`;

/**
 * Get the HTML to insert into the page from a rendered story.
 * Strips the full-screen backdrop (decorators); returns the element if there is one, otherwise wraps several in a wrapping row
 */
export function captureStory(doc: Document): { html: string; left: number; top: number; width: number; height: number } | null {
  const win = doc.defaultView;
  const root = doc.querySelector('#storybook-root');
  if (!win || !root || !doc.body.classList.contains('sb-show-main')) return null;
  const isBackdrop = (el: Element) => el.getBoundingClientRect().height >= win.innerHeight * 0.9;
  let cur: Element = root;
  while (cur.children.length === 1 && isBackdrop(cur.firstElementChild!)) cur = cur.firstElementChild!;
  if (!cur.children.length) return null;
  const one = cur.children.length === 1 ? cur.firstElementChild! : null;
  // Full-width containers (like a row of buttons) are measured by walking in to the content's extent
  const measure = (el: Element, depth: number): DOMRect[] => {
    const q = el.getBoundingClientRect();
    if (depth < 4 && el.children.length && q.width >= win.innerWidth * 0.8) return [...el.children].flatMap((c) => measure(c, depth + 1));
    return q.width || q.height ? [q] : [];
  };
  const rects = (one ? [one] : [...cur.children]).flatMap((c) => measure(c, 0));
  const left = Math.min(...rects.map((q) => q.left));
  const top = Math.min(...rects.map((q) => q.top));
  const r = { left, top, width: Math.max(...rects.map((q) => q.right)) - left, height: Math.max(...rects.map((q) => q.bottom)) - top };
  if (!rects.length) return null;
  const html =
    one?.outerHTML ??
    (cur === root || isBackdrop(cur)
      ? `<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start">${cur.innerHTML}</div>`
      : cur.outerHTML);
  return { html, left: r.left, top: r.top, width: Math.min(r.width, 800), height: Math.min(r.height, 600) };
}

// ---------------------------------------------------------------- props (Storybook args)
export type ArgControl = { kind: 'select' | 'boolean' | 'text' | 'number'; options?: string[] };
export type Args = Record<string, string | number | boolean>;

type SbWindow = Window & {
  __STORYBOOK_PREVIEW__?: {
    currentRender?: { story?: { id: string; initialArgs: Record<string, unknown>; argTypes: Record<string, any> } };
    storyStoreValue?: { args?: { get?: (id: string) => Record<string, unknown> } };
  };
  __STORYBOOK_ADDONS_CHANNEL__?: { on: (e: string, f: () => void) => void; off: (e: string, f: () => void) => void; emit: (e: string, p: unknown) => void };
};

/** Args of the rendering story and the kinds of args editable on the page. Function and object args are not handled */
export function storyMeta(win: Window | null): { args: Args; argTypes: Record<string, ArgControl> } | null {
  const story = (win as SbWindow | null)?.__STORYBOOK_PREVIEW__?.currentRender?.story;
  if (!story) return null;
  const now = (win as SbWindow).__STORYBOOK_PREVIEW__?.storyStoreValue?.args?.get?.(story.id) ?? story.initialArgs;
  const args: Args = {};
  for (const [k, v] of Object.entries(now ?? {})) if (['string', 'number', 'boolean'].includes(typeof v)) args[k] = v as Args[string];
  const argTypes: Record<string, ArgControl> = {};
  for (const [k, t] of Object.entries(story.argTypes ?? {})) {
    if (k === 'className' || k === 'style' || /^on[A-Z]/.test(k)) continue;
    const control = t?.control?.type;
    if (Array.isArray(t?.options) && t.options.every((o: unknown) => typeof o === 'string')) argTypes[k] = { kind: 'select', options: t.options };
    else if (control === 'boolean' || t?.type?.name === 'boolean') argTypes[k] = { kind: 'boolean' };
    else if (control === 'number' || control === 'range' || t?.type?.name === 'number') argTypes[k] = { kind: 'number' };
    else if (control === 'text' || t?.type?.name === 'string') argTypes[k] = { kind: 'text' };
  }
  return { args, argTypes };
}

// A hidden Storybook for rerendering with new args. One per story, reused
const renderers = new Map<string, Promise<HTMLIFrameElement>>();

const waitFor = async <T>(f: () => T | null, ms = 10_000): Promise<T | null> => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) {
    const v = f();
    if (v) return v;
  }
  return null;
};

function rendererOf(id: string) {
  let p = renderers.get(id);
  if (!p) {
    p = new Promise((resolve) => {
      const f = document.createElement('iframe');
      f.src = storyUrl(id);
      f.tabIndex = -1;
      f.setAttribute('aria-hidden', 'true');
      f.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:500px;border:0;visibility:hidden';
      f.addEventListener('load', () => resolve(f), { once: true });
      document.body.appendChild(f);
    });
    renderers.set(id, p);
  }
  return p;
}

/** Apply args, rerender and get the HTML to insert */
export async function renderStory(id: string, args: Args) {
  const f = await rendererOf(id);
  const doc = f.contentDocument;
  if (!doc || !(await waitFor(() => captureStory(doc)))) return null;
  const channel = (f.contentWindow as SbWindow).__STORYBOOK_ADDONS_CHANNEL__;
  if (!channel) return null;
  const before = captureStory(doc)?.html;
  const rendered = (ms: number) =>
    new Promise<void>((resolve) => {
      const done = () => {
        channel.off('storyRendered', done);
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, ms);
      channel.on('storyRendered', done);
    });
  const first = rendered(3000);
  channel.emit('updateStoryArgs', { storyId: id, updatedArgs: args });
  await first;
  // Rerendering back to back can deliver the previous render's done event first. If the content has not changed, wait for the next one
  if (captureStory(doc)?.html === before) await rendered(1000);
  return captureStory(doc);
}
