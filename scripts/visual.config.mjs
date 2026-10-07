import { defineConfig, chromium } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const widths = [375, 768, 1280, 1920];
export const themes = ['light', 'dark'];
export const height = 900;

export function launchOptions() {
  if (existsSync(chromium.executablePath())) return {};
  const cache = path.join(homedir(), 'Library/Caches/ms-playwright/chromium-1243');
  if (existsSync(cache)) {
    for (const entry of readdirSync(cache)) {
      const executablePath = path.join(
        cache,
        entry,
        'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
      );
      if (existsSync(executablePath)) return { executablePath };
    }
  }
  throw new Error('No compatible Chromium found. Install the pinned Playwright Chromium browser.');
}

export function captureUrl(base, route, allowLive = false) {
  const url = new URL(route, base);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.origin !== new URL(base).origin ||
    url.username ||
    url.password
  ) {
    throw new Error('Routes must be HTTP(S), same-origin, and contain no credentials.');
  }
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('Captures are limited to 127.0.0.1 or localhost.');
  }
  if (!url.port || Number(url.port) < 4500 || Number(url.port) > 4599) {
    throw new Error('Server port must be explicit and in 4500–4599.');
  }
  if (!allowLive) url.searchParams.set('demo', '1');
  url.searchParams.set('freeze', '1');
  url.searchParams.set('seed', 'fleet-visual-v1');
  return url.href;
}

export async function prepareContext(context, theme, allowLive = false) {
  await context.addInitScript((value) => {
    const apply = () => document.documentElement?.setAttribute('data-theme', value);
    apply();
    new MutationObserver(apply).observe(document, { childList: true, subtree: true });
  }, theme);
  if (!allowLive) {
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      const liveApi = /^\/api(?:\/|$)/.test(url.pathname);
      const unsafeDocument = route.request().isNavigationRequest() && url.searchParams.get('demo') !== '1';
      return liveApi || unsafeDocument ? route.abort() : route.continue();
    });
    await context.routeWebSocket('**/*', (socket) => socket.close());
  }
}

export async function settle(page, url, theme) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  const response = await page.goto(url, { waitUntil: 'networkidle' });
  if (!response?.ok()) throw new Error(`Page failed to load: ${url} (${response?.status()})`);
  await page.evaluate((value) => {
    document.documentElement.setAttribute('data-theme', value);
    return document.fonts.ready.then(() => undefined);
  }, theme);
  await page.addStyleTag({
    content:
      '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }',
  });
  await page.waitForTimeout(1500);
}

export default defineConfig({
  testDir: path.join(root, 'tests/visual'),
  outputDir: path.join(root, '.orch/visual-results'),
  snapshotPathTemplate: '{testDir}/baselines/{testFilePath}/{arg}{ext}',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.02, animations: 'disabled' } },
  use: {
    browserName: 'chromium',
    launchOptions: launchOptions(),
    viewport: { width: 1280, height },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  },
});
