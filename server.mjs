// Proxies a local dev server and serves the nudgix editor at /__nudgix/.
// The editor shows the app in a same-origin iframe and previews changes by touching the DOM. It never edits your source.
import { execFile } from 'node:child_process';
import { constants as fsConstants } from 'node:fs';
import { access, copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStylexVars } from './server/stylex.mjs';
import { loadThemeTokens } from './server/tailwind.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = '/__nudgix/';
const SKILL = 'apply-nudges';

const toUrl = (v) => new URL(/^\d+$/.test(v) ? `http://localhost:${v}` : v);
const portOf = (url) => Number(url.port || 80);

/** Token paths (colors.brand.500) from Panda's codegen output. Empty until `panda codegen` has run */
async function loadPandaPaths(dir) {
  const config = await Promise.any(['ts', 'mjs', 'js', 'cjs'].map((ext) => readFile(path.join(dir, `panda.config.${ext}`), 'utf8'))).catch(() => '');
  const outdir = config.match(/outdir:\s*['"]([^'"]+)/)?.[1] ?? 'styled-system';
  const source = await readFile(path.join(dir, outdir, 'tokens/index.js'), 'utf8').catch(() => '');
  const json = source.match(/const tokens = (\{.*\})\s*$/m)?.[1];
  return json ? Object.keys(JSON.parse(json)) : [];
}

/** Reads package.json and guesses the framework, the style system and the dev command. */
export async function inspectProject(dir) {
  let pkg = {};
  try {
    pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
  } catch {}
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const framework = deps.next ? 'next' : deps.astro ? 'astro' : deps.vite ? 'vite' : 'other';
  const tailwind = String(deps.tailwindcss ?? deps['@tailwindcss/postcss'] ?? deps['@tailwindcss/vite'] ?? '');
  const adapter = deps['@pandacss/dev'] ? 'panda' : deps['@stylexjs/stylex'] ? 'stylex' : /^\D*4/.test(tailwind) ? 'tailwind-v4' : 'css-vars';
  const runner = (await exists(path.join(dir, 'pnpm-lock.yaml')))
    ? 'pnpm'
    : (await exists(path.join(dir, 'yarn.lock')))
      ? 'yarn'
      : (await exists(path.join(dir, 'bun.lock')))
        ? 'bun'
        : 'npm';
  const devCommand = pkg.scripts?.dev ? `${runner} ${runner === 'npm' ? 'run dev' : 'dev'}` : null;
  // A port in the dev script (next dev -p 3100, vite --port 5174) wins. Otherwise only the framework's default port,
  // so another app running on a common port is never picked by mistake
  const scriptPort = Number(pkg.scripts?.dev?.match(/(?:-p|--port)[\s=]+(\d+)/)?.[1]);
  const ports = scriptPort ? [scriptPort] : { next: [3000], astro: [4321], vite: [5173], other: [3000, 5173, 4321, 8080, 8000] }[framework];
  const storybook = Object.keys(deps).some((d) => d === 'storybook' || d.startsWith('@storybook/'));
  return { framework, adapter, devCommand, ports, storybook };
}

export async function startServer({ port = 4747, target, dir = process.cwd(), storybook = '6006', open = true } = {}) {
  const DIR = path.resolve(dir);
  const project = await inspectProject(DIR);
  let TARGET = target ? toUrl(String(target)) : null;
  if (TARGET && TARGET.protocol !== 'http:') throw new Error('--target must be an http:// URL or a port number');
  const STORYBOOK = toUrl(String(storybook));
  // Storybook (Vite) asks for these paths. With a Vite app they collide with the app's own, so the gallery only works with other frameworks.
  // shortcut: no Storybook gallery for Vite apps; route by a path prefix once Storybook can be served under one
  // Only for projects that use Storybook, so another project's Storybook on the same port is never shown
  const STORYBOOK_PATH =
    !project.storybook || project.framework === 'vite' || project.framework === 'astro'
      ? null
      : /^\/(iframe\.html|index\.json|vite-inject-mocker-entry\.js|@vite\/|@id\/|@fs\/|@react-refresh|node_modules\/|src\/|\.storybook\/|sb-|storybook-server-channel|virtual:|__vite)/;

  /** Finds the dev server when --target was not given. Tries the framework's default port first. */
  let checkedAt = 0;
  async function findTarget() {
    if (target) return TARGET;
    // Proxied requests come in bursts, so look again at most every 2 seconds
    if (TARGET && Date.now() - checkedAt < 2000) return TARGET;
    checkedAt = Date.now();
    for (const p of project.ports) if (p !== port && (await portIsUp(p, 'localhost'))) return (TARGET = toUrl(String(p)));
    return (TARGET = null);
  }
  await findTarget();
  const targetUp = async () => !!(await findTarget()) && portIsUp(portOf(TARGET), TARGET.hostname);

  /** A path inside the project that the editor may read. Only source files, never node_modules or dotfiles. */
  function sourcePath(rel) {
    if (!rel || rel.includes('\0')) return null;
    const abs = path.resolve(DIR, rel);
    const inside = path.relative(DIR, abs);
    if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) return null;
    if (inside.split(path.sep).some((part) => part === 'node_modules' || part.startsWith('.'))) return null;
    return /\.(tsx?|jsx?|mjs|cjs|css|scss|vue|svelte|astro|html|mdx?)$/.test(abs) ? abs : null;
  }

  async function handleApi(req, res) {
    const url = req.url.split('?')[0];
    const query = new URL(req.url, 'http://x').searchParams;
    // Only the editor itself (same origin) may call APIs that write. Rejects POSTs sent to localhost from other sites
    const crossSite =
      (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) ||
      (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin');
    if (url.startsWith(`${BASE}api/`) && req.method !== 'GET' && crossSite) return sendJson(res, 403, { error: 'forbidden' }), true;

    if (url === `${BASE}api/status`) {
      const up = await targetUp();
      sendJson(res, 200, {
        target: TARGET?.origin ?? null,
        targetUp: up,
        dir: DIR,
        framework: project.framework,
        adapter: project.adapter,
        devCommand: project.devCommand,
        // With the skill installed the prompt drops the instructions and is just /apply-nudges plus the changes
        hasSkill: await exists(path.join(DIR, `.claude/skills/${SKILL}/SKILL.md`)),
        storybookUp: !!STORYBOOK_PATH && (await portIsUp(portOf(STORYBOOK), STORYBOOK.hostname)),
      });
      return true;
    }
    if (url === `${BASE}api/tokens`) {
      try {
        // css-vars reads the tokens from the page in the browser, so the server has nothing to send
        const tokens =
          project.adapter === 'tailwind-v4'
            ? await loadThemeTokens(DIR)
            : project.adapter === 'panda'
              ? { paths: await loadPandaPaths(DIR) }
              : project.adapter === 'stylex'
                ? { groups: await loadStylexVars(DIR) }
                : null;
        sendJson(res, 200, { adapter: project.adapter, tokens });
      } catch (error) {
        sendJson(res, 500, { error: String(error?.message ?? error) });
      }
      return true;
    }
    if (url === `${BASE}api/install-skill` && req.method === 'POST') {
      const dest = path.join(DIR, `.claude/skills/${SKILL}/SKILL.md`);
      try {
        await mkdir(path.dirname(dest), { recursive: true });
        await copyFile(path.join(HERE, `skills/${SKILL}/SKILL.md`), dest, fsConstants.COPYFILE_EXCL);
        sendJson(res, 200, { path: dest });
      } catch (error) {
        if (error?.code === 'EEXIST') return sendJson(res, 409, { error: 'exists', path: dest }), true;
        sendJson(res, 500, { error: String(error?.message ?? error) });
      }
      return true;
    }
    // Source map of a server chunk (Next.js Server Components run on the server, so their stacks point at files in .next)
    if (url === `${BASE}api/server-map`) {
      const file = path.resolve(query.get('file') ?? '');
      const inside = path.relative(path.join(DIR, '.next'), file);
      if (!file.endsWith('.js') || !inside || inside.startsWith('..') || path.isAbsolute(inside)) return sendJson(res, 400, { error: 'bad request' }), true;
      try {
        sendJson(res, 200, JSON.parse(await readFile(`${file}.map`, 'utf8')));
      } catch {
        sendJson(res, 404, { error: 'not found' });
      }
      return true;
    }
    // Code peek: the lines around one line of a source file in the project
    if (url === `${BASE}api/source`) {
      const file = sourcePath(query.get('file'));
      const line = Number(query.get('line'));
      const around = Math.min(Number(query.get('around') ?? 12) || 12, 60);
      if (!file || !Number.isInteger(line) || line < 1) return sendJson(res, 400, { error: 'bad request' }), true;
      try {
        const all = (await readFile(file, 'utf8')).split('\n');
        const start = Math.max(1, line - around);
        sendJson(res, 200, { start, lines: all.slice(start - 1, Math.min(all.length, line + around)) });
      } catch {
        sendJson(res, 404, { error: 'not found' });
      }
      return true;
    }
    // Code peek for plain CSS: the first line in a file that has the given text (a selector)
    if (url === `${BASE}api/find`) {
      const file = sourcePath(query.get('file'));
      const text = query.get('text') ?? '';
      if (!file || !text || text.length > 200) return sendJson(res, 400, { error: 'bad request' }), true;
      try {
        // The selector itself, followed by { or , (so .card does not match .cards)
        const re = new RegExp(`(^|[\\s,}])${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[{,]`);
        const lines = (await readFile(file, 'utf8')).split('\n');
        const at = lines.findIndex((l) => re.test(l));
        const index = at >= 0 ? at : lines.findIndex((l) => l.includes(text));
        sendJson(res, 200, { line: index >= 0 ? index + 1 : null });
      } catch {
        sendJson(res, 404, { error: 'not found' });
      }
      return true;
    }
    // Impact: how many places write <Name in the project (stories and tests excluded)
    if (url === `${BASE}api/usages`) {
      const name = query.get('name') ?? '';
      if (!/^[A-Z][\w.]{0,80}$/.test(name)) return sendJson(res, 400, { error: 'bad name' }), true;
      const pattern = `<${name.replaceAll('.', '\\.')}([[:space:]/>]|$)`;
      const grep = (extra, done) =>
        execFile('git', ['grep', ...extra, '-n', '-E', pattern, '--', '.', ':!node_modules'], { cwd: DIR, maxBuffer: 8 * 1024 * 1024 }, done);
      const reply = (error, stdout) => {
        // git grep also exits with 1 when nothing matches
        if (error && error.code !== 1) return sendJson(res, 500, { error: String(error.message) });
        const hits = String(stdout ?? '')
          .split('\n')
          .map((l) => l.match(/^([^:]+):(\d+):/))
          .filter(Boolean)
          .map((m) => `${m[1]}:${m[2]}`)
          .filter((h) => !/\.(stories|test|spec)\.[jt]sx?:/.test(h));
        sendJson(res, 200, { count: hits.length, hits: hits.slice(0, 200) });
      };
      // Outside a git repository, search the folder as plain files
      // --untracked also counts files not committed yet (still skipping .gitignore'd ones)
      grep(['--untracked'], (error, stdout) => (error?.code === 128 ? grep(['--no-index'], reply) : reply(error, stdout)));
      return true;
    }
    return false;
  }

  // Point redirects to the dev server back at the proxy (so a login redirect does not leave the editor)
  function rewriteLocation(location, req) {
    try {
      const url = new URL(location, TARGET);
      if (url.host !== TARGET.host) return location;
      url.host = req.headers.host;
      return url.toString();
    } catch {
      return location;
    }
  }

  const server = http.createServer();
  const editor = await editorHandler(server);

  server.on('request', async (req, res) => {
    if (req.url.startsWith(BASE)) {
      if (await handleApi(req, res)) return;
      return editor(req, res);
    }
    if (STORYBOOK_PATH?.test(req.url)) return proxyTo(req, res, STORYBOOK.hostname, portOf(STORYBOOK), STORYBOOK.origin);
    // Opening the proxy directly sends you to the editor with that page in the iframe
    if (req.headers['sec-fetch-dest'] === 'document' && req.method === 'GET') {
      res.writeHead(302, { location: `${BASE}?path=${encodeURIComponent(req.url)}` });
      return res.end();
    }
    if (!(await findTarget())) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('nudgix: dev server not found');
    }
    proxyTo(req, res, TARGET.hostname, portOf(TARGET), TARGET.origin);
  });

  function proxyTo(req, res, host, port, origin) {
    // Keep Host as the proxy's so frameworks that compare Origin and Host (Next.js Server Actions) accept the request
    const upstream = http.request({ host, port, method: req.method, path: req.url, headers: req.headers }, (upRes) => {
      const headers = { ...upRes.headers };
      if (headers.location) headers.location = rewriteLocation(headers.location, req);
      // Let the editor show the app in its iframe
      delete headers['x-frame-options'];
      if (headers['content-security-policy']) headers['content-security-policy'] = headers['content-security-policy'].replace(/frame-ancestors[^;]*;?/g, '');
      res.writeHead(upRes.statusCode, headers);
      upRes.pipe(res);
    });
    upstream.on('error', (error) => {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`${origin}: ${error.message}`);
    });
    req.pipe(upstream);
  }

  // Pass the app's HMR WebSocket straight through (the editor's own HMR, in development, is handled by Vite)
  server.on('upgrade', async (req, socket, head) => {
    if (req.url.startsWith(BASE)) return;
    const toStorybook =
      !!STORYBOOK_PATH && (STORYBOOK_PATH.test(req.url) || String(req.headers['sec-websocket-protocol'] ?? '').includes('vite-hmr'));
    if (!toStorybook && !(await findTarget())) return socket.destroy();
    const [up, host] = toStorybook ? [portOf(STORYBOOK), STORYBOOK.hostname] : [portOf(TARGET), TARGET.hostname];
    const upstream = net.connect(up, host, () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head?.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });

  await new Promise((resolve, reject) => {
    server.once('error', (error) => reject(error.code === 'EADDRINUSE' ? new Error(`Port ${port} is in use. Pick another one with --port ${port + 1}`) : error));
    server.listen(port, 'localhost', resolve);
  });
  const url = `http://localhost:${port}${BASE}`;
  console.log(`nudgix: ${url}`);
  console.log(`  project: ${DIR} (${project.framework}, ${project.adapter})`);
  console.log(`  target:  ${TARGET?.origin ?? `not running yet${project.devCommand ? `, start it with \`${project.devCommand}\`` : ''}`}`);
  if (open) openBrowser(url);
  return server;
}

/** Serves the built editor from dist/. Without a build (working on nudgix itself) it runs Vite in middleware mode. */
async function editorHandler(server) {
  const dist = path.join(HERE, 'dist');
  if (!process.env.NUDGIX_DEV && (await exists(path.join(dist, 'index.html')))) {
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.json': 'application/json' };
    return async (req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0].slice(BASE.length));
      let file = path.resolve(dist, rel);
      if (!file.startsWith(`${dist}${path.sep}`) || !(await stat(file).then((s) => s.isFile(), () => false))) file = path.join(dist, 'index.html');
      res.writeHead(200, {
        'content-type': `${types[path.extname(file)] ?? 'application/octet-stream'}; charset=utf-8`,
        // Built assets have hashed names and can be cached; index.html must not be
        'cache-control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable',
      });
      res.end(await readFile(file));
    };
  }
  const { createServer } = await import('vite');
  const vite = await createServer({ root: HERE, base: BASE, appType: 'spa', server: { middlewareMode: true, hmr: { server } } });
  return (req, res) => vite.middlewares(req, res);
}

const exists = (p) => access(p).then(() => true, () => false);

function portIsUp(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect(port, host);
    socket.setTimeout(800);
    socket.once('connect', () => (socket.destroy(), resolve(true)));
    socket.once('timeout', () => (socket.destroy(), resolve(false)));
    socket.once('error', () => resolve(false));
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  execFile(cmd, args, () => {});
}
