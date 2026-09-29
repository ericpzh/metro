// Tiny static file server used to view generated art in the browser.
//   node tools/serve.mjs [port]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || 4173);
const MIME = {
  '.svg': 'image/svg+xml', '.html': 'text/html; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.webp': 'image/webp',
};

createServer(async (req, res) => {
  try {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const rel = normalize(url).replace(/^([/\\])+/, '');
    const file = join(root, rel || 'index.html');
    if (!file.startsWith(root)) { res.writeHead(403).end('forbidden'); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`serving ${root} on http://127.0.0.1:${port}/`));
