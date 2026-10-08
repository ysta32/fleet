// Generates the site's binary assets into public/ (committed; not part of `next build`, which has no browser):
//   poster/fleet-<dark|light>-<768|1280|1920>.webp  stills of the REAL hero island (FleetScene + createDemoFleet,
//                                                   synthetic data) rendered by headless Chromium
//   poster/fleet-<dark|light>-m.webp                square phone still: rendered at 420x420 CSS px and 3x, so
//                                                   station labels keep their real size on a 375px screen and
//                                                   stay sharp when the hero frames the waiting station
//   poster/fleet-close-1280.webp                    a 16:10 dark still for the product panels
//   lib/poster-anchors.json                         where the waiting station's signal sits in each hero
//                                                   poster (fractions of the frame), so the page can frame it
//                                                   and raise its beacon there before any script runs
// Every still is the site's one world (lib/world.generated.json, written by scripts/prebuild.mjs).
//   og/<slug>.png                                   1200x630 social cards, one per pageMeta() call in app/
//   icons/*.png, manifest.webmanifest               favicon + PWA set rasterised from packages/ui/brand
// Usage: node scripts/prebuild.mjs && ~/.claude/orch/bin/serial e2e -- node scripts/assets.mjs [--only=posters,og,icons]
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(site, '../..');
const pub = path.join(site, 'public');
const ORIGIN = 'http://assets.local';
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '--only=posters,og,icons')
  .slice(7)
  .split(',');
const FONTS_CSS =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&family=Schibsted+Grotesk:wght@400;500;600&display=block';

/** Halyard token values (read, not copied) for the raster-only places that need literal colors. */
async function tokenValues() {
  const css = await readFile(path.join(repo, 'packages/ui/tokens.css'), 'utf8');
  const block = (sel) => {
    const i = css.indexOf(sel);
    if (i < 0) throw new Error(`tokens.css: ${sel} not found`);
    return css.slice(i, css.indexOf('\n}', i));
  };
  const pick = (b, name) => {
    const m = new RegExp(`--fl-${name}:\\s*([^;]+);`).exec(b);
    if (!m) throw new Error(`tokens.css: --fl-${name} missing`);
    return m[1].trim();
  };
  const dark = block(":root[data-theme='dark'] {");
  const light = block(":root[data-theme='light'] {");
  return {
    darkBg: pick(dark, 'bg'),
    lightBg: pick(light, 'bg'),
    accent: pick(dark, 'accent'),
    fg: pick(dark, 'fg'),
    muted: pick(dark, 'fg-muted'),
    subtle: pick(dark, 'fg-subtle'),
  };
}

const MIME = {
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.css': 'text/css',
};

async function withBrowser(fn) {
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

async function newPage(browser, { width, height, scheme, scale = 1 }, pages) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    colorScheme: scheme,
    reducedMotion: 'no-preference',
  });
  await ctx.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (pages[url.pathname])
      return route.fulfill({ status: 200, contentType: 'text/html', body: pages[url.pathname] });
    const file = path.join(pub, decodeURIComponent(url.pathname));
    if (!file.startsWith(pub) || !existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({
      status: 200,
      contentType: MIME[path.extname(file)] ?? 'application/octet-stream',
      body: await readFile(file),
    });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { page, ctx, errors };
}

const world = JSON.parse(await readFile(path.join(site, 'lib/world.generated.json'), 'utf8'));

/** The waiting station's tag anchor (its signal pennant) as fractions of the viewport, or null. */
const NEEDS_ANCHOR = () => {
  const tag = [...document.querySelectorAll('.fl-viz-tag[data-needs="1"]')].find(
    (el) => el.style.visibility !== 'hidden' && el.style.display !== 'none',
  );
  if (!tag) return null;
  const r = tag.getBoundingClientRect();
  return { x: r.left / innerWidth, y: r.bottom / innerHeight };
};

