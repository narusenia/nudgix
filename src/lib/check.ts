// After the agent edits the code, check each change against the page: with nudgix's previews taken off, does the
// element now get the target from its own styles? Text is checked in the source file instead, because the preview
// already shows the new text in the page
import { adapter } from './adapters';
import { splitLoc } from './code';
import { detect, withoutPreviews } from './inspect';
import { LAYOUT_CSS, PROP_BY_KEY } from './props';
import { shortDetection } from './prompt';
import type { Change, LayoutKey, PropKey, Tokens } from './types';

export type CheckStatus = 'ok' | 'ng' | 'unknown';
export type CheckItem = { label: string; status: CheckStatus; now?: string };
export type CheckResult = { status: CheckStatus; items: CheckItem[] };

const overall = (items: CheckItem[]): CheckStatus =>
  items.some((i) => i.status === 'ng') ? 'ng' : items.every((i) => i.status === 'ok') ? 'ok' : 'unknown';

/** Whether the file at the element's source location contains the text */
async function sourceHas(change: Change, text: string): Promise<boolean | null> {
  const loc = change.info.source?.self && splitLoc(change.info.source.self);
  if (!loc) return null;
  if (!text || text.length > 200) return null;
  const res = await fetch(`api/find?file=${encodeURIComponent(loc.file)}&text=${encodeURIComponent(text)}`).catch(() => null);
  if (!res?.ok) return null;
  return ((await res.json()) as { line: number | null }).line !== null;
}

export async function checkChanges(entries: [Element, Change][], tokens: Tokens): Promise<Map<Element, CheckResult>> {
  const live = entries.filter(([el]) => el.isConnected).map(([el]) => el);
  // Read every style in one pass while the previews are off
  const styles = withoutPreviews(live, () =>
    new Map(
      entries.map(([el, change]) => {
        if (!el.isConnected) return [el, null] as const;
        const cs = el.ownerDocument.defaultView!.getComputedStyle(el);
        const props = Object.keys(change.props).map((k) => [k as PropKey, detect(el, PROP_BY_KEY[k as PropKey], tokens)] as const);
        const layout = Object.keys(change.layout ?? {}).map((k) => [k as LayoutKey, cs.getPropertyValue(LAYOUT_CSS[k as LayoutKey])] as const);
        return [el, { props, layout, hidden: cs.display === 'none' }] as const;
      }),
    ),
  );
  const out = new Map<Element, CheckResult>();
  for (const [el, change] of entries) {
    const now = styles.get(el);
    const items: CheckItem[] = [];
    for (const [key, target] of Object.entries(change.props) as [PropKey, string][]) {
      const d = now?.props.find(([k]) => k === key)?.[1];
      const raw = tokens[PROP_BY_KEY[key].category].every((t) => t.name !== target);
      const ok = d && (d.how === 'class' ? d.name === target : d.how === 'value' ? d.candidates.includes(target) : raw && d.value === target);
      items.push({ label: `${key} ${adapter().format(key, target)}`, status: !d ? 'unknown' : ok ? 'ok' : 'ng', now: d ? shortDetection(d, key) : undefined });
    }
    for (const [key, target] of Object.entries(change.layout ?? {}) as [LayoutKey, string][]) {
      const value = now?.layout.find(([k]) => k === key)?.[1];
      items.push({ label: `${key} ${target}`, status: value === undefined ? 'unknown' : value === target ? 'ok' : 'ng', now: value });
    }
    if (change.removed) items.push({ label: 'remove', status: !el.isConnected || now?.hidden ? 'ok' : 'ng' });
    if (change.text) {
      const [to, from] = await Promise.all([sourceHas(change, change.text.to), sourceHas(change, change.text.from)]);
      items.push({ label: `text "${change.text.to}"`, status: to ? 'ok' : to === false && from ? 'ng' : 'unknown' });
    }
    // Moves, offsets, inserted stories and comments cannot be read back from the page
    if (change.move !== undefined || change.into || change.insert || change.nudge || change.note) items.push({ label: 'other', status: 'unknown' });
    out.set(el, { status: overall(items), items });
  }
  return out;
}

/** Plain-text report for the MCP tool, one block per element like the prompt */
export function checkReport(entries: [Element, Change][], results: Map<Element, CheckResult>): string {
  const mark = { ok: '✓', ng: '✗', unknown: '?' } as const;
  return entries
    .map(([el, change]) => {
      const r = results.get(el);
      const where = change.info.source?.self ?? `${change.info.route} ${change.info.components[0] ?? change.info.tag}`;
      const lines = (r?.items ?? []).map((i) => `  ${mark[i.status]} ${i.label}${i.status === 'ng' && i.now ? ` (now ${i.now})` : ''}`);
      return [`${r ? mark[r.status] : '?'} ${where}${el.isConnected ? '' : ' (not on page)'}`, ...lines].join('\n');
    })
    .join('\n');
}
