import type { Dict } from '../i18n';
import { adapter } from './adapters';
import { MERGES, PROP_BY_KEY, tokenOf } from './props';
import type { Change, Detection, PropKey, Tokens } from './types';

/** プロンプト用の短い「現在」。推定は末尾に ? を付ける */
export function shortDetection(d: Detection, key: PropKey): string {
  const f = (name: string) => adapter().format(key, name);
  if (d.how === 'class') return f(d.name);
  if (d.how === 'value') {
    const names = d.candidates;
    return `${names.slice(0, 2).map(f).join('|')}${names.length > 2 ? '|…' : ''}?`;
  }
  if (d.how === 'zero') return '-';
  return `(${d.value})`;
}

const signed = (n: number) => `${n >= 0 ? '+' : ''}${Math.round(n)}`;

function changeLines(change: Change, tokens: Tokens): string[] {
  const props = { ...change.props };
  const from = (key: PropKey) => shortDetection(change.baseline[key], key);
  // トークンでない値（パネルで直接入れた値）は、「現在」と同じく括弧で包んで書く
  const shown = (key: PropKey, v: string) => (tokenOf(tokens, PROP_BY_KEY[key].category, v)?.raw ? `(${v})` : adapter().format(key, v));
  const lines: string[] = [];
  for (const merge of MERGES) {
    const values = merge.keys.map((k) => props[k]);
    const froms = merge.keys.map(from);
    if (values.every((v) => v && v === values[0]) && froms.every((f) => f === froms[0])) {
      lines.push(`${merge.name} ${froms[0]}→${shown(merge.keys[0], values[0]!)}`);
      for (const k of merge.keys) delete props[k];
    }
  }
  for (const [key, value] of Object.entries(props)) lines.push(`${key} ${from(key as PropKey)}→${shown(key as PropKey, value!)}`);
  for (const [key, value] of Object.entries(change.layout ?? {})) lines.push(`${key} ${change.layoutBase?.[key as keyof typeof change.layoutBase] ?? '-'}→${value}`);
  if (change.insert) {
    const args = change.insert.args && Object.keys(change.insert.args).length ? ` args ${JSON.stringify(change.insert.args)}` : '';
    lines.push(`insert into ${change.into} ${change.move ? `after ${change.move}` : 'as first'}${args}`);
  }
  else if (change.into) lines.push(`move into ${change.into} ${change.move ? `after ${change.move}` : 'as first'}`);
  else if (change.move !== undefined) lines.push(change.move ? `move after ${change.move}` : 'move to first');
  if (change.removed) lines.push('remove');
  if (change.text) lines.push(`text "${change.text.from}"→"${change.text.to}"`);
  if (change.nudge) lines.push(`offset x${signed(change.nudge.x)} y${signed(change.nudge.y)}px`);
  return lines;
}

// トークン効率のため、1要素を「場所の1行＋差し替えの行」に詰める
export function buildPrompt(changes: Change[], tokens: Tokens, t: Dict, withSkill: boolean): string {
  const blocks = changes.map(({ info, ...rest }) => {
    // ファイル:行が分かれば、探すための手がかり（URL・部品の連なり・class）は省く
    const src = info.source;
    const story = rest.insert;
    const where = (
      story
        ? [`${story.title} › ${story.name}`, story.importPath.replace(/^\.\//, '')]
        : src?.self
        ? [src.self, src.usage ? `(${src.usage})` : null, info.components[0], info.text ? `"${info.text}"` : null, `<${info.tag}>`]
        : [
            info.route,
            info.components.slice(0, 3).join('<') || info.tag,
            info.text ? `"${info.text}"` : null,
            info.components.length ? `<${info.tag}>` : null,
            ...info.marks.slice(0, 2),
            ...info.tokenClasses.slice(0, 4).map((c) => `.${c}`),
          ]
    )
      .filter(Boolean)
      .join(' ');
    return [where, ...changeLines({ info, ...rest }, tokens).map((l) => `  ${l}`)].join('\n');
  });
  // スキルはこの行を見て、どの書き方（Tailwind の class、CSS 変数など）で直すかを決める
  const head = withSkill ? ['/apply-nudges', `adapter: ${adapter().id}`] : [t.promptText.intro(adapter().id), ...t.promptText.rules];
  return [...head, '', ...blocks].join('\n');
}
