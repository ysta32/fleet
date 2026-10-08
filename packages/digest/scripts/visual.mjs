import { execFileSync, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const visual = join(root, '.visual');
const shots = join(visual, 'shots');
const diffs = join(visual, 'diff');
const baseline = join(root, 'test/visual/baseline');
const scenarios = [
  'typical',
  'first-run',
  'quiet-night',
  'all-green',
  'rough-night',
  'llm-fallback',
  'partial-warnings',
];
const args = process.argv.slice(2);
const only = args.find((arg) => arg.startsWith('--only='))?.slice(7);
if (
  args.some((arg) => arg !== '--update' && !arg.startsWith('--only=')) ||
  (only !== undefined && !scenarios.includes(only))
) {
  throw new Error('Usage: visual.mjs [--update] [--only=<scenario>]');
}
const update = args.includes('--update');

async function chromeBinary() {
  const candidates = process.env.CHROME_PATH
    ? [process.env.CHROME_PATH]
    : [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        ...(process.env.PATH ?? '')
          .split(delimiter)
          .flatMap((dir) => ['google-chrome', 'chromium'].map((name) => join(dir, name))),
      ];
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return resolve(candidate);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'EACCES') throw error;
    }
  }
  throw new Error('Chrome not found; set CHROME_PATH to an executable Chrome or Chromium binary.');
}

/**
 * Runs headless Chrome until the screenshot is on disk. Recent Chrome builds sometimes keep running
 * after `--screenshot` has written the file, so a finished, size-stable PNG counts as success and
 * the process is killed instead of waiting for an exit that never comes.
 */
function capture(chrome, args, screenshot, timeoutMs = 60_000) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(chrome, args, { stdio: 'ignore', detached: true });
    let lastSize = -1;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timer);
      try {
        process.kill(-child.pid, 'SIGKILL'); // the whole group: GPU/renderer helpers too
      } catch {
        // already gone
      }
      if (error) reject(error);
      else resolvePromise();
    };
    const sizeOf = async () => (await stat(screenshot).catch(() => undefined))?.size ?? 0;
    const poll = setInterval(async () => {
      const size = await sizeOf();
      if (size > 0 && size === lastSize) finish();
      lastSize = size;
    }, 400);
    const timer = setTimeout(
      () => finish(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })),
      timeoutMs,
    );
    child.on('error', (error) => finish(error));
    child.on('exit', async (code) => {
      if ((await sizeOf()) > 0) finish();
      else finish(new Error(`Chrome exited with ${code} and no screenshot`));
    });
  });
}

/**
 * Headless Chrome clamps the layout viewport to about 500px, so narrower shots would lay out at
 * ~500px and be cropped. Below that, the page is loaded in an iframe of the exact target width.
 */
async function framed(htmlPath, width, height) {
  if (width >= 500) return htmlPath;
  const wrapper = htmlPath.replace(/\.html$/, `.frame-${width}.html`);
  const src = pathToFileURL(htmlPath).href;
  await writeFile(
    wrapper,
    `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000}iframe{display:block;border:0;width:${width}px;height:${height}px}</style></head><body><iframe src="${src}"></iframe></body></html>`,
  );
  return wrapper;
}

async function compare(filename) {
  let expected;
  try {
    expected = PNG.sync.read(await readFile(join(baseline, filename)));
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'NO BASELINE', difference: '—' };
    throw error;
  }
  const actual = PNG.sync.read(await readFile(join(shots, filename)));
  const diff = new PNG({ width: actual.width, height: actual.height });
  if (actual.width !== expected.width || actual.height !== expected.height) {
    actual.data.copy(diff.data);
    await writeFile(join(diffs, filename), PNG.sync.write(diff));
    return { status: 'FAIL (dimensions)', difference: '100%' };
  }
  const count = pixelmatch(actual.data, expected.data, diff.data, actual.width, actual.height, {
    threshold: 0.1,
  });
  const fraction = count / (actual.width * actual.height);
  if (count > 0) await writeFile(join(diffs, filename), PNG.sync.write(diff));
  return { status: fraction > 0.005 ? 'FAIL' : 'pass', difference: `${(fraction * 100).toFixed(3)}%` };
}

