// Screenshot QA for the static export: pages x widths x schemes, full page, after scrolling so every
// [data-reveal] block has entered. Needs a running preview (node scripts/serve.mjs <port>).
// Usage: node scripts/shots.mjs <outDir> [--base=http://127.0.0.1:4531] [--pages=/,/features] [--widths=375,1280]
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const outDir = path.resolve(process.argv[2] ?? 'shots');
const base = arg('base', 'http://127.0.0.1:4531');
const pages = arg('pages', '/,/features,/pricing,/docs,/changelog,/press,/demo,/nope').split(',');
const widths = arg('widths', '375,768,1280,1920').split(',').map(Number);
const schemes = arg('schemes', 'light,dark').split(',');
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const issues = [];
for (const scheme of schemes) {
  for (const width of widths) {
    const ctx = await browser.newContext({
      viewport: { width, height: Math.round(width < 800 ? width * 2.1 : width * 0.62) },
      colorScheme: scheme,
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => issues.push(`${scheme} ${width}: pageerror ${e}`));
    page.on(
      'requestfailed',
      (r) =>
        r.failure()?.errorText !== 'net::ERR_ABORTED' && issues.push(`${scheme} ${width}: failed ${r.url()}`),
    );
    for (const p of pages) {
      const res = await page.goto(base + p, { waitUntil: 'load' });
      if (!res || (res.status() !== 200 && p !== '/nope')) issues.push(`${p}: HTTP ${res?.status()}`);
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += innerHeight * 0.6) {
          scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 90));
        }
        scrollTo(0, 0);
      });
      await page.waitForTimeout(p === '/' || p === '/demo' ? 2500 : 600);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      if (overflow > 0) issues.push(`${p} ${scheme} ${width}: horizontal overflow ${overflow}px`);
      const name = (p === '/' ? 'home' : p.slice(1).replace(/\//g, '_')) + `-${width}-${scheme}.png`;
      // A live WebGL canvas breaks Chromium's beyond-viewport capture: shoot the fold with the live scene, then
      // drop the canvas (the poster underneath is a still of the same scene) for the full-page capture.
      const live = await page.evaluate(() => Boolean(document.querySelector('.hero-live canvas')));
      if (live) {
        await page.screenshot({ path: path.join(outDir, name.replace('.png', '-fold.png')) });
        await page.addStyleTag({ content: '.hero-live{display:none!important}' });
        await page.waitForTimeout(200);
      }
      // Chromium cannot capture a single bitmap taller than ~16k px; long mobile pages are split.
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      if (p === '/demo' || h <= 12000)
        await page.screenshot({ path: path.join(outDir, name), fullPage: p !== '/demo' });
      else
        for (let i = 0, y = 0; y < h; i++, y += 12000)
          await page.screenshot({
            path: path.join(outDir, name.replace('.png', `-part${i + 1}.png`)),
            fullPage: true,
            clip: { x: 0, y, width, height: Math.min(12000, h - y) },
          });
    }
    await ctx.close();
  }
}
await browser.close();
console.log(
  issues.length ? `[shots] issues:\n  ${issues.join('\n  ')}` : '[shots] no console/overflow/request issues',
);
console.log(`[shots] wrote ${outDir}`);
