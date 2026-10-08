// Fixture tests for scripts/defer-hydration.mjs: run with `npm test -w @fleet/site`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOAD_FALLBACK_MS, loaderUrls, manifestOf, rewrite } from './defer-hydration.mjs';

const A = '/_next/static/chunks/18-abc.js';
const W = '/_next/static/chunks/webpack-def.js';
const POLY = '/_next/static/chunks/polyfills-123.js';
const all = () => true;
const page = (head, body = '') =>
  `<!DOCTYPE html><html><head>${head}</head><body><main>hi</main>` +
  `<script>(self.__next_f=self.__next_f||[]).push([0])</script>${body}</body></html>`;
const eager = (html) => [...html.matchAll(/<script\b[^>]*\bsrc="\/_next\/[^"]*"[^>]*>/g)].map((m) => m[0]);

test('moves async runtime chunks into one loader, keeping ids, inline payload and the noModule polyfill', () => {
  const html = page(
    `<script src="${A}" async=""></script><script src="${POLY}" noModule=""></script>`,
    `<script src="${W}" id="_R_" async=""></script>`,
  );
  const r = rewrite(html, all);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.moved, [
    [A, null],
    [W, '_R_'],
  ]);
  assert.deepEqual(eager(r.html), [`<script src="${POLY}" noModule="">`]);
  assert.match(r.html, /self\.__next_f/);
  assert.deepEqual(loaderUrls(r.html), [A, W]);
  assert.equal(r.html.match(/data-defer-hydration/g).length, 1);
});

test('the fallback timer is armed whatever the browser supports', () => {
  const r = rewrite(page(`<script src="${A}" async=""></script>`), all);
  const body = /<script data-defer-hydration="">([\s\S]*?)<\/script>/.exec(r.html)[1];
  const fallback = `setTimeout(go,${LOAD_FALLBACK_MS})`;
  assert.ok(body.indexOf(fallback) >= 0 && body.indexOf(fallback) < body.indexOf('supportedEntryTypes'));
});

for (const [name, tag] of [
  ['defer instead of async', `<script src="${W}" defer=""></script>`],
  ['a query string', `<script src="${W}?v=1" async=""></script>`],
  ['a whitespace body', `<script src="${W}" async=""> </script>`],
  ['a type attribute', `<script src="${W}" async="" type="module"></script>`],
  ['no async at all', `<script src="${W}"></script>`],
]) {
  test(`rejects a runtime script with ${name}, even beside recognised chunks`, () => {
    const html = page(`<script src="${A}" async=""></script>${tag}`);
    const r = rewrite(html, all);
    assert.equal(r.problems.length, 1, r.problems.join('\n'));
    assert.equal(r.html, html, 'nothing is rewritten when a page has a problem');
  });
}

test('rejects a moved chunk missing from the export', () => {
  const r = rewrite(page(`<script src="${A}" async=""></script>`), (u) => u !== A);
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /missing/);
});

test('re-running over a rewritten page re-validates its loader manifest', () => {
  const once = rewrite(page(`<script src="${A}" async=""></script>`), all);
  const again = rewrite(once.html, all);
  assert.deepEqual(again.problems, []);
  assert.equal(again.html, once.html);
  const gone = rewrite(once.html, (u) => u !== A);
  assert.equal(gone.problems.length, 1);
  assert.match(gone.problems[0], /missing/);
});

test('rejects a page that has a loader and eager chunks, or an unreadable loader', () => {
  const once = rewrite(page(`<script src="${A}" async=""></script>`), all).html;
  const mixed = once.replace('</head>', `<script src="${W}" async=""></script></head>`);
  assert.ok(rewrite(mixed, all).problems.some((p) => /still eager/.test(p)));
  const broken = once.replace(/var s=\[[^\]]*\]\]/, 'var s=oops');
  assert.ok(rewrite(broken, all).problems.some((p) => /unreadable manifest/.test(p)));
});

test('pages without runtime scripts are left alone', () => {
  const html = '<html><body><script>1</script></body></html>';
  assert.deepEqual(rewrite(html, all), { html, moved: [], problems: [] });
  assert.equal(manifestOf('not a loader'), null);
});