await mkdir(join(visual, 'out'), { recursive: true });
await mkdir(shots, { recursive: true });
await mkdir(diffs, { recursive: true });
if (update) await mkdir(baseline, { recursive: true });
execFileSync(
  'npx',
  [
    'tsup',
    'src/demo/scenarios.ts',
    'src/render/html.ts',
    'src/render/text.ts',
    '--format',
    'esm',
    '--out-dir',
    '.visual/build',
    '--silent',
  ],
  { cwd: root, stdio: 'inherit' },
);
const { scenarioDigest, scenarioIndex } = await import(
  pathToFileURL(join(visual, 'build/demo/scenarios.js')).href
);
const { renderDigestHtml, renderIndexHtml } = await import(
  pathToFileURL(join(visual, 'build/render/html.js')).href
);
const { renderEmailHtml } = await import(pathToFileURL(join(visual, 'build/render/text.js')).href);
const chrome = await chromeBinary();
const profile = await mkdtemp(join(tmpdir(), 'overnight-visual-'));
const results = [];
try {
  for (const scenario of only ? [only] : scenarios) {
    const digest = scenarioDigest(scenario);
    const surfaces = {
      page: renderDigestHtml(digest, { siteTitle: 'Overnight' }),
      index: renderIndexHtml(scenarioIndex(scenario, digest), { siteTitle: 'Overnight', latest: digest }),
      email: renderEmailHtml(digest),
    };
    for (const [surface, html] of Object.entries(surfaces)) {
      for (const theme of ['light', 'dark']) {
        const name = `${scenario}-${surface}-${theme}`;
        const htmlPath = join(visual, 'out', `${name}.html`);
        await writeFile(
          htmlPath,
          html.replace(
            /<html\b([^>]*)>/i,
            (_, attributes) =>
              `<html${attributes.replace(/\sdata-theme\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')} data-theme="${theme}">`,
          ),
        );
        for (const width of [360, 768, 1280, 1920]) {
          const filename = `${name}-${width}.png`;
          const screenshot = join(shots, filename);
          await rm(screenshot, { force: true });
          await rm(join(diffs, filename), { force: true });
          try {
            await capture(
              chrome,
              [
                '--headless=new',
                '--disable-gpu',
                '--hide-scrollbars',
                '--force-device-scale-factor=1',
                `--window-size=${width},${surface === 'page' ? 2400 : 1600}`,
                `--user-data-dir=${join(profile, filename)}`,
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-background-networking',
                '--virtual-time-budget=3000',
                `--screenshot=${screenshot}`,
                pathToFileURL(await framed(htmlPath, width, surface === 'page' ? 2400 : 1600)).href,
              ],
              screenshot,
            );
            const png = PNG.sync.read(await readFile(screenshot));
            if (png.width !== width || png.height !== (surface === 'page' ? 2400 : 1600)) {
              throw new Error(`Unexpected screenshot dimensions: ${png.width}x${png.height}`);
            }
            if (update) {
              await copyFile(screenshot, join(baseline, filename));
              results.push({ shot: filename, status: 'updated', difference: '—' });
            } else {
              results.push({ shot: filename, ...(await compare(filename)) });
            }
          } catch (error) {
            results.push({ shot: filename, status: 'FAIL', difference: '—' });
            console.error(
              `Warning: ${filename}: ${error.code ?? error.signal ?? error.message.split('\n')[0]}`,
            );
          }
        }
      }
    }
  }
} finally {
  await rm(profile, { recursive: true, force: true });
}
const filenames = (await readdir(shots)).filter((name) => /^[a-z0-9-]+\.png$/.test(name)).sort();
await writeFile(
  join(visual, 'contact-sheet.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Overnight visual QA</title><style>body{font:14px system-ui;margin:24px;background:#eee;color:#111}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:20px}figure{margin:0}img{display:block;width:100%;height:auto}figcaption{padding:8px;overflow-wrap:anywhere}</style></head><body><h1>Overnight visual QA</h1><div class="grid">${filenames.map((name) => `<figure><a href="shots/${name}"><img loading="lazy" src="shots/${name}" alt="${name}"></a><figcaption>${name}</figcaption></figure>`).join('')}</div></body></html>`,
);
console.table(results);
console.log(
  `${results.length} shots: ${results.filter((row) => row.status.startsWith('FAIL')).length} failed, ${results.filter((row) => row.status === 'NO BASELINE').length} with no baseline. Contact sheet: ${join(visual, 'contact-sheet.html')}`,
);
if (results.some((row) => row.status.startsWith('FAIL'))) process.exitCode = 1;