async function renderScene(browser, { theme, width, height, settleMs, scale = 1, frame = false }) {
  const html = `<!doctype html><html data-theme="${theme}"><head><meta charset="utf-8">
<link rel="stylesheet" href="${FONTS_CSS}">
<style>html,body{margin:0;height:100%;overflow:hidden}#h{position:fixed;inset:0}</style></head>
<body><div id="h"></div><script type="module">
import { mount } from '/island/fleet-scene.js';
await document.fonts.ready;
mount(document.getElementById('h'), { world: ${JSON.stringify(world)}, frame: ${frame}, onReady: () => { window.__ready = true; } });
</script></body></html>`;
  const { page, ctx, errors } = await newPage(
    browser,
    { width, height, scheme: theme, scale },
    { '/scene.html': html },
  );
  await page.goto(`${ORIGIN}/scene.html`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60_000 });
  const hasCanvas = await page.evaluate(() => {
    const c = document.querySelector('#h canvas');
    return Boolean(c && c.width > 0 && c.height > 0);
  });
  if (!hasCanvas) throw new Error(`scene (${theme}) rendered no canvas`);
  await page.waitForTimeout(settleMs);
  if (errors.length) throw new Error(`scene (${theme}) errors:\n${errors.join('\n')}`);
  const png = await page.screenshot({ type: 'png' });
  const anchor = await page.evaluate(NEEDS_ANCHOR);
  await ctx.close();
  return { png, anchor };
}

async function posters(browser) {
  await mkdir(path.join(pub, 'poster'), { recursive: true });
  const anchors = {};
  const need = (a, what) => {
    if (!a) throw new Error(`${what}: no station needs you in the world at this moment (lib/world.mjs)`);
    const r = (n) => Math.round(n * 10_000) / 10_000;
    return { x: r(a.x), y: r(a.y) };
  };
  for (const theme of ['dark', 'light']) {
    // the hero posters use the hero's camera framing (island `frame`), so the live scene takes over in place
    const { png, anchor } = await renderScene(browser, {
      theme,
      width: 1920,
      height: 1080,
      settleMs: 7000,
      frame: true,
    });
    anchors[`${theme}-wide`] = need(anchor, `poster ${theme}`);
    for (const w of [768, 1280, 1920]) {
      await sharp(png)
        .resize({ width: w })
        .webp({ quality: w <= 768 ? 70 : 74, effort: 6 })
        .toFile(path.join(pub, `poster/fleet-${theme}-${w}.webp`));
    }
    const phone = await renderScene(browser, {
      theme,
      width: 420,
      height: 420,
      scale: 3,
      settleMs: 7000,
      frame: true,
    });
    anchors[`${theme}-m`] = need(phone.anchor, `phone poster ${theme}`);
    await sharp(phone.png)
      .webp({ quality: 70, effort: 6 })
      .toFile(path.join(pub, `poster/fleet-${theme}-m.webp`));
    console.log(`[assets] poster ${theme}`);
  }
  await writeFile(path.join(site, 'lib/poster-anchors.json'), JSON.stringify(anchors, null, 2) + '\n');
  const close = await renderScene(browser, { theme: 'dark', width: 1280, height: 800, settleMs: 7000 });
  await sharp(close.png)
    .webp({ quality: 76, effort: 6 })
    .toFile(path.join(pub, 'poster/fleet-close-1280.webp'));
  console.log('[assets] poster close');
}

/** Every pageMeta('slug', 'Title', 'Description') call under app/, so cards cannot drift from the pages. */
async function pageMetas() {
  const out = [];
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name === 'page.tsx') {
        const src = await readFile(p, 'utf8');
        const str = `'((?:[^'\\\\]|\\\\.)*)'`;
        const m = new RegExp(`pageMeta\\(\\s*${str},\\s*${str},\\s*${str}`).exec(src);
        if (m)
          out.push({ slug: m[1], title: m[2].replace(/\\'/g, "'"), description: m[3].replace(/\\'/g, "'") });
      }
    }
  };
  await walk(path.join(site, 'app'));
  if (!out.some((m) => m.slug === 'home')) throw new Error('no home pageMeta found');
  return out;
}

