// Static preview of apps/site/out with Vercel-like clean URLs: /features -> features.html, unknown -> 404.html.
// Usage: node scripts/serve.mjs [port=4530]. Binds 127.0.0.1 only.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../out');
const port = Number(process.argv[2] ?? process.env.PORT ?? 4530);
if (!existsSync(path.join(root, 'index.html'))) {
  console.error(`[serve] ${root}/index.html missing: run npm run build -w @fleet/site first`);
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

function resolve(urlPath) {
  let p;
  try {
    p = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const abs = path.resolve(root, '.' + path.posix.normalize(p));
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  const candidates = [abs, abs + '.html', path.join(abs, 'index.html')];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  const file = resolve(url.pathname);
  const status = file ? 200 : 404;
  const target = file ?? path.join(root, '404.html');
  const immutable = url.pathname.startsWith('/_next/static/');
  const type = TYPES[path.extname(target)] ?? 'application/octet-stream';
  const gzip =
    /^(text\/|application\/(json|manifest)|image\/svg)/.test(type) &&
    /\bgzip\b/.test(String(req.headers['accept-encoding']));
  res.writeHead(status, {
    'Content-Type': type,
    ...(gzip ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}),
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') return res.end();
  const stream = createReadStream(target).on('error', () => res.destroy());
  (gzip ? stream.pipe(createGzip()) : stream).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`[serve] http://127.0.0.1:${port} -> ${root}`));
