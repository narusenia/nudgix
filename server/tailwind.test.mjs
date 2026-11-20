// node server/tailwind.test.mjs
import assert from 'node:assert/strict';
import { parseTheme, themeToTokens } from './tailwind.mjs';

const theme = parseTheme(`
@theme default {
  --color-red-500: oklch(63.7% 0.237 25.331);
  --color-blue-500: oklch(62.3% 0.214 259.815);
  --spacing: 0.25rem;
  --text-sm: 0.875rem;
  --text-sm--line-height: calc(1.25 / 0.875);
  --radius-lg: 0.5rem;
  --text-shadow-2xs: 0px 1px 0px rgb(0 0 0 / 0.15);
}
`);
parseTheme(`@import "tailwindcss";
@theme {
  --color-*: initial;
  --color-brand: var(--color-accent, #4f46e5);
  --radius-card: var(--radius-lg);
}
`, theme, 'project');

const tokens = themeToTokens(theme);
assert.deepEqual(tokens.colors.map((t) => t.name), ['brand'], 'color-*: initial clears the default colors');
assert.equal(tokens.colors[0].css, '#4f46e5', 'falls back when the variable is unknown');
assert.equal(tokens.radii.find((t) => t.name === 'card').css, '0.5rem', 'resolves var() through the theme');
assert.deepEqual(tokens.fontSizes.map((t) => t.name), ['sm'], '--text-sm--line-height and --text-shadow-* are not font sizes');
assert.equal(tokens.fontSizes[0].variable, '--text-sm');
assert.equal(tokens.spacing.find((t) => t.name === '4').css, 'calc(0.25rem * 4)');
assert.equal(tokens.radii[0].group, 'project', 'project tokens come first');
console.log('tailwind.test: ok');
