// Profiles zero-dep static server — `npm start`.
// Serves the repo root so ../packs/*.json fetches work from src/.
// Usage: npm start [-- --port 8123]  →  http://localhost:8123/src/
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleAgent } from './agent/sidecar.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const argPort = process.argv.includes('--port')
  ? Number(process.argv[process.argv.indexOf('--port') + 1])
  : NaN;
const port = Number.isFinite(argPort) ? argPort : Number(process.env.PORT || 8123);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/') && await handleAgent(req, res, '/api')) return;
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    // Lock to repo root (no .. escapes).
    const file = normalize(join(root, '.' + path));
    if (!file.startsWith(root)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end('forbidden');
      return;
    }
    if (path === '/' || path === '/index.html') {
      res.writeHead(302, { location: '/src/' });
      res.end();
      return;
    }
    const st = await stat(file).catch(() => null);
    if (!st || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found: ' + path);
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('server error');
  }
});

server.listen(port, () => {
  console.log(`Profiles → http://localhost:${port}/src/  (try ?mode=lifeful and ?mode=calm)`);
  console.log(`Packs + engine served from repo root; Ctrl+C to stop.`);
});
