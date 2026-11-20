import * as stylex from '@stylexjs/stylex';

export const colors = stylex.defineVars({
  brand: '#6d28d9',
  brandStrong: '#5b21b6',
  surface: '#ffffff',
  page: '#f8fafc',
  text: '#0f172a',
  muted: '#64748b',
});

export const space = stylex.defineVars({
  s2: '8px',
  s4: '16px',
  s6: '24px',
  s8: '32px',
});

export const radii = stylex.defineVars({
  md: '8px',
  xl: '12px',
});

export const fontSizes = stylex.defineVars({
  sm: '14px',
  lg: '18px',
  xxl: '30px',
});
