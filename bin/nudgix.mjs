#!/usr/bin/env node
// nudgix start [--port 4747] [--target 3000] [--dir .] [--storybook 6006] [--no-open]
import { parseArgs } from 'node:util';
import { startServer } from '../server.mjs';

const HELP = `Usage: nudgix start [options]

Run it in your project folder while the dev server is running.

Options:
  --port <n>        Port for the editor (default 4747)
  --target <url|n>  Dev server URL or port (default: found from the framework's usual port)
  --dir <path>      Project folder (default: current folder)
  --storybook <n>   Storybook URL or port for the story gallery (default 6006)
  --no-open         Do not open the browser
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string' },
    target: { type: 'string' },
    dir: { type: 'string' },
    storybook: { type: 'string' },
    'no-open': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

const command = positionals[0] ?? 'start';
if (values.help || command !== 'start') {
  console.log(HELP);
  process.exit(values.help ? 0 : 1);
}

try {
  await startServer({
    port: Number(values.port ?? process.env.PORT ?? 4747),
    target: values.target ?? process.env.TARGET,
    dir: values.dir,
    storybook: values.storybook ?? process.env.STORYBOOK ?? '6006',
    open: !values['no-open'] && !process.env.NO_OPEN,
  });
} catch (error) {
  console.error(`nudgix: ${error.message}`);
  process.exit(1);
}
