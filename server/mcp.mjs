// MCP server over stdio (nudgix mcp). A coding agent calls these tools instead of the user copying the prompt.
// It talks to a running `nudgix start` over HTTP; the editor tab must be open, because the changes live there.
// Speaks just enough JSON-RPC 2.0 for MCP: initialize, tools/list, tools/call and ping
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const TOOLS = [
  {
    name: 'get_nudges',
    description:
      'Get the UI changes the user tried in the nudgix editor, as instructions plus one block per element (source location and what to change). Apply them to the code, then call check_nudges.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'check_nudges',
    description:
      'After editing the code, ask the nudgix editor to check each change against the reloaded page. Returns ✓ (done), ✗ (not yet, with the value the page has now) or ? (cannot be checked from the page) per change.',
    inputSchema: { type: 'object', properties: {} },
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function startMcp({ port = 4747 } = {}) {
  const api = (path, init) => fetch(`http://localhost:${port}/__nudgix/api/${path}`, init).then((r) => r.json());
  const notRunning = `nudgix is not running on port ${port}. Ask the user to run \`npx nudgix start\` in the project and keep the editor tab open.`;
  const stale = (state) => !state.at || Date.now() - state.at > 15_000;
  const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], isError });

  async function call(name) {
    let state;
    try {
      state = await api('state');
    } catch {
      return text(notRunning, true);
    }
    if (name === 'get_nudges') {
      if (stale(state)) return text('The nudgix editor tab is not open, so the changes cannot be read. Ask the user to open it.', true);
      return text(state.prompt || 'No changes yet. The user has not tried any changes in the editor.');
    }
    if (name === 'check_nudges') {
      const { id } = await api('check-request', { method: 'POST' });
      // The editor polls every second or so, runs the check and posts the report
      for (let i = 0; i < 30; i++) {
        await sleep(500);
        const next = await api('state').catch(() => null);
        if (next && next.checkId >= id) return text(next.report || 'No changes to check.');
      }
      return text('The nudgix editor did not answer. Ask the user to keep the editor tab open, then try again.', true);
    }
    return null;
  }

  const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  const rl = createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const { id, method, params } = msg;
    if (id === undefined) return; // notifications (initialized, cancelled) need no answer
    if (method === 'initialize') {
      return send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'nudgix', version },
        },
      });
    }
    if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
    if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    if (method === 'tools/call') {
      const result = await call(params?.name);
      if (result) return send({ jsonrpc: '2.0', id, result });
      return send({ jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${params?.name}` } });
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  });
}
