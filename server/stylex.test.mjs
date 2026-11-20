// node server/stylex.test.mjs
import assert from 'node:assert/strict';
import { parseDefineVars } from './stylex.mjs';

const groups = parseDefineVars(`
import * as stylex from '@stylexjs/stylex';
export const colors = stylex.defineVars({
  brand: '#6d28d9',
  'brand-strong': "#5b21b6",
  surface: { default: 'white', '@media (prefers-color-scheme: dark)': '#111' },
  shadow: \`0 1px 2px rgb(0 0 0 / 0.1), 0 0 1px {x}\`,
  computed: someFn(1, 2),
});
export const space = defineVars({ s2: '8px', s4: 16 });
const notExported = stylex.defineVars({ a: '1px' });
`);
assert.deepEqual(groups, [
  {
    name: 'colors',
    vars: [
      { key: 'brand', value: '#6d28d9' },
      { key: 'brand-strong', value: '#5b21b6' },
      { key: 'surface', value: 'white' },
      { key: 'shadow', value: '0 1px 2px rgb(0 0 0 / 0.1), 0 0 1px {x}' },
      { key: 'computed', value: null },
    ],
  },
  { name: 'space', vars: [{ key: 's2', value: '8px' }, { key: 's4', value: '16' }] },
]);
console.log('stylex ok');
