// Reads StyleX tokens. defineVars compiles to hashed variable names (--x17ej7d8), so the names people write
// (colors.brand) only exist in the source. The browser matches these groups to the page's :root rules by their values
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

/** The text between the brace at `start` and its matching closing brace. Skips braces inside strings */
function block(source, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return source.slice(start + 1, i);
  }
  return null;
}

/** Split an object body into top-level `key: value` entries */
function entries(body) {
  const out = [];
  let depth = 0;
  let quote = null;
  let from = 0;
  const push = (to) => {
    const m = body.slice(from, to).match(/^\s*(?:(['"])(.+?)\1|([\w$]+))\s*:\s*([\s\S]+?)\s*$/);
    if (m) out.push([m[2] ?? m[3], m[4]]);
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{' || c === '(' || c === '[') depth++;
    else if (c === '}' || c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      push(i);
      from = i + 1;
    }
  }
  push(body.length);
  return out;
}

/** A literal value, or the default of a conditional value ({ default: '8px', '@media …': '12px' }) */
function literal(raw) {
  if (raw.startsWith('{')) {
    const def = entries(raw.slice(1, -1)).find(([k]) => k === 'default');
    return def ? literal(def[1]) : null;
  }
  const m = raw.match(/^(['"`])([\s\S]*)\1$/);
  if (m) return m[2];
  return /^-?[\d.]+$/.test(raw) ? raw : null;
}

/** export const colors = stylex.defineVars({ brand: '#6d28d9' }) → [{ name: 'colors', vars: [{ key: 'brand', value: '#6d28d9' }] }] */
export function parseDefineVars(source) {
  const groups = [];
  for (const m of source.matchAll(/export\s+const\s+([\w$]+)\s*=\s*(?:[\w$]+\.)?defineVars\(\s*\{/g)) {
    const body = block(source, m.index + m[0].length - 1);
    if (body === null) continue;
    // Keys keep their order even when the value is not a literal, because the page's rule lists every key in order
    groups.push({ name: m[1], vars: entries(body).map(([key, raw]) => ({ key, value: literal(raw) })) });
  }
  return groups;
}

/** All defineVars groups in the project's *.stylex.* files */
export async function loadStylexVars(dir) {
  const files = (await readdir(dir, { recursive: true })).filter(
    (f) => /\.stylex\.[cm]?[jt]sx?$/.test(f) && !f.split(path.sep).some((part) => part === 'node_modules' || part.startsWith('.')),
  );
  const groups = [];
  for (const file of files) groups.push(...parseDefineVars(await readFile(path.join(dir, file), 'utf8')));
  return groups;
}
