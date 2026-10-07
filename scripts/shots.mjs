import { chromium } from '@playwright/test';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  captureUrl,
  height,
  launchOptions,
  prepareContext,
  root,
  settle,
  themes,
  widths,
} from './visual.config.mjs';

const escapeHtml = (value) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

async function main() {
  const [input, output, ...args] = process.argv.slice(2);
  if (!input || !output)
    throw new Error('Usage: shots.mjs <url?demo=1> <outDir> [--routes /,/features] [--allow-live]');
  let routes;
  let allowLive = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--allow-live') allowLive = true;
    else if (args[i] === '--routes' && args[i + 1]) routes = args[++i].split(',');
    else throw new Error(`Unknown or incomplete option: ${args[i]}`);
  }
  const base = new URL(input);
  if (!allowLive && base.searchParams.get('demo') !== '1') {
    throw new Error(
      'Refusing a URL without ?demo=1. Add ?demo=1, or explicitly use --allow-live with output under .orch.',
    );
  }
  const targets = (routes ?? [base.href]).map((route) => captureUrl(base, route, allowLive));
  const outDir = path.resolve(output);
  if (allowLive) {
    const orch = await realpath(path.join(root, '.orch'));
    const relative = path.relative(orch, outDir);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
      throw new Error('--allow-live output must be a subdirectory of this worktree’s .orch.');
    // Validate existing ancestors before creating anything, including through symlinks.
    let ancestor = outDir;
    while (true) {
      try {
        const resolved = await realpath(ancestor);
        const rel = path.relative(orch, resolved);
        if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Output symlink escapes .orch.');
        break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        ancestor = path.dirname(ancestor);
      }
    }
  }
  if (allowLive) {
    await mkdir(path.dirname(outDir), { recursive: true });
    // A fresh directory prevents overwriting tracked files or following file symlinks.
    await mkdir(outDir);
    await writeFile(path.join(outDir, '.gitignore'), '*\n', { flag: 'wx' });
  } else {
    await mkdir(outDir, { recursive: true });
  }
  const names = new Set();
  const pages = targets.map((url) => {
    const parsed = new URL(url);
    const name =
      parsed.pathname === '/'
        ? 'home'
        : parsed.pathname.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9_-]/g, '-');
    if (names.has(name)) throw new Error(`Routes produce the same filename: ${name}`);
    names.add(name);
    return { url, name };
  });
  const browser = await chromium.launch(launchOptions());
  const figures = [];
  try {
    for (const { url, name } of pages) {
      for (const width of widths) {
        for (const theme of themes) {
          const context = await browser.newContext({
            viewport: { width, height },
            deviceScaleFactor: 1,
            colorScheme: theme,
            reducedMotion: 'reduce',
            locale: 'en-US',
            timezoneId: 'UTC',
            serviceWorkers: 'block',
          });
          try {
            await prepareContext(context, theme, allowLive);
            const page = await context.newPage();
            await settle(page, url, theme);
            const filename = `${name}@${width}-${theme}.png`;
            await page.screenshot({
              path: path.join(outDir, filename),
              fullPage: true,
              animations: 'disabled',
            });
            figures.push(
              `<figure><a href="${filename}"><img loading="lazy" width="320" src="${filename}" alt="${escapeHtml(name)} at ${width}px in ${theme} mode"></a><figcaption>${escapeHtml(filename)}</figcaption></figure>`,
            );
          } finally {
            await context.close();
          }
        }
      }
    }
  } finally {
    await browser.close();
  }
  await writeFile(
    path.join(outDir, 'index.html'),
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fleet visual captures</title><body><h1>Fleet visual captures</h1><main style="display:flex;flex-wrap:wrap;align-items:start">${figures.join('\n')}</main></body></html>\n`,
  );
  console.log(`Captured ${figures.length} screenshots in ${outDir}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
