/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

interface Policy {
  shouldHandle(method: string, url: URL, origin: string): boolean;
  isShellNavigation(mode: string, status: number, contentType: string | null): boolean;
  isCacheableAsset(pathname: string, shell: string[]): boolean;
  shellAssets(html: string): string[];
}
const sandbox: { self: { fleetSwPolicy?: Policy }; URL: typeof URL } = { self: {}, URL };
runInNewContext(readFileSync(new URL('../../public/sw-policy.js', import.meta.url), 'utf8'), sandbox);
const policy = sandbox.self.fleetSwPolicy!;
const origin = 'http://fleet.local:4317';

describe('service worker policy', () => {
  it('never handles /api or URLs carrying a token', () => {
    expect(policy.shouldHandle('GET', new URL(`${origin}/api/snapshot`), origin)).toBe(false);
    expect(policy.shouldHandle('GET', new URL(`${origin}/api`), origin)).toBe(false);
    expect(policy.shouldHandle('GET', new URL(`${origin}/?token=abc`), origin)).toBe(false);
    expect(policy.shouldHandle('POST', new URL(`${origin}/`), origin)).toBe(false);
    expect(policy.shouldHandle('GET', new URL('https://elsewhere.example/x.js'), origin)).toBe(false);
    expect(policy.shouldHandle('GET', new URL(`${origin}/assets/index-abc.js`), origin)).toBe(true);
  });
  it('only lets successful HTML navigations replace the cached shell', () => {
    expect(policy.isShellNavigation('navigate', 200, 'text/html; charset=utf-8')).toBe(true);
    expect(policy.isShellNavigation('navigate', 200, 'image/png')).toBe(false);
    expect(policy.isShellNavigation('navigate', 401, 'text/html')).toBe(false);
    expect(policy.isShellNavigation('navigate', 200, 'application/json')).toBe(false);
    expect(policy.isShellNavigation('no-cors', 200, 'text/html')).toBe(false);
    expect(policy.isShellNavigation('navigate', 200, null)).toBe(false);
  });
  it('extracts built assets from index.html for precaching', () => {
    const html =
      '<link rel="icon" href="/favicon.svg"><script type="module" crossorigin src="/assets/index-a1.js"></script>' +
      '<link rel="modulepreload" href="/assets/vendor-b2.js"><link rel="stylesheet" href="/assets/index-c3.css">' +
      '<script src="/assets/index-a1.js"></script>';
    expect(policy.shellAssets(html)).toEqual([
      '/assets/index-a1.js',
      '/assets/vendor-b2.js',
      '/assets/index-c3.css',
    ]);
  });
  it('caches only static shell paths', () => {
    expect(policy.isCacheableAsset('/assets/x.js', ['/favicon.svg'])).toBe(true);
    expect(policy.isCacheableAsset('/favicon.svg', ['/favicon.svg'])).toBe(true);
    expect(policy.isCacheableAsset('/api/history', ['/api/history'])).toBe(false);
    expect(policy.isCacheableAsset('/random.json', ['/favicon.svg'])).toBe(false);
  });
});
