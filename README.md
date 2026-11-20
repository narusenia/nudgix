# nudgix

Nudge your local UI in the browser, then hand the list of tweaks to Claude Code as a prompt. nudgix never edits your source.

```sh
cd your-app
npm run dev          # start your dev server as usual
npx nudgix start     # opens the editor at http://localhost:4747/__nudgix/
```

nudgix finds the dev server from your framework's default port (Next.js 3000, Vite 5173, Astro 4321). Pass `--target 3001` if it runs elsewhere.

## Options

| Option | Default |
|---|---|
| `--port` | `4747` |
| `--target` | the framework's default port |
| `--dir` | the current folder |
| `--storybook` | `6006` |
| `--no-open` | opens the browser |

## Style systems

| Adapter | How tokens are read |
|---|---|
| `css-vars` | Custom properties on `:root` in the page's stylesheets. Works with any setup |
| `tailwind-v4` | Tailwind's default theme and the project's `@theme` blocks. Prompts are written as utilities (`pt-4`, `rounded-xl`) |

## Development

```sh
pnpm install
pnpm dev --dir examples/vite-css   # runs the editor from source with Vite
pnpm build                         # builds the editor into dist/
```
