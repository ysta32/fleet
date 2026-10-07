import { expect, test } from '@playwright/test';
import { captureUrl, height, prepareContext, settle, themes, widths } from '../../scripts/visual.config.mjs';

const appUrl = process.env.VISUAL_APP_URL ?? 'http://127.0.0.1:4501/?demo=1';
const siteUrl = process.env.VISUAL_SITE_URL ?? 'http://127.0.0.1:4503/?demo=1';
const surfaces = [
  { name: 'app', base: appUrl, routes: ['/'] },
  {
    name: 'site',
    base: siteUrl,
    routes: ['/', '/features', '/pricing', '/docs', '/about', '/privacy', '/terms'],
  },
];

for (const surface of surfaces) {
  for (const route of surface.routes) {
    for (const width of widths) {
      for (const theme of themes) {
        const name = route === '/' ? 'home' : route.slice(1).replaceAll('/', '-');
        test(`${surface.name}/${name} @ ${width} ${theme}`, async ({ context, page }) => {
          await page.setViewportSize({ width, height });
          await prepareContext(context, theme);
          await settle(page, captureUrl(surface.base, route), theme);
          await expect(page).toHaveScreenshot(`${surface.name}-${name}@${width}-${theme}.png`, {
            fullPage: true,
            animations: 'disabled',
            maxDiffPixelRatio: 0.02,
          });
        });
      }
    }
  }
}