/** Cards carry one sentence: the first, unless it is too long to set at 24px in 30ch × 3 lines. */
const firstSentence = (d) => {
  const first = /^.*?[.!?](?=\s|$)/.exec(d)?.[0] ?? d;
  return first.length <= 100 ? first : d.slice(0, d.lastIndexOf(' ', 97)) + '…';
};
const esc = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function ogCards(browser, tokens) {
  await mkdir(path.join(pub, 'og'), { recursive: true });
  const wordmark = await readFile(path.join(repo, 'packages/ui/brand/wordmark.svg'), 'utf8');
  const metas = await pageMetas();
  for (const { slug, title, description } of metas) {
    const head = slug === 'home' ? 'Your agents, <em>at a glance.</em>' : esc(title);
    const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${FONTS_CSS}">
<style>
html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:${tokens.darkBg};color:${tokens.fg}}
.bg{position:absolute;inset:0;background:url(/poster/fleet-dark-1920.webp) 62% 50%/cover}
.shade{position:absolute;inset:0;background:linear-gradient(90deg,${tokens.darkBg} 0%,${tokens.darkBg}e6 38%,${tokens.darkBg}00 78%),linear-gradient(0deg,${tokens.darkBg}cc 0%,${tokens.darkBg}00 45%)}
.c{position:absolute;inset:64px 72px;display:flex;flex-direction:column;justify-content:space-between}
.wm{height:34px;color:${tokens.fg}}.wm svg{height:34px;width:auto}
.label{font:500 15px/1 'IBM Plex Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:${tokens.subtle}}
h1{font:400 ${slug === 'home' ? 92 : 104}px/0.98 'Instrument Serif',serif;letter-spacing:-0.02em;margin:18px 0 0;max-width:11ch}
h1 em{color:${tokens.accent}}
p{font:400 24px/1.4 'Schibsted Grotesk',sans-serif;color:${tokens.muted};max-width:30ch;margin:22px 0 0}
</style></head><body><div class="bg"></div><div class="shade"></div><div class="c">
<div class="wm">${wordmark}</div>
<div><div class="label">${slug === 'home' ? 'Local mission control for Claude Code' : 'Fleet · ' + esc(title)}</div><h1>${head}</h1><p>${esc(firstSentence(description))}</p></div>
</div></body></html>`;
    const { page, ctx } = await newPage(
      browser,
      { width: 1200, height: 630, scheme: 'dark' },
      { '/og.html': html },
    );
    await page.goto(`${ORIGIN}/og.html`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const png = await page.screenshot({ type: 'png' });
    await ctx.close();
    await sharp(png)
      .png({ compressionLevel: 9, palette: true, quality: 90 })
      .toFile(path.join(pub, `og/${slug}.png`));
  }
  console.log(`[assets] og cards: ${metas.map((m) => m.slug).join(', ')}`);
}

async function icons(tokens) {
  const dir = path.join(pub, 'icons');
  await mkdir(dir, { recursive: true });
  const favicon = await readFile(path.join(repo, 'packages/ui/brand/favicon.svg'));
  for (const s of [16, 32, 48])
    await sharp(favicon, { density: 72 * (s / 32) * 4 })
      .resize(s, s)
      .png()
      .toFile(path.join(dir, `favicon-${s}.png`));
  for (const s of [192, 512])
    await sharp(favicon, { density: 72 * (s / 32) })
      .resize(s, s)
      .png()
      .toFile(path.join(dir, `icon-${s}.png`));
  // Apple touch and maskable icons must be opaque and full-bleed: the mark on the ink background, inside the safe zone.
  const mark = (await readFile(path.join(repo, 'packages/ui/brand/mark.svg'), 'utf8')).replace(
    '<svg ',
    `<svg color="${tokens.fg}" `,
  );
  const plate = async (size, inner, file) => {
    const m = await sharp(Buffer.from(mark), { density: 72 * (inner / 32) })
      .resize(inner, inner)
      .png()
      .toBuffer();
    await sharp({ create: { width: size, height: size, channels: 4, background: tokens.darkBg } })
      .composite([{ input: m, gravity: 'center' }])
      .png()
      .toFile(path.join(dir, file));
  };
  await plate(180, 132, 'apple-touch-icon.png');
  await plate(512, 320, 'maskable-512.png');
  const manifest = {
    name: 'Fleet',
    short_name: 'Fleet',
    description: 'Local mission control for Claude Code agents.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: tokens.darkBg,
    theme_color: tokens.darkBg,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  };
  await writeFile(path.join(pub, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('[assets] icons + manifest');
}

if (!existsSync(path.join(pub, 'island/fleet-scene.js')))
  throw new Error('public/island/fleet-scene.js missing: run node scripts/prebuild.mjs first');
const tokens = await tokenValues();
if (only.includes('icons')) await icons(tokens);
if (only.includes('posters') || only.includes('og')) {
  await withBrowser(async (browser) => {
    if (only.includes('posters')) await posters(browser);
    if (only.includes('og')) await ogCards(browser, tokens);
  });
}
