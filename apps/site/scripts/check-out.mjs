// Post-build gate over the static export (apps/site/out):
//  - every internal href/src/srcset/poster/og:image in every HTML page resolves to a file in out/
//  - every page listed in REQUIRED exists
//  - nothing in the export calls /api (the site is static and must never hit a collector)
import { readFile, readdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loaderUrls } from './defer-hydration.mjs';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../out');
const REQUIRED = [
  'index',
  '404',
  'features',
  'pricing',
  'changelog',
  'docs',
  'faq',
  'about',
  'privacy',
  'terms',
  'press',
  'status',
  'demo',
];

async function files(dir) {
  const acc = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) acc.push(...(await files(p)));
    else acc.push(p);
  }
  return acc;
}

const exists = (urlPath) => {
  const abs = path.join(out, decodeURIComponent(urlPath));
  if (!abs.startsWith(out)) return false;
  return [abs, abs + '.html', path.join(abs, 'index.html')].some(
    (c) => existsSync(c) && statSync(c).isFile(),
  );
};

const problems = [];
for (const r of REQUIRED)
  if (!existsSync(path.join(out, `${r}.html`))) problems.push(`missing page: ${r}.html`);

const all = await files(out);
let checked = 0;
for (const f of all.filter((f) => f.endsWith('.html'))) {
  const html = await readFile(f, 'utf8');
  const refs = new Set();
  for (const m of html.matchAll(/\s(?:href|src|poster)="([^"]+)"/g)) refs.add(m[1]);
  for (const m of html.matchAll(/\s(?:srcset|srcSet|imageSrcSet)="([^"]+)"/g))
    for (const part of m[1].split(',')) refs.add(part.trim().split(/\s+/)[0]);
  for (const m of html.matchAll(
    /<meta[^>]+(?:property|name)="(?:og:image|twitter:image)"[^>]+content="([^"]+)"/g,
  ))
    refs.add(new URL(m[1]).pathname);
  // runtime chunks moved into the post-paint loader (scripts/defer-hydration.mjs) are refs like any src
  for (const u of loaderUrls(html)) refs.add(u);
  for (const raw of refs) {
    const ref = raw.replace(/&amp;/g, '&');
    if (/^(https?:|mailto:|data:|#|\/\/)/.test(ref)) continue;
    const u = new URL(ref, 'http://site' + '/' + path.relative(out, f).replace(/\.html$/, ''));
    checked++;
    if (!exists(u.pathname)) problems.push(`${path.relative(out, f)}: broken ${ref}`);
  }
}
for (const f of all.filter((f) => /\.(html|js|css|json)$/.test(f))) {
  const text = await readFile(f, 'utf8');
  // Network calls aimed at /api (fetch, EventSource, WebSocket, beacons, XHR, <link>/<a> URLs). Next's runtime
  // contains a route-classifier string test for "/api/", which is not a request and is not matched here.
  const m =
    /(?:fetch|EventSource|WebSocket|sendBeacon|\.open)\(\s*(?:[^,()]*,\s*)?[`'"](?:https?:\/\/[^/'"`]*)?\/api\/|(?:href|src|action)=["']\/api\//.exec(
      text,
    );
  if (m)
    problems.push(
      `${path.relative(out, f)}: requests /api/ near "${text.slice(Math.max(0, m.index - 40), m.index + 40)}"`,
    );
}

if (problems.length) {
  console.error(`[check-out] ${problems.length} problem(s):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(
  `[check-out] ok: ${REQUIRED.length} pages present, ${checked} internal refs resolve, no /api references`,
);
