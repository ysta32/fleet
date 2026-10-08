// Records the hero GIF from the synthetic demo only (?demo=1, /api and sockets blocked).
// Usage: node scripts/make-gif.mjs <web-dist-dir> [out.gif]
// Serves the built web app on a port in 4500-4599, captures frames with Playwright, assembles with ffmpeg.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchOptions, prepareContext } from './visual.config.mjs';

const [distArg, outArg = 'docs/fleet-demo.gif'] = process.argv.slice(2);
if (!distArg) throw new Error('Usage: make-gif.mjs <web-dist-dir> [out.gif]');
const dist = path.resolve(distArg);
if (!existsSync(path.join(dist, 'index.html'))) throw new Error(`No index.html in ${dist}`);
const out = path.resolve(outArg);
const port = 4571;
const fps = 6;
const steps = [
  { label: null, ms: 2000 },
  { label: 'Sessions', ms: 1500 },
  { label: 'Overnight', ms: 2000 },
  { label: 'Spend', ms: 2500 },
];
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(dist, pathname);
  if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory())
    file = path.join(dist, 'index.html');
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(port, '127.0.0.1', r));

const frames = mkdtempSync(path.join(tmpdir(), 'fleet-gif-'));
const browser = await chromium.launch(launchOptions());
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
  });
  await prepareContext(context, 'dark');
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/?demo=1&seed=fleet-visual-v1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  let n = 0;
  for (const step of steps) {
    if (step.label)
      await page
        .getByRole('button', { name: step.label })
        .or(page.getByRole('link', { name: step.label }))
        .first()
        .click();
    const count = Math.round((step.ms / 1000) * fps);
    for (let i = 0; i < count; i++) {
      await page.screenshot({ path: path.join(frames, `f${String(n++).padStart(4, '0')}.png`) });
      await page.waitForTimeout(1000 / fps);
    }
  }
} finally {
  await browser.close();
  server.close();
}
const vf =
  'scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4';
execFileSync('ffmpeg', [
  '-y',
  '-loglevel',
  'error',
  '-framerate',
  String(fps),
  '-i',
  path.join(frames, 'f%04d.png'),
  '-vf',
  vf,
  out,
]);
rmSync(frames, { recursive: true, force: true });
console.log(`wrote ${out} (${(statSync(out).size / 1e6).toFixed(2)} MB)`);
