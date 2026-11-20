import { defineConfig } from '@pandacss/dev';

export default defineConfig({
  presets: ['@pandacss/preset-base', '@pandacss/preset-panda'],
  preflight: true,
  include: ['./src/**/*.{ts,tsx}'],
  outdir: 'styled-system',
  theme: {
    extend: {
      tokens: {
        colors: { brand: { 500: { value: '#6d28d9' }, 600: { value: '#5b21b6' } } },
      },
      semanticTokens: {
        colors: { surface: { value: '{colors.white}' }, muted: { value: '{colors.gray.500}' } },
      },
    },
  },
});
