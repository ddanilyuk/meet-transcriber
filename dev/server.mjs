// Dev server: serves the repo over http://localhost:8765 (design mockup, test harness) and exposes
// /__version — a hash of extension/ files that the unpacked extension polls to reload itself.
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const EXT_DIR = join(ROOT, 'extension');
const PORT = Number(process.env.PORT || 8765);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out.sort();
}

async function extensionVersion() {
  const h = createHash('sha1');
  for (const file of await walk(EXT_DIR)) {
    const s = await stat(file);
    h.update(`${file}:${s.size}:${s.mtimeMs}\n`);
  }
  return h.digest('hex').slice(0, 12);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (url.pathname === '/__version') {
      res.setHeader('Content-Type', 'text/plain');
      res.end(await extensionVersion());
      return;
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (!path || path.endsWith('/')) path += 'index.html';
    const file = resolve(ROOT, path);
    if (!file.startsWith(ROOT)) throw Object.assign(new Error('forbidden'), { code: 'EACCES' });
    const body = await readFile(file);
    res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch (err) {
    res.statusCode = err.code === 'ENOENT' ? 404 : err.code === 'EACCES' ? 403 : 500;
    res.end(String(err.message));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Dev server: http://localhost:${PORT}/  (mockup: /design/mockup.html, harness: /dev/harness.html)`);
});
