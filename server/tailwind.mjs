// Tailwind CSS v4: reads the default theme and the project's @theme blocks and turns them into nudgix tokens.
// Tailwind only emits the theme variables a page uses, so every token carries a resolved value instead of var(--…).
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', '.turbo', 'coverage']);

/** CSS files in the project that use Tailwind (import it or declare @theme). */
async function projectCssFiles(dir, depth = 0, out = []) {
  if (depth > 5 || out.length > 50) return out;
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) await projectCssFiles(path.join(dir, entry.name), depth + 1, out);
    else if (entry.isFile() && entry.name.endsWith('.css')) {
      const file = path.join(dir, entry.name);
      const text = await readFile(file, 'utf8');
      if (/@import\s+["']tailwindcss|@theme\b/.test(text)) out.push({ file, text });
    }
  }
  return out;
}

/** Variables declared inside @theme { … } blocks, in order. `--color-*: initial` clears a namespace. */
export function parseTheme(css, into = new Map(), origin = 'tailwind') {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const block of clean.matchAll(/@theme\b[^{]*\{([\s\S]*?)\n\s*\}/g)) {
    for (const [, name, value] of block[1].matchAll(/(--[\w*-]+)\s*:\s*([^;]+);/g)) {
      if (value.trim() === 'initial') {
        const prefix = name.replace(/\*$/, '');
        for (const key of into.keys()) if (name.endsWith('*') ? key.startsWith(prefix) : key === name) into.delete(key);
        continue;
      }
      into.set(name, { value: value.trim(), origin });
    }
  }
  return into;
}

/** Replaces var(--x) with the theme's value of --x, so the value works on a page that never emitted --x. */
function resolve(value, theme, depth = 0) {
  if (depth > 5) return value;
  return value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (all, name, fallback) => {
    const hit = theme.get(name)?.value ?? fallback;
    return hit ? resolve(hit, theme, depth + 1) : all;
  });
}

// The multipliers Tailwind's docs list for the spacing scale (p-4 = calc(var(--spacing) * 4))
const SPACING_STEPS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96];

// theme namespace → nudgix category
const NAMESPACES = [
  ['--color-', 'colors'],
  ['--text-', 'fontSizes'],
  ['--font-weight-', 'fontWeights'],
  ['--radius-', 'radii'],
  ['--shadow-', 'shadows'],
  ['--container-', 'sizes'],
];

export function themeToTokens(theme) {
  const tokens = { colors: [], spacing: [], fontSizes: [], fontWeights: [], radii: [], shadows: [], sizes: [], textStyles: [] };
  const group = (origin) => (origin === 'project' ? 'project' : 'tailwind');
  for (const [name, { value, origin }] of theme) {
    for (const [prefix, category] of NAMESPACES) {
      // --text-sm--line-height and the like belong to --text-sm, not tokens of their own
      if (!name.startsWith(prefix) || name.slice(prefix.length).includes('--')) continue;
      const css = resolve(value, theme);
      // --text-shadow-* shares the --text- prefix but is not a font size
      if (category === 'fontSizes' && !/^[\d.]+(rem|px|em)$/.test(css)) continue;
      tokens[category].push({ name: name.slice(prefix.length), css, variable: name, description: value, group: group(origin) });
    }
    if (name.startsWith('--spacing-')) {
      const token = { name: name.slice('--spacing-'.length), css: resolve(value, theme), description: value, group: group(origin) };
      tokens.spacing.push(token);
      tokens.sizes.push(token);
    }
  }
  const base = theme.get('--spacing');
  if (base) {
    const unit = resolve(base.value, theme);
    for (const step of SPACING_STEPS) {
      const token = { name: String(step), css: step ? `calc(${unit} * ${step})` : '0px', description: `${step} × ${base.value}`, group: group(base.origin) };
      tokens.spacing.push(token);
      tokens.sizes.push(token);
    }
    tokens.spacing.push({ name: 'px', css: '1px', description: '1px', group: 'tailwind' });
  }
  // Project tokens first so they come first in the panel
  for (const list of Object.values(tokens)) list.sort((a, b) => Number(b.group === 'project') - Number(a.group === 'project'));
  return tokens;
}

export async function loadThemeTokens(dir) {
  const theme = new Map();
  try {
    parseTheme(await readFile(path.join(dir, 'node_modules/tailwindcss/theme.css'), 'utf8'), theme, 'tailwind');
  } catch {}
  for (const { text } of await projectCssFiles(dir)) parseTheme(text, theme, 'project');
  if (!theme.size) throw new Error('No Tailwind theme found (node_modules/tailwindcss/theme.css or an @theme block)');
  return themeToTokens(theme);
}
